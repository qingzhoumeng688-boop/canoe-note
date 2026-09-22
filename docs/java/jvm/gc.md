# 04 垃圾回收 GC

> 本篇导读：GC 要解决的核心问题只有三个——哪些内存算"垃圾"、怎么回收、什么时候回收。本文从可达性分析（GC Roots）讲起，梳理四种引用类型与死亡判定的两次标记，重点拆解三种基础回收算法、分代收集理论、三色标记，并厘清 Minor/Full GC 的触发与空间分配担保机制，最后给出一张"各种 OOM 对照表"。这是后续理解所有垃圾收集器的地基。

## 一、什么是垃圾

判断"对象是否还活着"，历史上有两种思路：

**① 引用计数法（Reference Counting）**：给对象加一个计数器，被引用就加一、引用失效就减一，归零即回收。它实现简单、判定快，但有一个**致命缺陷——无法解决循环引用**：两个对象互相引用，却都没被外部使用，计数器永远不为零，于是双双泄漏。正因如此，主流 JVM **没有**采用引用计数。

**② 可达性分析（Reachability Analysis）**：这是 HotSpot 采用的方式。以一系列 **GC Roots** 为起点，向下搜索引用链；凡是**能被 GC Roots 引用到的对象是存活的，搜不到的（不可达）就是垃圾**。

**GC Roots 都包含哪些？**

- **虚拟机栈（栈帧的局部变量表）中引用的对象**：正在执行的方法里的局部变量指向的对象。
- **方法区中类的静态字段（static）引用的对象**。
- **方法区中常量（static final）引用的对象**。
- **本地方法栈中 JNI（native 方法）引用的对象**。
- **被同步锁（`synchronized`）持有的对象**。
- **JVM 内部引用**：如基本类型对应的 Class 对象、常驻异常对象（`NullPointerException` 等）、系统类加载器、反映 JVM 内部情况的 JMX Bean 等。

```java
package com.canoe.jvm.gc;

import java.util.ArrayList;
import java.util.List;

public class ReferenceCountingLeak {
    public Object ref;

    public static void main(String[] args) {
        ReferenceCountingLeak a = new ReferenceCountingLeak();
        ReferenceCountingLeak b = new ReferenceCountingLeak();
        a.ref = b;   // a 引用 b
        b.ref = a;   // b 引用 a  → 循环引用
        // 即使下面把外部引用置空, 引用计数法也无法回收它们(计数器都为 1)
        a = null;
        b = null;
        // 但可达性分析会把它们判定为不可达 → 可回收
    }
}
```

## 二、引用类型

Java 把"引用"细分为四种强度，给了开发者精细控制对象生命周期的能力：

- **强引用（Strong Reference）**：`Object o = new Object()` 这种普通引用。只要强引用还在，**绝不回收**，是 OOM 的元凶常见来源。
- **软引用（SoftReference）**：内存**不足即将 OOM 之前**才会被回收。非常适合做**内存敏感的缓存**（如图片缓存、查询结果缓存），撑过几次 GC 还能用，内存紧张时自动让位。
- **弱引用（WeakReference）**：**下一次 GC 无论内存是否充足都会被回收**。经典应用是 `WeakHashMap`——当 key 不再被强引用时，entry 会自动被清理，避免 Map 把 key 永远hold住导致泄漏。
- **虚引用（PhantomReference）**：**完全不影响对象生命周期、也拿不到对象实例**（`get()` 永远返回 null）。它的唯一用途是**在对象被回收时收到一个通知**（配合 `ReferenceQueue`），常用于管理堆外内存（如 `DirectByteBuffer` 的回收）。

```java
package com.canoe.jvm.gc;

import java.lang.ref.PhantomReference;
import java.lang.ref.ReferenceQueue;
import java.lang.ref.SoftReference;
import java.lang.ref.WeakReference;

public class ReferenceDemo {
    public static void main(String[] args) {
        // 软引用: 内存不足才回收, 适合缓存
        SoftReference<byte[]> softCache = new SoftReference<>(new byte[1024 * 1024]);

        // 弱引用: 下次 GC 就回收
        WeakReference<Object> weak = new WeakReference<>(new Object());

        // 虚引用: 仅用于回收通知
        ReferenceQueue<Object> queue = new ReferenceQueue<>();
        PhantomReference<Object> phantom = new PhantomReference<>(new Object(), queue);
    }
}
```

## 三、finalize 方法

`finalize()` 是 `Object` 提供的一个"对象被回收前最后的挣扎机会"，但**强烈不推荐在生产中使用**，理由很充分：

