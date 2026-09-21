# 16 持久化与断点续跑

> 长时任务的必备能力：快照、恢复、多线程记忆隔离。前面两章的图一旦 JVM 重启、或跑到一半要等人审批，状态就没了。这一章讲怎么把"跑到某一步的现场"存下来，之后随时续上——这正是生产级 Agent 的命脉。

::: warning 动手前必读：API 版本核对清单
Spring AI Alibaba Graph 的**持久化（Checkpoint / Saver）API 在版本间改动尤其频繁**。本章以官方教程与 DeepWiki 中**出现频率最高的 `CompileConfig.saverConfig(...)` + `SaverConfig` + `SaverConstant` + `MemorySaver` 风格**为准。凡标注"以你所用版本为准"之处，请到 `com.alibaba.cloud.ai.graph.checkpoint` 包下核对：

| 概念 | 包路径 | 本文名字 |
| --- | --- | --- |
| 检查点 | `com.alibaba.cloud.ai.graph.checkpoint` | `Checkpoint` |
| 保存器基类 | `com.alibaba.cloud.ai.graph.checkpoint` | `BaseCheckpointSaver` |
| 内存保存器 | `com.alibaba.cloud.ai.graph.checkpoint.savers` | `MemorySaver` |
| 文件保存器 | `com.alibaba.cloud.ai.graph.checkpoint.savers` | `FileSystemSaver` |
| 保存器配置 | `com.alibaba.cloud.ai.graph.checkpoint` | `SaverConfig` |
| 保存器类型常量 | `com.alibaba.cloud.ai.graph.checkpoint` | `SaverConstant` |
| 编译配置 | `com.alibaba.cloud.ai.graph` | `CompileConfig` |
| 状态快照 | `com.alibaba.cloud.ai.graph.state` | `StateSnapshot` |

> 不同版本中 `RedisSaver` / `MysqlSaver` 的构造方式（builder vs 构造器、所需客户端类型）差异较大，本文给出**最常见的写法并明确标注存疑点**，落地前请以你所用版本源码为准。
:::

## 本篇要解决的问题

- 什么是 Checkpoint（检查点）？它存了什么？
- Saver 体系怎么选：内存 / 文件 / Redis / MySQL / MongoDB？
- 怎么用 `threadId` 把不同会话的记忆隔离开？
- **断点续跑完整链路**：跑到某个节点中断 → 存盘 → 之后用同一 `threadId` 恢复继续跑。
- 怎么和"人工审批（HITL）"结合（指路第 13 章）？
- 生产环境要注意哪些坑：序列化兼容、快照膨胀、并发写冲突？

## Checkpoint 机制

### 一个比喻：游戏存档

把一次 Graph 执行想象成玩一局游戏。你打到第二关 Boss 面前，突然要下班了。你会**存档（Checkpoint）**——把"当前关卡、血量、背包、任务进度"全记下来。明天打开游戏，读档就能从 Boss 面前继续，而不是从头再来。

Graph 的 Checkpoint 同理：它是在**每个节点执行完后**自动拍的一张"快照"，记录：

```text
Checkpoint = {
    nodeId:        刚执行完的节点名（如 "call_llm"）
    nextNodeId:    根据边决定的下一个节点（如 "save"）
    state:         当前 OverAllState 的完整深拷贝（所有字段）
    checkPointId:  本次快照唯一 ID
}
```

### 快照什么时候产生

只有**配置了 Saver** 之后，框架才会在每个节点跑完后自动 `put` 一张快照。没配 Saver，图一样能跑，但**跑到哪断在哪，全没了**——重启只能从头来。

```java
// 伪时序：CompiledGraph 内部每个节点执行后的逻辑
Optional<Checkpoint> cp = addCheckpoint(config, currentNodeId, currentState, nextNodeId);
if (compileConfig.checkpointSaver().isPresent()) {
    compileConfig.checkpointSaver().get().put(config, cp);  // 自动存盘
}
```

