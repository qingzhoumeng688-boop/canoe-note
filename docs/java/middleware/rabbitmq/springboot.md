# 03 Spring Boot 整合实战

> 本篇导读：前两篇（01 消息队列入门、02 RabbitMQ 核心概念）我们一直在"看"RabbitMQ——它的交换机、队列、绑定。从这一篇开始，要真正"用"起来了：用 Spring Boot 把消息发进 MQ、再消费出来。本文以「零基础+小白视角」带你把 `spring-boot-starter-amqp` 跑通，重点讲清三件事——**怎么连上**、**核心类各管啥**、**消息怎么序列化才不会踩坑**。读完你能独立写出一个"用户注册后异步发积分+发邮件"的完整 Demo。

## 一、依赖与配置

### 1.1 一个生活化比喻：连接 RabbitMQ 像"打电话"

把 RabbitMQ 想成公司的总机（Broker）。你要跟它通信，得先知道三件事：

- **总机号码（host:port）**：服务器 IP 和端口（AMQP 默认 5672）。
- **你要进哪个部门（virtual-host）**：RabbitMQ 里可以划多个"虚拟主机"做隔离，相当于不同的电话分机号段。
- **工号密码（username/password）**：没权限连不上。

Spring Boot 只要把这些信息写进 `application.yml`，它就会自动帮你"拨号"建一条长连接（Connection），再在连接上开多个"通道"（Channel）来收发消息。你完全不用手写那堆 `ConnectionFactory` 样板代码——这是 Starter 的魅力。

### 1.2 完整 pom.xml

下面是能直接用的 `pom.xml`。关键点是继承了 `spring-boot-starter-parent`（统一管所有依赖版本），我们只额外引入 `amqp`、`web`、`lombok`、`jackson` 几个核心件：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <!-- ① 继承 Spring Boot 父工程：所有依赖版本由它统一管控，我们几乎不用写 <version> -->
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.canoe</groupId>
    <artifactId>rabbitmq-demo</artifactId>
    <version>1.0.0</version>
    <name>rabbitmq-demo</name>

    <!-- ② <properties> 里统一管"非 Boot 托管"的版本与编译参数 -->
    <properties>
        <java.version>17</java.version>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
        <!-- AMQP 核心 Starter：封装了 RabbitTemplate、监听器、连接工厂 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-amqp</artifactId>
        </dependency>
        <!-- Web：写个 Controller 触发发消息 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <!-- 数据访问：Demo 里要落库（用户表、积分流水表） -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>com.mysql</groupId>
            <artifactId>mysql-connector-j</artifactId>
            <scope>runtime</scope>
        </dependency>
        <!-- Lombok：少写 getter/setter -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        <!-- Jackson：JSON 序列化（Spring Boot 已传递依赖，这里显式声明便于统一版本） -->
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
        </dependency>
        <!-- Jackson 时间模块：让 LocalDateTime 能正确序列化 -->
        <dependency>
            <groupId>com.fasterxml.jackson.datatype</groupId>
            <artifactId>jackson-datatype-jsr310</artifactId>
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
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

::: tip 为什么很多依赖没写 version
`spring-boot-starter-parent` 内部维护了一张"推荐版本清单"，`spring-boot-starter-amqp`、`jackson-databind` 等都已经在清单里。你只管引入，版本交给父工程——这就是"统一管版本"的精髓，能避免依赖冲突。
:::

### 1.3 完整 application.yml（逐行注释版）

`spring.rabbitmq.*` 是 Spring Boot 的自动配置前缀。下面把所有常用项都列出来，每一项都带中文注释：

```yaml
spring:
  rabbitmq:
    # ========== 基础连接（拨号三要素） ==========
    host: 127.0.0.1          # RabbitMQ 服务器地址
    port: 5672               # AMQP 协议端口（注意不是管理后台的 15672）
    virtual-host: /          # 虚拟主机，默认 / ；多租户隔离用
    username: guest          # 账号（生产请用独立账号，别用 guest）
    password: guest          # 密码
    connection-timeout: 5000 # 建连超时（毫秒），连不上时快速失败

    # ========== 发布者（生产者）相关 ==========
    publisher-confirm-type: correlated   # 开启"发布确认"：broker 收到消息后回 ack
                                        # 可选值 none / correlated / simple
    publisher-returns: true              # 开启"消息回退"：路由不到队列时把消息退给生产者
    template:
      mandatory: true                   # 让每条发出的消息都带 mandatory 标志，
                                        # 路由失败时才会触发上面的 return 回调
      exchange: ""                      # 默认交换机（可选）
      routing-key: ""                   # 默认路由键（可选）

    # ========== 监听器（消费者）相关 ==========
    listener:
      simple:                           # 对应 SimpleMessageListenerContainer
        acknowledge-mode: auto          # ack 模式：none / auto / manual
        prefetch: 1                     # 每个消费者预取多少条（QoS）
        concurrency: 3                  # 初始并发消费者数
        max-concurrency: 10             # 最大并发消费者数
        retry:
          enabled: false                # 是否开启消费端重试（本篇先关，第 04 篇细讲）
          max-attempts: 3               # 最大重试次数
          initial-interval: 1000        # 首次重试间隔（毫秒）
          multiplier: 2.0               # 退避倍数
          max-interval: 10000           # 最大重试间隔
        default-requeue-rejected: true  # 重试耗尽后是否重新入队（建议 false）

    # ========== 连接与通道缓存 ==========
    cache:
      channel:
        size: 25                        # 缓存的 Channel 数量，确认模式开启时要调大
        checkout-timeout: 0             # 取不到缓存通道时等待毫秒数，0=不等待直接新建
      connection:
        size: 1                         # 缓存的连接数（一般 1 够用）
```

::: warning host/port 写错的最常见症状
如果你把 `port` 写成管理后台的 `15672`，应用启动时会报 `connection refused` 或一直超时——`5672` 是 AMQP 数据端口，`15672` 是网页管理后台端口，两者用途不同，别搞混。
:::

### 1.4 连不上怎么办：报错与排查清单

启动后如果连不上，按下面顺序排查：

| 现象 | 可能原因 | 排查动作 |
| --- | --- | --- |
| `Connection refused` | 服务没起 / host:port 错 | `docker ps` 看容器状态；确认 `port: 5672` |
| 一直 `Timeout` | 防火墙 / 虚拟机端口没映射 | 用 `telnet 127.0.0.1 5672` 测连通 |
| `ACCESS_REFUSED` | 用户名或虚拟主机不对 | 确认 `username/password/virtual-host` |
| `Channel closed; cannot ack` | 异步 ack（手动模式常见坑） | 见本篇第七章、第 04 篇第七章 |
| 消息发了但队列收不到 | 交换机/队列没声明或绑定错 | 去 `http://localhost:15672` 后台看 Exchanges/Queues |

