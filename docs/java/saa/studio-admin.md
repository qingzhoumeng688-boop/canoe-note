# 22 Studio 与 Admin

> 用可视化工具降低调试成本，把"开发调试 → 上线评估"串成一条流水线。前面你写的 Agent 都是靠 curl 和日志在黑盒里验证，这一章介绍 Spring AI Alibaba 提供的两样东西：轻量级的 Studio（本地调试 UI）和重量级的 Admin（一站式平台），以及它们能帮你省下多少排障时间。

## 本篇要解决的问题

- Studio 是干什么的、怎么启动、能在里面看到什么
- Admin 一站式平台有哪些能力，怎么部署
- 可视化编排（拖拉拽搭 Agent / Graph）是噱头还是真有用
- 能不能把 Dify / Coze 上已有的应用迁过来
- 什么时候该上平台、什么时候纯代码就够了

::: warning 本篇的 API / 平台基线
Studio 和 Admin 是 Spring AI Alibaba 社区**仍在快速迭代**的模块，UI 路径、依赖版本、Docker 配置在不同版本之间可能变化。**凡涉及具体路径和配置，落地前请以你所用版本的官方文档为准**（<https://java2ai.com/docs/frameworks/studio/quick-start> 与 Admin 仓库 README）。本篇给出经过验证的典型用法和思路。
:::

## 一、Studio 是什么：本地/在线调试 UI

### 1.1 一句话定位

Studio 是一个**嵌入到你 Spring Boot 应用里的 Web 调试界面**。你不用自己写 Controller、不用拼 curl，启动应用后直接打开浏览器就能和你的 Agent 对话，并且能**实时看到推理过程、工具调用、节点执行状态、状态流转**。

比喻：你写代码就像在调一台复杂的机器，以前你只能在机器外壳上贴个纸条（日志）看它干了啥；Studio 相当于给机器装了一块**透明观察窗 + 仪表盘**，你一眼就能看见里面哪个齿轮在转、转了多久。

### 1.2 两种运行模式

| 模式 | 适合 | 做法 |
| --- | --- | --- |
| **嵌入式（Embedded）** | 本地开发调试自己的 Agent | 加一个依赖，访问 `/chatui/index.html` |
| **独立式（Standalone）** | 不想改自己项目、纯当调试客户端 | clone 仓库的 `agent-chat-ui`，`pnpm dev` 跑在 3000 端口连你的后端 |

### 1.3 嵌入式模式：三步接入

**第 1 步：加依赖**

`pom.xml` 片段：

```xml
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-studio</artifactId>
    <version>1.1.2.0</version>
</dependency>
```

::: warning 依赖冲突的经典坑
Studio 内部已经带了一个 `spring-ai-alibaba-starter-dashscope`。**如果你的项目是用 OpenAI 兼容模式（`spring-ai-starter-model-openai`）接的百炼**，容器里就会出现两个 `ChatModel` Bean，导致注入失败。此时需要把 Studio 里的 dashscope starter 排除掉：

```xml
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-studio</artifactId>
    <version>1.1.2.0</version>
    <exclusions>
        <exclusion>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-starter-dashscope</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```
:::

**第 2 步：确认配置**

部分版本需要在 `application.yml` 里显式开启（请以你所用版本的文档为准）：

```yaml
spring:
  ai:
    studio:
      enabled: true
```

**第 3 步：启动并访问**

启动你的 Spring Boot 应用，默认访问地址（不同版本路径略有差异，请以文档为准）：

```text
http://localhost:8080/chatui/index.html
```

（早期文档也出现过 `/studio` 路径，若 `/chatui/index.html` 打不开，可尝试 `/studio`。）

**你能在这里看到什么**：

- **对话轨迹**：你发的每句话、模型每次回的每段，按时间线排列。
- **工具调用**：模型调了哪个工具、传了什么参数、返回了什么——这是调试 Agent 最有价值的信息。
- **状态流转**：如果是基于 Graph 的应用，能看到每个节点的执行状态、输入输出、耗时，甚至自动渲染流程图。
- **多会话隔离**：通过 `threadId` 区分不同对话，不会串台。

### 1.4 独立式模式（不污染自己的项目）

