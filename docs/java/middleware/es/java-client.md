# 06 官方 Java Client 实战

> 前几章的 DSL 都是在 Kibana / curl 里手写的。到了生产，你得用 Java 代码把查询拼出来、把结果映射成自己的实体类。这一章是全站**最贴近"写代码"的一章**：从"为什么只用官方 Java API Client"讲到"手写配置类覆盖四种连接场景"，再到 CRUD、批量、并发控制、搜索、异步、异常处理，最后用一个 `@Service` + `@RestController` 商品搜索模块把全链路打通。

## 本篇要解决的问题

- ES 有好几个 Java 客户端，到底用哪个？旧的 `TransportClient` / `RestHighLevelClient` 还能用吗？
- Spring Boot 怎么接入？依赖里 `elasticsearch-java` 和 `elasticsearch-rest-client` 什么关系？
- 本地无密码、云端 Basic Auth、HTTPS 自签证书、HTTPS 忽略校验——四种连接场景怎么配？
- Fluent Builder 写法和函数式 lambda 写法（`q -> q.match(...)`）哪种好？新手用哪个？
- 怎么让 `SearchResponse<Product>` 直接映射成我的 `Product` 实体？
- 完整的增删改查、批量 `bulk`、乐观并发控制（防超卖/脏写）怎么写？
- 异步客户端、异常处理、重试怎么做？
- **一个能跑的商品搜索接口**从 Controller 到 ES 全链路长什么样？

::: tip 本章约定
全部沿用 `com.example.es` 包结构（第 01 章约定）。实体类用第 05 章的 `Product`（字段：`title`/`description`/`price`/`category`/`brand`/`tags`/`createdAt`/`onSale`/`reviews`）。客户端统一注入 `co.elastic.clients.elasticsearch.ElasticsearchClient`。
:::

## 一、三种客户端的演进与选型

ES 的 Java 客户端历史上有三代，理解"为什么现在只用一个"能帮你避开大量过时教程的坑。

### 1.1 TransportClient（已废弃，7.0 移除）

最古老的客户端，走 ES 私有**二进制 Transport 协议**（9300 端口），直连节点。

- **问题**：和集群版本强绑定（客户端和服务端大版本必须一致，否则协议不兼容）；9200/9300 的 TCP 长连在云环境/容器网络里经常被挡；官方早已废弃并在 7.0 彻底移除。
- **结论**：**任何新项目都不要碰**。

### 1.2 RestHighLevelClient（已弃用，8.0 进入维护、计划移除）

基于 HTTP REST 的"高级"客户端，对应你第 04 章可能见过的 `SearchRequest` / `SearchSourceBuilder` / `AggregationBuilders` 那一套。

- **问题**：ES 8.0 起官方宣布它**弃用（deprecated）**，只做关键修复、不再加新特性。新出现的聚合/查询类型（如一些 8.x 的新 API）它不支持。官方明确建议迁移到新的 Java API Client。
- **结论**：**老项目逐步迁移，新项目不要新建**。

### 1.3 Elasticsearch Java API Client（现在主流，本文主角）

就是 `co.elastic.clients:elasticsearch-java`。它：

- 基于 **REST（9200 端口）**，和 Kibana/curl 发出的请求是同一套。
- **强类型 + 代码生成**：所有请求/响应都是 Java 类，IDE 自动补全、编译期就能发现字段拼错。
- **Fluent 链式 / 函数式 lambda** 两种写法，构建复杂查询不费劲。
- 和 Kibana 的 DSL **结构一一对应**（你写 `q -> q.term(...)` 等价于 `"term": {...}`），学一个会两个。
- 支持 `SearchResponse<Product>` 这种泛型，**直接把文档反序列化成你的实体类**。

### 1.4 选型结论

| 客户端 | 状态 | 新项目建议 |
| --- | --- | --- |
| `TransportClient` | 已移除（7.0） | ❌ 绝对不用 |
| `RestHighLevelClient` | 已弃用（8.0） | ❌ 不新建，老项目迁移 |
| **`elasticsearch-java`（Java API Client）** | ✅ 官方主推 | ✅ 唯一选择 |

```text
旧世界                      新世界（现在只用它）
TransportClient ──弃──→  RestHighLevelClient ──弃──→  Elasticsearch Java API Client
 (9300 私有协议)            (9200 REST, 但停更)          (9200 REST, 强类型, 持续演进)
```

::: danger 别照旧教程抄
搜索引擎上大量「ES Java 教程」还在用 `RestHighLevelClient` 甚至 `TransportClient`。它们的方法名、包名和本章**完全不同**。认准 `co.elastic.clients.elasticsearch.ElasticsearchClient` 才是 8.x 正解。
:::

## 二、接入 Spring Boot 的完整过程（重点）

### 2.1 依赖：elasticsearch-java 与 elasticsearch-rest-client 的关系

先看清楚两个 artifact 的分工——这是很多人困惑的点：

| artifact | 角色 | 干什么 |
| --- | --- | --- |
| `org.elasticsearch.client:elasticsearch-rest-client` | **低层 REST 客户端** | 负责 HTTP 连接池、请求发送、SSL、认证等"传输"细节。它**不懂业务语义**，只发 JSON。 |
| `co.elastic.clients:elasticsearch-java` | **强类型 API 客户端** | 建在 `elasticsearch-rest-client` 之上，把请求/响应封装成 Java 对象（就是你用的 `ElasticsearchClient`）。 |

**关系一句话**：`elasticsearch-java` 是"大脑"，`elasticsearch-rest-client` 是"腿"。你代码里只和 `ElasticsearchClient` 打交道，但底层跑的是 `elasticsearch-rest-client`。

`spring-boot-starter-data-elasticsearch` 会把两者都带进来（外加 Spring Data ES 的 `ElasticsearchOperations`）。下面 `pom.xml` 与第 01 章一致，这里再贴一次并标注关键点：

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
    <artifactId>es-demo</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>17</java.version>
        <!-- 红线：属性名是 elasticsearch-client.version（不是旧教程的 elasticsearch.version）
             把它锁成和服务端一致的 8.18.x，客户端服务端大版本对齐 -->
        <elasticsearch-client.version>8.18.5</elasticsearch-client.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- Spring Data Elasticsearch 启动器：自动带入 elasticsearch-java + elasticsearch-rest-client -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-elasticsearch</artifactId>
        </dependency>

        <!-- 显式声明官方 Java API Client（版本受 BOM/elasticsearch-client.version 管理，不用写 version） -->
        <dependency>
            <groupId>co.elastic.clients</groupId>
            <artifactId>elasticsearch-java</artifactId>
        </dependency>

        <!-- 低层 rest-client：上面 starter 已传递依赖，这里写出来是为了"看得清层次"
             （生产可以不写，starter 已经带上了） -->
        <dependency>
            <groupId>org.elasticsearch.client</groupId>
            <artifactId>elasticsearch-rest-client</artifactId>
        </dependency>

        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>

        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
    </dependencies>

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

