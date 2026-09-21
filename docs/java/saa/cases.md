# 23 实战案例

> 看官方重量级项目是怎么落地的，比看 API 文档更有收获。前面 20 多章你已经把"积木"都认全了：ChatClient、RAG、Tool、Graph、HITL、可观测。这一章把这些积木拼成三座能住的房子——深度研究、数据问答、智能客服，外加官方 JManus/DeepResearch 的拆解。每个案例都给"场景 → 架构图（文字版）→ 关键代码 → 踩坑点"，你可以直接照抄改。

## 本篇要解决的问题

- DeepResearch（深度研究）：怎么让 Agent 多轮检索 + 汇总，产出一份像样的报告
- NL2SQL（数据问答）：自然语言转 SQL，以及如何防权限越权和 SQL 注入
- 智能客服工单：意图识别 → 分流 → RAG + 工具调用 → 人工兜底（HITL）
- 官方 JManus / DeepResearch 是怎么设计的，能借鉴什么

::: warning 代码基线
全部基于 **Spring Boot 3.5.5 + Spring AI 1.1.2 + SAA 1.1.2.0 + qwen-plus + Elasticsearch 8.x**。案例代码是"关键片段的完整实现"，聚焦核心逻辑；完整可运行项目请把各片段按包结构拼起来，并复用第 02 章的 `pom.xml` 与 `application.yml` 基线。
:::

---

## 一、DeepResearch 深度检索

### 1.1 场景

用户丢一个开放性问题，比如"2025 年国内新能源汽车出海的现状、主要市场和面临的壁垒，给我一份报告"。这种问题**一次检索答不全**，需要：先拆解子问题 → 多轮搜索引擎/网页抓取 → 把资料汇总 → 再反思还缺什么 → 补齐 → 最后写成报告。

### 1.2 架构图（文字版）

```text
用户输入（一个研究主题）
   │
   ▼
┌─────────────────────────────────────────────┐
│  Planner（规划节点）                          │
│  让模型把大问题拆成 3~5 个可检索的子问题        │
└─────────────────────────────────────────────┘
   │  子问题列表
   ▼
┌─────────────────────────────────────────────┐
│  Research Loop（研究循环，可迭代 N 轮）         │
│   ├─ SearchNode：调搜索工具（Web / 向量库）      │
│   ├─ CrawlNode：抓取网页正文                    │
│   └─ SummarizeNode：把资料浓缩成要点             │
└─────────────────────────────────────────────┘
   │  汇总后的资料
   ▼
┌─────────────────────────────────────────────┐
│  Writer（撰写节点）                            │
│  基于所有要点，生成结构化 Markdown 报告          │
└─────────────────────────────────────────────┘
   │
   ▼
返回报告 + 引用来源
```

### 1.3 关键代码

下面用**最朴素但完整可运行**的方式实现核心循环（不依赖 Graph，先讲清思路；官方 DeepResearch 是用 Graph 编排的，思路一致）。

`src/main/java/com/example/saa/cases/deepresearch/DeepResearchService.java`

