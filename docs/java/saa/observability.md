# 21 可观测性与评估

> 看不见 Agent 在想什么，就不敢把它放到线上。传统应用我们盯 QPS 和耗时就行，但 AI 应用是"非确定性"的——同样的问题，两次回答可能不一样；回答错了不是代码 bug，而是模型"发挥失常"。这一章我们解决：怎么把一次 AI 调用的"前因后果"完整记录下来，以及怎么用工程化的手段评估它到底靠不靠谱。

## 本篇要解决的问题

- 为什么 AI 应用的监控和传统系统完全不同
- AI 应用到底要采集哪些指标才算"看得见"
- 怎么用 Micrometer + OpenTelemetry 把埋点做进去
- 一次请求里"对话 → 调工具 → 查知识库"各段耗时怎么串成一条 Trace
- 怎么把数据接到 Langfuse / 阿里云 ARMS 这类平台
- AI 应用怎么做评测（为什么单测测不了、怎么构建评测集、LLM-as-Judge）
- 成本怎么监控、阈值怎么定

::: warning 本篇的 API 基线
本篇代码基于 **Spring AI 1.1.2 + Spring AI Alibaba 1.1.2.0**。可观测性相关的配置项（尤其是"是否记录 prompt/completion 内容"的属性名）在不同小版本之间可能调整，**具体属性名以你所用版本的官方文档为准**。本篇给出的是经过验证可行的思路，落地前请对照官方文档核对一遍属性名。

参考文档：<https://docs.spring.io/spring-ai/reference/1.1/observability/index.html>
:::

## 一、为什么 AI 应用的观测和传统应用不一样

### 1.1 一个比喻：传统系统像红绿灯，AI 系统像天气预报

传统应用是**确定性的**：同样的输入、同样的代码，输出永远一样。你监控它，本质是监控"机器有没有按预期运转"——QPS 掉下来说明扛不住了，某接口耗时变长说明有慢 SQL，错误率升高说明有 bug。

AI 应用是**非确定性的**：你问"今天适合出门吗"，模型可能因为随机性、上下文不同、甚至它"心情"（temperature）不一样，给出完全不同的回答。所以仅仅看"接口有没有 500 错误"完全不够——**接口返回 200，但回答是胡说八道，这对业务来说同样是事故。**

这就是 AI 可观测性的核心差异：

| 维度 | 传统应用监控 | AI 应用监控 |
| --- | --- | --- |
| 关注点 | 机器是否正常运转 | 模型"这次答得对不对" |
| 关键指标 | QPS、耗时、错误率、CPU | 延迟、**Token 成本**、失败率、**工具调用次数**、**检索命中率**、回答质量 |
| 排查对象 | 堆栈、慢查询、线程池 | **prompt 原文、模型返回原文、工具调用入参出参、RAG 召回的上下文** |
| 能否单测 | 能（断言返回值） | 不能（没有唯一正确值） |

### 1.2 你必须额外记录的三类"AI 特有"信息

传统监控里没有、但 AI 应用里**缺一不可**的三样东西：

1. **Prompt 与 Completion 原文**：回答翻车了，你要能回放"当时到底喂给模型什么、模型回了什么"。没有原文你连怎么复现都不知道。
2. **工具调用链路**：模型这次调了哪些工具、传了什么参数、拿到什么结果。Agent "卡住"或"瞎调工具"是最高频的线上问题。
3. **Token 成本**：AI 的账单是按 Token 算的，而且每个用户、每个接口的成本差异巨大。不做成本监控，月底可能收到一张惊掉下巴的发票。

::: tip 一句话记住
传统监控回答"系统还活着吗"，AI 监控还要回答"它这次**想对了吗**、**花了多少钱**"。
:::

## 二、AI 应用要采集哪些指标

下面这张表是本篇建议的"最小可观测指标集"，覆盖到就能避免绝大多数线上事故。

