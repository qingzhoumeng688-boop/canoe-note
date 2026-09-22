# 03 生产者与消费者原生 API

> 本篇把 RocketMQ 原生 Java 客户端（`rocketmq-client`）的**生产端和消费端 API 一次性讲全**：三种发送方式的区别、`SendResult` 的四种状态分别意味着什么、`MessageQueueSelector` 怎么把同一业务的消息塞进同一个队列、集群消费和广播消费怎么配、并发消费和顺序消费的监听器怎么写、消费失败怎么重试。理解透这一篇，后面用 Spring Boot 封装时才知道"它到底在帮我干什么"。

## 本篇要解决的问题

- `send()`、`send(callback)`、`sendOneway()` 到底选哪个？
- `SendResult` 返回 `SEND_OK` 就万事大吉了吗？另外三种状态是什么情况？
- 我想让同一个订单的消息都进同一个队列，怎么做？
- 集群消费和广播消费代码上差一行，行为差多少？
- 消费失败了怎么让它重试？重试会不会把整个队列堵死？

## 一、Producer 全解

### 生产者的两个类

| 类 | 用途 |
| --- | --- |
| `DefaultMQProducer` | 发普通消息、顺序消息、延时消息、批量消息 |
| `TransactionMQProducer` | 发**事务消息**（继承 `DefaultMQProducer`，多一个 `TransactionListener`），详见 04 篇 |

### 三种发送方式

这是最常用的区分，先给结论表：

| 方式 | API | 特点 | 可靠性 | 吞吐 | 场景 |
| --- | --- | --- | --- | --- | --- |
| **同步发送** | `send(msg)` | 阻塞等 Broker 返回，拿到 `SendResult` | **最高**（有明确结果） | 低 | **订单、支付等核心业务** |
| **异步发送** | `send(msg, SendCallback)` | 不阻塞，结果在回调里 | 高（回调里有结果） | **高** | 日志、通知、对响应时间敏感 |
| **单向发送** | `sendOneway(msg)` | 发出去就不管了，**没有返回值** | **最低**（可能丢） | **最高** | 心跳、日志采集，丢了无所谓 |

```java
package com.canoe.rocketmq;

import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendCallback;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;
import org.apache.rocketmq.remoting.common.RemotingHelper;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 三种发送方式对比。
 */
public class SendWayDemo {

    public static void main(String[] args) throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("send_way_producer_group");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        // ---------- 1. 同步发送 ----------
        // 阻塞直到拿到结果，最可靠。核心业务用它。
        Message syncMsg = new Message("TopicTest", "TagA", "KEY_SYNC",
                "同步消息".getBytes(RemotingHelper.DEFAULT_CHARSET));
        SendResult syncResult = producer.send(syncMsg);
        System.out.println("同步发送结果：" + syncResult);

        // ---------- 2. 异步发送 ----------
        // 立刻返回，Broker 的响应在 SendCallback 回调里处理
        int msgCount = 3;
        CountDownLatch latch = new CountDownLatch(msgCount);
        for (int i = 0; i < msgCount; i++) {
            Message asyncMsg = new Message("TopicTest", "TagA", "KEY_ASYNC_" + i,
                    ("异步消息 " + i).getBytes(RemotingHelper.DEFAULT_CHARSET));

            producer.send(asyncMsg, new SendCallback() {
                @Override
                public void onSuccess(SendResult sendResult) {
                    System.out.println("异步发送成功：" + sendResult.getMsgId());
                    latch.countDown();
                }

                @Override
                public void onException(Throwable e) {
                    System.err.println("异步发送失败：" + e.getMessage());
                    // 实际业务里这里要做补偿：落库 + 定时重投
                    latch.countDown();
                }
            });
        }
        // 等所有回调执行完（示例用，真实业务不需要这样等）
        latch.await(5, TimeUnit.SECONDS);

        // ---------- 3. 单向发送 ----------
        // 发出去就完了，没有返回值也没有回调，可能丢，但最快
        for (int i = 0; i < 3; i++) {
            Message onewayMsg = new Message("TopicTest", "TagA", "KEY_ONEWAY_" + i,
                    ("单向消息 " + i).getBytes(RemotingHelper.DEFAULT_CHARSET));
            producer.sendOneway(onewayMsg);
        }
        System.out.println("单向消息已发出（不保证到达）");

        producer.shutdown();
    }
}
```

