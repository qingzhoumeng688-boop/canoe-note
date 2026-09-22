# 26 设计模式面试速查

> 本文不是又一篇模式教程，而是一份"上考场前能直接背"的速查手册：先点明面试题到底在考什么，再压 18 道高频题的精炼答案，最后附 23 种模式一句话速记与对比表。

## 一、它是什么

设计模式面试题，本质上考三件事：**① 你认不认识常见模式（名字 + 意图）；② 你写不写得出关键实现（如 DCL 单例、JDK 动态代理）；③ 你懂不懂"为什么这么设计、什么时候别用"。**

打个比方：面试官像在考你"菜谱"。认识菜名（单例、策略）是入门；能照着做出菜（手写代码）是及格；知道"这道菜为什么用大火、没这道食材能不能换"才是高手。本文帮你把这三层都补齐。

## 二、为什么需要它（不用会怎样）

如果你只背八股不真懂模式，后果很具体：

- **读不懂源码**：看到 `JdkDynamicAopProxy`、`HandlerAdapter` 一脸懵，只能死记。
- **写不出可维护代码**：需求一变就狂加 `if-else`，代码越改越烂，review 被同事怼。
- **面试被深挖就崩**：背了"单例用 DCL"，却答不出"为什么必须 `volatile`"，直接挂。

下面这 18 道题，几乎覆盖了国内 Java 中高级岗 80% 的模式考点。

## 三、结构与角色

面试题的知识体系可以这样组织：

```text
设计模式面试
 ├─ 创建型：单例 / 工厂 / 抽象工厂 / 建造者 / 原型
 ├─ 结构型：适配器 / 装饰器 / 代理 / 桥接 / 组合 / 外观 / 享元
 ├─ 行为型：策略 / 模板方法 / 观察者 / 责任链 / 命令 / 状态 / 迭代器 ...
 └─ 原则：SOLID + 迪米特 + 合成复用（模式的底层）
```

角色这块，记"三类人"即可：**Client（调用方）**、**Target/Abstract（抽象）**、**Concrete（具体实现）**。无论哪种模式，几乎都是"调用方只认抽象，具体实现可替换"。

## 四、代码实现

下面两段是面试里最高频的"手撕代码"，务必能闭眼写出。

**1. 线程安全的 DCL 单例（双重检查锁 + volatile）：**

```java
package com.canoe.pattern.interview;

// 双重检查锁单例：懒加载 + 线程安全 + 高性能
public class Singleton {
    // volatile 防止指令重排序导致其他线程拿到"半初始化"对象
    private static volatile Singleton instance;

    private Singleton() { }   // 私有构造，禁止外部 new

    public static Singleton getInstance() {
        if (instance == null) {               // 第一次检查（无锁，提升性能）
            synchronized (Singleton.class) {
                if (instance == null) {       // 第二次检查（持锁，保证只创建一次）
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

**2. 策略模式消灭 if-else（可运行的折扣示例）：**

```java
package com.canoe.pattern.interview;

// 策略模式：把"可变算法"抽成接口，运行时注入具体实现
public interface DiscountStrategy {
    double calc(double price);
}

class VipDiscount implements DiscountStrategy {
    @Override public double calc(double price) { return price * 0.9; }
}

class SvipDiscount implements DiscountStrategy {
    @Override public double calc(double price) { return price * 0.8; }
}

public class DiscountContext {
    private DiscountStrategy strategy;

