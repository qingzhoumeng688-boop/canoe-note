# 19 RAG 检索增强

> 给应用接上"外部记忆"：用 Elasticsearch 同时承担本地与云端的向量检索，把私有知识喂给大模型，让它"看着材料答题"。本篇从原理比喻讲起，到一份能直接复制运行的完整工程。

## 本篇要解决的问题

大模型有三个绕不开的毛病：**知识有截止日期**（不知道昨天发生的事）、**不知道你的私有数据**（公司制度、产品手册它没见过）、**一本正经地编**（没有依据也能洋洋洒洒写一段）。

RAG（Retrieval Augmented Generation，检索增强生成）就是标准解法：在模型生成答案**之前**，先把相关资料从你的知识库里检索出来，塞进提示词，让模型"照着材料回答"。

本篇统一采用 **Elasticsearch 8.x 作为向量库**：本地开发用 Docker 起一个 ES，线上换成阿里云 Elasticsearch，索引结构和代码几乎不动，只改连接配置。

::: tip 前置说明
本篇从 SAA 接入的角度讲 RAG。如果你对「文档切分 → 向量化 → 相似度检索」完全没概念，建议先补习一下基础向量检索原理再回看，会顺畅很多。但即使没基础，本篇的比喻和代码也足够让你跑通第一个 RAG 应用。
:::

## 一、先搞懂 RAG 到底在解决什么：开卷 vs 闭卷

### 1.1 一个比喻

把大模型想象成一个**参加考试的学霸**。

- **闭卷考试（不用 RAG）**：试卷发下来，只能靠自己脑子里的东西答题。学霸脑子好，通识题答得不错，但遇到"你们公司 2024 年差旅报销标准是多少"这种题 —— 它没见过你们公司的制度，又必须给出答案，于是**开始编**。这就是"幻觉"。
- **开卷考试（用 RAG）**：考前你塞给它一本《公司制度汇编》，并告诉它"答题时先翻书，书里有的照书答，书里没有的就说不知道"。这时它回答"差旅报销市内交通每天上限 80 元"，是**有据可查**的。

```text
不用 RAG（闭卷）                   用 RAG（开卷）
用户问："报销标准？"              用户问："报销标准？"
   │                                 │
   ▼                                 ▼
直接问大模型（只靠记忆）          ① 先去 ES 里翻制度文档
   │                                 │
   ▼                                 ▼
可能瞎编一个数字                  ② 把命中的原文拼进提示词
                                     │
                                     ▼
                                  ③ 带着材料问大模型
                                     │
                                     ▼
                                  照着材料给出有依据的答案
```

### 1.2 不 RAG 会怎样

具体到工程里，不接 RAG 至少有三个致命问题：

| 问题 | 表现 | 后果 |
| --- | --- | --- |
| 知识过期 | 模型只学到训练截止日之前的世界 | 问最新政策、最新价格，答的是旧信息 |
| 私有数据盲区 | 模型从没见过你的业务文档 | 答非所问，或干脆编造你们"根本没有"的规定 |
| 幻觉 | 没有依据也要凑答案 | 用户信以为真，引发客诉甚至合规风险 |

::: warning RAG 不是银弹
RAG 解决的是"**有没有依据**"的问题。它不能让模型变聪明，也不能修好你切得很烂的文档。后面第 20 章专门讲"回答不准时怎么调"。但先跑通 RAG，你已经消灭了大部分幻觉来源。
:::

## 二、RAG 完整链路：从一份文档到一句答案

很多人被"向量数据库""Embedding"这些词吓退，其实整条链路就是**八个步骤的流水线**。我们先用文字画一遍全貌，后面每步都有对应代码：

```text
【离线入库阶段（只做一次，或文档更新时做）】
① 文档   ── 一份 PDF / Word / 网页 / 数据库导出的文本
② 切分   ── 把长文档切成小块（chunk），比如每块 400 token
③ 向量化 ── 每块文字交给 Embedding 模型，变成一串数字（向量）
④ 存入ES ── 向量 + 原文 + 元数据，写进 Elasticsearch 索引

【在线问答阶段（每次用户提问都走一遍）】
⑤ 用户提问 ── "我们的年假怎么算？"
⑥ 检索     ── 把问题也向量化，去 ES 里找最相似的几块
⑦ 拼提示词 ── 把命中的原文塞进提示词模板
⑧ 生成     ── 大模型带着材料作答
```

