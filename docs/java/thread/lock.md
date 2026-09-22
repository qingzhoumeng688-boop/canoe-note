# 06 Lock 锁

> 本篇导读：`synchronized` 用起来最省心——自动加锁、自动释放。但它有个硬伤：不够灵活。你想"等锁等一半就放弃"？想"被别人打断时立刻松手"？想"一把锁配多个等待队列精确唤醒"？`synchronized` 都做不到。`java.util.concurrent.locks` 包下的 `Lock` 接口及其实现（`ReentrantLock`、`ReentrantReadWriteLock`、`StampedLock`）就是来补这些短板的。本文从为什么需要它，一路讲到 AQS 这个"并发包地基"。

## 一、为什么要有 Lock

`synchronized` 确实好用，但它是"开箱即用、但选项为零"的锁。它的局限：

- **不能中断**：线程抢不到锁就一直 Blocked，外面想取消都没办法。
- **不能超时**：没有"最多等 3 秒"这种选项，死等到底。
- **不能尝试获取**：拿不到就阻塞，没有"拿不到我先去干别的"的 `tryLock`。
- **只有一个条件队列**：一个 `synchronized` 块只能对应一个隐式等待集合，`wait`/`notify` 没法精确唤醒某一类线程。
- **不够灵活**：无法知道锁当前被谁持有、无法做公平/非公平的取舍。

`Lock` 接口把这些能力一个个补上了。它不是要取代 `synchronized`，而是给你一个"高级选项包"。

## 二、ReentrantLock 基本用法

`ReentrantLock` 是最常用的 `Lock` 实现。核心就是 `lock()` 拿锁、`unlock()` 放锁，而**放锁必须放在 `finally` 里**——否则一旦业务代码抛异常，锁就永远不释放，后续线程全部卡死（死锁）。

```java
package com.canoe.thread.lock;

import java.util.concurrent.locks.ReentrantLock;

public class ReentrantLockBasicDemo {

    private static final ReentrantLock lock = new ReentrantLock();
    private static int count = 0;

    public static void main(String[] args) {
        lock.lock();          // 加锁
        try {
            count++;          // 受保护的临界区
            System.out.println("count = " + count);
        } finally {
            lock.unlock();    // 必须放 finally，确保一定释放
        }
    }
}
```

**反面教材**：把 `unlock()` 写在 `try` 外面或忘了写，一旦中间抛异常，锁就成了"无人认领"的死锁源头。这恰恰是 `synchronized` 用自动释放帮我们避开、而 `Lock` 需要我们自己小心的地方。

## 三、可重入

`ReentrantLock` 和 `synchronized` 一样是**可重入锁**：同一个线程可以多次获取同一把锁而不会把自己锁死，内部用一个计数器记录重入次数。

```java
package com.canoe.thread.lock;

import java.util.concurrent.locks.ReentrantLock;

public class ReentrantDemo {

    private static final ReentrantLock lock = new ReentrantLock();

    public static void outer() {
        lock.lock();
        try {
            System.out.println("进入 outer，重入次数 = " + lock.getHoldCount());
            inner();   // 同一线程再次加锁，不会死锁
        } finally {
            lock.unlock();
        }
    }

    public static void inner() {
        lock.lock();
        try {
            System.out.println("进入 inner，重入次数 = " + lock.getHoldCount());
        } finally {
            lock.unlock();
        }
    }

    public static void main(String[] args) {
        outer();
    }
}
```

`getHoldCount()` 能看到当前线程持有这把锁的次数。重入的意义在于：调用链上多层方法都加同一把锁时，不会因为"自己等自己"而卡死。

## 四、可中断与超时

这是 `Lock` 碾压 `synchronized` 的地方。`synchronized` 抢不到锁就只能死等，而 `ReentrantLock` 提供：

- **`lockInterruptibly()`**：抢锁过程中如果线程被 `interrupt()`，会立刻抛 `InterruptedException` 放手。
- **`tryLock()`**：立刻尝试拿锁，拿不到返回 `false`，不阻塞。
- **`tryLock(long, TimeUnit)`**：最多等这么久，超时返回 `false`。

