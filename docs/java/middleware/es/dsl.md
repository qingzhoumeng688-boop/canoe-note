# 04 DSL 查询 API 全解

> 第三章我们把索引和 mapping 建好了。这一章进入"怎么把数据搜出来"的核心——**Query DSL**。这是全站 API 密度最高的一章：从 `term` 到 `bool`、从 `nested` 到 `function_score`，每个查询我都会给你「是什么 + 何时用 + Kibana DSL + curl + Java 客户端代码 + 返回结果讲解」五件套。学完这一章，ES 里 90% 的搜索需求你都能写出来。

## 本篇要解决的问题

- `term` 和 `match` 到底差在哪，为什么 `term` 要查 keyword 字段
- 为什么有的查询算分、有的不算分（性能优化的命门）
- 短语匹配、范围、模糊、通配符怎么写
- 多条件怎么用 `bool` 组合
- 对象数组怎么搜（`nested` 为什么躲不开）
- 排序、分页（`from/size` 深分页坑、search_after、scroll）、高亮怎么做
- 相关性算分（BM25）和自定义算分（function_score）是什么

::: tip 本章约定
所有示例基于第三章建的 `products` 索引和 `Product` 类。索引名用 `products`，字段有 `title`(text+keyword)、`description`(text)、`price`(scaled_float)、`category`(keyword)、`tags`(keyword[])、`createdAt`(date)、`onSale`(boolean)、`reviews`(nested: author/rating/content)。Java 客户端统一注入 `co.elastic.clients.elasticsearch.ElasticsearchClient`。
:::

## 一、Query DSL 的两种上下文：query vs filter

这是**性能优化最关键的一个认知**，务必先搞懂。

### 1.1 算分 vs 不算分

ES 的查询分两种"上下文"：

| 上下文 | 典型写法 | 算相关性得分 `_score` 吗 | 结果可缓存吗 | 典型场景 |
| --- | --- | --- | --- | --- |
| **query context** | `query` 里的 `match`/`term`/`bool.must` 等 | ✅ 算分，越匹配分越高 | ❌ 一般不缓存 | 全文检索、"越相关越靠前" |
| **filter context** | `bool.filter` / `bool.must_not` / `constant_score` | ❌ 不算分（固定 1 或 0） | ✅ 会缓存 | 状态过滤、时间范围、分类筛选 |

**核心区别**：

- query 上下文要算 `_score`（相关性），"iPhone 和 Apple 哪个更相关"。算分有成本，且结果依赖分数，ES 不会缓存。
- filter 上下文只回答"是/否"，不算分，比如"价格是否 < 100"。因为结果只分"符合/不符合"，ES 会**缓存**这套过滤结果，下次秒回。

### 1.2 怎么选（性能口诀）

```text
这个条件是"用来排序/挑相关的"  → 放 query（算分）
这个条件是"用来卡范围的"（是否上架、价格区间、分类） → 放 filter（不算分、缓存）
```

::: warning 一个常见的性能浪费
很多初学者把所有条件都塞进 `must`（query 上下文），导致本该被缓存的过滤条件也被迫算分、无法缓存，大流量下集群 CPU 飙高。记住：**能过滤的放 filter，要相关性的放 must**。
:::

理解了这个，后面 `bool` 的 `must` / `filter` / `must_not` / `should` 才算分差异就一目了然了。

## 二、查询子句清单（逐个讲）

下面的查询，每个都给 **① 是什么 + 何时用 ② Kibana DSL ③ curl ④ Java ⑤ 返回讲解**。

### 2.1 term / terms：精确匹配

**是什么**：`term` 查"字段值**完全等于**某个 term"。它**不做分词**，直接拿你给的值去倒排索引里找精确的词项。

**什么时候用**：查 `keyword` / 数值 / 日期 / 布尔字段的精确值。比如 `category="phone"`、`onSale=true`、`tags` 含某标签。

::: danger term 必须查不分词的字段
`term` 对 `text` 字段基本是坑：`text` 字段写入时被分词了（"Apple Phone" → `apple`、`phone`），你用 `term: "Apple Phone"` 去精确匹配一个不存在的 term，自然查不到。所以 **term 查 keyword 子字段**（如 `category`，而不是 `title`）。
:::

**① 是什么 + 何时用**：精确值匹配，用于结构化字段（keyword/数值/布尔/日期）。

**② Kibana DSL**：

```json
GET /products/_search
{
  "query": {
    "term": { "category": { "value": "phone" } }
  }
}
```

**③ curl**：

```bash
curl -X GET "http://localhost:9200/products/_search" \
  -H "Content-Type: application/json" \
  -d '{ "query": { "term": { "category": { "value": "phone" } } } }'
```

**④ Java**（官方客户端）：

```java
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.elasticsearch._types.query_dsl.TermQuery;

// term 查 keyword 字段：category 精确等于 "phone"
Query query = Query.of(q -> q.term(t -> t
        .field("category")
        .value("phone")          // keyword 字符串直接给值；数值用 .value(JsonData.of(100))
));
```

`terms` 是 term 的"多个值 OR"版本（in 查询）：

**② DSL**：

```json
GET /products/_search
{
  "query": {
    "terms": { "category": ["phone", "laptop", "tablet"] }
  }
}
```

**④ Java**：

```java
import co.elastic.clients.elasticsearch._types.FieldValue;
import java.util.List;

Query query = Query.of(q -> q.terms(t -> t
        .field("category")
        .terms(tt -> tt.value(List.of(
                FieldValue.of("phone"),
                FieldValue.of("laptop"),
                FieldValue.of("tablet")
        )))
));
```

