# 08 生产调优与踩坑

> 前七章把"怎么用"讲完了。这一章讲"上了生产怎么办"——写入怎么快、查询怎么稳、mapping 怎么设计不踩雷、分片怎么规划、集群怎么高可用、慢了怎么查、Java 客户端怎么配才像生产、报错怎么快速定位。内容偏运维和调优，但作为写代码的人，**这些决定了你写的 ES 应用能不能扛住真实流量**。

## 本篇要解决的问题

- 几百万商品要灌进 ES，怎么写才快？bulk 多大？副本和 refresh 怎么调？
- 查询越来越慢，是 filter 没缓存？深分页？wildcard 前导通配？还是 `_source` 全量返回？
- mapping 字段越加越多，为什么会拖垮集群？
- 单分片多大合适？分片太多为什么会 OOM？日志类索引怎么用 ILM 自动滚动？
- 集群 yellow/red 了，节点角色、脑裂、磁盘水位线是什么？
- 慢查询怎么抓？`_cat` 命令有哪些最常用？未分配分片怎么查？
- Java 客户端连接池、超时、重试、优雅关闭怎么配？
- 向量检索 kNN 怎么做？和 RAG 怎么结合？
- 常见报错（版本不匹配、Fielddata、Result window、磁盘只读……）怎么排查？

::: tip 本章命令的两种形式
所有 ES 运维命令，我都会同时给**Kibana Dev Tools Console**和 **curl** 两种写法。Console 格式是 `方法 路径` + 空行 + body；curl 就是等价的命令行。生产环境没有 Kibana 时，curl 直接能用。
:::

## 一、写入性能调优

写入是 ES 调优里"性价比最高"的一环。同样一份数据，配置对了能快 5~10 倍。

### 1.1 bulk 批量大小的经验值

一条条 `index` 太慢（每一条一次 HTTP 往返）。用 `bulk` 把多条操作打包成一个请求。

**经验值（生产红线）**：

| 维度 | 建议 | 说明 |
| --- | --- | --- |
| 按文档数 | 单批 **1000 ~ 5000 条** | 不要一次塞几万条 |
| 按体积 | 单批请求体 **5 ~ 15 MB** | 太大协调节点内存压力大、易超时 |
| 并发 | 多个 bulk 并行发 | 注意客户端连接池大小，单连接串行也有不错性能 |

**为什么限制**：`bulk` 是"单个 HTTP 请求"，太大一个请求占满连接、超时后整批重来，反而更慢。正确姿势是**分批读取 → 每批攒够 N 条发一次 → 循环**，而不是攒全量再发。

```bash
# curl 等价：一次 bulk 写入两条（实际生产建议 1000~5000 条/批）
curl -X POST "http://localhost:9200/_bulk?refresh=false" \
  -H "Content-Type: application/x-ndjson" \
  -d '
{ "index": { "_index": "products", "_id": "1" } }
{ "title": "华为无线耳机", "price": 399.0, "brand": "华为" }
{ "index": { "_index": "products", "_id": "2" } }
{ "title": "小米蓝牙音箱", "price": 199.0, "brand": "小米" }
'
```

（Java 侧 `bulk` 写法见第 06 章 4.6 节，`BulkOperation` 列表 + `client.bulk(...)`，必须检查 `response.errors()`。）

### 1.2 refresh_interval 调整

ES 默认每 `1s` 把内存里的写操作 refresh 成"可被搜索的段（segment）"。**频繁 refresh 很耗资源**。批量导入期间，把它调大（甚至 `-1` 关闭自动 refresh），导完再恢复：

```bash
# Kibana Console：导入前把 refresh 关掉
PUT /products/_settings
{ "index.refresh_interval": "-1" }

# 导入完成后恢复成 1s
PUT /products/_settings
{ "index.refresh_interval": "1s" }
```

```bash
# curl 等价
curl -X PUT "http://localhost:9200/products/_settings" -H "Content-Type: application/json" \
  -d '{ "index.refresh_interval": "-1" }'
```

### 1.3 translog 异步刷盘

写操作先进 translog（事务日志）保证不丢，再进内存。默认 `index.translog.durability: request` 表示每条都 fsync，最安全但最慢。批量导入可接受"丢最近 1 秒"时，改成 `async`：

