# 04 消息类型全解

> 本篇把 RocketMQ 支持的**六种消息类型**一次讲透：普通消息、批量消息、顺序消息、延时/定时消息、事务消息、消息过滤。其中**事务消息是 RocketMQ 的王牌**，也是它区别于 RabbitMQ/Kafka 最大的卖点，本篇会把它从原理到完整可运行代码讲清楚。

## 本篇要解决的问题

- 顺序消息怎么保证？"全局顺序"和"分区顺序"差在哪？
- 延时消息为什么只能选 18 个等级？5.x 怎么支持任意时间？
- 事务消息到底是怎么做到"本地事务和发消息要么都成功要么都失败"的？
- 回查机制是什么？我的本地事务执行完了但 Broker 不知道怎么办？
- Tag 过滤和 SQL92 过滤怎么用，什么时候用哪个？

## 一、普通消息

就是 03 篇讲的三种发送方式（同步 / 异步 / 单向），这里不重复。补充一个**发送结果的处理模板**：

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.client.producer.SendStatus;
import org.apache.rocketmq.common.message.Message;

import java.nio.charset.StandardCharsets;

/**
 * 普通消息 + 发送结果判断模板。
 */
public class NormalMessageDemo {

    public static void main(String[] args) throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("normal_msg_group");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        Message msg = new Message("TopicTest", "TagA", "KEY_001",
                "普通消息".getBytes(StandardCharsets.UTF_8));

        SendResult result = producer.send(msg);

        // 根据发送状态做不同处理（生产环境建议加告警）
        switch (result.getSendStatus()) {
            case SEND_OK -> System.out.println("发送成功");
            case FLUSH_DISK_TIMEOUT -> System.err.println("刷盘超时，Broker 宕机可能丢消息，告警！");
            case FLUSH_SLAVE_TIMEOUT -> System.err.println("主从同步超时，主宕机可能丢消息，告警！");
            case SLAVE_NOT_AVAILABLE -> System.err.println("没有可用从节点，告警！");
            default -> System.out.println("未知状态");
        }

        producer.shutdown();
    }
}
```

## 二、批量消息

一次网络请求发多条消息，减少网络开销、提高吞吐。

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 批量发送：一次请求发多条消息。
 */
public class BatchMessageDemo {

    public static void main(String[] args) throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("batch_msg_group");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        List<Message> messages = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            messages.add(new Message("BatchTopic", "TagA", "KEY_" + i,
                    ("批量消息 " + i).getBytes(StandardCharsets.UTF_8)));
        }

        // 一次发 100 条（注意下面的限制）
        SendResult result = producer.send(messages);
        System.out.println("批量发送结果：" + result.getSendStatus());

        producer.shutdown();
    }
}
```

::: danger 批量消息的四条限制（必须知道）
1. **同一个 Topic**：一批消息必须属于同一个 Topic
2. **不支持延时消息**：批量消息不能设置延时等级
3. **不支持事务消息**
4. **总大小不能超过 4MB**（`maxMessageSize` 默认 4194304 字节）

超过 4MB 会报 `MQClientException: CODE: 13 DESC: the message body size over max value`。

**解决办法：自己拆包**。下面给一个通用的拆分工具：
:::

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.common.message.Message;

import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * 批量消息拆分器：把大列表按 4MB 拆成多个小批次发送。
 * 参考官方 ListSplitter 的实现思路。
 */
public class BatchSplitter implements Iterator<List<Message>> {

    /** 单批最大字节数，留一点余量（默认是 4MB，这里用 4MB - 预留头部） */
    private static final int SIZE_LIMIT = 1024 * 1024 * 4;

    private final List<Message> messages;
    private int currentIndex;

    public BatchSplitter(List<Message> messages) {
        this.messages = messages;
    }

    @Override
    public boolean hasNext() {
        return currentIndex < messages.size();
    }

    @Override
    public List<Message> next() {
        int nextIndex = currentIndex;
        int totalSize = 0;
        for (; nextIndex < messages.size(); nextIndex++) {
            Message msg = messages.get(nextIndex);
            // 每条消息的大小 = body + 属性 + 约 20 字节的日志开销
            int tmpSize = msg.getBody().length + propertiesSize(msg) + 20;
            if (tmpSize > SIZE_LIMIT) {
                // 单条就超了，nextIndex==currentIndex 说明这条超大，单独发
                if (nextIndex == currentIndex) {
                    nextIndex++;
                }
                break;
            }
            if (tmpSize + totalSize > SIZE_LIMIT) {
                break;
            }
            totalSize += tmpSize;
        }
        List<Message> subList = messages.subList(currentIndex, nextIndex);
        currentIndex = nextIndex;
        return subList;
    }