::: tip 记住两个核心概念
- **Checkpoint**：某一刻的完整现场快照（数据）。
- **Saver**：把 Checkpoint 存到哪里的"仓库"（内存/文件/Redis/MySQL…）。
:::

## Saver 选型对比

框架内置了多种 Saver 实现（`BaseCheckpointSaver` 的子类）。下面这张表按"是否多实例共享""是否重启可恢复"两个维度对比，帮你在 Redis / MySQL 之间做选择：

| 实现 | 存储介质 | 多实例共享 | 重启可恢复 | 适用场景 |
| --- | --- | --- | --- | --- |
| `MemorySaver` | JVM 内存 HashMap | 否 | 否 | 本地开发、单测、Demo |
| `FileSystemSaver` | 本地文件 | 否 | 是 | 单实例但需重启恢复 |
| `RedisSaver` | Redis | **是** | **是** | **生产多实例部署首选** |
| `MysqlSaver` | MySQL | 是 | 是 | 已有 MySQL 基建、想少引入中间件 |
| `MongoSaver` | MongoDB | 是 | 是 | 已有 MongoDB 基建 |
| `PostgresSaver` | PostgreSQL | 是 | 是 | 已有 PG 基建 |
| `VersionedMemorySaver` | 内存（带版本） | 否 | 否 | 需要回溯历史快照 |
| `OracleSaver` | Oracle | 是 | 是 | 企业级 Oracle 环境 |

::: tip 本项目怎么选
- 本笔记统一约定**向量库用 Elasticsearch 8.x**（那是 RAG 的事）。
- **持久化 Checkpoint 不约束向量库**：按任务要求，本章 Example 用 **Redis**（多实例高可用）和 **MySQL**（已有 DB 基建）做 Saver 示例，二者都合法。
- 入门先把 `MemorySaver` 跑通，生产再切 `RedisSaver`。
:::

### 通用配置骨架：CompileConfig + SaverConfig

不管用哪种 Saver，都是同一个套路：把 Saver 注册进 `SaverConfig`，再塞进 `CompileConfig`，最后 `compile(config)`。

```java
import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.SaverConstant;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;

// 1. 创建 Saver 实例
BaseCheckpointSaver saver = new MemorySaver();

// 2. 注册进 SaverConfig，并指定默认类型
SaverConfig saverConfig = SaverConfig.builder()
        .register(SaverConstant.MEMORY, saver)   // key -> Saver 实例
        .type(SaverConstant.MEMORY)               // 默认用哪个
        .build();

// 3. 编译时把 SaverConfig 带进去
CompileConfig compileConfig = CompileConfig.builder()
        .saverConfig(saverConfig)
        .interruptBefore("human_approve")         // 跑到这节点前先中断（下节讲）
        .build();

CompiledGraph compiled = stateGraph.compile(compileConfig);
```

::: warning SaverConstant 的取值
`SaverConstant.MEMORY` / `SaverConstant.FILE` / `SaverConstant.REDIS` 等常量名**可能因版本不同**（有的版本直接用字符串 `"memory"`、`"redis"`）。若常量类报红，请到 `com.alibaba.cloud.ai.graph.checkpoint.SaverConstant` 里查你版本真实定义的常量，或直接传字符串字面量。
:::

### 内存 Saver（零依赖，先跑通）

```java
BaseCheckpointSaver saver = new MemorySaver();   // 进程内 HashMap，重启即丢
```

**优点**：零依赖、断点续跑逻辑全通，最适合学习和单测。
**缺点**：多实例部署时各 JVM 各存各的，且重启全没。

### Redis Saver（生产多实例首选）

Redis Saver 把 Checkpoint 存进 Redis，Key 形如 `spring-ai-alibaba:checkpoint:{threadId}`，天然支持多实例共享与重启恢复。它需要 **Redisson 客户端**。

依赖（在 14 章 pom 基础上追加）：

