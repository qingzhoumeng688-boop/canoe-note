# 02 交换机与消息模型

> 本篇在"01 环境搭建"的基础上，深入 RabbitMQ 最核心的抽象——**交换机（Exchange）**。你会学到：交换机到底是个什么角色、RabbitMQ 官方总结的六种经典工作模式分别怎么用、四种交换机类型怎么选，以及队列和消息的完整结构。每一节都配可运行的 Java 代码，抄下来就能跑。

## 本篇要解决的问题

- 生产者为什么从来不直接把消息"塞进队列"？中间的交换机到底干了啥？
- 为什么有的消息同时被多个消费者收到（广播），有的只被其中一个处理（竞争消费）？
- `fanout` / `direct` / `topic` / `headers` 四种交换机到底怎么选？
- `routingKey`、`binding key`、`*`、`#` 这些词到底怎么配合？
- 队列 `durable` / `exclusive` / `autoDelete` 到底啥区别？消息怎么设置持久化？

读完这章，你对 RabbitMQ 的"路由模型"会建立完整心智图，后面用 Spring Boot 整合只是换层封装。

## 一、交换机到底是什么

### 1.1 比喻：邮局的分拣员

回想 01 章的架构图：生产者 **不直接认队列**，而是把消息交给 **Exchange（交换机）**，由交换机决定"这封信进哪个格子（Queue）"。

交换机就像邮局的**分拣员**：

- 你（生产者）只负责把信投进邮局窗口，你**根本不知道**收件箱（队列）叫什么名字、有几个。
- 分拣员手里有一张**路由表（Binding 规则）**，写着"地址带 `error` 的信 → 进告警队列""带 `news` 的信 → 进日志队列"。
- 他照着这张表，把你的信分到对应的格子。

```text
生产者（你）                   分拣员（Exchange）                收件箱（Queue）
  发消息 ──────▶  看 routingKey  ──────▶  按 Binding 规则投递
                  │                            │
                  │  error  ───────────────▶ 告警队列
                  │  info   ───────────────▶ 日志队列
                  │  未知地址 ─────────────▶ 丢弃（没人要的信）
```

### 1.2 为什么要有交换机

没有交换机，生产者就得自己知道"哪个队列、几个消费者、怎么分"，又回到强耦合。有了交换机：

1. **生产者与队列解耦**：生产者只管把消息交给交换机，完全不关心下游有几个队列、几个消费者。
2. **支持一对多广播**：一条消息可以被交换机复制到 N 个队列，所有消费者都收到（发布订阅）。
3. **支持按规则路由**：不同的 routingKey 走不同的队列，实现"按关键词分流"。

### 1.3 交换机只做一件事：要么投递，要么丢掉

::: warning 交换机不存消息！
这是新手最容易误解的点：**Exchange 本身不存储任何消息**。它收到消息后，按 Binding 规则立刻转发给匹配的队列；如果没有任何队列匹配（比如没人绑定、或 routingKey 对不上），**这条消息就被丢弃**（除非你配了备用交换机，见下文）。所以"队列不存在 / 没绑定"就发消息 = 消息凭空消失。
:::

### 1.4 默认交换机 AMQP default

RabbitMQ 启动时会自带一个**名字是空字符串 `""` 的默认交换机**（类型是 `direct`）。它的特殊规则是：**routingKey 必须等于队列名**，消息才会进那个队列。

01 章我们第一个程序用的就是它：

```java
// 空串 "" = 默认交换机；routingKey 必须 = 队列名
channel.basicPublish("", "hello", null, body);
```

你从来没声明过这个交换机，它一直都在。但正式业务里，强烈建议**自己声明具名交换机**，路由更清晰、可控，也避免"routingKey 写错就静默丢"。

### 1.5 basicPublish 的参数逐项说明

发消息的核心方法 `basicPublish`，原型（以常用重载为例）：

```java
void basicPublish(String exchange, String routingKey,
                  AMQP.BasicProperties props, byte[] body)
```

逐项解释：

| 参数 | 含义 | 说明 |
| --- | --- | --- |
| `exchange` | 发往哪个交换机 | 空串 `""` 表示默认交换机；否则填你声明的交换机名 |
| `routingKey` | 路由键 | 交换机据此匹配 Binding；fanout 类型下被忽略 |
| `props` | 消息属性 | `AMQP.BasicProperties`，放持久化、correlationId、headers 等（第七章详讲）；不想设就传 `null` |
| `body` | 消息体 | **必须是 `byte[]`**，所以字符串要 `getBytes(StandardCharsets.UTF_8)` |

::: tip 记住 body 永远字节数组
无论你发 JSON、文本还是序列化对象，落到 `basicPublish` 时都得是 `byte[]`。这是 AMQP 协议的硬性规定（消息体是二进制透明传输）。接收端 `delivery.getBody()` 拿到的也是 `byte[]`，自己转回字符串/反序列化。
:::

## 二、六种经典工作模式

下面这六种模式对应 RabbitMQ 官方 Tutorials 的命名。每个模式都给：**原理 + ASCII 图 + 完整 Java 代码**。

### 2.1 ① Hello World（简单模式）

**最基础的单生产者、单队列、单消费者。** 一切都从这一条线开始，后面所有模式都是它的变体。

```text
[Producer] ──basicPublish("", "hello")──▶ [默认 direct 交换机] ──routingKey=hello──▶ [Queue: hello] ──basicConsume──▶ [Consumer]
```

生产者（和 01 章基本一致，这里贴完整版）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.MessageProperties;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Hello World 模式：一个生产者、一个队列、一个消费者。
 * 用默认交换机，routingKey 直接等于队列名。
 */
public class HelloProducer {