    private int propertiesSize(Message msg) {
        int size = 0;
        Map<String, String> props = msg.getProperties();
        if (props != null) {
            for (Map.Entry<String, String> entry : props.entrySet()) {
                size += entry.getKey().length() + entry.getValue().length();
            }
        }
        return size;
    }

    /** 使用示例 */
    public static void sendInBatch(DefaultMQProducer producer, List<Message> messages) throws Exception {
        BatchSplitter splitter = new BatchSplitter(messages);
        while (splitter.hasNext()) {
            List<Message> batch = splitter.next();
            producer.send(batch);
            System.out.println("发送一批，条数：" + batch.size());
        }
    }
}
```

## 三、顺序消息

### 先搞清楚两种"顺序"

| 类型 | 含义 | 做法 | 并发度 | 生产用吗 |
| --- | --- | --- | --- | --- |
| **全局顺序** | 所有消息严格按发送顺序消费 | Topic 只设 **1 个队列** | 1（完全串行） | **几乎不用**，性能太差 |
| **分区顺序** | 同一业务 key 的消息按顺序消费，不同 key 之间并行 | 同 key 发到同一队列 + 顺序消费 | 队列数 | ✅ **生产常用** |

::: tip 顺序消息的真实场景：订单状态流转
一个订单有 `创建 → 支付 → 发货 → 完成` 四个状态，这三个消息**必须按序处理**。如果"发货"先于"支付"被处理，就会出现"没付钱就发货"的荒唐结果。

但**不同订单之间不需要有顺序**——订单 A 和订单 B 完全可以并行处理。这就是"分区顺序"：**按订单号分区，区内有顺序**。
:::

### 实现三要素

1. **发送端**：用 `MessageQueueSelector`，把同一个业务 key 的消息发到同一个队列
2. **消费端**：用 `MessageListenerOrderly` 顺序消费
3. **不能有并发**：一个队列同时只能被一个线程消费（客户端自动保证）

### 完整示例：订单状态流转

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeOrderlyContext;
import org.apache.rocketmq.client.consumer.listener.ConsumeOrderlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerOrderly;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.MessageQueueSelector;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;
import org.apache.rocketmq.common.message.MessageExt;
import org.apache.rocketmq.common.message.MessageQueue;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 顺序消息完整示例：订单创建 → 支付 → 发货，必须按序处理。
 */
public class OrderMessageDemo {

    private static final String TOPIC = "OrderTopic";

    /** 订单的三个状态步骤 */
    enum OrderStep {
        CREATE, PAY, SHIP
    }

    public static void main(String[] args) throws Exception {
        // 先起消费者
        startConsumer();
        // 再发消息
        sendMessages();
    }

    // ============ 生产者 ============
    private static void sendMessages() throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("order_msg_producer");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        // 两个订单，每个订单三个步骤
        String[] orderIds = {"ORDER_1001", "ORDER_1002"};

        for (String orderId : orderIds) {
            for (OrderStep step : OrderStep.values()) {
                String body = orderId + " → " + step;
                Message msg = new Message(TOPIC, "ORDER_STEP", orderId,
                        body.getBytes(StandardCharsets.UTF_8));

                // 关键：同一个订单号的消息，用同一个 selector 选队列
                SendResult result = producer.send(msg, new MessageQueueSelector() {
                    @Override
                    public MessageQueue select(List<MessageQueue> mqs, Message msg, Object arg) {
                        String id = (String) arg;
                        int index = Math.abs(id.hashCode()) % mqs.size();
                        return mqs.get(index);
                    }
                }, orderId);

                System.out.printf("%s 发到队列 %d%n", body, result.getMessageQueue().getQueueId());
            }
        }
        producer.shutdown();
    }

    // ============ 消费者 ============
    private static void startConsumer() throws Exception {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("order_msg_consumer");
        consumer.setNamesrvAddr("127.0.0.1:9876");
        consumer.subscribe(TOPIC, "*");

        // 关键：用 MessageListenerOrderly 而不是 MessageListenerConcurrently
        consumer.registerMessageListener((MessageListenerOrderly) (msgs, context) -> {
            // context.getMessageQueue() 可以拿到当前在处理哪个队列
            System.out.printf("[线程 %s] 处理队列 %d%n",
                    Thread.currentThread().getName(),
                    context.getMessageQueue().getQueueId());

            for (MessageExt msg : msgs) {
                String body = new String(msg.getBody(), StandardCharsets.UTF_8);
                System.out.println("  → " + body);

                // 模拟业务失败：如果是 SHIP 且订单是 1002 就失败
                if (body.contains("ORDER_1002") && body.contains("SHIP")) {
                    System.err.println("  处理失败，挂起当前队列 3 秒后重试");
                    // SUSPEND_CURRENT_QUEUE_A_MOMENT：不会跳过这条消息，也不会消费后面的
                    // 可以用 context.setSuspendCurrentQueueTimeMillis(3000) 指定挂起时长
                    context.setSuspendCurrentQueueTimeMillis(3000);
                    return ConsumeOrderlyStatus.SUSPEND_CURRENT_QUEUE_A_MOMENT;
                }
            }
            return ConsumeOrderlyStatus.SUCCESS;
        });

        consumer.start();
    }
}
```

