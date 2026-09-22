# 02 核心概念与倒排索引

> 上一篇我们把环境跑通了。这一篇是**整个 ES 教程的地基**——倒排索引、分片副本、分词、近实时机制。这些概念不啃透，后面写查询、调性能、排查"为什么搜不到"都会像蒙眼开车。这一章节奏会慢，但值得。

## 本篇要解决的问题

- 倒排索引到底是个啥？为什么它能让搜索比 MySQL `LIKE` 快几个数量级
- ES 的 Index / Type / Document / Field 到底对应 MySQL 的什么
- 一个索引内部是怎么拆成 Shard、Segment 的
- 分片数为什么"创建后不能改"，副本又有什么用
- 为什么我刚写入的数据，要等 1 秒才能搜到
- 分词到底是什么，为什么中文必须用 IK、不能偷懒用 standard
- `_source`、`_id` 这些元数据字段都是干嘛的
- 集群状态 green / yellow / red 分别代表什么

## 一、倒排索引（Inverted Index）讲透

这是 ES 之所以快的根本原因。必须彻底搞懂。

### 1.1 先分清"正排"和"倒排"

假设图书馆有 3 本书，每本都有编号和内容。

**正排索引（Forward Index）= 文档 → 词**

就是"这本书里有哪些词"，和我们日常的思路一致：

| 文档 | 包含的词 |
| --- | --- |
| 文档 1 | Elasticsearch、一个、搜索引擎 |
| 文档 2 | 搜索引擎、用于、全文检索 |
| 文档 3 | Elasticsearch、使用、倒排索引 |

**倒排索引（Inverted Index）= 词 → 文档**

把上面那张表"反过来"，变成"每个词出现在哪几篇文档里"：

| 词项（Term） | 出现在哪些文档 | 出现次数 |
| --- | --- | --- |
| elasticsearch | 文档 1、文档 3 | 各 1 次 |
| 搜索引擎 | 文档 1、文档 2 | 各 1 次 |
| 全文检索 | 文档 2 | 1 次 |
| 倒排索引 | 文档 3 | 1 次 |
| 使用 | 文档 3 | 1 次 |
| 一个 | 文档 1 | 1 次 |
| 用于 | 文档 2 | 1 次 |

::: tip 正排 vs 倒排一句话
- **正排**：我知道文档 1 的内容 → 顺着文档找词。适合"给我这篇文档，我要看全文"。
- **倒排**：我知道"搜索引擎"这个词 → 顺着词找文档。适合"搜这个词，把相关文档都给我"。
- **ES 检索靠的是倒排索引**，因为搜索的本质就是"拿词找文档"。
:::

### 1.2 三篇文档，一步步建出倒排表

我们用三句真实的中文文档演示（为了聚焦原理，这里先按"词"切分；ES 实际怎么切词，见本章第六节的"分词"）。

**原始文档：**

```text
文档 1：Elasticsearch 是一个搜索引擎
文档 2：搜索引擎用于全文检索
文档 3：Elasticsearch 使用倒排索引
```

**第 1 步：分词（把每篇文档切成词项）**

```text
文档 1 → [elasticsearch, 一个, 搜索引擎]
文档 2 → [搜索引擎, 用于, 全文检索]
文档 3 → [elasticsearch, 使用, 倒排索引]
```

（真实 ES 里英文会转小写，中文怎么切取决于分词器，这里先假设已正确切成"词"。）

**第 2 步：建立"词 → 文档"的映射（这就是倒排索引的雏形）**

每读一个词，就把它出现的文档号记到对应词的" posting list（倒排列表）"里：

```text
elasticsearch  →  [1, 3]
搜索引擎        →  [1, 2]
一个           →  [1]
用于           →  [2]
全文检索        →  [2]
使用           →  [3]
倒排索引        →  [3]
```

**第 3 步：加上位置和词频（进阶，但很重要）**

光记"在哪些文档"还不够。要支持"短语查询"（比如"搜索引擎"必须连在一起）和高亮，还得记每个词在文档里的**位置**：