| 指标 | 含义 | 为什么重要 | 数据来源 |
| --- | --- | --- | --- |
| **延迟（Latency）** | 单次调用 / 整条链路耗时 | AI 调用天然慢，P95/P99 比平均值更有意义 | Micrometer Timer |
| **Token 用量** | 输入/输出/合计 Token | 直接对应账单，也是上下文长度的晴雨表 | Spring AI 自动埋点 `gen_ai_client_token_usage_total` |
| **成本（Cost）** | 按单价折算的人民币 | 把 Token 换算成钱，业务方才看得懂 | 自己用单价 × Token 算 |
| **失败率** | 调用报错 / 超时比例 | 区分"系统挂了"和"模型拒答" | 异常捕获 + 计数器 |
| **工具调用次数** | 一次问答里模型调了几次工具 | 工具循环调用失控是 Agent 经典事故 | 在 Tool 执行处埋点 |
| **检索命中率** | RAG 召回的文档是否相关 | 召回不到=答非所问，是 RAG 体验差的主因 | 评测 + 记录召回数量 |
| **模型/链路健康** | 上游限流、鉴权失败 | 百炼有 QPS 配额，被打满就整体不可用 | 错误码分类统计 |

::: warning 别只盯着平均值
AI 调用的延迟分布极不均匀：简单问答 1 秒，涉及多轮工具调用的 Agent 可能 30 秒。只看平均延迟会把"慢请求"埋没。**至少看 P95 和 P99**，并给整条链路设一个"超时熔断"阈值（例如单次 Agent 调用超过 60 秒直接失败兜底）。
:::

## 三、Micrometer + OpenTelemetry 埋点

### 3.1 比喻：埋点就像给每次调用装行车记录仪

你在车里装行车记录仪，不是为了好看，是为了**出了事能回放**。Micrometer 是 Spring 生态的"仪表盘标准接口"，它定义了一堆"仪表"（计时器、计数器），但具体数据往哪送（Prometheus？OpenTelemetry？）由"仪表后端"决定。OpenTelemetry（简称 OTel）是当前事实标准的"遥测数据协议"，它负责把 Trace（链路）和 Metric（指标）统一送到各种平台。

Spring AI 已经**内置了观测埋点**：只要你把 OTel 相关的依赖放到 classpath 上，每次 `ChatClient` 调用、每次向量库检索，框架都会自动生成 Observation（观测点），你什么都不用写就能拿到指标。

### 3.2 依赖：只加这两个，自动观测就生效

`pom.xml` 片段（其余 Spring Boot / SAA 依赖见第 02 章，这里只列观测专属依赖）：

```xml
<dependencies>
    <!-- 1) Micrometer 的 OTel 桥接：让框架的 Observation 能用 OpenTelemetry 协议导出 -->
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-tracing-bridge-otel</artifactId>
    </dependency>

    <!-- 2) OTel 的 OTLP 导出器：把数据通过 HTTP 发给 OTel Collector / 各平台 -->
    <dependency>
        <groupId>io.opentelemetry</groupId>
        <artifactId>opentelemetry-exporter-otlp</artifactId>
    </dependency>

    <!-- 3)（可选）Micrometer 的 Prometheus 注册表，用于把指标暴露给 Prometheus 抓取 -->
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-registry-prometheus</artifactId>
    </dependency>
</dependencies>
```

::: tip 为什么不需要写埋点代码
Spring AI 在 `ChatModel`、`ChatClient`、`EmbeddingModel`、`VectorStore` 内部已经通过 Micrometer 的 Observation API 埋好了点。只要 classpath 上存在 OTel 桥接，Spring Boot 的自动配置就会把这些 Observation 导出出去。这就是"约定优于配置"——**没写一行埋点，指标已经在产生了**。
:::

### 3.3 自动产生的指标（对照 Prometheus 时间序列名）

Spring AI 自动发出的指标遵循 OpenTelemetry 的生成式 AI 语义约定（GenAI Semantic Conventions），在 Prometheus 里会变成下面这些时间序列：