```bash
# Kibana Console：导入期间异步刷盘
PUT /products/_settings
{
  "index.translog.durability": "async",
  "index.translog.sync_interval": "5s"
}
```

::: warning 导入完务必改回 request
`durability: async` 意味着机器宕机可能丢最近几秒数据。**只在批量初始化阶段临时用，导完立刻改回 `request`**，否则线上写入有丢数据风险。
:::

### 1.4 关闭副本再打开

副本（replica）意味着每条文档要写主分片 + 所有副本分片，写入放大。批量建索引时先 `number_of_replicas: 0`，导完再调回：

```bash
# 关副本（导入期）
PUT /products/_settings
{ "index.number_of_replicas": 0 }

# 导完，开 1 个副本
PUT /products/_settings
{ "index.number_of_replicas": 1 }
```

### 1.5 自动生成 ID vs 手动 ID 的性能差异

- **手动指定 `_id`**：ES 写入前要先查"这个 id 是否已存在"来判断是新增还是更新（一次额外的读），且要维护版本。
- **让 ES 自动生成 `_id`**：跳过存在性检查，写入更快。

所以**纯追加型数据（日志、埋点、订单流水）尽量让 ES 自动生成 id**；只有"需要按业务主键更新"的数据（商品、用户）才手动指定 id。这是真实可观测的性能差（自动 id 写入吞吐明显更高）。

## 二、查询性能调优

### 2.1 filter 上下文与缓存

ES 查询分两种上下文：
- **query 上下文**（`must`）：要计算相关性得分 `_score`，不能用缓存。
- **filter 上下文**（`filter` / `must_not`）：只判断"是/否"，**不算分，结果会被节点缓存**，重复查询极快。

```json
{
  "query": {
    "bool": {
      "must":   { "match": { "title": "耳机" } },        // 算分，不能缓存
      "filter": [                                         // 不算分，可缓存
        { "term":  { "category": "phone" } },
        { "range": { "price": { "gte": 100, "lte": 5000 } } }
      ]
    }
  }
}
```

::: tip 调优铁律
所有"硬条件"（分类、状态、价格区间、时间范围、是否上架）一律放 `filter`；只有真正影响排序相关性的关键词放 `must`。这是查询提速最容易被忽略的一点。
:::

### 2.2 避免深分页

`from + size` 默认上限 `10000`（见 2.7 的 `Result window` 报错）。**深分页（from 很大）时，每个分片都要先取出 `from+size` 条再截断，极其浪费**。改用 `search_after`（基于上一页最后一个文档的排序值翻页）：

```bash
# search_after：不带 from，靠上页最后一条的 sort 值翻页
GET /products/_search
{
  "size": 10,
  "sort": [ { "price": "asc" }, { "_id": "asc" } ],
  "search_after": [ 399.0, "1" ]
}
```

### 2.3 避免 wildcard 前导通配

`*耳机`（以 `*` 开头）或 `*无线*` 这种**前导通配**会让 ES 扫描倒排索引里几乎所有 term 来匹配，代价极高，可能直接拖垮集群。

```bash
# ❌ 危险：前导通配，生产禁用
GET /products/_search
{ "query": { "wildcard": { "title": "*耳机" } } }

# ✅ 正确：用 match（分词）或前缀索引（edge_ngram）实现"以...开头"
GET /products/_search
{ "query": { "match": { "title": "耳机" } } }
```

需要"输入即联想"的前缀搜索，请在 mapping 里用 `edge_ngram` 分词器（第 05 章），而不是运行时 wildcard。

### 2.4 routing：把相关数据放同一分片

默认文档按 `_id` 的哈希分散到各分片。如果某类查询总是按"用户 id"或"店铺 id"过滤，可以用 `routing` 把同一个用户的文档固定到同一分片，**查询只需查一个分片**，大幅减少广播。

```bash
# 写入和查询都带 routing，保证落到同一分片
POST /products/_doc/1?routing=user-123
{ "title": "商品A", "userId": "user-123" }

GET /products/_search?routing=user-123
{ "query": { "term": { "userId": "user-123" } } }
```

### 2.5 禁止 `_source` 全量返回