```bash
# 最常用的一键排查组合拳
docker ps | grep rabbitmq            # 容器在不在
docker logs -f rabbitmq             # 看 broker 日志
rabbitmqctl list_queues             # 列出所有队列（确认有没有你的）
rabbitmqctl list_exchanges          # 列出所有交换机
```

## 二、Spring AMQP 三大核心类

Spring AMQP 把 RabbitMQ 的底层 API 包成了三个你天天会打交道的类。记住它们各自的"人设"就够了：

| 核心类 | 一句话职责 | 类比 |
| --- | --- | --- |
| `RabbitAdmin` | 管"基础设施"：声明/删除交换机、队列、绑定 | 装修队：负责把交换机、队列、绑定这些"房间和门"造出来 |
| `RabbitTemplate` | 管"消息收发"：把对象转成消息发出去、把消息拉回来 | 快递员：你给我一个对象，我序列化后送到 MQ；或者帮你去 MQ 取件 |
| `RabbitListenerContainerFactory` | 管"消费者容器"：把 `@RabbitListener` 注解变成真正在跑的监听线程 | 物业管家：你贴个"我要收快递"的条子（注解），它负责安排人 24 小时盯着 |

它们的关系一句话讲清：

> `RabbitAdmin` 先把"管道"（交换机/队列/绑定）建好 → `RabbitTemplate` 通过管道把消息发到 Broker → `RabbitListenerContainerFactory` 基于建好的管道，把 `@RabbitListener` 方法变成常驻消费者，从 Broker 把消息取回来交给你的方法。

::: tip 其实你多半不用自己 new 它们
Spring Boot 的自动配置已经帮你把 `RabbitTemplate`、`RabbitListenerContainerFactory`、`RabbitAdmin` 的 Bean 都建好了。你只在**要定制**（比如换 JSON 转换器、改并发数）时才需要自己 `@Bean` 覆盖。本篇后面会逐个演示。
:::

## 三、RabbitTemplate 发送 API 全景表

`RabbitTemplate` 方法很多，但常用的就下面这几类。先给一张全景表建立全局观，再逐个上代码。

### 3.1 方法全景表

| 方法 | 作用 | 是否阻塞 | 说明 |
| --- | --- | --- | --- |
| `convertAndSend(exchange, routingKey, object)` | 把对象转成消息发出去 | 否（发完就返回） | 最常用，object 会被消息转换器序列化 |
| `convertAndSend(exchange, routingKey, object, CorrelationData)` | 同上，但带业务关联 ID | 否 | 用于第 04 篇的发布确认回调定位消息 |
| `convertAndSend(exchange, routingKey, object, MessagePostProcessor)` | 发出前可改消息属性/头 | 否 | 比如加 `traceId` 头、设过期时间 |
| `send(Message)` | 直接发原始 `Message` | 否 | 你已经手动构建好 `Message` 时用 |
| `sendAndReceive(exchange, routingKey, Message)` | 发消息并同步等回复 | **是（阻塞）** | 内部用临时队列 + correlationId 实现 RPC |
| `convertSendAndReceive(exchange, routingKey, object)` | 同上，自动转换对象 | **是（阻塞）** | 性能差，非必要不要用 |
| `receive(queue)` | 从队列拉一条原始 `Message` | 否 | 主动拉模式（pull） |
| `receiveAndConvert(queue)` | 拉一条并转成对象 | 否 | 同上，返回反序列化后的对象 |

### 3.2 最常用的三种 convertAndSend

```java
package com.canoe.rabbitmq;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class OrderSender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    /** ① 最简形态：指定交换机 + 路由键 + 对象 */
    public void sendSimple(String exchange, String routingKey, Object payload) {
        // 对象会被 JSON 转换器（后面配）序列化成字节发出
        rabbitTemplate.convertAndSend(exchange, routingKey, payload);
    }

    /** ② 带 CorrelationData：给消息挂一个业务 ID，供 Confirm 回调定位 */
    public void sendWithCorrelation(String exchange, String routingKey, Object payload, String bizId) {
        // CorrelationData 的 id 就是你的业务单号，Confirm 回调里能原样拿到
        org.springframework.amqp.rabbit.connection.CorrelationData cd =
                new org.springframework.amqp.rabbit.connection.CorrelationData(bizId);
        rabbitTemplate.convertAndSend(exchange, routingKey, payload, cd);
    }

    /** ③ 带 MessagePostProcessor：发之前改消息头 / 属性 */
    public void sendWithPostProcessor(String exchange, String routingKey, Object payload, String traceId) {
        rabbitTemplate.convertAndSend(exchange, routingKey, payload, message -> {
            // 给消息加一个链路追踪 ID 头
            message.getMessageProperties().setHeader("x-trace-id", traceId);
            // 还可以设优先级、过期时间等
            message.getMessageProperties().setPriority(5);
            return message;
        });
    }
}
```

### 3.3 同步等待回复：sendAndReceive / convertSendAndReceive（大坑预警）

`sendAndReceive` 实现的是"请求-响应"模式：发一条消息出去，然后**一直阻塞当前线程**，等对方通过 `replyTo` 队列把结果送回来。

```java
package com.canoe.rabbitmq;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class RpcClient {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    /** 同步 RPC：会阻塞调用线程直到收到回复或超时 */
    public String callRemote(String exchange, String routingKey, Object request) {
        // ⚠️ 这一步是"阻塞"的：线程卡在这里等 reply，吞吐直接被打死
        Object reply = rabbitTemplate.convertSendAndReceive(exchange, routingKey, request);
        return reply == null ? null : reply.toString();
    }
}
```

::: danger 为什么一般不要这么写
`convertSendAndReceive` 内部会创建一个**临时队列**，并把这个队列塞进消息的 `replyTo` 头，再用 `correlationId` 把请求和回复对上号。整个过程**阻塞调用线程**。在高并发场景里，这意味着你的 Web 线程被 MQ 的回复速度绑架——MQ 一慢，Tomcat 线程池立刻打满。真要做 RPC，请用异步回调或换 gRPC/HTTP，别用 MQ 干这个。
:::

### 3.4 receive / receiveAndConvert：主动拉消息（别和监听器混用）

`receive(queue)` 是"拉（pull）"模式——你主动去队列里取一条。它和"推（push）"模式的 `@RabbitListener` **同时用在同一个队列上会互相抢消息**。