### 2.2 application.yml 配置

`src/main/resources/application.yml`（本地无密码场景）：

```yaml
spring:
  application:
    name: es-demo
  elasticsearch:
    # ES 的 REST 地址（本地 Docker 就是它）
    uris: http://localhost:9200
    # 本地关了安全认证，不需要 username/password
    # 连阿里云时填：username: elastic / password: ${ES_CLOUD_PASSWORD}
    connection-timeout: 5s
    socket-timeout: 30s

server:
  port: 8080

logging:
  level:
    org.springframework.data.elasticsearch: INFO
```

::: tip 多数情况不用写配置类
`spring.elasticsearch.uris` 会被 Spring Boot 自动配置读走，自动帮你建好 `RestClient` 和 `ElasticsearchClient`。**直接 `@Autowired ElasticsearchClient` 就能用**。只有需要自定义（加 TLS、凭据、pathPrefix、连接池参数）时才写下面的 `@Configuration` 覆盖它。Spring Boot 的自动配置是 `@ConditionalOnMissingBean`——你自己的 Bean 优先。
:::

### 2.3 手写 @Configuration 生产 ElasticsearchClient Bean（四种场景）

这是本章重点中的重点。四种连接场景，逐个给**完整可复制**的代码和中文注释。

#### 场景一：无密码（本地 Docker，关了安全）

本地学习环境（第 01 章的 docker-compose）就是这个。其实 Spring Boot 自动配置已经够用，但手写一遍让你看清"客户端是怎么拼出来的"——后面三个场景都是在它基础上加料。

```java
package com.example.es.config;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.json.jackson.JacksonJsonpMapper;
import co.elastic.clients.transport.ElasticsearchTransport;
import co.elastic.clients.transport.rest_client.RestClientTransport;
import org.apache.http.HttpHost;
import org.elasticsearch.client.RestClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 场景一：本地无密码连接。
 * 客户端的三层结构（记住这个套路，后面场景都在此基础上改）：
 *   RestClient（低层 HTTP） → RestClientTransport（传输层，绑 JSON 映射器） → ElasticsearchClient（强类型 API）
 */
@Configuration
public class ElasticsearchConfig {

    @Bean
    public ElasticsearchClient elasticsearchClient() {
        // 1) 低层 REST 客户端：指向 9200
        RestClient restClient = RestClient.builder(
                new HttpHost("localhost", 9200, "http"))
                .build();

        // 2) 传输层：用 Jackson 把 JSON 和 Java 对象互转
        ElasticsearchTransport transport =
                new RestClientTransport(restClient, new JacksonJsonpMapper());

        // 3) 强类型客户端：你业务代码里注入的就是它
        return new ElasticsearchClient(transport);
    }
}
```

#### 场景二：用户名密码（Basic Auth，云端最常用）

阿里云/腾讯云/自建开了安全认证的 ES，需要 Basic Auth。关键是 `BasicCredentialsProvider`。

```java
package com.example.es.config;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.json.jackson.JacksonJsonpMapper;
import co.elastic.clients.transport.ElasticsearchTransport;
import co.elastic.clients.transport.rest_client.RestClientTransport;
import org.apache.http.HttpHost;
import org.apache.http.auth.AuthScope;
import org.apache.http.auth.UsernamePasswordCredentials;
import org.apache.http.client.CredentialsProvider;
import org.apache.http.impl.client.BasicCredentialsProvider;
import org.elasticsearch.client.RestClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 场景二：Basic Auth（用户名 + 密码）。
 * 云端 ES 默认用户名 elastic，密码创建实例时设。绝不能硬编码，从环境变量读。
 */
@Configuration
public class ElasticsearchAuthConfig {

    @Bean
    public ElasticsearchClient elasticsearchClient() {
        // 1) 凭据：用户名 + 密码，放进 CredentialsProvider
        CredentialsProvider credentialsProvider = new BasicCredentialsProvider();
        credentialsProvider.setCredentials(AuthScope.ANY,
                new UsernamePasswordCredentials(
                        "elastic",
                        System.getenv("ES_CLOUD_PASSWORD")));   // 从环境变量读，别写死

        // 2) 低层客户端挂上凭据（setHttpClientConfigCallback）
        RestClient restClient = RestClient.builder(
                        new HttpHost("es-cn-xxxx.elasticsearch.aliyuncs.com", 9200, "https"))
                .setHttpClientConfigCallback(httpClientBuilder ->
                        httpClientBuilder.setDefaultCredentialsProvider(credentialsProvider))
                .build();

        ElasticsearchTransport transport =
                new RestClientTransport(restClient, new JacksonJsonpMapper());
        return new ElasticsearchClient(transport);
    }
}
```

#### 场景三：HTTPS + 自签证书（生产推荐）

生产 ES 走 HTTPS，且证书是自建 CA 签的（不是公网可信 CA）。需要把**证书导入信任库**，让 JVM 信任它。

