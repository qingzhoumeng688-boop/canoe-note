# 09 版本与生态关系

> 选型和踩坑，多半发生在"没搞清楚边界"的时候。这一章把 SAA 和 Spring AI 谁提供什么能力、各个 Maven 模块怎么分工、版本怎么对齐、和 AgentScope / Python 生态怎么区分、什么时候**不该**用 SAA，一次说清。

## 本篇要解决的问题

- SAA 和 Spring AI 到底怎么分工？哪些能力是"白嫖"上游的，哪些才是阿里自己写的？
- Maven 里那一堆 `spring-ai-alibaba-*` 模块，分别是什么、我该引哪个？
- 版本号怎么对？Spring Boot / Spring AI / SAA 三者谁来迁就谁？
- SAA 和 AgentScope 是什么关系？和 Python 的 LangChain / LangGraph 怎么类比？
- 哪些场景其实**不该**上 SAA？升级迁移要注意什么？

## 一、与 Spring AI 的关系

先给结论：**SAA 是 Spring AI 的上层扩展，不是替代品。** 它是建立在 Spring AI 抽象之上的"Agent 应用开发框架 + 阿里云生态集成"。

### 1.1 能力来源对照

下面这张表把"这个能力到底是谁的"拆开，避免你以为所有东西都是阿里写的：

| 能力 | 来源 | 说明 |
| --- | --- | --- |
| `ChatModel` / `ChatClient` | **Spring AI（上游）** | 模型调用的统一抽象，SAA 直接复用 |
| `Tool` / `@Tool` / `ToolCallback` | **Spring AI（上游）** | 工具机制完全来自 Spring AI |
| `VectorStore` | **Spring AI（上游）** | 向量检索抽象，本站统一用 Elasticsearch 实现 |
| `Message` / `ChatMemory` | **Spring AI（上游）** | 消息与多轮记忆 |
| `DashScopeChatModel` | **SAA 扩展（Spring AI Extensions）** | 阿里对 Spring AI `ChatModel` 的百炼实现 |
| `ReactAgent` / `SequentialAgent` 等 | **SAA 自己写** | Agent 高层框架，上游没有 |
| `StateGraph` / `MemorySaver` | **SAA 自己写** | Graph 工作流运行时，上游没有 |
| 上下文工程 / HITL | **SAA 自己写** | 内置的 Agent 最佳实践 |
| 百炼平台 / Nacos / A2A | **SAA 生态集成** | 阿里云专属打通 |

::: tip 一句话记忆
**"原子能力找 Spring AI，Agent 编排找 SAA。"** 你写的任何 `@Tool`、`VectorStore`、甚至 `ChatClient` 调用，本质都是 Spring AI 的 API；只有 `ReactAgent`、`StateGraph` 这种"编排层面的东西"才是 SAA 的增量价值。
:::

### 1.2 依赖方向再确认

```text
你的业务代码
    │  使用
    ▼
Spring AI Alibaba（ReactAgent / Graph / 阿里扩展）
    │  依赖（复用其抽象）
    ▼
Spring AI（ChatModel / Tool / VectorStore / Message）
    │  依赖
    ▼
大模型 HTTP API（百炼 DashScope / OpenAI / DeepSeek …）
```

因此：**升级 Spring AI 版本时，SAA 必须同步升级到与之匹配的版本**（见第三节对照表）。反过来，想用某个 SAA 新特性，得先确认它依赖的 Spring AI 版本你的项目能不能接受。

## 二、核心 Maven 模块

SAA 的源码仓库拆成了若干独立模块，理解它们能帮你"只引自己要的"，也方便排查依赖。下表基于官方仓库结构整理：

