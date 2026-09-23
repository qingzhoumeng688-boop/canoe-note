# 04 可靠性投递全解

> 本篇导读：前面 03 篇我们把消息发出去、消费掉，看起来一切正常。但"正常"只是因为现在没人拆台。真实生产环境里，**消息会在 5 个地方悄悄丢失**：生产者没发到、交换机没匹配到队列、Broker 宕机、消费者收到没处理完就挂、消费者处理抛异常。这一篇就是 MQ 的"防丢全集"——从生产者确认、消息落库重投，到 Broker 持久化、消费者手动 ACK、重试与死信、幂等、积压、顺序性，逐个讲透。这是 RabbitMQ 最难也最重要的一章，建议收藏反复看。

## 一、消息会丢在哪：一张链路图

一条消息从生产者到消费者，完整链路如下，标了 **5 个会丢消息的点**：

```mermaid
flowchart LR
    A["① 生产者 Producer"] -->|"网络抖动 / 连接断开，消息根本没到 Broker"| B["交换机 Exchange"]
    B -->|"routingKey 写错，没有队列匹配，消息被丢弃（默认行为）"| C["队列 Queue"]
    C -->|"Broker 宕机：消息还在内存没刷盘，重启后没了"| D["Broker 内存 / 磁盘"]
    D -->|"消息拉到本地，还没处理完消费者进程就挂了"| E["消费者 Consumer"]
    E -->|"处理抛异常：自动 ack 会误删，无限 requeue 会死循环"| F["消息被丢弃 / 重复"]
```

- ① 生产者 → 交换机：网络抖动/连接断开，消息根本没到 Broker
- ② 交换机 → 队列：routingKey 写错，没有队列匹配，消息被丢弃（默认行为！）
- ③ Broker 宕机：消息还在内存没刷盘，重启后没了
- ④ 消费者收到 → 处理完：消息拉到本地，还没处理完消费者进程就挂了
- ⑤ 消费者处理中抛异常：如果自动 ack，消息被误删；如果无限 requeue，造成死循环

| 丢消息的点 | 对应解决方案（后面章节） |
| --- | --- |
| ① 生产到交换机失败 | 第三章：Publisher Confirm（发布确认） |
| ② 交换机到队列失败 | 第四章：Publisher Return（消息回退） |
| ③ Broker 宕机 | 第六章：持久化三件套 + 07 章 Quorum/Lazy |
| ④⑤ 消费者侧 | 第七章手动 ACK + 第八章重试/死信 + 第九章幂等 |

::: tip 先建立一句话心智模型
"可靠性投递"本质就是给链路上的每个环节**加确认 + 加兜底 + 加幂等**：发之前确认到了、没到就重发；收之前确认处理完、没完就不删；重复来了也不怕。
:::

## 二、生产者侧之一：Publisher Confirm（发布确认）

### 2.1 原理

Confirm 机制让 Broker 在**收到消息（落到交换机）后**，异步给生产者回一个 ack（确认）或 nack（失败）。生产者拿到 ack 就知道"这条安全到了"；拿不到（或拿 nack）就**重发**。

```text
生产者 ──发消息(CorrelationData 带业务ID)──► Broker
生产者 ◄── 异步 ack/nack（带 correlationData.id）── Broker

收到 ack  → 标记发送成功
收到 nack / 超时 → 重发 或 落库待补发
```

### 2.2 三种 confirm 模式对比

| 模式 | 配置值 | 工作方式 | 评价 |
| --- | --- | --- | --- |
| 单条同步 | `simple`（配合 `waitForConfirms`） | 发一条、等一条确认，再发下一条 | 最慢，吞吐量被打死，**不推荐** |
| 批量同步 | `simple` + 一批后 `waitForConfirms` | 发一批，等这一批全确认 | 某条失败无法定位是哪条，部分重发困难 |
| **异步 confirm** | `correlated` | 发完不阻塞，Broker 异步回调 `ConfirmCallback` | **推荐**，性能最好，可精确定位每条结果 |

::: warning 为什么不用单条同步
单条同步等于"发一条等一条"，网络往返成了瓶颈，万级 QPS 直接趴窝。异步 confirm 把"等确认"这件事交给回调线程，主线程继续发，吞吐几乎不受影响——**生产环境一律 `correlated`**。
:::

### 2.3 配置

```yaml
spring:
  rabbitmq:
    publisher-confirm-type: correlated   # 开启异步发布确认
```

`publisher-confirm-type` 三个取值：
- `none`：关闭确认（默认，性能最高但不可靠）
- `correlated`：异步回调，每条消息带 `CorrelationData`，可精确定位
- `simple`：同步等待模式（用 `RabbitTemplate.waitForConfirms`），会阻塞

### 2.4 ConfirmCallback 完整代码（必须用 CorrelationData 携带业务 ID）

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.ReturnedMessage;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ConfirmConfig {

    @Bean
    public RabbitTemplate rabbitTemplate(
            org.springframework.amqp.rabbit.connection.ConnectionFactory connectionFactory,
            MessageConverter messageConverter) {

        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);

        // ===== 发布确认回调（Confirm） =====
        template.setConfirmCallback(new RabbitTemplate.ConfirmCallback() {
            @Override
            public void confirm(CorrelationData correlationData, boolean ack, String cause) {
                // correlationData 就是发送时你传入的那个，里面带着业务 ID
                String bizId = correlationData == null ? "null" : correlationData.getId();
                if (ack) {
                    System.out.println("[Confirm] 消息已送达交换机, bizId=" + bizId);
                } else {
                    // ack=false 表示 broker 拒收（如交换机不存在），cause 里有原因
                    System.err.println("[Confirm] 消息送达失败, bizId=" + bizId
                            + ", cause=" + cause);
                    // 这里应触发重发 / 落库告警（见第五章）
                }
            }
        });

        // ===== 消息回退回调（Return），详见第四章 =====
        template.setReturnsCallback(new RabbitTemplate.ReturnsCallback() {
            @Override
            public void returnedMessage(ReturnedMessage returned) {
                Message msg = returned.getMessage();
                System.err.println("[Return] 消息被退回: replyCode=" + returned.getReplyCode()
                        + ", replyText=" + returned.getReplyText()
                        + ", exchange=" + returned.getExchange()
                        + ", routingKey=" + returned.getRoutingKey());
            }
        });

        return template;
    }
}
```

发送时**必须**带上 `CorrelationData`，否则回调里 `correlationData` 为 `null`，你无法定位是哪条消息失败：

```java
package com.canoe.rabbitmq.sender;