关键点：**第 ①② ③ ④ 步是"喂知识"，离线跑；第 ⑤ ⑥ ⑦ ⑧ 步是"用知识"，在线跑。** 很多初学者把两件事混在一起，导致每次提问都重新向量化整个知识库 —— 那是性能灾难。

```text
时间轴
───────────────────────────────────────────────────────
离线：文档 → 切分 → 向量化 → 存 ES        （一次）
在线：提问 → 检索 → 拼提示词 → 生成        （每次）
───────────────────────────────────────────────────────
```

## 三、为什么统一用 Elasticsearch

如果团队里已经有 Elasticsearch，完全没必要再引入一套专门的向量数据库：

- **ES 8.x 原生支持向量**：`dense_vector` 字段类型 + kNN 检索，不需要装任何额外插件。
- **关键词检索和语义检索在一套系统里**：BM25 全文检索照常用，还能和向量检索做 **RRF 融合** —— 这是纯向量库做不到的事（第 20 章详讲）。
- **运维资产复用**：监控、备份、扩容、报警都是现成的。
- **本地和云端是同一个东西**：本地跑 ES 容器，线上换阿里云 Elasticsearch，索引结构一致，迁移成本近乎为零。

| 方案 | 优势 | 劣势 | 本专栏态度 |
| --- | --- | --- | --- |
| **Elasticsearch 8.x** | 关键词 + 向量一体、运维成熟、本地云端同构 | 单节点资源占用略高 | **统一采用** |
| pgvector（PostgreSQL 插件） | 复用已有 PG、事务一致 | 大规模 kNN 性能与运维不如 ES | 可在对比表里提，不写示例 |
| Milvus | 专为向量设计、超大规模友好 | 又引入一套独立系统 | 不写示例 |
| Redis / Chroma / SimpleVectorStore | 上手快 | 生产可靠性、混合检索弱 | **严禁出现在示例代码里** |

::: warning 前提是版本
需要 Elasticsearch **8.x**。7.x 虽然也能存 `dense_vector`，但 kNN 检索能力和性能都不是一个量级。下文所有配置与 mapping 都按 8.x 写。
:::

## 四、本地环境：docker-compose 起一个 ES

开发调试用单节点即可，关掉安全认证省去一堆配置。新建 `docker-compose.yml`：

```yaml
version: "3.8"

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.15.3
    container_name: es-vector
    environment:
      # 单节点模式，适合本地开发，不要用于生产
      - discovery.type=single-node
      # 本地关掉安全认证，省去证书和账号配置的麻烦
      - xpack.security.enabled=false
      # 给 ES 足够堆内存，否则 kNN 检索会非常慢甚至 OOM
      - ES_JAVA_OPTS=-Xms2g -Xmx2g
    ports:
      - "9200:9200"   # REST 端口，Spring AI 连这个
      - "9300:9300"   # 节点间通信端口
    volumes:
      # 把数据挂到宿主机，容器删了数据还在
      - es-data:/usr/share/elasticsearch/data

volumes:
  es-data:
```

启动与验证：

```bash
# 在 docker-compose.yml 所在目录
docker compose up -d

# 返回一段 JSON、里面能看到 "number" : "8.15.3" 说明就绪
curl http://localhost:9200
```

::: tip
`-e "xpack.security.enabled=false"` 只用于本地。任何放到公网或内网共享环境的实例都必须开认证，否则等于把整个知识库敞开给人扫。**生产永远用阿里云 ES 的账号密码 + 白名单方案（见第十一节）。**
:::

## 五、依赖与配置

### 5.1 完整 pom.xml

