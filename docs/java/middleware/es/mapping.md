# 03 索引与 Mapping API

> 上一章我们跑通了"存一条、搜一条"的最小闭环，用的是最简单的 `text/keyword` mapping。这一章把 mapping 这件事讲透：**mapping 到底是什么、为什么它比建数据库表还重要、字段类型怎么选、怎么建索引、怎么用索引模板和别名做零停机运维、以及改不了结构时怎么 `_reindex` 重建**。读完这一章，你才算真正"会建索引"，而不是只会 `PUT` 一个空壳。

## 本篇要解决的问题

很多同学对 mapping 的态度是"先随便建，能存进去就行"，结果上线后踩坑：

- 写入后想给字段加个分词器，发现改不了
- 某个字段类型设错了（数字被猜成 text），`range` 查询直接报错
- 日志索引每天一个，mapping 却能自动统一——凭什么？
- 想"无缝升级索引结构"，怎么做到用户零感知？

这一章逐个解决。读完你应该能：

1. 说清 mapping 和 MySQL 表结构的本质区别
2. 根据业务选对字段类型，避开动态映射的坑
3. 用 DSL + curl + Java 客户端建索引、看 mapping、加字段、删索引
4. 用索引模板统一日志类索引的 mapping
5. 用别名 + `_reindex` 实现零停机重建索引

::: danger 全章红线
**mapping 一旦写入数据，绝大多数定义就不可变了。** 这是 ES 和 MySQL 最大的不同：MySQL 改个列类型 `ALTER TABLE` 虽然慢但能改；ES 改字段类型必须重建整个索引。所以**建索引前想清楚 mapping，比写业务代码重要十倍**。
:::

## 一、为什么 mapping 这么重要：一个翻车现场

### 1.1 翻车现场：动态映射把"价格"猜成了 text

假设你图省事，没建 mapping，直接往一个不存在的索引 `shop` 里塞了一条文档：

Kibana Console：

```json
POST /shop/_doc/1
{ "name": "无线鼠标", "price": "29.90", "category": "数码" }
```

注意 `price` 的值是一个**字符串** `"29.90"`（真实业务里这种脏数据太常见了）。ES 的"动态映射（dynamic mapping）"看到这个字段是个字符串，就自作主张把它建成 `text` 类型（并附带一个 `.keyword` 子字段）。

过两天你写了一个范围查询，想找 30 元以下商品：

Kibana Console：

```json
GET /shop/_search
{
  "query": {
    "range": { "price": { "lte": 30 } }
  }
}
```

直接炸了，返回：

```json
{
  "error": {
    "root_cause": [
      {
        "type": "query_shard_exception",
        "reason": "Field [price] of type [text] is not supported for range queries",
        "index": "shop",
        "index_uuid": "abc123"
      }
    ],
    "type": "query_shard_exception",
    "reason": "Field [price] of type [text] is not supported for range queries"
  },
  "status": 400
}
```

| 字段 | 含义 |
| --- | --- |
| `error.type` | `query_shard_exception`，查询在分片上跑挂了 |
| `error.root_cause[].reason` | 关键原因：`price` 是 `text` 类型，不支持 `range` 范围查询 |
| `status` | HTTP 400，请求本身有问题（不是服务端崩了） |

::: warning 为什么 text 不能做 range
`text` 字段会"分词"，把内容切成词项（term）存倒排索引，比如 `29.90` 可能被切成 `29`/`90` 两个词项，根本没有"数值大小"的概念，所以没法比大小。能比大小的是 `integer/long/double` 这类**数值类型**，或者 `keyword`（但 keyword 比的是字典序不是数值序）。这个坑就是动态映射"猜错类型"留给你的债。
:::

**更绝望的是**：索引里已经有数据了，你没法把 `price` 从 `text` 改成 `double`——ES 不允许修改已存在字段的类型。唯一的解法是 `_reindex`（本章第九节详讲）。而 `_reindex` 要重建整个索引、搬数据、切流量，线上做这事风险极高。

所以永远记住：**别让 ES 替你猜字段类型，显式写 mapping。**

### 1.2 mapping 到底是什么（一个比喻）

把 mapping 想成 **MySQL 的"建表语句 + 索引定义"合体**：

- MySQL 里你 `CREATE TABLE` 要写 `price DECIMAL(10,2)`、`name VARCHAR(200)`，这决定了这列怎么存、能不能建索引、能不能 `WHERE price < 30`。
- ES 里 mapping 干同样的事：它定义每个字段**是什么类型**（`text`/`keyword`/`double`/`date`…）、**怎么分词**、**能不能被聚合/排序**。

区别只有一个，但很要命：

| 维度 | MySQL 表结构 | ES mapping |
| --- | --- | --- |
| 写入后改列类型 | `ALTER TABLE ... MODIFY` 能改（慢但能改） | **已写数据的字段类型基本不能改**，只能重建索引 |
| 没建结构直接写 | 报错（表不存在） | **不报错**，ES 用"动态映射"猜一套结构（埋雷） |
| 是否能全文检索 | 需要 `LIKE` 或额外建全文索引 | 字段类型选 `text` 天生支持 |

::: tip 一句话
**mapping = 字段类型定义 + 分词方式定义。** 它决定了"这个字段能不能被搜、怎么被搜、能不能排序聚合"。
:::

### 1.3 写入后哪些能改、哪些不能改

这是"schema 难改"的本质。我们直接列清楚：

| 操作 | 能不能改 | 说明 |
| --- | --- | --- |
| 给索引**新增**一个字段 | ✅ 能 | `PUT /index/_mapping` 加字段 |
| 修改字段的 `ignore_above`、`meta` 等少数参数 | ✅ 能 | 少数只读元数据可改 |
| 修改已有字段的 `type`（如 text→double） | ❌ 不能 | 必须 `_reindex` 重建 |
| 修改已有 `text` 字段的 `analyzer`（分词器） | ❌ 不能 | 分词器变了，旧倒排索引全错，必须重建 |
| 把 `keyword` 改成 `text`（或反过来） | ❌ 不能 | 同上，必须重建 |
| 修改主分片数 `number_of_shards` | ❌ 不能 | 分片数决定数据分布，必须重建索引 |

**根因**：ES 在写入时就为字段建好了"倒排索引 / 正排索引 / doc values"，这些索引的结构由 mapping 决定。一旦建好，物理存储就定型了，改类型等于让旧索引"对不上号"。所以**结构类变更只能重建**，而不是原地改。

## 二、字段类型全表

### 2.1 总览

下面这张表是 ES 最常用的字段类型。后面 2.2 节逐个拆开讲"是什么 / 何时用 / 坑在哪 / 示例"。

