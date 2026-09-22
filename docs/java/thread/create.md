# 02 线程创建方式

> 本篇导读：Java 里"开一个线程"至少有四种写法：继承 `Thread`、实现 `Runnable`、实现 `Callable` 配合 `FutureTask`、以及交给线程池。它们不是简单的"写法不同"，而是任务与线程耦合度的不同、是否需要返回值的区别。本篇逐一拆解，并讲清 `start()` 与 `run()` 这个经典坑，以及为什么生产环境几乎只用手动线程池。

## 一、四种方式总览

先上对比表，心里有张地图再往下看：

| 方式 | 是否有返回值 | 能否抛受检异常 | 任务与线程关系 | 适用场景 |
| --- | --- | --- | --- | --- |
| 继承 `Thread` | 否 | 否 | 耦合（任务即线程） | 学习、极简单场景 |
| 实现 `Runnable` | 否 | 否 | 解耦（可复用） | 不需要返回值的任务 |
| 实现 `Callable` | 是（`Future`） | 能 | 解耦，可拿结果 | 需要返回值的任务 |
| 线程池提交 | 视提交内容 | 视情况 | 完全托管 | **生产唯一推荐** |

记住一个趋势：**从 `Thread` 到 `Runnable` 到 `Callable` 到线程池，任务和"线程"这件脏活越分越开**，可维护性和可控性越来越好。

## 二、继承 Thread

最简单直接：写一个类继承 `Thread`，重写 `run()`，然后 `new` 出来 `start()`。

```java
package com.canoe.thread.create;

public class ExtendThreadDemo extends Thread {

    @Override
    public void run() {
        System.out.println("线程 " + getName() + " 正在执行任务");
    }

    public static void main(String[] args) {
        ExtendThreadDemo t = new ExtendThreadDemo();
        t.start();
    }
}
```

**缺点很明显**：Java 是单继承，继承了 `Thread` 就不能再继承别的类；而且"任务（`run` 里的逻辑）"和"线程（`Thread`）"被绑死在一个类里，任务没法被别的线程或线程池复用。所以实际开发基本不用它。

## 三、实现 Runnable

这是**最推荐的基础写法**：把"要做什么"抽成一个 `Runnable` 任务，线程只是负责"去跑它"。

```java
package com.canoe.thread.create;

public class RunnableDemo {

    // 任务与线程解耦：Runnable 只描述"做什么"
    static class TicketTask implements Runnable {
        private int tickets = 100;

        @Override
        public void run() {
            // 多个窗口（线程）抢同一份票，这里故意不加同步，先暴露问题
            while (tickets > 0) {
                System.out.println(Thread.currentThread().getName()
                        + " 卖出第 " + tickets + " 张票");
                tickets--;
            }
        }
    }

    public static void main(String[] args) {
        // 三个窗口共享同一个任务实例，也就是共享 tickets
        TicketTask task = new TicketTask();
        new Thread(task, "窗口A").start();
        new Thread(task, "窗口B").start();
        new Thread(task, "窗口C").start();
    }
}
```

`Runnable` 的两个好处：① **任务与线程解耦**，同一个 `task` 可以被任意线程跑；② 因为任务是普通类，还能再去继承别的类。

注意上面这个"三个窗口卖票"故意**没加同步**，必然会出现"同一张票卖了两次""卖出第 0 张票"之类的错乱——这正是为后面 `synchronized`/`Lock` 埋的伏笔：**共享变量 + 非原子操作 = 线程安全问题的温床**。

## 四、实现 Callable

`Runnable` 的短板是"干完活拿不到结果，也抛不出受检异常"。`Callable` 补上了这两点：它有一个泛型返回值，还能抛异常，配合 `FutureTask` 使用。

```java
package com.canoe.thread.create;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;

public class CallableDemo {

    // 计算 1 到 n 的累加和，并返回结果
    static class SumTask implements Callable<Integer> {
        private final int n;

        SumTask(int n) {
            this.n = n;
        }

        @Override
        public Integer call() throws Exception {
            int sum = 0;
            for (int i = 1; i <= n; i++) {
                sum += i;
            }
            return sum;
        }
    }

    public static void main(String[] args) {
        FutureTask<Integer> futureTask = new FutureTask<Integer>(new SumTask(100));
        new Thread(futureTask).start();

        try {
            // get() 会阻塞，直到任务算完拿到返回值
            Integer result = futureTask.get();
            System.out.println("1 到 100 的和 = " + result);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException e) {
            e.printStackTrace();
        }
    }
}
```

**`get()` 会阻塞**这一点要特别当心：如果任务里卡死了或算得很慢，调用 `get()` 的线程会被一直拖住。生产里一定要用带超时的 `get(long, TimeUnit)`，别让一个慢任务把你的主线程也拖垮。

## 五、匿名内部类与 Lambda

前面都写成了独立的类，实际代码里更常见的是**就地写**。`Runnable` 是函数式接口，用 Lambda 最爽：

