# 11 并发安全问题

多线程的世界里，最让人头疼的不是编译报错，而是"偶尔出错、难以复现"的并发 Bug。本篇先把**线程安全的定义、三大特性、happens-before 规则**这些地基打牢，再给出一套**从设计上规避并发问题的方法论**，并附上 jstack 排查流程与 6 个真实事故案例。读完你会明白：并发问题不是靠"加个锁"碰运气解决的，而是要理解它为什么会发生。

## 一、线程安全的定义

一句话定义：**当多个线程同时访问一个对象或方法时，不管运行时调度顺序如何、也不管这些线程如何交替执行，调用方都不需要额外的同步或协调，程序就能得到正确的结果，这样的代码就是线程安全的。**

这个概念里最容易被误解的是"**单个方法线程安全 ≠ 组合调用线程安全**"。比如 `Vector` 的每个方法都加了 `synchronized`，所以单独调用 `add`、`get` 是线程安全的；但如果你写出下面这种"先检查再操作"（check-then-act）的组合，仍然不安全：

```java
package com.canoe.thread.safe;

import java.util.HashMap;
import java.util.Map;

public class CheckThenActDemo {
    private final Map<String, String> cache = new HashMap<String, String>();

    // 两个线程同时进来，都发现 key 不存在，于是都执行 put，结果被覆盖
    public void putIfAbsent(String key, String value) {
        if (!cache.containsKey(key)) {   // 检查
            cache.put(key, value);        // 写入，检查与写入之间存在时间窗口
        }
    }
}
```

`containsKey` 和 `put` 各自原子，但把它们**组合**成一个更大操作时，中间的状态对别的线程是可见的，于是边界被打破。**原子性是有作用域的：方法级原子不代表业务级原子。**

## 二、三大特性

并发安全问题的根源，都可以归结到三个特性的缺失。理解它们，就掌握了所有并发工具的"设计意图"。

**原子性（Atomicity）**：一个或多个操作要么全部执行且不被中断，要么都不执行。就像银行转账，"扣 A 账户"和"加 B 账户"必须是一个整体，不能只完成一半。保证手段：锁（`synchronized` / `Lock`）、CAS（原子类）。

**可见性（Visibility）**：一个线程修改了共享变量，其他线程能**立刻**看到新值。由于 CPU 缓存的存在，线程可能一直读到旧值。保证手段：`volatile`、锁（释放锁前会把修改刷回主内存）、`final`（正确发布后值不可变、天然可见）。

**有序性（Ordering）**：程序执行的顺序不一定等于代码书写的顺序——编译器和 CPU 为了性能会做**指令重排序**。但在单线程下结果不变（as-if-serial），多线程下就可能出问题。保证手段：`volatile`（禁止特定重排）、锁（同一把锁互斥天然有序）、`happens-before` 规则。

一句话记忆：**原子性管"不可分割"，可见性管"看得见"，有序性管"不乱序"。**

## 三、happens-before 规则

`happens-before` 是 JMM（Java 内存模型）用来**判断两个操作之间是否有可见性保证**的规则。注意：它是"可见性顺序"，**不是"时间先后"**——即使 A 在时间上先于 B 发生，只要不满足 happens-before，B 依然可能看不到 A 的修改。

JMM 定义了 8 条规则：

1. **程序次序规则**：单线程内，书写在前面的操作 happens-before 书写在后面的操作。
2. **管程锁定规则**：`unlock` 操作 happens-before 后续对同一锁的 `lock` 操作。
3. **volatile 变量规则**：对 `volatile` 变量的写 happens-before 后续对该变量的读。
4. **线程启动规则**：`Thread.start()` 调用 happens-before 该线程的任何动作。
5. **线程终止规则**：线程中的所有操作 happens-before 其他线程检测到该线程结束（`join()` 返回）。
6. **线程中断规则**：对线程 `interrupt()` 的调用 happens-before 被中断线程检测到中断事件。
7. **对象终结规则**：对象构造器结束 happens-before 它的 `finalize()` 开始。
8. **传递性规则**：若 A happens-before B，且 B happens-before C，则 A happens-before C。

实际开发时，你不需要死记硬背，只要问一句：**"这两个线程的读写之间，是否存在上面某条 happens-before 链条？"** 没有，就可能出 Bug。

## 四、常见线程不安全类

下面这些"老熟人"在多线程下都会翻车，记住它们的正确替代方案：

