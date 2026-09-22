# 04 分布式锁

> 本篇导读：单体时代一把 `synchronized` 就能锁住资源，可一旦订单服务部署了 3 个实例，`synchronized` 就管不住跨 JVM 的并发了——三个实例各锁各的，库存照样被超卖。本文从"为什么要多实例锁"讲起，对比数据库 / Redis / Zookeeper 三种实现，讲清 Redisson 看门狗、ZK 临时节点、Redlock 争议，最后给出选型与踩坑清单。

## 一、为什么需要分布式锁

先看一个经典翻车现场：**限量秒杀，库存只剩 1 件，却超卖成 3 件**。

```text
单体时代（一个 JVM）：
  synchronized(lock) { if (stock > 0) stock--; }
  同一时刻只有一个线程能进，安全。✅

多实例部署（3 个 JVM）：
  实例A 的 synchronized 只锁住实例A 内的线程
  实例B、实例C 完全不知道 A 锁了 → 三个实例同时读到 stock=1
  → 三个都扣 → 库存变 -2，超卖！❌
```

`synchronized` / `ReentrantLock` 只在**单个 JVM 内部**有效，管不了跨进程、跨机器的并发。**分布式锁**就是要把"锁"放到一个所有实例都能访问的**公共的地方**（数据库 / Redis / Zookeeper），谁拿到这把公共锁，谁才能操作共享资源。

## 二、分布式锁要满足的条件

一个合格的分布式锁至少要满足：

- **互斥性**：同一时刻只能有一个客户端持有锁。
- **防死锁**：必须有过期时间（TTL），即使持有锁的进程崩溃，锁也会自动释放，不会永远卡死。
- **解铃还须系铃人**：只能释放自己加的锁，不能把别人的锁删了（否则 A 的锁被 B 删掉，互斥就废了）。
- **可重入**（可选但推荐）：同一个线程可以多次获取同一把锁而不会死锁自己。
- **高可用 / 高性能**：加锁解锁要快，且锁服务自身不能成为单点。

## 三、三种实现方案对比

```text
方案          性能    可靠性   实现复杂度   可重入   死锁风险
--------------------------------------------------------------
数据库        低      中       简单        需自建   有(需清理)
Redis        高      中高     中等        Redisson支持 低(有过期)
Zookeeper    中      高       中等        Curator支持 低(临时节点)
```

- **数据库**：用唯一索引或 `SELECT ... FOR UPDATE` 行锁。
- **Redis**：`SET key value NX EX` + Lua 保证原子，详见 [Redis 篇第 06 章](../redis/lock)。
- **Zookeeper**：临时顺序节点，CP 系统，可靠性最高。

## 四、Redis 方案核心

演进过程（完整版见 Redis 篇，这里给要点）：

1. **`SETNX key value`**：key 不存在才设置（拿到锁）。但 `SETNX` 没有过期参数，要分两步设 TTL，非原子，有风险。
2. **`SET key value NX EX 30`**：一条命令同时设置"不存在才写"和"30 秒过期"，**原子**，这是正确写法。
3. **value 放唯一标识**（如 UUID + 线程ID）：释放时先判断 value 是不是自己的，再删除——但"判断 + 删除"两步也要原子，所以用 **Lua 脚本**。
4. **看门狗续期**：业务没执行完锁就快过期了？后台线程定期续期（Redisson 自动做）。
5. **Hash 实现可重入**：锁的值用 Hash 记录持有者和重入次数。

```lua
-- 释放锁的 Lua：先比对 value，匹配才删除（保证原子，不会删别人的锁）
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

本篇只讲概览，完整演进与代码见 [Redis 篇第 06 章](../redis/lock)。

## 五、Redisson

Redisson 是 Redis 官方推荐的 Java 客户端，把分布式锁封装得极其好用，核心是**看门狗（Watchdog）自动续期**。

```java
package com.canoe.cloud.lock;

import org.redisson.Redisson;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;

// 最小可用示例：用 Redisson 加锁扣库存
public class RedissonLockDemo {