如果你只想把 Studio 当个调试客户端，不想往业务项目塞前端资源：

```bash
git clone https://github.com/alibaba/spring-ai-alibaba.git
cd spring-ai-alibaba/spring-ai-alibaba-studio/agent-chat-ui
pnpm install   # 或 npm install
pnpm dev       # 或 npm run dev
```

默认跑在 `http://localhost:3000`，会通过 `.env.development` 里的 `NEXT_PUBLIC_API_URL` 连到你的后端（默认 `http://localhost:8080`）。你可以改这个文件指向任意后端。

### 1.5 实战踩坑（来自社区经验）

| 现象 | 原因 | 解决办法 |
| --- | --- | --- |
| 通过 Studio 聊天，节点里自定义字段（如 `productId`）为空 | Studio 默认把用户输入放进 `input` 字段，而非你节点期望的字段名 | 在节点里增加"从 `input` 提取"的兜底逻辑，并在 `KeyStrategyFactory` 注册该 key |
| 审批链接里 `sessionId` 为空 | Studio 用 `threadId` 作为会话标识，不传 `sessionId` | 改用 `state.value("threadId", "")` 作为业务唯一标识 |
| Graph 的 `interruptBefore` 审批 UI 在 Studio 里没反应 | Studio 前端当前版本未内置 tool-confirm 审批渲染组件 | 轻量调试可把"等待"下沉到节点内部用内存轮询；正式审批流用 Admin 平台 |

::: tip Studio 的正确定位
Studio 是**开箱即用、零依赖、秒级启动的本地调试利器**，核心价值是"快速验证 Graph/Agent 逻辑 + 可视化追踪"。它不是生产管理后台，那种活交给下面的 Admin。
:::

### 1.6 Studio 的自动发现机制与端点

你加完依赖、启动应用，Studio 是怎么"找到"你的 Agent 的？理解机制能帮你避开"UI 打开了但下拉框是空的"这种尴尬。

- **Agent 类应用**：Studio 后端会扫描 Spring 容器里所有 `Agent` 类型的 Bean（来自 SAA agent-framework），把它们列在 UI 的下拉框里供你选择对话。所以确保你的 Agent 是一个被 Spring 管理的 `@Bean` 或 `@Component`。
- **Graph 类应用**：Studio 通过 `ContextScanningGraphLoader` 自动发现容器中所有 `CompiledGraph` 类型的 Bean，并用 `StateGraph` 构造时传入的名字（`new StateGraph("myGraph", ...)` 的第一个参数）作为图名。UI 里选这个图名即可对话。
- **暴露的端点**（典型的，具体以版本为准）：`/v1/agent/chat`（同步调用 Agent）、`/chatui/index.html`（UI 首页）、`/v3/api-docs.yaml`（自动生成的 OpenAPI，供前后端契约一致）。

::: tip Studio 和 Agent 的"接线"约定
Studio 默认把用户在聊天框的输入转成两种形态传给你的应用：
1. 如果传了结构化 `inputs`，就原样作为图/ Agent 的输入 Map；
2. 否则把用户输入文本同时塞进 `input` 字段和 `messages` 列表（`Map.of("input", text, "messages", List.of(new UserMessage(text)))`）。

**这就是为什么 1.5 节踩坑里强调"节点要从 `input` 取数"**——你的自定义节点如果只认 `productId` 这种字段，Studio 模式下就会取空。解决方法：节点里加"从 `input` 提取"的兜底，并在 `KeyStrategyFactory` 注册 `input` 这个 key。
:::

## 二、Admin 一站式平台能力清单

### 2.1 是什么

Admin（也叫 Agent Studio）是一个**完整的 AI Agent 生命周期管理平台**，比 Studio 重得多：它自带前端 + 后端 + 数据库（MySQL）+ 可观测组件（Elasticsearch + Kibana + OTel Collector），可以独立部署，也可以嵌入你的 Spring Boot 应用。

它面向两类用户：

- **AI 应用开发者**：管理 Prompt、调试 Agent 行为、跑评测。
- **外部 AI 应用**：接入 Admin 做动态配置加载和 Trace 采集。

### 2.2 六大能力域

