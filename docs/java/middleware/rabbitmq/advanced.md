# 05 高级特性与延迟队列

> 本篇导读：前几篇我们学会了怎么"发消息、收消息、保证不丢"。但真实业务里还有很多刁钻需求：订单 30 分钟没付款就自动关单、预约前 15 分钟发提醒、消息处理失败了 5 分钟后再试一次、异常消息不能静默消失要有人工兜底。这些需求 RabbitMQ 都能优雅搞定，但要用对"高级特性"。本篇从最基础的 TTL（存活时间）讲起，串到死信队列、延迟队列、优先级队列、惰性队列、备份交换机，最后给你一份"坑清单"。读完你不仅能写出可运行的代码，还能讲清楚"为什么不能那么写"。

## 本篇要解决的问题

- 一条消息我想让它"最多活 10 秒"再被丢弃，怎么设？设队列上还是设消息上？
- 为什么设置了 TTL，队列中间的"老消息"却没有按时消失？
- 消息消费失败、或者超时被丢弃，能不能先拐个弯进一个"收尸队列"留个底？
- 下单 30 分钟未支付自动关闭，用 RabbitMQ 到底有哪些套路？哪个最靠谱？
- 延迟队列插件 `rabbitmq_delayed_message_exchange` 怎么装、怎么写、有哪些坑？
- 优先级队列是不是设了就一定先处理重要的？惰性队列为什么能让百万消息不爆内存？
- 消息路由不到队列，会不会被"悄悄扔掉"？怎么抓住这种丢消息？

这一篇逐个讲透，每个点都配完整可运行代码。

## 一、消息 TTL（存活时间）

### 1.1 先打个比方

TTL 是 Time-To-Live（存活时间）的缩写。打个比方：你去便利店买关东煮，每串上面挂个小牌子写着"**超过 4 小时没卖出去就下架销毁**"。这个"4 小时"就是 TTL。

在 RabbitMQ 里，TTL 指的是**一条消息或整个队列里的消息，在没被消费之前最多能"活"多久**。一旦超过这个时间还没被取走，RabbitMQ 就会把这条消息处理掉（默认是直接丢弃；如果配了死信队列，就转去死信队列，后面第二节讲）。

::: tip 一句话记住
TTL 就是消息的"保质期"。过期了怎么办，取决于你有没有配死信队列——没配就丢，配了就转走。
:::

### 1.2 队列级别 TTL：`x-message-ttl`

这是给**整个队列**设置一个统一的"保质期"。队列里每一条消息，从进队列那一刻开始计时，超过这个时间还没被消费，就会被判定过期。

设置方式是在声明队列时加参数 `x-message-ttl`，单位是**毫秒**。

```java
package com.canoe.rabbitmq.advanced.ttl;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class QueueTtlConfig {

    // 队列里所有消息最多活 10 秒（10000 毫秒）
    @Bean
    public Queue ttlQueue() {
        return QueueBuilder.durable("ttl.queue")
                // x-message-ttl 单位毫秒，10000 = 10 秒
                .withArgument("x-message-ttl", 10000)
                .build();
    }
}
```

`x-message-ttl` 的取值规则：
- 必须是非负整数（毫秒）。
- 设为 `0` 表示"不限制"（即消息永不过期），这点不少人会误以为"0 秒就立刻过期"，**错！0 是不过期**。如果你确实想"立刻过期"，要给很小的正数，比如 `1`。

### 1.3 消息级别 TTL：`MessageProperties.setExpiration()`

有时候你不希望整个队列统一过期，而是**每条消息各自带一个保质期**。比如 A 订单要 30 分钟关单，B 订单只给 5 分钟，它们进同一个队列但 TTL 不同——这时候就得用消息级 TTL。

原生 amqp-client 写法：

```java
package com.canoe.rabbitmq.advanced.ttl;

import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

public class MessageTtlProducer {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            channel.queueDeclare("order.queue", true, false, false, null);

            // 构造消息属性，设置单条消息的过期时间
            AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
                    .deliveryMode(2)                       // 2 = 持久化消息
                    // 这条消息 30 分钟后过期（30 * 60 * 1000 毫秒）
                    .expiration(String.valueOf(Duration.ofMinutes(30).toMillis()))
                    .build();

            String body = "order-10086";
            channel.basicPublish("", "order.queue", props, body.getBytes(StandardCharsets.UTF_8));
            System.out.println("已发送带 30 分钟 TTL 的消息：" + body);
        }
    }
}
```

Spring Boot 写法（更常用）：

```java
package com.canoe.rabbitmq.advanced.ttl;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
public class MessageTtlSender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void sendWithTtl(String content, long ttlMillis) {
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        // 单条消息的过期时间，单位毫秒
        properties.setExpiration(String.valueOf(ttlMillis));

        Message message = MessageBuilder.withBody(content.getBytes(StandardCharsets.UTF_8))
                .andProperties(properties)
                .build();

        rabbitTemplate.send("order.exchange", "order.routing", message);
    }
}
```

注意 `expiration` 这个字段在 AMQP 协议里是 `String` 类型（虽然它表达的是毫秒数），所以要用 `String.valueOf(...)` 转一下，别直接塞 `long`。

### 1.4 两者并存时取较小值

如果一个队列既设了队列级 `x-message-ttl`，你发的消息又带了消息级 `expiration`，那**最终这条消息的寿命取"两者里更小"的那个**。

```text
队列 TTL = 30 分钟，消息 TTL = 1 分钟
→ 这条消息实际 1 分钟后过期（取较小值）

队列 TTL = 10 秒，消息 TTL = 1 小时
→ 这条消息实际 10 秒后过期（取较小值）
```

::: warning 别想反了
不是"叠加"，不是"取大"，是**取小**。这条规则非常关键，后面延迟队列方案 A 的坑就和它有关。
:::

### 1.5 实现机制的坑（重点）

这是本篇最容易被面试官追问、也最容易在线上翻车的地方。**务必理解清楚**。

很多人以为：RabbitMQ 给每条消息起了一个定时器，到点就删。这是**完全错误的**。

RabbitMQ 的真实实现是：**它并不会为每条消息单独起定时器**。消息过期判定只发生在一种情况——**当这条消息被"挪到队列头部（队首）、准备投递给消费者"的那一刻**，RabbitMQ 才检查它有没有过期。如果过期了，这条消息就被丢弃（或转死信）；没过期才投递。

这意味着一个非常反直觉的现象：

> 队列中间的、甚至队尾的"早该过期"的消息，只要还没轮到它排到队首，就**不会**被立即删除，会一直占着队列。只有当排在它前面的消息都被消费/取走、它终于"浮"到队首时，才会被判定过期。

```text
队列（队首在左）：
[ msg-A  TTL=30分钟 ]  [ msg-B  TTL=1分钟 ]  [ msg-C  TTL=1分钟 ]

时间走到 1 分钟后：
  msg-B、msg-C 都已经"理论过期"了
  但因为 msg-A 还在队首没被取走，B、C 轮不到队首
  → B、C 不会被删除，依然躺在队列里！

直到 msg-A 被消费、出队：
  队首变成 msg-B → 判定"已过期" → 丢弃/转死信
```

