# 15 状态与流程控制

> 用状态驱动复杂流程：条件分支、并行、子图与流式输出。第 14 章我们把"图怎么画"讲完了，这一章讲数据怎么在节点间流动，以及怎么用状态做出分支、并行、子图这些高级编排。

::: warning 动手前必读：API 版本核对清单
同第 14 章，**Spring AI Alibaba Graph 在 1.0.x → 1.1.x 之间 API 变动很大**。本章仍以官方教程与 DeepWiki 中**出现频率最高的 `OverAllState` + `KeyStrategyFactory` + `StateGraph` 风格**为准。凡下文标注"以你所用版本为准"之处，请到 `com.alibaba.cloud.ai.graph` 包下按以下清单核对：

| 概念 | 包路径 | 本文名字 |
| --- | --- | --- |
| 全局状态 | `com.alibaba.cloud.ai.graph` | `OverAllState` |
| 键策略接口 | `com.alibaba.cloud.ai.graph` | `KeyStrategy`（BiFunction） |
| 键策略工厂 | `com.alibaba.cloud.ai.graph` | `KeyStrategyFactory` |
| 替换策略 | `com.alibaba.cloud.ai.graph.state.strategy` | `ReplaceStrategy` |
| 追加策略 | `com.alibaba.cloud.ai.graph.state.strategy` | `AppendStrategy` |
| 条件边动作 | `com.alibaba.cloud.ai.graph.action` | `EdgeAction` / `AsyncEdgeAction` |
| 流式输出 | `com.alibaba.cloud.ai.graph.streaming` | `StreamingOutput` |
| 异步生成器 | `org.bsc.async` | `AsyncGenerator` |

> 若你用的是 1.1.x 且 `OverAllState` 的 API 变成了 `OverAllStateBuilder` + `Channel` 风格，请以你本地源码为准，本文给出的原理与示例结构依然适用。
:::

## 本篇要解决的问题

- `OverAllState` 到底是什么？节点怎么在它上面存取数据？
- 为什么有时"新值覆盖旧值"，有时"新值追加到列表末尾"？这就是 `KeyStrategy`。
- `REPLACE` / `APPEND` / `MERGE` 到底差在哪？为什么它是最容易踩坑的点？
- 条件边怎么写，才能根据状态动态选路？
- 多个节点并行跑，结果怎么合并回来？
- 子图怎么嵌套（把一张图当一个节点用）？
- 流式模式下，怎么逐节点拿到中间结果？
- "SuperStep 执行模型"是什么鬼，为什么它能支持并行和图算法？

## OverAllState 全局状态

### 一个比喻：节点们共用的"背包"

第 14 章反复强调一句话：**节点之间不通过方法参数传值，全部通过 `OverAllState` 传递。**

把 `OverAllState` 想象成**所有节点共背的一个背包**（英文里常叫 blackboard，黑板）：

- 节点 A 干完活，把自己的结果塞进背包的某个格子（比如 `llm_answer` 格子）。
- 节点 B 启动时，从背包里翻出 `llm_answer` 格子，拿去用。
- 谁都不用知道上游是谁，只认"背包里的格子名"。**节点之间彻底解耦。**

```text
        ┌─────────── OverAllState（背包）───────────┐
        │  user_input: "你好"                        │
        │  normalized_input: "你好"                  │
        │  llm_answer: "你好！有什么可以帮你？"        │
        └───────────────────────────────────────────┘
              ▲ 写                ▲ 读        ▲ 写
          normalize            call_llm    save
```

### 怎么读、怎么写

`OverAllState` 提供两类取值方法（具体方法名以你版本为准，经典写法如下）：

```java
// 读：返回 Optional<Object>，类型不安全但万能
Optional<Object> v1 = state.value("llm_answer");

// 读：带目标类型，类型安全（推荐）
Optional<String> v2 = state.value("llm_answer", String.class);

// 写：节点不是直接往 state 里塞，而是 return 一个 Map，
//     框架会按 KeyStrategy 把 Map 合并进 state
return Map.of("llm_answer", "...");
```

