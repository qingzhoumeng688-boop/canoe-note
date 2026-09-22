# 04 synchronized 锁

`synchronized` 是 Java 最古老也最常用的同步手段，但它远不止"加个关键字"那么简单。本篇先用一段"两个线程各加 1 万次结果却不到 2 万"的复现代码讲清**为什么需要同步**，再深入对象头、Monitor、锁升级与锁优化等底层原理，最后给出可重入、使用建议与死锁排查的完整实战。理解这些，你才能知道这把锁到底"锁住了什么"。

## 一、为什么需要同步

看一段最朴素的计数代码：两个线程各加 1 万次，你以为结果是 2 万，实际往往少很多。

```java
package com.canoe.thread.sync;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class UnsafeCounterDemo {
    private int count = 0;

    public void increment() {
        count++; // 看似一行，实际是"读-改-写"三步
    }

    public static void main(String[] args) throws InterruptedException {
        UnsafeCounterDemo demo = new UnsafeCounterDemo();
        int threadCount = 2;
        int perThread = 10000;
        CountDownLatch latch = new CountDownLatch(threadCount);
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        for (int i = 0; i < threadCount; i++) {
            pool.execute(() -> {
                for (int j = 0; j < perThread; j++) {
                    demo.increment();
                }
                latch.countDown();
            });
        }
        latch.await();
        pool.shutdown();
        System.out.println("期望结果：" + (threadCount * perThread));
        System.out.println("实际结果：" + demo.count);
    }
}
```

问题出在 `count++` 上。它不是原子操作，而是拆成了三步：

1. **读**：从内存把 `count` 读到工作内存；
2. **改**：在工作内存里执行 `+1`；
3. **写**：把新值写回内存。

两个线程可能同时读到 `100`，各自加 1 后都写回 `101`，一次自增就"丢了"。这种**竞态条件（Race Condition）** 就是需要 `synchronized` 的原因——它把临界区串行化，保证同一时刻只有一个线程在执行。

## 二、synchronized 的用法

`synchronized` 有三种写法，核心区别在于**锁住的是哪个对象**：

```java
package com.canoe.thread.sync;

public class SynchronizedUsageDemo {

    // 1. 修饰实例方法：锁的是当前对象 this
    public synchronized void instanceMethod() {
        System.out.println("实例方法，锁住 this");
    }

    // 2. 修饰静态方法：锁的是 SynchronizedUsageDemo.class 这个 Class 对象
    public static synchronized void staticMethod() {
        System.out.println("静态方法，锁住 Class 对象");
    }

    // 3. 修饰代码块：锁的是括号里显式指定的对象
    private final Object lock = new Object();

    public void blockMethod() {
        synchronized (lock) {
            System.out.println("代码块，锁住指定对象");
        }
    }
}
```

- **实例方法**：锁 `this`，不同实例之间互不影响。
- **静态方法**：锁 `Class` 对象（全局只有一份），等价于所有实例共用同一把锁。
- **同步代码块**：最灵活，推荐用私有 `final` 对象做锁，锁粒度可控、且不会和外部代码意外冲突。

## 三、锁的是什么

很多人误以为"锁的是这段代码"。**真相是：synchronized 锁的是对象（Object 的 Monitor），不是代码本身。** 只要两个地方锁定的是**同一个对象**，即便它们访问不同的方法，也会互斥。

下面代码中，`methodA` 和 `methodB` 是两个不同的同步方法，但线程访问的是同一个 `demo` 对象，于是它们会互斥——`methodB` 必须等 `methodA` 释放锁才能进入：

```java
package com.canoe.thread.sync;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LockObjectDemo {
    public synchronized void methodA() {
        System.out.println(Thread.currentThread().getName() + " 进入 methodA");
        try { Thread.sleep(1000); } catch (InterruptedException e) {}
        System.out.println(Thread.currentThread().getName() + " 离开 methodA");
    }

    public synchronized void methodB() {
        System.out.println(Thread.currentThread().getName() + " 进入 methodB");
        System.out.println(Thread.currentThread().getName() + " 离开 methodB");
    }

    public static void main(String[] args) throws InterruptedException {
        LockObjectDemo demo = new LockObjectDemo();
        CountDownLatch latch = new CountDownLatch(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        // 同一个对象的两个不同同步方法 → 互斥
        pool.execute(() -> { demo.methodA(); latch.countDown(); });
        pool.execute(() -> { demo.methodB(); latch.countDown(); });
        latch.await();
        pool.shutdown();
    }
}
```

