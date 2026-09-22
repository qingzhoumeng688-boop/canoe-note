# 07 Redisson 全解

> 本篇导读：前面 6 章我们把 Redis 的「数据结构、客户端、持久化、主从哨兵集群、缓存设计」都过了一遍。但到了真实项目里，你会发现一个尴尬的事——Jedis/Lettuce 只是「把 Redis 命令封装成 Java 方法」，分布式锁、限流、延迟队列、原子计数器这些「高级分布式原语」还得自己用 `SET NX` + Lua 手搓，稍不注意就是生产事故。Redisson 就是来填这个坑的：它把 JDK 里你最熟悉的 `Lock`/`Map`/`Queue`/`Semaphore` 直接「搬」到分布式环境，让你像写本地代码一样写分布式代码。本篇是 Redis 专栏的**重点章**，我们一个 API 一个 API 拆开讲，配可运行代码，重点突破分布式锁家族、延迟队列和令牌桶限流。

## 本篇要解决的问题

- Redisson 到底是个啥？它和 Jedis/Lettuce 到底啥关系？能不能共存？
- Spring Boot 怎么接？Maven 依赖怎么写才不踩版本坑？
- 分布式锁有七八种，到底该用哪个？看门狗（watchdog）到底是什么鬼，为什么我的锁会「自动续期」？
- 订单 30 分钟未支付自动关闭，怎么用 Redisson 的延迟队列实现？
- 接口限流、防缓存穿透、秒杀扣库存，这些高频场景 Redisson 怎么一把梭？
- Redisson 在生产上有哪些坑？序列化、连接池、看门狗、重复 Bean 冲突怎么处理？

::: tip 一句话定位
Jedis/Lettuce 是「Redis 命令的 Java 翻译官」；Redisson 是「在 Redis 之上实现的分布式 Java 对象与服务框架」。前者给你命令，后者直接给你「对象」。
:::

## 一、Redisson 是什么

### 1.1 先打个比方

假设 Redis 是一间「超级仓库」，里面有很多格子（key-value）。

- **Jedis/Lettuce** 像是给了你一把钥匙和一张「取货/存货」的清单（命令）。你要锁货（分布式锁）？自己照着清单写一堆 `SET key uuid NX PX 30000` 再配一段 Lua 脚本。能用，但每次都得自己写、自己测、自己背锅。
- **Redisson** 是直接给你配好了一整套「仓库管理系统」：你要一把分布式锁？`redisson.getLock("order:1")` 一句话拿到一个 `RLock`，它内部已经帮你把 `SET NX`、看门狗续期、Lua 释放全写好了。你要一个分布式队列？`redisson.getBlockingQueue("queue")` 直接拿到 `RBlockingQueue`，和本地 `java.util.concurrent.BlockingQueue` 用法一模一样。

::: tip 一句话记住
Redisson = 「Redis + 一套实现好的 Java 并发/集合/服务对象」。它**不是**把 Jedis 包了一层，而是自己基于 **Netty** 写了连接层，把 JDK 的并发工具类在 Redis 上重新实现了一遍。
:::

### 1.2 与 Jedis / Lettuce 的关系对比表

| 对比维度 | Jedis | Lettuce | Redisson |
| --- | --- | --- | --- |
| 底层连接模型 | 直连 / 连接池（BIO） | Netty（NIO，天然线程安全） | Netty（NIO，自带连接层） |
| 定位 | 最基础的 Redis 命令客户端 | Spring Data Redis 默认客户端 | 分布式对象与服务框架 |
| 分布式锁 | 需自己用 `SET NX` + Lua 写 | 需自己写 | 内置 `RLock`，开箱即用 |
| 分布式集合 / 队列 / 信号量 | 不支持，需自己封装 | 不支持，需自己封装 | 内置 `RMap`/`RBlockingQueue`/`RSemaphore` 等 60+ 对象 |
| 是否基于对方封装 | 否 | 否 | 否（三者独立实现，Redisson 自带的 Netty 层） |
| 与 Spring 集成 | 通过 `spring-boot-starter-data-redis` | 同上（默认） | `redisson-spring-boot-starter` |
| 适合干的事 | 简单读写、熟悉命令的人 | 高并发读写、响应式 | 分布式锁、限流、延迟队列、分布式集合 |

::: warning 一个常见误解
「Redisson 是基于 Lettuce 封装的吧？」——**不是**。Redisson 自己实现了 Netty 通信层，和 Lettuce 是两条独立的线。所以你项目里可以同时有 `spring-boot-starter-data-redis`（底层 Lettuce）和 `redisson-spring-boot-starter`，但会有「两个客户端、两套连接」的问题，后面 2.4 节专门讲怎么处理。
:::

### 1.3 JDK 接口 → Redisson 分布式实现 对照表

这是 Redisson 最爽的地方：**API 名字和 JDK 几乎一一对应**，你本地怎么写并发代码，分布式里就怎么写。

| JDK 本地接口 | Redisson 分布式实现 | 一句话用途 |
| --- | --- | --- |
| `java.util.concurrent.locks.Lock` | `RLock` | 分布式可重入锁 |
| `java.util.concurrent.locks.ReadWriteLock` | `RReadWriteLock` | 读写锁（缓存重建神器） |
| `java.util.Map` | `RMap` | 分布式 Map |
| `java.util.Map`（带单条 TTL） | `RMapCache` | 带过期时间的分布式 Map |
| `java.util.concurrent.BlockingQueue` | `RBlockingQueue` | 分布式阻塞队列（简易 MQ） |
| `java.util.concurrent.DelayQueue` | `RDelayedQueue` | 分布式延迟队列（订单关单） |
| `java.util.concurrent.Semaphore` | `RSemaphore` | 分布式信号量（限流/许可证） |
| `java.util.concurrent.CountDownLatch` | `RCountDownLatch` | 分布式闭锁（多任务汇合） |
| `java.util.concurrent.atomic.AtomicLong` | `RAtomicLong` | 分布式原子计数器 / 全局 ID |
| `java.util.Set` | `RSet` | 分布式 Set |
| `java.util.List` | `RList` | 分布式 List |
| `java.util.SortedSet`（带分值） | `RScoredSortedSet` | 分布式有序集合（排行榜） |

::: tip 学习心法
你**不需要背**这些类。记住一条规律：「JDK 里那个并发/集合工具类，前面加个 `R` 就是 Redisson 的分布式版」。看到 `RLock` 就当 `Lock` 用，看到 `RMap` 就当 `Map` 用，方法名几乎一致。
:::

## 二、接入 Spring Boot

### 2.1 Maven 依赖（版本号务必对齐！）

这是**最容易踩坑的一步**。Redisson 的 `redisson-spring-boot-starter` 版本必须和你的 **Spring Boot 大版本**对齐，否则启动直接报错。

::: danger 版本红线（已联网核对官方 README / Maven Central）
经核对 Redisson 官方文档与 Maven Central（截至本文撰写时，Redisson 主线最新为 `4.7.0`）：
- `redisson-spring-boot-starter` **4.x 系列对应的是 Spring Boot 4.x**；
- **Spring Boot 3.5.x 应使用 3.5x 系列**，即 `3.52.0`（内部依赖 `redisson-spring-data-35`）；
- 3.x 系列（如 `3.51.0`~`3.52.0`）对应 Spring Boot 3.x；
- 2.x 系列对应 Spring Boot 2.x。

本文统一技术基线为 **Spring Boot 3.5.5 + JDK 17**，因此锁定 **`3.52.0`**。**starter 版本号与 Spring Boot 版本的精确对应关系，请以官方 README（github.com/redisson/redisson）的兼容矩阵为准**，不要盲目追最新版，否则会出现 `RedissonAutoConfiguration` 类找不到或 `NoSuchMethodError`。
:::

完整的 `pom.xml`（Spring Boot parent 3.5.5，用 `<properties>` 统一管理版本）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <!-- 1) 父工程：统一 Spring Boot 3.5.5 的依赖与插件版本 -->
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.canoe</groupId>
    <artifactId>canoe-redis-redisson</artifactId>
    <version>1.0.0</version>
    <name>canoe-redis-redisson</name>

    <properties>
        <!-- 2) 统一 JDK 版本 -->
        <java.version>17</java.version>
        <!-- 3) 集中管理第三方依赖版本，避免散落各处 -->
        <redisson.version>3.52.0</redisson.version>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
        <!-- Web 层，用于后面的 Controller 实战 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- AOP，用于后面的 @RateLimit 注解 + 切面限流实战 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-aop</artifactId>
        </dependency>

        <!-- 核心：Redisson Spring Boot Starter（社区开源版，已包含 redisson 与 Netty） -->
        <dependency>
            <groupId>org.redisson</groupId>
            <artifactId>redisson-spring-boot-starter</artifactId>
            <version>${redisson.version}</version>
        </dependency>

        <!-- Lombok，减少样板代码（可选但强烈推荐） -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
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
            </plugin>
        </plugins>
    </build>
</project>
```

::: warning 不要同时引 `redisson` 和 `redisson-spring-boot-starter`
`redisson-spring-boot-starter` 内部已经传递依赖了 `redisson` 核心包。如果你自己再单独引一个不同版本的 `redisson`，极易造成版本冲突（`NoSuchMethodError` / `ClassNotFoundException`）。只引 starter 即可。
:::

### 2.2 三种配置方式

Redisson 接 Spring Boot 有三条路，按「懒 → 可控」依次介绍。

#### a) 复用 `spring.data.redis.*`（最省事，推荐起步）

`redisson-spring-boot-starter` 会自动读取 Spring Boot 的 Redis 配置（`spring.data.redis.host`、`port`、`password` 等），**什么都不用额外配**，直接就有 `RedissonClient` Bean 了。

```yaml
spring:
  data:
    redis:
      host: 127.0.0.1        # Redis 主机
      port: 6379             # 端口
      password: 123456       # 密码（没有就删掉这行）
      database: 0            # 用第 0 号库
      timeout: 3000ms        # 命令执行超时（毫秒）
      connect-timeout: 5000ms # 连接建立超时