### 顺序消息的坑

::: danger 顺序消费失败的代价：整条队列被阻塞
用 `MessageListenerOrderly` 时，如果某条消息一直消费失败并返回 `SUSPEND_CURRENT_QUEUE_A_MOMENT`，那么**这个队列后面的所有消息都会被卡住**——因为顺序不能被打破。

**生产防护**：
1. 同样要判断 `reconsumeTimes`，超过阈值就记录到失败表 + 返回 `SUCCESS` 放行（哪怕牺牲一点顺序）
2. 消费逻辑里区分"可重试错误"和"永久错误"：参数错误、数据不存在这类直接放行
3. 对失败表配监控告警 + 人工/定时补偿
:::

::: warning 发送端也要保证顺序
光消费端顺序还不够。**如果发送端并发发消息，同一个订单的三条消息可能因为网络原因乱序到达 Broker**。

正确做法：同一个业务 key 的消息**串行发送**（用同一线程按序发），或者至少保证发送顺序。
:::

## 四、延时 / 定时消息

### 4.x 的 18 个固定等级

4.x 时代只能从 18 个预置等级里选：

| 等级 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 延迟 | 1s | 5s | 10s | 30s | 1m | 2m | 3m | 4m | 5m |

| 等级 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 延迟 | 6m | 7m | 8m | 9m | 10m | 20m | 30m | 1h | 2h |

```java
Message msg = new Message("DelayTopic", "TagA", "ORDER_10086",
        "订单创建".getBytes(StandardCharsets.UTF_8));
// 等级 16 = 30 分钟后投递
msg.setDelayTimeLevel(16);
producer.send(msg);
```

可以在 Broker 端改等级定义（`messageDelayLevel` 配置项），但**改了要重启，且会影响已有消息**，一般不改。

### 4.x 的实现原理（以及它的致命弱点）

Broker 内部有 18 个特殊队列（在 `SCHEDULE_TOPIC_XXXX` 这个内部 Topic 下），**每个等级对应一个队列**，后台线程定时扫描，到期的就投递到真正的 Topic。

**弱点**：同一个队列里的消息必须是同一档延迟时间。因为如果第一条是 30 分钟到期、第二条是 1 分钟到期，**第二条会被第一条堵住**——必须等第一条出队才能发现第二条过期了。

### 5.x 的任意时间定时消息（推荐）

5.x 引入了基于**时间轮（TimingWheel）** 的新实现，支持任意时间点：

| 特性 | 4.x | 5.x |
| --- | --- | --- |
| 时间粒度 | 18 个固定等级 | **任意时间（毫秒级）** |
| 最长延迟 | 2 小时 | **默认 24 小时**（`timerMaxDelaySec` 可调） |
| 精度 | 固定 | 默认 1 秒（`timerPrecisionMs`） |
| 存储 | 只有 CommitLog | 新增 `TimerLog` + `TimerWheel` 文件 |
| API | `setDelayTimeLevel` | `setDelayTimeMs` / `setDelayTimeSec` / `setDeliverTimeMs` |

**Broker 端要先开启**（`broker.conf`）：

```properties
# 开启时间轮（5.x 任意时间定时消息）
timerWheelEnable = true
# 定时精度，毫秒。默认 1000ms（1 秒），越小越精确但越耗资源
timerPrecisionMs = 1000
# 最大延迟秒数，默认 86400（24 小时）
timerMaxDelaySec = 86400
```

**客户端三种写法**：

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;

import java.nio.charset.StandardCharsets;
import java.util.Calendar;

/**
 * 5.x 任意时间定时消息的三种 API。
 * 注意：Broker 必须开 timerWheelEnable=true。
 */
public class DelayMessageDemo {

    public static void main(String[] args) throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("delay_msg_group");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        // ===== 写法 1：延迟多少秒 =====
        Message msg1 = new Message("DelayTopic", "TagA", "KEY_1",
                "30 分钟后投递".getBytes(StandardCharsets.UTF_8));
        msg1.setDelayTimeSec(30 * 60L);
        SendResult r1 = producer.send(msg1);

        // ===== 写法 2：延迟多少毫秒 =====
        Message msg2 = new Message("DelayTopic", "TagA", "KEY_2",
                "10 秒后投递".getBytes(StandardCharsets.UTF_8));
        msg2.setDelayTimeMs(10_000L);
        SendResult r2 = producer.send(msg2);

