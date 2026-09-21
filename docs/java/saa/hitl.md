# 13 人机协同 HITL

> 在高风险环节把人类拉回决策环路，让 Agent 敢于落地到生产。HITL（Human-in-the-Loop，人在回路）不是"弹个确认框"那么简单，它是一套"中断—保存—人工决策—恢复"的工程机制。

::: tip 本章的承诺
这一章你将领到一套**能直接跑的审批流代码**：敏感操作被拦截 → 生成审批单存入数据库 → 人工在后台通过 → Agent 从断点继续跑完。覆盖提交、查询待办、审批通过、继续的完整 curl 链路，以及超时降级、前端怎么接、三个最常见的坑（状态丢失 / 幂等 / 并发）。
:::

## 本篇要解决的问题

- 为什么 Agent 不能"完全自主"？哪些事必须有人拍板？
- 人工介入有哪三种时机？分别在流程的什么位置插人？
- 框架是怎么"暂停并恢复"的？（Graph 中断点 + 状态保存 + 用户回复后续跑）
- 一个生产可用的审批流长什么样？从拦截到继续的完整代码与 curl 链路。
- 超时、降级、幂等、并发这些坑怎么填？

::: warning 版本说明
本章核心 API（类、包、builder 方法）依据 Spring AI Alibaba **1.1.2.0** 官方文档与源码核实。HITL 主要由 `HumanInTheLoopHook` 实现，底层依赖 Graph 的 `InterruptableAction` / `InterruptionMetadata` / `CheckpointSaver`。该能力在 1.1.x 已稳定，但**恢复时的元数据 key、FeedbackResult 枚举位置**等细节仍建议对照你所用版本确认，查找路径：包 `com.alibaba.cloud.ai.graph.agent.hook.hip`（Hook）与 `com.alibaba.cloud.ai.graph.action`（中断元信息）。
:::

## 一、为什么 Agent 必须有人工介入

Agent 自主循环很酷，但有三类事它**绝对不该自己拍板**：

| 类别 | 例子 | 为什么必须人介入 |
| --- | --- | --- |
| **不可逆操作** | 退款、发短信/邮件、删库、转账 | 做错了无法撤销，且直接产生资损或骚扰用户 |
| **合规要求** | 医疗/金融建议、合同生成、对外发文 | 行业监管强制"人审"，AI 不能独立担责 |
| **模型拿不准** | 意图模糊、高金额、冲突信息 | 模型可能幻觉，把"大概率对"当成"一定对" |

::: danger 没有 HITL 的真实事故
某 Agent 被问"帮我把这笔订单退款"，它直接调了退款工具。实际上用户说的是"帮我**查一下**能不能退款"。没有人工拦截 = 一笔不该退的款被退了，还无法单方面撤销。这就是为什么"写工具前先等人确认"是生产底线。
:::

核心思想：**让 Agent 自由思考，但在"动手"前把刹车交给人**。框架的做法是——模型生成了工具调用、但**执行工具之前**，Hook 把流程暂停，等人决策（批准 / 修改 / 拒绝）后再继续。

## 二、三种介入时机

```text
用户意图 ──→ 模型思考 ──→ [①执行前审批] ──→ 执行工具 ──→ [②执行中确认] ──→ 拿到结果 ──→ [③执行后修正] ──→ 最终回答
```

| 时机 | 位置 | 适合 | 框架手段 |
| --- | --- | --- | --- |
| **执行前审批** | 模型决定调工具，但还没执行 | 不可逆 / 高风险（退款、发消息） | `HumanInTheLoopHook.approvalOn(...)` |
| **执行中确认** | 工具已执行，关键中间结果出来后 | 长任务每步需人确认（如研究报告逐节） | Graph `interruptAfter` / `InterruptableAction` |
| **执行后修正** | 模型产出最终回答，对外发布前 | 对外发文、合同、给客户的邮件 | 输出审核 Interceptor / 人工复核节点 |

本章重点讲**执行前审批**（最常用、最救命），其余两种给出机制说明。

## 三、打断与恢复机制：Graph 是怎么暂停并续跑的

