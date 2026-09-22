# 05 Spring Boot 整合实战

> 本篇把 RocketMQ 接进 Spring Boot：`rocketmq-spring-boot-starter` 怎么用、`RocketMQTemplate` 的 API 全景、`@RocketMQMessageListener` 每个参数是啥意思、事务消息在 Spring Boot 里怎么写、最后给一个**完整的下单事务消息实战**（含建表 SQL、Service、Controller）。同时给出"starter 版本对不上"时的**退路方案**。

## 本篇要解决的问题

- 依赖加哪个？版本怎么和 Spring Boot 3.5 对齐？
- `RocketMQTemplate` 那么多 `syncSend` 重载，到底用哪个？`topic:tag` 这个写法是什么鬼？
- `@RocketMQMessageListener` 里一堆参数都是干什么的？
- 事务消息在 Spring Boot 里怎么写？注解叫什么？
- 消费者没启动、收不到消息，怎么排查？

## 一、依赖与配置

### Maven 依赖

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
    <artifactId>rocketmq-spring-demo</artifactId>
    <version>1.0.0</version>

    <properties>
        <java.version>17</java.version>
        <!-- rocketmq-spring 版本，2.3.x 起支持 Spring Boot 3 -->
        <rocketmq-spring.version>2.3.0</rocketmq-spring.version>
    </properties>

    <dependencies>
        <!-- Spring Web -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- ★ RocketMQ Spring Boot Starter -->
        <dependency>
            <groupId>org.apache.rocketmq</groupId>
            <artifactId>rocketmq-spring-boot-starter</artifactId>
            <version>${rocketmq-spring.version}</version>
        </dependency>

        <!-- JSON（starter 内部也依赖，显式声明方便统一版本） -->
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
        </dependency>

        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>

        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
```

::: warning 版本兼容性请以官方为准
`rocketmq-spring-boot-starter` 的版本与 Spring Boot 版本的对应关系**更新比较频繁**，请以 [rocketmq-spring 的 GitHub README](https://github.com/apache/rocketmq-spring) 和 Maven Central 为准。

已知规律：**2.3.x 开始支持 Spring Boot 3.x**。如果你的 Spring Boot 是 3.5，建议取 2.3.x 里最新的 patch 版本。启动时如果报 `NoSuchMethodError`、`ClassNotFoundException` 之类的兼容性问题，多半就是版本没对上——这时候请用本篇最后一节的**退路方案**。
:::

### application.yml

```yaml
rocketmq:
  # NameServer 地址，多个用分号分隔
  name-server: 127.0.0.1:9876

  # ===== 生产者配置 =====
  producer:
    # 生产者组（不配的话默认是 spring.application.name + "-producer"）
    group: canoe_producer_group
    # 发送超时时间（毫秒）
    send-message-timeout: 5000
    # 同步发送失败重试次数
    retry-times-when-send-failed: 2
    # 异步发送失败重试次数
    retry-times-when-send-async-failed: 2
    # 消息体超过多少字节就压缩（默认 4096）
    compress-message-body-threshold: 4096
    # 最大消息体大小，默认 4MB（4194304）
    max-message-size: 4194304
    # 是否关闭 VIP 通道（有些环境只开了 10911，没开 10909）
    vip-channel-enabled: false
    # 是否开启消息轨迹
    enable-msg-trace: false

  # ===== 消费者配置（作为 @RocketMQMessageListener 的默认值） =====
  consumer:
    # 消费线程数
    consume-thread-max: 32
    # 一次拉取多少条
    pull-batch-size: 32

spring:
  application:
    name: rocketmq-spring-demo

server:
  port: 8080

logging:
  level:
    # 打开能看到收发日志
    org.apache.rocketmq: INFO
    com.canoe: DEBUG
```

## 二、RocketMQTemplate API 全景

`RocketMQTemplate` 是对 `DefaultMQProducer` 的封装，注入就能用。

### destination 的写法（重点）

RocketMQ Spring 里所有发送方法的第一个参数叫 `destination`，格式是：

```text
topic                 →  "ORDER_TOPIC"
topic:tag             →  "ORDER_TOPIC:CREATE"
```

**冒号后面是 Tag**，不写就是没有 Tag。

```java
// 发到 ORDER_TOPIC，不带 tag
rocketMQTemplate.syncSend("ORDER_TOPIC", payload);