| 危险用法 | 现象 | 正确替代 |
| --- | --- | --- |
| `StringBuilder` 多线程共用 | 字符错乱、数据丢失 | 单线程用 `StringBuilder`；多线程加锁或用 `StringBuffer` |
| `SimpleDateFormat` 多线程共用 | 解析抛 `NumberFormatException`、日期错乱 | `DateTimeFormatter`（不可变）/ `ThreadLocal<DateFormat>` |
| `ArrayList` / `HashMap` 并发写 | 丢数据、`ConcurrentModificationException`、JDK7 下 `HashMap` 死循环 | 并发容器（`CopyOnWriteArrayList` / `ConcurrentHashMap`） |
| `i++` 自增 | 结果小于预期（非原子） | 原子类 `AtomicInteger` / `LongAdder` |

`SimpleDateFormat` 的事故最经典——它内部有 `Calendar` 状态，多线程并发调用 `parse` 会互相踩踏：

```java
package com.canoe.thread.safe;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SimpleDateFormatUnsafeDemo {
    // 共享一个 SimpleDateFormat，多个线程同时用同一个实例
    private static final SimpleDateFormat SDF = new SimpleDateFormat("yyyy-MM-dd");

    public static void main(String[] args) throws InterruptedException {
        int threadCount = 10;
        CountDownLatch latch = new CountDownLatch(threadCount);
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        for (int i = 0; i < threadCount; i++) {
            pool.execute(() -> {
                try {
                    System.out.println(SDF.parse("2024-01-01")); // 大概率抛异常
                } catch (ParseException e) {
                    System.out.println("解析异常：" + e.getMessage());
                } finally {
                    latch.countDown();
                }
            });
        }
        latch.await();
        pool.shutdown();
    }
}
```

正确做法之一是用 `ThreadLocal` 给每个线程一份独立实例：

```java
package com.canoe.thread.safe;

import java.text.DateFormat;
import java.text.ParseException;
import java.text.SimpleDateFormat;

public class DateFormatHolder {
    // 每个线程各自持有一个 SimpleDateFormat，互不干扰
    private static final ThreadLocal<DateFormat> HOLDER =
            ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));

    public static DateFormat get() {
        return HOLDER.get();
    }

    public static void main(String[] args) throws ParseException {
        System.out.println(get().parse("2024-01-01"));
    }
}
```

`ArrayList` 并发 `add` 会丢数据，下面的代码期望 20000，实际往往少很多：

```java
package com.canoe.thread.safe;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ArrayListUnsafeDemo {
    public static void main(String[] args) throws InterruptedException {
        List<Integer> list = new ArrayList<Integer>();
        int threadCount = 20;
        int perThread = 1000;
        CountDownLatch latch = new CountDownLatch(threadCount);
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        for (int i = 0; i < threadCount; i++) {
            pool.execute(() -> {
                for (int j = 0; j < perThread; j++) {
                    list.add(j); // add 非原子，可能覆盖、丢元素甚至抛异常
                }
                latch.countDown();
            });
        }
        latch.await();
        pool.shutdown();
        System.out.println("期望元素个数：" + (threadCount * perThread));
        System.out.println("实际元素个数：" + list.size());
    }
}
```

`i++` 的坑用原子类解决：

```java
package com.canoe.thread.safe;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class IncrementUnsafeDemo {
    private static int count = 0;
    private static final AtomicInteger atomicCount = new AtomicInteger(0);

    public static void main(String[] args) throws InterruptedException {
        int threadCount = 10;
        int perThread = 1000;
        CountDownLatch latch = new CountDownLatch(threadCount);
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        for (int i = 0; i < threadCount; i++) {
            pool.execute(() -> {
                for (int j = 0; j < perThread; j++) {
                    count++;                       // 非原子：读-改-写三步
                    atomicCount.incrementAndGet(); // 原子操作
                }
                latch.countDown();
            });
        }
        latch.await();
        pool.shutdown();
        System.out.println("普通 count 结果：" + count);
        System.out.println("原子类结果：" + atomicCount.get());
    }
}
```

## 五、安全发布对象

**对象发布（publish）** 指让对象能被当前作用域之外的代码使用；**this 逸出（escape）** 指**对象还没构造完成，引用就被泄露出去了**。这是最隐蔽的线程安全问题之一。

看一个错误示例：构造器里直接把 `this` 注册给外部监听器，外部可能在对象初始化到一半时就回调了它：