下面这份 `pom.xml` 是 19、20 两章所有代码的依赖基线，**请整份保存**。重点关注两个容易漏的依赖：`spring-ai-starter-vector-store-elasticsearch`（ES 向量库）和 `spring-ai-rag`（模块化 RAG Advisor，包含 `RetrievalAugmentationAdvisor`）。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">

    <modelVersion>4.0.0</modelVersion>

    <!-- 继承 Spring Boot 父 POM，统一管理 Spring 生态依赖版本 -->
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>saa-rag-demo</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>17</java.version>
        <spring-ai.version>1.1.2</spring-ai.version>
        <spring-ai-alibaba.version>1.1.2.0</spring-ai-alibaba.version>
    </properties>

    <dependencies>
        <!-- Web 能力，提供上传文档和提问的 HTTP 接口 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- DashScope 模型（对话 qwen-plus + Embedding text-embedding-v3） -->
        <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-starter-dashscope</artifactId>
        </dependency>

        <!-- Elasticsearch 向量库 starter：封装 dense_vector 存储与 kNN 检索 -->
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-starter-vector-store-elasticsearch</artifactId>
        </dependency>

        <!-- 模块化 RAG Advisor：RetrievalAugmentationAdvisor 就在这个模块里
             没有它，下面所有 RetrievalAugmentationAdvisor 代码都编译不过 -->
        <dependency>
            <groupId>org.springframework.ai</groupId>
            <artifactId>spring-ai-rag</artifactId>
        </dependency>
    </dependencies>

    <dependencyManagement>
        <dependencies>
            <!-- 两个 BOM 统一管理版本，避免 Spring AI 各模块之间版本冲突 -->
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

::: danger 最容易漏的依赖
`RetrievalAugmentationAdvisor` **不在** `spring-ai-starter-vector-store-elasticsearch` 里，它在独立的 `spring-ai-rag` 模块。Spring AI 1.1.x 把模块化 RAG 组件拆分到了这个模块，必须显式引入，否则 IDE 报"找不到符号 RetrievalAugmentationAdvisor"，还以为是包名写错了。
:::

### 5.2 application.yml

`src/main/resources/application.yml`：

```yaml
spring:
  application:
    name: saa-rag-demo
  elasticsearch:
    # 本地 ES 地址；换云端时只改这一行 + 下面加 username/password
    uris: http://localhost:9200
  ai:
    dashscope:
      # 从环境变量读取，绝不写死在这里
      api-key: ${AI_DASHSCOPE_API_KEY}
      chat:
        options:
          model: qwen-plus
          temperature: 0.7
      embedding:
        options:
          model: text-embedding-v3   # 默认 1024 维
    vectorstore:
      elasticsearch:
        index-name: knowledge-index  # 索引名
        dimensions: 1024            # 必须和 Embedding 模型输出维度一致
        similarity: cosine          # cosine / l2_norm / dot_product
        initialize-schema: true     # 启动时自动建索引 mapping
        embedding-field-name: embedding

server:
  port: 8080

logging:
  level:
    org.springframework.ai: DEBUG    # 调试阶段打开，能看到检索到的原文
```

配置参数说明：

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `spring.elasticsearch.uris` | ES 实例地址 | `http://localhost:9200` |
| `spring.elasticsearch.username` | 用户名，云端实例必填 | — |
| `spring.elasticsearch.password` | 密码，云端实例必填 | — |
| `spring.ai.vectorstore.elasticsearch.index-name` | 索引名称 | `spring-ai-document-index` |
| `spring.ai.vectorstore.elasticsearch.dimensions` | 向量维度 | `1536` |
| `spring.ai.vectorstore.elasticsearch.similarity` | 相似度算法 | `cosine` |
| `spring.ai.vectorstore.elasticsearch.initialize-schema` | 是否自动建索引 | `false` |
| `spring.ai.vectorstore.elasticsearch.embedding-field-name` | 向量字段名 | `embedding` |

::: danger 维度必须对齐（最痛的坑）
`dimensions` 必须和 Embedding 模型实际输出的维度一致。对不上的时候，异常信息非常隐晦（往往只报一句 `fail to parse` 或检索永远召回不到），排查起来很折磨。

DashScope 的 `text-embedding-v3` **默认 1024 维**（另支持 512 / 768 / 256 等规格，需在模型侧指定）。不同模型规格不同，**换了 Embedding 模型一定要同步改 `dimensions`，并且把整个索引删掉重建**。
:::

## 六、ES 索引 mapping：dense_vector 字段怎么定义

`initialize-schema: true` 会让 Spring AI 自动建索引，但**生产环境你往往要自己掌控 mapping**（比如要加自定义分词、调向量索引参数）。下面这份 mapping 就是 Spring AI ES 向量库的字段约定，你用 Kibana Dev Tools 或 curl 执行即可：