| 类型 | 一句话 | 典型用途 | 能不能分词 | 能不能 range | 能不能聚合 |
| --- | --- | --- | --- | --- | --- |
| `text` | 会分词的文本 | 标题、正文、描述 | ✅ 会 | ❌ 不能 | ❌ 默认不能（需 `.keyword`） |
| `keyword` | 不分词的精确值 | 状态、标签、分类、ID | ❌ 不分 | ✅ 能（字典序） | ✅ 能 |
| `long` | 64 位整数 | 浏览量、库存数 | — | ✅ 能 | ✅ 能 |
| `integer` | 32 位整数 | 评分、数量 | — | ✅ 能 | ✅ 能 |
| `short` | 16 位整数 | 小范围计数 | — | ✅ 能 | ✅ 能 |
| `byte` | 8 位整数 | 0~127 枚举 | — | ✅ 能 | ✅ 能 |
| `double` | 双精度浮点 | 价格、坐标 | — | ✅ 能 | ✅ 能 |
| `float` | 单精度浮点 | 价格（省空间） | — | ✅ 能 | ✅ 能 |
| `boolean` | 布尔 | 是否上架、是否有货 | — | ✅ 能 | ✅ 能 |
| `date` | 日期 | 创建时间、下单时间 | — | ✅ 能 | ✅ 能 |
| `object` | 嵌套 JSON 对象 | 地址、扩展属性 | — | 看子字段 | 看子字段 |
| `nested` | 独立索引的对象数组 | 评论列表、规格列表 | — | 看子字段 | 看子字段 |
| `flattened` | 整块压扁的对象 | 不确定的 JSON 元数据 | — | 有限 | 有限 |
| `geo_point` | 经纬度点 | 附近的店、配送范围 | — | ✅ 距离 | ✅ 能 |
| `dense_vector` | 向量数组 | 向量检索 / RAG | — | 用 knn | 用 knn |

::: tip 数值类型的选型建议
整数优先 `integer`/`long`；小数用 `double`（精度高）或 `float`（省空间、允许误差）。**不要图省事全用 `long`**，类型越贴合数据，存储和查询越高效。但也不要用过度小的（`byte`/`short`），除非你确认范围且量级巨大——多数业务 `integer`/`long`/`double` 三选一就够。
:::

### 2.2 逐个详解

#### （1）`text` —— 全文检索的基石

**是什么**：会被分词器切成词项（term），建倒排索引。搜"无线鼠标"能命中"无线静音鼠标"。

**什么时候用**：标题、正文、商品描述、任何"用户会输入一段词来搜"的字段。

**坑在哪**：
- 默认不能做 `term` 精确匹配、不能 `range`、不能直接聚合（聚合要 `fielddata`，很耗内存，官方默认关掉）。
- 想要精确匹配/聚合，必须配 `fields` 多字段（见第四节）。

**示例（DSL）**：

```json
PUT /blog/_mapping
{
  "properties": {
    "content": {
      "type": "text",
      "analyzer": "standard",
      "search_analyzer": "standard"
    }
  }
}
```

`analyzer` 是写入时分词器，`search_analyzer` 是搜索时分词器（默认等于 `analyzer`）。

#### （2）`keyword` —— 精确值的家

**是什么**：不分词，整个值当成一个 term 存。

**什么时候用**：状态码（`"ON_SALE"`）、分类（`"phone"`）、标签、邮箱、URL、商品 ID、任何"要么全等、要么不等"的字段。

**坑在哪**：
- 太长的值（比如整篇文章）设成 keyword 会爆 `bytes` 限制，默认超过 `ignore_above`（256）的部分不索引。
- keyword 比大小是**字典序**（`"10" < "9"` 成立），数值比较要用数值类型。

**示例**：

```json
{ "type": "keyword", "ignore_above": 256, "doc_values": true }
```

#### （3）`long` / `integer` / `short` / `byte`

整数家族。区别只是取值范围和占的空间：

| 类型 | 范围 |
| --- | --- |
| `byte` | -128 ~ 127 |
| `short` | -32768 ~ 32767 |
| `integer` | -21 亿 ~ 21 亿 |
| `long` | 超大，约 ±9×10¹⁸ |

**示例**：

```json
{ "type": "long" }
```

#### （4）`double` / `float`

浮点家族。`double` 精度高（15~16 位有效数字），`float` 精度低但省一半空间。价格建议 `double` 或 `scaled_float`（见下）。

**示例**：

```json
{ "type": "double" }
```

::: tip 金额的最佳实践是 scaled_float
价格这类"小数但要求精确"的字段，推荐 `scaled_float` + `scaling_factor`：把 `19.90` 存成整数 `1990`，查出来再除 100。避免浮点误差，又保留数值类型的 range/聚合能力：

```json
{ "type": "scaled_float", "scaling_factor": 100 }
```
:::

#### （5）`boolean`

`true`/`false`。注意 ES 不接受 `"yes"`/`"1"` 这种字符串当布尔，写入时必须是真布尔值或 `true`/`false` 字面量。

#### （6）`date`

**是什么**：日期类型。ES 内部把日期存成毫秒时间戳（或 `long`）。

**什么时候用**：任何时间字段——创建时间、下单时间、上架时间。

**坑在哪**：必须告诉 ES 你的日期字符串长什么样（format），否则它按默认 `strict_date_optional_time`（`2024-01-31T12:00:00Z`）解析，你传 `2024/01/31` 会报错。支持多种格式用 `||` 连接。

**示例**：

```json
{
  "type": "date",
  "format": "yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis"
}
```

`epoch_millis` 表示也接受"毫秒时间戳"数字。

#### （7）`object` —— 嵌套 JSON 对象

**是什么**：一个字段本身就是个 JSON 对象，比如：

```json
{
  "name": "鼠标",
  "attrs": { "color": "红", "weight": "120g" }
}
```

ES 会把它**压平**成 `attrs.color`、`attrs.weight` 两个独立字段（叫 "dot notation"）。

**坑在哪（重点，后面 nested 会再讲）**：如果 `object` 是个**数组**，对象之间的"字段关联"会丢。比如：

```json
{
  "reviews": [
    { "author": "张三", "rating": 5 },
    { "author": "李四", "rating": 1 }
  ]
}
```

压平后变成 `reviews.author = [张三,李四]`、`reviews.rating = [5,1]`。**你没法搜出"作者是张三且评分是 5"**，因为关联关系没了。这就是 `nested` 存在的理由。

**示例**：

```json
{
  "attrs": {
    "type": "object",
    "properties": {
      "color": { "type": "keyword" },
      "weight": { "type": "keyword" }
    }
  }
}
```

#### （8）`nested` —— 保留关联的对象数组

**是什么**：把数组里每个对象当成**独立的小文档**单独索引，保留了对象内部字段的关联。

**什么时候用**：评论列表、商品的规格组合、订单里的明细行——任何"数组里每个元素是一个完整结构体，且要按元素内部多字段组合查询"的场景。