// 发到 ORDER_TOPIC，tag = CREATE
rocketMQTemplate.syncSend("ORDER_TOPIC:CREATE", payload);
```

::: tip 为什么用冒号而不是单独一个参数
这是为了兼容 Spring 生态（Spring Cloud Stream 也用类似写法）。习惯就好，注意 **Topic 名字里不能带冒号**。
:::

### 发送方法对照表

| 方法 | 对应原生 | 说明 |
| --- | --- | --- |
| `syncSend(destination, payload)` | `send()` | **同步发送**，最常用 |
| `syncSend(destination, payload, timeout)` | `send(msg, timeout)` | 指定超时 |
| `syncSend(destination, Message<?>)` | `send()` | 用 Spring `Message` 包装（可带 header） |
| `syncSend(destination, payload, timeout, delayLevel)` | 延时消息 | **第 4 个参数是延时等级**（4.x 的 1~18） |
| `syncSendOrderly(destination, payload, hashKey)` | `send(msg, selector, arg)` | **顺序发送**，hashKey 相同的进同一队列 |
| `asyncSend(destination, payload, SendCallback)` | `send(msg, callback)` | **异步发送** |
| `sendOneWay(destination, payload)` | `sendOneway()` | **单向发送**（不关心结果） |
| `convertAndSend(destination, payload)` | — | 走 `MessageConverter` 转换后发送 |
| `sendAndReceive(destination, payload, type)` | `request-reply` | **发送请求并同步等待回复**（5.x，需要消费端配合） |
| `sendMessageInTransaction(destination, message, arg)` | 事务消息 | 见后面事务章节 |

### 完整示例

```java
package com.canoe.rocketmq.service;

import org.apache.rocketmq.client.producer.SendCallback;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.spring.core.RocketMQTemplate;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;

/**
 * RocketMQTemplate 发送 API 全景示例。
 */
@Service
public class SendApiService {

    @Resource
    private RocketMQTemplate rocketMQTemplate;

    /** 1. 同步发送（最常用，核心业务用它） */
    public SendResult sendSync(String payload) {
        // 返回 SendResult，可以拿到 msgId、队列、发送状态
        return rocketMQTemplate.syncSend("ORDER_TOPIC:CREATE", payload);
    }

    /** 2. 同步发送 + 指定超时时间（毫秒） */
    public SendResult sendSyncWithTimeout(String payload) {
        return rocketMQTemplate.syncSend("ORDER_TOPIC:CREATE", payload, 5000);
    }

    /** 3. 同步发送 + 延时等级（4.x：等级 3 = 10 秒；5.x 建议用 Message 设 setDelayTimeSec） */
    public SendResult sendDelay(String payload) {
        // 第 4 个参数 delayLevel：1~18，见 04 篇的等级表
        return rocketMQTemplate.syncSend("ORDER_TOPIC:CREATE", payload, 5000, 3);
    }

    /** 4. 顺序发送：同一个 hashKey 的消息进同一个队列 */
    public SendResult sendOrderly(String orderNo, String payload) {
        // hashKey 一般传订单号、userId 这类业务 key
        return rocketMQTemplate.syncSendOrderly("ORDER_TOPIC", payload, orderNo);
    }

    /** 5. 异步发送：结果在回调里 */
    public void sendAsync(String payload) {
        rocketMQTemplate.asyncSend("ORDER_TOPIC:CREATE", payload, new SendCallback() {
            @Override
            public void onSuccess(SendResult sendResult) {
                System.out.println("异步发送成功：" + sendResult.getMsgId());
            }

            @Override
            public void onException(Throwable e) {
                // 生产环境这里必须做补偿：落库 + 定时重投
                System.err.println("异步发送失败：" + e.getMessage());
            }
        });
    }

    /** 6. 单向发送：发出去就不管，可能丢，但最快 */
    public void sendOneWay(String payload) {
        rocketMQTemplate.sendOneWay("ORDER_TOPIC:CREATE", payload);
    }

    /** 7. 带 Spring Message header 发送（可以塞自定义属性） */
    public SendResult sendWithHeader(String payload) {
        return rocketMQTemplate.syncSend(
                "ORDER_TOPIC:CREATE",
                MessageBuilder.withPayload(payload)
                        // 这些 header 会变成 Message 的用户属性，可用于 SQL92 过滤
                        .setHeader("amount", "299")
                        .setHeader("region", "SH")
                        .build()
        );
    }
}
```

### 发送对象（自动 JSON 序列化）

`RocketMQTemplate` 默认用 Jackson 把对象转成 JSON 字节数组，所以**可以直接发对象**：

```java
package com.canoe.rocketmq.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 订单创建消息体。
 * 建议：消息体不一定要实现 Serializable（JSON 序列化不需要），但写上更保险。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OrderCreatedEvent implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 订单号（业务唯一键） */
    private String orderNo;
    /** 用户 ID */
    private Long userId;
    /** 商品 ID */
    private Long productId;
    /** 数量 */
    private Integer quantity;
    /** 金额 */
    private BigDecimal amount;
    /** 创建时间 */
    private LocalDateTime createTime;
}
```

```java
// 直接发对象，starter 会帮你做 JSON 序列化
OrderCreatedEvent event = new OrderCreatedEvent("ORDER_10086", 1001L, 2001L, 2,
        new BigDecimal("199.00"), LocalDateTime.now());