| 能力域 | 关键特性 | 解决什么痛点 |
| --- | --- | --- |
| **Prompt 管理** | 模板管理、版本控制、实时调试、会话管理 | 改 prompt 不再靠改代码发版，可追溯历史 |
| **数据集管理** | 多格式导入、版本控制、条目级增删改、基于 Trace 创建 | 沉淀评测集，从生产 Trace 反哺测试 |
| **评测器管理（Evaluator）** | 自定义配置、模板系统、在线调试、版本控制 | 把第 21 章的 LLM-as-Judge 变成可视化管理 |
| **实验管理** | 自动化执行、结果分析、批量处理 | 同一问题换不同 prompt/模型，A/B 对比 |
| **可观测性** | OpenTelemetry 集成、Trace 追踪、服务监控、Span 分析 | 生产 Agent 的分布式追踪（接 ES + Kibana） |
| **模型配置** | 多供应商、参数管理、动态切换 | 一套 UI 管 OpenAI / DashScope / DeepSeek |

::: tip 它和前面章节的呼应
- Prompt 版本管理 → 呼应"提示词工程"（第 03 章）。
- 评测器 + 实验 → 呼应"效果评估与回归测试"（第 21 章）。你在 Admin 里点的"跑实验"，底层就是 `RelevancyEvaluator` 那套。
- 可观测性 → 呼应"Trace 链路追踪"（第 21 章）。Admin 用 OTel 采集，存到 Elasticsearch，用 Kibana 看。
- 模型配置 → 多模型切换不用改代码。
:::

### 2.3 模块结构与可观测网络（深入一点）

Admin 不是单体，而是几个模块拼起来的：

| 模块 | 作用 |
| --- | --- |
| `spring-ai-alibaba-studio` | 含 UI 静态资源和基础 Controller，即前面章节的 Studio 能力 |
| `spring-ai-alibaba-admin` | 完整的 Agent 生命周期管理后端（Prompt/数据集/评测/实验/可观测/模型） |
| `spring-ai-alibaba-starter-dashscope` | Admin 内部智能体用的模型接入 |

它的可观测网络设计值得借鉴：Elasticsearch + Kibana + Loongcollector 跑在**专用的 Docker 网络**上，OTLP Collector 在 4318 端口收 Trace，处理后存进 ES，Kibana 负责可视化。这意味着 Admin 自带了一套"第 21 章讲的可观测方案"的**成品实现**——你不用自己搭 ES+Kibana，开箱即用。

此外 Admin 通过 **Nacos** 做动态配置：生产的 Agent 运行时按 `promptKey` 从 Nacos 拉取最新 prompt，改 prompt 不用重新发版。这对"线上紧急调话术"非常实用。

### 2.4 实战：在 Admin 里注册自定义评测器与 Prompt 版本

Admin 的"评测器管理"和"Prompt 管理"不是纯 UI 摆设，它们对应第 21 章你写的 `Evaluator` 和 prompt 模板。思路是：

1. **Prompt 版本化**：把生产用的 system prompt 抽到 Admin 管理，每次修改生成新版本，运行时按 `promptKey` 拉取。回滚只需切版本号。
2. **自定义 Evaluator**：把 `RelevancyEvaluator` / `FactCheckingEvaluator` 或你自己的评委逻辑，注册成 Admin 里可调用的评测器，然后在"实验管理"里对同一批问题跑不同 prompt 版本，自动对比通过率。

一个把 prompt 外部化的简化示例（对应 Admin 的 Prompt 管理思路，用 Nacos 配置中心实现同样效果）：

`src/main/java/com/example/saa/studio/PromptConfig.java`

```java
package com.example.saa.studio;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 把 system prompt 外部化：从配置中心（Nacos/Apollo/环境变量）读取，
 * 而不是硬编码在代码里。
 *
 * 为什么要这么做：prompt 是 AI 应用的"核心资产"，改 prompt 不应该触发一次发版。
 * 用配置中心后，运营/算法同学在 Admin 里改一句话术，应用热更新即可生效。
 */
@Configuration
public class PromptConfig {

    // 从配置中心按 key 注入；本地没配时给默认值，保证能跑起来
    @Value("${app.prompt.cs.system:你是一名专业客服，只能基于知识库回答}")
    private String csSystemPrompt;

    @Bean
    public String customerServiceSystemPrompt() {
        return csSystemPrompt;
    }
}
```

