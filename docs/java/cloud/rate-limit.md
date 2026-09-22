# 07 限流熔断降级

> 本篇导读：一个下游接口变慢，调用方线程被占满，上游也被拖慢，最后整条链路雪崩——这是分布式系统最常见的灾难。限流、熔断、降级就是用来给系统"装保险丝"的三件套。本文从三兄弟的关系讲起，逐个拆解四种限流算法，再讲熔断状态机、降级、隔离，最后落到 Sentinel 实战与容量规划。

## 一、三兄弟的关系

先一句话区分：

- **限流（Rate Limit）**：控制**进来的量**。像地铁早高峰限流，排队慢慢进。
- **熔断（Circuit Breaker）**：**下游挂了就别调了**。像保险丝烧断，直接跳闸保护上游。
- **降级（Degrade）**：**资源不够时关掉非核心功能**。像节假日关掉评论区，保住下单主链路。

它们在流量链路上的位置：

```text
           客户端请求
              |
              v
   ┌──── 限流（入口控制流量）────┐
   |                            |
   v                            v
 核心链路                      非核心链路
   |                            |
   |  调用下游                   |
   v                            |
 ┌──── 熔断（下游慢/挂就跳闸）────┘
   |
   v
 降级（兜底/关非核心）
```

## 二、为什么需要

核心原因是**雪崩效应**：一个服务变慢 → 调用方线程池被占满 → 调用方也变慢 → 调用方的上游也被拖慢 → 全链路崩溃。

```text
正常：  服务A → 服务B(50ms) → 服务C

雪崩：
服务C 变慢(2s)
  → 服务B 的线程卡在等 C，线程池耗尽
  → 服务B 也变慢，线程卡在等 B
  → 服务A 线程耗尽
  → 整条链路挂掉，连不依赖 C 的接口也挂了
```

限流/熔断/降级就是在这一连串崩塌发生前，把"坏味道"隔离在最小范围。

## 三、限流算法之一：固定窗口计数器

把时间切成固定窗口（如 1 秒），每个窗口内维护一个计数器，超过阈值就拒绝。

```java
package com.canoe.cloud.ratelimit;

import java.util.concurrent.atomic.AtomicLong;

// 固定窗口计数器：每 1 秒一个窗口，超过阈值拒绝
public class FixedWindowDemo {

    private final long windowSizeMs = 1000;
    private final long limit = 3;
    private long windowStart = System.currentTimeMillis();
    private final AtomicLong counter = new AtomicLong(0);

    public synchronized boolean allow() {
        long now = System.currentTimeMillis();
        if (now - windowStart >= windowSizeMs) {
            // 进入新窗口，重置计数
            windowStart = now;
            counter.set(0);
        }
        return counter.incrementAndGet() <= limit;
    }

    public static void main(String[] args) throws InterruptedException {
        FixedWindowDemo limiter = new FixedWindowDemo();
        for (int i = 1; i <= 5; i++) {
            System.out.println("请求" + i + "： " + (limiter.allow() ? "放行" : "拒绝"));
        }
    }
}
```

**临界问题**：两个窗口交界处可能通过 2 倍流量。比如限流 100/秒，第 1 秒的最后 100ms 来了 100 个，第 2 秒的前 100ms 又来 100 个——相邻两窗口各没超，但**这 200ms 内实际过了 200 个**，瞬间翻倍。

## 四、限流算法之二：滑动窗口

把大窗口切成很多小格，随时间滑动，统计"当前时间往前一个窗口"内的请求数，缓解临界问题。

```text
时间轴（窗口=1s，切成 4 格，每格 250ms）
[■][■][ ][  ]  ← 统计"最近 1s"=前两格=2 个
       ↑ 当前

滑动后：
[■][ ][ ][■]  ← 还是统计最近 1s 内的格子
```

它比固定窗口**平滑**，但格越细内存和统计开销越大，是精度与成本的权衡。Redis 的 `ZSET` 可以优雅实现滑动窗口（用时间戳打分，统计窗口内元素个数）。

