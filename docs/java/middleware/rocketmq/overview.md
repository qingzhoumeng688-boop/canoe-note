# 01 入门与整体架构

> 本篇解决三件事：**RocketMQ 是什么、它由哪些零件组成、一条消息从发到收走过了哪些路**。读完你应该能自己画出 RocketMQ 的架构图，说清楚四大角色（NameServer / Broker / Producer / Consumer）各自干什么，并且在本机跑通第一个"发送 + 接收"的程序。

::: tip 本专栏版本基线
RocketMQ **5.3.4**（5.3 系列为长期支持分支，5.5.1 为当前最新）。示例 JDK 17 + Maven，Docker 镜像 `apache/rocketmq:5.3.4`。不同 5.x 小版本配置项略有差异，遇到对不上的地方请以官方文档为准。
:::

## 本篇要解决的问题

- 我听说 RocketMQ 很牛，但它和 RabbitMQ、Kafka 到底该怎么选？
- NameServer、Broker、Topic、Queue、Consumer Group……这一堆名词到底谁是谁？
- 为什么同一个消费组里多起几个消费者就能提速？多起太多为什么没用？
- "集群消费"和"广播消费"有什么区别，我该用哪个？
- 能不能先跑个最简单的例子找到点成就感？

## 一、RocketMQ 是什么

先说出身：**阿里巴巴内部自研（前身 MetaQ），2016 年捐给 Apache，2017 年成为 Apache 顶级项目**。它最响亮的招牌是——**扛过了天猫双十一的万亿级消息洪峰**。

官方文档的定位是：一个**低延迟、高并发、高可用、高可靠、可伸缩**的分布式消息中间件。这几个词拆开看：

| 特性 | 意味着什么 | 怎么实现的（后面章节展开） |
| --- | --- | --- |
| 低延迟 | 毫秒级投递 | Broker 侧顺序写盘 + mmap 零拷贝 |
| 高并发 | 单机十万级 TPS | Topic 分多个 MessageQueue，天然并行 |
| 高可用 | 机器挂了不丢消息 | Master/Slave + 同步/异步复制 + Dledger 自动切主 |
| 高可靠 | 消息不会莫名其妙消失 | 同步刷盘 + 消费确认 + 重试 + 死信 |
| 可伸缩 | 扛不住就加机器 | Broker 集群 + 队列数可扩 |

::: warning 一个常见误解
RocketMQ 的"单机十万级 TPS"不是吹的，但**前提是 Topic 有足够多的队列、磁盘是 SSD、刷盘策略合理**。你要是拿机械硬盘 + 同步刷盘，能跑到一两万就不错了。性能永远是配置换来的。
:::

### 一句话记住它的特点

**Java 写的、国产、功能最全**。RabbitMQ 强在灵活路由和低延迟，Kafka 强在大数据生态，而 RocketMQ 强在**为业务场景准备的那些"高级功能"**——事务消息、定时消息、消息过滤、消息回溯、消息轨迹。这些功能在 Kafka 里基本没有，在 RabbitMQ 里要靠插件或自己拼。

## 二、整体架构：一张图看懂四个角色

先上图，再逐个解释：

```text
                       ┌─────────────────────────────────┐
                       │      NameServer 集群（无状态）     │
                       │   类比：114 查号台 / DNS 服务器    │
                       │  节点之间互相不通信，各存一份路由表  │
                       └─────────────────────────────────┘
                          ▲ 注册路由            ▲ 注册路由
                          │ (Broker 每30s心跳)   │
                          │                     │
    ┌──────────────┐      │                     │      ┌──────────────┐
    │  Producer    │──────┼── 拉取路由 ──────────┼──────│   Consumer   │
    │  (生产者)     │      │                     │      │   (消费者)    │
    └──────────────┘      │                     │      └──────────────┘
           │              ▼                     ▼              ▲
           │      ┌──────────────────────────────────────┐      │
           └─────▶│           Broker 集群                 │──────┘
       发消息      │  ┌─────────┐        ┌─────────┐      │  拉消息
                  │  │ Broker-A│        │ Broker-B│      │
                  │  │ Master  │◀──同步──│ Slave   │      │
                  │  └─────────┘        └─────────┘      │
                  │  真正存消息、收发消息的地方             │
                  └──────────────────────────────────────┘
```

