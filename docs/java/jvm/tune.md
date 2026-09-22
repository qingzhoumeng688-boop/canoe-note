# 07 JVM 调优

> 本篇导读：JVM 调优不是"背一堆参数往启动命令里塞"，真正的瓶颈往往不在 JVM。本文先端正调优态度与优先级，再给出内存参数模板、GC 日志与监控手段、一把好用的诊断命令（jstat/jmap/jstack/Arthas），最后用"OOM 排查"和"CPU 飙高排查"两条完整实战流程，外加一份可直接抄的生产启动参数模板，让你拿到问题知道从哪下手。

## 一、调优的原则

先端正态度：**大多数性能问题，首要原因不是 JVM，而是代码和 SQL**。一个在循环里反复查库的接口、一个没加索引的慢 SQL、一个无界 `HashMap` 缓存，再怎么调 JVM 也救不回来。

调优的**优先级**应该是：

1. **架构层面**：缓存、分库分表、异步化、削峰——解决"根本的量级问题"。
2. **代码层面**：减少无谓对象创建、避免大对象、优化算法、根治内存泄漏。
3. **数据库/中间件层面**：索引、慢 SQL、连接池配置。
4. **JVM 参数层面**：才是最后一步，用来"修边幅"——调整堆大小、选收集器、控停顿。

记住一句话：**JVM 调优的目标是让 GC 不成为瓶颈，而不是追求某个神奇参数**。先量化（监控 + 日志），再针对性调整，调完用数据验证，而不是拍脑袋。

## 二、内存参数设置

JVM 内存相关参数中，下面这组最常调：

- `-Xms` / `-Xmx`：堆的初始值 / 最大值。**建议设成一样**（见下一节）。
- `-Xmn`：新生代大小（也可让收集器自适应，但大促前常手动指定）。
- `-Xss`：每个线程栈大小，线程多时调小能容纳更多线程。
- `-XX:MetaspaceSize` / `-XX:MaxMetaspaceSize`：元空间初始水位 / 上限。
- `-XX:MaxDirectMemorySize`：堆外直接内存上限。

一份典型的 **4 核 8G 服务器**参数模板（JDK 8 + G1 前的 Parallel 时代，或 G1 都适用思路）：

```bash
# 堆: 8G 机器通常留 1~2G 给系统/堆外, 给堆 6G
-Xms6g -Xmx6g
# 新生代: 约占堆 1/3 ~ 1/2, 这里给 2G
-Xmn2g
# 每个线程栈 256K, 支持更多线程
-Xss256k
# 元空间: 设上限防止无限增长撑爆本机内存
-XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=512m
# 直接内存上限
-XX:MaxDirectMemorySize=1g
# 出 OOM 时自动 dump 堆, 事后分析(必开!)
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/logs/heapdump.hprof
```

## 三、-Xms 与 -Xmx 为什么要相同

把 `-Xms` 和 `-Xmx` 设成**相同值**，是为了**避免堆自动扩容带来的抖动**：

- 如果 `-Xms` 很小、`-Xmx` 很大，运行初期堆是小的；当内存压力上升、JVM 决定扩容堆时，会触发一次 **Full GC** 来完成扩容。
- 这种"用着用着突然 Full GC 一下"会造成**周期性、不可预期的停顿抖动**，对延迟敏感的服务尤其要命。

设成一样，堆一开始就以最大容量分配，运行期间不再扩容，**杜绝扩容型 Full GC**。代价只是启动时多占一点内存，通常完全可接受。这也是为什么生产环境几乎一律 `-Xms == -Xmx`。

## 四、GC 日志与监控

没有日志就没有调优。JDK 9+ 统一用 `-Xlog`：

```bash
-Xlog:gc*:file=/data/logs/gc.log:time,uptime:filecount=5,filesize=100M
```

参数含义：记录所有（`gc*`）GC 事件，带绝对时间（`time`）和启动后相对时间（`uptime`），滚动写文件，最多保留 5 个、每个最大 100MB，避免日志写爆磁盘。

分析工具：

- **GCeasy**：上传 `gc.log` 自动生成可视化报告，直接给出吞吐、停顿分布、问题诊断。
- **GCViewer**：开源桌面工具，画出 GC 前后堆占用曲线。

看 GC 报告重点关注四项指标：

- **吞吐量（Throughput）**：用户代码时间占比，越高越好（一般 95%+ 合格）。
- **平均停顿 / 最大停顿**：单次 STW 的均值和峰值，延迟敏感服务盯最大值。
- **GC 频率**：Minor/Full GC 多频繁，频繁说明参数或代码有问题。
- **晋升量（Promotion）**：每次 GC 从新生代晋升到老年代的对象大小，晋升过快会快速撑满老年代引发 Full GC。

## 五、常用诊断命令

JDK 自带一套命令行"听诊器"，无需额外安装：

**① `jps`**：列出当前机器的 Java 进程及 PID。

```bash
jps -l
# 输出: 12345 com.canoe.jvm.tune.OrderServiceApplication
```

**② `jstat`**：最常用，实时看 GC 与各内存区使用率。尤其 `-gcutil`：

