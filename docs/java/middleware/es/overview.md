# 01 ES 入门与环境搭建

> 本篇不急着写业务，先把「Elasticsearch（以下简称 ES）到底是什么、怎么把它跑起来、怎么用 Spring Boot 连上它」这三件事讲透。环境搭好了，后面 02~08 每一章的示例都基于这一篇搭出来的同一套环境，所以这篇请务必跟着跑一遍。

## 本篇要解决的问题

很多同学第一次接触 ES，脑子里是一团浆糊：

- ES 和 MySQL 到底有啥区别？我数据库不是也能查吗？
- 本地怎么跑？Docker 一堆配置看不懂
- 容器反复重启、端口被占、内存爆了，怎么排查
- Spring Boot 又要配一堆依赖，版本到底怎么对齐
- 连上了之后，怎么"存一条、搜出来"先建立一点成就感

这一篇逐个解决。读完你应该能在自己的机器上：

1. 用 Docker 跑起一个 ES + Kibana
2. 用 Spring Boot 3.5 连上它
3. 存一条数据，再把它搜出来

## 一、ES 到底是什么：一个让你一下子记住的比喻

想象你有一本 500 页的技术书，现在有人问你：**"书里哪几页讲过 '倒排索引' 这个词？"**

### 如果用 MySQL 的思路

MySQL 这种关系型数据库，数据是按"行"顺序存的，就像书里的内容是按页码一页一页排的。要找"倒排索引"这个词，你**只能从第 1 页翻到第 500 页，逐页逐行扫描**，看到就记下来。书越厚，翻得越慢。这就是 `SELECT * FROM book WHERE content LIKE '%倒排索引%'` 的本质——**全表扫描**。

### 如果用 ES 的思路

真实世界里，书后面都会有一张「**索引表（Index）**」，长这样：

```text
倒排索引 ................ 第 23 页、第 156 页、第 401 页
分词器 .................. 第 88 页、第 156 页
集群 .................... 第 12 页、第 45 页
```

你想找"倒排索引"，直接查这张表，一秒钟就知道它在 23、156、401 页，根本不用翻书。**ES 干的就是"给数据建这样一张索引表，然后按词反查文档"的活。**

::: tip 一句话记住
- **MySQL 像"按页码翻书找一句话"**——适合按条件精确取行、事务一致。
- **ES 像"书后面那张按词查页码的索引表"**——适合按关键词、全文模糊地找内容。

所以 ES 不是来替换 MySQL 的，它是来**替 MySQL 干它不擅长的事：海量文本里的模糊搜索、相关性排序**。你公司订单存在 MySQL，用户搜"2024 红色连衣裙"这种需求交给 ES。
:::

### ES 的官方定位

ES 是一个**分布式的、近实时的（NRT）搜索与分析引擎**，底层基于 Apache Lucene。它把"建索引表 + 分布式存储 + 高可用"这些复杂事全包了，对外只暴露一套 HTTP REST API。你往里塞 JSON 文档，它帮你建好倒排索引；你发一个搜索请求，它按相关性算分把最匹配的文档排前面返回。

## 二、ES 和 MySQL 的核心区别

别再纠结"谁更好"，它们解决的是不同问题：

| 对比维度 | MySQL（关系型数据库） | Elasticsearch（搜索/分析引擎） |
| --- | --- | --- |
| 数据模型 | 行（Row）+ 列（Column），强 Schema | 文档（Document，JSON），Schema 灵活（映射可动态） |
| 擅长的事 | 精确查询、事务（ACID）、join 关联 | 全文检索、模糊匹配、相关性排序、聚合统计 |
| 找内容的姿势 | `LIKE '%词%'` 全表扫，越大数据越慢 | 走倒排索引，毫秒级定位，和数据量关系不大 |
| 事务 | 原生支持，强一致 | 不支持跨文档事务，最终一致（近实时） |
| 写入后能否立刻搜到 | 立刻（提交即可见） | 默认约 1 秒后（refresh 机制，后面 02 章讲） |
| 扩展性 | 分库分表得自己搞 | 天生分片（Shard），加节点自动再均衡 |
| 典型场景 | 订单、账户、配置等"权威数据" | 商品搜索、日志检索、站内搜索、指标分析 |

::: warning 最常见的误用
把 ES 当主数据库，所有写操作都先写 ES、还要事务回滚——这是错的。ES 的定位是**查询侧**（Search/Analytics），权威数据（Source of Truth）应该放在 MySQL/业务库，需要被搜索的数据**同步**一份到 ES。本专栏后面会有"MySQL 到 ES 数据同步"的实战章。
:::