```java
package com.canoe.thread.safe;

// 事件监听器接口
interface EventListener {
    void onEvent();
}

// 事件源，可注册监听器
interface EventSource {
    void register(EventListener listener);
}

public class SafePublishDemo {
    private final int value;

    // 错误做法：构造器中把 this 暴露给外部（this 逸出）
    public SafePublishDemo(EventSource source) {
        this.value = 42;
        // 外部可能在对象还没完全构造好时就回调，读到不一致状态
        source.register(new EventListener() {
            public void onEvent() {
                System.out.println("value = " + value);
            }
        });
    }

    // 正确做法：私有构造器 + 静态工厂，先构造完再发布
    private SafePublishDemo() {
        this.value = 42;
    }

    public static SafePublishDemo newInstance(EventSource source) {
        SafePublishDemo instance = new SafePublishDemo(); // 先完整构造
        source.register(new EventListener() {
            public void onEvent() {
                System.out.println("value = " + instance.value);
            }
        });
        return instance; // 再发布
    }

    public static void main(String[] args) {
        EventSource source = new EventSource() {
            public void register(EventListener l) { /* 仅演示 */ }
        };
        // 直接用构造器发布就是 this 逸出；用工厂方法 newInstance 才安全
        SafePublishDemo.newInstance(source);
        System.out.println("安全发布完成");
    }
}
```

**记住：永远不要在构造器中启动线程、注册监听器、或把 `this` 传给别的对象。** 用私有构造器配合静态工厂方法，等对象彻底构造好之后再发布。

## 六、解决线程安全问题的思路

与其出了问题去加锁，不如从设计上让问题"无从发生"。按"安全性由高到低、性能由好到差"的顺序，有一套完整的方法论：

1. **无状态（最安全）**：对象没有成员变量，所有数据都在方法参数和局部变量里。比如大多数 `Servlet`/`Controller` 的无状态写法，天然线程安全。
2. **不可变（Immutable）**：字段用 `final`、不提供 setter，对象一旦创建就不可变，多线程随便读都不会出问题（`String`、`Integer`、`LocalDateTime` 都是典范）。
3. **不共享（ThreadLocal）**：数据就放在线程自己身上，别人拿不到，自然没有竞争。适合"用户上下文""数据库连接"这类线程级状态。
4. **加锁（synchronized / Lock）**：实在要共享可变状态时，用锁把临界区串行化。代价是性能与死锁风险。
5. **无锁（CAS / 原子类）**：用 `AtomicInteger` 等原子类做乐观并发，冲突少时比锁快得多。
6. **并发容器**：直接用 `ConcurrentHashMap`、`CopyOnWriteArrayList` 等"别人造好的轮子"，别自己手写同步。

经验法则：**能无状态就别共享，能不可变就别可变，能 ThreadLocal 就别加锁，能原子类就别用重锁。**

## 七、不可变对象

不可变对象把"线程安全"变成了"物理上不可能出错"。要构造一个真正不可变的对象，需同时满足：

- 类本身用 `final` 修饰（防止被继承后破坏不可变性）；
- 所有字段用 `private final` 修饰；
- 不提供任何 setter；
- 构造器里对**可变参数做深拷贝**，防止外部拿着引用偷偷改；
- 返回可变字段时返回副本，而不是原引用。

```java
package com.canoe.thread.safe;

import java.util.Date;

public final class ImmutableRange {
    private final int lower;
    private final int upper;
    private final Date createTime; // Date 是可变对象，需要小心处理

    public ImmutableRange(int lower, int upper, Date createTime) {
        this.lower = lower;
        this.upper = upper;
        // 深拷贝可变参数：外部之后修改传进来的 Date，不影响内部
        this.createTime = new Date(createTime.getTime());
    }

    public int getLower() {
        return lower;
    }

    public int getUpper() {
        return upper;
    }

    // 返回副本，避免调用方拿到内部可变引用后篡改
    public Date getCreateTime() {
        return new Date(createTime.getTime());
    }
}
```

## 八、并发问题排查

并发 Bug 最大的痛点是"本地复现不了，线上偶发"。一套可落地的排查流程：

1. **复现**：先在测试环境用压测、多线程脚本尽量复现，加日志打印关键共享变量。
2. **看监控**：CPU、内存、线程数、接口耗时曲线，先判断是"卡住"还是"算错"。
3. **抓线程栈**：用 `jstack <pid> > thread.txt` 导出线程栈，或在 Java 程序里用 `jstack -l <pid>` 看锁信息。
4. **找共享变量**：在代码里定位所有被多线程读写的共享字段。
5. **定位病灶**：判断是哪段代码不满足原子性 / 可见性 / 有序性。

`jstack` 输出里几个关键字段要会读：

- `"locked <0x...>"`：当前线程**已经持有**某个对象的锁（Monitor）。
- `"waiting to lock <0x...>"`：线程想拿某把锁，但**正在等别人释放**——这是竞争或死锁的信号。
- `"parking to wait for <0x...>"`：线程被 `LockSupport.park()` 挂起，常见于 AQS 队列、线程池空闲线程。

