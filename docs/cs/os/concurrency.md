# 08 并发控制与死锁

> 本篇导读：多进程/线程并发带来竞态与死锁。本篇讲清临界区、信号量、经典同步问题，以及死锁的四个必要条件与三种处理思路（预防/避免/检测）。理解它们，你就能看懂"为什么两个线程同时 `i++` 结果会少""为什么 `synchronized` 能保护共享变量""为什么数据库偶尔会报死锁并回滚"——这些都不是玄学，而是并发控制这套机制的必然。

## 一、并发问题与临界区

### 为什么会有并发问题

现代 CPU 多核、OS 抢占式调度，多个执行流（进程/线程）**在时间上重叠**地推进。当它们**共享同一份可变状态**（全局变量、堆对象、文件、数据库行）时，执行顺序的不确定性就会暴露出 bug。这类 bug 最难调，因为"偶发、依赖时序、复现困难"。

一个经典反例：两个线程各对共享变量 `count` 自增 100000 次，期望结果 200000，实际常常更小。

```java
// 看似简单的 count++，实际是"读-改-写"三步，并非原子
int count = 0;
// 线程A: tmp = count; tmp += 1; count = tmp;
// 线程B: 若恰好在 A 写回前也读了旧值 → 两次自增只生效一次
```

`count++` 在 CPU 层面至少拆成"从内存读入寄存器 → 加 1 → 写回内存"三条指令。若两个线程交错执行，就会丢掉一次更新。这就是**竞态条件（Race Condition）**。

### 竞态条件

**竞态条件**：程序的输出依赖多个线程/进程指令执行的**相对时序**，而该时序不可控，导致结果不确定（有时对、有时错）。根因是**对共享可变状态的访问缺少互斥保护**。

### 临界资源与临界区

| 概念 | 定义 |
| --- | --- |
| **临界资源** | 一次只允许一个执行流使用的共享资源（如打印机、共享变量、数据库连接） |
| **临界区（critical section）** | 访问临界资源的那段**代码**，不是资源本身 |
| **进入区 / 退出区** | 进入临界区前"申请锁"的代码段 / 离开后"释放锁"的代码段 |

正确的互斥机制必须满足三条性质：

| 性质 | 含义 |
| --- | --- |
| **互斥（Mutual Exclusion）** | 任一时刻最多一个执行流在临界区内 |
| **前进（Progress）** | 没有执行流在临界区内时，想进的能进，且由"非临界区执行流"决定谁进，不能死等 |
| **有限等待（Bounded Waiting）** | 一个执行流申请进入后，不能无限期等待（不能饿死） |

补充：**空闲让进**常作为第四条（临界区空时立即允许进入）。以上四条是评判任何锁/同步方案是否合格的标准。

## 二、软件与硬件解法

在操作系统提供信号量之前，人们用纯软件协议和硬件指令实现互斥。

### Peterson 算法（纯软件双线程解法）

Peterson 算法用两个共享变量，让**两个线程**严格交替地保证互斥与有限等待，无需硬件支持（仅作原理理解，生产不用）。

```text
共享变量:
  flag[0], flag[1]   // 各自"我想进临界区"标志
  turn               // 轮到谁

线程 i 进入区:
  flag[i] = true
  turn = j          // 礼让：把机会先给对方
  while (flag[j] == true && turn == j) ;  // 忙等，直到对方不想进或轮到我
线程 i 退出区:
  flag[i] = false
```

为什么能互斥：若两线程都想进，`turn` 只能是一个值，必有一方 `turn==j` 不成立而进入；若只有一方想进，`flag[j]==false` 直接让 i 进。**它证明了"纯软件也能实现互斥"**，但只适用两线程、且 `while` 忙等浪费 CPU，扩展到 N 线程极其复杂，所以现实中交给硬件指令。

### 硬件原子指令

现代 CPU 提供**不可中断**的读-改-写指令，从根本上解决"读改写被打断"：