`_source` 是文档原始 JSON。只取几个字段时，用 `_source` 过滤避免把整个大文档传回来：

```bash
GET /products/_search
{
  "_source": ["title", "price"],     // 只返回这两个字段
  "query": { "match": { "title": "耳机" } }
}
```

### 2.6 doc_values 与 fielddata 的区别

| 概念 | 存哪 | 用途 | 默认 |
| --- | --- | --- | --- |
| `doc_values` | **磁盘**（列式存储） | keyword / 数值 / 日期的排序、聚合 | 开启（除 text） |
| `fielddata` | **JVM 堆内存** | 对 `text` 字段排序/聚合 | 关闭 |

`fielddata` 把整个字段加载进堆内存，极易引发 OOM。**永远不要对 `text` 字段开 `fielddata` 做聚合**。正确做法：对需要聚合/排序的 text 字段，用 `@MultiField` 加一个 `keyword` 子字段（见第 07 章 3.4 节），对 `xxx.keyword` 做聚合。这就是"既能搜又能聚合"的底层原因。

## 三、mapping 设计层面的调优

### 3.1 字段数爆炸

ES 单索引字段数建议**控制在 1000 以内**，过多字段（尤其动态 Mapping 随便加）会撑大集群状态（`cluster state`），每次变更要广播到所有节点，拖慢整个集群。

- 关闭不必要的动态 Mapping：`"dynamic": "strict"` 或 `"dynamic": false`（见第 05 章）。
- 重复结构用 `nested` / `object` 聚合，而不是平铺成 `attr1`、`attr2`…`attr100`。

### 3.2 nested 过度使用

`nested` 类型每个子文档在 Lucene 层是独立文档，**嵌套层级深、数组大会显著放大存储和查询成本**。能用 `object`（扁平）就别用 `nested`，只有"需要独立跨字段检索数组元素"时才用 nested（如评论列表，见第 07 章 7.2 节）。

### 3.3 index:false 与 enabled:false

- `index: false`：字段**不被搜索**，但仍存进 `_source`，可被返回。适合只展示不检索的大字段（如商品详情 HTML）。
- `enabled: false`：字段**完全不解析、不索引、不存 `_source`**，只原样透传。适合你完全不需要检索/返回的冗余字段。

```bash
# Kibana Console：大文本只存不搜
PUT /products/_mapping
{
  "properties": {
    "detailHtml": { "type": "text", "index": false }
  }
}
```

## 四、分片与容量规划

### 4.1 单分片大小建议 20~50 GB

经验法则：**单个主分片大小控制在 20~50 GB**。太小（几 MB）则分片数爆炸；太大（超 50 GB）则恢复慢、堆压力大。

### 4.2 分片总数与堆内存的关系

节点 JVM 堆内存要"装得下"所有分片元数据。**经验值：每 1 GB 堆内存最多承载约 20 个分片**（含主+副）。例如 8 GB 堆的节点，分片总数（主+副）建议不超过 `8 × 20 = 160` 个。分片太多会让 `cluster state` 膨胀、GC 压力上升，甚至 OOM。

### 4.3 怎么估算

```
总数据量 = 单文档大小 × 文档数
主分片数 ≈ 总数据量 / 30GB（取中间值）
副本数 = 1（高可用）或 0（单节点/日志）
总分片数 = 主分片数 × (1 + 副本数)
```

例：300 GB 数据、副本 1 → 主分片 10 个、总分片 20 个。

### 4.4 rollover + ILM：日志类索引的生命周期管理

日志、指标这类"只追加、会过期"的数据，不该塞进一个永远增长的大索引，而应该用 **rollover（滚动）+ ILM（生命周期管理）** 按时间切索引并自动删除。

```bash
# 1) 定义 ILM 策略：热阶段超过 50GB 或 30 天就 rollover，冷阶段 90 天后删除
PUT _ilm/policy/logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": { "max_size": "50gb", "max_age": "30d" }
        }
      },
      "delete": {
        "min_age": "90d",
        "actions": { "delete": {} }
      }
    }
  }
}

# 2) 用别名写入，rollover 自动切出新索引
POST logs-write/_rollover
```