```java
package com.canoe.rabbitmq;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class PullConsumer {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    /** 主动从队列拉一条消息（立即返回，没有就返回 null） */
    public Message pullOne(String queueName) {
        // 第二个参数是超时毫秒，0 表示不等待
        return rabbitTemplate.receive(queueName, 0);
    }

    /** 拉一条并反序列化成对象 */
    public Object pullAndConvert(String queueName) {
        return rabbitTemplate.receiveAndConvert(queueName, 0);
    }
}
```

::: warning 千万不要混用
假设队列 `order.queue` 上同时有：
- 一个 `@RabbitListener` 在"推"着消费（RabbitMQ 把消息推给它）；
- 你的代码又用 `rabbitTemplate.receive("order.queue")` 去"拉"。

两条路会**抢同一批消息**，谁先拿到算谁的，结果就是：消费者时灵时不灵、消息"丢失"假象、甚至重复处理。**一个队列要么全用监听器，要么全用拉取，二选一。**
:::

### 3.5 MessageProperties 自定义头

`MessageProperties` 是消息的"信封"，除了正文（body）还能塞任意头（header）、设优先级、设过期时间、设 deliveryMode 等。

```java
package com.canoe.rabbitmq;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class HeaderSender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void sendWithCustomHeader(String exchange, String routingKey, String body, String tenant) {
        MessageProperties props = new MessageProperties();
        // 自定义业务头
        props.setHeader("x-tenant", tenant);
        // 设消息优先级（0~9，越大越先被消费）
        props.setPriority(8);
        // 设 10 秒后过期（TTL），过期进死信队列或丢弃
        props.setExpiration("10000");
        // 持久化模式：2 = 持久化（broker 重启不丢），1 = 非持久化
        props.setDeliveryMode(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);

        Message message = new Message(body.getBytes(java.nio.charset.StandardCharsets.UTF_8), props);
        rabbitTemplate.send(exchange, routingKey, message);
    }
}
```

## 四、@RabbitListener 详解

`@RabbitListener` 是日常写消费者最常用、最优雅的方式：贴一个注解，方法就能自动收到消息。下面把它的关键点全讲透。

### 4.1 queues / queuesToDeclare：监听已存在的队列 vs 顺手声明

```java
package com.canoe.rabbitmq.listener;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class DemoListener {

    /** 方式一：监听一个"已经存在"的队列（队列由别人/配置类声明好） */
    @RabbitListener(queues = "order.queue")
    public void onOrder(String msg) {
        System.out.println("收到订单消息：" + msg);
    }

    /** 方式二：监听的同时顺手把队列声明出来（queuesToDeclare） */
    @RabbitListener(queuesToDeclare = @org.springframework.amqp.core.Queue(
            value = "temp.queue",
            durable = "false",
            autoDelete = "true"))
    public void onTemp(String msg) {
        System.out.println("收到临时队列消息：" + msg);
    }
}
```

::: tip queues vs queuesToDeclare 怎么选
- 队列是"基础设施"，通常由配置类（见第六章）或运维在后台建好，消费者只管监听 → 用 `queues = "xxx"`。
- 你只是想快速验证、或队列很临时 → 用 `queuesToDeclare`，注解帮你自动建。
:::

### 4.2 注解式声明交换机+队列+绑定（queuesToDeclare / bindings）

实际项目里，队列往往还要和交换机、路由键"绑定"。`@RabbitListener` 的 `bindings` 属性可以一步到位声明三件套，下面给出 **fanout / direct / topic 三种**完整写法。

```java
package com.canoe.rabbitmq.listener;

import org.springframework.amqp.rabbit.annotation.Exchange;
import org.springframework.amqp.rabbit.annotation.Queue;
import org.springframework.amqp.rabbit.annotation.QueueBinding;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.annotation.ExchangeTypes;
import org.springframework.stereotype.Component;

@Component
public class BindingListener {

    /** ① FANOUT：广播，routingKey 无效，所有绑定的队列都能收到 */
    @RabbitListener(bindings = @QueueBinding(
            exchange = @Exchange(value = "user.events", type = ExchangeTypes.FANOUT),
            value = @Queue(value = "email.queue", durable = "true")))
    public void onFanout(String msg) {
        System.out.println("[fanout] 邮件服务收到：" + msg);
    }

    /** ② DIRECT：精确匹配 routingKey */
    @RabbitListener(bindings = @QueueBinding(
            exchange = @Exchange(value = "order.direct", type = ExchangeTypes.DIRECT),
            value = @Queue(value = "pay.queue", durable = "true"),
            key = "pay.success"))
    public void onDirect(String msg) {
        System.out.println("[direct] 支付成功队列收到：" + msg);
    }

    /** ③ TOPIC：按模式匹配，# 匹配多级，* 匹配一级 */
    @RabbitListener(bindings = @QueueBinding(
            exchange = @Exchange(value = "order.topic", type = ExchangeTypes.TOPIC),
            value = @Queue(value = "log.queue", durable = "true"),
            key = {"#.error", "order.*"}))
    public void onTopic(String msg) {
        System.out.println("[topic] 日志队列收到：" + msg);
    }
}
```

### 4.3 方法参数：你能拿到哪些东西

`@RabbitListener` 方法签名非常灵活，下面全列出来：

```java
package com.canoe.rabbitmq.listener;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.Header;
import org.springframework.amqp.rabbit.annotation.Headers;
import org.springframework.amqp.rabbit.annotation.Payload;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;

import java.util.Map;
import com.rabbitmq.client.Channel;

@Component
public class ParamListener {

    /** 最简：直接写消息正文类型（前提是用了 JSON 转换器，见第五章） */
    @RabbitListener(queues = "user.queue")
    public void plain(UserDTO user) {
        System.out.println("收到对象：" + user);
    }

    /** @Payload：显式标注这是消息正文（和上面等价，更清晰） */
    @RabbitListener(queues = "user.queue")
    public void withPayload(@Payload UserDTO user) {
        System.out.println("Payload：" + user);
    }

    /** @Header：取单个头 */
    @RabbitListener(queues = "user.queue")
    public void withHeader(@Payload UserDTO user,
                           @Header("x-trace-id") String traceId) {
        System.out.println("traceId=" + traceId + "，user=" + user);
    }

    /** @Headers：一次性拿全部头，放进 Map */
    @RabbitListener(queues = "user.queue")
    public void withHeaders(@Payload UserDTO user,
                            @Headers Map<String, Object> headers) {
        System.out.println("所有头：" + headers);
    }

    /** Message：拿到原始消息（含 properties） */
    @RabbitListener(queues = "user.queue")
    public void withMessage(Message message) {
        System.out.println("正文：" + new String(message.getBody()));
        System.out.println("头：" + message.getMessageProperties().getHeaders());
    }

    /** Channel：拿到通道，用于手动 ack（必须 acknowledge-mode=manual） */
    @RabbitListener(queues = "user.queue")
    public void withChannel(@Payload User  user, Channel channel,
                            org.springframework.amqp.core.Message raw) {
        // 手动确认的逻辑放到第 04 篇第七章细讲
        System.out.println("拿到 channel，稍后手动 ack");
    }
}
```

