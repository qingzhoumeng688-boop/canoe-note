# 03 线程状态与生命周期

> 本篇导读：线程不是"一启动就一直跑"，它会在新建、运行、阻塞、等待、死亡之间反复流转。理解这六种状态以及触发它们切换的方法（`sleep`/`wait`/`join`/`yield`/`notify`），是看懂死锁、`jstack` 线程 dump、以及正确停止线程的前提。本文还重点辨析 `sleep` 与 `wait`、`BLOCKED` 与 `WAITING` 这些面试高频易错点。

## 一、六种状态

Java 线程在 `Thread.State` 枚举里定义了**六种状态**。一张流转图先看全貌：

```text
        new Thread()
             │
             ▼
            NEW ────────── start() ──────────► RUNNABLE ◄────────┐
                                                            │     │ (被 OS 调度)
                                                            ▼     │
                                                      运行中 / 就绪  │
   RUNNABLE ── 等 synchronized 锁 ──► BLOCKED ── 获锁 ────────────┘
   RUNNABLE ── wait()/join()/park() ──► WAITING ── notify/中断 ───┘
   RUNNABLE ── sleep(t)/wait(t)/join(t) ──► TIMED_WAITING ── 超时/notify ─┘
   任意状态 ── run() 正常结束或抛异常 ──► TERMINATED
```

逐个解释：

- **NEW（新建）**：`new Thread()` 之后、`start()` 之前。此时线程对象有了，但操作系统里还没有真正的线程。
- **RUNNABLE（可运行）**：调了 `start()` 之后。注意它**包含**了操作系统层面的"就绪"和"运行"两种——只要没被阻塞、没在等，就是 RUNNABLE。
- **BLOCKED（阻塞）**：**专门指等 `synchronized` 内置锁**而进不去同步块的状态。
- **WAITING（无限等待）**：调了 `Object.wait()`、`Thread.join()`、`LockSupport.park()` 之后，没人唤醒就一直等。
- **TIMED_WAITING（限时等待）**：带超时的等待，如 `sleep(long)`、`wait(long)`、`join(long)`。
- **TERMINATED（终止）**：`run()` 执行完或抛异常退出，线程走完了它的一生。

**BLOCKED 与 WAITING 的区别是面试常考点**：BLOCKED 是"在门口等锁"，是竞争资源的被动排队；WAITING 是"主动停下等别人叫醒"，通常用于线程间协作（比如生产者等消费者消费）。

## 二、RUNNABLE 不等于运行中

很多人误以为 RUNNABLE 就是"正在跑"。其实 JVM 把"**就绪**"（在就绪队列里等着被调度）和"**运行**"（正占用 CPU）都归到了 RUNNABLE 一个状态里。

原因是：一个 Java 线程到底有没有真正占用 CPU，是由**操作系统调度器**决定的，JVM 并不实时感知。所以你在 `jstack` 里看到某个线程是 RUNNABLE，它可能已经因为时间片用完被切走了。判断"卡在哪"时，要结合栈帧看它到底卡在什么方法上，而不是只看状态。

## 三、状态转换方法

哪些方法会把线程推到什么状态？一张表记牢：

| 方法 | 调用方 | 进入状态 | 退出条件 |
| --- | --- | --- | --- |
| `start()` | 其他线程 | NEW → RUNNABLE | 线程被调度 |
| `sleep(long)` | 当前线程 | RUNNABLE → TIMED_WAITING | 时间到 / 被中断 |
| `wait()` | 当前线程（需持锁） | RUNNABLE → WAITING | `notify` / 被中断 |
| `wait(long)` | 当前线程（需持锁） | RUNNABLE → TIMED_WAITING | 超时 / `notify` / 中断 |
| `join()` | 其他线程 | 其他线程 RUNNABLE → WAITING | 目标线程结束 |
| `yield()` | 当前线程 | RUNNABLE → RUNNABLE（让出一下） | 立刻重新参与调度 |
| `notify()`/`notifyAll()` | 其他线程 | 唤醒 WAITING 线程 | 被唤醒线程重新抢锁 |
| 抢 `synchronized` 锁失败 | 当前线程 | RUNNABLE → BLOCKED | 拿到锁 |

## 四、sleep 与 wait 的区别

这是**面试必考**，`sleep` 和 `wait` 看着都"停一下"，本质完全不同：