理解这套机制，你才不会把 HITL 当成"弹窗"：

1. **中断点**：`HumanInTheLoopHook` 在"模型生成工具调用之后、工具执行之前"检查每个工具调用，命中 `approvalOn` 配置的策略就触发中断。
2. **状态保存**：触发中断的瞬间，框架把当前 `OverAllState`（对话、计划、上下文）通过 `CheckpointSaver` 落盘（开发用 `MemorySaver`，生产用 `RedisSaver` / `DatabaseSaver`）。这一步保证"暂停不会丢现场"。
3. **返回中断元信息**：调用返回一个 `InterruptionMetadata` 对象，里面装着"哪些工具在等审批、参数分别是什么"。
4. **用户回复后续跑**：人决策后，框架用**同一个 `threadId`** 把反馈（`FeedbackResult.APPROVED/EDITED/REJECTED`）塞回 `RunnableConfig`，再次调用 `invokeAndGetOutput`，Graph 从断点恢复执行。

::: tip threadId 是生命线
恢复时必须用**和中断时完全相同**的 `threadId`，否则框架找不到那次保存的状态，等于"换了一个新会话重来"。后面 REST 代码会用 UUID 当 threadId 并和审批单一起存库，就是为了保证它能对上。
:::

## 四、审批节点实现（典型代码）

目标：做一个"退款助手"，任何退款操作都必须人工审批。完整链路：**提交任务 → 查询待办 → 审批通过 → 继续跑完**。

### 4.1 依赖（pom.xml）

路径：`pom.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">

    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>saa-hitl-demo</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>17</java.version>
        <spring-ai.version>1.1.2</spring-ai.version>
        <spring-ai-alibaba.version>1.1.2.0</spring-ai-alibaba.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- JPA：把审批单存进数据库（这里用 H2 内存库演示，生产换 MySQL） -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>

        <!-- Agent Framework -->
        <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-agent-framework</artifactId>
            <version>${spring-ai-alibaba.version}</version>
        </dependency>
        <!-- DashScope 模型 -->
        <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-starter-dashscope</artifactId>
            <version>${spring-ai-alibaba.version}</version>
        </dependency>
    </dependencies>

    <dependencyManagement>
        <dependencies>
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

### 4.2 配置（application.yml）

路径：`src/main/resources/application.yml`

```yaml
spring:
  application:
    name: saa-hitl-demo
  ai:
    dashscope:
      api-key: ${AI_DASHSCOPE_API_KEY}
      chat:
        options:
          model: qwen-plus
          temperature: 0.3        # 审批类任务用低温度，减少随机性
          max-tokens: 1024
  # H2 内存库，存审批单；生产换成 MySQL 数据源
  datasource:
    url: jdbc:h2:mem:hitl;DB_CLOSE_DELAY=-1
    driver-class-name: org.h2.Driver
    username: sa
    password: ""
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: false

server:
  port: 8080
```

### 4.3 审批单实体（存数据库）

路径：`src/main/java/com/example/saa/hitl/ApprovalTicket.java`

```java
package com.example.saa.hitl;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;

import java.time.LocalDateTime;

/**
 * 审批单实体。
 *
 * 这张表就是"人工待办"的数据来源：每次 Agent 触发中断，就落一条 PENDING 记录。
 * 库里存的是"人能看懂"的信息（工具名、参数、描述），
 * 而框架恢复执行需要的 InterruptionMetadata 对象，本例临时放在服务内存的 Map 里。
 */
@Entity
public class ApprovalTicket {

    /** 审批单 ID，对外暴露、作为审批接口的路径参数 */
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    /** 对应的 Graph 线程 ID —— 恢复时必须用它找回断点状态 */
    @Column(nullable = false)
    private String threadId;

    /** 等待审批的工具名，如 refund */
    @Column(nullable = false)
    private String toolName;

    /** 工具入参（JSON 文本），方便人工查看"它打算干什么" */
    @Lob
    @Column(nullable = false)
    private String argumentsJson;

    /** 工具描述，解释这个操作的风险点 */
    @Column(length = 500)
    private String description;