::: danger 这个坑对"延迟精度"的影响
因为过期判定只看队首，所以：
1. **队列里有没消费的消息时，过期消息不能及时清理**，会一直占用内存和磁盘，也会让队列的"消息数"统计虚高。
2. 如果你指望"TTL 队列"当精确延迟队列用，会出问题——只要队首是一条长 TTL 的消息，后面的短 TTL 消息就被"堵住"了（这正是第三节方案 A 的致命缺陷）。
3. 队列级别的 `x-message-ttl` 只是"软限制"，不代表消息到点立刻消失。

记住一句话：**TTL 不是定时器，是"轮到它时的一次过期检查"。**
:::

### 1.6 `x-message-ttl=0` 表示不限制

前面提过，把 `x-message-ttl` 设成 `0` 并不是"立刻过期"，而是**不限制存活时间（永不过期）**。

```java
package com.canoe.rabbitmq.advanced.ttl;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class NoTtlConfig {

    // 0 表示队列里的消息永不过期（不限制）
    @Bean
    public Queue neverExpireQueue() {
        return QueueBuilder.durable("no.ttl.queue")
                .withArgument("x-message-ttl", 0)
                .build();
    }
}
```

### 1.7 完整 pom.xml 与 application.yml（本篇通用）

本篇所有 Spring Boot 示例共用下面这套依赖与配置。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.canoe</groupId>
    <artifactId>rabbitmq-advanced</artifactId>
    <version>1.0.0</version>
    <name>rabbitmq-advanced</name>

    <properties>
        <!-- 统一在 properties 里管版本，避免散落各处对不齐 -->
        <java.version>17</java.version>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <spring-boot.version>3.5.5</spring-boot.version>
        <amqp-client.version>5.24.0</amqp-client.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-amqp</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <!-- 原生 amqp-client，部分示例需要直接操作 Channel -->
        <dependency>
            <groupId>com.rabbitmq</groupId>
            <artifactId>amqp-client</artifactId>
            <version>${amqp-client.version}</version>
        </dependency>
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

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest
    # 虚拟主机，默认 /
    virtual-host: /
    # 生产环境强烈建议打开 publisher returns，配合 mandatory 抓"路由不到"的消息
    publisher-returns: true
    # 开启发布确认（confirm），保证消息到达 broker
    publisher-confirm-type: correlated
    listener:
      simple:
        # 手动 ACK，自己控制什么时候确认
        acknowledge-mode: manual
        # 预取数量，控制一次拉多少条到客户端（限流用，详见第八节）
        prefetch: 10

# 自定义业务配置示例（订单关单延迟用）
order:
  close:
    delay-minutes: 30
```

## 二、死信队列 DLX（Dead Letter Exchange）

### 2.1 什么是死信

"死信"（Dead Letter）顾名思义，就是**一条"死掉"的消息**——它没法被正常消费、或者被 RabbitMQ 主动判定要移除，但 RabbitMQ 又不想直接把它扔进虚空，于是把它**转发到另一个交换机**，再由那个交换机路由到一个专门的"收尸队列"。这个收尸队列就是死信队列（DLX = Dead Letter Exchange，严格说是"死信交换机"，但大家习惯叫死信队列）。

打个比方：快递送不到收件人手里（拒收 / 地址过期 / 包裹超体积），快递公司不会随手扔掉，而是退回"问题件处理中心"登记造册、等人工处理。DLX 就是 RabbitMQ 的"问题件处理中心"。

### 2.2 三种变死信的情况

消息变成死信，**有且仅有下面三种情况**，逐一讲：

1. **消费者拒绝且不再重回队列**：消费者调用 `basicReject` 或 `basicNack`，并且 `requeue=false`。意思是"这条我处理不了，也别再塞回队列了"——于是它变死信。
2. **消息 TTL 过期**：队列或消息设置了 TTL，消息在队列里待到过期（且没被消费），变死信。
3. **队列达到最大长度被丢弃**：队列设了 `x-max-length` 或 `x-max-length-bytes`，新消息进来把旧消息"顶出去"了，被顶出去的旧消息变死信。

::: tip 记住这三种触发条件
- 被拒绝：`basicReject`/`basicNack` + `requeue=false`
- 过期：TTL 到点
- 溢出：队列满了被挤掉

除此之外，正常被 `basicAck` 确认的消息**不会**进死信队列。
:::

### 2.3 原理 ASCII 图

```text
            正常业务队列                       死信交换机(DLX)                死信队列
        +-------------------+            +--------------------+        +-------------------+
发布 →  |  order.queue      | 死信(DLX)  |  dlx.exchange      | 路由   |  dl.queue         |
        |  (x-dead-letter-  | ---------> |  (通常是 fanout/   | -----> |  死信消费者在这里  |
        |   exchange=dlx)   |            |   direct)          |        |  做人工兜底/重试  |
        +-------------------+            +--------------------+        +-------------------+
                  |
                  | 三种情况之一触发：
                  | 1) 消费者 reject/nack 且 requeue=false
                  | 2) 消息 TTL 过期
                  | 3) 队列超长被挤掉
                  v
           消息被"拐弯"进 dlx.exchange，再路由到 dl.queue