::: warning 异步发送别忘了处理 onException
很多同学异步发送只写 `onSuccess`，`onException` 里打个日志就完事。这样**消息丢了都不知道**。正确做法：在 `onException` 里把消息落库，用定时任务重投（思路和 RabbitMQ 篇的"消息落库 + 定时重投"一样）。
:::

### SendResult 与四种发送状态

`send()` 返回的 `SendResult` 长这样：

```text
SendResult [sendStatus=SEND_OK, msgId=0A0B0C0D...,
            offsetMsgId=AC11000100002A9F00000000000003E8,
            messageQueue=MessageQueue [topic=TopicTest, brokerName=broker-a, queueId=2],
            queueOffset=42]
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `sendStatus` | 发送状态，见下表 |
| `msgId` | **客户端生成的** ID |
| `offsetMsgId` | **Broker 生成的** ID（含 Broker 地址和物理偏移量），查消息时一般用这个 |
| `messageQueue` | 这条消息落在了哪个 Broker 的哪个队列 |
| `queueOffset` | 在这个队列里的逻辑偏移量 |

**四种 `SendStatus`（面试常问）**：

| 状态 | 含义 | 消息丢了吗 | 生产怎么办 |
| --- | --- | --- | --- |
| `SEND_OK` | 发送成功 | 没丢 | 不用管 |
| `FLUSH_DISK_TIMEOUT` | **刷盘超时**（只在 `SYNC_FLUSH` 下才可能出现） | **可能丢**（Broker 挂了就没了） | 告警 + 记录，必要时重发 |
| `FLUSH_SLAVE_TIMEOUT` | **主从同步超时**（只在 `SYNC_MASTER` 下才可能出现） | 主挂了可能丢 | 告警 + 检查从节点 |
| `SLAVE_NOT_AVAILABLE` | **没有可用的 Slave** | 主挂了可能丢 | 检查从节点是否存活 |

::: danger 关键认知：SEND_OK ≠ 消息一定不丢
`SEND_OK` 只说明"Broker 成功接收并写入了"。如果 Broker 配的是 `ASYNC_FLUSH`（异步刷盘，默认），消息还在 PageCache 里，**这时候 Broker 宕机且没来得及刷盘，消息还是会丢**。

要做到真正不丢，需要：`SYNC_FLUSH`（同步刷盘）或 `SYNC_MASTER` + Slave —— 但这是拿性能换的。**绝大多数业务用异步刷盘 + 主从 + 生产侧重试就够了**，因为 Broker 整体宕机的概率很低。
:::

### 发送失败重试

RocketMQ 客户端自带重试，不用你写：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `retryTimesWhenSendFailed` | 2 | **同步发送**失败重试次数（不含第一次，总共尝试 3 次） |
| `retryTimesWhenSendAsyncFailed` | 2 | **异步发送**失败重试次数 |
| `retryAnotherBrokerWhenNotStoreOK` | false | 返回非 `SEND_OK` 时，是否换一个 Broker 重试 |
| `sendMsgTimeout` | 3000(ms) | 发送超时时间 |

```java
DefaultMQProducer producer = new DefaultMQProducer("group");
producer.setRetryTimesWhenSendFailed(3);            // 同步失败重试 3 次
producer.setRetryTimesWhenSendAsyncFailed(3);       // 异步失败重试 3 次
producer.setSendMsgTimeout(5000);                   // 超时 5 秒
producer.setRetryAnotherBrokerWhenNotStoreOK(true); // 没落库就换个 Broker 再试
```

::: warning 重试导致的问题：消息重复
客户端重试、网络抖动导致的"发了但没收到响应"，都会造成**同一条消息被写了两次**。RocketMQ 不会帮你去重——**消费端必须做幂等**。这是贯穿整个 MQ 使用的铁律。
:::

### MessageQueueSelector：把同一业务的消息发到同一个队列

这是实现**顺序消息**的基础（04 篇展开），但单独理解它也有用——比如你想让同一个用户的消息都落在一个队列上，方便后续按用户维度处理。

```java
package com.canoe.rocketmq;