| 指令 | 语义 | 用途 |
| --- | --- | --- |
| **TestAndSet（TSL）** | 原子地"读取旧值并置 1"，返回旧值 | `while (TestAndSet(&lock)) ;` 实现自旋锁 |
| **XCHG / Swap** | 原子地交换两个寄存器/内存值 | 同上，用交换实现加锁 |
| **CAS（Compare-And-Swap）** | 若当前值 == 预期值则更新，返回是否成功 | 构建无锁结构、自旋锁、Java `AtomicInteger` 底层 |

TestAndSet 实现自旋锁思路：

```text
boolean lock = false;
进入区: while (TestAndSet(&lock) == true) ;  // 返回 true 说明已被占，持续自旋
临界区: ... 干活 ...
退出区: lock = false;                         // 释放，让别人 TestAndSet 返回 false
```

硬件指令的价值：**原子性由 CPU 保证**，应用软件/OS 不必关心调度何时打断。但它仍是**忙等（自旋）**——持有锁前一直占着 CPU 空转。短临界区可接受（自旋不切上下文，比睡眠切换快），长临界区就该用"睡眠+唤醒"（即信号量、锁）避免空耗。

## 三、信号量

信号量（Semaphore，Dijkstra 1965 提出）是操作系统级** sleeps/wakeup** 的抽象，解决了"忙等浪费"和"遗漏唤醒"问题，是并发控制的基石。

### P / V 原语

信号量 `S` 是一个整型变量 + 一个等待队列，对它的操作必须**原子**：

| 操作 | 含义 | 伪码语义 |
| --- | --- | --- |
| **P（proberen，荷兰语"测试"）** | 申请资源 / 进入临界区 | `S--; if (S < 0) 阻塞并排队` |
| **V（verhogen，"增加"）** | 释放资源 / 离开临界区 | `S++; if (S <= 0) 唤醒一个等待者` |

`P` 就是 `wait()`，`V` 就是 `signal()`。若 `S` 初值 = 可用资源数，则 `P` 申请、`V` 归还。

为什么要用 P/V 而不是忙等：当 `S<0` 时进程被**阻塞（睡眠）**，让出 CPU 给别的进程；`V` 时再唤醒。这样就消除了自旋浪费，也绝不会"释放信号但没人接收"地丢失（信号量内部维护等待队列）。

### 整型信号量 vs 记录型信号量

| 类型 | 特点 | 问题 |
| --- | --- | --- |
| **整型信号量** | `S` 就是个整数，P 用 `while (S<=0); S--` 忙等 | **仍忙等**，不满足"让权等待" |
| **记录型（结构）信号量** | `S` 含 `{value, 阻塞队列}`，P 在 `value<0` 时**阻塞自己**入队 | 不忙等，正确实现休眠/唤醒 |

记录型信号量的结构（示意）：

```text
semaphore {
    int value;            // 资源计数
    queue<PCB> wait_q;    // 等待该信号量的进程队列
}
P(S):
    S.value--;
    if (S.value < 0) { 把当前进程加入 S.wait_q; 阻塞; }
V(S):
    S.value++;
    if (S.value <= 0) { 从 S.wait_q 取出一个进程; 唤醒; }
```

"记录型"才是正确的信号量，因为它在不足时**主动睡眠**而非空转。后面所有用法都默认指记录型。

### 用信号量实现互斥与同步

**互斥（当作锁，初值 1，叫互斥量 mutex）：**

```text
semaphore mutex = 1;        // 二值信号量，等价于一把锁
P(mutex);                   // 进入临界区前上锁
  // 临界区：访问共享变量
V(mutex);                   // 离开时解锁
```

`mutex` 初值 1，第一个 `P` 把它变 0 进入；第二个 `P` 变 -1 被阻塞，直到前者 `V` 唤醒。这就是互斥锁的本质。

**同步（顺序控制，初值 0，让 B 等 A 先完成）：**

