# 07 线程池

> 本篇导读：前面说过"生产环境几乎只用线程池"。本篇就把线程池这块硬骨头啃下来。你会看到 `ThreadPoolExecutor` 的七大参数如何用"公司招人"的比喻讲透、任务提交后到底走哪条路径、为什么 `Executors` 的快捷工厂是"糖衣炮弹"、以及 `submit` 偷偷吞掉异常这个大坑。读完你应该能亲手配出一个安全、可控、可监控的线程池。

## 一、为什么要用线程池

先想象**不用线程池**会怎样：每来一个请求就 `new Thread()` 跑完就销毁。

- **创建/销毁开销大**：线程的创建涉及系统调用、栈分配，频繁开关等于反复交"开办费"。
- **无限制创建会 OOM**：流量洪峰时疯狂 `new Thread`，每个线程占约 1MB 栈，直接把内存打爆。
- **无法统一管理**：线程叫什么、现在多少在忙、跑了多少任务，全靠运气，出事没法查。

线程池的**池化思想**就是：预先养好一批线程，任务来了排队或复用，线程跑完不销毁、接着接下一个活。成本摊薄了、数量有上限、还能统一监控——一举三得。

## 二、ThreadPoolExecutor 七大参数

`ThreadPoolExecutor` 的构造函数有七个参数，是理解线程池的全部秘密。用"公司招人干活"打个比方：

| 参数 | 比喻 | 含义 |
| --- | --- | --- |
| `corePoolSize` | 正式工数量 | 核心线程数，常驻不裁 |
| `maximumPoolSize` | 正式工 + 临时工上限 | 线程总数上限 |
| `keepAliveTime` | 临时工空闲多久被辞退 | 非核心线程空闲存活时间 |
| `unit` | 时间单位 | `keepAliveTime` 的单位 |
| `workQueue` | 任务排队区 | 核心线程忙时，任务先来这排队 |
| `threadFactory` | 招聘渠道 | 创建线程的工厂（用来命名） |
| `handler` | 拒单策略 | 队列满且线程到上限时的应对 |

下面是一段**手动配置**线程池、且可运行的代码（注意我们没用 `Executors`，见第六节）：

```java
package com.canoe.thread.pool;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public class ThreadPoolConfigDemo {

    public static void main(String[] args) {
        // 七大参数逐一对应"公司招人"模型
        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                2,                                   // corePoolSize：正式工 2 名
                4,                                   // maximumPoolSize：最多 4 名（含临时工）
                60,                                  // keepAliveTime：临时工空闲 60 秒被辞退
                TimeUnit.SECONDS,                    // unit：时间单位
                new LinkedBlockingQueue<Runnable>(10), // workQueue：排队区容量 10
                new NamedThreadFactory("order-pool"),   // threadFactory：招聘渠道（带名字）
                new ThreadPoolExecutor.CallerRunsPolicy() // handler：拒绝策略
        );

        for (int i = 0; i < 5; i++) {
            int taskId = i;
            pool.execute(() -> {
                System.out.println(Thread.currentThread().getName() + " 处理任务 " + taskId);
            });
        }

        pool.shutdown();
    }

    // 自定义线程工厂：给线程起有意义的名字，排查问题一目了然
    static class NamedThreadFactory implements ThreadFactory {
        private final String prefix;
        private int count = 0;

        NamedThreadFactory(String prefix) {
            this.prefix = prefix;
        }

        @Override
        public Thread newThread(Runnable r) {
            return new Thread(r, prefix + "-" + (++count));
        }
    }
}
```

## 三、execute 的执行流程

这是面试必画的图。关键是**很多人误以为"线程数超过核心数就立刻开新线程"，其实不是——要先填满队列，队列满了才会开非核心线程**。

```text
           提交一个任务 execute(task)
                  │
                  ▼
   当前线程数 < corePoolSize（正式工未满）？
        ├─ 是 ─► 立刻创建核心线程执行
        └─ 否 ─► 任务能放进 workQueue（排队区）吗？
                    ├─ 能 ─► 任务入队，等核心线程空闲来取
                    └─ 不能（队列已满）─► 当前线程数 < maximumPoolSize（还能招临时工）？
                                          ├─ 能 ─► 创建非核心线程执行
                                          └─ 不能 ─► 执行拒绝策略 handler
```

**反直觉点务必记住**：`corePoolSize` 满了之后，线程池**优先把任务塞进队列**，而不是马上扩到 `maximumPoolSize`。只有当队列也满了，才会去创建超出核心数的线程。所以如果你想让"临时工"尽早上岗，队列容量要设小，或者配合合适的拒绝策略。

## 四、四种拒绝策略

队列满且线程数到顶，新任务怎么办？`RejectedExecutionHandler` 四种内置策略：