### 角色一：NameServer（路由注册中心）

**一句话：它就是个"查号台"。**

Producer 想给某个 Topic 发消息，但它不知道这个 Topic 在哪台 Broker 上；Consumer 想消费也不知道去哪拉。NameServer 就是那个告诉它们"你要找的 Topic 在哪台机器上"的角色。

它有三个非常鲜明的特点，也是面试高频：

| 特点 | 说明 | 为什么这么设计 |
| --- | --- | --- |
| **无状态** | 不持久化任何数据，路由信息全在内存里 | 重启即丢失，但反正 Broker 会重新注册 |
| **节点间互不通信** | 多台 NameServer 之间没有任何同步 | 简单粗暴，代价是路由表可能短暂不一致 |
| **Broker 向所有 NameServer 注册** | 每台 Broker 启动后向集群里每个 NameServer 发心跳（默认 30s 一次） | 保证任何一台 NameServer 都有完整路由 |

::: tip NameServer 挂了会怎样？
**已建立的连接不受影响**——客户端本地缓存了路由表，还能继续收发。只是**新 Topic 发现不了、Broker 上下线感知不到**。所以生产上一般部署 2~3 台 NameServer 做高可用，客户端地址写成 `ns1:9876;ns2:9876`。

这也是为什么 RocketMQ 早期敢**不用 Zookeeper**：Zookeeper 提供强一致（CP），但重、维护成本高；而路由信息这种数据**允许短暂不一致**——客户端拿到的路由稍微旧一点，无非是重试一次而已，犯不上为它引入一个重型协调组件。
:::

### 角色二：Broker（消息服务器）

**一句话：真正干活、存消息的那台机器。**

- 接收 Producer 发来的消息 → 落盘 → 等 Consumer 来拉
- 处理 Consumer 的拉取请求、记录消费进度（Offset）
- 负责消息查询、定时消息扫描、事务消息回查、消息过滤……

Broker 有两个重要标识：

| 概念 | 含义 |
| --- | --- |
| `brokerName` | 一组 Broker 的"姓"。比如 `broker-a`，它的主从都叫这个名字 |
| `brokerId` | **0 表示 Master，非 0（1、2、3…）表示 Slave** |
| `brokerRole` | `ASYNC_MASTER`（异步复制主）、`SYNC_MASTER`（同步双写主）、`SLAVE`（从） |

也就是说：**同一个 `brokerName` 下，`brokerId=0` 那台是主，其余是从**。这也解释了为什么 Broker 配置文件里 `brokerId=0` 是默认值。

### 角色三：Producer（生产者）

发消息的一方。它启动时会：

1. 从 NameServer 拉取目标 Topic 的路由信息（这个 Topic 有几个队列、分别在哪些 Broker 上）
2. 本地缓存路由表，并定期更新（默认 30s）
3. 发消息时按策略挑一个队列（默认轮询），直连那台 Broker 发送

::: warning 生产者是"直连 Broker"的
很多同学以为消息是"发给 NameServer 再由它转发"——**不是的**。NameServer 只在你启动和定期更新时告诉你路在哪，真正发消息是 Producer 直接和 Broker 建立长连接。这也是为什么 NameServer 挂了短时间内不影响收发。
:::

### 角色四：Consumer（消费者）

消费消息的一方。流程类似：拉路由 → 知道该去哪几台 Broker 拉 → 建立连接 → 拉消息 → 处理 → 上报消费进度（Offset）。

## 三、三大 MQ 选型对比

这是面试和实际选型都会问的问题，别背数字，理解背后的取舍：

| 维度 | RabbitMQ | **RocketMQ** | Kafka |
| --- | --- | --- | --- |
| 开发语言 | Erlang | **Java** | Scala / Java |
| 单机吞吐 | 万级 | **十万级** | 十万~百万级 |
| 时效性 | **微秒~毫秒（最低）** | 毫秒 | 毫秒 |
| 协议 | AMQP（多语言友好） | 自定义 Remoting（5.x 新增 gRPC） | 自定义 TCP |
| 事务消息 | ❌ 需自己做 | ✅ **原生支持** | ✅（较弱） |
| 定时/延时消息 | 需插件 | ✅ **原生支持**（4.x 18 个等级，5.x 任意时间） | ❌ |
| 消息过滤 | 交换机路由 | ✅ **Tag / SQL92** | ❌（按分区读） |
| 消息回溯 | ❌ | ✅ **按时间点重置 Offset** | ✅ |
| 消息轨迹 | 需插件 | ✅ **原生支持** | 需外部 |
| 死信队列 | ✅ | ✅ | ❌ |
| 大数据生态 | 弱 | 中 | ✅ **最强** |
| 运维复杂度 | 中 | 中 | 高 |
| 社区 | 国外活跃 | **国内最活跃** | 国外活跃 |

