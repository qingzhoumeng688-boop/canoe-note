# 07 Spring Data ES 实战

> 前几章我们把 ES 当成一个"需要手写 JSON 的搜索引擎"来用：第 05 章在 Kibana 里拼 DSL，第 06 章用官方 Java Client 写 `ElasticsearchClient.search(...)`。这一章我们把抽象层级再往上抬一层——**用 Spring Data Elasticsearch，把 ES 当成"数据库"来用**：写最少量的代码，甚至只写一个接口方法名，就能完成增删改查、分页、排序、高亮、聚合。

## 本篇要解决的问题

- 前面那一坨 `Query.of(q -> q.bool(b -> ...))` 虽然强类型，但毕竟还是"拼查询"，业务代码里到处是这种样板，能不能更省？
- `ElasticsearchRepository` 到底能帮我们省多少事？方法名派生查询真的"写个方法名就出查询"吗？
- `@Document` / `@Field` / `@MultiField` 这些注解每个字段到底怎么标？
- 什么时候该用 Repository，什么时候必须退回 `ElasticsearchOperations` / `NativeQuery`？
- 自动建索引很方便，但 `mapping` 不符合预期怎么办？生产上推荐怎么管索引？
- 官方 Java Client（第 06 章）和 Spring Data ES（本章）到底什么关系，两者怎么选、能不能混用？

::: tip 本章和上一章的关系
第 06 章是"用官方 Java Client 直接调 ES"；本章是"在它之上套一层 Spring Data 的壳"。**底层一模一样**（都是 `co.elastic.clients.elasticsearch.ElasticsearchClient`），区别是：**你写不写样板代码**。所以本章不会重复第 06 章的 `ProductWriteService` 那一套，重点放在 Spring Data 独有的 Repository、`CriteriaQuery`、`NativeQuery` 封装、索引生命周期管理上。
:::

## 一、它到底解决了什么问题：把 ES 当数据库用

先回到一个具体痛点。假设你要实现一个"按标题搜商品"的接口，第 06 章的写法是这样的：

```java
// 第 06 章：官方 Java Client 写法（需要自己拼 Query）
SearchResponse<Product> resp = client.search(s -> s
        .index("products")
        .query(q -> q.match(m -> m.field("title").query(keyword)))
        .size(10), Product.class);
List<Product> list = resp.hits().hits().stream().map(Hit::source).toList();
```

问题在哪？你每加一个查询维度（按品牌、按分类、按价格区间），就得再写一段 `bool` 组合；分页、排序、高亮又各是一坨。一个真实商品搜索接口写下来，这种样板能有上百行。

**Spring Data ES 的解法**——把"按标题搜"直接变成一个接口方法名：

```java
// 本章：Spring Data 写法（只写一行方法签名，实现由框架生成）
public interface ProductRepository extends ElasticsearchRepository<Product, String> {
    // 方法名 = 查询意图，框架自动翻译成 ES 查询
    List<Product> findByTitleContaining(String keyword);
}
```

然后业务代码里：

```java
List<Product> list = productRepository.findByTitleContaining("无线耳机");
```

**对比一下**：

| 维度 | 官方 Java Client（第 06 章） | Spring Data ES（本章） |
| --- | --- | --- |
| 写查询 | 手拼 `Query` / `NativeQuery` | 写方法名 or 一个 `@Query` |
| 分页排序 | 自己 `PageRequest` + `sort(...)` | 方法参数加 `Pageable`/`Sort` 即可 |
| 实体映射 | 靠 Jackson 注解 + 自己建索引 | `@Document` / `@Field` 注解即映射 |
| 适合 | 复杂、动态、需要精细控制的查询 | 标准 CRUD + 简单派生查询 |
| 心智负担 | 低层，但要懂每个 API | 高封装，但灵活度受框架约束 |

一句话：**Spring Data ES 让你用"最少的代码"把 ES 当数据库用，把精力留给业务逻辑**；当封装不够用时，再退回第 06 章的底层客户端。两者底层是同一个东西，不是二选一，而是"平时用框架，特殊场景钻下去"。

## 二、依赖与配置（重点是 uris，不是 cluster-nodes）

### 2.1 完整 pom.xml

和前面章节共用同一套基线：**JDK 17 + Spring Boot 3.5.5 + elasticsearch-java 8.18.x + Spring Data Elasticsearch 5.5.x**。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">

    <modelVersion>4.0.0</modelVersion>

    <!-- 继承 Spring Boot 3.5.5 父 POM，统一管理 Spring 生态依赖版本 -->
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

        <!--
        ============================================================
        版本对齐红线（全站反复强调）：
        属性名是 elasticsearch-client.version，不是旧教程里的
        elasticsearch.version（那个属性在 3.5 BOM 里已不存在，写了不生效，
        客户端还是用 BOM 默认值，可能和服务端对不上）。
        把它锁成和你服务端一致的 8.18.x，保证大版本严格一致。
        ============================================================
        -->
        <elasticsearch-client.version>8.18.5</elasticsearch-client.version>
    </properties>

    <dependencies>
        <!-- Web 能力，提供 HTTP 接口 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!--
        Spring Data Elasticsearch 启动器：
        它会自动带入官方 Java 客户端 co.elastic.clients:elasticsearch-java
        （版本由上面的 elasticsearch-client.version 控制），
        并提供自动配置、Repository、ElasticsearchOperations 等。
        -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-elasticsearch</artifactId>
        </dependency>

        <!-- 参数校验（接口层会用到 @NotNull 等） -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>

        <!-- Lombok：少写 getter/setter（可选，按团队习惯） -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>

        <!-- 测试 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
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

### 2.2 application.yml：连接配置

```yaml
spring:
  application:
    name: es-demo
  elasticsearch:
    # ES 的 REST 地址（本地 Docker 就是它）
    # ⚠️ 注意：是 uris（复数、带 s），不是旧教程里写的 cluster-nodes / clusterNodes
    # 这是初学者最常见的报错来源之一，见下方 danger 提示
    uris: http://localhost:9200
    # 本地关了安全认证，不需要 username/password
    # 连阿里云时填：username: elastic / password: ${ES_CLOUD_PASSWORD}
    # 连接与读取超时（ES 查询可能比普通接口慢，给足时间）
    connection-timeout: 5s
    socket-timeout: 30s

server:
  port: 8080

logging:
  level:
    # 打开 Spring Data ES 的 DEBUG，初期排查很有用；稳定后可调回 INFO
    org.springframework.data.elasticsearch: INFO
```

::: danger 最常见的配置报错：uris vs cluster-nodes
很多老博客 / 旧教程里写的是 `spring.data.elasticsearch.cluster-nodes` 或 `clusterNodes`，那是 **Spring Data Elasticsearch 4.x 及更早、基于 TransportClient 时代的配置项**。从 4.0 起底层换成基于 HTTP REST 的客户端之后，这个配置项就**失效**了。你现在用的是 5.5，对应配置键是 **`spring.elasticsearch.uris`**（注意层级：`spring.elasticsearch` 不是 `spring.data.elasticsearch`，且是 `uris` 不是 `cluster-nodes`）。