    public static void main(String[] args) throws InterruptedException {
        Config config = new Config();
        config.useSingleServer().setAddress("redis://127.0.0.1:6379");
        RedissonClient redisson = Redisson.create(config);

        RLock lock = redisson.getLock("stock:product:1001");
        try {
            // 不传 leaseTime → 启用看门狗：默认 30 秒过期，每 10 秒自动续期
            lock.lock();
            System.out.println("拿到锁，开始扣库存...");
            // 这里写扣库存业务逻辑
            Thread.sleep(1000);
            System.out.println("扣库存完成");
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock(); // 必须在 finally 释放
            }
        }
        redisson.shutdown();
    }
}
```

**看门狗要点**：`lock()` 不传 `leaseTime` 才启用，默认锁 30 秒过期、每 10 秒续期；一旦显式传了 `leaseTime`，看门狗就**不生效**，锁到点直接释放。

## 六、Zookeeper 方案

ZK 用**临时顺序节点**实现锁，天然防死锁：

```text
1. 客户端在 /locks/order 下创建临时顺序节点 /locks/order/seq-0001
2. 判断自己是不是序号最小的节点
   - 是 → 拿到锁
   - 否 → 监听前一个节点（seq-0000）的删除事件
3. 前一个节点释放（会话断开或主动删除）→ 触发监听 → 自己变成最小 → 拿锁
```

**为什么好**：临时节点在客户端会话断开时**自动删除**，天然防死锁（不用怕进程崩溃不释放）；只监听前一个节点，**避免羊群效应**（所有节点一起抢）。

```java
package com.canoe.cloud.lock;

import org.apache.curator.framework.CuratorFramework;
import org.apache.curator.framework.CuratorFrameworkFactory;
import org.apache.curator.framework.recipes.locks.InterProcessMutex;
import org.apache.curator.retry.ExponentialBackoffRetry;

// Curator 的 InterProcessMutex 一把可重入分布式锁
public class ZkLockDemo {

    public static void main(String[] args) throws Exception {
        CuratorFramework client = CuratorFrameworkFactory.builder()
                .connectString("127.0.0.1:2181")
                .retryPolicy(new ExponentialBackoffRetry(1000, 3))
                .build();
        client.start();

        InterProcessMutex lock = new InterProcessMutex(client, "/locks/order");
        try {
            lock.acquire(); // 阻塞直到拿到锁
            System.out.println("拿到 ZK 锁，处理订单...");
            Thread.sleep(1000);
        } finally {
            lock.release();
            client.close();
        }
    }
}
```

ZK 是 **CP 系统**，可靠性高于 Redis（不会因为主从切换丢锁）。代价是性能比 Redis 低，且要维护 ZK 集群。

## 七、数据库方案

两种常见写法：

**① 唯一索引**：建一张锁表，对某业务键加唯一索引，插入成功即获锁，删除即释放。

```java
package com.canoe.cloud.lock;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

// 唯一索引方式：插入成功 = 获锁
public class DbLockDemo {