### 选型结论（直接抄作业）

| 你的场景 | 选谁 | 理由 |
| --- | --- | --- |
| 中小型业务，需要灵活路由、极低延迟、多语言 | **RabbitMQ** | 交换机模型灵活，管理界面好用 |
| 国内电商 / 金融 / 大额流量，需要**事务消息、定时消息、消息轨迹** | **RocketMQ** | 这些能力是原生的，中文资料多 |
| 日志采集、埋点上报、实时流计算、接 Flink/Spark | **Kafka** | 生态无可替代，吞吐最高 |
| 只是想解耦、流量很小 | 别引 MQ，用线程池 + 本地队列可能更简单 | 引入中间件是有成本的 |

::: danger 不要为了用 MQ 而用 MQ
引入 MQ 会带来：系统可用性下降（MQ 挂了整条链路断）、复杂度上升（重复消费、丢失、顺序、一致性全要处理）、排障变难。**如果 QPS 只有几十、业务也不要求异步，直接同步调用完事。**
:::

## 四、核心概念逐个讲

刚接触 RocketMQ 的同学最容易被这些名词绕晕，这里一次讲清：

| 概念 | 大白话 | 技术定义 | 类比 |
| --- | --- | --- | --- |
| **Topic** | 消息的一级分类 | 生产者发送、消费者订阅的逻辑主题 | 数据库的表名 |
| **Tag** | 二级分类，用来过滤 | 消息上的标签，消费时可只订阅某几个 tag | 邮件上的标签 |
| **Queue / MessageQueue** | Topic 被切成的小块 | **负载均衡和并行的最小单位**，一个 Topic 默认 4 个读队列 + 4 个写队列 | 表的分区 |
| **Producer Group** | 一类生产者的名字 | 同一类生产者的集合（事务消息回查靠它找人） | 部门名 |
| **Consumer Group** | 一类消费者的名字 | **负载均衡的单位**：同组内的消费者分摊消费 | 班组名 |
| **Offset** | 消费到哪了 | 每个队列上的消费进度（一个递增的数字） | 书签 |
| **NameServer Address** | 查号台地址 | `host:port`，多个用 `;` 分隔 | DNS 地址 |
| **CommitLog** | 消息本体存哪 | 所有消息顺序写入的物理文件（1G 一个） | 仓库货架 |
| **ConsumeQueue** | 消息的目录 | CommitLog 的索引，定长 20 字节/条 | 商品目录卡 |
| **IndexFile** | 按 key 查消息的索引 | 支持按 Message Key 查询 | 书的索引页 |

::: tip Topic 是逻辑概念，Queue 才是物理概念
这句话很重要：**消息实际存在 Queue 里，Topic 只是把这些 Queue 归了个组**。一台 Broker 上可以放多个 Topic 的多个 Queue。理解了这点，后面"消费者数量 > 队列数时多出来的消费者会闲着"就好懂了。
:::

## 五、消息模型：集群消费 vs 广播消费

### 一张图看懂分流

假设 Topic `order_topic` 有 4 个队列，分布在 2 台 Broker 上：

```text
                    Topic: order_topic
        ┌──────────┬──────────┬──────────┬──────────┐
        │  Queue-0 │  Queue-1 │  Queue-2 │  Queue-3 │
        │ Broker-A │ Broker-A │ Broker-B │ Broker-B │
        └──────────┴──────────┴──────────┴──────────┘
             │          │          │          │
   ────────────────────────────────────────────────────
   集群消费（默认）：Consumer Group 里有 2 个消费者
             │          │          │          │
        ┌────┴──────────┘          └────┬─────┘
        ▼                               ▼
   Consumer-1                      Consumer-2
   （负责 Q0、Q1）                  （负责 Q2、Q3）
   → 每条消息只被消费一次

   ────────────────────────────────────────────────────
   广播消费：Consumer Group 里有 2 个消费者
        ▼                               ▼
   Consumer-1                      Consumer-2
   （消费全部 4 个队列）             （也消费全部 4 个队列）
   → 每条消息被每个消费者各消费一次
```