如果你写成 `cluster-nodes`，Spring Boot 自动配置读不到，启动后注入的 `ElasticsearchClient` 连的是默认 `localhost:9200`，稍一改端口或上云就 **`java.net.ConnectException: Connection refused`**。记住这行：

```yaml
spring:
  elasticsearch:
    uris: http://localhost:9200
```
:::

::: tip Spring Boot 怎么知道连哪
`spring.elasticsearch.uris` 会被 Spring Boot 的自动配置读走，自动帮你建好低层 `RestClient` 和官方 `ElasticsearchClient`，并注册成 `ElasticsearchOperations`（具体实现是 `ElasticsearchTemplate`）Bean。**绝大多数情况你不用写任何配置类**，直接 `@Autowired ElasticsearchOperations` 或 `ElasticsearchRepository` 就能用。需要自定义（加 TLS、pathPrefix、凭据）时，再写 `@Configuration` 覆盖它。
:::

## 三、实体映射：@Document / @Id / @Field 全家桶

ES 是"文档型"存储，但你写业务代码用的是 Java 对象。怎么让一个 `Product` Java 对象，自动变成 ES 里的一条 `products` 文档？靠的就是这一组注解。**它们的作用，等价于你在 Kibana 里手写的 `PUT /products` 的 mapping。**

先用一个比喻：

> 你想往图书馆（ES）存一批书（文档）。`@Document` 相当于"我这批书放哪个书架（index）"；`@Id` 相当于每本书的"书号"；`@Field` 相当于"这本书的每一条信息（书名、作者、价格）分别是什么类型、要不要被检索、怎么分词"。你把这些标注清楚，Spring Data 启动时就能自动帮你把"书架"和"目录规则（mapping）"建好。

### 3.1 @Document：标记这是一个 ES 文档类

```java
package com.example.es.domain;

import org.springframework.data.elasticsearch.annotations.Document;

// indexName：索引名（必须全小写、不能含大写和特殊字符）
// shards：主分片数（默认 1）
// replicas：副本数（默认 1；本地单节点设 0，否则索引一直 yellow）
// createIndex：启动时是否自动建索引（默认 true）。生产建议设 false，见第八章"自动建索引的坑"
@Document(indexName = "products", shards = 1, replicas = 0, createIndex = false)
public class Product {
    // ... 字段见下方
}
```

::: warning shards/replicas 在新版已被 @Setting 取代（但仍可用）
在 Spring Data ES 5.x 里，`@Document` 上的 `shards` / `replicas` / `refreshInterval` 这三个属性**已被标记为 `@Deprecated`（自 4.2 起）**，官方建议改用独立的 `@Setting` 注解来配置索引设置。不过它们目前还能正常工作，为了不让初学者第一步就卡住，本章先用 `@Document` 简单写法演示；**生产环境建议用 `@Setting`（见 3.7 节）**。两种写法本章都会给。
:::

### 3.2 @Id：文档主键

```java
import org.springframework.data.annotation.Id;

@Id
private String id;   // 会映射到 ES 的 _id 字段
```

`@Id` 来自 `org.springframework.data.annotation.Id`（Spring Data 公共包），不是 ES 专属。标记后，这个字段的值就是 ES 文档的 `_id`。查、改、删都靠它。

### 3.3 @Field：声明每个字段的类型与行为

`@Field` 是映射的核心。常用属性：

| 属性 | 含义 | 举例 |
| --- | --- | --- |
| `type` | 字段类型（`FieldType` 枚举） | `FieldType.Text` / `Keyword` / `Integer` / `Date` |
| `name` | ES 里的字段名（不写则用 Java 字段名） | `@Field(name = "product_title")` |
| `analyzer` | 索引时用的分词器 | `analyzer = "ik_max_word"`（中文） |
| `searchAnalyzer` | 搜索时用的分词器 | `searchAnalyzer = "ik_smart"` |
| `index` | 是否建索引（false 则不可被搜索，但可存） | `index = false` |
| `store` | 是否单独存储（默认 false，从 `_source` 取） | `store = true` |
| `format` | 日期格式（`DateFormat` 枚举） | `format = DateFormat.date_time` |
| `pattern` | 自定义日期格式字符串 | `pattern = "yyyy-MM-dd HH:mm:ss"` |
| `fielddata` | text 字段是否允许聚合/排序（默认 false，极耗内存） | `fielddata = true` |
| `copyTo` | 把本字段值拷贝到别的字段 | `copyTo = "all"` |

`FieldType` 常见取值（不限于这些，全部以官方文档为准）：

| FieldType | 对应 ES 类型 | 用途 |
| --- | --- | --- |
| `Text` | `text` | 全文字段，会被分词，用于模糊搜索 |
| `Keyword` | `keyword` | 不分词，用于精确匹配、聚合、排序 |
| `Integer` / `Long` / `Short` / `Byte` | 整型 | 数量、ID 等 |
| `Double` / `Float` | 浮点 | 价格、评分 |
| `Boolean` | `boolean` | 是否上架等 |
| `Date` | `date` | 时间，配合 `format` |
| `Object` | `object` | 嵌套 JSON 对象 |
| `Nested` | `nested` | 需要独立检索的嵌套数组（如评论列表） |
| `Geo_Point` | `geo_point` | 经纬度，用于附近搜索 |
| `Ip` | `ip` | IP 地址 |
| `KnnVector` | `dense_vector` | 向量（kNN 检索，详见第 08 章） |

### 3.4 @MultiField / @InnerField：一个字段既能搜又能聚合

这是初学者最该掌握的技巧之一。常见需求：**一个 `title` 字段，既要能被全文分词搜索，又要能按"原样"精确匹配、排序、聚合**。

但 `text` 字段不能直接排序/聚合（会报 `Fielddata is disabled`），而 `keyword` 字段又不能分词搜索。解决办法：**同一个字段存两份映射**——主字段 `text`（分词，用于搜），内嵌子字段 `keyword`（不分词，用于聚合/排序）。这就是 `@MultiField` + `@InnerField`。

```java
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;
import org.springframework.data.elasticsearch.annotations.MultiField;
import org.springframework.data.elasticsearch.annotations.InnerField;

// 主字段 title 是 text（分词，可搜）；
// 子字段 title.keyword 是 keyword（不分词，可排序/聚合/精确匹配）
@MultiField(
    mainField = @Field(type = FieldType.Text, analyzer = "ik_max_word", searchAnalyzer = "ik_smart"),
    otherFields = {
        @InnerField(suffix = "keyword", type = FieldType.Keyword)
    }
)
private String title;
```

建出来的 mapping 等价于你在 Kibana 里写的：

```json
{
  "title": {
    "type": "text",
    "analyzer": "ik_max_word",
    "search_analyzer": "ik_smart",
    "fields": {
      "keyword": { "type": "keyword" }
    }
  }
}
```

业务里：
- 全文搜索用 `title`：`findByTitleContaining("耳机")`
- 精确匹配 / 排序 / 聚合用 `title.keyword`：`NativeQuery` 里 `.field("title.keyword")` 或派生查询 `findByTitleKeyword(...)`（注意写法，详见第四节）

