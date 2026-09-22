# 10 ThreadLocal

`ThreadLocal` 解决的问题很特别：**不共享，就不存在竞争。** 它给每个线程发一个"专属储物柜"，线程之间互不干扰，从而绕开了锁。但用不好也会翻车——最典型的就是**内存泄漏**和**线程池串号**。本篇从"是什么"到"原理、内存泄漏、父子线程继承"，再到真实业务场景与规范，把这把双刃剑讲透。

## 一、ThreadLocal 是什么

`ThreadLocal` 提供**线程级别的变量副本**：同一个 `ThreadLocal` 对象，在不同线程里 `get()` 拿到的是各自独立的值，互不影响。

一个贴切的比喻：**公司给每位员工发了一个专属储物柜**。你往自己柜子里放的东西，同事看不到、也拿不到；你取出来的，永远是你自己放进去的那份。所以根本不需要加锁——因为数据压根没共享。

适用场景的特征很明确：**数据只在线程内部流转，不需要跨线程共享**。比如一次请求里的"当前登录用户""traceId""数据库连接"。

## 二、基本用法

`ThreadLocal` 的常规 API：

- `set(T value)`：给当前线程存值；
- `get()`：取当前线程的值；
- `remove()`：**删除**当前线程的值（极其重要，后面内存泄漏会讲）；
- `withInitial(Supplier)`（JDK 8）：指定一个初始值工厂；
- `initialValue()`：子类重写，提供默认初始值。

下面代码里，3 个线程各自计数到 3，彼此完全独立：

```java
package com.canoe.thread.threadlocal;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ThreadLocalCounterDemo {
    // 每个线程独立的计数器，初始为 0
    private static final ThreadLocal<Integer> COUNTER =
            ThreadLocal.withInitial(() -> 0);

    public static void main(String[] args) throws InterruptedException {
        int threadCount = 3;
        CountDownLatch latch = new CountDownLatch(threadCount);
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        for (int i = 0; i < threadCount; i++) {
            pool.execute(() -> {
                for (int j = 0; j < 3; j++) {
                    COUNTER.set(COUNTER.get() + 1);
                }
                System.out.println(Thread.currentThread().getName()
                        + " 计数：" + COUNTER.get()); // 每个线程都只数到 3
                COUNTER.remove(); // 用完清理，避免内存泄漏
                latch.countDown();
            });
        }
        latch.await();
        pool.shutdown();
    }
}
```

## 三、实现原理

一个最常见的误解是："值存在 `ThreadLocal` 对象里"。**错。`ThreadLocal` 本身只是个 key，真正的值存在每个线程自己的身上。**

每个 `Thread` 对象内部都有一个 `ThreadLocalMap`（可理解为定制化的哈希表），它的 **key 是对 `ThreadLocal` 的弱引用（WeakReference），value 才是真正存的值**。当你调用 `get()` 时，流程是：

1. 拿到**当前线程** `Thread.currentThread()`；
2. 取它的 `threadLocals`（那个 `ThreadLocalMap`）；
3. 以**当前 `ThreadLocal` 对象自身**为 key，查出对应的 value。

结构示意如下：

```text
Thread-1                         Thread-2
 └─ ThreadLocalMap               └─ ThreadLocalMap
     ┌─────────────────────┐         ┌─────────────────────┐
     │ key→ThreadLocal(弱) │         │ key→ThreadLocal(弱) │
     │ value→"用户A的数据" │         │ value→"用户B的数据" │
     ├─────────────────────┤         ├─────────────────────┤
     │ key→ThreadLocal(弱) │         │       ...           │
     │ value→"traceId-001" │         └─────────────────────┘
     └─────────────────────┘

说明：ThreadLocal 只是钥匙，值锁在每个线程自己的"柜子"里。
      线程销毁时 Map 随之销毁；但线程池的线程会复用，所以必须 remove。
```

因此"线程隔离"的本质是：**空间换隔离——每个线程一份数据，谁也不碰谁的。**

## 四、内存泄漏（重点）

这是 `ThreadLocal` 最容易出生产事故的地方，必须讲透。

**为什么会泄漏？** 看第三节的结构：`ThreadLocalMap` 的 **key 是弱引用**，value 是强引用。当外界的 `ThreadLocal` 强引用（比如静态变量）被置为 `null` 或类卸载后，key 这个弱引用会在下次 GC 时被回收，变成 `null`。但 **value 仍然是强引用**，只要 `Thread` 还活着，这个 value 就一直占着内存、无法被 GC 回收。