```java
package com.example.saa.cases.deepresearch;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 深度研究服务：把"大问题"拆成子问题，逐个检索+总结，最后汇总成报告。
 *
 * 设计要点（纯白小白也能懂）：
 *   1. 大问题一次答不全，所以先"列提纲"（Planner）。
 *   2. 每个子问题去查资料（这里用模拟的 search 工具，真实可接搜索 API）。
 *   3. 资料太多塞不进一次回答，所以每查完一个就"先做笔记"（Summarize）。
 *   4. 所有笔记凑齐，最后"写文章"（Writer）。
 */
@Service
public class DeepResearchService {

    private final ChatClient chatClient;

    public DeepResearchService(ChatClient.Builder builder) {
        this.chatClient = builder
                // 把搜索工具暴露给模型：模型在"研究循环"里可以决定调它
                .defaultTools(this)
                .build();
    }

    /** 对外暴露的主方法：输入一个主题，返回研究报告 */
    public String research(String topic) {
        // 第一步：规划——让模型拆子问题
        String plan = chatClient.prompt()
                .system("你是一个研究规划助手。把用户给的宽泛主题，拆成 3~5 个具体、可检索的子问题，每行一个，不要编号以外的废话。")
                .user(topic)
                .call()
                .content();
        List<String> subQuestions = List.of(plan.split("\n"));

        // 第二步：逐个子问题检索+总结
        List<String> notes = new ArrayList<>();
        for (String q : subQuestions) {
            String material = chatClient.prompt()
                    .system("你是资料检索员。针对子问题，调用 search 工具查找资料，然后给出 200 字内的要点笔记。")
                    .user(q)
                    .call()
                    .content();
            notes.add("子问题：" + q + "\n" + material);
        }

        // 第三步：撰写最终报告
        String notesBlock = String.join("\n\n", notes);
        return chatClient.prompt()
                .system("你是一名分析师。基于下列研究笔记，撰写一份结构化 Markdown 报告，包含结论、分点论证和来源引用。")
                .user("研究主题：" + topic + "\n\n研究笔记：\n" + notesBlock)
                .call()
                .content();
    }

    /**
     * 搜索工具。真实场景里这里应调用搜索 API（如 Bing / SerpAPI / 百炼的搜索能力）。
     * 这里用模拟返回，便于你先把整条链路跑通。
     */
    @Tool(name = "search", description = "根据关键词搜索网络资料，返回相关摘要")
    public String search(String query) {
        // TODO 真实实现：调用搜索 API，返回 top-k 结果的标题+摘要
        return "[模拟搜索结果] 关于「" + query + "」的资料：……（真实环境接入搜索 API 后这里会有内容）";
    }
}
```

配套 Controller 与 curl：

`src/main/java/com/example/saa/cases/deepresearch/DeepResearchController.java`

```java
package com.example.saa.cases.deepresearch;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/research")
public class DeepResearchController {

    private final DeepResearchService service;

    public DeepResearchController(DeepResearchService service) {
        this.service = service;
    }

    @GetMapping
    public String research(@RequestParam String topic) {
        return service.research(topic);
    }
}
```

```bash
curl "http://localhost:8080/api/research?topic=2025年国内新能源汽车出海现状"
```

### 1.4 踩坑点

| 坑 | 现象 | 解决 |
| --- | --- | --- |
| 报告"查不全" | 只检索一轮就写，遗漏角度 | 加"反思节点"：写完提纲让模型自检"还缺哪些角度"，补一轮 |
| 上下文超限 | 资料太多塞爆窗口 | 每个子问题先 Summarize 成要点，不直接堆原文 |
| 工具不被调用 | 模型没用 search | 在 system 里明确要求"必须先调用 search 再回答"，并降低 temperature |
| 来源不可信 | 模型编造引用 | 让工具返回真实 URL，报告里只引用工具返回过的来源 |

::: tip 官方 DeepResearch 怎么做的
官方 `examples/deepresearch` 用 **Spring AI Alibaba Graph** 把上述节点编排成有状态的图：Planner → Research Loop（Search/Crawl/Python/MCP 工具）→ Writer，并带前端 UI。它额外支持**网页爬虫、Python 脚本执行、MCP 服务**等更强工具。学习路径：先照本节的朴素版跑通，再去读官方 Graph 版。注意官方项目"仍在持续开发中"，具体 API 以仓库源码为准。
:::

---

## 二、NL2SQL 数据问答

### 2.1 场景

业务人员不想写 SQL，想用自然语言问"上个月华东区销售额 top 10 的商品有哪些"。系统把这句话转成 SQL、查数据库、返回结果和中文解读。

### 2.2 架构图（文字版）

```text
用户自然语言问题
   │
   ▼
┌──────────────────────────────────────┐
│  NL2SQL 生成：问题 + 表结构(schema)     │
│  → 大模型生成 SQL（带防注入约束）        │
└──────────────────────────────────────┘
   │  SQL 文本
   ▼
┌──────────────────────────────────────┐
│  安全护栏（最重要！）                    │
│   ├─ 只允许 SELECT（白名单）            │
│   ├─ 限制访问的表/库（权限矩阵）         │
│   └─ 参数化 / 拒绝字符串拼接             │
└──────────────────────────────────────┘
   │  校验通过的 SQL
   ▼
执行 → 结果 → 大模型转成"人话"解读
```

