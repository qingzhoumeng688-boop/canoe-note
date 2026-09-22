# 09 CAS 与 AQS

> 本篇导读：`synchronized` 和 `ReentrantLock` 背后靠"加锁"保证安全，但锁有开销、还可能死锁。有没有不加锁也能保证原子操作的方法？有，就是 **CAS（Compare And Swap）**。而 Java 并发包里一大票工具（`ReentrantLock`、`Semaphore`、`CountDownLatch`……）又都站在同一个地基 **AQS** 上。本文先讲 CAS 的原理、问题与乐观锁思想，再揭开 AQS 的面纱，最后带你手写一个基于 AQS 的同步器，把"地基"踩实。

## 一、CAS 是什么

CAS，全称 **Compare And Swap（比较并交换）**，是一条**原子**的 CPU 指令。它有三个操作数：

- **内存地址 V**：要改的变量所在位置；
- **预期值 A**：我认为它现在应该是这个值；
- **新值 B**：我想把它改成这个值。

一句话描述它的逻辑：**"我认为 V 现在是 A，如果是，就把它改成 B；如果不是（说明被别人改过了），我就什么都不做并返回失败，我自己重试。"**

```text
CAS(V, A, B):
    if  *V == A:
        *V = B
        return true    // 没人动过，改成功
    else:
        return false   // 被别人改过了，放弃，返回失败让我重试
```

比如要把 `count` 从 0 改成 1：先读出现在是 0（A=0），调 `CAS(count, 0, 1)`。如果期间没别人改过，`count` 变 1，成功；如果别的线程已经把它改成 1 了，本次 CAS 失败，我们就重新读、重新算、再 CAS——这就是**自旋重试**。`AtomicInteger` 的 `incrementAndGet()` 底层就是这个套路。

## 二、Unsafe 与原子指令

Java 代码里没法直接发 CPU 指令，早期的入口是 `sun.misc.Unsafe` 的 `compareAndSwapInt(obj, offset, expect, update)`（新版本 JDK 已改为通过 `VarHandle` 暴露，但本质一致）。它最终落到 CPU 的 **`cmpxchg`** 指令上。

为什么 `cmpxchg` 是原子的？靠两道保险：

- **总线锁定（Bus Lock）**：早期实现在 CAS 期间锁住前端总线，阻止别的 CPU 访问这块内存。简单但太重，会把整个总线都堵住。
- **缓存锁定（Cache Lock）**：现代 CPU 更聪明——只要被改的内存已经缓存在当前核的 L1/L2 缓存里，就只对这块缓存行加锁（MESI 协议），不影响别的内存。性能友好得多。

所以 CAS 的"原子性"不是靠 Java 保证的，而是**硬件 + CPU 指令**兜底的。这也是为什么它能做到"无锁也能原子"。

## 三、CAS 的三个问题

CAS 很强，但有三个绕不开的坑：

1. **ABA 问题**：变量从 A 改成 B 又改回 A，CAS 一看"还是 A"就以为没变过，其实中间已经被人动过。比如链表头被替换一圈又换回来，结构可能已损坏。解决方案：**加版本号**，`AtomicStampedReference` 把"值 + 版本戳"绑在一起，比对时连版本一起比。
2. **循环时间长开销大**：抢不到就一直自旋重试，如果竞争激烈，大量线程空转吃 CPU。所以要控制重试次数或改用锁。
3. **只能保证一个变量的原子操作**：CAS 一次只能针对一个内存地址。要原子地改多个变量，解决方法是用 `AtomicReference` 把多个字段**封装成一个对象**，对"对象引用"做 CAS。

```java
package com.canoe.thread.casaqs;

import java.util.concurrent.atomic.AtomicReference;

public class AtomicReferenceDemo {

    // 把多个字段封装成一个对象，再对"引用"做 CAS，解决"多变量原子"问题
    static class Account {
        final String name;
        final int balance;

        Account(String name, int balance) {
            this.name = name;
            this.balance = balance;
        }
    }

    public static void main(String[] args) {
        AtomicReference<Account> ref = new AtomicReference<Account>(new Account("张三", 100));
        // 一次性原子的换掉整个账户对象（含姓名+余额）
        boolean ok = ref.compareAndSet(new Account("张三", 100), new Account("张三", 200));
        System.out.println("更新是否成功：" + ok + "，余额：" + ref.get().balance);
    }
}
```

## 四、悲观锁 vs 乐观锁

CAS 是**乐观锁**的典型实现，对比一下两种思想：

