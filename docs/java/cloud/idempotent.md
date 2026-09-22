# 06 接口幂等性

> 本篇导读：网络超时、用户手抖连点、MQ 重复投递——在分布式世界里，"同一个请求来了两次"不是异常，而是常态。幂等性就是让"执行一次"和"执行多次"效果完全一样。本文从定义讲起，逐个拆解唯一索引、乐观锁、状态机、Token、去重表等方案，并给出 MQ 消费与 HTTP 方法的实战要点。

## 一、什么是幂等

数学上，幂等指 `f(f(x)) = f(x)`。在接口里：**同一请求执行多次与执行一次的效果相同**。

举正反例（非常重要，面试常考）：

```text
SELECT * FROM user WHERE id=1;          → 天然幂等（读不改数据）
UPDATE user SET status=1 WHERE id=1;    → 幂等（无论执行几次，结果都是 status=1）
UPDATE stock SET stock=stock-1 ...      → 不幂等（每执行一次少一个）
INSERT INTO order(...)                  → 不幂等（无唯一约束会插多条）
```

一句话：**读操作天然幂等；写操作里"赋值型"幂等，"累加/插入型"不幂等**。

## 二、为什么要幂等

重复请求在分布式环境里是**常态**，来源很多：

- **网络超时重试**：调用方等不及响应，按重试策略再发一次。
- **用户重复点击**：抢购时用户疯狂点"提交订单"按钮。
- **消息队列重复投递**：MQ 通常是"至少一次（at-least-once）"语义，消费者处理完还没来得及 ACK 就宕机，消息会被重新投递。
- **前端重复提交**：表单没做防重，用户点了两次。
- **RPC 框架重试**：Feign / Dubbo 等客户端默认会在失败后重试。

所以**幂等不是"锦上添花"，而是分布式系统的基本生存技能**。

## 三、方案一：数据库唯一索引

最简单可靠的方案，专门用于**插入类**操作。

建表时给业务唯一键加唯一索引：

```sql
CREATE TABLE `order` (
    id          BIGINT PRIMARY KEY,
    order_no    VARCHAR(32) NOT NULL,
    user_id     BIGINT NOT NULL,
    UNIQUE KEY uk_biz_no (order_no)   -- 订单号唯一，重复插入直接报错
) ENGINE=InnoDB;
```

代码里捕获重复键异常，当作"已经处理过"：

```java
package com.canoe.cloud.idempotent;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

// 唯一索引防重复插入（示意）
public class UniqueIndexDemo {

    public static String createOrder(Connection conn, String orderNo, long userId) {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO `order`(id, order_no, user_id) VALUES (?, ?, ?)")) {
            ps.setLong(1, System.currentTimeMillis());
            ps.setString(2, orderNo);
            ps.setLong(3, userId);
            ps.executeUpdate();
            return "下单成功";
        } catch (SQLException e) {
            // 唯一索引冲突 = 已经下过单了，直接返回成功即可（幂等）
            if (e.getMessage() != null && e.getMessage().contains("Duplicate")) {
                return "订单已存在，无需重复创建";
            }
            throw new RuntimeException(e);
        }
    }

    public static void main(String[] args) throws Exception {
        try (Connection conn = DriverManager.getConnection(
                "jdbc:mysql://localhost:3306/test", "root", "root")) {
            System.out.println(createOrder(conn, "NO20240101", 1001));
            System.out.println(createOrder(conn, "NO20240101", 1001)); // 重复
        }
    }
}
```

**适用**：订单创建、用户注册等"不能重复插入"的场景。这是最后一道防线，强烈建议所有写表都加唯一约束。

## 四、方案二：乐观锁版本号

针对**更新类**操作，靠版本号 + 影响行数判断是否真的改了。

```sql
UPDATE stock
SET stock = stock - 1, version = version + 1
WHERE id = ? AND version = ?;
```

如果返回影响行数 = 1，说明本次更新成功；如果 = 0，说明版本已经被别人改过（或已扣过），**不再重复扣**。

```java
package com.canoe.cloud.idempotent;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

// 乐观锁：版本号 + 影响行数判断是否生效
public class OptimisticLockDemo {

    public static boolean decrease(Connection conn, long id, int oldVersion) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE stock SET stock = stock - 1, version = version + 1 "
                + "WHERE id = ? AND version = ?")) {
            ps.setLong(1, id);
            ps.setInt(2, oldVersion);
            return ps.executeUpdate() == 1; // 只有 1 行受影响才算成功
        }
    }

    public static void main(String[] args) throws Exception {
        try (Connection conn = DriverManager.getConnection(
                "jdbc:mysql://localhost:3306/test", "root", "root")) {
            boolean ok = decrease(conn, 1L, 5);
            System.out.println(ok ? "扣减成功" : "已被处理，跳过（幂等）");
        }
    }
}
```