```

### 2.4 配置参数

给业务队列加两个参数即可把它"拐弯"到死信交换机：

- `x-dead-letter-exchange`：死信交换机的名字。
- `x-dead-letter-routing-key`：可选，死信被转发时用的路由键（不填就沿用原消息的路由键）。

### 2.5 原生 amqp-client 版完整代码

```java
package com.canoe.rabbitmq.advanced.dlx;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class DlxNativeDemo {

    private static final String BUSINESS_QUEUE = "dlx.business.queue";
    private static final String DEAD_EXCHANGE = "dlx.exchange";
    private static final String DEAD_QUEUE = "dlx.dead.queue";

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setUsername("guest");
        factory.setPassword("guest");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            // 1) 声明死信交换机 + 死信队列，并绑定
            channel.exchangeDeclare(DEAD_EXCHANGE, "direct", true);
            channel.queueDeclare(DEAD_QUEUE, true, false, false, null);
            channel.queueBind(DEAD_QUEUE, DEAD_EXCHANGE, "dead.key");

            // 2) 声明业务队列，挂上死信参数
            Map<String, Object> argsMap = new HashMap<>(8);
            argsMap.put("x-dead-letter-exchange", DEAD_EXCHANGE);
            argsMap.put("x-dead-letter-routing-key", "dead.key");
            // 顺便演示 TTL 过期也会进死信（10 秒）
            argsMap.put("x-message-ttl", 10000);
            channel.queueDeclare(BUSINESS_QUEUE, true, false, false, argsMap);
            // 业务队列绑定到默认交换机，用队列名当路由键
            channel.queueBind(BUSINESS_QUEUE, "", BUSINESS_QUEUE);

            // 3) 死信消费者：专门处理"问题件"
            DeliverCallback deadCallback = (consumerTag, delivery) -> {
                String msg = new String(delivery.getBody(), StandardCharsets.UTF_8);
                System.out.println("[死信消费者] 收到问题件：" + msg);
                channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
            };
            channel.basicConsume(DEAD_QUEUE, false, deadCallback, consumerTag -> {});

            // 4) 业务消费者：手动拒绝一条，让它变死信
            DeliverCallback bizCallback = (consumerTag, delivery) -> {
                String msg = new String(delivery.getBody(), StandardCharsets.UTF_8);
                System.out.println("[业务消费者] 处理失败，拒绝并转死信：" + msg);
                // requeue=false → 这条消息变成死信，被转发到 dlx.exchange
                channel.basicReject(delivery.getEnvelope().getDeliveryTag(), false);
            };
            channel.basicConsume(BUSINESS_QUEUE, false, bizCallback, consumerTag -> {});

            // 5) 发一条测试消息
            channel.basicPublish("", BUSINESS_QUEUE, null,
                    "hello-dlx".getBytes(StandardCharsets.UTF_8));

            Thread.sleep(2000);
        }
    }
}
```

### 2.6 Spring Boot 注解声明版

```java
package com.canoe.rabbitmq.advanced.dlx;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class DlxConfig {

    public static final String BUSINESS_QUEUE = "dlx.business.queue";
    public static final String DEAD_EXCHANGE = "dlx.exchange";
    public static final String DEAD_QUEUE = "dlx.dead.queue";
    public static final String DEAD_ROUTING_KEY = "dead.key";

    // 死信交换机
    @Bean
    public DirectExchange deadExchange() {
        return new DirectExchange(DEAD_EXCHANGE, true, false);
    }

    // 死信队列
    @Bean
    public Queue deadQueue() {
        return QueueBuilder.durable(DEAD_QUEUE).build();
    }

    @Bean
    public Binding deadBinding() {
        return BindingBuilder.bind(deadQueue())
                .to(deadExchange())
                .with(DEAD_ROUTING_KEY);
    }

    // 业务队列，挂死信参数
    @Bean
    public Queue businessQueue() {
        Map<String, Object> argsMap = new HashMap<>(8);
        argsMap.put("x-dead-letter-exchange", DEAD_EXCHANGE);
        argsMap.put("x-dead-letter-routing-key", DEAD_ROUTING_KEY);
        argsMap.put("x-message-ttl", 10000);
        return QueueBuilder.durable(BUSINESS_QUEUE)
                .withArguments(argsMap)
                .build();
    }
}
```

```java
package com.canoe.rabbitmq.advanced.dlx;

import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Component
public class DlxConsumer {

    // 业务消费者：处理失败就拒绝，转死信
    @RabbitListener(queues = DlxConfig.BUSINESS_QUEUE)
    public void onBusiness(Message message,
                           @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag,
                           Channel channel) throws IOException {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        System.out.println("[业务] 处理失败，转死信：" + body);
        // requeue=false 才会变死信
        channel.basicReject(deliveryTag, false);
    }

    // 死信消费者：兜底处理
    @RabbitListener(queues = DlxConfig.DEAD_QUEUE)
    public void onDead(Message message,
                       @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag,
                       Channel channel) throws IOException {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        System.out.println("[死信兜底] 收到：" + body);
        channel.basicAck(deliveryTag, false);
    }
}
```

### 2.7 `x-death` header 的结构

重点来了：**消息变成死信被转发到 DLX 时，RabbitMQ 会往消息里塞一个特殊的 header，叫 `x-death`**。它记录了"这条消息是怎么死的、从哪个队列死的、死了几次"。

`x-death` 是一个数组（每个死信事件一项），每一项的字段如下：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `queue` | `String` | 消息原本所在的队列名 |
| `reason` | `String` | 死亡原因：`rejected`（被拒绝）、`expired`（TTL 过期）、`maxlen`（队列超长溢出） |
| `count` | `long` | 该队列里这条消息"死过几次"（同队列反复死会累加） |
| `exchange` | `String` | 消息原本被发布到的交换机 |
| `routing-keys` | `List<String>` | 消息原本用的路由键列表 |
| `time` | `long` (timestamp) | 死亡发生的时间戳 |

::: warning 4.0 版本一个行为变化
RabbitMQ 4.0 起，**当客户端把一条死信消息重新发布（republish）时，broker 不再自动解析/合并旧的 `x-death` header**（官方把这块逻辑简化了）。但这**不影响**"死信产生时 RabbitMQ 写入 `x-death`"这件事——死信消费者读取 `x-death` 来排查"为什么死的、从哪死的"依然完全有效。所以本节的读取代码在 4.x 照常工作。
:::

### 2.8 消费死信时读取 `x-death` 的代码

```java
package com.canoe.rabbitmq.advanced.dlx;

import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@Component
public class DeadLetterInspector {

    @RabbitListener(queues = DlxConfig.DEAD_QUEUE)
    public void inspect(Message message,
                        @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag,
                        Channel channel) throws IOException {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        System.out.println("[死信] 内容=" + body);

        // 读取 x-death header（它本质是一个 List<Map<String, Object>>）
        Object xdeathObj = message.getMessageProperties().getHeaders().get("x-death");
        if (xdeathObj instanceof List) {
            List<Map<String, Object>> xdeath = (List<Map<String, Object>>) xdeathObj;
            for (Map<String, Object> entry : xdeath) {
                String queue = String.valueOf(entry.get("queue"));
                String reason = String.valueOf(entry.get("reason"));
                Object count = entry.get("count");
                Object time = entry.get("time");
                System.out.println("  来源队列=" + queue
                        + " | 死因=" + reason
                        + " | 次数=" + count
                        + " | 时间=" + time);
            }
        }
        channel.basicAck(deliveryTag, false);
    }
}
```

通过 `reason` 字段你能清楚知道是"被拒了、过期了、还是被挤出去了"，通过 `queue` 知道它从哪个业务队列来的——**这是线上排查死信来源最关键的信息**。

### 2.9 典型用途

- **失败重试兜底**：消费者处理抛异常，拒绝并转死信，死信消费者做"告警 + 人工介入"，而不是让消息无限重投把正常流程拖死。
- **超时未支付订单**：订单创建时发一条带 TTL 的消息，TTL 到了进死信，死信消费者去查数据库——如果还是"未支付"就关单。这就是第三节实战的基础。
- **异常消息人工介入**：无法自动处理的脏数据集中到死信队列，运维在管理界面查看、手动重投递。

## 三、延迟队列（本章重头戏）

### 3.1 需求场景

"我想让一条消息在**未来某个时间点**才被消费"，这是一类超级常见需求：

- 下单 30 分钟未支付 → 自动关闭订单、回库存。
- 预约就诊前 15 分钟 → 发短信提醒。
- 任务执行失败 → 5 分钟后再试一次。
- 优惠券 7 天后过期 → 提前 1 天推送"即将到期"。

RabbitMQ **本身没有"原生延迟队列"**，但可以用几种方案"拼"出来。下面按"从土办法到官方推荐"的顺序讲。

### 3.2 方案 A：TTL + 死信队列

思路一句话：**让消息先进一个"等死"的 TTL 队列，过期后自动进死信队列，死信消费者在那一刻才真正处理它**。因为过期的消息会被转去 DLX，所以"被死信消费的时间"≈"TTL 到期时间"，实现了"延迟"。

完整实现：

```java
package com.canoe.rabbitmq.advanced.delay;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class DelayByDlxConfig {

    public static final String DELAY_QUEUE = "delay.wait.queue";
    public static final String DELAY_EXCHANGE = "delay.wait.exchange";
    public static final String REAL_QUEUE = "delay.real.queue";
    public static final String REAL_EXCHANGE = "delay.real.exchange";
    public static final String ROUTING_KEY = "delay.route";

    // 1) 等待队列：带 TTL + 死信参数
    @Bean
    public Queue waitQueue() {
        Map<String, Object> argsMap = new HashMap<>(8);
        // 消息级 TTL 我们用 setExpiration 控制，这里不写队列级
        argsMap.put("x-dead-letter-exchange", REAL_EXCHANGE);
        argsMap.put("x-dead-letter-routing-key", ROUTING_KEY);
        return QueueBuilder.durable(DELAY_QUEUE).withArguments(argsMap).build();
    }

    // 2) 等待交换机
    @Bean
    public DirectExchange waitExchange() {
        return new DirectExchange(DELAY_EXCHANGE, true, false);
    }

    @Bean
    public Binding waitBinding() {
        return BindingBuilder.bind(waitQueue()).to(waitExchange()).with(ROUTING_KEY);
    }

    // 3) 真正处理延迟消息的队列
    @Bean
    public Queue realQueue() {
        return QueueBuilder.durable(REAL_QUEUE).build();
    }

    @Bean
    public DirectExchange realExchange() {
        return new DirectExchange(REAL_EXCHANGE, true, false);
    }

    @Bean
    public Binding realBinding() {
        return BindingBuilder.bind(realQueue()).to(realExchange()).with(ROUTING_KEY);
    }
}
```

```java
package com.canoe.rabbitmq.advanced.delay;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
public class DelayByDlxSender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    // 发送一条"延迟 delayMillis 毫秒后处理"的消息
    public void sendDelay(String content, long delayMillis) {
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        // 消息级 TTL：到时间才被判定过期 → 转死信 → 被真正消费
        properties.setExpiration(String.valueOf(delayMillis));

        Message message = MessageBuilder.withBody(content.getBytes(StandardCharsets.UTF_8))
                .andProperties(properties)
                .build();

        rabbitTemplate.send(DelayByDlxConfig.DELAY_EXCHANGE,
                DelayByDlxConfig.ROUTING_KEY, message);
    }
}
```

```java
package com.canoe.rabbitmq.advanced.delay;