import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class ReliableSender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void sendWithConfirm(String exchange, String routingKey, Object payload, String bizId) {
        // 把业务单号塞进 CorrelationData，Confirm 回调里原样返回，用来定位失败消息
        CorrelationData cd = new CorrelationData(bizId);
        rabbitTemplate.convertAndSend(exchange, routingKey, payload, cd);
    }
}
```

::: warning 请以官方最新版本文档为准
`ConfirmCallback` 接口方法签名为 `void confirm(CorrelationData correlationData, boolean ack, String cause)`，位于 `org.springframework.amqp.rabbit.core.RabbitTemplate.ConfirmCallback`，Spring AMQP 2.x 与 3.x 均沿用此写法。若你升级到更新大版本，请到官方文档核对：`https://docs.spring.io/spring-amqp/reference/amqp/template.html`。
:::

## 三、生产者侧之二：Publisher Return（消息回退）

### 3.1 为什么会需要 Return

Confirm 只管"消息到没到**交换机**"。但消息到了交换机后，如果 `routingKey` 写错、没有任何队列绑定它，**消息会默认被直接丢弃**——而 Confirm 此时仍然返回 `ack=true`（因为确实到交换机了）！这就漏了"从交换机到队列"这一环。

Return 机制就是补这个漏洞：当交换机发现消息**路由不到任何队列**时，通过回调把消息**退还给生产者**，让你有机会感知并补救。

```text
消息 ──► 交换机 ──(routingKey 没匹配到队列)──► 触发 Return 回调 ──► 生产者拿到退回的消息
```

### 3.2 配置

```yaml
spring:
  rabbitmq:
    publisher-returns: true       # 开启回退（底层设 CachingConnectionFactory.publisherReturns=true）
    template:
      mandatory: true             # 每条消息都带 mandatory 标志，路由失败才触发 Return
```

`mandatory=true` 是开关：只有带了 mandatory 的消息，交换机路由不到队列时才会回退；否则直接丢。

### 3.3 Spring AMQP 3.x 的 ReturnsCallback（重点：接口已改名）

::: warning 这是新手最常踩的 API 版本坑
- **Spring AMQP 2.x**：回调接口叫 `ReturnCallback`，方法为 `returnedMessage(Message, int, String, String, String)`（参数平铺）。
- **Spring AMQP 3.0 起**：`ReturnCallback` 已被废弃并移除，取而代之的是 **`ReturnsCallback`**，方法为 `void returnedMessage(ReturnedMessage returned)`，所有信息封装进 `ReturnedMessage` 对象。

本文基于 **Spring AMQP 3.x**（对应 Spring Boot 3.5.5），使用 `ReturnsCallback`。若你仍用 2.x，请改为 `setReturnCallback` + 旧签名，并尽快升级。
:::

`ReturnedMessage` 的属性（已联网核对官方文档）：

| 属性 | 类型 | 含义 |
| --- | --- | --- |
| `message` | `org.springframework.amqp.core.Message` | 被退回的原始消息 |
| `replyCode` | `int` | 退回原因码，如 `312` 表示 `NO_ROUTE` |
| `replyText` | `String` | 退回原因文本，如 `NO_ROUTE` |
| `exchange` | `String` | 消息发送到的交换机 |
| `routingKey` | `String` | 使用的路由键 |

### 3.4 ReturnCallback 完整代码

```java
package com.canoe.rabbitmq.config;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.ReturnedMessage;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ReturnConfig {

    @Bean
    public RabbitTemplate rabbitTemplate(
            org.springframework.amqp.rabbit.connection.ConnectionFactory connectionFactory) {

        RabbitTemplate template = new RabbitTemplate(connectionFactory);

        // Spring AMQP 3.x：用 ReturnsCallback（注意不是旧版 ReturnCallback）
        template.setReturnsCallback(new RabbitTemplate.ReturnsCallback() {
            @Override
            public void returnedMessage(ReturnedMessage returned) {
                Message message = returned.getMessage();
                int replyCode = returned.getReplyCode();
                String replyText = returned.getReplyText();
                String exchange = returned.getExchange();
                String routingKey = returned.getRoutingKey();

                System.err.println("[Return] 消息路由失败被退回："
                        + "replyCode=" + replyCode
                        + ", replyText=" + replyText
                        + ", exchange=" + exchange
                        + ", routingKey=" + routingKey
                        + ", body=" + new String(message.getBody()));

                // 典型补救：记录日志 + 告警 + 落库人工处理（或走第五章的定时重投）
            }
        });

        return template;
    }
}
```

### 3.5 Confirm 与 Return 的分工

| 机制 | 管的是哪一段 | 触发条件 | 回调接口 |
| --- | --- | --- | --- |
| **Confirm** | 生产者 → 交换机 | 消息到达/未到达交换机 | `ConfirmCallback#confirm` |
| **Return** | 交换机 → 队列 | 到了交换机但路由不到任何队列 | `ReturnsCallback#returnedMessage` |

一句话：**Confirm 告诉你"到没到交换机"，Return 告诉你"从交换机到没到队列"**。两者互补，生产级方案两个都要开。

## 四、生产者侧之三：消息落库 + 定时重投（生产级方案）

### 4.1 为什么光有 Confirm 还不够

Confirm 有个致命弱点：回调是**内存态**的。一旦你的生产者应用**重启**，那些"已发出但还没收到 ack"的消息状态就丢了；而且回调里你往往只是打日志，没有持久化，故障恢复无从谈起。所以金融/订单这类"一条都不能丢"的场景，要在业务库里给每条消息留个"底稿"。

### 4.2 方案设计

```text
发送前：
  ① 落库 MessageLog(status=CREATE, retryCount=0, nextRetryTime=now)

发送 + 绑定 Confirm：
  ② convertAndSend(..., new CorrelationData(msgId))
  ③ Confirm 回调：ack → 改 status=SUCCESS；nack → 改 status=FAIL

定时任务（每 30s 跑一次）：
  ④ 扫描 status in (CREATE, FAIL) 且 nextRetryTime <= now 且 retryCount < MAX 的记录
  ⑤ 重新 convertAndSend（仍带 msgId）
  ⑥ retryCount++，更新 nextRetryTime = now + 退避间隔
  ⑦ retryCount >= MAX → 改 status=GIVEUP，转人工 / 告警
```

