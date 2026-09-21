# 05 Spring AI 框架

> Spring AI 是 Spring AI Alibaba 的底座。搞懂它的抽象，后面所有内容（包括 SAA 的 Agent、Graph、RAG）才真正通。这一章是一张"地图"。

## 本篇要解决的问题

前三章我们一直在用 Spring AI 写代码，但都是"遇到什么用什么"。这一章停下来，把 Spring AI 提供的**核心抽象**系统过一遍：

- 为什么我们要在模型上面再套一层框架？（换模型不改代码）
- `ChatModel` 和 `ChatClient` 到底啥区别，什么时候用哪个？
- 消息、选项、记忆、向量、工具、ETL 各自是什么、怎么串起来？
- 这张地图，对应本专栏后面哪些章节？

读完后，你再看 07 章的 SAA 三层架构会觉得"哦，原来都是在 Spring AI 这些积木上搭的"。

## 一、定位：AI 应用领域的 JDBC

回想 JDBC：不管底层是 MySQL、Oracle 还是 PostgreSQL，**你的业务代码都只面向 `Connection`/`PreparedStatement` 接口写**，换数据库只换驱动 jar，代码不动。

Spring AI 想做的正是同一件事，只不过抽象的对象从"数据库"换成了"大模型"：

```text
你的业务代码
     │  只面向 ChatModel / ChatClient 接口
     ▼
┌──────────────────────────────┐
│  Spring AI 抽象层             │  ← 本章讲的就是这一层
└──────────────────────────────┘
     │  不同 starter 提供不同实现
     ▼
┌──────────┬──────────┬──────────────┐
│ DashScope│ OpenAI   │ Ollama / 本地 │  ← 换模型只换依赖和配置
└──────────┴──────────┴──────────────┘
```

::: tip 为什么需要这层抽象
- **换模型不改代码**：今天用 qwen-plus，明天换 qwen-max 或 DeepSeek，只改 `application.yml` 的 `model` 和依赖，业务代码一行不动。
- **统一能力集**：不管是哪个厂商，对话、 Embedding、向量检索、工具调用、结构化输出都长一个样，不用为每个模型学一套 SDK。
- **工程化能力内建**：重试、记忆、拦截器（Advisor）、可观测，都是框架层的共性需求，写一次处处可用。
:::

## 二、核心抽象一览

先给一张总表，后面逐个展开：

| 抽象 | 接口 / 类名 | 一句话职责 |
| --- | --- | --- |
| 底层对话 | `ChatModel` | 最朴素的"发 Prompt 拿回复"，一个 `call()` 方法 |
| 高级对话 | `ChatClient` | 流式、记忆、工具、结构化输出的 fluent 门面 |
| 消息 | `Message`（System/User/Assistant/Tool） | 提示词的角色化载体 |
| 提示词 | `Prompt` / `PromptTemplate` | 一组消息 + 模板渲染 |
| 模型参数 | `ChatOptions` | temperature、maxTokens、model 等通用参数 |
| 对话记忆 | `ChatMemory` + `Advisor` | 多轮上下文的读写与拦截 |
| 嵌入模型 | `EmbeddingModel` | 把文本变成向量 |
| 向量存储 | `VectorStore` | 存向量、做相似度检索（本专栏统一用 ES） |
| 工具调用 | `Tool` / `ToolCallback` | 让模型调你的 Java 方法 |
| 结构化输出 | `StructuredOutputConverter` | 把文本变成强类型对象 |
| 数据管道 | ETL（`DocumentReader/Transformer/Writer`） | 把文档切分、向量化、入库（RAG 前置） |

## 三、ChatModel 与 ChatClient

这是最容易混淆的一对。记住一句话：**`ChatModel` 是地基，`ChatClient` 是在地基上盖的好用的房子。**

### 3.1 ChatModel：最朴素的抽象

`org.springframework.ai.chat.model.ChatModel` 只定义两件最基本的事：

```java
public interface ChatModel {
    ChatResponse call(Prompt prompt);   // 同步，一次性返回完整结果
    Flux<ChatResponse> stream(Prompt prompt);  // 流式
}
```

它只认 `Prompt`，只返回 `ChatResponse`。没有记忆、没有工具、没有流式门面——一切都要你手搓。但正因如此，**写库、写底层扩展、做适配时它最干净**。

`src/main/java/com/example/ai/framework/ChatModelDemo.java`

