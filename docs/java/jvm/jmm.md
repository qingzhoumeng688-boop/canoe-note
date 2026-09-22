# 06 内存模型 JMM

> 本篇导读：为什么在单线程里跑得好好的代码，放到多线程就出幺蛾子？根因是"可见性、原子性、有序性"三座大山。JMM（Java Memory Model）就是为了在五花八门的硬件之上，给 Java 程序员一套统一、可依赖的内存可见性约定。本文从硬件问题讲起，拆解主内存/工作内存、happens-before 八规则、volatile/锁/final 的语义、内存屏障，最后用双重检查锁定（DCL）把所有这些串成一次实战。

## 一、为什么要有内存模型

要理解 JMM，先得看硬件层面我们到底在对抗什么：

- **可见性问题（Visibility）**：现代 CPU 有多级缓存，线程 A 改了变量先写进自己的缓存，没刷回主存，线程 B 读到的还是旧值——两个线程"看不见"彼此的修改。
- **有序性问题（Ordering）**：编译器和处理器为了性能，会对**没有数据依赖**的指令做**重排序**（指令重排）。单线程看结果正确，但多线程下重排可能让"初始化"跑到"使用"之后，暴露出诡异 bug。
- **原子性问题（Atomicity）**：一条 `i++` 在 CPU 层面其实是"读-改-写"三步，多线程并发时可能被交错，导致计数不准。

不同 CPU 架构（x86 的强内存模型 vs ARM 的弱内存模型）行为还不一样。如果让程序员去手动适配每种硬件，几乎不可能。于是 JVM 抽象出 **JMM**，用一套统一的规则（happens-before、volatile、锁）屏蔽底层差异，保证"只要按规则写，跨平台可见性一致"。

## 二、主内存与工作内存

JMM 把内存抽象成两层：

- **主内存（Main Memory）**：所有**变量（实例字段、静态字段、数组元素）都存储在这里**，是线程共享的。
- **工作内存（Working Memory）**：**每个线程私有**，保存了该线程用到的变量的**副本拷贝**。线程读写变量，实际上是先在自己的工作内存里操作，再同步回主内存。

```text
        主内存 (所有变量, 线程共享)
   ┌─────────────────────────────────┐
   │   x = 0    y = 0    flag = false │
   └──────┬──────────────┬───────────┘
          │ 拷贝          │ 拷贝
          ▼              ▼
   ┌────────────┐  ┌────────────┐
   │ 线程 A 工作 │  │ 线程 B 工作 │   ← 各线程私有, 互不可见
   │ 内存 x 副本 │  │ 内存 x 副本 │
   └────────────┘  └────────────┘
```

> 强调：**主内存/工作内存是 JMM 的逻辑概念**，并不等于物理上的 RAM 或 CPU 缓存——JMM 只是用这套抽象来定义"变量如何在线程间传递"，具体落到哪级缓存由 JVM 和硬件决定。

JMM 定义了 8 种**内存交互操作**来完成"主存 ↔ 工作内存"的同步，并施加规则：

- `lock`（锁定）/ `unlock`（解锁）：作用于主内存变量，锁定后独占。
- `read`（读取）/ `load`（载入）：把主存变量读入工作内存。
- `use`（使用）：把工作内存变量交给执行引擎。
- `assign`（赋值）：把执行引擎结果赋给工作内存变量。
- `store`（存储）/ `write`（写入）：把工作内存变量写回主内存。

规则如：read 和 load 必须成对、assign 后必须 store/write 回主存、`lock` 的变量会清空工作内存中对应副本等，确保不会出现"改了不回写""读了不同步"的混乱。

## 三、happens-before

**happens-before 是 JMM 的核心**：如果操作 A happens-before 操作 B，那么 **A 的结果对 B 可见，且 A 的执行顺序排在 B 之前**（对 B 而言，A 的修改都已被看到）。它是 JMM 向程序员承诺的"可见性契约"，比死记底层屏障友好得多。

JMM 规定了以下 **8 条 happens-before 规则**（满足任一条即成立）：

1. **程序次序规则**：同一线程内，按照控制流顺序，前面的操作 happens-before 后面的操作。
2. **管程锁定规则**：一个 `unlock` 操作 happens-before **后续**对**同一个锁**的 `lock` 操作。
3. **volatile 变量规则**：对一个 `volatile` 字段的**写** happens-before **后续**对该字段的**读**。
4. **线程启动规则**：`Thread.start()` 调用 happens-before 该线程中的任何动作。
5. **线程终止规则**：线程中的所有动作 happens-before 其他线程成功检测到该线程已终止（如 `Thread.join()` 返回、`isAlive()` 为 false）。
6. **中断规则**：对线程 `interrupt()` 的调用 happens-before 被中断线程检测到中断事件（`InterruptedException` 抛出或 `isInterrupted()` 返回 true）。
7. **对象终结规则**：对象构造器执行结束 happens-before 它的 `finalize()` 方法开始。
8. **传递性**：若 A happens-before B，且 B happens-before C，则 A happens-before C。