## 五、限流算法之三：漏桶

请求像水一样进桶，桶以**固定速率**出水（处理），桶满则拒绝。

```text
   请求 →  ▓▓▓▓▓  桶(容量5)
             │
             │ 固定速率出水(如 1/s)
             ▼
           处理
```

**特点**：强行**削峰填谷**，输出速率恒定。缺点是无法应对突发——即使桶是空的，出水速率也被锁死，突发流量只能排队或被拒。

## 六、限流算法之四：令牌桶

本篇重点。以**固定速率**往桶里放令牌，请求要**拿到令牌**才能通过，拿不到就拒绝/排队。桶里的令牌可以攒着，所以**允许突发**。

```text
   令牌生成器(如 1/s) →  ▣▣▣▣  令牌桶(容量4)
                              │
   请求来了，抢到一个令牌才放行，桶空了就拒绝
```

```java
package com.canoe.cloud.ratelimit;

import java.util.concurrent.atomic.AtomicLong;

// 令牌桶：固定速率放令牌，桶满则溢出，允许突发
public class TokenBucketDemo {

    private final long capacity = 4;        // 桶容量
    private final long refillPerSec = 2;    // 每秒放 2 个令牌
    private final AtomicLong tokens = new AtomicLong(capacity);
    private long lastRefill = System.currentTimeMillis();

    private void refill() {
        long now = System.currentTimeMillis();
        long added = (now - lastRefill) / 1000 * refillPerSec;
        if (added > 0) {
            tokens.set(Math.min(capacity, tokens.get() + added));
            lastRefill = now;
        }
    }

    public synchronized boolean allow() {
        refill();
        if (tokens.get() > 0) {
            tokens.decrementAndGet();
            return true; // 抢到令牌
        }
        return false; // 桶空了
    }

    public static void main(String[] args) throws InterruptedException {
        TokenBucketDemo bucket = new TokenBucketDemo();
        for (int i = 1; i <= 6; i++) {
            System.out.println("请求" + i + "： " + (bucket.allow() ? "放行" : "拒绝"));
        }
    }
}
```

生产常用 **Guava `RateLimiter`**（单机）或 **Redisson `RRateLimiter`**（分布式）。

```java
package com.canoe.cloud.ratelimit;

import com.google.common.util.concurrent.RateLimiter;

// Guava 令牌桶（单机限流）
public class GuavaRateLimiterDemo {
    public static void main(String[] args) {
        // 每秒放行 5 个，突发可透支
        RateLimiter limiter = RateLimiter.create(5.0);
        for (int i = 0; i < 8; i++) {
            boolean ok = limiter.tryAcquire(); // 立即尝试，不阻塞
            System.out.println("请求" + i + "： " + (ok ? "放行" : "拒绝"));
        }
    }
}
```

## 七、四种算法对比

```text
算法          平滑?   允许突发?   实现复杂度   典型场景
--------------------------------------------------------------
固定窗口      否      否          简单        粗粒度接口限流
滑动窗口      较平滑   否          中等        较精确限流
漏桶          平滑     否          中等        保护下游、强制匀速
令牌桶        平滑     是          中等        应对突发（最常用）
```

**生产结论**：最常用的是**令牌桶**（允许突发）和**滑动窗口**（精确）。Guava、Sentinel、Nginx 默认都偏向令牌桶。

## 八、单机限流 vs 分布式限流

**单机限流**的问题：限流 100 QPS，部署 10 台机器，总流量其实是 1000 QPS，与"全局限流"目标不符。

**分布式限流**靠共享计数：用 **Redis + Lua** 保证原子计数（经典令牌桶/Lua 脚本），或直接在**网关层**限流（Gateway 的 `RequestRateLimiter`）。

```lua
-- Redis 令牌桶 Lua（分布式限流，原子执行）
local tokens = redis.call('get', KEYS[1])
if tokens == false then
    tokens = ARGV[1]  -- 初始容量
end
local now = tonumber(ARGV[2])
-- 省略 refill 计算，伪代码示意：根据时间差补充令牌
if tonumber(tokens) > 0 then
    redis.call('decr', KEYS[1])
    return 1  -- 放行
end
return 0      -- 拒绝
```

