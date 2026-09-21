# 06 LangChain4j 框架

> 另一个主流 Java AI 框架，作为横向参照，也是 Spring AI Alibaba 之外的一个备选。看完这一章，你应该能拍板：自己的项目到底用 Spring AI 还是 LangChain4j。

## 本篇要解决的问题

05 章我们吃透了 Spring AI 的抽象。但 Java 生态里另一套同样成熟的方案是 **LangChain4j**。很多人会纠结：

- 它和 Spring AI 到底啥关系，是替代还是互补？
- 它的"声明式接口 AiServices"用起来是什么体验？
- 记忆、工具、RAG、流式，它怎么写？
- **最关键**：我该选哪个？

这一章把 LangChain4j 的核心能力快速过一遍，最后给你一张**横向选型对比表**和明确的场景建议。注意：本章示例为了和你之前学的对齐，**模型仍走阿里云百炼 DashScope 的 qwen-plus**（通过 OpenAI 兼容端点），**向量库仍只用 Elasticsearch 8.x**。

## 一、LangChain4j 是什么

一句话：**LangChain4j 是 Java 版的 LangChain**——目标是让 Java 开发者也能像 Python 圈那样，用很少的代码把 LLM、记忆、工具、RAG 串起来。

它和 Spring AI 是**同一层级的竞争关系**：都做"模型抽象 + 工程化能力"。区别在风格：

```text
Spring AI 的思路：      LangChain4j 的思路：
"Spring 风格，偏低层"   "声明式接口，高层封装"
ChatClient 链式调用     AiServices 直接生成接口实现
你拼消息、配 Advisor    你定义接口，框架填实现
```

::: tip 一个关键事实
LangChain4j **不依赖 Spring**，可以纯 Java 用；也提供了 Quarkus / Spring Boot 集成。而 Spring AI 天然长在 Spring 生态里。如果你整个项目就是 Spring Boot，两者都能用；选型差异主要在 API 风格和生态，见末尾对比表。
:::

依赖基线（用 BOM 管理版本；LangChain4j 版本号独立于 Spring AI，以官方最新 1.x 为准）：

```xml
<dependencyManagement>
    <dependencies>
        <!-- LangChain4j 的 BOM，统一各模块版本 -->
        <dependency>
            <groupId>dev.langchain4j</groupId>
            <artifactId>langchain4j-bom</artifactId>
            <version>1.1.0</version>   <!-- 仅示例，请对齐官方最新 1.x -->
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>dev.langchain4j</groupId>
        <artifactId>langchain4j</artifactId>
    </dependency>
    <!-- 通过 OpenAI 兼容端点接 DashScope（qwen-plus） -->
    <dependency>
        <groupId>dev.langchain4j</groupId>
        <artifactId>langchain4j-open-ai</artifactId>
    </dependency>
    <!-- 向量库：本专栏统一用 Elasticsearch -->
    <dependency>
        <groupId>dev.langchain4j</groupId>
        <artifactId>langchain4j-elasticsearch</artifactId>
    </dependency>
    <!-- 快速 RAG 入门（Easy RAG） -->
    <dependency>
        <groupId>dev.langchain4j</groupId>
        <artifactId>langchain4j-easy-rag</artifactId>
    </dependency>
</dependencies>
```

## 二、核心 API：AiServices 声明式用法

这是 LangChain4j 最亮眼的特性。**你只定义一个 Java 接口，框架用动态代理帮你实现它**——不用手写"拼消息、解析响应"那堆样板。

`src/main/java/com/example/ai/langchain4j/Assistant.java`

```java
package com.example.ai.langchain4j;

import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import dev.langchain4j.service.V;

/**
 * 声明式 AI 接口：只写接口 + 注解，实现由 AiServices 动态生成。
 */
public interface Assistant {

    // 最简单：返回纯文本
    String chat(String message);

    // 用 @SystemMessage 设定系统提示词（支持 {变量} 模板）
    @SystemMessage("你是一位{role}专家，回答简洁。")
    String ask(@V("role") String role, @UserMessage String question);
}
```

`src/main/java/com/example/ai/langchain4j/AiServicesDemo.java`