::: tip 为什么日志必须 rollover
不滚动的日志索引会无限增长，单个分片超过 50 GB 后恢复极慢；一旦要变更 mapping 或迁移，巨大索引几乎不可操作。ILM 让"切分 + 留存 + 删除"全自动，是日志/指标场景的标准做法。
:::

## 五、集群与高可用

### 5.1 节点角色

ES 节点可承担不同角色（单节点可身兼多职，生产建议分离）：

| 角色 | 职责 | 说明 |
| --- | --- | --- |
| `master` | 管理集群状态、分片分配 | 奇数个（3/5），防脑裂 |
| `data` | 存数据、执行 CRUD/搜索 | 真正干活的节点 |
| `ingest` | 写入前做 pipeline 预处理 | 可选 |
| `coordinating`（协调节点） | 只路由请求、汇总结果 | 不存数据、不选主，纯转发 |

### 5.2 脑裂与 discovery / quorum

**脑裂**：网络分区后，两拨节点各自选出 master，集群分裂成两个，数据冲突。

防脑裂靠**奇数个 master 候选节点 + 法定多数（quorum）**：

```yaml
# elasticsearch.yml（生产多节点）
discovery.seed_hosts: ["es-node-1", "es-node-2", "es-node-3"]
cluster.initial_master_nodes: ["es-node-1", "es-node-2", "es-node-3"]
# 只有获得超过半数 master 选票的节点才能成为 master
```

::: warning 不要用偶数个 master 节点
3 个节点允许挂 1 个仍多数；4 个节点挂 2 个就分裂（和 3 个一样只能容忍 1 个挂），但多花一台机器。**master 候选节点永远用奇数（3 或 5）**。
:::

### 5.3 cluster.routing.allocation 常见设置

控制分片怎么分配，避免都堆到一台机器：

```bash
# 限制单节点分片数，防止某节点过载
PUT _cluster/settings
{
  "transient": {
    "cluster.routing.allocation.total_shards_per_node": 1000
  }
}
```

### 5.4 磁盘水位线

ES 按磁盘用量决定能不能往节点分配分片，三个水位线：

| 水位线 | 默认 | 行为 |
| --- | --- | --- |
| 高水位 `watermark.high` | 90% | 不再往该节点分配新分片 |
| 洪泛水位 `watermark.flood_stage` | 95% | 该节点所有索引强制 `read_only`，拒绝写入 |
| 低水位 `watermark.low` | 85% | 不再往该节点迁移分片 |

```bash
# 调高水位线（磁盘大的机器可放宽）
PUT _cluster/settings
{
  "transient": {
    "cluster.routing.allocation.disk.watermark.low": "85%",
    "cluster.routing.allocation.disk.watermark.high": "90%",
    "cluster.routing.allocation.disk.watermark.flood_stage": "95%"
  }
}
```

## 六、慢日志与诊断

### 6.1 slowlog 配置

记录慢查询和慢索引，定位性能问题：

```bash
# Kibana Console：查询超过 1s 记 warn 慢日志
PUT /products/_settings
{
  "index.search.slowlog.threshold.query.warn": "1s",
  "index.search.slowlog.threshold.fetch.warn": "500ms",
  "index.indexing.slowlog.threshold.index.warn": "2s"
}
```

```bash
# curl 等价
curl -X PUT "http://localhost:9200/products/_settings" -H "Content-Type: application/json" \
  -d '{ "index.search.slowlog.threshold.query.warn": "1s" }'
```

### 6.2 _stats / _cat 系列常用命令速查表

| 命令 | 作用 |
| --- | --- |
| `GET /_cat/health?v` | 集群健康（green/yellow/red） |
| `GET /_cat/nodes?v` | 节点列表与角色 |
| `GET /_cat/indices?v` | 所有索引及文档数、大小、健康 |
| `GET /_cat/shards/products?v` | 某索引分片分布与状态 |
| `GET /_cat/allocation?v` | 各节点磁盘/分片分配 |
| `GET /_cat/thread_pool?v` | 线程池队列/拒绝数（排查拒绝） |
| `GET /_cat/recovery?v` | 分片恢复进度 |
| `GET /products/_stats` | 索引级统计（docs、store、search 耗时） |
| `GET /_nodes/stats` | 节点级 JVM、GC、HTTP 统计 |