    public static boolean tryLock(Connection conn, String lockKey) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO lock_table(lock_key, owner, expire_at) VALUES (?, ?, ?)")) {
            ps.setString(1, lockKey);
            ps.setString(2, "node-1");
            ps.setLong(3, System.currentTimeMillis() + 30000);
            ps.executeUpdate();
            return true;
        } catch (SQLException e) {
            // 唯一索引冲突 = 别人已持锁
            return false;
        }
    }

    public static void main(String[] args) throws Exception {
        try (Connection conn = DriverManager.getConnection(
                "jdbc:mysql://localhost:3306/test", "root", "root")) {
            boolean ok = tryLock(conn, "order:1001");
            System.out.println(ok ? "获锁成功" : "锁被占用");
        }
    }
}
```

**② `SELECT ... FOR UPDATE`**：对某一行加行锁，事务提交才释放。注意**锁住的是哪张表、事务别开太长**，否则会拖垮数据库。

**缺点**：性能差、对数据库有压力，高并发场景不推荐作为主方案。

## 八、Redlock

Redlock 是 Redis 作者 antirez 提出的**多节点 Redlock 算法**：在 N（通常 5）个**独立** Redis 节点上加锁，超过半数（大于 N/2）成功、且总耗时小于锁的 TTL，才算加锁成功。

```text
5 个独立 Redis 节点
客户端向 5 个节点依次请求加锁（带总超时）
→ 至少 3 个成功 且 总耗时 < TTL  → 加锁成功
→ 否则 向所有节点发起释放
```

**争议很大**：Martin Kleppmann（剑桥学者）公开指出两大问题——① GC 停顿或网络延迟可能导致锁已过期但持有者还以为自己持有；② 算法依赖"所有节点时钟一致"的假设，而时钟在分布式下并不可靠。antirez 随后反驳，但社区至今没有定论。

**现实**：Redisson 的 `RedissonRedLock` 已**标记弃用（deprecated）**。绝大多数业务用单 Redis + 看门狗已足够；真要强一致，不如用 Zookeeper/etcd 或数据库串行化。

## 九、常见问题与坑

一份实战踩坑清单，建议和 Redis 篇对照看：

- **锁粒度太大**：锁住整个方法而不是具体的 `orderId`，并发度被严重拉低。锁的 key 要细到业务资源级别。
- **忘了 `finally` 释放**：异常路径下锁永远不释放 → 死锁。释放必须放 `finally`。
- **超时时间拍脑袋**：设太短业务没跑完锁就没了；设太长故障恢复慢。配合看门狗才是正解。
- **锁写在事务里**：先释放锁，后提交事务 → 锁没了别的线程进来读到"未提交"的数据，脏读。**正确顺序：事务提交后再释放锁**，或锁范围包含整个事务。
- **主从切换丢锁**：Redis 主从异步复制，主挂了从还没复制这把锁就升级为主 → 锁丢失。这是 CP 与 AP 的老矛盾。
- **看门狗线程没停**：Redisson 客户端 `shutdown()` 要调用，否则续期线程泄漏。

## 十、选型建议

直接给结论：

```text
场景                              推荐方案
--------------------------------------------------
追求性能、能容忍极端失效          Redis（Redisson 看门狗）
追求强一致、并发不高              Zookeeper / etcd
简单低频、不想引入中间件          数据库唯一索引
真正强一致的临界资源              数据库锁 或 队列串行化
```

最后一句忠告：**分布式锁不是万能的，它解决的是"并发"问题；涉及钱和库存的强一致，优先考虑"数据库事务 + 唯一约束 + 队列串行化"更稳妥**。锁是优化手段，不是正确性保证。

## 本篇小结

- **多实例部署** 下 `synchronized` 失效，需要公共锁服务做分布式锁。
- **合格锁** 必须满足互斥、防死锁（TTL）、解铃系铃人、可重入。
- **Redis 锁** 用 `SET key value NX EX` + Lua 释放，原子性最关键。
- **Redisson 看门狗** 在 `lock()` 不传 leaseTime 时自动续期（30s/10s）。
- **Zookeeper** 用临时顺序节点，天然防死锁、避免羊群效应，可靠性最高。
- **数据库锁** 有唯一索引和 `FOR UPDATE` 两种，性能差不建议高并发用。
- **Redlock** 多节点多数派加锁，但有 GC/时钟争议，Redisson 已弃用。
- **锁必须放 `finally` 释放**，否则异常即死锁。
- **锁不要写在事务里** 先释放后提交会导致脏读。
- **锁粒度** 要细到业务资源（如 orderId）而非整个方法。
- **选型**：高性能用 Redis，强一致用 ZK，低频用数据库。

## 参考链接

- [Redis 官方：SETNX 与分布式锁](https://redis.io/docs/latest/commands/set/)
- [Redisson 分布式锁文档](https://github.com/redisson/redisson/wiki/8.-Distributed-locks-and-synchronizers)
- [Zookeeper 官方文档](https://zookeeper.apache.org/doc/current/)
- [Curator Recipes：分布式锁](https://curator.apache.org/docs/curator-recipes/)
- [Martin Kleppmann：How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [antirez：Is Redlock safe?](https://antirez.com/news/101)
- [美团技术团队：分布式锁实践](https://tech.meituan.com/)
- [阿里中间件：分布式锁方案](https://developer.aliyun.com/)

下一篇 → [05 分布式 ID](/java/cloud/distribute-id)