```java
package com.example.ai.langchain4j;

import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.service.AiServices;

/**
 * 用 AiServices 把接口变成可用的实现。
 *
 * 关键点：模型通过 OpenAI 兼容端点指向 DashScope 的 qwen-plus，
 * 这样和你前面几章用的模型完全一致。
 */
public class AiServicesDemo {

    public static void main(String[] args) {
        // 1. 构建 ChatModel，base-url 指向 DashScope 兼容模式
        OpenAiChatModel model = OpenAiChatModel.builder()
                .baseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1")
                .apiKey(System.getenv("AI_DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .temperature(0.7)
                .build();

        // 2. AiServices 动态生成 Assistant 的实现
        Assistant assistant = AiServices.create(Assistant.class, model);

        // 3. 像调普通接口一样调用
        System.out.println(assistant.chat("用一句话介绍什么是向量数据库"));

        // 带模板变量的调用
        System.out.println(assistant.ask("Java", "HashMap 和 ConcurrentHashMap 的区别"));
    }
}
```

::: tip AiServices 能帮你自动做哪些事
- **拼装提示词**：`@SystemMessage` / `@UserMessage` / `@V` 模板变量自动渲染。
- **解析响应**：返回类型写成 POJO / record，框架自动做结构化抽取（类似 Spring AI 的 BeanOutputConverter）。
- **记忆、工具、RAG**：通过 `.chatMemory(...)` / `.tools(...)` / `.contentRetriever(...)` 一行接入（见下文）。
- 本质上它把 Spring AI 里你要手写的"ChatClient 链"封装成了接口约定。
:::

## 三、ChatMemory：会话记忆

LangChain4j 的记忆核心是 `ChatMemory`，最常用实现是 `MessageWindowChatMemory`（保留最近 N 条，和 Spring AI 的 `MessageWindowChatMemory` 思路一致）。多用户时用 `ChatMemoryProvider` 按 ID 造不同记忆。

`src/main/java/com/example/ai/langchain4j/MemoryDemo.java`

```java
package com.example.ai.langchain4j;

import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.MemoryId;

/**
 * 多用户记忆示例。
 *
 * @MemoryId 告诉框架：用这个参数的值（如用户 ID）区分不同会话的记忆。
 */
public class MemoryDemo {

    interface MemoryAssistant {
        String chat(@MemoryId String userId, String message);
    }

    public static void main(String[] args) {
        OpenAiChatModel model = OpenAiChatModel.builder()
                .baseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1")
                .apiKey(System.getenv("AI_DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .build();

        MemoryAssistant assistant = AiServices.builder(MemoryAssistant.class)
                .chatModel(model)
                // 按 userId 给每个用户独立的滑动窗口记忆，最多 10 条
                .chatMemoryProvider(memoryId ->
                        MessageWindowChatMemory.withMaxMessages(10))
                .build();

        // 用户 A 说自己的名字
        assistant.chat("user-A", "我叫小明");
        // 用户 B 完全不知道 A 的事
        System.out.println(assistant.chat("user-B", "我叫什么名字？"));
        // 用户 A 能回忆起来
        System.out.println(assistant.chat("user-A", "我叫什么名字？"));
    }
}
```

::: warning 记忆要主动清理
`MessageWindowChatMemory` 是内存里的窗口，超出 maxMessages 会自动丢最早的。但**多用户长期不清理会内存泄漏**——生产环境要用持久化的 `ChatMemoryStore`（如基于 ES/Redis）。具体实现类名以你所用版本文档为准。
:::

## 四、Tools：工具调用

和 04 章 Function Calling 等价。你在方法上贴 `@Tool`，框架把它暴露给模型；模型决定调用时，执行你的方法。

`src/main/java/com/example/ai/langchain4j/ToolDemo.java`

```java
package com.example.ai.langchain4j;

import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.service.AiServices;

/**
 * 工具调用示例。
 *
 * 工具参数用 @P 描述（对应 Spring AI 的 @ToolParam）。
 * 也可以用 record 描述一组参数，语义更清晰。
 */
public class ToolDemo {

    // 工具类：模型可以"调用"的本地能力
    static class OrderTools {
        @Tool("根据订单号查询订单状态。当用户问具体订单时使用。")
        public String queryOrder(@P("订单号，形如 NO123456") String orderId) {
            if ("NO123456".equals(orderId)) {
                return "订单 NO123456：已发货，预计明天送达。";
            }
            return "未找到订单：" + orderId;
        }
    }

    interface ToolAssistant {
        String chat(String message);
    }

    public static void main(String[] args) {
        OpenAiChatModel model = OpenAiChatModel.builder()
                .baseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1")
                .apiKey(System.getenv("AI_DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .build();

        ToolAssistant assistant = AiServices.builder(ToolAssistant.class)
                .chatModel(model)
                .tools(new OrderTools())   // 把工具对象交给框架
                .build();

        // 模型会自己判断：要回答订单问题，得先调 queryOrder
        System.out.println(assistant.chat("帮我查一下订单 NO123456 到哪了"));
    }
}
```