```bash
# curl 示例：看集群健康和分片
curl -X GET "http://localhost:9200/_cat/health?v"
curl -X GET "http://localhost:9200/_cat/shards/products?v"
```

### 6.3 _cluster/allocation/explain 排查未分配分片

索引 `red` 或 `yellow` 往往因为分片 `UNASSIGNED`。用 explain 看"为什么分不下去"：

```bash
# Kibana Console
GET /_cluster/allocation/explain

# curl
curl -X GET "http://localhost:9200/_cluster/allocation/explain?pretty"
```

返回里会告诉你原因：磁盘超水位、副本无节点可放、shard 过大、节点角色不匹配等。

## 七、Java 客户端生产配置

### 7.1 连接池

底层 `RestClient` 默认已有连接池，但生产要显式调大上限，否则高并发下连接不够会排队/超时：

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
 * 生产级客户端配置：连接池 + 超时 + 凭据。
 * 用 @Configuration 覆盖 Spring Boot 自动配置（@ConditionalOnMissingBean 保证你的优先）。
 */
@Configuration
public class EsClientConfig {

    @Bean
    public ElasticsearchClient elasticsearchClient() {
        // 1) 凭据（云端 Basic Auth）
        CredentialsProvider credentialsProvider = new BasicCredentialsProvider();
        credentialsProvider.setCredentials(AuthScope.ANY,
                new UsernamePasswordCredentials("elastic", System.getenv("ES_CLOUD_PASSWORD")));

        // 2) 低层 REST 客户端，设连接池和超时
        RestClient restClient = RestClient.builder(
                        new HttpHost("es-cn-xxxx.elasticsearch.aliyuncs.com", 9200, "https"))
                // 连接池上限（并发高时调大，默认每路由 10、总数 30 偏小）
                .setMaxConnTotal(200)
                .setMaxConnPerRoute(50)
                .setHttpClientConfigCallback(httpClientBuilder -> httpClientBuilder
                        // 连接超时：建连最久等多久
                        .setConnectTimeout(java.time.Duration.ofSeconds(5))
                        // 读取超时：一次请求最久等多久（ES 查询可能慢，给足）
                        .setSocketTimeout(java.time.Duration.ofSeconds(30))
                        // 从连接池借连接的超时
                        .setConnectionRequestTimeout(java.time.Duration.ofSeconds(5))
                        .setDefaultCredentialsProvider(credentialsProvider))
                .build();

        ElasticsearchTransport transport =
                new RestClientTransport(restClient, new JacksonJsonpMapper());
        return new ElasticsearchClient(transport);
    }
}
```

**三个超时参数（务必分清）**：

| 参数 | 含义 | 建议 |
| --- | --- | --- |
| 连接超时 connectTimeout | 建立 TCP 连接的最长等待 | 3~5s |
| 读取超时 socketTimeout | 连接建立后，等响应返回的最长等待 | 30s（查询可能慢） |
| 借连接超时 connectionRequestTimeout | 从连接池借一个连接的最长等待 | 5s（池满会等） |

### 7.2 失败重试与幂等

- **传输层异常（连不上/超时，`IOException`）才适合重试**——往往是临时抖动。用 Resilience4j（见第 06 章 7.2 节），只对 `IOException` 重试。
- **业务层异常（`ElasticsearchException`，如字段拼错、版本冲突 409）重试无效**，反而放大压力。
- **写入要幂等**：用固定 `_id`（业务主键）写入，重试也不会产生重复文档；如果用自动生成 id，重试可能产生重复，需要去重或带 `if_seq_no` 乐观锁（第 06 章 4.8 节）。

### 7.3 优雅关闭

应用停机时，`RestClient` 持有连接池和后台 IO 线程，不关会泄漏或阻塞停机。Spring 容器关闭时销毁 Bean 即可：

```java
import org.elasticsearch.client.RestClient;
import jakarta.annotation.PreDestroy;

@Component
public class EsLifecycle {

    private final RestClient restClient;

    public EsLifecycle(RestClient restClient) {
        this.restClient = restClient;
    }