注意 `UserDTO` / `User` 等类型要能反序列化，前提是你配了 `Jackson2JsonMessageConverter`（第五章）。

### 4.4 返回值 = 回复（replyTo）

如果监听器方法**有返回值**，且调用方是用 `sendAndReceive`/`convertSendAndReceive` 发的（第三章 3.3），那返回值会被自动发到消息的 `replyTo` 队列，作为 RPC 的"回复"。普通异步消费场景里，返回值会被忽略。

```java
package com.canoe.rabbitmq.listener;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class RpcServer {

    /** 这个方法收到请求后，返回值会作为"回复"发回 replyTo 队列 */
    @RabbitListener(queues = "rpc.request.queue")
    public String handle(String request) {
        return "已处理：" + request;
    }
}
```

::: warning 返回值只有在 RPC 场景才有意义
如果你是用 `convertAndSend` 异步发消息，监听器方法即使 return 了东西也不会有任何效果，也不会报错——别误以为 return 是在"ack"。真正的确认见第 04 篇的 ACK 机制。
:::

### 4.5 一个类里多个 @RabbitListener + id 与生命周期

一个类可以贴多个 `@RabbitListener` 方法，各自监听不同队列：

```java
package com.canoe.rabbitmq.listener;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class MultiListener {

    // id 很重要：它是底层监听容器的 Bean 名，可用于后续控制启停
    @RabbitListener(id = "orderConsumer", queues = "order.queue")
    public void onOrder(String msg) {
        System.out.println("order：" + msg);
    }

    @RabbitListener(id = "payConsumer", queues = "pay.queue")
    public void onPay(String msg) {
        System.out.println("pay：" + msg);
    }
}
```

`id` 是底层 `MessageListenerContainer` 的标识。你可以用它做精细化控制，比如运行时暂停某个消费者：

```java
package com.canoe.rabbitmq;

import org.springframework.amqp.rabbit.listener.RabbitListenerEndpointRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class ListenerController {

    @Autowired
    private RabbitListenerEndpointRegistry registry;

    /** 暂停某个监听器（比如发布时临时停掉） */
    public void pause(String id) {
        registry.getListenerContainer(id).stop();
    }

    /** 恢复 */
    public void resume(String id) {
        registry.getListenerContainer(id).start();
    }
}
```

### 4.6 @RabbitHandler：同一个队列按消息类型分发（多类型重载）

有时候**一个队列里会放不同类型的消息**（比如"创建订单""取消订单"都进 `order.queue`）。`@RabbitHandler` 让你在同一个类里写多个重载方法，Spring 会按消息正文类型自动路由到对应方法。

```java
package com.canoe.rabbitmq.listener;

import org.springframework.amqp.rabbit.annotation.RabbitHandler;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
@RabbitListener(queues = "order.queue")   // 类级别指定队列
public class OrderDispatcher {

    @RabbitHandler
    public void handleCreate(CreateOrder cmd) {
        System.out.println("处理创建订单：" + cmd);
    }

    @RabbitHandler
    public void handleCancel(CancelOrder cmd) {
        System.out.println("处理取消订单：" + cmd);
    }
}
```

::: danger 没有类型头会路由失败（核心坑）
`@RabbitHandler` 能"按类型分发"，前提是**消息里带了类型信息**。Spring 靠 `Jackson2JsonMessageConverter` 在发送时写入的 `__TypeId__` 头（里面是类的全限定名），接收时再用 `JavaTypeMapper` 还原成具体类，最后比对哪个 `@RabbitHandler` 方法的参数类型匹配。

如果你：
- 生产端用的是默认 `SimpleMessageConverter`（不写 `__TypeId__`）；或
- 消费端的 `Jackson2JsonMessageConverter` 没配 `JavaTypeMapper` / 没加 `@JsonTypeInfo`；

那么 Spring 不知道这条消息该分给 `handleCreate` 还是 `handleCancel`，**要么全部进不到正确方法，要么报类型不匹配异常**。

正确做法（完整方案见第五章）：生产端和消费端都统一用 `Jackson2JsonMessageConverter`，并在对象上加 `@JsonTypeInfo`：

```java
package com.canoe.rabbitmq.dto;

import com.fasterxml.jackson.annotation.JsonTypeInfo;

@JsonTypeInfo(use = com.fasterxml.jackson.annotation.JsonTypeInfo.Id.CLASS)
public class CreateOrder {
    private String orderId;
    // getter/setter 省略
}
```

:::

## 五、序列化（重点）：消息不是 Java 对象，是字节

这是新手最容易翻车的地方。RabbitMQ 不认识你的 `User` 对象，它只存 `byte[]`。"对象 → 字节"和"字节 → 对象"这个转换过程就叫**消息转换（Message Conversion）**，由 `MessageConverter` 负责。

### 5.1 默认转换器 SimpleMessageConverter 的坑

Spring Boot 默认装的是 `SimpleMessageConverter`，它只认三种类型：

| 你发的对象类型 | 结果 |
| --- | --- |
| `byte[]` | 直接当正文 |
| `String` | 转成字节 |
| 实现了 `Serializable` 的对象 | JDK 原生序列化（`ObjectOutputStream`） |

也就是说，如果你直接 `convertAndSend("ex", "rk", new User(...))` 而 `User` 没实现 `Serializable`，会直接抛异常。更糟的是，即使实现了，JDK 序列化产出的字节**又大又不可读**，而且**两端类结构稍有不一致（比如加个字段）就反序列化失败**，垮语言更不可能（Go/Python 读不懂 Java 的 JDK 序列化）。

```java
package com.canoe.rabbitmq;

import java.io.Serializable;

/** 必须实现 Serializable，否则默认转换器直接报错 */
public class User implements Serializable {
    private static final long serialVersionUID = 1L;
    private String name;
    // getter/setter 省略
}
```

::: warning 生产环境别用 JDK 序列化
JDK 原生序列化：① 体积大、性能差；② 强耦合 Java 类结构，前后兼容脆弱；③ 跨语言完全不行。真实项目一律用 JSON。
:::

### 5.2 换成 Jackson2JsonMessageConverter（推荐）