注意：如果让两个线程分别 `new` 一个对象，那它们锁的是不同实例，就不会互斥了。

## 四、对象头与 Mark Word

在 JVM（以 HotSpot 为例）里，每个 Java 对象在堆中分为三块：**对象头（Header）、实例数据（Instance Data）、对齐填充（Padding）**。对象头又分为 **Mark Word** 和 **类型指针（Klass Pointer）**，如果是数组还会有数组长度。

其中 **Mark Word 是锁状态的"身份证"**：它根据对象当前处于哪种锁状态，存不同的内容（以 32 位 JVM 为例，空间中 25/23/25/30 这些数字指对应字段占用的 bit 数）：

```text
|--------------------------- Mark Word (32 bit) ---------------------------|
| 锁状态      | 25 bit           | 4 bit  | 1 bit (是否偏向) | 2 bit (锁标志) |
|-------------|------------------|--------|------------------|----------------|
| 无锁        | 对象 hashCode     | 分代年龄 | 0                | 01             |
| 偏向锁      | 线程ID + epoch    | 分代年龄 | 1                | 01             |
| 轻量级锁    | 指向栈中锁记录的指针                               | 00             |
| 重量级锁    | 指向操作系统 Monitor 的指针                         | 10             |
| GC 标记     | 空（CMS 等回收器使用）                              | 11             |
```

一句话记忆：**锁标志位（最后 2 bit）决定锁的类型，Mark Word 其余内容随锁状态而变。** 这也是为什么同一个对象，在不同时刻被加锁会表现出不同性能特征。

## 五、Monitor

**Monitor（管程/监视器）** 是 `synchronized` 的底层实现机制，可以把它理解成每个 Java 对象"与生俱来"的一把看不见的锁，由 JVM 依赖操作系统的互斥原语（如 pthread mutex）实现。

- 修饰**代码块**时，编译后会在前后插入 `monitorenter` 和 `monitorexit` 字节码；
- 修饰**方法**时，编译后会在方法表的 `ACC_SYNCHRONIZED` 标志位上做文章，进入方法前自动 `monitorenter`，退出时 `monitorexit`。

用 `javap -c` 反编译同步代码块，能看到两个 `monitorexit`：

```text
public void blockIncrement();
    Code:
       0: aload_0
       1: getfield      #3   // 取出锁对象 lock
       4: dup
       5: astore_1
       6: monitorenter        // 进入 Monitor，获取锁
       7: aload_0
      ...
      17: aload_1
      18: monitorexit         // 正常路径：释放锁（第一个 monitorexit）
      19: goto          27
      22: aload_1
      23: monitorexit         // 异常路径：释放锁（第二个 monitorexit）
      24: athrow
      27: return
```

**为什么有两个 `monitorexit`？** 因为要保证锁一定会被释放：第一个对应正常执行完释放；第二个是编译器偷偷加的**异常表（exception table）** 分支，保证方法因异常退出时，锁也能被正确释放，避免死锁。

## 六、锁升级

JDK 6 之后，`synchronized` 不再是"一上来就挂操作系统锁"，而是**根据竞争激烈程度逐级升级**，用最小的代价满足需求：

```text
 无锁 ──(只有一个线程访问)──▶ 偏向锁 ──(多线程交替访问)──▶ 轻量级锁 ──(真正竞争/自旋失败)──▶ 重量级锁
  ▲                                                                                      │
  └──────────────────────────── 锁只能升级，不能降级 ─────────────────────────────────────┘
```