**⑤ 返回讲解**（term 和大部分查询的返回结构都一样，这里统一讲一次，后面不再重复）：

```json
{
  "took": 3,
  "timed_out": false,
  "hits": {
    "total": { "value": 12, "relation": "eq" },
    "max_score": 1.0,
    "hits": [
      {
        "_index": "products",
        "_id": "1",
        "_score": 1.0,
        "_source": { "title": "iPhone 15", "category": "phone", "price": 5999.0 }
      }
    ]
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `hits.total.value` | 命中总数；`relation` 是 `eq`（精确）或 `gte`（估算，深分页时） |
| `hits.max_score` | 最高分；term/filter 命中固定为 `1.0`（不算分） |
| `hits.hits[]._score` | 这条的得分 |
| `hits.hits[]._source` | 文档原始内容 |

### 2.2 match：分词后匹配

**是什么**：`match` 是**全文检索的默认入口**。它会先对你的搜索词分词，再用分词后的词项去 `text` 字段的倒排索引里找。

**什么时候用**：用户输了"无线鼠标"这种自然语言，要在 `title`/`description` 里找相关商品。

**② DSL**（默认 `operator: or`，任一词项命中即可）：

```json
GET /products/_search
{
  "query": {
    "match": { "title": "无线鼠标" }
  }
}
```

**关键参数**：
- `operator`：`or`（默认，无线 OR 鼠标）/ `and`（无线 AND 鼠标，必须都出现）。
- `minimum_should_match`：至少命中几个词项，如 `"75%"` 表示 4 个词里至少中 3 个。

```json
{
  "query": {
    "match": {
      "title": {
        "query": "无线 游戏 鼠标 机械",
        "operator": "or",
        "minimum_should_match": "75%"
      }
    }
  }
}
```

**③ curl**：

```bash
curl -X GET "http://localhost:9200/products/_search" \
  -H "Content-Type: application/json" \
  -d '{ "query": { "match": { "title": { "query": "无线鼠标", "operator": "and" } } } }'
```

**④ Java**：

```java
import co.elastic.clients.elasticsearch._types.query_dsl.MatchQuery;
import co.elastic.clients.elasticsearch._types.Operator;

Query query = Query.of(q -> q.match(m -> m
        .field("title")
        .query("无线 游戏 鼠标 机械")
        .operator(Operator.Or)              // 或 Operator.And
        .minimumShouldMatch("75%")
));
```

**⑤ 返回**：和 2.1 同一结构，但 `_score` 不再是 1.0——它根据 BM25 算分（见第八节），命中的词项越多、越稀有，分越高。`max_score` 是这批里的最高分。

### 2.3 match_phrase：短语匹配

**是什么**：`match_phrase` 要求词项**按顺序且紧挨着**出现（默认词项之间距离为 0）。适合"我要找完整一句短语"的场景。

**slop 参数**：允许词项之间最多隔 `slop` 个位置。比如 `"red fox"` 配 `slop: 1`，能匹配 `"red quick fox"`（中间隔 1 个词）。

**② DSL**：

```json
GET /products/_search
{
  "query": {
    "match_phrase": {
      "description": { "query": "静音 无线", "slop": 1 }
    }
  }
}
```

**④ Java**：

```java
Query query = Query.of(q -> q.matchPhrase(mp -> mp
        .field("description")
        .query("静音 无线")
        .slop(1)
));
```

### 2.4 match_all：匹配全部

**是什么**：匹配所有文档，不算分（所有 `_score`=1.0）。常用于"只过滤/只排序/只聚合，不关心相关性"的场景。

**② DSL**：

```json
GET /products/_search
{
  "query": { "match_all": {} },
  "sort": [ { "price": { "order": "asc" } } ]
}
```

**④ Java**：

```java
Query query = Query.of(q -> q.matchAll(ma -> ma));
// 配合 .sort(...) 用于"按价格排序展示全部"
```

### 2.5 range：范围查询

**是什么**：按数值 / 日期范围筛选。参数 `gt`(>)、`gte`(>=)、`lt`(<)、`lte`(<=)。

**日期范围**支持"日期运算"：`now-1d` 表示"昨天此时"，`now-1d/d` 末尾的 `/d` 把时间lfloor到天。

**② DSL**：

```json
GET /products/_search
{
  "query": {
    "range": {
      "price": { "gte": 19.9, "lte": 99.0 },
      "createdAt": { "gte": "now-1d", "lte": "now" }
    }
  }
}
```

**③ curl**：

```bash
curl -X GET "http://localhost:9200/products/_search" \
  -H "Content-Type: application/json" \
  -d '{ "query": { "range": { "price": { "gte": 19.9, "lte": 99.0 } } } }'
```

**④ Java**：

```java
import co.elastic.clients.json.JsonData;

// 数值范围
Query query = Query.of(q -> q.range(r -> r
        .field("price")
        .gte(JsonData.of(19.9))
        .lte(JsonData.of(99.0))
));

// 日期范围（字符串写法，ES 内部做日期运算）
Query dateQuery = Query.of(q -> q.range(r -> r
        .field("createdAt")
        .gte("now-1d")
        .lte("now")
));
```

::: tip range 必须查数值/日期字段
和 term 同理，`range` 不能查 `text`。价格用的是 `scaled_float`（数值），所以能比大小。如果你把 price 设成了 text，这里会报"text 不支持 range"——回到第三章的翻车现场。
:::

### 2.6 exists / missing：字段是否存在

**是什么**：`exists` 查"字段有值（非 null、非空数组、非空字符串）"的文档。`missing` 在 ES 2.0 后已被移除，**用 `bool.must_not + exists` 替代**。

**② DSL**：

```json
GET /products/_search
{
  "query": { "exists": { "field": "brand" } }
}