    @PreDestroy
    public void close() {
        // 优雅关闭：释放连接池、中断 IO 线程
        try {
            restClient.close();
        } catch (Exception e) {
            // 记录日志即可，关机阶段不打断
        }
    }
}
```

::: tip Spring Boot 自动配置场景更简单
如果你**没写自定义 `RestClient` Bean**，而是用 `spring.elasticsearch.uris` 自动配置，Spring Boot 会帮你管理 `RestClient` 的生命周期，停机自动关闭，**不用自己写 `@PreDestroy`**。只有自己 new 了 `RestClient` 才需要手动关。
:::

## 八、向量检索 kNN 与 RAG

ES 8.x 原生支持 `dense_vector` 字段和 kNN 检索，可以作为 **RAG（检索增强生成）的向量库**：把知识库切片 embedding 成向量存进 ES，用户提问时把问题也 embedding，用 kNN 找出最相似的几段，塞进大模型提示词。

### 8.1 dense_vector 字段

```bash
# Kibana Console：建一个带向量字段的索引
PUT /knowledge_base
{
  "mappings": {
    "properties": {
      "content":  { "type": "text" },
      "embedding": {
        "type": "dense_vector",
        "dims": 1536,                // 向量维度，要和你的 embedding 模型一致
        "index": true,
        "similarity": "cosine"       // 相似度算法：cosine / l2 / dot_product
      }
    }
  }
}
```

### 8.2 knn 查询

```bash
# Kibana Console：用查询向量做 kNN 近邻检索
GET /knowledge_base/_search
{
  "knn": {
    "field": "embedding",
    "query_vector": [0.12, 0.34, /* ...1536 维 ... */],
    "k": 5,
    "num_candidates": 100
  },
  "_source": ["content"]
}
```

`k` 是最终返回几条，`num_candidates` 是每分片初筛多少候选（越大越准越慢）。

### 8.3 与 RAG 的结合（交叉链接）

ES 在这里扮演"语义记忆库"：

```text
用户提问 ──→ embedding 成向量 ──→ ES kNN 检索最相关片段 ──→ 拼进提示词 ──→ 大模型作答
```

本笔记站 **AI 系列**里有两章专门讲"用 ES 8.x 当向量库做 RAG"的完整实现（切片、embedding、写入、检索、拼提示词的全套代码），比本章更深入：

- [RAG 基础：用 ES 做向量检索](/java/ai/rag) —— 讲 embedding 模型、切片策略、ES 向量写入与 kNN 查询。
- [RAG 进阶：生产级检索与重排](/java/ai/rag-vector) —— 讲混合检索（BM25 + 向量）、重排、缓存、与 Spring AI 的集成。

::: tip 链接路径以你站点实际路由为准
上面两个 RAG 章节的路由（`/java/ai/rag`、`/java/ai/rag-vector`）是按本笔记站 AI 系列命名惯例写的，请按你仓库里 `docs/java/ai/` 下实际文件名调整。向量检索的细节交给那两章，本章只讲"ES 侧怎么存向量、怎么查"。
:::

## 九、常见报错排查清单（≥10 条）

下面每一条都是"现象 → 原因 → 解决"。

### 1. 版本不匹配：`java.lang.NoClassDefFoundError` / 序列化协议对不上
- **现象**：启动报错或查询返回结构怪异；客户端服务端大版本不一致。
- **原因**：`elasticsearch-java` 客户端版本和服务端 8.18.x 对不上。
- **解决**：在 `pom.xml` 用 `<elasticsearch-client.version>8.18.5</elasticsearch-client.version>` 锁成服务端同大版本（注意属性名是 `elasticsearch-client.version`，不是旧教程的 `elasticsearch.version`）。

### 2. NoNodeAvailableException / Connection refused
- **现象**：`java.net.ConnectException: Connection refused` 或 `NoNodeAvailableException`。
- **原因**：连错地址/端口；或配置了已废弃的 `cluster-nodes` 导致连默认 `localhost:9200` 失败。
- **解决**：确认 `spring.elasticsearch.uris: http://localhost:9200`；上云改 `https` + `username`/`password`；检查安全组/白名单。

### 3. Fielddata is disabled on text fields
- **现象**：对 `text` 字段做 `terms` 聚合或排序报 `Fielddata is disabled on [title]`。
- **原因**：`text` 字段默认不能聚合/排序（会爆堆内存）。
- **解决**：对 `title.keyword`（keyword 子字段）做聚合/排序；或用 `@MultiField` 给 text 加 keyword 子字段（第 07 章 3.4 节）。

