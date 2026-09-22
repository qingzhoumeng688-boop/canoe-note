# 06 集群、监控与生产调优

> 本篇导读：前几篇我们都是在"单机"上学 RabbitMQ——怎么发、怎么收、怎么延迟、怎么兜底。但真实生产环境里，单机就是个定时炸弹：机器一宕机，消息全没了，系统直接不可用。本篇带你从"为什么必须上集群"讲起，把普通集群、被 4.0 移除的镜像队列、现在主推的 Quorum Queue、Stream Queue、负载均衡、网络脑裂、监控告警、内存磁盘水位、上线调优 checklist 和生产故障排查表，一次性讲透。读完你应该能在心里画出一张"生产级 RabbitMQ 部署蓝图"。

## 本篇要解决的问题

- 单机 RabbitMQ 到底有哪些致命短板，非上集群不可？
- 普通集群能把消息复制到每个节点吗？为什么 node1 挂了队列消息还是没了？
- 听说镜像队列能高可用，为什么 4.x 反而把它删了？现在该用什么？
- Quorum Queue 是什么、怎么声明、副本数设几个、有哪些不能用的特性？
- 3 个节点怎么用 docker-compose 搭起来、怎么 join_cluster？
- 客户端连多个节点怎么做负载均衡？HAProxy / Nginx stream 怎么配？
- 网络分区（脑裂）是什么、三种处理策略怎么选、为什么推荐 `pause_minority`？
- 监控看哪些指标、告警阈值怎么设、Prometheus + Grafana 怎么接？
- 内存/磁盘水位到了会怎样、怎么调？上线前 checklist 有哪些必做项？
- 队列堆积、Unacked 暴涨、Channel 爆炸这类线上故障怎么快速定位？

## 一、为什么需要集群

### 1.1 单机的问题

把 RabbitMQ 跑在一台机器上，就像把全部鸡蛋放一个篮子里：

- **宕机即不可用**：机器断电、进程 OOM、磁盘坏道，MQ 一挂，上游生产者和下游消费者全断，相关业务停摆。
- **内存容量上限**：所有消息、连接、channel 都吃这一台机器的内存。流量一上来，单机能扛的吞吐和队列长度都有天花板。
- **没有扩展性**：业务涨了只能给这台机器加内存加 CPU（垂直扩容），成本非线性上升，且总有上限。

### 1.2 集群能解决什么

把多台 RabbitMQ 组成一个**集群（Erlang 分布式集群）**，元数据（交换机、队列、绑定、用户、权限、vhost）在所有节点间同步，客户端连任意节点都能看到全貌。这带来：

- **高并发吞吐**：生产者和消费者可以分散到不同节点，整体吞吐线性提升。
- **水平扩展**：加节点就能加容量，不用死磕单机配置。
- **部分高可用**：配合 Quorum Queue / Stream（下详），队列消息也能在多节点有副本，单节点挂了不丢数据。

::: tip 一句话
单机的痛点是"挂了就全完"；集群的初衷是"分散风险、横向扩容"。但**普通集群默认并不复制消息体**，要做到"挂一个节点消息不丢"，得用 Quorum Queue 或 Stream——这是后面两节的重点。
:::

## 二、普通集群（默认集群模式）

### 2.1 原理：只同步元数据

普通集群（也叫"非镜像集群"）最核心、也最容易被误解的一点：

> **集群只同步元数据（交换机、队列、绑定、用户、权限、vhost），队列里真正的消息只存在于"创建这个队列的那个节点"上。**

也就是说，队列是一个"有主场"的对象。假设队列 Q 在 node1 上创建，那么：
- 它的消息只存在 node1 的磁盘/内存里；
- node2、node3 只知道"有个队列 Q，它在 node1"，但**没有 Q 的消息副本**；
- 当客户端连到 node2 想访问 Q 时，node2 会内部把请求**重定向/代理**到 node1 去取数据。

```text
         客户端A                    客户端B
            |                         |
            v                         v
        [ node1 ]                [ node2 ]                 [ node3 ]
        队列Q的"主场"            仅知道Q在node1            仅知道Q在node1
        消息真正在这里  <---- 内部重定向/代理 ---->  访问Q要去node1取

        node1 挂了 → Q 的消息随之消失（元数据还在，但消息没了）
```

### 2.2 能解决什么

- 提升**生产/消费并发**：多个节点分摊连接和 CPU。
- **线性扩容**消费者和生产者：加机器就能扛更多流量。
- 元数据高可用：交换机/绑定等定义不会因为单节点挂而丢失。

### 2.3 不能解决什么（重点）

::: danger 普通集群不保证消息高可用
如果创建队列 Q 的 node1 宕机，**Q 里的消息就访问不到了，直到 node1 恢复**。期间：
- 连到其他节点的客户端访问 Q 会报错或被阻塞；
- node1 上的未消费消息在 node1 恢复前等于"暂时丢失"（若磁盘也坏了就是永久丢失）。

所以：**普通集群 ≠ 高可用队列**。要做到队列消息不丢，必须用 Quorum Queue 或 Stream（第 4、5 节）。
:::

### 2.4 搭建步骤（docker-compose 三节点）