**重点：happens-before 不等于时间上的先后！** 它是"可见性+顺序"的保证，不是时钟意义上的"先发生"。例如规则 1 说的"前面 happens-before 后面"是指单线程内可见性，而两个不同线程之间若无上述任一规则连接，它们的操作就没有 happens-before 关系，JIT/CPU 完全可能重排，彼此不可见。

```java
package com.canoe.jvm.jmm;

// 规则3示例: volatile 写对后续读可见
public class VolatileRule {
    private volatile boolean ready = false;
    private int value = 0;

    public void writer() {
        value = 42;        // 普通写
        ready = true;      // volatile 写 → 对后续 ready 的读可见, 且 value=42 也被一起刷出
    }

    public void reader() {
        if (ready) {       // volatile 读
            System.out.println(value);  // 一定能看到 42
        }
    }
}
```

## 四、volatile 的内存语义

`volatile` 是 JVM 提供的**最轻量的同步手段**，它保证两件事：

- **可见性**：对一个 `volatile` 变量的**写**，会立刻把新值刷新到主内存；对其**读**，会从主内存重新加载最新值。一个线程的修改对其他线程立即可见。
- **有序性（禁止特定重排）**：`volatile` 写之前的操作不会被重排到写之后；`volatile` 读之后的操作不会被重排到读之前。

用 happens-before 的 **volatile 规则**（写 hb 读）来解释：既然写 happens-before 读，那么写之前的所有普通变量修改，都会随 volatile 写一起"携带"可见性，被读线程看到。这正是上一节 `VolatileRule` 能稳定打印 42 的原因。

注意 `volatile` **不保证复合操作的原子性**：`volatile int count` 的 `count++` 仍是三步（读-改-写），多线程仍会丢更新，必须用 `synchronized` 或 `AtomicInteger`。

## 五、锁的内存语义

`synchronized`（以及 `ReentrantLock`）的加锁/解锁，等价于一对 volatile 的读写：

- **解锁（unlock）happens-before 于随后对同一锁的加锁（lock）**。
- 因此，线程 A 在 **持有锁期间** 修改的所有变量，在 **线程 B 拿到同一把锁** 后全部可见。

这其实就是 happens-before 规则 2（管程锁定规则）的直接表述。锁比 volatile 更强：它既保证可见性，又保证**临界区内操作的原子性（互斥执行）**。所以"用 synchronized 保护共享变量"能同时解决可见性与原子性。

```java
package com.canoe.jvm.jmm;

public class LockSemantics {
    private int count = 0;

    public synchronized void increment() {
        count++;   // 持有锁期间修改, 解锁后对下一个加锁线程可见且互斥
    }
}
```

## 六、final 的内存语义

`final` 字段有特殊的"安全发布"语义：**只要对象被正确构造（构造器里没有 `this` 逸出），`final` 字段在构造器初始化完成后，对其他线程一定可见，且不会被重排到构造器之外**。

问题在于"构造器内 `this` 逸出"会破坏这个保证。下面这个反例演示了危险：

```java
package com.canoe.jvm.jmm;

public class FinalEscape {
    // 构造器里 this 逸出, 导致 final 字段可能被其他线程读到默认值 0
    public final int value;
    public static FinalEscape instance;

    public FinalEscape() {
        this.value = 1;                       // final 字段初始化为 1
        instance = this;                       // 危险! 把未构造完的 this 暴露出去
    }

    public static void main(String[] args) {
        new Thread(() -> {
            while (instance == null) { /* 等待发布 */ }
            // 由于 this 提前逸出, 这里可能读到 value 的默认值 0, 而非 1
            System.out.println(instance.value);
        }).start();
        new FinalEscape();
    }
}
```

教训：**不要在构造器里把 `this` 赋值给静态字段、或启动线程并传入 `this`**，否则 final 的安全发布保证失效。这就是"安全发布（safe publication）"的由来。

## 七、as-if-serial 与 happens-before

这两条规则分别守护"单线程"和"多线程"的可预期性：

- **as-if-serial**：在**单线程**内，编译器和 CPU 可以做任意重排序，但必须保证**重排后的执行结果与"顺序执行"一致**。程序员因此能安心地按代码顺序推理单线程逻辑，不用操心底层重排。
- **happens-before**：在**多线程**间，JMM 用 happens-before 规则界定"哪些操作的可见性被保证"。只要你的代码建立了 happens-before 关系，就能跨线程得到预期可见性；否则不保证。

二者是互补的两层保证：**as-if-serial 给单线程正确性，happens-before 给多线程可见性**。重排序本身没有被禁止，只是被约束在"不破坏这两条规则"的范围内。

## 八、内存屏障

happens-before 和 volatile/锁的语义，最终落到硬件上就是**内存屏障（Memory Barrier）**——一类强制 CPU 不做某些重排、强制刷新缓存的指令。JMM 抽象出四种屏障：