| 模块（artifactId 前缀 `com.alibaba.cloud.ai:`） | 作用 | 日常要不要直接引 |
| --- | --- | --- |
| `spring-ai-alibaba-agent-framework` | Agent 开发框架核心：`ReactAgent`、多 Agent 编排、上下文工程、HITL | **要**（写 Agent 必引） |
| `spring-ai-alibaba-graph` | Graph 工作流运行时：`StateGraph`、节点/边、状态、持久化 | 一般用 agent-framework 间接依赖即可；要直接构图时可引 |
| `spring-ai-alibaba-starter-dashscope` | 百炼 DashScope 的 Spring Boot starter，自动配置 `ChatModel` | **要**（用通义/qwen 必引） |
| `spring-ai-alibaba-admin` | 一站式 Agent 平台：可视化开发、可观测、评估、MCP 管理 | 可选（平台化运维时） |
| `spring-ai-alibaba-studio` | 内嵌的可视化调试 UI | 可选（本地调试体验） |
| `spring-boot-starters`（Nacos 集成） | 把 Agent Framework 与 Nacos 集成，提供 A2A、动态配置 | 可选（需分布式 Agent 协作时） |
| `spring-ai-alibaba-extensions-*`（如 dashscope 扩展） | 对 Spring AI 核心概念的具体实现（DashScopeChatModel 等） | 通常由 starter 传递依赖，无需手引 |

> 注：具体 artifactId 随版本可能微调，**以你所用 SAA 版本的官方文档 / Maven 仓库为准**。本专栏示例统一使用 `spring-ai-alibaba-agent-framework` + `spring-ai-alibaba-starter-dashscope` 这两个，已覆盖绝大多数场景。

### 2.1 最简依赖组合

和上一章一致，写 Agent + 用百炼，只需这两个：

```xml
<dependencies>
    <!-- Agent 框架核心 -->
    <dependency>
        <groupId>com.alibaba.cloud.ai</groupId>
        <artifactId>spring-ai-alibaba-agent-framework</artifactId>
    </dependency>
    <!-- 百炼 DashScope starter：自动配置 ChatModel -->
    <dependency>
        <groupId>com.alibaba.cloud.ai</groupId>
        <artifactId>spring-ai-alibaba-starter-dashscope</artifactId>
    </dependency>
</dependencies>
```

### 2.2 想直接玩 Graph，不止用 ReactAgent

当你需要 ReactAgent 满足不了的精细流程控制时，可单独引入 graph 模块，用 `StateGraph` 自行构图（完整用法见第 14～16 章）：

```xml
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-graph</artifactId>
</dependency>
```

```java
package com.example.saa.ecosystem;

import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;

/**
 * 直接基于 Graph 运行时构图的最小示意。
 * 注意：具体 API 以你所用版本的官方文档为准。
 */
public class GraphOnlyDemo {
    public void build() throws Exception {
        StateGraph graph = new StateGraph("custom-flow");
        // graph.addNode(...); graph.addEdge(...);
        graph.compile(new MemorySaver());
    }
}
```

### 2.3 Maven 依赖全景（一张图看清该引什么）

把本章提到的模块按"必引 / 按需 / 可选"整理成一张全景表，建工程时对着勾：

```xml
<!-- ========== 必引（写 Agent + 用百炼） ========== -->
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-agent-framework</artifactId>
</dependency>
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-starter-dashscope</artifactId>
</dependency>

<!-- ========== 按需（直接构图 / 可视化 / 平台 / 分布式） ========== -->
<!-- 需要脱离 ReactAgent、直接用 StateGraph 精细编排时 -->
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-graph</artifactId>
</dependency>
<!-- 需要可视化调试 Agent 时 -->
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-studio</artifactId>
</dependency>
<!-- 需要把 Agent 当平台运维（可观测/评估/MCP 管理）时 -->
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-admin</artifactId>
</dependency>
<!-- 需要多服务间 Agent 通信（A2A）/ 动态配置时，配合 Nacos -->
<!-- 由 spring-boot-starters 模块提供，具体 artifact 以官方为准 -->

<!-- ========== 版本由 BOM 统一，上面都不写 version ========== -->
```

::: tip 依赖原则的"三不"
1. **不让 Spring AI 各子模块独写版本** —— 交给 `spring-ai-bom`。
2. **不让 SAA 各子模块独写版本** —— 交给 `spring-ai-alibaba-bom`。
3. **不混用多个模型 starter** —— 一个项目只留一个（dashscope 或 openai 二选一）。
:::

### 2.4 如何核实你所用版本的 API（重要）

SAA 的 API 演进极快，`ReactAgent.builder()` 的方法名、`@Tool` 的参数、`MemorySaver` 的包路径都可能随版本变化。当本文示例和你实际版本对不上时，按下面路径自查，不要凭记忆硬编：