import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.MessageQueueSelector;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;
import org.apache.rocketmq.common.message.MessageQueue;
import org.apache.rocketmq.remoting.common.RemotingHelper;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * MessageQueueSelector 两种实现：取模 和 hash。
 */
public class SelectorDemo {

    public static void main(String[] args) throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("selector_producer_group");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        String[] orderIds = {"ORDER_1", "ORDER_2", "ORDER_3", "ORDER_4", "ORDER_5"};

        for (String orderId : orderIds) {
            Message msg = new Message("OrderTopic", "TagA", orderId,
                    ("订单 " + orderId + " 创建").getBytes(RemotingHelper.DEFAULT_CHARSET));

            // 方式一：取模（最直观）
            SendResult result = producer.send(msg, new MessageQueueSelector() {
                /**
                 * @param mqs  该 Topic 下所有可选的队列
                 * @param msg  要发送的消息
                 * @param arg  send 方法透传进来的参数（这里传的是订单号）
                 * @return 选中的那个队列
                 */
                @Override
                public MessageQueue select(List<MessageQueue> mqs, Message msg, Object arg) {
                    String id = (String) arg;
                    // 用订单号的 hashCode 取绝对值再取模，保证同一个订单永远落到同一个队列
                    int index = Math.abs(id.hashCode()) % mqs.size();
                    return mqs.get(index);
                }
            }, orderId);

            System.out.printf("订单 %s → 队列 %d%n",
                    orderId, result.getMessageQueue().getQueueId());
        }

        producer.shutdown();
    }
}
```

**方式二：用官方自带的 hash 选择器**（省事）：

```java
// org.apache.rocketmq.client.producer.selector.SelectMessageQueueByHash
import org.apache.rocketmq.client.producer.selector.SelectMessageQueueByHash;

// 直接用，内部就是按 arg 的 hashCode 取模
SendResult result = producer.send(msg, new SelectMessageQueueByHash(), orderId);
```

还有个随机选择器 `SelectMessageQueueByRandom`，一般不用（默认轮询就是这个效果）。

### 生产者的生命周期与线程安全

::: tip 必须记住的两条
1. **`DefaultMQProducer` 是线程安全的**，一个应用里**一个业务类型建一个实例**就够了，全程复用。**千万不要每条消息 `new` 一个 Producer** —— 那样每次都要建连接、拉路由，性能灾难，还会耗尽端口。
2. **应用关闭时要调 `shutdown()`**，否则连接和后台线程不释放。Spring Boot 里用 `@PreDestroy` 或实现 `DisposableBean`。
:::

Spring Boot 里推荐这样管理：

```java
package com.canoe.rocketmq.config;

import jakarta.annotation.PreDestroy;
import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 把 DefaultMQProducer 交给 Spring 容器管理，全程单例复用。
 * 这个做法在"rocketmq-spring-boot-starter 版本和 Spring Boot 对不上"时特别有用（退路方案）。
 */
@Configuration
public class RocketMQProducerConfig {

    @Value("${rocketmq.name-server:127.0.0.1:9876}")
    private String nameServer;

    @Value("${rocketmq.producer.group:canoe_producer_group}")
    private String producerGroup;

    private DefaultMQProducer producer;

    @Bean(destroyMethod = "shutdown")
    public DefaultMQProducer defaultMQProducer() throws MQClientException {
        producer = new DefaultMQProducer(producerGroup);
        producer.setNamesrvAddr(nameServer);
        producer.setRetryTimesWhenSendFailed(3);
        producer.setSendMsgTimeout(5000);
        // 关闭 VIP 通道（有些环境只开了 10911，没开 10909）
        producer.setVipChannelEnabled(false);
        producer.start();
        return producer;
    }