```text
状态流转：
  CREATE ──ack──► SUCCESS（终态）
  CREATE ──nack/超时──► FAIL ──定时重投──► 重新发送
  FAIL ──retryCount>=MAX──► GIVEUP（人工介入）
```

### 4.3 完整 MySQL 建表 DDL

```sql
CREATE TABLE `t_message_log` (
  `msg_id`           VARCHAR(64)   NOT NULL COMMENT '消息唯一ID（业务单号或UUID）',
  `exchange`         VARCHAR(128)  NOT NULL COMMENT '目标交换机',
  `routing_key`      VARCHAR(128)  NOT NULL COMMENT '路由键',
  `body`             TEXT          NOT NULL COMMENT '消息体（JSON 序列化后的字符串）',
  `status`           VARCHAR(16)   NOT NULL COMMENT '状态：CREATE/SUCCESS/FAIL/GIVEUP',
  `retry_count`      INT           NOT NULL DEFAULT 0 COMMENT '已重试次数',
  `next_retry_time`  DATETIME      NOT NULL COMMENT '下次可重试时间（用于退避）',
  `create_time`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`msg_id`),
  KEY `idx_status_retry` (`status`, `next_retry_time`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消息发送日志表（可靠投递底稿）';
```

::: tip 索引为什么这么建
定时任务的核心查询是"按状态 + 下次重试时间扫一批"，所以建联合索引 `(status, next_retry_time)`，让扫描走索引而不是全表扫。`idx_create_time` 用于排查和清理历史数据。
:::

### 4.4 Entity / Repository（注解式 Mapper）

```java
package com.canoe.rabbitmq.reliability.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "t_message_log")
public class MessageLog {

    public static final String CREATE  = "CREATE";
    public static final String SUCCESS = "SUCCESS";
    public static final String FAIL    = "FAIL";
    public static final String GIVEUP  = "GIVEUP";

    @Id
    @Column(name = "msg_id", length = 64)
    private String msgId;

    @Column(name = "exchange", nullable = false, length = 128)
    private String exchange;

    @Column(name = "routing_key", nullable = false, length = 128)
    private String routingKey;

    @Column(name = "body", nullable = false, columnDefinition = "TEXT")
    private String body;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "retry_count", nullable = false)
    private Integer retryCount = 0;

    @Column(name = "next_retry_time", nullable = false)
    private LocalDateTime nextRetryTime;

    @Column(name = "create_time")
    private LocalDateTime createTime;

    @Column(name = "update_time")
    private LocalDateTime updateTime;

    public MessageLog() {}

    // getter / setter
    public String getMsgId() { return msgId; }
    public void setMsgId(String msgId) { this.msgId = msgId; }
    public String getExchange() { return exchange; }
    public void setExchange(String exchange) { this.exchange = exchange; }
    public String getRoutingKey() { return routingKey; }
    public void setRoutingKey(String routingKey) { this.routingKey = routingKey; }
    public String getBody() { return body; }
    public void setBody(String body) { this.body = body; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Integer getRetryCount() { return retryCount; }
    public void setRetryCount(Integer retryCount) { this.retryCount = retryCount; }
    public LocalDateTime getNextRetryTime() { return nextRetryTime; }
    public void setNextRetryTime(LocalDateTime nextRetryTime) { this.nextRetryTime = nextRetryTime; }
    public LocalDateTime getCreateTime() { return createTime; }
    public void setCreateTime(LocalDateTime createTime) { this.createTime = createTime; }
    public LocalDateTime getUpdateTime() { return updateTime; }
    public void setUpdateTime(LocalDateTime updateTime) { this.updateTime = updateTime; }
}
```

```java
package com.canoe.rabbitmq.reliability.repository;

import com.canoe.rabbitmq.reliability.entity.MessageLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface MessageLogRepository extends JpaRepository<MessageLog, String> {

    /** 扫描需要重试的消息：状态为 CREATE/FAIL、到点的、且未超最大次数 */
    @Query("SELECT m FROM MessageLog m WHERE m.status IN ('CREATE','FAIL') "
            + "AND m.nextRetryTime <= :now AND m.retryCount < :max")
    List<MessageLog> findNeedRetry(@Param("now") LocalDateTime now,
                                   @Param("max") int maxRetry);

    /** 标记成功（Confirm ack 时调用） */
    @Modifying
    @Query("UPDATE MessageLog m SET m.status='SUCCESS', m.updateTime=:now WHERE m.msgId=:id")
    void markSuccess(@Param("id") String id, @Param("now") LocalDateTime now);

    /** 标记失败（Confirm nack 时调用） */
    @Modifying
    @Query("UPDATE MessageLog m SET m.status='FAIL', m.updateTime=:now WHERE m.msgId=:id")
    void markFail(@Param("id") String id, @Param("now") LocalDateTime now);
}
```

### 4.5 Service：发送 + Confirm 落库闭环

```java
package com.canoe.rabbitmq.reliability.service;

import com.canoe.rabbitmq.reliability.entity.MessageLog;
import com.canoe.rabbitmq.reliability.repository.MessageLogRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
public class ReliableSendService {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private MessageLogRepository messageLogRepository;

    @Autowired
    private ObjectMapper objectMapper;

    /**
     * 可靠发送：先落库底稿，再发消息，Confirm 回调更新状态
     */
    @Transactional
    public void sendReliable(String exchange, String routingKey, Object payload) {
        try {
            String msgId = UUID.randomUUID().toString();
            String body = objectMapper.writeValueAsString(payload);

            // ① 落库底稿
            MessageLog log = new MessageLog();
            log.setMsgId(msgId);
            log.setExchange(exchange);
            log.setRoutingKey(routingKey);
            log.setBody(body);
            log.setStatus(MessageLog.CREATE);
            log.setRetryCount(0);
            // 立即允许首次重试（30 秒后由定时任务兜底）
            log.setNextRetryTime(LocalDateTime.now().plusSeconds(30));
            log.setCreateTime(LocalDateTime.now());
            log.setUpdateTime(LocalDateTime.now());
            messageLogRepository.save(log);

            // ② 发消息，绑定 msgId，Confirm 回调里据此更新底稿状态
            CorrelationData cd = new CorrelationData(msgId);
            rabbitTemplate.convertAndSend(exchange, routingKey, payload, cd);

        } catch (Exception e) {
            throw new RuntimeException("可靠发送失败", e);
        }
    }
}
```

在 Confirm 回调里更新底稿状态（把回调接到 Service）：