        // ===== 写法 3：指定精确的投递时间戳（真正的"定时"） =====
        Message msg3 = new Message("DelayTopic", "TagA", "KEY_3",
                "明天凌晨 2 点投递".getBytes(StandardCharsets.UTF_8));
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.DAY_OF_MONTH, 1);
        calendar.set(Calendar.HOUR_OF_DAY, 2);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        msg3.setDeliverTimeMs(calendar.getTimeInMillis());
        SendResult r3 = producer.send(msg3);

        System.out.println("定时消息已发送");
        producer.shutdown();
    }
}
```

::: warning 定时消息的限制
- **不支持事务消息**（延时和事务不能同时用）
- **不支持批量消息**（批量发不能设延迟）
- 5.x 默认最大延迟 24 小时，超过要改 `timerMaxDelaySec`
- 延迟消息在 Broker 里占存储，**别搞几百万条长期定时消息**
- **不要大量消息集中在同一秒投递**（比如全设 00:00:00），会让时间轮的某个槽位瞬间压力飙升。业务层加个随机抖动（Jitter）打散
:::

### 实战：订单 30 分钟未支付自动关闭

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.common.message.Message;
import org.apache.rocketmq.common.message.MessageExt;

import java.nio.charset.StandardCharsets;

/**
 * 实战：订单 30 分钟未支付自动关闭。
 * 流程：下单 → 发一条 30 分钟延时消息 → 30 分钟后消费 → 检查支付状态 → 未付则关单回库存
 */
public class OrderTimeoutCloseDemo {

    private static final String TOPIC = "ORDER_TIMEOUT_TOPIC";
    private static final String CONSUMER_GROUP = "order_timeout_consumer";

    // ===== 下单时调用 =====
    public static void sendCloseOrderDelayMsg(DefaultMQProducer producer, String orderNo) throws Exception {
        Message msg = new Message(TOPIC, "CHECK_PAY", orderNo,
                orderNo.getBytes(StandardCharsets.UTF_8));
        // 5.x：任意时间，30 分钟后
        msg.setDelayTimeSec(30 * 60L);
        // 4.x 写法：msg.setDelayTimeLevel(16);   // 等级 16 = 30 分钟
        producer.send(msg);
        System.out.println("已投递延时检查消息，订单：" + orderNo);
    }

    // ===== 消费端 =====
    public static void startConsumer() throws Exception {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer(CONSUMER_GROUP);
        consumer.setNamesrvAddr("127.0.0.1:9876");
        consumer.subscribe(TOPIC, "CHECK_PAY");

        consumer.registerMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            for (MessageExt msg : msgs) {
                String orderNo = new String(msg.getBody(), StandardCharsets.UTF_8);
                try {
                    // 1. 先查订单当前状态（关键：消息到期不等于订单没支付！）
                    String status = queryOrderStatus(orderNo);

                    // 2. 只有"待支付"才关单，用条件更新保证幂等
                    if ("WAIT_PAY".equals(status)) {
                        // UPDATE orders SET status='CLOSED' WHERE order_no=? AND status='WAIT_PAY'
                        // 影响行数为 0 说明已经被别的流程处理过了，跳过
                        boolean closed = closeOrderIfUnpaid(orderNo);
                        if (closed) {
                            // 3. 回库存
                            restoreStock(orderNo);
                            System.out.println("订单已关闭并回库存：" + orderNo);
                        }
                    } else {
                        System.out.println("订单已支付或已处理，跳过：" + orderNo);
                    }
                } catch (Exception e) {
                    if (msg.getReconsumeTimes() >= 3) {
                        System.err.println("关单失败转人工：" + orderNo);
                        return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
                    }
                    return ConsumeConcurrentlyStatus.RECONSUME_LATER;
                }
            }
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        });

        consumer.start();
    }

    private static String queryOrderStatus(String orderNo) {
        return "WAIT_PAY"; // 模拟
    }

    private static boolean closeOrderIfUnpaid(String orderNo) {
        return true; // 模拟
    }

    private static void restoreStock(String orderNo) {
        // 模拟回库存
    }
}
```

::: tip 为什么一定要再查一次状态
延时消息到期只代表"30 分钟到了"，不代表"用户没付钱"。用户可能在第 29 分钟付了款。所以**消费时必须回查订单状态**，用条件更新（`WHERE status='WAIT_PAY'`）兜底，这才是正确的幂等写法。
:::

## 五、事务消息（RocketMQ 的王牌）

### 解决什么问题

经典场景：**下单扣库存 + 发"订单创建"消息**，要求"要么都成功，要么都失败"。

朴素写法的问题：