## 三、ES 的典型使用场景

理解它擅长什么，才知道什么时候该用它：

| 场景 | 说明 | 为什么用 ES |
| --- | --- | --- |
| **全文检索** | 站内搜索、文档搜索、代码搜索 | 倒排索引 + 相关性算分，模糊匹配又快又准 |
| **日志分析（ELK）** | 把应用日志、Nginx 日志灌进 ES，用 Kibana 看板 | 写入吞吐高，聚合统计快，配 Kibana 直接可视化 |
| **商品搜索** | 电商"搜商品 + 筛选 + 排序" | 支持分词、过滤、高亮、分页，还能按销量/价格排序 |
| **指标监控** | 服务器 metrics、APM 链路数据 | 时序数据 + 聚合，配合 Grafana/Kibana 做监控大盘 |
| **向量检索** | 用向量做"以文搜文""图片相似""RAG 知识库" | 8.x 原生支持 `dense_vector` 字段和 knn 检索 |

::: tip 一个判断标准
"用户用一串**关键词**来找东西"→ 上 ES。"程序用**主键/唯一条件**精确取一条记录"→ 用 MySQL。两者经常**配合使用**，不是二选一。
:::

## 四、本地 Docker 环境搭建

开发学习阶段，最省事的就是用 Docker 起一套 ES + Kibana。下面给的是**单节点、关掉安全认证**的开发配置，专为本地学习设计。

### 4.1 完整的 docker-compose.yml

在任意目录新建 `docker-compose.yml`：

```yaml
version: "3.8"

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.18.5
    container_name: es-single
    environment:
      # 1) 单节点模式：不组成集群，省掉选主等开销，开发环境专用
      - discovery.type=single-node
      # 2) 关闭 X-Pack 安全：本地学习不用账号密码，方便上手
      #    ⚠️ 生产环境必须开启，否则任何人都能读写你的数据
      - xpack.security.enabled=false
      - xpack.security.enrollment.enabled=false
      - xpack.security.http.ssl.enabled=false
      - xpack.security.transport.ssl.enabled=false
      # 3) JVM 堆内存：初始和最大设成一样，避免运行时扩容抖动
      #    物理机内存小就设 512m，够用就 1g；不要超过物理内存的 50%
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
      # 4) 单节点下把副本关掉，否则索引会处于 yellow（后面 02 章讲原因）
      - "index.number_of_replicas=0"
    ulimits:
      # 允许锁内存，避免交换（swap）拖慢 ES
      memlock:
        soft: -1
        hard: -1
    ports:
      # 5) 9200 是 REST API 端口（你所有 curl / Java 客户端都打这里）
      - "9200:9200"
      # 6) 9300 是节点间通信端口（Transport），集群内部用；单节点用不到但习惯上仍暴露
      - "9300:9300"
    volumes:
      # 7) 数据持久化：容器删了数据不丢
      - es-data:/usr/share/elasticsearch/data
    healthcheck:
      # 用集群健康接口做健康检查，green 或 yellow 都算健康
      test: ["CMD-SHELL", "curl -s http://localhost:9200/_cluster/health | grep -q '\"status\":\"green\"\\|\"status\":\"yellow\"'"]
      interval: 10s
      timeout: 10s
      retries: 30

  kibana:
    image: docker.elastic.co/kibana/kibana:8.18.5
    container_name: kibana-single
    environment:
      # 指向上面 ES 容器的服务名（docker 内部网络互通）
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    ports:
      # Kibana 的 Web 界面端口
      - "5601:5601"
    depends_on:
      elasticsearch:
        condition: service_healthy

volumes:
  es-data:
    driver: local
```

几个关键点先记住，后面还会反复用到：

- **9200 vs 9300**：`9200` 是你和 ES 说话的 REST 端口（HTTP JSON）；`9300` 是 ES 节点之间"私聊"的端口，业务代码永远不打 9300。
- **`xpack.security.enabled=false`**：关认证，curl 不用带账号密码，初学最顺。但记住这是开发配置。
- **`index.number_of_replicas=0`**：单节点没地方放副本，不关掉索引会一直 yellow。

::: danger 镜像版本要和服务端基线一致
本文基线统一用 **8.18.x**。上面写的是 `8.18.5`，你换成你服务端实际的 8.18 小版本号即可（如 `8.18.0`）。**客户端和服务端大版本必须对齐**，这是后面反复强调的红线。
:::

### 4.2 启动与验证

