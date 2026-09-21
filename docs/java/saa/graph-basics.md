# 14 Graph 构图基础

> SAA 的底层运行时，一切 Agent 最终都跑在 StateGraph 之上。这一章不急着上高级玩法，先把"图是什么、节点怎么写、边怎么连、编译后怎么跑"这套最朴素也最容易被劝退的流程，从零讲透。

::: warning 动手前必读：API 版本核对清单
Spring AI Alibaba 的 Graph 模块（包名 `com.alibaba.cloud.ai.graph`）在 **1.0.x → 1.1.x** 之间发生过**包名与类名的大改**。本文所有代码以官方教程与 DeepWiki 中**出现频率最高**的 `StateGraph(KeyStrategyFactory)` 风格为准（也是 `spring-ai-alibaba-graph-core` 的经典写法）。

**如果你用 1.1.2.0 跑不通，请按下面这份清单逐类核对**（在 IDE 里 Ctrl+点击类名即可跳转源码确认）：

| 我要用的东西 | 应该在的包 | 本文用的名字 | 若报红请查 |
| --- | --- | --- | --- |
| 图定义 | `com.alibaba.cloud.ai.graph` | `StateGraph` | 是否改到 `graph` 子包 |
| 可执行图 | `com.alibaba.cloud.ai.graph` | `CompiledGraph` | 同上 |
| 全局状态 | `com.alibaba.cloud.ai.graph` | `OverAllState` | 同上 |
| 键策略 | `com.alibaba.cloud.ai.graph` | `KeyStrategy` / `KeyStrategyFactory` | 新版可能叫 `OverAllStateBuilder` + `Channel` |
| 节点动作 | `com.alibaba.cloud.ai.graph.action` | `NodeAction` / `AsyncNodeAction` | 方法名 `node_async` 与 `nodeasync` 两版并存 |
| 边动作 | `com.alibaba.cloud.ai.graph.action` | `EdgeAction` / `AsyncEdgeAction` | 方法名 `edge_async` 与 `edgeasync` 两版并存 |
| 键策略实现 | `com.alibaba.cloud.ai.graph.state.strategy` | `ReplaceStrategy` / `AppendStrategy` | 包路径是否变动 |
| 编译配置 | `com.alibaba.cloud.ai.graph` | `CompileConfig` / `RunnableConfig` | 同上 |
| 图可视化 | `com.alibaba.cloud.ai.graph` | `GraphRepresentation` | 同上 |

> **铁律**：凡本文代码在你所用版本报红，**以你本地 `spring-ai-alibaba-graph-core` 源码为准**，不要凭记忆把类名硬改。本文在每处关键 API 都标注了包名，方便你对照。下文若说"具体 API 以你所用版本的官方文档为准"，即表示作者无法在写作时 100% 确认该方法的精确签名。
:::

## 本篇要解决的问题

读完后你应该能回答：

- 为什么"对话式 Agent"不够用，非要引入 Graph？
- `StateGraph` 和 `CompiledGraph` 到底差在哪，为什么必须编译？
- 一个节点（Node）怎么写、它的入参出参是什么？
- 普通边和条件边怎么连？`START` / `END` 是什么鬼？
- 框架内置了哪些开箱即用的节点（LlmNode / ToolNode / HumanNode …）？
- 怎么把图"画"出来排查问题？有哪些必踩的坑？

下面全程从纯小白视角讲，先懂"为什么"，再学"怎么写"。

## 为什么需要 Graph

### 用一个比喻：对话式 Agent 是"单行道"

把普通的对话式 Agent（比如第 10 章的 ReactAgent）想象成一条**单行道**：

```text
用户提问 ──→ 模型思考 ──→ 调工具 ──→ 再思考 ──→ 给答案
```

它确实能"循环"（思考→工具→思考），但这种循环是**模型自己决定的**，你作为开发者**没法精确控制**：哪一步该分支、哪一步该回退、哪些步骤必须并行。**流程的走向完全交给模型临场发挥。**

这就像你给一个很聪明但自由散漫的同事派活：他大概率能干好，但你没法保证他一定先打草稿再发邮件，也没法强制他在"金额超过 1 万"时停下来找你签字。

### Graph 是把流程"画"成一张图