```text
semaphore done = 0;         // 初值 0，表示"还没完成"
线程A: 做准备工作; V(done);          // 通知：我好了
线程B: P(done); 做依赖准备结果的活;  // 没收到通知就阻塞等待
```

`P(done)` 在 `V(done)` 之前会阻塞，于是**强制 B 等到 A 完成之后**——这是"同步"而非"互斥"：两者不抢资源，只是约定先后顺序。

## 四、经典同步问题

三个问题是面试与教材的常青树，本质都是"在一堆约束下用 P/V 安排正确顺序"。

### 生产者-消费者（有界缓冲区）

**问题**：一个缓冲区容量 N。生产者往里放、消费者从里取；缓冲区满时生产者不能放，空时消费者不能取；且放/取动作本身要互斥。

用三个信号量/计数：

| 变量 | 初值 | 作用 |
| --- | --- | --- |
| `empty` | N | 空槽数量，生产者先 P 它 |
| `full` | 0 | 满槽（产品）数量，消费者先 P 它 |
| `mutex` | 1 | 保护缓冲区这一临界资源的互斥 |

```text
生产者:
  while (true) {
    生产一件产品;
    P(empty);          // 等一个空位
    P(mutex);          // 进临界区
    放入缓冲区;
    V(mutex);
    V(full);           // 产品+1，唤醒可能等待的消费者
  }

消费者:
  while (true) {
    P(full);           // 等一个产品
    P(mutex);
    从缓冲区取出;
    V(mutex);
    V(empty);          // 空位+1，唤醒可能等待的生产者
    消费产品;
  }
```

关键点：**`P(empty)/P(full)` 必须在 `P(mutex)` 之前**。若先 `P(mutex)` 再 `P(empty)`，缓冲满时生产者拿着锁睡死，消费者拿不到锁永远无法取——**死锁**。次序错了就是灾难。

下面给一个 Java 示意（用 `ReentrantLock` + `Condition` 对应 empty/full 两个条件）：

```java
package os.concurrency;

import java.util.LinkedList;
import java.util.Queue;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

public class BoundedBuffer {
    private final Queue<Integer> buf = new LinkedList<>();
    private final int capacity;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();   // 对应 empty
    private final Condition notEmpty = lock.newCondition();  // 对应 full

    public BoundedBuffer(int capacity) { this.capacity = capacity; }

    public void produce(int item) throws InterruptedException {
        lock.lock();
        try {
            while (buf.size() == capacity) notFull.await();  // P(empty) 的睡眠版
            buf.offer(item);
            notEmpty.signal();                               // V(full)
        } finally {
            lock.unlock();
        }
    }

    public int consume() throws InterruptedException {
        lock.lock();
        try {
            while (buf.isEmpty()) notEmpty.await();          // P(full)
            int item = buf.poll();
            notFull.signal();                                // V(empty)
            return item;
        } finally {
            lock.unlock();
        }
    }
}
```

### 读者-写者（读多写少）

**问题**：多个读者可同时读（不互斥），但写者必须独占（写-写、读-写都互斥）。目标：读者间并发、写者串行，且写者不能饿死。

用信号量：

| 变量 | 初值 | 作用 |
| --- | --- | --- |
| `rw` | 1 | 写者互斥锁（也是第一个读者"占位"用） |
| `mutex` | 1 | 保护读者计数 `rc` 的修改 |
| `rc` | 0 | 当前读者数（普通变量，非信号量） |

```text
读者:
  P(mutex); rc++; if (rc == 1) P(rw); V(mutex);   // 第一位读者锁住 rw，挡住写者
  读数据;
  P(mutex); rc--; if (rc == 0) V(rw); V(mutex);   // 最后一位读者解锁 rw

写者:
  P(rw); 写数据; V(rw);                            // 全程独占
```

这是**读者优先**版：只要还有读者，`rw` 一直被占，写者可能饿死。若要**写者优先**，需加"写者排队"信号量（写者来时先占 `w` 挡住新读者），这里不展开。Java 里直接 `ReentrantReadWriteLock` 就是该模型的标准实现（读锁共享、写锁独占）。