- **无锁**：对象刚创建、还没被任何线程当作锁使用。
- **偏向锁**：第一个线程来了，就在 Mark Word 里记下它的线程 ID。之后这个线程再进同步块，**无需任何 CAS、无需真正加锁**，直接通过，开销极低。适合"基本只有单线程访问"的场景。
- **轻量级锁**：当有第二个线程来竞争，偏向锁被撤销，升级为轻量级锁。线程在自己的栈帧里建一个**锁记录（Lock Record）**，通过 CAS 尝试把 Mark Word 指向它。适合**线程交替执行、竞争不激烈**的场景，本质是用**自旋**避免立刻陷入操作系统阻塞。
- **重量级锁**：当竞争激烈、自旋长时间拿不到锁，就膨胀为重量级锁，Mark Word 指向操作系统的 `Monitor`，拿不到锁的线程被挂起（阻塞），需要内核态与用户态切换，开销最大。适合**真并发、长时间持锁**的场景。

**关键结论：锁只能升级不能降级。** 因为降级需要复杂的撤销逻辑，且实际收益很小，JVM 选择"一路向上"以保证简单与稳定。（注：JDK 15 起偏向锁默认已禁用，详见 JEP 374，但理解它仍是面试与原理学习的核心。）

## 七、锁优化

JVM 在 JIT 编译期还做了不少"看不见的优化"：

**锁消除（Lock Elimination）**：JIT 通过**逃逸分析**发现某个加锁对象不会逃逸出当前线程（比如只在方法局部使用），就会直接把 `synchronized` 去掉。下面的 `StringBuffer` 是局部变量，不会被别的线程看到，JIT 会消除其内部同步：

```java
package com.canoe.thread.sync;

public class LockEliminationDemo {
    // sb 未逃逸出方法，JIT 会消除 StringBuffer 内部的 synchronized 同步
    public String concat(String a, String b, String c) {
        StringBuffer sb = new StringBuffer();
        sb.append(a);
        sb.append(b);
        sb.append(c);
        return sb.toString();
    }

    public static void main(String[] args) {
        LockEliminationDemo demo = new LockEliminationDemo();
        System.out.println(demo.concat("并发", "编程", "实战"));
    }
}
```

**锁粗化（Lock Coarsening）**：如果一段代码里对同一个对象反复加锁/解锁（比如循环里每次都 `synchronized`），JIT 会把锁范围**扩大**到整个循环外，减少加锁次数。

**自旋锁与自适应自旋**：轻量级锁竞争时，线程不会立刻被挂起，而是**空转（自旋）** 等一会儿，期待锁很快释放。JDK 后来演进为**自适应自旋**：自旋时间不再固定，而是根据上次在同一个锁上自旋的成功率动态调整。

## 八、可重入性

`synchronized` 是**可重入锁**：同一个线程可以反复进入它已经持有的锁，JVM 用一个**计数器**记录重入次数，每进入一次 +1，每退出一次 -1，归零时才真正释放。所以一个同步方法调用另一个同步方法，不会把自己锁死：

```java
package com.canoe.thread.sync;

public class ReentrantDemo {
    public synchronized void outer() {
        System.out.println("outer 持有锁，调用 inner");
        inner(); // 同一线程再次进入同步方法，可重入，不会死锁
    }

    public synchronized void inner() {
        System.out.println("inner 可重入，仍然持有同一把锁");
    }

    public static void main(String[] args) {
        new ReentrantDemo().outer();
    }
}
```

## 九、使用建议

- **同步块尽量小**：只把真正需要保护的临界区放进 `synchronized`，缩小持锁时间，降低竞争。
- **不要用字符串常量 / 字面量做锁**：`synchronized("ABC")` 可能和你依赖的第三方库锁住**同一个常量池对象**，引发莫名其妙的互斥。用私有 `private final Object lock = new Object();` 最稳妥。
- **不要锁可变对象**：锁对象如果被替换成另一个实例，锁就"失效"了，多个线程可能同时进入。
- **不要在同步块里做耗时 IO / 远程调用**：这会长时间占着锁，拖垮整个系统的并发度。
- **避免嵌套锁**：多个锁交叉获取是死锁的温床，必须嵌套时统一加锁顺序。

## 十、死锁

当两个（或多个）线程**互相等待对方持有的锁**，谁都走不下去，就发生了死锁。下面是一段会产生死锁的代码：线程 1 拿了 A 等 B，线程 2 拿了 B 等 A，形成循环等待。