    public void setStrategy(DiscountStrategy strategy) {
        this.strategy = strategy;
    }
    public double pay(double price) {
        return strategy.calc(price);
    }
}
```

## 五、高频面试题清单

**1. 单例为什么要用 `volatile`？**
JVM 创建对象分三步：① 分配内存 ② 初始化对象 ③ 把引用指向内存。没有 `volatile` 时，②③ 可能被重排序，线程 A 刚执行③、对象还没初始化完，线程 B 就读取到非 null 的"半初始化"实例直接返回，导致空指针。`volatile` 的禁止重排序语义保证了"初始化完成后引用才可见"。

**2. 饿汉式 vs 懒汉式怎么选？**
饿汉式类加载即创建，绝对线程安全但可能浪费内存（没用到也建了）；懒汉式用才建，省内存但要处理线程安全（DCL 或静态内部类）。**静态内部类写法最优雅**：既懒加载又线程安全，靠类加载机制保证。

**3. 单例有哪些破坏方式，怎么防？**
反射可调用私有构造、序列化/反序列化会新建对象、多 ClassLoader 会产生多个实例。防御：构造里抛异常防反射；实现 `readResolve()` 返回同一实例防序列化；用枚举单例可一次性防住反射 + 序列化。

**4. 简单工厂是 GoF 模式吗？**
不是。GoF 23 种里没有"简单工厂"，它只是把 `new` 挪到一个方法里的编码习惯。工厂方法（Factory Method）和抽象工厂（Abstract Factory）才是正式模式。

**5. 工厂方法 vs 抽象工厂的区别？**
工厂方法**一个工厂只产一个产品**（如 `LoggerFactory.create()` 只产 logger），靠继承扩展新产品；抽象工厂**一个工厂产一族配套产品**（如 `GUIFactory` 同时产 Button + Checkbox），解决"产品间要配套"的问题。

**6. 策略模式与状态模式的区别？**
结构极像（都有 Context + 抽象 + 具体）。区别在**意图**：策略是"算法可替换"，客户端主动选策略，各策略之间无状态迁移；状态是"对象状态变了行为跟着变"，状态间会自己切换（如下单后订单状态自动流转），且状态往往知道下一个状态是谁。

**7. 装饰器与代理的区别？**
装饰器**目的是动态叠加功能**（如 `BufferedInputStream` 包 `FileInputStream`），装饰者和被装饰者实现同一接口，可多层嵌套；代理**目的是控制访问**（权限、延迟加载、远程调用），代理和真实对象通常实现同一接口，但客户端一般不知道背后有代理。

**8. 适配器与桥接的区别？**
适配器是"事后补救"——两个已有接口不兼容，加个转接头让它俩能合作（结构型，解决接口不匹配）；桥接是"事前设计"——把抽象和实现拆成两条独立继承轴，让它们各自演化（如"形状"和"颜色"两个维度）。

**9. Spring 用了哪些设计模式？（高频大题）**
工厂（`BeanFactory`/`FactoryBean`）、单例（`SingletonBeanRegistry`，默认单例 scope）、模板方法（`AbstractApplicationContext.refresh()`）、策略（`InstantiationStrategy`）、适配器（`HandlerAdapter`）、观察者（事件 `ApplicationEvent`/`ApplicationListener`）、代理（`JdkDynamicAopProxy`/`CglibAopProxy`）、责任链（`BeanPostProcessor` 链、`HandlerInterceptor`）、组合（`CompositeIterator`）、外观（`JdbcTemplate` 封装 JDBC 繁琐流程）。详见本专栏 Spring 篇。

**10. JDK 动态代理 vs CGLIB 怎么选？**
JDK 动态代理要求**目标类实现接口**，基于 `InvocationHandler` + 反射，生成代理快、调用略慢；CGLIB 通过**继承目标类**生成子类（不能代理 final 类/方法），基于 ASM 字节码，生成略慢、调用快。Spring AOP 默认"有接口用 JDK，无接口用 CGLIB"。

**11. 观察者模式与发布-订阅（MQ）的区别？**
经典观察者中，Subject 直接持有 Observer 引用，二者耦合较紧、同步调用；发布-订阅（如消息队列）中间有"Broker/主题"解耦，发布者和订阅者互不认识，且通常异步。可理解为"观察者模式的松散解耦升级版"。

**12. 责任链模式在哪些源码里出现？**
Servlet 的 `Filter` 链、`Spring MVC` 的 `HandlerInterceptor` 拦截器链、`MyBatis` 的 `InterceptorChain`、`Spring` 的 `BeanPostProcessor` 处理链，以及 Netty 的 `ChannelPipeline`。

**13. 模板方法模式怎么防止子类破坏流程？**
把模板方法用 `final` 修饰，子类只能重写被 `protected` 标记的"钩子/抽象"步骤，不能改主流程骨架。例：`AbstractApplicationContext.refresh()` 就是 `final` 的模板方法。

**14. 什么时候不该用设计模式？**
① 没有变化点、只被调用一次的代码；② 需求极不稳定且模式本身会放大改动成本时；③ 团队不熟悉模式，强行使用反而降低可读性。记住 KISS 原则。

**15. 建造者模式 vs 工厂模式的区别？**
工厂关注"造哪种对象"（选择逻辑）；建造者关注"复杂对象怎么一步步拼出来"（构造逻辑），适合参数多、有必填/选填、需要链式调用的场景，如 `StringBuilder`、`OkHttpClient.Builder`。

**16. 接口隔离 vs 单一职责的区别？**
SRP 约束的是"类"（一个类只干一件事）；ISP 约束的是"接口"（不要往一个接口里塞一堆方法强迫实现类依赖用不到的）。前者是类级别，后者是接口级别，目标都是"高内聚、低耦合"。

**17. 依赖倒置 vs 依赖注入的区别？**
DIP 是设计原则（应面向抽象）；DI 是实现手段（把具体依赖从外部"注入"进来）。IOC 容器（如 Spring）用 DI 来落地 DIP。

**18. 组合模式适用什么场景？**
处理**树形结构**、希望"单个对象"和"对象容器"被统一对待时。例：文件系统（文件 vs 文件夹）、菜单（菜单项 vs 子菜单）、公司组织架构。`java.awt` 的 `Container`、MyBatis 的 `SqlNode` 都用到了。

## 六、一句话记住 23 种模式

- **单例**：全局只有一个实例。
- **工厂方法**：子类决定造哪个对象。
- **抽象工厂**：一次造一族配套对象。
- **建造者**：分步、链式拼出复杂对象。
- **原型**：复制自己来造新对象。
- **适配器**：转接头，让不兼容的接口能合作。
- **装饰器**：套娃式动态加功能。
- **代理**：给对象找个替身管访问。
- **桥接**：抽象和实现拆成两条轴，各走各的。
- **组合**：树形结构，单个和整体一视同仁。
- **外观**：给乱糟糟的子系统开个干净大门。
- **享元**：共享小对象，省内存。
- **策略**：算法可替换，消灭 if-else。
- **模板方法**：父类定骨架，子类填空。
- **观察者**：一个变，多个自动知道。
- **责任链**：请求接力传，谁处理谁截断。
- **命令**：把"请求"包成对象，可排队撤销。
- **状态**：状态变了，行为跟着变。
- **迭代器**：不暴露内部，挨个遍历。
- **中介者**：加个调度员，别互相直接叫。
- **访问者**：不动类，给类族加新操作。
- **备忘录**：存个快照，能悔棋。
- **解释器**：定义小文法，现场解释执行。

## 七、模式速查大表

| 模式 | 分类 | 一句话意图 | 关键词 | 常见度 | 面试频率 |
| --- | --- | --- | --- | --- | --- |
| 单例 | 创建型 | 全局唯一实例 | 唯一、懒加载 | 高频 | 极高 |
| 工厂方法 | 创建型 | 子类决定创建对象 | 多态创建 | 高频 | 高 |
| 抽象工厂 | 创建型 | 创建一族对象 | 产品族 | 中频 | 中 |
| 建造者 | 创建型 | 分步构造复杂对象 | 链式、Builder | 中频 | 中 |
| 原型 | 创建型 | 拷贝自身 | clone | 低频 | 低 |
| 适配器 | 结构型 | 接口转接 | 转接头 | 高频 | 高 |
| 装饰器 | 结构型 | 动态叠加职责 | 套娃 | 高频 | 高 |
| 代理 | 结构型 | 控制访问 | 替身 | 高频 | 高 |
| 桥接 | 结构型 | 抽象实现分离 | 两条轴 | 中频 | 中 |
| 组合 | 结构型 | 树形统一处理 | 部分-整体 | 中频 | 中 |
| 外观 | 结构型 | 统一入口 | 门面 | 中频 | 中 |
| 享元 | 结构型 | 共享细粒度 | 池化 | 低频 | 低 |
| 策略 | 行为型 | 算法可替换 | 消灭 if-else | 高频 | 极高 |
| 模板方法 | 行为型 | 骨架 + 钩子 | final 流程 | 高频 | 高 |
| 观察者 | 行为型 | 一对多通知 | 监听 | 高频 | 高 |
| 责任链 | 行为型 | 链式传递 | 接力 | 中频 | 中 |
| 命令 | 行为型 | 请求对象化 | 撤销 | 中频 | 中 |
| 状态 | 行为型 | 状态驱动行为 | 状态机 | 中频 | 中 |
| 迭代器 | 行为型 | 顺序遍历 | hasNext/next | 中频 | 中 |
| 中介者 | 行为型 | 集中调度 | 调度员 | 低频 | 低 |
| 访问者 | 行为型 | 加操作不改类 | 双分派 | 低频 | 低 |
| 备忘录 | 行为型 | 保存恢复 | 快照 | 低频 | 低 |
| 解释器 | 行为型 | 解释文法 | 语法树 | 低频 | 低 |

## 八、优缺点

| 优点 | 缺点 |
| --- | --- |
| 沉淀最佳实践，提升代码可读性与可维护性 | 过度使用会引入额外抽象层，增加复杂度 |
| 解耦，需求变更时改动范围小 | 学习成本高，新人需要时间理解套路 |
| 模式是通用语言，便于团队沟通 | 错误套用反而制造"为模式而模式"的代码 |
| 大量出现在框架源码中，读懂源码的钥匙 | 部分模式（如访问者）实现较绕，易写错 |
| 复用经过验证的方案，降低设计风险 | 性能敏感场景，多层包装（装饰/代理）有开销 |

## 九、适用场景

- **创建型**：对象创建逻辑复杂、需要控制实例数量或需要解耦 `new` 时（配置中心用单例、多数据库用工厂）。
- **结构型**：需要给对象动态加能力（装饰器）、接口不兼容要对齐（适配器）、要隐藏复杂子系统（外观）时。
- **行为型**：算法需要运行时切换（策略）、多个模块要响应同一事件（观察者）、请求需多级过滤（责任链）时。
- **什么时候不要用**：一次性代码、无变化点、团队不熟、性能极致敏感处，优先 KISS。

## 十、在 JDK / 开源框架中的应用

- **JDK**：`java.lang.Runtime`（单例）、`java.util.Iterator`（迭代器）、`java.util.EventListener`（观察者）、`java.io.InputStream` 的 `BufferedInputStream`（装饰器）、`java.util.Arrays.asList()`（工厂）、`Proxy` + `InvocationHandler`（代理）。
- **Spring**：见上文第 9 题与 Spring 专栏；`BeanFactory`（工厂）、`JdkDynamicAopProxy`（代理）、`ApplicationListener`（观察者）。
- **MyBatis**：`SqlSessionFactory`（工厂）、`MapperProxy`（代理）、`BaseExecutor`（模板方法）、`InterceptorChain`（责任链）、`MixedSqlNode`（组合）。

## 十一、与相近模式的区别

| 易混对 | 核心区别 |
| --- | --- |
| 策略 vs 状态 | 策略是客户端主动选算法，状态是对象自己随状态切换行为 |
| 装饰器 vs 代理 | 装饰器加功能、可多层嵌套；代理控访问、客户端通常无感知 |
| 适配器 vs 桥接 | 适配器是事后补救接口不匹配；桥接是事前拆两轴各自演化 |
| 工厂方法 vs 抽象工厂 | 前者产单个产品，后者产一族配套产品 |
| 观察者 vs 发布订阅 | 前者 Subject 直持 Observer、同步；后者有 Broker 解耦、常异步 |

## 本篇小结

- **单例的 `volatile`** 是为了禁止对象创建指令重排序，防止拿到半初始化实例。
- **静态内部类单例**兼具懒加载与线程安全，是优选写法。
- **枚举单例**可一次性防住反射与序列化破坏。
- **工厂方法产单个、抽象工厂产一族**，简单工厂不是 GoF 模式。
- **策略消灭 if-else、状态管自身流转**，二者结构像但意图不同。
- **装饰器加功能、代理控访问、适配器做转接**，三者都"包一层"但目的各异。
- **Spring 是模式的博物馆**：工厂/单例/模板/策略/适配器/观察者/代理/责任链俱全。
- **JDK 动态代理要接口、CGLIB 靠继承**，Spring AOP 按有无接口自动选。
- **观察者 vs 发布订阅**：中间多一个 Broker 即解耦升级版。
- **模板方法用 `final` 锁骨架**，子类只能填空。
- **接口隔离管接口、单一职责管类**，目标都是高内聚。
- **没有变化点就别用模式**，KISS 优先于花哨套路。

## 参考链接

- [Refactoring Guru · 设计模式中文目录](https://refactoringguru.cn/design-patterns)
- [Baeldung · Java 设计模式](https://www.baeldung.com/design-patterns)
- [GitHub · iluwatar/java-design-patterns](https://github.com/iluwatar/java-design-patterns)
- [Wikipedia · Design Patterns](https://en.wikipedia.org/wiki/Design_Patterns)
- [SourceMaking · Design Patterns](https://sourcemaking.com/design_patterns)
- [菜鸟教程 · 设计模式面试](https://www.runoob.com/design-pattern/design-pattern-tutorial.html)

下一篇 → [01 设计模式概述与学习指南](/java/design-pattern/overview)