Graph（状态图）的想法的核心就一句话：**把流程画成一张图，节点（Node）负责干活，边（Edge）负责决定"下一步去哪"。**

```text
          ┌─(条件:是)─→ 走审批节点 ─┐
START ──→ 分类节点                   汇总节点 ──→ END
          └─(条件:否)─→ 直接答复 ───┘
```

对比一下你就懂了：

| 维度 | 对话式 Agent（ReactAgent） | Graph 状态图 |
| --- | --- | --- |
| 流程走向 | 模型临场决定（不可控） | 你用代码画死（可控） |
| 表达能力 | 只能"向前"推理 + 循环 | 支持**分支、循环、回退、并行** |
| 可预测性 | 低，同一输入可能走不同路 | 高，路径完全由边决定 |
| 调试 | 黑盒，难复现 | 白盒，每一步状态可查 |
| 适合 | 探索性、开放式任务 | 流程固定、要合规、要可审计的业务 |

::: tip 一句话记住
**ReactAgent 是"让模型自己想下一步"，Graph 是"你规定好每一步往哪走"。** 不是谁替代谁，而是复杂/严肃的业务用 Graph 把控制权拿回自己手里。
:::

所以这一章（14）讲"怎么把图画出来"，下一章（15）讲"状态怎么在节点间流动"，下下章（16）讲"跑到一半崩了怎么续"。

## 核心概念总览

先用一张表把后面要反复出现的概念一次性认全脸：

| 概念 | 大白话 | 在代码里的样子 |
| --- | --- | --- |
| **StateGraph** | 画图用的"蓝图"，只定义不执行 | `new StateGraph(factory).addNode(...).addEdge(...)` |
| **Node（节点）** | 一个干活的最小单元（一次 LLM 调用 / 一次工具调用 / 一段业务逻辑） | 实现 `NodeAction` 接口的 `apply(OverAllState)` 方法 |
| **Edge（边）** | 连接两个节点，决定"干完这个去干哪个" | `addEdge(a, b)` 普通边；`addConditionalEdges(...)` 条件边 |
| **START / END** | 图的特殊起点和终点，所有流程从 START 进、到 END 出 | `StateGraph.START` / `StateGraph.END` |
| **OverAllState** | 节点们共享的"黑板/背包"，所有数据都放在这上面传递 | `state.value("key")` 取值；return 的 Map 写值 |
| **CompiledGraph** | 蓝图编译后的"可执行引擎"，真正能跑的东西 | `graph.compile()` 得到，再 `invoke` / `stream` |
| **KeyStrategy** | 每个状态字段的"合并策略"（新值覆盖旧值？还是追加？） | `ReplaceStrategy` / `AppendStrategy` |

记住一条主线：**先 new 一个 StateGraph（蓝图）→ 往里塞节点和边 → compile() 成 CompiledGraph → invoke() 跑起来。**

## StateGraph 与 CompiledGraph

### StateGraph：只是蓝图

`StateGraph` 本身**不会执行任何逻辑**，它只是把"有哪些节点、怎么连"记下来。你可以把它理解成建筑施工图——图上有水管电线，但没人住进去、没通电，它就不产生任何效果。

构造一个 `StateGraph` 时，必须告诉它**有哪些状态字段、每个字段怎么合并**。这就是 `KeyStrategyFactory`：

```java
// 它是一个函数式接口：无参，返回一个「字段名 -> 合并策略」的 Map
KeyStrategyFactory factory = () -> {
    Map<String, KeyStrategy> strategies = new HashMap<>();
    strategies.put("user_input", new ReplaceStrategy());   // 用户输入：直接覆盖
    strategies.put("llm_answer", new ReplaceStrategy());    // 模型回答：直接覆盖
    return strategies;
};

StateGraph graph = new StateGraph(factory);  // 这时候图还是空的
```

::: warning KeyStrategyFactory 不能省
`new StateGraph()` 无参构造在某些版本存在，但**生产写法都传 `KeyStrategyFactory`**。漏了它，节点 return 出去的 Map 不知道怎么合并进状态，要么报错要么静默丢失数据。第 15 章会专门讲清楚合并策略。
:::

### START 和 END 是什么

`StateGraph` 里有俩特殊常量：