**示例**：

```json
{
  "reviews": {
    "type": "nested",
    "properties": {
      "author": { "type": "keyword" },
      "rating": { "type": "integer" },
      "content": { "type": "text" }
    }
  }
}
```

查"作者张三且评分 5"要用 `nested` 查询（第四章讲）。

::: danger object vs nested 选错是高频事故
数组场景如果选了 `object`，查询永远拿不到元素内部的关联，排查极其痛苦。**数组里每个元素是结构化对象的，一律用 `nested`**。唯一代价是 nested 查询/聚合稍重，单索引 nested 文档数有限制（默认每个文档 10000 个 nested 对象）。
:::

#### （9）`flattened` —— 不确定结构的 JSON

**是什么**：把整个对象压成一个 keyword 字段，不分字段建索引。

**什么时候用**：你有一坨结构不固定的 JSON 元数据（比如业务方塞的扩展字段），你只想"整块存、整块取"，不需要对里面某个具体字段做精细查询。

**坑在哪**：只能整体匹配，不能对内部具体字段做 range/聚合。

**示例**：

```json
{ "type": "flattened" }
```

#### （10）`geo_point` —— 经纬度

**是什么**：存一个经纬度点 `{ "lat": 31.23, "lon": 121.47 }`。

**什么时候用**："附近的店""配送范围内""按距离排序"。

**示例**：

```json
{ "type": "geo_point" }
```

写入文档：

```json
{ "location": { "lat": 31.23, "lon": 121.47 } }
```

#### （11）`dense_vector` —— 向量

**是什么**：存一个浮点数组（向量），配合 `knn` 做相似度检索。

**什么时候用**：以图搜图、以文搜文、RAG 知识库（本专栏后续向量检索章会深入）。

**示例**（8.x 写法，指定维度）：

```json
{ "type": "dense_vector", "dims": 768, "index": true, "similarity": "cosine" }
```

`index: true` + `similarity` 开启 ANN（近似最近邻）索引，才能用 `knn` 查询。

## 三、text vs keyword：会不会分词的分水岭

这是全站最重要的一个分水岭，必须讲透。

### 3.1 一个字段能不能被"搜"，取决于它会不会分词

| 维度 | `text` | `keyword` |
| --- | --- | --- |
| 写入时 | 经过分词器，切成词项 | 整个值原样当成一个 term |
| 搜索时 `match` 输入 | 也会分词，去倒排索引找 | 不分词，整个值去匹配 |
| 适合 | "包含某些词"的全文检索 | "精确等于某个值"的匹配 |
| `term` 精确查 | ❌ 不推荐（会被分词坑） | ✅ 正确姿势 |
| `range` / 排序 / 聚合 | ❌ 默认不行 | ✅ 行 |

**经典对比**：字段 `city` 值是 `"New York"`。

- 设成 `text`：写入时被标准分词器切成 `new` 和 `york` 两个词项。你搜 `match: "new york"` 能命中，但你用 `term: "New York"` 查却查不到（因为索引里存的是 `new`/`york`，不是 `"New York"` 这个整体）。
- 设成 `keyword`：`"New York"` 整个当一个 term。你用 `term: "New York"` 才能精确命中；用 `match` 搜也会被当成一个整体去比，通常也能命中但因为不分词，搜 `"new"` 就匹配不到。

::: tip 记忆口诀
**要"模糊找词"→ text；要"精确对值"→ keyword。** 一个是"拆开比对词"，一个是"整串对整串"。
:::

### 3.2 `fields` 多字段：一个字段同时支持分词和精确聚合（最常用套路）

现实里一个字段经常**既要全文搜、又要精确聚合/排序**。比如商品 `title`：用户搜"鼠标"要命中（需要 text），后台按 title 分组统计又要精确（需要 keyword）。

ES 的解法叫**多字段（multi-fields）**：给 `text` 字段再加一个 `.keyword` 子字段（或反过来）。主字段 `title` 是 text 用于搜索，子字段 `title.keyword` 是 keyword 用于聚合/精确匹配。

**建 mapping 示例**：

```json
PUT /products
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "standard",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          }
        }
      }
    }
  }
}
```

**两种用法对比**：

```json
GET /products/_search
{
  "query": {
    "match": { "title": "鼠标" }
  },
  "aggs": {
    "by_title": {
      "terms": { "field": "title.keyword", "size": 10 }
    }
  }
}
```

| 用法 | 字段 | 作用 |
| --- | --- | --- |
| 全文检索 | `title` | 分词后匹配"鼠标" |
| 精确聚合 | `title.keyword` | 按完整标题分组，不会把"无线鼠标"和"游戏鼠标"混在一起 |

::: tip 这是 ES 里最高频的设计套路
`text` 主字段 + `keyword` 子字段，几乎每个"既要搜又要聚合"的字符串字段都该这么写。Spring Data 的 `@MultiField`/`@Field` 也有对应注解（本章第十节会看到）。动态映射其实已经帮你对每个字符串字段自动加了 `.keyword` 子字段——但那是默认配置，生产环境你还是该显式定义，避免意外。
:::

## 四、创建索引的完整 DSL

建索引就是在 `PUT /索引名` 时把 `settings`（索引级配置）和 `mappings`（字段定义）一起发过去。

### 4.1 settings 关键参数

| 参数 | 是什么 | 怎么选 |
| --- | --- | --- |
| `number_of_shards` | 主分片数 | 决定数据分布和并行度，**建后不可改**；学习用 1，生产按数据量（几十 GB/分片估） |
| `number_of_replicas` | 副本分片数 | 提供高可用和读扩容；可随时改；单节点学习设 0 |
| `refresh_interval` | 刷新间隔 | 默认 `1s`，决定写入后多久可被搜到；大批量导入时可调大（如 `30s`）或 `-1` 关闭提速 |
| `analysis` | 自定义分析器 | 定义分词器/过滤器，比如中文用 IK、或自定义停用词 |

### 4.2 一个带自定义分析器的完整建索引 DSL

下面用"标准分词器 + 英文停用词"做一个自定义分析器（**不需要装任何插件**，开箱即用）：

Kibana Console：

```json
PUT /products
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "refresh_interval": "1s",
    "analysis": {
      "analyzer": {
        "my_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [ "lowercase", "my_stop" ]
        }
      },
      "filter": {
        "my_stop": {
          "type": "stop",
          "stopwords": "_english_"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "title":       { "type": "text", "analyzer": "my_analyzer",
                       "fields": { "keyword": { "type": "keyword" } } },
      "description": { "type": "text", "analyzer": "my_analyzer" },
      "price":       { "type": "scaled_float", "scaling_factor": 100 },
      "category":    { "type": "keyword" },
      "tags":        { "type": "keyword" },
      "createdAt":   { "type": "date",
                       "format": "yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis" },
      "onSale":      { "type": "boolean" },
      "location":    { "type": "geo_point" },
      "attrs":       { "type": "object",
                       "properties": {
                         "color": { "type": "keyword" },
                         "size":  { "type": "keyword" }
                       } },
      "reviews":     { "type": "nested",
                       "properties": {
                         "author":  { "type": "keyword" },
                         "rating":  { "type": "integer" },
                         "content": { "type": "text" }
                       } }
    }
  }
}
```