```bash
# 在 docker-compose.yml 所在目录执行，后台启动
docker compose up -d

# 看容器状态（STATUS 应为 healthy / Up）
docker compose ps

# 看 ES 启动日志（第一次会下载镜像，慢一点正常）
docker compose logs -f elasticsearch
```

ES 启动要十几秒，等 healthcheck 变绿后，验证集群状态：

**方式 A：Kibana Dev Tools Console（推荐，后面 06 章细讲）**

```json
GET /_cluster/health
```

**方式 B：curl（没装 Kibana 也能验证）**

```bash
curl -X GET "http://localhost:9200/_cluster/health?pretty"
```

返回（开发单节点通常看到 `yellow`，原因见 02 章，不影响学习）：

```json
{
  "cluster_name" : "docker-cluster",
  "status" : "yellow",
  "timed_out" : false,
  "number_of_nodes" : 1,
  "number_of_data_nodes" : 1,
  "active_primary_shards" : 1,
  "active_shards" : 1,
  "relocating_shards" : 0,
  "initializing_shards" : 0,
  "unassigned_shards" : 1,
  "delayed_unassigned_shards" : 0,
  "number_of_pending_tasks" : 0,
  "active_shards_percent_as_number" : 100.0
}
```

逐字段看一遍（小白别怕这坨 JSON）：

| 字段 | 含义 |
| --- | --- |
| `cluster_name` | 集群名，默认 `docker-cluster` |
| `status` | 健康度：`green` 全好 / `yellow` 主分片在、副本没地放 / `red` 有主分片丢了。**单节点 yellow 是正常的** |
| `number_of_nodes` | 集群里节点数，单机就是 1 |
| `active_primary_shards` | 已激活的主分片数 |
| `unassigned_shards` | 没分配出去的分片数，单节点下副本分片就是它 |
| `active_shards_percent_as_number` | 已分配分片百分比，100 说明主分片都好了 |

再验证一下根接口，能看到 ES 版本号，确认服务端就是 8.18.x：

```bash
curl -X GET "http://localhost:9200?pretty"
```

```json
{
  "name" : "es-single",
  "cluster_name" : "docker-cluster",
  "version" : {
    "number" : "8.18.5",
    "build_flavor" : "default",
    "build_type" : "docker"
  },
  "tagline" : "You Know, for Search"
}
```

看到 `"number" : "8.18.5"`，说明服务端版本对上了，环境 OK。

### 4.3 Windows / Linux 常见踩坑

这部分是"容器反复重启、起不来"的高频原因，提前列给你。

**坑 1：Linux 上 `max virtual memory areas vm.max_map_count [65530] is too low`**

ES 对 `mmap` 计数有要求，Linux 默认值太小会直接启动失败。

```bash
# 临时生效（重启失效）
sudo sysctl -w vm.max_map_count=262144

# 永久生效：写进 /etc/sysctl.conf
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

Windows / macOS 的 Docker Desktop 一般不用管（它底层 WSL2/VM 已调好），真遇到再查。

**坑 2：内存不够，容器反复重启（Restarting）**

症状：`docker compose ps` 里 STATUS 一直 `Restarting`。多半是给 ES 的堆内存超过了宿主可用内存。

- 把 `ES_JAVA_OPTS` 调小，比如 `-Xms256m -Xmx256m`（小机器够学用了）
- 确认宿主机空闲内存 > 你设的堆内存 + 系统开销

```bash
# 看容器为什么挂：看日志末尾
docker compose logs --tail=50 elasticsearch
```

**坑 3：端口冲突（bind: address already in use）**

9200/5601 被别的程序占了（比如你之前起过一次没删）。

```bash
# 换端口映射即可，例如把宿主机 9201 映射到容器 9200
# ports: - "9201:9200"
# 或者清掉旧容器
docker compose down
```

**坑 4：数据持久化卷**

第一次跑 `docker compose down` 只停容器、数据还在（`es-data` 卷保留）。要**彻底清空数据**才用：

```bash
docker compose down -v
```

::: warning 改了 compose 后记得重建
如果你改了 `ES_JAVA_OPTS` 或环境变量，执行 `docker compose up -d` 不会重新应用——要先 `docker compose down` 再 `up -d`，或者用 `docker compose up -d --force-recreate elasticsearch`。
:::

## 五、阿里云 Elasticsearch

学会了本地，到公司大概率用的是云上的 ES（阿里云、腾讯云、AWS 等）。好消息是：**本地和云端 ES 是同一套软件，你的代码几乎不用改，只改连接配置**。

### 5.1 怎么选版本和规格

- **版本**：选和本文基线一致的 **8.18.x**（阿里云控制台选 8.18 系列）。这样你本地写的示例直接能连云端。
- **规格**：学习/小业务从**最小规格（单节点或 2 节点）**起步；生产按数据量和 QPS 选。云厂商按节点数和规格计费，别一上来选顶配。
- **网络**：务必把"云服务器 ECS 私网"或"公网白名单"配上，否则连不上（经典事故：代码没错，是安全组没放 IP）。

### 5.2 本地 vs 云端：只改连接配置的对照表

| 项目 | 本地 Docker | 阿里云 ES |
| --- | --- | --- |
| 地址 | `http://localhost:9200` | `https://es-cn-xxxx.kibana.elasticsearch.aliyuncs.com:9200`（控制台给的公网/私网地址） |
| 端口 | 9200 | 9200（云端也是） |
| 协议 | http（关了安全） | **https**（云端默认开 TLS） |
| 认证 | 无 | **Basic Auth（用户名/密码）**，默认用户名 `elastic` |
| 路径前缀 | 无 | 阿里云公网端点常带 `path_prefix`（控制台可见，必须配上，否则 404） |
| 代码改动 | — | 只改 `uris` + `username` + `password` +（必要）`pathPrefix` |

