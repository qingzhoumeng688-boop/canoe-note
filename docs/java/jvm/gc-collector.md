# 05 垃圾收集器

> 本篇导读：上一节讲了 GC 的算法地基，这一节看"谁在干活"——各种垃圾收集器。它们本质上是不同算法（复制、标记-清除、标记-整理）与并发程度（STW 时长）的组合。本文先给出收集器搭配矩阵，再逐一拆解 Serial、Parallel、CMS、G1、ZGC、Shenandoah、Epsilon 的取舍，重点讲清 G1 的 Region 化整为零思路与 ZGC 的极低延迟，最后给出选型决策表与 GC 日志解读方法。

## 一、收集器总览

收集器按"负责的内存分代"可分为新生代收集器、老年代收集器和整堆收集器。下面是经典搭配关系（注意 JDK 版本变迁）：

```text
              新生代收集器              老年代收集器          整堆收集器
              ───────────              ───────────          ───────────
  早期:        Serial    ──配合──►      Serial Old           (无)
               ParNew    ──配合──►      CMS                 (无)
               Parallel Scavenge ──►   Parallel Old         (无)

  JDK 9+:      (-)                      (-)                  G1 (默认, 整堆)
  JDK 11+:     (-)                      (-)                  ZGC (低延迟)
  JDK 12+:     (-)                      (-)                  Shenandoah
  特殊:        (-)                      (-)                  Epsilon (不回收)

  说明:
   • CMS 在 JDK 9 被标记为废弃(Deprecate), JDK 14 被正式移除(Remove)
   • G1 从 JDK 9 起成为服务端默认收集器
   • ParNew 唯一能与 CMS 配合, CMS 移除后 ParNew 仅作为 G1/ ZGC 之前的过渡存在
```

关键结论：**单线程场景用 Serial；吞吐优先用 Parallel；追求低延迟且 JDK 9+ 用 G1；超大堆极致低延迟用 ZGC**。CMS 已经是历史。

## 二、Serial / Serial Old

**Serial** 是最古老、最简单的收集器：**单线程**工作，GC 时必须 **Stop The World（STW，暂停所有用户线程）**。

- 优点：没有线程交互开销，**简单、高效（单线程下反而快）**，内存占用极小。
- 缺点：STW 期间所有工作都停，堆稍大就卡得明显。
- 适用：客户端应用、单核/嵌入式、或作为其他收集器的 fallback。
- **Serial Old** 是它的老年代版本（标记-整理），除了单独用，还作为 CMS 失败后的"担保"收集器。

```bash
-XX:+UseSerialGC      # 显式开启 Serial + Serial Old
```

## 三、ParNew

**ParNew** 就是 **Serial 的多线程并行版**： Minor GC 时用多条 GC 线程同时回收，其余行为几乎与 Serial 一致，同样会 STW。

它最大的历史意义在于：**它是唯一能与 CMS 配合工作的新生代收集器**（因为 CMS 设计上只和 ParNew 对接）。随着 CMS 在 JDK 14 被移除，ParNew 也基本退出了历史舞台——今天的新生代并行回收任务已由 G1 统一接管。

```bash
-XX:+UseParNewGC      # 开启 ParNew (如今多配合 CMS, 已不推荐单独使用)
```

## 四、Parallel Scavenge / Parallel Old

**Parallel Scavenge** 是**吞吐量优先**的新生代收集器，关注点是"用最短时间完成 GC、把更多 CPU 留给用户代码"。它的老年代搭档是 **Parallel Old**（标记-整理）。组合即为 **Parallel GC**。

- **吞吐量 = 用户代码运行时间 / (用户代码时间 + GC 时间)**。Parallel 追求高吞吐，适合后台计算、离线批处理这类"不那么在意单次停顿、只在意总时间"的场景。
- `-XX:GCTimeRatio`：设置吞吐量目标（如 99 表示 GC 时间占比不超过 1%）。
- `-XX:MaxGCPauseMillis`：设置期望最大停顿（与吞吐是矛盾的，GC 会在这两者间权衡）。
- **`-XX:+UseAdaptiveSizePolicy` 自适应策略**：开启后收集器会**自动调整**新生代大小、Eden/Survivor 比例、晋升年龄等参数来逼近你设定的吞吐/停顿目标，几乎不用手调。
- **它是 JDK 8 的默认服务端收集器**。