下面给一套可直接跑的 3 节点普通集群配置。三个节点共享同一个 Erlang Cookie（集群成员靠 cookie 互相认证）。

```yaml
version: "3.8"

services:
  rabbit1:
    image: rabbitmq:4.1-management-alpine
    hostname: rabbit1
    ports:
      - "15672:15672"
      - "5672:5672"
    environment:
      - RABBITMQ_DEFAULT_USER=admin
      - RABBITMQ_DEFAULT_PASS=admin123
      # 同一集群的节点必须 Cookie 一致
      - RABBITMQ_ERLANG_COOKIE=canoe_secret_cookie
      # 用短域名互相发现
      - RABBITMQ_NODENAME=rabbit@rabbit1
    volumes:
      - ./rabbit1-data:/var/lib/rabbitmq

  rabbit2:
    image: rabbitmq:4.1-management-alpine
    hostname: rabbit2
    ports:
      - "15673:15672"
      - "5673:5672"
    environment:
      - RABBITMQ_DEFAULT_USER=admin
      - RABBITMQ_DEFAULT_PASS=admin123
      - RABBITMQ_ERLANG_COOKIE=canoe_secret_cookie
      - RABBITMQ_NODENAME=rabbit@rabbit2
    volumes:
      - ./rabbit2-data:/var/lib/rabbitmq
    # 等 rabbit1 先起来再加入
    depends_on:
      - rabbit1

  rabbit3:
    image: rabbitmq:4.1-management-alpine
    hostname: rabbit3
    ports:
      - "15674:15672"
      - "5674:5672"
    environment:
      - RABBITMQ_DEFAULT_USER=admin
      - RABBITMQ_DEFAULT_PASS=admin123
      - RABBITMQ_ERLANG_COOKIE=canoe_secret_cookie
      - RABBITMQ_NODENAME=rabbit@rabbit3
    volumes:
      - ./rabbit3-data:/var/lib/rabbitmq
    depends_on:
      - rabbit1
```

启动后，把 node2、node3 加入 node1 形成的集群：

```bash
# 启动三个容器
docker compose up -d

# 进入 node2，停止应用 → 加入 node1 集群 → 启动应用
docker exec -it rabbit2 bash -c \
  "rabbitmqctl stop_app && \
   rabbitmqctl join_cluster rabbit@rabbit1 && \
   rabbitmqctl start_app"

# node3 同理
docker exec -it rabbit3 bash -c \
  "rabbitmqctl stop_app && \
   rabbitmqctl join_cluster rabbit@rabbit1 && \
   rabbitmqctl start_app"

# 查看集群状态（应在 Nodes 里看到 3 个节点，running_nodes 全 online）
docker exec -it rabbit1 rabbitmqctl cluster_status
```

::: tip 加入集群注意
`join_cluster` 必须在 `stop_app` 之后、`start_app` 之前执行。加入的节点如果已有数据，会被清空以匹配目标集群的状态（所以新节点先别建重要数据）。4.x 引入 Khepri 作为新的元数据后端，join 行为基本一致，但升级跨大版本请先在测试环境验证。
:::

## 三、镜像队列 Classic Queue Mirroring（重要版本提示）

### 3.1 原理（历史方案）

镜像队列（Classic Queue Mirroring）是 RabbitMQ **早期**用来做队列高可用的机制：一个队列可以在 N 个节点上拥有副本（1 个主副本 leader + 若干个镜像副本 mirror）。所有读写先在主副本执行，再同步复制到镜像副本。主副本所在节点挂了，一个已同步的镜像会被提升为新主，从而实现"队列在、消息在"。

配置方式历史上有两种：
- 通过 **policy**（`ha-mode` 等）：`ha-all`（全节点镜像）、`ha-exactly`（精确 N 个）、`ha-nodes`（指定节点列表）。
- 队列参数 `x-ha-policy`。

同步模式：`ha-sync-mode: automatic`（新加入的镜像自动同步）vs 手动（`ha-sync-batch-size` 控制批量同步）。

### 3.2 已知严重问题

镜像队列在实际生产中暴露了很多硬伤：

- **主节点故障后未同步的消息会丢失**：如果镜像还没追上主副本，被提升后那些"没同步到"的消息就没了。
- **需要人工介入恢复**：脑裂、网络抖动后经常出现"镜像不同步"，得手动处理。
- **`autoheal` 会造成数据不一致**：自动恢复时选一个"胜利者"，牺牲其他节点的数据。
- **性能开销大**：每条消息都要同步到所有镜像，写放大严重，吞吐随镜像数下降明显。

### 3.3 4.x 官方立场（务必看清）

::: danger 4.x 已彻底移除 Classic Queue Mirroring
Classic Queue Mirroring 自 **2021 年起就被官方废弃（deprecated）**，并在 **RabbitMQ 4.0 中彻底移除（removed completely）**。官方原文明确：

> "After three years of deprecation, classic queue mirroring was completely removed in this version. ... Classic queues continue being supported without any breaking changes ... but they are now a non-replicated queue type."

也就是说：
- **RabbitMQ 4.x 里 `ha-*` 相关的 policy 已经没有任何效果**，配了也不会报错但"镜像不会生效"。
- 官方推荐迁移到 **Quorum Queue** 或 **Stream**。
- 老版本（3.x 及更早）了解镜像队列即可，**新项目、新集群请直接用 Quorum Queue**，不要再用 `ha-*`。