### 5.3 连接配置示例（含 Basic Auth）

**application.yml（Spring Boot）**

```yaml
spring:
  elasticsearch:
    # 云端给的地址，注意是 https
    uris: https://es-cn-xxxx.kibana.elasticsearch.aliyuncs.com:9200
    # Basic Auth：默认用户名 elastic，密码是创建实例时设的
    username: elastic
    password: ${ES_CLOUD_PASSWORD}   # 从环境变量读，别写死
    # 如果云端端点有 path prefix（控制台"基本信息"里能看到），需要在这里拼上
    # 例如 uris: https://es-cn-xxxx.elasticsearch.aliyuncs.com:9200/es-path
```

**Java 客户端显式配置（需要 path prefix 或自定义 TLS 时）**

当云端有 `pathPrefix` 或你要自己控制连接（加凭据、关证书校验等），手动建一个 `ElasticsearchClient` Bean：

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
 * 连接阿里云 ES 的客户端配置。
 *
 * 关键点：
 * 1. 用 BasicCredentialsProvider 把用户名密码塞进去，对应云端的 Basic Auth。
 * 2. 阿里云公网端点常带 pathPrefix，必须用 setPathPrefix 设上，否则所有请求都 404。
 * 3. 本地没这些花活，可以不要这个配置类，直接用 Spring Boot 自动配置（见 07 章）。
 */
@Configuration
public class AliyunEsConfig {

    @Bean
    public ElasticsearchClient elasticsearchClient() {
        // 1. 凭据：用户名 + 密码
        CredentialsProvider credentialsProvider = new BasicCredentialsProvider();
        credentialsProvider.setCredentials(AuthScope.ANY,
                new UsernamePasswordCredentials("elastic", System.getenv("ES_CLOUD_PASSWORD")));

        // 2. 建低层 REST 客户端，挂上凭据，并设置 path prefix
        RestClient restClient = RestClient.builder(
                        new HttpHost("es-cn-xxxx.kibana.elasticsearch.aliyuncs.com", 9200, "https"))
                // 阿里云端点的路径前缀，按控制台实际值填；本地没有就删掉这一行
                .setPathPrefix("/es-path")
                .setHttpClientConfigCallback(httpClientBuilder ->
                        httpClientBuilder.setDefaultCredentialsProvider(credentialsProvider))
                .build();

        // 3. Jackson 做 JSON 映射，再用它建传输层和客户端（和本地完全一致）
        ElasticsearchTransport transport = new RestClientTransport(restClient, new JacksonJsonpMapper());
        return new ElasticsearchClient(transport);
    }
}
```

::: tip 为什么"只改连接配置"就行
因为 ES 对外只有一套 REST API + 一套 Java 客户端 `elasticsearch-java`。无论服务端在本地 Docker 还是阿里云，接口长得一模一样。你的 Repository、Controller、查询语句**一个字都不用改**，只换 `uris`/`username`/`password` 三个值。这就是"服务端统一基线"带来的好处。
:::

## 六、Kibana Dev Tools Console 的用法

后面 02~08 章所有 DSL（ES 的领域特定查询语言）我都会先在 Console 里演示。先花两分钟认识这个工具，后面跟着做会顺很多。

### 6.1 打开它

浏览器访问 `http://localhost:5601` → 左侧菜单 **Management（堆叠图标）→ Dev Tools**（或直接搜 "Console"）。打开后是一个左右分栏的编辑器：