curl 等价：

```bash
curl -X PUT "http://localhost:9200/products" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0,
      "refresh_interval": "1s",
      "analysis": {
        "analyzer": {
          "my_analyzer": { "type": "custom", "tokenizer": "standard", "filter": ["lowercase", "my_stop"] }
        },
        "filter": { "my_stop": { "type": "stop", "stopwords": "_english_" } }
      }
    },
    "mappings": {
      "properties": {
        "title": { "type": "text", "analyzer": "my_analyzer", "fields": { "keyword": { "type": "keyword" } } },
        "description": { "type": "text", "analyzer": "my_analyzer" },
        "price": { "type": "scaled_float", "scaling_factor": 100 },
        "category": { "type": "keyword" },
        "tags": { "type": "keyword" },
        "createdAt": { "type": "date", "format": "yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis" },
        "onSale": { "type": "boolean" },
        "location": { "type": "geo_point" },
        "attrs": { "type": "object", "properties": { "color": { "type": "keyword" }, "size": { "type": "keyword" } } },
        "reviews": { "type": "nested", "properties": { "author": { "type": "keyword" }, "rating": { "type": "integer" }, "content": { "type": "text" } } }
      }
    }
  }'
```

返回（重点看 `acknowledged` 和 `shards_acknowledged`）：

```json
{
  "acknowledged": true,
  "shards_acknowledged": true,
  "index": "products"
}
```

| 字段 | 含义 |
| --- | --- |
| `acknowledged` | `true` 表示集群已接受并写入集群状态（索引创建了） |
| `shards_acknowledged` | `true` 表示主分片已成功启动。单节点无副本时通常也是 `true` |
| `index` | 刚建的索引名 |

::: tip 中文分词怎么办
上面的 `my_analyzer` 用的是标准分词器，对中文是**按字切**（" Elasticsearch 入门"→"E/l/a/s/t/i/c…入/门"），中文词粒度太碎。生产需要中文分词器（如 IK、jieba），但它们是**插件**，要在服务端装好才能用，DSL 里写 `"analyzer": "ik_max_word"`。本地学习阶段用 `standard` 即可，别为了中文分词卡在装插件上。具体 API 以你所用版本官方文档为准：<https://www.elastic.co/docs/reference/elasticsearch/analysis/analyzers>
:::

## 五、索引的日常操作

### 5.1 查看映射 `GET /index/_mapping`

Kibana Console：

```json
GET /products/_mapping
```

curl：

```bash
curl -X GET "http://localhost:9200/products/_mapping?pretty"
```

返回（节选，看 `properties` 里每个字段的 `type`）：

```json
{
  "products": {
    "mappings": {
      "properties": {
        "category":   { "type": "keyword" },
        "createdAt":  { "type": "date", "format": "..." },
        "description": { "type": "text", "analyzer": "my_analyzer" },
        "onSale":     { "type": "boolean" },
        "price":      { "type": "scaled_float", "scaling_factor": 100 },
        "tags":       { "type": "keyword" },
        "title": {
          "type": "text",
          "analyzer": "my_analyzer",
          "fields": { "keyword": { "type": "keyword" } }
        }
      }
    }
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `products.mappings.properties` | 该索引所有字段定义 |
| 每个字段的 `type` | 字段类型，排查"为什么查不到"先看这里 |
| `title.fields.keyword` | 多字段子字段，聚合/精确查用它 |
| `analyzer` | 该 text 字段用的分词器 |

### 5.2 新增字段 `PUT /index/_mapping`

mapping **可以追加新字段**（但不能改已有字段）。比如给 `products` 加一个 `brand` 字段：

Kibana Console：

```json
PUT /products/_mapping
{
  "properties": {
    "brand": { "type": "keyword" }
  }
}
```

curl：

```bash
curl -X PUT "http://localhost:9200/products/_mapping" \
  -H "Content-Type: application/json" \
  -d '{ "properties": { "brand": { "type": "keyword" } } }'
```

返回：`{ "acknowledged": true }`。之后新写入的文档 `brand` 字段就会按 keyword 索引；**已存在的旧文档不会回填这个字段**（它本来就没有 brand，查出来是 missing，不影响）。

::: warning 加字段 ≠ 改字段
`PUT /_mapping` 只能"新增"以前没有的字段。如果你写的是已经存在的字段名且类型不同，会报错 `mapper_parsing_exception`。要改已有字段，回头走第九节的 `_reindex`。
:::

### 5.3 删除索引、是否存在、开关索引

**删除索引（危险，不可恢复）**：

```bash
# Kibana
DELETE /products

# curl
curl -X DELETE "http://localhost:9200/products"
```

返回：`{ "acknowledged": true }`。

::: danger 删索引是物理删除
`DELETE /索引` 直接把数据和 mapping 全删了，没有回收站。生产环境务必加权限控制和二次确认。可以设 `cluster.indices.close_on_delete` 等保护，或改用"关闭索引"代替删除。
:::

**索引是否存在**：

```bash
# Kibana（存在返回 200，不存在返回 404）
HEAD /products

# curl：用 -I 看状态码，或 -o /dev/null -w "%{http_code}"
curl -I "http://localhost:9200/products"
```

**开关索引（close/open）**：关闭的索引不占内存、不能读写，但结构还在，比删除温和：

```bash
# 关闭
POST /products/_close
# 打开
POST /products/_open

# curl
curl -X POST "http://localhost:9200/products/_close"
curl -X POST "http://localhost:9200/products/_open"
```

## 六、索引模板（Index Template）与组件模板

### 6.1 为什么日志场景必须用模板

日志类索引通常**按天建一个**：`logs-2024-09-21`、`logs-2024-09-22`……如果每个索引都手动写 mapping，累死且容易不一致。

**索引模板（composable index template）**就是解决这个的：你定义一条规则"凡是名字匹配 `logs-*` 的新索引，自动套用这套 settings + mappings"。新索引一创建，mapping 自动就位，不用你每次手写。

**组件模板（component template）**是模板的"零件"：把通用的 settings、mappings、aliases 拆成可复用的小块，再用 `composed_of` 组合进索引模板。适合多个索引模板共用同一套 mapping 的场景。

### 6.2 组件模板 + 索引模板完整示例

先定义两个组件模板（一个管 settings，一个管 mappings），再定义索引模板把它们组合起来：

Kibana Console：

```json
# ① 组件模板：通用 settings
PUT /_component_template/logs-settings
{
  "template": {
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0,
      "refresh_interval": "5s"
    }
  }
}