| 屏障 | 含义 | 作用 |
|------|------|------|
| LoadLoad | `Load1; LoadLoad; Load2` | Load1 先于 Load2 及后续装载完成 |
| StoreStore | `Store1; StoreStore; Store2` | Store1 对其他处理器可见先于 Store2 |
| LoadStore | `Load1; LoadStore; Store2` | Load1 先于 Store2 及后续存储 |
| StoreLoad | `Store1; StoreLoad; Load2` | Store1 可见先于 Load2 装载（最重） |

它们如何被插入：

- **volatile 写**：在写后插入 **StoreStore**（保证前面的写先刷出）+ **StoreLoad**（保证本写对所有处理器可见，且不被后续读重排）。
- **volatile 读**：在读后插入 **LoadLoad** + **LoadStore**（保证后续读/写不重排到 volatile 读之前）。
- **synchronized 解锁**：相当于在解锁前插入 StoreStore，并把写刷出；加锁相当于在加锁后插入 LoadLoad/LoadStore，使后续读看到最新值。

> 程序员一般不直接写屏障，但理解它有助于明白：为什么 `volatile` 比普通变量"慢一点"——因为它多了这些强制同步的指令；也明白 JMM 只是"规则"，真正干活的是这些底层屏障。

## 九、双重检查锁定与 JMM

**双重检查锁定（DCL, Double-Checked Locking）** 是单例模式的经典写法，也是综合运用 JMM 的最佳案例。先看**错误**版本：

```java
package com.canoe.jvm.jmm;

public class BadSingleton {
    // 没有 volatile!
    private static BadSingleton instance;

    public static BadSingleton getInstance() {
        if (instance == null) {                 // 第一次检查 (避免每次都加锁)
            synchronized (BadSingleton.class) {
                if (instance == null) {         // 第二次检查
                    instance = new BadSingleton(); // 危险! 这里可能暴露"半初始化对象"
                }
            }
        }
        return instance;
    }
}
```

问题出在 `instance = new BadSingleton()` 这行，它实际分三步：① 分配内存；② 调用构造器初始化对象；③ 把 `instance` 指向这块内存。**由于缺少 happens-before 约束，JIT 可能把 ② 和 ③ 重排**（先赋值引用、再初始化）。另一个线程在第一次检查时可能看到 `instance != null`，于是拿到一个**构造还没完成的"半初始化"对象**，使用时崩溃。

**修复只需给 `instance` 加 `volatile`**（JDK 5 之后 volatile 增强了语义，禁止了 ② ③ 的重排）：

```java
package com.canoe.jvm.jmm;

public class GoodSingleton {
    // 关键: volatile 禁止"初始化"与"引用赋值"的重排序
    private static volatile GoodSingleton instance;

    public static GoodSingleton getInstance() {
        if (instance == null) {
            synchronized (GoodSingleton.class) {
                if (instance == null) {
                    instance = new GoodSingleton();
                }
            }
        }
        return instance;
    }
}
```

可见：DCL 的正确性完全建立在 **volatile 的 happens-before（写 hb 读）+ 禁止重排** 之上。这也是为什么"单例用 DCL 必须加 volatile"——它是 JMM 规则的一次完整实战。

## 本篇小结

- **JMM 屏蔽硬件差异**，统一解决可见性、原子性、有序性三大问题。
- **主内存/工作内存是逻辑概念**，线程通过 8 种交互操作同步变量。
- **happens-before 是可见性契约**：A hb B 则 A 的结果对 B 可见且排在前面。
- **happens-before 不等于时间先后**，而是 JMM 承诺的跨线程可见性关系。
- **八条规则**含程序次序、锁、volatile、线程启动/终止、中断、终结、传递性。
- **volatile 保证可见性+禁止特定重排**，但不保证复合操作的原子性。
- **锁的语义 = volatile 读写**：unlock hb 后续同一锁的 lock。
- **final 字段安全发布**：构造完即对他人可见，但构造器内 `this` 逸出会破坏。
- **四种内存屏障**（LoadLoad/StoreStore/LoadStore/StoreLoad）是语义的硬件落地。
- **DCL 单例必须加 volatile**，否则可能拿到半初始化的对象。

## 参考链接

- [JSR-133: Java Memory Model and Thread Specification](https://jcp.org/en/jsr/detail?id=133)
- [Oracle - Java Language Spec 17 (Threads and Locks)](https://docs.oracle.com/javase/specs/jls/se17/html/jls-17.html)
- [The Java Memory Model (序章与论文, Goetz)](https://www.cs.umd.edu/~pugh/java/memoryModel/)
- [volatile 与内存屏障详解 - OpenJDK wiki](https://wiki.openjdk.org/display/HotSpot/Volatile)
- [Double-Checked Locking 问题 (Wikipedia)](https://en.wikipedia.org/wiki/Double-checked_locking)
- [周志明《深入理解Java虚拟机》](https://book.douban.com/subject/34927789/)

下一篇 → [07 JVM 调优](/java/jvm/tune)