| 基础指标名 | 类型 | 含义 |
| --- | --- | --- |
| `gen_ai_client_operation_seconds_*` | Timer | 模型调用耗时（sum/count/max/active） |
| `gen_ai_chat_client_operation_seconds_*` | Timer | `ChatClient` 层（call/stream）耗时 |
| `gen_ai_client_token_usage_total` | Counter | **Token 总消耗**，按 `gen_ai_token_type`（input/output/total）分标签 |
| `db_vector_client_operation_seconds_*` | Timer | 向量库操作（add/delete/query）耗时 |
| `db_vector_client_operation_seconds_count` | Counter | 向量库操作次数，标签含 `db_operation_name`（add/delete/query） |

**关键用法**：成本监控就是盯 `gen_ai_client_token_usage_total` 这个计数器，按 `gen_ai_token_type=total` 累加，再乘以单价，就能画出"每天/每用户花了多少钱"的曲线。

### 3.4 让 Prompt / Completion 原文也进 Trace（关键）

默认情况下，为了性能和隐私，Spring AI **不会**把 prompt 和 completion 的全文写进观测数据。但在调试阶段，没有原文你根本没法排查"为什么答错了"。Spring AI 提供了一个 ObservationFilter 钩子，注册它之后原文就会作为 span 的高基数属性（如 `gen_ai.prompt`、`gen_ai.completion`）导出。

`src/main/java/com/example/saa/observability/ChatContentObservationFilter.java`

```java
package com.example.saa.observability;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationFilter;
import org.springframework.ai.chat.observation.ChatModelObservationContext;
import org.springframework.stereotype.Component;

/**
 * 把每次模型调用的 prompt 和 completion 原文写进观测 span。
 *
 * 为什么需要它：默认 Spring AI 只记录模型名、token 数等"概要"信息，
 * 不记录你到底喂了什么、模型回了什么。调试"答非所问""幻觉"时，
 * 没有原文你连怎么复现都不知道。
 *
 * 注意：生产环境建议只针对特定环境（如 dev/test）开启，或者在落盘前做脱敏，
 * 因为 prompt 里可能包含用户隐私或公司机密。
 */
@Component
public class ChatContentObservationFilter implements ObservationFilter {

    @Override
    public Observation.Context map(Observation.Context context) {
        // 只处理 ChatModel 的观测上下文，向量库、Embedding 的上下文原样放过
        if (!(context instanceof ChatModelObservationContext chatContext)) {
            return context;
        }

        // 把用户指令拼接成一段文本，作为 span 属性 gen_ai.prompt 导出
        StringBuilder prompt = new StringBuilder();
        chatContext.getRequest().getInstructions().forEach(message ->
                prompt.append(message.getText()).append("\n"));
        context.put("gen_ai.prompt", prompt.toString());

        // 把模型返回拼接，作为 span 属性 gen_ai.completion 导出
        StringBuilder completion = new StringBuilder();
        chatContext.getResponse().getResults().forEach(result ->
                completion.append(result.getOutput().getText()).append("\n"));
        if (completion.length() > 0) {
            context.put("gen_ai.completion", completion.toString());
        }

        return context;
    }
}
```

::: danger 隐私红线
Prompt 和 Completion 里经常包含**用户身份证号、手机号、公司内部文档**等敏感信息。把它们原样写进 Trace 平台，等于把机密广播给了所有能看监控的人。**生产环境务必**：
1. 只在 dev/test 开启上面的 Filter；
2. 或对原文做脱敏（正则替换手机号、身份证）；
3. 或只记录 token 数和"是否调用了工具"这类概要，不记录全文。
:::

### 3.5 手动埋点：给 Agent 整条链路包一层业务级 Observation

框架自动埋的只是"单次模型调用"级别。一个 Agent 可能调了 5 次模型 + 3 次工具，你想把**整次问答**作为一条父 span，下面挂这些子 span，就需要自己包一层。

`src/main/java/com/example/saa/observability/AgentObserveService.java`