    @PreDestroy
    public void destroy() {
        if (producer != null) {
            producer.shutdown();
        }
    }
}
```

## 二、消息结构：Message 的四个参数

```java
new Message(String topic, String tags, String keys, byte[] body)
```

| 参数 | 作用 | 建议 |
| --- | --- | --- |
| `topic` | 一级分类 | 按业务域命名，如 `TRADE_ORDER_TOPIC` |
| `tags` | 二级分类，消费端过滤用 | **一条消息只能有一个 tag**，如 `CREATE`、`PAY`、`CANCEL` |
| `keys` | 业务唯一标识 | **强烈建议设为订单号/流水号**，否则后期查不到消息 |
| `body` | 消息体字节数组 | 一般放 JSON 字符串；**不要超过 4MB**（`maxMessageSize`） |

### 自定义属性 putUserProperty

Tag 只能有一个，如果需要**多维度过滤**，就用 `putUserProperty` 配合 **SQL92 过滤**（04 篇讲）：

```java
Message msg = new Message("OrderTopic", "TagA", "ORDER_10086",
        "{\"orderId\":\"10086\"}".getBytes(StandardCharsets.UTF_8));

// 放自定义属性，消费端可以用 SQL 表达式过滤：amount > 100 AND region = 'SH'
msg.putUserProperty("amount", "299");
msg.putUserProperty("region", "SH");
msg.putUserProperty("vipLevel", "3");
```

::: warning `putUserProperty` 的坑
系统保留的属性名不能用作 key，比如：
- `DELAY`（延时等级）
- `UNIQ_KEY`（唯一键）
- `TRANSACTION_ID`（事务 ID）
- `MIN_OFFSET` / `MAX_OFFSET` / `RETRY_TOPIC`…

用了会被覆盖或导致行为异常。自定义属性建议加个前缀，比如 `biz_amount`。
:::

### 消息的属性 vs 消息体怎么选？

| 放哪 | 好处 | 坏处 |
| --- | --- | --- |
| 放 `putUserProperty` | **Broker 端就能过滤**，减少无效网络传输 | 有大小限制；过滤逻辑写在 SQL 里不好维护 |
| 放 body 里（JSON 字段） | 灵活，随便加字段 | 只能拉到消费端再判断，浪费带宽 |

**建议**：过滤维度固定、区分度高的放 property（如地区、等级）；其余放 body。

## 三、Consumer 全解

### 三个消费者类

| 类 | 特点 | 状态 |
| --- | --- | --- |
| `DefaultMQPushConsumer` | 长轮询封装，用起来像推送，最常用 | **主流** |
| `DefaultLitePullConsumer` | 主动拉取，**自己控制 offset 和拉取节奏** | 5.x 推荐用于需要精确控制的场景 |
| `DefaultMQPullConsumer` | 老 API | **已废弃** |

### 集群消费 vs 广播消费

```java
// 集群消费（默认）：同组消费者分摊，一条消息只消费一次
consumer.setMessageModel(MessageModel.CLUSTERING);

// 广播消费：同组每个消费者都收到全量消息
consumer.setMessageModel(MessageModel.BROADCASTING);
```

| 对比 | CLUSTERING（默认） | BROADCASTING |
| --- | --- | --- |
| 一条消息消费几次 | 1 次 | 每个消费者各 1 次 |
| 进度存哪 | Broker | 消费者本地文件 |
| 重试 | ✅ | ❌ |
| 消费者数 > 队列数 | 多余的空转 | 无所谓 |
| 典型场景 | 订单、扣库存 | **本地缓存刷新、配置推送** |

::: tip 广播消费的典型用法：刷新本地缓存
一个配置变更了，希望**集群里每一台机器**都刷新自己的本地缓存（Caffeine/Guava）。这时候用广播消费，每台机器都收到消息，各自清缓存。
:::

### 并发消费：MessageListenerConcurrently

**不保证顺序**，吞吐最高，99% 场景用它。

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
 * 并发消费：不保证顺序，吞吐最高。
 */
public class ConcurrentConsumer {

    public static void main(String[] args) throws Exception {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("concurrent_consumer_group");
        consumer.setNamesrvAddr("127.0.0.1:9876");

        // 订阅 Topic 和 Tag："*" 全部；"TagA || TagB" 表示 TagA 或 TagB
        consumer.subscribe("TopicTest", "TagA || TagB");

        // 一次最多消费多少条（默认 1）。业务能批量处理的话调大能提吞吐
        consumer.setConsumeMessageBatchMaxSize(1);
        // 消费线程数（默认 20），很关键
        consumer.setConsumeThreadMin(20);
        consumer.setConsumeThreadMax(64);

        consumer.registerMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            for (MessageExt msg : msgs) {
                String body = new String(msg.getBody(), StandardCharsets.UTF_8);
                // 重试次数：0 表示第一次消费，>0 表示是被重试投递过来的
                int reconsumeTimes = msg.getReconsumeTimes();

                System.out.printf("收到：body=%s, queueId=%d, 第 %d 次消费%n",
                        body, msg.getQueueId(), reconsumeTimes + 1);

                try {
                    // ========== 业务处理 ==========
                    doBiz(body);
                    // ============================
                } catch (Exception e) {
                    System.err.println("消费失败：" + e.getMessage());

                    // 重试 3 次还失败就放弃（记录日志/进死信），避免无限重试堵住队列
                    if (reconsumeTimes >= 3) {
                        // 实际生产：存到一张失败表，人工介入或定时补偿
                        System.err.println("重试 3 次仍失败，转人工处理：" + msg.getKeys());
                        return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
                    }
                    // 返回 RECONSUME_LATER：消息会被投递到重试队列，稍后再来
                    return ConsumeConcurrentlyStatus.RECONSUME_LATER;
                }
            }
            // 全部成功，Broker 推进 offset
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        });

        consumer.start();
        System.out.println("并发消费者已启动");
    }

    private static void doBiz(String body) {
        // 模拟业务逻辑
    }
}
```