```java
package com.example.ai.framework;

import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;

import java.util.List;

/**
 * 直接用最底层的 ChatModel 调用。
 *
 * 适用场景：需要精细控制、写框架扩展、或极简工具类。
 * 日常业务开发更推荐用 ChatClient（见下）。
 */
public class ChatModelDemo {

    private final ChatModel chatModel;

    public ChatModelDemo(ChatModel chatModel) {
        this.chatModel = chatModel;
    }

    public String ask(String question) {
        // 手动拼 system + user 两条消息
        SystemMessage system = new SystemMessage("你是一个简洁的 Java 助手。");
        UserMessage user = new UserMessage(question);
        Prompt prompt = new Prompt(List.of(system, user));

        // call 返回 ChatResponse，需要自己往下取文本
        ChatResponse response = chatModel.call(prompt);
        return response.getResult().getOutput().getText();
    }
}
```

### 3.2 ChatClient：日常开发的主角

`org.springframework.ai.chat.client.ChatClient` 是流式 API 门面，把记忆、工具、结构化输出、Advisor 都做成了链式方法。02~04 章我们全用它。

`src/main/java/com/example/ai/framework/ChatClientDemo.java`

```java
package com.example.ai.framework;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatResponse;

/**
 * ChatClient 的几种常用写法。
 * ChatClient.Builder 由 Spring Boot 自动配置注入，无需自己创建。
 */
public class ChatClientDemo {

    private final ChatClient chatClient;

    public ChatClientDemo(ChatClient.Builder builder) {
        this.chatClient = builder
                .defaultSystem("你是一个务实的 Java 架构师。")
                .build();
    }

    /** 1) 拿纯文本 */
    public String text(String q) {
        return chatClient.prompt().user(q).call().content();
    }

    /** 2) 拿完整响应（含 token 用量、模型名） */
    public ChatResponse full(String q) {
        return chatClient.prompt().user(q).call().chatResponse();
    }

    /** 3) 流式（返回 Flux<String>） */
    public reactor.core.publisher.Flux<String> stream(String q) {
        return chatClient.prompt().user(q).stream().content();
    }

    /** 4) 结构化输出（强类型对象） */
    public Recipe recipe(String dish) {
        return chatClient.prompt()
                .user(u -> u.text("给出「{dish}」的菜谱").param("dish", dish))
                .call()
                .entity(Recipe.class);
    }

    /** 结构化输出用的目标类型 */
    public record Recipe(String name, java.util.List<String> steps, int minutes) {}
}
```

::: tip 选型口诀
写库/底层扩展 → 用 `ChatModel`；几乎一切业务开发 → 用 `ChatClient`。本专栏从 07 章起的 SAA 高层 API，最终也都是委托给这两者之一，换汤不换药。
:::

## 四、Message 与 Prompt

01、03 章提过三种角色消息，这里把类型补全。Spring AI 用 `Message` 接口统一，按角色分实现：

| 角色 | 实现类 | 包 |
| --- | --- | --- |
| system | `SystemMessage` | `org.springframework.ai.chat.messages` |
| user | `UserMessage` | 同上 |
| assistant | `AssistantMessage` | 同上 |
| tool | `ToolResponseMessage` | 同上（Function Calling 回传结果用） |

`Prompt`（`org.springframework.ai.chat.prompt.Prompt`）就是把一组 `Message` 装在一起，外加可选的 `ChatOptions`。它本质上就是 02 章说的"完整请求体"的 Java 表达。

```java
// 手动构建一个带 system + user 的 Prompt
Prompt prompt = new Prompt(
        List.of(
            new SystemMessage("你是一个翻译官。"),
            new UserMessage("把下面翻译成英文：今天天气真好")
        )
);
```

`PromptTemplate`（`org.springframework.ai.chat.prompt.PromptTemplate`）负责模板渲染，把 `{变量}` 替换成实际值，并可与 classpath 资源文件配合（详见 03 章第七节）。这些拼装能力，ChatClient 的内部其实也是在用它们。

## 五、ChatOptions：控制生成行为

`ChatOptions`（`org.springframework.ai.chat.prompt.ChatOptions`）是跨厂商的**通用**参数接口：model、temperature、maxTokens、topP、topK、stopSequences 等。各厂商还有自己的实现（如 `DashScopeChatOptions`、`OpenAiChatOptions`）暴露独有参数。