::: tip 和 Spring AI 的对照
- LangChain4j 的 `@Tool` + `@P` ≈ Spring AI 的 `@Tool` + `@ToolParam`。
- LangChain4j 的 `.tools(new XxxTools())` ≈ Spring AI 的 `ToolCallbackProvider` 注册。
- 两者的闭环逻辑一样：模型决定调用 → 执行 → 回传 → 二次生成，都自动完成。
:::

## 五、RAG 的 Easy / Naive / Advanced 三档

LangChain4j 把 RAG 分成三档，难度和可控度递增。本专栏向量库统一用 **Elasticsearch**，所以下面三档的"库"都用 `ElasticsearchEmbeddingStore`，不再使用内存库或其他向量库。

### 5.1 Easy RAG（零配置快速入门）

Easy RAG 的理念是"把文档丢进去就完事"，框架自动做解析、切分、嵌入、入库。它的 API 很简洁：

```java
// 仅展示 API 形态：Easy RAG 默认用本地嵌入模型 + 内存库做零配置体验。
// 本专栏统一用 ES + DashScope 嵌入模型，因此生产示例见 5.2/5.3，
// 这里只理解"一行 ingest"的思想即可。
// EmbeddingStoreIngestor.ingest(documents, embeddingStore);
```

::: warning 为什么本教程不直接拿 Easy RAG 当生产示例
Easy RAG 默认把向量存进**内存库**、用本地小嵌入模型（bge-small）。这与本专栏"向量库只允许 Elasticsearch"的基线冲突，且本地嵌入模型中文效果一般。**了解其"零配置"思想即可，真正落地请走下面 Naive / Advanced 两档并用 ES。**
:::

### 5.2 Naive RAG（基础可控）

Naive RAG 让你自己控制：用哪个嵌入模型、怎么切分、用哪个向量库检索。核心是 `EmbeddingStoreContentRetriever`。

`src/main/java/com/example/ai/langchain4j/NaiveRagDemo.java`

```java
package com.example.ai.langchain4j;

import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.loader.FileSystemDocumentLoader;
import dev.langchain4j.data.document.splitter.DocumentSplitters;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.elasticsearch.ElasticsearchEmbeddingStore;

import java.util.List;

/**
 * Naive RAG：自己控制 嵌入模型 / 切分 / ES 检索。
 *
 * 说明：ElasticsearchEmbeddingStore 的 builder 需要传入 ES 客户端（client）。
 * 下面给出官方文档推荐的 ElasticsearchClient.of(...) 写法；
 * 不同小版本在 builder 方法名上可能有差异（如 serverUrl / restClient），
 * 以你所用版本官方文档为准。
 */
public class NaiveRagDemo {

    interface RagAssistant {
        String chat(String message);
    }

    public static void main(String[] args) {
        String apiKey = System.getenv("AI_DASHSCOPE_API_KEY");

        // 1) 嵌入模型：DashScope 的 text-embedding-v3（和前面章节一致）
        OpenAiEmbeddingModel embeddingModel = OpenAiEmbeddingModel.builder()
                .baseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1")
                .apiKey(apiKey)
                .modelName("text-embedding-v3")
                .build();

        // 2) 向量库：Elasticsearch（本专栏唯一允许）
        //    下面用官方推荐的 ElasticsearchClient 创建方式；
        //    host() 与 apiKey() 的具体写法请对齐你所用版本的官方文档。
        var esClient = dev.langchain4j.store.embedding.elasticsearch.ElasticsearchClient.of(
                ec -> ec.host("http://localhost:9200").apiKey(apiKey));
        EmbeddingStore embeddingStore = ElasticsearchEmbeddingStore.builder()
                .client(esClient)
                .indexName("ai-knowledge")
                .build();

        // 3) 数据入库（ETL）：读文档 → 切分 → 嵌入 → 写 ES
        List<Document> docs = FileSystemDocumentLoader.loadDocuments("/path/to/手册.pdf");
        // DocumentSplitters.recursive(chunkSize, overlap) 做递归切分，带重叠避免语义割裂
        var segments = DocumentSplitters.recursive(500, 50).splitAll(docs);
        List<Embedding> embeddings = embeddingModel.embedAll(segments).content();
        embeddingStore.addAll(embeddings, segments);

        // 4) 检索器：用 ES 做向量相似检索
        ContentRetriever retriever = EmbeddingStoreContentRetriever.builder()
                .embeddingStore(embeddingStore)
                .embeddingModel(embeddingModel)
                .maxResults(5)        // 取前 5 条
                .minScore(0.75)       // 相似度阈值，过滤不相关
                .build();

        // 5) 聊天模型
        OpenAiChatModel chatModel = OpenAiChatModel.builder()
                .baseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1")
                .apiKey(apiKey)
                .modelName("qwen-plus")
                .build();

        // 6) 把检索器挂到 AiServices，即开启 Naive RAG
        RagAssistant assistant = AiServices.builder(RagAssistant.class)
                .chatModel(chatModel)
                .contentRetriever(retriever)
                .build();

        System.out.println(assistant.chat("我们的退款政策是怎样的？"));
    }
}
```