```java
package com.example.es.config;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.json.jackson.JacksonJsonpMapper;
import co.elastic.clients.transport.ElasticsearchTransport;
import co.elastic.clients.transport.rest_client.RestClientTransport;
import org.apache.http.HttpHost;
import org.apache.http.ssl.SSLContextBuilder;
import org.elasticsearch.client.RestClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.net.ssl.SSLContext;
import java.io.InputStream;
import java.security.KeyStore;

/**
 * 场景三：HTTPS + 自签证书（生产推荐做法）。
 * 把云端给的 CA 证书（.p12 / .jks）放进信任库，JVM 才会信任这个 HTTPS 连接。
 */
@Configuration
public class ElasticsearchHttpsConfig {

    @Bean
    public ElasticsearchClient elasticsearchClient() throws Exception {
        // 1) 加载信任库：里面放了 ES 服务端的 CA 证书
        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        try (InputStream is = getClass().getResourceAsStream("/truststore.p12")) {
            trustStore.load(is, "truststore-password".toCharArray());   // 信任库密码
        }
        // 2) 用这个信任库构建 SSLContext
        SSLContext sslContext = SSLContextBuilder.create()
                .loadTrustMaterial(trustStore, null)
                .build();

        // 3) 低层客户端：https 协议 + 挂 SSLContext（保留主机名校验，安全）
        RestClient restClient = RestClient.builder(
                        new HttpHost("es-cn-xxxx.elasticsearch.aliyuncs.com", 9200, "https"))
                .setHttpClientConfigCallback(httpClientBuilder ->
                        httpClientBuilder.setSSLContext(sslContext))
                .build();

        ElasticsearchTransport transport =
                new RestClientTransport(restClient, new JacksonJsonpMapper());
        return new ElasticsearchClient(transport);
    }
}
```

> 如果你只是想"信任自签证书（不校验 CA 链）"而不导入文件，可以用 `SSLContextBuilder.create().loadTrustMaterial(new org.apache.http.conn.ssl.TrustSelfSignedStrategy()).build()` 代替步骤 1~2。但这仍会校验主机名。

#### 场景四：HTTPS 忽略证书校验（仅开发/测试）

开发联调时服务端用的是 IP / 自签证书、主机名对不上，临时想"跳过所有 TLS 校验"。**切记：生产禁用**，等同明文。

```java
package com.example.es.config;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.json.jackson.JacksonJsonpMapper;
import co.elastic.clients.transport.ElasticsearchTransport;
import co.elastic.clients.transport.rest_client.RestClientTransport;
import org.apache.http.HttpHost;
import org.apache.http.conn.ssl.NoopHostnameVerifier;
import org.apache.http.ssl.SSLContextBuilder;
import org.elasticsearch.client.RestClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

import javax.net.ssl.SSLContext;

/**
 * 场景四：HTTPS 忽略证书校验（仅开发！）。
 * 用 @Profile("dev") 限制只在开发环境生效，避免误上生产。
 */
@Configuration
@Profile("dev")
public class ElasticsearchInsecureConfig {

    @Bean
    public ElasticsearchClient elasticsearchClient() throws Exception {
        // 信任所有证书 + 跳过主机名校验：等于不校验 TLS
        SSLContext sslContext = SSLContextBuilder.create()
                .loadTrustMaterial(null, (chain, authType) -> true)   // 信任一切
                .build();

        RestClient restClient = RestClient.builder(
                        new HttpHost("localhost", 9200, "https"))
                .setHttpClientConfigCallback(httpClientBuilder ->
                        httpClientBuilder
                                .setSSLContext(sslContext)
                                .setSSLHostnameVerifier(NoopHostnameVerifier.INSTANCE))  // 跳过主机名校验
                .build();

        ElasticsearchTransport transport =
                new RestClientTransport(restClient, new JacksonJsonpMapper());
        return new ElasticsearchClient(transport);
    }
}
```

::: danger 场景四上生产的后果
"忽略证书校验"会让中间人攻击（MITM）变得可能——攻击者能冒充你的 ES 节点、窃听/篡改数据。**它只能出现在 `@Profile("dev")` 或本地，CI/生产构建里绝不能包含这段配置。**
:::

### 2.4 三种 JSON 映射器

`RestClientTransport` 需要一个"JSON 映射器"把 ES 的 JSON 和 Java 对象互相转换。官方提供：

| 映射器 | 说明 | 何时用 |
| --- | --- | --- |
| **`JacksonJsonpMapper`** | 基于 Jackson（业界最流行的 JSON 库） | **99% 场景用这个**，和 Spring Boot 默认 Jackson 生态一致 |
| `JacksonJsonpMapper(ObjectMapper)` | 同上，但传你自定义配置的 `ObjectMapper` | 需要统一日期格式、命名策略时 |
| `SmileJsonpMapper` | 用 Smile 二进制 JSON 格式 | 极致性能/带宽场景，需服务端也支持 |

**为什么用 JacksonJsonpMapper**：它是 ES 官方 Java 客户端**默认且最完整支持**的映射器；Jackson 生态成熟，能直接处理你的 `LocalDateTime`、`BigDecimal`、自定义序列化；Spring Boot 项目里 Jackson 本来就在。所以本章所有示例都用它。

```java
// 默认映射器（最简单）
new JacksonJsonpMapper();

// 想用项目里统一的 ObjectMapper（比如统一日期格式），把 Spring 的 ObjectMapper 注入进去：
// new JacksonJsonpMapper(customObjectMapper);
```

## 三、API 使用模式讲透

新客户端有两套写法：**Fluent Builder**（连点）和**函数式 lambda**（箭头函数）。理解它们能让你读得懂任何示例。

### 3.1 Fluent Builder 写法

像"搭积木"一样连点，每一步返回构建器自身：

```java
import co.elastic.clients.elasticsearch._types.query_dsl.Query;

// Fluent 写法：q.term(...).field(...).value(...) 一路点下去
Query query = Query.of(q -> q
        .term(t -> t
                .field("brand")
                .value("华为")));
```

### 3.2 函数式 lambda 写法（推荐新手）

把"构建逻辑"塞进一个 lambda，IDE 补全体验最好，嵌套深时也最清晰：

```java
import co.elastic.clients.elasticsearch._types.query_dsl.Query;

// lambda 写法：q -> q.term(t -> t.field("brand").value("华为"))
Query query = Query.of(q -> q.term(t -> t
        .field("brand")
        .value("华为")));
```

构建搜索时两者等价，只是风格不同。如果一个聚合要挂好几个子聚合，lambda 的"缩进即层级"优势很明显（回想第 05 章的嵌套聚合）：

```java
import co.elastic.clients.elasticsearch.core.SearchResponse;
import co.elastic.clients.elasticsearch.core.SearchRequest;
import co.elastic.clients.elasticsearch._types.aggregations.Aggregation;
import com.example.es.domain.Product;

// lambda 写法天然表达"嵌套层级"
SearchRequest request = SearchRequest.of(s -> s
        .index("products")
        .size(0)
        .aggregations("by_brand", a -> a
                .terms(t -> t.field("brand").size(10))
                .aggregations("avg_price", sub -> sub.avg(av -> av.field("price")))
        ));
```