### 3.5 日期字段：用 @Field(type = Date) + format（注意：没有 @DateField）

很多教程会写 `@DateField` 或 `@Point`，**在 Spring Data Elasticsearch 5.x 里这些都不是标准注解**。日期字段的正确写法是 `@Field(type = FieldType.Date, format = ...)`：

```java
import org.springframework.data.elasticsearch.annotations.DateFormat;

// 方式一：用内置格式枚举
@Field(type = FieldType.Date, format = DateFormat.date_time)
private LocalDateTime createdAt;

// 方式二：用自定义 pattern（更常见，因为你的数据格式往往不标准）
@Field(type = FieldType.Date,
       format = DateFormat.custom,
       pattern = "yyyy-MM-dd HH:mm:ss")
private LocalDateTime onSaleAt;
```

::: danger 没有 @DateField 注解
Spring Data Elasticsearch **没有** `@DateField` 这个注解（那是其他 ORM 或旧版本的叫法）。日期一律用 `@Field(type = FieldType.Date, format = ..., pattern = ...)`。同理，地理坐标**没有** `@Point` 注解，而是 `@Field(type = FieldType.Geo_Point)`（见下）。写错注解名会直接编译不过或 mapping 不符合预期。
:::

### 3.6 地理坐标：@Field(type = FieldType.Geo_Point)

"附近奶茶店""离我最近的仓库"这类需求，靠 `geo_point` 实现：

```java
import org.springframework.data.elasticsearch.annotations.FieldType;

// 一个经纬度点，类型是 Geo_Point（注意下划线）
@Field(type = FieldType.Geo_Point)
private GeoPoint location;   // org.springframework.data.elasticsearch.core.geo.GeoPoint
```

Java 侧用 `GeoPoint` 对象存经纬度：

```java
// 构造：纬度 lat，经度 lon
this.location = new GeoPoint(39.9087, 116.3975);
```

### 3.7 @Setting：生产级索引设置（替代 @Document 上的废弃属性）

前面说了 `@Document` 的 `shards`/`replicas` 已废弃。生产上用 `@Setting` 单独声明索引设置：

```java
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.elasticsearch.annotations.Setting;

@Document(indexName = "products")
@Setting(
    shards = 3,                       // 主分片数
    replicas = 1,                    // 副本数
    refreshInterval = "1s",          // 刷新间隔（写入可见性，第 08 章会讲调优）
    indexStoreType = "fs"
)
public class Product {
    // ...
}
```

如果想把 settings 抽到独立 JSON 文件（便于版本管理和运维 review），用 `settingPath`：

```java
@Setting(settingPath = "/elasticsearch/products-settings.json")
public class Product { ... }
```

`src/main/resources/elasticsearch/products-settings.json`：

```json
{
  "index": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "1s"
  },
  "analysis": {
    "analyzer": {
      "my_ik": {
        "type": "ik_max_word"
      }
    }
  }
}
```

### 3.8 完整的 Product 实体（可直接复制）

和前面章节的 `Product` 字段保持一致（id、title、description、price、category、brand、tags、onSale、createdAt、嵌套 reviews）：

```java
package com.example.es.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;
import org.springframework.data.elasticsearch.annotations.InnerField;
import org.springframework.data.elasticsearch.annotations.MultiField;
import org.springframework.data.elasticsearch.annotations.Setting;
import org.springframework.data.elasticsearch.core.geo.GeoPoint;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 商品文档，对应 ES 索引 products。
 *
 * 设计要点：
 * 1. title 用 @MultiField：text 分词可搜 + keyword 子字段可聚合/排序
 * 2. category / brand 直接 keyword：只用于精确过滤和聚合，不需要分词
 * 3. price 用 scaled_float 或 double：用于范围查询和 avg 聚合
 * 4. createdAt 用 Date + 自定义 pattern
 * 5. reviews 用 Nested：每条评论是独立可检索的对象，避免数组扁平化导致的误匹配
 */
@Document(indexName = "products")
@Setting(shards = 1, replicas = 0, refreshInterval = "1s")
public class Product {

    @Id
    private String id;

    // 主字段分词可搜；子字段 title.keyword 不分词，用于排序/聚合
    @MultiField(
        mainField = @Field(type = FieldType.Text, analyzer = "ik_max_word", searchAnalyzer = "ik_smart"),
        otherFields = { @InnerField(suffix = "keyword", type = FieldType.Keyword) }
    )
    private String title;

    @Field(type = FieldType.Text, analyzer = "ik_max_word")
    private String description;

    // double：价格区间用 range 查询，算均价用 avg 聚合，不能用 keyword
    @Field(type = FieldType.Double)
    private Double price;

    // keyword：分类/品牌一般精确匹配 + 聚合统计，不需要分词
    @Field(type = FieldType.Keyword)
    private String category;

    @Field(type = FieldType.Keyword)
    private String brand;

    // 标签数组，keyword 便于 terms 聚合
    @Field(type = FieldType.Keyword)
    private List<String> tags;

    @Field(type = FieldType.Boolean)
    private Boolean onSale;

    // 日期：自定义格式，保证 Java LocalDateTime 和 ES date 互转正确
    @Field(type = FieldType.Date, format = DateFormat.custom, pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createdAt;

    // 地理坐标：附近搜索用
    @Field(type = FieldType.Geo_Point)
    private GeoPoint location;

    // 嵌套对象：评论。注意 type = Nested，否则数组内跨字段匹配会出错
    @Field(type = FieldType.Nested)
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
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public Double getPrice() { return price; }
    public void setPrice(Double price) { this.price = price; }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public String getBrand() { return brand; }
    public void setBrand(String brand) { this.brand = brand; }

    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags; }

    public Boolean getOnSale() { return onSale; }
    public void setOnSale(Boolean onSale) { this.onSale = onSale; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public GeoPoint getLocation() { return location; }
    public void setLocation(GeoPoint location) { this.location = location; }

    public List<Review> getReviews() { return reviews; }
    public void setReviews(List<Review> reviews) { this.reviews = reviews; }

    /** 嵌套评论对象 */
    public static class Review {
        @Field(type = FieldType.Keyword)
        private String author;

        @Field(type = FieldType.Integer)
        private Integer rating;

        @Field(type = FieldType.Text)
        private String content;

        public String getAuthor() { return author; }
        public void setAuthor(String author) { this.author = author; }
        public Integer getRating() { return rating; }
        public void setRating(Integer rating) { this.rating = rating; }
        public String getContent() { return content; }
        public void setContent(String content) { this.content = content; }
    }
}
```

## 四、Repository 用法：写个方法名就出查询

这是 Spring Data ES 最爽的地方。你定义一个接口继承 `ElasticsearchRepository`，**连实现类都不用写**，框架在启动时按"方法名"自动生成查询实现。