```text
elasticsearch  →  文档1@位置0, 文档3@位置0
搜索引擎        →  文档1@位置2, 文档2@位置0
```

这样 ES 不仅知道"哪篇有这个词"，还知道"词在句子第几个位置"，从而能做短语匹配、临近度打分。

**最终倒排索引（简化视图）：**

```text
Term          | Doc IDs (with positions)
--------------+---------------------------
elasticsearch  | 1(0), 3(0)
搜索引擎        | 1(2), 2(0)
一个           | 1(1)
用于           | 2(1)
全文检索        | 2(2)
使用           | 3(1)
倒排索引        | 3(2)
```

### 1.3 为什么 MySQL `LIKE` 全表扫描慢

现在你要搜"搜索引擎"，对比两条路：

**用倒排索引（ES）：**
1. 在倒排表里查 `搜索引擎` → O(1) 哈希/二分定位
2. 直接拿到 `[文档1, 文档2]`
3. 不管总共有 3 篇还是 3 亿篇，这一步代价几乎不变

**用 MySQL `LIKE '%搜索引擎%'`：**
1. 从第 1 篇开始读
2. 对每篇文档的整段文本做子串匹配（逐字符比较）
3. 读到第 3 篇才结束
4. **文档数翻 1 万倍，扫描时间也翻 1 万倍**

```text
ES 倒排索引：  搜索引擎 ──查表──> [1, 2]        ← 和数据量几乎无关
MySQL LIKE：  文档1 文档2 文档3 ... 文档N       ← 全扫，随 N 线性增长
```

::: warning 关键结论
ES 的快，**不是因为它"机器快"，而是因为它提前建好了"词→文档"的映射表**。代价是写入时要额外维护这张表（所以 ES 写比 MySQL 重），收益是查询时直接查表、免全扫。这就是"空间换时间"。
:::

## 二、核心名词对照表（ES ↔ MySQL）

ES 和关系型数据库的术语容易混，先用表对齐心智：

| ES 概念 | MySQL 类比 | 说明 |
| --- | --- | --- |
| **Index（索引）** | 库（Database）/ 表（Table） | 一类文档的集合，相当于"一张逻辑表" |
| **Document（文档）** | 行（Row） | 一条 JSON 记录，存在 Index 里 |
| **Field（字段）** | 列（Column） | 文档里的一个键值对 |
| **Mapping（映射）** | 表结构（Schema） | 字段类型定义，如 text/keyword/integer |
| **Type（类型）** | ——（已废弃） | 见下方说明 |
| **Shard（分片）** | 分库分表 | 索引的物理切分 |
| **Cluster（集群）** | —— | 多个节点组成 |
| **Node（节点）** | —— | 一台运行中的 ES 实例 |
| **_id** | 主键 | 文档唯一标识 |

### 关于 Type：7.x 之后已废弃

早期 ES 为了"像关系库"，在 Index 里又搞了一层 Type（类似表里有子表）。**从 7.x 开始，一个 Index 只能有一个 Type，且默认叫 `_doc`；8.x 已彻底移除 Type 概念。**

::: danger 别再写 Type 了
你在老教程里看到的 `POST /blog/articles` 这种"Index/Type"两段式 URL，是 6.x 的写法。8.x 里：
- 索引就是索引，URL 是 `/索引名/_doc` 或 `/索引名/_search`，**没有 Type 这一层**。
- Spring Data 的 `@Document` 也不再需要 `type` 属性（设了也会被忽略）。
- 如果看到 `PUT /index/type/1` 这种写法，那是过时文档，不要抄。
:::

## 三、索引结构：Index → Shard → Segment

一个索引在物理上不是"一整块"，而是层层拆分的：

```text
Index（blog_articles）
├── Shard 0  （主分片，数据的一部分）
│   ├── Segment 1  （倒排索引文件，不可变）
│   ├── Segment 2
│   └── Segment 3
└── Shard 1  （主分片，数据的另一部分）
    ├── Segment 1
    └── Segment 2
```