**ABA 问题**：值从 A→B→A，版本号机制能识别（版本变了），但如果只用"值相等"判断就有风险。用版本号（自增）即可规避。**适用**：库存扣减、余额变更等更新场景。

## 五、方案三：状态机

最符合业务语义的方式：**业务状态只能按预定方向流转**。

```text
订单状态机：
  待支付 → 已支付 → 已发货 → 已完成
  (不能 已支付 → 待支付，也不能 待支付 → 已完成)
```

前端重复点支付，第二次支付时订单已是"已支付"，SQL 直接不匹配（影响行数 0），天然幂等：

```sql
UPDATE `order` SET status = '已支付' WHERE order_no = ? AND status = '待支付';
```

```java
package com.canoe.cloud.idempotent;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

// 状态机：只有处于"待支付"的订单才能被改为"已支付"
public class StateMachineDemo {

    public static boolean pay(Connection conn, String orderNo) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE `order` SET status = '已支付' "
                + "WHERE order_no = ? AND status = '待支付'")) {
            ps.setString(1, orderNo);
            return ps.executeUpdate() == 1;
        }
    }

    public static void main(String[] args) throws Exception {
        try (Connection conn = DriverManager.getConnection(
                "jdbc:mysql://localhost:3306/test", "root", "root")) {
            boolean ok = pay(conn, "NO20240101");
            System.out.println(ok ? "支付成功" : "订单非待支付状态，已处理过");
        }
    }
}
```

**优势**：不需要额外字段，直接用业务语义防重，最推荐用于"有明确状态流转"的业务。

## 六、方案四：Token 机制

专治**用户重复点击 / 重复提交表单**。核心：**先发令牌，提交时销毁令牌，且销毁必须原子**。

```text
1. 进入下单页 → 服务端生成一个 token，存 Redis（如 token:abc123=1），返回前端
2. 用户提交 → 请求带 token=abc123
3. 服务端用 Lua/SETNX 原子地"判断存在并删除"
   - 删除成功 → 继续处理业务
   - 删除失败（token 已没）→ 说明是重复提交，直接拒绝
4. 注意：必须是"删除"成功才算数，不能是"get 判断 + del"两步（非原子会被并发绕过）
```

```lua
-- 原子校验并消费 token（防止并发下重复放行）
if redis.call("exists", KEYS[1]) == 1 then
    redis.call("del", KEYS[1])
    return 1
else
    return 0
end
```

```java
package com.canoe.cloud.idempotent;

import redis.clients.jedis.Jedis;

// Token 机制：原子消费令牌，防重复提交（示意）
public class TokenDemo {

    public static boolean submit(Jedis jedis, String token) {
        // 用 Lua 保证"判断+删除"原子
        String script = "if redis.call('exists', KEYS[1]) == 1 then "
                + "redis.call('del', KEYS[1]) return 1 else return 0 end";
        Object res = jedis.eval(script, 1, "token:" + token);
        return "1".equals(res.toString());
    }

    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("127.0.0.1", 6379)) {
            jedis.set("token:abc", "1");
            System.out.println("第一次提交：" + submit(jedis, "abc")); // true
            System.out.println("重复提交：" + submit(jedis, "abc"));   // false
        }
    }
}
```

## 七、方案五：分布式锁

以**相同业务唯一键**加锁，保证同一笔业务同一时刻只有一个请求在处理。

```text
下单请求 orderNo=NO123
  → 以 "lock:order:NO123" 加分布式锁
  → 拿到锁才处理，处理完释放
  → 重复请求拿不到锁，直接返回"处理中/已处理"
```

**与幂等的区别**：锁解决"并发"（同一时刻只一个），幂等解决"重复"（多次效果一样）。**两者要配合使用**——锁防并发、幂等兜底，双重保险。

## 八、方案六：去重表 / 唯一流水

把请求的唯一 ID 存一张去重表（带唯一索引）或 Redis（`SETNX`），处理前先"占坑"。

```java
package com.canoe.cloud.idempotent;

import redis.clients.jedis.Jedis;

// Redis SETNX 去重：请求唯一ID占坑，处理过就跳过
public class DedupDemo {

    public static boolean process(Jedis jedis, String requestId) {
        // SETNX：key 不存在才设置成功，返回 true = 第一次
        boolean first = jedis.setnx("dedup:" + requestId, "1") == 1L;
        if (!first) {
            return false; // 已经处理过
        }
        // 建议设置合理过期时间，或在业务成功后才保留（不删）
        jedis.expire("dedup:" + requestId, 24 * 60 * 60);
        return true;
    }

    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("127.0.0.1", 6379)) {
            System.out.println("第一次：" + process(jedis, "req-001")); // true
            System.out.println("重复：" + process(jedis, "req-001"));   // false
        }
    }
}
```