rocketMQTemplate.syncSend("ORDER_TOPIC:CREATE", event);
```

::: tip LocalDateTime 序列化的坑
Jackson 默认不认识 Java 8 时间类型，会抛 `InvalidDefinitionException`。解决办法：

```java
@Configuration
public class JacksonConfig {
    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        // 注册 Java 8 时间模块
        mapper.registerModule(new JavaTimeModule());
        // 时间序列化成 ISO 字符串而不是时间戳数组
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        // 忽略不认识的字段（防止消息体加字段后老消费者报错）
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        return mapper;
    }
}
```
:::

## 三、@RocketMQMessageListener 详解

### 参数全解

```java
@RocketMQMessageListener(
        topic = "ORDER_TOPIC",                    // 订阅的 Topic（必填）
        consumerGroup = "order-consumer-group",   // 消费组（必填）
        selectorType = SelectorType.TAG,          // 过滤类型：TAG（默认）或 SQL92
        selectorExpression = "CREATE || PAY",     // 过滤表达式：TAG 写 "CREATE || PAY"；SQL92 写 "amount > 100"
        consumeMode = ConsumeMode.CONCURRENTLY,   // 并发消费（默认）或 ORDERLY（顺序）
        messageModel = MessageModel.CLUSTERING,   // 集群消费（默认）或 BROADCASTING（广播）
        consumeThreadNumber = 32,                 // 消费线程数，默认 20
        maxReconsumeTimes = 3                     // 最大重试次数，超过进死信队列
)
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `topic` | — | **必填**，要订阅的 Topic |
| `consumerGroup` | — | **必填**，消费组名。**同组内分摊消费** |
| `selectorType` | `TAG` | `TAG`（按 Tag 过滤）或 `SQL92`（按属性表达式过滤） |
| `selectorExpression` | `"*"` | TAG 模式：`"*"` 全部、`"CREATE"`、`"CREATE \|\| PAY"`；SQL92 模式：`"amount > 100"` |
| `consumeMode` | `CONCURRENTLY` | `CONCURRENTLY`（并发，吞吐高）/ `ORDERLY`（顺序，保证队列内有序） |
| `messageModel` | `CLUSTERING` | `CLUSTERING`（集群分摊）/ `BROADCASTING`（广播全量） |
| `consumeThreadNumber` | 20 | 消费线程数 |
| `maxReconsumeTimes` | -1（用 Broker 默认 16） | 最大重试次数 |
| `replyTopic` | — | 用于 request-reply 模式（`sendAndReceive`） |

### 三种监听器写法

```java
package com.canoe.rocketmq.consumer;

import org.apache.rocketmq.spring.annotation.RocketMQMessageListener;
import org.apache.rocketmq.spring.core.RocketMQListener;
import org.springframework.stereotype.Component;

/**
 * 写法 1：最简单，实现 RocketMQListener<T>，泛型里直接写消息类型。
 * starter 会自动把 JSON 反序列化成 OrderCreatedEvent。
 */
@Component
@RocketMQMessageListener(
        topic = "ORDER_TOPIC",
        consumerGroup = "order-consumer-group",
        selectorExpression = "CREATE",
        consumeThreadNumber = 16
)
public class OrderCreatedListener implements RocketMQListener<OrderCreatedEvent> {

    @Override
    public void onMessage(OrderCreatedEvent event) {
        System.out.println("收到订单创建消息：" + event);
        // 业务处理……
        // 抛异常 = 消费失败，会触发重试（RocketMQListener 抛出即失败）
    }
}
```