```java
package com.example.saa.observability;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationRegistry;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 演示如何用 ObservationRegistry 把"一次完整的 Agent 问答"包成父 span。
 *
 * 为什么手动包：框架自动的 Observation 粒度是"单次模型调用"，
 * 但排障时你更关心"用户这一次提问的整体耗时和成败"。
 * 包一层父 span 后，下面所有子调用（模型、工具、RAG）都会自动挂到它下面，
 * 在 Trace 平台里就是一棵漂亮的调用树。
 */
@Service
public class AgentObserveService {

    private final ChatClient chatClient;
    private final ObservationRegistry registry;

    public AgentObserveService(ChatClient.Builder builder, ObservationRegistry registry) {
        this.chatClient = builder.build();
        this.registry = registry;
    }

    /**
     * 用 Observation 包裹一次业务调用。
     *
     * @param userQuestion 用户问题（作为 span 名的一部分，便于检索）
     * @param userId       用户 ID（作为低基数标签，便于按用户聚合成本）
     */
    public String askWithObservation(String userQuestion, String userId) {
        // 创建一个名为 "agent.chat" 的 Observation（即 span）
        Observation observation = Observation.createNotStarted("agent.chat", registry)
                // 低基数标签：值固定几个，适合做指标聚合维度
                .lowCardinalityKeyValue("ai.operation", "agent-chat")
                .lowCardinalityKeyValue("ai.user.id", userId)
                // 高基数标签：值动态变化，只适合做 span 属性，不适合做指标维度
                .highCardinalityKeyValue("ai.question", userQuestion)
                .start();

        // try-with-resources：scope 内创建的所有子 Observation 都会挂到当前 span 下
        try (Observation.Scope scope = observation.openScope()) {
            String answer = chatClient.prompt()
                    .user(userQuestion)
                    .call()
                    .content();
            // 成功时记录结果长度，便于事后判断是否有空回答
            observation.highCardinalityKeyValue("ai.answer.length", String.valueOf(answer.length()));
            return answer;
        } catch (Exception e) {
            // 失败时把异常标记到 span 上，Trace 平台会标红
            observation.error(e);
            throw e;
        } finally {
            // 必须 stop，否则 span 永远不会结束、数据不导出
            observation.stop();
        }
    }
}
```

`application.yml` 里打开采样与导出（把数据发到 OTel Collector，再由其转发到各平台）：

```yaml
management:
  # 把指标暴露给 Prometheus 抓取
  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
  # 把 Observation（Trace）通过 OTLP 协议导出
  tracing:
    sampling:
      probability: 1.0   # 开发期全采样；生产可降到 0.1（10%）
  otlp:
    tracing:
      # OTel Collector 的地址；直接发给 Langfuse/ARMS 时换成它们的 OTLP 端点
      endpoint: http://localhost:4318
```

## 四、Trace 链路追踪：一次请求里 Chat → Tool → RAG 各段耗时怎么串起来

### 4.1 概念：Span 像俄罗斯套娃

Trace（链路）是由一个个 **Span（跨度）** 组成的树。一次用户提问产生一条 Trace：

```text
Trace: 用户问"我们公司的年假政策是什么"
└─ Span: agent.chat（父，你手动包的，总耗时 8.2s）
   ├─ Span: chat（第 1 次模型调用：让模型判断是否要查知识库，0.9s）
   ├─ Span: db.vector.query（RAG 检索，命中 3 篇文档，0.3s）   ← 向量库
   ├─ Span: chat（第 2 次模型调用：带着上下文生成回答，1.1s）
   └─ Span: tool（模型决定调"查 hr 系统"工具，2.4s）           ← 工具调用
      └─ Span: http（工具内部真正打 hr 系统的 HTTP 调用，2.2s）
```

父 Span 的总耗时 = 所有子 Span 之和。这样你一眼就能看出：**这次回答慢，瓶颈在"查 hr 系统"那个工具**，而不是模型本身。这正是 Trace 比单纯看"接口耗时"强的地方。