```java
package com.example.es.repository;

import com.example.es.domain.Product;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.elasticsearch.repository.ElasticsearchRepository;

import java.util.List;

/**
 * 第一个泛型：文档类型（Product）
 * 第二个泛型：主键类型（ES 的 _id 是字符串，所以用 String）
 *
 * 继承后，save / findById / findAll / delete / count 等方法直接白送。
 */
public interface ProductRepository extends ElasticsearchRepository<Product, String> {

    // ① 派生查询：方法名 = 查询意图
    // 按 title 模糊搜（对 text 字段做 match，中文分词自动生效）
    List<Product> findByTitleContaining(String keyword);

    // ② 多条件组合：And / Or
    List<Product> findByTitleContainingAndBrand(String keyword, String brand);

    // ③ 精确匹配 keyword 字段
    List<Product> findByCategory(String category);

    // ④ 范围查询：Between
    List<Product> findByPriceBetween(Double min, Double max);

    // ⑤ 比较：GreaterThan
    List<Product> findByPriceGreaterThan(Double price);

    // ⑥ 排序：OrderBy + 字段 + 方向（Asc/Desc）
    List<Product> findByCategoryOrderByPriceDesc(String category);

    // ⑦ 分页：加一个 Pageable 参数，返回 Page<Product>
    Page<Product> findByBrand(String brand, Pageable pageable);

    // ⑧ 统计：countBy...
    long countByCategory(String category);

    // ⑨ 判断存在：existsBy...
    boolean existsByTitle(String title);
}
```

### 4.1 方法名派生查询：关键字对照表（列全）

Spring Data 的方法名解析器把"方法名里的关键字"翻译成 ES 查询。下面这张表是从官方 `query-keywords-reference` 整理来的**全量关键字**，记住它们，你 90% 的简单查询都不用写 `@Query`：

| 关键字 | 含义 | 示例方法 | 翻译成的查询 |
| --- | --- | --- | --- |
| `And` | 并且（must） | `findByTitleAndBrand` | `bool.must` 两个条件 |
| `Or` | 或者（should） | `findByTitleOrContent` | `bool.should` |
| `Is` / `Equals` | 等于（精确） | `findByBrandIs` | `term` |
| `Not` | 不等于 | `findByBrandNot` | `bool.must_not` |
| `Between` | 区间（含两端） | `findByPriceBetween` | `range` |
| `LessThan` | 小于 | `findByPriceLessThan` | `range.lt` |
| `LessThanEqual` | 小于等于 | `findByPriceLessThanEqual` | `range.lte` |
| `GreaterThan` | 大于 | `findByPriceGreaterThan` | `range.gt` |
| `GreaterThanEqual` | 大于等于 | `findByPriceGreaterThanEqual` | `range.gte` |
| `Before` / `After` | 时间早于/晚于 | `findByCreatedAtAfter` | `range` 日期 |
| `Like` | 模糊（wildcard） | `findByTitleLike` | `query_string` + 通配 |
| `StartingWith` | 前缀 | `findByTitleStartingWith` | `query_string` + `关键词*` |
| `EndingWith` | 后缀 | `findByTitleEndingWith` | `query_string` + `*关键词` |
| `Containing` / `Contains` | 包含（分词） | `findByTitleContaining` | `match`（**中文搜索最常用**） |
| `In` | 在集合内（in 查询） | `findByCategoryIn` | `terms` |
| `NotIn` | 不在集合内 | `findByCategoryNotIn` | `bool.must_not` + `terms` |
| `True` / `False` | 布尔值 | `findByOnSaleTrue` | `term` |
| `OrderBy...Asc/Desc` | 排序 | `findByCategoryOrderByPriceDesc` | `sort` |
| `First` / `Top` / `Distinct` | 限制条数 / 去重 | `findFirst5ByBrand` | `size` / `collapse` |
| `Exists` | 字段存在 | `existsByTitle` | 是否存在投影 |
| `IgnoreCase` | 忽略大小写 | `findByBrandIgnoreCase` | 大小写不敏感匹配 |

::: tip 中文搜索为什么用 Containing
`findByTitleContaining("耳机")` 会被翻译成对 `title`（text 字段）的 `match` 查询，会自动经过中文分词器（如 `ik_max_word`），所以"无线蓝牙耳机"这种文档也能被搜到。**这是商品搜索里最常用的一招**。而 `findByTitle("耳机")`（`Is`/精确）会被翻译成 `term` 查询，要求整个字段值完全等于"耳机"才匹配——对 text 字段几乎匹配不到，新手常踩这个坑。
:::

### 4.2 分页与排序：Pageable / Sort / Page

只要方法参数里出现 `Pageable` 或 `Sort`，框架就自动帮你分页/排序，返回 `Page<Product>`（带总数）或 `List<Product>`。

```java
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

// 在 Service 里调用
Page<Product> page = productRepository.findByBrand("华为",
        PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "price")));

long total = page.getTotalElements();   // 命中总数
int totalPages = page.getTotalPages();  // 总页数
List<Product> content = page.getContent();  // 当前页数据
```

注意：排序字段如果是 text 类型（如 `title`），必须排它的 `keyword` 子字段，否则会报 `Fielddata is disabled`。所以排序一般写 `Sort.by("title.keyword")` 或 `Sort.by("price")`。

### 4.3 自定义 @Query：写原生 JSON

当派生查询表达能力不够（比如 `bool` 里要同时放 `must` 和 `filter`、要写 `multi_match`、要写嵌套查询）时，用 `@Query` 直接把 ES 的查询 JSON 写上去。占位符 `?0`、`?1` 对应方法参数顺序。

```java
import org.springframework.data.elasticsearch.annotations.Query;

public interface ProductRepository extends ElasticsearchRepository<Product, String> {

    /**
     * @Query 的值是 ES 的"查询体" JSON（即 _search 请求里 query 字段的内容）。
     * ?0 对应第一个参数 keyword，?1 对应第二个参数 category。
     * 这里用 bool：must 放相关性算分的关键词，filter 放硬过滤（不算分、可缓存）。
     */
    @Query("""
           {
             "bool": {
               "must":   { "match": { "title": "?0" } },
               "filter": { "term":  { "category": "?1" } }
             }
           }
           """)
    Page<Product> searchByTitleAndCategory(String keyword, String category, Pageable pageable);

    /**
     * 多字段搜索：multi_match 在 title 和 description 同时搜。
     */
    @Query("""
           {
             "multi_match": {
               "query": "?0",
               "fields": ["title^3", "description"]
             }
           }
           """)
    List<Product> searchAcrossFields(String keyword);
}
```

`@Query` 方法支持的返回类型：`List<Product>`、`Page<Product>`、`Stream<Product>`、`SearchHits<Product>`（需要原始命中信息，包括 `_score`、高亮时很有用）。

### 4.4 高亮：@Highlight 注解

想让命中词在结果里被 `<em>` 包起来交给前端高亮，在 Repository 方法上加 `@Highlight`：

```java
import org.springframework.data.elasticsearch.annotations.Highlight;
import org.springframework.data.elasticsearch.annotations.HighlightField;
import org.springframework.data.elasticsearch.core.SearchHits;

public interface ProductRepository extends ElasticsearchRepository<Product, String> {

    @Highlight(fields = {
        @HighlightField(name = "title"),
        @HighlightField(name = "description")
    })
    SearchHits<Product> findByTitleContaining(String keyword);
}
```

返回 `SearchHits<Product>` 后，从每个 `SearchHit` 取高亮：

