# 03 单例模式

天下分久必合，合久必分。在软件世界里，"唯一"往往比"多个"更让人安心：一个帝国只能有一个皇帝，一个应用只能有一个配置中心，一个线程池只能有一份。单例模式（Singleton）要解决的正是这个问题——**保证一个类在 JVM 里只有一个实例，并且提供全局访问点**。本文以秦始皇一统六国为引，带你从八种写法一路演进到面试必问的 DCL、volatile 与各种"破墙"手段。

## 一、它是什么

一句话大白话：**单例模式就是"千呼万唤只出来一个"的对象**——无论你在程序的哪个角落去要它，拿到的永远是同一个人（同一个对象）。

生活化的比喻：秦始皇扫六合之后，天下只有一个"始皇帝"。你在咸阳喊"陛下"，在陇西喊"陛下"，应答的都是同一个嬴政，绝不会出现第二个皇帝跟你争玉玺。程序中如果某个资源全局唯一（比如玉玺 = 配置中心），你就该用单例把它"锁死"。

经典定义（GoF）：**Ensure a class only has one instance, and provide a global point of access to it.** 保证一个类仅有一个实例，并提供一个访问它的全局访问点。

单例在 GoF 里属于"创建型"模式，但注意它同时也是一个被用烂、被误用最多的模式——能不用就别用，要用就用对。

## 二、为什么需要它（不用会怎样）

先看看"不用单例"会怎样。假设我们做一个全局计数器 `IdGenerator`，多个线程都去 `new` 一个，各玩各的：

```java
package com.canoe.pattern.singleton;

public class BadIdGenerator {
    private int count = 0;

    public int nextId() {
        return ++count;
    }
}

// 调用方 A
BadIdGenerator g1 = new BadIdGenerator();
// 调用方 B
BadIdGenerator g2 = new BadIdGenerator();
System.out.println(g1.nextId()); // 1
System.out.println(g2.nextId()); // 1  ← 两套计数器，ID 重复了！
```

痛点立刻暴露：

- **ID 不唯一**：每个 `new` 都是独立对象，`g1` 和 `g2` 各数各的，分布式/多线程下会撞车。
- **资源浪费**：数据库连接池、线程池、配置中心如果到处 `new`，内存和连接被成倍吃掉。
- **状态不一致**：A 改了配置，B 拿到的还是旧配置，改一处动不了全身，反而"改一处谁都看不见"。

单例的作用就在这：把"构造"这件事收口到一处，全程序共享同一个实例，既保证唯一，又节省资源，还让全局状态一致可控。

## 三、结构与角色

单例的结构极其简单，只有"自己"和"自己"：

```text
        ┌──────────────────────────┐
        │       Singleton          │
        ├──────────────────────────┤
        │ - instance: Singleton     │◄── 私有静态成员，保存唯一实例
        │ + getInstance(): Singleton│◄── 全局访问点（公开静态方法）
        │ - Singleton()             │◄── 私有构造器，堵死外部 new
        └──────────────────────────┘
                  ▲
                  │ 只能调用 getInstance()
        ┌─────────┴─────────┐
        │   Client（任意调用方）│
        └───────────────────┘
```

| 角色 | 职责 | 说明 |
| --- | --- | --- |
| `Singleton`（单例类） | 持有私有静态实例，提供 `getInstance()` | 自己管自己，外部不能直接 `new` |
| 私有构造器 | 禁止外部通过 `new` 创建第二个实例 | 这是单例的"命门"，必须 `private` |
| `getInstance()`（全局访问点） | 返回唯一实例，必要时才创建 | 饿汉式立刻建，懒汉式按需建 |
| `Client`（调用方） | 只通过 `getInstance()` 拿对象 | 拿到的永远是同一个引用 |

## 四、代码实现

最稳妥、最推荐的写法其实是"枚举单例"，但为了让演进过程清晰，我们先给出**饿汉式（静态常量）**这版"地基"代码，它已经是完整可运行的：