### 3.3 新手推荐哪种

| 写法 | 优点 | 缺点 | 推荐 |
| --- | --- | --- | --- |
| Fluent Builder | 简短 | 嵌套深时缩进乱、易漏括号 | 简单查询 |
| **函数式 lambda** | IDE 补全强、层级清晰、改起来直观 | 略长 | ✅ **新手首选** |

::: tip 一个统一心智模型
无论查询还是聚合，模式永远是：`.xxx(构建器 -> 构建器.字段(值))`。**最外层 `Query.of(q -> ...)` 的 `q` 是"聚合/查询类型选择器"**（`.term()` / `.match()` / `.bool()` / `.terms()` …），里面的 `t`/`m`/`b` 才是具体参数。**写错层级（把 field 写到 q 上）编译器会直接报错**——这正是强类型客户端的价值。
:::

### 3.4 `SearchResponse<T>` 泛型直接映射实体（重点）

这是新客户端最爽的能力：搜出来的文档**直接变成你的 `Product`**，不用手动解析 JSON。

```java
import co.elastic.clients.elasticsearch.core.SearchResponse;
import co.elastic.clients.elasticsearch.core.search.Hit;
import com.example.es.domain.Product;

import java.io.IOException;
import java.util.List;

/** 搜索并把命中文档直接映射成 Product 实体 */
public class SearchMappingDemo {

    private final ElasticsearchClient client;

    public SearchMappingDemo(ElasticsearchClient client) {
        this.client = client;
    }

    public List<Product> search(String keyword) throws IOException {
        // 第二个类型参数 Product.class 告诉客户端：把 _source 反序列化成 Product
        SearchResponse<Product> resp = client.search(s -> s
                .index("products")
                .query(q -> q.match(m -> m.field("title").query(keyword)))
                .size(10), Product.class);

        // resp.hits().hits() 是命中列表；每个 Hit<Product> 的 .source() 就是 Product 对象
        return resp.hits().hits().stream()
                .map(Hit::source)          // 直接拿到 Product，不是 Map/JsonNode
                .toList();
    }
}
```

> 注意上面 `SearchResponse<Product>` 写在代码围栏里合法。**围栏外（含标题）一律用反引号包住泛型**，例如 `SearchResponse<Product>`、`List<Product>`，否则 VitePress 把 `<Product>` 当 HTML 标签导致构建失败。

## 四、完整 CRUD

先给出 `Product` 实体（第 05 章已用，这里给出完整可复制版，带 Jackson 友好的类型）：

```java
package com.example.es.domain;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 商品文档，对应 ES 索引 products。
 * 字段类型要和 products 的 mapping 对齐（第 05 章建过）。
 */
public class Product {

    private String id;
    private String title;
    private String description;
    private Double price;
    private String category;
    private String brand;
    private List<String> tags;
    private Boolean onSale;

    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime createdAt;

    private List<Review> reviews;

    public Product() {
    }

    public Product(String id, String title, Double price, String brand) {
        this.id = id;
        this.title = title;
        this.price = price;
        this.brand = brand;
    }

    // getter / setter（生产可用 Lombok @Data 省略；这里显式写出便于理解）
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Double getPrice() {
        return price;
    }

    public void setPrice(Double price) {
        this.price = price;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public String getBrand() {
        return brand;
    }

    public void setBrand(String brand) {
        this.brand = brand;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public Boolean getOnSale() {
        return onSale;
    }

    public void setOnSale(Boolean onSale) {
        this.onSale = onSale;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public List<Review> getReviews() {
        return reviews;
    }

    public void setReviews(List<Review> reviews) {
        this.reviews = reviews;
    }

    /** 评论（嵌套文档） */
    public static class Review {
        private String author;
        private Integer rating;
        private String content;

        public String getAuthor() {
            return author;
        }

        public void setAuthor(String author) {
            this.author = author;
        }

        public Integer getRating() {
            return rating;
        }

        public void setRating(Integer rating) {
            this.rating = rating;
        }

        public String getContent() {
            return content;
        }

        public void setContent(String content) {
            this.content = content;
        }
    }
}
```

### 4.1 单条 index（写入/新增）

```java
import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.core.IndexResponse;
import com.example.es.domain.Product;

import java.io.IOException;

/** 写入一条商品 */
public class ProductWriteService {

    private final ElasticsearchClient client;

    public ProductWriteService(ElasticsearchClient client) {
        this.client = client;
    }

    /** 写入/覆盖一条文档。有 id 则覆盖（reindex），无 id 则由 ES 生成 */
    public String save(Product product) throws IOException {
        IndexResponse response = client.index(i -> i
                .index("products")              // 目标索引
                .id(product.getId())            // 文档 _id（不写则 ES 自动生成）
                .document(product)              // 要写入的对象，Jackson 自动序列化
                , Product.class);

        // result 是 "created"（新建）或 "updated"（覆盖）
        System.out.println("写入结果=" + response.result() + ", 版本=" + response.version());
        return response.id();
    }
}
```

`IndexResponse` 关键字段：`result()`（`created`/`updated`）、`version()`、`id()`、`seqNo()`、`primaryTerm()`（后两个用于并发控制，见 4.8）。

### 4.2 get（按 id 取）

```java
import co.elastic.clients.elasticsearch.core.GetResponse;
import com.example.es.domain.Product;

import java.io.IOException;

/** 按 id 取一条 */
public Product get(String id) throws IOException {
    GetResponse<Product> response = client.get(g -> g
            .index("products")
            .id(id), Product.class);

    // found() 判断是否存在；不存在时 source() 为 null
    if (response.found()) {
        return response.source();
    }
    return null;
}
```

### 4.3 update（局部更新）

```java
import co.elastic.clients.elasticsearch.core.UpdateResponse;
import com.example.es.domain.Product;

import java.io.IOException;
import java.util.Map;

/** 局部更新：只改传进来的字段，其余字段不变 */
public void updatePrice(String id, Double newPrice) throws IOException {
    UpdateResponse<Product> response = client.update(u -> u
            .index("products")
            .id(id)
            .doc(Map.of("price", newPrice))   // 只传要改的字段（partial update）
            , Product.class);

    System.out.println("更新结果=" + response.result());
}
```

### 4.4 delete（删除）