在 Service 里注入使用：

`src/main/java/com/example/saa/studio/PromptAwareService.java`

```java
package com.example.saa.studio;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

/**
 * 演示"外部化 prompt"如何接入 ChatClient。
 * 改 prompt 只需改配置中心，无需重新打包部署。
 */
@Service
public class PromptAwareService {

    private final ChatClient chatClient;

    public PromptAwareService(ChatClient.Builder builder,
                              @Qualifier("customerServiceSystemPrompt") String systemPrompt) {
        this.chatClient = builder
                .defaultSystem(systemPrompt)   // 动态 system prompt
                .build();
    }

    public String answer(String userQuestion) {
        return chatClient.prompt().user(userQuestion).call().content();
    }
}
```

::: tip 落地顺序建议
先用上面的"配置中心 + @Value"把 prompt 外部化跑通（低成本），等团队真需要版本对比、A/B 实验、可视化编辑时，再上 Admin 接管这部分。不要为了用平台而用平台。
:::

### 2.5 部署方式

Admin 通过 `docker-compose` 一键拉起整套依赖（MySQL、Nacos、Elasticsearch、Kibana、OTel Collector）。关键架构特征：

- **统一端口策略**：前端 dev server 和后端都跑在 8080，前端代理 `/api` 请求。
- **隔离的可观测网络**：Elasticsearch、Kibana、Collector 跑在专用 Docker 网络。
- **多供应商 AI 接入**：后端用 `model-config.yaml` 抽象不同模型。
- **动态配置**：外部 Agent 运行时从 Nacos 按 `promptKey` 加载 prompt。
- **分布式追踪**：OTLP Collector 在 4318 端口收 Trace，存进 Elasticsearch。

::: warning 部署前确认
Admin 的 `docker-compose` 服务较多（MySQL / Nacos / ES / Kibana / Collector），**对机器内存要求较高**（ES 单节点就吃 2G+）。个人笔记本跑可能吃力，建议用一台 8G 以上内存的机器或云服务器。具体镜像版本与端口以仓库 README 为准。
:::

## 三、可视化编排：拖拉拽搭 Agent / Graph

### 3.1 为什么需要可视化编排

前面你写 Agent / Graph 都是**写 Java 代码**定义节点和边。这对程序员没问题，但有两个场景代码不划算：

1. **业务方 / 产品经理**想自己调流程，不想碰代码；
2. **快速原型验证**，拖几下比写一堆 `@Bean` 快得多。

Spring AI Alibaba 提供了两条可视化路径：

| 路径 | 形态 | 产出 |
| --- | --- | --- |
| **Project Initializer（项目初始化平台）** | 网页上低代码拖拽工作流 / 配置 Chatbot / Agent | **导出 Java 项目源码** |
| **Admin 的可视化 Agent 开发** | 在 Admin 里拖节点连线 | 直接运行 / 导出为独立 Java 项目 |

### 3.2 从"拖拽"到"代码"：所见即所得

Project Initializer 的理念是 **"从拖拽画图到自动生成 Spring AI Alibaba 代码"**：你在网页上画好流程图（节点 + 连线），平台帮你生成等价的 `StateGraph` 代码。这对"不想手写 Graph 状态定义"的团队很友好。

::: tip 给程序员的建议
可视化编排生成的代码，**建议还是要 review 一遍再提交**。自动生成的 Graph 代码可能不如手写的精简，且复杂的条件分支、自定义节点逻辑，目前仍更适合手写。把它当作"原型加速器"而不是"替代编码"。
:::

### 3.3 从"拖拽"到"代码"：一个具体例子

假设你想做一个"用户提问 → 意图分类 → 查知识库或调工具 → 汇总回答"的客服 Agent，在 Project Initializer 里拖出三个节点：

```text
[ 用户输入 ] ──→ [ 意图分类节点(LLM) ] ──→ [ 分支节点 ]
                                              ├─ 知识类 → [ RAG 检索节点 ] ─┐
                                              └─ 数据类 → [ 工具调用节点 ] ─┤
                                                                          ├─→ [ 汇总节点(LLM) ] ──→ [ 输出 ]
```