```java
package com.canoe.rocketmq.consumer;

import org.apache.rocketmq.common.message.MessageExt;
import org.apache.rocketmq.spring.annotation.RocketMQMessageListener;
import org.apache.rocketmq.spring.core.RocketMQListener;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

/**
 * 写法 2：泛型写 MessageExt，能拿到消息的全部元信息（keys、tags、重试次数、属性）。
 * 需要做幂等判断、想看 reconsumeTimes 时用这种。
 */
@Component
@RocketMQMessageListener(
        topic = "ORDER_TOPIC",
        consumerGroup = "order-ext-consumer-group",
        selectorExpression = "*"
)
public class OrderExtListener implements RocketMQListener<MessageExt> {

    @Override
    public void onMessage(MessageExt message) {
        String orderNo = message.getKeys();
        int reconsumeTimes = message.getReconsumeTimes();
        String body = new String(message.getBody(), StandardCharsets.UTF_8);

        System.out.printf("收到：orderNo=%s, 第 %d 次消费, body=%s%n",
                orderNo, reconsumeTimes + 1, body);

        try {
            // 幂等判断
            if (!canConsume(orderNo)) {
                return;
            }
            doBiz(body);
        } catch (Exception e) {
            if (reconsumeTimes >= 3) {
                // 超过阈值，记录后放行，避免无限重试
                saveToFailedTable(orderNo, body, e);
                return;
            }
            // 抛出异常触发重试
            throw new RuntimeException(e);
        }
    }

    private boolean canConsume(String orderNo) {
        return true;
    }

    private void doBiz(String body) {
    }

    private void saveToFailedTable(String orderNo, String body, Exception e) {
    }
}
```

```java
package com.canoe.rocketmq.consumer;

import org.apache.rocketmq.spring.annotation.RocketMQMessageListener;
import org.apache.rocketmq.spring.core.RocketMQReplyListener;
import org.springframework.stereotype.Component;

/**
 * 写法 3：RocketMQReplyListener —— 消费后还能"回复"一个结果。
 * 配合 rocketMQTemplate.sendAndReceive() 使用（request-reply 模式）。
 */
@Component
@RocketMQMessageListener(
        topic = "QUERY_TOPIC",
        consumerGroup = "query-consumer-group"
)
public class QueryReplyListener implements RocketMQReplyListener<String, String> {

    @Override
    public String onMessage(String question) {
        // 处理并返回一个结果，这个结果会被 sendAndReceive 那边收到
        return "答案是：" + question.toUpperCase();
    }
}
```

::: warning 抛异常 = 消费失败
用 `RocketMQListener` 时，**方法里抛出任何异常都会被 starter 捕获并返回 `RECONSUME_LATER`**，触发重试。

所以**别在 `onMessage` 里吞掉异常**（catch 了不打不抛），否则会返回 `CONSUME_SUCCESS`，消息"假装消费成功"然后消失。要区分：
- 可重试错误（网络抖动、依赖暂时不可用）→ 抛异常
- 不可重试错误（参数非法、数据不存在）→ catch 住并**记录 + 正常返回**
:::

### 顺序消费和广播消费

```java
// 顺序消费：consumeMode = ORDERLY
@Component
@RocketMQMessageListener(
        topic = "ORDER_TOPIC",
        consumerGroup = "order-orderly-group",
        consumeMode = ConsumeMode.ORDERLY,   // ★ 顺序消费
        consumeThreadNumber = 8
)
public class OrderOrderlyListener implements RocketMQListener<MessageExt> {
    @Override
    public void onMessage(MessageExt message) {
        // 同一个队列内串行执行
    }
}

// 广播消费：messageModel = BROADCASTING（典型场景：刷新本地缓存）
@Component
@RocketMQMessageListener(
        topic = "CONFIG_TOPIC",
        consumerGroup = "cache-refresh-group",
        messageModel = MessageModel.BROADCASTING   // ★ 广播，每台机器都收到
)
public class CacheRefreshListener implements RocketMQListener<String> {
    @Override
    public void onMessage(String configKey) {
        // 清本地缓存
    }
}
```

### SQL92 过滤

```java
@Component
@RocketMQMessageListener(
        topic = "ORDER_TOPIC",
        consumerGroup = "big-order-group",
        selectorType = SelectorType.SQL92,          // ★ 切到 SQL92
        selectorExpression = "amount > 100 AND region = 'SH'"
)
public class BigOrderListener implements RocketMQListener<MessageExt> {
    @Override
    public void onMessage(MessageExt message) {
        // 只收到金额 > 100 且上海的订单
    }
}
```

::: danger 忘了开 enablePropertyFilter 会直接启动失败
Broker 没开 `enablePropertyFilter=true` 时，SQL92 消费者启动会报：

```text
CODE: 1  DESC: The broker does not support consumer to filter message by SQL92
```

去 `broker.conf` 加上 `enablePropertyFilter = true` 并重启 Broker。
:::

## 四、事务消息（Spring Boot 版）

Spring Boot 里用 `@RocketMQTransactionListener` 注解 + 实现 `RocketMQLocalTransactionListener` 接口。