- **执行时机完全不确定**：什么时候调用、是否调用，都由 GC 决定，不能指望它做资源释放。
- **只会被执行一次**：自救也只能救一次，第二次 GC 不会再调。
- **有性能与死锁风险**：finalize 由一条低优先级 Finalizer 线程执行，可能拖慢回收、甚至引发死锁。

因此 JDK 9 已把 `finalize()` **标记为废弃（deprecated）**。替代方案是：资源释放交给 **`try-with-resources`**（实现 `AutoCloseable`）或 **`java.lang.ref.Cleaner`**（替代 `finalize` 的轻量清理机制）。

## 四、死亡判定

一个对象真正被宣告"死亡"，要经历**两次标记**：

1. **第一次标记并筛选**：可达性分析后发现不可达，进行第一次标记。同时筛选——该对象是否**有必要执行 `finalize()`**（对象没重写 `finalize`，或 `finalize` 已被调用过，则视为"没必要"）。有必要执行的，会被放进 **F-Queue** 队列。
2. **第二次标记**：稍后由 Finalizer 线程去执行 F-Queue 里对象的 `finalize()`；在 `finalize()` 执行过程中，GC 会进行**第二次小规模标记**——如果对象在 `finalize` 里重新把自己（比如赋给某个静态变量）**连接到引用链上，它就被移出"即将回收"集合，完成一次"自救"**；否则就真的被回收。

下面这段代码演示了"自救"，但**仅用于理解，绝不要在项目里这么写**：

```java
package com.canoe.jvm.gc;

public class FinalizeEscape {
    public static FinalizeEscape SAVE_HOOK;

    @Override
    protected void finalize() throws Throwable {
        super.finalize();
        System.out.println("finalize 被执行");
        SAVE_HOOK = this;   // 在 finalize 里把自己重新挂上引用链, 自救一次
    }

    public static void main(String[] args) throws InterruptedException {
        SAVE_HOOK = new FinalizeEscape();
        SAVE_HOOK = null;          // 断开引用
        System.gc();               // 第一次 GC, finalize 自救成功
        Thread.sleep(500);
        System.out.println(SAVE_HOOK != null ? "我还活着" : "我死了"); // 还活着

        SAVE_HOOK = null;          // 再次断开
        System.gc();               // 第二次 GC, finalize 不会再次执行
        Thread.sleep(500);
        System.out.println(SAVE_HOOK != null ? "我还活着" : "我死了"); // 我死了
    }
}
```

## 五、方法区的回收

方法区（元空间）并非"永久不回收"，只是**回收条件苛刻、收益很低**，所以常给人"不回收"的错觉。它主要回收两部分：

- **废弃的常量**：比如一个字符串 `"abc"` 曾进入常量池，但再没有任何 `String` 对象引用它，也没有其他地方引用该字面量，则可以被清理。
- **无用的类**：必须**同时满足**上一节(类加载篇)提到的三个条件——该类所有实例已回收、加载它的 ClassLoader 已回收、对应的 `Class` 对象无引用。

由于日常 Application ClassLoader 几乎不被回收，类的卸载极少发生，所以方法区回收在普通应用中很难触发，这也是元空间 OOM 往往源于"类越积越多"而非"回收不掉"。

## 六、三种 GC 算法

所有收集器底层都建立在三种基础算法之上，理解它们才能看懂收集器的设计取舍：

**① 标记-清除（Mark-Sweep）**
先标记出所有存活对象，再统一清除未标记的对象。
- 优点：简单。
- 缺点：**产生大量内存碎片**，后续大对象可能找不到连续空间而提前触发 GC。

**② 复制算法（Copying）**
把内存分成两块，只用其中一块；GC 时把存活对象**复制**到另一块，然后整块清空。
- 优点：**没有碎片**，分配效率高（指针碰撞）。
- 缺点：**白白浪费一半空间**。
- 适用：**新生代**（对象朝生夕死，存活极少，浪费可控）。HotSpot 的 Eden + S0/S1 正是复制算法的变种（8:1:1，只浪费 10%）。

**③ 标记-整理（Mark-Compact）**
标记存活对象后，让所有存活对象**向一端移动、紧凑排列**，再清理边界外的空间。
- 优点：**没有碎片，且不浪费空间**。
- 缺点：**要移动对象、更新引用，开销大、需 STW**。
- 适用：**老年代**（对象存活率高，复制算法会浪费且拷贝量大，标记-整理更合适）。