### 2.3 关键代码

`src/main/java/com/example/saa/cases/nl2sql/Nl2SqlService.java`

```java
package com.example.saa.cases.nl2sql;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.regex.Pattern;

/**
 * NL2SQL 服务：自然语言 → SQL → 执行 → 人话解读。
 *
 * 安全是这条链路的生命线。大模型生成的 SQL 绝不能"拿到就跑"，
 * 必须经过白名单校验，否则用户一句"把用户表清空"就可能成真。
 */
@Service
public class Nl2SqlService {

    private final ChatClient chatClient;
    private final JdbcTemplate jdbcTemplate;

    /** 只允许 SELECT，且只允许访问这两张业务表——权限矩阵的核心 */
    private static final Pattern SAFE_SQL =
            Pattern.compile("^\\s*select\\b[\\s\\S]*\\bfrom\\s+(orders|products)\\b", Pattern.CASE_INSENSITIVE);

    public Nl2SqlService(ChatClient.Builder builder, JdbcTemplate jdbcTemplate) {
        this.chatClient = builder.build();
        this.jdbcTemplate = jdbcTemplate;
    }

    public String ask(String question) {
        // 1) 把"表结构"也喂给模型，否则它不知道字段名
        String schema = """
                表 orders: id, product_id, region, amount, created_at
                表 products: id, name, category
                """;

        // 2) 让模型生成 SQL，并强调只允许查询、只查指定表
        String sql = chatClient.prompt()
                .system("""
                        你是一个 SQL 生成器。只能生成 SELECT 语句，只能查询 orders 和 products 表，
                        禁止 INSERT/UPDATE/DELETE/DROP，禁止访问其他表。只输出 SQL，不要解释。""")
                .user("表结构：\n" + schema + "\n问题：" + question)
                .call()
                .content()
                .trim();

        // 3) 安全护栏：正则白名单校验
        if (!SAFE_SQL.matcher(sql).matches()) {
            return "抱歉，这个问题超出了可查询范围（只允许查询 orders / products 的只读语句）。";
        }

        // 4) 执行并限制返回行数，防止一次拉爆内存
        List<?> rows = jdbcTemplate.queryForList(
                sql.replaceAll("(?i)\\s*;\\s*$", "")   // 去掉结尾分号，防多语句注入
                        + " LIMIT 100");
        if (rows.isEmpty()) {
            return "没有查到相关数据。";
        }

        // 5) 把结果交给模型转成"人话"
        return chatClient.prompt()
                .system("你擅长把数据库查询结果用中文通俗地总结给用户，不要输出 SQL。")
                .user("用户问题：" + question + "\n查询结果（前若干条）：" + rows)
                .call()
                .content();
    }
}
```

::: warning 关于官方 NL2SQL Starter
Spring AI Alibaba 提供了 `spring-ai-alibaba-starter-nl2sql` starter，内置了 NL2SQL 的能力封装。**但本篇不保证其具体类名与 API 形态**，落地请以官方文档为准。上面的手写实现基于 `ChatClient`，不依赖该 starter，逻辑完全透明、可控，推荐先用手写版理解原理，再按需切换到官方 starter 提升开发效率。
:::

Controller 与 curl：

`src/main/java/com/example/saa/cases/nl2sql/Nl2SqlController.java`

```java
package com.example.saa.cases.nl2sql;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/nl2sql")
public class Nl2SqlController {

    private final Nl2SqlService service;

    public Nl2SqlController(Nl2SqlService service) {
        this.service = service;
    }

    @GetMapping
    public String ask(@RequestParam String q) {
        return service.ask(q);
    }
}
```

```bash
curl "http://localhost:8080/api/nl2sql?q=上个月华东区销售额top10的商品"
```

### 2.4 踩坑点：权限与注入风险防范（重点）