### 哲学家就餐（避免死锁的经典）

**问题**：5 个哲学家围坐，每人左右各一支筷子（共 5 支）。拿齐左右两支才能吃，吃完放下。朴素写法"先拿左再拿右"会全体同时拿左、都等右——死锁。

解法思路（信号量/管程皆可）：

1. **限制同时拿筷人数 ≤ 4**：最多 4 人同时尝试，必有人能吃，打破循环等待（破坏死锁四条件之一）。
2. **奇数号先拿右、偶数号先拿左**：错开拿取顺序，打破"循环等待"。
3. **同时拿两支（管程/原子拿）**：用一把大锁把"拿左+拿右"做成原子，要么都拿到要么都不拿，杜绝半拿状态。

管程思路示意（把"拿两支筷子"封成一个原子操作）：

```text
monitor DiningPhilosophers {
    state[5] = thinking;
    condition[5] = 每人一个条件变量;

    pickup(i):
        state[i] = hungry;
        test(i);                       // 看左右是否都空闲
        if (state[i] != eating) wait(condition[i]);   // 不满足就睡，等邻居放下唤醒
    putdown(i):
        state[i] = thinking;
        test(left(i)); test(right(i)); // 唤醒可能因此能吃的邻居
    test(i):
        if (左右都thinking && 自己hungry) { state[i]=eating; signal(condition[i]); }
}
```

管程的好处：把"检查+等待+唤醒"封装进 monitor，调用者不必手写 P/V 顺序，降低出错概率。

## 五、管程 Monitor

### 概念

**管程（Monitor，Hoare 1974）** 是一种比信号量更高层的同步抽象：把**共享变量 + 对它的操作 + 内部互斥**打包成一个模块。任何时刻**只有一个线程能在管程内执行**，进入管程自动加锁、离开自动解锁，所以调用者不用手动配对 P/V。

```text
monitor 名字 {
    // 私有共享变量（外部不能直接访问）
    共享状态;
    // 对外过程：进入即自动互斥
    procedure 操作A() { ... }
    procedure 操作B() { ... }
    // 条件变量 + wait/signal 用于线程间协作
    condition c;
}
```

管程内用**条件变量（condition）** 表达"我还不满足、先睡"：`c.wait()` 释放管程锁并睡到 `c` 上；`c.signal()` 唤醒一个等在 `c` 上的线程（唤醒后由管程保证互斥交接）。

### 与信号量对比

| 维度 | 信号量 | 管程 |
| --- | --- | --- |
| **抽象层级** | 低层原语（P/V） | 高层封装（过程 + 自动互斥） |
| **互斥由谁保证** | 程序员自己配对 P/V，配错就乱 | 进入管程自动互斥，不用手写 |
| **易错点** | P/V 顺序/配对易错（如生产者问题次序） | 条件变量的 wait/signal 语义需理解 |
| **表达力** | 两者等价，可互相实现 | 两者等价 |
| **典型实现** | 操作系统内核、POSIX sem | Java `synchronized` / `ReentrantLock` + `Condition` |

### Java 的对应

Java 没有名为"Monitor"的关键字，但 **`synchronized` 方法/代码块就是管程语义**：进入自动获取对象锁（监视器锁），离开自动释放；同一时刻只有一个线程在 synchronized 块内。

```java
package os.concurrency;

public class Counter {
    private int value = 0;

    // synchronized 方法 = 进入对象管程，自动互斥
    public synchronized void increment() {
        value++;                 // 临界区，安全
    }

    public synchronized int get() {
        return value;
    }
}
```

更灵活的 `ReentrantLock` + `Condition` 对应"管程 + 多个条件变量"，可精确唤醒某一类等待者（如生产者-消费者里的 notFull/notEmpty），比单个 `synchronized` + `wait/notify` 更可控：