import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Component
public class DelayByDlxConsumer {

    // 真正在"延迟到期"时才执行
    @RabbitListener(queues = DelayByDlxConfig.REAL_QUEUE)
    public void onDelay(Message message,
                        @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag,
                        Channel channel) throws IOException {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        System.out.println("[延迟到期] 现在才处理：" + body);
        channel.basicAck(deliveryTag, false);
    }
}
```

### 3.3 方案 A 致命缺陷：队头阻塞

方案 A 能跑，但有个**致命缺陷**，面试几乎必问，线上也极容易踩。

回到第一节 1.5 讲过的机制：**消息过期判定只在"轮到队首"时发生**。于是有这样一个场景：

```text
等待队列（队首在左）：
[ msg-30min  TTL=30分钟 ]  [ msg-1min  TTL=1分钟 ]

理想：1 分钟后 msg-1min 就该进死信被处理
现实：因为 msg-30min 堵在队首，msg-1min 要等 30 分钟那条先出队
      → msg-1min 在第 30 分钟 + 1 分钟时才被处理！
```

也就是说：**如果队列里第一条是长 TTL、第二条是短 TTL，第二条会被第一条"堵住"**，短延迟的消息被迫等长的那条走完。这就是"队头阻塞"（Head-of-Line Blocking）。

```text
时间线（假设队列里有 A=30min, B=1min, C=5min）：
t=0   入队: [A(30)] [B(1)] [C(5)]
t=1m  B 理论过期了，但 A 还在队首 → B 不动
t=5m  C 理论过期了，但 A 还在队首 → C 不动
t=30m A 终于被消费出队 → 队首变 B → B 判过期 → 进死信（晚到了 29 分钟！）
t=30m 队首变 C → C 判过期 → 进死信（晚到了 25 分钟！）
```

::: danger 结论
**一个 TTL 等待队列，只能放"同一档"延迟的消息**。多档延迟必须：
- 要么建多个队列（每个队列固定一档 TTL，比如 `delay.1min`、`delay.5min`、`delay.30min`）；
- 要么直接上方案 B 的延迟插件（推荐）。
:::

### 3.4 方案 B：延迟消息插件 `rabbitmq_delayed_message_exchange`（推荐）

官方社区提供的插件，专门解决"任意延迟时间"的问题。它**没有队头阻塞**，一条消息延迟多久就准点多久。

### 3.5 方案 B 安装方式

RabbitMQ 4.x 起官方镜像**不再默认自带**这个插件（部分社区镜像会带），需要手动启用或安装。

方式一：命令行启用（镜像里已有 `.ez` 文件时）

```bash
# 进入容器
docker exec -it rabbitmq /bin/bash

# 启用插件
rabbitmq-plugins enable rabbitmq_delayed_message_exchange

# 查看插件是否启用（带 [E*] 表示已启用）
rabbitmq-plugins list | grep delayed
```

方式二：镜像里没有，先下载再装（**插件版本必须与 RabbitMQ 版本匹配**）

```bash
# 查看你的 RabbitMQ 版本
docker exec rabbitmq rabbitmqctl version

# 去 GitHub Releases 下载对应版本的 .ez 文件
# 地址：https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases
# 例如 RabbitMQ 4.0.x 对应下载 v4.0.7 的包

# 把下载好的 .ez 拷进容器
docker cp rabbitmq_delayed_message_exchange-4.0.7.ez rabbitmq:/plugins/

# 启用
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

方式三：写进自定义 Dockerfile（一劳永逸）

```dockerfile
FROM rabbitmq:4.1-management-alpine

# 下载与 RabbitMQ 大版本匹配的插件（这里是 4.1）
RUN apk add --no-cache wget && \
    cd /opt/rabbitmq/plugins && \
    wget https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v4.1.0/rabbitmq_delayed_message_exchange-4.1.0.ez && \
    rabbitmq-plugins enable --offline rabbitmq_delayed_message_exchange && \
    apk del wget
```

::: danger 版本匹配警告
插件是和 RabbitMQ **同版本号构建**的。RabbitMQ 是 4.0.x 就下 4.0.x 的插件，是 4.1.x 就下 4.1.x 的插件，**大版本对不上节点可能起不来或插件加载失败**。另外该插件仓库原维护已停止在 4.2，4.2+ 不保证可用，生产请锁定到与你服务端同一小版本的插件。
:::

### 3.6 方案 B 原理

这个插件引入了一种**新的交换机类型** `x-delayed-message`。它的工作方式：

1. 你声明一个类型为 `x-delayed-message` 的交换机，并额外指定 `x-delayed-type`（它底层"伪装"成哪种普通交换机，比如 `direct` / `topic` / `fanout`）。
2. 发消息时，在消息 header 里放一个 `x-delay`（毫秒数），表示"延迟多久再路由"。
3. **插件内部用 Mnesia 表按到期时间排序存着这些消息**，到点了才把消息真正路由到绑定的队列。
4. 因为是按"到期时间"直接触发路由，而不是靠"队首过期判定"，所以**没有队头阻塞**。