# ② 组件模板：通用 mappings
PUT /_component_template/logs-mappings
{
  "template": {
    "mappings": {
      "properties": {
        "level":     { "type": "keyword" },
        "message":   { "type": "text" },
        "service":   { "type": "keyword" },
        "@timestamp": { "type": "date" }
      }
    }
  }
}

# ③ 索引模板：匹配 logs-*，组合上面两个组件
PUT /_index_template/logs-template
{
  "index_patterns": [ "logs-*" ],
  "priority": 10,
  "composed_of": [ "logs-settings", "logs-mappings" ],
  "template": {
    "aliases": {
      "logs-all": {}
    }
  }
}
```

curl（以索引模板这步为例，组件模板同理）：

```bash
curl -X PUT "http://localhost:9200/_index_template/logs-template" \
  -H "Content-Type: application/json" \
  -d '{
    "index_patterns": ["logs-*"],
    "priority": 10,
    "composed_of": ["logs-settings", "logs-mappings"],
    "template": { "aliases": { "logs-all": {} } }
  }'
```

之后你随便建一个 `logs-2024-09-21`，它的 mapping 已经自动包含 `level/message/service/@timestamp`，无需手写：

```bash
# 自动套用模板
PUT /logs-2024-09-21
# 验证 mapping 已存在
GET /logs-2024-09-21/_mapping
```

| 概念 | 作用 |
| --- | --- |
| `index_patterns` | 哪些索引名命中此模板（支持通配符 `*`） |
| `priority` | 多个模板都命中时，priority 大的胜出 |
| `composed_of` | 引用哪些组件模板（按顺序合并） |
| `template.aliases` | 自动给新索引挂的别名 |

::: tip 模板 vs 显式建索引的优先级
如果同时存在"匹配中的模板"和你自己 `PUT` 时写的 mapping，**两者会合并**：模板提供的字段你没写就补上，你显式写的覆盖模板。但已存在的索引不会再套用新模板——模板只对"新建索引"生效。注意：旧版 `PUT /_template`（legacy v1）已废弃，8.x 请用 `PUT /_index_template`（composable）。
:::

### 6.3 用 Java 客户端管理模板（带版本注意）

::: warning 方法名以你所用版本为准
下面是官方 Java API Client（co.elastic.clients）的写法。**不同小版本方法名可能微调**（例如 `putIndexTemplate` 与 legacy `putTemplate` 的差异），如果编译报"找不到方法"，请对照你的 8.18.x 官方 Javadoc 修正：<https://artifacts.elastic.co/javadoc/co/elastic/clients/elasticsearch-java/8.18.0/index.html>
:::

`src/main/java/com/example/es/mapping/TemplateManager.java`：

```java
package com.example.es.mapping;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.indices.PutComponentTemplateResponse;
import co.elastic.clients.elasticsearch.indices.PutIndexTemplateResponse;

import java.io.IOException;

/**
 * 用官方 Java 客户端管理组件模板与索引模板。
 *
 * 关键点：
 * 1. 组件模板用 putComponentTemplate，索引模板用 putIndexTemplate（composable v2）。
 * 2. 索引模板靠 indexPatterns + composedOf 把通用零件拼起来。
 * 3. 生产日志场景：定义一次模板，之后所有 logs-* 索引自动套用。
 */
public class TemplateManager {

    private final ElasticsearchClient client;

    public TemplateManager(ElasticsearchClient client) {
        this.client = client;
    }

    /** 注册组件模板：通用 mapping */
    public void createComponentTemplate() throws IOException {
        PutComponentTemplateResponse resp = client.indices().putComponentTemplate(ct -> ct
                .name("logs-mappings")                       // 组件模板名
                .template(t -> t
                        .mappings(m -> m
                                .properties("level", p -> p.keyword(k -> k))
                                .properties("message", p -> p.text(txt -> txt))
                                .properties("service", p -> p.keyword(k -> k))
                                .properties("@timestamp", p -> p.date(d -> d))
                        )
                )
        );
        System.out.println("组件模板 logs-mappings 创建: " + resp.acknowledged());
    }

    /** 注册索引模板：匹配 logs-*，组合组件模板 */
    public void createIndexTemplate() throws IOException {
        PutIndexTemplateResponse resp = client.indices().putIndexTemplate(it -> it
                .name("logs-template")                       // 索引模板名
                .indexPatterns("logs-*")                     // 命中哪些索引
                .priority(10L)                               // 优先级，越大越优先
                .composedOf("logs-mappings")                 // 引用组件模板
                .template(t -> t
                        .aliases("logs-all", a -> a)         // 自动挂别名
                )
        );
        System.out.println("索引模板 logs-template 创建: " + resp.acknowledged());
    }
}
```

## 七、索引别名 Alias

### 7.1 为什么查询要用别名而不是真索引名

别名（alias）是**指向一个或多个真实索引的"软链接"**。业务代码永远查别名 `products`，不直接查真索引 `products_v1`。

好处：

1. **零停机重建索引**：结构要改时，建新索引 `products_v2`，把别名从 `products_v1` 切到 `products_v2`，业务代码无感知（详见下一节）。
2. **统一视图**：比如 `logs-all` 别名同时指向 30 天的日志索引，查 `logs-all` 就是查全部。
3. **滚动索引**：每天新索引自动加入 `logs-all` 别名。

### 7.2 别名怎么做到零停机重建索引（文本图）

```text
重建前：
  业务代码 ──查──> 别名 products ──指向──> 真索引 products_v1

第 1 步：建新索引 products_v2（新 mapping）
第 2 步：_reindex 把 v1 数据搬进 v2
第 3 步：原子切换别名（先解绑 v1，再绑定 v2）
  业务代码 ──查──> 别名 products ──指向──> 真索引 products_v2
第 4 步：确认无误后删掉 products_v1
```

切换那一瞬间对业务是透明的，因为别名切换是集群状态的一次原子更新，正在进行的查询要么走旧的要么走新的，不会出现"一半查到一半查不到"。

**建别名 / 切换别名 DSL**：

```json
# 初次给 v1 挂别名
PUT /products_v1/_alias/products

# 原子切换：一个请求里同时 remove v1、add v2
POST /_aliases
{
  "actions": [
    { "remove": { "index": "products_v1", "alias": "products" } },
    { "add":    { "index": "products_v2", "alias": "products" } }
  ]
}
```

curl：

```bash
curl -X POST "http://localhost:9200/_aliases" \
  -H "Content-Type: application/json" \
  -d '{
    "actions": [
      { "remove": { "index": "products_v1", "alias": "products" } },
      { "add":    { "index": "products_v2", "alias": "products" } }
    ]
  }'
