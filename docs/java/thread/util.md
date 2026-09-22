# 08 并发工具类

JDK 的 `java.util.concurrent`（俗称 JUC）把并发编程里那些"轮子"都造好了：从**等待协作**的 `CountDownLatch`/`CyclicBarrier`/`Semaphore`，到**无锁原子类**、**并发容器**、**Fork/Join** 与 **CompletableFuture**。本篇挑最高频的几类，每个配一段可运行代码，让你开箱即用。

## 一、CountDownLatch

**作用**：让一个或多个线程**等待**其他 N 个任务完成后再继续。它内部有个计数器，`countDown()` 减一，`await()` 阻塞到计数器归零。

典型场景：**主线程等所有依赖服务初始化完成后再启动应用**。关键特性——**一次性、不可重置**，归零后就废了。

```java
package com.canoe.thread.util;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CountDownLatchDemo {
    public static void main(String[] args) throws InterruptedException {
        int serviceCount = 3;
        CountDownLatch latch = new CountDownLatch(serviceCount);
        ExecutorService pool = Executors.newFixedThreadPool(serviceCount);

        String[] services = {"订单服务", "库存服务", "支付服务"};
        for (String service : services) {
            pool.execute(() -> {
                try {
                    System.out.println(service + " 初始化完成");
                } finally {
                    latch.countDown(); // 每个服务就绪后计数减一
                }
            });
        }
        latch.await(); // 主线程在此等待，直到全部完成
        System.out.println("所有服务就绪，应用启动成功");
        pool.shutdown();
    }
}
```

## 二、CyclicBarrier

**作用**：让**多个线程互相等待**，直到大家都到达某个"集合点（barrier）"，再一起继续。与 `CountDownLatch` 最大区别是**可循环复用**，且在全员到齐时可触发一个 `barrierAction`。

典型场景：**多线程分段计算，到齐后汇总**。

```java
package com.canoe.thread.util;

import java.util.concurrent.BrokenBarrierException;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CyclicBarrierDemo {
    public static void main(String[] args) throws InterruptedException {
        int party = 3;
        // 三人到齐后先执行 barrierAction，再一起出发；可重复使用
        CyclicBarrier barrier = new CyclicBarrier(party, () -> System.out.println("三人到齐，开始汇总"));

        ExecutorService pool = Executors.newFixedThreadPool(party);
        for (int i = 0; i < party; i++) {
            final int no = i + 1;
            pool.execute(() -> {
                System.out.println("第" + no + "人到达集合点，等待其他人...");
                try {
                    barrier.await(); // 等待大家都到齐
                    System.out.println("第" + no + "人出发");
                } catch (InterruptedException | BrokenBarrierException e) {
                    e.printStackTrace();
                }
            });
        }
        pool.shutdown();
    }
}
```

**`CountDownLatch` vs `CyclicBarrier` 对比**：

| 维度 | CountDownLatch | CyclicBarrier |
| --- | --- | --- |
| 是否可复用 | **一次性**，不可重置 | **可循环复用** |
| 谁等谁 | 一个或多个线程等"别人干完" | 线程之间**互相等**到齐 |
| barrierAction | 无 | 全员到齐时可执行一个回调 |
| 计数方向 | 从 N 倒数到 0 | 从 0 累加到达 party 数 |

## 三、Semaphore

**作用**：**信号量 / 许可证**。控制同时访问某资源的线程数量，常用于**限流**。核心方法：`acquire()` 拿许可（没有就阻塞）、`release()` 还许可、`tryAcquire()` 尝试拿（不阻塞）。

典型场景：**接口最多允许 100 个并发**。下面演示最多同时 3 个：