| 对比维度 | `Thread.sleep(long)` | `Object.wait()` |
| --- | --- | --- |
| 所属类 | `Thread` 静态方法 | `Object` 实例方法 |
| 是否释放锁 | **不释放**任何锁 | **释放**持有的对象锁 |
| 使用条件 | 任何地方都能调 | **必须在 `synchronized` 块/方法里** |
| 唤醒方式 | 时间到自动醒 | 需要 `notify`/`notifyAll` 或中断 |
| 用途 | 单纯暂停当前线程 | 线程间协作（等条件满足） |

```java
package com.canoe.thread.lifecycle;

public class SleepVsWaitDemo {

    private static final Object LOCK = new Object();

    public static void main(String[] args) throws InterruptedException {
        // 演示 wait 必须在同步块里，且会释放锁
        new Thread(() -> {
            synchronized (LOCK) {
                try {
                    System.out.println("线程A 进入同步块，准备 wait（会释放锁）");
                    LOCK.wait();   // 释放 LOCK，进入 WAITING
                    System.out.println("线程A 被唤醒，重新拿到锁，继续");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }, "线程A").start();

        Thread.sleep(100);   // 主线程 sleep，注意：它不释放任何锁

        synchronized (LOCK) {
            System.out.println("主线程拿到锁，唤醒线程A");
            LOCK.notify();
        }
    }
}
```

记住口诀：**`sleep` 抱着锁睡，`wait` 哭着把锁交出去等人哄。**

## 五、join

`join()` 的意思是"**等这个线程死（结束）**"。主线程调 `t.join()`，主线程就会进入 WAITING，直到 `t` 跑完才继续。典型用途：主线程等若干子线程把活儿干完再汇总。

```java
package com.canoe.thread.lifecycle;

import java.util.ArrayList;
import java.util.List;

public class JoinDemo {

    public static void main(String[] args) throws InterruptedException {
        List<Thread> workers = new ArrayList<Thread>();
        int[] results = new int[3];

        for (int i = 0; i < 3; i++) {
            final int index = i;
            Thread t = new Thread(() -> {
                results[index] = index * 10;
                System.out.println("子线程 " + index + " 算完");
            });
            t.start();
            workers.add(t);
        }

        // 主线程依次 join，等所有子线程结束
        for (Thread t : workers) {
            t.join();
        }

        int total = 0;
        for (int r : results) {
            total += r;
        }
        System.out.println("全部完成，汇总结果 = " + total);
    }
}
```

`join(long)` 是带超时的版本：最多等这么久，超时就不等了，主线程继续执行（此时子线程可能还没结束）。其底层本质是 `wait()`，所以它在等待期间是 **WAITING / TIMED_WAITING** 状态。

## 六、yield

`yield()` 的意思是"我**让出一下 CPU**，你们先来"。但它是**建议性**的——操作系统完全可以无视你这个请求，线程让完可能立刻又被调度回来。它**不释放锁**，也几乎不改变状态（还是 RUNNABLE）。

实际开发中 `yield()` **很少用**，因为它对不同 OS 的语义不一致，容易写出不可移植的代码。新手基本可以忽略它，知道有这回事即可。

## 七、interrupt 机制

这是理解"如何停止线程"的关键。**`interrupt()` 并不会真的杀掉线程**，它只是给目标线程"贴了个中断标签（标志位设为 true）"。目标线程必须在代码里**自己检查这个标签并主动退出**，否则啥也不会发生。

```java
package com.canoe.thread.lifecycle;

public class InterruptDemo {

    public static void main(String[] args) throws InterruptedException {
        Thread worker = new Thread(() -> {
            // 正确姿势：循环里检查中断标志
            while (!Thread.currentThread().isInterrupted()) {
                System.out.println("工作中...");
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    // sleep 被中断会抛异常，并【自动清除】中断标志
                    // 想让上层感知，应该重新设置标志
                    Thread.currentThread().interrupt();
                    System.out.println("收到中断，准备退出");
                    break;
                }
            }
        }, "worker");
        worker.start();

        Thread.sleep(1500);
        worker.interrupt();   // 只是设标志 / 唤醒阻塞中的 sleep
    }
}
```

几个要点：

- **`isInterrupted()`**：看当前标志，不清除。
- **`interrupted()`**（静态方法）：看**当前线程**的标志，并且**会把它清除**成 false——很多 bug 就出在误用了它导致标志被吃掉。
- 当线程正阻塞在 `sleep()`/`wait()`/`join()` 上时，被 `interrupt()` 会**立刻抛 `InterruptedException`，并且自动清除中断标志**。所以捕获异常后如果想让上层知道，记得重新 `interrupt()` 把标志补回去。