```text
"Thread-1" #12 prio=5 os_prio=0
   java.lang.Thread.State: BLOCKED (on object monitor)
        at com.canoe.DeadlockDemo.lambda$main$1(DeadlockDemo.java:30)
        - waiting to lock <0x000000076b8c3a20> (a java.lang.Object)  // 在等这把锁
        - locked <0x000000076b8c3a50> (a java.lang.Object)           // 但自己已拿着另一把
```

## 九、常见并发事故案例

把前面讲的点串成 6 个真实踩坑场景，建议逐条对照自己的代码：

**1. SimpleDateFormat 共享**：多个线程共用同一个 `SimpleDateFormat` 实例，并发 `parse` 抛出 `NumberFormatException`。解法见第四节 `ThreadLocal` 方案。

**2. ArrayList 并发 add 丢数据**：如第四节示例，多线程 `add` 导致元素丢失甚至抛 `ConcurrentModificationException`。解法：用 `CopyOnWriteArrayList` 或加锁。

**3. HashMap 死循环（JDK 7 及以前）**：JDK 7 的 `HashMap` 在扩容 `transfer` 时采用**头插法**，多线程并发扩容会把链表反转，形成环形链表，后续 `get` 时陷入死循环、CPU 100%。JDK 8 改成尾插法修复了该问题，但 `HashMap` 本身仍然非线程安全，正确做法是用 `ConcurrentHashMap`。

**4. ThreadLocal 不 remove**：线程池里的线程会被复用，如果 `ThreadLocal` 用完不 `remove()`，下一个任务可能读到上一个任务的脏数据，造成"数据串号"。务必在 `finally` 中 `remove()`（详见 ThreadLocal 篇）。

**5. 双重检查锁定（DCL）不加 volatile**：单例模式用双重检查，但 `instance` 没加 `volatile`，指令重排可能让其他线程拿到**半初始化的对象**。正确写法：

```java
// 危险：缺少 volatile，可能返回未构造完成的对象
private static Singleton instance;
public static Singleton getInstance() {
    if (instance == null) {
        synchronized (Singleton.class) {
            if (instance == null) {
                instance = new Singleton(); // new 拆成：分配内存→初始化→赋值引用
            }                                   // 重排后可能"先赋值后初始化"
        }
    }
    return instance;
}
```
给 `instance` 加上 `volatile` 即可禁止这种重排（详见 volatile 篇）。

**6. 线程池无界队列 OOM**：`Executors.newFixedThreadPool`、`newCachedThreadPool` 内部用的是无界 `LinkedBlockingQueue`，任务激增时队列无限堆积，最终撑爆内存。应手动创建有界队列：

```java
package com.canoe.thread.safe;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public class UnboundedQueueRisk {
    public static void main(String[] args) {
        int core = 2;
        int max = 4;
        // 有界队列（容量 100），超出时触发拒绝策略，避免无限堆积导致 OOM
        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                core, max, 0L, TimeUnit.MILLISECONDS,
                new LinkedBlockingQueue<Runnable>(100));
        System.out.println("有界队列剩余容量：" + pool.getQueue().remainingCapacity());
        pool.shutdown();
    }
}
```

## 本篇小结

- **线程安全**指多线程下无论调度顺序如何，结果都符合预期。
- **原子性**保证一组操作不可分割，由锁或 CAS 保证。
- **可见性**保证一个线程的修改对其他线程立即可见，由 volatile、锁、final 保证。
- **有序性**保证执行顺序不被重排破坏，由 volatile 与锁约束。
- **happens-before** 是判断可见性的规则，与时间先后无关。
- **StringBuilder、`SimpleDateFormat`、`ArrayList`、`HashMap`、`i++`** 是典型的线程不安全对象。
- **this 逸出**指对象构造未完成前就暴露引用，会导致状态不一致。
- **不可变对象**通过 final 字段与深拷贝彻底杜绝被意外修改。
- **ThreadLocal** 通过线程隔离实现不共享，但必须 `remove()` 防止内存泄漏。
- **并发问题排查**优先用 `jstack` 看 `locked` / `waiting to lock` / `parking to wait for`。
- **JDK 7 的 `HashMap` 扩容**在多线程下可能形成环形链表导致死循环。
- **线程池应使用有界队列**，避免无界队列堆积引发 OOM。

## 参考链接

- [Java 语言规范 第 17 章：线程与锁](https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html)
- [Java 并发包 API 文档](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/package-summary.html)
- [ThreadLocal API 文档](https://docs.oracle.com/javase/8/docs/api/java/lang/ThreadLocal.html)
- [原子类 API 文档](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/atomic/package-summary.html)
- [SimpleDateFormat API 文档](https://docs.oracle.com/javase/8/docs/api/java/text/SimpleDateFormat.html)
- [《Java 并发编程实战》官方站](https://jcip.net/)

下一篇 → [返回专栏首页](/java/thread/base)