### 4.2 链路是自动串起来的

你**不需要手动去"连接"这些 Span**。只要都在同一个线程、同一个 Observation scope 内，或者用同一个 Trace Context 传播，Micrometer + OTel 会自动建立父子关系：

- 框架自动的 `chat`、`db.vector.query`、`tool` 这些 Span 自带父子关系；
- 你在 3.5 节手动包的 `agent.chat` 作为父 Span，只要在它的 `openScope()` 范围内发生上述调用，子 Span 就自动挂上来；
- 跨线程/跨服务时（比如 Agent 把任务丢给另一个线程池），需要保证 Trace Context 被传播（Spring 的 `ObservationThreadLocal` / `TransmittableThreadLocal` 相关机制），否则链路会断。

::: tip 排查 Agent "卡住"的实战套路
线上 Agent 回答很慢或答非所问，第一时间去 Trace 平台搜这条 Trace，看：
1. 是 `chat` 慢（模型侧，可能限流）还是 `tool` 慢（你的业务接口慢）；
2. `tool` 调用了几次——如果同一个工具被反复调用，八成是"工具循环" bug；
3. `db.vector.query` 命中几条——命中 0 条说明 RAG 召回失败（见第 24 章排查清单）。
:::

## 五、接入 Langfuse（选其一给完整配置）

Langfuse 是开源的 LLM 应用观测/评测平台，对 Spring AI 友好。它本质上就是一个"OTel 后端"——你把 Trace 数据用 OTLP 发给它即可。

### 5.1 依赖

沿用第三节的 `micrometer-tracing-bridge-otel` + `opentelemetry-exporter-otlp` 即可，不需要额外依赖。

### 5.2 配置：把数据发到 Langfuse

最简单的方式是用环境变量（部署时不改代码）：

```bash
# Langfuse 的 OTLP 接收端点（云版；自托管换成你的地址）
export OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel"
# 认证：Basic 后面跟 base64(publicKey:secretKey)
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n 'pk-lf-xxx:sk-lf-xxx' | base64)"
# 服务名，在 Langfuse 里作为项目/服务标识
export OTEL_SERVICE_NAME="canoe-saa-demo"
```

等价地也可以用 `application.yml` 的 `management.otlp.tracing.endpoint` 配置（注意 endpoint 在部分版本需带 `/v1/traces` 后缀，以 Langfuse 文档为准）：

```yaml
management:
  otlp:
    tracing:
      endpoint: "https://cloud.langfuse.com/api/public/otel/v1/traces"
      headers:
        Authorization: "Basic YOUR_BASE64_KEY"
  tracing:
    sampling:
      probability: 1.0
```

### 5.3 让 Langfuse 显示 Input / Output

接入后常遇到一个坑：**Trace 有了，但 Input / Output 窗口是空的**。原因是 Spring AI 默认不把 prompt/completion 全文写进 span 属性，而 Langfuse 依赖特定属性键来填充输入框。解决办法就是第三节那个 `ChatContentObservationFilter`——注册它之后 `gen_ai.prompt` / `gen_ai.completion` 就会出现，Langfuse 才能渲染出来。

### 5.4 关联用户和会话

在 Langfuse 里按用户看成本、按会话看对话，需要给根 Span 打上 Langfuse 专用属性：

`src/main/java/com/example/saa/observability/LangfuseTraceService.java`