参考：RabbitMQ 官方 "What's New in 4.0" 与 "Classic Queue Mirroring (Deprecated)" 文档（见文末参考链接）。
:::

::: warning 升级迁移提醒
如果你正从 3.x 升级到 4.x，且旧集群里跑着镜像队列，**必须先把镜像队列迁移成 Quorum Queue 或 Stream**（可用 rabbitmqadmin v2 等工具辅助迁移），否则升级后这些队列会变成"非复制的普通队列"，失去高可用。
:::

## 四、Quorum Queue（重点推荐）

### 4.1 原理：Raft 共识

Quorum Queue 是 RabbitMQ 现代的高可用队列类型，基于 **Raft 共识算法**。一个 Quorum 队列在多个节点上有副本（leader + followers），写入一条消息必须得到**多数派（quorum = N/2 + 1 个副本）确认**才算成功。

```text
3 副本 Quorum 队列（quorum = 2）：
   leader(node1)  +  follower(node2)  +  follower(node3)
   写入需 2/3 确认 → 即使 node3 挂了，2 个还在 → 消息安全、可继续服务
   若 node1(leader) 挂了 → 剩余 2 个重新选主 → 数据不丢、自动切换
```

### 4.2 声明方式

方式一：队列参数 `x-queue-type: quorum`

```java
package com.canoe.rabbitmq.production.quorum;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class QuorumConfig {

    @Bean
    public Queue quorumQueue() {
        Map<String, Object> argsMap = new HashMap<>(4);
        // 关键：声明为 quorum 类型
        argsMap.put("x-queue-type", "quorum");
        return QueueBuilder.durable("order.quorum.queue")
                .withArguments(argsMap)
                .build();
    }
}
```

方式二：用 policy（推荐，对一批队列统一生效）

```bash
# 对所有名字以 "quorum." 开头的队列启用 quorum 类型
docker exec -it rabbit1 rabbitmqctl set_policy quorum-policy \
  "^quorum\." '{"queue-type":"quorum"}' --apply-to queues
```

::: tip 副本数怎么设
- **推荐 3 或 5 个副本**。
- **偶数节点没意义**：Raft 要"多数派"，3 节点容忍 1 个挂、4 节点也只容忍 1 个挂（quorum 都是 2/4 vs 2/3），但 4 节点要多养一个副本还多写一份。所以副本数用奇数。
- 集群至少 3 节点才能体现 Quorum 的价值。
:::

### 4.3 优点

- **强一致**：写入经多数派确认，不丢消息。
- **故障自动切换**：leader 挂了，followers 自动选新 leader，无需人工介入。
- **可预测的失败语义**：不会像镜像队列那样出现"未同步副本被提升导致丢消息"的混乱。
- 通过 Jepsen 测试，网络分区/故障场景下行为可信。

### 4.4 限制（对照表，务必看全）

::: warning Quorum Queue 不能用的特性
Quorum Queue 为了"数据安全"放弃了一些"瞬时/特殊"特性，下面这张表来自官方 Feature Matrix，**写代码前先确认你的需求不在禁区里**：
:::

| 特性 | Classic Queue | Quorum Queue | 说明 |
| --- | --- | --- | --- |
| 非持久化队列（non-durable） | 支持 | **不支持** | Quorum 永远持久化 |
| 排他队列（exclusive） | 支持 | **不支持** | 不与连接生命周期绑定 |
| 消息 TTL | 支持 | **支持（自 3.10）** | 4.x 可设 `x-message-ttl` |
| 队列 TTL | 支持 | 部分支持 | 重新声明不续租 |
| 队列长度限制 | 支持 | 支持（**除 `x-overflow: reject-publish-dlx`**） | 注意这个例外 |
| 惰性（lazy） | 支持 | **始终 lazy（自 3.10）** | 消息直接落盘 |
| 消息优先级（priority） | 支持 | **不支持** | 需要优先级请用 Classic/业务层 |
| 全局 QoS（global prefetch） | 支持 | **不支持** | 用 `global=false` |
| 服务端命名队列（server-named） | 支持 | **不支持** | 要用具名队列 |
| 死信交换机（DLX） | 支持 | 支持 | 含 at-least-once 死信 |
| 单活跃消费者（SAC） | 支持 | 支持 | — |
| 消费者优先级 | 支持 | 支持 | — |

::: danger 4.0 一个行为变化：默认重投上限
RabbitMQ 4.0 起，Quorum Queue 的**默认投递（重投）上限从"无限"改为 20**。一条消息被反复 `nack`/`reject` 超过 20 次，会被丢弃或转死信（防"毒消息"把节点拖死）。如果你的老逻辑依赖无限重投，升级后要显式调整或加死信兜底。
:::

### 4.5 什么时候选 Quorum，什么时候选 Classic