```xml
<!-- Redisson：RedisSaver 的底层客户端 -->
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson</artifactId>
    <version>3.30.0</version>
</dependency>
<!-- Graph 核心（已含 Saver 实现） -->
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-graph-core</artifactId>
</dependency>
```

配置示例（**构造方式以你所用版本为准**；常见两种：builder 或构造器传入 RedissonClient）：

```java
package com.example.saa.graph.persist.config;

import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.SaverConstant;
import com.alibaba.cloud.ai.graph.checkpoint.savers.RedisSaver;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RedisSaverConfig {

    /** 创建 Redisson 客户端，连本地 Redis */
    @Bean
    public RedissonClient redissonClient() {
        Config config = new Config();
        config.useSingleServer().setAddress("redis://127.0.0.1:6379");
        return Redisson.create(config);
    }

    /**
     * 创建 RedisSaver 并注册为默认 Saver。
     *
     * 注：不同版本 RedisSaver 构造方式可能不同：
     *   - 新版常见：RedisSaver.builder().redisson(client).build()
     *   - 旧版常见：new RedisSaver(client)
     * 若编译报红，请以你所用版本 spring-ai-alibaba-graph-core 源码为准。
     */
    @Bean
    public BaseCheckpointSaver redisSaver(RedissonClient client) {
        BaseCheckpointSaver saver = RedisSaver.builder()
                .redisson(client)
                .build();
        return saver;
    }

    @Bean
    public SaverConfig saverConfig(BaseCheckpointSaver redisSaver) {
        return SaverConfig.builder()
                .register(SaverConstant.REDIS, redisSaver)
                .type(SaverConstant.REDIS)
                .build();
    }
}
```

::: warning RedisSaver 构造签名存疑
`RedisSaver.builder().redisson(client).build()` 是社区示例里较常见的写法；也有版本用 `new RedisSaver(client)` 或需要额外传入 `StateSerializer`。**落地前务必 Ctrl+点击 `RedisSaver` 确认你版本的构造入口**，否则编译不过。
:::

### MySQL Saver（复用已有 DB 基建）

若你已有 MySQL，不想为多实例单独上 Redis，可用 `MysqlSaver`——它把 Checkpoint 存进数据库表（框架会自动建表或需要你提供 DataSource）。

```java
package com.example.saa.graph.persist.config;

import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.SaverConfig;
import com.alibaba.cloud.ai.builder?; // 占位：MysqlSaver 包路径以版本为准
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;

@Configuration
public class MysqlSaverConfig {

    /**
     * 创建 MysqlSaver。
     *
     * 注：MysqlSaver 的构造方式各版本差异较大：
     *   - 有的版本：new MysqlSaver(DataSource)
     *   - 有的版本：MysqlSaver.builder().dataSource(ds).build()
     *   - 有的版本还需要 JdbcTemplate
     * 包路径也可能在 com.alibaba.cloud.ai.graph.checkpoint.savers 之下。
     * 请到该包下核对你版本的精确类名与构造参数。
     */
    @Bean
    public BaseCheckpointSaver mysqlSaver(DataSource dataSource) {
        // 以下写法为示意，具体 API 以你所用版本源码为准
        BaseCheckpointSaver saver = new com.alibaba.cloud.ai.graph.checkpoint.savers.MysqlSaver(dataSource);
        return saver;
    }

    @Bean
    public SaverConfig mysqlSaverConfig(BaseCheckpointSaver mysqlSaver) {
        return SaverConfig.builder()
                .register(SaverConstant.MYSQL, mysqlSaver)
                .type(SaverConstant.MYSQL)
                .build();
    }
}
```

对应表结构（**若框架不自动建表，你需要手动建**。字段以版本为准，常见结构如下）：