```java
package com.canoe.rocketmq.transaction;

import org.apache.rocketmq.spring.annotation.RocketMQTransactionListener;
import org.apache.rocketmq.spring.core.RocketMQLocalTransactionListener;
import org.apache.rocketmq.spring.core.RocketMQLocalTransactionState;
import org.springframework.messaging.Message;

import jakarta.annotation.Resource;

/**
 * 事务消息监听器（Spring Boot 版）。
 *
 * 接口方法名和原生 API 不一样，注意区分：
 *   原生：TransactionListener.executeLocalTransaction / checkLocalTransaction
 *   Spring：RocketMQLocalTransactionListener.executeLocalTransaction / checkLocalTransaction
 * 返回值类型也不同：
 *   原生：LocalTransactionState.COMMIT_MESSAGE / ROLLBACK_MESSAGE / UNKNOW
 *   Spring：RocketMQLocalTransactionState.COMMIT / ROLLBACK / UNKNOWN
 */
@RocketMQTransactionListener
public class OrderTransactionListenerImpl implements RocketMQLocalTransactionListener {

    @Resource
    private OrderService orderService;

    /**
     * 执行本地事务。半消息发送成功后回调。
     */
    @Override
    public RocketMQLocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        String orderNo = (String) msg.getHeaders().get("KEYS");
        System.out.println("【本地事务】开始，订单：" + orderNo);

        try {
            // 在一个 @Transactional 里：写订单表 + 扣库存 + 写事务日志表
            orderService.createOrderWithTx(orderNo, arg);
            return RocketMQLocalTransactionState.COMMIT;
        } catch (Exception e) {
            System.err.println("【本地事务】异常，返回 UNKNOWN 等待回查：" + e.getMessage());
            // 别直接 ROLLBACK，可能已经写了一半；让回查去数据库确认
            return RocketMQLocalTransactionState.UNKNOWN;
        }
    }

    /**
     * 回查本地事务状态。
     * 必须查数据库，不能查内存（进程可能重启过）。
     */
    @Override
    public RocketMQLocalTransactionState checkLocalTransaction(Message msg) {
        String orderNo = (String) msg.getHeaders().get("KEYS");
        System.out.println("【回查】订单：" + orderNo);

        // 查"事务日志表"是比查订单表更好的做法：
        // 订单表可能因为业务原因被删改，事务日志表只记录"这个订单的本地事务做没做成"
        Integer state = orderService.queryTransactionLog(orderNo);

        if (state == null) {
            return RocketMQLocalTransactionState.UNKNOWN;  // 还没执行完，等下次
        }
        return state == 1
                ? RocketMQLocalTransactionState.COMMIT
                : RocketMQLocalTransactionState.ROLLBACK;
    }
}
```

发送事务消息：

```java
// 用 sendMessageInTransaction，注意 destination 的 topic:tag 写法
rocketMQTemplate.sendMessageInTransaction("ORDER_TOPIC:CREATE",
        MessageBuilder.withPayload(event)
                .setHeader("KEYS", orderNo)   // 设置 keys，回查时能拿回来
                .build(),
        extraArg);                            // 透传给 executeLocalTransaction 的 arg
```

::: warning 状态枚举名字不一样，别搞混
原生 API 是 `LocalTransactionState.COMMIT_MESSAGE`，Spring 封装后是 `RocketMQLocalTransactionState.COMMIT`。**名字差一个后缀**，写错了编译不过。
:::

## 五、完整实战：下单事务消息

### 建表 SQL