| 场景 | 选谁 | 理由 |
| --- | --- | --- |
| 订单、交易、关键业务消息 | **Quorum** | 数据安全优先，不能丢 |
| 需要多副本高可用 | **Quorum** | 自动选主、强一致 |
| 瞬时/临时队列、RPC 回复队列 | Classic | Quorum 不支持 exclusive/non-durable |
| 需要消息优先级 | Classic（或业务层排序） | Quorum 不支持优先级 |
| 超长堆积（500 万+）、大 fanout | **Stream** | Quorum 内存/性能不适合 |
| 追求极致吞吐、可容忍丢失 | Classic | 少一层共识开销 |

### 4.6 查看状态（`rabbitmqctl` / `rabbitmq-queues`）

```bash
# 列出队列及其类型、副本成员（队列相关操作用 rabbitmq-queues）
docker exec -it rabbit1 rabbitmq-queues list_members order.quorum.queue

# 查看队列概览（含类型、状态）
docker exec -it rabbit1 rabbitmqctl list_queues name type state

# 查看某 Quorum 队列的 leader 在哪个节点
docker exec -it rabbit1 rabbitmq-queues status
```

## 五、Stream Queue（3.9+）

### 5.1 特点

Stream（流）是 RabbitMQ 3.9 起正式可用的一种**日志型（append-only log）队列结构**：

- **append-only 日志**：消息写入后按到达顺序追加，不被消费而删除。
- **可重复消费**：每个消费者自己维护 **offset（偏移量）**，想从头读、从中间读都行，像 Kafka 的 consumer group。
- **消息可长期保留**：可配置保留策略（按时间/大小），适合审计、回放。
- ** replicated**：和 Quorum 一样支持多副本（基于 Raft）。

### 5.2 与 Quorum / Classic 对比表

| 维度 | Classic | Quorum | Stream |
| --- | --- | --- | --- |
| 数据结构 | FIFO 队列 | 复制 FIFO 队列 | append-only 日志 |
| 是否多副本 | 否（4.x 非复制） | 是（Raft） | 是（Raft） |
| 重复消费 | 否（消费即走） | 否 | **是（按 offset 回放）** |
| 消息保留 | 被消费即删 | 被消费即删 | **可长期保留** |
| 典型场景 | 一般业务、临时队列 | 关键业务高可用 | 审计日志、大 fanout、回放、事件溯源 |
| 消费模型 | 推/拉，竞争消费 | 竞争消费 | 多消费者各自 offset |

### 5.3 适用场景

- **大型 fanout**：一条消息要被很多独立消费者各自完整处理。
- **审计日志 / 事件溯源**：消息要留底、可回放重算。
- **需要"重播"的业务**：比如离线分析要重跑昨天的订单流。

声明 Stream 队列（用 `x-queue-type: stream`，并可选 `x-max-length-bytes` 等保留策略）：

```java
package com.canoe.rabbitmq.production.stream;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class StreamConfig {

    public static final String STREAM_QUEUE = "audit.stream.queue";
    public static final String EXCHANGE = "audit.exchange";

    @Bean
    public Queue streamQueue() {
        Map<String, Object> argsMap = new HashMap<>(4);
        argsMap.put("x-queue-type", "stream");
        // 保留最近 1GB 或 7 天（取先到者）
        argsMap.put("x-max-length-bytes", 1_073_741_824);
        argsMap.put("x-max-age", "7D");
        return QueueBuilder.durable(STREAM_QUEUE).withArguments(argsMap).build();
    }

    @Bean
    public TopicExchange streamExchange() {
        return new TopicExchange(EXCHANGE, true, false);
    }

    @Bean
    public Binding streamBinding() {
        return BindingBuilder.bind(streamQueue()).to(streamExchange()).with("#");
    }
}
```

## 六、负载均衡

集群搭好后，客户端不能"写死连某一个节点"——否则那节点挂了客户端就断了，集群白搭。负载均衡分两端：

### 6.1 客户端侧：连接多个地址

Spring AMQP 的 `addresses` 支持填多个节点，客户端内部会做故障转移：

```yaml
spring:
  rabbitmq:
    # 逗号分隔多个节点，客户端依次尝试，连不上自动换下一个
    addresses: node1:5672,node2:5672,node3:5672
    username: admin
    password: admin123
    # 连接恢复（断线重连）
    connection-timeout: 5000
```

原生 client 用 `Addresses` 类：

```java
package com.canoe.rabbitmq.production.lb;

import com.rabbitmq.client.Address;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

public class MultiNodeClient {

    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setUsername("admin");
        factory.setPassword("admin123");
        // 传入多个节点地址，自动故障转移
        Address[] addrs = new Address[]{
                new Address("node1", 5672),
                new Address("node2", 5672),
                new Address("node3", 5672)
        };
        try (Connection connection = factory.newConnection(addrs)) {
            System.out.println("已连到：" + connection.getAddress());
        }
    }
}
```

### 6.2 服务端侧：HAProxy

在客户端和 RabbitMQ 集群之间放一层 HAProxy，做 TCP 层负载均衡 + 健康检查，客户端只连 HAProxy 的虚拟地址。