```java
package com.canoe.thread.sync;

import java.util.concurrent.TimeUnit;

public class DeadlockDemo {
    private static final Object lockA = new Object();
    private static final Object lockB = new Object();

    public static void main(String[] args) {
        // 线程 1：先拿 A，再等 B
        new Thread(() -> {
            synchronized (lockA) {
                System.out.println("线程1 拿到 lockA，等待 lockB...");
                try { TimeUnit.MILLISECONDS.sleep(100); } catch (InterruptedException e) {}
                synchronized (lockB) {
                    System.out.println("线程1 拿到 lockB");
                }
            }
        }, "Thread-1").start();

        // 线程 2：先拿 B，再等 A，与线程 1 顺序相反 → 循环等待
        new Thread(() -> {
            synchronized (lockB) {
                System.out.println("线程2 拿到 lockB，等待 lockA...");
                synchronized (lockA) {
                    System.out.println("线程2 拿到 lockA");
                }
            }
        }, "Thread-2").start();
    }
}
```

死锁必须同时满足**四个必要条件**：

1. **互斥**：资源（锁）同一时刻只能被一个线程占用。
2. **占有且等待**：线程已占有资源，又去等待别的资源。
3. **不可抢占**：线程已占有的资源不能被强行夺走。
4. **循环等待**：若干线程形成头尾相接的等待环。

**如何破坏死锁**：只要打破上述任一条件即可。常见做法——**统一加锁顺序**（所有线程都按 A→B 顺序拿锁，破坏循环等待）；**加超时**（用 `Lock.tryLock(timeout)`，拿不到就放弃并重试）；**死锁检测**（依赖 JVM 工具）。

用 `jstack` 排查死锁时，日志里会出现醒目的提示：

```text
Found one Java-level deadlock:
=============================
"Thread-2":
  waiting to lock monitor 0x000000000 -> (a java.lang.Object)
  which is held by "Thread-1"
"Thread-1":
  waiting to lock monitor 0x000000001 -> (a java.lang.Object)
  which is held by "Thread-2"
```

看到 `Found one Java-level deadlock` 即可确认死锁，并顺着 `waiting to lock` 与 `held by` 定位到互相僵持的两把锁。

## 本篇小结

- **`synchronized` 锁的是对象（Monitor），而不是代码本身。**
- **`count++` 是读-改-写三步，非原子，必须用同步保护。**
- 三种用法分别锁 **this、Class 对象、显式指定对象**。
- **对象头 Mark Word** 记录锁状态，最后 2 bit 标识锁类型。
- `monitorenter`/`monitorexit` 实现同步块，**两个 monitorexit 保证异常也能释放锁**。
- **锁升级路径**：无锁 → 偏向 → 轻量 → 重量，且 **只能升级不能降级**。
- JVM 通过**锁消除、锁粗化、自适应自旋**优化 `synchronized` 性能。
- **`synchronized` 是可重入锁**，重入靠计数器实现，不会自锁死。
- 锁对象应**私有、final、私有化**，避免字符串常量与可变对象。
- 死锁需满足**互斥、占有等待、不可抢占、循环等待**四条件。
- 破坏死锁最常用手段是**统一加锁顺序**与**加锁超时**。
- `jstack` 中 **`Found one Java-level deadlock`** 直接确认死锁。

## 参考链接

- [Java 语言规范 第 17 章：线程与锁](https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html)
- [Java 并发教程：同步方法](https://docs.oracle.com/javase/tutorial/essential/concurrency/syncmeth.html)
- [Java 并发教程：同步语句](https://docs.oracle.com/javase/tutorial/essential/concurrency/locksync.html)
- [JEP 374：废弃并禁用偏向锁](https://openjdk.org/jeps/374)
- [Object 类 API（wait/notify 与 Monitor）](https://docs.oracle.com/javase/8/docs/api/java/lang/Object.html)
- [《Java 并发编程实战》官方站](https://jcip.net/)

下一篇 → [05 volatile 关键字](/java/thread/volatile)