```java
SearchHits<Product> hits = productRepository.findByTitleContaining("耳机");
for (SearchHit<Product> hit : hits) {
    // 高亮片段：Map<字段名, 高亮片段列表>
    Map<String, List<String>> hl = hit.getHighlightFields();
    List<String> titleHl = hl.get("title");  // 例如 ["华为无线<em>耳机</em>"]
}
```

::: tip 高亮标签
默认高亮标签是 `<em></em>`。要自定义前缀后缀（比如前端用 `<mark>`），在 `@Highlight` 上加 `preTags` / `postTags`（具体属性名以你所用版本官方文档为准）。高亮片段不在 `_source` 里，在响应的 `highlight` 部分，前端直接用即可。
:::

## 五、ElasticsearchOperations / ElasticsearchTemplate：什么时候用它而不是 Repository

Repository 很省，但有三个场景它不够用，**必须退回 `ElasticsearchOperations`**（自动配置注册的实现是 `ElasticsearchTemplate`）：

1. **聚合查询**（terms 统计、avg、histogram 等）—— Repository 方法无法直接返回聚合结果。
2. **完全动态的查询拼装**——前端筛选项有 10 个，用户可能只填了 3 个，你需要按"有没有值"动态决定是否加条件。Repository 方法名是静态的，搞不定这种运行时拼装。
3. **需要精细控制返回字段、`_source` 过滤、routing、scroll 流处理**等底层能力时。

注入方式（二选一，等价）：

```java
// 方式一：注入接口（推荐，松耦合）
@Autowired
private ElasticsearchOperations elasticsearchOperations;

// 方式二：直接注入实现类
@Autowired
private ElasticsearchTemplate elasticsearchTemplate;
```

`ElasticsearchOperations` 的核心方法：

| 方法 | 作用 |
| --- | --- |
| `search(Query, Class)` | 搜索，返回 `SearchHits<T>` |
| `save(Object)` / `saveAll(Collection)` | 写入/更新文档 |
| `get(String, Class)` | 按 id 取 |
| `delete(String, Class)` | 按 id 删 |
| `indexOps(Class)` | 拿到 `IndexOperations` 管理索引 |
| `searchForStream(Query, Class)` | 流式遍历大结果集（scroll 封装） |
| `count(Query, Class)` | 统计命中数 |

## 六、CriteriaQuery vs StringQuery vs NativeQuery：三种写法分别适合什么

Spring Data ES 提供三种"查询对象"，对应不同复杂度。理解它们各自的甜区，你就知道什么时候用哪个。

### 6.1 CriteriaQuery：类型安全的"方法链"查询（适合中等复杂、全 Java 拼装）

`CriteriaQuery` 用 `Criteria` 对象描述条件，不用写 JSON，IDE 全程补全。

```java
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.SearchHits;
import org.springframework.data.elasticsearch.core.query.Criteria;
import org.springframework.data.elasticsearch.core.query.CriteriaQuery;
import com.example.es.domain.Product;

import java.util.List;

public class CriteriaDemo {

    private final ElasticsearchOperations operations;

    public CriteriaDemo(ElasticsearchOperations operations) {
        this.operations = operations;
    }

    /** 标题包含"耳机" 且 品牌是"华为" 且 价格在 100~500 之间 */
    public List<Product> search() {
        // 用 Criteria.where 起手，链式拼条件，默认 AND
        Criteria criteria = new Criteria("title").contains("耳机")
                .and("brand").is("华为")
                .and("price").between(100.0, 500.0);

        CriteriaQuery query = new CriteriaQuery(criteria);
        SearchHits<Product> hits = operations.search(query, Product.class);
        return hits.stream().map(h -> h.getContent()).toList();
    }
}
```

`Criteria` 常用方法：`is()`（等于）、`contains()`（包含/分词）、`startsWith()`、`endsWith()`、`between()`、`greaterThan()`、`lessThan()`、`in(Collection)`、`not()`、`and()`、`or()`、`subCriteria()`（嵌套子查询）。

### 6.2 StringQuery：直接贴 JSON（适合从 Kibana 抄来的查询）

你第 05 章在 Kibana 调好的 DSL，想直接搬到 Java，用 `StringQuery` 最省事——把 JSON 字符串原样塞进去。

```java
import org.springframework.data.elasticsearch.core.query.StringQuery;

public List<Product> searchByJson(String keyword) {
    // 注意：这里放的是 query 的内容（即 _search 里 "query" 字段的值）
    String json = """
            {
              "bool": {
                "must":   { "match": { "title": "%s" } },
                "filter": { "range": { "price": { "gte": 100, "lte": 500 } } }
              }
            }
            """.formatted(keyword);

    StringQuery query = new StringQuery(json);
    SearchHits<Product> hits = operations.search(query, Product.class);
    return hits.stream().map(h -> h.getContent()).toList();
}
```

::: warning StringQuery 的坑
`StringQuery` 的值是 **query 体**（`{ "match": {...} }`），不是整个 `_search` 请求体。如果你把 `{"query": {...}, "aggs": {...}}` 整个塞进去，框架只会把最外层当 query，聚合会失效。需要聚合时用下面的 `NativeQuery`。
:::

### 6.3 NativeQuery：最强写法（适合聚合、嵌套、复杂组合）

`NativeQuery` 底层直接对接官方 Java Client 的 `Query`（`co.elastic.clients...query_dsl.Query`），**能力最全**：能写任意查询、任意聚合、高亮、排序、分页、字段过滤。当你需要聚合时，**只能用它**（或 `@Query`）。

```java
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.elasticsearch.client.elc.NativeQuery;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.SearchHits;
import com.example.es.domain.Product;

import java.util.List;

public class NativeQueryDemo {

    private final ElasticsearchOperations operations;

    public NativeQueryDemo(ElasticsearchOperations operations) {
        this.operations = operations;
    }

    /** 用 NativeQuery 写 bool 查询 + 分页 + 排序 */
    public List<Product> search(String keyword, String category) {
        Query query = Query.of(q -> q
                .bool(b -> b
                        .must(m -> m.match(mm -> mm.field("title").query(keyword)))
                        .filter(f -> f.term(t -> t.field("category").value(category)))
                ));

        // withQuery 接的是 co.elastic.clients 的 Query
        // withPageable / withSort 接管分页排序
        NativeQuery nativeQuery = NativeQuery.builder()
                .withQuery(query)
                .withPageable(PageRequest.of(0, 10))
                .withSort(s -> s.field(f -> f.field("price").order(
                        co.elastic.clients.elasticsearch._types.SortOrder.Asc)))
                .build();

        SearchHits<Product> hits = operations.search(nativeQuery, Product.class);
        return hits.stream().map(h -> h.getContent()).toList();
    }
}
```

::: tip 三种写法怎么选（速查）
- **简单单条件 / 组合条件**：优先 `Repository` 方法名派生（开发最快）。
- **中等复杂、想纯 Java 拼、不要 JSON**：`CriteriaQuery`。
- **从 Kibana 抄来一段 DSL 直接用**：`StringQuery`（仅查询，不含聚合）。
- **要聚合、要最精细控制、要嵌套**：`NativeQuery`（终极大招）。
:::