```text
生产者 → x-delayed-message 交换机（Mnesia 里按到期时间排队）
                  |
                  | 时间没到：安静等着
                  | 时间到了：才路由到真正的队列
                  v
            业务队列 → 消费者准点收到
```

### 3.7 方案 B 声明 `CustomExchange`

Spring AMQP 里没有现成的 `DelayedExchange` 类，要用 `CustomExchange`，并把 `type` 设为 `x-delayed-message`，再补一个 `x-delayed-type` 参数。这是**固定写法**，务必照抄：

```java
package com.canoe.rabbitmq.advanced.delay.plugin;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.CustomExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class DelayedPluginConfig {

    public static final String DELAYED_EXCHANGE = "canoe.delayed.exchange";
    public static final String DELAYED_QUEUE = "canoe.delayed.queue";
    public static final String ROUTING_KEY = "delayed.route";

    // 延迟交换机：type = x-delayed-message，并指定底层类型
    @Bean
    public CustomExchange delayedExchange() {
        Map<String, Object> argsMap = new HashMap<>(4);
        // x-delayed-type 表示这个延迟交换机"伪装"成 direct 来路由
        argsMap.put("x-delayed-type", "direct");

        // 第一个参数：名字；第二个：类型固定为 x-delayed-message
        // 第三个：持久化；第四个：不自动删除；第五个：额外参数
        return new CustomExchange(DELAYED_EXCHANGE, "x-delayed-message", true, false, argsMap);
    }

    @Bean
    public Queue delayedQueue() {
        return new Queue(DELAYED_QUEUE, true);
    }

    @Bean
    public Binding delayedBinding() {
        return BindingBuilder.bind(delayedQueue())
                .to(delayedExchange())
                .with(ROUTING_KEY)
                .noargs();
    }
}
```

::: tip 容易写错的地方
- `type` 一定是字符串 `"x-delayed-message"`，不是 `"delayed"`。
- 必须同时给 `x-delayed-type`，否则交换机创建出来不会按延迟逻辑工作。
- `BindingBuilder...with(...).noargs()` 才是 `CustomExchange` 的绑定收尾写法，别用 `.and()` 之后又填参数。
:::

### 3.8 方案 B 发送

发送时在 `MessagePostProcessor` 里给消息加 `x-delay` header：

```java
package com.canoe.rabbitmq.advanced.delay.plugin;

import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessagePostProcessor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class DelayedPluginSender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    // 发送一条延迟 delayMillis 毫秒的消息
    public void sendDelayed(String content, long delayMillis) {
        rabbitTemplate.convertAndSend(
                DelayedPluginConfig.DELAYED_EXCHANGE,
                DelayedPluginConfig.ROUTING_KEY,
                content,
                new MessagePostProcessor() {
                    @Override
                    public Message postProcessMessage(Message message) throws AmqpException {
                        // x-delay 单位是毫秒，表示延迟多久再路由
                        message.getMessageProperties().setHeader("x-delay", delayMillis);
                        return message;
                    }
                });
    }

    // 也可以直接 setHeader 一个 long（等价于上面的写法）
    public void sendDelayedV2(String content, long delayMillis) {
        rabbitTemplate.convertAndSend(
                DelayedPluginConfig.DELAYED_EXCHANGE,
                DelayedPluginConfig.ROUTING_KEY,
                (Object) content,
                message -> {
                    message.getMessageProperties().setHeader("x-delay", delayMillis);
                    return message;
                });
    }
}
```

```java
package com.canoe.rabbitmq.advanced.delay.plugin;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class DelayedPluginConsumer {

    @RabbitListener(queues = DelayedPluginConfig.DELAYED_QUEUE)
    public void onDelayed(String content) {
        // 这里收到的，就是"延迟到期"后的消息
        System.out.println("[插件延迟到期] 处理：" + content);
    }
}
```

### 3.9 方案 B 的已知限制

::: warning 用之前请知悉这些边界
- **不适合超大规模**：官方提示消息量在**百万级以上**时要谨慎，因为延迟消息都堆在 Mnesia 表里，量太大内存和性能会吃紧。
- **不是真正的高可用**：插件的延迟状态存在**单个节点**的 Mnesia 中。如果那个节点挂了，未到期的延迟消息可能丢失（集群环境下它不像 Quorum Queue 那样有多副本保障）。
- **不能撤销已投递的延迟消息**：消息一旦交给插件"定时"，你没法在中途取消它（除非你有业务上的"幂等 + 版本号"兜底）。
- **精度受消息量影响**：延迟时间不是硬实时的，消息越多、触发越密集，精度越可能漂移。
- **只在消息真正"到点"时路由**：如果目标队列当时不存在或没绑定，消息会按普通路由规则处理（可能进备份交换机或丢失）。
:::

### 3.10 方案 C：外部方案

如果延迟需求超出了 RabbitMQ 插件的能力（比如要海量、要可取消、要分布式高可用），可以上外部方案：

| 方案 | 思路 | 适合场景 |
| --- | --- | --- |
| Redis ZSet 扫描 | 用 `zadd` 存"执行时间戳+任务ID"，定时线程 `zrangeByScore` 扫到期任务 | 轻量、已有 Redis、延迟精度要求不高 |
| Redisson `RDelayedQueue` | 封装好的延迟队列，底层也是 Redis | 想少写代码、直接用现成 API |
| RocketMQ 定时消息 | broker 原生支持"延迟级别/任意时间"消息 | 已经用 RocketMQ、要强一致与高可用 |
| 时间轮（Netty/HashedWheelTimer） | 内存时间轮，毫秒级精度 | 单机内调度、数量大但生命周期短 |

### 3.11 三种方案对比表

| 维度 | 方案 A：TTL+死信 | 方案 B：延迟插件 | 方案 C：外部方案 |
| --- | --- | --- | --- |
| 延迟精度 | 受队头阻塞影响，**不准** | 较高，无队头阻塞 | 取决于外部实现，一般较高 |
| 多档延迟 | 需建多个队列 | 单队列任意延迟 | 任意延迟 |
| 可靠性 | 高（死信也是 MQ 内） | 中（单节点 Mnesia，百万级吃紧） | 看外部组件自身可靠性 |
| 能否取消 | 难 | 难（不能撤销已投递） | 相对容易（删 key / 改状态） |
| 实现复杂度 | 低 | 低（装插件即可） | 中~高 |
| 适合场景 | 单档、简单的超时关单 | **绝大多数业务延迟需求首选** | 海量 / 需高可用 / 需可取消 |

::: tip 选型结论
**90% 的业务延迟需求，直接上方案 B 延迟插件**就够了。只有"消息量极大 + 必须可取消 + 要跨节点高可用"时才考虑方案 C（RocketMQ/Redis）。**方案 A 仅作理解原理用，真要落地多档延迟会很痛苦**。
:::

### 3.12 实战：订单 30 分钟未支付自动关闭