**为什么线程池里尤其危险？** 普通线程跑完就结束了，它的 `ThreadLocalMap` 随线程一起销毁，泄漏只是"一次性"的。但**线程池的线程是长期存活、反复复用的**——不 `remove()`，上一个任务残留的 value 会一直挂在 Map 里，下一个复用该线程的任务可能读到这些**脏数据（串号）**，同时这些 value 永远无法释放，慢慢把内存吃满。

下面代码演示了"不 remove 导致数据串号"的隐患：

```java
package com.canoe.thread.threadlocal;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ThreadLocalLeakDemo {
    private static final ThreadLocal<String> USER_HOLDER = new ThreadLocal<String>();

    public static void main(String[] args) {
        // 线程池只有 2 个线程，却要处理 5 个任务 → 线程会被复用
        ExecutorService pool = Executors.newFixedThreadPool(2);
        for (int i = 0; i < 5; i++) {
            final int order = i;
            pool.execute(() -> {
                USER_HOLDER.set("用户-" + order);
                System.out.println(Thread.currentThread().getName()
                        + " 处理的用户：" + USER_HOLDER.get());
                // 忘记 remove！该线程被复用处理下一个任务时，可能看到上个用户的脏值
            });
        }
        pool.shutdown();
    }
}
```

**解决方案：只要用完，务必 `remove()`。** 标准写法是 `try { ... } finally { threadLocal.remove(); }`。

## 五、为什么 key 用弱引用

既然弱引用会导致 key 变 `null`、value 泄漏，那为什么不直接用强引用？

反过来想：**如果 key 是强引用**，那么即便你业务上已经不再使用这个 `ThreadLocal`（外部强引用已断开），因为 `ThreadLocalMap` 还被 `Thread` 强引用着，Map 里的 entry（key + value）就**永远无法被回收**——这样比现在更糟，连 key 都清不掉。

而用**弱引用**至少保证了：**一旦外部不再持有 `ThreadLocal`，key 在 GC 时会被清成 `null`**。而且 JDK 在 `set()`、`get()`、`remove()` 时会顺带执行 **`expungeStaleEntry`** 清理逻辑，把 key 为 `null` 的 entry 连带 value 一起清掉，从而释放出 value 的内存。

**结论：弱引用是一种"兜底补救"，不是根治手段。真正能 100% 避免泄漏的，只有显式调用 `remove()`。**

## 六、InheritableThreadLocal

普通 `ThreadLocal` 的值只在**当前线程**可见。如果想让**子线程继承父线程的值**，用 `InheritableThreadLocal`：

```java
package com.canoe.thread.threadlocal;

public class InheritableDemo {
    // 子线程能继承父线程设置的值
    private static final InheritableThreadLocal<String> PARENT_VALUE =
            new InheritableThreadLocal<String>();

    public static void main(String[] args) throws InterruptedException {
        PARENT_VALUE.set("父线程的值");
        Thread child = new Thread(() -> {
            System.out.println("子线程读到：" + PARENT_VALUE.get()); // 输出"父线程的值"
        });
        child.start();
        child.join();
    }
}
```

**重点警告**：`InheritableThreadLocal` 的继承发生在**子线程被 `new Thread()` 创建**的那一刻（它会把父线程的 `inheritableThreadLocals` 拷贝过来）。而**线程池里的线程是预先创建、反复复用的**，新任务不会"新建线程"，也就**不会触发继承**——父线程设置的值，线程池里的 worker 线程根本拿不到。

这正是阿里的 **Transmittable Thread Local（TTL）** 组件要解决的问题：它通过包装 `Runnable`/`Callable`，在任务提交与执行之间显式传递上下文，让线程池场景也能正确继承。生产环境如果需要在异步/线程池中传递上下文，请直接用 TTL，而不是 `InheritableThreadLocal`。

## 七、典型应用场景

`ThreadLocal` 在框架里无处不在，下面挑 5 个真实场景：