它有三层作用域，越靠近调用越优先：

```java
// 1) 全局：写在 application.yml（最外层）
// 2) 客户端级：ChatClient.Builder.defaultOptions(...)
// 3) 请求级：单次调用覆盖（最常用）
chatClient.prompt()
        .user("把这个工单分类为 BILLING / TECHNICAL / GENERAL")
        .options(org.springframework.ai.chat.prompt.ChatOptions.builder()
                .temperature(0.0)     // 分类要确定性，温度设 0
                .maxTokens(10)
                .build())
        .call()
        .content();
```

::: tip 为什么要分层
一个服务里，分类接口要 temperature=0，创意文案接口要 temperature=0.9。用请求级 `options(...)` 覆盖默认值，就不用建两个 ChatClient 了。
:::

## 六、ChatMemory 与 Advisor 拦截器链

多轮对话、RAG、日志、安全……这些"在调用模型前后插入的逻辑"，Spring AI 统一用 **Advisor（拦截器）** 实现，和 Spring 的 AOP 思想一致。`ChatMemory` 则负责"记什么、记多少"。

### 6.1 ChatMemory：会话记忆

`org.springframework.ai.chat.memory.ChatMemory` 定义"按会话 ID 存消息"。最常用实现是 `MessageWindowChatMemory`——只保留最近 N 条，防止上下文无限膨胀。

### 6.2 Advisor：拦截器链

Advisor 是 Spring AI 的"切面"。比如 `MessageChatMemoryAdvisor` 就是"自动读写记忆"的 Advisor；后面 RAG 的 `QuestionAnswerAdvisor` 也是 Advisor。多个 Advisor 串成链，在请求发往模型前/后依次生效。

`src/main/java/com/example/ai/framework/MemoryConfig.java`

```java
package com.example.ai.framework;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.MessageChatMemoryAdvisor;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.memory.InMemoryChatMemoryRepository;
import org.springframework.ai.chat.memory.MessageWindowChatMemory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 记忆配置 + 在 ChatClient 上挂 Advisor。
 */
@Configuration
public class MemoryConfig {

    /** 基于内存的会话记忆：最多保留最近 20 条消息，超出丢弃最早的 */
    @Bean
    public ChatMemory chatMemory() {
        return MessageWindowChatMemory.builder()
                .chatMemoryRepository(new InMemoryChatMemoryRepository())
                .maxMessages(20)
                .build();
    }

    /** 把记忆 Advisor 挂到 ChatClient 上 */
    @Bean
    public ChatClient memoryChatClient(ChatClient.Builder builder, ChatMemory chatMemory) {
        return builder
                .defaultAdvisors(
                        MessageChatMemoryAdvisor.builder(chatMemory).build()
                )
                .build();
    }
}
```

使用时每次传会话 ID，框架自动隔离不同用户的历史：

```java
// 在 Controller 里：.advisors(spec -> spec.param(ChatMemory.CONVERSATION_ID, sessionId))
```

::: warning 记忆的代价
`InMemoryChatMemoryRepository` 重启即丢、且无法多实例共享。生产环境应换成持久化实现（如基于 Redis / JDBC 的 `ChatMemory`），否则多副本部署会"串台"或丢失历史。具体持久化实现类名以你所用版本官方文档为准。
:::

## 七、EmbeddingModel 与 VectorStore

这两位是 RAG（19、20 章）的基石。先建立直觉：**Embedding 把文字变成一串数字（向量），语义相近的文字向量也相近；VectorStore 负责存这些向量并做"找最近邻"的检索。**

### 7.1 EmbeddingModel：文本 → 向量

`org.springframework.ai.embedding.EmbeddingModel`，核心方法 `float[] embed(String text)`（及批量版本）。

`src/main/java/com/example/ai/framework/EmbeddingDemo.java`