### 5.3 Advanced RAG（生产级管道）

当 Naive RAG 检索质量不够时，用 `RetrievalAugmentor` 把"查询转换、多源检索、重排序、注入"等模块自由组合。

```java
// 思路示意（具体类名以所用版本文档为准）：
// RetrievalAugmentor augmentor = DefaultRetrievalAugmentor.builder()
//         .contentRetriever(retriever)                 // 检索
//         .contentAggregator(ReRankingContentAggregator.builder()
//                 .scoringModel(scoringModel).build()) // 重排序
//         .build();
// AiServices.builder(RagAssistant.class)
//         .chatModel(chatModel)
//         .retrievalAugmentor(augmentor)
//         .build();
```

三档对比速记：

| 档位 | 配置量 | 你能控制什么 | 适合 |
| --- | --- | --- | --- |
| Easy | 几乎零 | 基本不能调 | 概念验证、快速试水 |
| Naive | 中等 | 嵌入模型、切分、检索参数 | 大多数业务 RAG |
| Advanced | 高 | 查询转换、重排、多源、注入 | 对召回质量有硬性要求 |

## 六、Streaming 回调

LangChain4j 的流式通过接口方法返回 `TokenStream` 实现。你可以注册"每来一个 token""完成""出错"等回调，做出打字机效果。

`src/main/java/com/example/ai/langchain4j/StreamingDemo.java`

```java
package com.example.ai.langchain4j;

import dev.langchain4j.model.openai.OpenAiStreamingChatModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.TokenStream;

/**
 * 流式输出示例。
 *
 * 关键点：接口方法返回 TokenStream，配合 streamingChatModel 使用。
 */
public class StreamingDemo {

    interface StreamingAssistant {
        TokenStream chat(String message);
    }

    public static void main(String[] args) {
        // 流式模型：换 OpenAiStreamingChatModel，其余参数和普通模型一致
        OpenAiStreamingChatModel model = OpenAiStreamingChatModel.builder()
                .baseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1")
                .apiKey(System.getenv("AI_DASHSCOPE_API_KEY"))
                .modelName("qwen-plus")
                .build();

        StreamingAssistant assistant = AiServices.builder(StreamingAssistant.class)
                .streamingChatModel(model)
                .build();

        // 启动流式：每收到一个 token 就打印，完成/出错各有回调
        assistant.chat("用三句话介绍 Spring AI")
                .onNext(System.out::print)                         // 逐 token
                .onCompleteResponse(r ->
                        System.out.println("\n[完成] token=" + r.tokenUsage().totalTokenCount()))
                .onError(Throwable::printStackTrace)
                .start();                                          // 别忘了 start()
    }
}
```

::: tip 和 Spring AI 流式的对照
- LangChain4j：`TokenStream` + 回调（`onNext/onCompleteResponse/onError`），或换成 `Flux<String>`（需 `langchain4j-reactor`）。
- Spring AI：`.stream().content()` 返回 `Flux<String>`，配 SSE。
- 两者体验等价，只是 API 形态不同：一个是"回调式"，一个是"响应式流"。
:::

## 七、和 Spring AI 的横向选型对比表（重点）

这是你做决策最直接的依据。逐项对照：