```sql
-- 仅为示意：具体列名/类型请以你所用版本的 MysqlSaver 要求为准
CREATE TABLE IF NOT EXISTS graph_checkpoint (
    thread_id      VARCHAR(128) NOT NULL,
    check_point_id VARCHAR(128) NOT NULL,
    node_id        VARCHAR(128),
    next_node_id   VARCHAR(128),
    state          MEDIUMTEXT,        -- 序列化的 OverAllState
    create_time    DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (thread_id, check_point_id)
);
```

::: danger 表结构必须匹配
MysqlSaver 对表名/列名有隐含约定。若它不自动建表，建错列名会导致存取失败、且报错信息往往很隐晦。**优先让框架自动初始化；若需手动建表，先翻你版本对应源码或官方示例。**
:::

## 断点续跑实现

### 核心三件套：threadId + Saver + interruptBefore

断点续跑 = **用同一 `threadId` 找回上次存的那张快照，从断点接着跑**。三个要素缺一不可：

1. **Saver**：先把快照存下来（没存就谈不上续）。
2. **interruptBefore("节点名")**：在指定节点**之前**插入中断点，让图跑到这就"暂停存档"并停下。
3. **threadId**：作为快照的 retrieval key，续跑时靠它找回。

### 完整示例：跑一半被中断 → 恢复继续

下面这张图演示"人工审批"式中断——跑到 `human_approve` 前暂停，等人决定后再继续：

```text
START ──> prepare（准备材料）──> human_approve（审批节点，中断点）──> execute（执行）──> END
```

#### 配置：带中断点的编译

```java
package com.example.saa.graph.persist.config;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.KeyStrategy;
import com.alibaba.cloud.ai.graph.KeyStrategyFactory;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.action.NodeAction;
import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.SaverConstant;
import com.alibaba.cloud.ai.graph.state.strategy.ReplaceStrategy;
import com.example.saa.graph.persist.node.PrepareNode;
import com.example.saa.graph.persist.node.ApproveNode;
import com.example.saa.graph.persist.node.ExecuteNode;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

import static com.alibaba.cloud.ai.graph.StateGraph.START;
import static com.alibaba.cloud.ai.graph.StateGraph.END;
import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;

@Configuration
public class ResumeGraphConfig {

    @Bean
    public CompiledGraph resumeGraph(ChatClient.Builder chatClientBuilder,
                                     BaseCheckpointSaver saver) throws Exception {
        KeyStrategyFactory factory = () -> {
            Map<String, KeyStrategy> m = new HashMap<>();
            m.put("material", new ReplaceStrategy());
            m.put("approved", new ReplaceStrategy());
            m.put("result", new ReplaceStrategy());
            return m;
        };

        StateGraph g = new StateGraph(factory)
                .addNode("prepare", node_async(new PrepareNode()))
                .addNode("human_approve", node_async(new ApproveNode()))  // 这里会中断
                .addNode("execute", node_async(new ExecuteNode(chatClientBuilder)))
                .addEdge(START, "prepare")
                .addEdge("prepare", "human_approve")
                .addEdge("human_approve", "execute")
                .addEdge("execute", END);

        // 关键：把 Saver 装进 CompileConfig，并声明在 human_approve 前中断
        SaverConfig saverConfig = SaverConfig.builder()
                .register(SaverConstant.MEMORY, saver)   // 生产换 REDIS
                .type(SaverConstant.MEMORY)
                .build();

        var compileConfig = com.alibaba.cloud.ai.graph.CompileConfig.builder()
                .saverConfig(saverConfig)
                .interruptBefore("human_approve")
                .build();

        return g.compile(compileConfig);
    }
}
```

#### 三个节点