```java
package com.canoe.cloud.ratelimit;

import redis.clients.jedis.Jedis;

// 分布式限流：Redis INCR + 过期实现（简化版固定窗口）
public class DistributedLimitDemo {

    public static boolean allow(Jedis jedis, String key, int limit) {
        long count = jedis.incr(key);
        if (count == 1) {
            jedis.expire(key, 1); // 首请求设 1 秒窗口
        }
        return count <= limit;
    }

    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("127.0.0.1", 6379)) {
            String key = "limit:api:order";
            for (int i = 1; i <= 5; i++) {
                System.out.println("请求" + i + "： " + (allow(jedis, key, 3) ? "放行" : "拒绝"));
            }
        }
    }
}
```

## 九、熔断

核心思想：**下游失败率过高就直接跳闸，别再傻傻地调，给下游喘息的机会**。三态状态机：

```text
       失败率超阈值
   ┌──────────┐  ───────────►  ┌──────────┐
   │  Closed  │                 │   Open   │
   │ (正常调用)│  ◄────────────  │ (直接拒绝)│
   └──────────┘   成功恢复       └────┬─────┘
        ▲                            │ 过了熔断时长
        │                            ▼
        │                     ┌──────────────┐
        │   试探成功          │ Half-Open    │
        └──────────────────── │ (放部分请求) │
                              └──────────────┘
```

- **Closed（关闭）**：正常调用，统计失败率。
- **Open（打开）**：失败率超阈值，**直接拒绝，不再调用下游**，避免雪崩。
- **Half-Open（半开）**：熔断时长过后，放一小部分请求试探，成功则恢复 Closed，失败则继续 Open。

**关键参数**：失败率阈值（如 50%）、最小请求数（如 20，避免少量请求误判）、熔断时长（如 10s）、恢复策略。框架：**Hystrix**（已停维）、**Sentinel**、**Resilience4j**（Spring 官方推荐的新一代）。

## 十、降级

三种常见降级方式：

1. **返回兜底值**：默认值、缓存旧值、静态页。比如商品详情页降级返回"暂时不可用的通用文案"。
2. **关闭非核心功能**：大促时关掉"评论""推荐""相关商品"，保住"下单""支付"主链路。
3. **直接拒绝**：返回"系统繁忙，请稍后再试"，保护核心资源。

```java
package com.canoe.cloud.ratelimit;

import com.alibaba.csp.sentinel.annotation.SentinelResource;

// Sentinel 降级：blockHandler 处理被限流/熔断，fallback 处理业务异常
public class DegradeDemo {

    @SentinelResource(
        value = "queryRecommend",
        blockHandler = "blockHandler",   // 被限流/熔断时走这里
        fallback = "fallback")           // 业务抛异常时走这里
    public String queryRecommend(Long userId) {
        // 非核心：个性化推荐，可能慢或挂
        return remoteRecommendService(userId);
    }

    // 兜底：返回空推荐，不影响主流程
    public String fallback(Long userId, Throwable e) {
        return "[]"; // 返回空列表，降级关闭推荐
    }

    public String blockHandler(Long userId, Throwable e) {
        return "[]"; // 被限流/熔断，直接降级
    }

    private String remoteRecommendService(Long userId) {
        return "recommend-list";
    }
}
```

## 十一、隔离

为什么要隔离？**防止一个慢接口拖垮整个服务**。两种隔离方式：

- **线程池隔离**：每个依赖用独立线程池，慢调用占满自己的池子，不影响别的。开销大（线程切换），但隔离彻底。
- **信号量隔离**：用计数器限制并发数，不新建线程，开销小。但慢调用仍占主线程，隔离性弱于线程池。

```text
线程池隔离：  接口A线程池 ┐
             接口B线程池 ┼ 互不影响，A 慢只耗光 A 的池
             接口C线程池 ┘

信号量隔离：  所有接口共享主线程，仅用计数限制每接口并发
```