下面这个例子演示用 `tryLock` **避免死锁**：两个线程都要拿 A、B 两把锁，谁先拿到不确定。一旦限时内拿不全，就释放已拿到的、稍后重试，从而打破"互相等待"的死锁环。

```java
package com.canoe.thread.lock;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

public class TryLockAvoidDeadlockDemo {

    private static final ReentrantLock lockA = new ReentrantLock();
    private static final ReentrantLock lockB = new ReentrantLock();

    public static void main(String[] args) {
        // 线程1：先A后B
        new Thread(() -> grab(lockA, lockB, "线程1"), "线程1").start();
        // 线程2：先B后A（故意反序，制造潜在死锁）
        new Thread(() -> grab(lockB, lockA, "线程2"), "线程2").start();
    }

    private static void grab(ReentrantLock first, ReentrantLock second, String name) {
        while (true) {
            if (first.tryLock()) {
                try {
                    // 第二把锁限时等，拿不到就放弃，打破死锁
                    if (second.tryLock(100, TimeUnit.MILLISECONDS)) {
                        try {
                            System.out.println(name + " 成功拿到两把锁，执行业务");
                            return;
                        } finally {
                            second.unlock();
                        }
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                } finally {
                    first.unlock();
                }
            }
            // 没拿全，稍后重试（这里让出一下，避免空转）
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }
}
```

## 五、公平锁与非公平锁

`ReentrantLock` 构造时可选公平策略：

- **非公平锁（默认）**：谁抢到算谁的，刚释放锁的线程有优势（可能插队）。吞吐高，但**可能出现线程饥饿**。
- **公平锁**：严格按"谁先等谁先拿"的顺序（`new ReentrantLock(true)`）。延迟有上界、更公平，但**性能明显更差**——因为要维护等待顺序、唤醒时大量线程竞争。

```java
package com.canoe.thread.lock;

import java.util.concurrent.locks.ReentrantLock;

public class FairVsUnfairDemo {

    // 公平锁：true；非公平锁：false（默认）
    private static final ReentrantLock fairLock = new ReentrantLock(true);

    public static void main(String[] args) {
        System.out.println("是否公平锁：" + fairLock.isFair());
    }
}
```

**选择建议**：绝大多数场景用默认的**非公平锁**就够了（吞吐优先）。只有当你明确遇到"低优先级任务长期拿不到锁"的饥饿问题，且能接受性能损耗时，才考虑公平锁。

## 六、Condition

`synchronized` 只能配一个隐式条件队列（`wait`/`notify`），没法精确唤醒某一类等待者。`Lock` 通过 `Condition` 解决了这个痛点：**一个 `Lock` 可以 `newCondition()` 出多个条件队列，精确唤醒特定的一批线程**。

下面用 `Condition` 实现一个**有界阻塞队列**（生产者-消费者模型），用 `notFull` 和 `notEmpty` 两个条件分别管"队列满"和"队列空"：

```java
package com.canoe.thread.lock;

import java.util.LinkedList;
import java.util.Queue;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

public class BoundedQueueDemo {

    private final Queue<Integer> queue = new LinkedList<Integer>();
    private final int capacity;
    private final ReentrantLock lock = new ReentrantLock();
    // 两个条件队列：一个管"不满"，一个管"不空"
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();

    public BoundedQueueDemo(int capacity) {
        this.capacity = capacity;
    }

    public void put(Integer item) throws InterruptedException {
        lock.lock();
        try {
            // 队列满了，就在"不满"条件上等
            while (queue.size() == capacity) {
                notFull.await();
            }
            queue.offer(item);
            System.out.println("生产 " + item + "，当前大小 " + queue.size());
            notEmpty.signal();   // 精确唤醒等"不空"的消费者
        } finally {
            lock.unlock();
        }
    }

    public Integer take() throws InterruptedException {
        lock.lock();
        try {
            // 队列空了，就在"不空"条件上等
            while (queue.isEmpty()) {
                notEmpty.await();
            }
            Integer item = queue.poll();
            System.out.println("消费 " + item + "，当前大小 " + queue.size());
            notFull.signal();    // 精确唤醒等"不满"的生产者
            return item;
        } finally {
            lock.unlock();
        }
    }

    public static void main(String[] args) {
        BoundedQueueDemo q = new BoundedQueueDemo(3);
        new Thread(() -> {
            try {
                for (int i = 1; i <= 5; i++) {
                    q.put(i);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "生产者").start();

        new Thread(() -> {
            try {
                for (int i = 1; i <= 5; i++) {
                    q.take();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "消费者").start();
    }
}
```