::: tip 关键认知
**节点没有"写状态"的方法**，它只能通过 `return Map` 表达"我要更新这些字段"。框架拿到 Map 后，根据每个 key 的 `KeyStrategy` 决定"怎么把新值并到旧值上"。这就是下一节要讲的合并策略——整个 Graph 状态管理的核心。
:::

## Key 注册与 KeyStrategy

### 为什么需要"合并策略"

设想一个场景：节点 A 往 `messages` 字段写了 `"用户问了天气"`，节点 B 又往 `messages` 写了 `"模型回答了晴天"`。

那 `messages` 最终应该是什么？

- 如果你想要"只剩最新一条" → 新值**覆盖**旧值（`REPLACE`）。
- 如果你想要"两条都要，变成对话历史" → 新值**追加**到列表（`APPEND`）。
- 如果你想要"把两份 JSON 合并成一份" → 做**深合并**（`MERGE`）。

所以光有"字段名"不够，还得告诉框架"这个字段遇到新值时怎么合"。这就是 `KeyStrategy`，它是一个 `BiFunction`：

```java
// 签名语义：给定 (旧值 oldValue, 新值 newValue)，返回合并后的结果
@FunctionalInterface
public interface KeyStrategy {
    Object apply(Object oldValue, Object newValue);
}
```

### 在 KeyStrategyFactory 里注册

所有字段的合并策略，集中在 `KeyStrategyFactory` 里一次性声明（这就是第 14 章 `new StateGraph(factory)` 传的那个 factory）：

```java
KeyStrategyFactory factory = () -> {
    Map<String, KeyStrategy> strategies = new HashMap<>();
    strategies.put("user_input", new ReplaceStrategy());   // 用户输入：覆盖
    strategies.put("messages", new AppendStrategy());       // 对话历史：追加
    return strategies;
};
```

::: danger 最容易踩的坑：忘了注册 key
如果一个节点 `return Map.of("new_key", v)`，但 `KeyStrategyFactory` 里**没有** `new_key` 的合并策略：框架要么报错，要么**直接丢弃这条新值**。表现就是"下游节点读到的字段是空的"，而且很难排查。**新增状态字段时，务必同步到 factory。**
:::

## 常见策略对比

框架内置了几种常用策略实现，最常见的两个是 `ReplaceStrategy` 和 `AppendStrategy`。下面用代码逐个演示差异——这是全章**最该动手试**的部分。

### REPLACE：新值覆盖旧值（默认最常用）

```java
strategies.put("answer", new ReplaceStrategy());
```

节点 A 写 `answer="第一版"`，节点 B 写 `answer="终版"`：
```
最终 answer = "终版"   // 旧值被直接抹掉
```
**适合**：单值字段——用户输入、分类结果、最终答案、状态标记。

### APPEND：新值追加到列表（做对话历史必备）

```java
strategies.put("messages", new AppendStrategy());
```

节点 A 写 `messages="用户:你好"`，节点 B 写 `messages="模型:你好呀"`：
```
最终 messages = ["用户:你好", "模型:你好呀"]   // 累积成列表
```
**适合**：对话历史、工具调用记录、多轮累积结果。这是做"带记忆 Agent"的核心手段。

### MERGE：把两份 Map 深合并（做结构化累积）

`MERGE` 策略（部分版本命名为 `MergeStrategy` 或需自定义 lambda）用于把新 Map 合并进旧 Map：

```java
// 自定义 MERGE 策略：如果新旧都是 Map，就 putAll 合并
strategies.put("metadata", (oldValue, newValue) -> {
    Map<String, Object> result = new HashMap<>();
    if (oldValue instanceof Map) result.putAll((Map<? extends String, ?>) oldValue);
    if (newValue instanceof Map) result.putAll((Map<? extends String, ?>) newValue);
    return result;
});
```

节点 A 写 `metadata={a:1}`，节点 B 写 `metadata={b:2}`：
```
最终 metadata = {a:1, b:2}   // 两份合并，而不是被覆盖
```
**适合**：结构化累积信息，比如"逐步收集的用户画像"。

### 自定义 lambda：任意合并逻辑

`KeyStrategy` 就是个 `BiFunction`，你可以写任意逻辑。例如实现一个"计数器累加"：