```bash
curl -X PUT "http://localhost:9200/knowledge-index" \
  -H "Content-Type: application/json" \
  -d @mapping.json
```

`mapping.json` 内容：

```json
{
  "mappings": {
    "properties": {
      "id": {
        "type": "keyword"
      },
      "content": {
        "type": "text",
        "analyzer": "standard"
      },
      "metadata": {
        "type": "object",
        "enabled": true
      },
      "embedding": {
        "type": "dense_vector",
        "dims": 1024,
        "index": true,
        "similarity": "cosine"
      }
    }
  }
}
```

四句话讲清每个字段：

| 字段 | 类型 | 作用 | 和什么对应 |
| --- | --- | --- | --- |
| `id` | keyword | 文档分片唯一 ID | `Document.getId()` |
| `content` | text | 原文，走 BM25 全文检索 | `Document.getText()` |
| `metadata` | object | 元数据，做过滤隔离 | `Document.getMetadata()` |
| `embedding` | dense_vector | 向量，走 kNN 语义检索 | Embedding 模型输出 |

::: tip dims 与 Embedding 模型的对应关系
`dense_vector` 的 `dims` **必须等于** `text-embedding-v3` 的输出维度 1024。这条线和 `application.yml` 里的 `dimensions: 1024` 是同一件事的两面：yml 告诉 Spring AI 建多少维，mapping 告诉 ES 预留多少维。两边不一致，写入直接报错。

如果你把 `text-embedding-v3` 切成 512 维规格，那么 **yml 的 `dimensions` 和 mapping 的 `dims` 都要改成 512**，且旧索引作废重建。
:::

## 七、手动装配 Bean（自动配置不生效时）

大部分场景靠 `application.yml` 自动装配就够了。但当你需要自定义连接、SSL、批量策略时，自己声明 Bean 更可控。下面这份配置把 `RestClient` 和 `ElasticsearchVectorStore` 都手动建出来，等价于上面 yml 的效果，但看得见摸得着：

```java
package com.example.saa.rag.config;

import org.apache.http.HttpHost;
import org.elasticsearch.client.RestClient;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.elasticsearch.ElasticsearchVectorStore;
import org.springframework.ai.vectorstore.elasticsearch.ElasticsearchVectorStoreOptions;
import org.springframework.ai.vectorstore.elasticsearch.SimilarityFunction;
import org.springframework.ai.vectorstore.elasticsearch.TokenCountBatchingStrategy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Elasticsearch 向量库的手动装配。
 *
 * 什么时候需要它：
 *   1. 自动配置因多数据源冲突没生效；
 *   2. 需要自定义 SSL / 证书 / 白名单；
 *   3. 想精确控制批量写入策略（避免一次塞太多超出 Embedding 模型 token 上限）。
 *
 * 本专栏向量库只能是 Elasticsearch，请勿替换为其他实现。
 */
@Configuration
public class EsVectorConfig {

    /**
     * 构造 ES 的底层 REST 客户端。
     * RestClient 来自 org.elasticsearch.client，是 Spring AI ES 向量库的连接入口。
     */
    @Bean
    public RestClient restClient(@Value("${spring.elasticsearch.uris}") String uris) {
        return RestClient.builder(HttpHost.create(uris)).build();
    }

    /**
     * 手动声明 VectorStore Bean。
     * 用 ElasticsearchVectorStore.builder() 把连接和 Embedding 模型组合起来。
     */
    @Bean
    public VectorStore vectorStore(RestClient restClient, EmbeddingModel embeddingModel) {
        // options 里集中放索引名、相似度、维度——和 yml 里的配置一一对应
        ElasticsearchVectorStoreOptions options = new ElasticsearchVectorStoreOptions();
        options.setIndexName("knowledge-index");
        options.setSimilarity(SimilarityFunction.cosine); // 和 text-embedding-v3 配套用 cosine
        options.setDimensions(1024);                      // 必须等于 Embedding 模型输出维度

        return ElasticsearchVectorStore.builder(restClient, embeddingModel)
                .options(options)
                .initializeSchema(true)                                  // 没有索引时自动建
                .batchingStrategy(new TokenCountBatchingStrategy())       // 按 token 自动分批写入
                .build();
    }
}
```