JSON 是人可读、语言无关、体积小的首选方案。下面给出**生产端和消费端都要配**的完整代码。

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MqConfig {

    /** 统一的 JSON 转换器 */
    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    /** 注入到 RabbitTemplate（生产者发消息用它） */
    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory,
                                         MessageConverter messageConverter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);
        return template;
    }

    /** 注入到监听器容器工厂（消费者用它反序列化） */
    @Bean
    public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
            ConnectionFactory connectionFactory, MessageConverter messageConverter) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(messageConverter);
        return factory;
    }
}
```

::: tip 生产端和消费端必须一致
这是**铁律**：生产端用 JSON 发，消费端也必须用 JSON 收；如果一端 JDK 一端 JSON，**反序列化必然失败**，消息直接进死信或反复报错。所以上面把同一个 `MessageConverter` Bean 同时塞进了 `RabbitTemplate` 和 `ContainerFactory`。
:::

### 5.3 反序列化的安全：DefaultJackson2JavaTypeMapper 白名单

`Jackson2JsonMessageConverter` 默认会利用消息里的 `__TypeId__` 头，决定把 JSON 反序列化成哪个 Java 类。但**如果不加限制，攻击者可以伪造这个头，让 Jackson 去反序列化任意类**——这就是著名的"Java 反序列化 RCE"漏洞的根源。必须设置可信包白名单。

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.support.converter.DefaultJackson2JavaTypeMapper;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class SafeConverterConfig {

    @Bean
    public MessageConverter safeJsonConverter() {
        Jackson2JsonMessageConverter converter = new Jackson2JsonMessageConverter();

        // JavaTypeMapper：决定 JSON 里的类型头映射到哪个类
        DefaultJackson2JavaTypeMapper typeMapper = new DefaultJackson2JavaTypeMapper();

        // ① 最关键：只允许白名单包下的类被反序列化，杜绝 RCE
        typeMapper.setTrustedPackages("com.canoe.rabbitmq");

        // ② 可选：自定义类型别名映射（消息里写 "order" 而非全限定名，更省带宽也更安全）
        Map<String, Class<?>> idClassMapping = new HashMap<>();
        idClassMapping.put("user", com.canoe.rabbitmq.dto.UserDTO.class);
        idClassMapping.put("order", com.canoe.rabbitmq.dto.CreateOrder.class);
        typeMapper.setIdClassMapping(idClassMapping);

        converter.setJavaTypeMapper(typeMapper);
        return converter;
    }
}
```

::: danger 不设白名单 = 给黑客留门
`DefaultJackson2JavaTypeMapper` 默认在某些版本会信任所有包。生产环境**务必** `setTrustedPackages("com.canoe.rabbitmq")` 或显式列出可信包。否则攻击者只要发一条带恶意 `__TypeId__` 头的消息，就可能触发远程代码执行。安全无小事。
:::

### 5.4 对象加 @JsonTypeInfo 的方案与取舍

除了 5.3 的"类型映射器"方案，还可以直接在类上标注 `@JsonTypeInfo`，让 Jackson 在 JSON 里嵌入类型信息（默认是类的全限定名）：

```java
package com.canoe.rabbitmq.dto;

import com.fasterxml.jackson.annotation.JsonTypeInfo;

@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
public class UserDTO {
    private String name;
    private Integer age;
    // getter/setter 省略
}
```

| 方案 | 优点 | 缺点 | 适用 |
| --- | --- | --- | --- |
| `DefaultJackson2JavaTypeMapper` + 白名单 | 可控、安全、可别名 | 要额外配置 | 生产首选 |
| `@JsonTypeInfo(use = Id.CLASS)` | 零配置、配合 `@RabbitHandler` 路由方便 | JSON 里写死全限定名，改包名就废；跨语言不友好 | 内部服务、配合多类型分发 |

::: tip 和 Redis 篇呼应
本专栏 Redis 篇（06 章）也强调了：用 Jackson 存对象时同样要小心 `__TypeId__` 带来的耦合与安全隐患。结论一致——**生产环境用类型映射器做白名单，比把全限定名硬编码进 JSON 更稳妥**。
:::

### 5.5 ObjectMapper 定制（时间类型、忽略未知字段）

`Jackson2JsonMessageConverter` 默认用自带 `ObjectMapper`，但遇到 `LocalDateTime` 会序列化失败，且对方多一个字段就报错。建议自己配一个：

```java
package com.canoe.rabbitmq.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ObjectMapperConfig {

    @Bean
    public MessageConverter customJsonConverter() {
        Jackson2JsonMessageConverter converter = new Jackson2JsonMessageConverter();

        ObjectMapper mapper = new ObjectMapper();
        // 让 LocalDateTime / LocalDate 正确序列化
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        // 对方多/少字段时不报错，最大兼容
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        converter.setJsonObjectMapper(mapper);
        return converter;
    }
}
```

### 5.6 收发转换器对照表

| 发送端用的转换器 | 接收端必须用的转换器 | 能否成功 |
| --- | --- | --- |
| `Jackson2JsonMessageConverter` | `Jackson2JsonMessageConverter` | ✅ 可以（且需一致的类结构+白名单） |
| `SimpleMessageConverter`（JDK） | `SimpleMessageConverter`（JDK） | ✅ 可以（对象须 `Serializable`） |
| `Jackson2JsonMessageConverter` | `SimpleMessageConverter` | ❌ 失败（一个 JSON 一个 JDK 流） |
| `SimpleMessageConverter` | `Jackson2JsonMessageConverter` | ❌ 失败（JSON 解析 JDK 字节流报错） |

## 六、注解 / Bean 式声明资源

除了第四章用 `@RabbitListener(bindings=...)` 顺手声明，更"正规"的做法是用 `@Bean` 把交换机、队列、绑定都定义出来——**定义在 Spring 容器里的 `Queue`/`Exchange`/`Binding` Bean，会被 `RabbitAdmin` 在连接建立时自动声明到 Broker**。