    /** 状态：待审批 / 已批准 / 已拒绝 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.PENDING;

    /** 创建时间，用于超时判断 */
    private LocalDateTime createdAt = LocalDateTime.now();

    public enum Status {
        PENDING, APPROVED, REJECTED
    }

    // 以下为 getter / setter（JPA 需要）
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getThreadId() { return threadId; }
    public void setThreadId(String threadId) { this.threadId = threadId; }
    public String getToolName() { return toolName; }
    public void setToolName(String toolName) { this.toolName = toolName; }
    public String getArgumentsJson() { return argumentsJson; }
    public void setArgumentsJson(String argumentsJson) { this.argumentsJson = argumentsJson; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
```

### 4.4 Agent 配置（挂上 HITL Hook）

路径：`src/main/java/com/example/saa/hitl/HitlAgentConfig.java`

```java
package com.example.saa.hitl;

import com.alibaba.cloud.ai.dashscope.api.DashScopeApi;
import com.alibaba.cloud.ai.dashscope.chat.DashScopeChatModel;
import com.alibaba.cloud.ai.graph.agent.ReactAgent;
import com.alibaba.cloud.ai.graph.agent.hook.hip.HumanInTheLoopHook;
import com.alibaba.cloud.ai.graph.agent.hook.hip.ToolConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.function.FunctionToolCallback;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.function.Function;

/**
 * HITL Agent 配置。
 *
 * 关键点：
 *  1) HumanInTheLoopHook 配置"哪些工具需要审批"（approvalOn）
 *  2) 必须配 saver（MemorySaver），中断时靠它保存状态
 *  3) 敏感工具 refund 必须进审批；查询类工具 queryOrder 不需要
 */
@Configuration
public class HitlAgentConfig {

    /** 退款请求入参 */
    public record RefundRequest(String orderNo, String amount) {}

    /** 查询请求入参 */
    public record QueryRequest(String orderNo) {}

    @Bean
    public ChatModel chatModel() {
        DashScopeApi api = DashScopeApi.builder()
                .apiKey(System.getenv("AI_DASHSCOPE_API_KEY"))
                .build();
        return DashScopeChatModel.builder().dashScopeApi(api).build();
    }

    /** 敏感工具：退款。真实项目里这里会调用支付/订单系统，且应做幂等 */
    @Bean
    public ToolCallback refundTool() {
        Function<RefundRequest, String> refundFn = (req) ->
                "已对订单 " + req.orderNo() + " 退款 " + req.amount() + " 元（演示，未真实扣款）";
        return FunctionToolCallback.builder("refund", refundFn)
                .description("对指定订单执行退款。这是不可逆的资金操作，必须经过人工审批。")
                .inputType(RefundRequest.class)
                .build();
    }

    /** 普通工具：查询订单，无需审批 */
    @Bean
    public ToolCallback queryOrderTool() {
        Function<QueryRequest, String> queryFn = (req) ->
                "订单 " + req.orderNo() + " 当前状态：待发货";
        return FunctionToolCallback.builder("queryOrder", queryFn)
                .description("查询订单当前状态。")
                .inputType(QueryRequest.class)
                .build();
    }

    @Bean
    public ReactAgent hitlAgent(ChatModel chatModel,
                                ToolCallback refundTool,
                                ToolCallback queryOrderTool) {
        // 配置人工介入 Hook：只对 refund 工具要求审批
        HumanInTheLoopHook hitlHook = HumanInTheLoopHook.builder()
                .approvalOn("refund", ToolConfig.builder()
                        .description("退款是资金操作，必须人工审批")
                        .build())
                // 提示：部分版本也支持 .approvalOn("refund", "退款需审批") 的字符串简写
                .build();

        return ReactAgent.builder()
                .name("refund_assistant")
                .model(chatModel)
                .systemPrompt("你是订单助手。需要退款时调用 refund 工具，且知道该工具需人工审批。")
                .tools(refundTool, queryOrderTool)
                .hooks(hitlHook)       // 挂上 HITL Hook
                .saver(new MemorySaver())  // 中断恢复依赖它
                .build();
    }
}
```

### 4.5 审批服务（中断落单 + 审批恢复）

路径：`src/main/java/com/example/saa/hitl/ApprovalService.java`

```java
package com.example.saa.hitl;

import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.NodeOutput;
import com.alibaba.cloud.ai.graph.action.InterruptionMetadata;
import com.alibaba.cloud.ai.graph.agent.ReactAgent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 审批服务：把"框架中断"翻译成"业务待办"，再把"人工批准"翻译成"恢复执行"。
 *
 * 设计说明：
 *  - ApprovalTicket（JPA 实体）存库，是给人看的待办列表，可持久化、可多实例共享。
 *  - InterruptionMetadata（框架对象）本例放在内存 Map 里，key 就是 ticketId。
 *    原因：它是框架恢复执行的"钥匙"，框架要求原样回传。生产环境应把它序列化进同一张表
 *    （或 Redis），保证重启/多实例也能恢复——本节末尾"常见坑"会说明。
 */
@Service
public class ApprovalService {

    private final ReactAgent hitlAgent;
    private final ApprovalTicketRepository ticketRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** ticketId -> 中断元信息，恢复时取出 */
    private final Map<String, InterruptionMetadata> interruptionStore = new ConcurrentHashMap<>();

    public ApprovalService(ReactAgent hitlAgent, ApprovalTicketRepository ticketRepository) {
        this.hitlAgent = hitlAgent;
        this.ticketRepository = ticketRepository;
    }

    /**
     * 步骤 1：提交任务。
     * 如果模型决定调 refund，会触发中断，返回待审批信息；否则直接返回答案。
     */
    public SubmitResult submit(String prompt) {
        // 每次提交生成独立 threadId，作为"这次会话/这次执行"的身份证
        String threadId = UUID.randomUUID().toString();
        RunnableConfig config = RunnableConfig.builder().threadId(threadId).build();

        Optional<NodeOutput> result = hitlAgent.invokeAndGetOutput(prompt, config);

        if (result.isPresent() && result.get() instanceof InterruptionMetadata im) {
            // —— 触发中断：把每个等待审批的工具调用落成审批单 ——
            List<InterruptionMetadata.ToolFeedback> feedbacks = im.toolFeedbacks();
            for (InterruptionMetadata.ToolFeedback fb : feedbacks) {
                ApprovalTicket ticket = new ApprovalTicket();
                ticket.setThreadId(threadId);
                ticket.setToolName(fb.getName());
                try {
                    ticket.setArgumentsJson(objectMapper.writeValueAsString(fb.getArguments()));
                } catch (JsonProcessingException e) {
                    ticket.setArgumentsJson(fb.getArguments().toString());
                }
                ticket.setDescription(fb.getDescription());
                ticket.setStatus(ApprovalTicket.Status.PENDING);
                ticketRepository.save(ticket);

                // 把框架中断钥匙按 ticketId 存好，供恢复时使用
                interruptionStore.put(ticket.getId(), im);
            }
            return new SubmitResult(false, "需要人工审批", null, feedbacks.size());
        }

        // 未触发中断，直接拿到答案
        return new SubmitResult(true, "已完成", result.map(NodeOutput::toString).orElse(""), 0);
    }

    /** 步骤 2：查询待办 */
    public List<ApprovalTicket> pendingTickets() {
        return ticketRepository.findByStatus(ApprovalTicket.Status.PENDING);
    }

    /**
     * 步骤 3：审批通过 → 恢复执行。
     * 这里演示"全部批准"；edit / reject 见文末说明。
     */
    public String approve(String ticketId) {
        ApprovalTicket ticket = ticketRepository.findById(ticketId)
                .orElseThrow(() -> new IllegalArgumentException("审批单不存在: " + ticketId));

        InterruptionMetadata im = interruptionStore.get(ticketId);
        if (im == null) {
            throw new IllegalStateException("中断信息已丢失，无法恢复（见常见坑：状态丢失）");
        }

        // 重建反馈：对每个工具调用标记 APPROVED
        InterruptionMetadata.Builder feedbackBuilder = InterruptionMetadata.builder()
                .nodeId(im.node())
                .state(im.state());
        im.toolFeedbacks().forEach(tf -> {
            InterruptionMetadata.ToolFeedback approved = InterruptionMetadata.ToolFeedback.builder(tf)
                    .result(InterruptionMetadata.ToolFeedback.FeedbackResult.APPROVED)
                    .build();
            feedbackBuilder.addToolFeedback(approved);
        });
        InterruptionMetadata approval = feedbackBuilder.build();

        // 用相同 threadId + 人工反馈恢复执行
        RunnableConfig resumeConfig = RunnableConfig.builder()
                .threadId(ticket.getThreadId())
                .addMetadata(RunnableConfig.HUMAN_FEEDBACK_METADATA_KEY, approval)
                .build();

        Optional<NodeOutput> finalResult = hitlAgent.invokeAndGetOutput("", resumeConfig);
        String answer = finalResult.map(NodeOutput::toString).orElse("无结果");

        ticket.setStatus(ApprovalTicket.Status.APPROVED);
        ticketRepository.save(ticket);
        return answer;
    }

    /** 提交结果的简单载体 */
    public record SubmitResult(boolean completed, String message, String answer, int pendingCount) {}
}
```

### 4.6 审批单 Repository

路径：`src/main/java/com/example/saa/hitl/ApprovalTicketRepository.java`

```java
package com.example.saa.hitl;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

/** 审批单仓储：按状态查待办 */
public interface ApprovalTicketRepository extends JpaRepository<ApprovalTicket, String> {
    List<ApprovalTicket> findByStatus(ApprovalTicket.Status status);
}
```

### 4.7 控制器（对外接口）

路径：`src/main/java/com/example/saa/hitl/HitlController.java`

```java
package com.example.saa.hitl;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * HITL 对外接口。
 *
 * 三个核心端点对应完整链路：
 *   POST /api/hitl/run             提交任务（可能被拦截）
 *   GET  /api/hitl/approvals       查询待办
 *   POST /api/hitl/approvals/{id}  审批通过 → 继续
 */
@RestController
@RequestMapping("/api/hitl")
public class HitlController {

    private final ApprovalService approvalService;

    public HitlController(ApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    /** 提交任务 */
    @PostMapping("/run")
    public Map<String, Object> run(@RequestBody Map<String, String> body) {
        ApprovalService.SubmitResult r = approvalService.submit(body.get("prompt"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("completed", r.completed());
        out.put("message", r.message());
        out.put("answer", r.answer());
        out.put("pendingCount", r.pendingCount());
        out.put("tip", r.completed() ? "已直接完成" : "请调用 GET /api/hitl/approvals 查看待办并审批");
        return out;
    }

    /** 查询待办 */
    @GetMapping("/approvals")
    public List<ApprovalTicket> approvals() {
        return approvalService.pendingTickets();
    }

    /** 审批通过并继续 */
    @PostMapping("/approvals/{id}")
    public Map<String, Object> approve(@PathVariable String id) {
        String answer = approvalService.approve(id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", "APPROVED_AND_RESUMED");
        out.put("answer", answer);
        return out;
    }
}
```

### 4.8 完整 curl 链路

```bash
# ① 提交任务：让 Agent 退款（会触发人工审批，返回 pendingCount=1）
curl -X POST http://localhost:8080/api/hitl/run \
  -H "Content-Type: application/json" \
  -d '{"prompt":"请给订单 A1001 退款 99 元"}'
# 返回示例：
# {"completed":false,"message":"需要人工审批","answer":null,
#  "pendingCount":1,"tip":"请调用 GET /api/hitl/approvals 查看待办并审批"}

# ② 查询待办：拿到审批单 ID（假设返回 id = "a1b2c3..."）
curl http://localhost:8080/api/hitl/approvals
# 返回示例：
# [{"id":"a1b2c3...","threadId":"...","toolName":"refund",
#   "argumentsJson":"{\"orderNo\":\"A1001\",\"amount\":\"99 元\"}",
#   "description":"退款是资金操作，必须人工审批","status":"PENDING",...}]

# ③ 审批通过：用上面拿到的 id 审批，Agent 从断点继续跑完
curl -X POST http://localhost:8080/api/hitl/approvals/a1b2c3...
# 返回示例：
# {"status":"APPROVED_AND_RESUMED",
#  "answer":"已对订单 A1001 退款 99 元（演示，未真实扣款）..."}

# ④（对比）查询一个无需审批的任务：直接完成，无待办
curl -X POST http://localhost:8080/api/hitl/run \
  -H "Content-Type: application/json" \
  -d '{"prompt":"查一下订单 A1001 的状态"}'
```

::: tip 为什么这一步能"继续"而不是"重来"
因为第 ③ 步的 `RunnableConfig` 用了和中断时**同一个 `threadId`**，框架据此从 `MemorySaver` 取出保存的状态，跳过已完成的思考、只执行被批准的工具、然后继续。人工反馈通过 `HUMAN_FEEDBACK_METADATA_KEY` 注入，告诉框架"这个工具调用被批准了"。
:::

## 五、超时与降级策略

HITL 引入"等人"这一步，就必须考虑"人一直不批怎么办"：

| 策略 | 做法 | 代码落点 |
| --- | --- | --- |
| **审批超时** | 超过 N 分钟未审批，自动拒绝并通知用户 | 用 `ApprovalTicket.createdAt` + 定时任务扫描，超时置 REJECTED |
| **人工离线降级** | 审批人不在，先返回"已受理，稍后处理" | 提交接口直接返回受理号，不阻塞 |
| **模型审批兜底** | 低风险操作用模型自动放行，只拦高风险 | 把 `approvalOn` 只配在高风险工具上 |
| **拒绝后的处理** | 拒绝时把原因反馈给模型，让它换方案 | `FeedbackResult.REJECTED` + 附 `reason`，恢复时一并回传 |

超时扫描示例（节选）：

```java
package com.example.saa.hitl;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 审批超时扫描：超过 30 分钟未处理的待办，自动置为 REJECTED，避免任务永远卡住。
 */
@Component
public class ApprovalTimeoutScanner {

    private final ApprovalTicketRepository ticketRepository;

    public ApprovalTimeoutScanner(ApprovalTicketRepository ticketRepository) {
        this.ticketRepository = ticketRepository;
    }

    // 每 5 分钟扫一次；生产可配更合理间隔
    @Scheduled(fixedDelay = 5 * 60 * 1000)
    public void scan() {
        LocalDateTime deadline = LocalDateTime.now().minusMinutes(30);
        List<ApprovalTicket> expired = ticketRepository.findByStatus(ApprovalTicket.Status.PENDING)
                .stream()
                .filter(t -> t.getCreatedAt().isBefore(deadline))
                .toList();
        expired.forEach(t -> {
            t.setStatus(ApprovalTicket.Status.REJECTED);
            ticketRepository.save(t);
            // 这里还应发通知（邮件/钉钉）告知用户"审批超时未通过"
        });
    }
}
```

## 六、前端 / 接口怎么接

前端本质是三块：

```text
┌────────────┐   提交任务    ┌──────────────┐
│  前端页面   │ ───────────→ │  /api/hitl/run │
└────────────┘              └──────────────┘
       ↑                           │ 触发中断
       │     查询待办              ↓
       └── GET /api/hitl/approvals ──→ 管理后台表格（待审批列表）
       │                           │
       │  点击"通过"               ↓
       └── POST /api/hitl/approvals/{id} ──→ 恢复执行，返回结果
```

接入要点：

1. **提交后看 `completed` 字段**：`true` 直接展示 `answer`；`false` 提示用户"已生成审批单，等待人工处理"。
2. **管理后台轮询或 WebSocket**：审批人侧用定时轮询 `GET /api/hitl/approvals`（或 SSE/WebSocket 推送），渲染成可操作的表格。
3. **结果回填**：审批通过接口返回 `answer`，前端把它关联到原任务卡片上，标记"已执行"。
4. **生产可视化**：Spring AI Alibaba 提供 **Admin / Studio** 控制台，可直接看到 Agent 推理与工具执行细节、进行人工审批，省去自己写后台。

::: tip 用框架自带控制台更快
如果你不想自己写审批后台，可直接用 **Spring AI Alibaba Admin**（<https://java2ai.com/ecosystem/admin/quick-start>），它内置了 Agent 运行时可视化与人工审批能力。自己写接口适合需要深度定制审批流（多级、会签、对接 OA）的场景。
:::

## 七、常见坑

### 坑 1：恢复时状态丢失

`InterruptionMetadata`（恢复钥匙）和 `threadId` 必须都能在审批时找回来。本例把 `InterruptionMetadata` 放内存 `Map`，**一旦服务重启或水平扩容，Map 没了，approve 就报"中断信息已丢失"**。

::: danger 生产正确做法
把 `InterruptionMetadata` 连同 `threadId`、工具参数**序列化进同一张审批表（或 Redis）**。`MemorySaver` 也要换成 `RedisSaver` / `DatabaseSaver`，否则状态同样会随重启消失。本例用内存仅为便于直接运行演示。
:::

### 坑 2：幂等（重复审批 / 重复执行）

审批接口可能被前端重复点击，或网络重试导致"同一张单审批两次"。若第二次恢复时原 `threadId` 状态已消费，可能报错或重跑工具。

正确做法：

- **审批单加状态机**：只有 `PENDING → APPROVED` 的原子转移才执行恢复，重复请求直接返回"已处理"。
- **工具本身幂等**：退款工具入参带 `requestId`，服务端用 `requestId` 去重，即使恢复执行两次也不重复扣款。

```java
// 伪代码：审批时先乐观锁抢状态
if (!ticketRepository.transitionToApproved(ticketId)) {
    return "该审批单已被处理，勿重复操作"; // 直接短路，不恢复
}
```

### 坑 3：并发（多人同时审批 / 多实例）

- **并发审批同一单**：用数据库行锁或乐观锁（版本号）保证只有一个能成功转移状态。
- **多实例部署**：`interruptionStore` 必须是共享存储（Redis），不能是每个实例各一份 JVM 内存，否则 A 实例触发的单，B 实例来审批会找不到。
- **threadId 冲突**：用 UUID 保证全局唯一，不要用自增或固定值，否则不同任务的状态会互相覆盖。

::: warning 一个并发细节
`HumanInTheLoopHook` 的 `InterruptionMetadata` 是一次中断的快照。若一次中断里有**多个工具调用**（如同时 refund + sendEmail），恢复时需把**每一个**都设好 `FeedbackResult`（本例循环全部 APPROVED）。漏掉任何一个，框架可能仍认为未决而再次中断。
:::

## 本篇小结

- **HITL 是生产落地 Agent 的底线**：不可逆、合规、模型拿不准的三类操作，必须有人拍板。
- **三种时机**：执行前审批（最常用，用 `HumanInTheLoopHook`）、执行中确认、执行后修正。
- **中断—恢复机制**：Hook 在"工具执行前"暂停 → `CheckpointSaver` 保存状态 → 返回 `InterruptionMetadata` → 人决策后同 `threadId` 恢复。
- **一套可跑的审批流**：敏感工具配 `approvalOn` → 提交触发中断落"审批单"→ 查待办 → 批准重建 `FeedbackResult.APPROVED` 并恢复执行。
- **超时与降级**：审批要有超时自动拒绝，避免任务永久卡住；低风险可让模型自动放行。
- **三个坑**：恢复钥匙/状态要持久化（别放内存）、审批要幂等、多实例要共享存储 + 并发加锁。

## 参考链接

- 人工介入 HITL（Hook 机制）：<https://java2ai.com/docs/frameworks/agent-framework/advanced/human-in-the-loop/>
- 人类反馈（Graph 中断/恢复）：<https://java2ai.com/docs/frameworks/graph-core/examples/human-in-the-loop/>
- 中断与恢复系统（底层原理）：<https://deepwiki.com/alibaba/spring-ai-alibaba/3.9-interruption-and-resume-system>
- Admin 可视化控制台：<https://java2ai.com/ecosystem/admin/quick-start>
- GitHub 仓库：<https://github.com/alibaba/spring-ai-alibaba>

下一篇 → [14 Graph 构图基础](/java/saa/graph-basics)