```text
┌───────────────────────────────┬───────────────────────────────┐
│  左：请求编辑器（写 DSL）        │  右：响应结果（返回 JSON）        │
│                               │                               │
│  GET /_cluster/health         │  {                            │
│                               │    "cluster_name": "...",    │
│  （点 ▶ 运行，或按快捷键）       │    "status": "yellow",        │
│                               │    ...                        │
└───────────────────────────────┴───────────────────────────────┘
```

### 6.2 基本语法

- 每行一条请求，格式是 `HTTP方法 路径`，方法后的请求体（body）写在下面，用空行隔开。例如：

```json
GET /_cluster/health

POST /blog_articles/_search
{
  "query": {
    "match": { "title": "elasticsearch" }
  }
}
```

- 多行请求之间用**空行**分隔；连续非空行会被当成同一条请求。
- 同一份编辑器里可以放很多请求，想跑哪个就把光标放在那条请求上点运行（或选中再运行）。

### 6.3 常用快捷键

| 快捷键（Mac / Win） | 作用 |
| --- | --- |
| `Cmd/Ctrl + Enter` | 运行光标所在（或选中的）请求 |
| `Cmd/Ctrl + /` | 注释/取消注释当前行 |
| `Cmd/Ctrl + Alt + L` | 格式化当前请求 JSON |
| `Cmd/Ctrl + ↑/↓` | 在请求历史里翻 |

### 6.4 怎么看结果

右侧返回的 JSON 里，搜索类请求重点看两个字段：

- `hits.hits`：命中的文档数组，每个元素里有 `_source`（原始文档）和 `_score`（相关性得分，越大越匹配）。
- `took`：耗时（毫秒）；`timed_out`：是否超时。

::: tip 看不懂返回 JSON 别慌
从本篇开始，凡是我贴出的返回结果，都会**逐字段讲一遍**。你养成"先看 `hits.total`，再看 `hits.hits[]._source`"的习惯就行。
:::

## 七、Spring Boot 项目脚手架（重点）

这是后面 03~08 章共用的"演示项目"。我们把它建好，并约定包结构。

### 7.1 包结构约定

统一用 `com.example.es`：

```text
src/main/java/com/example/es/
├── EsDemoApplication.java        # 启动类
├── config/
│   └── ElasticsearchConfig.java  # 客户端配置（可选，自动配置够用）
├── domain/
│   └── Article.java              # 文档实体（对应一个 ES 索引）
├── repository/
│   └── ArticleRepository.java    # Spring Data 仓库
├── controller/
│   └── ArticleController.java     # 演示接口
└── HealthController.java          # 健康检查
src/main/resources/
├── application.yml               # 连接配置
```

### 7.2 完整 pom.xml（含版本对齐的"坑"）

`pom.xml`：

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
        版本对齐的"坑"（务必看）：
        Spring Boot 3.5 用属性 elasticsearch-client.version 管理
        官方 Java 客户端 co.elastic.clients:elasticsearch-java 的版本。
        （注意：是 elasticsearch-client.version，不是旧教程里写的
         elasticsearch.version —— 那个属性在 3.5 的 BOM 里已不存在，
         写了也不会生效，客户端版本还是 BOM 默认值。）
        以 3.5.5 为例，BOM 默认就是 8.18.5，已经和 8.18.x 服务端对齐；
        但不同 3.5.x 补丁版的默认值可能不同（早期版本曾是 8.17.x），
        所以最稳妥的做法是显式锁成你服务端的大版本。
        这样客户端和服务端大版本严格一致，避免兼容性报错。
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

        <!--
        显式声明官方 Java API Client（版本受 BOM 管理，不需要写 <version>）。
        写在这里是为了让"用的是哪个客户端"一目了然；
        不写也行，starter 已经传递依赖了它。
        -->
        <dependency>
            <groupId>co.elastic.clients</groupId>
            <artifactId>elasticsearch-java</artifactId>
        </dependency>

        <!-- 参数校验（后面接口会用到 @NotNull 等） -->
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

::: danger 版本对齐红线（全站反复强调）
- **属性名是 `elasticsearch-client.version`**，不是 `elasticsearch.version`。旧博客/旧教程里写的 `<elasticsearch.version>` 在 Spring Boot 3.5 里**不生效**，会导致你以为锁了版本其实没锁。
- 把它设成和你服务端一致的 **8.18.x**（上面示例 `8.18.5`）。客户端和服务端大版本不一致，轻则某些新 API 报错，重则序列化协议对不上直接连不上。
- 本文基线固定：**JDK 17 + Spring Boot 3.5.5 + elasticsearch-java 8.18.x + Spring Data Elasticsearch 5.5.x**。后续所有章节示例都基于这套组合，不要随意换版本。
:::