### 6.1 @Bean 声明四件套

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DeclareConfig {

    /** 队列：durable=true 表示持久化（broker 重启不丢） */
    @Bean
    public Queue orderQueue() {
        return new Queue("order.queue", true);
    }

    @Bean
    public TopicExchange orderTopicExchange() {
        return new TopicExchange("order.topic", true, false);
    }

    @Bean
    public DirectExchange orderDirectExchange() {
        return new DirectExchange("order.direct", true, false);
    }

    @Bean
    public FanoutExchange userFanoutExchange() {
        return new FanoutExchange("user.events", true, false);
    }

    /** 绑定：队列 → 交换机，并指定路由键 */
    @Bean
    public Binding orderBinding(Queue orderQueue, TopicExchange orderTopicExchange) {
        // .with("order.#") 是 topic 匹配规则
        return BindingBuilder.bind(orderQueue).to(orderTopicExchange).with("order.#");
    }
}
```

### 6.2 BindingBuilder 三种绑定写法

`BindingBuilder` 是流式 API，不同交换机类型对应不同 `with` 方法：

| 写法 | 含义 | 适用 |
| --- | --- | --- |
| `BindingBuilder.bind(q).to(directEx).with("pay.success")` | 精确路由键 | Direct |
| `BindingBuilder.bind(q).to(topicEx).with("order.#")` | 模式路由键 | Topic |
| `BindingBuilder.bind(q).to(fanoutEx).noargs()` | fanout 不需要路由键 | Fanout |

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BindingStyleConfig {

    @Bean
    public Queue emailQueue() { return new Queue("email.queue", true); }

    @Bean
    public Queue logQueue() { return new Queue("log.queue", true); }

    @Bean
    public FanoutExchange userFanout() { return new FanoutExchange("user.events", true, false); }

    @Bean
    public TopicExchange orderTopic() { return new TopicExchange("order.topic", true, false); }

    /** Fanout：noargs() */
    @Bean
    public Binding fanoutBinding(Queue emailQueue, FanoutExchange userFanout) {
        return BindingBuilder.bind(emailQueue).to(userFanout).noargs();
    }

    /** Topic：with("#") 表示匹配所有路由键（等同 fanout 的广播效果） */
    @Bean
    public Binding topicAllBinding(Queue logQueue, TopicExchange orderTopic) {
        return BindingBuilder.bind(logQueue).to(orderTopic).with("#");
    }
}
```

::: tip 声明时机：连接一建好就建资源
`RabbitAdmin` 会在 `Connection` 建立（或 Channel 创建）时，扫描容器里所有 `Queue`/`Exchange`/`Binding` Bean 并自动 `declare`。所以你只要 `@Bean` 定义好，不用手动调 `admin.declareQueue(...)`——除非你在运行时动态建资源才需要手动调 `RabbitAdmin` 的方法。
:::

### 6.3 流式 Builder：ExchangeBuilder / QueueBuilder

Spring 还提供流式 Builder，能一行写完"持久化 + TTL + 死信"等高级属性：

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FluentConfig {

    /** 队列：持久化 + 10 秒 TTL + 死信交换机 + 惰性队列 */
    @Bean
    public Queue fluentQueue() {
        return QueueBuilder.durable("order.delay.queue")
                .ttl(10000)                                   // 消息 10 秒过期
                .deadLetterExchange("order.dlx")              // 过期/拒收后转到的死信交换机
                .deadLetterRoutingKey("order.dlq")            // 死信路由键
                .lazy()                                       // 惰性队列：消息直接落盘，适合堆积
                .build();
    }

    /** 交换机：持久化、不自动删 */
    @Bean
    public DirectExchange fluentExchange() {
        return ExchangeBuilder.directExchange("order.direct")
                .durable(true)
                .build();
    }

    @Bean
    public Binding fluentBinding(Queue fluentQueue, DirectExchange fluentExchange) {
        return BindingBuilder.bind(fluentQueue).to(fluentExchange).with("order.create");
    }
}
```

| 链式方法 | 作用 |
| --- | --- |
| `.durable()` | 持久化队列/交换机 |
| `.ttl(毫秒)` | 队列级消息过期时间 |
| `.deadLetterExchange(...)` | 死信交换机 |
| `.deadLetterRoutingKey(...)` | 死信路由键 |
| `.lazy()` | 惰性队列（消息直落磁盘） |

## 七、监听容器：消息到底是"谁"在帮你收

第二章提过，`RabbitListenerContainerFactory` 负责把 `@RabbitListener` 变成真正运行的"消费者容器"。Spring AMQP 提供了两种容器实现，选错会直接影响性能和稳定性。

### 7.1 Simple vs Direct 对比表

| 维度 | `SimpleMessageListenerContainer` | `DirectMessageListenerContainer` |
| --- | --- | --- |
| 线程模型 | 启动时创建固定数量的消费者线程，每个线程长期霸占一个 Channel | 用共享线程池，按需为每个队列/消费者分配短期 Channel，消息处理完即回收 |
| 动态扩缩容 | 改并发数要**停掉容器再重启**才生效 | 可**运行时动态**调整并发、增减队列，无需重启 |
| 内存占用 | 每个消费者常驻一个 Channel，队列多时内存占用高 | 共享资源，队列/消费者多时更省内存 |
| 适用场景 | 队列数少、并发稳定、追求高吞吐的稳态系统 | 队列多、需要动态管理、云原生弹性伸缩 |
| 推荐度 | 老项目常见，新项目一般选 Direct | Spring AMQP 4.x / RabbitMQ 4.x **推荐默认** |

::: tip 怎么选
新项目、队列多、要弹性 → `DirectMessageListenerContainer`。老代码或简单场景 → `SimpleMessageListenerContainer` 也完全够用。两者对 `@RabbitListener` 写法的差异**对开发者透明**，你只是换了个工厂 Bean。
:::

### 7.2 自定义 SimpleRabbitListenerContainerFactory

无论用哪种容器，定制都通过"自定义 `SimpleRabbitListenerContainerFactory` Bean"完成（`DirectMessageListenerContainer` 对应的是 `DirectRabbitListenerContainerFactory`，配置项类似）：

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ContainerConfig {

    @Bean
    public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
            ConnectionFactory connectionFactory, MessageConverter messageConverter) {

        SimpleRabbitListenerContainerFactory factory =
                new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        // ① 消息转换器（JSON）
        factory.setMessageConverter(messageConverter);
        // ② ack 模式：manual 最可控（第 04 篇细讲）
        factory.setAcknowledgeMode(org.springframework.amqp.core.AcknowledgeMode.MANUAL);
        // ③ 并发：初始 3，最大 10
        factory.setConcurrentConsumers(3);
        factory.setMaxConcurrentConsumers(10);
        // ④ 预取：每次最多从 broker 拉多少条到本地（QoS）
        factory.setPrefetchCount(10);
        return factory;
    }
}
```

### 7.3 并发数 × prefetch 的关系（内存未确认上限）

这是个关键数学关系，很多人没概念：

> **并发消费者数 × prefetch = 该队列在内存中"已拉取但未确认"的消息上限。**

举例：`concurrency=3`、`prefetch=10` → 最多有 `3 × 10 = 30` 条消息同时躺在消费者内存里没 ack。如果这个上限设得过大，消息处理慢 + 积压 → 内存被打爆；设得太小 → 消费者经常"饿着"，吞吐上不去。