```bash
-XX:+UseParallelGC                # 开启 Parallel Scavenge + Parallel Old (JDK8 默认)
-XX:GCTimeRatio=99                # 吞吐目标: GC 时间 <= 1%
-XX:MaxGCPauseMillis=200          # 期望停顿 <= 200ms (与吞吐权衡)
-XX:+UseAdaptiveSizePolicy        # 自适应调节(默认开启)
```

> 吞吐量与低延迟是一对矛盾：要吞吐就要少 GC、让 GC 一次多干点（停顿长）；要低延迟就要频繁小步 GC（吞吐略降）。选型时先想清楚业务更痛哪一边。

## 五、CMS

**CMS（Concurrent Mark Sweep）** 是**以最短回收停顿时间为目标**的老年代收集器，曾长期是"低延迟"的代名词。它把 GC 拆成四个阶段：

1. **初始标记（Initial Mark，STW）**：只标记 GC Roots 直接关联的对象，速度极快。
2. **并发标记（Concurrent Mark）**：与用户线程**同时**遍历引用链，耗时最长但**不暂停用户线程**。
3. **重新标记（Remark，STW）**：修正并发标记期间因用户线程运行而变动的标记（用增量更新补漏），比初始标记稍慢但仍短。
4. **并发清理（Concurrent Sweep）**：与用户线程**同时**清理垃圾。

```text
时间轴:
  STW→ [初始标记] 并发→[并发标记] STW→[重新标记] 并发→[并发清理]
  停顿仅发生在初始标记和重新标记, 其余与业务并行
```

**三个致命缺点**，正是它被 G1 取代的原因：

- **对 CPU 资源敏感**：并发阶段要占用一部分 CPU 线程，核数少时明显拖慢业务。
- **浮动垃圾（Floating Garbage）**：并发清理期间用户线程还在产生新垃圾，这些"浮动垃圾"只能等下次 GC 处理，需预留空间，不能等老年代满了才收。
- **标记-清除产生内存碎片**：不整理，长期运行后大对象可能找不到连续空间，被迫触发 **Full GC（Serial Old 兜底，停顿很长）**。可用 `-XX:+UseCMSCompactAtFullCollection` 在 Full GC 时压缩，但会更慢。

```bash
-XX:+UseConcMarkSweepGC          # 开启 CMS (JDK 9 废弃, JDK 14 移除)
-XX:+UseCMSCompactAtFullCollection  # Full GC 时整理碎片
```

## 六、G1

**G1（Garbage First）** 是 **JDK 9 起的服务端默认收集器**，设计目标是在大堆下提供**可预测的停顿**。它的核心思想是把"分代"和"Region"结合：

- **Region 化整为零**：堆被切成一个个大小相等（1MB~32MB）的 **Region**，每个 Region 可扮演 Eden / Survivor / Old / **Humongous（存大对象，占连续多个 Region）** 角色，逻辑上仍分代，但物理上不再要求连续。
- **Remembered Set（记忆集）**：每个 Region 维护一个 RS，记录"哪些外部 Region 引用了我"，避免全堆扫描。
- **可预测的停顿模型**：G1 跟踪每个 Region 的回收"价值"（回收能腾出多少空间、需要多少时间），在用户设定的 **`-XX:MaxGCPauseMillis`** 预算内，**优先回收价值最高的 Region**（这也是"Garbage First"名字的由来）。

G1 的三种 GC 与主要流程：

```text
  Young GC    : 只回收 Eden/Survivor 这些年轻 Region (STW, 复制算法)
  Concurrent Marking : 并发标记全堆存活对象, 找出垃圾多的 Old Region
  Mixed GC    : 在停顿预算内, 挑若干高价值 Old Region + 所有年轻 Region 一起回收
  Full GC     : 极端情况(回收跟不上分配)才发生, 单线程标记-整理, 应竭力避免
```

```bash
-XX:+UseG1GC                  # 开启 G1 (JDK 9+ 默认)
-XX:MaxGCPauseMillis=200      # 期望最大停顿目标(软目标, G1 尽力逼近)
-XX:G1HeapRegionSize=16m      # 手动指定 Region 大小(一般不用)
```