```java
package com.example.ai.framework;

import org.springframework.ai.embedding.EmbeddingModel;

/**
 * Embedding 直观演示：两段语义相近的话，向量距离更近。
 */
public class EmbeddingDemo {

    private final EmbeddingModel embeddingModel;

    public EmbeddingDemo(EmbeddingModel embeddingModel) {
        this.embeddingModel = embeddingModel;
    }

    public void show() {
        float[] v1 = embeddingModel.embed("如何重置我的密码");
        float[] v2 = embeddingModel.embed("忘记密码了怎么找回");
        float[] v3 = embeddingModel.embed("今天天气真好");

        System.out.println("密码相关两句的相似度: " + cosine(v1, v2)); // 较高
        System.out.println("密码句与天气句的相似度: " + cosine(v1, v3)); // 较低
    }

    /** 余弦相似度：值越接近 1 越相似 */
    private float cosine(float[] a, float[] b) {
        float dot = 0, na = 0, nb = 0;
        for (int i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        return dot / (float) (Math.sqrt(na) * Math.sqrt(nb));
    }
}
```

### 7.2 VectorStore：向量存储与检索（统一用 Elasticsearch 8.x）

本专栏**强制只使用 Elasticsearch 8.x**，禁止把 pgvector、Milvus、Redis、Chroma、SimpleVectorStore 当作示例代码（选型对比里可以提一句为什么不选，但示例代码一律 ES）。

用 `spring-ai-starter-vector-store-elasticsearch` 自动配置最简单——你只要声明依赖和配置，Spring Boot 直接给你一个 `VectorStore` Bean，不用碰底层 `RestClient`。

依赖片段（pom.xml）：

```xml
<!-- Elasticsearch 向量存储 starter：自动配置 VectorStore Bean -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-vector-store-elasticsearch</artifactId>
</dependency>
<!-- elasticsearch-java 客户端（Spring AI 1.1.x 对版本有要求，按官方文档对齐） -->
<dependency>
    <groupId>co.elastic.clients</groupId>
    <artifactId>elasticsearch-java</artifactId>
    <version>8.13.3</version>
</dependency>
```

`application.yml` 配置片段：

```yaml
spring:
  elasticsearch:
    uris: http://localhost:9200
    username: elastic
    password: changeme
  ai:
    vectorstore:
      elasticsearch:
        initialize-schema: true   # 首次自动建索引，生产可改为手动
        index-name: ai-knowledge # 向量索引名
        dimensions: 1024          # 必须和你用的 embedding 模型维度一致（text-embedding-v3 默认 1024）
        similarity: cosine        # 相似度算法
```

使用示例：

`src/main/java/com/example/ai/framework/VectorStoreDemo.java`

```java
package com.example.ai.framework;

import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;

import java.util.List;
import java.util.Map;

/**
 * VectorStore 基本用法：存文档、按语义检索。
 *
 * 这里直接注入 Spring Boot 自动配置好的 VectorStore（背后是 Elasticsearch 实现）。
 */
public class VectorStoreDemo {

    private final VectorStore vectorStore;

    public VectorStoreDemo(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    /** 入库：把几段知识存成 Document（自动向量化） */
    public void save() {
        List<Document> docs = List.of(
                new Document("Spring AI 是 Spring 官方 AI 应用框架，提供模型抽象。",
                             Map.of("source", "doc1")),
                new Document("Elasticsearch 8.x 可用作向量数据库，支持 kNN 检索。",
                             Map.of("source", "doc2"))
        );
        vectorStore.add(docs);
    }

    /** 检索：返回和 query 语义最相近的 Top-K */
    public List<Document> search(String query) {
        return vectorStore.similaritySearch(
                SearchRequest.builder().query(query)
                        .topK(3)                       // 取前 3 条
                        .similarityThreshold(0.7)       // 相似度阈值，过滤不相关
                        .build()
        );
    }
}
```

::: warning dimensions 必须对齐
`dimensions` 必须等于你所用 embedding 模型的输出维度。例如 DashScope 的 `text-embedding-v3` 默认 1024 维；如果配错，建索引或写入时会直接报错。**这是 ES 向量库最高频的坑。**

手动构建 `ElasticsearchVectorStore` 需要传入 ES 客户端（`org.springframework.ai.vectorstore.elasticsearch.ElasticsearchVectorStore`，通过 `ElasticsearchVectorStore.builder(restClient, embeddingModel)`）。不同 1.1.x 小版本对 `restClient` 的类型（旧版 `org.elasticsearch.client.RestClient` 或新版 `Rest5Client`）可能有差异，**手动构建时请以你所用版本的官方文档为准**。日常开发走上面的 starter 自动配置即可避开这个细节。
:::

## 八、Tool 与 Advisor（工具调用 + 拦截）

Tool Calling（Function Calling）在 04 章已完整实操。这里把它放进"框架地图"里定位：