| 并发 | prefetch | 未确认上限 | 特征 |
| --- | --- | --- | --- |
| 3 | 1 | 3 | 最稳但吞吐低，适合必须保序 |
| 3 | 10 | 30 | 均衡，常用默认值 |
| 10 | 100 | 1000 | 吞吐高，但内存压力大、出错影响面广 |

::: warning prefetch 不是越大越好
prefetch 大 = 批量预取 = 吞吐高，但一旦消费者卡死，那一批未确认消息全卡在内存里，且 broker 也不会把已分配的消息分给别的消费者（"已分配未 ack"）。所以**高 prefetch 配高并发要谨慎**，一般 `prefetch` 取 10~50、`concurrency` 取 3~10 是稳妥区间。
:::

## 八、完整实战 Demo：用户注册后异步发积分 + 发邮件

前面都是零件，现在装一台能跑的车。需求：**用户注册（写库）后，异步给TA加积分、发欢迎邮件**——注册主流程不阻塞在"发邮件"上。

整体思路（用 fanout 广播，两个消费者各干各的）：

```text
注册 Controller
     │  写用户表（同步）
     │  convertAndSend → fanout: user.events, routingKey 随意
     ▼
 RabbitMQ  ──广播──┬──► point.queue ──► 积分消费者：加积分 + 写积分流水
                   └──► email.queue ──► 邮件消费者：发欢迎邮件
```

### 8.1 建表 SQL

```sql
-- 用户表
CREATE TABLE `t_user` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `username`    VARCHAR(64)  NOT NULL COMMENT '用户名',
  `email`       VARCHAR(128) NOT NULL COMMENT '邮箱',
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- 积分流水表
CREATE TABLE `t_point_flow` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`     BIGINT       NOT NULL COMMENT '用户ID',
  `change_type` VARCHAR(32)  NOT NULL COMMENT '变动类型，如 REGISTER',
  `amount`      INT          NOT NULL COMMENT '积分变动值',
  `balance`     INT          NOT NULL COMMENT '变动后余额',
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分流水表';
```

### 8.2 配置（JSON 转换器 + 交换机/队列/绑定）

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DemoConfig {

    /** 统一 JSON 转换器 */
    @Bean
    public MessageConverter messageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    /** 广播交换机 */
    @Bean
    public FanoutExchange userEventsExchange() {
        return new FanoutExchange("user.events", true, false);
    }

    /** 积分队列 */
    @Bean
    public Queue pointQueue() {
        return new Queue("point.queue", true);
    }

    /** 邮件队列 */
    @Bean
    public Queue emailQueue() {
        return new Queue("email.queue", true);
    }

    @Bean
    public Binding pointBinding(Queue pointQueue, FanoutExchange userEventsExchange) {
        return BindingBuilder.bind(pointQueue).to(userEventsExchange).noargs();
    }

    @Bean
    public Binding emailBinding(Queue emailQueue, FanoutExchange userEventsExchange) {
        return BindingBuilder.bind(emailQueue).to(userEventsExchange).noargs();
    }

    @Bean
    public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
            ConnectionFactory connectionFactory, MessageConverter messageConverter) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(messageConverter);
        return factory;
    }
}
```

### 8.3 DTO / Entity 完整代码

```java
package com.canoe.rabbitmq.dto;

import com.fasterxml.jackson.annotation.JsonTypeInfo;
import java.time.LocalDateTime;

/** 注册事件：生产端发出、两个消费者都接收它 */
@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
public class UserRegisteredEvent {
    private Long userId;
    private String username;
    private String email;
    private LocalDateTime registeredAt;

    public UserRegisteredEvent() {}

    public UserRegisteredEvent(Long userId, String username, String email, LocalDateTime registeredAt) {
        this.userId = userId;
        this.username = username;
        this.email = email;
        this.registeredAt = registeredAt;
    }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public LocalDateTime getRegisteredAt() { return registeredAt; }
    public void setRegisteredAt(LocalDateTime registeredAt) { this.registeredAt = registeredAt; }
}
```

```java
package com.canoe.rabbitmq.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "t_user")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String username;

    @Column(nullable = false)
    private String email;

    private LocalDateTime createTime = LocalDateTime.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public LocalDateTime getCreateTime() { return createTime; }
    public void setCreateTime(LocalDateTime createTime) { this.createTime = createTime; }
}
```

```java
package com.canoe.rabbitmq.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "t_point_flow")
public class PointFlow {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    @Column(nullable = false)
    private String changeType;

    @Column(nullable = false)
    private Integer amount;

    @Column(nullable = false)
    private Integer balance;

    private LocalDateTime createTime = LocalDateTime.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getChangeType() { return changeType; }
    public void setChangeType(String changeType) { this.changeType = changeType; }
    public Integer getAmount() { return amount; }
    public void setAmount(Integer amount) { this.amount = amount; }
    public Integer getBalance() { return balance; }
    public void setBalance(Integer balance) { this.balance = balance; }
    public LocalDateTime getCreateTime() { return createTime; }
    public void setCreateTime(LocalDateTime createTime) { this.createTime = createTime; }
}
```

### 8.4 Repository

```java
package com.canoe.rabbitmq.repository;

import com.canoe.rabbitmq.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, Long> {
}
```

```java
package com.canoe.rabbitmq.repository;

import com.canoe.rabbitmq.entity.PointFlow;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PointFlowRepository extends JpaRepository<PointFlow, Long> {
}
```

### 8.5 Controller：注册接口（同步写库 + 发消息）

```java
package com.canoe.rabbitmq.controller;

import com.canoe.rabbitmq.dto.UserRegisteredEvent;
import com.canoe.rabbitmq.entity.User;
import com.canoe.rabbitmq.repository.UserRepository;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @PostMapping("/register")
    public String register(@RequestParam String username, @RequestParam String email) {
        // 1）同步写主库（注册是核心业务，必须落库成功）
        User user = new User();
        user.setUsername(username);
        user.setEmail(email);
        user.setCreateTime(LocalDateTime.now());
        userRepository.save(user);

        // 2）发广播事件：后续动作（积分、邮件）异步处理，不阻塞注册返回
        UserRegisteredEvent event = new UserRegisteredEvent(
                user.getId(), username, email, LocalDateTime.now());
        // fanout 交换机不在乎 routingKey，写 "" 即可
        rabbitTemplate.convertAndSend("user.events", "", event);

        return "注册成功，userId=" + user.getId();
    }
}
```

### 8.6 两个消费者：积分服务 & 邮件服务