- **`AbortPolicy`（默认）**：直接抛 `RejectedExecutionException`，简单粗暴，让调用方自己处理。
- **`CallerRunsPolicy`**：由**提交任务的线程自己来跑**这个任务。这是一种"负反馈"——提交方被迫慢下来，相当于天然限流，很实用。
- **`DiscardPolicy`**：**静默丢弃**，连个异常都不抛，最危险，容易丢任务还查不出原因。
- **`DiscardOldestPolicy`**：丢弃队列里**最老**的那个任务，然后重试提交当前任务。

选择建议：默认 `AbortPolicy` 适合"不能丢任务就得立刻知道"的场景；想做限流兜底常用 `CallerRunsPolicy`；而生产里更常见的是**自定义策略**——把被拒绝的任务记日志、落库或发告警，至少留个痕。

## 五、四种工作队列

`workQueue` 决定了任务怎么排队，也决定了池子的脾气：

- **`ArrayBlockingQueue`**：**有界**队列，构造时必须给容量，最稳，能逼出拒绝策略。
- **`LinkedBlockingQueue`**：默认**无界**（容量是 `Integer.MAX_VALUE`），危险！任务只进不出就会无限堆积，最终 OOM。
- **`SynchronousQueue`**：**不存储**任务，直接把任务"移交"给空闲线程，适合 `newCachedThreadPool` 那种来一个跑一个。
- **`PriorityBlockingQueue`**：带优先级的队列，按任务优先级出队。
- **`DelayedWorkQueue`**：延迟队列，是 `ScheduledThreadPoolExecutor` 的底层，支持定时/周期任务。

**重点警告**：无界队列（`LinkedBlockingQueue` 不指定容量）会让 `maximumPoolSize` 形同虚设——因为队列永远塞不满，永远不会去创建非核心线程，而队列本身却能无限涨到 OOM。所以**队列一定要设上限**。

## 六、Executors 的四个工厂方法与坑

`Executors` 提供了几个"一键创建"的快捷方法，看着方便，其实是**糖衣炮弹**：

- **`newFixedThreadPool`**：核心数=最大数，背后用**无界** `LinkedBlockingQueue` → 任务堆积可能 **OOM**。
- **`newSingleThreadExecutor`**：单线程 + **无界**队列 → 同样可能 **OOM**，且单点故障。
- **`newCachedThreadPool`**：核心数 0、最大线程数 `Integer.MAX_VALUE` → 来多少任务开多少线程，可能 **OOM**。
- **`newScheduledThreadPool`**：最大线程数同样是 `Integer.MAX_VALUE` → 同样可能 **OOM**。

```java
package com.canoe.thread.pool;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ExecutorsTrapDemo {

    public static void main(String[] args) {
        // 看似方便，实则埋雷：
        // newFixedThreadPool 用无界队列，任务堆积会 OOM
        ExecutorService fixed = Executors.newFixedThreadPool(10);
        // newCachedThreadPool 最大线程数 Integer.MAX_VALUE，线程爆炸会 OOM
        ExecutorService cached = Executors.newCachedThreadPool();

        // 结论：生产一律手动 new ThreadPoolExecutor，把队列容量、拒绝策略写清楚
        fixed.shutdown();
        cached.shutdown();
    }
}
```

**结论**：生产环境一律**手动 `new ThreadPoolExecutor`**，明确指定核心数、最大数、有界队列和拒绝策略，把你真实的意图写进代码里。

## 七、submit vs execute

往池子里塞任务有两套 API：`execute(Runnable)` 和 `submit(Callable/Runnable)`。它们的关键差异在于**异常处理**：

- **`execute`**：任务里抛的异常会直接交给线程的**未捕获异常处理器**，堆栈立即可见。
- **`submit`**：返回的 `Future` 会把异常**悄悄吞掉**——只要你不调用 `future.get()`，这个异常就像没发生过一样，日志里连个影都没有。这是线上最阴险的"静默失败"来源。

```java
package com.canoe.thread.pool;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public class SubmitVsExecuteDemo {

    public static void main(String[] args) throws Exception {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                1, 1, 0, TimeUnit.SECONDS,
                new LinkedBlockingQueue<Runnable>());

        // execute：异常直接出现在未捕获异常处理器，能看到堆栈
        pool.execute(() -> System.out.println("execute 正常执行"));

        // submit：异常被 Future 吞掉，不调 get() 就永远看不到
        pool.submit(() -> {
            throw new RuntimeException("submit 任务内部异常（被吞了）");
        });
        // 想看到上面的异常，必须：future.get(); 否则它悄无声息地消失

        pool.shutdown();
    }
}
```

**经验**：如果任务不需要返回值，又希望异常别被吞，`execute` 更省心；用 `submit` 就**务必对 `Future` 调 `get()`** 把异常接出来。

## 八、关闭线程池

线程池用完要关，否则 JVM 可能一直不退出（池里的线程默认是**非守护线程**）。

- **`shutdown()`**：平缓关闭——不再接收新任务，但**会把队列里已有的任务跑完**，然后才停。
- **`shutdownNow()`**：立刻关闭——尝试中断正在跑的线程，并**返回还没执行的任务列表**（你可以据此补救）。
- **`awaitTermination(timeout)`**：阻塞等待，直到池子彻底停掉或超时，常用于"优雅停机"里等线程收尾。