```text
# HAProxy 关键配置片段（haproxy.cfg）
listen rabbitmq_amqp
    bind *:5672
    mode tcp
    option tcplog
    # 后端三个节点，轮询分发；健康检查用 RabbitMQ 的 amqp 端口探测
    server rabbit1 node1:5672 check inter 5000 rise 2 fall 3
    server rabbit2 node2:5672 check inter 5000 rise 2 fall 3
    server rabbit3 node3:5672 check inter 5000 rise 2 fall 3

listen rabbitmq_mgmt
    bind *:15672
    mode tcp
    server rabbit1 node1:15672 check
    server rabbit2 node2:15672 check
    server rabbit3 node3:15672 check
```

要点：
- `mode tcp`：AMQP 是二进制协议，必须四层（TCP）转发，不能用 HTTP 层。
- `check`：定期探活，节点挂了自动剔除。
- 配合 **keepalived** 在 HAProxy 之上做 VIP（虚拟 IP），避免 HAProxy 自身成为单点。

### 6.3 Nginx stream 模块代理 5672

如果你已有 Nginx，用它的 `stream` 模块（注意是 `stream {}` 不是 `http {}`）也能代理 AMQP：

```text
# nginx.conf（stream 上下文，与 http 平级）
stream {
    upstream rabbitmq_cluster {
        # 加权轮询到三个节点
        server node1:5672 max_fails=3 fail_timeout=30s;
        server node2:5672 max_fails=3 fail_timeout=30s;
        server node3:5672 max_fails=3 fail_timeout=30s;
    }

    server {
        listen 5672;
        proxy_pass rabbitmq_cluster;
        # 连接空闲超时，避免半开连接堆积
        proxy_timeout 300s;
        proxy_connect_timeout 5s;
    }
}
```

### 6.4 注意事项

::: warning 几个容易踩的坑
- **连接空闲超时**：NAT、云厂商 LB 会对空闲 TCP 连接做回收，导致客户端突然收到 "socket closed"。把 RabbitMQ 的 `requested_heartbeat` 调小（如 30s），让心跳保活；同时 LB 的 idle timeout 要大于心跳周期。
- **健康检查别太激进**：探测频率过高会占用连接，间隔 5s 左右较稳妥。
- **管理端口 15672 也要均衡**：运维访问 UI 走 VIP/LB 更安全。
:::

## 七、网络分区（脑裂）

### 7.1 是什么、危害

集群节点之间靠网络心跳互认。当网络抖动、交换机故障导致**部分节点之间失联但各自都还活着**，就发生了"网络分区（network partition / 脑裂）"。分区期间，两边可能各自继续服务，等网络恢复后，两边的状态（消息、队列）出现了**分歧**——这就是脑裂。危害是数据可能重复、丢失或不一致。

### 7.2 三种处理策略对比

通过 `rabbitmq.conf` 的 `cluster_partition_handling` 配置（默认是 `ignore`）：

| 策略 | 行为 | 优点 | 缺点 | 推荐度 |
| --- | --- | --- | --- | --- |
| `ignore`（默认） | 分区期间各节点各干各的，恢复后合并元数据 | 不中断服务 | 恢复后可能**丢数据/重复**，状态难一致 | 不推荐生产 |
| `pause_minority` | 少数派节点"自杀"（暂停自己），等网络恢复 | 保证多数派一致，恢复简单 | 少数派期间不可用（但数据不裂） | **推荐** |
| `autoheal` | 恢复后自动选一个"胜利者"节点，其他节点数据被丢弃对齐 | 全自动恢复 | **会丢数据**（非胜利者的消息没了） | 仅容忍丢数据的场景 |

### 7.3 生产推荐

::: tip 结论
**生产环境推荐 `pause_minority`**。它的哲学是"宁可少数节点短暂不可用，也不要让数据分裂"。代价只是少数派节点在分区期间拒绝服务，但恢复后数据是一致的、不需要人工擦屁股。

```text
# rabbitmq.conf
cluster_partition_handling = pause_minority
```

`autoheal` 虽然全自动，但会无脑丢数据，只适合"消息可重放、丢了能补"的缓存类场景。
:::

## 八、监控

### 8.1 Management UI 怎么看

浏览器打开 `http://node1:15672`，重点看：

- **Overview 页**：节点数、集群状态、消息总速率（publish/deliver）、内存/磁盘占用。
- **Queues 页**：每个队列的 Ready（待消费）、Unacked（已投递未确认）、Total、消息速率曲线。
- **Connections / Channels 页**：连接数、channel 数是否异常暴涨。
- **Nodes 页**：单节点的内存、磁盘、Erlang 进程数、Mnesia 状态。

### 8.2 HTTP API

Management 插件自带 REST API，可脚本化取数：

```bash
# 集群总览（含消息速率、节点资源）
curl -u admin:admin123 http://node1:15672/api/overview

# 所有队列的状态（Ready/Unacked/Total、速率等），加 ?columns= 可精简字段
curl -u admin:admin123 http://node1:15672/api/queues

# 单个队列详情
curl -u admin:admin123 http://node1:15672/api/queues/%2F/order.quorum.queue
```

### 8.3 Prometheus + Grafana

启用 `rabbitmq_prometheus` 插件，暴露 `/metrics` 端点给 Prometheus 抓取：

```bash
# 每个节点都启用
docker exec -it rabbit1 rabbitmq-plugins enable rabbitmq_prometheus
docker exec -it rabbit2 rabbitmq-plugins enable rabbitmq_prometheus
docker exec -it rabbit3 rabbitmq-plugins enable rabbitmq_prometheus
```