**两个返回值的含义**：

| 返回值 | 含义 |
| --- | --- |
| `CONSUME_SUCCESS` | 消费成功，Broker 推进 offset，消息不会再投 |
| `RECONSUME_LATER` | 消费失败，消息进**重试队列**，按延迟等级递增间隔后重新投递 |

::: danger 无限重试会堵死队列
如果业务一直失败又一直返回 `RECONSUME_LATER`，消息会**无限重试**（直到 16 次才进死信队列），在重试期间**同一个队列后面的消息都被堵住**（顺序消费下尤其明显）。

生产上的正确做法：
1. 判断 `reconsumeTimes`，超过 N 次就记录并**返回 CONSUME_SUCCESS** 放行，转人工/补偿表
2. 或者区分错误类型：可重试的（网络抖动）返回 `RECONSUME_LATER`，不可重试的（参数错误、数据不存在）直接返回 `CONSUME_SUCCESS` 并记录
:::

### 顺序消费：MessageListenerOrderly

**保证同一个队列内按顺序消费**。完整顺序消息方案见 04 篇，这里先讲监听器本身。

```java
package com.canoe.rocketmq;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeOrderlyContext;
import org.apache.rocketmq.client.consumer.listener.ConsumeOrderlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerOrderly;
import org.apache.rocketmq.common.message.MessageExt;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 顺序消费：同一个队列内串行处理，保证顺序。
 */
public class OrderlyConsumer {

    public static void main(String[] args) throws Exception {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("orderly_consumer_group");
        consumer.setNamesrvAddr("127.0.0.1:9876");
        consumer.subscribe("OrderTopic", "*");

        // 顺序消费的线程数一般不用太大，因为一个队列同时只能被一个线程消费
        consumer.setConsumeThreadMin(4);
        consumer.setConsumeThreadMax(8);

        consumer.registerMessageListener((MessageListenerOrderly) (msgs, context) -> {
            // context 可以拿到当前消费的队列信息
            // context.getMessageQueue()  → 当前队列
            // context.setSuspendCurrentQueueTimeMillis(3000) → 失败时挂起多久再试

            for (MessageExt msg : msgs) {
                String body = new String(msg.getBody(), StandardCharsets.UTF_8);
                System.out.printf("顺序消费：queueId=%d, body=%s%n", msg.getQueueId(), body);
            }

            // SUCCESS              ：成功
            // SUSPEND_CURRENT_QUEUE_A_MOMENT：稍后重试（不会跳过当前消息）
            return ConsumeOrderlyStatus.SUCCESS;
        });

        consumer.start();
        System.out.println("顺序消费者已启动");
    }
}
```

`MessageListenerOrderly` 内部有三把锁保证顺序：

1. **Broker 端队列锁**：向 Broker 申请该队列的锁，保证同一队列只被一个消费者消费
2. **本地 MessageQueueLock**：保证同一队列的消息在客户端内串行处理
3. **消费任务锁**：保证处理过程不并发