注意：**JVM 不会自动帮你关**，忘记 `shutdown` 会导致应用无法正常退出或资源泄漏。

## 九、线程池监控

光配好还不够，线上要知道池子健不健康。两个层面：

1. **重写钩子方法**：继承 `ThreadPoolExecutor`，覆写 `beforeExecute`、`afterExecute`、`terminated`，可以统计每个任务的耗时、失败次数。
2. **读监控指标**：`getPoolSize()`（当前线程数）、`getActiveCount()`（活跃线程数）、`getCompletedTaskCount()`（累计完成任务）、`getQueue().size()`（积压任务数）。

接 Spring Boot 时，可以把这些指标注册到 **Actuator / Micrometer**，配合 Grafana 画面板，线程池拥堵、积压一眼可见。

## 十、线程数怎么设置

经典问题，但**没有银弹，公式只是起点**：

- **CPU 密集型**（一直算）：线程数 ≈ **CPU 核数**（或 核数 + 1）。
- **IO 密集型**（大量等网络/数据库）：线程数 ≈ **核数 × (1 + 等待时间/计算时间)**，实践中常取 **核数 × 2** 起步。

也可以**反推**：已知可接受的最大响应时间、单任务平均耗时、队列容量，就能算出能容忍的积压与所需并发度。但无论如何，**压测才是真理**——公式拍出来的数，一定要用真实流量压一压、看 CPU 利用率和队列积压再调。

## 十一、实战：Spring Boot 集成线程池

Spring 里用 `@Async` 标注方法即可异步执行，但底层线程池必须自己配，否则用的是 Spring 默认的 `SimpleAsyncTaskExecutor`（**每次都 new 线程，根本没有池化**，是个大坑）。

```java
package com.canoe.thread.pool;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import java.util.concurrent.ThreadPoolExecutor;

@Configuration
@EnableAsync   // 必须开启，否则 @Async 不生效
public class AsyncConfig {

    @Bean("bizExecutor")
    public ThreadPoolTaskExecutor bizExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("biz-async-");   // 给线程起名
        executor.setRejectedExecutionHandler(
                new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}
```

```java
package com.canoe.thread.pool;

import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
public class OrderService {

    // 指定用哪个线程池，否则退回默认（无池化）执行器
    @Async("bizExecutor")
    public void sendNotification(Long orderId) {
        System.out.println(Thread.currentThread().getName()
                + " 异步发送订单 " + orderId + " 通知");
    }
}
```

**`@Async` 失效的两个高频场景**：① **同类内部调用**——`this.sendNotification()` 走的是对象内部调用，Spring 代理不生效，仍是同步；② **忘了加 `@EnableAsync`**，代理根本没织入。踩过一次就忘不掉了。

## 本篇小结

- 线程池的核心价值是**复用线程、限制数量、统一监控**，避免无节制 `new Thread` 导致 OOM。
- `ThreadPoolExecutor` 有**七大参数**：核心数、最大数、空闲时间、时间单位、队列、线程工厂、拒绝策略。
- 提交任务时**先填核心线程、再入队列、队列满才扩到最大线程**，这个顺序反直觉却关键。
- 四种拒绝策略中 `CallerRunsPolicy` 是**天然限流**的负反馈，`DiscardPolicy` 静默丢任务最危险。
- **无界队列（`LinkedBlockingQueue` 不设容量）会绕过最大线程数并可能 OOM**，队列一定要设上限。
- `Executors` 的快捷工厂大多隐藏**无界队列或无限线程**，生产应手动 `new ThreadPoolExecutor`。
- `submit` 会把异常**吞进 `Future`**，不调 `get()` 就看不到；`execute` 异常直接可见。
- 关闭线程池用 `shutdown()`（跑完队列）或 `shutdownNow()`（立刻停并返回未执行任务）。
- 监控靠 `getActiveCount()`、`getQueue().size()` 等指标，可接入 **Actuator / Micrometer**。
- 线程数设置**没有银弹**：CPU 密集取核数，IO 密集取核数×2 起步，最终靠**压测**定。
- Spring 中 `@Async` 必须配**自定义线程池**且开 `@EnableAsync`，并避免**同类内部调用**导致失效。

## 参考链接

- [Oracle 并发教程 - 线程池](https://docs.oracle.com/javase/tutorial/essential/concurrency/pools.html)
- [Java ThreadPoolExecutor 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)
- [Java Executors 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/Executors.html)
- [Java BlockingQueue 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/BlockingQueue.html)
- [Spring @Async 官方文档](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/annotation/Async.html)
- [美团技术团队 - Java 线程池实现原理](https://tech.meituan.com/2020/04/02/java-pooling-pratice-in-meituan.html)
- [《Java 并发编程实战》](https://www.amazon.com/Java-Concurrency-Practice-Brian-Goetz/dp/0321349601)

下一篇 → [08 并发工具类](/java/thread/util)