1. **先查你当前的版本号**：看 `pom.xml` 里 `spring-ai-alibaba.version` 的值。
2. **去官网对应版本文档**：<https://java2ai.com/>，左侧导航找 "Agent Framework / Graph" 章节。
3. **去 GitHub 源码按包名搜**：核心类都在 `com.alibaba.cloud.ai.graph.agent`（Agent）、`com.alibaba.cloud.ai.graph`（Graph）、`com.alibaba.cloud.ai.dashscope`（模型）三个包下，直接搜类名最准。
4. **跑官方 example 对照**：<https://github.com/alibaba/spring-ai-alibaba/tree/main/examples> 里有可运行的 `chatbot`、`multiagent-patterns` 等，照着抄最稳。

> 本文所有 SAA API 示例均基于 **1.1.2.0** 验证；若使用其他版本，以你所用版本官方文档为准。

## 三、Spring Boot Starters

SAA 遵循 Spring Boot 的 starter 惯例：一个 starter 负责"自动配置好一类能力"，你只管注入 Bean。

| Starter / 模块 | 自动配置出的核心 Bean | 何时用 |
| --- | --- | --- |
| `spring-ai-alibaba-starter-dashscope` | `ChatModel`（百炼实现）、`EmbeddingModel` | 用通义/qwen 系列模型 |
| `spring-ai-alibaba-agent-framework`（非 starter，是框架库） | 提供 `ReactAgent` 等类，需你自行 `@Bean` 配置 | 写 Agent |
| Nacos 集成 starter | A2A 通信、动态配置 | 多服务分布式 Agent 协作 |

::: warning 不要同时引两个模型 starter
如果你既引了 `spring-ai-alibaba-starter-dashscope`，又引了 Spring AI 官方的 `spring-ai-starter-model-openai`，两者都会尝试创建 `ChatModel` Bean，注入时因"多个候选 Bean"而启动失败。**一个项目只保留一个模型 starter**，需要多模型时在代码里用 `@Qualifier` 或不同配置类隔离。
:::

## 四、版本对照表

这是本章最实用的一张表。**三者必须捆绑对齐**，缺一不可。

| SAA 版本 | Spring AI 版本 | Spring Boot 版本 | 说明 |
| --- | --- | --- | --- |
| **1.1.2.0（本专栏基线）** | **1.1.2** | **3.5.x** | 与本站统一技术栈一致 |
| 1.1.2.2（更新版本） | 1.1.2 | 3.5.x | 增加 Agent Skills、Supervisor/Routing 等多 Agent 能力 |
| 1.1.0.0 | 1.1.0 | 3.4.x | 1.1.x 首个正式版 |
| 1.0.x | 1.0.0 | 3.4.x | 早期 1.0 系列 |

> 数据来源：SAA 官方文档与发布说明，版本组合以官方最新对照为准。本文写作时以 `1.1.2.0 / Spring AI 1.1.2 / Spring Boot 3.5.5` 为基准。

### 4.1 BOM 怎么管版本

SAA 用两个 BOM 把"Spring AI 全家桶"和"阿里全家桶"的版本一次性拍平：

```xml
<dependencyManagement>
    <dependencies>
        <!-- Spring AI 官方 BOM：统一 spring-ai-core / model-* / vector-store-* 等 -->
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-bom</artifactId>
            <version>1.1.2</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
        <!-- SAA 的 BOM：统一所有 com.alibaba.cloud.ai 下依赖的版本 -->
        <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-bom</artifactId>
            <version>1.1.2.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

**为什么是两个而不是一个？** 因为这两组依赖由不同团队、不同节奏发布，各自有自己的 BOM。引入两个 BOM 后，你的 `pom.xml` 依赖里**不必再写任何 `<version>`**，版本全部由 BOM 仲裁，从根本上避免"局部写死版本导致整体打架"。

### 4.2 升级只改一处

把所有版本收敛到 `<properties>`，升级时只改这里：

```xml
<properties>
    <java.version>17</java.version>
    <spring-ai.version>1.1.2</spring-ai.version>
    <spring-ai-alibaba.version>1.1.2.0</spring-ai-alibaba.version>