```

有了上面这段，`@Autowired RedissonClient redisson` 就能直接用了，starter 帮你建好连接。

#### b) `spring.redis.redisson.config` 内联 YAML（最灵活，推荐生产）

当你要连「主从 / 哨兵 / 集群」或要调连接池、看门狗等参数时，用这种方式。下面给四种拓扑的完整示例，**生产只用其中一种**。

单节点（single）：

```yaml
spring:
  redis:
    redisson:
      config: |
        singleServerConfig:
          address: "redis://127.0.0.1:6379"
          password: "123456"
          database: 0
          connectionPoolSize: 64            # 连接池最大连接数
          connectionMinimumIdleSize: 24     # 连接池最小空闲连接
          idleConnectionTimeout: 10000
          connectTimeout: 10000
          timeout: 3000
          retryAttempts: 3                   # 命令失败重试次数
          retryInterval: 1500                # 重试间隔（毫秒）
          pingConnectionInterval: 0         # 定期 PING 间隔，0 表示关闭
        threads: 16                          # 业务线程池大小
        nettyThreads: 32                     # Netty 线程池大小
        codec: !<org.redisson.codec.JsonJacksonCodec>  # 默认 JDK 序列化，生产建议改 JsonJacksonCodec
```

主从（master-slave）：

```yaml
spring:
  redis:
    redisson:
      config: |
        masterSlaveServersConfig:
          masterAddress: "redis://127.0.0.1:6379"
          slaveAddresses:
            - "redis://127.0.0.1:6380"
            - "redis://127.0.0.1:6381"
          password: "123456"
          database: 0
          readMode: "SLAVE"          # 读走从节点
          subscriptionMode: "SLAVE"
          slaveConnectionPoolSize: 64
          masterConnectionPoolSize: 64
```

哨兵（sentinel）：

```yaml
spring:
  redis:
    redisson:
      config: |
        sentinelServersConfig:
          masterName: "mymaster"                # 哨兵配置里的主节点名
          sentinelAddresses:
            - "redis://127.0.0.1:26379"
            - "redis://127.0.0.1:26380"
            - "redis://127.0.0.1:26381"
          password: "123456"
          database: 0
          slaveConnectionPoolSize: 64
          masterConnectionPoolSize: 64
```

集群（cluster）：

```yaml
spring:
  redis:
    redisson:
      config: |
        clusterServersConfig:
          nodeAddresses:
            - "redis://127.0.0.1:7000"
            - "redis://127.0.0.1:7001"
            - "redis://127.0.0.1:7002"
          password: "123456"
          scanInterval: 2000              # 集群拓扑扫描间隔（毫秒）
          slaveConnectionPoolSize: 64
          masterConnectionPoolSize: 64
```

#### c) 编程式 `Config` + `@Bean`（最可控）

有些项目想完全自己掌控 `RedissonClient` 的创建（比如多数据源、动态地址），用 `Config` 硬编码：

```java
package com.canoe.redis;

import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RedissonConfig {

    /**
     * 手动编程式创建 RedissonClient（单节点示例）
     * 注意：RedissonClient 必须是单例，全局共用一个，不要每次 new
     */
    @Bean
    public RedissonClient redissonClient() {
        // 1) 新建配置对象
        Config config = new Config();
        // 2) 使用单节点模式，设置地址（格式必须是 redis:// 或 rediss:// 开头）
        config.useSingleServer()
                .setAddress("redis://127.0.0.1:6379")
                .setPassword("123456")
                .setDatabase(0)
                .setConnectionPoolSize(64)
                .setConnectionMinimumIdleSize(24);
        // 3) 用配置创建客户端并返回（Redisson.create 内部会做单例化封装）
        return Redisson.create(config);
    }
}
```

### 2.3 常用配置项表

| 配置项（YAML 路径） | 默认值 | 说明 / 生产建议 |
| --- | --- | --- |
| `singleServerConfig.address` | 无 | 节点地址，必须 `redis://ip:port` |
| `singleServerConfig.password` | null | 密码，生产必填 |
| `singleServerConfig.database` | 0 | 使用的 Redis 库 |
| `singleServerConfig.timeout` | 3000 | 命令等待响应超时（毫秒） |
| `singleServerConfig.connectTimeout` | 10000 | 建立连接超时（毫秒） |
| `singleServerConfig.retryAttempts` | 3 | 命令发送失败重试次数 |
| `singleServerConfig.retryInterval` | 1500 | 重试间隔（毫秒） |
| `singleServerConfig.connectionPoolSize` | 64 | 连接池最大连接数（按并发调） |
| `singleServerConfig.connectionMinimumIdleSize` | 24 | 连接池最小空闲连接 |
| `singleServerConfig.pingConnectionInterval` | 0 | 定期 PING 保活间隔，0=关闭 |
| `threads` | 16 | 业务执行线程池大小 |
| `nettyThreads` | 32 | Netty 事件循环线程数（建议保持默认或略增） |
| `lockWatchdogTimeout` | 30000 | 看门狗默认锁超时（毫秒），后面锁章节细讲 |

### 2.4 重要坑：与 `spring-boot-starter-data-redis` 共存

很多项目既要 `RedisTemplate`（操作原生数据结构），又要 Redisson（分布式锁）。坑在这里：

::: danger 共存冲突的真相
`redisson-spring-boot-starter` 会自动配置一个 `RedissonConnectionFactory`，并且**会顺手把 Spring 的 `RedisTemplate`/`StringRedisTemplate` 也给接管替换掉**（它注册了 `RedissonAutoConfiguration`，满足条件时把 `RedisConnectionFactory` 指向 Redisson 的实现）。于是：
- 如果你**同时**引了 `spring-boot-starter-data-redis` 和 `redisson-spring-boot-starter`，可能出现「两个 `RedisConnectionFactory` Bean」或「`RedisTemplate` 被 Redisson 版替换」的情况，行为不符合预期，甚至启动报 `NoUniqueBeanDefinitionException`。
:::

处理办法有两种：

**方案 A（推荐）：只引 `redisson-spring-boot-starter`**
既然 Redisson 的 starter 已经能自动提供 `RedisTemplate`（底层走 Redisson 的连接），你其实不需要再引 `spring-boot-starter-data-redis`。只用 Redisson 一家，最干净。

**方案 B：两个都要，且想保留原生 `RedisTemplate`**
在启动类排除 Redisson 对 `RedisTemplate` 的自动接管，并显式声明你要用哪个 `RedisConnectionFactory`：

```java
package com.canoe.redis;

import org.redisson.spring.starter.RedissonAutoConfigurationV2;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration;

@SpringBootApplication(exclude = {
        // 排除 Redisson 对 RedisTemplate 的自动配置，保留 spring-data-redis 的原生模板
        RedissonAutoConfigurationV2.class
})
public class RedisRedissonApplication {
    public static void main(String[] args) {
        SpringApplication.run(RedisRedissonApplication.class, args);
    }
}
```

::: warning 版本差异请以官方最新文档为准
排除类在不同 Spring Boot / Redisson 版本名字不同：Spring Boot 2.7+ 之前叫 `RedissonAutoConfigurationV2`，Spring Boot 4.x 叫 `RedissonAutoConfigurationV4`。本文基于 Spring Boot 3.5，使用 `RedissonAutoConfigurationV2`。若启动报「找不到该类」，请以你所用版本的 `org.redisson.spring.starter` 包下的实际类名（完整包路径 `org.redisson.spring.starter.RedissonAutoConfigurationV2`）为准。
:::

## 三、分布式锁家族（重点）

分布式锁是 Redisson 的「门面功能」，也是面试高频题。Redisson 提供了**七种**锁/同步器，下面逐个拆。

### 3.1 可重入锁 `RLock`

`RLock` 对应 JDK 的 `java.util.concurrent.locks.Lock`，是**最常用**的分布式锁。

**是什么**：同一把锁在同一个线程里可以多次 `lock()` 而不会被自己阻塞（可重入），底层用 Redis 的 Hash 结构存「锁名 → 线程标识:重入次数」。

**核心方法一览**（都在 `org.redisson.api.RLock` 里）：

| 方法 | 作用 |
| --- | --- |
| `getLock(key)`（来自 `RedissonClient`） | 获取一个名为 key 的锁对象 |
| `lock()` | 加锁，不传leaseTime 时启用看门狗 |
| `lock(leaseTime, unit)` | 加锁并指定固定leaseTime，到期强制释放（**无看门狗**） |
| `tryLock()` | 尝试加锁，立即返回 true/false |
| `tryLock(waitTime, leaseTime, unit)` | 最多等 waitTime 去抢，抢到后 leaseTime 到期释放 |
| `unlock()` | 释放锁（必须是持锁线程） |
| `forceUnlock()` | 强制释放（不管谁持有，慎用） |
| `isLocked()` | 锁是否已被任何人持有 |
| `isHeldByCurrentThread()` | 当前线程是否持有这把锁 |
| `isHeldByAnyThread()` | 是否有任意线程持有（等价于 `isLocked`） |
| `getHoldCount()` | 当前线程的重入次数 |
| `remainTimeToLive()` | 锁还剩多少毫秒过期 |

**完整可运行代码**：