- `StateGraph.START`：流程的起点。任何图都**必须**有一条从 `START` 出发的边，否则"没人启动这张图"。
- `StateGraph.END`：流程的终点。流程跑到 `END` 就结束，返回最终状态。

```java
graph.addEdge(StateGraph.START, "first_node");  // 图一启动就进 first_node
graph.addEdge("last_node", StateGraph.END);     // last_node 干完就结束
```

### compile()：蓝图变引擎

蓝图画好之后，必须 **编译** 才能跑。编译时会做几件重要的事：

1. **校验**：有没有从 START 出发的边？有没有边指向不存在的节点？条件边的分支有没有覆盖不全？
2. **优化**：把"从一个节点出发的多条边"自动识别成并行节点（第 15 章讲）。
3. **生成可执行引擎**：返回一个 `CompiledGraph`。

```java
CompiledGraph compiled = graph.compile();
```

`CompiledGraph` 提供两种执行方式：

| 方法 | 行为 | 适合 |
| --- | --- | --- |
| `invoke(Map inputs, RunnableConfig config)` | **同步**跑完，返回最终状态 | 一次性拿结果 |
| `stream(Map inputs, RunnableConfig config)` | **流式**，每跑完一个节点就吐一份中间结果 | 前端要实时看到进度 |

`RunnableConfig` 里最关键的是 `threadId`——它用来隔离不同会话（第 16 章讲持久化时会重点用）。先有个印象：

```java
RunnableConfig config = RunnableConfig.builder()
        .threadId("user-123-session-1")   // 这一趟执行的唯一身份
        .build();
```

## Node 节点

### 节点的本质：一个"读黑板、写黑板"的函数

每个节点就是一个**实现了 `NodeAction` 接口的类**。接口只有一个方法：

```java
public interface NodeAction {
    /**
     * @param state 当前全局状态（黑板），你能从中读数据
     * @return 你要写回黑板的数据（框架会按 KeyStrategy 合并进去）
     */
    Map<String, Object> apply(OverAllState state) throws Exception;
}
```

**这是整个 Graph 里最重要的心智模型**，请默念三遍：

> 节点不保存任何自己的变量。它只做两件事——**从 `OverAllState` 读入参，向 `OverAllState` 写出参（用返回的 Map）**。

### 同步节点 vs 异步节点

- **同步**：直接实现 `NodeAction`，`apply` 返回 `Map`。
- **异步**：用 `AsyncNodeAction` 包装，框架帮你用 `CompletableFuture` 跑，提升吞吐、避免阻塞。

实际开发中几乎都写成同步逻辑，然后用 `node_async(...)` 包一层变成异步。注意不同版本静态方法名不同：`node_async`（1.0.x 经典）或 `nodeasync`（部分 1.1.x）。**本文统一用 `node_async`，若你版本编译报红，改成 `nodeasync` 即可。**

```java
import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;

// 把任意 NodeAction 包成异步节点挂到图上
graph.addNode("my_node", node_async(new MyNode()));
```

### 一个完整节点长什么样

下面这个节点干的事很简单：把用户输入转成小写、去掉首尾空格，写回状态。

```java
package com.example.saa.graph.basic;

import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.action.NodeAction;

import java.util.Map;

/**
 * 归一化节点：清洗用户输入。
 *
 * 为什么单独成一个节点？因为只有"干净的标准输入"才能让后面的 LLM 调用更稳定。
 * 这种"前处理"在 Graph 里很常见：每个节点只做一件事，职责单一、好测试。
 */
public class NormalizeNode implements NodeAction {

    /**
     * @param state 全局状态，从中读取 "user_input"
     * @return 写回 "normalized_input" 字段
     */
    @Override
    public Map<String, Object> apply(OverAllState state) {
        // 1. 从黑板读入参。value(key, 类型) 返回 Optional，类型安全
        String raw = state.value("user_input", String.class).orElse("");

        // 2. 干活：清洗
        String cleaned = raw.trim().toLowerCase();

        // 3. 写回黑板。返回的 Map 的 key 必须已在 KeyStrategyFactory 里注册过
        return Map.of("normalized_input", cleaned);
    }
}
```