```bash
jstat -gcutil 12345 1000     # 每 1 秒刷新一次
```

```text
  S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
  0.00  12.35  78.40  45.21  92.10  88.30   152    3.210     3    0.880   4.090
```

逐列解读：S0/S1 是 Survivor 区使用率，E 是 Eden 使用率，O 是老年代使用率，M 是元空间使用率；**YGC/YGCT 是 Minor GC 次数/总耗时，FGC/FGCT 是 Full GC 次数/总耗时，GCT 是 GC 总耗时**。如果 `O` 持续攀升不回落、`FGC` 频繁增长，基本可以断定**内存泄漏或老年代过小**。

**③ `jmap`**：看堆与对象分布、导出快照。

```bash
jmap -heap 12345            # 打印堆配置与各区域使用概况
jmap -histo:live 12345 | head -20   # 按实例数/占用排序, 看谁占内存最多
jmap -dump:live,format=b,file=/data/heap.hprof 12345  # 导出堆快照给 MAT 分析
```

**④ `jstack`**：看线程栈，定位死锁、阻塞、CPU 高的线程。

```bash
jstack 12345 > thread.txt   # 导出所有线程栈
# 在 thread.txt 里搜 "BLOCKED" / "deadlock" 找问题线程
```

**⑤ `jinfo`**：运行时查看/动态修改 JVM 参数。

```bash
jinfo -flags 12345          # 查看该进程生效的所有 JVM 参数
jinfo -flag MaxHeapFreeRatio 12345   # 查看某个具体参数
```

## 六、可视化工具

图形化工具能更直观地"看见"JVM 状态：

- **JConsole**：JDK 自带，连上进程即可看内存、线程、类、CPU 曲线，开箱即用。
- **VisualVM**：比 JConsole 强，支持插件、采样、堆 dump 分析。
- **JMC（Java Mission Control）**：Oracle 出品，基于 JFR（Java Flight Recorder）做低开销的飞行记录，适合生产环境长期采集。
- **Arthas（重点推荐）**：阿里开源的**在线诊断神器**，不用重启、不用加参数就能attach 到运行中的进程，排查线上问题极其顺手。

Arthas 常用命令速查：

```bash
dashboard            # 实时面板: 线程/内存/GC 总览
thread               # 列出所有线程, 找 CPU 高/阻塞的线程
thread -n 3          # 找出 CPU 占用最高的 3 个线程
thread <id>          # 查看某个线程的栈
jvm                  # 打印 JVM 信息(内存/GC/类加载)
heapdump /tmp/a.hprof # 在线 dump 堆
trace com.canoe.OrderService query  # 追踪方法内部各调用耗时
watch com.canoe.OrderService query '{params,returnObj}'  # 观测入参/返回值
ognl '@com.canoe.Config@instance'  # 用 OGNL 表达式读/改运行时对象
```

`trace` 和 `watch` 在"接口慢但不知道慢在哪一行"时尤其好用——能精确到方法内部每一步的耗时。

## 七、OOM 排查流程

遇到 `OutOfMemoryError`，**千万别重启了事**，按这套流程把现场留住并定位：

1. **提前预防**：务必在启动参数里加 `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=...`，这样 OOM 瞬间会自动dump，不依赖手快。
2. **拿到快照**：若没配自动 dump，立刻 `jmap -dump:live,format=b,file=heap.hprof <pid>` 手动导出（注意这步本身可能触发 Full GC，线上谨慎）。
3. **用 MAT 分析**：用 Eclipse MAT 打开 `heap.hprof`，看 **Dominator Tree（支配树）** 和 **Leak Suspects（泄漏嫌疑）**，找出"谁占了大部分内存、被谁引用着"。
4. **定位代码**：顺着 MAT 给出的引用链，定位到具体的业务类/缓存/集合，修复（如给缓存加上限、关闭未释放的资源、修复静态集合无清理等）。

典型内存泄漏模式：静态 `Map`/`List` 当作缓存却不淘汰、未关闭的流/连接、`ThreadLocal` 用完没 `remove` 导致线程池线程长期持有大对象。

## 八、CPU 飙高排查

服务 CPU 突然 100%，排查链路如下（给出完整命令）：

```bash
# 1. 找到最耗 CPU 的 Java 进程
top
# 假设看到 pid = 12345 的 java 进程 CPU 飙高

# 2. 在该进程内找最耗 CPU 的线程
top -Hp 12345
# 假设线程 tid = 12356 占用最高

# 3. 把线程 id 转成 16 进制(Arthas 等工具里 nid 用 16 进制表示)
printf "%x\n" 12356
# 输出: 304c

# 4. 在 jstack 输出里定位该线程的栈
jstack 12345 | grep -A 20 "nid=0x304c"
```

从 `jstack` 输出里能看到该线程**正在执行哪行代码**——常见元凶有：死循环、`HashMap` 在并发下退化成链表导致 `get` 死循环（JDK 8 已修复但仍应避免并发写）、正则回溯爆炸、频繁 Full GC 本身吃 CPU。