## 七、复杂查询与聚合在 Spring Data 里怎么写

### 7.1 NativeQuery + 聚合：按分类统计数量 + 各类平均价

这是 `NativeQuery` 的杀手锏。下面统计"每个品牌有多少商品、平均价多少"：

```java
import co.elastic.clients.elasticsearch._types.aggregations.Aggregation;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.elasticsearch.client.elc.NativeQuery;
import org.springframework.data.elasticsearch.client.elc.ElasticsearchAggregations;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.SearchHits;
import com.example.es.domain.Product;

import java.util.LinkedHashMap;
import java.util.Map;

public class ProductAggService {

    private final ElasticsearchOperations operations;

    public ProductAggService(ElasticsearchOperations operations) {
        this.operations = operations;
    }

    /**
     * 按 brand 做 terms 聚合，每个桶里再算 avg(price)。
     * withPageable(PageRequest.of(0,0)) 表示"只要聚合、不要具体文档"。
     */
    public Map<String, Double> avgPriceByBrand() {
        NativeQuery query = NativeQuery.builder()
                .withAggregation("by_brand",
                        Aggregation.of(a -> a
                                .terms(t -> t.field("brand").size(20))
                                .aggregations("avg_price",
                                        sub -> sub.avg(av -> av.field("price")))
                        ))
                .withPageable(PageRequest.of(0, 0))
                .build();

        SearchHits<Product> hits = operations.search(query, Product.class);

        // 聚合结果取出来：强转成 ElasticsearchAggregations
        ElasticsearchAggregations aggs =
                (ElasticsearchAggregations) hits.getAggregations();

        // 逐个桶解析：桶 key = 品牌名，桶里的 avg_price 子聚合 = 平均价
        Map<String, Double> result = new LinkedHashMap<>();
        aggs.get("by_brand")
                .aggregation()
                .getAggregate()
                .sterms()                          // 因为是 terms 聚合，用 sterms()
                .buckets()
                .array()
                .forEach(bucket -> {
                    String brand = bucket.key().stringValue();
                    double avg = bucket.aggregations()
                            .get("avg_price")
                            .avg()
                            .value();
                    result.put(brand, avg);
                });
        return result;
    }
}
```

::: warning 聚合结果解析的几个雷
1. **强转类型**：`hits.getAggregations()` 返回 `AggregationsContainer`，要强转成 `ElasticsearchAggregations`（包路径 `org.springframework.data.elasticsearch.client.elc.ElasticsearchAggregations`）。
2. **sterms / lterms**：`keyword` 字段用 `.sterms()`；如果是 `long`/`integer` 字段的 terms 聚合，用 `.lterms()`。用错方法会 `ClassCastException`。
3. **数值聚合取值**：`avg()` / `sum()` / `value()` 取的是 `double`；`docCount()` 取桶文档数（`long`）。具体方法名以你所用版本官方文档为准。
:::

### 7.2 nested 嵌套字段查询

`reviews` 是 `nested` 类型（评论列表）。要查"作者叫张三且评分 ≥ 4 的评论所属商品"，必须用 `nested` 查询，否则数组会被扁平化导致跨字段误匹配：

```java
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.elasticsearch._types.query_dsl.ChildScoreMode;
import co.elastic.clients.json.JsonData;
import org.springframework.data.elasticsearch.client.elc.NativeQuery;

public List<Product> searchByReview() {
    Query query = Query.of(q -> q
            .nested(n -> n
                    .path("reviews")                       // 嵌套字段路径
                    .scoreMode(ChildScoreMode.Avg)         // 子文档打分策略
                    .query(inner -> inner.bool(b -> b
                            .must(m -> m.term(t -> t.field("reviews.author").value("张三")))
                            .must(m -> m.range(r -> r.field("reviews.rating").gte(JsonData.of(4))))
                    ))
            ));

    NativeQuery nativeQuery = NativeQuery.builder()
            .withQuery(query)
            .withPageable(PageRequest.of(0, 10))
            .build();

    SearchHits<Product> hits = operations.search(nativeQuery, Product.class);
    return hits.stream().map(h -> h.getContent()).toList();
}
```

### 7.3 高亮（NativeQuery 版）

`NativeQuery` 用 `withHighlightQuery(...)` 配置高亮：

```java
import org.springframework.data.elasticsearch.core.query.HighlightQuery;
import org.springframework.data.elasticsearch.core.query.highlight.Highlight;
import org.springframework.data.elasticsearch.core.query.highlight.HighlightField;

public SearchHits<Product> searchWithHighlight(String keyword) {
    NativeQuery query = NativeQuery.builder()
            .withQuery(Query.of(q -> q.match(m -> m.field("title").query(keyword))))
            .withPageable(PageRequest.of(0, 10))
            // 高亮配置：对 title、description 两个字段高亮，标签用 <em>
            .withHighlightQuery(new HighlightQuery(
                    new Highlight(List.of(
                            new HighlightField("title"),
                            new HighlightField("description"))),
                    Product.class))
            .build();

    SearchHits<Product> hits = operations.search(query, Product.class);

    // 从每个 hit 取高亮片段
    for (var hit : hits) {
        Map<String, List<String>> hl = hit.getHighlightFields();
        // hl.get("title") -> ["华为无线<em>耳机</em>"]
    }
    return hits;
}
```

## 八、自动创建索引的坑：mapping 不符合预期怎么办

`@Document(createIndex = true)`（默认值）会在 Spring 容器启动时，**自动检查索引是否存在，不存在就帮你建好，并把实体注解推导出的 mapping 写进去**。这很方便，但有三个坑：

1. **mapping 不完全受你控**：自动推导的 mapping 用的是"通用规则"（比如 `String` 默认映射成 `text` + 一个 `keyword` 子字段，日期按默认格式）。如果你要 IK 中文分词、要 `index: false`、要自定义 `normalizer`，自动推导往往**达不到预期**。
2. **每次启动都试着建**：虽然已存在就不会重复建，但万一你哪天改了实体字段，自动推导的 mapping 和已有索引不一致，会报错或静默忽略。
3. **生产环境风险**：自动建索引意味着"代码一启动就改生产集群结构"，不符合"变更要走评审/脚本"的运维规范。

### 8.1 生产推荐做法：关掉自动建，手动初始化

两步：

**第一步**：`@Document(createIndex = false)`，告诉框架"别自动建"。

```java
@Document(indexName = "products", createIndex = false)
public class Product { ... }
```

**第二步**：在应用启动事件里，用 `IndexOperations` 手动建索引 + 写 mapping（仅当索引不存在时）。

```java
package com.example.es.config;

import com.example.es.domain.Product;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.IndexOperations;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 生产推荐：手动管理索引生命周期。
 * 用 ApplicationRunner（应用启动完成后执行一次）检查并创建索引。
 */
@Configuration
public class IndexInitConfig {

    private static final Logger log = LoggerFactory.getLogger(IndexInitConfig.class);

    @Bean
    public ApplicationRunner productIndexInitializer(ElasticsearchOperations operations) {
        return args -> {
            // indexOps(实体类) 拿到该实体的索引操作对象
            IndexOperations indexOps = operations.indexOps(Product.class);

            if (!indexOps.exists()) {
                // 1) 用 @Document / @Setting 里声明的 settings 创建索引
                indexOps.create();
                // 2) 把实体注解推导出的 mapping 写进去
                indexOps.putMapping();
                log.info("索引 products 不存在，已手动创建并写入 mapping");
            } else {
                log.info("索引 products 已存在，跳过创建");
            }
        };
    }
}
```