```java
package com.example.saa.observability;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationRegistry;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 演示在根 Span 上设置 Langfuse 专用的 user.id / session.id 属性。
 *
 * 为什么单独做：Langfuse 用 gen_ai 之外的私有属性 langfuse.user.id / langfuse.session.id
 * 来聚合"按用户""按会话"的 Trace。这些属性最好设置在最外层的根 Span 上，
 * 这样它所有的子 Span 都能继承归属关系。
 */
@Service
public class LangfuseTraceService {

    private final ChatClient chatClient;
    private final ObservationRegistry registry;

    public LangfuseTraceService(ChatClient.Builder builder, ObservationRegistry registry) {
        this.chatClient = builder.build();
        this.registry = registry;
    }

    public String chat(String userInput, String userId) {
        String sessionId = UUID.randomUUID().toString();
        Observation root = Observation.createNotStarted("langfuse.root", registry)
                // Langfuse 识别的私有属性键，用于按用户/会话聚合
                .lowCardinalityKeyValue("langfuse.user.id", userId)
                .lowCardinalityKeyValue("langfuse.session.id", sessionId)
                .start();
        try (Observation.Scope scope = root.openScope()) {
            return chatClient.prompt().user(userInput).call().content();
        } finally {
            root.stop();
        }
    }
}
```

::: warning 别混用多个 Tracer 实现
同时引入 Brave 和 OTel 两套 tracing 桥接，会导致 Span 冲突、数据错乱。**只选一套**——本篇全部基于 OTel，保持依赖干净。
:::

## 六、接入阿里云 ARMS

ARMS 是阿里云的监控服务，同样支持 OpenTelemetry 协议，可以和百炼（DashScope）同生态打通。

### 6.1 两种接入方式

| 方式 | 适合 | 做法 |
| --- | --- | --- |
| **OTLP 直连** | 已有 Spring AI 应用，想快速接 | 把 5.2 里的 endpoint/header 换成 ARMS 提供的 OTLP 接入点 |
| **ARMS Java Agent** | 不想改代码、想监控整个 JVM | 挂载 ARMS 探针（`-javaagent`），自动采集，再在 ARMS 控制台开启 GenAI 相关大盘 |

### 6.2 OTLP 直连配置示例

ARMS 控制台会给你一个专属的 OTLP 接入点和鉴权头，填入即可：

```yaml
management:
  otlp:
    tracing:
      # 替换为 ARMS 控制台提供的接入点（示例为占位，实际以控制台为准）
      endpoint: "https://arms-otlp-access-point.aliyuncs.com:8090"
      headers:
        # ARMS 的鉴权头，具体键名以 ARMS 文档为准
        Authentication: "您的ARMS鉴权信息"
  tracing:
    sampling:
      probability: 1.0
```

::: tip 平台选型的建议
- **个人 / 小团队 / 想白嫖开源**：Langfuse 自托管或云版，对 LLM 场景的指标（Token、成本）开箱即用。
- **已经在用阿里云全家桶（百炼 + ARMS）**：直接用 ARMS，权限、账单、告警都在一个控制台，省心。
- **大公司已有 Prometheus + Grafana**：只用 `micrometer-registry-prometheus` 暴露指标，自己画大盘，不引入新平台。
:::

## 七、AI 应用怎么评测

### 7.1 为什么"准确率"不能用单测来测

写后端时你能写 `assertEquals(expected, actual)`。但 AI 回答**没有唯一正确答案**：问"推荐三道家常菜"，模型回"番茄炒蛋、青椒肉丝、红烧肉"和"可乐鸡翅、麻婆豆腐、清蒸鱼"都是对的，你没法断言必须等于某串字符串。

所以 AI 评测的核心是：**用"评分"代替"断言"**。而谁来评分？两条路：

| 方式 | 怎么做 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **人工打分** | 人看回答，判好坏 | 最准 | 慢、贵、没法高频跑 |
| **LLM-as-Judge** | 再调一次模型，让它当裁判打分 | 快、便宜、可进 CI | 裁判本身也可能错，需要校准 |

### 7.2 构建最小评测集

不要一上来就搞大而全的评测平台，**先建一个"黄金集"（golden set）**：

1. 挑 **20~50 条** 能代表真实用户的问题（覆盖正常、边界、恶意三类）。
2. 每条附上"期望的行为"——不一定是一字不差的答案，而是**判定标准**（例如"必须引用第 3 章内容""不能编造政策日期"）。
3. 把这套集子放进 `src/test/resources` 当测试夹具。