```java
import co.elastic.clients.elasticsearch.core.DeleteResponse;

import java.io.IOException;

/** 删除一条 */
public void delete(String id) throws IOException {
    DeleteResponse response = client.delete(d -> d
            .index("products")
            .id(id));
    System.out.println("删除结果=" + response.result());   // deleted / not_found
}
```

### 4.5 exists（是否存在）

```java
import co.elastic.clients.elasticsearch.core.ExistsResponse;

import java.io.IOException;

/** 判断文档是否存在（比 get 更省带宽，不返回 _source） */
public boolean exists(String id) throws IOException {
    ExistsResponse response = client.exists(e -> e
            .index("products")
            .id(id));
    return response.value();   // true / false
}
```

### 4.6 bulk 批量（重点：正确用法与批量大小）

一条条 index 太慢（每次一次 HTTP 往返）。`bulk` 把多个操作打包成一个请求，吞吐量几十倍提升。

**正确用法**：用 `BulkOperation.of(...)` 把每种操作（index/update/delete）封装成操作单元，汇总到 `.operations(...)`。

```java
import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.core.BulkResponse;
import co.elastic.clients.elasticsearch.core.bulk.BulkOperation;
import co.elastic.clients.elasticsearch.core.bulk.BulkResponseItem;
import com.example.es.domain.Product;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** 批量写入 */
public class ProductBulkService {

    private final ElasticsearchClient client;

    public ProductBulkService(ElasticsearchClient client) {
        this.client = client;
    }

    /** 批量写入一批商品 */
    public void bulkSave(List<Product> products) throws IOException {
        // 1) 把每个商品包装成一个 index 操作单元
        List<BulkOperation> ops = new ArrayList<>();
        for (Product p : products) {
            ops.add(BulkOperation.of(b -> b
                    .index(idx -> idx
                            .index("products")
                            .id(p.getId())
                            .document(p))));
        }

        // 2) 一次性发出 bulk 请求
        BulkResponse response = client.bulk(b -> b
                .index("products")
                .operations(ops));

        // 3) 检查是否有失败项（bulk 是"部分成功"语义，必须看 errors()）
        if (response.errors()) {
            for (BulkResponseItem item : response.items()) {
                if (item.error() != null) {
                    System.err.println("失败 id=" + item.id() + " 原因=" + item.error().reason());
                }
            }
        } else {
            System.out.println("批量写入全部成功，共 " + response.items().size() + " 条");
        }
    }
}
```

::: warning bulk 的批量大小建议（生产红线）
- **按文档数**：单批建议 **1000 ~ 5000 条**，不要一次塞几万条。
- **按体积**：单批请求体建议 **5 ~ 15 MB** 以内。太大协调节点内存压力大、易超时。
- **为什么限制**：bulk 是"单个 HTTP 请求"，太大一个请求占满连接、超时后整批重来，反而更慢。
- **正确姿势**：从数据库/文件**分批读取 → 每批攒够 N 条就发一次 bulk → 循环**，而不是攒全量再发。
- **并发**：需要更高吞吐时，多个 bulk 请求并行发（注意客户端连接池大小），但单连接串行 bulk 也有不错性能。
:::

### 4.7 upsert（没有就插入，有就更新）

`docAsUpsert(true)` 表示"文档存在就局部更新、不存在就按 `doc` 插入"。适合"每天同步一次商品，有则更新无则新增"的场景。

```java
import co.elastic.clients.elasticsearch.core.UpdateResponse;
import com.example.es.domain.Product;

import java.io.IOException;
import java.util.Map;

/** upsert：存在则更新价格，不存在则整条插入 */
public void upsert(String id, Product product) throws IOException {
    UpdateResponse<Product> response = client.update(u -> u
            .index("products")
            .id(id)
            .doc(product)                 // 更新的内容
            .docAsUpsert(true)            // 关键：不存在时把 doc 当新文档插入
            , Product.class);
    System.out.println("upsert 结果=" + response.result());   // updated / created
}
```

> 另一种 upsert 是用 `script` + `upsert` 文档做"有则跑脚本、无则插文档"的细粒度控制，脚本写法以你所用版本官方文档为准。

### 4.8 乐观并发控制（if_seq_no / primary_term）

**解决什么问题**：高并发下，两个请求同时读到一个商品（版本都是 v1）、都基于 v1 改价格，后到的那个会**覆盖**先到的——这就是丢失更新（脏写）。ES 用 `_seq_no` + `_primary_term` 做乐观锁：更新时带上你读到的版本号，若期间被人改过，版本号对不上，更新**直接失败**，你再重试。

`index`/`update` 时加 `.ifSeqNo()` 和 `.ifPrimaryTerm()`：

```java
import co.elastic.clients.elasticsearch.core.GetResponse;
import co.elastic.clients.elasticsearch.core.UpdateResponse;
import com.example.es.domain.Product;

import java.io.IOException;

/** 乐观并发更新：只有在我读到的版本没被别人改过时才成功 */
public void safeUpdatePrice(String id, Double newPrice) throws IOException {
    // 1) 先取，拿到当前的 seqNo / primaryTerm（这就是"我读到的版本号"）
    GetResponse<Product> getResp = client.get(g -> g
            .index("products").id(id), Product.class);
    long seqNo = getResp.seqNo();
    long primaryTerm = getResp.primaryTerm();

    // 2) 更新时带上版本号；期间若被别人改过，会抛 ElasticsearchException（409 冲突）
    UpdateResponse<Product> upd = client.update(u -> u
            .index("products")
            .id(id)
            .doc(java.util.Map.of("price", newPrice))
            .ifSeqNo(seqNo)              // 乐观锁：期望的序列号
            .ifPrimaryTerm(primaryTerm)  // 乐观锁：期望的主分片代
            , Product.class);

    System.out.println("并发安全更新结果=" + upd.result());
}
```

::: tip 和数据库乐观锁一个道理
这等价于 MySQL 的 `UPDATE ... WHERE version = ?`。失败（`409 Conflict`，客户端抛 `ElasticsearchException`）后，业务层应当**重新读取最新值 → 重新计算 → 重试**，而不是无条件覆盖。库存、余额、计数这类"不能丢更新"的场景必须加。
:::

## 五、完整搜索操作

把第 04 章的查询用 Java 写一遍。每个都配完整代码。

### 5.1 构建各种查询