| 层级 | 是什么 | 要点 |
| --- | --- | --- |
| **Index** | 逻辑集合 | 你操作的"表"，由若干分片组成 |
| **Shard（分片）** | 索引的水平切分 | 数据被均分到不同分片；**主分片数创建后不可改** |
| **Segment（段）** | 分片内的倒排索引文件 | **一旦写出就不可修改（immutable）**；查询时多个段合并结果 |

::: tip 为什么 Segment 不可变
不可变带来三个好处：① 不用加锁，并发安全；② 可以直接缓存在内存/OS cache，读极快；③ 老段删了就删了，不用原地修改。代价是"删除"其实是打删除标记、后台合并段时再真正清理——这就是后面"refresh/merge"机制的基础。
:::

## 四、分片（Shard）与副本（Replica）

这是 ES 能"分布式、高可用、水平扩展"的核心。

### 4.1 为什么要有分片

- **突破单机容量**：一个索引的数据可以超过单节点磁盘，切到多台机器。
- **并行计算**：搜索请求会分发到所有分片，结果汇总，**分片越多，查询越能并行**（但有上限）。

主分片（Primary Shard）负责承载数据；索引创建时指定的 `number_of_shards` 就是主分片数。

### 4.2 为什么主分片数"创建后不能改"

文档存进哪个分片，是用一个公式算的：

```text
分片序号 = hash(_id) % number_of_shards
```

如果改了 `number_of_shards`，所有已有文档的"该去哪个分片"全部算错，原来在分片 0 的文档，新公式可能算到分片 2，ES 就找不到了。**所以主分片数在创建索引时就定死。**

::: warning 想改主分片数怎么办
只能**重建索引（Reindex）**：建一个新分片数的索引，把老数据 `_reindex` 过去，再别名切换。这就是"改 mapping/分片要 reindex"说法的由来。所以一开始就要规划好分片数。
:::

### 4.3 副本（Replica）的作用

副本是主分片的拷贝：

- **高可用**：主分片所在节点挂了，副本顶上，集群不丢数据、不中断服务。
- **提升读吞吐**：搜索请求可以打副本，副本越多，能扛的并发读越大。

副本数 `number_of_replicas` **可以随时改**（不影响数据分布）。

### 4.4 计算公式与设计建议

**单个分片多大？**
官方经验值：**单个分片 10GB ~ 50GB 最舒服**。太大（>100GB）恢复慢、查询重；太小（<1GB）分片数爆炸，元数据开销大。

**分片数怎么定（经验估算）？**

```text
预计总数据量(GB) ≈ 单分片目标大小(如 30GB) × 主分片数
主分片数 ≈ 总数据量 / 单分片大小
```

举例：预计索引最终 300GB，按单分片 30GB → 主分片约 10 个。

**另一些建议：**

| 场景 | 建议 |
| --- | --- |
| 开发/学习、数据量小 | 1 主分片 + 0 副本（就是上一篇 docker-compose 里的配置） |
| 生产、要高可用 | 至少 1 副本；主分片数按数据量算 |
| 单节点集群 | 副本必须 0（没地方放副本，否则一直 yellow） |
| 分片总数 | 别贪多，集群总分片数控制在几万以内，过多 master 压力大 |

::: tip 一个常见反模式
"我多开几个分片，查询不就更快了吗？"——错。分片过多会让每个分片太小、元数据膨胀、协调节点负担重，**反而更慢**。先按数据量算，不够再加节点（副本自动分布过去）才是正路。
:::

### 4.5 查看分片分配（curl + Kibana）

建一个带分片的索引看看：

Kibana Console：

```json
PUT /blog_articles
{
  "settings": {
    "number_of_shards": 2,
    "number_of_replicas": 1
  }
}
```

curl 等价：

```bash
curl -X PUT "http://localhost:9200/blog_articles" \
  -H "Content-Type: application/json" \
  -d '{"settings":{"number_of_shards":2,"number_of_replicas":1}}'
```

查看分片分配：

Kibana Console：

```json
GET /_cat/shards/blog_articles?v
```

curl 等价：

```bash
curl -X GET "http://localhost:9200/_cat/shards/blog_articles?v"
```