# 等价于旧版 missing：brand 不存在
GET /products/_search
{
  "query": {
    "bool": { "must_not": [ { "exists": { "field": "brand" } } ] }
  }
}
```

**④ Java**：

```java
// exists
Query hasBrand = Query.of(q -> q.exists(e -> e.field("brand")));
// missing = must_not exists
Query noBrand = Query.of(q -> q.bool(b -> b.mustNot(
        mn -> mn.exists(e -> e.field("brand"))
)));
```

### 2.7 prefix / wildcard / regexp / fuzzy

这四个都是"词项级"匹配，常用于自动补全、模糊搜。

| 查询 | 匹配方式 | 示例（查 `title`） | 性能 |
| --- | --- | --- | --- |
| `prefix` | 前缀 | `"无线"` 匹配"无线鼠标" | 中等，走前缀索引 |
| `wildcard` | 通配符 `*`/`?` | `*鼠标*` | ⚠️ 慢，慎用 |
| `regexp` | 正则 | `无线.*鼠标` | ⚠️ 很慢 |
| `fuzzy` | 编辑距离模糊 | `"鼠标"` 也能中"鼠年" | 中等，靠 `fuzziness` |

**② DSL**：

```json
GET /products/_search
{
  "query": { "prefix": { "title": { "value": "无线" } } }
}
GET /products/_search
{
  "query": { "wildcard": { "title": { "value": "*鼠标*" } } }
}
GET /products/_search
{
  "query": { "regexp": { "title": { "value": "无线.*鼠标" } } }
}
GET /products/_search
{
  "query": { "fuzzy": { "title": { "value": "鼠标", "fuzziness": "AUTO" } } }
}
```

**④ Java**：

```java
Query prefixQ  = Query.of(q -> q.prefix(p -> p.field("title").value("无线")));
Query wildcardQ = Query.of(q -> q.wildcard(w -> w.field("title").value("*鼠标*")));
Query regexpQ  = Query.of(q -> q.regexp(rx -> rx.field("title").value("无线.*鼠标")));
Query fuzzyQ   = Query.of(q -> q.fuzzy(f -> f.field("title").value("鼠标").fuzziness("AUTO")));
```

::: danger wildcard / regexp 性能警告
`wildcard` 和 `regexp` 是**逐词项暴力匹配**，尤其是以 `*` 开头（如 `*鼠标*`）会扫描整个倒排索引，大数据量下直接把集群 CPU 打满。**生产禁止在热路径用前缀通配**，自动补全请用 `completion`  suggester 或 `search_as_you_type` 字段类型。
:::

### 2.8 ids：按文档 ID 查

**是什么**：给定一组 `_id`，精确返回这些文档。

**② DSL**：

```json
GET /products/_search
{
  "query": { "ids": { "values": ["1", "2", "3"] } }
}
```

**④ Java**：

```java
Query query = Query.of(q -> q.ids(i -> i.values("1", "2", "3")));
```

### 2.9 multi_match：多字段匹配

**是什么**：`match` 的升级版，把一个搜索词同时打到多个字段上。关键是 `type`：

| type | 含义 | 何时用 |
| --- | --- | --- |
| `best_fields`（默认） | 取"单个字段匹配最好"的分 | 一个字段里集中出现关键词更重要（标题 > 描述） |
| `most_fields` | 多个字段分数相加 | 同一意思拆在多个字段（如 `title` + `title.cn` + `title.en`） |
| `cross_fields` | 把多个字段当成一个大字段 | 词项分散在不同字段也要算整体命中（如 `firstname`+`lastname`） |

还可以用 `^` 给字段加权：`"title^3"` 表示标题权重是其他的 3 倍。

**② DSL**：

```json
GET /products/_search
{
  "query": {
    "multi_match": {
      "query": "无线鼠标",
      "fields": ["title^3", "description", "tags"],
      "type": "best_fields"
    }
  }
}
```

**④ Java**：

```java
import co.elastic.clients.elasticsearch._types.query_dsl.TextQueryType;
import co.elastic.clients.elasticsearch._types.query_dsl.MultiMatchQuery;

Query query = Query.of(q -> q.multiMatch(mm -> mm
        .query("无线鼠标")
        .fields("title^3", "description", "tags")
        .type(TextQueryType.BestFields)      // 或 MostFields / CrossFields
));
```

### 2.10 bool：多条件组合（核心）

**是什么**：把多个子查询用布尔逻辑组合，是写复杂搜索的"主骨架"。四个子句：

| 子句 | 含义 | 算分吗 | 等价 SQL |
| --- | --- | --- | --- |
| `must` | 必须命中，且**参与算分** | ✅ 算 | `AND`（影响相关性） |
| `should` | 应该命中（OR），命中加分 | ✅ 算 | `OR`（加分） |
| `must_not` | 必须不命中 | ❌ 不算（filter 上下文） | `NOT` |
| `filter` | 必须命中，但**不算分、可缓存** | ❌ 不算 | `AND`（硬过滤） |

::: tip must vs filter 的选择（呼应第一节）
"iPhone 这个词相关性高不高" → `must`（算分）。"价格在 100~500、已上架、分类是 phone" → `filter`（硬条件，不算分还能缓存）。**这是写高性能 ES 查询的分水岭。**
:::

**② DSL**（经典组合：关键词相关性 + 硬过滤）：

```json
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "无线鼠标" } }
      ],
      "filter": [
        { "term": { "category": "phone" } },
        { "range": { "price": { "gte": 100, "lte": 500 } } },
        { "term": { "onSale": true } }
      ],
      "should": [
        { "term": { "tags": "新品" } }
      ],
      "must_not": [
        { "term": { "tags": "缺货" } }
      ],
      "minimum_should_match": 0
    }
  }
}
```

**③ curl**：

```bash
curl -X GET "http://localhost:9200/products/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "must": [ { "match": { "title": "无线鼠标" } } ],
        "filter": [
          { "term": { "category": "phone" } },
          { "range": { "price": { "gte": 100, "lte": 500 } } }
        ]
      }
    }
  }'