| 维度 | Spring AI | LangChain4j |
| --- | --- | --- |
| **官方定位** | Spring 官方出品，AI 应用抽象层 | 社区驱动的 Java LLM 框架（类 LangChain） |
| **编程风格** | 链式 fluent（`ChatClient`），偏过程 | 声明式接口（`AiServices`），偏契约 |
| **Spring 集成** | 天然一等公民，starter 自动配置 | 有 Spring Boot starter，但也能纯 Java 用 |
| **抽象粒度** | 偏底层，积木清晰，可控性强 | 偏高层，封装多，少写样板 |
| **模型覆盖** | 官方维护主流模型 starter | 社区维护，模型/向量库集成数量更庞大 |
| **向量库** | 官方维护主流向量库 starter | 社区集成更多（含本专栏用的 Elasticsearch） |
| **Agent / Graph** | 由 Spring AI Alibaba 提供 ReactAgent / Graph | 自带 Agent / 多 Agent 玩法，较成熟 |
| **中文资料/社区** | 国内有 Spring AI Alibaba 团队与文档 | 英文为主，中文资料相对少 |
| **可移植性** | 通用接口屏蔽厂商，换模型改配置 | 同样可移植，但 API 风格差异大 |
| **学习曲线** | 懂 Spring 上手快 | 概念稍多（AiServices/记忆/检索器） |
| **适合谁** | 已有 Spring Boot 项目、要可控、跟 SAA 生态 | 想少写样板、纯 Java、或看中其 Agent 玩法 |

::: tip 一句话决策
- 你的项目是 **Spring Boot**，且后续要跟 **Spring AI Alibaba**（ReactAgent / Graph / 三层架构，本专栏 07~18 章）走 → **选 Spring AI**，没有悬念。
- 你想要**极简声明式代码**、**纯 Java（非 Spring）**、或特别看重 LangChain4j 的某些 Agent 能力 → 可以考虑 **LangChain4j**。
- 两者底层能力（对话、记忆、工具、RAG、流式）是**对等**的，迁移成本主要在 API 风格，不在能力本身。
:::

## 八、什么时候该选它（场景建议）

结合上面这张表，给几条明确建议：

1. **默认跟我走 SAA 路线**：本专栏从 07 章起全部基于 Spring AI Alibaba，用的是 Spring AI 这套抽象。除非你有强烈理由，否则继续用 Spring AI，避免两套框架混用带来的认知和维护成本。
2. **选 LangChain4j 的合理场景**：
   - 团队不想引入 Spring，或项目是 Quarkus / 纯 Java 服务。
   - 你特别喜欢 `AiServices` 那种"定义接口就行"的开发体验。
   - 你需要 LangChain4j 社区里某个 Spring AI 暂时没覆盖的集成/玩法。
3. **不要混用**：同一个项目里同时依赖 Spring AI 和 LangChain4j 去干同一件事，会显著增加依赖体积和理解成本。选定一套贯彻到底。
4. **能力无代差**：记住，两者都能做流式、工具、RAG、记忆。**选哪个是工程风格与生态问题，不是"能不能做"的问题。**

::: warning 版本提示
LangChain4j 迭代很快，类名/包名在不同 1.x 小版本间有变动（例如 Elasticsearch 客户端 builder 方法、嵌入模型类名）。**动手前先按"包名 + 类名"查官方文档**，不要凭记忆。涉及 `ElasticsearchClient.of(...)`、`ElasticsearchEmbeddingStore`、`OpenAiStreamingChatModel` 等，本文已尽量对齐主流 1.x，但请以你所用版本为准。
:::

## 本篇小结

- **LangChain4j 是 Java 版 LangChain**，与 Spring AI 同层级竞争：一个偏"Spring 链式"，一个偏"声明式接口"。
- **AiServices 是招牌**：定义接口 + 注解，框架动态生成实现，自动处理拼提示词、解析响应、接记忆/工具/RAG。
- **记忆**用 `MessageWindowChatMemory` + `@MemoryId` 区分用户；**工具**用 `@Tool` + `@P` 再 `.tools(...)` 注册。
- **RAG 三档**：Easy（零配置，但本教程不用其内存库）、Naive（自管嵌入/切分/ES 检索）、Advanced（`RetrievalAugmentor` 自由组合）。向量库一律用 Elasticsearch。
- **流式**用 `TokenStream` + 回调，或换 `Flux<String>`（需 reactor 模块）。
- **选型**：Spring Boot + 跟 SAA 路线 → Spring AI；纯 Java / 爱声明式 / 特定集成 → LangChain4j。两者能力对等，别混用。

## 参考链接

- LangChain4j 官方文档：<https://docs.langchain4j.dev/>
- LangChain4j AI Services：<https://docs.langchain4j.dev/tutorials/ai-services>
- LangChain4j Elasticsearch 集成：<https://docs.langchain4j.dev/integrations/embedding-stores/elasticsearch>
- LangChain4j RAG 文档：<https://docs.langchain4j.dev/tutorials/rag>
- Spring AI 官方文档（对照）：<https://docs.spring.io/spring-ai/reference/

下一篇 → [07 概览与三层架构](/java/saa/intro)