### 两者对比

| 对比项 | 集群消费 CLUSTERING（默认） | 广播消费 BROADCASTING |
| --- | --- | --- |
| 一条消息被消费几次 | **1 次**（组内某个消费者处理） | **N 次**（组内每个消费者都收全量） |
| 消费进度存哪 | **Broker 端**（`%RETRY%`、Offset 集中管理） | **消费者本地文件**（`~/.rocketmq_offsets`） |
| 消费者数量 > 队列数 | **多出来的闲着，不消费任何队列** | 无所谓，大家都是全量 |
| 支持重试 / 死信 | ✅ 支持 | ❌ 不支持（消费失败就丢了） |
| 典型场景 | 订单处理、扣库存、发券 | **本地缓存刷新、配置推送**（每台机器都要知道） |
| 进度可靠性 | 高（集中存储，重启不丢） | 低（本地文件，机器重置就没了） |

::: warning 集群消费的核心限制：消费者数 ≤ 队列数
这是个**必考题**。一个队列在同一时刻只能被同一个消费组里的**一个**消费者消费（否则进度没法记）。所以如果你开了 4 个队列却起了 8 个消费者实例，**多出来的 4 个会一直空转、啥也不干**。

想提高消费能力有两种办法：
1. **加队列数**（推荐，Topic 建的时候就把 `writeQueueNums`/`readQueueNums` 设大一点，比如 8 或 16）
2. 加消费者实例，但不要超过队列数

**反过来**：队列数只能加不能减（减了会导致部分消息永远没人消费），所以建 Topic 时宁可多设几个。
:::

## 六、消费方式：Push 还是 Pull？

RocketMQ 提供了三个消费者类，最容易搞混：

| 类 | 本质 | 适用场景 | 状态 |
| --- | --- | --- | --- |
| `DefaultMQPushConsumer` | **底层还是 Pull**，只是封装了长轮询，让你感觉像 Broker 主动推 | 99% 的业务场景 | 主流 |
| `DefaultLitePullConsumer` | 真正的主动拉取，**自己控制 offset 和拉取节奏** | 需要精确控制消费位点、批量拉取 | 5.x 推荐 |
| `DefaultMQPullConsumer` | 老式拉取 API | — | **已废弃，别用** |

::: tip 说个很多人不知道的事
`DefaultMQPushConsumer` 名字里带 Push，但**它内部是一个长轮询的 Pull**：消费者线程不停地向 Broker 发拉取请求，Broker 如果没消息就挂起这个请求一小段时间（默认 15s，可配 `brokerSuspendMaxTimeMillis`），有消息了立刻返回。

好处是：既有 Push 的低延迟（消息一来马上拿到），又有 Pull 的可控性（消费者按自己能力拉，不会被压垮）。
:::

## 七、最小可跑示例：发送 + 接收

先把环境准备起来（详细的安装步骤在 **02 安装部署与控制台**，这里先给一个最快能跑的 Docker 命令）：

```bash
# 启动 NameServer
docker run -d --name rmqnamesrv -p 9876:9876 \
  -e JAVA_OPT_EXT="-Xms512m -Xmx512m" \
  apache/rocketmq:5.3.4 sh mqnamesrv

# 启动 Broker（注意 -n 后面是 NameServer 地址，容器间用宿主机 IP 或同一 docker network）
docker run -d --name rmqbroker -p 10911:10911 -p 10909:10909 \
  -e NAMESRV_ADDR="你的宿主机IP:9876" \
  -e JAVA_OPT_EXT="-Xms1g -Xmx1g" \
  apache/rocketmq:5.3.4 sh mqbroker -n 你的宿主机IP:9876 \
  -c /home/rocketmq/rocketmq-5.3.4/conf/broker.conf
```