```java
package com.canoe.pattern.singleton;

// 饿汉式：类加载时就建好唯一实例，线程安全，但没有懒加载
public class Emperor {

    // 1. 私有静态常量，类加载阶段即完成实例化（JVM 保证线程安全）
    private static final Emperor INSTANCE = new Emperor();

    // 2. 私有构造器：外部任何地方都无法 new 出第二个皇帝
    private Emperor() {
        // 防御反射破坏：若已有实例，再被反射调用构造器直接拒绝
        if (INSTANCE != null) {
            throw new RuntimeException("皇帝只能有一个，禁止通过反射创建！");
        }
    }

    // 3. 全局访问点：永远返回同一个 INSTANCE
    public static Emperor getInstance() {
        return INSTANCE;
    }

    // 4. 业务方法：皇帝发号施令
    public void order() {
        System.out.println("朕乃始皇帝，号令天下。");
    }

    // 演示入口
    public static void main(String[] args) {
        Emperor e1 = Emperor.getInstance();
        Emperor e2 = Emperor.getInstance();
        e1.order();
        System.out.println("e1 与 e2 是同一人？ " + (e1 == e2)); // true
    }
}
```

运行输出：

```text
朕乃始皇帝，号令天下。
e1 与 e2 是同一人？ true
```

## 五、八种写法与演进

单例的八种常见写法，按"懒 → 安全 → 优雅"逐步演进：

**① 饿汉式（静态常量）** —— 见上文，类加载即创建，无线程安全问题，但没懒加载（不管用不用都占着）。

**② 饿汉式（静态代码块）** —— 和①本质一样，只是把初始化挪到 `static {}` 块，适合需要先读配置再 `new` 的场景：

```java
package com.canoe.pattern.singleton;

public class ConfigCenter {

    private static final ConfigCenter INSTANCE;

    // 静态代码块：可在创建前做一些初始化（读文件、解析配置等）
    static {
        System.out.println("读取 application.yml，初始化配置中心……");
        INSTANCE = new ConfigCenter();
    }

    private ConfigCenter() {}

    public static ConfigCenter getInstance() {
        return INSTANCE;
    }

    public void show() {
        System.out.println("全局配置中心就绪。");
    }
}
```

**③ 懒汉式（线程不安全）** —— 第一次调用才创建，但多线程下可能 `new` 出多个：

```java
package com.canoe.pattern.singleton;

// 线程不安全：两个线程同时进入 if 判断，可能创建两个实例
public class UnsafeLazy {

    private static UnsafeLazy instance;

    private UnsafeLazy() {}

    // 没有同步，并发场景下可能返回不同实例
    public static UnsafeLazy getInstance() {
        if (instance == null) {
            instance = new UnsafeLazy();
        }
        return instance;
    }
}
```

**④ 懒汉式（synchronized 方法）** —— 给方法加锁，安全了但每次调用都加锁，性能差：

```java
package com.canoe.pattern.singleton;

public class SyncLazy {

    private static SyncLazy instance;

    private SyncLazy() {}

    // 整个方法加 synchronized：线程安全，但 99% 的读操作都被锁拖累
    public static synchronized SyncLazy getInstance() {
        if (instance == null) {
            instance = new SyncLazy();
        }
        return instance;
    }
}
```

**⑤ 双重检查锁（DCL）** —— 只在首次创建时加锁，兼顾安全与性能（下一节详解为什么必须 `volatile`）：

```java
package com.canoe.pattern.singleton;

public class DclSingleton {

    // volatile：禁止指令重排序，防止拿到"半初始化"对象
    private static volatile DclSingleton instance;

    private DclSingleton() {}

    public static DclSingleton getInstance() {
        if (instance == null) {                 // 第一次检查（无锁，提升性能）
            synchronized (DclSingleton.class) {  // 只在真正要创建时才加锁
                if (instance == null) {          // 第二次检查（持锁，防重复创建）
                    instance = new DclSingleton();
                }
            }
        }
        return instance;
    }
}
```