```java
strategies.put("retry_count", (oldValue, newValue) -> {
    int old = (oldValue == null) ? 0 : (int) oldValue;
    int add = (newValue == null) ? 0 : (int) newValue;
    return old + add;   // 每次调用累加重试次数
});
```

### 三种策略一句话对比

| 策略 | 行为 | 典型字段 | 踩坑点 |
| --- | --- | --- | --- |
| `REPLACE` | 新值直接覆盖旧值 | `answer`、`status`、`user_input` | 误用会导致历史被冲掉 |
| `APPEND` | 新值追加到 List 末尾 | `messages`、`tool_calls` | 字段会变成 List，下游读取时要按列表处理 |
| `MERGE` | 两份 Map 合并 | `metadata`、`profile` | 嵌套深合并不完全，需自定义 |

::: tip 选错策略的经典症状
- 下游读到的是 `List` 却按 `String` 强转 → 八成某字段用了 `APPEND`，你却当成 `REPLACE` 用了。
- 历史只剩最后一条 → 八成该用 `APPEND` 的字段误用了 `REPLACE`。
:::

## 条件边与分支路由

条件边是实现"分支"的唯一手段。第 14 章给过简单版，这里讲透。

### EdgeAction：返回"下一个节点名"

```java
package com.example.saa.graph.state.route;

import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.action.EdgeAction;

/**
 * 根据分类结果选路。
 * 返回值是「路由 key」，再交给 addConditionalEdges 的 Map 翻译成真实节点名。
 */
public class SentimentRoute implements EdgeAction {
    @Override
    public String apply(OverAllState state) {
        // 读上游 QuestionClassifierNode 写入的 sentiment 字段
        return state.value("sentiment", String.class).orElse("neutral");
    }
}
```

### 注册条件边

```java
import com.alibaba.cloud.ai.graph.action.AsyncEdgeAction;
import static com.alibaba.cloud.ai.graph.action.AsyncEdgeAction.edge_async;

// 条件边：从 classifier 出来 → 调用路由动作 → 按返回 key 去 Map 里找目标节点
graph.addConditionalEdges(
        "classifier",
        edge_async(new SentimentRoute()),        // 异步版条件动作
        Map.of(
                "positive", "thank_you",         // 返回 positive → 去 thank_you 节点
                "negative", "apologize",         // 返回 negative → 去 apologize 节点
                "neutral",  "standard_reply"      // 返回 neutral  → 去 standard_reply 节点
        )
);
```

::: warning 路由 key 必须全覆盖
`EdgeAction` 可能返回的每一个值，都**必须**出现在 `Map` 里。若有遗漏，框架找不到目标节点会直接抛异常。稳妥起见，给一个"默认兜底"分支（比如都指到 `standard_reply`）。
:::

### 用 lambda 内联写更简洁

```java
graph.addConditionalEdges(
        "evaluator",
        edge_async(state ->
                "OK".equals(state.value("status", String.class).orElse(""))
                        ? "success" : "retry"),
        Map.of("success", "save", "retry", "evaluator")  // 注意：retry 指回自己，形成循环
);
```

上面这个 `retry → evaluator` 就是 Graph 表达"循环重试"的方式：**条件边把流程指回自己**。比对话式 Agent 那种"靠模型自觉重试"可控得多。

## 并行分支执行

### 一个节点发出多条边 = 自动并行

编译期，框架发现"一个节点连出去多条边"时，会自动把它变成 `ParallelNode`，用 `CompletableFuture.allOf()` 并发执行所有分支，全部完成后**汇聚**到下一个节点。

```text
START
 ├─> 节点A ─┐
 │          ├─> 汇合节点 merge ─> END
 └─> 节点B ─┘
```

```java
KeyStrategyFactory factory = () -> {
    Map<String, KeyStrategy> m = new HashMap<>();
    m.put("query", new ReplaceStrategy());
    m.put("expand_result", new AppendStrategy());   // 两路结果都追加进来
    m.put("translate_result", new AppendStrategy());
    m.put("merge_result", new ReplaceStrategy());
    return m;
};

StateGraph g = new StateGraph(factory)
        .addNode("expand", node_async(new ExpanderNode(chatClientBuilder)))
        .addNode("translate", node_async(new TranslateNode(chatClientBuilder)))
        .addNode("merge", node_async(new MergeNode()))
        .addEdge(START, "expand")        // START 同时连两条边 → 自动并行
        .addEdge(START, "translate")
        .addEdge("expand", "merge")      // 两路都到 merge 汇合
        .addEdge("translate", "merge")
        .addEdge("merge", END);
```