平台导出的 Java 代码，本质上就是第 14~16 章讲的那套 `StateGraph`：每个方框变成一个 `NodeAction`，箭头变成 `edge()`，分支变成条件边。你拿到的代码结构大致是：

```java
// 平台自动生成（示意，具体 API 以你所用版本为准）
StateGraph graph = new StateGraph("customerServiceGraph", strategyFactory);
graph.addNode("classify", classifyNode);        // 意图分类
graph.addNode("rag", ragNode);                  // 知识检索
graph.addNode("tool", toolNode);                // 工具调用
graph.addNode("summarize", summarizeNode);      // 汇总
graph.addEdge(START, "classify");
graph.addConditionalEdges("classify",           // 分支
        state -> "知识类".equals(state.value("intent")) ? "rag" : "tool",
        Map.of("rag", "rag", "tool", "tool"));
graph.addEdge("rag", "summarize");
graph.addEdge("tool", "summarize");
graph.addEdge("summarize", END);
```

看懂这个映射后你会发现：**可视化编排不是黑魔法，它只是把你已经会的 Graph 画法换了个入口**。所以即使不用平台，你手写这段代码也完全等价——平台的价值在于"让不会写 Java 的人先画出来"，以及"改流程不用重新编译"。

## 四、从 Dify / Coze DSL 迁移

很多团队已经在 Dify、Coze 上用 DSL（YAML/JSON 描述的工作流）搭了应用，想迁到 Spring AI Alibaba 拿到 Java 生态的工程化能力（类型安全、Spring 生态、私有化部署）。

### 4.1 现状与限制（务必确认）

根据公开资料，Spring AI Alibaba 生态**已提出并初步支持与 Dify 的集成 / DSL 相关能力**，例如官方提到"支持 Dify DSL 自动生成 Graph 代码""支持从 DSL 快速迁移到 Spring AI Alibaba 项目"。但这类能力的**成熟度、覆盖的 DSL 版本、支持的节点类型都在演进中**。

::: danger 迁移前必须核实
**具体到你用的 Dify / Coze 版本、具体工作流节点类型能否无缝迁移，本篇无法替你保证。** 请按以下路径核实当前能力：
1. 官方文档：<https://java2ai.com/> 搜索 "Dify" / "DSL" / "迁移"；
2. GitHub 仓库 <https://github.com/alibaba/spring-ai-alibaba> 的 Admin / Studio 模块 README 与 examples；
3. 官方社区（钉群 / 微信群）确认你目标 DSL 版本的兼容性。

**不要**假设"一键迁移"。实际迁移通常要处理：节点语义差异（Dify 的某些节点在 SAA Graph 里没有等价实现）、变量作用域、工具注册方式、模型配置映射等。
:::

### 4.2 务实的迁移策略

如果官方迁移工具覆盖不了你的工作流，推荐**半自动迁移**：

1. 把 Dify 工作流当"需求说明书"，人工映射成 SAA 的 `StateGraph`（节点 → NodeAction，边 → 条件跳转）。
2. 工具（Tools）重新用 `@Tool` 或 MCP 在 Java 侧注册。
3. 提示词直接复用，迁到 Admin 的 Prompt 管理做版本化。
4. 用第 21 章的评测集做回归，确保迁移后行为一致。

### 4.3 Dify 节点到 SAA 的映射参考（迁移时心里有数）

如果你决定手工/半自动迁移，下面这张对照表能帮你快速定位"Dify 里这个节点，在 SAA 里用什么实现"：

| Dify 工作流节点 | SAA 中的等价实现 | 备注 |
| --- | --- | --- |
| 开始 / 结束 | `START` / `END` 常量 | Graph 的固定端点 |
| LLM 节点 | `AgentLlmNode` 或自定义 `NodeAction` 调 `ChatClient` | 直接映射 |
| 知识检索节点 | `VectorStoreDocumentRetriever` + RAG Advisor | 需先在 ES 建索引 |
| 工具 / 插件节点 | `@Tool` 方法 或 MCP Server | SAA 用 MCP 对接外部工具更标准 |
| 条件分支 / IF | `addConditionalEdges` | 条件函数返回目标节点名 |
| 代码节点 | 自定义 `NodeAction`（Java 代码） | 比 Dify 的沙箱代码更类型安全 |
| 循环 / 迭代 | 条件边回到自身节点 或 `ParallelNode` | 注意设置最大循环次数防失控 |
| 变量赋值 | `OverAllState` 的 key | 需在 `KeyStrategyFactory` 注册 |