完整链路：**订单创建 → 投递延迟消息（30 分钟）→ 到期消费 → 查支付状态 → 未支付则关单 + 回库存 → 幂等处理**。

声明（用方案 B 插件）：

```java
package com.canoe.rabbitmq.advanced.delay.order;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.CustomExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class OrderCloseConfig {

    public static final String EXCHANGE = "order.close.exchange";
    public static final String QUEUE = "order.close.queue";
    public static final String ROUTING_KEY = "order.close";

    @Bean
    public CustomExchange orderCloseExchange() {
        Map<String, Object> argsMap = new HashMap<>(4);
        argsMap.put("x-delayed-type", "direct");
        return new CustomExchange(EXCHANGE, "x-delayed-message", true, false, argsMap);
    }

    @Bean
    public Queue orderCloseQueue() {
        return new Queue(QUEUE, true);
    }

    @Bean
    public Binding orderCloseBinding() {
        return BindingBuilder.bind(orderCloseQueue())
                .to(orderCloseExchange())
                .with(ROUTING_KEY)
                .noargs();
    }
}
```

消息体定义：

```java
package com.canoe.rabbitmq.advanced.delay.order;

import java.io.Serializable;

public class OrderCloseMessage implements Serializable {
    private static final long serialVersionUID = 1L;

    private String orderId;
    // 发送时的时间戳，用于幂等判断
    private long sendTimestamp;

    public OrderCloseMessage() {
    }

    public OrderCloseMessage(String orderId, long sendTimestamp) {
        this.orderId = orderId;
        this.sendTimestamp = sendTimestamp;
    }

    public String getOrderId() {
        return orderId;
    }

    public void setOrderId(String orderId) {
        this.orderId = orderId;
    }

    public long getSendTimestamp() {
        return sendTimestamp;
    }

    public void setSendTimestamp(long sendTimestamp) {
        this.sendTimestamp = sendTimestamp;
    }
}
```

发送（订单创建时调用）：

```java
package com.canoe.rabbitmq.advanced.delay.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessagePostProcessor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class OrderCloseSender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Value("${order.close.delay-minutes:30}")
    private long delayMinutes;

    public void sendOrderClose(String orderId) throws Exception {
        OrderCloseMessage msg = new OrderCloseMessage(orderId, System.currentTimeMillis());
        String json = objectMapper.writeValueAsString(msg);

        long delayMillis = delayMinutes * 60 * 1000;

        rabbitTemplate.convertAndSend(
                OrderCloseConfig.EXCHANGE,
                OrderCloseConfig.ROUTING_KEY,
                json,
                new MessagePostProcessor() {
                    @Override
                    public Message postProcessMessage(Message message) throws AmqpException {
                        message.getMessageProperties().setHeader("x-delay", delayMillis);
                        return message;
                    }
                });
    }
}
```

消费（到期处理，含查支付状态 + 幂等）：

```java
package com.canoe.rabbitmq.advanced.delay.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Component
public class OrderCloseConsumer {

    @Autowired
    private ObjectMapper objectMapper;

    // 这三个是示例里"假装"的服务，真实项目替换成你自己的 Mapper/Client
    // private OrderMapper orderMapper;
    // private InventoryMapper inventoryMapper;
    // private PayClient payClient;

    @RabbitListener(queues = OrderCloseConfig.QUEUE)
    public void onClose(Message message,
                        @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag,
                        Channel channel) throws IOException {
        try {
            String json = new String(message.getBody(), StandardCharsets.UTF_8);
            OrderCloseMessage msg = objectMapper.readValue(json, OrderCloseMessage.class);
            String orderId = msg.getOrderId();

            // 1) 查支付状态（真实项目调用支付网关 / 数据库）
            // String status = orderMapper.selectStatus(orderId);
            String status = "UNPAID"; // 演示用：假设未支付

            // 2) 幂等：只有"未支付"才关单，已支付/已关闭直接跳过
            if (!"UNPAID".equals(status)) {
                channel.basicAck(deliveryTag, false);
                return;
            }

            // 3) 关单 + 回库存（真实项目用同事务 / 本地事务表保证一致）
            // orderMapper.closeOrder(orderId);
            // inventoryMapper.rollbackStock(orderId);
            System.out.println("订单 " + orderId + " 超时未支付，已关单并回库存");

            // 4) 确认消息
            channel.basicAck(deliveryTag, false);
        } catch (Exception e) {
            // 处理失败：这里选择不 ACK，让消息重新入队重试
            // 生产环境建议配合死信 + 重试上限，避免死循环
            channel.basicNack(deliveryTag, false, true);
        }
    }
}
```

::: tip 幂等为什么必须有
延迟消息可能因为网络重投、消费失败重试而"被处理多次"。关单这种写操作必须幂等——用 `orderId` 当唯一键、或先 `SELECT` 状态再决定、或用"已处理集合"标记，否则可能把已支付的订单误关掉。**延迟队列 + 幂等 = 生产可用**。
:::

## 四、优先级队列

### 4.1 配置 `x-max-priority`

优先级队列让"重要的消息"能插队先被消费。声明队列时加 `x-max-priority`，值是**优先级上限（最大 255，但建议 0~10）**。

```java
package com.canoe.rabbitmq.advanced.priority;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class PriorityConfig {

    @Bean
    public Queue priorityQueue() {
        return QueueBuilder.durable("priority.queue")
                // 支持 0~10 共 11 档优先级
                .withArgument("x-max-priority", 10)
                .build();
    }
}
```

### 4.2 消息 `priority` 属性

发消息时给每条设 `priority`（0 最低，越接近上限越高）：

```java
package com.canoe.rabbitmq.advanced.priority;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
public class PrioritySender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void send(String content, int priority) {
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        // 设置这条消息的优先级（0~10）
        properties.setPriority((byte) priority);

        Message message = MessageBuilder.withBody(content.getBytes(StandardCharsets.UTF_8))
                .andProperties(properties)
                .build();
        rabbitTemplate.send("priority.exchange", "priority.key", message);
    }
}
```

### 4.3 只有堆积时才有意义

::: warning 最容易被误解的点
优先级队列**只在"队列有堆积、消息排着队等消费"时才有意义**。如果消费者一直空闲，消息一进来就被立刻取走，根本没机会"插队"，优先级自然不生效。

另外，优先级队列**不支持 Quorum Queue**（Quorum Queue 不支持消息优先级，见下一篇）。如果你既想要高可用副本、又想要优先级，目前没有两全的方案，得用普通集群 + Classic Queue 或在业务层自己排序。
:::

### 4.4 完整代码（原生 client 版）

```java
package com.canoe.rabbitmq.advanced.priority;

import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class PriorityNativeDemo {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setUsername("guest");
        factory.setPassword("guest");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            Map<String, Object> argsMap = new HashMap<>(4);
            argsMap.put("x-max-priority", 10);
            channel.queueDeclare("priority.queue", true, false, false, argsMap);

            // 发 3 条不同优先级的消息
            publishWithPriority(channel, "低优先级-3", (byte) 3);
            publishWithPriority(channel, "高优先级-10", (byte) 10);
            publishWithPriority(channel, "中优先级-6", (byte) 6);

            // 消费：如果此刻队列没堆积，可能还是按发送顺序收到
            DeliverCallback callback = (tag, delivery) -> {
                System.out.println("收到：" + new String(delivery.getBody(), StandardCharsets.UTF_8));
                channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
            };
            channel.basicConsume("priority.queue", false, callback, t -> {});

            Thread.sleep(2000);
        }
    }

    private static void publishWithPriority(Channel channel, String body, byte priority) throws Exception {
        AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
                .deliveryMode(2)
                .priority(priority)
                .build();
        channel.basicPublish("", "priority.queue", props, body.getBytes(StandardCharsets.UTF_8));
    }
}
```