```java
package com.canoe.redis.lock;

import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class ReentrantLockDemo {

    private final RedissonClient redisson;

    // 构造注入 RedissonClient（starter 已自动配置好）
    public ReentrantLockDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 最标准的用法：lock() + try/finally + unlock() */
    public void deductStock(Long productId) {
        // 1) 锁的 key 要和业务资源绑定，粒度越细越好（这里锁到具体商品）
        String lockKey = "lock:stock:" + productId;
        RLock lock = redisson.getLock(lockKey);
        // 2) 加锁（不传 leaseTime → 启用看门狗，默认 30s，每 10s 续期）
        lock.lock();
        try {
            // 3) 临界区：扣库存等业务
            System.out.println("当前重入次数：" + lock.getHoldCount());
            System.out.println("锁还剩 " + lock.remainTimeToLive() + " 毫秒过期");
            // TODO: 读库存、判断、扣库存
        } finally {
            // 4) 必须在 finally 释放，否则锁会一直续期/泄漏
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    /** tryLock 带等待时间，抢不到就放弃，避免无限阻塞 */
    public boolean tryDeduct(Long productId) throws InterruptedException {
        RLock lock = redisson.getLock("lock:stock:" + productId);
        // 最多等 3 秒抢锁；抢到后 10 秒强制过期（不再续期）
        boolean locked = lock.tryLock(3, 10, TimeUnit.SECONDS);
        if (!locked) {
            System.out.println("3 秒内没抢到锁，直接返回，不做扣减");
            return false;
        }
        try {
            // 临界区业务
            return true;
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

**必须讲透：看门狗（watchdog）**

看门狗是 Redisson 分布式锁最容易被误解、也最容易出生产事故的机制，务必搞懂。

::: tip 看门狗原理（白话版）
- 当你调用 **`lock()` 或 `tryLock()` 且不传 `leaseTime`** 时，Redisson 不知道你的业务要跑多久，于是它默认给锁一个 **30 秒**的过期时间，并**启动一个后台「看门狗」定时任务**：每 `internalLockLeaseTime / 3` = **10 秒**检查一次，只要持锁的客户端还活着，就把锁的过期时间**重置回 30 秒**。
- 效果：业务没跑完，锁就不会过期；客户端宕机，看门狗随之死亡，30 秒后锁自动释放，不会死锁。
- 当你调用 **`lock(leaseTime, unit)` 或 `tryLock(wait, leaseTime, unit)` 且传了 leaseTime`** 时，Redisson **不再启动看门狗**。锁就是「定时炸弹」：到点（leaseTime）不管业务跑没跑完，**强制释放**。
:::

所以一个铁律：

| 调用方式 | 看门狗 | 风险 |
| --- | --- | --- |
| `lock()` / `tryLock()` 不传 leaseTime | 有，自动续期 | 业务跑太久会无限续期（见 3.1 反例） |
| 传了 leaseTime | 无 | 业务超过 leaseTime 会提前释放，并发安全问题 |

**反例 1：不写 `finally` 导致看门狗线程泄漏**

```java
// ❌ 错误写法：lock() 后没在 finally 里 unlock()，一旦临界区抛异常，
// 锁永远不释放，看门狗线程也一直续期，变成「幽灵锁」
public void badDeduct(Long productId) {
    RLock lock = redisson.getLock("lock:stock:" + productId);
    lock.lock();
    int stock = readStock(productId);   // 万一这里抛 NPE
    writeStock(productId, stock - 1);    // 这行没执行，且锁没释放
    lock.unlock();                       // 异常跳过，锁泄漏！
}
```

正确写法永远把 `unlock()` 放进 `finally`，并用 `isHeldByCurrentThread()` 兜底（防止重复释放报错）。

**反例 2：`unlock()` 时锁已不属于自己 → `IllegalMonitorStateException`**

```java
// ❌ 错误写法：传了 leaseTime=5s，业务跑了 8s，锁已被 Redisson 自动释放并被别人抢走，
// 此时你再 unlock() 会抛 IllegalMonitorStateException（你不是锁的持有者）
RLock lock = redisson.getLock("lock:order");
lock.lock(5, TimeUnit.SECONDS);   // 关闭了看门狗
try {
    Thread.sleep(8000);            // 业务超过 5s
} finally {
    lock.unlock();                // 第 6 秒锁已过期，这里抛异常！
}
```

::: warning 看门狗与长事务的坑
如果临界区是个「长事务」（比如要调好几个下游、跑几十秒），用 `lock()` 不传 leaseTime 会让锁**无限续期**，等于这把锁被你独占很久，别人全阻塞。解决办法：给业务设超时上限，或评估后用 `tryLock(wait, leaseTime, unit)` 显式给一个合理 leaseTime，并接受「超时就失败」的代价。
:::

### 3.2 公平锁 `getFairLock`

**是什么**：按请求到达的先后顺序排队拿锁（内部用 Redis 队列 + 超时实现），先来先得。

**应用场景**：需要严格顺序、且能接受性能损耗时。比如「多个节点抢着处理同一笔订单，必须按提交顺序处理」。

**代价**：公平锁比非公平锁（默认 `RLock`）**慢不少**（每次加锁都要维护队列），所以**非必要不用**。

```java
package com.canoe.redis.lock;

import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class FairLockDemo {

    private final RedissonClient redisson;

    public FairLockDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    public void processInOrder(String taskId) throws InterruptedException {
        // 公平锁：前面加 getFairLock，其余 API 和 RLock 完全一致
        RLock fairLock = redisson.getFairLock("fair-lock:task:" + taskId);
        fairLock.lock();
        try {
            // 按请求顺序依次进入的临界区
            System.out.println("按顺序处理任务 " + taskId);
        } finally {
            if (fairLock.isHeldByCurrentThread()) {
                fairLock.unlock();
            }
        }
    }
}
```

### 3.3 联锁 `getMultiLock`（MultiLock）

**是什么**：把多把锁「绑」成一把锁，**全部抢到才算抢到**，任意一把没抢到则整体失败。

**应用场景**：需要同时锁住多个独立资源才能继续。经典例子——**A 账户向 B 账户转账**，必须同时锁住 A 和 B，否则只锁 A 不锁 B 会出现「A 扣了 B 没加」的并发问题。

```java
package com.canoe.redis.lock;

import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class MultiLockDemo {

    private final RedissonClient redisson;

    public MultiLockDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** A 给 B 转账：同时锁住 A 和 B 两把锁 */
    public boolean transfer(Long fromUserId, Long toUserId, int amount) throws InterruptedException {
        // 1) 分别拿到两把独立的锁
        RLock lockA = redisson.getLock("lock:account:" + fromUserId);
        RLock lockB = redisson.getLock("lock:account:" + toUserId);
        // 2) 用 getMultiLock 绑成一把联锁（参数顺序建议按 key 排序，避免不同节点加锁顺序相反导致死锁）
        RLock multiLock = redisson.getMultiLock(lockA, lockB);
        // 3) 最多等 3 秒；抢到后 30 秒（这里不传 leaseTime 走看门狗也可，按业务定）
        boolean locked = multiLock.tryLock(3, 30, TimeUnit.SECONDS);
        if (!locked) {
            return false;
        }
        try {
            // 临界区：A 扣、B 加
            System.out.println("从 " + fromUserId + " 向 " + toUserId + " 转 " + amount);
            return true;
        } finally {
            if (multiLock.isHeldByCurrentThread()) {
                multiLock.unlock();
            }
        }
    }
}
```

::: warning 联锁的加锁顺序要一致
多个节点抢联锁时，**锁的传入顺序要约定一致**（比如统一按 userId 升序），否则节点 1 按 `(A,B)`、节点 2 按 `(B,A)` 抢，可能互相持有对方需要的锁 → **死锁**。MultiLock 内部虽有超时兜底，但约定顺序是最佳实践。
:::

### 3.4 红锁 `getRedLock`（⚠️ 官方已弃用）

::: danger 红线结论（已联网核对官方文档）
经核对 Redisson 官方文档（redisson.org/docs 的 Locks and synchronizers 页）：**`RedLock` 对象已被官方标记为 deprecated（弃用）**，官方原文说明其「safety guarantees are contested（安全性受质疑）」，并用「需要多个独立 Redis 主节点的 quorum，运维成本高」为由，建议用 **`RLock` + 副本同步检查** 或 **`RFencedLock`（带防护令牌）** 替代。

因此：本篇**不推荐**在生产使用 `getRedLock`。下面仅作原理介绍，不提供生产示例代码。Redisson 4.x 中该对象可能已被移除；即使 3.x 里 `getRedLock` 方法还在，调用也可能编译/运行告警。
:::

**原理（仅科普）**：红锁（Redlock 算法）的思路是——向 **N 个互相独立的 Redis 主节点**（通常 5 个）各申请一把锁，只有**超过半数（≥ N/2+1）**的节点都抢到，才算整体抢到锁。目的是在「单个 Redis 主挂掉」时锁依然可用。

**为什么被弃用**：
1. **安全性争议**：分布式系统专家 Martin Kleppmann 指出，在 GC 停顿、时钟漂移、网络延迟下，红锁仍可能出现「两个客户端同时持有锁」的窗口。
2. **运维成本高**：要维护 5 个独立 Redis 主节点，只为一把锁，性价比低。
3. **Redisson 的现代替代方案**：Redisson 默认在加锁后做「副本同步检查」（`Config.setCheckLockSyncedSlaves(true)`，默认开），主从切换时锁不会丢；需要更强保护时用 `RFencedLock`（每次加锁发一个单调递增令牌，被保护资源拒绝旧令牌的写入）。

**现代正确姿势**：

```java
// ✅ 替代红锁的方案：普通 RLock + 开启副本同步检查（默认已开）
Config config = new Config();
config.useMasterSlaveServers()
        .setMasterAddress("redis://127.0.0.1:6379")
        .addSlaveAddress("redis://127.0.0.1:6380");
// 默认 checkLockSyncedSlaves=true，加锁后会确认已同步到副本，否则加锁失败
// 需要 fencing token 时用：
// RLock fenceLock = redisson.getFencedLock("myLock");
// Long token = fenceLock.lockAndGetToken();
```