    private static final String QUEUE_NAME = "hello";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            // 声明队列（幂等）
            channel.queueDeclare(QUEUE_NAME, false, false, false, null);

            String message = "Hello World!";
            channel.basicPublish("", QUEUE_NAME,
                    MessageProperties.PERSISTENT_TEXT_PLAIN,
                    message.getBytes(StandardCharsets.UTF_8));
            System.out.println("[x] 已发送：'" + message + "'");
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

消费者：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Hello World 消费者：监听 hello 队列，收到就打印。
 */
public class HelloConsumer {

    private static final String QUEUE_NAME = "hello";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.queueDeclare(QUEUE_NAME, false, false, false, null);

            DeliverCallback deliverCallback = (consumerTag, delivery) -> {
                String message = new String(delivery.getBody(), StandardCharsets.UTF_8);
                System.out.println("[x] 收到：'" + message + "'");
            };

            channel.basicConsume(QUEUE_NAME, true, deliverCallback, consumerTag -> {});

            System.out.println("[*] 等待消息，按 Ctrl+C 退出");
            System.in.read();
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

### 2.2 ② Work Queues（工作队列 / 竞争消费）

**一个生产者、一个队列、多个消费者。一条消息只会被其中一个消费者处理**——多个消费者"抢"同一条消息，这叫**竞争消费**，用来**分摊任务、提高吞吐**。

```text
[Producer] ──发 10 条──▶ [Queue: tasks]
                                │
                ┌───────────────┼───────────────┐
                ▼                                ▼
         [Consumer A]                      [Consumer B]
         （抢到 1,3,5,7,9）               （抢到 2,4,6,8,10）
         一条消息只被其中一个处理
```

#### 轮询分发（round-robin）

RabbitMQ 默认用**轮询**：消息 1 给 A、消息 2 给 B、消息 3 给 A……平均分配，不管谁忙谁闲。问题来了：如果 A 处理慢、B 处理快，A 那儿会积压，B 闲着。

轮询演示输出（A、B 各处理 5 条）：

```text
Producer 发：task1 task2 task3 task4 task5 task6 task7 task8 task9 task10

Consumer A 收到：task1  task3  task5  task7  task9   （均匀，但 A 慢）
Consumer B 收到：task2  task4  task6  task8  task10  （均匀，但 B 快，早闲）
```

#### 不公平分发（prefetch = 1）

解决办法：**不让消费者一次拿一堆，而是处理完一条再拿下一条**。在消费者端设置 `channel.basicQos(1)`（prefetchCount = 1）：

```java
// 关键：消费者端设置，一次只预取 1 条，ACK 后再取下一条
channel.basicQos(1);
// 并且必须 manual ack（autoAck=false），prefetch 才有意义
channel.basicConsume(QUEUE, false, deliverCallback, cancelCallback);
```

`DeliverCallback` 里处理完要手动 `basicAck`：

```java
DeliverCallback deliverCallback = (consumerTag, delivery) -> {
    String task = new String(delivery.getBody(), StandardCharsets.UTF_8);
    System.out.println("[x] 处理：" + task);
    doWork(task); // 模拟耗时
    // 手动确认：告诉 Broker 这条我处理完了，可以删了
    // 第二个参数 multiple=false 表示只确认这一条
    channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
};
```

::: warning prefetch 必须在 manual ack 下才有意义
`basicQos(prefetchCount)` 控制"最多预取多少条未确认消息"。如果你 `autoAck=true`（收到就自动确认），那 prefetch 等于没用——因为消息一到达就被确认了，Broker 会继续猛推。所以**不公平分发 = 消费者端 `basicQos(1)` + `autoAck=false` + 处理完 `basicAck`**，三者缺一不可。
:::

#### prefetch 取值建议与性能权衡

| prefetchCount | 行为 | 适用场景 |
| --- | --- | --- |
| `0`（默认） | 不限，Broker 一次性全推给空闲消费者 | 任务极轻、处理极快；否则易把慢消费者压垮 |
| `1` | 严格公平，处理完才取下一条 | **最常用**，慢消费者不被压垮，负载均衡最好 |
| `10~100` | 批量预取，减少网络往返 | 任务多且重、吞吐优先，但要防消费者积压 |
| 过大 | 又退化成"谁先连上谁全拿" | 不推荐 |

完整 Work Queue 生产者（发多条任务）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.MessageProperties;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Work Queue 生产者：连发多条任务到同一个队列，让多个消费者竞争处理。
 */
public class WorkProducer {

    private static final String QUEUE_NAME = "tasks";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.queueDeclare(QUEUE_NAME, true, false, false, null);

            // 连发 10 条任务，模拟耗时不同
            for (int i = 1; i <= 10; i++) {
                String task = "task" + i;
                channel.basicPublish("", QUEUE_NAME,
                        MessageProperties.PERSISTENT_TEXT_PLAIN,
                        task.getBytes(StandardCharsets.UTF_8));
                System.out.println("[x] 发布：" + task);
            }
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

完整 Work Queue 消费者（启用不公平分发 + 手动 ack）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;
import com.rabbitmq.client.Delivery;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Work Queue 消费者：basicQos(1) + 手动 ack，实现不公平分发。
 * 启动两个本类实例，就能看到它们竞争消费同一条队列里的任务。
 */
public class WorkConsumer {

    private static final String QUEUE_NAME = "tasks";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.queueDeclare(QUEUE_NAME, true, false, false, null);

            // ★ 不公平分发核心：一次最多预取 1 条未确认消息
            channel.basicQos(1);