```java
package com.canoe.rabbitmq.reliability.config;

import com.canoe.rabbitmq.reliability.repository.MessageLogRepository;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;

import java.time.LocalDateTime;

@Configuration
public class ReliableTemplateConfig {

    @Bean
    public RabbitTemplate reliableTemplate(ConnectionFactory connectionFactory,
                                           MessageConverter messageConverter,
                                           MessageLogRepository messageLogRepository) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);

        template.setConfirmCallback(new RabbitTemplate.ConfirmCallback() {
            @Override
            public void confirm(CorrelationData correlationData, boolean ack, String cause) {
                if (correlationData == null) return;
                String msgId = correlationData.getId();
                if (ack) {
                    messageLogRepository.markSuccess(msgId, LocalDateTime.now());
                } else {
                    messageLogRepository.markFail(msgId, LocalDateTime.now());
                }
            }
        });
        return template;
    }
}
```

### 4.6 定时重投任务

```java
package com.canoe.rabbitmq.reliability.task;

import com.canoe.rabbitmq.reliability.entity.MessageLog;
import com.canoe.rabbitmq.reliability.repository.MessageLogRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Component
public class RetrySenderTask {

    private static final int MAX_RETRY = 5;

    @Autowired
    private MessageLogRepository messageLogRepository;

    @Autowired
    private RabbitTemplate reliableTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    /** 每 30 秒扫描一次待重试消息 */
    @Scheduled(fixedDelay = 30000)
    @Transactional
    public void retry() {
        LocalDateTime now = LocalDateTime.now();
        for (MessageLog log : messageLogRepository.findNeedRetry(now, MAX_RETRY)) {
            try {
                // 反序列化 body 重新发送（这里按 Object 发，转换器会再序列化；
                // 真实场景建议保存原始类型或 __TypeId__，确保消费端能反序列化）
                Object payload = objectMapper.readValue(log.getBody(), Object.class);
                reliableTemplate.convertAndSend(
                        log.getExchange(), log.getRoutingKey(), payload,
                        new org.springframework.amqp.rabbit.connection.CorrelationData(log.getMsgId()));

                log.setRetryCount(log.getRetryCount() + 1);
                // 指数退避：第 n 次失败后等 2^n 分钟
                int backoffMinutes = (int) Math.pow(2, log.getRetryCount());
                log.setNextRetryTime(LocalDateTime.now().plusMinutes(backoffMinutes));
                log.setUpdateTime(LocalDateTime.now());
                messageLogRepository.save(log);
            } catch (Exception e) {
                // 反序列化或重发异常：标记超限，转人工
                log.setStatus(MessageLog.GIVEUP);
                log.setUpdateTime(LocalDateTime.now());
                messageLogRepository.save(log);
            }
        }
    }
}
```

::: danger 重试 + 重投 = 一定会重复消费
定时重投会把同一条业务消息再发一次，加上网络重发、requeue，消费者**一定会遇到重复消息**。所以"消费端幂等"不是可选项，而是可靠投递的**必选项**（见第九章）。
:::

## 五、Broker 侧：持久化三件套

就算生产者确认都做对了，消息到了 Broker，如果 Broker 重启时消息还在内存里，照样丢。所以要"持久化"。

### 5.1 三件套

| 组件 | 配置 | 作用 |
| --- | --- | --- |
| 交换机 | `durable=true` | 重启后交换机还在 |
| 队列 | `durable=true` | 重启后队列还在 |
| 消息 | `deliveryMode=2`（`PERSISTENT`） | 消息写入磁盘，重启不丢 |

```java
package com.canoe.rabbitmq.reliability.config;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class PersistentSender {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void sendPersistent(String exchange, String routingKey, Object payload) {
        rabbitTemplate.convertAndSend(exchange, routingKey, payload, message -> {
            // 设 deliveryMode=2 即持久化（默认 Jackson 转换器发出的消息已是 PERSISTENT，
            // 显式声明更稳妥，确保任何转换器下都持久化）
            message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
            return message;
        });
    }
}
```

队列 `durable` 示例（声明时指定）：

```java
package com.canoe.rabbitmq.reliability.config;

import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DurableConfig {
    @Bean
    public Queue durableQueue() {
        // 第二个参数 true = 持久化
        return new Queue("order.queue", true);
    }
}
```

### 5.2 只做三件套仍然可能丢：PageCache 没刷盘

::: warning 持久化 ≠ 立刻落盘
`deliveryMode=2` 的消息只是"允许落盘"，RabbitMQ 实际是**先写 PageCache（操作系统页缓存），再由 OS 异步刷盘**。如果消息在 PageCache 还没刷到磁盘时 Broker 宕机/断电，**这部分消息仍会丢**。要做到"落盘才返回"，需要把交换机/队列设为 `confirm` 类型或使用 Quorum Queue。

更彻底的持久化方案（保证不丢）留给 **05 章（高级特性与延迟队列）** 的 **Quorum Queue（仲裁队列）**——它基于 Raft 复制，消息写入多数节点副本才算成功，是 RabbitMQ 4.x 推荐的强一致方案。
:::

### 5.3 Lazy Queue（惰性队列）：堆积场景的救星

普通队列消息先在内存、消费不掉才落盘；**Lazy Queue 让消息直接落磁盘**，只在被消费时才加载到内存，极大缓解内存压力，适合"消息可能大量堆积"的场景（如大促、削峰）。

```java
package com.canoe.rabbitmq.reliability.config;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class LazyConfig {
    @Bean
    public Queue lazyQueue() {
        return QueueBuilder.durable("order.lazy.queue")
                .lazy()                       // 惰性队列：消息直落磁盘
                .build();
    }
}
```

## 六、消费者侧：ACK 机制

消息到了消费者，什么时候算"处理完了、可以删了"？这就是 ACK（确认）机制要回答的问题。

### 6.1 三种 AcknowledgeMode 对比

| 模式 | 配置值 | 行为 | 风险 |
| --- | --- | --- | --- |
| `NONE` | `none` | **自动 ack**：消息一发出去（甚至没到方法）就立刻删除 | 消费者挂了消息直接丢，**最不安全** |
| `AUTO` | `auto`（默认） | 方法**正常返回**就 ack；**抛异常**就 nack/requeue | 抛异常会无限 requeue，**可能死循环**（见第八章） |
| `MANUAL` | `manual` | 你**手动**调 `basicAck` 才删，最可控 | 忘了 ack 消息永远不删，会堆积 |

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        acknowledge-mode: manual   # 推荐手动确认，最可靠
```

### 6.2 手动 ACK 完整代码

```java
package com.canoe.rabbitmq.reliability.listener;