```java
// 反例 1：先发消息再执行本地事务
producer.send(msg);        // 消息发出去了，消费者立刻收到
orderService.create();     // 但本地事务失败了 → 消费者收到一条"不存在的订单"

// 反例 2：先执行本地事务再发消息
orderService.create();     // 成功
producer.send(msg);        // 但发消息失败了（网络抖动）→ 订单创建了，下游不知道
```

**两种写法都有问题**，因为"本地事务"和"发消息"是两件事，无法在一个数据库事务里保证。

### 事务消息的原理：两阶段提交 + 回查

```text
     Producer                              Broker                        Consumer
        │                                    │                              │
   ①    │───── 发送 Half 消息（半消息）─────▶│                              │
        │      对消费者不可见                  │                              │
        │◀───── 返回"半消息已收到" ───────────│                              │
        │                                    │                              │
   ②    │ 执行本地事务（create order）        │                              │
        │ （写数据库）                        │                              │
        │                                    │                              │
   ③    │───── COMMIT / ROLLBACK ───────────▶│                              │
        │                                    │                              │
        │        ┌─ COMMIT：消息转为可见 ─────┼─────── 投递消息 ────────────▶│ 消费
        │        └─ ROLLBACK：消息被丢弃      │                              │
        │                                    │                              │
        │  （如果 ③ 迟迟不来，比如 Producer 挂了）                            │
   ④    │◀───── Broker 主动发起"回查" ────────│                              │
        │───── 查本地事务状态后回 COMMIT/ROLLBACK/UNKNOW ──▶│                │
```

**Half 消息（半消息）**：消息已经写到 Broker 了，但**对消费者不可见**。只有 Producer 明确 COMMIT 之后，消费者才能看到它。

**回查（Transaction Check）**：如果 Broker 长时间没收到 COMMIT/ROLLBACK（比如 Producer 发完半消息就宕机了），Broker 会主动回调 Producer 的 `checkLocalTransaction`，问一句"你那边到底成没成？"。

### 完整代码

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.client.producer.LocalTransactionState;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.client.producer.TransactionListener;
import org.apache.rocketmq.client.producer.TransactionMQProducer;
import org.apache.rocketmq.common.message.Message;
import org.apache.rocketmq.common.message.MessageExt;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 事务消息完整示例：下单 → 本地事务写库 → 提交/回滚。
 */
public class TransactionMessageDemo {

    public static void main(String[] args) throws Exception {
        // 1. 事务监听器：两个回调
        TransactionListener transactionListener = new TransactionListener() {

            private final AtomicInteger transactionIndex = new AtomicInteger(0);

            /**
             * ② 执行本地事务。半消息发送成功后会立刻回调这个方法。
             *
             * @param msg 半消息
             * @param arg sendMessageInTransaction 透传的参数
             * @return COMMIT_MESSAGE / ROLLBACK_MESSAGE / UNKNOW
             */
            @Override
            public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
                String orderNo = msg.getKeys();
                String body = new String(msg.getBody(), StandardCharsets.UTF_8);
                System.out.println("【本地事务】开始执行，订单：" + orderNo);

                try {
                    // ===== 真实业务：写订单表 + 扣库存（在一个数据库事务里） =====
                    boolean success = createOrderAndDeductStock(orderNo, body);
                    // =======================================================

                    if (success) {
                        System.out.println("【本地事务】成功 → COMMIT");
                        return LocalTransactionState.COMMIT_MESSAGE;
                    } else {
                        System.out.println("【本地事务】失败 → ROLLBACK");
                        return LocalTransactionState.ROLLBACK_MESSAGE;
                    }
                } catch (Exception e) {
                    // 异常时不要直接回滚！因为可能已经写了一半。
                    // 返回 UNKNOW 让 Broker 稍后回查，由回查逻辑去数据库确认真实状态
                    System.err.println("【本地事务】异常，返回 UNKNOW 等待回查：" + e.getMessage());
                    return LocalTransactionState.UNKNOW;
                }
            }

            /**
             * ④ 回查本地事务状态。
             * 触发时机：Broker 长时间没收到 COMMIT/ROLLBACK。
             *
             * @param msg 被回查的那条半消息
             * @return COMMIT_MESSAGE / ROLLBACK_MESSAGE / UNKNOW
             */
            @Override
            public LocalTransactionState checkLocalTransaction(MessageExt msg) {
                String orderNo = msg.getKeys();
                System.out.println("【回查】检查订单状态：" + orderNo);

                // 去数据库查这个订单到底有没有创建成功
                // 这是唯一可信的真相来源，不要靠内存里的状态（进程可能重启过）
                Integer status = queryOrderStatusFromDb(orderNo);

                if (status == null) {
                    // 查不到：可能是本地事务还没执行完，返回 UNKNOW 等下次回查
                    // 注意：不要无限返回 UNKNOW，超过最大回查次数会被强制回滚
                    System.out.println("【回查】订单不存在，返回 UNKNOW");
                    return LocalTransactionState.UNKNOW;
                }
                if (status == 1) {
                    System.out.println("【回查】订单已创建 → COMMIT");
                    return LocalTransactionState.COMMIT_MESSAGE;
                }
                System.out.println("【回查】订单已取消 → ROLLBACK");
                return LocalTransactionState.ROLLBACK_MESSAGE;
            }
        };