`prometheus.yml` 抓取配置示例：

```yaml
scrape_configs:
  - job_name: 'rabbitmq'
    static_configs:
      - targets:
          - 'node1:15692'
          - 'node2:15692'
          - 'node3:15692'
```

Grafana 导入**官方 Dashboard "RabbitMQ-Overview"（ID 10991）**即可看到现成的队列、速率、节点资源面板。导入路径：Grafana 左侧 `+` → Import → 填 `10991` → 选 Prometheus 数据源。

### 8.4 核心监控指标表

| 指标 | 含义 | 关注点 |
| --- | --- | --- |
| `rabbitmq_queue_messages_ready` | 队列待消费消息数（Ready） | 持续上涨 = 消费跟不上 |
| `rabbitmq_queue_messages_unacked` | 已投递未确认（Unacked） | 持续上涨 = 消费者卡死/不 ACK |
| `rabbitmq_queue_messages` | 总消息数（Ready+Unacked） | 整体堆积量 |
| 发布速率 `message_stats.publish` | 每秒发布数 | 流量基线 |
| 投递速率 `message_stats.deliver` | 每秒投递数 | 消费能力基线 |
| ACK 速率 `message_stats.ack` | 每秒确认数 | 与 deliver 是否匹配 |
| 连接数 `rabbitmq_connections` | 当前连接数 | 暴涨 = 连接泄漏 |
| channel 数 `rabbitmq_channels` | 当前 channel 数 | 暴涨 = 每发消息都建 channel |
| 节点内存 `rabbitmq_node_memory` | 节点内存占用 | 逼近水位线告警 |
| 节点磁盘 `rabbitmq_disk_free` | 节点剩余磁盘 | 低于 `disk_free_limit` 阻塞 |
| Erlang 进程数 / Mnesia | 内部资源 | 异常增长预示泄漏 |

### 8.5 告警阈值建议表

| 告警项 | 建议阈值 | 说明 |
| --- | --- | --- |
| 队列 Ready 数 | **超过 10000 且持续 5 分钟** | 消费跟不上，需扩容消费者 |
| Unacked 数 | **持续增长不回落** | 消费者不 ACK 或处理卡住 |
| 节点内存 | **超过水位线 40%~70%** | 逼近 `vm_memory_high_watermark` 会阻塞 |
| 剩余磁盘 | **低于 2GB 或低于 `disk_free_limit`** | 触发 `disk_free_limit` 阻塞生产者 |
| 节点不可达 | 任一节点 `down` | 集群缺节点，高可用降级 |
| channel 数 | **短时间内暴涨** | 多半是连接/channel 未复用 |
| 消息速率骤降/为 0 | 偏离基线 | 生产者断了或队列被阻塞 |

## 九、内存与磁盘水位

### 9.1 内存水位 `vm_memory_high_watermark`

RabbitMQ 用内存水位控制"什么时候开始拒绝/阻塞生产者"：

- 默认 `vm_memory_high_watermark = 0.4`，即节点内存用到 **40%** 就开始施加背压。
- 触发后节点会进入 **`mem_alarm`** 状态，阻塞所有生产者发布，直到内存降下来。

```text
# rabbitmq.conf
# 设为物理内存的 0.6（内存大的机器可调高，但别到 0.7 以上）
vm_memory_high_watermark.relative = 0.6
```

::: warning 调高水位的代价
水位调太高（如 0.9），内存快满才阻塞，一旦 OOM 整个节点崩，比"早阻塞"更糟。一般 0.4~0.6 是合理区间，结合监控告警提前介入。
:::

### 9.2 磁盘水位 `disk_free_limit`

磁盘剩余空间低于阈值时，RabbitMQ 同样阻塞生产者，防止写满导致崩溃：

- 默认约 **50MB**（很保守）。
- 官方建议设为**内存的 1.0~2.0 倍**，避免"内存还有、磁盘先爆"。

```text
# rabbitmq.conf
# 至少保留 2GB 空闲
disk_free_limit.absolute = 2GB
# 或相对内存的倍数（推荐）
disk_free_limit.relative = 1.5
```

### 9.3 触发阻塞时的表现与排查

阻塞时你会看到：
- 生产者发布被拒/卡住，日志出现 `disk resource limit alarm` / `memory resource limit alarm`。
- Management UI 节点标红，Overview 显示 `disk_free_limit` / `mem_alarm`。
- 队列消息不再增长。

排查顺序：先看是哪个 alarm（`rabbitmqctl status` 或 UI）→ 清堆积/加磁盘/加节点 → 水位恢复后自动解除阻塞。

## 十、生产调优 checklist

下面这些是新项目上线 RabbitMQ 前**必过**的清单。

### 10.1 Connection 和 Channel 必须复用

::: danger 最家常的错误
很多新手每发一条消息就 `new Connection()` + `new Channel()`，发完就关。这是**性能灾难**：
- TCP 连接建立/销毁成本高；
- 节点要为每个连接/channel 维护 Erlang 进程，连接数一多节点就被拖垮；
- channel 暴涨会触发"channel 数"告警，甚至打满文件描述符。