### 7.3 application.yml（连接配置 + 日志）

`src/main/resources/application.yml`：

```yaml
spring:
  application:
    name: es-demo
  elasticsearch:
    # ES 的 REST 地址（本地 Docker 就是它）
    uris: http://localhost:9200
    # 本地关了安全认证，所以不需要 username/password
    # 连阿里云时填：username: elastic / password: ${ES_CLOUD_PASSWORD}
    # 连接超时与读取超时（ES 查询可能比普通接口慢，给足时间）
    connection-timeout: 5s
    socket-timeout: 30s

server:
  port: 8080

logging:
  level:
    # 打开 Spring Data ES 的 DEBUG，初期排查很有用；稳定后可调回 INFO
    org.springframework.data.elasticsearch: INFO
    # 想看客户端发了什么请求，开这个（非常啰嗦，调试时临时开）
    # co.elastic.clients: DEBUG
```

::: tip Spring Boot 怎么知道连哪
`spring.elasticsearch.uris` 会被 Spring Boot 的自动配置读走，自动帮你建好低层 `RestClient` 和官方 `ElasticsearchClient`。所以**绝大多数情况你不用写任何配置类**，直接注入 `ElasticsearchClient` 就能用。需要自定义（加 TLS、pathPrefix、凭据）时，再写 05 章那种 `@Configuration` 覆盖它（Spring Boot 的自动配置是 `@ConditionalOnMissingBean`，你的 Bean 优先）。
:::

### 7.4 启动类

`src/main/java/com/example/es/EsDemoApplication.java`：

```java
package com.example.es;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 演示项目启动类。
 *
 * 引入 spring-boot-starter-data-elasticsearch 后，Spring Boot 会自动配置
 * ElasticsearchClient（官方 Java 客户端）并注册成 Bean。
 * 我们不用写任何创建客户端的代码 —— 这就是 starter 的价值。
 */
@SpringBootApplication
public class EsDemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(EsDemoApplication.class, args);
    }
}
```

### 7.5 健康检查 Controller

先放一个最简单的接口，确认"应用能起来、ES 能连上"。后面再换成真正的搜索。

`src/main/java/com/example/es/HealthController.java`：

```java
package com.example.es;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch.cluster.HealthResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

/**
 * 健康检查接口。
 *
 * 注入官方 Java 客户端 ElasticsearchClient（由 Spring Boot 自动配置提供）。
 * 调用 _cluster/health 接口，把集群状态透出来，方便验证连通性。
 */
@RestController
public class HealthController {

    private final ElasticsearchClient elasticsearchClient;

    // 构造器注入。如果 Spring Boot 没自动配置成功，这里启动就会报错，正好帮你提前发现问题
    public HealthController(ElasticsearchClient elasticsearchClient) {
        this.elasticsearchClient = elasticsearchClient;
    }

    @GetMapping("/health")
    public String health() throws IOException {
        // 等价于 Kibana 里的 GET /_cluster/health
        HealthResponse response = elasticsearchClient.cluster().health(h -> h);
        return "ES 集群状态: " + response.status();
    }
}
```

启动应用后验证：

**方式 A：直接访问**

浏览器或 curl：

```bash
curl -X GET "http://localhost:8080/health"
# 返回：ES 集群状态: YELLOW
```

**方式 B：看 ES 侧的等价请求**

```bash
# Kibana Console
GET /_cluster/health

# curl
curl -X GET "http://localhost:9200/_cluster/health?pretty"
```

看到 `YELLOW`（单节点无副本，正常），说明**Spring Boot → ES 的整条链路打通了**。

## 八、最小闭环：存一条数据 → 搜出来

光连通还不够，我们用**最少的代码**完成一次"写入文档 → 检索文档"，建立成就感。这个闭环贯穿两种写法：先给 ES 原生的 DSL（Kibana + curl），再给 Spring Boot 的 Java 写法。

### 8.1 用 ES 原生方式（Kibana DSL + curl）

先建一个索引 `blog_articles`，写入一条文档，再搜"elasticsearch"。

**① 建索引（指定 mapping，让 title 用标准分词）**

Kibana Console：

```json
PUT /blog_articles
{
  "mappings": {
    "properties": {
      "title":    { "type": "text" },
      "content":  { "type": "text" },
      "author":   { "type": "keyword" }
    }
  }
}
```