`signal()`/`signalAll()` 比 `notify()`/`notifyAll()` 强在能**定向唤醒**——生产者只唤醒消费者、消费者只唤醒生产者，避免了不必要的惊群竞争。

## 七、AQS 原理

`ReentrantLock`、`Semaphore`、`CountDownLatch`、`ReentrantReadWriteLock`……这些并发工具长得各不相同，却几乎都站在同一个巨人肩膀上——**`AbstractQueuedSynchronizer`（AQS）**。它是并发包的"地基"。

AQS 靠三大组件工作：

```text
                  AQS 内部结构
┌──────────────────────────────────────────┐
│  volatile int state   ← 同步状态          │
│  (ReentrantLock 用它记重入次数)            │
├──────────────────────────────────────────┤
│  FIFO 双向队列（CLH 变体，head→tail）      │
│  head → [node1] ⇄ [node2] ⇄ [node3] ←tail │
│  每个 node 封装一个等待中的线程             │
├──────────────────────────────────────────┤
│  CAS 操作：原子地修改 state、原子地入队     │
└──────────────────────────────────────────┘
```

- **`state`**：同步状态。比如 `ReentrantLock` 用它表示重入次数，`Semaphore` 用它表示剩余许可数。
- **CLH 队列**：抢不到锁的线程被包装成节点，排进这条 FIFO 队列里自旋/挂起等待。
- **CAS**：保证对 `state` 和队列指针的修改是原子的。

AQS 用的是**模板方法模式**：它把"获取/释放"的通用骨架（入队、阻塞、唤醒）写好，把 `tryAcquire`、`tryRelease` 等具体逻辑留给子类实现。所以你只要实现这几个钩子方法，就能造出一把新锁。

## 八、读写锁 ReentrantReadWriteLock

有些场景是"**读多写少**"。如果读写都加互斥锁，读之间也互相阻塞，太浪费。`ReentrantReadWriteLock` 把锁拆成两把：

- **读锁（共享）**：多个线程可同时读，读读不互斥。
- **写锁（独占）**：写的时候，既不能有其他写，也不能有其他读（读写互斥、写写互斥）。

```java
package com.canoe.thread.lock;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class ReadWriteLockCacheDemo {

    private final Map<String, String> cache = new HashMap<String, String>();
    private final ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();

    public String get(String key) {
        rwLock.readLock().lock();          // 读锁，可并发
        try {
            return cache.get(key);
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public void put(String key, String value) {
        rwLock.writeLock().lock();         // 写锁，独占
        try {
            cache.put(key, value);
            System.out.println("写入 " + key + " = " + value);
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    public static void main(String[] args) {
        ReadWriteLockCacheDemo demo = new ReadWriteLockCacheDemo();
        demo.put("site", "canoe-notes");
        System.out.println("读取 " + demo.get("site"));
    }
}
```

两个进阶细节：

- **锁降级**：写锁可以"降级"为读锁（先拿写锁、再拿读锁、再放写锁），是安全的，用于"改完数据马上读"的场景保证不被别人插空。
- **不能升级**：读锁**不能升级**为写锁（先拿读锁再想拿写锁），因为可能已有多个读线程，互相升级会死锁，AQS 直接禁止。

## 九、StampedLock

JDK 8 引入的 `StampedLock` 在"读多写少"上又往前一步——它支持**乐观读**：读的时候**完全不加锁**，只是记一个"戳（stamp）"，读完用 `validate(stamp)` 检查一下期间有没有人写过，没有就直接用了。