### 3.5 读写锁 `getReadWriteLock`（经典场景：缓存重建）

**是什么**：一把锁拆成「读锁」和「写锁」。规则是 **读读共享、读写互斥、写写互斥**（和 JDK `ReadWriteLock` 一样）。

**经典场景——缓存重建（防缓存击穿）**：

- 热点 key 失效瞬间，海量请求同时打到数据库 → 缓存击穿。
- 解法：用**写锁**保护「查 DB + 回写缓存」这段，用**读锁**保护「读缓存」。这样同一时刻只有一个线程去查 DB 重建缓存，其余线程要么等写锁释放后读缓存，要么直接读已存在的缓存。

```java
package com.canoe.redis.lock;

import org.redisson.api.RReadWriteLock;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class CacheRebuildDemo {

    private final RedissonClient redisson;

    public CacheRebuildDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 缓存重建：读锁查缓存，写锁回源 */
    public String getWithCache(String key) {
        // 1) 先不加任何锁，直接试读缓存（绝大多数请求走这里，最快）
        String cache = readFromCache(key);
        if (cache != null) {
            return cache;
        }

        // 2) 缓存没有：拿读写锁
        RReadWriteLock rwLock = redisson.getReadWriteLock("rw-lock:cache:" + key);
        RLock readLock = rwLock.readLock();    // 读锁
        RLock writeLock = rwLock.writeLock();  // 写锁

        // 3) 先上读锁，再查一次缓存（double check，避免多个线程同时通过上面的空判断后都去抢写锁）
        readLock.lock();
        try {
            cache = readFromCache(key);
            if (cache != null) {
                return cache;
            }
            // 4) 升级为写锁去回源（实际项目常用 writeLock.tryLock 防死锁；此处为讲清原理用降级逻辑）
            readLock.unlock();   // 释放读锁，准备拿写锁
            writeLock.lock();
            try {
                // 5) 再查一次（双检）：可能别的线程已经重建好了
                cache = readFromCache(key);
                if (cache == null) {
                    cache = readFromDb(key);          // 回源查 DB
                    writeToCache(key, cache, 300);    // 写回缓存，5 分钟过期
                }
                return cache;
            } finally {
                if (writeLock.isHeldByCurrentThread()) {
                    writeLock.unlock();
                }
            }
        } finally {
            // 若上面 readLock.unlock() 已执行，这里 isHeldByCurrentThread=false，不会重复释放
            if (readLock.isHeldByCurrentThread()) {
                readLock.unlock();
            }
        }
    }

    // —— 下面的本地模拟方法，实际换成你的 RedisTemplate / Mapper ——
    private String readFromCache(String key) { return null; }
    private String readFromDb(String key) { return "db-value-" + key; }
    private void writeToCache(String key, String value, int seconds) { }
}
```

::: tip 读写锁选型口诀
「**多读少写、且写的时候不能让读读到脏数据**」→ 用读写锁。纯扣库存（写写互斥、不需要读）用普通 `RLock` 就够了，别滥用读写锁。
:::

### 3.6 信号量 `getSemaphore` / `getPermitExpirableSemaphore`

**是什么**：信号量 = 「许可证池」。初始化 N 个许可证，`acquire()` 拿一个（没有就阻塞），`release()` 还一个。用来控制「最多 N 个并发」。

**`getSemaphore`（普通信号量）**：许可证不绑定线程，A 拿的 B 也能还，适合限流。

**`getPermitExpirableSemaphore`（可过期信号量）**：每张许可证有唯一 ID 且能自动过期，适合「占座 / 临时资源」场景。

```java
package com.canoe.redis.lock;

import org.redisson.api.RSemaphore;
import org.redisson.api.RPermitExpirableSemaphore;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class SemaphoreDemo {

    private final RedissonClient redisson;

    public SemaphoreDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 普通信号量：限制同时最多 100 个任务在跑 */
    public void limitConcurrency() throws InterruptedException {
        RSemaphore semaphore = redisson.getSemaphore("sem:task-pool");
        semaphore.trySetPermits(100);   // 初始化 100 个许可证（幂等，多次调用以第一次为准）
        semaphore.acquire();            // 拿一个许可证，没有就阻塞等待
        try {
            // 临界区：最多 100 个线程同时在这里
        } finally {
            semaphore.release();        // 归还许可证
        }
    }

    /** 可过期信号量：占一个车位，最多占 10 分钟自动释放 */
    public void parkWithExpiry() throws InterruptedException {
        RPermitExpirableSemaphore ps = redisson.getPermitExpirableSemaphore("park:lot");
        ps.trySetPermits(50);
        // acquire 返回一个许可证 ID（字符串），持有期间若客户端宕机，leaseTime 到点自动释放
        String permitId = ps.acquire(10, TimeUnit.MINUTES);
        try {
            // 占用资源
        } finally {
            ps.release(permitId);       // 用许可证 ID 归还
        }
    }
}
```

### 3.7 闭锁 `getCountDownLatch`

**是什么**：和 JDK `CountDownLatch` 一样，`await()` 等待，`countDown()` 倒数。用于「等 N 个任务都完成再继续」。

**应用场景**：批量任务汇合。比如「一个导出请求要等 10 个分片都算完，再合并返回」。

```java
package com.canoe.redis.lock;

import org.redisson.api.RCountDownLatch;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class CountDownLatchDemo {

    private final RedissonClient redisson;

    public CountDownLatchDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 等 3 个子任务都完成后再继续 */
    public void waitAllDone() throws InterruptedException {
        RCountDownLatch latch = redisson.getCountDownLatch("latch:export:123");
        latch.trySetCount(3);   // 设置需要 countDown 3 次

        // 子任务线程里每完成一个就 countDown() 一次（这里示意）
        // new Thread(() -> { doWork(); latch.countDown(); }).start();

        // 主线程阻塞等待，直到 count 减到 0（最多等 60 秒）
        boolean done = latch.await(60, TimeUnit.SECONDS);
        if (done) {
            System.out.println("3 个子任务全部完成，开始合并");
        } else {
            System.out.println("超时仍有任务未完成");
        }
    }
}
```

### 3.8 锁选型速查表

| 你要的效果 | 用哪个 | 关键方法 |
| --- | --- | --- |
| 最简单的互斥（最常用） | `RLock` | `getLock` |
| 严格按先后排队 | `RLock`（公平） | `getFairLock` |
| 同时锁多个资源才继续（转账） | `RLock`（联锁） | `getMultiLock` |
| 多读少写、写时防脏读（缓存重建） | `RReadWriteLock` | `getReadWriteLock` |
| 控制并发上限（最多 N 个） | `RSemaphore` | `getSemaphore` |
| 占临时资源、可自动过期归还 | `RPermitExpirableSemaphore` | `getPermitExpirableSemaphore` |
| 等 N 个任务汇合 | `RCountDownLatch` | `getCountDownLatch` |
| 多主高可用锁（**已弃用**） | `RedLock` | `getRedLock`（不推荐） |

## 四、延迟队列 `RDelayedQueue`

### 4.1 原理（白话）

`RDelayedQueue` 解决「消息要在未来某个时间点才被消费」的问题（订单关单、重试、定时提醒）。

::: tip 原理一句话
Redisson 在客户端侧维护一个 `RDelayedQueue`，**投递消息时按「到期时间」把消息放进一个 Redis ZSet（有序集合，score=到期时间戳）**；Redisson 后台有个定时任务不断扫描这个 ZSet，把「已经到期」的消息**转移**到你在创建延迟队列时指定的那个目标 `RBlockingQueue` 里；消费者从目标队列 `take()` 就能拿到到期的消息。
::

```text
生产者                            Redis 内部                           消费者
  |                                |                                  |
  | offer(msg, 30分钟)            |                                  |
  |------------------------------>| ZSet（score=到期时间）            |
  |                                |   ↑ Redisson 后台定时扫描         |
  |                                |   到期的 msg 转移到 ↓             |
  |                                | 目标 RBlockingQueue              |
  |                                |--------------------------------->| take() 拿到 msg
```

### 4.2 配合 `RBlockingQueue` 的完整代码

```java
package com.canoe.redis.queue;

import org.redisson.api.RBlockingQueue;
import org.redisson.api.RDelayedQueue;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
public class DelayedQueueDemo {

    private final RedissonClient redisson;

    public DelayedQueueDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 投递延迟消息：3 秒后消息才会出现在目标队列 */
    public void produce() {
        // 1) 先建一个普通阻塞队列作为「目标队列」
        RBlockingQueue<String> targetQueue = redisson.getBlockingQueue("my:target:queue");
        // 2) 基于目标队列建一个延迟队列
        RDelayedQueue<String> delayedQueue = redisson.getDelayedQueue(targetQueue);
        // 3) 投递：10 秒后这条消息才会进 targetQueue
        delayedQueue.offer("hello-delayed", 10, TimeUnit.SECONDS);
        System.out.println("已投递，10 秒后消费者才能拿到");
    }

    /** 消费：从目标队列阻塞获取（到期的消息才会到这里） */
    public void consume() throws InterruptedException {
        RBlockingQueue<String> targetQueue = redisson.getBlockingQueue("my:target:queue");
        // 注意：消费者只监听「目标队列」，不需要碰延迟队列
        String msg = targetQueue.take();   // 阻塞直到有到期消息
        System.out.println("收到到期消息：" + msg);
    }
}
```

::: warning 延迟队列的两个坑
1. **消费者必须监听「目标队列」（`targetQueue`），不是延迟队列本身**——延迟队列只是「投递入口 + 内部调度器」。
2. **延迟队列的调度器是「客户端进程」**。如果你有多个消费者实例，每个实例创建延迟队列都会起一个扫描任务，但 Redisson 内部用 pub/sub 协调，不会重复转移；不过生产建议明确「只有一个角色负责投递」，避免混淆。
:::