返回（单节点下副本会 `UNASSIGNED`，因为没第二台机器放它）：

```text
index         shard  prirep  state        docs  store  node
blog_articles 0      p       STARTED         0    0b  es-single
blog_articles 1      p       STARTED         0    0b  es-single
blog_articles 0      r       UNASSIGNED
blog_articles 1      r       UNASSIGNED
```

| 列 | 含义 |
| --- | --- |
| `shard` | 分片编号 |
| `prirep` | `p` 主分片 / `r` 副本 |
| `state` | `STARTED` 已分配并可用 / `UNASSIGNED` 没分配出去 |
| `docs` | 该分片文档数 |
| `node` | 所在节点名 |

## 五、近实时（NRT）与 refresh / flush / translog

"为什么我刚写入的数据，要等 1 秒才能搜到？"——这是新手最高频的疑问。答案在 ES 的写入机制里。

### 5.1 写入到底经历了什么

一次 `index` 写入，数据会经过这几道关：

```text
你的请求
  │
  ▼
① 写内存 buffer（此时还搜不到）
  │
  ▼
② 同时写 translog（WAL 预写日志，防丢）
  │
  ▼
③ 默认每 1 秒 refresh 一次：buffer → 生成一个新 Segment（进 OS 缓存，可被搜）
  │                                   ↑ 这就是"近实时"：不是立刻，是最多等 1 秒
  ▼
④ 段越来越多，后台 merge 合并；translog 攒够/30 秒 flush：段落盘，translog 清空
```

### 5.2 三个关键词

| 机制 | 默认频率 | 作用 | 和"能不能搜到"的关系 |
| --- | --- | --- | --- |
| **refresh** | 1 秒 | 把内存 buffer 写成新的、可被搜索的 Segment（还在 OS 缓存，未落盘） | **写入后约 1 秒才可被搜到**，所以叫"近实时"而非"实时" |
| **translog（事务日志）** | 随写随记 | 预写日志，节点崩溃时靠它恢复未落盘的数据 | 保证**不丢数据**，和"搜不到"无关但和"数据安全"强相关 |
| **flush** | 30 秒 / translog 达 512MB | 把 Segment 真正落盘，清空 translog | 持久化，落盘后才算"铁板钉钉" |

### 5.3 为什么是"近实时"不是"实时"

refresh 是**周期性批量**把 buffer 刷成 Segment 的，而不是每条写入立刻可见。这么做是为了吞吐：如果每条都立刻建段、刷盘，磁盘 IO 会爆炸。代价就是**最多延迟约 1 秒（refresh_interval 默认值）**才能搜到。

::: tip 想要"写入立刻能搜到"怎么办
开发/测试时可以对单条请求强制刷新：

Kibana：
```json
POST /blog_articles/_doc/1?refresh=wait_for
{ "title": "即时可见" }
```
curl：
```bash
curl -X POST "http://localhost:9200/blog_articles/_doc/1?refresh=wait_for" \
  -H "Content-Type: application/json" \
  -d '{"title":"即时可见"}'
```
`refresh=wait_for` 表示"等这次 refresh 完成再返回"。**生产别滥用**，会拖慢写入。默认近实时对绝大多数搜索场景足够。
:::

## 六、分词（Analysis）—— 本章重点

分词（Analysis）是"往 ES 里写文本、以及拿文本去搜"时**最关键、也最容易踩坑**的一环。前面倒排索引能建好，前提是"词切得对"。

### 6.1 Analyzer = 三段式管道

ES 里的分词器（Analyzer）由三部分**按顺序**组成：

```text
原始文本
  │
  ▼
① Character Filter（字符过滤器）：先改文本，如去掉 HTML 标签、把 & 换成 and
  │
  ▼
② Tokenizer（分词器）：按规则把文本切成词项（token），如按空格、按标点
  │
  ▼
③ Token Filter（词项过滤器）：再加工，如转小写、去停用词、同义词扩展
  │
  ▼
最终词项（写入倒排索引 / 用于搜索）
```