</properties>
```

::: tip 升级原则：三者一起看
想从 `1.1.2.0` 升到 `1.1.2.2`，要同时确认：① Spring AI 是否还是 `1.1.2`（是，可只升 SAA）；② Spring Boot 是否兼容（3.5.x 不变则安全）。**不要单独升 SAA 而让 Spring AI 停留在不匹配的版本**——这正是大多数 `NoSuchMethodError` 的根源。
:::

### 4.3 依赖冲突实战排查

当项目启动报 `NoSuchMethodError` / `ClassNotFoundException` / `NoSuchClass` 时，多半是版本打架。按下面步骤定位：

```bash
# 1. 看整棵依赖树，重点 grep spring-ai 相关，确认没有两个不同主版本混进来
mvn dependency:tree | grep -i "spring-ai"

# 2. 直接看某个类的实际来源（确认它来自哪个 jar / 哪个版本）
mvn dependency:tree -Dincludes=com.alibaba.cloud.ai

# 3. 若发现某个子模块版本被"其它地方"强制指定了，在 pom 里显式对齐到 BOM 版本
```

排查清单：

| 现象 | 可能原因 | 解法 |
| --- | --- | --- |
| `NoSuchMethodError: ReactAgent.builder()` | SAA 版本过低，该方法不存在 | 对齐到 `1.1.2.0+` |
| `NoSuchMethodError` 指向 `org.springframework.ai.*` | Spring AI 与 SAA 版本不匹配 | 按第四节对照表同时升级 |
| `BeanCreationException: ChatModel` | 引入了多个模型 starter | 只保留一个 |
| `ClassNotFoundException: com.alibaba.cloud.ai.graph...` | graph 模块没引入或被排除 | 显式加 `spring-ai-alibaba-graph` 依赖 |
| 启动时 `No qualifying bean` 一大堆 | BOM 没生效，依赖版本错乱 | 确认 `dependencyManagement` 里两个 BOM 都在且 scope=import |

::: danger 别用 `exclude` 掩盖问题
遇到冲突第一反应去 `exclude` 某个传递依赖，往往治标不治本，还可能把真正需要的类排除掉。**优先从"统一 BOM 版本"入手**，exclude 只作为最后手段，并且要清楚自己到底在删什么。
:::

## 五、与 AgentScope 的分工

这是很多人混淆的点。一句话：**AgentScope 是阿里另一个独立的、以 Python 为主的智能体框架，偏"模型驱动的高阶 Agent 范式"；SAA 是 Java 侧、深度集成 Spring 生态的 Agent 框架。**

| 维度 | Spring AI Alibaba（SAA） | AgentScope |
| --- | --- | --- |
| 语言 | **Java / Kotlin**（JVM） | 以 **Python** 为主 |
| 定位 | Spring 生态内的 Agent 框架 + Graph 运行时 | 更偏"模型驱动"的高阶 Agent 范式 |
| 适合 | 已有 Java/Spring 业务系统，要嵌入 AI 能力 | 研究型 / Python 优先的 Agent 实验 |
| 与 Spring 关系 | 原生集成，直接做 `@Bean`、注入、Web | 不在 Spring 体系内 |
| 选型建议 | 你的主系统是 Java/Spring → 选 SAA | 你的技术栈是 Python 优先 → 看 AgentScope |

::: tip 官方原话的意味
官方文档提到：**更高阶的模型驱动 Agent 范式已由新项目 AgentScope 承载**，SAA 这边更聚焦 Spring AI 集成与多智能体协同，ReactAgent 部分仍在持续维护。也就是说——两者不是"新旧替代"，而是"场景分治"：SAA 守住 Java/Spring 阵地，AgentScope 探索更前沿的范式。
:::

## 六、和 Python 侧生态的定位差异

很多同学从 Python 过来，会本能地拿 LangChain / LangGraph 来对标。下面这张表帮你在脑子里建立映射：

| Python 生态 | Java 侧对应 | 关系说明 |
| --- | --- | --- |
| **LangChain**（Python） | Spring AI + SAA Agent Framework | 都是"把模型能力 + 工具 + 数据拼成应用"的框架；SAA 更贴近 Spring 工程化 |
| **LangGraph**（Python） | SAA 的 **Graph Runtime**（`StateGraph`） | 都是"用图建模可控工作流"的底层运行时，概念高度对应 |
| **LangChain/LangGraph 的 Agent** | SAA 的 `ReactAgent` | 都是"ReAct 循环 + 工具调用"的高层封装 |
| **AgentScope**（Python，阿里） | （无直接 Java 对应，是 SAA 的"兄弟项目"） | 阿里在 Python 侧的高阶 Agent 框架 |

结论：**如果你团队是 Java/Spring 技术栈，SAA 就是你能在 JVM 上拿到的最对等的"LangChain + LangGraph"组合**，不必为了用 LangGraph 而去引入 Python 服务。

## 七、扩展生态一览

SAA 不是孤零零一个库，它周围有一圈官方/社区项目，知道它们存在，能少造轮子：

| 项目 | 是什么 | 何时用 |
| --- | --- | --- |
| **JManus** | 基于 SAA 的 Java 版 Manus（通用智能体） | 想要开箱即用的通用 Agent 参考实现 |
| **DataAgent** | 自然语言转 SQL，直接用自然语言查数据库 | 做"对话式查数"产品 |
| **DeepResearch** | 基于 `spring-ai-alibaba-graph` 的深度研究 Agent | 做多步检索+综合的调研类应用 |
| **Spring AI Alibaba Admin** | 可视化 Agent 平台：开发、可观测、评估、MCP 管理 | 需要把 Agent 当平台来运维 |
| **Studio** | 内嵌调试 UI，可视化调 Agent | 本地开发调试体验 |
| **百炼平台 / Nacos** | 阿里云一侧的模型托管与分布式协调 | 上云部署、多 Agent 跨服务协作（A2A） |

::: tip 本专栏的范围
本站聚焦**应用开发主线**（07～18 章的框架 + 19～20 的 RAG + 21～24 的工程化），上面这些"成品项目/平台"只做索引式介绍。真要用到时，直接去对应仓库按官方 README 上手即可。
:::

### 7.1 我该从哪个生态项目起步

面对上面一长串项目容易犯选择困难，给一张"按目标对号入座"的速查表：

| 你的目标 | 直接看 | 理由 |
| --- | --- | --- |
| 先跑通一个能调工具的 Agent | 本站 08、10 章 + `examples/chatbot` | 最小必要知识，最快见效 |
| 做"对话式查数"产品 | **DataAgent** | 自然语言转 SQL 开箱即用 |
| 做多步检索 + 综合的调研助手 | **DeepResearch** | 基于 Graph 的深度研究范式 |
| 要一个通用智能体参考实现 | **JManus** | 阿里内部已在用的 Java 版 Manus |
| 把 Agent 当平台来运维/评估 | **Admin + Studio** | 可视化开发、可观测、MCP 管理 |

> 提醒：这些生态项目版本迭代快、与核心框架存在版本耦合，引入前务必核对它们依赖的 SAA 版本是否和你工程一致，避免再次陷入依赖冲突。

## 八、什么情况下不该用 SAA

清楚地知道"什么时候不用它"，和知道"怎么用"同样重要。

### 8.1 不合适的场景

| 场景 | 为什么不合适 | 更合适的选择 |
| --- | --- | --- |
| 你要**训练 / 微调**模型 | SAA 是应用层框架，不碰模型权重 | PAI / 算法平台 |
| 纯一次性脚本，只调一次模型 | 引入整套 Spring Boot + SAA 太重 | 裸 HTTP（见本站第 01 章）或 Spring AI 的 `ChatClient` |
| 技术栈是 **Python 优先** | SAA 是 Java 框架 | LangChain / LangGraph / AgentScope |
| 需要某模型**独家能力且 SAA 未适配** | 适配器覆盖有限 | 该厂商官方 SDK 或 Spring AI 原生 starter |
| **强实时低延迟**主链路（如高频交易撮合） | 模型推理本身有秒级延迟 | 把 AI 放异步旁路，主链路别依赖它 |
| 团队**完全没有 Spring / Java 基础** | 学习曲线叠加 | 先用 Python 生态快速验证想法 |

### 8.2 合适的场景（对照着看）

- 已有 Spring Boot 业务系统，想给它能"调接口、查库、办事"的 AI 助手 ✅
- 需要可控、可观测、可上线的多步骤工作流 ✅
- 要对接阿里云百炼 / 通义 / 百炼平台 / Nacos ✅
- 团队是 Java 技术栈，希望 AI 能力和现有工程规范（依赖注入、配置中心、可观测）一脉相承 ✅

::: danger 选型红绿灯
**别为了"用 Agent 而用 Agent"。** 如果业务只是"把用户问题转给模型答一下"，一个 `ChatClient` 就够了，上 ReactAgent 是杀鸡用牛刀。只有当你确实需要"模型自主决定调哪些工具、循环推理直到任务完成"时，SAA 的 Agent 能力才真正派上用场。
:::

### 8.3 选型决策口诀

记不住上面大段分析时，用这三句就够了：

- **Java/Spring 主系统 + 要接 AI** → 用 SAA（本专栏主场）。
- **Python 优先 / 研究型 Agent 范式** → 看 AgentScope / LangChain。
- **只是调一次模型、或要训练模型** → 别上 SAA，用裸 HTTP 或算法平台。

## 九、升级迁移注意事项

真要升级版本，按下面清单走，能避开大部分坑。

1. **先查官方对照表**：确认目标 SAA 版本对应的 Spring AI / Spring Boot 版本（见第四节），三者一起升。
2. **改 `pom.xml` 的 `<properties>` 即可**，不要手动去改各依赖的 `<version>`（交给 BOM）。
3. **跑 `mvn dependency:tree`** 确认没有混入旧版本的 `spring-ai-core` 或 `spring-ai-alibaba-*`，有就清理掉手写的版本号。
4. **API 漂移检查**：SAA 演进极快，`ReactAgent.builder()` 的方法名、`@Tool` 的注解参数、`MemorySaver` 的包路径都可能随版本变化。升级后重点回归：
   - Agent 能否正常 build（`ReactAgent.builder()...build()`）
   - 工具是否还能被识别（`@Tool` 方法是否被扫描）
   - 多轮记忆是否还生效（`MemorySaver` / `RunnableConfig.threadId`）
5. **看官方 Release Notes / Migration Guide**：每个 minor 版本通常附带迁移说明，优先读它而不是猜。
6. **灰度发布**：Agent 行为对模型+框架版本敏感，升级后先在测试环境用真实语料回归，再上生产。

::: warning 关于 API 准确性
SAA 的 API 变化很快。**本文给出的 `ReactAgent.builder()`、`@Tool`、`MethodToolCallbackProvider`、`MemorySaver` 等写法基于 SAA 1.1.2.0 验证**。当你使用其他版本时，若发现类名/方法名对不上，**以你所用版本的官方文档为准**：
- 官网：<https://java2ai.com/>
- 源码与示例：<https://github.com/alibaba/spring-ai-alibaba>
- 关键类搜索路径：`com.alibaba.cloud.ai.graph.agent`（Agent）、`com.alibaba.cloud.ai.graph`（Graph）、`com.alibaba.cloud.ai.dashscope`（模型）
:::

## 本篇小结

- **SAA 是 Spring AI 的上层扩展**：原子能力（ChatModel/Tool/VectorStore）全部来自上游 Spring AI，SAA 只增量提供 Agent 框架、Graph 运行时、上下文工程与阿里云集成。
- **两个核心依赖**：`spring-ai-alibaba-agent-framework` + `spring-ai-alibaba-starter-dashscope` 覆盖绝大多数场景；graph 模块可在需要精细编排时单独引入。
- **版本铁三角**：SAA 1.1.2.0 ↔ Spring AI 1.1.2 ↔ Spring Boot 3.5.x，**三者必须捆绑对齐**，靠两个 BOM 统一管版本。
- **边界清晰**：AgentScope 是阿里 Python 侧的高阶 Agent 框架，与 SAA"场景分治"而非替代；SAA 在 JVM 上等价于"LangChain + LangGraph"。
- **别滥用**：纯问答用 `ChatClient` 就够了，只有需要"自主调工具、循环推理"才上 ReactAgent；训练模型、Python 优先、强实时主链路都不适合 SAA。
- **升级看对照表、改 properties、跑 dependency:tree、读迁移指南、灰度回归**。

## 参考链接

- Spring AI Alibaba 官网：<https://java2ai.com/>
- Spring AI Alibaba GitHub：<https://github.com/alibaba/spring-ai-alibaba>
- AgentScope（Python 高阶 Agent 框架）：<https://github.com/modelscope/agentscope>
- Spring AI 官方文档：<https://docs.spring.io/spring-ai/reference/>
- 阿里云百炼控制台：<https://bailian.console.aliyun.com/>

下一篇 → [10 ReactAgent](/java/saa/reactagent)