::: danger 节点最常见的两个错误
1. **`return Map.of()` 或返回空 Map**：你啥都没写回，等于这节点白干，状态里不会有任何新东西。
2. **返回的 key 没在 `KeyStrategyFactory` 注册**：框架不知道怎么合并，结果要么报错要么直接丢弃。
:::

## Edge 边

### 普通边：干完 A 必去 B

```java
graph.addEdge("normalize", "call_llm");
```

含义：当 `normalize` 节点执行完，无条件跳到 `call_llm`。简单直接，没有分支。

### 条件边：干完 A，看情况去不同地方

条件边是 Graph 实现"分支"的关键。它需要一个 **`EdgeAction`**（或异步版 `AsyncEdgeAction`）：

```java
public interface EdgeAction {
    /** 根据当前状态，返回"下一个节点名" */
    String apply(OverAllState state) throws Exception;
}
```

然后配合一个"路由表" `Map<路由key, 节点名>`：

```java
import com.alibaba.cloud.ai.graph.action.EdgeAction;

// 1. 先定义一个路由动作：读状态里的分类结果，返回路由 key
EdgeAction routeBySentiment = state -> {
    String sentiment = state.value("sentiment", String.class).orElse("neutral");
    return sentiment;   // 返回 "positive" / "negative" / "neutral"
};

// 2. 注册条件边：路由 key 决定去哪个节点
graph.addConditionalEdges(
        "classifier",                    // 从哪个节点出来
        routeBySentiment,                // 路由动作
        Map.of(                          // 路由表：key -> 目标节点
                "positive", "thank_you",
                "negative", "apologize",
                "neutral",  "standard_reply"
        )
);
```

**执行逻辑**：`classifier` 跑完后，框架调用 `routeBySentiment`，拿到返回值（比如 `"negative"`），再去路由表里查 `"negative"` 对应哪个节点（这里是 `apologize`），然后跳过去。

::: warning 条件边最毒的坑：返回值没在路由表里
如果 `EdgeAction` 返回了 `"angry"`，但路由表里只有 `positive/negative/neutral`，框架**找不到下一站**，直接抛异常。务必保证 `EdgeAction` 所有可能返回值都在路由表里，或者用 `default` 兜底（部分版本支持 `Map.of` 之外额外配一个默认分支，具体以你版本为准）。
:::

## 第一个完整示例：从零搭一张可运行的图

下面是一张**完整、可直接复制运行**的图。它做三件事：

```text
START ──> normalize（清洗输入）──> call_llm（调模型）──> save（"落库"）──> END
```

### 完整依赖 pom.xml