```java
package com.canoe.thread.lock;

import java.util.concurrent.locks.StampedLock;

public class StampedLockDemo {

    private double x = 0.0;
    private double y = 0.0;
    private final StampedLock stampedLock = new StampedLock();

    // 乐观读：不加读锁，先快照再校验
    public double distanceFromOrigin() {
        long stamp = stampedLock.tryOptimisticRead();  // 拿一个戳
        double currentX = x;
        double currentY = y;
        // 校验戳：期间没写操作则校验通过，直接返回
        if (!stampedLock.validate(stamp)) {
            stamp = stampedLock.readLock();            // 被改过，老老实实加读锁重读
            try {
                currentX = x;
                currentY = y;
            } finally {
                stampedLock.unlockRead(stamp);
            }
        }
        return Math.sqrt(currentX * currentX + currentY * currentY);
    }

    public void move(double deltaX, double deltaY) {
        long stamp = stampedLock.writeLock();
        try {
            x += deltaX;
            y += deltaY;
        } finally {
            stampedLock.unlockWrite(stamp);
        }
    }

    public static void main(String[] args) {
        StampedLockDemo demo = new StampedLockDemo();
        demo.move(3.0, 4.0);
        System.out.println("距离原点 = " + demo.distanceFromOrigin());
    }
}
```

**注意**：`StampedLock` **不可重入**，且它的 `readLock()`/`writeLock()` 不支持 `Condition`、被中断时不会抛异常而是直接返回（需要自己检查）。乐观读适合"读极多、写极少、且读的数据结构简单"的场景，普通场景用 `ReentrantReadWriteLock` 更稳妥。

## 十、synchronized vs ReentrantLock

| 对比维度 | `synchronized` | `ReentrantLock` |
| --- | --- | --- |
| 加解锁方式 | 自动（进入/退出同步块） | 手动 `lock()`/`unlock()` |
| 中断等待 | 不支持 | 支持（`lockInterruptibly`） |
| 超时获取 | 不支持 | 支持（`tryLock(time)`） |
| 公平策略 | 非公平 | 可选公平/非公平 |
| 条件队列 | 只有 1 个 | 多个 `Condition` |
| 性能 | 经 JVM 持续优化，已很好 | 高竞争下更可控 |
| 可读性 | 简洁 | 代码更多 |

**选择建议**：**简单场景优先 `synchronized`**——写法简洁、不会忘释放、JVM 还在持续做锁升级优化。只有当你确实需要"可中断、可超时、公平锁、多条件队列"这些高级特性时，才上 `ReentrantLock`。不要为了"显得高级"而无脑用 `Lock`。

## 本篇小结

- `synchronized` 的短板是**不能中断、不能超时、不能尝试获取、只有一个条件队列**，不够灵活。
- `ReentrantLock` 用 `lock()`/`unlock()`，放锁**必须写在 `finally`**，否则易死锁。
- `ReentrantLock` 是**可重入**的，`getHoldCount()` 可查看重入次数。
- `tryLock`/`lockInterruptibly` 让锁变得**可中断、可超时**，能主动打破死锁。
- **非公平锁**是默认且吞吐更高的选择，公平锁保证顺序但性能差很多。
- 一个 `Lock` 可 `newCondition()` 出**多个条件队列**，实现精确的线程唤醒。
- AQS 是并发包的**地基**，靠 `state` + CLH 队列 + CAS 三大组件工作。
- `ReentrantReadWriteLock` 做到**读读共享、读写/写写互斥**，适合读多写少。
- 读写锁支持**锁降级**但**不支持读锁升级为写锁**（会死锁）。
- `StampedLock` 的**乐观读**性能更好，但**不可重入**、无 Condition，使用要谨慎。
- 简单场景用 `synchronized`，需要高级特性才用 `Lock`，不要过度设计。

## 参考链接

- [Java Lock 接口官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/locks/Lock.html)
- [Java ReentrantLock 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)
- [Java ReentrantReadWriteLock 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html)
- [Java StampedLock 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/locks/StampedLock.html)
- [Java AQS 源码（AbstractQueuedSynchronizer）](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java)
- [Doug Lea 的 AQS 论文](http://gee.cs.oswego.edu/dl/papers/aqs.pdf)
- [《Java 并发编程实战》](https://www.amazon.com/Java-Concurrency-Practice-Brian-Goetz/dp/0321349601)

下一篇 → [07 线程池](/java/thread/pool)