curl 等价：

```bash
curl -X PUT "http://localhost:9200/blog_articles" \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": {
      "properties": {
        "title":   { "type": "text" },
        "content": { "type": "text" },
        "author":  { "type": "keyword" }
      }
    }
  }'
```

**② 写入一条文档**

Kibana Console：

```json
POST /blog_articles/_doc/1
{
  "title": "Elasticsearch 入门",
  "content": "倒排索引是 Elasticsearch 的核心",
  "author": "张三"
}
```

curl 等价：

```bash
curl -X POST "http://localhost:9200/blog_articles/_doc/1" \
  -H "Content-Type: application/json" \
  -d '{"title":"Elasticsearch 入门","content":"倒排索引是 Elasticsearch 的核心","author":"张三"}'
```

返回（重点看 `result` 是 `created`）：

```json
{
  "_index" : "blog_articles",
  "_id" : "1",
  "_version" : 1,
  "result" : "created",
  "_shards" : { "total" : 1, "successful" : 1, "failed" : 0 },
  "_seq_no" : 0,
  "_primary_term" : 1
}
```

**③ 搜出来**

Kibana Console：

```json
GET /blog_articles/_search
{
  "query": {
    "match": { "title": "elasticsearch" }
  }
}
```

curl 等价：

```bash
curl -X GET "http://localhost:9200/blog_articles/_search" \
  -H "Content-Type: application/json" \
  -d '{"query":{"match":{"title":"elasticsearch"}}}'
```

返回（逐字段看）：

```json
{
  "took" : 3,
  "timed_out" : false,
  "hits" : {
    "total" : { "value" : 1, "relation" : "eq" },
    "max_score" : 0.2876821,
    "hits" : [
      {
        "_index" : "blog_articles",
        "_id" : "1",
        "_score" : 0.2876821,
        "_source" : {
          "title" : "Elasticsearch 入门",
          "content" : "倒排索引是 Elasticsearch 的核心",
          "author" : "张三"
        }
      }
    ]
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `took` | 本次查询耗时 3 毫秒 |
| `hits.total.value` | 命中 1 条 |
| `hits.max_score` | 最高相关性得分 |
| `hits.hits[]._score` | 这一条的得分（越大越匹配） |
| `hits.hits[]._source` | 文档原始内容（就是你写入的 JSON） |

::: tip 为什么 `elasticsearch` 能匹配 `Elasticsearch 入门`
`match` 查询会先对搜索词分词（这里 `elasticsearch` 分词后还是 `elasticsearch`），再去倒排索引里找。索引时 `Elasticsearch 入门` 的 `title` 被标准分词器切成 `elasticsearch` / `入门` 两个词项，所以能匹配上。这个过程下一章（02 倒排索引、分词）会彻底讲透。
:::

### 8.2 用 Spring Boot 写法（Repository 风格）

同样的"存一条、搜出来"，用 Spring Data 的 Repository 写，业务代码非常干净。

**① 文档实体**

`src/main/java/com/example/es/domain/Article.java`：

```java
package com.example.es.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;

/**
 * 文章文档，对应 ES 索引 blog_articles。
 *
 * @Document 标记这是一个 ES 文档类，indexName 指定索引名。
 * 注意：indexName 必须小写、不能含下划线以外的特殊字符。
 */
@Document(indexName = "blog_articles")
public class Article {

    // @Id 标记文档主键，会写到 ES 的 _id 字段
    @Id
    private String id;

    // title 是 text 类型，会被分词，用于全文检索
    @Field(type = FieldType.Text)
    private String title;

    // content 也是 text，用于检索
    @Field(type = FieldType.Text)
    private String content;

    // author 用 keyword（不分词），适合精确匹配/聚合
    @Field(type = FieldType.Keyword)
    private String author;

    public Article() {
    }

    public Article(String id, String title, String content, String author) {
        this.id = id;
        this.title = title;
        this.content = content;
        this.author = author;
    }

    // getter / setter（Lombok 可省略，这里显式写出方便理解）
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

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getAuthor() {
        return author;
    }

    public void setAuthor(String author) {
        this.author = author;
    }
}
```

**② Repository 接口**

`src/main/java/com/example/es/repository/ArticleRepository.java`：

```java
package com.example.es.repository;

import com.example.es.domain.Article;
import org.springframework.data.elasticsearch.repository.ElasticsearchRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * 继承 ElasticsearchRepository 即可获得 CRUD、分页等现成方法。
 *
 * 泛型：<文档类型, 主键类型>。ES 的 _id 是字符串，所以主键用 String。
 *
 * findByTitleContaining 这种"方法名派生查询"会自动翻译成
 * title 上的 match 查询，不用写一行 DSL。
 */