| 对比维度 | 悲观锁 | 乐观锁（CAS） |
| --- | --- | --- |
| 假设 | 一定有人抢，先加锁再说 | 大概率没人抢，先改，冲突了再重试 |
| 实现 | `synchronized`、数据库 `SELECT FOR UPDATE` | CAS 指令、`Atomic` 系列 |
| 开销 | 加锁/释放/阻塞有成本 | 冲突少时极快，冲突多时自旋浪费 CPU |
| 适用 | 写多、冲突频繁 | 读多写少、冲突少 |

一个类比：数据库里的**乐观锁**常加一个 `version` 字段——更新时 `UPDATE ... SET val=?, version=version+1 WHERE version=?`，如果 `version` 对不上说明被别人改过，更新行数为 0，应用就重试。这和 `AtomicStampedReference` 的"值 + 版本戳"思路**一模一样**。

## 五、AQS 是什么

**AQS（AbstractQueuedSynchronizer）是 Java 并发包的"核心骨架"**。你用的 `ReentrantLock`、`Semaphore`、`CountDownLatch`、`ReentrantReadWriteLock` 全都继承/组合了它。

它运用的是**模板方法模式**：AQS 把"获取资源 / 释放资源"的通用流程（入队、阻塞、唤醒、自旋）写得死死的，而把 `tryAcquire`、`tryRelease`、`tryAcquireShared`、`tryReleaseShared` 这些**具体的"能不能拿、怎么放"的逻辑留成钩子让子类实现**。子类只管定义"state 怎么算抢到"，其余脏活 AQS 包办。这就是它能用一套框架养出一堆不同工具的秘密。

## 六、AQS 三大组件

看 AQS 内部，核心是三件套：

```text
                  AQS 内部结构
┌──────────────────────────────────────────┐
│  volatile int state   ← 同步状态          │
│  (ReentrantLock: 重入次数；Semaphore: 剩余许可)│
├──────────────────────────────────────────┤
│  FIFO 双向队列（CLH 变体：head → tail）     │
│  head → [node1] ⇄ [node2] ⇄ [node3] ←tail │
│  每个 node 封装一个等待中的线程              │
├──────────────────────────────────────────┤
│  CAS 操作：原子修改 state、原子入队/出队     │
└──────────────────────────────────────────┘
```

- **`state`（同步状态）**：一个 `volatile int`，语义由子类定。比如 `ReentrantLock` 用它记重入次数，`Semaphore` 用它记剩余许可。
- **FIFO 双向队列（CLH 变体）**：抢不到资源的线程被包装成节点排进这条队列，按顺序等待被唤醒。
- **CAS**：保证对 `state` 的修改、对队列指针的修改都是原子的，是整个机制不会乱的根基。

## 七、AQS 的两种模式

AQS 支持两种资源共享模式：

- **独占模式（Exclusive）**：同一时刻只有一个线程能持有，如 `ReentrantLock`。
- **共享模式（Shared）**：多个线程可同时持有，如 `Semaphore`、`CountDownLatch`、`ReadWriteLock` 的读锁。

以独占模式的 `acquire` 为例，源码流程可以简化成三步：

```text
acquire(arg):
  ├─ tryAcquire(arg) 成功？ → 直接返回，拿到锁
  └─ 失败 →
        ├─ addWaiter()       把当前线程包装成节点，入到 CLH 队尾
        └─ acquireQueued()   在队列里自旋/挂起，等被前驱唤醒后再次 tryAcquire
```

`release` 则是改 `state` + 唤醒队列里下一个节点。整条链路你不用自己写阻塞/唤醒，AQS 全包了，子类只实现 `tryAcquire`/`tryRelease` 即可。

## 八、基于 AQS 实现的类

并发包里这些"明星工具"其实都是 AQS 的子类，区别只在于**用 `state` 表示什么、用独占还是共享**：

| 工具类 | 模式 | `state` 的含义 |
| --- | --- | --- |
| `ReentrantLock` | 独占 | 锁的重入次数（0 表示空闲） |
| `ReentrantReadWriteLock` | 独占+共享 | 高 16 位读锁计数，低 16 位写锁计数 |
| `Semaphore` | 共享 | 剩余许可数 |
| `CountDownLatch` | 共享 | 还没倒数的计数器（`countDown` 减 1） |
| `ThreadPoolExecutor.Worker` | 独占 | 锁住工作线程，防止在执行时被中断 |
| `FutureTask` | 共享 | 任务运行状态（未完成/完成/取消） |

看懂这张表，你会发现"并发包里千姿百态的工具，骨架全是同一个 AQS"——这就是框架的力量。

## 九、自定义一个同步器