        // 2. 创建事务生产者
        TransactionMQProducer producer = new TransactionMQProducer("transaction_producer_group");
        producer.setNamesrvAddr("127.0.0.1:9876");

        // 3. 设置处理"回查"请求的线程池（Broker 回查时用的是这个线程池）
        //    不设的话用默认线程池，一般也够用，但生产建议自定义：线程数要能扛住回查并发
        ExecutorService executorService = new ThreadPoolExecutor(
                2,                          // 核心线程数
                5,                          // 最大线程数
                100, TimeUnit.SECONDS,      // 空闲线程存活时间
                new ArrayBlockingQueue<>(2000),
                new ThreadFactory() {
                    @Override
                    public Thread newThread(Runnable r) {
                        Thread thread = new Thread(r);
                        thread.setName("client-transaction-msg-check-thread");
                        return thread;
                    }
                }
        );
        producer.setExecutorService(executorService);

        // 4. 设置监听器并启动
        producer.setTransactionListener(transactionListener);
        producer.start();

        // 5. 发事务消息
        for (int i = 1; i <= 3; i++) {
            String orderNo = "TX_ORDER_" + i;
            Message msg = new Message("TransactionTopic", "CREATE", orderNo,
                    ("下单 " + orderNo).getBytes(StandardCharsets.UTF_8));

            // 第二个参数是透传给 executeLocalTransaction 的 arg
            SendResult result = producer.sendMessageInTransaction(msg, null);
            System.out.println("发送事务消息：" + result.getSendStatus() + "，订单：" + orderNo);
        }

        // 6. 别急着 shutdown，回查可能还没发生（示例里等一会儿）
        Thread.sleep(30_000);
        producer.shutdown();
    }

    private static boolean createOrderAndDeductStock(String orderNo, String body) {
        // 模拟：写订单表 + 扣库存，在同一个 @Transactional 里
        System.out.println("  写订单表 + 扣库存：" + orderNo);
        return true;
    }

    private static Integer queryOrderStatusFromDb(String orderNo) {
        // 模拟：1 = 已创建，2 = 已取消，null = 不存在
        return 1;
    }
}
```

### 三种返回状态

| 状态 | 含义 | Broker 行为 |
| --- | --- | --- |
| `COMMIT_MESSAGE` | 本地事务成功 | 半消息**转为可见**，投递给消费者 |
| `ROLLBACK_MESSAGE` | 本地事务失败 | 半消息被**丢弃**（其实是转移到内部 OP 主题标记删除），消费者永远看不到 |
| `UNKNOW` | 暂时不确定 | **不处理**，等下一次回查 |

### 关键参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `transactionTimeout` | 6000(ms) | Broker 多久没收到确认就发起**第一次**回查 |
| `transactionCheckMax` | **15 次** | **最多回查次数**，超了默认按 ROLLBACK 处理（丢弃消息） |
| `transactionCheckInterval` | 60000(ms) | 回查间隔 |
| `checkTransactionMessageEnable` | true | Broker 端回查总开关 |

::: danger 回查次数上限是 15 次
超过了还没回出确定结果，**消息会被丢弃**。如果你的本地事务可能跑很久（比如依赖外部系统调用），要：
1. 把 `transactionTimeout` 调大
2. 回查逻辑里**尽快给出确定结论**，别一直 UNKNOW
3. 回查逻辑一定要**查数据库**，不要查内存（进程重启内存就没了）
:::

### 事务消息注意事项

| 注意点 | 说明 |
| --- | --- |
| **不支持延时** | 事务消息和延时消息不能同时用 |
| **不支持批量** | 必须一条一条发 |
| **半消息也占存储** | 大量 UNKNOW 会堆积半消息，监控 `RMQ_SYS_TRANS_HALF_TOPIC` |
| **消费端依然要幂等** | 事务消息保证的是"本地事务和发消息一致"，**不保证消费只发生一次** |
| **回查是异步的** | 别在 `checkLocalTransaction` 里做耗时操作，会占用回查线程池 |
| **Producer Group 不能随便改** | Broker 回查是按 Producer Group 找到客户端的，改了组名就找不到人回查了 |

::: tip 事务消息能保证什么
准确地说，事务消息保证的是：**本地事务成功 ⟺ 消息被投递**。它解决的是"我做了 A 但没通知到 B"的问题。

它**不保证**下游一定处理成功——下游消费失败该重试还是重试，该进死信还是进死信。完整的分布式事务还需要下游的幂等 + 重试 + 补偿机制配合。
:::

## 六、消息过滤

### Tag 过滤（最常用）

**一条消息只能有一个 Tag**，消费端订阅时指定要哪些：

```java
// 生产者：一条消息一个 tag
Message msg = new Message("OrderTopic", "CREATE", "ORDER_1", body);