### 4.3 实战：订单 30 分钟未支付自动关闭

这是延迟队列的「重头戏」。完整链路：用户下单 → 投递一条「30 分钟后关单」的延迟消息 → 独立的消费者线程 30 分钟后收到 → 检查订单仍是「未支付」就关单 + 回库存。

**订单实体（简化）**：

```java
package com.canoe.redis.order;

import java.io.Serializable;

/** 延迟关单消息体：只带必要字段，越小越好 */
public class CloseOrderMessage implements Serializable {
    private static final long serialVersionUID = 1L;

    private Long orderId;
    private Long productId;
    private Integer buyCount;

    public CloseOrderMessage() {
    }

    public CloseOrderMessage(Long orderId, Long productId, Integer buyCount) {
        this.orderId = orderId;
        this.productId = productId;
        this.buyCount = buyCount;
    }

    public Long getOrderId() { return orderId; }
    public void setOrderId(Long orderId) { this.orderId = orderId; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public Integer getBuyCount() { return buyCount; }
    public void setBuyCount(Integer buyCount) { this.buyCount = buyCount; }
}
```

**生产者（下单时投递延迟消息）**：

```java
package com.canoe.redis.order;

import org.redisson.api.RBlockingQueue;
import org.redisson.api.RDelayedQueue;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class OrderProducerService {

    private final RedissonClient redisson;

    public OrderProducerService(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 下单成功后调用：投递「30 分钟后关单」的延迟消息 */
    public void onCreateOrder(Long orderId, Long productId, Integer buyCount) {
        RBlockingQueue<CloseOrderMessage> targetQueue =
                redisson.getBlockingQueue("order:close:queue");
        RDelayedQueue<CloseOrderMessage> delayedQueue =
                redisson.getDelayedQueue(targetQueue);

        CloseOrderMessage msg = new CloseOrderMessage(orderId, productId, buyCount);
        // 30 分钟到期后才进 targetQueue
        delayedQueue.offer(msg, 30, TimeUnit.MINUTES);
        System.out.println("订单 " + orderId + " 已投递 30 分钟关单延迟消息");
    }
}
```

**消费者（后台线程监听目标队列）**：

```java
package com.canoe.redis.order;

import org.redisson.api.RBlockingQueue;
import org.redisson.api.RedissonClient;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Component
public class OrderCloseConsumer implements CommandLineRunner {

    private final RedissonClient redisson;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();

    public OrderCloseConsumer(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 应用启动后，起一个后台线程一直 take() 目标队列 */
    @Override
    public void run(String... args) {
        pool.submit(this::loop);
    }

    private void loop() {
        RBlockingQueue<CloseOrderMessage> targetQueue =
                redisson.getBlockingQueue("order:close:queue");
        while (!Thread.currentThread().isInterrupted()) {
            try {
                // 阻塞获取到期消息
                CloseOrderMessage msg = targetQueue.take();
                handleClose(msg);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }

    /** 关单逻辑：只有「未支付」才关，并回库存 */
    private void handleClose(CloseOrderMessage msg) {
        // 实际项目里这里调 OrderMapper / StockMapper；此处用伪代码表达关键点
        System.out.println("处理关单：" + msg.getOrderId());
        // 1) 查订单状态
        // Order order = orderMapper.selectById(msg.getOrderId());
        // 2) 只有未支付才关单 + 回库存（防止重复关单、防止已支付被误关）
        // if (order != null && order.getStatus() == OrderStatus.UNPAID) {
        //     orderMapper.updateStatus(msg.getOrderId(), OrderStatus.CLOSED);
        //     stockMapper.increase(msg.getProductId(), msg.getBuyCount());
        // }
    }

    @PreDestroy
    public void destroy() {
        pool.shutdownNow();
    }
}
```

::: tip 为什么延迟队列比「定时扫库」好
扫全库 `WHERE status=UNPAID AND create_time < now()-30min` 在订单量大时会拖垮 DB，且精度差。延迟队列把「到点」交给 Redis，到点才触发，精准又轻量。代价是：Redis 宕机期间延迟消息可能丢失，对一致性要求极高的场景要配合「关单兜底定时任务」。
:::

## 五、分布式集合

Redisson 把 JDK 的集合类几乎都搬到了 Redis 上。下面挑生产最常用的讲。

### 5.1 `RBucket`（任意对象 + 过期）与 `RBatch`（批量）

`RBucket` 就是「一个 Redis key 存一个对象」，相当于 `SET key value` 的对象版，支持设置过期。

```java
package com.canoe.redis.collection;

import org.redisson.api.RBucket;
import org.redisson.api.RBatch;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class BucketDemo {

    private final RedissonClient redisson;

    public BucketDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** RBucket：存任意对象，可带过期 */
    public void bucketDemo() {
        RBucket<String> bucket = redisson.getBucket("bucket:name");
        bucket.set("轻舟", 10, TimeUnit.MINUTES);   // 存值 + 10 分钟过期
        String v = bucket.get();                    // 取值
        boolean ok = bucket.trySet("新值", 10, TimeUnit.MINUTES); // 不存在才设，返回是否成功
        System.out.println(v + " / " + ok);
    }

    /** RBatch：一次网络往返执行多条命令（批量，等价于 Pipeline） */
    public void batchDemo() {
        RBatch batch = redisson.createBatch();
        batch.getBucket("k1").setAsync("v1");
        batch.getBucket("k2").setAsync("v2");
        batch.getMap("m1").putAsync("f1", "fv1");
        // 一次性提交，只一次网络往返
        batch.execute();
        System.out.println("批量命令已提交");
    }
}
```

### 5.2 `RMap` / `RMapCache` / `RLocalCachedMap` / `RSetCache` / `RList` / `RScoredSortedSet`

**`RMap`**：分布式 `Map`，但**整个 Map 的 key 不能单独设过期**。

```java
package com.canoe.redis.collection;

import org.redisson.api.RMap;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class MapDemo {

    private final RedissonClient redisson;

    public MapDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    public void mapDemo() {
        RMap<String, String> map = redisson.getMap("user:1001");
        map.put("name", "轻舟");
        map.put("age", "18");
        String name = map.get("name");
        // 注意：RMap 不能给单个 field 设 TTL，整张表统一过期要靠下面 RMapCache
        System.out.println(name);
    }
}
```

**`RMapCache`：带单条记录 TTL 的 Map（解决「Map 里元素不能单独过期」的痛点）**

```java
package com.canoe.redis.collection;

import org.redisson.api.RMapCache;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class MapCacheDemo {

    private final RedissonClient redisson;

    public MapCacheDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    public void mapCacheDemo() {
        // RMapCache：每个 field 可以单独设过期时间
        RMapCache<String, String> mapCache = redisson.getMapCache("session:cache");
        // 字段 token:abc 存 30 分钟过期；字段 config:x 存 1 小时过期
        mapCache.put("token:abc", "user-1", 30, TimeUnit.MINUTES);
        mapCache.put("config:x", "v", 1, TimeUnit.HOURS);
        System.out.println(mapCache.get("token:abc"));
    }
}
```

::: tip `RMapCache` vs `RMap`
- `RMap`：整张表一个过期，适合「永久字典」。
- `RMapCache`：每个 entry 独立过期，底层用 Redis 的「Map + 每个 field 的过期调度」，适合「分布式 Session / 本地缓存兜底」。代价是**内存和 CPU 略高**，不要拿来存超大量字段。
:::

**`RLocalCachedMap`：本地缓存加速（Near Cache）**

```java
package com.canoe.redis.collection;

import org.redisson.api.LocalCachedMapOptions;
import org.redisson.api.RLocalCachedMap;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class LocalCachedMapDemo {

    private final RedissonClient redisson;

    public LocalCachedMapDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    public void localCachedDemo() {
        // 本地缓存选项：失效策略、同步策略
        LocalCachedMapOptions<String, String> options = LocalCachedMapOptions.<String, String>defaults()
                // 本地缓存最多 1000 条
                .cacheSize(1000)
                // 本地条目最多存活 10 分钟
                .timeToLive(10 * 60 * 1000)
                // 写底层时，通过 pub/sub 通知其他节点的本地缓存失效（保持最终一致）
                .invalidationPolicy(LocalCachedMapOptions.InvalidationPolicy.ON_CHANGE);
        RLocalCachedMap<String, String> map =
                redisson.getLocalCachedMap("hot:config", options);
        map.put("switch", "on");
        // 读：先查本地 JVM 缓存，没有才走 Redis，极大降低网络开销
        System.out.println(map.get("switch"));
    }
}
```

::: warning `RLocalCachedMap` 的一致性
本地缓存意味着「多实例各自存一份」，某个实例改了 Redis，其他实例的本地副本不会立刻变。`invalidationPolicy` 用 `ON_CHANGE`（默认）会通过 pub/sub 广播失效事件，做到**最终一致**；但如果 pub/sub 丢消息，会短暂读到旧值。配置类数据是它的最佳场景，强一致数据别用。
:::

**`RList` / `RSetCache`**：分布式 List 和带过期的 Set，用法同 `java.util.List` / `java.util.Set`，不再赘述。

**`RScoredSortedSet`：排行榜实战**

底层是 Redis 的 ZSet（有序集合），`score` 决定排名，最适合做排行榜。