::: warning 哪些最容易"迁不过来"
1. **Dify 某些专有插件**（如特定 SaaS 连接器）在 SAA 里没有现成等价物，需要自己用 MCP 或 `@Tool` 补齐；
2. **变量作用域与类型**语义不完全一致，迁移后要逐节点核对输入输出；
3. **模型配置映射**：Dify 的模型供应商体系与 SAA 的 `ChatModel` 注册方式不同，需要重新配置。
4. 具体支持到什么程度，**以你所用版本的官方文档和 examples 为准**，不要假设全量兼容。
:::

## 五、什么时候该上平台、什么时候不用

这是最实用的一节。平台不是越多越好，它也有引入成本（部署、内存、学习）。

### 5.1 决策表

| 你的阶段 / 场景 | 建议 | 理由 |
| --- | --- | --- |
| 个人学习、写 Demo、验证想法 | **只上 Studio（嵌入式）** | 零部署、秒级启动，看调用轨迹足够 |
| 小团队、1~2 个 Agent、已经在用代码管理 prompt | 先不上 Admin | 引入 Admin 的运维成本大于收益 |
| 多 Agent、频繁调 prompt、需要 A/B 实验 | **上 Admin** | Prompt 版本 + 实验 + 评测能显著提效 |
| 生产环境、需要分布式追踪和告警 | **上 Admin 的可观测性 或 接 ARMS**（二选一） | 生产必须看得见，二选一看你云生态 |
| 已经有 Prometheus + Grafana 体系 | 不上平台，用 `micrometer-registry-prometheus` | 别重复造监控 |
| 业务方要自己调流程、不想碰代码 | **上 Admin 可视化编排** | 这才是平台真正的价值点 |

### 5.2 一句话原则

::: tip 先代码、后平台
**先用纯代码把功能跑通，确认值得长期维护，再引入平台做工程和协作增强。** 平台解决的是"规模化、协作、可观测"问题，不是"能不能跑"的问题。初学者一上来就部署 Admin，很容易被它的复杂度劝退——而 Studio 嵌入式模式几乎零成本，强烈建议每个项目都顺手加上。
:::

## 本篇小结

- **Studio 是嵌入式调试 UI**：加一个依赖、开 `enabled`，访问 `/chatui/index.html` 就能看对话轨迹、工具调用、节点状态流转。注意排除 dashscope starter 冲突、Studio 用 `input`/`threadId` 传参的坑。
- **Admin 是一站式平台**：六大能力（Prompt / 数据集 / 评测器 / 实验 / 可观测 / 模型配置），用 docker-compose 部署，适合多 Agent、需协作和生产的团队。
- **可视化编排**：Project Initializer 能从拖拽生成 Java 代码；把它当原型加速器，生成代码要 review。
- **Dify / Coze 迁移**：官方已有 DSL 相关支持但仍在演进，**具体兼容性以官方文档和你所用版本为准**，复杂工作流建议半自动人工映射。
- **平台选型原则**：先代码后平台；Studio 几乎零成本建议都加，Admin 看团队规模和协作需求。

## 参考链接

- Spring AI Alibaba Studio 快速开始：<https://java2ai.com/docs/frameworks/studio/quick-start>
- Spring AI Alibaba 概述（含 Studio / Project Initializer）：<https://java2ai.com/docs/dev/overview/>
- Admin 仓库（Agent Studio）：<https://github.com/alibaba/spring-ai-alibaba/tree/main/spring-ai-alibaba-admin>
- Studio 仓库：<https://github.com/alibaba/spring-ai-alibaba/tree/main/spring-ai-alibaba-studio>
- Spring AI Alibaba GitHub：<https://github.com/alibaba/spring-ai-alibaba>

下一篇 → [23 实战案例](/java/saa/cases)