光看不过瘾，动手实现一个"**同一时刻最多允许 N 个线程进入**"的同步器（相当于 `Semaphore` 的简化版）。只需继承 AQS，实现共享模式的 `tryAcquireShared` 和 `tryReleaseShared`，`state` 表示"剩余许可数"：

```java
package com.canoe.thread.casaqs;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.AbstractQueuedSynchronizer;

public class LimitSyncDemo {

    // 基于 AQS 的共享同步器：最多允许 N 个线程同时进入
    static class NPermitsSync extends AbstractQueuedSynchronizer {

        NPermitsSync(int permits) {
            setState(permits);   // state 表示剩余许可数
        }

        // 共享模式获取：剩余许可减 arg，不足返回负数表示失败
        @Override
        protected int tryAcquireShared(int arg) {
            for (;;) {
                int current = getState();
                int remaining = current - arg;
                if (remaining < 0) {
                    return remaining;   // 许可不够，获取失败
                }
                if (compareAndSetState(current, remaining)) {
                    return remaining;   // CAS 成功，返回剩余数
                }
                // CAS 失败，自旋重试（体现 CAS 的自旋思想）
            }
        }

        // 共享模式释放：剩余许可加 arg
        @Override
        protected boolean tryReleaseShared(int arg) {
            for (;;) {
                int current = getState();
                int next = current + arg;
                if (compareAndSetState(current, next)) {
                    return true;
                }
            }
        }
    }

    // 对外门面：enter 进入、leave 离开
    static class Gate {
        private final NPermitsSync sync;

        Gate(int permits) {
            sync = new NPermitsSync(permits);
        }

        public void enter() throws InterruptedException {
            sync.acquireSharedInterruptibly(1);
        }

        public void leave() {
            sync.releaseShared(1);
        }
    }

    public static void main(String[] args) {
        Gate gate = new Gate(2);   // 同时最多 2 个线程进入
        for (int i = 1; i <= 5; i++) {
            final int id = i;
            new Thread(() -> {
                try {
                    gate.enter();
                    System.out.println("线程 " + id + " 进入，时间 " + System.currentTimeMillis());
                    TimeUnit.SECONDS.sleep(1);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    gate.leave();
                    System.out.println("线程 " + id + " 离开");
                }
            }, "t" + id).start();
        }
    }
}
```

跑这段代码会看到：尽管 5 个线程同时想进，但**任意时刻只有 2 个在"进入"后 sleep**，其余在 AQS 队列里乖乖排队，等有人 `leave()` 才被唤醒进场。这就是 AQS + CAS 协同工作的直观体现——我们没有写任何 `synchronized` 或 `wait/notify`，排队、阻塞、唤醒全由 AQS 代劳。

## 本篇小结

- **CAS** 是"比较并交换"的原子指令，逻辑是"值没被改就更新，否则重试"。
- CAS 的原子性由 CPU 的 `cmpxchg` 指令保证，靠**总线锁定或缓存锁定**实现。
- **ABA 问题**用版本号（`AtomicStampedReference`）解决，多变量原子用 `AtomicReference` 封装。
- CAS 自旋在**竞争激烈时浪费 CPU**，这是乐观锁的主要代价。
- **乐观锁**假设冲突少先改后验，对应 `Atomic` 系列；悲观锁假设必冲突先加锁。
- 数据库的 **version 字段乐观锁**与 CAS 的"值 + 版本"思路完全一致。
- **AQS 是并发包的核心骨架**，采用模板方法模式，把脏活包办、钩子留给子类。
- AQS 三大组件是 **`state` + CLH 队列 + CAS**，分别管状态、排队与原子修改。
- AQS 分**独占模式**（如 `ReentrantLock`）和**共享模式**（如 `Semaphore`）。
- 众多并发工具只是 AQS 子类，差异仅在 **`state` 的语义**与所用模式不同。
- 自定义同步器只需实现 `tryAcquire/tryRelease`（或其共享版），复用 AQS 的排队与唤醒。

## 参考链接

- [Java AtomicInteger 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)
- [Java AtomicStampedReference 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/atomic/AtomicStampedReference.html)
- [Java AbstractQueuedSynchronizer 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html)
- [Java Semaphore 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/Semaphore.html)
- [Java Unsafe 源码（OpenJDK）](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/misc/Unsafe.java)
- [Doug Lea 的 AQS 设计论文](http://gee.cs.oswego.edu/dl/papers/aqs.pdf)
- [《Java 并发编程实战》](https://www.amazon.com/Java-Concurrency-Practice-Brian-Goetz/dp/0321349601)

下一篇 → [10 ThreadLocal](/java/thread/threadlocal)