```java
package com.canoe.redis.collection;

import org.redisson.api.RScoredSortedSet;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.Collection;

@Service
public class LeaderboardDemo {

    private final RedissonClient redisson;

    public LeaderboardDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 积分排行榜：value=用户ID，score=积分 */
    public void leaderboard() {
        RScoredSortedSet<String> board = redisson.getScoredSortedSet("rank:game");
        // 增加积分（不存在则新增，存在则累加）
        board.addScore("user:1", 100);
        board.addScore("user:2", 250);
        board.addScore("user:3", 80);

        // 取前 10 名（按分数从高到低）
        Collection<String> top10 = board.valueRangeReversed(0, 9);
        System.out.println("排行榜前 10：" + top10);

        // 查某用户排名（从 0 开始，reversed 表示高分在前）
        Integer rank = board.revRank("user:2");
        System.out.println("user:2 排名第 " + (rank == null ? "无" : rank + 1));
    }
}
```

### 5.3 `RBlockingQueue`（阻塞队列实现简易 MQ）

不依赖 RabbitMQ/Kafka，用 Redis 队列就能做「生产者-消费者」解耦。

```java
package com.canoe.redis.collection;

import org.redisson.api.RBlockingQueue;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class SimpleMqDemo {

    private final RedissonClient redisson;

    public SimpleMqDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 生产者 */
    public void produce(String task) {
        RBlockingQueue<String> queue = redisson.getBlockingQueue("simple:mq");
        queue.offer(task);   // 入队
        System.out.println("投递任务：" + task);
    }

    /** 消费者（阻塞拿，最多等 5 秒） */
    public void consume() throws InterruptedException {
        RBlockingQueue<String> queue = redisson.getBlockingQueue("simple:mq");
        String task = queue.poll(5, TimeUnit.SECONDS);  // 5 秒内没消息返回 null
        if (task != null) {
            System.out.println("处理任务：" + task);
        }
    }
}
```

::: warning 简易 MQ 的局限
`RBlockingQueue` 是「至少一次」语义，**没有 ACK 确认、没有死信、没有重试**。消费时进程挂了消息可能丢（取决于你是否先 `poll` 再处理）。真要可靠 MQ，用 Redis Stream 或上 Kafka/RabbitMQ。Redisson 也有 `RStream`（基于 Redis Stream）可做可靠队列。
:::

### 5.4 `RPriorityQueue` / `RDeque`

- `RPriorityQueue`：按元素自然顺序或比较器出队的队列（底层 ZSet）。
- `RDeque`：双端队列（`java.util.Deque` 的分布式版），两头都能进能出。

```java
package com.canoe.redis.collection;

import org.redisson.api.RPriorityQueue;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class PriorityQueueDemo {

    private final RedissonClient redisson;

    public PriorityQueueDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    public void priorityDemo() {
        // 数字小的优先出队
        RPriorityQueue<Integer> pq = redisson.getPriorityQueue("priority:q");
        pq.add(3);
        pq.add(1);
        pq.add(2);
        Integer first = pq.poll();   // 取出 1
        System.out.println("优先级最高：" + first);
    }
}
```

## 六、`RAtomicLong`：分布式计数器 / 全局 ID

`RAtomicLong` 对应 JDK 的 `AtomicLong`，底层就是 Redis 的 `INCR`/`DECR` 命令，原子自增、线程安全。

```java
package com.canoe.redis.atomic;

import org.redisson.api.RAtomicLong;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class AtomicLongDemo {

    private final RedissonClient redisson;

    public AtomicLongDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 全局访问计数器 / 限流计数 / 批量发号 */
    public void counter() {
        RAtomicLong counter = redisson.getAtomicLong("counter:visit");
        long now = counter.incrementAndGet();   // 原子 +1，等价于 INCR，返回最新值
        System.out.println("当前访问量：" + now);

        long batch = counter.addAndGet(100);    // 一次 +100，用于批量取号
        System.out.println("批量取号起点：" + batch);
    }
}
```

::: tip `RAtomicLong` 与 `INCR`
`incrementAndGet()` 底层就是 Redis 的 `INCR`，单命令原子，天然分布式安全。适合做「全局自增 ID、访问量、限流令牌计数」。但它**严格单调递增、每次都走网络**；如果你要「高性能、不要求连续」的 ID，看下一节的 `RIdGenerator`。
:::

## 七、`RRateLimiter`（令牌桶限流）

### 7.1 原理（白话）

令牌桶：想象一个桶，系统**匀速往桶里放令牌**（比如每秒放 10 个）。请求来时**从桶里拿一个令牌**，拿到才放行，拿不到就拒绝。桶满后多余的令牌丢弃。这样既能**限平均速率**（桶容量限制突发），又能**容忍短时突发**（桶里攒的令牌够一下放一波）。

::: tip 一句话
令牌桶 = 「匀速生产令牌 + 请求消费令牌 + 桶容量兜底突发」。Redisson 用 Lua 脚本保证「取令牌」的原子性，是分布式限流的成熟方案。
:::

### 7.2 API（已核对官方 Javadoc）

经核对 Redisson 3.x Javadoc，`RRateLimiter` 的签名如下（**务必照抄，不要臆造**）：

```java
// 设置限流规则（幂等：多个节点都调，只有第一个生效，返回 true；其余返回 false）
boolean trySetRate(RateType type, long rate, long rateInterval, RateIntervalUnit unit);
//   type: RateType.OVERALL（集群总限流）或 RateType.PER_CLIENT（每个客户端限流）
//   rate: 在 rateInterval 时间窗口内生成的总令牌数
//   rateInterval + unit: 时间窗口，比如 1 + SECONDS = 每秒 rate 个令牌

void setRate(RateType type, long rate, long rateInterval, RateIntervalUnit unit); // 同上，但强制覆盖

void acquire();                              // 阻塞拿 1 个令牌，直到拿到
void acquire(long permits);                 // 阻塞拿 permits 个
boolean tryAcquire();                       // 立即试拿 1 个，拿到 true，否则 false
boolean tryAcquire(long permits);           // 立即试拿 permits 个
boolean tryAcquire(long timeout, TimeUnit unit);             // 最多等 timeout 拿 1 个
boolean tryAcquire(long permits, long timeout, TimeUnit unit); // 最多等 timeout 拿 permits 个
long availablePermits();                    // 当前桶里还剩多少令牌
```

```java
package com.canoe.redis.ratelimiter;

import org.redisson.api.RRateLimiter;
import org.redisson.api.RateIntervalUnit;
import org.redisson.api.RateType;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class RateLimiterDemo {

    private final RedissonClient redisson;

    public RateLimiterDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 限制某接口每秒最多 10 次（集群整体限流） */
    public boolean allowRequest(String userId) {
        // 每个被限流的资源一个 limiter
        RRateLimiter limiter = redisson.getRateLimiter("ratelimit:api:createOrder");
        // 初始化：OVERALL 全局、每 1 秒生成 10 个令牌（幂等，重复调用无副作用）
        limiter.trySetRate(RateType.OVERALL, 10, 1, RateIntervalUnit.SECONDS);
        // 非阻塞：拿不到立即返回 false（被限流）
        return limiter.tryAcquire();
    }
}
```

::: warning 版本差异请以官方最新文档为准
`trySetRate` 在 Redisson 3.x 长期稳定为此签名 `(RateType, long, long, RateIntervalUnit)`。若你使用 Redisson 4.x 或后续版本，官方可能新增 `rateIntervals`（多档速率）重载，请以 `org.redisson.api.RRateLimiter` 的官方 Javadoc 为准。本文基于 3.52.0。
:::

### 7.3 实战：自定义注解 + AOP 切面限流

把限流做成注解，业务代码只写 `@RateLimit(key="createOrder", rate=10, interval=1)`，切面自动拦截。

**注解定义**：

```java
package com.canoe.redis.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** 方法级限流注解 */
@Target(ElementType.METHOD)              // 只能标在方法上
@Retention(RetentionPolicy.RUNTIME)      // 运行时保留，AOP 才能读到
public @interface RateLimit {
    /** 限流资源的 key，相同 key 共享一个令牌桶 */
    String key() default "";
    /** 时间窗口内允许的请求数 */
    int rate() default 10;
    /** 时间窗口（秒） */
    int interval() default 1;
}
```

**切面实现**：

```java
package com.canoe.redis.aspect;

import com.canoe.redis.annotation.RateLimit;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.redisson.api.RRateLimiter;
import org.redisson.api.RateIntervalUnit;
import org.redisson.api.RateType;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;

@Aspect
@Component
public class RateLimitAspect {

    private final RedissonClient redisson;

    public RateLimitAspect(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 拦截所有带 @RateLimit 的方法 */
    @Around("@annotation(com.canoe.redis.annotation.RateLimit)")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        // 1) 取出注解上的参数
        MethodSignature signature = (MethodSignature) pjp.getSignature();
        Method method = signature.getMethod();
        RateLimit rateLimit = method.getAnnotation(RateLimit.class);

        // 2) 拼限流 key（方法全限定名 + 注解里的 key，保证全局唯一）
        String limitKey = "ratelimit:" + method.getDeclaringClass().getSimpleName()
                + ":" + method.getName() + ":" + rateLimit.key();

        // 3) 拿令牌桶并初始化规则
        RRateLimiter limiter = redisson.getRateLimiter(limitKey);
        limiter.trySetRate(RateType.OVERALL, rateLimit.rate(), rateLimit.interval(), RateIntervalUnit.SECONDS);

        // 4) 尝试拿令牌；拿不到直接抛异常，由全局异常处理器转成 429
        if (!limiter.tryAcquire()) {
            throw new RuntimeException("请求过于频繁，请稍后再试（被限流）");
        }
        // 5) 拿到令牌，放行原方法
        return pjp.proceed();
    }
}
```

**使用示例（Controller）**：

```java
package com.canoe.redis.controller;

import com.canoe.redis.annotation.RateLimit;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class DemoController {

    /** 该接口每秒最多 5 次 */
    @RateLimit(key = "demo", rate = 5, interval = 1)
    @GetMapping("/demo")
    public String demo() {
        return "ok";
    }
}
```