```java
package com.canoe.thread.util;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

public class SemaphoreDemo {
    public static void main(String[] args) {
        Semaphore semaphore = new Semaphore(3); // 最多 3 个并发
        ExecutorService pool = Executors.newFixedThreadPool(10);
        for (int i = 1; i <= 10; i++) {
            final int taskId = i;
            pool.execute(() -> {
                try {
                    semaphore.acquire(); // 获取许可证
                    System.out.println("任务" + taskId + " 获得许可，开始执行");
                    TimeUnit.MILLISECONDS.sleep(500);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                } finally {
                    System.out.println("任务" + taskId + " 释放许可");
                    semaphore.release(); // 释放许可证
                }
            });
        }
        pool.shutdown();
    }
}
```

## 四、Exchanger

**作用**：用于**两个线程在同步点交换数据**。线程 A 调用 `exchange(dataA)` 会阻塞，直到线程 B 也调用 `exchange(dataB)`，然后双方各自拿到对方的数据。

```java
package com.canoe.thread.util;

import java.util.concurrent.Exchanger;

public class ExchangerDemo {
    public static void main(String[] args) {
        Exchanger<String> exchanger = new Exchanger<String>();
        new Thread(() -> {
            try {
                String mine = "线程A的数据";
                String yours = exchanger.exchange(mine);
                System.out.println("A 收到：" + yours);
            } catch (InterruptedException e) {}
        }, "A").start();

        new Thread(() -> {
            try {
                String mine = "线程B的数据";
                String yours = exchanger.exchange(mine);
                System.out.println("B 收到：" + yours);
            } catch (InterruptedException e) {}
        }, "B").start();
    }
}
```

## 五、原子类

`java.util.concurrent.atomic` 提供了一系列**无锁原子类**：`AtomicInteger`、`AtomicLong`、`AtomicReference`、`AtomicBoolean` 等。它们底层靠 **CAS（Compare And Swap，比较并交换）** 实现乐观并发。

**CAS 原理**：它是一条 CPU 原子指令，逻辑是"如果内存当前值等于预期值 `expect`，就把它改成 `update`，并返回成功；否则什么都不做，返回失败"。循环"读-比较-改"直到成功，就叫**自旋**。因为不需要加锁，冲突少时比 `synchronized` 快得多。

`LongAdder` 是 JDK 8 引入的"加强版计数器"，采用**分段（Cell）思想**：高并发下把累加分散到多个 Cell 上，最后求和，大幅降低 CAS 冲突，比 `AtomicLong` 快得多（代价是读取 `sum()` 不是精确瞬间值）。

```java
package com.canoe.thread.util;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

public class LongAdderDemo {
    public static void main(String[] args) throws InterruptedException {
        int threads = 8;
        int per = 100000;
        AtomicLong atomicLong = new AtomicLong(0);
        LongAdder longAdder = new LongAdder();

        CountDownLatch latch = new CountDownLatch(threads);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        for (int i = 0; i < threads; i++) {
            pool.execute(() -> {
                for (int j = 0; j < per; j++) {
                    atomicLong.incrementAndGet();
                    longAdder.increment();
                }
                latch.countDown();
            });
        }
        latch.await();
        pool.shutdown();
        System.out.println("AtomicLong 结果：" + atomicLong.get());
        System.out.println("LongAdder  结果：" + longAdder.sum());
    }
}
```

**选择**：低并发或需要精确原子读取用 `AtomicLong`；高并发纯计数（如 QPS 统计）用 `LongAdder`。

## 六、AtomicReference 与 ABA 问题

**CAS 的致命弱点——ABA 问题**：变量的值从 A 改成 B，又改回 A。对 CAS 来说，"现在还是 A 就等于没变过"，但它**丢失了中间发生过变化**这一事实，在某些场景下会导致逻辑错误（比如一个无锁栈的节点被取出又放回，结构已乱）。

解决方案是加**版本号**：`AtomicStampedReference`（带 `int` 戳记）或 `AtomicMarkableReference`（带布尔标记）。每次修改版本号 +1，CAS 时同时比较"值"和"版本号"。