| 组件 | 数量 | 作用 | 常见例子 |
| --- | --- | --- | --- |
| Character Filter | 0~多个（可选） | 分词前改文本 | `html_strip` 去标签、`mapping` 字符映射 |
| Tokenizer | **必须有 1 个** | 把文本切成 token | `standard`、`whitespace`、`ik_max_word` |
| Token Filter | 0~多个（可选） | 加工 token | `lowercase` 转小写、`stop` 去停用词、`synonym` 同义词 |

### 6.2 标准分词器（standard）长什么样

`standard` 是 ES 默认 analyzer：按词边界（Unicode 规则）切，英文按空格/标点，并转小写。

用 `_analyze` API 亲眼看分词结果。

Kibana Console：

```json
POST /_analyze
{
  "analyzer": "standard",
  "text": "The quick Brown Foxes"
}
```

curl 等价：

```bash
curl -X POST "http://localhost:9200/_analyze" \
  -H "Content-Type: application/json" \
  -d '{"analyzer":"standard","text":"The quick Brown Foxes"}'
```

返回：

```json
{
  "tokens" : [
    { "token" : "the",    "start_offset" : 0,  "end_offset" : 3,  "type" : "<ALPHANUM>", "position" : 0 },
    { "token" : "quick",  "start_offset" : 4,  "end_offset" : 9,  "type" : "<ALPHANUM>", "position" : 1 },
    { "token" : "brown",  "start_offset" : 10, "end_offset" : 15, "type" : "<ALPHANUM>", "position" : 2 },
    { "token" : "foxes",  "start_offset" : 16, "end_offset" : 21, "type" : "<ALPHANUM>", "position" : 3 }
  ]
}
```

逐字段看：

| 字段 | 含义 |
| --- | --- |
| `token` | 切出来的词项（已转小写） |
| `start_offset` / `end_offset` | 这个词在原文本里的起止字符位置（高亮用） |
| `position` | 词在句子里的顺序（短语查询/临近度用） |

可以看到：`The quick Brown Foxes` 被切成 `the / quick / brown / foxes`，并且**首字母大写在分词阶段已被转小写**。这正是英文检索"大小写不敏感"的来源。

### 6.3 中文为什么不能用 standard（逐字切的坑）

把同一句中文丢给 standard：

Kibana Console：

```json
POST /_analyze
{
  "analyzer": "standard",
  "text": "我爱编程"
}
```

curl 等价：

```bash
curl -X POST "http://localhost:9200/_analyze" \
  -H "Content-Type: application/json" \
  -d '{"analyzer":"standard","text":"我爱编程"}'
```

返回：

```json
{
  "tokens" : [
    { "token" : "我", "start_offset" : 0, "end_offset" : 1, "position" : 0 },
    { "token" : "爱", "start_offset" : 1, "end_offset" : 2, "position" : 1 },
    { "token" : "编", "start_offset" : 2, "end_offset" : 3, "position" : 2 },
    { "token" : "程", "start_offset" : 3, "end_offset" : 4, "position" : 3 }
  ]
}
```

::: danger 灾难现场
standard 对中文是**逐字切**的——"我爱编程"被切成 `我 / 爱 / 编 / 程` 四个单字。后果是：
- 你搜"编程"，倒排索引里只有单字"编"和"程"，**根本匹配不到"编程"这个词**。
- 搜"我爱你"，因为"爱"和"你"都是单字 token，会把所有含"爱"或"你"的文档都捞出来，**相关性全乱**。

所以**中文检索绝不能用默认 standard**，必须上中文分词器（IK）。
:::

### 6.4 IK 中文分词器

IK（elasticsearch-analysis-ik）是中文社区最主流的分词插件，提供两个 analyzer：

| analyzer | 行为 | 适用 |
| --- | --- | --- |
| **ik_smart** | 粗粒度，尽量少切、贪心合并成词 | 搜索时（query 侧），词少、性能好 |
| **ik_max_word** | 细粒度，穷尽所有可能的词 | 建索引时（index 侧），词全、召回率高 |

#### 6.4.1 Docker 里安装 IK

**方式 A：进容器用官方命令装（最快，但换容器要重装）**