```sql
-- 订单表
CREATE TABLE `t_order` (
    `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
    `order_no`    VARCHAR(64)  NOT NULL COMMENT '订单号（业务唯一键）',
    `user_id`     BIGINT       NOT NULL COMMENT '用户ID',
    `product_id`  BIGINT       NOT NULL COMMENT '商品ID',
    `quantity`    INT          NOT NULL DEFAULT 1 COMMENT '数量',
    `amount`      DECIMAL(10,2) NOT NULL COMMENT '订单金额',
    `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '状态：0-待支付 1-已支付 2-已关闭',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '订单表';

-- 商品库存表
CREATE TABLE `t_product` (
    `id`       BIGINT  NOT NULL AUTO_INCREMENT,
    `name`     VARCHAR(128) NOT NULL COMMENT '商品名',
    `stock`    INT     NOT NULL DEFAULT 0 COMMENT '库存',
    `version`  INT     NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '商品表';

-- ★ 事务日志表（回查用的"真相来源"）
-- 这张表是关键：它记录"某个订单的本地事务到底做没做成"
CREATE TABLE `t_transaction_log` (
    `id`          BIGINT      NOT NULL AUTO_INCREMENT,
    `tx_id`       VARCHAR(64) NOT NULL COMMENT '事务ID，一般用订单号',
    `state`       TINYINT     NOT NULL COMMENT '1-已提交 2-已回滚',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tx_id` (`tx_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '本地事务日志表';
```

### Service（本地事务）

```java
package com.canoe.rocketmq.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;

/**
 * 订单服务：本地事务（写订单 + 扣库存 + 写事务日志）在一个数据库事务里。
 */
@Slf4j
@Service
public class OrderService {

    @Resource
    private OrderMapper orderMapper;

    @Resource
    private ProductMapper productMapper;

    @Resource
    private TransactionLogMapper transactionLogMapper;

    /**
     * 本地事务：写订单 + 扣库存 + 写事务日志，三者要么都成功要么都失败。
     *
     * @param orderNo 订单号
     * @param arg     透传参数
     */
    @Transactional(rollbackFor = Exception.class)
    public void createOrderWithTx(String orderNo, Object arg) {
        // 1. 扣库存（用乐观锁防止超卖）
        //    UPDATE t_product SET stock = stock - #{qty}, version = version + 1
        //    WHERE id = #{productId} AND stock >= #{qty} AND version = #{version}
        int rows = productMapper.deductStock(1001L, 2);
        if (rows == 0) {
            throw new RuntimeException("库存不足");
        }

        // 2. 写订单表
        orderMapper.insertOrder(orderNo, 1001L, 2001L, 2);

        // 3. ★ 写事务日志表：这是回查时唯一可信的真相
        //    放在同一个 @Transactional 里，保证和订单表要么都成功要么都失败
        transactionLogMapper.insertLog(orderNo, 1);

        log.info("本地事务执行成功，订单：{}", orderNo);
    }

    /**
     * 回查：查事务日志表。
     *
     * @return null-还没执行完；1-已提交；2-已回滚
     */
    public Integer queryTransactionLog(String txId) {
        return transactionLogMapper.selectStateByTxId(txId);
    }

    /** 幂等关单：只有"待支付"状态才能改成"已关闭" */
    @Transactional(rollbackFor = Exception.class)
    public boolean closeOrderIfUnpaid(String orderNo) {
        // UPDATE t_order SET status = 2 WHERE order_no = #{orderNo} AND status = 0
        // 影响行数为 0 说明已被处理过或已支付，天然幂等
        int rows = orderMapper.closeIfUnpaid(orderNo);
        if (rows > 0) {
            // 回库存
            productMapper.restoreStock(1001L, 2);
            log.info("订单 {} 已关闭并回库存", orderNo);
            return true;
        }
        log.info("订单 {} 已支付或已处理，跳过", orderNo);
        return false;
    }
}
```

### Controller（发送事务消息）

```java
package com.canoe.rocketmq.controller;

import com.canoe.rocketmq.model.OrderCreatedEvent;
import lombok.extern.slf4j.Slf4j;
import org.apache.rocketmq.spring.core.RocketMQTemplate;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.annotation.Resource;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 下单接口：发事务消息。
 */
@Slf4j
@RestController
public class OrderController {

    @Resource
    private RocketMQTemplate rocketMQTemplate;

    /**
     * 下单：走事务消息，保证"本地事务成功 ⟺ 消息被投递"。
     */
    @PostMapping("/order/create")
    public String createOrder(@RequestParam(defaultValue = "1001") Long userId) {
        String orderNo = "ORDER_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);

        OrderCreatedEvent event = new OrderCreatedEvent(
                orderNo, userId, 2001L, 2, new BigDecimal("199.00"), LocalDateTime.now());

        // 发事务消息：
        //   ① Broker 先存半消息（对消费者不可见）
        //   ② 回调 OrderTransactionListenerImpl.executeLocalTransaction 执行本地事务
        //   ③ 本地事务成功 → COMMIT，消息对消费者可见
        org.springframework.messaging.Message<OrderCreatedEvent> message =
                MessageBuilder.withPayload(event)
                        // 设置 KEYS，回查时能拿回来定位订单
                        .setHeader("KEYS", orderNo)
                        .build();

        rocketMQTemplate.sendMessageInTransaction("ORDER_TOPIC:CREATE", message, null);

        return "下单请求已受理，订单号：" + orderNo;
    }

    /**
     * 普通消息（对照用）。
     */
    @PostMapping("/order/notify")
    public String notifyOrder(@RequestParam String orderNo) {
        rocketMQTemplate.syncSend("ORDER_TOPIC:CREATE", orderNo);
        return "已发送普通消息";
    }
}
```

### 消费者（幂等 + 重试上限）

```java
package com.canoe.rocketmq.consumer;

import com.canoe.rocketmq.model.OrderCreatedEvent;
import com.canoe.rocketmq.service.OrderService;
import lombok.extern.slf4j.Slf4j;
import org.apache.rocketmq.spring.annotation.RocketMQMessageListener;
import org.apache.rocketmq.spring.core.RocketMQListener;
import org.springframework.stereotype.Component;

import jakarta.annotation.Resource;

/**
 * 订单创建消息消费者：发积分 / 发优惠券 / 通知仓储。
 */
@Slf4j
@Component
@RocketMQMessageListener(
        topic = "ORDER_TOPIC",
        consumerGroup = "order-created-consumer-group",
        selectorExpression = "CREATE",
        consumeThreadNumber = 16,
        maxReconsumeTimes = 3
)
public class OrderCreatedConsumer implements RocketMQListener<OrderCreatedEvent> {

    @Resource
    private OrderService orderService;

    @Override
    public void onMessage(OrderCreatedEvent event) {
        log.info("收到订单创建消息：{}", event.getOrderNo());

        // 1. 幂等：用订单号做去重（这里用业务状态机或 Redis SETNX）
        //    实际项目里推荐：UPDATE ... WHERE status = 旧值，影响行数为 0 就跳过
        if (!orderService.canConsume(event.getOrderNo())) {
            log.info("订单 {} 已处理过，跳过", event.getOrderNo());
            return;
        }

        // 2. 业务处理：发积分等
        orderService.grantPoints(event.getUserId(), event.getAmount());
    }
}
```

### 验证

```bash
# 1. 启动应用
mvn spring-boot:run

# 2. 下单
curl -X POST "http://localhost:8080/order/create?userId=1001"
# 下单请求已受理，订单号：ORDER_xxxxxxxx

# 3. 看日志，应该依次出现：
#    【本地事务】开始，订单：ORDER_xxxxxxxx
#    本地事务执行成功，订单：ORDER_xxxxxxxx
#    收到订单创建消息：ORDER_xxxxxxxx

# 4. 查数据库确认
mysql> SELECT * FROM t_order WHERE order_no = 'ORDER_xxxxxxxx';
mysql> SELECT * FROM t_transaction_log WHERE tx_id = 'ORDER_xxxxxxxx';

# 5. 在 Dashboard 上查消息（用订单号作为 MessageKey）
```

## 六、退路方案：不用 starter，直接管原生 Producer

当 starter 版本和 Spring Boot 对不上（报 `NoSuchMethodError`、自动配置冲突）时，可以**只用原生客户端自己注册 Bean**，这是最稳的退路。

```java
package com.canoe.rocketmq.config;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 退路方案：不用 starter，自己管理原生 Producer / Consumer 的生命周期。
 * 适合：starter 版本与 Spring Boot 不兼容，或需要精细控制参数时。
 */
@Configuration
public class RawRocketMQConfig {

    @Value("${rocketmq.name-server:127.0.0.1:9876}")
    private String nameServer;

    /**
     * 生产者 Bean，destroyMethod = "shutdown" 保证应用关闭时释放连接。
     */
    @Bean(destroyMethod = "shutdown")
    public DefaultMQProducer defaultMQProducer() throws MQClientException {
        DefaultMQProducer producer = new DefaultMQProducer("raw_producer_group");
        producer.setNamesrvAddr(nameServer);
        producer.setRetryTimesWhenSendFailed(3);
        producer.setSendMsgTimeout(5000);
        producer.setVipChannelEnabled(false);
        producer.start();
        return producer;
    }

    /**
     * 消费者 Bean。
     */
    @Bean(destroyMethod = "shutdown")
    public DefaultMQPushConsumer defaultMQPushConsumer() throws MQClientException {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("raw_consumer_group");
        consumer.setNamesrvAddr(nameServer);
        consumer.subscribe("ORDER_TOPIC", "CREATE");
        consumer.setConsumeThreadMin(8);
        consumer.setConsumeThreadMax(32);
        consumer.registerMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            for (org.apache.rocketmq.common.message.MessageExt msg : msgs) {
                System.out.println("收到：" + new String(msg.getBody()));
            }
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        });
        consumer.start();
        return consumer;
    }
}
```

对应的 `pom.xml` 只引原生客户端：

```xml
<dependency>
    <groupId>org.apache.rocketmq</groupId>
    <artifactId>rocketmq-client</artifactId>
    <version>5.3.4</version>
</dependency>
```

## 七、常见问题排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `No route info of this topic: XXX` | Topic 不存在 / Broker 没开自动创建 | `mqadmin updateTopic` 创建；或 Broker 加 `autoCreateTopicEnable=true` |
| 消费者启动报 `The broker does not support ... SQL92` | 没开 `enablePropertyFilter` | Broker 配置加 `enablePropertyFilter = true` 并重启 |
| 消费者收不到消息 | ① `selectorExpression` 和发送时的 Tag 对不上 ② 消费组已有进度，新消息被跳过 | ① 检查 Tag（destination 冒号后面那段）；② 用 `resetOffsetByTime` 重置位点或换个消费组名 |
| `NoSuchMethodError` / 启动失败 | starter 与 Spring Boot 版本不兼容 | 换 starter 版本；或用上面的**退路方案** |
| `connect to xxx:10909 failed` | VIP 通道端口没开 | `rocketmq.producer.vip-channel-enabled: false`；或防火墙开 10909 |
| 消息体里有 `LocalDateTime` 报序列化错 | Jackson 没注册 JavaTimeModule | 加 `JacksonConfig`（见上文） |
| 事务消息一直不投递 | 本地事务返回了 `UNKNOWN` 且回查一直没结论 | 检查 `checkLocalTransaction` 是否查到了事务日志表；看回查线程池是不是被打满 |
| 两个应用用了同一个 consumerGroup | 会被当成同一个消费组，消息被分摊 | **不同应用必须用不同的 consumerGroup** |
| 应用关闭时报错 | Producer/Consumer 没 shutdown | 用 `@Bean(destroyMethod = "shutdown")` 或 `@PreDestroy` |

::: danger 消费组名千万别复用
两个不相关的应用如果用同一个 `consumerGroup`，RocketMQ 会把它们当成"同一个消费组的两个实例"，消息在它们之间**分摊**。结果就是：A 应用应该收到的消息，有一半被 B 应用吃掉了。

**命名规范建议**：`应用名_业务_topic名`，比如 `order-service_create_order`。
:::

## 本篇小结

- 依赖 `org.apache.rocketmq:rocketmq-spring-boot-starter`，**2.3.x 起支持 Spring Boot 3**，具体版本请以官方 README 为准。
- **`destination` 格式是 `topic:tag`**，冒号后面是 Tag，Topic 名里不能有冒号。
- `RocketMQTemplate` 常用方法：`syncSend`（同步）、`syncSendOrderly`（顺序）、`asyncSend`（异步，**务必处理 onException**）、`sendOneWay`（单向）、`syncSend(dest, payload, timeout, delayLevel)`（延时）。
- **可以直接发对象**，starter 自动 JSON 序列化；`LocalDateTime` 要注册 `JavaTimeModule`。
- `@RocketMQMessageListener` 核心参数：`topic`、`consumerGroup`、`selectorExpression`、`consumeMode`（CONCURRENTLY/ORDERLY）、`messageModel`（CLUSTERING/BROADCASTING）、`consumeThreadNumber`、`maxReconsumeTimes`。
- **抛异常 = 消费失败重试**。别吞异常（会假装成功），也别无限抛（要判断 `reconsumeTimes` 设上限）。
- SQL92 过滤要 `selectorType = SelectorType.SQL92`，且 **Broker 必须开 `enablePropertyFilter=true`**。
- Spring 版事务消息：`@RocketMQTransactionListener` + `RocketMQLocalTransactionListener`，状态枚举是 `RocketMQLocalTransactionState.COMMIT/ROLLBACK/UNKNOWN`（**和原生的 `LocalTransactionState.COMMIT_MESSAGE` 名字不一样**）。
- **事务日志表是关键**：回查要查它，它和订单表在同一个数据库事务里，是"本地事务做没做成"的真相来源。
- **消费组名不能跨应用复用**，否则消息会被分摊吃掉。建议命名 `应用名_业务_topic名`。
- starter 版本对不上时的**退路**：只引 `rocketmq-client`，自己用 `@Bean(destroyMethod = "shutdown")` 管原生 Producer/Consumer。

## 参考链接

- [rocketmq-spring GitHub（含版本对应说明）](https://github.com/apache/rocketmq-spring)
- [RocketMQ Spring Boot Starter 官方示例](https://github.com/apache/rocketmq-spring/tree/master/rocketmq-spring-boot-samples)
- [RocketMQ 事务消息（官方）](https://rocketmq.apache.org/zh/docs/featureBehavior/04transactionmessage/)
- [RocketMQ 消息轨迹](https://rocketmq.apache.org/zh/docs/featureBehavior/10messagetrace/)
- [Maven Central: rocketmq-spring-boot-starter](https://central.sonatype.com/artifact/org.apache.rocketmq/rocketmq-spring-boot-starter)

下一篇 → [06 存储原理、集群与调优](/java/middleware/rocketmq/production)