::: tip 关于批量策略
`TokenCountBatchingStrategy` 来自 `org.springframework.ai.vectorstore.elasticsearch` 包，它会按 token 自动分批写入 ES，避免一次塞太多超出 Embedding 模型上限。这是 Spring AI ES 向量库的默认策略，手动装配时显式写出来更可控。
:::

本专栏任何向量库代码都只使用 Elasticsearch，`elasticsearch` 包下的类型即为全部所需，**不得出现 pgvector / Milvus / Redis / Chroma / SimpleVectorStore 等其他向量库**。

## 八、灌数据：ETL 完整代码

Spring AI 把"入库"抽象成标准三段：**Reader（读） → Transformer（切） → Writer（写）**。下面是一份能直接跑的 `IngestionService`，把上传的 PDF/Word/网页变成 ES 里的向量。

```java
package com.example.saa.rag.service;

import org.springframework.ai.document.Document;
import org.springframework.ai.reader.tika.TikaDocumentReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * 文档入库服务（ETL）。
 *
 * 职责：把一份原始文件，经过"读取 → 切分 → 向量化 → 写入 ES"四步，
 * 变成大模型检索时能用到的知识块。
 *
 * 向量化和分批写入由 Spring AI 自动完成，我们只要把分片交给 vectorStore.add()。
 */
@Service
public class IngestionService {

    private final VectorStore vectorStore;

    // 构造器注入。vectorStore 由上一节的配置提供，内部已绑定 Embedding 模型
    public IngestionService(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    /**
     * 入库入口。
     *
     * @param file 前端上传的文件（PDF / Word / HTML 等）
     * @param tenantId 租户 ID，用于多租户隔离（元数据过滤的关键字段）
     */
    public void ingest(MultipartFile file, String tenantId) throws IOException {
        // ① Extract：用 Tika 读取，PDF/Word/HTML 通吃，转成 Document 列表
        Resource resource = new ByteArrayResource(file.getBytes()) {
            @Override
            public String getFilename() {
                return file.getOriginalFilename(); // Tika 需要文件名来判断类型
            }
        };
        List<Document> docs = new TikaDocumentReader(resource).get();

        // ② Transform：按 token 切分。每块约 400 token，太短的碎片（<50）丢弃
        //    切分质量直接决定检索上限，经验值见第 20 章
        var splitter = TokenTextSplitter.builder()
                .withChunkSize(400)
                .withMinChunkLengthToEmbed(50)
                .build();
        List<Document> chunks = splitter.apply(docs);

        // ③ 给每个分片打元数据：文件名 + 租户。后面靠 tenantId 做隔离
        for (Document chunk : chunks) {
            Map<String, Object> metadata = chunk.getMetadata();
            metadata.put("source", file.getOriginalFilename());
            metadata.put("tenantId", tenantId);
        }

        // ④ Load：写入 ES。这一步内部自动调用 Embedding 模型把文字变向量
        //    TokenCountBatchingStrategy 会自动分批，超大文档也不会超限
        vectorStore.add(chunks);
    }
}
```

::: tip 元数据是刚需，不是优化项
务必给分片打上**文件名、章节、更新时间、租户 ID** 等元数据。多租户场景下，**靠元数据过滤做隔离是安全底线** —— 别指望语义相似度能拦住跨租户泄漏。一个租户问"我的合同"，绝不能从另一个租户的合同里召回答案。
:::

## 九、检索增强对话：RetrievalAugmentationAdvisor

数据进了 ES 之后，用 `RetrievalAugmentationAdvisor` 把检索挂到 `ChatClient` 上。每次对话，它会**在调用模型之前**先去 ES 检索，把命中的片段拼进提示词，再把带着上下文的请求发出去 —— 对业务代码完全透明。