**⑥ 静态内部类（推荐）** —— 利用 JVM 类加载机制保证线程安全，又实现懒加载，堪称"懒汉的优雅版"：

```java
package com.canoe.pattern.singleton;

public class InnerClassSingleton {

    private InnerClassSingleton() {}

    // 内部类在被调用时才加载，天然实现懒加载 + 线程安全
    private static class Holder {
        private static final InnerClassSingleton INSTANCE = new InnerClassSingleton();
    }

    public static InnerClassSingleton getInstance() {
        return Holder.INSTANCE;
    }
}
```

**⑦ 枚举（最优雅，官方推荐）** —— 《Effective Java》作者 Josh Bloch 力荐，天然防反射、防序列化破坏：

```java
package com.canoe.pattern.singleton;

// 枚举天生单例：JVM 保证唯一、免费防反射与序列化攻击
public enum EnumEmperor {
    INSTANCE;

    public void order() {
        System.out.println("朕即天下，枚举单例，固若金汤。");
    }

    public static void main(String[] args) {
        EnumEmperor.INSTANCE.order();
        System.out.println(EnumEmperor.INSTANCE == EnumEmperor.INSTANCE); // true
    }
}
```

**⑧ 容器式（登记式）** —— Spring 就是这么干的：用一个 `Map` 登记多个单例，按名字取：

```java
package com.canoe.pattern.singleton;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// 容器式单例：用一个 Map 统一管理多个"单例"（Spring 的 BeanFactory 思路）
public class SingletonRegistry {

    // 用 ConcurrentHashMap 保证并发安全
    private static final Map<String, Object> REGISTRY = new ConcurrentHashMap<String, Object>();

    private SingletonRegistry() {}

    public static void register(String key, Object instance) {
        REGISTRY.putIfAbsent(key, instance);
    }

    public static Object get(String key) {
        return REGISTRY.get(key);
    }
}
```

## 六、双重检查锁为什么要加 volatile

这是面试必考点。问题出在 `instance = new DclSingleton();` 这一行**不是原子的**，它在字节码层面至少分三步：

```text
(1) 分配内存空间          memory = allocate();
(2) 初始化对象            ctorInstance(memory);   // 调用构造器，给字段赋值
(3) 引用指向内存          instance = memory;      // 把地址赋给 instance
```

JIT 为了优化性能，可能做**指令重排序**，把 (3) 排到 (2) 前面：

```text
(1) 分配内存空间
(3) instance 指向内存（此时对象还没初始化完！）
(2) 初始化对象
```

后果：线程 A 刚执行完 (3)，`instance` 已经非 `null`，但对象还没真正初始化（半初始化对象）。此时线程 B 进入第一次检查，发现 `instance != null`，**直接返回了这个"半成品"**，后续用到字段就拿到默认值（`null`/0），引发难以排查的 BUG。

`volatile` 的作用就是**禁止这种重排序**（以及保证可见性），让 (2) 一定先于 (3)，线程 B 要么看到 `null`（那它会去加锁创建），要么看到**完全初始化好**的实例。少这一个关键字，DCL 就是空中楼阁。

## 七、反射、序列化、克隆如何破坏单例

单例再"铁"，也有三把"破墙锤"。

**① 反射攻击**：反射能强行调用私有构造器，造出第二个实例。

```java
package com.canoe.pattern.singleton;

import java.lang.reflect.Constructor;

public class ReflectAttack {
    public static void main(String[] args) throws Exception {
        Constructor<Emperor> c = Emperor.class.getDeclaredConstructor();
        c.setAccessible(true);                       // 暴力破除 private
        Emperor e3 = c.newInstance();               // 又造出一个皇帝！
        System.out.println(e3 == Emperor.getInstance()); // false，单例被破
    }
}
```