```java
package com.canoe.rabbitmq.listener;

import com.canoe.rabbitmq.dto.UserRegisteredEvent;
import com.canoe.rabbitmq.entity.PointFlow;
import com.canoe.rabbitmq.repository.PointFlowRepository;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class PointConsumer {

    @Autowired
    private PointFlowRepository pointFlowRepository;

    /** 监听积分队列：注册后加 100 积分，并落积分流水 */
    @RabbitListener(queues = "point.queue")
    public void onUserRegistered(UserRegisteredEvent event) {
        System.out.println("[积分] 给用户 " + event.getUsername() + " 加注册积分");

        PointFlow flow = new PointFlow();
        flow.setUserId(event.getUserId());
        flow.setChangeType("REGISTER");
        flow.setAmount(100);
        flow.setBalance(100);
        pointFlowRepository.save(flow);

        System.out.println("[积分] 已记录积分流水，userId=" + event.getUserId());
    }
}
```

```java
package com.canoe.rabbitmq.listener;

import com.canoe.rabbitmq.dto.UserRegisteredEvent;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class EmailConsumer {

    /** 监听邮件队列：发欢迎邮件（这里用打印模拟真实发信） */
    @RabbitListener(queues = "email.queue")
    public void onUserRegistered(UserRegisteredEvent event) {
        System.out.println("[邮件] 正在给 " + event.getEmail()
                + " 发送欢迎邮件，用户名=" + event.getUsername());
        // 真实项目里这里调用邮件 SDK（如 JavaMail / 阿里云邮件推送）
    }
}
```

### 8.7 用 curl 验证 + 预期日志

```bash
# 触发注册
curl -X POST "http://localhost:8080/api/users/register?username=zhangsan&email=zhang%40example.com"
```

预期控制台输出（两个消费者从各自队列收到同一条广播）：

```text
[积分] 给用户 zhangsan 加注册积分
[积分] 已记录积分流水，userId=1
[邮件] 正在给 zhang@example.com 发送欢迎邮件，用户名=zhangsan
```

去管理后台 `http://localhost:15672` 的 Queues 页，能看到 `point.queue` 和 `email.queue` 的 `Ready` 数从 1 变回 0（已被消费）。

::: tip 为什么一条消息能被两个消费者各收一次
因为用的是 **fanout 广播交换机**，"用户注册事件"被同时投递到了 `point.queue` 和 `email.queue`。这和"点对点"的 work 模式（一条消息只被一个消费者吃）不同，广播模式天然适合"一个事件触发多个后续动作"。
:::

## 九、常见坑清单

把新手最容易踩的坑列成一张清单，照着自查：

| 序号 | 坑 | 现象 | 解法 |
| --- | --- | --- | --- |
| 1 | 端口写错 | 连不上/超时 | `port` 用 `5672`，别用 `15672` |
| 2 | 生产/消费转换器不一致 | 反序列化异常 | 两端统一 `Jackson2JsonMessageConverter` |
| 3 | JSON 反序列化无白名单 | 安全告警/兼容差 | `setTrustedPackages` 设白名单 |
| 4 | `@RabbitHandler` 路由不到 | 类型不匹配异常 | 用 JSON 转换器 + `@JsonTypeInfo` 或类型映射 |
| 5 | `receive()` 和 `@RabbitListener` 混用 | 消息被抢、重复处理 | 一个队列只选一种消费方式 |
| 6 | `convertSendAndReceive` 当异步用 | 线程阻塞、吞吐崩 | 异步场景用 `convertAndSend` |
| 7 | prefetch 设太大 | 内存堆积、出错面广 | 取 10~50，`并发×prefetch` 控制在合理范围 |
| 8 | 队列没声明就监听 | 启动报队列不存在 | 用 `@Bean` 或 `bindings` 先把资源建好 |
| 9 | 忘了持久化 | broker 重启消息丢 | 队列/交换机 `durable=true` + 消息 `PERSISTENT`（第 04 篇） |
| 10 | 监听器方法抛异常无处理 | 消息无限 requeue | 配重试 + 死信兜底（第 04 篇） |

## 本篇小结

- **连接 RabbitMQ 就是填 `host/port/virtual-host/username/password`**，`port` 用 `5672`（数据端口），`15672` 是管理后台。
- **三大核心类各司其职**：`RabbitAdmin` 管基础设施、`RabbitTemplate` 管收发、`RabbitListenerContainerFactory` 把 `@RabbitListener` 变成消费者容器。
- **`convertAndSend` 是发消息主力**；`convertSendAndReceive` 会**阻塞线程**，异步场景千万别用。
- **`receive()` 主动拉消息不要和 `@RabbitListener` 推模式混用同一队列**，会互相抢消息。
- **序列化首选 `Jackson2JsonMessageConverter`**，默认 `SimpleMessageConverter` 要求对象实现 `Serializable` 且垮语言不可用。
- **生产端和消费端必须用同一个转换器**，否则反序列化失败。
- **反序列化必须设 `setTrustedPackages` 白名单**，否则有 RCE 风险。
- **`@RabbitHandler` 按类型分发依赖 `__TypeId__` 类型头**，需统一 JSON 转换器并在类上加 `@JsonTypeInfo`。
- **资源声明两种方式**：`@Bean` 定义（`RabbitAdmin` 自动建）或 `@RabbitListener(bindings=...)` 顺手建；`BindingBuilder` 有 `with` / `with("#")` / `noargs()` 三种。
- **`并发数 × prefetch = 内存中未确认消息上限`**，一般 `prefetch=10~50`、`concurrency=3~10`。
- **fanout 广播适合"一个事件触发多个动作"**，本篇 Demo 用它让积分/邮件两个消费者各收一份。

## 参考链接

- Spring AMQP 官方文档（Reference）：<https://docs.spring.io/spring-amqp/reference/>
- Spring Boot Messaging（RabbitMQ）配置项：<https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#messaging.amqp>
- `RabbitTemplate` JavaDoc：<https://docs.spring.io/spring-amqp/docs/current/api/org/springframework/amqp/rabbit/core/RabbitTemplate.html>
- `Jackson2JsonMessageConverter` JavaDoc：<https://docs.spring.io/spring-amqp/docs/current/api/org/springframework/amqp/support/converter/Jackson2JsonMessageConverter.html>
- `@RabbitListener` 注解文档：<https://docs.spring.io/spring-amqp/reference/amqp/receiving.html>
- `SimpleMessageListenerContainer` vs `DirectMessageListenerContainer`：<https://docs.spring.io/spring-amqp/reference/amqp/listener-containers.html>
- RabbitMQ Java 客户端（Channel/ACK）：<https://www.rabbitmq.com/client-libraries/java-api-guide>

下一篇 → [04 可靠性投递全解](/java/middleware/rabbitmq/reliability)