### 并行节点的结果怎么合并

关键就在**合并策略**。上面 `expand_result` 和 `translate_result` 都用了 `APPEND`，所以两个分支各自写回自己的 key、互不覆盖。汇合节点 `merge` 再从状态里把两份都读出来拼装：

```java
public class MergeNode implements NodeAction {
    @Override
    public Map<String, Object> apply(OverAllState state) {
        List<?> expanded = (List<?>) state.value("expand_result").orElse(List.of());
        List<?> translated = (List<?>) state.value("translate_result").orElse(List.of());
        // 把两路结果合成最终结果
        return Map.of("merge_result", "expanded=" + expanded + ", translated=" + translated);
    }
}
```

::: warning 并行 ≠ 任意共享可变状态
并行的两个分支**不要去改同一个 REPLACE 字段**，否则谁最后写谁赢，结果不确定。正确做法是：每个分支写**自己独立命名的字段**（或都 APPEND 到同一列表），最后由汇合节点统一读取合并。
:::

## 子图嵌套

### 把一张图当节点用

复杂流程可以拆成"子图"，子图整体作为一个节点挂到父图上。父图只看到 `B` 这一个节点，内部细节被隐藏。

```java
// 1. 先建一张子图
StateGraph subGraph = new StateGraph(subFactory)
        .addNode("b1", node_async(new B1Node()))
        .addNode("b2", node_async(new B2Node()))
        .addEdge(START, "b1")
        .addEdge("b1", "b2")
        .addEdge("b2", END);

// 2. 把子图当成一个节点 "B" 挂到父图
StateGraph parent = new StateGraph(parentFactory)
        .addNode("A", node_async(new ANode()))
        .addNode("B", subGraph)          // 注意：这里传的是 StateGraph 对象
        .addNode("C", node_async(new CNode()))
        .addEdge(START, "A")
        .addEdge("A", "B")
        .addEdge("B", "C")
        .addEdge("C", END);
```

### 编译时子图会被"拍平"

编译阶段，框架会**递归展开子图**，把 `B1`、`B2` 拍平成父图的节点，并用前缀重命名（如 `B:b1`、`B:b2`），父子图共享同一个 `OverAllState`。所以子图节点**读写的是同一块背包**，数据天然打通。

```text
父图视角：  START → A → B(子图) → C → END

编译拍平后：START → A → B:b1 → B:b2 → C → END
```

::: tip 子图的价值
- **复用**：同一张子图可以在多处、多父图里当节点用。
- **封装**：父图不用关心子图内部几十个节点怎么连。
- **团队分工**：子图可以独立开发测试。
:::

## 流式 Streaming

### invoke 与 stream 的区别

| 方法 | 返回 | 体验 |
| --- | --- | --- |
| `invoke(inputs, config)` | 跑完才返回**最终状态** | 前端干等，最后一次性给 |
| `stream(inputs, config)` | 返回 `AsyncGenerator`，**每跑完一个节点就吐一份** | 前端能实时看到"走到哪了、出了什么中间结果" |

### 逐节点拿中间结果

```java
package com.example.saa.graph.state.controller;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.streaming.StreamingOutput;
import org.bsc.async.AsyncGenerator;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/graph/state")
public class StreamGraphController {

    private final CompiledGraph graph;

    public StreamGraphController(CompiledGraph graph) {
        this.graph = graph;
    }

    @GetMapping("/stream")
    public String stream(@RequestParam(defaultValue = "介绍一下 Graph") String msg) throws Exception {
        RunnableConfig config = RunnableConfig.builder().threadId("stream-demo").build();

        StringBuilder sb = new StringBuilder();
        // stream 返回 AsyncGenerator，逐节点产出输出
        AsyncGenerator<?, ?> generator = graph.stream(Map.of("user_input", msg), config);

        // 遍历每一个节点产出
        for (Object output : generator) {
            if (output instanceof StreamingOutput so) {
                // node() 告诉你这是哪个节点的产出，chunk() 是它的内容片段
                sb.append("节点[").append(so.node()).append("] 产出：")
                  .append(so.chunk()).append("\n");
            } else {
                sb.append("其他输出：").append(output).append("\n");
            }
        }
        return sb.toString();
    }
}
```