1. **用户上下文传递**：Web 拦截器里 `set` 当前用户，业务代码任意深处直接 `get`，免去了层层传参。Spring Security 的 `SecurityContextHolder` 就是这么干的。
2. **数据库连接 / 事务绑定**：Spring 的 `TransactionSynchronizationManager` 用 `ThreadLocal` 把 `Connection` 绑在当前线程，保证同一事务里多个 DAO 用的是同一个连接。
3. **SimpleDateFormat 线程安全化**：如本专栏"并发安全"篇所述，给每个线程一个独立实例（也可配合 `DateTimeFormatter`）。
4. **链路追踪 traceId**：在请求入口生成 `traceId` 存入 `ThreadLocal`，日志框架在打日志时取出，串起整条调用链。
5. **分页参数**：MyBatis 的 `PageHelper` 用 `ThreadLocal` 暂存分页信息，避免把 `pageNum/pageSize` 写进每个方法签名。

下面是"用户上下文"的完整可运行示例，注意 `finally` 里的 `remove()`：

```java
package com.canoe.thread.threadlocal;

// 用户上下文：拦截器里 set，业务代码里 get，finally 里 remove
public class UserContextHolder {
    private static final ThreadLocal<User> CONTEXT = new ThreadLocal<User>();

    public static void set(User user) {
        CONTEXT.set(user);
    }

    public static User get() {
        return CONTEXT.get();
    }

    public static void clear() {
        CONTEXT.remove(); // 关键：防止线程池复用时串号与内存泄漏
    }

    // 当前登录用户
    public static class User {
        private final String name;
        public User(String name) { this.name = name; }
        public String getName() { return name; }
    }
}

// 业务服务：任意方法都能拿到当前用户，无需参数传递
class BusinessService {
    public void doBusiness() {
        UserContextHolder.User user = UserContextHolder.get();
        System.out.println("当前操作用户：" + (user == null ? "匿名" : user.getName()));
    }
}

// 模拟"拦截器 + 业务 + 清理"的完整流程
class UserContextDemo {
    public static void main(String[] args) {
        try {
            UserContextHolder.set(new UserContextHolder.User("小明"));
            new BusinessService().doBusiness();
        } finally {
            UserContextHolder.clear(); // 无论成败都清理
        }
    }
}
```

## 八、使用规范

- **必须声明为 `static final`**：`ThreadLocal` 实例本身只是个 key，应该是全局唯一的；如果每次 `new` 一个，不同地方用的是不同的 key，自然取不到同一份值。非 `static` 还可能导致 Map 无限膨胀。
- **必须用完 `remove()`**：尤其在 Web 请求结束、线程池任务收尾时，用 `try-finally` 兜底。
- **不要在异步 / 线程池里依赖普通 `ThreadLocal`**：线程会被复用，且 `InheritableThreadLocal` 也不会继承；需要传递请用 TTL。
- **不要存大对象**：因为值会随线程（尤其是线程池）长期存活，存大对象等同于变相的内存泄漏。

## 本篇小结

- **`ThreadLocal` 给每个线程一份独立副本**，本质是"不共享"来规避竞争。
- **值存在线程自己的 `ThreadLocalMap` 里**，`ThreadLocal` 只是 key，不存值。
- **Map 的 key 是弱引用、value 是强引用**，key 被 GC 后 value 仍可能泄漏。
- **线程池线程复用 + 不 remove = 数据串号 + 内存泄漏**，危害最大。
- **根治内存泄漏靠 `remove()`**，弱引用只是兜底补救。
- `set/get/remove` 时会触发 **`expungeStaleEntry`** 顺带清理过期 entry。
- **`InheritableThreadLocal` 能向子线程传值**，但线程池场景不生效。
- 异步/线程池传递上下文应改用阿里的 **Transmittable Thread Local（TTL）**。
- 典型应用：**用户上下文、事务绑定、SimpleDateFormat、traceId、分页参数**。
- `ThreadLocal` **必须声明为 `static final`** 且用完 `remove()`。
- 不要往 `ThreadLocal` 里存大对象，避免变相内存泄漏。

## 参考链接

- [ThreadLocal API 文档](https://docs.oracle.com/javase/8/docs/api/java/lang/ThreadLocal.html)
- [InheritableThreadLocal API 文档](https://docs.oracle.com/javase/8/docs/api/java/lang/InheritableThreadLocal.html)
- [Transmittable Thread Local（阿里 TTL）](https://github.com/alibaba/transmittable-thread-local)
- [Java 并发教程：并发概述](https://docs.oracle.com/javase/tutorial/essential/concurrency/)
- [Java 语言规范 第 17 章：线程与锁](https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html)
- [《Java 并发编程实战》官方站](https://jcip.net/)

下一篇 → [11 并发安全问题](/java/thread/safe)