import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class ManualAckListener {

    @RabbitListener(queues = "order.queue", ackMode = "MANUAL")
    public void listen(Object payload,
                      Channel channel,
                      Message message) {
        // deliveryTag 是本次投递在 Channel 内的唯一递增序号
        long deliveryTag = message.getMessageProperties().getDeliveryTag();
        try {
            // 业务处理
            System.out.println("处理消息：" + payload);
            // 处理成功 → 手动确认（multiple=false 表示只确认这一条）
            channel.basicAck(deliveryTag, false);
        } catch (Exception e) {
            // 处理失败 → 拒绝并重新入队（requeue=true）
            // 注意：这里用 basicNack，最后一个参数 requeue=true 表示重回队列
            try {
                channel.basicNack(deliveryTag, false, true);
            } catch (Exception ex) {
                ex.printStackTrace();
            }
        }
    }
}
```

### 6.3 basicAck / basicNack / basicReject 三者区别

| 方法 | 批量 | 可重新入队 | 用途 |
| --- | --- | --- | --- |
| `basicAck(tag, multiple)` | ✅ `multiple=true` 可批量 | 不适用（是确认） | 确认消息处理成功，Broker 删除它 |
| `basicNack(tag, multiple, requeue)` | ✅ 支持 | ✅ `requeue=true` 重回队列 | 拒绝一批，**最灵活** |
| `basicReject(tag, requeue)` | ❌ 只能单条 | ✅ `requeue=true` 重回队列 | 拒绝单条，功能子集 |

```java
// 确认单条
channel.basicAck(deliveryTag, false);
// 批量确认当前 tag 之前所有未确认（multiple=true）——慎用！
channel.basicAck(deliveryTag, true);
// 拒收单条并重新入队
channel.basicReject(deliveryTag, true);
// 批量拒收并重新入队
channel.basicNack(deliveryTag, true, true);
// 拒收且不放回队列（通常配合死信队列）
channel.basicNack(deliveryTag, false, false);
```

### 6.4 `multiple=true` 的危险

`basicAck(deliveryTag, multiple=true)` 会把**当前 deliveryTag 之前所有未确认消息一起确认**。这看起来高效，但有个大坑：

```text
假设某 Channel 按顺序收到 tag=1,2,3 三条消息，你处理完 tag=3 调 basicAck(3, true)：
  → 1、2、3 全部被确认删除！

但如果 tag=1 其实还没处理完（比如你以为只确认了 3）——
  → 1 和 2 被"误删"，消息丢失。
```

::: danger 生产环境优先 multiple=false
批量确认一旦用错，会"静默丢消息"且极难排查。除非你非常确定前面的消息都已安全处理，否则**一律 `multiple=false`**。需要提升吞吐，靠调大 `prefetch` 而不是批量 ack。
:::

### 6.5 Spring AMQP 的大坑：Channel 参数与异步 ack

在 `@RabbitListener` 里用 `Channel` 参数做手动 ack，有个很多人栽过的坑：

> **`Channel` 是和当前监听调用绑定的，必须在该监听方法执行期间、同一个线程里同步 ack。一旦把 ack 丢到另一个异步线程（比如丢进线程池、或 `@Async` 方法）里去做，就会报 `Channel closed; cannot ack` 或 `AcknowledgeFailedException`——因为方法返回后 Spring 可能已把 Channel 回收。**

**正确写法**（同步 ack，在方法内）：

```java
@RabbitListener(queues = "order.queue", ackMode = "MANUAL")
public void correct(Object payload, Channel channel, Message message) {
    long tag = message.getMessageProperties().getDeliveryTag();
    try {
        process(payload);
        channel.basicAck(tag, false);          // ✅ 方法内同步 ack
    } catch (Exception e) {
        channel.basicNack(tag, false, false); // ✅ 失败也同步拒绝
    }
}
```

**错误写法**（异步 ack，必踩坑）：

```java
@RabbitListener(queues = "order.queue", ackMode = "MANUAL")
public void wrong(Object payload, Channel channel, Message message) {
    long tag = message.getMessageProperties().getDeliveryTag();
    // ❌ 把 ack 丢进线程池异步执行，方法返回后 channel 已被回收
    executor.execute(() -> {
        try {
            process(payload);
            channel.basicAck(tag, false); // 大概率报错：Channel closed; cannot ack
        } catch (Exception e) { /* ... */ }
    });
}
```

::: warning 前置条件
使用 `Channel` 参数要求该监听器 `ackMode = "MANUAL"`。如果你用的是 `AUTO`/`NONE`，Spring 不会把真实 Channel 交给你控制 ack，手动调用反而会冲突。要"延迟异步处理又要可靠 ack"，正确姿势是：方法内先用线程池**处理业务**，处理完**立刻同步 ack**（先确认、后处理也行，只要业务允许最终一致）；或者把消息内容复制到本地再异步跑，确认与业务解耦。
:::

## 七、消费端重试

### 7.1 默认行为：抛异常无限 requeue

这是**生产事故最常见的源头**。默认 `AUTO` 模式下，监听器方法抛异常，Spring 会把消息 `requeue` 回队列，然后立刻又被消费、又抛异常、又 requeue……**无限循环**，队列 `Ready` 数反复横跳，CPU 飙高，且正常消息被这条"毒消息"堵住。

### 7.2 方案一：无状态重试（推荐，RetryInterceptorBuilder.stateless）

重试发生在**消费者内存里**，不依赖 broker 的 requeue。重试耗尽后交给 `MessageRecoverer` 兜底（进死信/重发/丢弃）。

```java
package com.canoe.rabbitmq.reliability.config;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.retry.RepublishMessageRecoverer;
import org.springframework.amqp.rabbit.retry.RetryInterceptorBuilder;
import org.springframework.amqp.rabbit.retry.RetryOperationsInterceptor;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RetryConfig {

    /** 重试耗尽后的"兜底器"：转发到错误队列 */
    @Bean
    public org.springframework.amqp.rabbit.retry.MessageRecoverer republishRecoverer(
            org.springframework.amqp.rabbit.core.RabbitTemplate rabbitTemplate) {
        // 把失败消息发到 error.exchange 的 error.routingKey（对应 error.queue）
        return new RepublishMessageRecoverer(rabbitTemplate, "error.exchange", "error.routingKey");
    }

    /** 无状态重试拦截器：重试在内存，指数退避 */
    @Bean
    public RetryOperationsInterceptor retryInterceptor(
            org.springframework.amqp.rabbit.retry.MessageRecoverer republishRecoverer) {
        return RetryInterceptorBuilder.stateless()
                .maxAttempts(3)                       // 最多重试 3 次（含首次共 4 次投递）
                .backOffOptions(1000, 2.0, 5000)      // 初始 1s，乘 2，最大 5s
                .recoverer(republishRecoverer)        // 耗尽后交给兜底器
                .build();
    }

    /** 把重试拦截器挂到容器工厂 */
    @Bean
    public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
            ConnectionFactory connectionFactory,
            MessageConverter messageConverter,
            RetryOperationsInterceptor retryInterceptor) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(messageConverter);
        factory.setAdviceChain(retryInterceptor);     // 关键：挂上重试链
        return factory;
    }
}
```

### 7.3 方案二：有状态重试（stateful，仅特殊场景）

`RetryInterceptorBuilder.stateful()` 会把重试状态保存在 broker（利用 `x-death` 头），适合**需要事务、且并发要求低**的场景。它要求消息被 requeue，因此会和并发消费有冲突。

```java
RetryInterceptorBuilder.stateful()
        .maxAttempts(3)
        .backOffOptions(1000, 2.0, 5000)
        .recoverer(republishRecoverer)
        .build();