```java
package os.concurrency;

import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

public class MonitorStyle {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition ready = lock.newCondition();

    public void worker() throws InterruptedException {
        lock.lock();
        try {
            while (!canProceed()) ready.await();   // 等价于 c.wait()
            doWork();
            ready.signal();                        // 等价于 c.signal()
        } finally {
            lock.unlock();
        }
    }

    private boolean canProceed() { return false; }
    private void doWork() { /* ... */ }
}
```

一句话对应：**管程 ≈ `synchronized`/`ReentrantLock` 提供的"自动互斥 + 条件等待"**，只是 Java 把它做进了语言与 JDK，而非独立叫 Monitor。

## 六、死锁

**死锁（Deadlock）**：一组进程/线程**互相持有对方需要的资源、又互相等待对方释放**，导致谁都推进不下去，永久阻塞。

典型场景：线程 T1 锁了 A 等 B，线程 T2 锁了 B 等 A，两者卡死。

### 四个必要条件（缺一不可）

Coffman 等人总结，死锁发生**必须同时满足**以下四条：

| 条件 | 含义 | 直觉 |
| --- | --- | --- |
| **① 互斥（Mutual Exclusion）** | 资源不可共享，一次只能一个占用 | 打印机、锁天然互斥 |
| **② 占有并等待（Hold and Wait）** | 进程已占有一部分资源，还申请别的并被阻塞，期间不放手 | 拿着 A 等 B |
| **③ 不可剥夺（No Preemption）** | 资源不能被强行抢走，只能自愿释放 | 不能把别人的锁夺过来 |
| **④ 循环等待（Circular Wait）** | 存在"进程环"：P1 等 P2 的资源、P2 等 P3…Pn 等 P1 | 形成等待闭环 |

**关键推论**：四条**同时成立**才死锁。所以只要破坏任意一条，死锁就不可能发生——这正是下一节"预防"的思路。注意"四个条件都满足"是死锁的**必要非充分**表述的严格形式：在经典模型里，这四条同时成立即足以构成死锁（且死锁必满足这四条）。

### 资源分配图（死锁可视化）

用有向图表示：圆形=进程，方形=资源（内部分块=资源实例数）；**进程→资源**表示"申请中"，**资源→进程**表示"已分配给它"。

```text
T1 ──申请──> R1 (已分配──> T2)
T2 ──申请──> R2 (已分配──> T1)

即: T1 等 R1(在T2) , T2 等 R2(在T1)  → 有环 → 死锁
```

判定：**若图中存在环，且涉及资源每类只有 1 个实例，则环 = 死锁**；若资源有多实例，有环不一定死锁（可能只是排队等待），需用"死锁定理"（看能否化简/是否处于不安全状态）进一步判断。

## 七、死锁处理

处理死锁有四种大方向：**忽略（预防/避免/检测都不做，如多数通用 OS 选鸵鸟算法）、预防、避免、检测+解除**。教材与面试重后三者。

### 预防：破坏四条件之一

从设计上让四个必要条件至少一个**永远不成立**，从而死锁不可能发生。代价是可能降低并发度或利用率。

| 破坏目标 | 做法 | 代价 |
| --- | --- | --- |
| **破坏互斥** | 把资源改成可共享（如只读文件、写时复制） | 很多资源本质互斥，改不了 |
| **破坏占有并等待** | **一次性申请所有资源**再开工；或申请新资源前先释放已持有的 | 资源利用率低、可能饿（一直凑不齐） |
| **破坏不可剥夺** | 申请不到时**主动释放已持有的**，稍后重试（或 OS 抢占） | 实现复杂，且不适合"释放一半状态"的资源（如数据库事务） |
| **破坏循环等待** | **给所有资源统一编号，只能按升序申请**（如先锁小号再锁大号） | 必须全局约定顺序，灵活性差但最常用（数据库加锁顺序即此思路） |

最实用的是"**按固定顺序加锁**"：只要所有线程都按资源编号从小到大申请，就不会出现"T1 拿大号等小号、T2 拿小号等大号"的环。这把循环等待直接消除。