### 完整 pom.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.canoe</groupId>
    <artifactId>rocketmq-demo</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>17</java.version>
        <!-- RocketMQ 客户端版本，建议与服务端大版本保持一致 -->
        <rocketmq.version>5.3.4</rocketmq.version>
    </properties>

    <dependencies>
        <!-- RocketMQ 原生 Java 客户端（Remoting 协议，连 9876/10911） -->
        <dependency>
            <groupId>org.apache.rocketmq</groupId>
            <artifactId>rocketmq-client</artifactId>
            <version>${rocketmq.version}</version>
        </dependency>

        <!-- 日志，避免运行时报 SLF4J 警告 -->
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-simple</artifactId>
            <version>2.0.16</version>
        </dependency>
    </dependencies>
</project>
```

### 生产者

```java
package com.canoe.rocketmq;

import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.client.producer.SendStatus;
import org.apache.rocketmq.common.message.Message;
import org.apache.rocketmq.remoting.common.RemotingHelper;

import java.nio.charset.StandardCharsets;

/**
 * 最小可跑的生产者：同步发送一条消息。
 */
public class SimpleProducer {

    public static void main(String[] args) throws Exception {
        // 1. 创建生产者实例，参数是"生产者组名"，同一类业务用同一个组名
        DefaultMQProducer producer = new DefaultMQProducer("simple_producer_group");

        // 2. 指定 NameServer 地址（多个用英文分号分隔）
        producer.setNamesrvAddr("127.0.0.1:9876");

        // 3. 启动生产者（内部会建连接、拉路由、起心跳线程），必须调用
        producer.start();

        try {
            for (int i = 0; i < 3; i++) {
                // 4. 构造消息：Message(topic, tags, keys, body)
                //    topic  ：一级分类，必须先存在（或 Broker 开了 autoCreateTopicEnable）
                //    tags   ：二级分类，消费端可以按 tag 过滤，一条消息只能有一个 tag
                //    keys   ：业务唯一标识（建议设为订单号等），后续可按 key 查消息
                //    body   ：消息体，字节数组，实际业务里一般是 JSON
                String body = "Hello RocketMQ " + i;
                Message msg = new Message(
                        "TopicTest",
                        "TagA",
                        "KEY_" + i,
                        body.getBytes(StandardCharsets.UTF_8)
                );

                // 5. 同步发送：阻塞等待 Broker 返回，拿到 SendResult
                SendResult sendResult = producer.send(msg);

                System.out.printf("第 %d 条：%s%n", i, sendResult);
            }
        } finally {
            // 6. 关闭生产者，释放连接和线程（不关的话 JVM 可能不退出）
            producer.shutdown();
        }
    }
}
```

### 消费者

```java
package com.canoe.rocketmq;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyContext;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.common.message.MessageExt;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 最小可跑的消费者：并发消费模式。
 */
public class SimpleConsumer {