            DeliverCallback deliverCallback = (consumerTag, delivery) -> {
                String task = new String(delivery.getBody(), StandardCharsets.UTF_8);
                System.out.println("[x] 处理：" + task);
                // 模拟不同耗时（带点的多少代表耗时）
                try {
                    Thread.sleep(500 + task.length() * 100L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                // ★ 手动确认，Broker 才删这条消息
                channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
                System.out.println("[x] 完成：" + task);
            };

            // autoAck=false：必须手动 ack
            channel.basicConsume(QUEUE_NAME, false, deliverCallback, consumerTag -> {});

            System.out.println("[*] 等待任务，按 Ctrl+C 退出");
            System.in.read();
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

起 1 个 `WorkProducer` 发 10 条，再起 **2 个** `WorkConsumer` 实例，把其中一个的 `Thread.sleep` 调长，就能看到快的那台多揽活——不公平分发生效了。

### 2.3 ③ Publish/Subscribe（发布订阅 / Fanout 广播）

**一个消息发给所有绑定的队列**——典型"广播"。交换机类型是 `fanout`，它**无视 routingKey**，把消息复制一份丢给所有绑定的队列。

```text
[Producer] ──basicPublish(fanout_ex, "")──▶ [fanout 交换机]
                                             │  复制 N 份
                       ┌─────────────────────┼─────────────────────┐
                       ▼                                            ▼
                 [Queue: log.a]                              [Queue: log.b]
                       ▼                                            ▼
                 [Consumer A]                                 [Consumer B]
                 （都收到同一条消息）
```

场景：系统通知（所有用户都要收到）、缓存同步清理（多个缓存节点都要清）。

**临时队列**：广播模式里，每个消费者通常要一个"专属、用完即删"的队列。RabbitMQ 支持让 Broker 帮你随机命名：

```java
// 不传队列名，Broker 返回类似 "amq.gen-xxxx" 的随机名；且该队列 exclusive+autoDelete
String queueName = channel.queueDeclare().getQueue();
```

完整生产者（fanout）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Publish/Subscribe 生产者：声明 fanout 交换机，广播消息（routingKey 被忽略）。
 */
public class FanoutProducer {

    private static final String EXCHANGE_NAME = "logs_fanout";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            // 声明 fanout 交换机
            channel.exchangeDeclare(EXCHANGE_NAME, "fanout");

            String message = "系统将于今晚 23:00 维护";
            // fanout 下 routingKey 随便写（这里传空串），反正被忽略
            channel.basicPublish(EXCHANGE_NAME, "", null,
                    message.getBytes(StandardCharsets.UTF_8));
            System.out.println("[x] 广播：" + message);
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

完整消费者（临时队列 + 绑定到 fanout）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Publish/Subscribe 消费者：建一个 Broker 随机命名的临时队列，绑定到 fanout 交换机。
 * 启动多个实例，每个都能收到同一条广播消息。
 */
public class FanoutConsumer {

    private static final String EXCHANGE_NAME = "logs_fanout";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.exchangeDeclare(EXCHANGE_NAME, "fanout");

            // 关键：Broker 随机命名的临时队列（exclusive、autoDelete 默认 true）
            String queueName = channel.queueDeclare().getQueue();

            // 绑定到交换机，fanout 下 binding key 无意义，传空串
            channel.queueBind(queueName, EXCHANGE_NAME, "");

            DeliverCallback deliverCallback = (consumerTag, delivery) -> {
                String message = new String(delivery.getBody(), StandardCharsets.UTF_8);
                System.out.println("[x] 收到广播：" + message);
            };

            channel.basicConsume(queueName, true, deliverCallback, consumerTag -> {});

            System.out.println("[*] 等待广播，按 Ctrl+C 退出（queue=" + queueName + "）");
            System.in.read();
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

### 2.4 ④ Routing（路由模式 / Direct）

**按 routingKey 精确匹配。** 交换机类型是 `direct`：只有当队列绑定的 binding key **完全等于**消息的 routingKey 时，消息才进该队列。

```text
[Producer] ──basicPublish(direct_ex, "error")──▶ [direct 交换机]
                                                    │ 精确匹配 binding key
                       ┌────────────────────────────┼────────────────────────┐
                       │ binding key="error"        │ binding key="info"      │ binding key="error"
                       ▼                            ▼                          ▼
                 [Queue: error_log]          [Queue: all_log]            [Queue: error_alarm]
                 （error 进）                 （info/error 都进）          （error 进，可告警）
```

实例：日志系统。`error` 级别的进"告警队列"并存盘，`info` / `warning` 只写普通日志。一个队列可以绑**多个 routingKey**（多重绑定）：

```java
// all_log 队列同时接收 info 和 warning
channel.queueBind(queueName, EXCHANGE_NAME, "info");
channel.queueBind(queueName, EXCHANGE_NAME, "warning");
```

完整生产者（direct）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Routing 生产者：用 direct 交换机，按 severity 作为 routingKey 精确路由。
 */
public class RoutingProducer {

    private static final String EXCHANGE_NAME = "logs_direct";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.exchangeDeclare(EXCHANGE_NAME, "direct");

            // 模拟发几条不同级别的日志
            String[][] logs = {
                    {"error",   "数据库连接失败"},
                    {"info",    "用户登录成功"},
                    {"warning", "磁盘使用率 80%"},
                    {"error",   "支付回调超时"}
            };
            for (String[] log : logs) {
                String severity = log[0];   // routingKey
                String text = log[1];        // 消息体
                channel.basicPublish(EXCHANGE_NAME, severity, null,
                        text.getBytes(StandardCharsets.UTF_8));
                System.out.println("[x] 发布 [" + severity + "] " + text);
            }
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

完整消费者（只关心 error + warning 的告警消费者）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Routing 消费者：只绑定 error 和 warning，精确接收对应级别日志。
 * 想收全部级别就再 queueBind 一个 "info"。
 */
public class RoutingConsumer {

    private static final String EXCHANGE_NAME = "logs_direct";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.exchangeDeclare(EXCHANGE_NAME, "direct");
            String queueName = channel.queueDeclare().getQueue();

            // 多重绑定：这个队列同时收 error 和 warning
            channel.queueBind(queueName, EXCHANGE_NAME, "error");
            channel.queueBind(queueName, EXCHANGE_NAME, "warning");

            DeliverCallback deliverCallback = (consumerTag, delivery) -> {
                String msg = new String(delivery.getBody(), StandardCharsets.UTF_8);
                System.out.println("[x] 收到 [" + delivery.getEnvelope().getRoutingKey() + "] " + msg);
            };

            channel.basicConsume(queueName, true, deliverCallback, consumerTag -> {});

            System.out.println("[*] 只收 error/warning，按 Ctrl+C 退出");
            System.in.read();
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

### 2.5 ⑤ Topics（主题模式 / Topic）

`direct` 只能精确匹配，太死板。`topic` 交换机支持**通配符模糊匹配**，是生产里最常用、最灵活的一种。

**规则：**

- routingKey 和 binding key 都是用 `.` 分隔的**多个单词**，例如 `usa.weather.sunny`、`china.news.sports`。
- `*` 匹配**恰好一个**单词。
- `#` 匹配**零个或多个**单词。

```text
示例 binding key 与匹配情况：
  binding key = *.orange.*      能匹配：a.orange.b / x.orange.y
                          不匹配：orange.a（少一段）/ a.b.orange.c（多一段）
  binding key = lazy.#         能匹配：lazy / lazy.dog / lazy.cat.sleep（# 吃任意多段）
  binding key = *.*.rabbit     能匹配：a.b.rabbit
                          不匹配：rabbit.x（段数不对）
```

**匹配规则练习表（自己先猜，再看答案）：**

| 消息 routingKey | binding `*.orange.*` | binding `lazy.#` | binding `*.*.rabbit` |
| --- | --- | --- | --- |
| `a.orange.b` | ✅ 匹配 | ❌ 不匹配 | ❌ 不匹配 |
| `lazy.pig.dog` | ❌ 不匹配 | ✅ 匹配（`#` 吃 `pig.dog`） | ❌ 不匹配 |
| `a.b.rabbit` | ❌ 不匹配 | ❌ 不匹配 | ✅ 匹配 |
| `quick.orange.fox` | ✅ 匹配 | ❌ 不匹配 | ❌ 不匹配 |
| `lazy.orange.cat` | ❌ 不匹配 | ✅ 匹配（`#`= `orange.cat`） | ❌ 不匹配 |
| `orange` | ❌ 不匹配（只有一段） | ❌ 不匹配（首段非 lazy） | ❌ 不匹配 |

多维度路由实例：消息 `usa.weather.sunny` 可被"关心美国天气"的消费者（`usa.weather.*`）和"关心所有天气"的消费者（`#.weather.#`）同时收到。

特殊情况：binding key 为 `#` 等于 **fanout**（收所有）；不含通配符（如 `usa.news`）则等于 **direct**（精确匹配）。

完整生产者（topic）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Topics 生产者：用 topic 交换机，routingKey 用 "." 分隔多维度。
 */
public class TopicProducer {

    private static final String EXCHANGE_NAME = "news_topic";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.exchangeDeclare(EXCHANGE_NAME, "topic");

            // 多维度消息：<国家>.<类别>.<明细>
            String[][] messages = {
                    {"usa.weather.sunny",   "美国天气晴"},
                    {"china.news.sports",   "中国体育新闻"},
                    {"usa.news.politics",    "美国政治新闻"},
                    {"china.weather.rain",  "中国天气雨"}
            };
            for (String[] m : messages) {
                channel.basicPublish(EXCHANGE_NAME, m[0], null,
                        m[1].getBytes(StandardCharsets.UTF_8));
                System.out.println("[x] 发布 [" + m[0] + "] " + m[1]);
            }
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

完整消费者（关心"所有国家的天气"，`#.weather.#`）：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * Topics 消费者：用 #.weather.# 订阅所有天气消息（任意国家、任意明细）。
 * 想只收美国新闻就用 binding key "usa.#"，想收美国天气用 "usa.weather.*"。
 */
public class TopicConsumer {

    private static final String EXCHANGE_NAME = "news_topic";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.exchangeDeclare(EXCHANGE_NAME, "topic");
            String queueName = channel.queueDeclare().getQueue();

            // 通配符绑定：所有天气消息
            channel.queueBind(queueName, EXCHANGE_NAME, "#.weather.#");

            DeliverCallback deliverCallback = (consumerTag, delivery) -> {
                String msg = new String(delivery.getBody(), StandardCharsets.UTF_8);
                System.out.println("[x] 收到 [" + delivery.getEnvelope().getRoutingKey() + "] " + msg);
            };

            channel.basicConsume(queueName, true, deliverCallback, consumerTag -> {});

            System.out.println("[*] 订阅 #.weather.#，按 Ctrl+C 退出");
            System.in.read();
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

### 2.6 ⑥ RPC（远程调用）

用 MQ 做"请求—响应"：客户端把请求发到队列，带上 `replyTo`（回调队列名）和 `correlationId`（请求唯一标识）；服务端处理完，把结果发回 `replyTo`，客户端按 `correlationId` 对上号。

```text
[Client] ──发请求(exchange="",routingKey=rpc_queue, replyTo=临时队列, correlationId=UUID)──▶ [rpc_queue]
                                                                                                    │
                                                                                              [Server] 处理
                                                                                                    │ 发回结果
                                                                                                    ▼
[Client] ◀──收响应(replyTo 队列, correlationId 匹配)───────────────────────────────────── [临时回调队列]
```

完整客户端：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeoutException;

/**
 * RPC 客户端：发请求到 rpc_queue，带 replyTo + correlationId，阻塞等结果。
 */
public class RpcClient {

    private static final String REQUEST_QUEUE = "rpc_queue";

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            // 1) 回调队列：服务端把结果发回来
            String replyQueueName = channel.queueDeclare().getQueue();

            // 2) 请求唯一标识
            String corrId = UUID.randomUUID().toString();

            // 3) 主线程用阻塞队列等响应
            ArrayBlockingQueue<String> response = new ArrayBlockingQueue<>(1);

            // 4) 监听回调队列：只认 correlationId 匹配的响应
            DeliverCallback deliverCallback = (consumerTag, delivery) -> {
                if (delivery.getProperties().getCorrelationId().equals(corrId)) {
                    response.offer(new String(delivery.getBody(), StandardCharsets.UTF_8));
                }
            };
            channel.basicConsume(replyQueueName, true, deliverCallback, consumerTag -> {});

            // 5) 发请求：带上 replyTo 和 correlationId
            String request = "30"; // 求斐波那契第 30 项
            AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
                    .correlationId(corrId)
                    .replyTo(replyQueueName)
                    .build();
            channel.basicPublish("", REQUEST_QUEUE, props,
                    request.getBytes(StandardCharsets.UTF_8));
            System.out.println("[x] 请求 fib(" + request + ")，等待...");

            // 6) 阻塞取结果（生产环境一定要加超时，否则服务端挂了就永远等）
            String result = response.take();
            System.out.println("[.] 结果 = " + result);

        } catch (IOException | TimeoutException | InterruptedException e) {
            e.printStackTrace();
        }
    }
}
```

完整服务端：

```java
package com.canoe.rabbitmq;

import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeoutException;

/**
 * RPC 服务端：从 rpc_queue 取请求，计算后把结果发回 replyTo，带上 correlationId。
 */
public class RpcServer {

    private static final String REQUEST_QUEUE = "rpc_queue";

    // 模拟计算：斐波那契（仅为演示，生产别用递归）
    private static int fib(int n) {
        if (n < 0) return -1;
        if (n == 0) return 0;
        if (n == 1) return 1;
        return fib(n - 1) + fib(n - 2);
    }

    public static void main(String[] args) {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.queueDeclare(REQUEST_QUEUE, false, false, false, null);
            channel.basicQos(1); // 一次处理一条

            System.out.println("[x] RPC 服务端就绪");

            DeliverCallback deliverCallback = (consumerTag, delivery) -> {
                // 回包带上客户端的 correlationId
                AMQP.BasicProperties replyProps = new AMQP.BasicProperties.Builder()
                        .correlationId(delivery.getProperties().getCorrelationId())
                        .build();

                String responseText;
                try {
                    String request = new String(delivery.getBody(), StandardCharsets.UTF_8);
                    responseText = String.valueOf(fib(Integer.parseInt(request)));
                } catch (Exception e) {
                    responseText = "error: " + e.getMessage();
                } finally {
                    // 手动 ack，确认请求已处理
                    channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
                }

                // 把结果发回客户端的 replyTo 队列
                channel.basicPublish("", delivery.getProperties().getReplyTo(),
                        replyProps, responseText.getBytes(StandardCharsets.UTF_8));
            };

            channel.basicConsume(REQUEST_QUEUE, false, deliverCallback, consumerTag -> {});

            System.in.read();
        } catch (IOException | TimeoutException e) {
            e.printStackTrace();
        }
    }
}
```

::: danger 用 MQ 做同步 RPC 大多是反模式
RabbitMQ 的强项是**异步解耦**。把 MQ 当同步 RPC 用，等于把它的优点全丢了：
1. **丢了异步的意义**：客户端还要阻塞等结果，链路没解耦，MQ 挂了调用方照样挂。
2. **阻塞等待 + 超时难处理**：上面 `response.take()` 没有超时，服务端一挂客户端就永远卡住（生产必须加超时）。
3. **性能差**：比直接 HTTP/gRPC 多绕一圈序列化与 Broker 中转。

**什么时候才合理？** 只有两种：① 你**已经有 MQ 基础设施**，偶尔需要远程调一下，不想再引入一套 RPC 框架；② 调用本身是异步友好的，只是顺便要个回执。否则请直接用 HTTP / gRPC / Dubbo 做同步调用，MQ 只做异步通知。
:::

### 2.7 ⑦ Headers（几乎不用）

`headers` 交换机**不看 routingKey，而是按消息 `headers` 里的键值对匹配**。绑定队列时给一组 header 规则，消息带着 header 来，逐键比对。还有个特殊键 `x-match`：

- `x-match: all` → 消息必须**全部** header 都匹配。
- `x-match: any` → 消息**任意一个** header 匹配即可。

```java
// 绑定：只要 format=pdf 或 type=report 任一满足（x-match=any）
Map<String, Object> bindHeaders = new HashMap<>();
bindHeaders.put("x-match", "any");
bindHeaders.put("format", "pdf");
bindHeaders.put("type", "report");
channel.queueBind(queue, EXCHANGE, "", bindHeaders);

// 发消息：带 headers
Map<String, Object> msgHeaders = new HashMap<>();
msgHeaders.put("format", "pdf");
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
        .headers(msgHeaders).build();
channel.basicPublish(EXCHANGE, "", props, body);
```

::: warning 为什么几乎没人用 Headers
三个硬伤：① **性能差**，要逐键比对 map，比 routingKey 字符串匹配慢；② **不直观**，键值对规则不如 `error` / `usa.weather.*` 这种一看就懂；③ **完全能由 direct/topic 替代**——你真正要路由的维度，用 routingKey + 通配符表达更清晰。所以面试常说"Headers 了解即可，生产基本不用"。本文点到为止，不展开完整代码。
:::

## 三、四种交换机类型对比大表

| 交换机类型 | 路由依据 | 是否支持通配符 | 典型场景 |
| --- | --- | --- | --- |
| **direct** | routingKey **精确等于** binding key | 否 | 按关键词精确路由（日志级别、订单类型） |
| **fanout** | 无视 routingKey，**广播**给所有绑定队列 | 否 | 通知广播、缓存清理、事件扩散 |
| **topic** | routingKey 按 `.` 分词，用 `*` `#` **模糊匹配** | 是（`*` `#`） | 多维度路由（地域.类别.明细）、最灵活 |
| **headers** | 按消息 `headers` 键值对匹配（不看 routingKey） | 否 | 几乎不用，可用 topic 替代 |

::: tip 一个记忆口诀
direct = 精确对号；fanout = 全广播；topic = 带通配符的精确；headers = 看包裹面单上的标签。日常 90% 的场景 `topic` + `direct` + `fanout` 就够，**`topic` 最常用**。
:::

## 四、六种工作模式横向对比表

| 模式 | 交换机类型 | 队列数 | 消费者数 | 一条消息被消费几次 | 典型场景 |
| --- | --- | --- | --- | --- | --- |
| Hello World | 默认 direct | 1 | 1 | 1 次 | 跑通 demo、最简单通知 |
| Work Queues | 默认 direct | 1 | ≥1（竞争） | **1 次**（抢到的人处理） | 任务分发、提升吞吐 |
| Publish/Subscribe | fanout | ≥1 | ≥1 | **每个绑定队列各 1 次**（广播） | 系统通知、缓存同步 |
| Routing | direct | ≥1 | ≥1 | 按 binding key 匹配，可能 1~多次 | 日志分级、按类型分流 |
| Topics | topic | ≥1 | ≥1 | 按通配符匹配，可能 1~多次 | 多维路由、灵活订阅 |
| RPC | 默认 direct | 1（请求）+ 1（回调） | 1（服务端） | 请求 1 次，结果回传客户端 | 偶尔的远程调用（谨慎用） |
| Headers | headers | ≥1 | ≥1 | 按 header 匹配 | 几乎不用 |

## 五、选型决策文本图

遇到"该用哪个"时，照着这张图走：

```text
你要发消息给谁？
│
├─ 所有订阅者都要收到同一份？
│     └─▶ fanout（发布订阅）
│
├─ 要按多个维度 / 模糊关键词路由？
│     ├─ 关键词用 "." 分隔、要通配 → topic（最常用）
│     └─ 纯键值对匹配（少见）       → headers（不推荐）
│
├─ 要按某个具体值精确路由？
│     └─▶ direct（精确匹配）
│
├─ 要把一个任务分给多个 worker 分摊？
│     └─▶ Work Queues（一个队列 + 多个消费者竞争）
│
└─ 只是想 A 调 B 拿个返回值（同步）？
      └─▶ 别用 MQ！直接用 HTTP / gRPC；非要借 MQ 才用 RPC 模式
```

## 六、Queue 详解

### 6.1 queueDeclare 五参数逐个讲

声明队列的方法：

```java
channel.queueDeclare(String queue, boolean durable,
                     boolean exclusive, boolean autoDelete,
                     Map<String, Object> arguments)
```

| 参数 | 类型 | 含义 |
| --- | --- | --- |
| `queue` | String | 队列名；传空串让 Broker 随机命名（临时队列） |
| `durable` | boolean | **持久化**：true 表示队列元数据持久化到磁盘，Broker 重启还在（消息本身是否持久化看 `deliveryMode`，见第七章） |
| `exclusive` | boolean | **独占**：true 表示仅当前连接可用，连接关闭队列自动删 |
| `autoDelete` | boolean | **自动删**：true 表示最后一个消费者断开后，队列自动删 |
| `arguments` | `Map<String, Object>` | 队列额外参数（TTL、最大长度、死信等，见 6.3） |

```java
// 常见生产配置：持久化、非独占、非自动删
channel.queueDeclare("order_queue", true, false, false, null);
```

### 6.2 exclusive 和 autoDelete 的区别（讲透）

这两个最容易被混，给一张对比：

| 维度 | exclusive（独占） | autoDelete（自动删） |
| --- | --- | --- |
| 触发删除的条件 | **连接（Connection）关闭**就删 | **最后一个消费者断开**才删 |
| 谁能用这个队列 | 只有声明它的那个连接能用 | 任何连接都能用，只是没人消费了就删 |
| 典型用途 | 临时、私有的回调队列（如 RPC 的 replyTo） | 一次性任务队列，消费完即清理 |
| 注意 | 别的连接来 `queueDeclare` 同名会报 `RESOURCE_LOCKED` | 只要还有消费者连着就不删 |

::: warning 容易踩的混淆点
- `exclusive=true` 的队列，你换一个连接去 `basicConsume` 会失败（报 405 `RESOURCE_LOCKED`）。所以**长期业务队列务必 `exclusive=false`**。
- `autoDelete=true` 的队列，如果消费者全掉线就消失，未消费的消息一并没——**不想丢消息就 `autoDelete=false`**。
- 临时队列 `channel.queueDeclare().getQueue()` 默认是 `exclusive=true` + `autoDelete=true`，正好适合 RPC 回调这种"用完即弃"的场景。
:::

### 6.3 队列参数 arguments 说明

`arguments` 是个 `Map<String, Object>`，用来给队列加高级特性。常用键：

| 参数键 | 类型 | 作用 |
| --- | --- | --- |
| `x-message-ttl` | int（毫秒） | 队列里消息的存活时间，过期自动删 |
| `x-max-length` | int | 队列最大消息条数，超了按 `x-overflow` 策略处理 |
| `x-overflow` | String | `drop-head`（删最早的）/ `reject-publish`（拒收新消息） |
| `x-dead-letter-exchange` | String | 死信交换机：消息被拒/过期/队列满时转发到这里 |
| `x-dead-letter-routing-key` | String | 死信的 routingKey（可选） |
| `x-queue-mode` | String | `lazy`（消息优先落盘，省内存）/ `default` |

示例：建一个消息 60 秒过期、最多存 1000 条、满了丢最早的队列，并把死信转给 `dlx`：

```java
Map<String, Object> argsMap = new HashMap<>();
argsMap.put("x-message-ttl", 60000);            // 消息 60 秒后过期
argsMap.put("x-max-length", 1000);              // 最多 1000 条
argsMap.put("x-overflow", "drop-head");         // 满了丢最早的
argsMap.put("x-dead-letter-exchange", "dlx");   // 死信转发到 dlx
channel.queueDeclare("order_queue", true, false, false, argsMap);
```

::: tip 预告
死信队列（DLX）、延迟队列、lazy 模式都是生产中非常实用的高级特性，本专栏会在 **第 05 章（可靠性与高级特性）** 专门展开，这里先认识这些参数的名字即可。
:::

## 七、消息详细结构：AMQP.BasicProperties 全字段

每条消息的属性都在 `AMQP.BasicProperties` 里。完整字段表（按官方 Java 客户端）：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `deliveryMode` | int | **1 = 非持久（重启丢），2 = 持久（落盘）**；这是消息持久化的开关 |
| `contentType` | String | 内容类型，如 `application/json` |
| `contentEncoding` | String | 内容编码，如 `gzip` |
| `headers` | `Map<String, Object>` | 自定义键值对，业务透传（Headers 交换机就用它） |
| `expiration` | String | 单条消息 TTL（毫秒），到期删；队列级用 `x-message-ttl` |
| `priority` | int | 优先级（0~9），高优先级先被消费（需队列支持） |
| `correlationId` | String | 关联 ID，RPC 用来对请求/响应 |
| `replyTo` | String | 回调队列名，RPC 让服务端把结果发这 |
| `messageId` | String | 消息唯一 ID，业务自定义 |
| `timestamp` | Date | 消息时间戳 |
| `type` | String | 消息类型，业务自定义 |
| `userId` | String | 用户标识（Broker 会校验，少用） |
| `appId` | String | 产生消息的应用 ID |
| `clusterId` | String | **已废弃**，勿用 |

设置示例（持久化 JSON 消息，带 correlationId）：

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
        .deliveryMode(2)                       // 持久化
        .contentType("application/json")
        .correlationId("req-10086")
        .headers(java.util.Collections.singletonMap("traceId", "abc123"))
        .build();
channel.basicPublish("", "order_queue", props, json.getBytes(StandardCharsets.UTF_8));
```

::: warning deliveryMode 与队列 durable 是两回事
- **队列 `durable=true`**：Broker 重启后队列还在（但里面**没持久化的消息照样丢**）。
- **消息 `deliveryMode=2`**：这条消息落盘，Broker 重启后还在。
- 想要"重启不丢消息"，**两个都要**：队列 `durable=true` **且** 消息 `deliveryMode=2`（`MessageProperties.PERSISTENT_TEXT_PLAIN` 已含 `deliveryMode=2`）。只设一个都不保险。
:::

## 八、怎么创建资源：交换机 / 队列

### 8.1 界面手动创建 vs 代码声明

两种方式都能建交换机和队列：

- **Management UI**：Exchanges / Queues 面板点 "Add"，填名字选类型即可。适合调试、临时看效果。
- **代码声明**：生产推荐。把 `exchangeDeclare` / `queueDeclare` / `queueBind` 写进应用启动逻辑，保证"应用起来资源就在"。

```java
// 代码声明是幂等的：队列/交换机已存在且参数一致，重复声明不报错
channel.exchangeDeclare("logs_topic", "topic");
channel.queueDeclare("order_queue", true, false, false, null);
channel.queueBind("order_queue", "logs_topic", "order.created");
```

### 8.2 新手天坑：交换机/队列不存在就发消息会静默丢弃

这是 RabbitMQ 新手**排名第一的坑**：

```text
Producer 直接 basicPublish("不存在的交换机", "key", ...) 
   → Broker 找不到交换机 → 消息被丢弃（无异常！）
   → 你发现消费者啥也没收到，还以为代码错了
```

更隐蔽的是：发到**默认交换机**但 routingKey 没有对应队列，消息同样静默丢。所以铁律——**发消息前，确保目标交换机和队列已经声明（或已在 UI 建好）**。

排查方法：

- 去 Management 的 **Exchanges** 面板，看该交换机有没有 `Incoming` 消息计数在涨（有 incoming 说明生产者发到了）。
- 看交换机 `Bindings` 标签页，确认绑定到了正确的队列。
- 给关键业务配**备用交换机（Alternate Exchange）**：交换机声明时加 `alternate-exchange` 参数，匹配不上的消息转发到它，避免凭空丢失。

### 8.3 幂等 vs PRECONDITION_FAILED（406）

- `queueDeclare` / `exchangeDeclare` 是**幂等**的：同名同参数重复声明没问题。
- 但如果**参数不一致**（比如第一次 `durable=false`，第二次 `durable=true`），Broker 会报 **406 PRECONDITION_FAILED**，拒绝声明。

```text
第一次：queueDeclare("q", durable=false, ...)
第二次：queueDeclare("q", durable=true,  ...)  → 406 PRECONDITION_FAILED
```

::: danger 406 的解决
遇到 406，说明"你想改一个已存在资源的属性"。RabbitMQ 不允许原地改队列/交换机参数。正确做法：**删掉旧资源重建**（先 `queueDelete` / `exchangeDelete`，再按新参数声明），或者换一个新名字。注意删除会丢消息，生产环境要评估。
:::

## 九、常见坑清单

```text
┌──── 交换机与消息模型 · 坑清单 ───────────────────────────────┐
│ ① 队列没声明就发消息 → 静默丢弃                 │
│    → 发之前先 queueDeclare / 在 UI 建好         │
│                                                  │
│ ② 先启动生产者还是消费者？都能，但队列要先存在   │
│    → 两边都 queueDeclare 最稳                    │
│                                                  │
│ ③ routingKey 写错 → 消息被丢 / 进错队列          │
│    → UI 看交换机 Incoming 计数；配备用交换机兜底 │
│                                                  │
│ ④ 临时队列名随机，消费者重启会新建一个           │
│    → 临时队列只适合 RPC 回调；业务队列要固定名  │
│                                                  │
│ ⑤ basicConsume 后主线程退出 → 收不到消息         │
│    → 末尾 System.in.read() / CountDownLatch      │
│                                                  │
│ ⑥ fanout 下 routingKey 无效，别指望它路由        │
│    → fanout 一律广播，忽略 routingKey            │
│                                                  │
│ ⑦ topic 的 * 和 # 用混                           │
│    → * 一个词，# 零或多词，词间用 "." 分隔       │
│                                                  │
│ ⑧ 想改队列参数 → 406 PRECONDITION_FAILED         │
│    → 删了重建，或换名字                          │
└──────────────────────────────────────────────────┘
```

重点再强调两条：

- **④ 临时队列**：`channel.queueDeclare().getQueue()` 每次都返回新名字。如果你拿它当业务队列，消费者一重启就新建一个空队列，旧消息还在旧队列里没人消费——所以**业务队列一定要用固定名字 + `durable=true`**，临时队列只给 RPC 回调这种一次性场景用。
- **⑤ 主线程退出**：和 01 章一样，`basicConsume` 是异步监听，主线程必须阻塞（本文所有消费者示例都用了 `System.in.read()`）。生产里用 `CountDownLatch` 或交给 Spring 容器生命周期管理。

## 本篇小结

- **Exchange 是分拣员**：生产者只把消息交给交换机，**从不知道队列名**；交换机按 Binding 规则把消息投到队列，**自己不存消息**。
- **六种工作模式**：Hello World（单线）、Work Queues（竞争消费，一条只被一个处理）、Publish/Subscribe（fanout 广播，每个绑定队列各一份）、Routing（direct 精确匹配）、Topics（topic 通配符模糊匹配）、RPC（请求/响应）、Headers（按 header 匹配，几乎不用）。
- **不公平分发 = `basicQos(1)` + `autoAck=false` + `basicAck`**，缺一不可；prefetch 控制预取上限，`1` 最常用。
- **topic 通配符**：`*` 恰好一个词、`#` 零个或多个词，词用 `.` 分隔；binding `#` 等于 fanout、无通配符等于 direct。
- **四种交换机**：direct（精确）/ fanout（广播）/ topic（模糊，最常用）/ headers（看 header，不推荐）。
- **Queue 五参数**：`durable`（重启队列在）、`exclusive`（连接关即删、独占）、`autoDelete`（最后消费者断即删）；**exclusive 和 autoDelete 触发条件不同**，业务队列都要设 false。
- **消息结构**：`AMQP.BasicProperties` 全字段；`deliveryMode=2` 才持久化，且要和**队列 `durable=true` 配合**才重启不丢。
- **资源创建**：代码 `declare` 幂等；**队列/交换机不存在就发消息会静默丢**（头号天坑）；参数不一致声明报 **406 PRECONDITION_FAILED**，需删了重建。
- **RPC 是反模式预警**：用 MQ 做同步 RPC 大多不合适，会丢失异步优势、阻塞等待难处理；仅在已有 MQ 基建且偶尔调用时才考虑。
- **排查静默丢**：去 Management 看交换机的 `Incoming` 计数与 `Bindings`，给关键业务配备用交换机兜底。

## 参考链接

- RabbitMQ 官方 Tutorials（六种模式原版）：<https://www.rabbitmq.com/tutorials>
- 交换机类型（Exchange Types）官方文档：<https://www.rabbitmq.com/docs/exchanges>
- 发布订阅与绑定（Bindings）：<https://www.rabbitmq.com/docs/tutorials#pub-sub>
- Topics 通配符规则：<https://www.rabbitmq.com/tutorials/tutorial-five-java>
- 工作队列与公平分发（prefetch / ack）：<https://www.rabbitmq.com/docs/consumer-prefetch>
- RPC 模式（含反模式说明）：<https://www.rabbitmq.com/tutorials/tutorial-six-java>
- 队列参数（TTL / 死信 / overflow）：<https://www.rabbitmq.com/docs/queues>
- AMQP 0-9-1 协议与 BasicProperties 字段：<https://www.rabbitmq.com/docs/amqp-0-9-1-reference>

下一篇 → [03 Spring Boot 整合实战](/java/middleware/rabbitmq/springboot)