### 7.3 Spring AI 自带的评测器（Evaluator）

Spring AI 把"评测"抽象成一个接口 `Evaluator`，并且**内置了两个开箱即用的实现**，都基于 LLM-as-Judge，不需要额外依赖（它们就在 chat 模型的 starter 里）。

`src/test/java/com/example/saa/eval/RelevancyTest.java`

```java
package com.example.saa.eval;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.evaluation.EvaluationRequest;
import org.springframework.ai.evaluation.EvaluationResponse;
import org.springframework.ai.evaluation.FactCheckingEvaluator;
import org.springframework.ai.evaluation.RelevancyEvaluator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 用 Spring AI 内置评测器做 RAG 回归测试。
 *
 * 关键认知：评测器本身也是一次 LLM 调用（LLM-as-Judge），
 * 所以它会额外花时间和钱。建议放在独立的 CI 阶段跑，而不是每次单测都跑。
 */
@SpringBootTest
public class RelevancyTest {

    @Autowired
    private ChatModel chatModel;

    /**
     * RelevancyEvaluator：判断"回答是否贴着问题和上下文"。
     * 适合检测：召回到了文档，但模型答非所问、东拉西扯。
     */
    @Test
    void ragAnswerShouldBeRelevant() {
        // 1) 这里简化：假设你已经跑完 RAG，拿到回答和相关上下文
        String question = "我们公司的年假政策是怎样的？";
        List<String> context = List.of(
                "根据员工手册第 3 章，正式员工入职满 1 年享有 5 天年假，满 3 年 10 天。");
        String answer = "正式员工入职满 1 年有 5 天年假，满 3 年有 10 天。";

        // 2) 构造评测请求：参数顺序是 (用户问题, 上下文列表, 模型回答)
        EvaluationRequest request = new EvaluationRequest(question, context, answer);

        // 3) 评测模型可以和生成模型不同：评测追求稳定低成本，可用 qwen-turbo
        RelevancyEvaluator evaluator =
                new RelevancyEvaluator(ChatClient.builder(chatModel));

        EvaluationResponse response = evaluator.evaluate(request);
        // isPass() 是评委模型判的 YES/NO
        assertTrue(response.isPass(), "回答应当与本问题和上下文相关");
    }

    /**
     * FactCheckingEvaluator：判断"回答里的陈述是否被上下文支持"。
     * 适合检测：幻觉——模型一本正经编造上下文里没有的事实。
     */
    @Test
    void hallucinationShouldFail() {
        String context = "正式员工入职满 1 年享有 5 天年假。";
        // 这句明显和上下文矛盾，应当判不通过
        String claim = "正式员工入职满 1 年享有 30 天年假。";

        EvaluationRequest request = new EvaluationRequest(context, List.of(), claim);
        FactCheckingEvaluator evaluator =
                new FactCheckingEvaluator(ChatClient.builder(chatModel));

        EvaluationResponse response = evaluator.evaluate(request);
        assertFalse(response.isPass(), "与上下文矛盾的陈述不应通过事实核查");
    }
}
```

**要点**：

- `EvaluationRequest` 构造函数参数顺序固定为 `(userText, dataList, responseContent)`——上下文放第二位。
- 两个评测器内部都用自己的 prompt 模板问评委模型 YES/NO。`RelevancyEvaluator` 的模板必须包含 `query`、`response`、`context` 三个占位符，你可以用 `.promptTemplate(...)` 自定义更严格的判定标准。
- 评测消耗的是**另一次**模型调用，建议：生成用 `qwen-plus`，评测用更便宜的 `qwen-turbo`。

### 7.4 回归测试怎么跑

把评测接进 CI 的"质量闸门"：

```text
代码合并 → 单元测试（Java 逻辑）→ 集成测试（接口通不通）
                            ↓
               AI 评测阶段（用黄金集跑 Relevancy/FactChecking）
                            ↓
       任一关键用例 isPass()==false → 阻断合并 + 钉钉告警
```