// 消费者：三种写法
consumer.subscribe("OrderTopic", "*");                // 全部 tag
consumer.subscribe("OrderTopic", "CREATE");           // 只要 CREATE
consumer.subscribe("OrderTopic", "CREATE || PAY");    // CREATE 或 PAY
```

**过滤发生在 Broker 端**：Broker 在 ConsumeQueue 里存了每条消息 Tag 的 hashCode，消费拉取时先比对 hash，不匹配就不返回，省掉网络传输。

::: warning 服务端比对的是 hashCode
Broker 先比 Tag 的 **hashCode**，匹配了才把消息传给客户端；客户端收到后再做一次**字符串精确比对**。所以理论上存在 hash 碰撞导致"多传了一条"，但客户端会二次过滤，不会出错。
:::

### SQL92 过滤（多维度）

Tag 只有一个维度，要"金额大于 100 且是上海地区的 VIP 订单"就得用 SQL92。

**第一步：Broker 必须开开关**（默认关闭）：

```properties
# broker.conf
enablePropertyFilter = true
```

**第二步：发送时放自定义属性**：

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;

import java.nio.charset.StandardCharsets;

/**
 * SQL92 过滤：发送端放属性。
 */
public class SqlFilterProducer {

    public static void main(String[] args) throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("sql_filter_producer");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        String[][] orders = {
                {"ORDER_1", "299", "SH", "3"},   // 金额 299，上海，VIP3
                {"ORDER_2", "50",  "BJ", "1"},   // 金额 50，北京，VIP1
                {"ORDER_3", "888", "SH", "5"},   // 金额 888，上海，VIP5
        };

        for (String[] order : orders) {
            Message msg = new Message("SqlFilterTopic", "ORDER",
                    order[0], ("订单 " + order[0]).getBytes(StandardCharsets.UTF_8));
            // 放自定义属性，供 SQL 表达式过滤
            msg.putUserProperty("amount", order[1]);
            msg.putUserProperty("region", order[2]);
            msg.putUserProperty("vipLevel", order[3]);

            SendResult result = producer.send(msg);
            System.out.println("发送：" + order[0]);
        }
        producer.shutdown();
    }
}
```

**第三步：消费端用 `MessageSelector.bySql` 订阅**：

```java
package com.canoe.rocketmq.type;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.MessageSelector;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.common.message.MessageExt;

import java.nio.charset.StandardCharsets;

/**
 * SQL92 过滤：消费端用表达式订阅。
 */
public class SqlFilterConsumer {

    public static void main(String[] args) throws Exception {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("sql_filter_consumer");
        consumer.setNamesrvAddr("127.0.0.1:9876");

        // 只要：金额 > 100 且 地区是上海 且 VIP 等级 >= 3
        consumer.subscribe("SqlFilterTopic",
                MessageSelector.bySql("amount > 100 AND region = 'SH' AND vipLevel >= 3"));

        consumer.registerMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            for (MessageExt msg : msgs) {
                System.out.printf("收到：%s, amount=%s, region=%s, vip=%s%n",
                        new String(msg.getBody(), StandardCharsets.UTF_8),
                        msg.getProperty("amount"),
                        msg.getProperty("region"),
                        msg.getProperty("vipLevel"));
            }
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        });

        consumer.start();
        System.out.println("SQL 过滤消费者已启动，只会收到 ORDER_3");
    }
}
```

### SQL92 支持的语法

| 类型 | 支持的操作 |
| --- | --- |
| 数值比较 | `>`、`>=`、`<`、`<=`、`=`、`BETWEEN x AND y` |
| 字符串比较 | `=`、`<>`、`IN ('a', 'b')` |
| 逻辑 | `AND`、`OR`、`NOT` |
| 判空 | `IS NULL`、`IS NOT NULL` |
| 布尔 | `TRUE`、`FALSE` |

::: warning SQL92 的限制
- **必须开 `enablePropertyFilter=true`**，否则消费者启动就报错：`The broker does not support consumer to filter message by SQL92`
- **不支持**：`LIKE`、函数、算术运算、子查询
- 属性值的**类型要对得上**：`amount` 存的是字符串 "299"，SQL 里写 `amount > 100` 时 Broker 会尝试转成数值。**如果存的是非数字字符串会过滤失败**
- 过滤是在 **Broker 端**做的，会给 Broker 加 CPU 负担。**消息量极大时慎用**，或者干脆拉到消费端自己判断
:::