**防御**：构造器里加"已有实例就抛异常"的判断（见第四节 `Emperor` 构造器）。但**枚举天然免疫**——JVM 禁止用反射创建枚举实例，会直接抛 `IllegalArgumentException`。

**② 序列化攻击**：单例对象被序列化再反序列化，会得到"另一个"对象。

```java
package com.canoe.pattern.singleton;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.Serializable;

// 普通单例若实现 Serializable 却不做防护，反序列化会新建对象
class SerializableEmperor implements Serializable {
    private static final long serialVersionUID = 1L;
    private static final SerializableEmperor INSTANCE = new SerializableEmperor();
    private SerializableEmperor() {}
    public static SerializableEmperor getInstance() { return INSTANCE; }
}

public class SerializeAttack {
    public static void main(String[] args) throws Exception {
        ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream("e.obj"));
        oos.writeObject(SerializableEmperor.getInstance());
        oos.close();

        ObjectInputStream ois = new ObjectInputStream(new FileInputStream("e.obj"));
        SerializableEmperor e2 = (SerializableEmperor) ois.readObject();
        ois.close();
        System.out.println(e2 == SerializableEmperor.getInstance()); // false
    }
}
```

**防御**：实现 `readResolve()`，让反序列化时直接返回既有实例：

```java
package com.canoe.pattern.singleton;

import java.io.Serializable;

class SafeEmperor implements Serializable {
    private static final long serialVersionUID = 1L;
    private static final SafeEmperor INSTANCE = new SafeEmperor();
    private SafeEmperor() {}
    public static SafeEmperor getInstance() { return INSTANCE; }

    // 反序列化时 JVM 会调用此方法，用已有实例替换新创建的，保证唯一
    private Object readResolve() {
        return INSTANCE;
    }
}
```

**③ 克隆攻击**：若单例实现了 `Cloneable`，调用 `clone()` 会复制出另一个对象。

**防御**：重写 `clone()` 直接抛异常或返回 `INSTANCE`：

```java
package com.canoe.pattern.singleton;

import java.io.Serializable;

class CloneSafeEmperor implements Serializable, Cloneable {
    private static final long serialVersionUID = 1L;
    private static final CloneSafeEmperor INSTANCE = new CloneSafeEmperor();
    private CloneSafeEmperor() {}
    public static CloneSafeEmperor getInstance() { return INSTANCE; }

    @Override
    protected Object clone() throws CloneNotSupportedException {
        return INSTANCE; // 克隆也只返回唯一实例
    }
}
```

## 八、优缺点

| 优点 | 缺点 |
| --- | --- |
| **唯一性**：全局只有一份，避免资源冲突与状态不一致 | **不易扩展**：想派生子类或改成多例很麻烦 |
| **节省资源**：只创建一次，适合重量级对象（连接池、配置中心） | **隐藏依赖**：到处 `getInstance()` 像全局变量，耦合变重，难测试 |
| **全局访问点**：调用方便，无需层层传参 | **并发需谨慎**：写法不对会线程不安全或性能差 |
| **受控生命周期**：可在单例内做懒加载、缓存、计数 | **违背单一职责**：既管业务又管自己的创建逻辑 |
| **利于统一治理**：日志器、监控、权限等天然适合集中管理 | **易成"反模式"**：被滥用成到处可见的"上帝对象" |

## 九、适用场景

- **全局配置中心**：整个应用读同一份配置，改一处全局生效。
- **线程池 / 连接池**：资源宝贵，必须唯一且被复用。
- **日志器（Logger）**：所有模块写同一份日志，避免文件句柄错乱。
- **Spring 单例 Bean**：Spring 容器默认把 Bean 当单例管理（容器内唯一）。
- **计数器、ID 生成器、缓存管理器**：需要全局唯一状态或共享数据时。