```

## 八、重建索引 `_reindex`

### 8.1 什么时候必须重建

满足任一就要 `_reindex`：

1. **字段类型错了**（如第一章翻车的 text→double）；
2. **要改分词器**（analyzer 变了，旧倒排索引全失效）；
3. **要改主分片数**（分片数不可变）；
4. 字段要从 `object` 改成 `nested`（保留关联）；
5. 大批量改字段名（用 Painless 脚本在 reindex 时转换）。

`_reindex` 本质：**从源索引读文档，写进目标索引**，期间可以加 query 过滤、加脚本转换。

### 8.2 完整步骤：新建 → reindex → 切换 → 删旧

假设 `products_v1` 的 `price` 是 text（翻车了），要重建为 `products_v2`（price 改 `scaled_float`）。

**① 建新索引（正确 mapping）**：参照第四节的建索引 DSL，把 `price` 改成 `scaled_float`，索引名叫 `products_v2`。

**② reindex 搬数据**：

Kibana Console：

```json
POST /_reindex
{
  "source": { "index": "products_v1" },
  "dest":   { "index": "products_v2" }
}
```

curl：

```bash
curl -X POST "http://localhost:9200/_reindex" \
  -H "Content-Type: application/json" \
  -d '{ "source": { "index": "products_v1" }, "dest": { "index": "products_v2" } }'
```

返回：

```json
{
  "took": 342,
  "timed_out": false,
  "total": 1000,
  "updated": 0,
  "created": 1000,
  "deleted": 0,
  "batches": 1,
  "version_conflicts": 0,
  "noops": 0,
  "retries": { "bulk": 0, "search": 0 },
  "throttled_millis": 0,
  "requests_per_second": -1,
  "throttled_until_millis": 0,
  "failures": []
}
```

| 字段 | 含义 |
| --- | --- |
| `took` | 本次 reindex 耗时（毫秒） |
| `total` | 计划搬的文档数 |
| `created` | 成功写入目标索引的文档数（新文档） |
| `updated` | 覆盖更新的文档数（dest 已存在同 _id 时） |
| `version_conflicts` | 版本冲突数，`0` 表示顺利 |
| `failures` | 失败的文档列表，空数组表示全成功 |

::: tip 大数据量别阻塞等待
默认 `_reindex` 会**一直阻塞到完成**（wait_for_completion=true）。百万级文档会卡很久。生产用 `wait_for_completion=false` 让它在后台跑，返回一个 `task` ID，再用 `_tasks/{task_id}` 查进度（Java 客户端对应 `waitForCompletion(false)` + 轮询 `client.tasks().get(...)`）。
:::

**③ 切换别名**（第七节的动作）：
```json
POST /_aliases
{
  "actions": [
    { "remove": { "index": "products_v1", "alias": "products" } },
    { "add":    { "index": "products_v2", "alias": "products" } }
  ]
}
```

**④ 删旧索引**（确认新索引数据 OK 后）：
```bash
DELETE /products_v1
```

::: danger 切换前务必校验
切换别名前，确认 `products_v2` 的文档数和 `products_v1` 一致（`_count`），且 mapping 正确。别一激动直接删了旧索引才发现新索引少了数据——那就真没了。
:::

### 8.3 带过滤 / 脚本的 reindex（进阶）

只搬"在售"的商品：

```json
POST /_reindex
{
  "source": { "index": "products_v1", "query": { "term": { "onSale": true } } },
  "dest":   { "index": "products_v2" }
}
```

把旧字段 `product_name` 改名成 `title`：

```json
POST /_reindex
{
  "source": { "index": "products_v1" },
  "dest":   { "index": "products_v2" },
  "script": {
    "source": "ctx._source.title = ctx._source.remove('product_name')"
  }
}
```

## 九、Java 实战：用 ElasticsearchClient 操作

下面所有代码用第一章搭好的 `com.example.es` 项目，注入官方 `ElasticsearchClient`。

### 9.1 创建索引 + 写 mapping（完整 import + 注释）

`src/main/java/com/example/es/mapping/IndexCreator.java`：

```java
package com.example.es.mapping;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.indices.CreateIndexResponse;
import co.elastic.clients.elasticsearch._types.mapping.Property;
import co.elastic.clients.elasticsearch._types.mapping.TextProperty;
import co.elastic.clients.elasticsearch._types.mapping.KeywordProperty;
import co.elastic.clients.elasticsearch._types.mapping.DoubleNumberProperty;
import co.elastic.clients.elasticsearch._types.mapping.DateProperty;
import co.elastic.clients.elasticsearch._types.mapping.ObjectProperty;
import co.elastic.clients.elasticsearch._types.mapping.NestedProperty;

import java.io.IOException;

/**
 * 用官方 Java 客户端创建索引并写 mapping。
 *
 * 关键点：
 * 1. client.indices().create(...) 对应 REST 的 PUT /索引名。
 * 2. settings 里 numberOfShards/numberOfReplicas 都是字符串（ES 内部当文本传）。
 * 3. mappings.properties(字段名, p -> p.类型(...)) 是"流式构建器"，
 *    每一个 p.text / p.keyword / p.double_ 对应一种字段类型。
 *    注意 double/float/long 等因为和 Java 关键字冲突，方法名带下划线：double_、float_、long_。
 * 4. fields("keyword", ...) 就是多字段子字段，让 text 主字段同时拥有 keyword 能力。
 */
public class IndexCreator {

    private final ElasticsearchClient client;

    public IndexCreator(ElasticsearchClient client) {
        this.client = client;
    }