- **声明**：`@Tool`（包 `org.springframework.ai.tool.annotation.Tool`）或 `FunctionToolCallback`。
- **注册**：`ToolCallbackProvider`（如 `MethodToolCallbackProvider`），或 `ChatClient` 的 `.tools()` / `.toolCallbacks()` / `.defaultToolCallbacks()`。
- **执行**：框架内置 `ToolCallingManager` 负责"模型决定调用 → 执行 → 回传 → 二次生成"的闭环。
- **拦截**：工具调用过程也可被 Advisor 观测/干预（例如记录每次工具调用的耗时）。

它和 Advisor 是并列的两类扩展点：**Advisor 改"流程"（记忆、RAG、日志），Tool 给模型加"能力"（查数据、做动作）**。两者常常一起用——比如一个带记忆、又能查订单的 Agent。

## 九、结构化输出

03 章已讲 `BeanOutputConverter` 与 `.entity()`。从框架地图角度，它属于 `StructuredOutputConverter` 体系（`org.springframework.ai.converter` 包），把"文本 → 强类型对象"这件事标准化了。除了 `BeanOutputConverter`，还有 `MapOutputConverter`、`ListOutputConverter` 等，原理一致。这部分不再赘述，详见 03 章第六节。

## 十、ETL Pipeline 概览（RAG 的数据准备）

RAG 不是上来就检索，得先把你的私有文档"切好、向量化、入库"。Spring AI 把这条链路抽象成经典的 **ETL（Extract-Transform-Load）**：

```text
Extract（抽取）  →  Transform（切分/富化）  →  Load（向量化入库）
读文档(PDF/Word/   TokenTextSplitter 把长文    VectorStore.accept(...)
TXT/HTML)          切成小块（适配上下文窗口）
```

三个核心接口，正好对应函数式编程的三个原型：

| 阶段 | 接口 | 行为 | 常见实现 |
| --- | --- | --- | --- |
| Extract | `DocumentReader`（Supplier） | 读取源文档 → `List<Document>` | `TikaDocumentReader`、`TextReader`、`JsonReader` |
| Transform | `DocumentTransformer`（Function） | 切分/加元数据 | `TokenTextSplitter`、`KeywordMetadataEnricher` |
| Load | `DocumentWriter`（Consumer） | 写入向量库 | `VectorStore`（它本身实现 `DocumentWriter`，`accept(...)` 即写入） |

`src/main/java/com/example/ai/framework/EtlDemo.java`

```java
package com.example.ai.framework;

import org.springframework.ai.document.Document;
import org.springframework.ai.reader.tika.TikaDocumentReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.core.io.ClassPathResource;

import java.util.List;

/**
 * ETL 管道示例：读 PDF/Word/HTML → 切分 → 入库。
 *
 * 依赖（任选其一）：
 *   - spring-ai-tika-document-reader：用 Apache Tika 读各种格式（推荐，覆盖面广）
 */
public class EtlDemo {

    private final VectorStore vectorStore;

    public EtlDemo(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    /** 一行式 ETL：读 → 切 → 写 */
    public void ingest(String resourcePath) {
        // E（抽取）：TikaDocumentReader 支持 PDF / Word / PPT / HTML 等几十种格式
        TikaDocumentReader reader =
                new TikaDocumentReader(new ClassPathResource(resourcePath));
        List<Document> rawDocs = reader.read();

        // T（变换）：按 token 切分，避免单块超过模型上下文窗口
        // 默认构造使用框架推荐的分块参数；需要调优可用 builder/构造函数设置 chunkSize、overlap
        TokenTextSplitter splitter = new TokenTextSplitter();
        List<Document> chunks = splitter.apply(rawDocs);

        // L（加载）：VectorStore 实现了 DocumentWriter，accept 即自动向量化并入库
        vectorStore.accept(chunks);
    }
}
```

::: tip ETL 之后才有 RAG
ETL 产出的是"向量化的知识块"。真正回答问题时，再把用户问题向量化、去 ES 里检索 Top-K、塞进提示词让模型作答——那部分在 19、20 章。ETL 就是 RAG 的"食材准备"阶段。
:::

::: warning 依赖与类名版本差异
- 文档读取器分散在独立 starter：`spring-ai-tika-document-reader`（Tika 多格式）、`spring-ai-pdf-document-reader`（PDF 专用）等，按格式引入。
- `TokenTextSplitter` 的构造参数/builder 方法名在不同小版本略有差异，调优分块时以你所用版本官方文档为准；默认构造一般可用。