**真实案例**：某接口偶发 CPU 100%，按上述流程发现是 `nid=0x304c` 的线程卡在一个正则 `String.matches("^(\d+)+$")` 上——这种 `(...)+` 对长数字串会产生** catastrophic backtracking（灾难性回溯）**，输入稍长就指数级耗时。修复为预编译 `Pattern` 并限制长度后恢复正常。

## 九、常见调优场景

针对几类高频问题，给出对应思路与参数：

- **① 大促前扩容堆**：预估流量，按比例调大 `-Xmx`，并把 `-Xms` 同步调大避免抖动；确认收集器能 hold 住（堆过大时 G1/ZGC 优于 Parallel）。
- **② 频繁 Full GC**：先看是**内存泄漏**（老年代只涨不落、FGC 次数持续增加 → 走 OOM 排查修代码）还是**晋升过快**（新生代太小、短命大对象直接晋升 → 调大新生代 `-Xmn`、检查是否有大对象）。
- **③ Minor GC 频繁**：说明 Eden 太小或对象创建速率过高。调大 `-Xmn` 降低频率；若频繁 GC 仍快、停顿可接受，也可不动。同时排查是不是在循环里疯狂 new 短命大对象。
- **④ 元空间 OOM**：多为**动态生成类过多**（CGLib 动态代理、反射、Groovy 脚本、JSON 库缓存的 `BeanInfo`）。限制 `-XX:MaxMetaspaceSize` 防撑爆，并排查类加载泄漏（如每次请求都新生成代理类）。
- **⑤ 线程数太多 OOM**：`unable to create new native thread`。减小 `-Xss`（如 256k）以容纳更多线程，或改为线程池/异步模型，排查线程泄漏（线程一直不回收）。

## 十、一份生产参数模板

给出 **JDK 8** 与 **JDK 11/17** 两套可直接参考的启动参数（G1 收集器）。

JDK 8（G1 需显式开启）：

```bash
java -server \
  -Xms4g -Xmx4g \
  -Xss256k \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=512m \
  -XX:MaxDirectMemorySize=1g \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/data/logs/heapdump.hprof \
  -Xlog:gc*:file=/data/logs/gc.log:time,uptime:filecount=5,filesize=100M \
  -jar order-service.jar
```

JDK 11 / 17（G1 已是默认，参数更精简，并可考虑 ZGC）：

```bash
java -server \
  -Xms4g -Xmx4g \
  -Xss256k \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -XX:MaxMetaspaceSize=512m \
  -XX:MaxDirectMemorySize=1g \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/data/logs/heapdump.hprof \
  -Xlog:gc*:file=/data/logs/gc.log:time,uptime:filecount=5,filesize=100M \
  -jar order-service.jar

# 若堆很大(如 16G+)且对延迟极度敏感, 可切换 ZGC:
#  -XX:+UseZGC -XX:+UnlockExperimentalVMOptions   (JDK11 需解锁; JDK15+ 直接 -XX:+UseZGC)
```

> 模板只是起点，最终参数一定要结合**你自己的 GC 日志与监控数据**来微调，别人抄来的"最优参数"未必适合你的业务。

## 本篇小结

- **调优优先级：架构 → 代码 → 数据库 → JVM 参数**，多数瓶颈不在 JVM。
- **`-Xms` 与 `-Xmx` 必须设成一样**，避免扩容触发 Full GC 造成抖动。
- **GC 日志是调优前提**，JDK 9+ 用 `-Xlog:gc*` 统一记录。
- **报告重点看吞吐/平均停顿/最大停顿/GC 频率/晋升量**。
- **`jstat -gcutil` 实时看各区使用率与 GC 次数/耗时**，快速判断是否泄漏。
- **`jmap -histo` 看对象排行，`jmap -dump` 导出快照给 MAT 分析**。
- **`jstack` 定位死锁与 CPU 高线程**，`jinfo` 查改运行时参数。
- **Arthas 在线诊断无需重启**，`trace`/`watch`/`thread` 排接口慢与异常。
- **OOM 必须提前开 `-XX:+HeapDumpOnOutOfMemoryError`**，事后用 MAT 支配树定位。
- **CPU 飙高排查链路：top → top -Hp → printf %x → jstack grep nid**。
- **大促扩堆、频繁 Full GC、Minor 频繁、元空间 OOM、线程过多**各有对应思路。

## 参考链接

- [Oracle - Java SE 17 工具文档（jstat/jmap/jstack 等）](https://docs.oracle.com/en/java/javase/17/docs/specs/man/index.html)
- [Oracle - GC Tuning Guide (含参数与案例)](https://docs.oracle.com/en/java/javase/17/gctuning/index.html)
- [Alibaba Arthas 官方文档](https://arthas.aliyun.com/doc/)
- [Eclipse MAT (Memory Analyzer) 下载](https://www.eclipse.org/mat/)
- [GCeasy - 在线 GC 日志分析](https://gceasy.io/)
- [周志明《深入理解Java虚拟机》](https://book.douban.com/subject/34927789/)

下一篇 → [08 类字节码](/java/jvm/bytecode)