```

::: warning 有状态重试的限制
`stateful` 模式需要消息重新入队来保留状态，**无法配合高并发消费者**，且依赖 broker 往返。绝大多数业务用 `stateless` 就够了；除非你要"在事务边界内保证恰好一次语义"，否则别碰 stateful。
:::

### 7.4 三种 MessageRecoverer 对比

| Recoverer | 行为 | 适用 |
| --- | --- | --- |
| `RejectAndDontRequeueRecoverer` | 直接丢弃（或配合死信队列） | 不关心失败、或已另设死信 |
| `ImmediateRequeueMessageRecoverer` | 立刻重回队列 | 临时故障、想立刻再试（小心死循环） |
| **`RepublishMessageRecoverer`** | 转发到专门的**错误队列**，并附带异常堆栈头 | **推荐**，失败消息不丢，可人工/定时补偿 |

### 7.5 RepublishMessageRecoverer 完整配置 + 错误队列消费者

`RepublishMessageRecoverer` 会把失败消息转发到指定交换机/路由键，并自动添加以下头，方便排查：

| 头名 | 内容 |
| --- | --- |
| `x-exception-message` | 异常信息 |
| `x-exception-stacktrace` | 完整堆栈（字符串） |
| `x-original-exchange` | 原始交换机 |
| `x-original-routing-key` | 原始路由键 |
| `x-original-queue` | 原始队列 |

错误队列与交换机声明：

```java
package com.canoe.rabbitmq.reliability.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ErrorQueueConfig {

    @Bean
    public DirectExchange errorExchange() {
        return new DirectExchange("error.exchange", true, false);
    }

    @Bean
    public Queue errorQueue() {
        return new Queue("error.queue", true);
    }

    @Bean
    public Binding errorBinding(Queue errorQueue, DirectExchange errorExchange) {
        return BindingBuilder.bind(errorQueue).to(errorExchange).with("error.routingKey");
    }
}
```

错误队列消费者（人工排查 / 告警 / 定时补偿）：

```java
package com.canoe.rabbitmq.reliability.listener;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class ErrorQueueListener {

    @RabbitListener(queues = "error.queue")
    public void onError(Message message) {
        // 读取 RepublishMessageRecoverer 附加的异常信息头
        Object errMsg = message.getMessageProperties().getHeaders().get("x-exception-message");
        Object stack = message.getMessageProperties().getHeaders().get("x-exception-stacktrace");
        Object originalExchange = message.getMessageProperties().getHeaders().get("x-original-exchange");

        System.err.println("[ERROR-QUEUE] 原始交换机=" + originalExchange
                + ", 异常=" + errMsg);
        // 生产环境：发告警（钉钉/飞书/邮件）+ 落库，必要时人工重放
    }
}
```

## 八、消费幂等性

### 8.1 为什么必须幂等

回顾第四章的预警：网络重发、requeue、重试、Confirm 超时重投，**都会造成同一条业务消息被消费多次**。如果你的业务逻辑是"给用户加 100 积分"，重复消费就会加多次——这是资损事故。

> **幂等** = 同一条消息被处理 N 次，结果和处理 1 次一样。

### 8.2 四种方案对比

| 方案 | 原理 | 优点 | 缺点 | 适用 |
| --- | --- | --- | --- | --- |
| 数据库唯一索引 | 消息 ID 建唯一键，重复插入直接报错 | 简单、强一致 | 只能挡插入类 | 订单/流水创建 |
| 乐观锁 version | `UPDATE ... WHERE version=?` | 无额外组件 | 仅适合更新类 | 余额/库存变更 |
| 去重表 | 独立表记"已处理 msgId" | 通用 | 多一次 DB 写 | 任意场景 |
| **Redis `SETNX`** | 用 msgId 做键，`setIfAbsent` 抢锁 | 极快、通用 | 需处理过期与可用性问题 | **最常用推荐** |

### 8.3 推荐方案：唯一消息 ID + Redis SETNX

核心思想：每条消息带唯一 `msgId`（生产者用 `CorrelationData` 或消息头传下来）。消费前先用 `SETNX` 抢这个 key，抢到说明"第一次处理"，处理完保留（或设较长 TTL）；抢不到说明"重复了"，直接跳过。

```java
package com.canoe.rabbitmq.reliability.listener;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
public class IdempotentListener {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @RabbitListener(queues = "order.queue")
    public void listen(Message message) {
        // 从消息头取唯一消息 ID（生产者需通过 MessagePostProcessor 写入）
        String msgId = (String) message.getMessageProperties().getHeaders().get("x-msg-id");
        if (msgId == null) {
            msgId = message.getMessageProperties().getCorrelationId();
        }
        if (msgId == null) {
            // 没 ID 也要兜底，用内容哈希，避免空 key
            msgId = "fallback-" + message.hashCode();
        }

        String redisKey = "mq:done:" + msgId;
        // SETNX：key 不存在才设置成功，返回 true 表示"我是第一次"
        Boolean first = redisTemplate.opsForValue()
                .setIfAbsent(redisKey, "1", 24, TimeUnit.HOURS);
        if (Boolean.FALSE.equals(first)) {
            // 已经处理过，直接丢弃，保证幂等
            System.out.println("重复消息，跳过 msgId=" + msgId);
            return;
        }

        try {
            // 真正业务处理（如加积分）
            JsonNode payload = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(message.getBody());
            System.out.println("首次处理 msgId=" + msgId + "，内容=" + payload);
        } catch (Exception e) {
            // 处理失败：删除幂等标记，允许后续重试（否则会永久跳过！）
            redisTemplate.delete(redisKey);
            throw new RuntimeException("处理失败，已清除幂等标记以便重试", e);
        }
    }
}
```

### 8.4 SETNX + 过期时间的陷阱

上面的"设 24 小时 TTL"是为了防止 Redis 堆积。但它有个隐患：

```text
场景：业务处理要 30 秒（慢查询/下游超时）。
t=0s    SETNX 成功，开始处理
t=10s   key 的 24h TTL……不对，这里 TTL 是 24 小时不会这么快过期。
```

更隐蔽的陷阱是**反过来**：如果为了"处理完就释放"而把 TTL 设得很短（比如 5 秒），而业务处理要 30 秒——key 在第 5 秒过期，第 6 秒另一条重复消息进来，`SETNX` 又成功了，于是**同一消息被处理了两次**，幂等失效。

::: warning 简版方案的局限性
本篇用的是"处理前抢锁、设较长 TTL"的简版。它解决了绝大多数重复消费，但**不能保证严格 Exactly-Once**（业务超时导致 key 提前过期就可能误判）。生产级方案请见本专栏 **Redis 篇 06 章（分布式锁）**——用 `SET key value NX EX` + 唯一持有者标识 + 看门狗续期，才能既防重复又防误删。本篇先建立"消费必须幂等"的意识即可。
:::

### 8.5 更通用的幂等写法：先查状态再处理（状态机）

不依赖 Redis 也能幂等的稳妥做法：**用业务状态机兜底**。

```java
// 伪代码：订单支付回调，重复回调不应重复发货
Order order = orderMapper.selectById(orderId);
if (order.getStatus() == OrderStatus.PAID) {
    return;  // 已支付，直接返回，天然幂等
}
order.setStatus(OrderStatus.PAID);
orderMapper.updateById(order);   // 状态变更是原子的
```

配合数据库唯一约束（如 `uk_order_no`），即使并发也能兜底不重复。

## 九、消息积压

### 9.1 现象与危害

消息生产速度远大于消费速度，队列 `Ready` 数持续上涨，就是"积压"。危害：

- 磁盘打满（消息堆在 broker）
- 内存告警、broker 不稳定
- 消息 TTL 过期被丢弃（设置了过期时间的场景）
- 业务延迟：用户下单半小时才收到积分

### 9.2 排查命令

```bash
# 管理后台 Queues 页：看 Ready / Unacked 两个数字
# Ready 大 = 没人消费或消费太慢
# Unacked 大 = 消费者拉了但不 ack（卡在处理里）