代价：**一个队列同时只能有一个线程在消费**，吞吐大幅下降。

### 消费起点 ConsumeFromWhere

```java
consumer.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_LAST_OFFSET);
```

| 值 | 含义 |
| --- | --- |
| `CONSUME_FROM_LAST_OFFSET` | 从最新位置开始，**历史消息不消费**（默认行为） |
| `CONSUME_FROM_FIRST_OFFSET` | 从最早位置开始，把历史消息全消费一遍 |
| `CONSUME_FROM_TIMESTAMP` | 从指定时间点开始，需配合 `setConsumeTimestamp("20260921210000")` |

::: warning 这个参数什么时候才生效
**只有"服务端没有这个消费组的进度记录"时才生效**（即这个消费组第一次上线）。

如果消费组已经消费过一段时间，Broker 里存着 offset，那你改这个参数**没用**。想重新消费历史消息要么换一个消费组名，要么用 `mqadmin resetOffsetByTime` 重置位点。
:::

### 消费进度存在哪（OffsetStore）

| 消费模式 | OffsetStore | 存哪 |
| --- | --- | --- |
| 集群消费 | `RemoteBrokerOffsetStore` | **Broker 端** |
| 广播消费 | `LocalFileOffsetStore` | **消费者本地文件** `~/.rocketmq_offsets` |

一般不用手动设置，`setMessageModel()` 时客户端会自动选。

### DefaultLitePullConsumer：主动拉取

需要**自己控制消费节奏、批量拉取、精确控制 offset** 时用：

```java
package com.canoe.rocketmq;

import org.apache.rocketmq.client.consumer.DefaultLitePullConsumer;
import org.apache.rocketmq.common.message.MessageExt;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * LitePullConsumer：主动拉取，自己控制节奏。
 */
public class LitePullConsumerDemo {

    public static void main(String[] args) throws Exception {
        DefaultLitePullConsumer consumer = new DefaultLitePullConsumer("lite_pull_group");
        consumer.setNamesrvAddr("127.0.0.1:9876");
        // 一次拉多少条
        consumer.setPullBatchSize(32);
        consumer.subscribe("TopicTest", "*");
        // 自动提交位点（也可以关掉后手动 commitSync / seek）
        consumer.setAutoCommit(true);
        consumer.start();

        try {
            while (true) {
                // 阻塞拉取，超时时间 3 秒
                List<MessageExt> messages = consumer.poll(3000);
                if (messages == null || messages.isEmpty()) {
                    continue;
                }
                for (MessageExt msg : messages) {
                    System.out.println("拉取到：" + new String(msg.getBody(), StandardCharsets.UTF_8));
                }
                // 手动提交位点（setAutoCommit(false) 时必须调用）
                // consumer.commitSync();
            }
        } finally {
            consumer.shutdown();
        }
    }
}
```

## 四、消费幂等：必须做的事

### 为什么一定会重复

RocketMQ 的语义是 **At Least Once（至少一次）**，也就是说**消息一定会投到，但可能投多次**。重复来源：

| 来源 | 说明 |
| --- | --- |
| 生产者重试 | 网络抖动，客户端以为失败了又发一次 |
| Broker 主从切换 | 消费者进度没及时同步 |
| 消费者提交 offset 前宕机 | 重启后从上次进度重新消费 |
| 消费失败重试 | `RECONSUME_LATER` 本身就是重新投递 |

**所以幂等不是"可选优化"，是"必做项"。**

### 幂等方案对比

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **业务状态机（推荐）** | `UPDATE order SET status=2 WHERE id=? AND status=1`，靠 `WHERE` 条件保证只有一次生效 | 不需要额外组件，天然幂等 | 要求业务有明确状态流转 |
| **数据库唯一索引** | 建 `unique(msg_id)`，重复插入直接失败 | 简单可靠 | 高频写库压力大 |
| **去重表 + 事务** | 消费前先插入去重表（唯一键），和业务操作放同一个事务 | 通用 | 同上，多一次写 |
| **Redis SETNX** | 消费前 `SETNX msgId`，成功才处理 | 性能好 | 要处理过期时间、Redis 不可用（详见 Redis 篇 06 章） |