```java
package com.example.saa.rag.config;

import org.springframework.ai.chat.client.advisor.Advisor;
import org.springframework.ai.rag.advisor.RetrievalAugmentationAdvisor;
import org.springframework.ai.rag.retrieval.search.VectorStoreDocumentRetriever;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RAG Advisor 配置。
 *
 * RetrievalAugmentationAdvisor 是 Spring AI 模块化 RAG 的标准实现，
 * 内部流程：查询变换 → 检索 → 拼接 → 注入提示词 → 生成。
 * 这里只配最基础的"检索"环节，进阶的查询改写/重排见第 20 章。
 */
@Configuration
public class RagAdvisorConfig {

    @Bean
    public Advisor ragAdvisor(VectorStore vectorStore) {
        return RetrievalAugmentationAdvisor.builder()
                .documentRetriever(VectorStoreDocumentRetriever.builder()
                        .vectorStore(vectorStore)
                        .similarityThreshold(0.7)   // 相似度低于 0.7 的不要，过滤噪声
                        .topK(5)                    // 最多取 5 条
                        .build())
                .build();
    }
}
```

然后是一个**完整可运行的 Controller**，包含"上传文档"和"提问"两个接口：

```java
package com.example.saa.rag.controller;

import com.example.saa.rag.service.IngestionService;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.Advisor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * RAG 对外接口：上传知识 + 基于知识提问。
 *
 * 关键点：ChatClient 通过 defaultAdvisors(ragAdvisor) 挂上检索增强，
 * 业务方法里完全不用手写"先查 ES 再拼提示词"，Advisor 自动做完。
 */
@RestController
@RequestMapping("/api/rag")
public class RagController {

    private final ChatClient chatClient;
    private final IngestionService ingestionService;

    // 注入 ChatClient.Builder（自动配置提供）和我们的 ragAdvisor
    public RagController(ChatClient.Builder builder,
                         Advisor ragAdvisor,
                         IngestionService ingestionService) {
        // 把 RAG Advisor 设为默认 Advisor，所有经过此 ChatClient 的对话都会自动检索
        this.chatClient = builder.defaultAdvisors(ragAdvisor).build();
        this.ingestionService = ingestionService;
    }

    /**
     * 上传文档并入库。
     * curl -F "file=@员工手册.pdf" "http://localhost:8080/api/rag/upload?tenantId=t001"
     */
    @PostMapping("/upload")
    public String upload(@RequestParam("file") MultipartFile file,
                         @RequestParam(defaultValue = "default") String tenantId) throws IOException {
        ingestionService.ingest(file, tenantId);
        return "已入库：" + file.getOriginalFilename() + "（租户 " + tenantId + "）";
    }

    /**
     * 基于知识库提问。
     * curl "http://localhost:8080/api/rag/ask?q=年假怎么算？"
     */
    @GetMapping("/ask")
    public String ask(@RequestParam String q) {
        // 表面上只是一次普通对话，实际上 ragAdvisor 已经先去 ES 检索并拼好上下文
        return chatClient.prompt()
                .user(q)
                .call()
                .content();
    }
}
```

完整调用流程（先上传，再提问）：

```bash
# 1. 上传一份 PDF 知识文档
curl -F "file=@员工手册.pdf" "http://localhost:8080/api/rag/upload?tenantId=t001"

# 2. 基于这份文档提问
curl "http://localhost:8080/api/rag/ask?q=年假怎么算？"

# 3. 问一个知识库里没有的问题，模型应当诚实说"不知道"（靠 0.7 阈值拦截）
curl "http://localhost:8080/api/rag/ask?q=明天股票会涨吗？"
```

::: tip 第三步为什么重要
不设 `similarityThreshold`，任何问题都会"召回点什么"，模型就拿着不相关的材料硬答。**设了阈值，Agent 才可能在没把握时诚实地说"不知道"** —— 这对生产环境是关键行为差异，能直接减少幻觉投诉。
:::

### 9.1 Advisor 选型

| Advisor | 包路径 | 说明 | 什么时候用 |
| --- | --- | --- | --- |
| `QuestionAnswerAdvisor` | `org.springframework.ai.chat.client.advisor.QuestionAnswerAdvisor` | 早期实现，一句话配置，但灵活性差 | 快速验证、Demo；新项目不强制 |
| `RetrievalAugmentationAdvisor` | `org.springframework.ai.rag.advisor.RetrievalAugmentationAdvisor` | 模块化 RAG 标准抽象，可挂查询变换器、扩展器、重排器 | **默认选它** |

## 十、元数据过滤表达式

检索时可以按元数据过滤，这是多租户隔离的核心手段。`VectorStoreDocumentRetriever` 和底层的 `SearchRequest` 都支持 `filterExpression`，语法是 Spring AI 的可移植表达式（会被自动翻译成 ES 的 query string）：