# 命令行
rabbitmqctl list_queues name messages_ready messages_unacknowledged
rabbitmqctl list_consumers
```

### 9.3 解决步骤

```text
① 先修消费者 bug（最常见根因：消费者抛异常死循环 / 慢 SQL / 下游超时）
② 临时扩容消费者实例（加机器 / 加 pod 副本，同一队列多消费者并行）
③ 若还不行 → 终极方案：临时队列分流（见下）
```

### 9.4 终极方案：临时队列均匀分流

当单个队列积压百万级、单消费者怎么扩都跟不上时，新建 N 倍数量的临时 topic 队列，写个"转发消费者"把积压消息**均匀分发**过去，再起 N 倍消费者并行消费，消费完回收临时资源。

```java
package com.canoe.rabbitmq.reliability.listener;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class BacklogForwarder {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    // 临时转发的目标交换机与 N 个临时队列的路由键
    private static final String[] TEMP_ROUTING_KEYS = {
            "temp.1", "temp.2", "temp.3", "temp.4"
    };

    private int index = 0;

    /**
     * 原始积压队列的"转发消费者"：把消息轮流发到 N 个临时队列
     * 注意：这个转发者本身要从原队列消费（消费掉积压），不是拉取
     */
    @RabbitListener(queues = "order.backlog.queue", concurrency = "5")
    public void forward(Object payload) {
        // 轮询分发，保证均匀
        String rk = TEMP_ROUTING_KEYS[index++ % TEMP_ROUTING_KEYS.length];
        rabbitTemplate.convertAndSend("temp.topic.exchange", rk, payload);
    }
}
```

临时队列的消费者（N 倍实例，真正干活的）：

```java
package com.canoe.rabbitmq.reliability.listener;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class TempWorker {

    // 每个临时队列各起一个消费者；可水平扩展多个实例
    @RabbitListener(queues = "temp.queue.1")
    public void work1(Object payload) { realProcess(payload); }

    @RabbitListener(queues = "temp.queue.2")
    public void work2(Object payload) { realProcess(payload); }

    @RabbitListener(queues = "temp.queue.3")
    public void work3(Object payload) { realProcess(payload); }

    @RabbitListener(queues = "temp.queue.4")
    public void work4(Object payload) { realProcess(payload); }

    private void realProcess(Object payload) {
        // 真正的业务处理
        System.out.println("处理积压消息：" + payload);
    }
}
```

操作步骤小结：

```text
1) 新建 temp.topic.exchange（topic 类型）和 temp.queue.1~N
2) 绑定每个 temp.queue.i 到交换机，routingKey=temp.i
3) 启动 BacklogForwarder 消费原积压队列，把消息分流到临时队列
4) 起 N 倍 TempWorker 实例并行消费临时队列
5) 原队列 Ready 归零后，停掉转发者和临时队列，回收资源
```

::: tip 为什么不直接多消费者
单队列多消费者确实能提速，但受限于**单队列消费调度**和 `prefetch` 上限。积压极大时，单队列的调度开销和锁竞争成为瓶颈，分流到多队列才能线性扩展。这是"分而治之"的经典思路。
:::

## 十、消息顺序性

### 10.1 为什么会乱序

- **多消费者并发**：同队列多条消息被不同消费者并行处理，谁先完成不确定。
- **重试 requeue**：某条失败被重新入队，插到队尾，晚于后面的消息被处理。
- **多队列/分流**：上节的分流方案天然打破顺序。

### 10.2 保证顺序的代价

要严格保序，只能：

```text
单队列 + 单消费者 + prefetch=1
```

即"一条道、一个人、一次只取一条"。代价是**吞吐骤降**——高并发场景几乎不可用。所以大多数业务**不追求严格顺序**，而用"业务层最终顺序"兜底。

### 10.3 更实用的做法：业务层状态机/版本号

与其在 MQ 层死磕顺序，不如让业务**不依赖顺序**：

- 用**版本号/时间戳**：处理时若发现"旧版本消息晚到"，直接丢弃或忽略。
- 用**状态机**：订单状态只能 `待支付 → 已支付 → 已发货`，乱序到达的"已发货"在"未支付"状态下不生效。
- 按**业务主键分片**：同一订单 ID 的消息路由到同一队列（用 `routingKey=orderId`），保证同订单有序、不同订单并行。

```java
// 按订单 ID 路由到固定队列，保证同订单消息有序
String routingKey = "order." + (orderId % QUEUE_COUNT);
rabbitTemplate.convertAndSend("order.topic", routingKey, payload);
```

## 十一、可靠投递全景 checklist

把前面所有措施浓缩成一张"打钩清单"，上线前逐项核对：

| 维度 | 措施 | 怎么做 | 必选项 |
| --- | --- | --- | --- |
| 生产者 | 发布确认 | `publisher-confirm-type: correlated` + `ConfirmCallback` | ✅ 必选 |
| 生产者 | 消息回退 | `publisher-returns: true` + `template.mandatory: true` + `ReturnsCallback` | ✅ 必选 |
| 生产者 | 落库重投 | 消息底稿表 + 定时任务重试 + 超限告警 | ⚠️ 金融/订单必选 |
| Broker | 交换机持久化 | `durable=true` | ✅ 必选 |
| Broker | 队列持久化 | `durable=true` | ✅ 必选 |
| Broker | 消息持久化 | `deliveryMode=2`（`PERSISTENT`） | ✅ 必选 |
| Broker | 强一致 | Quorum Queue / Lazy Queue（按场景） | ⚠️ 高可靠场景 |
| 消费者 | 手动 ACK | `acknowledge-mode: manual` + `basicAck` | ✅ 必选 |
| 消费者 | 合理重试 | `RetryInterceptorBuilder.stateless` + 退避 | ✅ 必选 |
| 消费者 | 死信兜底 | `RepublishMessageRecoverer` 转错误队列 | ✅ 必选 |
| 消费者 | 消费幂等 | 唯一 msgId + Redis `SETNX` / 状态机 | ✅ 必选 |
| 全局 | 监控告警 | 队列堆积、Unacked、错误队列、Confirm 失败率 | ✅ 必选 |

::: tip 一句话总结可靠投递
**发有确认、丢有回退、存有底稿、落有持久、收有手动 ACK、错有重试与死信、重复有幂等、全程有监控**——八件事都做齐，消息才真正"可靠"。
:::

## 本篇小结

- **消息会丢在 5 个地方**：生产→交换机、交换机→队列、Broker 宕机、收到未处理完、处理抛异常，每处都有对应解法。
- **Publisher Confirm（`correlated` + `ConfirmCallback`）管"到没到交换机"**，回调里必须用 `CorrelationData` 带业务 ID 才能定位失败消息。
- **Publisher Return（`publisher-returns: true` + `template.mandatory: true` + `ReturnsCallback`）管"从交换机到没到队列"**，路由失败时退信。
- **Spring AMQP 3.x 用 `ReturnsCallback` 取代 2.x 的 `ReturnCallback`**，方法 `returnedMessage(ReturnedMessage)`，信息封装进 `ReturnedMessage`（含 `message/replyCode/replyText/exchange/routingKey`）。
- **仅 Confirm 不够**：应用重启会丢内存态回调，生产级需"消息落库底稿 + 定时重投 + 超限告警"。
- **Broker 持久化三件套**：交换机/队列 `durable=true`、消息 `deliveryMode=2`，但 PageCache 未刷盘仍可能丢，强一致靠 05 章 Quorum Queue。
- **消费者 ACK 用 `MANUAL` 最可控**，`basicAck/basicNack/basicReject` 区别在于批量与 requeue；`multiple=true` 会误删前序消息，慎用。
- **`@RabbitListener` 的 `Channel` 参数必须同步 ack**，异步 ack 会报 `Channel closed; cannot ack`。
- **默认 AUTO 抛异常会无限 requeue（死循环）**，用 `RetryInterceptorBuilder.stateless` + `MessageRecoverer` 兜底，推荐 `RepublishMessageRecoverer` 转错误队列。
- **重复消费必然发生**，消费端必须幂等；推荐"唯一 msgId + Redis `SETNX`"，严格场景见 Redis 篇 06 章分布式锁。
- **积压先修消费者 bug 再扩容**，终极方案是临时 N 倍队列分流；严格顺序代价大，用业务层状态机/版本号更实际。

## 参考链接

- Spring AMQP 发布确认与回退官方文档：<https://docs.spring.io/spring-amqp/reference/amqp/template.html>
- `RabbitTemplate` JavaDoc（`ConfirmCallback` / `ReturnsCallback`）：<https://docs.spring.io/spring-amqp/docs/current/api/org/springframework/amqp/rabbit/core/RabbitTemplate.html>
- `ReturnedMessage` JavaDoc：<https://docs.spring.io/spring-amqp/docs/current/api/org/springframework/amqp/core/ReturnedMessage.html>
- Spring AMQP 可靠接收（ACK/重试/死信）：<https://docs.spring.io/spring-amqp/reference/amqp/receiving.html>
- `RepublishMessageRecoverer` JavaDoc：<https://docs.spring.io/spring-amqp/docs/current/api/org/springframework/amqp/rabbit/retry/RepublishMessageRecoverer.html>
- `RetryInterceptorBuilder` JavaDoc：<https://docs.spring.io/spring-amqp/docs/current/api/org/springframework/amqp/rabbit/retry/RetryInterceptorBuilder.html>
- RabbitMQ 发布者确认（Confirms）官方指南：<https://www.rabbitmq.com/docs/confirms>
- RabbitMQ 仲裁队列（Quorum Queues）：<https://www.rabbitmq.com/docs/quorum-queues>

下一篇 → [05 高级特性与延迟队列](/java/middleware/rabbitmq/advanced)