### 推荐写法：业务状态机

```java
/**
 * 幂等的正确姿势：用数据库的条件更新保证"只有第一次生效"。
 * 返回影响行数，0 表示已被处理过或状态不对，直接跳过。
 */
public boolean payOrder(String orderNo) {
    // 只有当前状态是"待支付(1)"时才允许更新为"已支付(2)"
    // 重复消费时，第一次已经把 status 改成 2 了，第二次的 WHERE 条件不满足，影响行数为 0
    int rows = orderMapper.updateStatus(orderNo, 2, 1);
    if (rows == 0) {
        log.info("订单 {} 已处理或状态不匹配，跳过（幂等拦截）", orderNo);
        return false;
    }
    // 只有第一次会走到这里
    doAfterPay(orderNo);
    return true;
}
```

### 次选写法：Redis SETNX 去重

```java
package com.canoe.rocketmq;

import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;

/**
 * 用 Redis 做消费幂等（简单版）。
 * 注意：SETNX + 过期时间的完整坑与解决方案见 Redis 篇 06「分布式锁实战」。
 */
public class IdempotentChecker {

    private final StringRedisTemplate redisTemplate;

    public IdempotentChecker(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * 判断这条消息是否处理过。
     *
     * @param msgId 消息唯一标识（建议用 msg.getKeys() 或 UNIQ_KEY）
     * @return true = 没处理过，本次可以处理；false = 已处理过，跳过
     */
    public boolean canConsume(String msgId) {
        String key = "mq:consumed:" + msgId;
        // setIfAbsent 等价于 SETNX；只有 key 不存在时才返回 true
        // 过期时间要大于业务最大处理时间 + 消息最大重试周期，这里给 7 天
        Boolean ok = redisTemplate.opsForValue()
                .setIfAbsent(key, "1", Duration.ofDays(7));
        return Boolean.TRUE.equals(ok);
    }
}
```

::: warning Redis 去重不是万无一失
Redis 挂了、主从切换丢 key，都可能导致去重失效。所以**核心业务的最后一道防线应该是数据库的唯一约束**，Redis 只是用来挡掉绝大部分重复请求、降低数据库压力。
:::

## 五、完整示例：订单服务的生产者与消费者

```java
package com.canoe.rocketmq.order;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;
import org.apache.rocketmq.common.message.MessageExt;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;

/**
 * 订单服务：发"订单创建"消息 + 消费"订单创建"消息。
 * 演示生产者和消费者在一个 Spring 应用里的完整生命周期管理。
 */
@Component
public class OrderMqService {

    private static final String NAME_SERVER = "127.0.0.1:9876";
    private static final String TOPIC = "ORDER_TOPIC";
    private static final String PRODUCER_GROUP = "order_producer_group";
    private static final String CONSUMER_GROUP = "order_consumer_group";

    private DefaultMQProducer producer;
    private DefaultMQPushConsumer consumer;

    /** 应用启动后初始化生产者和消费者 */
    @PostConstruct
    public void init() throws MQClientException {
        // ===== 生产者 =====
        producer = new DefaultMQProducer(PRODUCER_GROUP);
        producer.setNamesrvAddr(NAME_SERVER);
        producer.setRetryTimesWhenSendFailed(3);
        producer.setVipChannelEnabled(false);
        producer.start();

        // ===== 消费者 =====
        consumer = new DefaultMQPushConsumer(CONSUMER_GROUP);
        consumer.setNamesrvAddr(NAME_SERVER);
        // 只订阅"创建订单"这个 tag
        consumer.subscribe(TOPIC, "CREATE");
        consumer.setConsumeThreadMin(8);
        consumer.setConsumeThreadMax(32);
        consumer.registerMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            for (MessageExt msg : msgs) {
                String orderNo = msg.getKeys();
                String body = new String(msg.getBody(), StandardCharsets.UTF_8);
                try {
                    // 幂等校验
                    if (!canConsume(orderNo)) {
                        continue;
                    }
                    // 业务处理
                    handleOrderCreated(orderNo, body);
                } catch (Exception e) {
                    // 超过 3 次放弃重试，转人工
                    if (msg.getReconsumeTimes() >= 3) {
                        saveToFailedTable(orderNo, body, e);
                        return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
                    }
                    return ConsumeConcurrentlyStatus.RECONSUME_LATER;
                }
            }
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        });
        consumer.start();
    }

    /** 发送"订单创建"消息（同步发送，保证可靠） */
    public SendResult sendOrderCreated(String orderNo, String payload) throws Exception {
        Message msg = new Message(TOPIC, "CREATE", orderNo,
                payload.getBytes(StandardCharsets.UTF_8));
        // 延时 30 分钟（4.x 等级 16 = 30m，见 04 篇等级表）
        msg.setDelayTimeLevel(16);
        return producer.send(msg);
    }

    /** 应用关闭时释放资源 */
    @PreDestroy
    public void destroy() {
        if (consumer != null) {
            consumer.shutdown();
        }
        if (producer != null) {
            producer.shutdown();
        }
    }

    private boolean canConsume(String orderNo) {
        // 幂等判断，实际用 Redis SETNX 或数据库状态机
        return true;
    }

    private void handleOrderCreated(String orderNo, String body) {
        System.out.println("处理订单创建：" + orderNo);
    }

    private void saveToFailedTable(String orderNo, String body, Exception e) {
        System.err.println("消息转人工：" + orderNo + "，原因：" + e.getMessage());
    }
}
```