```

**④ Java**（完整方法，后面每个查询都套这个壳）：

```java
import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.core.SearchResponse;
import co.elastic.clients.elasticsearch.core.search.Hit;
import co.elastic.clients.elasticsearch._types.query_dsl.BoolQuery;
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import java.io.IOException;
import java.util.List;

public class ProductSearchService {

    private final ElasticsearchClient client;

    public ProductSearchService(ElasticsearchClient client) {
        this.client = client;
    }

    /** bool 组合：标题含"无线鼠标" + 分类 phone + 价格 100~500 + 已上架，标签含"新品"加分 */
    public List<Product> searchComplex(String keyword) throws IOException {
        Query query = Query.of(q -> q.bool(b -> b
                .must(m -> m.match(mm -> mm.field("title").query(keyword)))
                .filter(f -> f.term(t -> t.field("category").value("phone")))
                .filter(f -> f.range(r -> r.field("price").gte(JsonData.of(100.0)).lte(JsonData.of(500.0))))
                .filter(f -> f.term(t -> t.field("onSale").value(true)))
                .should(s -> s.term(t -> t.field("tags").value("新品")))
                .mustNot(mn -> mn.term(t -> t.field("tags").value("缺货")))
        ));

        // 第二个泛型 Product 是文档反序列化目标类型
        SearchResponse<Product> resp = client.search(s -> s
                .index("products")
                .query(query)
                .from(0)
                .size(10), Product.class);

        // 遍历命中：每个 Hit 有 id / score / source
        return resp.hits().hits().stream()
                .map(Hit::source)
                .toList();
    }
}
```

> 注意上面 `SearchResponse<Product>` 写在代码围栏里是合法的；**围栏外（含标题）一律用反引号包住泛型**，例如 `SearchResponse<Product>`，否则 VitePress 会把 `<Product>` 当成 HTML 标签导致构建失败。

## 三、嵌套与关联查询

### 3.1 nested 查询：为什么普通 object 数组会丢关联

回顾第三章的坑：`reviews` 是对象数组，如果设成 `object`，ES 会压平成 `reviews.author=[张三,李四]`、`reviews.rating=[5,1]`，**关联没了**——你无法搜"作者是张三且评分=5"。

设成 `nested` 后，每个评论是独立小文档。查内部关联必须用 `nested` 查询，包住一个普通子查询，并指定 `path`：

**② DSL**：

```json
GET /products/_search
{
  "query": {
    "nested": {
      "path": "reviews",
      "score_mode": "avg",
      "query": {
        "bool": {
          "must": [
            { "term": { "reviews.author": "张三" } },
            { "range": { "reviews.rating": { "gte": 4 } } }
          ]
        }
      }
    }
  }
}
```

`score_mode`：多个 nested 命中怎么合成该文档分数（`avg`/`max`/`min`/`sum`/`none`）。

**③ curl**：

```bash
curl -X GET "http://localhost:9200/products/_search" \
  -H "Content-Type: application/json" \
  -d '{ "query": { "nested": { "path": "reviews", "score_mode": "avg", "query": { "bool": { "must": [ { "term": { "reviews.author": "张三" } }, { "range": { "reviews.rating": { "gte": 4 } } } ] } } } } }'
```

**④ Java**：

```java
import co.elastic.clients.elasticsearch._types.query_dsl.ChildScoreMode;
import co.elastic.clients.elasticsearch._types.query_dsl.NestedQuery;

Query query = Query.of(q -> q.nested(n -> n
        .path("reviews")                         // 指向 nested 字段
        .scoreMode(ChildScoreMode.Avg)           // 子文档分数如何合成
        .query(inner -> inner.bool(b -> b
                .must(m -> m.term(t -> t.field("reviews.author").value("张三")))
                .must(m -> m.range(r -> r.field("reviews.rating").gte(JsonData.of(4))))
        ))
));
```

::: danger 漏写 nested 是经典 bug
对 `nested` 字段直接写 `term: { reviews.author: "张三" }`（不带 `nested` 包裹），ES 会把它当成普通字段去查，结果要么报错要么查到错数据。凡是对象数组且定义了 `nested`，查询内部字段必须包 `nested`。
:::

### 3.2 has_child / has_parent 简介

`nested` 解决的是"一个文档内部数组元素的关联"。还有另一种关联：**父子文档（join 类型）**——把"父文档"（如博客）和"子文档"（如评论）存成**不同的文档**，用 `join` 字段建立父子关系。查询用 `has_child`（找"有满足条件的子文档"的父文档）和 `has_parent`（找"父文档满足条件"的子文档）。

它们比 nested 更灵活（子文档可独立增删、数量无上限），但跨分片 join 有性能代价，且要求父子在同一分片（靠 `routing`）。一般优先用 `nested`；只有"子文档需要独立频繁更新、或数量巨大"才上 join + has_child/has_parent。具体用法以你所用版本官方文档为准：<https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/parent-join>

## 四、排序

### 4.1 基础排序、多字段排序、缺值处理

排序用 `sort`，默认按 `_score` 降序（query 上下文）。可以指定字段和顺序。

**② DSL**：

```json
GET /products/_search
{
  "query": { "match": { "title": "鼠标" } },
  "sort": [
    { "price": { "order": "asc" } },
    { "_score": { "order": "desc" } },
    { "createdAt": { "order": "desc", "missing": "_last" } }
  ]
}
```

| 写法 | 含义 |
| --- | --- |
| `"price": {"order":"asc"}` | 按价格升序 |
| `"_score": {"order":"desc"}` | 再按相关性降序（多字段排序时常用） |
| `"missing": "_last"` | 该字段缺失的文档排最后（`_first` 排最前） |

**④ Java**：

```java
import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.SortOptions;
import co.elastic.clients.elasticsearch._types.FieldSort;