为什么 JDK 9 起成为默认？因为它在**吞吐与延迟之间取得了良好平衡**：既能像 CMS 那样并发低停顿，又没有 CMS 的碎片顽疾（Mixed GC 会做整理），还能在大堆（数十 GB）下hold住。

## 七、ZGC

**ZGC（Z Garbage Collector）** 是**低延迟的王者**：JDK 11 引入（实验）、**JDK 15 转正**为正式特性。它的目标极其激进——**任何堆大小下停顿都不超过 10ms**，且停顿时间**不随堆大小增长**。

实现两大黑科技：

- **着色指针（Colored Pointers）**：把 GC 状态信息（标记、重定位）直接编码进**对象指针的空闲比特位**里，无需额外记录，访问对象时顺带读出状态。
- **读屏障（Load Barrier）**：在"从堆里读取引用"的瞬间插入一小段逻辑，配合着色指针完成并发标记与并发重定位，使对象移动对用户线程透明。

```text
  ZGC 几乎全程并发: 标记、重定位、重映射都与业务线程并行
  停顿仅发生在极短的根扫描等阶段, 与堆大小无关 → 10ms 以内
```

- 支持 **TB 级堆**（官方称可到 16TB），停顿依旧 10ms 内。
- 适合**超大堆 + 极致低延迟**场景（如金融交易、实时推荐）。

```bash
-XX:+UseZGC                  # 开启 ZGC (JDK 15+ 正式)
-XX:+UseZGC -XX:+ZGenerational  # JDK 21+ 支持分代 ZGC, 吞吐更优
```

## 八、Shenandoah

**Shenandoah** 与 ZGC 目标相似（低延迟、并发），都是 Red Hat 主导推动的 OpenJDK 项目，在 **OpenJDK 12 引入**。它与 ZGC 的关键区别在于**实现并发移动（并发压缩）的手段不同**：

- **ZGC 用着色指针（Colored Pointers）**——依赖指针本身记录状态，需要平台支持（64 位地址且有空闲位）。
- **Shenandoah 用转发指针（Forwarding Pointer）**——在每个对象头里额外放一个"转发指针"指向对象移动后的新地址，读写时通过它透明地访问到新位置，因此**不依赖特殊指针格式、可移植性更好**，但在对象头维护上开销略大。

二者都是"低延迟并发收集器"路线，ZGC 因内置于 Oracle/OpenJDK 主线且性能亮眼，目前采用更广泛。

## 九、Epsilon

**Epsilon** 是一个"**不回收内存**"的收集器（JDK 11 引入，叫 No-Op GC）。它只负责分配内存，一旦用完就直接 OOM，**完全不做垃圾回收**。

听起来很荒谬，但有几个正当用途：

- **性能测试基准**：排除 GC 本身的开销，测出"纯业务"吞吐上限。
- **极短生命周期任务**：程序跑几秒就结束、根本来不及 GC，用 Epsilon 省去 GC 逻辑。
- **内存压力测试**：验证应用确切需要多少内存。

```bash
-XX:+UseEpsilonGC      # 开启 Epsilon(只分配, 不回收, 用完即 OOM)
```

## 十、如何选择收集器

给出一张决策表，按场景对号入座：

| 场景 | 推荐收集器 | 理由 |
|------|-----------|------|
| 单核 / 客户端 / 嵌入式 | Serial | 无线程开销、简单高效 |
| 吞吐优先、后台计算、批处理 | Parallel | 高吞吐、自适应 |
| 中小堆、平衡（JDK 8 默认） | Parallel / 升级到 G1 | 稳定、易调 |
| 大堆、追求可预测停顿（JDK 9+ 默认） | G1 | Region 化整为零、停顿可控 |
| 超大堆 + 极致低延迟（JDK 11+） | ZGC | 停顿 ≤10ms、与堆大小无关 |
| 极致低延迟（需跨平台/OpenJDK 分支） | Shenandoah | 转发指针、可移植 |
| 性能基准 / 短任务 / 压测 | Epsilon | 不回收、零 GC 开销 |