官方 ETL 文档：<https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html>
:::

## 十一、版本现状与设计哲学

Spring AI 目前迭代很快（本专栏基于 1.1.2）。它的设计哲学可以概括为三点：

1. **可移植优先**：通用接口（`ChatModel`/`ChatOptions`/`VectorStore`/`EmbeddingModel`）屏蔽厂商差异，厂商专属能力放到各自子接口里，不破坏可移植性。
2. **分层**：`ChatModel`（裸）↔ `ChatClient`（门面）↔ Advisor（切面）↔ Starter（自动配置），每一层都可单独替换或扩展。
3. **约定优于配置**：引入 starter + 写 yml，Bean 自动就绪；需要定制度再往下钻到 Builder / 底层接口。

::: warning 跟紧版本
Spring AI 的 API 演进快（你看到的 1.1.x 与更早的 1.0.x 在类名、包名上就有变动）。**任何你不确定签名的 API，先去官方文档按"包名 + 类名"查，不要凭记忆。** 本专栏所有示例已尽量对齐 1.1.2，但你升级版本时务必复核。
:::

## 十二、这张地图对应本专栏后面哪些章节

把上面这些抽象，和你接下来要读的内容对上号，学习成本会再降一截：

| 本专栏后续章节 | 用到的 Spring AI 抽象 | 关系说明 |
| --- | --- | --- |
| 07 概览与三层架构 | 全部（Augmented LLM 层） | SAA 的底层就是这些原子能力 |
| 10 ReactAgent / 18 Tool 与 MCP | `ChatModel` / Tool Calling / Advisor | Agent 的"思考-行动"循环建立在工具调用之上 |
| 12 上下文工程 | `ChatMemory` / `MessageWindowChatMemory` | 如何在有限窗口里塞最重要信息 |
| 17 模型接入 | `ChatModel` / `ChatOptions` | 不同模型的连接与参数 |
| 19~20 RAG 与向量检索 | `EmbeddingModel` / `VectorStore` / ETL | 本章第七、十节就是 RAG 的地基 |
| 21 可观测 | Advisor / `ChatResponse` 元数据 | 用拦截器统一采集 token 与耗时 |

::: tip 一句话收尾
**Spring AI 是一盒标准积木**：`ChatModel`/`ChatClient` 是对话，Message/Prompt 是输入，ChatOptions 是旋钮，Memory/Advisor 是流程扩展，Embedding/VectorStore/ETL 是 RAG 地基，Tool 是能力扩展。后面 SAA 的所有高级玩法，都是在 rearrange 这些积木。
:::

## 本篇小结

- **Spring AI = AI 领域的 JDBC**：面向统一接口写代码，换模型只换 starter + 配置。
- **`ChatModel` 是地基（一个 `call()`），`ChatClient` 是门面（流式/记忆/工具/结构化全链式）**；业务开发主用 ChatClient。
- **消息角色** system/user/assistant/tool 由 `Message` 体系统一表达；`Prompt` = 消息组 + 可选选项。
- **`ChatOptions` 分层**（全局/客户端/请求）控制 temperature、maxTokens 等。
- **`ChatMemory` + Advisor** 是流程扩展的两大支柱：记忆存上下文，Advisor 在前后插入逻辑（RAG、日志等）。
- **`EmbeddingModel` + `VectorStore`（ES 8.x）+ ETL** 构成 RAG 地基：向量化、存向量、切分入库。
- **Tool Calling** 给模型加"动手"能力；**结构化输出**把文本变强类型对象。
- 所有抽象在 07 章起的 SAA 三层架构里被重新组织，本章就是它们的"地图"。

## 参考链接

- Spring AI 官方文档（总览）：<https://docs.spring.io/spring-ai/reference/>
- Spring AI ChatModel / ChatClient：<https://docs.spring.io/spring-ai/reference/api/chatclient.html>
- Spring AI Vector Stores（Elasticsearch）：<https://docs.spring.io/spring-ai/reference/api/vectordbs/elasticsearch.html>
- Spring AI ETL Pipeline：<https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html>
- Spring AI Alibaba 官网：<https://java2ai.com/>

下一篇 → [06 LangChain4j 框架](/java/ai/langchain4j)
