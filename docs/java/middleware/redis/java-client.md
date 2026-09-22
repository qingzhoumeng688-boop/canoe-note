# 04 Java 客户端实战

> 本篇导读：前面三篇我们一直在用 `redis-cli` 敲命令、用 `StringRedisTemplate` 写几行 Spring 代码。但"用 Java 连 Redis"远不止一个 `StringRedisTemplate`——Jedis、Lettuce、Redisson 三个客户端各有定位：Jedis 简单直接、Lettuce 基于 Netty 天然线程安全且支持异步响应式、Redisson 直接给你分布式锁和布隆过滤器这种"高级对象"。本篇把三个客户端都跑一遍，重点讲清 Spring Data Redis 的 `RedisTemplate` 序列化黑盒（为什么命令行里看到 `\xac\xed` 乱码）、五大类型 API 全家桶、管道/事务、连接池调优，最后用 Testcontainers 写集成测试。读完你能在项目里正确选型、不再被序列化坑、写出的客户端代码既安全又高性能。

## 本篇要解决的问题

- Jedis / Lettuce / Redisson 到底谁线程安全、谁要连接池、Spring Boot 默认用谁？
- `RedisTemplate` 的 key 在 Redis 里变成 `\xac\xed\x00\x05t\x00\x03abc` 这种乱码，命令行看不懂，怎么解决？
- `StringRedisSerializer` / `Jackson2JsonRedisSerializer` / `GenericJackson2JsonRedisSerializer` 三者怎么选？反序列化类型安全和泛型 `List<Order>` 怎么处理？
- `opsForValue/Hash/List/Set/ZSet/Geo/HyperLogLog/Stream` 这些 API 每个怎么用？
- 管道（Pipeline）和事务（multi/exec）在 Spring 里怎么写？`executePipelined` 有什么禁忌？
- 连接池、超时怎么调？Lettuce 为什么默认不开连接池？
- 怎么用 Testcontainers 起个真实 Redis 做单元测试，而不是 mock 到失真？

读完你应该能：独立选客户端、配好序列化、写出覆盖五种类型 + 管道 + 事务 + 监听的健壮 Redis 代码，并配上可重复的集成测试。

## 〇、本篇环境与依赖（完整 pom）

