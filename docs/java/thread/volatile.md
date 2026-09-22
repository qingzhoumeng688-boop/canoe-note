# 05 volatile 关键字

`volatile` 是 Java 里最轻量级的同步机制，但它的"能"和"不能"经常被混淆。本篇先用"主线程改了标志位、子线程却死循环不退出"的复现代码讲清**可见性问题**，再拆解 `volatile` 的**可见性、禁止指令重排序**两大作用，重点戳破"它保证原子性"的最大误区，并用**双重检查锁定（DCL）单例**这个经典场景说明它在实战中不可替代的位置。

## 一、volatile 的两个作用

`volatile` 只有两个作用，务必记牢：

1. **保证可见性（Visibility）**：一个线程对 `volatile` 变量的修改，会立刻刷回主内存，并使其他 CPU 缓存中该变量的副本失效，从而保证其他线程读到最新值。
2. **禁止指令重排序（Ordering）**：编译器和 CPU 不能把 `volatile` 变量的读写与它前后的普通读写随意重排。

**最大的误区：volatile 不保证原子性。** 它管不了"读-改-写"这种多步操作的整体性，所以 `i++` 即使用了 `volatile` 依然不安全。后面第六节专门验证。

## 二、可见性问题的产生

要理解可见性，得先理解 **JMM（Java 内存模型）**：每个线程有自己的**工作内存（等价于 CPU 缓存）**，变量真正的值存在**主内存**里。线程改值时，先改工作内存的副本，再（不一定立即）同步回主内存。这就埋下了"一个线程改了，另一个线程看不见"的雷。

下面代码里，主线程把 `running` 改成 `false`，但子线程可能一直读自己工作内存里的 `true`，陷入死循环：

```java
package com.canoe.thread.vol;

public class VisibilityDemo {
    // 没加 volatile：主线程修改 running，子线程可能永远看不到
    private static boolean running = true;
    // private static volatile boolean running = true; // 加上这行，子线程能正常退出

    public static void main(String[] args) throws InterruptedException {
        Thread worker = new Thread(() -> {
            System.out.println("子线程启动，开始工作...");
            while (running) {
                // 空循环，完全依赖 running 的可见性
            }
            System.out.println("子线程感知到 running=false，退出");
        });
        worker.start();
        Thread.sleep(1000);
        running = false;
        System.out.println("主线程将 running 设为 false");
    }
}
```

把 `volatile` 加上后，主线程的修改会立刻对子线程可见，循环随即结束。这就是可见性的直观体现。

## 三、volatile 怎么保证可见性

`volatile` 的可见性不是 JVM 凭空变出来的，它的底层依赖三样东西：

1. **`lock` 前缀指令**：对 `volatile` 变量写操作后，JIT 会插入一个带 `lock` 前缀的指令（在 x86 上通常是 `lock addl $0x0, (%rsp)` 这种空操作），它相当于一个**内存屏障**。
2. **缓存一致性协议（MESI）**：`lock` 指令会触发 CPU 的缓存一致性协议，强制把当前处理器缓存行的数据**写回主内存**。
3. **其他 CPU 缓存行失效**：其他 CPU 发现自己缓存里的该变量副本失效，下次读取必须去主内存拿最新值。

所以 `volatile` 的"可见"本质是：**写操作立即刷主内存 + 读操作每次都从主内存取**，而不是简单地"线程之间共享变量"。

## 四、指令重排序

编译器和 CPU 为了性能，会在**不改变单线程语义**的前提下重排指令。但多线程下，这种重排会酿成 Bug，而 `volatile` 正是它的克星。

最经典的案例是**双重检查锁定（DCL）单例**。对象的创建看似一行 `instance = new Singleton();`，在字节码层面实际是三步：

1. 分配内存空间；
2. 初始化对象（调用构造器）；
3. 把 `instance` 引用指向这块内存。

如果不加 `volatile`，编译器和 CPU 可能把第 2、3 步重排成"先赋值引用、再初始化"。此时另一个线程进入 `getInstance()`，看到 `instance != null` 就直接返回，拿到的是一个**半初始化（字段还是默认值）的对象**——这就是致命 Bug：