    public void createProductsIndex() throws IOException {
        // 调用 PUT /products，同时带 settings + mappings
        CreateIndexResponse resp = client.indices().create(c -> c
                .index("products")
                // ---- settings ----
                .settings(s -> s
                        .numberOfShards("1")
                        .numberOfReplicas("0")
                        .refreshInterval("1s")
                )
                // ---- mappings ----
                .mappings(m -> m
                        // title：text 主字段 + keyword 子字段（最常用套路）
                        .properties("title", p -> p.text(TextProperty.of(t -> t
                                .analyzer("standard")
                                .fields("keyword", f -> f.keyword(KeywordProperty.of(k -> k)))
                        )))
                        // description：纯 text，用于全文检索
                        .properties("description", p -> p.text(TextProperty.of(t -> t.analyzer("standard"))))
                        // price：用 scaled_float 避免浮点误差，scaling_factor=100 表示存整数 1990 代表 19.90
                        .properties("price", p -> p.scaledFloat(sf -> sf.scalingFactor(100.0)))
                        // category / tags：keyword，用于精确匹配和聚合
                        .properties("category", p -> p.keyword(KeywordProperty.of(k -> k)))
                        .properties("tags", p -> p.keyword(KeywordProperty.of(k -> k)))
                        // createdAt：日期，支持多种格式
                        .properties("createdAt", p -> p.date(DateProperty.of(d -> d
                                .format("yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis"))))
                        // onSale：布尔
                        .properties("onSale", p -> p.boolean_(b -> b))
                        // attrs：object 对象（非数组时够用）
                        .properties("attrs", p -> p.object(ObjectProperty.of(o -> o
                                .properties("color", op -> op.keyword(KeywordProperty.of(k -> k)))
                                .properties("size", op -> op.keyword(KeywordProperty.of(k -> k)))
                        )))
                        // reviews：nested 数组，保留"作者+评分"的内部关联
                        .properties("reviews", p -> p.nested(NestedProperty.of(n -> n
                                .properties("author", np -> np.keyword(KeywordProperty.of(k -> k)))
                                .properties("rating", np -> np.integer(i -> i))
                                .properties("content", np -> np.text(TextProperty.of(t -> t)))
                        )))
                )
        );

        // acknowledged=true 表示集群已接受创建
        System.out.println("创建 products 索引，acknowledged=" + resp.acknowledged());
    }
}
```

### 9.2 查 mapping

`src/main/java/com/example/es/mapping/MappingReader.java`：

```java
package com.example.es.mapping;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.indices.GetMappingResponse;
import co.elastic.clients.elasticsearch.indices.IndexMappingRecord;
import co.elastic.clients.elasticsearch._types.mapping.Property;
import co.elastic.clients.elasticsearch._types.mapping.Property.Kind;

import java.io.IOException;
import java.util.Map;

/**
 * 读取并打印索引的 mapping，等价于 REST 的 GET /索引/_mapping。
 *
 * 关键点：
 * 1. getMapping 返回的是"索引名 -> 映射记录"的映射，用 resp.get(索引名) 取。
 * 2. .mappings().properties() 拿到字段定义 Map。
 * 3. prop._kind() 告诉你这个字段是 text / keyword / ... 哪种类型（Kind 枚举）。
 */
public class MappingReader {

    private final ElasticsearchClient client;

    public MappingReader(ElasticsearchClient client) {
        this.client = client;
    }

    public void printMapping(String indexName) throws IOException {
        GetMappingResponse resp = client.indices().getMapping(g -> g.index(indexName));

        // 取该索引的映射记录（多索引查询时这里会有多个 entry）
        IndexMappingRecord record = resp.get(indexName);
        if (record == null) {
            System.out.println("索引 " + indexName + " 不存在或没有 mapping");
            return;
        }

        Map<String, Property> props = record.mappings().properties();
        for (Map.Entry<String, Property> entry : props.entrySet()) {
            String fieldName = entry.getKey();
            Kind kind = entry.getValue()._kind();   // text / keyword / long / date ...
            System.out.println(fieldName + " -> " + kind);
        }
    }
}
```

### 9.3 reindex

`src/main/java/com.example.es/mapping/IndexRebuilder.java`：

```java
package com.example.es.mapping;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.core.ReindexResponse;
import co.elastic.clients.elasticsearch.tasks.GetTaskResponse;

import java.io.IOException;

/**
 * 用 Java 客户端执行 _reindex，等价于 REST 的 POST /_reindex。
 *
 * 关键点：
 * 1. client.reindex(r -> r.source(...).dest(...)) 对应 source/dest 两个索引。
 * 2. 默认 waitForCompletion=true，会阻塞到搬完（返回 created/total 等统计）。
 * 3. 大数据量用 waitForCompletion(false)，返回 task ID，再用 client.tasks().get(...) 轮询进度。
 */
public class IndexRebuilder {

    private final ElasticsearchClient client;

    public IndexRebuilder(ElasticsearchClient client) {
        this.client = client;
    }

    public void rebuild(String sourceIndex, String destIndex) throws IOException {
        ReindexResponse resp = client.reindex(r -> r
                .source(s -> s.index(sourceIndex))
                .dest(d -> d.index(destIndex))
                // 大数据量改为 .waitForCompletion(false) 并轮询任务：
                // .waitForCompletion(false)
        );

        System.out.println("reindex 耗时=" + resp.took() + "ms");
        System.out.println("总计=" + resp.total() + "，新建=" + resp.created());
        System.out.println("版本冲突=" + resp.versionConflicts() + "，失败数=" + resp.failures().size());

        if (!resp.failures().isEmpty()) {
            // 有失败要打出来排查，不能当没事发生
            resp.failures().forEach(f -> System.out.println("失败: " + f));
        }
    }

    /** 大数据量异步模式：提交后立即拿到 task ID */
    public String rebuildAsync(String sourceIndex, String destIndex) throws IOException {
        ReindexResponse resp = client.reindex(r -> r
                .source(s -> s.index(sourceIndex))
                .dest(d -> d.index(destIndex))
                .waitForCompletion(false)          // 后台跑，不阻塞
        );
        String taskId = resp.task();              // 形如 "nodeId:taskNumber"
        System.out.println("reindex 后台任务 ID=" + taskId);
        return taskId;
    }

    /** 根据 task ID 查进度（异步模式用） */
    public void printTaskProgress(String taskId) throws IOException {
        GetTaskResponse task = client.tasks().get(t -> t.taskId(taskId));
        System.out.println("完成=" + task.completed() + "，进度=" + task.progress());
    }
}
```

### 9.4 封装成 RestController + curl 验证

把"建索引"做成 HTTP 接口，方便联调：

`src/main/java/com/example/es/controller/IndexAdminController.java`：

```java
package com.example.es.controller;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.indices.CreateIndexResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

/**
 * 索引管理演示接口：建索引、查 mapping。
 * 这里直接复用本章 9.1/9.2 的逻辑，演示"业务代码怎么调客户端"。
 */
@RestController
@RequestMapping("/api/index")
public class IndexAdminController {

    private final ElasticsearchClient client;

    public IndexAdminController(ElasticsearchClient client) {
        this.client = client;
    }

    /** 建一个 products 索引：POST /api/index/products */
    @PostMapping("/products")
    public String createProducts() throws IOException {
        CreateIndexResponse resp = client.indices().create(c -> c
                .index("products")
                .settings(s -> s.numberOfShards("1").numberOfReplicas("0"))
                .mappings(m -> m
                        .properties("title", p -> p.text(t -> t
                                .fields("keyword", f -> f.keyword(k -> k))))
                        .properties("price", p -> p.scaledFloat(sf -> sf.scalingFactor(100.0)))
                        .properties("category", p -> p.keyword(k -> k))
                )
        );
        return "created products, acknowledged=" + resp.acknowledged();
    }

    /** 检查索引是否存在：GET /api/index/exists?name=products */
    @PostMapping("/exists")
    public String exists(@RequestParam String name) throws IOException {
        // BooleanResponse.value() 才是真正的布尔值
        boolean exists = client.indices().exists(e -> e.index(name)).value();
        return "index " + name + " exists=" + exists;
    }
}
```

启动后验证：

```bash
# 建索引
curl -X POST "http://localhost:8080/api/index/products"