::: tip 想要"完全可控"的 mapping？用 JSON 文件
`indexOps.putMapping()` 默认用实体注解推导的 mapping。如果你想要 100% 可控（比如用 IK 分词、自定义 `dynamic` 策略），改用 `indexOps.putMapping(jsonString)`，从一个 classpath 下的 JSON 文件读取标准 ES mapping：

```java
Resource resource = new ClassPathResource("elasticsearch/products-mapping.json");
String mappingJson = StreamUtils.copyToString(
        resource.getInputStream(), StandardCharsets.UTF_8);
indexOps.putMapping(mappingJson);
```

文件 `src/main/resources/elasticsearch/products-mapping.json` 里就是你第 05 章学过的标准 mapping DSL。这样"代码管结构、JSON 管细节"，最稳。
:::

::: warning 别让自动建和手动建打架
如果 `@Document(createIndex = true)`（默认）又写了上面的 `ApplicationRunner`，启动时框架会先自动建一个"推导版"索引，你的 `exists()` 判断就永远为 true，手动 mapping 永远不会生效。**所以生产环境务必 `createIndex = false`**，把索引生命周期完全交给你的初始化代码 / 运维脚本。
:::

## 九、完整实战模块：商品搜索 Service + Controller 全链路

把前面所有技能串起来：一个支持**关键词搜索 + 多条件过滤 + 排序 + 分页 + 高亮**的商品搜索接口，从 Controller 到 ES 全链路打通。

> 设计选择：过滤条件多且动态，用 `NativeQuery` + `ElasticsearchOperations` 最合适（Repository 方法名是静态的，扛不住"可选过滤"）。

### 9.1 请求 DTO

```java
package com.example.es.dto;

/** 商品搜索请求参数（全部可选） */
public class ProductSearchRequest {
    private String keyword;     // 关键词（搜 title/description）
    private String category;    // 分类精确过滤
    private String brand;       // 品牌精确过滤
    private Double minPrice;    // 最低价
    private Double maxPrice;    // 最高价
    private String sortBy;      // 排序字段：price / createdAt
    private String order;       // asc / desc
    private int page = 0;       // 第几页（从 0 起）
    private int size = 10;      // 每页条数

    // getter / setter
    public String getKeyword() { return keyword; }
    public void setKeyword(String keyword) { this.keyword = keyword; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getBrand() { return brand; }
    public void setBrand(String brand) { this.brand = brand; }
    public Double getMinPrice() { return minPrice; }
    public void setMinPrice(Double minPrice) { this.minPrice = minPrice; }
    public Double getMaxPrice() { return maxPrice; }
    public void setMaxPrice(Double maxPrice) { this.maxPrice = maxPrice; }
    public String getSortBy() { return sortBy; }
    public void setSortBy(String sortBy) { this.sortBy = sortBy; }
    public String getOrder() { return order; }
    public void setOrder(String order) { this.order = order; }
    public int getPage() { return page; }
    public void setPage(int page) { this.page = page; }
    public int getSize() { return size; }
    public void setSize(int size) { this.size = size; }
}
```

### 9.2 Service：动态拼 NativeQuery

```java
package com.example.es.service;

import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.query_dsl.BoolQuery;
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.json.JsonData;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.elasticsearch.client.elc.NativeQuery;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.SearchHit;
import org.springframework.data.elasticsearch.core.SearchHits;
import org.springframework.data.elasticsearch.core.query.HighlightQuery;
import org.springframework.data.elasticsearch.core.query.highlight.Highlight;
import org.springframework.data.elasticsearch.core.query.highlight.HighlightField;
import org.springframework.stereotype.Service;
import com.example.es.domain.Product;
import com.example.es.dto.ProductSearchRequest;

import java.util.ArrayList;
import java.util.List;

/**
 * 商品搜索 Service：封装所有 ES 逻辑。
 * 关键点：过滤条件"按需添加"——用户没填的字段就不拼进查询。
 */
@Service
public class ProductSearchService {

    private final ElasticsearchOperations operations;

    public ProductSearchService(ElasticsearchOperations operations) {
        this.operations = operations;
    }

    public SearchHits<Product> search(ProductSearchRequest req) {
        // 1) 用 BoolQuery.Builder 动态拼条件
        BoolQuery.Builder bool = new BoolQuery.Builder();

        // 关键词：放 must（算分）；空则 match_all
        if (req.getKeyword() != null && !req.getKeyword().isBlank()) {
            bool.must(Query.of(q -> q
                    .multiMatch(mm -> mm
                            .query(req.getKeyword())
                            .fields("title^3", "description")   // title 加权
                            .fuzziness("AUTO"))));              // 容错拼写
        } else {
            bool.must(Query.of(q -> q.matchAll(ma -> ma)));
        }

        // 分类：filter（不算分、可缓存）
        if (req.getCategory() != null) {
            bool.filter(Query.of(q -> q.term(t -> t.field("category").value(req.getCategory()))));
        }
        // 品牌：filter
        if (req.getBrand() != null) {
            bool.filter(Query.of(q -> q.term(t -> t.field("brand").value(req.getBrand()))));
        }
        // 价格区间：filter
        if (req.getMinPrice() != null || req.getMaxPrice() != null) {
            bool.filter(Query.of(q -> q.range(r -> {
                if (req.getMinPrice() != null) r.gte(JsonData.of(req.getMinPrice()));
                if (req.getMaxPrice() != null) r.lte(JsonData.of(req.getMaxPrice()));
                return r;
            })));
        }

        // 2) 排序：默认按相关性，否则按指定字段
        NativeQuery.Builder builder = NativeQuery.builder()
                .withQuery(Query.of(q -> q.bool(bool.build())))
                .withPageable(PageRequest.of(req.getPage(), req.getSize()));

        SortOrder order = "desc".equalsIgnoreCase(req.getOrder())
                ? SortOrder.Desc : SortOrder.Asc;
        String sortField = "price".equals(req.getSortBy()) ? "price" : "createdAt";
        builder.withSort(s -> s.field(f -> f.field(sortField).order(order)));

        // 3) 高亮：命中词用 <em> 包起来
        builder.withHighlightQuery(new HighlightQuery(
                new Highlight(List.of(
                        new HighlightField("title"),
                        new HighlightField("description"))),
                Product.class));

        NativeQuery query = builder.build();
        return operations.search(query, Product.class);
    }
}
```

### 9.3 Controller：HTTP 入口