**陷阱**：如果业务**还没处理完就删了标记**，或者标记**过期太早**，会导致漏判（重复执行）或误判（正常请求被拒）。建议：**过期时间要长于业务最大处理时长，且尽量"业务成功后才保留标记（或不删）"**。

## 九、方案选型

```text
操作类型         推荐方案                备注
----------------------------------------------------------
插入类(创建订单)  数据库唯一索引         最后防线，必加
更新类(扣库存)    乐观锁 / 状态机         靠版本号或状态流转
前端重复提交      Token 机制             原子消费令牌
MQ 消费          去重表 + 业务状态判断    至少一次语义必做
跨服务调用        幂等键 + 下游幂等      请求里带 idempotentKey
```

**兜底铁律**：**无论如何都要在数据库层面加唯一约束**，这是最后一道、也是不可或缺的一道防线。上层方案是优化，唯一索引才是保命。

## 十、MQ 消费幂等

MQ 是"至少一次"投递，消费端**必须**幂等。完整套路：**消息 ID + Redis 去重 + 业务状态判断**。

```java
package com.canoe.cloud.idempotent;

import redis.clients.jedis.Jedis;

// MQ 消费幂等：消息ID去重 + 业务状态兜底
public class MqConsumerDemo {

    public static void onMessage(Jedis jedis, String msgId, String orderNo) {
        // 1. 消息ID去重
        if (jedis.setnx("mq:dedup:" + msgId, "1") != 1L) {
            System.out.println("消息 " + msgId + " 已消费，跳过");
            return;
        }
        // 2. 业务状态判断（双重保险）
        String status = jedis.get("order:status:" + orderNo);
        if ("已支付".equals(status)) {
            System.out.println("订单 " + orderNo + " 已支付，跳过");
            return;
        }
        // 3. 真正处理业务
        jedis.set("order:status:" + orderNo, "已支付");
        System.out.println("处理支付消息：" + msgId);
    }

    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("127.0.0.1", 6379)) {
            onMessage(jedis, "m1", "NO2024");
            onMessage(jedis, "m1", "NO2024"); // 重复投递
        }
    }
}
```

## 十一、HTTP 方法的幂等性

RESTful 设计里，方法语义本身就规定了幂等性：

```text
方法      幂等?    说明
GET      是       只读，天然幂等
PUT      是       整体更新，更新多次结果一样
DELETE   是       删除一次和删多次，结果都是"没了"
POST     否       新增资源，每次都新建一个（不幂等）
```

**实践意义**：前端重试时，对 GET/PUT/DELETE 可以放心重试；对 POST（如提交订单）必须配合 Token 或业务幂等键，否则重试就会重复下单。

## 本篇小结

- **幂等** 指同一请求执行多次与一次效果相同，读操作天然幂等。
- **重复请求是常态**：超时重试、重复点击、MQ 重投、RPC 重试。
- **唯一索引** 最简单可靠，用于插入类防重复，是最后防线。
- **乐观锁** 靠版本号 + 影响行数，适合更新类防重复扣减。
- **状态机** 用状态单向流转防重，最贴合业务语义。
- **Token 机制** 原子消费令牌，专治前端重复提交。
- **分布式锁** 防并发，幂等防重复，两者配合使用。
- **去重表/Redis** 用唯一 ID 占坑，注意过期时间要够长。
- **MQ 消费** 必须幂等，靠消息ID去重 + 业务状态双保险。
- **POST 不幂等**，重试下单必须配合幂等设计。
- **数据库唯一约束** 是不管怎样都要加的兜底防线。

## 参考链接

- [幂等性（维基百科）](https://en.wikipedia.org/wiki/Idempotence)
- [HTTP 方法语义（MDN）](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Methods)
- [Redis SETNX 命令](https://redis.io/docs/latest/commands/setnx/)
- [AWS：幂等性设计](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- [美团技术团队：分布式系统幂等设计](https://tech.meituan.com/)
- [阿里中间件：消息幂等消费](https://developer.aliyun.com/)
- [Spring 官方：@Retryable 与重试](https://spring.io/projects/spring-retry)
- [RocketMQ 消费幂等文档](https://rocketmq.apache.org/zh/docs/featureBehavior/06consumermessage/)

下一篇 → [07 限流熔断降级](/java/cloud/rate-limit)