本例只需要 Graph 核心 + DashScope 模型，**不需要向量库**（纯构图演示）。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">

    <modelVersion>4.0.0</modelVersion>

    <!-- 继承 Spring Boot 3.5.5 父 POM -->
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>saa-graph-basic</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>17</java.version>
        <spring-ai.version>1.1.2</spring-ai.version>
        <spring-ai-alibaba.version>1.1.2.0</spring-ai-alibaba.version>
    </properties>

    <dependencies>
        <!-- Web 能力，方便后面用 RestController 暴露接口 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- 通义千问模型接入（DashScope） -->
        <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-starter-dashscope</artifactId>
        </dependency>

        <!-- Graph 核心：StateGraph / CompiledGraph / 节点 / 边 都在这里 -->
        <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-graph-core</artifactId>
        </dependency>
    </dependencies>

    <dependencyManagement>
        <dependencies>
            <!-- 两个 BOM 统一版本，避免 Graph 与 Spring AI 各模块版本打架 -->
            <dependency>
                <groupId>org.springframework.ai</groupId>
                <artifactId>spring-ai-bom</artifactId>
                <version>${spring-ai.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
            <dependency>
                <groupId>com.alibaba.cloud.ai</groupId>
                <artifactId>spring-ai-alibaba-bom</artifactId>
                <version>${spring-ai-alibaba.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

::: tip graph-core 的传递依赖
`spring-ai-alibaba-graph-core` 内部依赖了 `org.bsc:async-generator`（提供 `AsyncGenerator` 等响应式工具），由 BOM 自动管理，**你一般不用手动加**。若编译报找不到 `org.bsc.async.*`，再补一个显式依赖即可。
:::

### application.yml

```yaml
server:
  port: 8080

spring:
  application:
    name: saa-graph-basic
  ai:
    dashscope:
      # API Key 一律从环境变量读，绝不写死
      api-key: ${AI_DASHSCOPE_API_KEY}
      chat:
        options:
          model: qwen-plus
          temperature: 0.7
          max-tokens: 1024

logging:
  level:
    com.example.saa: DEBUG
```

### 三个节点

节点一：清洗输入（前面已给，这里放进包结构里完整呈现）。

```java
package com.example.saa.graph.basic.node;

import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.action.NodeAction;

import java.util.Map;

/**
 * 节点一：归一化用户输入。入参 user_input，出参 normalized_input。
 */
public class NormalizeNode implements NodeAction {
    @Override
    public Map<String, Object> apply(OverAllState state) {
        String raw = state.value("user_input", String.class).orElse("");
        return Map.of("normalized_input", raw.trim().toLowerCase());
    }
}
```

节点二：调用大模型。

```java
package com.example.saa.graph.basic.node;

import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.action.NodeAction;
import org.springframework.ai.chat.client.ChatClient;

import java.util.Map;

/**
 * 节点二：调大模型生成回答。
 *
 * 这里直接注入 Spring 的 ChatClient（由 dashscope starter 自动配置好的 Builder 构建）。
 * 入参 normalized_input，出参 llm_answer。
 */
public class LlmNode implements NodeAction {

    private final ChatClient chatClient;

    /** 构造时传入 ChatClient.Builder，节点本身不负责创建客户端 */
    public LlmNode(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    @Override
    public Map<String, Object> apply(OverAllState state) {
        String question = state.value("normalized_input", String.class).orElse("");

        String answer = chatClient.prompt()
                .system("你是一个严谨的技术助手，回答简洁。")
                .user(question)
                .call()
                .content();

        return Map.of("llm_answer", answer);
    }
}
```

节点三：模拟"落库"（这里只打印，真实场景换成数据库写入）。

```java
package com.example.saa.graph.basic.node;

import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.action.NodeAction;

import java.util.Map;

/**
 * 节点三：把回答"保存"下来（示例仅打印）。
 * 入参 llm_answer，出参 final_answer（一模一样，纯粹演示"最后一个节点也能写状态"）。
 */
public class SaveNode implements NodeAction {
    @Override
    public Map<String, Object> apply(OverAllState state) {
        String answer = state.value("llm_answer", String.class).orElse("");
        System.out.println("[SaveNode] 已"保存"回答：" + answer);
        return Map.of("final_answer", answer);
    }
}
```

### 把图画出来并编译：配置类

```java
package com.example.saa.graph.basic.config;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.GraphRepresentation;
import com.alibaba.cloud.ai.graph.KeyStrategy;
import com.alibaba.cloud.ai.graph.KeyStrategyFactory;
import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.action.NodeAction;
import com.alibaba.cloud.ai.graph.state.strategy.ReplaceStrategy;
import com.example.saa.graph.basic.node.LlmNode;
import com.example.saa.graph.basic.node.NormalizeNode;
import com.example.saa.graph.basic.node.SaveNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

import static com.alibaba.cloud.ai.graph.StateGraph.START;
import static com.alibaba.cloud.ai.graph.StateGraph.END;
import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;

/**
 * 图的定义与编译都放在一个 @Configuration 里，编译后的 CompiledGraph 作为 Bean 供 Controller 使用。
 */
@Configuration
public class BasicGraphConfig {

    private static final Logger log = LoggerFactory.getLogger(BasicGraphConfig.class);

    @Bean
    public CompiledGraph basicGraph(ChatClient.Builder chatClientBuilder) throws Exception {
        // 1. 定义状态字段及其合并策略（这里全部用"覆盖"即可）
        KeyStrategyFactory keyStrategyFactory = () -> {
            Map<String, KeyStrategy> strategies = new HashMap<>();
            strategies.put("user_input", new ReplaceStrategy());
            strategies.put("normalized_input", new ReplaceStrategy());
            strategies.put("llm_answer", new ReplaceStrategy());
            strategies.put("final_answer", new ReplaceStrategy());
            return strategies;
        };

        // 2. 建图：加节点 + 连边
        StateGraph stateGraph = new StateGraph(keyStrategyFactory)
                .addNode("normalize", node_async(new NormalizeNode()))
                .addNode("call_llm", node_async(new LlmNode(chatClientBuilder)))
                .addNode("save", node_async(new SaveNode()))
                .addEdge(START, "normalize")        // 启动先清洗
                .addEdge("normalize", "call_llm")   // 清洗完调模型
                .addEdge("call_llm", "save")        // 模型回答后落库
                .addEdge("save", END);              // 落库完结束

        // 3. 把图导出成 PlantUML 文本，方便排查（注意本项目禁 mermaid，用 PlantUML 文本即可）
        GraphRepresentation representation =
                stateGraph.getGraph(GraphRepresentation.Type.PLANTUML, "基础流程图");
        log.info("\n=== 图结构（PlantUML）===\n{}\n=====================", representation.content());

        // 4. 编译成可执行引擎
        return stateGraph.compile();
    }
}
```

### 用 RestController 跑起来

```java
package com.example.saa.graph.basic.controller;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/graph/basic")
public class BasicGraphController {

    private final CompiledGraph graph;
    private final ChatClient.Builder chatClientBuilder;

    public BasicGraphController(CompiledGraph graph, ChatClient.Builder chatClientBuilder) {
        this.graph = graph;
        this.chatClientBuilder = chatClientBuilder;
    }

    @GetMapping("/run")
    public Map<String, Object> run(@RequestParam(defaultValue = "  请用一句话解释 什么是 Graph ") String msg) {
        // 初始输入：只放 user_input 这一个字段
        Map<String, Object> inputs = Map.of("user_input", msg);

        // 每次执行都要带 threadId；这里随便给一个，持久化章节会细讲它的意义
        RunnableConfig config = RunnableConfig.builder().threadId("basic-demo-1").build();

        // invoke 同步执行，返回最终状态 Map（不同版本可能包在 Optional 里）
        Optional<Map<String, Object>> result = graph.invoke(inputs, config);
        return result.orElse(Map.of("error", "no result"));
    }
}
```

启动类：

```java
package com.example.saa.graph.basic;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class GraphBasicApplication {
    public static void main(String[] args) {
        SpringApplication.run(GraphBasicApplication.class, args);
    }
}
```

### 跑一下

```bash
# 先设好 Key（Windows PowerShell）
$env:AI_DASHSCOPE_API_KEY="sk-xxxxxxxxxx"

# 启动后调用
curl "http://localhost:8080/api/graph/basic/run?msg=请用一句话解释什么是Graph"
```

返回（节选）：

```json
{
  "user_input": "  请用一句话解释 什么是Graph  ",
  "normalized_input": "请用一句话解释 什么是graph",
  "llm_answer": "Graph 是一种用节点和边描述流程的数据结构……",
  "final_answer": "Graph 是一种用节点和边描述流程的数据结构……"
}
```

### 把每一步的入参出参画成表

理解"数据怎么在节点间流动"最直观的方式，就是看这张表：

| 阶段 | 当前节点 | 从状态读取（入参） | 写回状态（出参） | 状态里累积的字段 |
| --- | --- | --- | --- | --- |
| ① 初始 | — | — | 注入 `user_input` | `user_input` |
| ② normalize | NormalizeNode | `user_input` | `normalized_input` | `user_input`, `normalized_input` |
| ③ call_llm | LlmNode | `normalized_input` | `llm_answer` | `+ llm_answer` |
| ④ save | SaveNode | `llm_answer` | `final_answer` | `+ final_answer` |
| ⑤ 结束 | END | — | — | 全部字段返回 |

::: tip 记住这条铁律
**节点之间不通过方法参数传值，全部通过 `OverAllState` 这个共享"背包"传递。** 你写的每个节点，本质就是在"读背包某几项 → 算一下 → 往背包里塞几项"。这个心智模型吃透了，第 15 章的状态策略就一点都不难。
:::

## 预置节点 builtin-nodes

每次都手写 `NodeAction` 太累。框架针对高频场景**内置了一批节点**，直接 `builder()` 出来挂图上就行。

| 内置节点 | 用途 | 典型场景 |
| --- | --- | --- |
| `LlmNode` | 按模板调大模型 | 内容生成、摘要、对话 |
| `ToolNode` | 执行工具调用 | 调外部 API、本地函数 |
| `HumanNode` | 暂停等人输入 | 审批、敏感操作确认 |
| `QuestionClassifierNode` | 文本分类并写入状态 | 意图识别、工单分流 |
| `HttpNode` | 发 HTTP 请求 | 调外部 REST 服务 |
| `KnowledgeRetrievalNode` | 向量检索 | RAG 检索增强 |
| `McpNode` | 调 MCP 服务 | 接入 MCP 工具生态 |
| `DocumentExtractorNode` | 解析文件提取文本 | PDF/Word 内容抽取 |

::: tip 包位置
内置节点大多在 `com.alibaba.cloud.ai.graph.node` 包下；部分需要 `spring-ai-alibaba-starter-builtin-nodes` 这个 starter 才完整。如果你只引入了 `spring-ai-alibaba-graph-core`，`LlmNode` / `ToolNode` / `QuestionClassifierNode` 等通常已包含，但 `KnowledgeRetrievalNode` 等 RAG 相关节点可能需要额外 starter。**以你所用版本的包结构为准。**
:::

### 内置 LlmNode 怎么用

下面用内置 `LlmNode` 替换我们手写的 `LlmNode`，代码量立刻减半：

```java
package com.example.saa.graph.basic.node;

import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.action.AsyncNodeAction;
import com.alibaba.cloud.ai.graph.node.LlmNode;
import org.springframework.ai.chat.client.ChatClient;

import java.util.Map;

import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;

/**
 * 演示用内置 LlmNode 替代手写节点。
 *
 * LlmNode.builder() 关键参数（具体字段名以你版本为准）：
 *   - chatClient          要用的模型客户端
 *   - systemPromptTemplate 系统提示词模板
 *   - userPromptTemplateKey 从状态里取哪个 key 作为用户问题（本例 "normalized_input"）
 *   - outputKey           模型回答写回状态的哪个 key（本例 "llm_answer"）
 */
public class BuiltinLlmNodeFactory {

    public static AsyncNodeAction build(ChatClient.Builder builder) {
        LlmNode llmNode = LlmNode.builder()
                .chatClient(builder.build())
                .systemPromptTemplate("你是一个严谨的技术助手，回答简洁。")
                .userPromptTemplateKey("normalized_input")
                .outputKey("llm_answer")
                .build();

        // 同样用 node_async 包成异步节点
        return node_async(llmNode);
    }
}
```

然后在配置类里把 `.addNode("call_llm", node_async(new LlmNode(chatClientBuilder)))` 换成 `.addNode("call_llm", BuiltinLlmNodeFactory.build(chatClientBuilder))` 即可，其余代码完全不变。

::: warning 内置节点的 outputKey 一定要注册
`LlmNode` 的 `outputKey`（如 `llm_answer`）**必须已经在 `KeyStrategyFactory` 里注册过**，否则回答写不进状态。这是新手用内置节点最容易漏的一步。
:::

### QuestionClassifierNode 做分支（条件边的前置）

```java
package com.example.saa.graph.basic.node;

import com.alibaba.cloud.ai.graph.node.QuestionClassifierNode;
import org.springframework.ai.chat.client.ChatClient;

import java.util.List;

/**
 * 文本分类节点：把用户问题分成 positive / negative / neutral，结果写入状态。
 * 它常和条件边配合——边根据分类结果决定走哪条路。
 */
public class SentimentClassifierFactory {

    public static QuestionClassifierNode build(ChatClient.Builder builder) {
        return QuestionClassifierNode.builder()
                .chatClient(builder.build())
                .categories(List.of("positive", "negative", "neutral"))
                .inputTextKey("normalized_input")   // 读哪个字段
                .outputKey("sentiment")              // 分类结果写回哪个字段
                .build();
    }
}
```

## 导出图结构（PlantUML / 文本）：用于排查

图写复杂了以后，肉眼很难确认"边连对了没"。框架支持把图**导出成文本结构**来排查。

### PlantUML 文本

```java
// 在配置类里，编译前调用 getGraph 即可拿到文本
GraphRepresentation representation =
        stateGraph.getGraph(GraphRepresentation.Type.PLANTUML, "我的流程图");
System.out.println(representation.content());
```

打印出来的内容长这样（可以直接贴到 PlantUML 在线编辑器渲染）。注意本项目 VitePress 没装 mermaid 插件，**在 md 里画流程图一律用文本图**，下面这种：

```text
@startuml
title 基础流程图
START --> normalize
normalize --> call_llm
call_llm --> save
save --> END
@enduml
```

### 纯文本缩进图（推荐写进文档）

排查时手画一个缩进图最清爽，也符合本项目"禁 mermaid"的红线：

```text
START
 ├─> normalize      （清洗输入）
 │    └─> call_llm  （调模型）
 │         └─> save （落库）
 │              └─> END
```

::: tip 什么时候该导出图
- 条件边的分支对不上、流程"走偏"时；
- 接手别人写的图、先快速看全貌时；
- 给同事讲流程、评审时。
:::

## 常见坑（建议背下来）

### 坑 1：忘记加 START 边

```java
// 错误：所有节点都加了，但图不知道从哪开始
graph.addNode("a", ...).addNode("b", ...).addEdge("a", "b");
// 编译时会报 missingEntryPoint：没有从 START 出发的边

// 正确：一定有一条 START 出发的边
graph.addEdge(StateGraph.START, "a");
```

### 坑 2：条件边返回值没有对应分支

```java
graph.addConditionalEdges("classifier",
        state -> state.value("sentiment", String.class).orElse("neutral"),
        Map.of("positive", "thank", "negative", "apologize"));
// 如果 sentiment 是 "neutral"，路由表里没有，直接炸
// 务必把所有可能返回值都列进 Map，或加默认分支
```

### 坑 3：节点没写返回值，状态丢失

```java
public Map<String, Object> apply(OverAllState state) {
    String x = state.value("user_input", String.class).orElse("");
    // 忘记 return，或 return Map.of()
    // → 这个节点等于白干，下游拿不到任何新数据
    return Map.of("result", x);   // 一定要返回写回的字段
}
```

### 坑 4：返回的 key 没在 KeyStrategyFactory 注册

节点 `return Map.of("new_field", v)`，但 `KeyStrategyFactory` 里没 `put("new_field", ...)`。框架不知道怎么合并，可能静默丢弃。**新增字段时，记得两边同步。**

### 坑 5：把节点间传值当成方法参数

新手常以为 `addNode("b", ...)` 会自动把 `a` 的返回值传给 `b`。**不会。** 一切通过 `OverAllState` 传递，a 写 `state["x"]`，b 从 `state["x"]` 读。

## 本篇小结

- **为什么用 Graph**：对话式 Agent 只能让模型"临场决定下一步"，不可控；Graph 让你用代码把流程画死，支持分支、循环、回退、并行。
- **StateGraph 是蓝图，CompiledGraph 才是能跑的引擎**：`new StateGraph(factory)` 定义 → `compile()` 生成可执行对象 → `invoke()/stream()` 执行。
- **节点 = 读黑板 + 写黑板**：实现 `NodeAction.apply(OverAllState)`，从状态读入参、用返回的 Map 写出参。用 `node_async` 包成异步。
- **边决定走向**：`addEdge` 普通边无条件跳转；`addConditionalEdges` 条件边靠 `EdgeAction` 返回值 + 路由表选路。`START`/`END` 是特殊起点终点。
- **内置节点省大事**：`LlmNode`/`ToolNode`/`HumanNode`/`QuestionClassifierNode` 等开箱即用，但要注意 `outputKey` 必须注册。
- **图要能"画出来"**：用 `getGraph(PLANTUML)` 或纯文本缩进图排查，本项目禁用 mermaid。
- **四大必踩坑**：漏 START 边、条件边返回值无对应分支、节点不返回、key 未注册。

## 参考链接

- Spring AI Alibaba 官网（Graph 文档）：<https://java2ai.com/>
- Graph 快速上手（官方示例）：<https://java2ai.com/docs/frameworks/graph-core/examples/plantuml>
- GitHub 仓库（graph 模块源码，核对类名最准）：<https://github.com/alibaba/spring-ai-alibaba>
- StateGraph 执行引擎（DeepWiki）：<https://deepwiki.com/alibaba/spring-ai-alibaba/3.1-overview-and-core-concepts>

下一篇 → [15 状态与流程控制](/java/saa/graph-state)