**压测 curl（每秒发 20 个请求，观察被限流）**：

```bash
# 用 curl 循环快速打 20 次
for i in $(seq 1 20); do curl -s http://localhost:8080/api/demo; echo; done
```

::: tip 注解式限流的扩展点
- 想「按用户 ID 限流」而非全局？把 `RateType.PER_CLIENT` 或把 userId 拼进 `limitKey`。
- 想被限流时返回 HTTP 429 而非抛异常？在切面里 `throw` 一个自定义异常，再用 `@ControllerAdvice` 统一转成 429。
- 集群限流用 `RateType.OVERALL`（所有节点共享一个桶）；单节点各自限流用 `RateType.PER_CLIENT`。
:::

## 八、`RBloomFilter`（布隆过滤器）

### 8.1 API（已核对官方文档）

布隆过滤器是「用极小内存判断一个元素**是否可能存在于集合**」的概率结构：返回 `false` 一定不在；返回 `true` **可能**在（有误判率）。经典用于**缓存穿透防护**。

`RBloomFilter` 核心签名（Redisson 3.x）：

```java
// 初始化：expectedInsertions=预计放入的元素总数，falseProbability=期望误判率（0~1）
boolean tryInit(long expectedInsertions, double falseProbability);
boolean add(Object object);             // 放入一个元素
boolean contains(Object object);        // 是否可能存在（false=一定不在）
long count();                            // 当前已放入的近似数量
long getExpectedInsertions();           // 读取初始化时的 expectedInsertions
double getFalseProbability();           // 读取初始化时的误判率
```

```java
package com.canoe.redis.bloom;

import org.redisson.api.RBloomFilter;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class BloomFilterDemo {

    private final RedissonClient redisson;

    public BloomFilterDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    public void bloomDemo() {
        RBloomFilter<Long> bloom = redisson.getBloomFilter("bf:user:id");
        // 预计放 100 万条，误判率 1%
        bloom.tryInit(1_000_000L, 0.01);
        bloom.add(1001L);
        bloom.add(1002L);
        System.out.println("1001 可能存在？" + bloom.contains(1001L)); // true
        System.out.println("9999 可能存在？" + bloom.contains(9999L)); // 大概率 false（一定不在）
    }
}
```

### 8.2 容量与误判率怎么选（内存对照表）

布隆过滤器大小公式：`m = -n * ln(p) / (ln(2)^2)`，约 `n * 1.44 * log2(1/p)` bit。下列为经验值（单个 bit 占 1 bit）：

| 预计元素数 n | 误判率 p | 约占用内存 | 说明 |
| --- | --- | --- | --- |
| 10 万 | 1% | ~ 120 KB | 小数据量，1% 够用 |
| 10 万 | 0.1% | ~ 180 KB | 误判率降 10 倍，内存只多 50% |
| 100 万 | 1% | ~ 1.2 MB | 常规缓存穿透防护够用 |
| 100 万 | 0.1% | ~ 1.8 MB | 对误判敏感时 |
| 1000 万 | 1% | ~ 12 MB | 大数据量仍很省 |
| 1000 万 | 0.1% | ~ 18 MB | 仍远小于存全量 |

::: tip 选型经验
- 误判率从 1% 降到 0.1%，内存只多约 50%，但误判少 10 倍——**默认就用 0.1% 更稳**。
- `expectedInsertions` 要**高估**真实量（比如实际 80 万就按 100 万初始化），低估会导致实际误判率飙升。
- 布隆过滤器**不支持删除单个元素**（bit 复用），需要删除请用 `RClusteredBloomFilter`（Redisson 集群版，较新版本提供）或重建。
:::

### 8.3 实战：缓存穿透防护（呼应第 05 章）

缓存穿透 = 查一个**根本不存在的 key**（如 `id=-1` 或 `id=不存在`），缓存和 DB 都没有，请求每次都打到 DB。布隆过滤器挡在缓存之前：先问「这个 id 可能存在吗？」`false` 直接返回空，绝不放行到 DB。

```java
package com.canoe.redis.bloom;

import org.redisson.api.RBloomFilter;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class BloomProtectDemo {

    private final RedissonClient redisson;

    public BloomProtectDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    /** 初始化时把「所有合法 id」灌进布隆过滤器（应用启动 / 定时刷新） */
    public void init(Long maxId) {
        RBloomFilter<Long> bloom = redisson.getBloomFilter("bf:product:id");
        bloom.tryInit(1_000_000L, 0.01);
        for (long id = 1; id <= maxId; id++) {
            bloom.add(id);
        }
    }

    /** 查询前先过布隆过滤器 */
    public String getProduct(Long id) {
        RBloomFilter<Long> bloom = redisson.getBloomFilter("bf:product:id");
        if (!bloom.contains(id)) {
            // 一定不存在 → 直接返回，保护 DB
            return null;
        }
        // 可能存在 → 走缓存 / DB（注意仍可能误判命中，所以 DB 查不到也要正常返回空）
        return queryFromCacheOrDb(id);
    }

    private String queryFromCacheOrDb(Long id) { return "product-" + id; }
}
```

## 九、`RIdGenerator`（分布式 ID 生成器）⚠️ 纠正一个常见误解

::: tip 重要更正（已联网核对官方文档）
很多资料说「`RIdGenerator` 是 Redisson PRO 商业版功能」——**这是错的**。经核对 Redisson 官方文档（redisson.org/docs 的 Counters 页）与 GitHub README，`RIdGenerator`（Id generator）**属于开源社区版（Community Edition）**，免费可用。PRO 版额外增强的是「Advanced Live Object / Advanced JSON Store / Bit Vector Store」等，**不包含基础 Id generator**。所以本文直接上代码，无需付费。
:::

**是什么**：`RIdGenerator` 用「**批量预分配**」思路生成全局唯一 Long ID：首次调用从 Redis 一次性**预留一段**（比如 20000 个）到本地缓存，之后每次 `nextId()` 从本地拿，**不走网络**，直到这段用完再去 Redis 预占下一段。所以它比 `RAtomicLong`（每次都 `INCR` 走网络）**快得多**，但代价是 ID **不严格单调递增**（不同节点各自分一段，会交错）。

```java
package com.canoe.redis.id;

import org.redisson.api.RIdGenerator;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

@Service
public class IdGeneratorDemo {

    private final RedissonClient redisson;

    public IdGeneratorDemo(RedissonClient redisson) {
        this.redisson = redisson;
    }

    public void idDemo() {
        RIdGenerator generator = redisson.getIdGenerator("generator:order");
        // 初始化：起始值 1，每段预分配 50000 个（幂等，多节点都调，只有第一个生效）
        boolean inited = generator.tryInit(1, 50000);
        System.out.println("是否本节点初始化成功：" + inited);

        // 拿 ID：多数情况从本地段取，无网络开销
        long id = generator.nextId();
        System.out.println("生成订单 ID：" + id);
    }
}
```

| 维度 | `RAtomicLong` | `RIdGenerator` |
| --- | --- | --- |
| 是否连续递增 | 是（严格） | 否（各节点分段，交错） |
| 性能 | 每次网络 `INCR` | 本地取，批量才走网络，更快 |
| 适用 | 需要严格顺序（流水号） | 只需唯一、不需顺序（主键、traceId） |

::: tip 开源替代方案（当 Redisson 不可用时）
- **雪花算法（Snowflake）**：本地生成 64 位 ID（时间戳+机器+序列），无需 Redis，但要解决「时钟回拨」。
- **号段模式**：从 DB/`RAtomicLong` 批量取一段区间，本地分配（和 RIdGenerator 思路一致）。
- **`RAtomicLong`**：最简单的全局自增，但性能不如批量预分配。
:::

## 十、Spring Cache 接入 Redisson

Redisson 提供 `RedissonSpringCacheManager`，让 `@Cacheable` 直接把缓存存进 Redis（分布式缓存，多实例共享）。

```java
package com.canoe.redis.config;

import org.redisson.api.RedissonClient;
import org.redisson.spring.cache.RedissonSpringCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.RedisTemplate;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class CacheConfig {

    /** 用 Redisson 作为 Spring Cache 的底层存储 */
    @Bean
    public RedissonSpringCacheManager redissonCacheManager(RedissonClient redissonClient) {
        // 每个 cacheName 的 TTL 配置：userCache 存 10 分钟，orderCache 存 30 分钟
        Map<String, org.redisson.spring.cache.CacheConfig> config = new HashMap<>();
        config.put("userCache", new org.redisson.spring.cache.CacheConfig(10 * 60 * 1000, 10 * 60 * 1000));
        config.put("orderCache", new org.redisson.spring.cache.CacheConfig(30 * 60 * 1000, 30 * 60 * 1000));
        return new RedissonSpringCacheManager(redissonClient, config);
    }
}
```

```java
package com.canoe.redis.service;

import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    /** 第一次查库并写入 Redis（cacheName=userCache），之后直接从 Redis 读 */
    @Cacheable(cacheNames = "userCache", key = "#userId")
    public String getUser(Long userId) {
        System.out.println("查库：" + userId);
        return "user-" + userId;
    }
}
```

::: warning 别忘了 `@EnableCaching`
在启动类或配置类上加 `@EnableCaching` 才会让 `@Cacheable` 生效。若同时引了 `spring-boot-starter-data-redis`，`RedisTemplate` 的序列化可能和 Redisson 不互通——要么统一用 Redisson 缓存管理器，要么明确指定 key/value 的 `Codec`。
:::

## 十一、Redisson 的坑与调优

### 11.1 默认 JDK 序列化 → 改成 JSON

Redisson 默认用 **JDK 序列化**（`Serializable` + 二进制），存在「对象必须实现 `Serializable`、Redis 里看不懂、跨语言不互通」三大问题。生产换成 `JsonJacksonCodec`：