## 八、如何优雅停止线程

**反例**：`Thread.stop()`、`suspend()`、`resume()` 早在 Java 1.2 就被标记为**废弃**。它们会"暴力"终止线程，不释放已持有的锁、不保证资源清理，极易把对象搞成半成品状态，引发难以排查的诡异 bug。**绝对不要用。**

正确做法是用**中断标志**或 `volatile` 标志位，让线程自己"体面下班"：

```java
package com.canoe.thread.lifecycle;

public class GracefulStopDemo {

    // volatile 保证可见性：主线程改了，工作线程立刻能看到
    private static volatile boolean running = true;

    public static void main(String[] args) throws InterruptedException {
        Thread worker = new Thread(() -> {
            while (running && !Thread.currentThread().isInterrupted()) {
                System.out.println("健康工作中...");
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
            System.out.println("线程已优雅退出，释放资源");
        }, "worker");

        worker.start();
        Thread.sleep(2000);

        // 两种停止信号都给上：volatile 标志 + 中断
        running = false;
        worker.interrupt();
    }
}
```

一般同时用 `volatile` 标志 + `interrupt()` 双保险：前者用于"正常轮询"的退出，后者用于唤醒可能阻塞在 `sleep`/`wait` 上的线程。

## 九、查看线程状态

出问题时怎么知道线程卡在哪个状态？

- **`jstack <pid>`**：命令行打印 JVM 所有线程的栈和状态。看 `java.lang.Thread.State:` 后面那串，对应前面的六种状态。比如看到 `BLOCKED (on object monitor)` 就知道在等锁，`WAITING (parking)` 是 `LockSupport.park` 之类。
- **IDEA 自带的线程 dump**：Run 面板点"相机"图标，或在 Debug 时看 Threads 视图，能图形化看到每个线程的状态和调用栈。
- **对应关系**：`jstack` 里的 `RUNNABLE`、`BLOCKED`、`WAITING`、`TIMED_WAITING`、`TERMINATED` 与 `Thread.State` 枚举一一对应；`NEW` 一般还没跑起来看不到。

排查死锁时，`jstack` 末尾通常会直接打印 `Found one Java-level deadlock:` 并列出互相持有、互相等待的锁，是定位死锁最快的手段。

## 本篇小结

- Java 线程有**六种状态**：NEW、RUNNABLE、BLOCKED、WAITING、TIMED_WAITING、TERMINATED。
- **RUNNABLE 同时涵盖"就绪"和"运行"**，不能简单等同于正在占用 CPU。
- **BLOCKED** 是等 `synchronized` 锁的被动排队，**WAITING** 是主动停下等被唤醒的协作。
- `sleep()` **不释放锁**，`wait()` **释放锁**且必须在同步块里调用。
- `join()` 让调用方线程等待目标线程结束，底层基于 `wait()`。
- `yield()` 只是"建议让出 CPU"，**不释放锁**，几乎不改变状态，实际很少用。
- `interrupt()` 只**设置中断标志**，不会真的停止线程，需代码自行检查退出。
- `interrupted()` 会**清除**中断标志，`isInterrupted()` 不会，两者极易用错。
- 阻塞在 `sleep`/`wait`/`join` 时收到中断会抛 `InterruptedException` **并清除标志**，记得补 `interrupt()`。
- **`stop()`/`suspend()` 已废弃**，会破坏锁与对象状态，严禁使用。
- 优雅停止靠 **`volatile` 标志 + `interrupt()`** 双保险，让线程自己退出。
- `jstack` 能直接打印线程状态甚至**自动发现死锁**，是排查第一工具。

## 参考链接

- [Oracle 并发教程 - 线程生命周期](https://docs.oracle.com/javase/tutorial/essential/concurrency/states.html)
- [Java Thread.State 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Thread.State.html)
- [Java Thread 类官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Thread.html)
- [Java Language Specification 第 17 章](https://docs.oracle.com/javase/specs/jls/se17/html/jls-17.html)
- [jstack 工具官方文档](https://docs.oracle.com/en/java/javase/17/docs/specs/man/jstack.html)
- [《Java 并发编程实战》](https://www.amazon.com/Java-Concurrency-Practice-Brian-Goetz/dp/0321349601)

下一篇 → [04 synchronized 锁](/java/thread/synchronized)