```java
package com.canoe.thread.util;

import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicStampedReference;

public class ABADemo {
    public static void main(String[] args) {
        // 普通 CAS：A→B→A 后，仍认为"没变过"
        AtomicReference<Integer> ref = new AtomicReference<Integer>(100);
        boolean ok = ref.compareAndSet(100, 100);
        System.out.println("普通 CAS 通过（无法察觉中间发生过 A→B→A）：" + ok);

        // 带版本号，可识别 ABA
        AtomicStampedReference<Integer> stamped = new AtomicStampedReference<Integer>(100, 0);
        int stamp = stamped.getStamp();
        stamped.compareAndSet(100, 101, stamp, stamp + 1); // A→B
        stamp = stamped.getStamp();
        stamped.compareAndSet(101, 100, stamp, stamp + 1); // B→A
        // 用最初的版本号 0 再去 CAS，必然失败
        boolean fail = stamped.compareAndSet(100, 200, 0, 1);
        System.out.println("带版本号后旧版本 CAS 失败（成功规避 ABA）：" + fail);
    }
}
```

## 七、并发容器

JUC 提供了一整套线程安全的容器，替代那些"裸奔"的集合类：

- **`ConcurrentHashMap`**：高并发 Map 首选，JDK 8 用 CAS + `synchronized` 细化到桶级别，读写都高并发（不要用同步的 `Hashtable`）。
- **`CopyOnWriteArrayList`**：**写时复制**——每次修改都复制一份底层数组，读完全无锁。适合**读多写极少**（如监听器列表），但**写内存开销大、数据有短暂不一致**。
- **`ConcurrentLinkedQueue`**：无锁并发队列，适合高并发生产者-消费者。
- **`BlockingQueue` 家族**：`ArrayBlockingQueue`（有界数组）、`LinkedBlockingQueue`（可选有界）、`PriorityBlockingQueue`（优先级）、`DelayQueue`（延迟）、`SynchronousQueue`（不缓冲，直接交接）。

`BlockingQueue` 的 `put`/`take` 在队满/队空时**自动阻塞**，是生产者-消费者模型的最佳搭档：

```java
package com.canoe.thread.util;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class BlockingQueueDemo {
    public static void main(String[] args) throws InterruptedException {
        BlockingQueue<String> queue = new ArrayBlockingQueue<String>(5); // 有界，容量 5
        ExecutorService pool = Executors.newFixedThreadPool(2);

        // 生产者
        pool.execute(() -> {
            for (int i = 1; i <= 10; i++) {
                try {
                    queue.put("任务-" + i); // 队列满时自动阻塞
                    System.out.println("生产 任务-" + i);
                } catch (InterruptedException e) {}
            }
        });

        // 消费者
        pool.execute(() -> {
            try {
                for (int i = 1; i <= 10; i++) {
                    String task = queue.take(); // 队列空时自动阻塞
                    System.out.println("消费 " + task);
                    TimeUnit.MILLISECONDS.sleep(200);
                }
            } catch (InterruptedException e) {}
        });

        pool.shutdown();
        pool.awaitTermination(10, TimeUnit.SECONDS);
    }
}
```

## 八、Fork/Join

**思想**：分治（Divide and Conquer）。把大任务拆成小任务，递归拆分到足够小再并行计算，最后合并结果。**工作窃取（Work-Stealing）** 算法让空闲线程去"偷"别的线程的任务队列，保证 CPU 不闲着。

核心类：`ForkJoinPool`、`RecursiveTask`（有返回值）/ `RecursiveAction`（无返回值）。下面是并行求和：

```java
package com.canoe.thread.util;

import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.RecursiveTask;

public class ForkJoinSumDemo {
    // 分治求和：区间足够小就直接计算，否则拆成左右两半并行
    static class SumTask extends RecursiveTask<Long> {
        private final long start;
        private final long end;
        private static final long THRESHOLD = 1000;

        SumTask(long start, long end) {
            this.start = start;
            this.end = end;
        }

        protected Long compute() {
            if (end - start <= THRESHOLD) {
                long sum = 0;
                for (long i = start; i <= end; i++) {
                    sum += i;
                }
                return sum;
            }
            long mid = (start + end) / 2;
            SumTask left = new SumTask(start, mid);
            SumTask right = new SumTask(mid + 1, end);
            left.fork();                  // 异步执行左半
            long rightResult = right.compute(); // 当前线程算右半
            long leftResult = left.join();     // 等左半结果
            return leftResult + rightResult;
        }
    }

    public static void main(String[] args) {
        ForkJoinPool pool = new ForkJoinPool();
        Long result = pool.invoke(new SumTask(1, 10000));
        System.out.println("1~10000 求和结果：" + result);
        pool.shutdown();
    }
}
```