```java
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.elasticsearch._types.query_dsl.BoolQuery;
import co.elastic.clients.elasticsearch._types.FieldValue;
import co.elastic.clients.json.JsonData;
import java.util.List;

/** 各类查询的 Java 构造 */
public class QueryBuilders {

    /** term：精确匹配 keyword 字段 */
    public static Query termBrand(String brand) {
        return Query.of(q -> q.term(t -> t.field("brand").value(brand)));
    }

    /** match：全文分词匹配 text 字段 */
    public static Query matchTitle(String keyword) {
        return Query.of(q -> q.match(m -> m.field("title").query(keyword)));
    }

    /** terms：多值 OR（in 查询），用 FieldValue 列表 */
    public static Query termsCategory(List<String> categories) {
        return Query.of(q -> q.terms(t -> t
                .field("category")
                .terms(tt -> tt.value(categories.stream()
                        .map(FieldValue::of)
                        .toList()))));
    }

    /** range：数值范围 */
    public static Query priceRange(double min, double max) {
        return Query.of(q -> q.range(r -> r
                .field("price")
                .gte(JsonData.of(min))
                .lte(JsonData.of(max))));
    }

    /** bool：组合（相关性放 must，硬条件放 filter 不算分可缓存） */
    public static Query boolSearch(String keyword, String category) {
        return Query.of(q -> q.bool(b -> b
                .must(m -> m.match(mm -> mm.field("title").query(keyword)))
                .filter(f -> f.term(t -> t.field("category").value(category)))
                .filter(f -> f.range(r -> r.field("price").gte(JsonData.of(0.0))))));
    }
}
```

### 5.2 排序

```java
import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.SortOptions;
import co.elastic.clients.elasticsearch._types.FieldSort;
import co.elastic.clients.elasticsearch.core.SearchResponse;
import com.example.es.domain.Product;

import java.io.IOException;

/** 按价格升序 + 相关性降序 */
public List<Product> searchWithSort(String keyword) throws IOException {
    SearchResponse<Product> resp = client.search(s -> s
            .index("products")
            .query(q -> q.match(m -> m.field("title").query(keyword)))
            .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f
                    .field("price").order(SortOrder.Asc)))))
            .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f
                    .field("_score").order(SortOrder.Desc)))))
            , Product.class);
    return resp.hits().hits().stream().map(Hit::source).toList();
}
```

### 5.3 分页（from / size）

```java
import co.elastic.clients.elasticsearch.core.SearchResponse;
import com.example.es.domain.Product;

import java.io.IOException;
import java.util.List;

/** 浅分页：from 起始，size 每页条数（深分页请用 search_after，第 04 章讲过） */
public List<Product> page(String keyword, int from, int size) throws IOException {
    SearchResponse<Product> resp = client.search(s -> s
            .index("products")
            .query(q -> q.match(m -> m.field("title").query(keyword)))
            .from(from)
            .size(size)
            , Product.class);
    return resp.hits().hits().stream().map(Hit::source).toList();
}
```

### 5.4 高亮

```java
import co.elastic.clients.elasticsearch.core.SearchResponse;
import co.elastic.clients.elasticsearch.core.search.Hit;
import com.example.es.domain.Product;

import java.io.IOException;
import java.util.List;

/** 命中词高亮，结果在 hit.highlight() 里（不在 _source） */
public List<String> searchWithHighlight(String keyword) throws IOException {
    SearchResponse<Product> resp = client.search(s -> s
            .index("products")
            .query(q -> q.match(m -> m.field("title").query(keyword)))
            .highlight(h -> h
                    .preTags("<mark>").postTags("</mark>")
                    .fields("title", f -> f))
            , Product.class);

    // 高亮片段在 hit.highlight()（Map<字段, 片段列表>），前端直接渲染
    return resp.hits().hits().stream()
            .flatMap(hit -> hit.highlight().values().stream())
            .flatMap(List::stream)
            .toList();
}
```

### 5.5 嵌套字段查询（nested）

```java
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.elasticsearch._types.query_dsl.ChildScoreMode;
import co.elastic.clients.elasticsearch.core.SearchResponse;
import com.example.es.domain.Product;

import java.io.IOException;
import java.util.List;

/** 查"作者是张三且评分>=4"的评论所属商品 */
public List<Product> nestedSearch() throws IOException {
    Query query = Query.of(q -> q.nested(n -> n
            .path("reviews")
            .scoreMode(ChildScoreMode.Avg)
            .query(inner -> inner.bool(b -> b
                    .must(m -> m.term(t -> t.field("reviews.author").value("张三")))
                    .must(m -> m.range(r -> r.field("reviews.rating").gte(JsonData.of(4))))))
    ));

    SearchResponse<Product> resp = client.search(s -> s
            .index("products")
            .query(query)
            .size(10), Product.class);
    return resp.hits().hits().stream().map(Hit::source).toList();
}
```

## 六、异步客户端 ElasticsearchAsyncClient 简介

上面的 `ElasticsearchClient` 是**同步阻塞**的（方法直接返回结果，但线程会等网络）。新客户端还提供**异步**版本 `ElasticsearchAsyncClient`，方法返回 `CompletableFuture`，不阻塞调用线程，适合高并发/响应式场景。

```java
import co.elastic.clients.elasticsearch.ElasticsearchAsyncClient;
import co.elastic.clients.elasticsearch.core.SearchResponse;
import co.elastic.clients.transport.ElasticsearchTransport;
import com.example.es.domain.Product;

import java.util.concurrent.CompletableFuture;
import java.util.List;

/** 异步搜索：返回 CompletableFuture，不阻塞当前线程 */
public class AsyncDemo {

    private final ElasticsearchAsyncClient asyncClient;

    public AsyncDemo(ElasticsearchTransport transport) {
        // 异步客户端复用同一个 transport（同步/异步可共存）
        this.asyncClient = new ElasticsearchAsyncClient(transport);
    }

    public CompletableFuture<List<Product>> searchAsync(String keyword) {
        CompletableFuture<SearchResponse<Product>> future = asyncClient.search(s -> s
                .index("products")
                .query(q -> q.match(m -> m.field("title").query(keyword)))
                .size(10), Product.class);

        // 拿到 Future 后，用 thenApply / thenAccept 处理结果，不阻塞
        return future.thenApply(resp ->
                resp.hits().hits().stream().map(Hit::source).toList());
    }
}
```