```java
package com.example.saa.graph.persist.node;

import com.alibaba.cloud.ai.graph.OverAllState;
import com.alibaba.cloud.ai.graph.action.NodeAction;

import java.util.Map;

/** 准备材料：写入 material 字段 */
public class PrepareNode implements NodeAction {
    @Override
    public Map<String, Object> apply(OverAllState state) {
        return Map.of("material", "一份待审批的报销单：金额 12000 元");
    }
}

/** 审批节点：这里只是把"待审批"标记写好，真正的人工决策在 Controller 里完成 */
public class ApproveNode implements NodeAction {
    @Override
    public Map<String, Object> apply(OverAllState state) {
        // 注意：因为 compile 时设了 interruptBefore("human_approve")，
        // 图在"进入本节点之前"就被中断并存档，本节点的 apply 实际上不会被执行，
        // 直到人工恢复后才真正跑。这里return的内容在恢复后才会生效。
        return Map.of("approved", state.value("approved", String.class).orElse("pending"));
    }
}

/** 执行节点：根据审批结果做事 */
public class ExecuteNode implements NodeAction {
    private final org.springframework.ai.chat.client.ChatClient chatClient;
    public ExecuteNode(org.springframework.ai.chat.client.ChatClient.Builder b) {
        this.chatClient = b.build();
    }
    @Override
    public Map<String, Object> apply(OverAllState state) {
        String approved = state.value("approved", String.class).orElse("rejected");
        String result = "审批结果=" + approved + "，已" +
                ("approved".equals(approved) ? "执行打款" : "拒绝并归档");
        return Map.of("result", result);
    }
}
```

#### Controller：启动 → 中断 → 查询状态 → 恢复（完整 curl 链路）

```java
package com.example.saa.graph.persist.controller;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.state.StateSnapshot;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/graph/persist")
public class PersistGraphController {

    private final CompiledGraph graph;

    public PersistGraphController(CompiledGraph graph) {
        this.graph = graph;
    }

    /** ① 启动：跑到 human_approve 前被中断，存档后停下 */
    @GetMapping("/start")
    public Map<String, Object> start(@RequestParam String threadId) throws Exception {
        RunnableConfig config = RunnableConfig.builder().threadId(threadId).build();
        // 传入初始输入，stream 会跑到中断点停止
        graph.stream(Map.of("material", ""), config).forEach(out -> { /* 可打印中间产出 */ });
        // 此时已存档，状态停在 human_approve 之前
        return Map.of("status", "interrupted", "threadId", threadId,
                      "nextNode", "human_approve");
    }

    /** ② 查询：当前这个 threadId 卡在哪个节点、状态里有什么 */
    @GetMapping("/state")
    public Map<String, Object> state(@RequestParam String threadId) {
        RunnableConfig config = RunnableConfig.builder().threadId(threadId).build();
        Optional<StateSnapshot> snapshot = graph.getState(config);   // 取最新快照
        if (snapshot.isEmpty()) {
            return Map.of("status", "not_found");
        }
        StateSnapshot s = snapshot.get();
        return Map.of(
                "threadId", threadId,
                "lastNode", s.node(),        // 上一个执行完的节点
                "nextNode", s.next(),        // 接下来要执行的节点（即中断点）
                "state", s.state()           // 当前背包内容
        );
    }

    /** ③ 恢复：人工把 approved 写回状态，带同一 threadId 继续跑完 */
    @PostMapping("/resume")
    public Map<String, Object> resume(@RequestParam String threadId,
                                      @RequestParam String decision) throws Exception {
        RunnableConfig config = RunnableConfig.builder().threadId(threadId).build();

        // 先查询，再更新状态并指定下一个要执行的节点（human_approve）
        StateSnapshot snapshot = graph.getState(config).orElseThrow();
        // updateState：把人工决策写进状态，并指明"下一步从 human_approve 继续"
        // 不同版本 API 可能为 updateState(config, Map, asNode) 或 snapshot.state().withResume() 等，
        // 以下为常见写法，落地前请以你版本为准
        RunnableConfig updated = graph.updateState(
                config,
                Map.of("approved", decision),   // "approved" 或 "rejected"
                "human_approve"
        );

        // 用 null 输入 + 同一 threadId 触发"从快照恢复"，跑到 END
        Optional<Map<String, Object>> result = graph.invoke(null, updated);
        return result.orElse(Map.of("error", "no result"));
    }
}
```