正确做法：**Connection 长连接复用**（应用生命周期内一个连接池），**Channel 也复用**（每个线程/每次调用从池取一个 Channel，用完归还，不要每发一条 new 一个）。Spring 的 `RabbitTemplate` 已经帮你管理了连接/Channel 池，直接用即可，别自己手搓短连接。
:::

### 10.2 `publisher-returns` 必须开 + `mandatory` 必须处理

```yaml
spring:
  rabbitmq:
    publisher-returns: true        # 开启 return 回调
    publisher-confirm-type: correlated  # 开启 confirm 确认
```

```java
package com.canoe.rabbitmq.production.tuning;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;

@Component
public class ConfirmAndReturn {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @PostConstruct
    public void init() {
        // 消息路由不到队列时被返回，这里必须处理（否则静默丢消息）
        rabbitTemplate.setReturnsCallback(new RabbitTemplate.ReturnsCallback() {
            @Override
            public void returnedMessage(ReturnedMessage returned) {
                Message msg = returned.getMessage();
                System.err.println("[return] 路由失败被退回：" + msg + "，replyText=" + returned.getReplyText());
                // 真实场景：记日志 / 落库 / 告警 / 转死信
            }
        });

        // 发布确认：broker 收到并持久化后回调
        rabbitTemplate.setConfirmCallback(new RabbitTemplate.ConfirmCallback() {
            @Override
            public void confirm(Message message, boolean ack, String cause) {
                if (!ack) {
                    System.err.println("[confirm] 消息未到达 broker：" + message + "，原因=" + cause);
                }
            }
        });
    }
}
```

::: tip mandatory 的作用
`mandatory=true` 表示"消息必须能路由到队列，否则返回给生产者"。配合 `publisher-returns` 的 `returnsCallback`，你能在代码里抓住"路由失败"的消息，而不是让它被静默丢弃。
:::

### 10.3 心跳与网络抖动

- `requested_heartbeat` 默认 60 秒。在 **NAT / 云 LB / 容器网络**环境下，中间设备可能 30~60 秒就回收空闲连接，导致客户端突然 `heartbeat timeout` / `socket closed`。
- 建议把心跳调小到 **30 秒**左右，并让 LB 的 idle timeout 大于心跳周期。

```yaml
spring:
  rabbitmq:
    requested-heartbeat: 30s
```

### 10.4 消息体控制在 1MB 以内

::: warning 大消息是毒药
把 10MB 的 JSON、图片、文件塞进 MQ，会：
- 撑大内存/磁盘，挤压正常消息；
- 网络传输慢，拖低整体吞吐；
- 超出 broker 的 `max_message_size`（4.0 默认已降到 **16 MiB**，超限直接拒）。

正确做法：MQ 里只传**业务 key / 对象存储的路径**，大文件存 OSS/S3，消费者再去下载。
:::

### 10.5 prefetch 不要设 0/无限

`prefetch` 控制消费者一次预取多少条到本地（unacked 上限）。设 0 表示"无限预取"——broker 会把队列里所有消息一次性推给这个消费者，消费慢就内存爆炸。设一个具体值（如 10~100）：

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        prefetch: 20
```

### 10.6 消费者并发与线程池

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        concurrency: 5        # 最少 5 个消费者线程
        max-concurrency: 20   # 最多 20 个
```

业务逻辑如果是 IO 密集（调外部接口、查库），给消费者配独立线程池，避免阻塞 RabbitMQ 的消费者线程。

### 10.7 持久化 + 队列类型选择

- 消息 `deliveryMode=2`（持久化），队列 `durable=true`，交换机也要 `durable`，三样都持久化，节点重启才不丢。
- 关键业务队列用 **Quorum Queue**；临时/可丢的用 Classic；要回放/审计用 Stream。
- 不用 Quorum 的场景（如需要 exclusive 的 RPC 回复队列）才用 Classic。

### 10.8 别让队列无限制堆积

给队列设 TTL 或 `x-max-length`，避免消息无限堆积把磁盘写满：

```java
package com.canoe.rabbitmq.production.tuning;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class BoundedQueueConfig {

    @Bean
    public Queue boundedQueue() {
        Map<String, Object> argsMap = new HashMap<>(8);
        argsMap.put("x-max-length", 100_000);                 // 最多 10 万条
        argsMap.put("x-overflow", "reject-publish");          // 满了拒绝新消息（背压）
        return QueueBuilder.durable("bounded.queue").withArguments(argsMap).build();
    }
}
```

### 10.9 定期归档与清理

- 不用的临时队列、测试队列及时删，别留一堆无人消费的"僵尸队列"占资源。
- 监控里对 `Ready` 长期为 0 但队列还存在的，评估是否可下线。
- 大流量队列配合惰性/Quorum 的落盘策略，控制磁盘增长。

### 10.10 `rabbitmqctl` 常用排障命令

```bash
# 集群状态
rabbitmqctl cluster_status

# 节点资源占用
rabbitmqctl status

# 列出所有队列（名称、消息数、状态）
rabbitmqctl list_queues name messages_ready messages_unacknowledged state

# 列出所有连接 / channel（查泄漏）
rabbitmqctl list_connections
rabbitmqctl list_channels

# 查看用户 / 权限
rabbitmqctl list_users
rabbitmqctl list_permissions

# 追踪某个连接的问题（开 trace，排完记得关）
rabbitmqctl trace_on
```