| 风险 | 说明 | 防范 |
| --- | --- | --- |
| **越权查询** | 用户问"所有用户的手机号" | 权限矩阵：按用户角色限定可查的表/列；上面的正则就是最小实现 |
| **SQL 注入 / 多语句** | 问题里夹带 `; DROP TABLE` | 去掉结尾分号、禁止多语句、禁止非 SELECT 关键字 |
| **上下文泄露** | 模型生成的 SQL 跨库 JOIN 到敏感表 | 白名单只允许指定表，schema 只暴露必要字段 |
| **结果过大** | 没 LIMIT 一次拉几十万行 | 强制 `LIMIT` + 分页 |
| **幻觉字段** | 模型编造不存在的字段名 | 把准确的 schema 文本喂给模型，执行失败就回退提示 |

::: danger 生产铁律
NL2SQL **永远不要**用字符串拼接把用户问题直接塞进 SQL。本案例用 `JdbcTemplate.queryForList` 执行模型生成的**完整 SQL 字符串**，已在应用层用正则白名单拦截；若进一步要求参数化，应让模型只输出**条件值**，由代码用 `?` 占位符绑定，彻底杜绝注入。权限校验必须在**应用层**做，不能依赖模型"自觉"。
:::

---

## 三、智能客服工单

### 3.1 场景

用户来咨询，系统先判断他**意图**（查订单 / 退换货 / 技术咨询 / 投诉），再分流：简单问题用 RAG 知识库答，需要实时数据的调工具（查订单系统），搞不定的转**人工**（HITL，呼应第 13 章）。

### 3.2 架构图（文字版）

```text
用户消息
   │
   ▼
┌──────────────────────────────────────┐
│  Intent Router（意图识别）             │
│  分类：查订单 / 退换货 / 咨询 / 投诉    │
└──────────────────────────────────────┘
   │  意图标签
   ▼
┌──────────────────────────────────────┐
│  分流处理                              │
│   ├─ 知识类  → RAG 检索知识库作答        │
│   ├─ 数据类  → 调工具查订单/物流系统      │
│   └─ 复杂/高风险 → 转人工(HITL)         │
└──────────────────────────────────────┘
   │
   ▼
人工坐席（HITL：在关键节点暂停，等人工确认/接管）
   │
   ▼
返回用户 + 生成工单记录
```

### 3.3 关键代码

先定义意图枚举和路由，再做 RAG + 工具 + HITL 的组合。

`src/main/java/com/example/saa/cases/cs/Intent.java`

```java
package com.example.saa.cases.cs;

/** 客服意图分类——用枚举把"意图"变成可控的代码，而不是让模型自由发挥 */
public enum Intent {
    QUERY_ORDER,    // 查订单
    RETURN,         // 退换货
    CONSULT,        // 产品咨询
    COMPLAINT,      // 投诉
    UNKNOWN         // 识别不出 → 转人工
}
```

`src/main/java/com/example/saa/cases/cs/CustomerServiceService.java`