## 五、惰性队列 Lazy Queue

### 5.1 配置 `x-queue-mode: lazy`

默认队列会把消息先放**内存**，消费慢、堆积多时内存直接打满。惰性队列（Lazy Queue）让消息**直接写磁盘**，只在被消费时才加载到内存，专门对付"海量堆积"。

在 RabbitMQ 3.12+ 中，**惰性模式已成为默认行为**（Classic Queue v2 默认就是 lazy）。

```java
package com.canoe.rabbitmq.advanced.lazy;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class LazyConfig {

    @Bean
    public Queue lazyQueue() {
        Map<String, Object> argsMap = new HashMap<>(4);
        // lazy = 消息优先写磁盘
        argsMap.put("x-queue-mode", "lazy");
        return QueueBuilder.durable("lazy.queue").withArguments(argsMap).build();
    }
}
```

### 5.2 与默认队列对比表

| 维度 | 默认队列（eager） | 惰性队列（lazy） |
| --- | --- | --- |
| 消息存储位置 | 尽量放内存，溢出才落盘 | 直接落盘，消费时才进内存 |
| 海量堆积能力 | 弱，内存易打满 | 强，百万级堆积不爆内存 |
| 吞吐/延迟 | 高吞吐、低延迟 | 吞吐略降（有磁盘 IO） |
| 适合场景 | 消费快、消息少驻留 | 消费者离线久、流量洪峰、备份 |

::: tip 什么时候用
消费者长时间不在线、或者你要往队列里灌百万条做缓冲，用惰性队列。日常正常消费、消息不堆积，用默认队列性能更好。**Quorum Queue 自 3.10 起内部其实就是 lazy 的**，不用单独设。
:::

## 六、备份交换机（Alternate Exchange）

### 6.1 解决的问题

前面提过 `mandatory` 标志：消息路由不到任何队列时，broker 会把消息返回给生产者（`return` 回调）。但如果你**没处理 return**，或者你就是想要"路由不到的消息统一归集告警"，就可以用备份交换机（Alternate Exchange，简称 AE）。

AE 的作用：当消息无法路由到任何队列时，**不会静默丢弃**，而是被转发到你指定的那个 AE，再由 AE 路由到一个"兜底队列"（通常是 fanout + 告警队列）。

### 6.2 配置 `alternate-exchange`

```java
package com.canoe.rabbitmq.advanced.ae;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class AlternateExchangeConfig {

    public static final String MAIN_EXCHANGE = "ae.main.exchange";
    public static final String AE_EXCHANGE = "ae.alternate.exchange";
    public static final String WARN_QUEUE = "ae.warn.queue";

    // 主交换机，挂上 alternate-exchange 参数
    @Bean
    public org.springframework.amqp.core.DirectExchange mainExchange() {
        Map<String, Object> argsMap = new HashMap<>(4);
        argsMap.put("alternate-exchange", AE_EXCHANGE);
        return new org.springframework.amqp.core.DirectExchange(MAIN_EXCHANGE, true, false, argsMap);
    }

    // 备份交换机：用 fanout，把所有"漏网消息"广播到告警队列
    @Bean
    public FanoutExchange alternateExchange() {
        return new FanoutExchange(AE_EXCHANGE, true, false);
    }

    @Bean
    public Queue warnQueue() {
        return new Queue(WARN_QUEUE, true);
    }

    @Bean
    public Binding warnBinding() {
        // fanout 不需要 routing key
        return BindingBuilder.bind(warnQueue()).to(alternateExchange());
    }
}
```

### 6.3 读取告警队列的代码

```java
package com.canoe.rabbitmq.advanced.ae;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class WarnConsumer {

    // 所有路由不到的消息都会到这里，方便你发现"配置错了 / 队列没了"
    @RabbitListener(queues = AlternateExchangeConfig.WARN_QUEUE)
    public void onWarn(String body) {
        System.err.println("[告警] 捕获到路由失败的消息：" + body);
        // 真实场景：发钉钉/邮件告警，或落库人工处理
    }
}
```

### 6.4 注意事项

::: warning 三个坑
1. **AE 不级联**：如果消息被 AE 转发后还是路由不到队列，就**直接丢弃**了（不会再用 AE 的 AE）。所以 AE 通常用 fanout 绑一个确定存在的队列，确保能接住。
2. **与 `mandatory` 的取舍**：`mandatory=true` 是把"路由失败"通知回生产者代码里处理；AE 是把"路由失败"交给另一个交换机处理。两者可以并存，但别重复设计。一般建议**生产环境两者都留**：AE 做兜底归集，mandatory 的 return 做日志。
3. **AE 只对"路由失败"生效**，对"消息被拒绝/expired"不生效（那些归死信队列管）。
:::

## 七、队列长度限制

队列不能无限涨，否则内存/磁盘爆掉。RabbitMQ 提供三个参数：

| 参数 | 作用 |
| --- | --- |
| `x-max-length` | 队列最多多少条消息（整数） |
| `x-max-length-bytes` | 队列消息总字节上限 |
| `x-overflow` | 超出后怎么办：`drop-head` / `reject-publish` / `reject-publish-dlx` |

`x-overflow` 三种行为对照：

| 取值 | 行为 |
| --- | --- |
| `drop-head`（默认） | 丢弃**队首**最老的消息来腾位置（被丢的消息若配了 DLX 会进死信） |
| `reject-publish` | **拒绝最新来的发布**，让生产者报错（背压，保护队列） |
| `reject-publish-dlx` | 拒绝发布，并把被拒的消息当死信转去 DLX |

```java
package com.canoe.rabbitmq.advanced.length;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class LengthLimitConfig {

    @Bean
    public Queue lengthQueue() {
        Map<String, Object> argsMap = new HashMap<>(8);
        argsMap.put("x-max-length", 1000);                 // 最多 1000 条
        argsMap.put("x-max-length-bytes", 10 * 1024 * 1024); // 最多 10MB
        argsMap.put("x-overflow", "reject-publish");       // 满了就拒绝新消息
        return QueueBuilder.durable("length.limit.queue").withArguments(argsMap).build();
    }
}
```

::: tip 怎么选 overflow
- 想要"保留最新、丢掉最老"（如行情快照）：用 `drop-head`。
- 想要"队列满了就别再写、让上游自己慢下来"（保护系统）：用 `reject-publish`。
- 想要"满了就把被拒消息进死信留底"：用 `reject-publish-dlx`（注意 Quorum Queue 不支持这个取值）。
:::

## 八、消费端限流

### 8.1 `basicQos`