一句话经验：**新项目无脑 G1（JDK 9+ 默认即可），堆特别大且对延迟极度敏感再上 ZGC，老 JDK 8 项目默认 Parallel 一般也够用**。

## 十一、GC 日志

从 **JDK 9 起，日志系统统一为 `-Xlog`**，取代了旧的 `-XX:+PrintGCDetails` 等零散参数，表达力强得多：

```bash
# 开启所有 gc 日志, 带时间戳, 滚动到文件(最多5个, 每个100MB)
-Xlog:gc*:file=/path/to/gc.log:time,uptime:filecount=5,filesize=100M
```

解读一段典型的 G1 日志：

```text
[2024-01-01T10:00:00.123+0800] GC(1) Pause Young (Normal) (G1 Evacuation Pause)
[2024-01-01T10:00:00.123+0800] GC(1) Using 4 workers of 4 for evacuation
[2024-01-01T10:00:00.130+0800] GC(1)   Eden regions: 12->0(12)
[2024-01-01T10:00:00.130+0800] GC(1)   Survivor regions: 0->2(2)
[2024-01-01T10:00:00.130+0800] GC(1)   Old regions: 5->6
[2024-01-01T10:00:00.130+0800] GC(1)   Heap: 200M->80M(512M)
[2024-01-01T10:00:00.130+0800] GC(1) Pause Young (Normal) (G1 Evacuation Pause) 7.2ms
```

逐行含义：

- `Pause Young (Normal)`：一次**年轻代 GC**（G1 疏散暂停）。
- `Eden regions: 12->0(12)`：Eden 区 12 个 Region 被清空，下次目标仍为 12。
- `Survivor regions: 0->2`：存活对象复制到 2 个 Survivor Region。
- `Heap: 200M->80M(512M)`：**GC 前后堆占用 200M→80M，堆总容量 512M**。
- 末尾 `7.2ms`：本次 **STW 停顿 7.2 毫秒**。

分析日志推荐工具：**GCeasy**（上传日志自动出报告）、**GCViewer**（开源桌面工具），重点看**吞吐量、平均/最大停顿、GC 频率、晋升量**这四项。

## 本篇小结

- **Serial 单线程 STW，简单高效**，适合客户端与单核场景。
- **ParNew 是 Serial 多线程版，唯一能配 CMS**，随 CMS 退出历史。
- **Parallel 吞吐优先（JDK 8 默认）**，自适应策略自动调参。
- **CMS 追求最短停顿但已废弃**，缺点是对 CPU 敏感、浮动垃圾、碎片。
- **G1 是 JDK 9+ 默认**，Region 化整为零 + 记忆集 + 可预测停顿。
- **G1 有 Young/Mixed/Full GC 三类**，Full GC 应避免。
- **ZGC 停顿 ≤10ms 且与堆大小无关**，靠着色指针 + 读屏障，支持 TB 级堆。
- **Shenandoah 与 ZGC 同走低延迟路线**，区别在转发指针 vs 着色指针。
- **Epsilon 不回收内存**，用于压测/短任务/基准。
- **选型口诀**：小堆 Serial、吞吐 Parallel、默认 G1、超大低延迟 ZGC。
- **JDK 9+ 用 `-Xlog:gc*` 统一日志**，重点看吞吐/停顿/频率/晋升。

## 参考链接

- [Oracle - Z Garbage Collector (ZGC) 文档](https://docs.oracle.com/en/java/javase/17/gctuning/z-garbage-collector.html)
- [Oracle - Garbage-First (G1) 收集器文档](https://docs.oracle.com/en/java/javase/17/gctuning/garbage-first-garbage-collector.html)
- [OpenJDK - Shenandoah GC 项目](https://wiki.openjdk.org/display/shenandoah/Main)
- [OpenJDK - Epsilon (No-Op) GC](https://openjdk.org/jeps/318)
- [JEP 333: ZGC](https://openjdk.org/jeps/333)
- [GCeasy - 在线 GC 日志分析](https://gceasy.io/)
- [周志明《深入理解Java虚拟机》](https://book.douban.com/subject/34927789/)

下一篇 → [06 内存模型 JMM](/java/jvm/jmm)