### 避免：银行家算法（动态判断）

不事先破坏条件，而是**每次资源申请时，先"假装分配"并检查系统是否仍处安全状态**，安全才真分配，否则让进程等待。代表是**银行家算法（Banker's Algorithm）**。

核心概念：

| 概念 | 含义 |
| --- | --- |
| **Max** | 每个进程声明的最大需求 |
| **Allocation** | 已分配 |
| **Need = Max - Allocation** | 还差多少 |
| **Available** | 当前空闲资源 |
| **安全序列** | 存在一个进程执行顺序，使每个进程都能"用已有+借来的资源跑完并归还"，系统不卡死 |

安全性检查算法（思路）：反复找"Need ≤ Available"的进程，把它当作能跑完，把它的 Allocation 加回 Available；若所有进程都能这样消化完，就存在安全序列 → 状态安全。

银行家算法举例（5 进程、3 类资源，仅示意关键步骤）：

```text
某时刻:
        Max        Allocation   Need       Available
P0     (7,5,3)    (0,1,0)     (7,4,3)    (3,3,2)
P1     (3,2,2)    (2,0,0)     (1,2,2)
P2     (9,0,2)    (3,0,2)     (6,0,0)
P3     (2,2,2)    (2,1,1)     (0,1,1)
P4     (4,3,3)    (0,0,2)     (4,3,1)

找 Need<=Available(3,3,2): P1(1,2,2) yes → 跑完归还 → Available=(5,3,2)
再找: P3(0,1,1) yes → 归还 → Available=(7,4,3)
再找: P4(4,3,1) yes → 归还 → Available=(7,4,5)
再找: P0(7,4,3) yes → 归还 → Available=(7,5,5)
再找: P2(6,0,0) yes → 全部完成
安全序列: P1→P3→P4→P0→P2  ⇒ 当前安全，可分配
```

现实意义：银行家算法**理论完美但开销大、要预知最大需求**，现实 OS 很少全盘用它（怕进程不报真实 Max）；但它塑造了"安全状态"思想，被数据库、资源调度借鉴。多数通用 OS 选择"不预防也不避免，而是检测+解除"或干脆鸵鸟（死锁极少且代价低时）。

### 检测：资源分配图 + 死锁定理

允许死锁发生，但**定期检测**。方法：

- **单实例资源**：检测资源分配图中**是否有环**；有环即死锁。
- **多实例资源**：用类似银行家的"化简"：反复消除"能跑完的进程"（其请求能被满足的），若最后还剩进程消不掉，则**剩余的就是死锁进程**（死锁定理）。

```text
检测化简: 把所有"请求能被当前可用满足"的进程当完成 → 释放其资源
          重复直到无法化简 → 剩下未能消除的进程集合 = 死锁进程
```

### 解除：终止或回滚

确认死锁后"如何止损"：

| 方法 | 做法 | 代价/风险 |
| --- | --- | --- |
| **终止进程** | 杀掉死锁环中的一个或全部进程 | 简单，但丢失现场、可能数据不一致 |
| **逐个终止** | 一次杀一个，每杀完检测一次，直到死锁解除 | 代价小些，仍丢工作 |
| **回滚（rollback）** | 把进程回退到某个**检查点（checkpoint）** 重来 | 需事先存快照，损失小、最优雅，数据库常用 |
| **资源抢占** | 强行剥夺某进程资源给别的，稍后归还 | 实现复杂，且被抢进程状态要能恢复 |

选择策略常按"代价最小"：优先终止**优先级低、已运行时间短（重做成本低）、不持有太多资源**的进程。

## 八、活锁与饥饿

死锁不是唯一的"推进不下去"，还有两种近亲。