::: tip 同步还是异步
- **普通 Spring MVC 接口**：用同步 `ElasticsearchClient` 就够了，代码直白（本章其余示例都同步）。
- **高并发网关 / 响应式（WebFlux）/ 批量导入**：用 `ElasticsearchAsyncClient`，避免线程被 IO 占满。
- 两者**共用同一个 `ElasticsearchTransport`**，可以一起注入。
:::

## 七、异常处理

ES 调用可能失败在两层：**传输层**（连不上/超时）和**业务层**（ES 返回错误，如字段不存在、版本冲突）。

### 7.1 异常分类与区分处理

| 异常 | 来源 | 典型原因 | 怎么处理 |
| --- | --- | --- | --- |
| `java.io.IOException` | 传输层（网络） | 连接被拒绝、读超时、连接重置 | 重试 / 检查 ES 是否存活 / 调大超时 |
| `co.elastic.clients.transport.TransportException` | 传输层（封装） | 底层 HTTP 异常 | 同 IOException |
| `co.elastic.clients.elasticsearch._types.ElasticsearchException` | **业务层**（ES 返回错误响应） | 字段类型错、mapping 冲突、版本冲突（409）、查询语法错 | 看 `error().type()`/`reason()` 定位，**不要盲目重试**（4xx 类重试也没用） |
| `org.elasticsearch.client.ResponseException` | 低层 `RestClient` 直接调用 | 非 2xx 响应（使用 RestClient 原生 API 时） | 转成上面的 `ElasticsearchException` 处理 |

```java
import co.elastic.clients.elasticsearch._types.ElasticsearchException;
import co.elastic.clients.elasticsearch.core.GetResponse;
import com.example.es.domain.Product;

import java.io.IOException;

/** 分层捕获：传输异常可重试，业务异常看原因 */
public Product safeGet(String id) {
    try {
        GetResponse<Product> resp = client.get(g -> g.index("products").id(id), Product.class);
        return resp.found() ? resp.source() : null;

    } catch (ElasticsearchException esEx) {
        // 业务层错误：ES 明确返回了错误（4xx/5xx 带 error body）
        String type = esEx.error().type();        // 如 "version_conflict_engine_exception"
        String reason = esEx.error().reason();
        System.err.println("ES 业务错误 type=" + type + " reason=" + reason);
        if ("version_conflict_engine_exception".equals(type)) {
            // 乐观锁冲突（409）：重新读取后重试，不要放弃
            return retryAfterRefresh(id);
        }
        throw esEx;   // 其它业务错误向上抛，让全局异常处理器兜底

    } catch (IOException ioEx) {
        // 传输层：连不上 / 超时 —— 这类才适合重试
        System.err.println("网络/传输异常：" + ioEx.getMessage());
        throw new RuntimeException("ES 连接异常，请检查集群状态", ioEx);
    }
}
```

::: warning 重试的边界
**只有传输层异常（IOException / 超时）才适合重试**——它们往往是临时抖动。业务层异常（字段拼错、mapping 冲突、版本冲突）重试多少次都一样，反而放大压力。版本冲突（409）是特例：它应该"重新读取最新值再重试"，而不是无脑重发原请求。
:::

### 7.2 重试策略（Resilience4j）

对传输层抖动加重试，用 Resilience4j 最省事（不要自己写 `for + sleep`）：

```java
import io.github.resilience4j.retry.Retry;
import io.github.resilience4j.retry.RetryConfig;

import java.time.Duration;
import java.io.IOException;

/** 给 ES 调用加重试：最多 3 次，间隔 1 秒，只对 IOException（传输层）重试 */
public class RetryableEsService {

    private final ElasticsearchClient client;
    private final Retry retry;

    public RetryableEsService(ElasticsearchClient client) {
        this.client = client;
        RetryConfig config = RetryConfig.custom()
                .maxAttempts(3)
                .waitDuration(Duration.ofSeconds(1))
                // 只对传输层 IOException 重试；ElasticsearchException（业务错）不重试
                .retryOnException(e -> e instanceof IOException)
                .build();
        this.retry = Retry.of("esRetry", config);
    }

    public long countByBrand(String brand) throws IOException {
        // 用重试器包住真正的调用
        return Retry.decorateCheckedSupplier(retry, () ->
                client.count(c -> c
                        .index("products")
                        .query(q -> q.term(t -> t.field("brand").value(brand)))
                ).count()
        ).get();
    }
}
```

依赖（Maven）：
```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-retry</artifactId>
    <version>2.2.0</version>
</dependency>
```

## 八、综合实战：@Service + @RestController 商品搜索模块

把前面串起来：从 Controller 入口 → Service 业务逻辑 → ES 调用，全链路打通。这是一个**能直接跑**的商品搜索接口。

**① Service 层（封装 ES 调用）**

```java
package com.example.es.service;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.SortOptions;
import co.elastic.clients.elasticsearch._types.FieldSort;
import co.elastic.clients.elasticsearch._types.query_dsl.BoolQuery;
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.elasticsearch.core.SearchResponse;
import co.elastic.clients.elasticsearch.core.search.Hit;
import co.elastic.clients.json.JsonData;
import com.example.es.domain.Product;

import java.io.IOException;
import java.util.List;

/**
 * 商品搜索 Service：封装所有 ES 调用细节，Controller 只调业务方法。
 */
@Service
public class ProductSearchService {

    private final ElasticsearchClient client;

    public ProductSearchService(ElasticsearchClient client) {
        this.client = client;
    }

    /**
     * 商品搜索：关键词（算分）+ 分类/价格区间（filter）+ 价格升序 + 高亮 + 分页。
     *
     * @param keyword   关键词（可空，空则 match_all）
     * @param category  分类过滤（可空）
     * @param minPrice  最低价（可空）
     * @param maxPrice  最高价（可空）
     * @param from      分页起始
     * @param size      每页条数
     */
    public List<Product> search(String keyword, String category,
                                Double minPrice, Double maxPrice,
                                int from, int size) throws IOException {

        // 1) 组装查询：关键词放 must（算分），硬条件放 filter（不算分、可缓存）
        Query query = Query.of(q -> q.bool(b -> {
            if (keyword != null && !keyword.isBlank()) {
                b.must(m -> m.match(mm -> mm.field("title").query(keyword)));
            } else {
                b.must(m -> m.matchAll(ma -> ma));   // 关键词为空则匹配全部
            }
            if (category != null) {
                b.filter(f -> f.term(t -> t.field("category").value(category)));
            }
            if (minPrice != null || maxPrice != null) {
                b.filter(f -> f.range(r -> {
                    if (minPrice != null) r.gte(JsonData.of(minPrice));
                    if (maxPrice != null) r.lte(JsonData.of(maxPrice));
                    return r;
                }));
            }
            return b;
        }));

        // 2) 发搜索请求（结果直接映射成 Product）
        SearchResponse<Product> resp = client.search(s -> s
                .index("products")
                .query(query)
                .from(from)
                .size(size)
                .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f
                        .field("price").order(SortOrder.Asc)))))
                .highlight(h -> h.preTags("<mark>").postTags("</mark>")
                        .fields("title", f -> f))
                , Product.class);

        // 3) 取出实体（真实项目这里应把高亮片段一起返回前端）
        return resp.hits().hits().stream()
                .map(Hit::source)
                .toList();
    }
}
```