```text
标记-清除:   [存活][ 垃圾 ][存活][ 垃圾 ]  →  [存活][    ][存活][    ]  (有空洞碎片)
复制算法:    A区[存活][垃圾]  B区[    ]     →  B区[存活]  A区整块清空
标记-整理:   [存活][ 垃圾 ][存活]           →  [存活][存活][       ]  (紧凑无碎片)
```

**三色标记法（并发标记的核心）**：现代并发收集器（CMS、G1、ZGC）在做"并发标记"时，不能长时间 STW，于是用**三色抽象**来追踪标记进度：

- **白色**：尚未被标记（本轮 GC 结束时仍是白色 = 垃圾）。
- **灰色**：自身已被标记，但其引用字段还没处理完。
- **黑色**：自身及其所有引用字段都已处理完（确定存活）。

标记从 GC Roots 出发，把 Roots 置黑，逐步把灰色对象的引用"染"成灰、再变黑。并发标记期间用户线程还在跑，于是会出现两个关键问题——**漏标**（黑色对象新指向了一个白色对象，而该白色对象未被灰色对象引用，导致被误回收）和**错标**。解决漏标的方案有两种经典思路：**增量更新（Incremental Update，CMS 用，记录黑色→白色的新增引用，重新扫描）** 和 **原始快照 SATB（Snapshot-At-The-Beginning，G1/ZGC 用，记录灰色→白色被删除的引用，把白色对象当作存活）**。理解三色标记，就看懂了"为什么并发收集器既能不暂停又能保证不漏标"。

## 七、分代收集理论

分代收集不是凭空设计的，而是建立在三条**经验假说**之上：

- **弱分代假说（Weak Generational Hypothesis）**：绝大多数对象都是**朝生夕死**的（据统计新生代对象 98% 熬不过第一次 GC）。
- **强分代假说（Strong Generational Hypothesis）**：**熬过越多次 GC 的对象越难死亡**。
- **跨代引用假说**：跨代引用（老年代对象引用新生代，或反之）相对于同代引用**极少**。

前两条解释了"为什么要分代、为什么新生代用复制、老年代用整理"；第三条引出了**记忆集（Remembered Set）与卡表（Card Table）**：因为 GC 时不能每次都全堆扫描找跨代引用，于是用一个"记忆集"记录"哪一块老年代区域可能引用了新生代"，精度到"卡页（Card）"层面（卡表是一张字节数组，标记某页是否脏了），从而在 Minor GC 时只扫描被标记的卡页，省去全堆扫描。

> 分代是"结果"而非"原因"：因为对象生命周期差异巨大，才选择了不同的回收算法分代存放。

## 八、Minor GC / Major GC / Full GC

这三个名词常被混用，需要厘清：

- **Minor GC（新生代 GC）**：只回收新生代（Eden + Survivor）。**触发条件：Eden 区满了**。因为新生代对象死亡率高，Minor GC 通常非常频繁但速度很快、停顿短。
- **Major GC（老年代 GC）**：只回收老年代。有些资料把"老年代 GC"叫 Major GC，但不同收集器定义不一（CMS 的并发清理、G1 的 Mixed GC 都涉及老年代），口径较模糊。
- **Full GC（整堆 GC）**：回收**整个堆 + 方法区（元空间）**，停顿最久、影响最大。触发条件包括：
  - 老年代空间不足；
  - 元空间（方法区）不足；
  - 显式调用 `System.gc()`（仅建议，不保证立刻执行）；
  - **空间分配担保失败**（见下一节）；
  - CMS 并发模式失败（Concurrent Mode Failure）等。

**目标：尽量减少 Full GC 的频率与时长**，因为它的停顿直接拖垮吞吐和延迟。

## 九、空间分配担保

Minor GC 前，虚拟机要确认"老年代能不能装下可能晋升的对象"，这就是**空间分配担保**机制：

1. Minor GC 前，检查**老年代最大可用连续空间**是否大于**新生代所有对象总大小**（极端情况所有对象都存活并晋升）。若大于，则 Minor GC 安全。
2. 若不大于，则看是否允许担保失败（`-XX:-HandlePromotionFailure`，JDK 6 Update 24 后该参数实际失效、默认视为允许）。
3. 允许失败时，再检查**老年代最大可用连续空间**是否大于**历次晋升到老年代对象的平均大小**；若大于，则冒险尝试一次 Minor GC（大概率够）；若小于，则**先触发一次 Full GC** 腾出空间，再回头做 Minor GC。

核心思想：**用"历史平均晋升量"去赌这次也能装下，赌输了再 Full GC 兜底**，从而在多数情况下避免不必要的 Full GC。