```java
package com.example.saa.rag.config;

import org.springframework.ai.chat.client.advisor.Advisor;
import org.springframework.ai.rag.advisor.RetrievalAugmentationAdvisor;
import org.springframework.ai.rag.retrieval.search.VectorStoreDocumentRetriever;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FilteredRagConfig {

    /**
     * 带元数据过滤的 RAG Advisor。
     * 这里在构建时写死过滤规则；更常见的是运行时按当前用户动态传（见下方说明）。
     */
    @Bean
    public Advisor tenantRagAdvisor(VectorStore vectorStore) {
        VectorStoreDocumentRetriever retriever = VectorStoreDocumentRetriever.builder()
                .vectorStore(vectorStore)
                .similarityThreshold(0.7)
                .topK(5)
                // 只召回来源是员工手册、且租户是 t001 的块
                .filterExpression("source == '员工手册.pdf' && tenantId == 't001'")
                .build();

        return RetrievalAugmentationAdvisor.builder()
                .documentRetriever(retriever)
                .build();
    }
}
```

运行时按当前登录用户动态过滤（更安全，避免把过滤规则写死）：

```java
// 在 Controller 里，每次请求带上当前租户
Advisor advisor = RetrievalAugmentationAdvisor.builder()
        .documentRetriever(VectorStoreDocumentRetriever.builder()
                .vectorStore(vectorStore)
                .similarityThreshold(0.7)
                .topK(5)
                .build())
        .build();

// 用 FILTER_EXPRESSION 上下文参数，把租户 ID 动态塞进去
return chatClient.prompt()
        .user(q)
        .advisors(a -> a.param(VectorStoreDocumentRetriever.FILTER_EXPRESSION,
                "tenantId == '" + currentTenantId + "'"))
        .call()
        .content();
```

::: danger 过滤表达式的跨租户红线
`filterExpression` 是唯一可靠的租户隔离手段。如果图省事只在提示词里写"只回答本租户内容"，模型根本拦不住 —— 它会从所有分片里召回最相似的，包括别的租户。**生产必须强制 filterExpression，且值来自服务端会话，绝不来自前端传入。**
:::

## 十一、切到云端：换成阿里云 Elasticsearch

这一步几乎不需要改代码，**只需要改连接配置** —— 索引结构、mapping、检索逻辑完全一致。把 `application.yml` 的 ES 段换成：

```yaml
spring:
  elasticsearch:
    # 阿里云 ES 的公网/内网地址，形态是 https://es-cn-xxxx.elasticsearch.aliyuncs.com:9200
    uris: https://es-cn-xxxxxxxxx.elasticsearch.aliyuncs.com:9200
    username: elastic
    password: ${ES_PASSWORD}     # 从环境变量读，不要写死
  ai:
    vectorstore:
      elasticsearch:
        index-name: knowledge-index
        dimensions: 1024
        similarity: cosine
        initialize-schema: true
```

::: warning 云端必须开认证 + 白名单
云端实例必须启用用户名密码（或更细粒度的 RAM 权限），并且**安全组白名单只允许你的应用服务器访问**，绝对不要把 ES 的 9200 端口暴露到公网，否则知识库会被全网扫。
:::

### 11.1 需要手写 RestClient 的情况

自动装配若无法覆盖你的鉴权/证书场景（比如内网自签证书），手动构造带账号密码的 `RestClient`：

```java
package com.example.saa.rag.config;

import org.apache.http.HttpHost;
import org.apache.http.auth.AuthScope;
import org.apache.http.auth.UsernamePasswordCredentials;
import org.apache.http.client.CredentialsProvider;
import org.apache.http.impl.client.BasicCredentialsProvider;
import org.elasticsearch.client.RestClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class CloudEsConfig {

    /**
     * 带账号密码的 RestClient。
     * 用于阿里云 ES 等需要 Basic Auth 的场景。
     */
    @Bean
    public RestClient restClient(
            @Value("${es.uri}") String uri,
            @Value("${es.username}") String username,
            @Value("${es.password}") String password) {

        // 组装账号密码凭证
        CredentialsProvider credentials = new BasicCredentialsProvider();
        credentials.setCredentials(AuthScope.ANY,
                new UsernamePasswordCredentials(username, password));

        return RestClient.builder(HttpHost.create(uri))   // 形如 https://es-cn-xxx:9200
                .setHttpClientConfigCallback(builder ->
                        builder.setDefaultCredentialsProvider(credentials))
                .build();
    }
}
```