### Tag vs SQL92 怎么选

| 维度 | Tag | SQL92 |
| --- | --- | --- |
| 维度数量 | 1 个 | 多个 |
| 性能 | 高（hash 比对） | 较低（表达式解析） |
| 需要开配置 | 否 | **是**（`enablePropertyFilter`） |
| 复杂度 | 简单 | 复杂 |
| 场景 | 按消息类型分流（创建/支付/取消） | 按业务属性分流（金额/地区/等级） |

**建议**：能用 Tag 就用 Tag，Tag 不够用再上 SQL92，SQL92 还不够就拉到消费端自己 `if` 判断。

## 七、消息类型选型速查

| 需求 | 用什么 | 关键点 |
| --- | --- | --- |
| 普通异步解耦 | 普通消息（同步发送） | 判断 `SendStatus`，异常做补偿 |
| 高吞吐、可容忍少量丢失 | 单向 / 异步发送 | 记得处理 `onException` |
| 一次发很多条 | 批量消息 | **≤4MB**，超限自己拆包 |
| 同一业务 key 要按顺序 | 顺序消息 | `MessageQueueSelector` + `MessageListenerOrderly`，注意失败会堵队列 |
| 多久之后执行 | 延时/定时消息 | 5.x 用 `setDelayTimeSec`，要开 `timerWheelEnable` |
| 本地事务和发消息要一致 | **事务消息** | 半消息 + `executeLocalTransaction` + `checkLocalTransaction` |
| 按类型分流 | Tag 过滤 | 一条消息只能一个 Tag |
| 按业务属性分流 | SQL92 过滤 | Broker 要开 `enablePropertyFilter` |

## 本篇小结

- **顺序消息**分两种：全局顺序（1 个队列，几乎不用）和**分区顺序**（同 key 同队列，生产常用）。实现靠 `MessageQueueSelector` + `MessageListenerOrderly`。
- 顺序消费失败会**阻塞整条队列**，必须判断 `reconsumeTimes` 设上限，超限就记录后放行。
- **批量消息**必须同 Topic、不能设延时、不能是事务消息，**总大小 ≤4MB**，超了自己拆包。
- **延时消息**：4.x 只有 18 个固定等级（1s~2h）；**5.x 用时间轮支持任意时间**，API 是 `setDelayTimeSec` / `setDelayTimeMs` / `setDeliverTimeMs`，**Broker 要先开 `timerWheelEnable=true`**。
- 延时消息**不支持事务和批量**，最大延迟 24 小时（可改 `timerMaxDelaySec`），别让大量消息撞在同一秒投递。
- 关单场景**必须在消费时回查订单状态**并用条件更新兜底，"消息到期"不等于"用户没付款"。
- **事务消息 = 半消息 + 本地事务 + 二阶段确认 + 回查**。半消息对消费者不可见，COMMIT 后才投递，ROLLBACK 就丢弃。
- `executeLocalTransaction` 抛异常时**返回 UNKNOW 而不是 ROLLBACK**，让回查去数据库确认真相。
- **回查最多 15 次**，超限消息被丢弃；回查逻辑必须**查数据库**（内存状态重启就没了），要尽快给出确定结论。
- 事务消息**不支持延时和批量**，且**消费端依然要幂等**——它只保证"本地事务和投递一致"。
- **Tag 过滤**是 hash 比对，性能好，但一条消息只能一个 Tag；**SQL92 过滤**支持多维度，但 Broker 要开 `enablePropertyFilter=true` 且性能较低。
- 过滤优先级：能用 Tag 用 Tag，不够再 SQL92，还不够就拉到消费端自己判断。

## 参考链接

- [RocketMQ 顺序消息（官方）](https://rocketmq.apache.org/zh/docs/featureBehavior/03fifomessage/)
- [RocketMQ 延迟消息（官方）](https://rocketmq.apache.org/zh/docs/featureBehavior/02delaymessage/)
- [RocketMQ 事务消息（官方）](https://rocketmq.apache.org/zh/docs/featureBehavior/04transactionmessage/)
- [RocketMQ 消息过滤（官方）](https://rocketmq.apache.org/zh/docs/featureBehavior/07messagefilter/)
- [RocketMQ 批量消息](https://rocketmq.apache.org/zh/docs/featureBehavior/01normalmessage/)
- [RIP-43：任意时间定时消息设计文档](https://github.com/apache/rocketmq/wiki/RIP-43-Support-RocketMQ-Arbitrary-Time-Delay-Message)

下一篇 → [05 Spring Boot 整合实战](/java/middleware/rocketmq/springboot)