## 九、CompletableFuture

**JDK 8 最重要的并发工具**，把"回调地狱"变成链式调用，轻松编排异步任务。常用 API：

- `supplyAsync` / `runAsync`：异步启动一个有/无返回值的任务；
- `thenApply`：转换结果；`thenAccept`：消费结果；
- `thenCompose`：任务串联（前一个的结果喂给后一个）；
- `thenCombine`：两个任务都完成后合并；
- `allOf` / `anyOf`：等待**全部 / 任一**完成；
- `exceptionally` / `handle`：异常处理。

**高频实战：多个远程调用并行聚合**。下面三个调用并行执行，全部完成后聚合结果，总耗时约等于最慢的那个，而不是三者相加：

```java
package com.canoe.thread.util;

import java.util.concurrent.CompletableFuture;

public class CompletableFutureDemo {
    // 模拟三个远程调用（各自耗时不同）
    static CompletableFuture<String> queryUser() {
        return CompletableFuture.supplyAsync(() -> {
            sleep(300);
            return "用户信息";
        });
    }

    static CompletableFuture<String> queryOrder() {
        return CompletableFuture.supplyAsync(() -> {
            sleep(200);
            return "订单信息";
        });
    }

    static CompletableFuture<String> queryProduct() {
        return CompletableFuture.supplyAsync(() -> {
            sleep(100);
            return "商品信息";
        });
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) {}
    }

    public static void main(String[] args) {
        // 三个调用并行，用 thenCombine 逐步聚合，exceptionally 兜底异常
        CompletableFuture<String> result = queryUser()
                .thenCombine(queryOrder(), (u, o) -> u + " | " + o)
                .thenCombine(queryProduct(), (uo, p) -> uo + " | " + p)
                .exceptionally(ex -> "调用失败：" + ex.getMessage());

        System.out.println("聚合结果：" + result.join());
    }
}
```

## 本篇小结

- **`CountDownLatch` 等待 N 个任务完成**，一次性、不可重置。
- **`CyclicBarrier` 让多线程互相等到齐**，可循环复用且有 barrierAction。
- **`Semaphore` 用许可证限流**，`acquire`/`release`/`tryAcquire` 控制并发数。
- **`Exchanger` 用于两个线程在同步点交换数据**。
- **原子类靠 CAS 实现无锁并发**，比锁在冲突少时更快。
- **`LongAdder` 用分段思想**，高并发计数远快于 `AtomicLong`。
- **ABA 问题**用 `AtomicStampedReference` 加版本号解决。
- **`ConcurrentHashMap`** 是高并发 Map 首选，`CopyOnWriteArrayList` 适合读多写极少。
- **`BlockingQueue` 的 put/take 自动阻塞**，是生产者-消费者模型利器。
- **Fork/Join 用分治 + 工作窃取**，适合可并行拆分的计算任务。
- **`CompletableFuture` 用链式编排异步任务**，`allOf`/`thenCombine` 轻松并行聚合。

## 参考链接

- [java.util.concurrent 包文档](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/package-summary.html)
- [CountDownLatch API](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/CountDownLatch.html)
- [CyclicBarrier API](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/CyclicBarrier.html)
- [Semaphore API](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/Semaphore.html)
- [CompletableFuture API](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/CompletableFuture.html)
- [ConcurrentHashMap API](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ConcurrentHashMap.html)
- [Java 并发教程：并发工具](https://docs.oracle.com/javase/tutorial/essential/concurrency/)

下一篇 → [09 CAS 与 AQS](/java/thread/cas-aqs)