消费者一次性从 broker 拉太多消息到本地，本地处理慢就会把内存撑爆。用 `basicQos`（QoS = Quality of Service）限制"**未确认（unacked）的消息数上限**"。

```java
package com.canoe.rabbitmq.advanced.qos;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.DeliverCallback;

import java.nio.charset.StandardCharsets;

public class QosDemo {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setUsername("guest");
        factory.setPassword("guest");

        try (Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {

            // 参数：prefetchCount(未确认上限), prefetchSize(字节上限,0=不限), global(是否跨消费者)
            channel.basicQos(10, 0, false);

            DeliverCallback callback = (tag, delivery) -> {
                String msg = new String(delivery.getBody(), StandardCharsets.UTF_8);
                System.out.println("处理：" + msg);
                // 处理完一定要 ack，否则 unacked 一直涨，触发不了新消息
                channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
            };
            channel.basicConsume("order.queue", false, callback, t -> {});

            Thread.sleep(2000);
        }
    }
}
```

### 8.2 `global` 的坑

`basicQos` 第三个参数 `global` 非常容易写错：

- `global=false`（默认、常用）：QoS 限制**作用于单个消费者 channel**。每个消费者最多攒 `prefetchCount` 条未确认。
- `global=true`：限制**作用于整个 channel**（该 channel 上所有消费者共享这个额度）。

::: danger 常见误用
很多同学以为 `prefetchCount=0` 表示"不限"，其实 `prefetchCount=0` 在 AMQP 里是"**无限制**"的意思——但**无限制意味着 broker 会把队列里所有消息一次性推给你**，消费慢时直接内存爆炸。生产环境务必设一个具体值（如 10~100），**不要设 0**。
:::

另外注意：Quorum Queue **不支持全局 QoS（global=true 的某些语义）**，用 Quorum 时请保持 `global=false`。

## 九、Federation / Shovel 插件简介

这两个都是跨集群/跨机房同步消息的插件，和"集群"（下一篇）不是一个概念：

- **Federation（联邦）**：把一个 broker 上交换机的消息，**按绑定关系"拉"**到另一个 broker 的同名交换机。适合"总部→分支"的单向同步、跨广域网降低延迟。它在**消费者侧**生效，只同步需要的消息。
- **Shovel（铲子）**：把源 broker 某个队列（或交换机）的消息**主动"推"**到目标 broker 的队列/交换机。更像"搬运工"，适合明确的点对点复制、把云上消息搬到本地分析。

::: tip 与集群的区别
集群是**同一个 Erlang 集群内多节点共享元数据**，队列数据按节点分布；Federation/Shovel 是**两个独立 broker 之间**的消息搬运，彼此可以版本不同、网络距离很远。需要"异地多活/容灾同步"才用它们，日常高可用用集群 + Quorum Queue 即可。
:::

启用：

```bash
rabbitmq-plugins enable rabbitmq_federation
rabbitmq-plugins enable rabbitmq_shovel
rabbitmq-plugins enable rabbitmq_shovel_management
```

## 十、常见坑清单

- **多个消费者监听同一个队列 = 竞争消费，不是广播**：同一条消息只被其中一个消费者处理一次。要"一条消息被多个服务都收到"，请用 `fanout` 交换机，让每个服务有**自己的队列**绑定到该 fanout。
- **`@RabbitListener` 声明参数与已存在队列不一致 → 406 PRECONDITION_FAILED**：比如代码里写了 `x-message-ttl=10000`，但 broker 上这个队列已经存在且没这个参数，或者反过来。解决：删掉旧队列重建，或让代码参数和已存在队列完全一致。
- **延迟插件装了没生效**：常见三个原因——① 没执行 `rabbitmq-plugins enable`（只是下好了没启用）；② 交换机 `type` 写错（必须 `x-delayed-message`）；③ `x-delayed-type` 没设或设错。去管理界面 Exchanges 页看类型是不是 `x-delayed-message` 就能验证。
- **以为 TTL 队列是精确延迟**：见 1.5 与 3.3，TTL 只对队首生效，多档延迟别用单 TTL 队列。
- **死信消息被循环拒绝导致死循环**：死信消费者处理失败又 `reject` 且 `requeue=true`，消息又被打回原业务队列……要设重试上限或转人工。
- **优先级队列在没堆积时"不生效"**：见 4.3，别在消费很快的场景指望它插队。
- **消息体塞大文件**：把 10MB 文件塞进消息，MQ 会很难受。大文件请存对象存储（OSS/S3），MQ 里只传 key（见下一篇调优）。

## 本篇小结

- **TTL 是消息"保质期"**，分队列级 `x-message-ttl` 与消息级 `expiration`，**两者并存取较小值**，`0` 表示不限制。
- **TTL 不是定时器**：过期判定只在消息"轮到队首"时发生，队列中间的过期消息不会立即消失。
- **死信队列（DLX）**接收三种变死信的消息：被拒(`requeue=false`)、TTL 过期、队列超长溢出；靠 `x-dead-letter-exchange` / `x-dead-letter-routing-key` 配置。
- **`x-death` header**记录了消息"从哪死的、为什么死、死几次"，是排查死信来源的关键；4.0 不再在 republish 时解析旧 header，但读取依然有效。
- **延迟队列方案 A（TTL+死信）有队头阻塞**，多档延迟需多队列；**方案 B（延迟插件）无队头阻塞，是业务首选**。
- **延迟插件**交换机类型为 `x-delayed-message`、需配 `x-delayed-type`，发消息用 `x-delay` header（毫秒）；限制：单节点 Mnesia、百万级吃紧、不可取消。
- **优先级队列**只有"队列堆积、消息排队等消费"时才生效；Quorum Queue 不支持优先级。
- **惰性队列**消息直接落盘，专治百万级堆积；3.12+ 默认即为 lazy。
- **备份交换机（AE）**接住"路由不到"的消息防静默丢失，但不级联、与 `mandatory` 可互补。
- **队列长度限制**用 `x-max-length`/`x-max-length-bytes` + `x-overflow`，生产建议设上限防无限堆积。
- **消费端限流**用 `basicQos`，`prefetchCount` 不要设 `0`（无限制会爆内存）；Quorum 不支持 global QoS。
- **多消费者同队列是竞争消费不是广播**；声明参数与已存在队列不一致会 406；延迟插件要启用且类型写对才生效。

## 参考链接

- RabbitMQ TTL 官方文档：<https://www.rabbitmq.com/docs/ttl>
- RabbitMQ 死信队列 DLX 官方文档：<https://www.rabbitmq.com/docs/dlx>
- 延迟消息插件（GitHub Releases，版本须匹配）：<https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases>
- 延迟消息插件官方说明：<https://www.rabbitmq.com/docs/dlx#delayed-message-exchange>
- RabbitMQ 优先级队列：<https://www.rabbitmq.com/docs/priority>
- RabbitMQ 惰性队列：<https://www.rabbitmq.com/docs/lazy-queues>
- RabbitMQ 备份交换机 AE：<https://www.rabbitmq.com/docs/ae>
- RabbitMQ 队列长度限制：<https://www.rabbitmq.com/docs/maxlength>

下一篇 → [06 集群、监控与生产调优](/java/middleware/rabbitmq/production)