本篇统一用 Spring Boot 3.5.5 管理版本。三个客户端都列进来，你可以按需裁剪。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
                             http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <!-- 统一父工程，版本由父工程管理 -->
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.canoe</groupId>
    <artifactId>redis-client-demo</artifactId>
    <version>1.0.0</version>
    <name>redis-client-demo</name>

    <properties>
        <java.version>17</java.version>
        <maven.compiler.release>17</maven.compiler.release>
        <!-- Jedis 版本：请联网确认 Maven Central 最新稳定版；本文以 6.1.0 为例 -->
        <jedis.version>6.1.0</jedis.version>
        <!-- Redisson 版本：以 Maven Central 最新为准 -->
        <redisson.version>3.30.0</redisson.version>
        <!-- Testcontainers 版本（Spring Boot 父工程已管理，这里显式声明便于阅读） -->
        <testcontainers.version>1.20.4</testcontainers.version>
    </properties>

    <dependencies>
        <!-- Spring 容器 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter</artifactId>
        </dependency>

        <!-- Spring Data Redis：默认带 Lettuce（spring-boot-starter-data-redis 内部依赖 lettuce-core） -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-redis</artifactId>
        </dependency>

        <!-- Jedis：想用 Jedis 时打开。版本由 properties 管理 -->
        <dependency>
            <groupId>redis.clients</groupId>
            <artifactId>jedis</artifactId>
            <version>${jedis.version}</version>
        </dependency>

        <!-- Redisson：分布式对象 / 布隆过滤器 / 分布式锁 -->
        <dependency>
            <groupId>org.redisson</groupId>
            <artifactId>redisson</artifactId>
            <version>${redisson.version}</version>
        </dependency>

        <!-- Jackson Java 8 时间模块 -->
        <dependency>
            <groupId>com.fasterxml.jackson.datatype</groupId>
            <artifactId>jackson-datatype-jsr310</artifactId>
        </dependency>

        <!-- 响应式支持（Lettuce reactive API 依赖 Reactor，spring-boot-starter-data-redis 已间接引入） -->
        <dependency>
            <groupId>io.projectreactor</groupId>
            <artifactId>reactor-core</artifactId>
        </dependency>

        <!-- 测试 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <!-- Testcontainers 起真实 Redis 做集成测试 -->
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>testcontainers</artifactId>
            <version>${testcontainers.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>${testcontainers.version}</version>
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
  data:
    redis:
      host: 127.0.0.1
      port: 6379
      password: ""            # 有密码填这里
      database: 0
      connect-timeout: 5000ms
      timeout: 5000ms         # 命令读写超时
      # Lettuce（Spring Boot 默认客户端）连接池配置
      lettuce:
        pool:
          enabled: false      # Lettuce 单连接可多线程共享，默认不开池；大并发阻塞命令才开
          max-active: 8
          max-idle: 8
          min-idle: 0
          max-wait: -1ms      # -1 表示阻塞等待，直到拿到连接
      # 若引入 Jedis 并排除 lettuce，则用这套池配置（见 3.x 切换说明）
      jedis:
        pool:
          enabled: true
          max-active: 8
          max-idle: 8
          min-idle: 0
          max-wait: -1ms
```

::: tip Windows 同学注意
本文命令行示例默认在 WSL / Linux / 容器内的 `redis-cli` 执行。测试部分用到 Testcontainers，它依赖 Docker Desktop（Windows 上装 Docker Desktop 并开启 WSL2 后端即可），`docker` 守护进程可用时测试自动起一个 Redis 容器。
:::

## 一、三大客户端对比

### 1.1 一张表看懂怎么选

| 维度 | Jedis | Lettuce | Redisson |
| --- | --- | --- | --- |
| 线程安全 | **否**（Jedis 实例非线程安全，需连接池） | **是**（连接本身可多线程共享） | **是** |
| 连接模型 | 连接池（`JedisPool`），每线程借一个 | 单连接复用（基于 Netty），可开池 | 单连接复用（Netty），可开池 |
| 同步 API | 有 | 有（`sync()`） | 有 |
| 异步 API | 有限（`JedisFuture` 较弱） | **有（`async()`，返回 `RedisFuture`）** | 有 |
| 响应式 API | 无 | **有（`reactive()`，返回 `Mono`/`Flux`）** | 无 |
| 集群/哨兵 | 支持 | 支持 | 支持 |
| 分布式对象 | 无 | 无 | **有（分布式锁/Bloom/Map/Queue 等）** |
| Spring Boot 默认 | 否 | **是**（`spring-boot-starter-data-redis` 默认 Lettuce） | 否（需自行整合） |
| 社区活跃度 | 高 | 高 | 高 |

### 1.2 选型结论

- **简单同步、轻量脚本**：用 **Jedis**，API 最直白。
- **Spring Boot 项目默认**：**Lettuce**，零配置、线程安全、支持异步响应式。
- **要分布式锁 / 布隆 / 分布式集合等高级对象**：用 **Redisson**（第 06、07 章展开）。

::: tip 一句话记忆
Spring Boot 默认 **Lettuce**（你啥都不配就是它）；想要"Java 对象直接当 Redis 分布式对象用"才上 **Redisson**；只想简单同步操作、不想碰响应式，用 **Jedis**。三者不是互斥——很多项目同时引 Lettuce（Spring 默认）和 Redisson（高级对象）。
:::

## 二、Jedis 实战

### 2.1 Maven 坐标与版本

```xml
<dependency>
    <groupId>redis.clients</groupId>
    <artifactId>jedis</artifactId>
    <version>${jedis.version}</version>   <!-- 例如 6.1.0，以 Maven Central 为准 -->
</dependency>
```

::: warning 版本差异请以官方最新文档为准
Jedis 的包名长期是 `redis.clients.jedis`，但大版本间有 API 调整：`JedisPooled` 是 4.x 引入的便捷类；6.x 仍以 `new Jedis(host, port)` 为基本入口、`JedisPool` 做池化。本文示例在 4.x / 5.x / 6.x 均适用。具体坐标以 Maven Central 的 `redis.clients:jedis` 最新稳定版为准。
:::

### 2.2 直连 `new Jedis(host, port)` 的问题

```java
package com.canoe.redis;

import redis.clients.jedis.Jedis;

public class JedisDirect {
    public void bad() {
        // 每次 new 都要建一次 TCP 连接（三次握手），用完不关还泄漏；且 Jedis 实例线程不安全
        Jedis jedis = new Jedis("127.0.0.1", 6379);
        jedis.set("k", "v");
        jedis.close();   // 必须关，否则连接泄漏
    }
}
```

**三个坑**：① 每次 `new` 都新建 TCP，高并发下连接风暴；② `Jedis` 实例**线程不安全**，多线程共享会出诡异 bug；③ 忘了 `close()` 连接泄漏。所以生产必须用连接池。

### 2.3 `JedisPool` + `GenericObjectPoolConfig` 完整配置

`src/main/java/com/canoe/redis/JedisPoolConfig.java`：

```java
package com.canoe.redis;

import org.apache.commons.pool2.impl.GenericObjectPoolConfig;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

public class JedisPoolHolder {

    // 用 Apache Commons Pool2 的 GenericObjectPoolConfig 管理池参数
    private static final GenericObjectPoolConfig<Jedis> POOL_CONFIG = new GenericObjectPoolConfig<>();

    static {
        POOL_CONFIG.setMaxTotal(16);          // 池中最大连接数（含借出+空闲）
        POOL_CONFIG.setMaxIdle(8);            // 最大空闲连接
        POOL_CONFIG.setMinIdle(2);            // 最小空闲连接（保活，避免冷启动建连）
        POOL_CONFIG.setMaxWaitMillis(3000);   // 借不到连接时最多等 3 秒，超时抛异常
        POOL_CONFIG.setTestOnBorrow(true);    // 借出时 ping 一下，确保拿到的是活连接
        POOL_CONFIG.setBlockWhenExhausted(true); // 池耗尽时是否阻塞等待（false 则直接报错）
    }

    private static final JedisPool POOL = new JedisPool(POOL_CONFIG, "127.0.0.1", 6379, 5000, "");

    /** 用 try-with-resources 借连接，用完自动归还 */
    public static void use() {
        try (Jedis jedis = POOL.getResource()) {
            jedis.set("k", "v");
            System.out.println(jedis.get("k"));
        }   // 出作用域自动 jedis.close() → 归还池，而非断开
    }
}
```

### 2.4 连接池参数含义与建议值

| 参数 | 含义 | 建议值 | 说明 |
| --- | --- | --- | --- |
| `maxTotal` | 池最大连接总数 | 8~32 | 按并发量定，过大浪费、过小排队 |
| `maxIdle` | 最大空闲连接 | = maxTotal 或略小 | 控制空闲上限 |
| `minIdle` | 最小空闲连接 | 0~maxIdle/2 | 保活，避免突发建连抖动 |
| `maxWaitMillis` | 借连接最大等待 | 1000~3000 | 超时抛 `JedisException`，别设 -1 无限等 |
| `testOnBorrow` | 借出时校验 | true（低延迟可 false） | 防拿到死连接 |
| `blockWhenExhausted` | 耗尽是否阻塞 | true | false 则直接失败，需配合降级 |

### 2.5 Jedis 4.x 的 `JedisPooled`（推荐）

`JedisPooled` 把"从池借连接"藏在内部，API 用起来和直连一样顺手，但底层仍是池化、线程安全。

```java
package com.canoe.redis;

import redis.clients.jedis.JedisPooled;

public class JedisPooledDemo {
    public void good() {
        // JedisPooled 内部维护连接池，方法调用完自动归还，无需 try-with-resources
        try (JedisPooled jedis = new JedisPooled("127.0.0.1", 6379)) {
            jedis.set("k", "v");
            System.out.println(jedis.get("k"));
        }
    }
}
```

### 2.6 Pipeline 批量（性能关键）

逐条发命令有"网络往返 RTT"开销；Pipeline 把多条命令打包一次发送，大幅降低 RTT。

```java
package com.canoe.redis;

import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.Pipeline;
import org.apache.commons.pool2.impl.GenericObjectPoolConfig;

import java.util.List;

public class JedisPipeline {

    private static final JedisPool POOL = new JedisPool(new GenericObjectPoolConfig<>(), "127.0.0.1", 6379);

    public void batch() {
        try (Jedis jedis = POOL.getResource()) {
            Pipeline pip = jedis.pipelined();
            for (int i = 0; i < 10000; i++) {
                pip.set("p:" + i, "v" + i);   // 不立即发，攒在管道里
            }
            // sync() 一次性发送并拿回所有结果
            List<Object> results = pip.sync();
            System.out.println("批量写入 " + results.size() + " 条");
        }
    }

    /** 性能对比说明：逐条 1 万次 set 约 1~2 秒（受 RTT 影响），Pipeline 约 20~50 毫秒，快几十倍。 */
    public void oneByOne() {
        try (Jedis jedis = POOL.getResource()) {
            for (int i = 0; i < 10000; i++) {
                jedis.set("p:" + i, "v" + i);   // 每次都一次网络往返
            }
        }
    }
}
```

### 2.7 Lua 脚本：`eval` 与 `scriptLoad` + `evalsha`

```java
package com.canoe.redis;

import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import org.apache.commons.pool2.impl.GenericObjectPoolConfig;

import java.util.List;

public class JedisLua {

    private static final JedisPool POOL = new JedisPool(new GenericObjectPoolConfig<>(), "127.0.0.1", 6379);

    public void evalDemo() {
        String script = "redis.call('set', KEYS[1], ARGV[1]) return redis.call('get', KEYS[1])";
        try (Jedis jedis = POOL.getResource()) {
            // 直接 eval：每次都传脚本原文（Redis 会缓存）
            Object r1 = jedis.eval(script, List.of("k"), List.of("v"));
            System.out.println(r1);

            // 先 scriptLoad 拿 sha1，之后用 evalsha 省带宽（脚本长时更优）
            String sha = jedis.scriptLoad(script);
            Object r2 = jedis.evalsha(sha, List.of("k"), List.of("v2"));
            System.out.println(r2);
        }
    }
}
```

### 2.8 事务：`multi` / `exec` / `discard` + `WATCH` 乐观锁

```java
package com.canoe.redis;

import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.Transaction;
import org.apache.commons.pool2.impl.GenericObjectPoolConfig;

import java.util.List;

public class JedisTx {

    private static final JedisPool POOL = new JedisPool(new GenericObjectPoolConfig<>(), "127.0.0.1", 6379);

    public void tx() {
        try (Jedis jedis = POOL.getResource()) {
            // WATCH 乐观锁：监控 balance，若事务提交前被别人改了，exec 返回 null（需重试）
            jedis.watch("balance");
            Transaction t = jedis.multi();      // 开启事务
            t.decrBy("balance", 10);            // 扣款
            t.incrBy("points", 1);              // 加积分
            List<Object> res = t.exec();        // 提交；返回每条命令结果；被抢改则返回 null
            if (res == null) {
                System.out.println("被并发修改，事务中止，需重试");
            } else {
                System.out.println("事务成功：" + res);
            }
        }
    }

    public void discardDemo() {
        try (Jedis jedis = POOL.getResource()) {
            Transaction t = jedis.multi();
            t.set("tmp", "1");
            t.discard();   // 放弃事务，上述命令不执行
        }
    }
}
```

### 2.9 封装一个 `JedisUtil` 工具类

`src/main/java/com/canoe/redis/JedisUtil.java`：

```java
package com.canoe.redis;

import org.apache.commons.pool2.impl.GenericObjectPoolConfig;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

import java.util.Optional;

/**
 * 极简 Jedis 工具类：封装 get/set/expire/del/incr，统一从池借还。
 * 真实项目可结合 Spring 用 @Component 包一层，这里用静态方法演示。
 */
public final class JedisUtil {

    private static final JedisPool POOL;

    static {
        GenericObjectPoolConfig<Jedis> cfg = new GenericObjectPoolConfig<>();
        cfg.setMaxTotal(16);
        cfg.setMaxIdle(8);
        cfg.setMinIdle(2);
        cfg.setMaxWaitMillis(3000);
        cfg.setTestOnBorrow(true);
        POOL = new JedisPool(cfg, "127.0.0.1", 6379, 5000, "");
    }

    private JedisUtil() {}

    public static void set(String key, String value) {
        try (Jedis j = POOL.getResource()) {
            j.set(key, value);
        }
    }

    public static void setex(String key, int seconds, String value) {
        try (Jedis j = POOL.getResource()) {
            j.setex(key, seconds, value);   // SETEX：带过期
        }
    }

    public static Optional<String> get(String key) {
        try (Jedis j = POOL.getResource()) {
            return Optional.ofNullable(j.get(key));
        }
    }

    public static boolean expire(String key, int seconds) {
        try (Jedis j = POOL.getResource()) {
            return j.expire(key, seconds) == 1L;
        }
    }

    public static boolean del(String key) {
        try (Jedis j = POOL.getResource()) {
            return j.del(key) == 1L;
        }
    }

    public static long incr(String key) {
        try (Jedis j = POOL.getResource()) {
            return j.incr(key);
        }
    }

    public static void close() {
        POOL.close();
    }
}
```

## 三、Lettuce 实战

### 3.1 Maven 坐标

```xml
<dependency>
    <groupId>io.lettuce</groupId>
    <artifactId>lettuce-core</artifactId>
    <!-- 版本由 spring-boot-starter-parent 统一管理；独立使用可在此声明，如 6.5.x -->
</dependency>
```

::: tip 和 Jedis 最大的不同：连接本身线程安全
Lettuce 基于 Netty，**一个 `StatefulRedisConnection` 可以被多个线程同时共享**（只要别在多线程里做阻塞/事务这类"占住连接"的操作）。所以 Lettuce 默认"单连接复用"，不强制要池——这是和 Jedis（每线程一个连接、非线程安全）的本质区别。
:::

### 3.2 三种 API：同步 / 异步 / 响应式

`src/main/java/com/canoe/redis/LettuceDemo.java`：

```java
package com.canoe.redis;

import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.async.RedisAsyncCommands;
import io.lettuce.core.api.reactive.RedisReactiveCommands;
import io.lettuce.core.api.sync.RedisCommands;
import io.lettuce.core.RedisFuture;

import reactor.core.publisher.Mono;

import java.util.concurrent.TimeUnit;

public class LettuceDemo {

    public void sync() {
        // 1) 用 RedisURI 拼连接（支持密码、库号）
        RedisURI uri = RedisURI.builder()
                .withHost("127.0.0.1").withPort(6379)
                .withPassword("".toCharArray()).withDatabase(0)
                .build();
        RedisClient client = RedisClient.create(uri);

        // 2) connect() 拿到一个线程安全的连接
        try (StatefulRedisConnection<String, String> connection = client.connect()) {
            // 3) 同步 API：方法名 = 小写命令名
            RedisCommands<String, String> sync = connection.sync();
            sync.set("k", "v");
            System.out.println(sync.get("k"));

            // 4) 异步 API：返回 RedisFuture（实现了 Future / CompletionStage）
            RedisAsyncCommands<String, String> async = connection.async();
            RedisFuture<String> future = async.get("k");
            // 配合 CompletableFuture / get(timeout) 拿结果
            String val = future.get(5, TimeUnit.SECONDS);
            System.out.println(val);

            // 5) 响应式 API（Project Reactor）：返回 Mono / Flux
            RedisReactiveCommands<String, String> reactive = connection.reactive();
            Mono<String> mono = reactive.get("k");
            mono.subscribe(System.out::println);   // 仅订阅触发执行
        }

        // 6) 关闭资源：先关连接，再关 client
        client.shutdown();
    }
}
```

### 3.3 异步结果处理要点

- 异步 `RedisFuture` 是 `java.util.concurrent.CompletionStage` 的子接口，能用 `thenApply` / `thenAccept` 串起来，也能 `future.get(timeout, unit)` 阻塞取。
- 响应式 `Mono`/`Flux` 是 Reactor 类型，`subscribe()` 才真正执行；适合高并发、背压场景，WebFlux 项目天然契合。

### 3.4 关闭资源

```java
connection.close();   // 关单个连接（归还/释放底层资源）
client.shutdown();    // 关客户端，释放 EventLoop 线程池
```

::: warning 别忘了 shutdown
Lettuce 底层是 Netty EventLoop 线程池，`RedisClient` 不 `shutdown()` 会导致 JVM 无法正常退出（后台线程常驻）。Spring 环境下 `LettuceConnectionFactory` 由容器管理、随应用关闭，无需你手动关。
:::

## 四、Spring Data Redis 核心

### 4.1 `RedisConnectionFactory` 两个实现与切换

`spring-boot-starter-data-redis` 默认自动装配 **`LettuceConnectionFactory`**。想换成 Jedis：

1. 排除 starter 里的 Lettuce：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
    <exclusions>
        <exclusion>
            <groupId>io.lettuce</groupId>
            <artifactId>lettuce-core</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<dependency>
    <groupId>redis.clients</groupId>
    <artifactId>jedis</artifactId>
    <version>${jedis.version}</version>
</dependency>
```

2. 配 `spring.redis.jedis.pool.*`（见 〇 的 `application.yml`），Spring Boot 会自动装配 **`JedisConnectionFactory`**。

### 4.2 四大序列化器：存进去的是什么、取出来的是什么

`RedisTemplate` 有 4 个序列化位：

| 序列化器位置 | 作用对象 | 默认 | 你该设成啥 |
| --- | --- | --- | --- |
| `keySerializer` | key | `JdkSerializationRedisSerializer` | `StringRedisSerializer`（可读） |
| `valueSerializer` | value | `JdkSerializationRedisSerializer` | JSON 序列化（见 4.3） |
| `hashKeySerializer` | Hash 的 field | `JdkSerializationRedisSerializer` | `StringRedisSerializer` |
| `hashValueSerializer` | Hash 的 value | `JdkSerializationRedisSerializer` | JSON 序列化 |

### 4.3 默认 JDK 序列化的坑（重点）

**没配置序列化时，`RedisTemplate` 全部用 JDK 序列化**，于是你把字符串 `"abc"` 存进去，Redis 里看到的是：

```text
\xac\xed\x00\x05t\x00\x03abc
```

`\xac\xed\x00\x05` 是 Java 序列化魔数 + 类型标记，`t\x00\x03` 表示后面是个 3 字节字符串——**命令行里根本看不懂，别的语言也读不了**。而且 key 也被序列化，导致 `redis-cli GET abc` 取不到（真实 key 是 `\xac\xed...abc`）。

### 4.4 三种序列化方案对比

| 方案 | 存的样子 | 跨语言 | 反序列化 | 风险 |
| --- | --- | --- | --- | --- |
| `StringRedisSerializer` | 纯 UTF-8 | 完美 | 直接得 String | 只能存字符串 |
| `Jackson2JsonRedisSerializer`（不带类型） | 纯 JSON | 好 | 反序列化成 `LinkedHashMap`，需手动指定目标类 | 类型信息丢失 |
| `GenericJackson2JsonRedisSerializer`（带 `@class`） | JSON 里带 `@class` | 一般 | 能自动转回原对象 | 反序列化安全/包路径风险 |

### 4.5 完整的 `RedisConfig.java`

`src/main/java/com/canoe/redis/RedisConfig.java`：

```java
package com.canoe.redis;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

/**
 * 统一配置 RedisTemplate<String, Object>：
 * - key / hashKey 用 String（命令行可读）
 * - value / hashValue 用 JSON（可读 + 可反序列化对象）
 */
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);

        // 自定义 ObjectMapper：支持 Java 8 时间、关时间戳、忽略未知属性
        ObjectMapper om = new ObjectMapper();
        om.registerModule(new JavaTimeModule());
        om.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        om.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        om.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);

        // key / hashKey 一律 String
        StringRedisSerializer stringSerializer = new StringRedisSerializer();
        // value / hashValue 用带类型信息的 Jackson（存 @class，能自动转回对象）
        GenericJackson2JsonRedisSerializer jsonSerializer =
                new GenericJackson2JsonRedisSerializer(om);

        template.setKeySerializer(stringSerializer);
        template.setHashKeySerializer(stringSerializer);
        template.setValueSerializer(jsonSerializer);
        template.setHashValueSerializer(jsonSerializer);
        template.afterPropertiesSet();
        return template;
    }

    /** 纯字符串专用模板：key/value 全 String，最直观，命令行友好 */
    @Bean
    public StringRedisTemplate stringRedisTemplate(RedisConnectionFactory factory) {
        return new StringRedisTemplate(factory);
    }
}
```

::: tip StringRedisTemplate vs RedisTemplate 怎么选
- **`StringRedisTemplate`**：`RedisTemplate<String, String>` 特化，四个序列化器全是 `StringRedisSerializer`。适合"key/value 都是字符串"的简单场景（如计数器、Token），命令行直接 `GET` 可读。
- **`RedisTemplate<String, Object>`**：value 能存任意 Java 对象（经 JSON 序列化）。适合"把对象缓存进 Redis"。注意 Hash 的 field/value 同样走序列化器。
- 两者共用同一个 `RedisConnectionFactory`，可同时注入，互不冲突。
:::

## 五、RedisTemplate API 全家桶

### 5.1 `opsForValue()`：字符串

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

@Component
public class ValueOps {

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void demo() {
        ValueOperations<String, String> ops = redisTemplate.opsForValue();

        ops.set("k", "v");                       // SET
        String v = ops.get("k");                 // GET
        // SETNX：不存在才写，返回是否写入成功（分布式锁基础）
        Boolean ok = ops.setIfAbsent("lock", "1", Duration.ofSeconds(10)); // SET k v EX 10 NX
        // SETXX：存在才写
        Boolean updated = ops.setIfPresent("k", "v2");
        // 原子自增
        Long n = ops.increment("counter");
        Long n2 = ops.increment("counter", 5);   // 自增指定步长
        // 取旧值并设新值
        String old = ops.getAndSet("k", "new");
        // 批量写
        ops.multiSet(java.util.Map.of("a", "1", "b", "2"));
        // 过期时间重载：set 同时设过期（推荐用 Duration 或 TimeUnit 重载）
        ops.set("k2", "v2", 30, TimeUnit.SECONDS);
    }
}
```

### 5.2 `opsForHash()`：哈希

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class HashOps {

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void demo() {
        HashOperations<String, String, String> ops = redisTemplate.opsForHash();

        ops.put("user:1", "name", "张三");        // HSET
        String name = ops.get("user:1", "name");  // HGET
        ops.putAll("user:1", Map.of("age", "18", "city", "北京")); // HMSET
        Map<String, String> all = ops.entries("user:1");          // HGETALL
        Boolean has = ops.hasKey("user:1", "name");               // HEXISTS
        Long age = ops.increment("user:1", "age", 1);             // HINCRBY
        ops.delete("user:1", "city");                             // HDEL
        Set<String> fields = ops.keys("user:1");                  // HKEYS
        List<String> values = ops.values("user:1");               // HVALS
        Long size = ops.size("user:1");                           // HLEN
        // 安全遍历大 Hash（HSCAN），避免 HGETALL 阻塞
        try (var cursor = ops.scan("user:1")) {
            cursor.forEachRemaining(entry -> System.out.println(entry.getKey() + "=" + entry.getValue()));
        }
    }
}
```

### 5.3 `opsForList()`：列表

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ListOps {

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void demo() {
        ListOperations<String, String> ops = redisTemplate.opsForList();

        ops.leftPush("queue", "a");              // LPUSH
        ops.rightPush("queue", "b");            // RPUSH
        List<String> range = ops.range("queue", 0, -1); // LRANGE 全量
        Long size = ops.size("queue");          // LLEN
        String left = ops.leftPop("queue");     // LPOP
        String right = ops.rightPop("queue");   // RPOP
        // 阻塞弹出：队列空时最多等 5 秒（BRPOP 语义），做可靠队列
        String blocked = ops.leftPop("queue", java.time.Duration.ofSeconds(5));
        ops.trim("queue", 0, 99);               // LTRIM 只留最新 100 条
        Long removed = ops.remove("queue", 1, "a"); // LREM 删前 1 个 "a"
        String idx = ops.index("queue", 0);     // LINDEX 取第 0 个
    }
}
```

### 5.4 `opsForSet()`：集合

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Set;

@Component
public class SetOps {

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void demo() {
        SetOperations<String, String> ops = redisTemplate.opsForSet();

        ops.add("tags", "redis", "java", "redis"); // SADD（重复自动去重）
        Set<String> members = ops.members("tags"); // SMEMBERS
        Boolean isMember = ops.isMember("tags", "java"); // SISMEMBER
        Long size = ops.size("tags");              // SCARD
        Set<String> inter = ops.intersect("tags", "tags2");  // SINTER 共同
        Set<String> union = ops.union("tags", "tags2");      // SUNION
        Set<String> diff = ops.difference("tags", "tags2");  // SDIFF 差集
        String pop = ops.pop("tags");              // SPOP 随机弹一个（不可重复）
        String rand = ops.randomMember("tags");    // SRANDMEMBER 随机取（可重复）
        // 安全遍历大 Set（SSCAN）
        try (var cursor = ops.scan("tags")) {
            cursor.forEachRemaining(System.out::println);
        }
    }
}
```

### 5.5 `opsForZSet()`：有序集合

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Component;

import java.util.Set;

@Component
public class ZSetOps {

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void demo() {
        ZSetOperations<String, String> ops = redisTemplate.opsForZSet();

        ops.add("rank", "u1", 100);              // ZADD
        Set<String> top = ops.range("rank", 0, 9); // ZRANGE 前 10（按分数升序）
        // 带分数、降序取前 10（排行榜）
        Set<ZSetOperations.TypedTuple<String>> topWithScore =
                ops.reverseRangeWithScores("rank", 0, 9);  // ZREVRANGE ... WITHSCORES
        Long rank = ops.rank("rank", "u1");      // ZRANK 排名（从 0）
        Double score = ops.score("rank", "u1"); // ZSCORE
        Double newScore = ops.incrementScore("rank", "u1", 10); // ZINCRBY
        ops.remove("rank", "u1");                // ZREM
        // 按分数区间取（闭区间）
        Set<String> byScore = ops.rangeByScore("rank", 80, 100); // ZRANGEBYSCORE
        Long count = ops.count("rank", 80, 100); // ZCOUNT
        Long size = ops.size("rank");            // ZCARD
    }
}
```

### 5.6 `opsForGeo()` / `opsForHyperLogLog()` / `opsForStream()`

这三个在第 03 篇已详细写过，这里给入口对照：

| 类型 | 入口 | 返回对象 |
| --- | --- | --- |
| GEO | `opsForGeo()` | `GeoOperations<String, String>` |
| HyperLogLog | `opsForHyperLogLog()` | `HyperLogLogOperations<String, String>` |
| Stream | `opsForStream()` | `StreamOperations<String, String, ?>` |

用法见 `advanced-types.md` 第三章、第二章、第四章的完整示例，本篇不再重复贴大段代码。

### 5.7 `BoundXXXOperations`：绑定 key 少传参

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.BoundValueOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

@Component
public class BoundOps {

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void demo() {
        // boundValueOps("user:1") 把 key 绑死，后续不再传 key
        BoundValueOperations<String, String> bound = redisTemplate.boundValueOps("user:1");
        bound.set("张三");
        String v = bound.get();
        bound.expire(java.time.Duration.ofHours(1));
        // 同理：boundHashOps / boundListOps / boundSetOps / boundZSetOps
    }
}
```

### 5.8 `executePipelined`：批量执行（注意禁忌）

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class PipelineOps {

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void batch() {
        // 把多条命令在管道里发出去，返回值是每条命令结果的 List
        List<Object> results = redisTemplate.executePipelined((RedisCallback<Object>) conn -> {
            conn.set("p1".getBytes(), "1".getBytes());
            conn.set("p2".getBytes(), "2".getBytes());
            // 注意：管道内不要依赖"前面命令的返回值"做判断，因为结果要等 sync 后才回来
            return null;   // 回调返回值会被忽略，真正结果在 List 里
        });
        System.out.println("批量结果：" + results);
    }
}
```

::: danger 管道内不要做"读取依赖结果"的逻辑
`executePipelined` 里所有命令是**攒批一起发**的，回调的返回值被忽略，结果统一在返回的 `List<Object>` 里。如果你在回调里写了"先 `get` 再判断再 `set`"，拿到的不是真实值（还只是个未完成的占位），逻辑会错。需要"读-改-写"依赖请用 Lua 脚本或事务。
:::

### 5.9 `execute(RedisCallback)`：拿原生连接

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

@Component
public class RawOps {

    @Autowired
    private StringRedisTemplate redisTemplate;

    /** 执行任意 Redis 命令（第 03 篇 BitMap 的 BITCOUNT/BITOP/BITFIELD 就用这招） */
    public Long bitCount(String key) {
        return redisTemplate.execute((RedisCallback<Long>) conn ->
                conn.bitCount(key.getBytes()));
    }
}
```

### 5.10 `SessionCallback` + 事务

```java
package com.canoe.redis;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisOperations;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class TxOps {

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    public void tx() {
        // SessionCallback 保证 multi/exec 在同一连接上，否则事务失效
        List<Object> result = redisTemplate.execute(new SessionCallback<>() {
            @Override
            public Object execute(RedisOperations operations) {
                operations.multi();                 // MULTI
                operations.opsForValue().increment("a");
                operations.opsForValue().increment("b");
                return operations.exec();          // EXEC，返回各命令结果
            }
        });
        System.out.println("事务结果：" + result);
    }
}
```

### 5.11 监听 key 过期事件：`KeyExpirationEventMessageListener`

```java
package com.canoe.redis;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.KeyExpirationEventMessageListener;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

@Configuration
public class KeyExpiryConfig {

    @Bean
    public RedisMessageListenerContainer container(RedisConnectionFactory factory) {
        RedisMessageListenerContainer c = new RedisMessageListenerContainer();
        c.setConnectionFactory(factory);
        return c;
    }

    @Bean
    public KeyExpirationEventMessageListener listener(RedisMessageListenerContainer container) {
        return new KeyExpirationEventMessageListener(container) {
            @Override
            public void onMessage(Message message, byte[] pattern) {
                String expiredKey = message.toString();
                // 注意：过期事件只能拿到 key，拿不到 value（已删除）
                System.out.println("key 过期了：" + expiredKey);
            }
        };
    }
}
```

::: danger 过期事件不是可靠的定时任务
Redis 的 key 过期靠**惰性删除 + 定期抽样删除**：key 真正过期那一刻不会立刻触发事件，要等被访问或抽样扫到才"认定过期"，所以事件**可能延迟、甚至可能丢**。而且过期事件**只能带 key、不带 value**。因此**绝不能用它做精确定时任务**（如"订单 30 分钟未支付自动关单"），这种需求请用专门的延迟队列 / 定时调度框架。
:::

## 六、序列化深入

### 6.1 `@class` 带来的反序列化安全问题

`GenericJackson2JsonRedisSerializer` 会在 JSON 里写 `"@class": "com.canoe.redis.User"`，反序列化时按这个类名 `new` 对象。风险：

- **包路径/类名漂移**：类重构改名后旧数据反序列化失败。
- **反序列化 gadget 攻击**：若 `@class` 指向攻击者可控的类，可能触发危险构造（虽 Redis 数据一般内网可信，但多租户/不可信写入场景要警惕）。

::: warning 版本差异请以官方最新文档为准
Spring 对 `GenericJackson2JsonRedisSerializer` 的默认 `ObjectMapper` 在不同版本有调整（是否开启 `default typing` 等）。生产若用带类型序列化，建议**显式配置白名单**或改用"不带类型的序列化器 + 手动指定目标类型"。具体以你所用 Spring Data Redis 版本官方文档为准。
:::

### 6.2 反序列化类型安全的两种做法

**做法 A（推荐、最稳）**：用 `StringRedisSerializer` 存 JSON 字符串，读取时手动指定类型。

```java
package com.canoe.redis;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class SafeDeserialize {

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private ObjectMapper objectMapper;   // 与 RedisConfig 中同一个 ObjectMapper

    public void saveOrder(Order order) throws Exception {
        // 自己把对象转 JSON 字符串再存（用 StringRedisTemplate，value 就是纯 JSON）
        redisTemplate.opsForValue().set("order:" + order.getId(),
                objectMapper.writeValueAsString(order));
    }

    /** 泛型 List<Order> 反序列化：用 TypeReference 锁住泛型，避免变成 List<LinkedHashMap> */
    public List<Order> loadOrders() throws Exception {
        String json = redisTemplate.opsForValue().get("orders");
        return objectMapper.readValue(json, new TypeReference<List<Order>>() {});
    }

    /** 简单对象反序列化：直接指定 Class */
    public Order loadOrder(String id) throws Exception {
        String json = redisTemplate.opsForValue().get("order:" + id);
        return objectMapper.readValue(json, Order.class);
    }
}
```

**做法 B**：沿用 `GenericJackson2JsonRedisSerializer`（带 `@class`），由框架自动转回对象，但务必校验白名单。

::: tip 为什么泛型 `List<Order>` 不能直接 `readValue(json, List.class)`
`List.class` 丢失了元素类型信息，Jackson 只能把每个元素反序列化成 `LinkedHashMap`——你拿到的是 `List<LinkedHashMap>`，强转 `List<Order>` 会 `ClassCastException`。必须用 `new TypeReference<List<Order>>() {}` 把泛型"钉死"，Jackson 才能正确还原成 `Order`。
:::

## 七、连接池与超时调优

### 7.1 Lettuce 开连接池：`LettucePoolingClientConfiguration`

Lettuce 默认**单连接共享、不开池**。以下场景才需要开池：大并发下大量**阻塞命令**（`BLPOP`/`XREAD BLOCK`/`SUBSCRIBE`）会长期占住连接，导致其他线程拿不到连接——此时开池让阻塞命令各自占一条连接。

```java
package com.canoe.redis;

import io.lettuce.core.RedisURI;
import io.lettuce.core.resource.ClientResources;
import io.lettuce.core.resource.DefaultClientResources;
import org.apache.commons.pool2.impl.GenericObjectPoolConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettucePoolingClientConfiguration;

import java.time.Duration;

@Configuration
public class LettucePoolConfig {

    @Bean
    public RedisConnectionFactory lettuceFactory() {
        RedisURI uri = RedisURI.builder()
                .withHost("127.0.0.1").withPort(6379)
                .withTimeout(Duration.ofSeconds(5))   // 命令超时
                .build();

        // 池配置
        GenericObjectPoolConfig<Object> poolConfig = new GenericObjectPoolConfig<>();
        poolConfig.setMaxTotal(16);
        poolConfig.setMaxIdle(8);
        poolConfig.setMinIdle(2);

        // 开启池 + 设命令超时 / 关闭超时
        LettucePoolingClientConfiguration poolConf = LettucePoolingClientConfiguration.builder()
                .poolConfig(poolConfig)
                .commandTimeout(Duration.ofSeconds(5))    // commandTimeout
                .shutdownTimeout(Duration.ofSeconds(2))   // shutdownTimeout：client 关闭等待
                .build();

        ClientResources resources = DefaultClientResources.create();
        return new LettuceConnectionFactory(uri, poolConf, resources);
    }
}
```

::: tip 为什么 Lettuce 默认不开连接池
因为 `StatefulRedisConnection` 本身是**线程安全**的，一个连接就能被 N 个线程并发发非阻塞命令（底层 Netty 串行化），池化反而增加开销和连接数。只有"阻塞命令长时间占连接"时才需要池化隔离。Jedis 因为连接非线程安全，才**必须**池化。
:::

### 7.2 超时参数

| 参数 | 含义 | 建议 |
| --- | --- | --- |
| `connect-timeout` | 建连超时 | 2000~5000ms |
| `timeout` / `commandTimeout` | 单条命令读写超时 | 3000~5000ms，别太长 |
| `shutdownTimeout` | 客户端关闭等待 | 1000~2000ms |
| 池 `max-wait` | 借连接等待 | 1000~3000ms，超时降级 |

## 八、单元测试：Testcontainers 起真实 Redis

mock `RedisTemplate` 测出来的代码，上线一跑就崩（mock 不会暴露序列化/类型问题）。用 Testcontainers 起一个真实 Redis 容器做集成测试最贴近生产。

`src/test/java/com/canoe/redis/RedisIntegrationTest.java`：

```java
package com.canoe.redis;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

@Testcontainers
public class RedisIntegrationTest {

    // 启动一个 Redis 7 容器，映射 6379；withReuse(true) 可在多次测试间复用
    @Container
    public static final GenericContainer<?> REDIS =
            new GenericContainer<>("redis:7").withExposedPorts(6379);

    @Test
    void setAndGet() {
        // 用容器动态分配的地址/端口建连接工厂
        RedisStandaloneConfiguration cfg = new RedisStandaloneConfiguration(
                REDIS.getHost(), REDIS.getFirstMappedPort());
        LettuceConnectionFactory factory = new LettuceConnectionFactory(cfg);
        factory.afterPropertiesSet();

        StringRedisTemplate template = new StringRedisTemplate(factory);
        template.opsForValue().set("k", "v");
        Assertions.assertEquals("v", template.opsForValue().get("k"));

        factory.destroy();   // 释放连接
    }
}
```

::: tip 没有 Docker 怎么办
- **`embedded-redis` / `redis-embedded`**：在 JVM 内嵌一个 Redis 进程（适合无 Docker 环境），但维护较少、版本滞后。
- **本地已装 Redis**：测试前手动 `redis-server`，测试直接连 `127.0.0.1:6379`，简单直接。
- 生产 CI 仍推荐 Testcontainers（标准、版本可控）。
:::

## 九、客户端选型与踩坑清单

1. **Spring Boot 默认 Lettuce**：你不排除它、不配 Jedis，跑的就是 Lettuce，别怀疑。
2. **Jedis 实例非线程安全**：绝不把 `Jedis` 当单例共享，必须走 `JedisPool`/`JedisPooled`。
3. **没配序列化 → key 变成 `\xac\xed...`**：命令行看不懂、跨语言读不了，务必配 `StringRedisSerializer` 做 key。
4. **`GET` 取不到自己 `SET` 的 key**：多半是 key 被 JDK 序列化了，`redis-cli` 里的 key 和你以为的 key 不是同一个字符串。
5. **泛型 `List<Order>` 反序列化**：用 `TypeReference`，别用 `List.class`（会变成 `LinkedHashMap`）。
6. **管道内别依赖读取结果**：读-改-写依赖用 Lua 或事务。
7. **过期事件不是定时任务**：延迟、丢事件、不带 value，别用来做关单/调度。
8. **Lettuce 记得 `shutdown`**：非 Spring 环境不关会导致 JVM 不退。
9. **大并发阻塞命令要开 Lettuce 池**：否则阻塞命令占满单连接，其他线程饿死。
10. **测试用 Testcontainers**：别只 mock，序列化/类型问题只有真 Redis 才暴露。

## 本篇小结

- **三大客户端**：Jedis（同步、需池、简单）、Lettuce（Spring Boot 默认、线程安全、支持异步响应式）、Redisson（分布式对象/锁/布隆）。
- **Spring Boot 默认 Lettuce**：排除它并引 `jedis` 才能切到 `JedisConnectionFactory`，池配 `spring.redis.jedis.pool.*`。
- **四大序列化器**：key/hashKey 用 `StringRedisSerializer`，value/hashValue 用 JSON 序列化，否则 key 变 `\xac\xed` 乱码。
- **默认 JDK 序列化坑**：命令行看不懂、跨语言读不了、key 对不上——务必自定义 `RedisTemplate<String, Object>`。
- **三种序列化取舍**：`StringRedisSerializer`（纯串）、`Jackson2JsonRedisSerializer`（无类型、需手指定类）、`GenericJackson2JsonRedisSerializer`（带 `@class`、有安全/重构风险）。
- **API 全家桶**：`opsForValue/Hash/List/Set/ZSet/Geo/HyperLogLog/Stream` 一一对应五种基本 + 高级类型；`boundXxxOps` 绑定 key 少传参。
- **管道用 `executePipelined`**，但**内部不要依赖读结果**；读-改-写依赖用 Lua / 事务（`SessionCallback` + `multi/exec`，且必须在同一连接）。
- **过期事件不可靠**：延迟、丢事件、无 value，不做定时任务。
- **Lettuce 默认不开池**：单连接线程安全够用；阻塞命令密集才开 `LettucePoolingClientConfiguration`。
- **泛型反序列化**：`List<Order>` 用 `new TypeReference<List<Order>>() {}`，否则成 `LinkedHashMap`。
- **集成测试用 Testcontainers**：起真实 Redis，比 mock 更贴近生产，能暴露序列化与类型问题。

## 参考链接

- Spring Data Redis 官方文档（客户端/模板/序列化）：<https://docs.spring.io/spring-data/redis/docs/current/reference/html/>
- Jedis GitHub 与文档：<https://github.com/redis/jedis>
- Lettuce 官方文档：<https://lettuce.io/>
- Lettuce `RedisClient` / `StatefulRedisConnection` API：<https://redis.io/docs/latest/develop/clients/lettuce/>
- Redisson 官方文档（分布式对象/布隆/锁）：<https://github.com/redisson/redisson/wiki>
- Testcontainers Redis 模块：<https://java.testcontainers.org/modules/redis/>
- Redis 序列化与 `RedisTemplate` 配置（Spring 博客）：<https://spring.io/blog/>

下一篇 → [05 Spring Boot 缓存实战](/java/middleware/redis/springboot-cache)