```java
package com.example.es.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.data.elasticsearch.core.SearchHit;
import org.springframework.data.elasticsearch.core.SearchHits;
import com.example.es.domain.Product;
import com.example.es.dto.ProductSearchRequest;
import com.example.es.service.ProductSearchService;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/products")
public class ProductSearchController {

    private final ProductSearchService searchService;

    public ProductSearchController(ProductSearchService searchService) {
        this.searchService = searchService;
    }

    /**
     * 商品搜索：GET /api/products/search?keyword=耳机&category=phone&minPrice=100&maxPrice=5000&sortBy=price&order=asc&page=0&size=10
     *
     * 返回里除了商品本身，还带上高亮片段和命中总数。
     */
    @GetMapping("/search")
    public Map<String, Object> search(@ModelAttribute ProductSearchRequest req) {
        SearchHits<Product> hits = searchService.search(req);

        // 把每个 hit 的"商品 + 高亮"打包
        List<Map<String, Object>> items = hits.stream().map(hit -> {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("product", hit.getContent());
            m.put("highlight", hit.getHighlightFields());  // Map<字段, 高亮片段>
            m.put("score", hit.getScore());
            return m;
        }).collect(Collectors.toList());

        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("total", hits.getTotalHits());
        result.put("items", items);
        return result;
    }
}
```

### 9.4 启动验证（curl 示例）

先确保 `products` 索引已按第八节初始化、并灌几条数据（可用 Repository 的 `save` 或第 06 章的 `bulkSave`）。然后：

```bash
# 1) 关键词 + 分类 + 价格区间 + 分页 + 排序
curl -X GET "http://localhost:8080/api/products/search?keyword=耳机&category=phone&minPrice=100&maxPrice=5000&sortBy=price&order=asc&page=0&size=10"

# 2) 只看分类过滤（关键词留空 → 匹配全部，按默认排序）
curl -X GET "http://localhost:8080/api/products/search?category=phone&size=5"

# 3) 只看高亮效果（响应 items[].highlight.title 里命中词会被 <em> 包起来）
curl -X GET "http://localhost:8080/api/products/search?keyword=无线"
```

返回（节选，重点是 `highlight` 和 `total`）：

```json
{
  "total": 2,
  "items": [
    {
      "product": {
        "id": "1",
        "title": "华为无线耳机",
        "price": 399.0,
        "brand": "华为",
        "category": "phone"
      },
      "highlight": {
        "title": ["华为<em>无线耳机</em>"]
      },
      "score": 4.21
    }
  ]
}
```

逐字段看：`total` 是命中总数；`items[].product` 是原始文档；`items[].highlight.title` 是命中词被 `<em>` 包裹的片段，前端直接渲染即可；`score` 是相关性得分（越大越匹配）。

## 十、选型对比：官方 Java Client vs Spring Data ES

这是你做技术选型时最该看的一张表。

| 维度 | 官方 Java Client（第 06 章） | Spring Data ES（本章） |
| --- | --- | --- |
| 学习成本 | 中：要懂 `Query`/`Aggregation` 函数式写法 | 低：方法名派生 + 注解，上手快 |
| 灵活度 | 极高：每个 API 都暴露 | 中：封装掉样板，但复杂场景能退回 `NativeQuery` |
| 复杂查询能力 | 原生支持，写法直接 | 用 `NativeQuery` 也是原生（底层同一个客户端） |
| Repository 友好度 | 无（要自己写 DAO） | 极高（继承接口即得 CRUD + 派生查询） |
| 聚合/高亮 | 直接写 | 用 `NativeQuery`/ `@Highlight`，略绕但能搞定 |
| 实体映射 | 靠 Jackson + 自己建索引 | `@Document`/`@Field` 注解即映射，自动建索引 |
| 适合场景 | 要精细控制、动态拼装、底层调优 | 标准 CRUD、快速业务开发、团队不熟悉 ES |

**什么情况下两者混用（最佳实践）**：

- **日常 CRUD + 简单搜索**：用 Spring Data ES 的 `Repository`，一行方法名搞定。
- **聚合、复杂 bool、嵌套、需要 `_source` 过滤/routing/scroll**：在同一个项目里注入 `ElasticsearchOperations`（或 `ElasticsearchClient`），用 `NativeQuery` 写。**它们共享同一个底层连接，可以共存，不用二选一**。
- **底层调优（连接池、超时、重试）**：直接配置官方 `ElasticsearchClient`（见第 06 章与第 08 章）。

::: tip 一句话总结选型
"能用 Repository 就用 Repository，写不出的时候用 `NativeQuery`，要对连接做生产级调优时回到官方 `ElasticsearchClient`。" 三者底层是同一个 `co.elastic.clients.elasticsearch.ElasticsearchClient`，只是封装层级不同，可以按需混用。
:::

## 本篇小结

- **Spring Data ES 把 ES 当数据库用**：`ElasticsearchRepository` 继承即得 CRUD，方法名 = 查询意图，省掉大量样板。
- **连接配置用 `spring.elasticsearch.uris`**（复数、带 s），不是旧版的 `cluster-nodes`——这是高频报错源。
- **实体映射全家桶**：`@Document`（indexName / shards / replicas / createIndex）、`@Id`、`@Field`（type / analyzer / index / store / format / pattern）、`@MultiField` + `@InnerField`（一个字段既能搜又能聚合）、`@Setting`（生产级索引设置）。**没有 `@DateField` / `@Point` 注解**，日期用 `FieldType.Date`，坐标用 `FieldType.Geo_Point`。
- **方法名派生关键字表列全了**（And/Or/Between/Like/Containing/OrderBy/In/Top…）；分页排序用 `Pageable`/`Sort`；复杂查询用 `@Query` 贴 JSON。
- **三种查询对象**：`CriteriaQuery`（中等复杂、纯 Java）、`StringQuery`（直接贴 DSL）、`NativeQuery`（最强，聚合/嵌套/高亮/排序全用它能写）。
- **聚合必须走 `NativeQuery`**：`withAggregation` + 强转 `ElasticsearchAggregations` 解析 `sterms().buckets()`。
- **自动建索引的坑**：生产用 `createIndex = false` + 启动事件里 `IndexOperations.create()` / `putMapping()` 手动初始化，mapping 完全可控。
- **全链路实战**：`NativeQuery` 动态拼 bool + 过滤 + 排序 + 高亮，配 Controller 和 curl 示例可直接跑。
- **选型**：Repository 快、NativeQuery 强、官方 Client 最底层，三者底层同一个客户端，按需混用。

## 参考链接

- Spring Data Elasticsearch 官方文档（当前版）：<https://docs.spring.io/spring-data/elasticsearch/reference/>
- 对象映射注解（@Document / @Field / @MultiField 等）：<https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/object-mapping.html>
- Elasticsearch Operations（CriteriaQuery / StringQuery / NativeQuery / 聚合）：<https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/template.html>
- Repository 查询关键字表：<https://docs.spring.io/spring-data/elasticsearch/reference/repositories/query-keywords-reference.html>
- @Query 注解用法：<https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/repositories.html>
- @Setting 注解（索引设置）：<https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/misc.html>
- Spring Boot Elasticsearch 自动配置：<https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.elasticsearch>
- 聚合结果解析（Baeldung）：<https://www.baeldung.com/elasticsearch-aggregation-query>

下一篇 → [08 生产调优与踩坑](/java/middleware/es/production)