内网走自签证书时还需要额外处理 `SSLContext`，按你实例的实际情况配置，这里不展开。

### 11.2 本地与云端的差异清单

| 项 | 本地 Docker | 阿里云 ES |
| --- | --- | --- |
| 连接地址 | `http://localhost:9200` | `https://es-cn-xxx.elasticsearch.aliyuncs.com:9200` |
| 认证 | 关闭（仅本地） | 用户名 + 密码，配白名单 |
| 节点数 | 单节点 | 多节点 + 副本，选够 CPU 承载 kNN |
| kNN 性能 | 数据量小，无感 | 数据量大时关注索引段数与向量资源占用 |
| 索引 / mapping / 代码 | 完全一致 | 完全一致 |

## 常见坑

| 坑 | 症状 | 怎么避免 |
| --- | --- | --- |
| `dimensions` 与模型不一致 | 写入报 parse fail，或检索永远召回不到 | 对齐 Embedding 模型输出维度；换模型必须重建索引 |
| 换 Embedding 模型没重建索引 | 新文档能检索到，老文档检索不到 | 换模型 = 全量重灌，写进上线检查单 |
| 忘记 `initialize-schema` | 写入时报索引不存在 | 首次部署 `true`，稳定后可关掉由运维管理 mapping |
| 切分过粗 / 无重叠 | 回答"话说一半" | 调整 chunk size，依赖 `TokenTextSplitter` 的边界参数 |
| `topK` 过大 | 答案被噪声淹没，Token 成本飙升 | 从 5 起步，靠评测集调整 |
| 未设相似度阈值 | 什么问题都能答，但经常是编的 | 必须设阈值，允许答"不知道" |
| 缺 `spring-ai-rag` 依赖 | 编译报找不到 `RetrievalAugmentationAdvisor` | pom 里显式加 `spring-ai-rag` |
| 无元数据过滤 | 多租户数据串泄 | 打元数据 + 强制 `filterExpression` |

## 本篇小结

- **RAG 的本质是"开卷考试"**：先检索再生成，让模型照着你的材料答，从根上消灭大部分幻觉。
- **整条链路八步**：文档 → 切分 → 向量化 → 存 ES（离线）｜提问 → 检索 → 拼提示词 → 生成（在线）。两阶段别混。
- **统一用 Elasticsearch 8.x**：本地 Docker，线上阿里云 ES，索引结构不变，只改连接配置；关键词 + 向量一体是 ES 的独特优势。
- **两条红线**：`dimensions` 必须对齐 Embedding 模型（text-embedding-v3 默认 1024 维，换模型必删索引重灌）；相似度阈值必须设，让模型敢说"不知道"。
- **依赖别漏**：`RetrievalAugmentationAdvisor` 在独立模块 `spring-ai-rag`，pom 必须显式引入。
- 进阶玩法是把检索降级为**工具或图节点**，交给 Agent 自己调度 —— 下一章的主题。

::: tip 可选的托管方案
如果连 ES 都不想自己维护，阿里云百炼提供完全托管的云端知识库（自动解析 PDF/Word/PPT、自动切分向量化），Spring AI Alibaba 通过 `DashScopeDocumentRetriever` + `DocumentRetrievalAdvisor` 对接，详见官网文档。本篇不展开，避免在示例里掺第二套向量库方案。
:::

## 参考链接

- Spring AI Elasticsearch VectorStore 文档：<https://docs.spring.io/spring-ai/reference/api/vectordbs/elasticsearch.html>
- Spring AI RAG 模块文档：<https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html>
- Elasticsearch kNN 检索文档：<https://www.elastic.co/guide/en/elasticsearch/reference/current/knn-search.html>
- 阿里云 Elasticsearch：<https://www.aliyun.com/product/bigdata/elasticsearch>
- 官网文档：<https://java2ai.com/>

下一篇 → [20 RAG 进阶调优](/java/saa/rag-advanced)