**选型**：对延迟敏感的外部调用用线程池隔离；内部轻量调用用信号量隔离更划算。

## 十二、Sentinel 实战

完整用法链路：控制台部署 → 引依赖 → 定义资源 → 配规则 → 持久化。

```xml
<!-- 依赖 -->
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
</dependency>
```

```yaml
spring:
  cloud:
    sentinel:
      transport:
        dashboard: 127.0.0.1:8080   # 控制台地址
      # 规则持久化到 Nacos（生产必配，否则重启丢失）
      datasource:
        ds1:
          nacos:
            server-addr: 127.0.0.1:8848
            data-id: sentinel-rules
            group-id: DEFAULT_GROUP
            rule-type: flow
```

```java
package com.canoe.cloud.ratelimit;

import com.alibaba.csp.sentinel.annotation.SentinelResource;
import com.alibaba.csp.sentinel.slots.block.BlockException;

// 定义资源 + 流控/熔断处理
public class SentinelFlowDemo {

    @SentinelResource(value = "createOrder", blockHandler = "handleBlock")
    public String createOrder(Long userId) {
        return "order-created";
    }

    public String handleBlock(Long userId, BlockException e) {
        return "请求过于频繁，请稍后再试"; // 被限流/熔断的统一提示
    }
}
```

**规则维度**：QPS/线程数、关联（读写分离保护写）、链路（仅对某个调用链限流）、Warm Up（冷启动预热，防瞬间打满）、排队等待（匀速通过）。

## 十三、压测与容量规划

**限流阈值不能拍脑袋**。确定方法：

1. **全链路压测**：用真实流量回放或压测工具（JMeter / 全链路压测平台）找出单机极限 QPS。
2. **单机测量**：单接口压到 RT 明显上升或错误率上升的那个点，就是单机容量上限。
3. **按 SLA 反推**：目标 99.9% 可用、P99 小于 200ms，取该目标下的 QPS 的 70% 作为限流阈值（留余量）。

```text
公式：限流阈值 ≈ 单机安全QPS × 机器数 × 安全系数(0.7)
```

记住：**阈值是调出来的，不是猜出来的**。上线后根据监控持续微调。

## 本篇小结

- **限流** 控入口流量，**熔断** 保护上游不调坏下游，**降级** 保核心关非核心。
- **雪崩效应** 是慢调用拖垮线程池导致全链路崩，三件套就是保险丝。
- **固定窗口** 简单但有临界双倍流量问题。
- **滑动窗口** 更平滑，代价是统计精度与内存的权衡。
- **漏桶** 强制匀速，无法应对突发。
- **令牌桶** 限速又允许突发，生产最常用（Guava/Redisson）。
- **分布式限流** 用 Redis+Lua 或网关层，避免单机阈值翻倍。
- **熔断三态**：Closed→Open→Half-Open，靠失败率与熔断时长驱动。
- **降级** 三方式：兜底值、关非核心、直接拒绝。
- **隔离** 分线程池（彻底）与信号量（轻量）两种。
- **Sentinel** 需配规则持久化，否则重启丢规则。
- **限流阈值** 靠压测确定，不能拍脑袋。

## 参考链接

- [Sentinel 官方文档](https://sentinelguard.io/zh-cn/docs/introduction.html)
- [Resilience4j 官方文档](https://resilience4j.readme.io/)
- [Hystrix（已停维，参考思想）](https://github.com/Netflix/Hystrix)
- [Guava RateLimiter](https://github.com/google/guava/wiki/RateLimiterExplained)
- [Redisson RRateLimiter](https://github.com/redisson/redisson/wiki/8.-Distributed-locks-and-synchronizers)
- [Nginx 限流 ngx_http_limit_req_module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
- [Martin Fowler：Circuit Breaker](https://martinfowler.com/bliki/CircuitBreaker.html)
- [阿里中间件：大促降级实践](https://developer.aliyun.com/)

下一篇 → [返回专栏首页](/java/cloud/distribute-base)