```bash
# 进容器
docker exec -it es-single /bin/bash

# 在容器内执行插件安装，版本号必须和 ES 一致（这里是 8.18.5）
bin/elasticsearch-plugin install https://github.com/medcl/elasticsearch-analysis-ik/releases/download/v8.18.5/elasticsearch-analysis-ik-8.18.5.zip

# 退出并重启容器，让插件生效
exit
docker restart es-single
```

**方式 B：打自己的镜像（推荐，持久、可复现）**

新建 `Dockerfile`：

```dockerfile
FROM docker.elastic.co/elasticsearch/elasticsearch:8.18.5

# --batch 表示非交互（CI/构建用）；版本必须和 FROM 的 ES 版本一致
RUN bin/elasticsearch-plugin install --batch \
    https://github.com/medcl/elasticsearch-analysis-ik/releases/download/v8.18.5/elasticsearch-analysis-ik-8.18.5.zip
```

构建并改用这个镜像：

```bash
docker build -t es-ik:8.18.5 .
# 把 docker-compose.yml 里的 image 改成 es-ik:8.18.5 后再 up
```

::: warning IK 版本必须 = ES 版本
IK 插件和 ES 大版本、小版本都要对齐。ES 是 8.18.x，IK 就用 `v8.18.x`。装错版本 ES 启动会报插件不兼容、直接起不来。
:::

#### 6.4.2 验证 IK 装好了

```bash
curl -X GET "http://localhost:9200/_cat/plugins?v"
# 输出里应能看到 analysis-ik
```

#### 6.4.3 亲眼对比 ik_smart 和 ik_max_word

**ik_smart（粗）：**

Kibana：

```json
POST /_analyze
{
  "analyzer": "ik_smart",
  "text": "我爱编程"
}
```

curl：

```bash
curl -X POST "http://localhost:9200/_analyze" \
  -H "Content-Type: application/json" \
  -d '{"analyzer":"ik_smart","text":"我爱编程"}'
```

示意返回（具体 token 取决于 IK 词典）：

```json
{ "tokens" : [
  { "token" : "我",   "position" : 0 },
  { "token" : "爱",   "position" : 1 },
  { "token" : "编程", "position" : 2 }
] }
```

**ik_max_word（细）：**

Kibana：

```json
POST /_analyze
{
  "analyzer": "ik_max_word",
  "text": "我爱编程"
}
```

curl：

```bash
curl -X POST "http://localhost:9200/_analyze" \
  -H "Content-Type: application/json" \
  -d '{"analyzer":"ik_max_word","text":"我爱编程"}'
```

示意返回：

```json
{ "tokens" : [
  { "token" : "我",     "position" : 0 },
  { "token" : "爱",     "position" : 1 },
  { "token" : "编程",   "position" : 2 },
  { "token" : "我爱",   "position" : 0 },
  { "token" : "编",     "position" : 2 },
  { "token" : "程",     "position" : 3 }
] }
```

::: tip 对比结论
- `ik_smart` 只切出 `我/爱/编程` 三个词，干净、歧义少。
- `ik_max_word` 还额外切出 `我爱`、`编`、`程`，词更多更全。
- **常见实践**：索引时用 `ik_max_word`（尽量多词，召回高），搜索时用 `ik_smart`（词少、精准）。两者可以分别配在字段的 `analyzer` 和 `search_analyzer` 上（下一章 mapping 会讲）。
- 上面是示意结果，**你机器上的实际 token 以安装的 IK 词典为准**，可用 `_analyze` 自己验证。
:::

#### 6.4.4 自定义词典

IK 自带词典可能缺你们公司的专有词（如产品名" canoe 笔记"）。加自定义词典：

进容器编辑 `config/analysis-ik/IKAnalyzer.cfg.xml`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">
<properties>
  <comment>IK Analyzer 扩展配置</comment>
  <!-- 远程/本地扩展词典，一行一个词 -->
  <entry key="ext_dict">my_ext.dic</entry>
  <!-- 停用词词典（这些词不索引，如"的""了"） -->
  <entry key="ext_stopwords">my_stop.dic</entry>