    public static void main(String[] args) throws Exception {
        // 1. 创建推模式消费者，参数是"消费者组名"
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("simple_consumer_group");

        // 2. 指定 NameServer 地址
        consumer.setNamesrvAddr("127.0.0.1:9876");

        // 3. 订阅 Topic 和 Tag：
        //    "*"             表示订阅所有 tag
        //    "TagA"          表示只订阅 TagA
        //    "TagA || TagB"  表示订阅 TagA 或 TagB
        consumer.subscribe("TopicTest", "*");

        // 4. 设置消费起点（只在第一次启动、服务端没有该组进度时生效）
        //    CONSUME_FROM_LAST_OFFSET  ：从最新位置开始，历史消息不消费
        //    CONSUME_FROM_FIRST_OFFSET ：从最早位置开始，把历史消息全消费一遍
        consumer.setConsumeFromWhere(org.apache.rocketmq.common.consumer.ConsumeFromWhere.CONSUME_FROM_LAST_OFFSET);

        // 5. 注册并发消费监听器
        consumer.registerMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            // msgs 默认一次最多 1 条，可通过 consumeMessageBatchMaxSize 调大（默认 1）
            for (MessageExt msg : msgs) {
                String body = new String(msg.getBody(), StandardCharsets.UTF_8);
                System.out.printf("收到消息：topic=%s, tags=%s, keys=%s, queueId=%d, body=%s%n",
                        msg.getTopic(), msg.getTags(), msg.getKeys(), msg.getQueueId(), body);
            }
            // 返回 CONSUME_SUCCESS 表示消费成功，Broker 会推进 offset
            // 返回 RECONSUME_LATER 表示消费失败，稍后会重试（详见 06 章）
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        });

        // 6. 启动消费者
        consumer.start();
        System.out.println("消费者已启动，等待消息...");
    }
}
```

### 第一次跑可能遇到的问题

| 报错 | 原因 | 解决办法 |
| --- | --- | --- |
| `No route info of this topic: TopicTest` | Topic 不存在，且 Broker 没开自动创建 | 用 `mqadmin updateTopic` 创建，或启动时加 `autoCreateTopicEnable=true` |
| `connect to 172.17.0.2:10911 failed` | 容器里拿到的 Broker IP 是内网地址 | Broker 配置里显式指定 `brokerIP1=宿主机IP` |
| `MQClientException: The producer group has been created` | 同一个 JVM 里创建了两个同名 producer group | 组名要唯一 |
| 消费者收不到消息 | `ConsumeFromWhere` 只对**首次启动**生效 | 服务端已有进度的话，用 `mqadmin resetOffsetByTime` 重置 |

## 八、RocketMQ 的能力清单（本专栏目录预告）

| 能力 | 说明 | 在哪一篇 |
| --- | --- | --- |
| 普通消息 | 同步 / 异步 / 单向 / 批量发送 | 03、04 |
| 顺序消息 | 同一业务 key 的消息按顺序消费 | 04 |
| 定时 / 延时消息 | 4.x 的 18 个等级，5.x 支持任意时间 | 04 |
| 事务消息 | 半消息 + 本地事务 + 回查，保证最终一致 | 04、05 |
| 消息过滤 | Tag 过滤 + SQL92 表达式过滤 | 04 |
| 消息重试 | 消费失败自动进重试队列，按等级递增延迟 | 06 |
| 死信队列 | 重试超过次数进死信队列，人工介入 | 06 |
| 消息查询 | 按 MessageId / MessageKey 查 | 02 |
| 消息轨迹 | 一条消息从生产到消费的全链路追踪 | 02、05 |
| 消息回溯 | 按时间点重置消费位点，重新消费历史消息 | 02 |
| ACL 权限 | 生产/消费的账号鉴权 | 06 |
| 主从与集群 | Master/Slave、Dledger 自动切主、多副本 | 06 |

## 本篇小结

- **RocketMQ** 是阿里开源、Apache 顶级的分布式消息中间件，最大卖点是**事务消息、定时消息、消息过滤、消息回溯**这些为业务准备的高级能力。
- 架构四大角色：**NameServer（无状态查号台）** → **Broker（存消息、主从）** → **Producer（发消息）** → **Consumer（收消息）**。
- **NameServer 节点间互不通信**，Broker 向每台 NameServer 注册；NameServer 挂了短时间内不影响收发，只是新 Topic 发现不了。
- **Producer/Consumer 是直连 Broker 的**，NameServer 只提供路由，不转发消息。
- **Topic 是逻辑概念，Queue 才是物理单位**：一个 Topic 切成多个 MessageQueue 分布在各 Broker 上，这是高吞吐的来源。
- **集群消费**（默认）同一消费组内分摊消费，一条消息只消费一次，进度存 Broker；**广播消费**每台机器都收全量，进度存本地，不支持重试。
- **核心限制**：集群消费下**消费者实例数 ≤ 队列数**，多了会空转；队列数只能增不能减。
- `DefaultMQPushConsumer` **名字带 Push 实际是长轮询的 Pull**，兼顾低延迟和可控性。
- 选型：**要事务/定时/轨迹 → RocketMQ；要灵活路由 → RabbitMQ；要大数据生态 → Kafka**。
- `Message(topic, tags, keys, body)` 四个参数各有用途，尤其 **keys 建议设为业务唯一 ID**，否则后面查不到消息。

## 参考链接

- [Apache RocketMQ 官方网站](https://rocketmq.apache.org/)
- [RocketMQ 中文文档 - 快速开始](https://rocketmq.apache.org/zh/docs/quick-start/)
- [RocketMQ GitHub 仓库](https://github.com/apache/rocketmq)
- [RocketMQ 领域模型（官方概念说明）](https://rocketmq.apache.org/zh/docs/introduction/02concepts/)
- [RocketMQ 版本发布记录](https://rocketmq.apache.org/release-notes/)
- [RocketMQ Spring（Spring Boot 整合）](https://github.com/apache/rocketmq-spring)

下一篇 → [02 安装部署与控制台](/java/middleware/rocketmq/install)