```java
package com.example.saa.cases.cs;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.stereotype.Service;

/**
 * 智能客服：意图识别 → 分流 → RAG/工具 → 人工兜底(HITL)。
 *
 * 关键设计：
 *   - 意图识别单独一步，且要求模型只输出枚举值，避免它"自由发挥"导致分流错乱。
 *   - 高风险意图（投诉、识别不出）直接转人工，不信任模型独自处理。
 *   - 工具只暴露"查订单"这类只读能力，绝不在客服里暴露"退款执行"等写操作（写操作走人工）。
 */
@Service
public class CustomerServiceService {

    private final ChatClient chatClient;

    public CustomerServiceService(ChatClient.Builder builder) {
        this.chatClient = builder
                .defaultTools(this)   // 暴露查订单工具
                .build();
    }

    public String handle(String userId, String message) {
        // 第 1 步：意图识别（强约束输出枚举）
        Intent intent = classify(message);

        // 第 2 步：分流
        return switch (intent) {
            case QUERY_ORDER -> "您的订单信息如下：\n" + queryOrder(userId);
            case CONSULT     -> consult(message);          // RAG 知识库作答
            case RETURN, COMPLAINT, UNKNOWN ->
                // 高风险或识别不出 → 转人工（HITL 的"接管"环节）
                handoffToHuman(userId, message, intent);
        };
    }

    /** 让模型只输出枚举名，降低分流错误率 */
    private Intent classify(String message) {
        String result = chatClient.prompt()
                .system("你是意图分类器。只输出以下之一：QUERY_ORDER, RETURN, CONSULT, COMPLAINT, UNKNOWN。不要解释。")
                .user(message)
                .call()
                .content()
                .trim()
                .toUpperCase();
        try {
            return Intent.valueOf(result);
        } catch (IllegalArgumentException e) {
            return Intent.UNKNOWN;   // 模型乱输出 → 兜底转人工，不要赌
        }
    }

    /** 知识类问题：用 RAG（这里假设已配好 VectorStore，详见 19/20 章） */
    private String consult(String message) {
        // 真实项目里这里挂 RetrievalAugmentationAdvisor 做检索增强
        return chatClient.prompt()
                .system("你是产品客服，只能基于公司知识库回答，不知道的就说'需要为您转接人工'。")
                .user(message)
                .call()
                .content();
    }

    /** 转人工：生成工单，等待坐席（HITL） */
    private String handoffToHuman(String userId, String message, Intent intent) {
        // 这里应把 (userId, message, intent, 时间) 写入工单表，并通知坐席
        // 第 13 章 HITL 讲过的"在关键节点 interrupt 等人工确认"即用于此
        return "您的问题已为您转接人工客服，工单类型：" + intent + "，请稍候，坐席将尽快联系您。";
    }

    /** 查订单工具：只读，返回脱敏后的订单摘要 */
    @Tool(name = "queryOrder", description = "根据用户ID查询其最近订单的状态和金额")
    public String queryOrder(String userId) {
        // TODO 真实实现：调订单系统/数据库，返回脱敏摘要
        return "订单号 A1001，状态：已发货，金额：299 元（模拟数据）";
    }
}
```

::: tip HITL 在客服里的落点
第 13 章讲的人机协同（Human-in-the-loop），在客服场景最典型的三个落点：
1. **退款/赔偿执行前**：模型生成方案，必须 `interrupt` 等人工点"同意"才真正执行写操作。
2. **意图 UNKNOWN 时**：不硬答，转人工。
3. **高置信度低时**：模型自己觉得拿不准，主动申请人工兜底。
:::

Controller 与 curl：

`src/main/java/com/example/saa/cases/cs/CustomerServiceController.java`

```java
package com.example.saa.cases.cs;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cs")
public class CustomerServiceController {

    private final CustomerServiceService service;

    public CustomerServiceController(CustomerServiceService service) {
        this.service = service;
    }

    @GetMapping
    public String handle(@RequestParam String userId, @RequestParam String msg) {
        return service.handle(userId, msg);
    }
}
```

```bash
curl "http://localhost:8080/api/cs?userId=user-001&msg=我的订单到哪了"
```

### 3.4 踩坑点

| 坑 | 现象 | 解决 |
| --- | --- | --- |
| 意图分错 | "我要退货"被当成咨询 | 分类单独成步 + 强约束枚举输出；边界 case 宁可转人工 |
| 模型擅自执行写操作 | 用户说"帮我退款"模型直接调了退款接口 | 工具只暴露只读能力，写操作走 HITL 人工确认 |
| RAG 答非所问 | 知识库没召回相关文档 | 见第 24 章 RAG 召回排查清单；召回不到就转人工 |
| 隐私泄露 | 工具返回了别人的订单 | 工具内按 `userId` 强校验，禁止跨用户查询 |

---

## 四、官方 JManus 等案例介绍与拆解

### 4.1 JManus：Java 版的通用智能体

JManus 是社区基于 Spring AI Alibaba 实现的 **Manus 开源替代品**（完全 Java 化、彻底开源），定位"通用智能体平台"。它的核心能力：