# 查 mapping（用 Kibana 或 curl 看结果）
curl -X GET "http://localhost:9200/products/_mapping?pretty"
```

## 十、完整案例：商品索引设计

把前面所有知识点落到一个真实"商品索引"上，逐字段说明为什么这么设计。

`src/main/java/com/example/es/domain/Product.java`（对应索引 `products`）：

```java
package com.example.es.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;
import org.springframework.data.elasticsearch.annotations.MultiField;
import org.springframework.data.elasticsearch.annotations.InnerField;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 商品文档，对应 ES 索引 products。
 *
 * 用 Spring Data 注解表达和本章 DSL 完全一致的 mapping：
 * - @Field(type=FieldType.Text) + @MultiField 里的 @InnerField(keyword) 就是"text 主字段 + keyword 子字段"
 * - @Field(type=FieldType.Nested) 对应 DSL 的 nested
 * - @Field(type=FieldType.Object) 对应 DSL 的 object
 */
@Document(indexName = "products")
public class Product {

    @Id
    private String id;

    // 标题：要全文搜（text），后台又要按标题聚合（keyword 子字段）
    @MultiField(
        mainField = @Field(type = FieldType.Text, analyzer = "standard"),
        otherFields = {
            @InnerField(suffix = "keyword", type = FieldType.Keyword)
        }
    )
    private String title;

    // 描述：纯 text 全文检索
    @Field(type = FieldType.Text, analyzer = "standard")
    private String description;

    // 价格：scaled_float 避免浮点误差；Spring Data 用 scaledFloatFactors 表达
    @Field(type = FieldType.ScaledFloat, scaledFloatFactors = 100.0)
    private Double price;

    // 分类：keyword，精确匹配 + 聚合
    @Field(type = FieldType.Keyword)
    private String category;

    // 标签：keyword 数组，terms 查询 / 聚合
    @Field(type = FieldType.Keyword)
    private List<String> tags;

    // 上架时间：日期
    @Field(type = FieldType.Date, pattern = "yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis")
    private LocalDateTime createdAt;

    // 是否上架：布尔
    @Field(type = FieldType.Boolean)
    private Boolean onSale;

    // 扩展属性：object（非数组结构）
    @Field(type = FieldType.Object)
    private Map<String, String> attrs;

    // 评论：nested 数组，保留"作者+评分"关联
    @Field(type = FieldType.Nested)
    private List<Review> reviews;

    // 经纬度：geo_point
    @Field(type = FieldType.GeoPoint)
    private GeoLocation location;

    public static class Review {
        @Field(type = FieldType.Keyword)
        private String author;
        @Field(type = FieldType.Integer)
        private Integer rating;
        @Field(type = FieldType.Text)
        private String content;
        // getter/setter 省略
    }

    public static class GeoLocation {
        private Double lat;
        private Double lon;
        // getter/setter 省略
    }

    // 全量 getter/setter 省略（按第一章 Article 的写法补齐即可）
}
```

**字段设计理由表**：

| 字段 | 类型 | 为什么这么设计 |
| --- | --- | --- |
| `id` | `_id` | 文档主键，便于更新/删除 |
| `title` | `text` + `keyword` | 既要搜（text）又要聚合/精确（keyword） |
| `description` | `text` | 长文本全文检索，不需要聚合 |
| `price` | `scaled_float` | 数值才能 range；scaled_float 防浮点误差 |
| `category` | `keyword` | 分类是精确值，用于 `term` 过滤和 `terms` 聚合 |
| `tags` | `keyword[]` | 标签数组，用于 `terms` 查询 |
| `createdAt` | `date` | 时间范围查询、按时间排序 |
| `onSale` | `boolean` | 上下架状态过滤（filter 上下文，不算分） |
| `attrs` | `object` | 不确定 key 的扩展属性，非数组场景 |
| `reviews` | `nested` | 数组且要按"作者+评分"内部组合查，必须 nested |
| `location` | `geo_point` | 附近商品、距离排序 |

::: tip 设计顺序建议
拿到一个索引需求，按这个顺序定字段：① 哪些要全文搜 → `text`；② 哪些要精确匹配/聚合/排序 → `keyword`/`数值`/`date`；③ 有没有"对象数组且要内部关联" → `nested`；④ 要不要省空间/防误差 → `scaled_float`、合适的整数类型。定完再建索引，**别等写入了才发现有问题**。
:::

## 本篇小结

- **mapping 决定字段怎么被索引/搜索/聚合**，写入数据后类型基本不可改，只能 `_reindex` 重建——所以建索引前想清楚比写业务重要。
- **动态映射会猜错类型**（字符串数字→text），导致 `range` 报错。生产务必显式写 mapping。
- **字段类型核心**：`text` 分词用于全文检索；`keyword` 不分词用于精确匹配/聚合；`long/integer/double/...` 数值用于 range；`date` 用于时间；`object` vs `nested` 的分水岭是"数组里要不要保留对象内部关联"。
- **text vs keyword 是最重要分水岭**：要模糊找词用 text，要精确对值用 keyword；用 `fields` 多字段让一个字段两者兼得（最常用套路）。
- **创建索引** = `PUT /索引` 带 `settings`（分片/副本/refresh/analysis）+ `mappings`。
- **日常操作**：`GET /_mapping` 看结构、`PUT /_mapping` 加字段（不能改已有）、`DELETE` 删索引、`_close/_open` 开关。
- **索引模板（composable）+ 组件模板**让日志类 `logs-*` 索引自动套用统一 mapping；**别名 alias** 让业务查软链接、实现零停机重建。
- **_reindex 四步法**：建新索引 → reindex 搬数据 → 原子切换别名 → 删旧索引，是改结构的唯一解法。
- 所有操作都有对应的 Java 官方客户端写法（create / getMapping / reindex / putIndexTemplate / updateAliases）。

## 参考链接

- Elasticsearch 字段类型总览：<https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/field-data-types>
- text vs keyword 与 multi-fields：<https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/multi-fields>
- 创建索引 API：<https://www.elastic.co/docs/api/doc/elasticsearch/v8/operation/operation-create-index>
- 索引模板（composable）：<https://www.elastic.co/docs/reference/elasticsearch/index-templates>
- 别名 API：<https://www.elastic.co/docs/reference/elasticsearch/aliases>
- 重建索引 API：<https://www.elastic.co/docs/api/doc/elasticsearch/v8/operation/operation-reindex>
- 官方 Java API Client Javadoc：<https://artifacts.elastic.co/javadoc/co/elastic/clients/elasticsearch-java/8.18.0/index.html>

下一篇 → [04 DSL 查询 API 全解](/java/middleware/es/dsl)