SearchResponse<Product> resp = client.search(s -> s
        .index("products")
        .query(q -> q.match(m -> m.field("title").query("鼠标")))
        .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f
                .field("price").order(SortOrder.Asc)))))
        .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f
                .field("_score").order(SortOrder.Desc)))))
        .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f
                .field("createdAt").order(SortOrder.Desc).missing("_last")))))
        ), Product.class);
```

::: warning 排序字段的限制
`text` 字段不能直接排序（会报 fielddata 错）。要按文本排序，用它的 `keyword` 子字段（如 `title.keyword`）。数值/keyword/date 才能直接排序。
:::

## 五、分页

### 5.1 from / size 深分页问题

最朴素的分页：`from` 起始位置、`size` 每页条数。

```json
{ "from": 0, "size": 10 }   // 第 1 页
{ "from": 990, "size": 10 } // 第 100 页
```

**深分页坑**：`from=10000` 时，ES 要从每个分片取 `from+size` 条（比如 10010 条）在协调节点排序，再丢掉前 10000 条——**越翻越深越慢，且默认 `index.max_result_window=10000` 直接拒绝 from+size>10000 的请求**。所以 from/size 只适合浅分页（前几页）。

### 5.2 search_after：深分页的正确姿势

`search_after` 不跳过前 N 条，而是"从上一页最后一条的排序值继续"。它**无深分页开销、能翻很深**，但**不支持随机跳页**（只能上一页/下一页），且排序必须唯一（通常加 `_id` 兜底）。

**② DSL**（假设按 `price asc, _id asc` 排）：

```json
GET /products/_search
{
  "size": 10,
  "sort": [ { "price": "asc" }, { "_id": "asc" } ],
  "search_after": [ 5999.0, "doc_id_上一页最后一条" ]
}
```

**④ Java**：

```java
// 第一页不带 search_after；之后把上一页最后一条的 sort 值传进来
SearchResponse<Product> resp = client.search(s -> s
        .index("products")
        .size(10)
        .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f.field("price").order(SortOrder.Asc)))))
        .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f.field("_id").order(SortOrder.Asc)))))
        // 上一页最后一条的排序值（价格 + id）。search_after 的取值类型以你所用版本官方文档为准
        .searchAfter(List.of(JsonData.of(5999.0), JsonData.of("doc_id_上一页最后一条")))
        , Product.class);
```

::: tip search_after 怎么拿"上一页最后一条的排序值"
`resp.hits().hits().get(size-1).sort()` 就是你下一页要填的 `search_after` 数组，顺序与 `sort` 一致。前端翻页时把这个值带回来即可。
:::

### 5.3 scroll：游标翻全量

`scroll` 适合"导出全部数据 / 离线批处理"，不适合实时用户翻页（它占用资源、有超时）。它一次性生成快照，之后用 `scroll_id` 一页页滚。

**② DSL/curl**：

```bash
# 第一次查询，带 scroll 上下文（保留 1 分钟）
curl -X GET "http://localhost:9200/products/_search?scroll=1m" \
  -H "Content-Type: application/json" \
  -d '{ "size": 100, "sort": ["_doc"] }'

# 后续滚动，带 scroll_id
curl -X POST "http://localhost:9200/_search/scroll" \
  -H "Content-Type: application/json" \
  -d '{ "scroll": "1m", "scroll_id": "上一轮返回的scroll_id" }'
```

**④ Java**（typed client 写法，注意版本差异，建议对照官方文档）：

```java
import co.elastic.clients.elasticsearch.core.ScrollResponse;
import co.elastic.clients.elasticsearch.core.search.HitsMetadata;
import co.elastic.clients.elasticsearch._types.Time;

// 1) 首查带 scroll，返回 SearchResponse（含 scrollId）
SearchResponse<Product> first = client.search(s -> s
        .index("products")
        .size(100)
        .scroll(Time.of(t -> t.time("1m")))     // 滚动上下文保留 1 分钟
        , Product.class);

// 2) 用 scrollId 进入滚动循环；client.scroll 返回 ScrollResponse
ScrollResponse<Product> page = client.scroll(s -> s
        .scrollId(first.scrollId())
        .scroll(Time.of(t -> t.time("1m"))), Product.class);

do {
    for (Hit<Product> hit : page.hits().hits()) {
        // 处理文档
    }
    String scrollId = page.scrollId();         // 记下当前 scroll_id
    // 下一页
    page = client.scroll(s -> s
            .scrollId(scrollId)
            .scroll(Time.of(t -> t.time("1m"))), Product.class);
} while (!page.hits().hits().isEmpty());