- **完整实现 Manus 的多 Agent 框架**：多个专职 Agent 分工协作。
- **原生支持 MCP**：Agent 能调本地/云端模型，也能深度对接外部服务、API、数据库。
- **PLAN-ACT 模式**：先规划（Plan）再分步执行（Act），支持复杂推理与动态调整——适合多轮对话、复杂决策。
- **UI 配置 Agent**：开发者/运维不用改代码，在网页上调整参数、模型、工具。
- **自然语言生成 Agent 项目**：用自然语言交互生成方案，并可导出为 Spring AI Alibaba 项目。

::: tip 和本专栏的呼应
JManus 几乎用遍了本专栏的所有概念：Graph 编排（多 Agent）、Tool/MCP（工具调用）、上下文工程、HITL（人工确认）、可观测（接 ARMS/Langfuse）。把它当作"把所有积木拼成一个大房子"的范本去读源码，比任何文档都直观。

源码：<https://github.com/alibaba/spring-ai-alibaba> 下的 JManus 子项目（具体路径以官方仓库为准，搜索 "JManus"）。
:::

### 4.2 官方 DeepResearch

前文第一节的朴素版，官方有更完整的 Graph 实现（`examples/deepresearch`）：基于 Spring AI Alibaba Graph，内置 **Web 搜索、网页爬虫、Python 脚本引擎、MCP 服务** 等工具，支持"多轮检索 → 反思补齐 → 撰写报告"。其架构与我们文字版一致，区别在于用 Graph 做了**有状态、可持久化、可中断恢复**的编排。

### 4.3 社区其它案例

- **多 Agent RAG 应用**：基于 SAA Graph 的检索增强，演示 Supervisor / ReAct 等多 Agent 模式。
- **Playground 示例**：官方 examples 仓库里带前端 UI 的综合性 Demo，覆盖 chatbot、多轮对话、图像生成、多模态、工具调用、MCP、RAG，适合"抄作业"。
- 示例仓库：<https://github.com/springaialibaba/spring-ai-alibaba-examples>

::: warning 官方项目迭代快
JManus 与 DeepResearch 官方均声明"仍在持续开发中"。**具体 API、UI 路径、工具集以官方仓库最新源码和 Release 说明为准**，本篇只做架构层面的拆解与借鉴思路，不保证与最新版逐行对应。
:::

---

## 五、自己的练手项目建议

把上面三个案例各跑通一遍后，可以挑一个垂直场景做自己的项目，建议路线：

1. **先抄后改**：从官方 examples 或本篇片段起步，跑通最小闭环。
2. **加可观测**：接 Studio（嵌入式）看调用轨迹，再按第 21 章接 Langfuse/ARMS。
3. **加评测**：用第 21 章的黄金集做回归，保证每次改 prompt 不退化。
4. **上权限与护栏**：尤其 NL2SQL 类，安全校验必须在应用层。
5. **再考虑平台**：团队大了再上 Admin 做协作与可视化编排。

## 本篇小结

- **DeepResearch**：规划 → 多轮检索+总结 → 撰写。核心坑是"查不全"和"上下文超限"，解法分别是反思补轮和先 summarize 再汇总。
- **NL2SQL**：自然语言 → SQL → 安全护栏 → 执行 → 解读。**安全是生命线**：白名单只允许 SELECT、限定表、去分号防多语句、应用层权限校验。
- **智能客服**：意图识别（强约束枚举）→ 分流（RAG/工具/人工）→ HITL 兜底。写操作绝不交给模型，必须人工确认。
- **官方案例**：JManus（Java 通用智能体，PLAN-ACT + MCP）、DeepResearch（Graph 编排）、Playground（综合 Demo）是极佳的"抄作业"范本。

## 参考链接

- Spring AI Alibaba Examples：<https://github.com/springaialibaba/spring-ai-alibaba-examples>
- JManus / DeepResearch（在 SAA 主仓库）：<https://github.com/alibaba/spring-ai-alibaba>
- Spring AI Alibaba 官网：<https://java2ai.com/>
- 本专栏相关章节：第 13 章 HITL、第 19/20 章 RAG、第 21 章可观测与评估

下一篇 → [24 常见问题与踩坑](/java/saa/faq)