## 十一、常见故障排查表

| 现象 | 可能原因 | 排查命令 | 解决办法 |
| --- | --- | --- | --- |
| 队列 Ready 持续增长 | 消费者太慢/挂了、prefetch 太低 | `rabbitmqctl list_queues` 看 messages_ready | 扩容消费者、调大 prefetch、查消费线程池 |
| Unacked 一直涨 | 消费者不 ACK / 处理卡死 / 死循环 | list_queues 看 messages_unacknowledged | 检查 ACK 逻辑、加超时、加死信兜底 |
| Channel 数暴涨 | 每发消息 new Channel 不关 | `rabbitmqctl list_channels` | 复用 Channel（用连接池/模板） |
| 连接频繁断开 | 心跳超时、NAT 回收、LB idle 太短 | 客户端日志 `heartbeat timeout`/`socket closed` | 调小 `requested_heartbeat`、调大 LB idle |
| 生产者被阻塞（flow control） | 触发内存/磁盘水位 alarm | UI 看 `mem_alarm`/`disk_free_limit` | 清堆积、加磁盘、加节点、调水位 |
| 消息莫名其妙消失 | 路由失败未处理 return、TTL 过期无 DLX | 看 `returnsCallback` 日志、查 DLX | 开 `publisher-returns`+`mandatory`、配 DLX |
| 管理界面打不开 | 管理插件没启 / 端口映射错 / 节点挂 | `rabbitmq-plugins list`、`docker ps` | 启用 `rabbitmq_management`、检查端口 |
| 磁盘打满 | 队列无限堆积、消息体过大 | `df -h`、list_queues messages | 设 max-length/TTL、清理、扩磁盘 |
| `PRECONDITION_FAILED 406` | 代码声明参数与已存在队列不一致 | 对比代码与 UI 队列参数 | 删旧队列重建，或让参数一致 |
| 集群节点显示 down | 网络分区、cookie 不一致、端口不通 | `rabbitmqctl cluster_status` | 检查网络/防火墙、统一 Erlang cookie |
| 镜像队列高可用"没生效" | 用的是 4.x（已移除镜像） | 查版本 `rabbitmqctl version` | 改用 Quorum Queue，移除 `ha-*` policy |

## 本篇小结

- **单机 RabbitMQ 有宕机即不可用、内存上限、无法扩展三大痛点**，生产必须上集群。
- **普通集群只同步元数据、不复制消息体**，队列创建节点挂了消息就没——它不等于高可用队列。
- **Classic Queue Mirroring 已在 RabbitMQ 4.0 彻底移除**（2021 起废弃），新项目改用 **Quorum Queue / Stream**，升级前须先迁移。
- **Quorum Queue 基于 Raft，需多数派确认写入**，强一致、自动选主、不丢消息；副本数用 **3 或 5（奇数）**，偶数无意义。
- **Quorum 限制**：不支持 non-durable、`exclusive`、消息优先级、全局 QoS、`reject-publish-dlx` 等；消息 TTL 自 3.10 起支持；**4.0 默认重投上限 20**。
- **Stream** 是 append-only 日志，支持按 offset 重复消费与长期保留，适合审计、大 fanout、回放。
- **负载均衡**：客户端填多地址做故障转移；服务端用 HAProxy/Nginx stream（TCP 层）做 VIP + 健康检查；注意空闲超时与心跳配合。
- **网络分区**三种策略：`ignore`（默认、会丢）、`pause_minority`（**推荐，少数派自杀保一致**）、`autoheal`（自动恢复但丢数据）。
- **监控**：Management UI + HTTP API + `rabbitmq_prometheus` + Grafana（官方 Dashboard ID 10991）；重点盯 Ready/Unacked/速率/内存/磁盘/channel。
- **内存水位**默认 0.4 触发 `mem_alarm` 阻塞生产者；**磁盘水位**默认 50MB（建议设内存 1.0~2.0 倍），到限阻塞。
- **上线 checklist**：复用 Connection/Channel、开 `publisher-returns`+`mandatory`、心跳调小、消息控制在 1MB 以内、prefetch 别设 0、设队列上限防堆积。

## 参考链接

- RabbitMQ 4.0 新特性（含镜像队列移除）：<https://blog.rabbitmq.com/docs/4.0/whats-new>
- 经典队列镜像（已废弃）官方说明：<https://www.rabbitmq.com/docs/4.1/ha>
- Quorum Queue 官方文档：<https://www.rabbitmq.com/docs/quorum-queues>
- Stream Queue 官方文档：<https://www.rabbitmq.com/docs/streams>
- 集群搭建与 `rabbitmqctl`：<https://www.rabbitmq.com/docs/clustering>
- 网络分区处理策略：<https://www.rabbitmq.com/docs/partitions>
- 内存与磁盘水位：<https://www.rabbitmq.com/docs/memory>
- 监控（Prometheus 插件）：<https://www.rabbitmq.com/docs/prometheus>

下一篇 → [01 MQ 入门与环境搭建](/java/middleware/rabbitmq/overview)（RabbitMQ 篇到此结束）