```yaml
spring:
  redis:
    redisson:
      config: |
        singleServerConfig:
          address: "redis://127.0.0.1:6379"
          password: "123456"
        codec: !<org.redisson.codec.JsonJacksonCodec>   # 全站改 JsonJacksonCodec
```

或编程式：

```java
Config config = new Config();
config.useSingleServer().setAddress("redis://127.0.0.1:6379").setPassword("123456");
// 全站默认用 JSON 序列化
config.setCodec(new org.redisson.codec.JsonJacksonCodec());
```

::: tip 进阶：CompositeCodec
「key 用 String、value 用 JSON」是常见组合，可用 `CompositeCodec`：
`new org.redisson.codec.CompositeCodec(new org.redisson.codec.StringCodec(), new org.redisson.codec.JsonJacksonCodec())`。
:::

### 11.2 Netty 线程池与连接池

| 参数 | 默认 | 建议 |
| --- | --- | --- |
| `nettyThreads` | 32 | 高并发可适当提到 64，但别盲目翻倍 |
| `threads` | 16 | 业务回调线程池，按 CPU 核数调 |
| `connectionPoolSize` | 64 | 按真实并发连接数调（QPS 高就加） |
| `connectionMinimumIdleSize` | 24 | 保底空闲连接，避免冷启动建连抖动 |

::: warning 连接数不是越大越好
连接池过大 → Redis 侧 `maxclients` 被打满、文件句柄耗尽。先压测再调，一般 `connectionPoolSize` 设为「预估并发 / 单连接复用倍数」即可，64~128 是常见区间。
:::

### 11.3 看门狗与长事务

`lock()` 不传 leaseTime 会无限续期。如果临界区是个跑几分钟的长事务，等于独占锁几分钟。两种对策：
1. 业务拆小，让临界区尽量短；
2. 用 `tryLock(wait, leaseTime, unit)` 显式给上限（超时就失败，业务要能兜底）。

### 11.4 `RedissonClient` 必须是单例

`RedissonClient` 是重量级对象（内含 Netty 线程池、连接池），**全局一个就够**。不要每次请求 `new` 一个，也不要 `close()` 它（除非应用关闭）。Spring 的 `@Bean` 默认单例，注入即可。

### 11.5 与 `spring-boot-starter-data-redis` 共存冲突

见 2.4 节。一句话：**只引 `redisson-spring-boot-starter` 最省心**；非要两者共存，排除 Redisson 对 `RedisTemplate` 的自动接管（注意排除类名随版本变：`RedissonAutoConfigurationV2` / `V4`）。

### 11.6 锁粒度与 `getHoldCount` 调试

- 锁 key 要**细粒度**（锁到 `productId` 而不是 `global`），否则并发度被锁死。
- 调试时打印 `getHoldCount()`（重入次数）和 `remainTimeToLive()`（剩余过期），快速定位「锁为什么没释放 / 为什么提前释放」。

## 十二、综合实战：秒杀 / 库存扣减

把前面学的「注解限流 + 分布式锁扣库存 + 布隆过滤器防穿透 + 延迟队列关单」串成一个完整秒杀。

**建表 SQL（MySQL）**：

```sql
-- 商品库存表
CREATE TABLE `t_product_stock` (
    `id`          BIGINT PRIMARY KEY AUTO_INCREMENT,
    `product_id`  BIGINT       NOT NULL COMMENT '商品ID',
    `stock`       INT          NOT NULL DEFAULT 0 COMMENT '剩余库存',
    `version`     INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    UNIQUE KEY `uk_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品库存表';

-- 订单表
CREATE TABLE `t_order` (
    `id`          BIGINT PRIMARY KEY AUTO_INCREMENT,
    `order_no`    VARCHAR(64)  NOT NULL COMMENT '订单号',
    `user_id`     BIGINT       NOT NULL COMMENT '用户ID',
    `product_id`  BIGINT       NOT NULL COMMENT '商品ID',
    `buy_count`   INT          NOT NULL COMMENT '购买数量',
    `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '0未支付 1已支付 2已关闭',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_order_no` (`order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表';
```

**限流注解（复用第七节的 `@RateLimit`）**——已在 `com.canoe.redis.annotation.RateLimit` 定义，此处直接用。

**秒杀 Service（锁扣库存 + 布隆防穿透 + 延迟关单）**：

```java
package com.canoe.redis.seckill;

import com.canoe.redis.annotation.RateLimit;
import com.canoe.redis.order.OrderProducerService;
import org.redisson.api.RBloomFilter;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class SeckillService {

    private final RedissonClient redisson;
    private final OrderProducerService orderProducer;

    public SeckillService(RedissonClient redisson, OrderProducerService orderProducer) {
        this.redisson = redisson;
        this.orderProducer = orderProducer;
    }

    /**
     * 秒杀下单：限流 + 防穿透 + 分布式锁扣库存 + 延迟关单
     */
    @RateLimit(key = "seckill", rate = 100, interval = 1)   // 每秒最多 100 次
    public String seckill(Long userId, Long productId, Integer buyCount) {
        // 1) 布隆过滤器防缓存穿透：非法商品 ID 直接挡掉
        RBloomFilter<Long> bloom = redisson.getBloomFilter("bf:product:id");
        if (!bloom.contains(productId)) {
            return "商品不存在";
        }

        // 2) 分布式锁锁商品库存（细粒度到 productId）
        RLock lock = redisson.getLock("lock:stock:" + productId);
        boolean locked = false;
        try {
            locked = lock.tryLock(3, 10, TimeUnit.SECONDS);
            if (!locked) {
                return "活动太火爆，请重试";
            }
            // 3) 查库存（实际用 StockMapper；此处伪代码）
            int stock = queryStock(productId);
            if (stock < buyCount) {
                return "库存不足";
            }
            // 4) 扣库存（实际 UPDATE ... SET stock=stock-buyCount WHERE product_id=? AND stock>=?）
            deductStock(productId, buyCount);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "系统繁忙";
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }

        // 5) 生成订单号并投递「30 分钟关单」延迟消息
        String orderNo = "SO" + System.nanoTime();
        orderProducer.onCreateOrder(1L, productId, buyCount);  // 这里 orderId 用 1L 占位
        return "下单成功，订单号：" + orderNo;
    }

    // —— 以下伪代码替换成你的 Mapper 调用 ——
    private int queryStock(Long productId) { return 100; }
    private void deductStock(Long productId, Integer buyCount) { }
}
```

::: tip 完整链路回顾
1. 入口 `@RateLimit` 挡掉超出 100 QPS 的洪峰；
2. 布隆过滤器挡掉「查不存在商品」的穿透攻击；
3. `RLock` 保证「查库存 + 扣库存」原子，多实例不超卖；
4. 下单成功投递延迟队列，30 分钟未支付自动关单 + 回库存（见 4.3 节消费者）。

生产还要补：库存**预热**到 Redis（避免每次查 DB）、扣库存用 **Lua / 数据库乐观锁**兜底、订单号用 `RIdGenerator` 或雪花算法生成。
:::

## 本篇小结

- **Redisson 是「在 Redis 之上的分布式 Java 对象框架」**，自带 Netty 层，不是 Lettuce 的封装，三者可独立存在。
- **版本红线**：Spring Boot 3.5.5 配 `redisson-spring-boot-starter` **3.52.0**；4.x 才对应 Spring Boot 4.x，版本映射以官方 README 为准。
- **`RLock` 看门狗**：不传 `leaseTime` 才续期（默认 30s，每 10s 续一次）；传了 `leaseTime` 不续期、到点强释，否则 `unlock` 抛 `IllegalMonitorStateException`。
- **`unlock()` 必须放 `finally`** 且用 `isHeldByCurrentThread()` 兜底，否则锁泄漏。
- **`RedLock` 已被官方弃用**，生产改用 `RLock` + 副本同步检查或 `RFencedLock`，本文不推荐使用。
- **`RReadWriteLock`** 适合缓存重建（读读共享、读写互斥）；**`getMultiLock`** 适合转账（同时锁多个资源）。
- **`RDelayedQueue`** 基于 ZSet 延迟转移，是订单 30 分钟关单的利器；消费者监听的是**目标队列**。
- **`RRateLimiter`** 令牌桶 API 为 `trySetRate(RateType, long, long, RateIntervalUnit)` + `tryAcquire()`，可优雅做成注解 + AOP。
- **`RBloomFilter`** 用 `tryInit(n, p)` 初始化，是缓存穿透防护标配；误判率 0.1% 比 1% 只多约 50% 内存。
- **`RIdGenerator` 属于开源社区版**（非 PRO），批量预分配、性能优于 `RAtomicLong`，但 ID 不严格连续。
- **序列化务必改 `JsonJacksonCodec`**；`RedissonClient` 保持单例；与 `data-redis` 共存要排除自动接管避免重复 Bean。

## 参考链接

- [Redisson 官方文档（Integration with Spring）](https://redisson.org/docs/integration-with-spring)
- [Redisson GitHub 仓库](https://github.com/redisson/redisson)
- [Redisson 锁与同步器文档](https://redisson.org/docs/data-and-services/locks-and-synchronizers/)
- [Redisson 分布式对象 / 计数器文档](https://redisson.org/docs/data-and-services/counters/)
- [Redisson Spring Boot 4 兼容性矩阵（版本对照）](https://redisson.pro/blog/redisson-spring-boot-4-compatibility.html)
- [Redisson Maven Central](https://mvnrepository.com/artifact/org.redisson/redisson-spring-boot-starter)
- [Redisson Lock 术语表（含 RedLock 弃用说明）](https://redisson.pro/glossary/redis-lock.html)

下一篇 → [08 高可用、集群与生产调优](/java/middleware/redis/production)