### 4. Result window is too large
- **现象**：`Result window is too large, from + size must be less than or equal to [10000]`。
- **原因**：`from + size` 超过 `index.max_result_window`（默认 10000）做深分页。
- **解决**：改用 `search_after` 翻页；或必要时调大 `max_result_window`（不推荐，深分页本身慢）。

### 5. mapping 冲突：MapperParsingException
- **现象**：`mapper_parsing_exception` / `failed to parse field`、`Mapping conflict`。
- **原因**：同一字段在不同文档里被映射成不同类型（如先来 `text` 后来 `long`），或动态 Mapping 自动推断出错。
- **解决**：显式定义 mapping（关闭 `dynamic` 或固定类型）；已污染的索引需重建 mapping 并 reindex。

### 6. 集群 status=red
- **现象**：`GET /_cluster/health` 返回 `red`，有主分片丢失。
- **原因**：某主分片所在节点宕机且无副本；或磁盘满导致分片离线。
- **解决**：恢复节点 / 扩容副本；用 `_cluster/allocation/explain` 定位未分配原因；检查磁盘水位线。

### 7. 磁盘只读：index read_only_allow_delete
- **现象**：写入报 `cluster_block_exception: index [x] blocked by: [FORBIDDEN/12/index read-only / allow delete (api)]`。
- **原因**：节点磁盘超过**洪泛水位线（默认 95%）**，ES 自动把索引置为只读保护。
- **解决**：清理磁盘 / 扩容；然后手动解除只读：`PUT /<index>/_settings { "index.blocks.read_only_allow_delete": false }`。

### 8. 数据搜不到（analyzer 改了）
- **现象**：改了分词器（如换 IK）后，旧数据搜不到、新数据能搜到。
- **原因**：analyzer 只在**索引时**生效。改了 analyzer 不会重建已有文档的倒排索引，旧文档仍按旧分词存着。
- **解决**：`_reindex` 重建索引，或删旧数据重新灌；改 analyzer 属于"破坏式变更"，必须重建索引。

### 9. 时区错：日期差 8 小时
- **现象**：存入 `2024-01-01 00:00:00`，查出来是 `2023-12-31T16:00:00Z`。
- **原因**：ES 内部日期统一存 UTC；没指定时区时按 UTC 解析/展示，和本地（东八区）差 8 小时。
- **解决**：写入/查询都显式带时区，或在 mapping 里约定格式；Java 侧用 `OffsetDateTime`/`ZonedDateTime` 明确时区。

### 10. 改了 join/结构导致旧数据搜不到
- **现象**：实体加了 nested 字段或改了结构，旧索引数据查不出新字段。
- **原因**：旧索引 mapping 没有新字段，或字段类型不兼容。
- **解决**：mapping 变更走"新建索引 + reindex"；生产用 `createIndex=false` 手动管索引（第 07 章 8 节），避免自动推导掩盖问题。

### 11. 深分页 + 大 `_source` 导致查询 OOM
- **现象**：一次查询把节点 JVM 堆打满，Full GC 甚至崩溃。
- **原因**：`size` 设得很大 + 返回全量 `_source`（大文档），单请求占用过多堆内存。
- **解决**：`size` 调小 + `_source` 过滤只取必要字段；用 `search_after` 替代深 `from`；聚合用 `composite` 分页。

### 12. bulk 部分失败被忽略
- **现象**：bulk 写入后"少数据"，但没报错。
- **原因**：bulk 是"部分成功"语义，个别 item 失败不影响整体返回 200，不检查 `errors()` 就发现不了。
- **解决**：务必检查 `BulkResponse.errors()`，遍历 `items()` 看 `item.error()` 处理失败项（第 06 章 4.6 节）。

## 十、上线检查清单

上线前逐项打勾：