**② Controller 层（HTTP 入口）**

```java
package com.example.es.controller;

import com.example.es.domain.Product;
import com.example.es.service.ProductSearchService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 商品搜索接口：GET /api/products/search
 */
@RestController
@RequestMapping("/api/products")
public class ProductSearchController {

    private final ProductSearchService searchService;

    public ProductSearchController(ProductSearchService searchService) {
        this.searchService = searchService;
    }

    /**
     * 商品搜索入口。
     * 示例：GET /api/products/search?keyword=手机&category=phone&minPrice=100&maxPrice=5000&from=0&size=10
     */
    @GetMapping("/search")
    public List<Product> search(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) Double minPrice,
            @RequestParam(required = false) Double maxPrice,
            @RequestParam(defaultValue = "0") int from,
            @RequestParam(defaultValue = "10") int size) throws IOException {

        return searchService.search(keyword, category, minPrice, maxPrice, from, size);
    }
}
```

**③ 启动并验证（curl 示例）**

先确保有数据（用前面 4.6 的 `bulkSave` 灌一批，或第 05 章的 DSL 手动写几条）。然后：

```bash
# 1) 关键词 + 分类 + 价格区间 + 分页
curl -X GET "http://localhost:8080/api/products/search?keyword=手机&category=phone&minPrice=100&maxPrice=5000&from=0&size=10"

# 2) 只按分类过滤（关键词留空 → 匹配全部，按价格升序）
curl -X GET "http://localhost:8080/api/products/search?category=phone&size=5"

# 3) 只看高亮效果（响应里每个商品的 title 命中词会被 <mark> 包起来）
curl -X GET "http://localhost:8080/api/products/search?keyword=无线"
```

返回（节选）：
```json
[
  {
    "id": "1",
    "title": "华为无线耳机",
    "price": 399.0,
    "brand": "华为",
    "category": "phone"
  }
]
```

::: tip 全链路心智模型
`Controller`（接 HTTP 参数）→ `Service`（拼 `Query`/排序/高亮/分页，调 `client.search`）→ `ElasticsearchClient`（发 REST 请求）→ ES。业务代码里**只和 `Product` 实体打交道**，所有 JSON 序列化、类型映射都由 `JacksonJsonpMapper` + 泛型 `SearchResponse<Product>` 包办。这正是官方 Java Client 的价值：**你写的是 Java，ES 收到的是标准 DSL。**
:::

## 本篇小结

- **只用 `elasticsearch-java`（Java API Client）**：`TransportClient` 已移除、`RestHighLevelClient` 已弃用，新项目一律用 `co.elastic.clients.elasticsearch.ElasticsearchClient`。
- **依赖层次**：`elasticsearch-rest-client`（低层 HTTP）是"腿"，`elasticsearch-java`（强类型 API）是"大脑"，`spring-boot-starter-data-elasticsearch` 俩都带。
- **接入四场景**：无密码（本地）、Basic Auth（云端 `BasicCredentialsProvider`）、HTTPS 自签证书（`SSLContext` 加载信任库）、HTTPS 忽略校验（`NoopHostnameVerifier` + 信任一切，**仅 dev**）。客户端三层套路固定：`RestClient → RestClientTransport(JacksonJsonpMapper) → ElasticsearchClient`。默认用 `JacksonJsonpMapper`。
- **写法**：Fluent Builder 简短、函数式 lambda 层级清晰（**新手首选**）；`SearchResponse<Product>` 泛型直接把 `_source` 映射成实体，不用手解析 JSON。
- **CRUD**：`index`/`get`/`update`/`delete`/`exists` 一字排开；`bulk` 批量要把操作包成 `BulkOperation`、单批 1000~5000 条 / 5~15MB、必须检查 `errors()`；`upsert` 用 `docAsUpsert(true)`；乐观并发控制用 `ifSeqNo` + `ifPrimaryTerm` 防丢失更新（冲突抛 409 需重试）。
- **搜索**：`term`/`match`/`terms`/`range`/`bool` 等查询、排序（`SortOptions`）、分页（`from/size`）、高亮（`hit.highlight()`）、`nested` 查询，全部配了完整 Java 代码。
- **异步**：`ElasticsearchAsyncClient` 返回 `CompletableFuture`，复用同一 transport，适合高并发/响应式。
- **异常**：传输层 `IOException`（可重试）vs 业务层 `ElasticsearchException`（看 `error().type()`/`reason()`，不要盲目重试；409 版本冲突要重读重试）。重试用 Resilience4j，只对 `IOException` 重试。
- **收尾**：`@Service` + `@RestController` 商品搜索模块从 Controller→Service→ES 全链路打通，配 curl 示例可直接跑。

## 参考链接

- 官方 Java API Client 文档：<https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/index.html>
- 客户端接入（Connecting）：<https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/java-client-usage.html>
- 配置（Configuration）：<https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/java-client-config.html>
- 索引/文档 API：<https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/java-client-indexed-documents.html>
- 批量 bulk：<https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/java-client-bulk.html>
- 乐观并发控制：<https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html>
- 异常处理：<https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/java-client-exceptions.html>
- Spring Boot Elasticsearch 自动配置：<https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.elasticsearch>
- Resilience4j：<https://resilience4j.readme.io/>

下一篇 → [07 Spring Data ES 实战](/java/middleware/es/spring-data)