</properties>
```

`my_ext.dic` 内容（每行一个词）：

```text
canoe笔记
倒排索引
```

改完重启 ES 即生效。也可以在 docker-compose 里把宿主机目录挂到 `/usr/share/elasticsearch/config/analysis-ik`，避免进容器改。

### 6.5 用 Java 客户端调用 _analyze（看分词结果）

前面都是用 DSL 看分词。在代码里也能调，方便你写单测验证分词效果：

`src/main/java/com/example/es/AnalyzeDemo.java`（演示用，可放 test 或随便一个 @Service 里）：

```java
package com.example.es;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.indices.AnalyzeResponse;
import co.elastic.clients.elasticsearch.indices.analyze.AnalyzeToken;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;

/**
 * 演示用官方 Java 客户端调用 _analyze API。
 *
 * 等价于 Kibana 里的：
 *   POST /_analyze
 *   { "analyzer": "ik_max_word", "text": "我爱编程" }
 */
@Component
public class AnalyzeDemo {

    private final ElasticsearchClient elasticsearchClient;

    public AnalyzeDemo(ElasticsearchClient elasticsearchClient) {
        this.elasticsearchClient = elasticsearchClient;
    }

    public void printTokens() throws IOException {
        // 调用 indices().analyze(...)，指定 analyzer 和待分析文本
        AnalyzeResponse response = elasticsearchClient.indices().analyze(a -> a
                .analyzer("ik_max_word")
                .text("我爱编程"));

        // 取出所有 token，逐个打印
        List<AnalyzeToken> tokens = response.tokens();
        for (AnalyzeToken token : tokens) {
            System.out.println("词项=" + token.token()
                    + "，位置=" + token.position()
                    + "，起=" + token.startOffset()
                    + "，止=" + token.endOffset());
        }
    }
}
```

对应的 curl（没装 IK 时把 analyzer 换成 `standard` 也能跑，验证逻辑一致）：

```bash
curl -X POST "http://localhost:9200/_analyze" \
  -H "Content-Type: application/json" \
  -d '{"analyzer":"ik_max_word","text":"我爱编程"}'
```

::: tip 三段式自定义 analyzer 也能在代码里验证
`_analyze` 还支持"临时拼一个 analyzer"来试效果，不发请求建索引就能调：

Kibana：
```json
POST /_analyze
{
  "tokenizer": "whitespace",
  "filter": ["lowercase"],
  "text": "The QUICK Brown FOX"
}
```
curl：
```bash
curl -X POST "http://localhost:9200/_analyze" \
  -H "Content-Type: application/json" \
  -d '{"tokenizer":"whitespace","filter":["lowercase"],"text":"The QUICK Brown FOX"}'