## 本篇小结

- **三种发送方式**：同步 `send()`（最可靠，核心业务用）、异步 `send(msg, callback)`（高吞吐，记得处理 `onException`）、单向 `sendOneway()`（最快但可能丢，日志类用）。
- **`SEND_OK` ≠ 不丢消息**：异步刷盘下 Broker 宕机仍可能丢。要真不丢得 `SYNC_FLUSH` 或 `SYNC_MASTER` + Slave，是拿性能换的。
- 四种 `SendStatus`：`SEND_OK`、`FLUSH_DISK_TIMEOUT`（同步刷盘超时）、`FLUSH_SLAVE_TIMEOUT`（主从同步超时）、`SLAVE_NOT_AVAILABLE`（没从节点）。后三种都要告警。
- **客户端自带重试**（`retryTimesWhenSendFailed` 默认 2），但重试会造成**消息重复**，所以消费端必须幂等。
- **生产者是线程安全的**，一个业务一个实例全程复用，**别每条消息 new 一个**；关闭时 `shutdown()`。
- `Message(topic, tags, keys, body)`：**keys 建议设业务唯一 ID**，否则后期查消息只能扫时间范围。
- 多维度过滤用 `putUserProperty`，但**不能用 `DELAY`、`UNIQ_KEY` 等保留名**。
- **集群消费**（默认）分摊 + 进度存 Broker + 支持重试；**广播消费**全量 + 进度存本地 + 不支持重试，适合刷新本地缓存。
- `MessageListenerConcurrently` 返回 `CONSUME_SUCCESS` / `RECONSUME_LATER`；**务必判断 `reconsumeTimes` 设上限**，否则无限重试会堵死队列。
- `MessageListenerOrderly` 靠 **Broker 队列锁 + 本地队列锁 + 消费任务锁** 三把锁保证顺序，代价是吞吐下降。
- `ConsumeFromWhere` **只在消费组首次上线时生效**，已有进度要重置得用 `mqadmin resetOffsetByTime`。
- **幂等是必做项**：首选业务状态机（`UPDATE ... WHERE status=旧值`），Redis SETNX 作前置挡流，数据库唯一约束作最后防线。

## 参考链接

- [RocketMQ 普通消息（官方）](https://rocketmq.apache.org/zh/docs/featureBehavior/01normalmessage/)
- [RocketMQ 消费者（官方）](https://rocketmq.apache.org/zh/docs/featureBehavior/03consumermessage/)
- [rocketmq-client JavaDoc](https://javadoc.io/doc/org.apache.rocketmq/rocketmq-client)
- [RocketMQ 消费幂等最佳实践](https://rocketmq.apache.org/zh/docs/bestPractice/07subscribe/)
- [DefaultLitePullConsumer 用法](https://rocketmq.apache.org/zh/docs/featureBehavior/04consumerloadbalance/)

下一篇 → [04 消息类型全解](/java/middleware/rocketmq/message-type)