::: tip StreamingOutput 的两个核心方法
- `node()`：本次产出来自哪个节点（排查"卡在哪"很有用）。
- `chunk()`：产出内容（可能是字符串，也可能是流式 token 片段，取决于节点是否支持流式）。
:::

## SuperStep 执行模型（通俗讲解）

### 为什么叫"超级步"

Graph 的底层执行引擎借鉴了**图计算（如 Pregel）的 BSP 模型**：每一轮叫一个 **SuperStep（超级步）**。

通俗理解：

```text
超级步 1：从 START 出发，把所有"已就绪"的节点（本例只有 normalize）一起执行
            ↓ 每个节点读背包、算、写回背包
超级步 2：根据边重新计算"下一步该执行谁"（call_llm 就绪了）
            ↓
超级步 3：执行 call_llm，写回 llm_answer
            ↓
……直到没有节点就绪（到达 END）
```

### 它为什么能支撑"并行"和"图算法"

- **并行**：一个超级步里，所有"入边都满足了"的节点会被**同时**调度执行（这就是前面并行分支的实现原理——同一超级步里启动多个分支）。
- **收敛**：超级步之间不共享执行顺序，只通过"背包状态 + 边"传递信息。所以像 PageRank、最短路径这类图算法也能跑在 Graph 上。
- **防死循环**：框架有"最大超级步数"限制（默认上限，不同版本不同；可用 `CompileConfig` 或 `setMaxIterations` 调节），避免条件边把流程指回自己形成无限循环。

```text
超级步机制一句话：
  每一轮，所有"可以跑"的节点一起跑；跑完看边决定下一轮谁跑。
  节点彼此不直接喊话，只通过背包 + 边"隔轮"通信。
```

::: warning 循环要设上限
用条件边做「retry → 自己」这类循环时，**务必给最大迭代次数**，否则真出 bug 会无限循环直到耗尽资源。生产环境这个值要显式配置。
:::

## 本篇小结

- **OverAllState 是共享背包**：节点只从它读入参、用 `return Map` 写出参，节点间彻底解耦。
- **KeyStrategy 决定"新值如何合进旧值"**：`REPLACE` 覆盖（单值）、`APPEND` 追加成列表（历史）、`MERGE` 合并 Map（结构化累积），还能自定义 lambda。漏注册 key 会静默丢数据。
- **条件边 = EdgeAction 返回值 + 路由表**：返回 key 去 Map 里查下一个节点；返回值必须全覆盖，靠它可实现分支与"循环重试"。
- **并行 = 一个节点连多条边**：编译期自动变 ParallelNode 并发执行，各分支写独立字段、由汇合节点统一合并。
- **子图 = 把一张图当节点**：编译时被拍平、前缀重命名，父子共享同一背包，利于复用与封装。
- **stream 逐节点吐结果**：用 `StreamingOutput.node()/chunk()` 实时拿到中间产出。
- **SuperStep 是执行内核**：每轮并行跑所有就绪节点，靠背包+边隔轮通信，并受最大步数限制防死循环。

## 参考链接

- OverAllState 与 KeyStrategy（DeepWiki）：<https://deepwiki.com/alibaba/spring-ai-alibaba/3.1-overview-and-core-concepts>
- StateGraph 执行引擎（DeepWiki）：<https://deepwiki.com/kuyusea/spring-ai-alibaba/2.1-stategraph-execution-engine>
- 并行节点官方教程：<https://java2ai.com/en/docs/1.0.0.2/tutorials/graph/parallel-node/>
- 条件边/人工节点教程：<https://java2ai.com/en/docs/1.0.0.2/tutorials/graph/human-in-the-loop/>

下一篇 → [16 持久化与断点续跑](/java/saa/graph-persist)