// 3) 用完清理 scroll 上下文，释放资源
client.clearScroll(c -> c.scrollId(page.scrollId()));
```

::: warning scroll 的代价
scroll 会**锁定那段数据的快照**，期间 refresh 不影响它，所以占用堆内存和文件句柄。批量导出完一定 `clearScroll` 释放，否则撑爆集群。
:::

### 5.4 三种方案对比

| 方案 | 能否随机跳页 | 深分页性能 | 适用场景 |
| --- | --- | --- | --- |
| `from/size` | ✅ 能 | ❌ 越深越慢，上限 1 万 | 浅分页（前几页、后台列表） |
| `search_after` | ❌ 只能上一页/下一页 | ✅ 无深分页开销 | 无限滚动、深翻页（APP 流） |
| `scroll` | �️ 顺序滚 | ✅ 适合全量 | 数据导出、离线批处理（非实时） |

## 六、高亮 highlight

### 6.1 三种高亮器

`highlight` 把命中的词用标签包起来（如 `<em>鼠标</em>`），前端直接渲染成高亮。三种高亮器：

| 高亮器 | 特点 | 适用 |
| --- | --- | --- |
| `unified`（默认，8.x） | 基于 Lucene 的 Unified Highlighter，最准 | 绝大多数场景 |
| `plain` | 老式，按 term 向量 | 兼容旧配置 |
| `fvh` | Fast Vector Highlighter，需 `term_vector=with_positions_offsets` | 大字段、复杂高亮 |

### 6.2 自定义前置/后置标签

默认标签是 `<em>`。可以自定义，比如前端用 `<mark>` 或自己 CSS class。

**② DSL**：

```json
GET /products/_search
{
  "query": { "match": { "title": "鼠标" } },
  "highlight": {
    "pre_tags": ["<mark>"],
    "post_tags": ["</mark>"],
    "fields": {
      "title": {},
      "description": { "fragment_size": 100, "number_of_fragments": 1 }
    }
  }
}
```

### 6.3 完整示例（Kibana + curl + Java + 返回讲解）

**③ curl**：

```bash
curl -X GET "http://localhost:9200/products/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "match": { "title": "鼠标" } },
    "highlight": {
      "pre_tags": ["<mark>"], "post_tags": ["</mark>"],
      "fields": { "title": {}, "description": { "fragment_size": 100, "number_of_fragments": 1 } }
    }
  }'
```

**④ Java**：

```java
SearchResponse<Product> resp = client.search(s -> s
        .index("products")
        .query(q -> q.match(m -> m.field("title").query("鼠标")))
        .highlight(h -> h
                .preTags("<mark>")
                .postTags("</mark>")
                .fields("title", f -> f)
                .fields("description", f -> f.fragmentSize(100).numOfFragments(1))
        )
        , Product.class);