#### 完整 curl 链路

```bash
# 0. 设 Key
$env:AI_DASHSCOPE_API_KEY="sk-xxxxxxxxxx"

# ① 启动：跑到 human_approve 前中断存档
curl "http://localhost:8080/api/graph/persist/start?threadId=order-1001"
# 返回：{"status":"interrupted","threadId":"order-1001","nextNode":"human_approve"}

# ② 查询：看看卡在哪、背包里有什么（模拟人工去看审批单）
curl "http://localhost:8080/api/graph/persist/state?threadId=order-1001"
# 返回示例：{"lastNode":"prepare","nextNode":"human_approve","state":{...material...}}

# ③ 恢复：人工决定 approved，继续跑完
curl -X POST "http://localhost:8080/api/graph/persist/resume?threadId=order-1001&decision=approved"
# 返回：{"material":"...","approved":"approved","result":"审批结果=approved，已执行打款"}
```

::: tip 续跑的两种触发方式（不同版本）
1. **传 null 输入 + 同一 threadId**：`graph.invoke(null, config)` 或 `graph.stream(null, config)`，框架识别到已有快照就自动续。
2. **显式 updateState + resume**：先 `getState` 取快照，再 `updateState` 写入人工决策并指定下一节点，最后 `invoke(null, ...)`。

本文示例展示的是方式 2（更可控，能注入人工决策）。具体方法名（尤其 `updateState` 的参数顺序、`HumanFeedback` 类是否存在）**以你所用版本为准**。
:::

## 线程与记忆隔离

### threadId 是会话的"身份证"

同一张编译好的图，可以**被无数个会话同时跑**。框架靠 `RunnableConfig.threadId` 区分：每个 `threadId` 对应一份独立的 Checkpoint 链。

```java
// 用户 A 和用户 B 用不同 threadId，彼此状态完全隔离
graph.invoke(inputs, RunnableConfig.builder().threadId("user-A-session-1").build());
graph.invoke(inputs, RunnableConfig.builder().threadId("user-B-session-1").build());
```

::: danger 复用 threadId 的代价
**同一个 `threadId` 第二次 `invoke` 会被当成"续跑"**——框架会去读这个 threadId 上次存的快照，而不是从头开始。如果你本意是"开新会话"，却不小心复用了旧 threadId，会诡异地从半路接着跑。**新会话务必生成全新 threadId（如 UUID）。**
:::

### 查询历史快照

`threadId` 下通常不止一张快照（每跑一个节点存一张）。`getStateHistory` 能拿到完整时间线：

```java
RunnableConfig config = RunnableConfig.builder().threadId(threadId).build();
// getStateHistory 返回该 threadId 下所有历史快照（具体返回类型以版本为准）
Collection<?> history = graph.getStateHistory(config);
history.forEach(h -> { /* 逐个看每步的 state */ });
```

用途：审计"这个 Agent 到底走了哪几步"、排查"为什么走到这一步"。

## 和 HITL 人工审批如何结合

**HITL（Human-in-the-Loop，人在回路）** 就是"让流程在某个节点停下来，等人拍板再继续"。它和断点续跑是**同一套机制的两面**：

- 断点续跑强调的是"**中断 + 恢复**"（技术能力）；
- HITL 强调的是"**中断是为了等人**"（业务语义）。

本文第 ③ 步的 `resume` 接口，本质上就是一次最简 HITL：在 `human_approve` 前中断 → 把审批单给人看 → 人填 `approved/rejected` → 恢复执行。

```text
           ┌──── 中断点（interruptBefore）────┐
START ─> prepare ─┤                      ├─> execute ─> END
                  │   人工审批（HITL）      │
                  │   人填 approved/rejected│
                  └──────── 恢复 resume ────┘
```

更完整的 HITL 实践（含 `HumanNode` 内置节点、条件边按人决策选路、超时默认通过等）请见 **[第 13 章 人机协同]**（链接以你站点实际路径为准）。本文只负责把"中断—存档—恢复"这条技术链路讲透。