## 十、对象晋升

对象从新生代"长大"进入老年代，有几种路径：

- **年龄计数器**：对象每在 Survivor 熬过一次 Minor GC，年龄加 1。达到阈值 `-XX:MaxTenuringThreshold`（**默认 15**，因为对象头里年龄字段只有 4 位、最大 15）就晋升老年代。
- **动态年龄判定**：并非一定要等到 15 岁。如果 **Survivor 中相同年龄的所有对象大小总和超过 Survivor 空间的一半**，则**年龄大于等于该年龄的对象直接晋升**老年代——这是为了防止 Survivor 被少量高龄对象占满。
- **大对象直接进老年代**：通过 `-XX:PretenureSizeThreshold` 设定阈值，超过该大小的对象**不在 Eden 分配、直接进老年代**，避免在 Eden 和 Survivor 之间反复拷贝（典型如大数组）。

```bash
-XX:MaxTenuringThreshold=15        # 晋升年龄上限
-XX:PretenureSizeThreshold=1m      # 大于 1MB 的对象直接进老年代
```

## 十一、各种 OOM

不同区域溢出会报不同的 `OutOfMemoryError`，排查方向也各不相同：

| 类型 | 报错信息 | 成因 | 排查 / 解决 |
|------|----------|------|-------------|
| 堆溢出 | `Java heap space` | 对象太多、内存泄漏、堆太小 | `jmap -dump` 导出堆，用 MAT 看 Dominator Tree；调大 `-Xmx` |
| 栈溢出 | `StackOverflowError` | 递归过深、单个栈帧过大 | 检查递归退出条件；适当调大 `-Xss` |
| 线程过多 | `unable to create new native thread` | 线程数超过系统/进程限制 | 减小 `-Xss`、改用线程池、检查线程泄漏 |
| 元空间溢出 | `Metaspace` | 动态生成类过多（代理/Groovy/反射） | 限制 `-XX:MaxMetaspaceSize`，排查类加载泄漏 |
| 直接内存溢出 | `Direct buffer memory` | NIO 堆外内存用尽 | 限制 `-XX:MaxDirectMemorySize`，检查 `DirectByteBuffer` 未释放 |
| GC 开销过大 | `GC overhead limit exceeded` | 98% 时间在做 GC 却只回收不到 2% 堆 | 排查内存泄漏、调大堆、或关闭 `-XX:-UseGCOverheadLimit` |
| 数组超限 | `Requested array size exceeds VM limit` | 申请超大数组（超过 `Integer.MAX-2`） | 改数据结构，避免巨型数组 |

## 本篇小结

- **可达性分析是 HotSpot 判定存活的方式**，以 GC Roots 为起点搜索引用链。
- **GC Roots 含栈引用、静态字段、常量、JNI 引用、同步锁持有、JVM 内部引用**。
- **引用计数法因循环引用缺陷被淘汰**，主流 JVM 不用它。
- **四种引用**：强（绝不回收）、软（内存不足才收）、弱（下次 GC 收）、虚（仅通知）。
- **`finalize()` 已废弃**，资源释放用 try-with-resources 或 Cleaner。
- **死亡判定两次标记**，对象可在 finalize 里"自救"一次（别这么写）。
- **三算法**：标记-清除（有碎片）、复制（省空间换一半）、标记-整理（移动无碎片）。
- **三色标记用白/灰/黑追踪并发标记**，靠增量更新或 SATB 防漏标。
- **分代基于弱/强分代假说**，跨代引用靠记忆集+卡表避免全堆扫描。
- **Minor GC 因 Eden 满触发；Full GC 最伤**，诱因含老年代/元空间不足、担保失败。
- **晋升靠年龄(默认15)或动态年龄判定，大对象直接进老年代**。

## 参考链接

- [Oracle - Java SE 17 GC Tuning 指南](https://docs.oracle.com/en/java/javase/17/gctuning/index.html)
- [The Java Virtual Machine Specification - 堆与 GC](https://docs.oracle.com/javase/specs/jvms/se17/html/jvms-3.html)
- [Java 8 官方文档 - 引用类型](https://docs.oracle.com/javase/8/docs/api/java/lang/ref/package-summary.html)
- [Plumbr - 各类 OutOfMemoryError 详解](https://plumbr.io/outofmemoryerror)
- [周志明《深入理解Java虚拟机》](https://book.douban.com/subject/34927789/)

下一篇 → [05 垃圾收集器](/java/jvm/gc-collector)