**什么情况下不要用**：对象"有状态且会被并发修改且需要隔离"时别用单例；业务上本来就该多实例（如每个订单一个 `OrderService` 工作单元）时更不要用单例，否则会踩共享状态的坑。

## 十、在 JDK / 开源框架中的应用

- **`java.lang.Runtime`**：JDK 里的经典饿汉单例，`Runtime.getRuntime()` 返回与当前 JVM 绑定的唯一实例，封装了 `exec()` 等运行时能力。
- **`java.awt.Toolkit` / `Desktop`**：早期 JDK 用单例管理桌面与 GUI 工具。
- **Spring `DefaultSingletonBeanRegistry`**：Spring 容器用 `Map<String, Object>`（即上面的"容器式"）登记所有单例 Bean，`getSingleton(beanName)` 即访问点——这正是第八种写法的真实落地。
- **MyBatis `ErrorContext`**：MyBatis 用 `ThreadLocal` 配合单例思路保存每个线程的错误上下文，保证线程间互不串扰。
- **日志框架 `LogFactory` / `LoggerFactory`**：SLF4J 的 `LoggerFactory.getLogger()` 内部缓存并复用 `Logger` 实例，本质是单例 + 工厂的结合。

## 十一、与相近模式的区别

| 对比项 | 单例模式 | 工厂模式 | 原型模式 |
| --- | --- | --- | --- |
| **目的** | 保证唯一，全局共享 | 屏蔽创建细节、解耦 | 通过拷贝快速造新对象 |
| **结构** | 自己管自己的创建 | 工厂类负责 new 产品 | `clone()` 复制自身 |
| **使用场景** | 资源唯一、全局共享 | 产品种类多、要扩展 | 创建成本高、需要大量相似对象 |
| **会不会产生多个** | 坚决只有一个 | 想要几个有几个 | 每 clone 一次就多一个 |

## 本篇小结

- **单例模式**保证一个类在 JVM 内只有一个实例，并提供全局访问点。
- **私有构造器**是单例的命门，负责堵死外部 `new` 出第二个实例。
- **饿汉式**类加载即创建，线程安全但无懒加载；**懒汉式**按需创建但需注意并发。
- **静态内部类**写法兼顾线程安全与懒加载，是工程常用推荐。
- **双重检查锁（DCL）**必须给 `instance` 加 `volatile`，否则可能拿到半初始化对象。
- **指令重排序**会把"引用赋值"排到"初始化"之前，这是 DCL 不加 volatile 的致命伤。
- **枚举单例**是《Effective Java》首推写法，天然防反射、防序列化攻击。
- **反射攻击**可通过构造器内判空抛异常防御，枚举则直接免疫。
- **序列化攻击**需实现 `readResolve()` 返回既有实例来保护单例。
- **克隆攻击**应重写 `clone()` 返回 `INSTANCE` 或抛异常。
- **容器式（登记式）单例**正是 Spring 管理单例 Bean 的核心思路。
- 单例虽好，**不可滥用**，否则会变成耦合全局的"上帝对象"，损害可测试性。

## 参考链接

- [Refactoring Guru · 单例模式](https://refactoringguru.cn/design-patterns/singleton)
- [菜鸟教程 · 单例模式](https://www.runoob.com/design-pattern/singleton-pattern.html)
- [Spring 官方文档 · Bean 作用域](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-factory-scopes)
- [Oracle JavaDoc · java.lang.Runtime](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Runtime.html)
- [《Effective Java》第三版 · 条目 3：用枚举增强单例属性](https://book.douban.com/subject/30412517/)
- [廖雪峰的 Java 教程 · 单例模式](https://www.liaoxuefeng.com/wiki/1252599548343744/1281319214514209)
- [美团技术团队 · 单例模式与 volatile 的那些事](https://tech.meituan.com/)

下一篇 → [04 工厂三兄弟](/java/design-pattern/factory)