```java
package com.canoe.thread.create;

public class LambdaDemo {

    public static void main(String[] args) {
        // 匿名内部类写法（老式）
        new Thread(new Runnable() {
            @Override
            public void run() {
                System.out.println("匿名内部类方式");
            }
        }).start();

        // Lambda 写法（推荐，简洁）
        new Thread(() -> System.out.println("Lambda 方式")).start();
    }
}
```

`new Thread(() -> {...}).start()` 现在几乎成了"临时起个线程"的标准姿势。不过再次强调：临时 `new Thread` 只适合一次性小脚本，**正经服务请用线程池**（见第八节）。

## 六、start 与 run 的区别

这是一道**经典送命题**：调用 `run()` 并不会启动新线程，它只是一次普通的方法调用，依然在**当前线程**里顺序执行；只有 `start()` 才会真正向 JVM 申请创建一个新线程，再由新线程去执行 `run()`。

```java
package com.canoe.thread.create;

public class StartVsRunDemo {

    public static void main(String[] args) {
        Runnable task = () -> {
            System.out.println("执行 run 的线程是：" + Thread.currentThread().getName());
        };

        Thread t = new Thread(task, "我的线程");

        System.out.println("主线程是：" + Thread.currentThread().getName());
        // t.run();   // 如果改成这样，打印的会是 "main"，并没有新线程
        t.start();    // 正确：打印的是 "我的线程"
    }
}
```

一句话：**`start()` 是"招人干活"，`run()` 是"自己干"**。另外 `start()` 只能调一次，重复调会抛 `IllegalThreadStateException`。

## 七、线程命名

生产环境**一定要给线程起名字**！否则出问题时 `jstack` 里全是 `Thread-12`、`Thread-37`，你根本分不清谁是谁。

```java
package com.canoe.thread.create;

public class NameDemo {

    public static void main(String[] args) {
        Runnable task = () -> {
            System.out.println("当前线程：" + Thread.currentThread().getName());
        };

        // 好的做法：名字带业务含义，出问题时一眼定位
        new Thread(task, "order-pool-1").start();

        // 反面教材：什么都不传，名字变成 Thread-0，排查时一脸懵
        new Thread(task).start();
    }
}
```

命名建议带上"业务 + 角色 + 编号"，比如 `order-consumer-1`、`push-scheduler`。线程池也别忘了自定义 `ThreadFactory` 给线程命名（后面线程池篇会讲）。

## 八、为什么推荐线程池

看到这你可能会问：前面学了好几种 `new Thread` 的写法，实际到底用哪个？答案很残酷也很统一：**生产环境几乎只用线程池，几乎不裸 `new Thread`**。

原因：

- **复用线程**：池里线程跑完任务不销毁，下一个任务直接复用，省掉频繁创建/销毁的开销。
- **数量可控**：手动 `new Thread` 想开多少开多少，流量一上来直接 OOM；线程池有上限，扛不住就走拒绝策略，至少不把进程拖死。
- **便于管理**：统一命名、监控活跃数、统计完成任务数，排查问题有据可查。

裸 `new Thread` 就像"每来一个活儿就招一个人，干完就开除"，成本极高且无法管理；线程池是"养一支固定团队，活儿排好队挨个干"。所以后面的篇章，`ExecutorService` 才是主角。

## 本篇小结

- Java 创建线程有**四种方式**：继承 `Thread`、实现 `Runnable`、实现 `Callable`、交给线程池。
- 继承 `Thread` 有**单继承限制**且任务与线程耦合，实际很少使用。
- 实现 `Runnable` 做到了**任务与线程解耦**，是最基础也最推荐的写法。
- `Callable` 相比 `Runnable` 多了**返回值和异常抛出**能力，靠 `FutureTask` 承接结果。
- `FutureTask.get()` 会**阻塞**等待结果，生产环境务必使用带超时的 `get`。
- `start()` 才是真正**创建并启动新线程**，`run()` 只是普通方法调用，不会开线程。
- `start()` 只能调用**一次**，重复调用会抛 `IllegalThreadStateException`。
- 用 **Lambda** 写 `Runnable` 最简洁，是临时起线程的常用姿势。
- 生产环境必须**给线程起有意义的名字**，方便 `jstack` 排查问题时定位。
- 共享同一个 `Runnable` 实例时，多个线程会**共享其成员变量**，容易引发线程安全问题。
- 真实项目几乎不裸 `new Thread`，一律使用**线程池**以获得复用与可控性。

## 参考链接

- [Oracle 并发教程 - 定义和启动线程](https://docs.oracle.com/javase/tutorial/essential/concurrency/runthread.html)
- [Java Thread 类官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Thread.html)
- [Java Runnable 接口官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Runnable.html)
- [Java Callable 接口官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/Callable.html)
- [Java FutureTask 官方 API 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/FutureTask.html)
- [《Java 并发编程实战》](https://www.amazon.com/Java-Concurrency-Practice-Brian-Goetz/dp/0321349601)

下一篇 → [03 线程状态与生命周期](/java/thread/lifecycle)