```
返回 token：`the / quick / brown / fox`（whitespace 按空格切，lowercase 转小写）。这就是 6.1 三段式的现场演示。
:::

## 七、文档 JSON 结构与元数据字段

你写入一条文档，ES 存的不只是你的 JSON，还会加一堆以 `_` 开头的**元数据字段**。

### 7.1 一个文档长什么样

你写入：

```json
{ "title": "Elasticsearch 入门", "content": "倒排索引是核心", "author": "张三" }
```

ES 实际存的：

```json
{
  "_index": "blog_articles",
  "_id": "1",
  "_version": 1,
  "_seq_no": 0,
  "_primary_term": 1,
  "_source": {
    "title": "Elasticsearch 入门",
    "content": "倒排索引是核心",
    "author": "张三"
  }
}
```

### 7.2 元数据字段速查

| 字段 | 含义 |
| --- | --- |
| `_index` | 这条文档属于哪个索引 |
| `_id` | 文档唯一 ID（你写的时候指定，或由 ES 生成） |
| `_version` | 版本号，每次修改 +1，乐观锁用 |
| `_seq_no` / `_primary_term` | 用于并发控制的序号（更新时带上是乐观并发控制） |
| `_source` | **你写入的原始 JSON**，搜索结果默认返回的就是它 |
| `_score` | 搜索时的相关性得分（写入时不存，查询时算） |
| `_type` | 已废弃（8.x 不再有，忽略） |

### 7.3 关于 `_source`

`_source` 就是你写入的那份原始文档。它**默认开启存储**，搜索结果里 `hits.hits[]._source` 返回的就是它，所以你的接口能直接拿到完整业务对象。

::: warning _source 能关吗
可以关（`"_source": {"enabled": false}`），关了能省点存储、写入快一点，但代价是：**搜出来的结果没有原始文档，你拿不到完整对象，也无法做 Reindex / 部分更新 / 高亮**。除非你非常清楚自己在干什么，否则**保持 _source 开启**。本专栏所有示例都依赖 `_source`。
:::

## 八、集群健康三种颜色

用 `_cluster/health` 看状态，会返回 `green / yellow / red` 三色。

| 颜色 | 含义 | 常见成因 | 要紧吗 |
| --- | --- | --- | --- |
| **green** | 主分片 + 副本全部正常分配 | 理想状态 | 最好 |
| **yellow** | 主分片都在，但**有副本没分配** | 单节点集群（没第二台放副本）、副本数 > 可用节点数 | 学习/单节点常见，**不影响读写** |
| **red** | **有主分片丢失**，部分数据不可用 | 节点宕机且没副本、磁盘写满、分片损坏 | 严重，部分数据搜不到/写不进 |

Kibana：

```json
GET /_cluster/health
```

curl：

```bash
curl -X GET "http://localhost:9200/_cluster/health?pretty"
```

::: tip 回到第一篇的"yellow"
第一篇我们本地单节点集群是 `yellow`，原因就是：索引设了 `number_of_replicas=1`，但集群只有 1 个节点，副本无处安放 → yellow。**yellow 在单节点开发环境完全正常**，数据可读可写。上生产要 ≥2 节点 + 副本，才能到 green。如果看到 `red`，第一时间查是不是节点挂了或磁盘满了（`GET _cat/allocation?v`、`GET _cat/nodes?v`）。
:::

## 本篇小结

- **倒排索引 = 词→文档的映射表**，是 ES 快于 MySQL `LIKE` 全表扫描的根本原因（查询代价与数据量几乎无关）。
- **名词对照**：Index≈表、Document≈行、Field≈列；**Type 在 7.x 后废弃，8.x 彻底移除**，别再写。
- **索引结构**：Index → Shard（主分片数创建后不可改，改要 reindex）→ Segment（不可变文件）。
- **分片**解决容量与并行，**副本**解决高可用与读吞吐；单分片 10~50GB 为宜，单节点副本必须 0。
- **近实时**：写入经 buffer → translog → 每 1 秒 refresh 成可搜 Segment，所以"约 1 秒后才搜到"；translog 保证不丢数据，flush 负责落盘。
- **分词三段式**：Character Filter → Tokenizer → Token Filter。英文用 standard，中文**必须用 IK**；`ik_max_word`（建索引，细）vs `ik_smart`（搜索，粗），且 IK 版本要 = ES 版本。用 `_analyze` 亲自验证分词结果。
- **文档元数据**：`_source` 是你的原始 JSON（别关）、`_id` 是主键、`_version`/`_seq_no` 做并发控制、`_score` 是相关性得分。
- **集群三色**：green 全好、yellow 缺副本（单节点正常）、red 丢主分片（要紧）。

## 参考链接

- 倒排索引与文本分析官方文档：<https://www.elastic.co/docs/solutions/search/index-and-query-analyze>
- Analyze API：<https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-analyze>
- 分词器（Analyzers）：<https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/analyzer>
- IK 分词插件：<https://github.com/medcl/elasticsearch-analysis-ik>
- 索引、分片与副本：<https://www.elastic.co/docs/deploy-manage/distributed-architecture/shard-allocation>
- 近实时、refresh、translog：<https://www.elastic.co/docs/solutions/search/index-and-query-documents/near-real-time>
- 集群健康：<https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cluster-health>

下一篇 → [03 索引与 Mapping API](/java/middleware/es/mapping)