```java
package com.canoe.thread.vol;

public class Singleton {
    // 必须 volatile：禁止"赋值引用"与"初始化"重排序，防止拿到半初始化对象
    private static volatile Singleton instance;

    private Singleton() {}

    public static Singleton getInstance() {
        if (instance == null) {                  // 第一次检查：无锁，提升性能
            synchronized (Singleton.class) {
                if (instance == null) {          // 第二次检查：加锁，保证唯一
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

`volatile` 在这里不是保证"只创建一次"（那由 `synchronized` 负责），而是保证**对象构造完成之前，引用不会被其他线程看到**。

## 五、内存屏障

`volatile` 禁止重排，底层靠的是**内存屏障（Memory Barrier）**。JMM 抽象出四种屏障：

| 屏障类型 | 含义 | 防止的重排 |
| --- | --- | --- |
| LoadLoad | `Load1; LoadLoad; Load2` | Load1 先于 Load2 及其后续读 |
| StoreStore | `Store1; StoreStore; Store2` | Store1 先于 Store2 及其后续写 |
| LoadStore | `Load1; LoadStore; Store2` | Load1 先于 Store2 及其后续写 |
| StoreLoad | `Store1; StoreLoad; Load2` | Store1 先于 Load2 及其后续读（开销最大） |

对 `volatile` 变量的具体插入规则（JDK 实现，如 X86）：

- **写操作前**插入 `StoreStore` 屏障，**写操作后**插入 `StoreLoad` 屏障；
- **读操作后**插入 `LoadLoad` 与 `LoadStore` 屏障。

这些屏障共同保证了：**volatile 写 happens-before 后续 volatile 读**，从而在 happens-before 规则层面确立了可见性与有序性。

## 六、volatile 不保证原子性

这是被问得最多、也最容易踩坑的点。看代码：即便 `count` 是 `volatile`，多线程 `count++` 结果依然不对——因为 `++` 是"读-改-写"三步，`volatile` 保证每一步的可见性，却保证不了这三步**不被别的线程插空**。

```java
package com.canoe.thread.vol;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class VolatileNotAtomicDemo {
    private static volatile int count = 0;
    private static final AtomicInteger atomic = new AtomicInteger(0);

    public static void main(String[] args) throws InterruptedException {
        int threadCount = 10;
        int perThread = 1000;
        CountDownLatch latch = new CountDownLatch(threadCount);
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        for (int i = 0; i < threadCount; i++) {
            pool.execute(() -> {
                for (int j = 0; j < perThread; j++) {
                    count++;                       // volatile 不保证原子性，结果偏小
                    atomic.incrementAndGet();      // 原子类才是正确解法
                }
                latch.countDown();
            });
        }
        latch.await();
        pool.shutdown();
        System.out.println("volatile count：" + count);
        System.out.println("atomic count：" + atomic.get());
    }
}
```

**解决方案**：需要原子自增时，用 `synchronized`、`AtomicInteger` 或 `LongAdder`，而不是 `volatile`。

## 七、适用场景

`volatile` 不是万能钥匙，它只适合**状态被一个线程写、多个线程读（一写多读 / 单写）** 的场合。典型可用清单：

1. **状态标志位**：如 `volatile boolean running`，用于优雅停止线程（见第二节）。
2. **一次性安全发布**：对象引用 `volatile`，保证构造完成后再被其他线程看到（避免 DCL 那种半初始化问题）。
3. **独立观察（定期发布的值）**：如定期把传感器读数写入 `volatile` 字段供其他线程读取。
4. **双重检查锁定（DCL）单例**：`volatile` 保证可见性 + 禁止重排（见第四节）。

**明确不适用**：多个线程都写同一个变量（如计数器 `i++`）、或一组操作需要整体原子性的场景——这些 `volatile` 无能为力，必须靠锁或原子类。

## 八、volatile vs synchronized

| 对比维度 | volatile | synchronized |
| --- | --- | --- |
| 原子性 | **不保证** | 保证（串行化临界区） |
| 可见性 | 保证 | 保证（解锁前刷主内存） |
| 有序性 | 保证（禁止特定重排） | 保证（同一锁互斥天然有序） |
| 是否阻塞 | **不阻塞**，轻量 | 可能阻塞（重量级锁挂起线程） |
| 适用场景 | 一写多读的状态标记 | 需要原子性的临界区 |
| 性能开销 | 极小 | 较大（尤其重量级锁） |

口诀：**`volatile` 管"看得见、不乱排"但管不了"合在一起"；`synchronized` 管"合在一起"但代价更高。** 两者常常配合使用，比如 DCL 单例里用 `synchronized` 保证只创建一次、用 `volatile` 保证发布安全。

## 本篇小结

- **`volatile` 两大作用**：保证可见性、禁止指令重排序。
- **`volatile` 不保证原子性**，这是它最大的使用误区。
- **可见性根源**是 JMM 的工作内存/主内存模型与 CPU 缓存不一致。
- 底层靠 **`lock` 前缀指令 + MESI 协议** 强制刷主内存并使其他缓存失效。
- **指令重排**由编译器和 CPU 完成，单线程语义不变但多线程会出错。
- **DCL 单例必须加 `volatile`**，否则可能拿到半初始化对象。
- 内存屏障有 **LoadLoad / StoreStore / LoadStore / StoreLoad** 四种。
- `volatile` 写前后会插入 `StoreStore` 与 `StoreLoad` 屏障。
- 适合**一写多读**状态标志、一次性发布、独立观察等场景。
- **多写场景 `volatile` 无效**，须用 `synchronized` 或原子类。
- 与 `synchronized` 相比，`volatile` **不阻塞、开销小但能力弱**。

## 参考链接

- [Java 语言规范 第 17 章：内存模型](https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html)
- [Java 并发教程：原子性](https://docs.oracle.com/javase/tutorial/essential/concurrency/atomic.html)
- [Java Memory Model 概览（Jeremy Manson）](https://www.cs.umd.edu/~pugh/java/memoryModel/)
- [Java 并发教程：同步方法](https://docs.oracle.com/javase/tutorial/essential/concurrency/syncmeth.html)
- [Double-Checked Locking 问题与正确写法（Wikipedia）](https://en.wikipedia.org/wiki/Double-checked_locking)
- [《Java 并发编程实战》官方站](https://jcip.net/)

下一篇 → [06 Lock 锁](/java/thread/lock)