| 现象 | 表现 | 与死锁区别 | 例子 |
| --- | --- | --- | --- |
| **死锁** | 进程**阻塞睡眠**，永久卡住，不消耗 CPU 也不前进 | 占用资源、睡死 | T1 持 A 等 B，T2 持 B 等 A |
| **活锁（Livelock）** | 进程**一直在运行**（忙），但总是"让来让去"谁也进不去，无进展 | 不睡、空转、像在跳舞 | 两人在窄路互相谦让，同时左移同时右移，永远错不开 |
| **饥饿（Starvation）** | 某进程**一直得不到资源**，长期不被调度，但别人在正常工作 | 系统没卡死，只是它饿 | 高优先级线程源源不断，低优先级线程永远排不上 |

- **活锁**：典型场景——两个线程都检测到"可能死锁"于是都主动释放并退避重来，结果下一轮又同时抢、又同时退避，循环往复。解决靠**随机化退避**（如加随机等待）打破对称性。
- **饥饿**：SSTF 磁盘调度、严格优先级调度都可能出现——中间请求不断来，边缘请求永远轮不到。解决靠**老化（aging）**：等待越久优先级越高，最终一定被服务。
- **优先级反转**一句话关联：低优先级线程持锁、高优先级线程等它，中间优先级线程又抢占了低优先级，导致高优先级被"间接"卡住（经典事故：火星探路者号）。解决用**优先级继承**（持锁时临时提升其优先级）。

一句话区分：**死锁=全睡死；活锁=全在忙但无进展；饥饿=个别一直没饭吃**。三者都不是"程序出错"，而是**资源分配策略的副作用**，靠好的调度与协议规避。

## 本篇小结

- 并发 bug 源于**共享可变状态 + 交错执行**，典型是 `count++` 的读-改-写非原子导致竞态。
- 临界区是"访问临界资源的代码段"，合格锁须满足**互斥、前进、有限等待**三性质。
- Peterson 算法证明纯软件能互斥（仅双线程）；**TestAndSet/XCHG/CAS** 用硬件原子指令落地，但朴素用法会忙等。
- 信号量 `P/V` 是休眠-唤醒抽象：初值 1 当**互斥锁**、初值 0 做**同步**；记录型信号量才不忙等。
- 生产者-消费者用 `empty/full/mutex` 三信号量，**P(empty/full) 必须在 P(mutex) 前**否则死锁。
- 读者-写者用"首个读者锁 rw、计数加 mutex"实现读共享写独占；哲学家就餐用**错序拿筷/限人数/原子拿双筷**破环。
- 管程把"共享变量+操作+互斥"封装成模块，进入自动加锁；**Java `synchronized`/`ReentrantLock` 即管程语义**。
- 死锁四必要条件：**互斥、占有并等待、不可剥夺、循环等待**，同时成立才死锁；破坏任一条即可预防。
- 死锁处理三思路：预防（破坏条件）、避免（银行家算法查安全序列）、检测+解除（资源分配图/死锁定理 + 终止或回滚）。
- 活锁=忙而无进展、饥饿=个别长期没资源、优先级反转=低优先级持锁卡住高优先级，三者皆靠好的调度/协议规避。

## 参考链接

- [OSTEP: Concurrency and Synchronization (locks, semaphores)](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks.pdf)
- [OSTEP: Deadlock (conditions, prevention, detection)](https://pages.cs.wisc.edu/~remzi/OSTEP/deadlock.pdf)
- [Wikipedia: Deadlock](https://en.wikipedia.org/wiki/Deadlock)
- [Wikipedia: Semaphore (programming)](https://en.wikipedia.org/wiki/Semaphore_(programming))
- [Wikipedia: Monitor (synchronization)](https://en.wikipedia.org/wiki/Monitor_(synchronization))
- [The Java Tutorials: Concurrency (Oracle)](https://docs.oracle.com/javase/tutorial/essential/concurrency/)
- [Java `java.util.concurrent.locks` Package Docs](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/package-summary.html)
- [Wikipedia: Dining philosophers problem](https://en.wikipedia.org/wiki/Dining_philosophers_problem)

下一篇 → [01 操作系统概述与体系结构](/cs/os/overview)