::: tip 条件边 + 中断 = 黄金组合
- **中断**让流程停下来等人；
- **条件边**按人的决策（`approved`/`rejected`）选不同后续路径。
两者解耦：节点只负责把决策写进背包，路由函数只负责按标签选路。这样"审批通过走 A、驳回走 B"就非常干净。
:::

## 生产环境建议

### 1. 序列化兼容性

Checkpoint 要把 `OverAllState` **序列化**后存入 Redis/MySQL。坑在于：

- 存的时候某个类没问题，后来你**改了类的字段/包名**，旧快照反序列化失败 → 续跑炸。
- 建议：状态里的对象尽量用**稳定、可版本化的 DTO**，避免直接塞不可序列化的 Spring Bean。

### 2. 快照膨胀与清理

每个节点都存一张快照，长流程 + 高并发会迅速膨胀。必须：提供清理机制（按 `threadId` 过期删除）；HITL 场景的快照常驻直到人审批，要设超时兜底。

```text
生产 Checklist：
  □ 给 Checkpoint 设 TTL（Redis 用过期时间 / MySQL 定时删）
  □ 已完成会话的快照及时清理，别无限堆积
  □ HITL 中断要有超时自动释放，防止"永远卡住"
```

### 3. 并发写冲突

同一个 `threadId` 同时被两个请求续跑，会**互相覆盖快照**。防护：

- 同一 `threadId` 的执行用分布式锁串行化（Redis `SETNX` 或数据库锁）。
- 或业务上保证一个 `threadId` 同时只有一个活跃执行。

### 4. 选型的硬建议

| 场景 | 建议 |
| --- | --- |
| 本地开发 / 单测 | `MemorySaver` |
| 生产单实例、要重启恢复 | `FileSystemSaver` |
| **生产多实例（绝大多数）** | **`RedisSaver`（高可用、共享）** |
| 已有 MySQL 且不想加中间件 | `MysqlSaver` |
| 已有 MongoDB / PG | 对应 `MongoSaver` / `PostgresSaver` |

::: warning 别用 MemorySaver 上生产
`MemorySaver` 重启即丢、多实例各存各的。一旦你的服务有 2 个以上副本，或会重启，断点续跑就会"神秘失效"。**生产只用 Redis/MySQL 等外部 Saver。**
:::

## 本篇小结

- **Checkpoint 是跑到某一步的现场快照**（节点、下一节点、完整状态），配了 Saver 后每个节点跑完自动存档。
- **Saver 选型的本质**：内存（开发）/ 文件（单机重启）/ Redis（生产多实例首选）/ MySQL（复用 DB 基建）。Vector 库约定（Elasticsearch）不影响 Checkpoint 存储选型。
- **断点续跑三件套**：`threadId`（找回快照）+ `Saver`（存盘）+ `interruptBefore`（设中断点）。恢复靠同一 `threadId` + 写回决策 + 继续跑。
- **threadId 是会话身份证**：隔离不同会话；复用会误触发"续跑"，新会话务必用新 ID。
- **HITL = 中断为了等人**：与第 13 章人机协同共用同一机制，条件边按人决策选路。
- **生产三件套坑**：序列化兼容、快照膨胀清理、并发写冲突（同 threadId 加锁）。

## 参考链接

- StateGraph 执行引擎 / Checkpoint（DeepWiki）：<https://deepwiki.com/kuyusea/spring-ai-alibaba/2.1-stategraph-execution-engine>
- 人工介入 HITL 官方教程：<https://java2ai.com/en/docs/1.0.0.2/tutorials/graph/human-in-the-loop/>
- Spring AI Alibaba 官网：<https://java2ai.com/>
- GitHub graph 模块源码（核对 Saver 类名最准）：<https://github.com/alibaba/spring-ai-alibaba>

下一篇 → [17 模型与 ChatClient](/java/saa/model)