public interface ArticleRepository extends ElasticsearchRepository<Article, String> {

    // 按标题模糊搜，返回分页结果
    Page<Article> findByTitleContaining(String keyword, Pageable pageable);
}
```

**③ Controller：存 + 搜**

`src/main/java/com/example/es/controller/ArticleController.java`：

```java
package com.example.es.controller;

import com.example.es.domain.Article;
import com.example.es.repository.ArticleRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 文章演示接口：写入一条 + 按关键词搜索。
 */
@RestController
@RequestMapping("/api/articles")
public class ArticleController {

    private final ArticleRepository articleRepository;

    public ArticleController(ArticleRepository articleRepository) {
        this.articleRepository = articleRepository;
    }

    /**
     * 存一条：POST /api/articles
     * body: {"id":"1","title":"Elasticsearch 入门","content":"倒排索引是核心","author":"张三"}
     */
    @PostMapping
    public String save(@RequestBody Article article) {
        // save 方法：有 id 就更新，没 id 就新增（底层走 index API）
        articleRepository.save(article);
        return "saved: " + article.getId();
    }

    /**
     * 搜出来：GET /api/articles/search?keyword=elasticsearch
     */
    @GetMapping("/search")
    public List<Article> search(@RequestParam String keyword) {
        // 调我们定义的派生查询方法，取第一页前 10 条
        Page<Article> page = articleRepository.findByTitleContaining(
                keyword, PageRequest.of(0, 10));
        return page.getContent();
    }
}
```

**④ 启动并验证**

先确保 8.1 建的 `blog_articles` 索引还在（或者让应用启动时自动建——Spring Data 默认会按 `@Document` 自动创建索引和 mapping，但建议先手动建好便于控制）。然后：

```bash
# 1) 存一条
curl -X POST "http://localhost:8080/api/articles" \
  -H "Content-Type: application/json" \
  -d '{"id":"1","title":"Elasticsearch 入门","content":"倒排索引是核心","author":"张三"}'

# 2) 搜出来
curl -X GET "http://localhost:8080/api/articles/search?keyword=elasticsearch"
```

返回：

```json
[
  {
    "id": "1",
    "title": "Elasticsearch 入门",
    "content": "倒排索引是核心",
    "author": "张三"
  }
]
```

::: tip 闭环完成 🎉
你刚刚用 Spring Boot 完成了「写一条 JSON → ES 建好倒排索引 → 按词搜回来」。这就是 ES 最小可用的全部骨架。后面每一章都是在给它加肌肉：更精细的 mapping、更丰富的查询、聚合、高亮、批量、向量检索……
:::

## 本篇小结

- **ES 是"按词查文档"的搜索/分析引擎**，像书后那张按词查页码的索引表；MySQL 是"按行取数据"的权威库。两者互补，不是替代。
- **本地环境用 Docker 起 ES + Kibana**：单节点 + 关安全 + 设 `ES_JAVA_OPTS` + 持久化卷。9200 是 REST 端口，9300 是节点间通信。
- **Linux 起不来先看 `vm.max_map_count` 和内存**；容器反复重启基本是内存/端口问题。
- **本地和阿里云只差连接配置**（uris/username/password/pathPrefix），业务代码不动。
- **Kibana Dev Tools Console 是写 DSL 的主战场**：`方法 路径` + 空行 + body，快捷键 `Cmd/Ctrl+Enter` 运行。
- **Spring Boot 脚手架核心**：父 POM 3.5.5 + `spring-boot-starter-data-elasticsearch` + 用 **`elasticsearch-client.version`** 把客户端锁到 8.18.x（注意属性名，不是 `elasticsearch.version`）。
- 完成"存一条 → 搜出来"最小闭环，环境彻底打通。

## 参考链接

- Elasticsearch 官方文档：<https://www.elastic.co/docs>
- Elasticsearch 参考（REST API）：<https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html>
- Elasticsearch Docker 部署：<https://www.elastic.co/docs/deploy-manage/deploy/elastic-cloud/elasticsearch-options>
- Spring Boot 官方文档（NoSQL / Elasticsearch）：<https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.elasticsearch>
- Spring Boot 依赖版本属性表：<https://docs.spring.io/spring-boot/appendix/dependency-versions/properties.html>
- 阿里云 Elasticsearch：<https://www.aliyun.com/product/elasticsearch>

下一篇 → [02 核心概念与倒排索引](/java/middleware/es/core)