// 高亮结果不在 _source 里，而在每个 hit 的 highlight 字段
for (Hit<Product> hit : resp.hits().hits()) {
    // highlight 是 Map<字段名, 该字段的高亮片段列表>
    hit.highlight().forEach((field, fragments) -> {
        System.out.println(field + " => " + fragments);
    });
}
```

**⑤ 返回讲解**（重点看 `highlight` 字段）：

```json
{
  "hits": {
    "hits": [
      {
        "_score": 2.1,
        "_source": { "title": "无线游戏鼠标", "description": "..." },
        "highlight": {
          "title": [ "<mark>鼠标</mark> 无线游戏" ]
        }
      }
    ]
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `highlight` | 每个命中字段的高亮片段（数组，可能有多段） |
| `highlight.title[0]` | 命中的"鼠标"被 `<mark>` 包起来的文本，前端直接渲染 |

::: tip 高亮字段最好和查询字段一致
只对 `match`/`term` 命中的 text 字段高亮才有意义。`_source` 里永远是原始文本，**高亮片段在 `highlight` 里**，取的时候别取错地方。
:::

## 七、其他检索控制

### 7.1 _source 过滤

只返回需要的字段，省网络传输（尤其大文档）。

**② DSL**：

```json
GET /products/_search
{
  "query": { "match": { "title": "鼠标" } },
  "_source": { "includes": ["title", "price"], "excludes": ["description"] }
}
```

**④ Java**：

```java
SearchResponse<Product> resp = client.search(s -> s
        .index("products")
        .query(q -> q.match(m -> m.field("title").query("鼠标")))
        .source(src -> src.filter(f -> f
                .includes(List.of("title", "price"))
                .excludes(List.of("description"))
        ))
        , Product.class);
```

### 7.2 字段折叠 collapse

`collapse` 按某个字段"去重"，每个值只返回**一条代表文档**（典型：按 `category` 折叠，每个分类只展示一个商品当封面）。

**② DSL**：

```json
GET /products/_search
{
  "query": { "match": { "title": "鼠标" } },
  "collapse": { "field": "category" }
}
```

**④ Java**：

```java
SearchResponse<Product> resp = client.search(s -> s
        .index("products")
        .query(q -> q.match(m -> m.field("title").query("鼠标")))
        .collapse(c -> c.field("category"))
        , Product.class);
// 注意：collapse 只保证每个 category 一条；要拿"每个分类的文档数"配合 cardinality 聚合
```

### 7.3 explain 查看打分

`explain: true` 在返回里附加 `_score` 的计算明细，debug "为什么这条分这么高"。

**② DSL**：

```json
GET /products/_search
{
  "query": { "match": { "title": "鼠标" } },
  "explain": true
}
```

返回里每个 hit 多一个 `explanation` 字段，层层展开"BM25 怎么算出来的"。Java 用 `.explain(true)` 开启；也可以用独立 `_explain` 接口针对某条文档单独看：

```java
import co.elastic.clients.elasticsearch.core.explain.ExplainResponse;

ExplainResponse<Product> ex = client.explain(e -> e
        .index("products")
        .id("1")
        .query(q -> q.match(m -> m.field("title").query("鼠标")))
        , Product.class);
System.out.println("是否命中=" + ex.matched() + "，分数=" + ex.explanation());
```

### 7.4 _count：只数不想取

只关心"命中多少条"而不取文档，用 `_count`，省带宽。

**② DSL / curl**：

```bash
curl -X GET "http://localhost:9200/products/_count" \
  -H "Content-Type: application/json" \
  -d '{ "query": { "term": { "category": "phone" } } }'
```

**④ Java**：

```java
import co.elastic.clients.elasticsearch.core.CountResponse;

CountResponse countResp = client.count(c -> c
        .index("products")
        .query(q -> q.term(t -> t.field("category").value("phone")))
);
System.out.println("phone 类商品数=" + countResp.count());
```

## 八、相关性算分

### 8.1 TF-IDF vs BM25 通俗讲解

ES 默认用 **BM25** 算 `match` 类查询的相关性 `_score`。先说它要解决的直觉问题："一篇文档里'鼠标'出现 10 次，就一定比出现 2 次更相关吗？"——未必（长文天然出现次数多）。所以算分要平衡两个东西：

| 概念 | 大白话 | 直觉 |
| --- | --- | --- |
| **TF（词频 Term Frequency）** | 这个词在文档里出现了几次 | 出现越多，越相关，但**边际递减**（10 次不比 2 次重要 5 倍） |
| **IDF（逆文档频率 Inverse DF）** | 这个词在整个库里罕见吗 | "鼠标"很罕见 → 命中很说明问题，加分；"的"满库都是 → 几乎不加分 |
| **字段长度归一** | 文档长短 | 短标题里出现"鼠标"比长文里出现更说明问题 |

- **TF-IDF** 是早期公式：score ≈ TF × IDF。问题是 TF 线性增长，长文占便宜。
- **BM25** 是 ES 5.x 起的默认：在 TF 上加了"饱和函数"（出现再多，加分也封顶），并加了字段长度惩罚。所以它更抗"长文刷分"。

::: tip 你基本不用手调 BM25
BM25 的 `k1`（词频饱和度）、`b`（长度惩罚）参数有默认值，绝大多数场景不用动。你要"干预相关性"，用下面的 `function_score` 或 `bool` 的 `boost`，而不是去改 BM25。
:::

### 8.2 _explain 看算分过程

第七节讲过 `"explain": true`。返回里 `explanation` 会显示：`score = boost * (idf * tf_norm)` 每一步的明细数值。当你发现"明明该排前面的没排前面"，先用它看分是哪一步拉低的。

### 8.3 function_score：自定义算分（按销量加权）

**是什么**：在原始 `_score` 基础上，用"函数"再乘/加一个分数，实现"相关性 + 业务权重"的混合排序。比如"标题相关，但销量高的商品应该往前排"。

常用函数：

| 函数 | 作用 |
| --- | --- |
| `weight` | 乘一个固定权重 |
| `field_value_factor` | 用某字段值参与算分（如 `sales` 销量） |
| `decay_function` | 距离/时间衰减（越近分越高） |
| `script_score` | 自定义 Painless 脚本 |

**示例：按销量加权**（销量越高分越高，用对数避免被爆款碾压）：

**② DSL**：

```json
GET /products/_search
{
  "query": {
    "function_score": {
      "query": { "match": { "title": "鼠标" } },
      "functions": [
        {
          "filter": { "term": { "onSale": true } },
          "weight": 1.5
        },
        {
          "field_value_factor": {
            "field": "sales",
            "modifier": "log1p",
            "factor": 0.1,
            "missing": 1
          }
        }
      ],
      "score_mode": "sum",
      "boost_mode": "multiply"
    }
  }
}
```

- `score_mode: sum`：多个函数之间怎么合并（sum/multiply/avg/max/min/first）。
- `boost_mode: multiply`：最终分数 = 原始 `_score` × 函数分数（也可用 sum/replace）。

**④ Java**：

```java
import co.elastic.clients.elasticsearch._types.query_dsl.FunctionScoreQuery;
import co.elastic.clients.elasticsearch._types.query_dsl.FunctionScore;
import co.elastic.clients.elasticsearch._types.query_dsl.FieldValueFactorModifier;
import co.elastic.clients.elasticsearch._types.query_dsl.FunctionScoreMode;
import co.elastic.clients.elasticsearch._types.query_dsl.FunctionBoostMode;

Query query = Query.of(q -> q.functionScore(f -> f
        // 1) 基础相关性查询（标题匹配）
        .query(qq -> qq.match(m -> m.field("title").query("鼠标")))
        // 2) 函数列表：已上架加权 + 销量对数加权
        .functions(fs -> fs
                .add(FunctionScore.of(fn -> fn
                        .filter(fl -> fl.term(t -> t.field("onSale").value(true)))
                        .weight(1.5)
                ))
                .add(FunctionScore.of(fn -> fn
                        .fieldValueFactor(fvf -> fvf
                                .field("sales")
                                .modifier(FieldValueFactorModifier.Log1p)
                                .factor(0.1)
                                .missing(1.0)
                        )
                ))
        )
        .scoreMode(FunctionScoreMode.Sum)        // 函数之间相加
        .boostMode(FunctionBoostMode.Multiply)   // 函数结果 × 原始分
));

SearchResponse<Product> resp = client.search(s -> s
        .index("products")
        .query(query)
        .size(10), Product.class);
```

::: tip function_score 是"精排"利器
它天然适合"搜索结果混排业务权重"：相关性保底（match），销量/评分/新鲜度做微调（function）。但函数越多越慢，**热查询慎用太多函数**，必要时用 `rescore` 只在 top-N 上做二次算分。
:::

## 九、综合实战：一个商品搜索接口

把前面串起来，做一个"关键词 + 过滤 + 排序 + 高亮 + 分页"的完整 Controller。

`src/main/java/com/example/es/controller/ProductSearchController.java`：

```java
package com.example.es.controller;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.SortOrder;
import co.elastic.clients.elasticsearch._types.SortOptions;
import co.elastic.clients.elasticsearch._types.FieldSort;
import co.elastic.clients.elasticsearch._types.query_dsl.Query;
import co.elastic.clients.elasticsearch.core.SearchResponse;
import co.elastic.clients.elasticsearch.core.search.Hit;
import com.example.es.domain.Product;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;

/**
 * 商品搜索接口：关键词（算分）+ 分类/价格/上架（filter）+ 价格升序 + 高亮 + 分页。
 * 覆盖了本章 query/filter 上下文、term/range/match、sort、highlight、from/size。
 */
@RestController
@RequestMapping("/api/products")
public class ProductSearchController {

    private final ElasticsearchClient client;

    public ProductSearchController(ElasticsearchClient client) {
        this.client = client;
    }

    @GetMapping("/search")
    public List<Product> search(
            @RequestParam String keyword,
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "0") int from,
            @RequestParam(defaultValue = "10") int size
    ) throws IOException {

        // 组装查询：关键词放 must（算分），硬条件放 filter（不算分、可缓存）
        // 用语句式 lambda，方便按条件（category 非空）追加 filter
        Query query = Query.of(q -> q.bool(b -> {
            b.must(m -> m.match(mm -> mm.field("title").query(keyword)));
            b.filter(f -> f.range(r -> r.field("price").gte(JsonData.of(0.0))));
            b.filter(f -> f.term(t -> t.field("onSale").value(true)));
            if (category != null) {
                b.filter(f -> f.term(t -> t.field("category").value(category)));
            }
            return b;
        }));

        SearchResponse<Product> resp = client.search(s -> s
                .index("products")
                .query(query)
                .from(from)
                .size(size)
                // 先按价格升序，再按相关性降序
                .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f
                        .field("price").order(SortOrder.Asc)))))
                .sort(SortOptions.of(so -> so.field(FieldSort.of(f -> f
                        .field("_score").order(SortOrder.Desc)))))
                // 高亮标题里命中的词
                .highlight(h -> h.preTags("<mark>").postTags("</mark>")
                        .fields("title", f -> f))
                , Product.class);

        // 真实项目里这里应该把高亮片段也一并返回给前端
        return resp.hits().hits().stream()
                .map(Hit::source)
                .toList();
    }
}
```

上面的 `bool` 用语句式 lambda 构建，只有 `category` 非空时才追加该 filter 条件，干净利落。启动后验证：

```bash
curl -X GET "http://localhost:8080/api/products/search?keyword=鼠标&category=phone&from=0&size=10"
```

## 本篇小结

- **两种上下文**：query 算分（相关性）、filter 不算分且可缓存。能过滤的条件放 `filter`，要相关性的放 `must`——这是性能命门。
- **term / terms** 查精确值，必须打 keyword/数值字段；**match** 分词后匹配，打 text 字段；`operator`/`minimum_should_match` 控制命中宽松度。
- **match_phrase** 短语紧邻匹配（slop 容错）；**range** 数值/日期范围（`now-1d` 做日期运算）；**exists** 查非空（旧 `missing` 用 `must_not exists` 替代）。
- **prefix/wildcard/regexp/fuzzy** 是词项级模糊；`wildcard`/`regexp` 很慢，热路径禁用。
- **multi_match** 多字段匹配，`best_fields`/`most_fields`/`cross_fields` 决定如何合并分数；`ids` 按 `_id` 取。
- **bool** 是组合主骨架：`must`(算分)、`should`(加分)、`filter`(不算分缓存)、`must_not`(不算分)；`nested` 包裹查对象数组内部关联。
- **排序**用 `sort`（text 要排 `.keyword`）；**分页**三方案：from/size 浅分页、search_after 深翻页、scroll 全量导出，各有适用场景。
- **highlight** 高亮命中词（结果在 `highlight` 字段）；`_source` 过滤省流量；`collapse` 按字段折叠；`explain`/`_explain` 看算分；`_count` 只计数。
- **算分**默认 BM25（TF 饱和 + IDF + 长度惩罚）；`function_score` 用 `field_value_factor` 等函数做"相关性+业务权重"混合排序。
- 每个查询都给了 Kibana DSL + curl + Java 客户端三种写法，套进 `client.search(s -> s.index("products").query(...), Product.class)` 即可跑。

## 参考链接

- Query DSL 总览：<https://www.elastic.co/docs/reference/query-languages/query-dsl>
- bool 查询：<https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-bool-query>
- term / terms：<https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-term-query>
- range：<https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-range-query>
- nested：<https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-nested-query>
- 分页（search_after / scroll）：<https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-search-after>、<https://www.elastic.co/docs/reference/elasticsearch/search/scroll>
- 高亮：<https://www.elastic.co/docs/reference/query-languages/highlighting>
- function_score：<https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-function-score-query>
- 相关性（BM25）：<https://www.elastic.co/docs/reference/elasticsearch/misc/index/recipes/bm25>
- 官方 Java API Client Javadoc：<https://artifacts.elastic.co/javadoc/co/elastic/clients/elasticsearch-java/8.18.0/index.html>

下一篇 → [05 聚合分析 Aggregation](/java/middleware/es/aggregation)