- [ ] **版本对齐**：`elasticsearch-client.version` 锁成服务端 8.18.x；客户端服务端大版本一致。
- [ ] **连接配置**：`spring.elasticsearch.uris` 正确（不是 `cluster-nodes`）；云端带 `https` + 凭据 + 必要时 `pathPrefix`。
- [ ] **索引管理**：`createIndex=false` + 启动事件手动初始化；mapping 用 JSON 文件完全可控。
- [ ] **mapping 设计**：text 字段配 keyword 子字段用于聚合/排序；大字段 `index:false`；关掉不必要的 `dynamic`。
- [ ] **写入调优**：bulk 1000~5000 条/批；导入期临时关 refresh / 关副本 / translog async，导完恢复。
- [ ] **查询调优**：硬条件全放 `filter`；不用前导通配 `*`；深分页用 `search_after`；`_source` 按需过滤。
- [ ] **分片规划**：单分片 20~50 GB；总分片数 ≤ 堆内存(GB) × 20；日志类用 ILM rollover。
- [ ] **集群高可用**：master 候选奇数个；磁盘水位线合理；`allocation/explain` 能解释未分配分片。
- [ ] **客户端生产配置**：连接池 `setMaxConnTotal/PerRoute`；三个超时参数已设；传输层异常才重试；停机优雅关闭 `RestClient`。
- [ ] **监控**：慢日志已开；`_cat`/`_stats` 能随时排查；有告警（磁盘、堆、线程池拒绝）。
- [ ] **兜底**：批量写入检查 `errors()`；写入幂等（固定 id 或乐观锁）；有 reindex 预案应对 mapping 破坏性变更。

## 本篇小结

- **写入调优**：bulk 1000~5000 条/批；导入期临时关 `refresh_interval`、关副本、translog 改 `async`，导完恢复；纯追加数据让 ES 自动生成 id 更快。
- **查询调优**：硬条件全放 `filter`（可缓存）；深分页用 `search_after`；禁用前导通配 `*`；用 `routing` 共置相关数据；`_source` 按需过滤；`text` 聚合靠 `keyword` 子字段（`fielddata` 禁用、伤堆）。
- **mapping 调优**：字段数 < 1000、关 `dynamic`；`nested` 别滥用；大字段 `index:false` / `enabled:false`。
- **分片规划**：单分片 20~50 GB；总分片 ≤ 堆内存(GB)×20；日志类用 rollover + ILM 自动滚动删除。
- **高可用**：master 候选奇数；`discovery.seed_hosts` + quorum 防脑裂；磁盘水位线（85/90/95%）控制分配。
- **诊断**：slowlog + `_cat`（`health`/`indices`/`shards`/`thread_pool`/`allocation`）+ `_cluster/allocation/explain` 排查未分配分片。
- **Java 客户端生产配置**：连接池 + 三个超时（connect/socket/借连接）+ 只对传输层异常重试 + 优雅关闭 `RestClient`。
- **向量 kNN**：`dense_vector` + `knn` 查询，是 RAG 的向量库；细节见 AI 系列 RAG 两章（交叉链接）。
- **报错清单 ≥12 条**覆盖版本不匹配、连接拒绝、Fielddata、Result window、mapping 冲突、red、磁盘只读、analyzer 变更、时区、结构变更、深分页 OOM、bulk 部分失败。
- **上线检查清单**十项，逐项打勾再发。

## 参考链接

- Elasticsearch 性能调优官方文档：<https://www.elastic.co/docs/deploy-manage/production-guidance/optimize/>
- 写入调优（bulk / refresh / translog）：<https://www.elastic.co/docs/solutions/search/optimize-indexing>
- 查询调优（filter / 分页 / fielddata）：<https://www.elastic.co/docs/reference/query-languages/query-dsl/>
- 分片与容量规划：<https://www.elastic.co/docs/deploy-manage/production-guidance/size-your-cluster/>
- ILM 生命周期管理：<https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management>
- 磁盘水位线与分配：<https://www.elastic.co/docs/deploy-manage/elasticsearch/disk-watermarks>
- 慢日志配置：<https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/indexing-tune-for-speed>
- 集群健康与诊断：<https://www.elastic.co/docs/reference/elasticsearch/commands-reference>
- kNN 向量检索：<https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-knn>
- Java 客户端连接配置：<https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/java-client-config.html>

下一篇 → [回到 01 ES 入门与环境搭建](/java/middleware/es/overview)（Elasticsearch 部分到此结束）