落地清单：

1. 先做 2 条最小闭环：1 条正常场景（应 Pass）、1 条故意错误场景（应 Fail），验证评测器本身没问题。
2. **生成模型与评测模型分离**：评测追求稳定低成本。
3. 评测失败时，把 `query / response / context` 打印到测试日志，CI 报错时一眼看出"哪段上下文没召回 / 哪句话在胡说"。
4. 评测套件作为**独立 CI 阶段**运行，不要和每次单测混在一起（避免每次提交都烧钱）。

## 八、成本监控与告警阈值建议

成本失控是 AI 应用最痛的线上问题之一。下面给出一套可直接套用的监控+告警基线（数字按 `qwen-plus` 量级估算，请按你的实际单价和体量调整）：

| 监控项 | 建议阈值（示例） | 触发动作 |
| --- | --- | --- |
| 单用户日 Token 消耗 | 超过 50 万 tokens | 告警 + 限流该用户 |
| 单次请求 Token | 超过 8000 tokens | 记录日志，检查是否上下文未压缩 |
| 单接口日均成本 | 环比增长 > 50% | 排查是否有异常调用 |
| Agent 单轮工具调用次数 | 超过 10 次 | 告警，疑似工具循环 bug |
| 整条链路 P99 延迟 | 超过 30 秒 | 告警，检查限流/慢工具 |
| 失败率 | 超过 5% | 立即告警，检查 Key/配额/网络 |

::: tip 三条最省钱的工程手段（已在前面章节展开）
1. 给 `max_tokens` 设上限，防止单次生成失控（第 02 章）。
2. 用 `MessageWindowChatMemory` 控制历史长度，或做上下文压缩（第 12 章）。
3. 记录每次调用的 Token（本篇的 `gen_ai_client_token_usage_total`），有数据才知道钱花在哪。
:::

::: warning 告警要分级
成本告警别一上来就"封号"——可能只是运营在做批处理。建议：**轻度超限发通知 → 持续超限限流 → 极端超限熔断**。另外给 API Key 设置**额度上限**（百炼控制台可配），就算代码忘了限流，账单也不会无限涨。
:::

## 本篇小结

- **AI 应用和传统应用监控的根本差异**：非确定性，所以除了延迟/错误率，还必须记录 **prompt/completion 原文、工具调用链路、Token 成本、检索命中率**。
- **Spring AI 内置观测埋点**：只要加 `micrometer-tracing-bridge-otel` + `opentelemetry-exporter-otlp`，`ChatClient`、向量库的指标（`gen_ai_*`、`db_vector_*`）自动产生。
- **Trace 自动串成树**：父 Span 包"一次问答"，子 Span 自动挂"每次模型调用 / RAG 检索 / 工具调用"，瓶颈一目了然。
- **平台接入二选一**：Langfuse（开源友好，OTLP 直连）或阿里云 ARMS（同生态）。写 `ChatContentObservationFilter` 才能让 Input/Output 显示出来。
- **评测代替断言**：用 `RelevancyEvaluator` / `FactCheckingEvaluator`（LLM-as-Judge）做回归测试，接进 CI 当质量闸门。
- **成本监控是红线**：盯 Token 计数器 + 分级告警 + Key 额度上限。

## 参考链接

- Spring AI 可观测性文档：<https://docs.spring.io/spring-ai/reference/1.1/observability/index.html>
- Spring AI Evaluation 文档：<https://docs.spring.io/spring-ai/reference/1.1/api/testing.html>
- Langfuse + Spring AI 接入：<https://langfuse.com/docs/integrations/frameworks/spring-ai>
- 阿里云 ARMS 文档：<https://help.aliyun.com/zh/arms/>
- Spring AI Alibaba 官网：<https://java2ai.com/>
- Spring AI Alibaba GitHub：<https://github.com/alibaba/spring-ai-alibaba>

下一篇 → [22 Studio 与 Admin](/java/saa/studio-admin)
