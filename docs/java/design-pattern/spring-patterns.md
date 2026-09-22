# 25 Spring 框架中的设计模式

> 很多人说"设计模式就是 Spring 源码"。这话不夸张——Spring 几乎把 GoF 模式用了个遍。本文逐个贴出**真实类名与方法**，讲清 Spring 为什么这么设计，并顺带看一眼 MyBatis 里的套路。

## 一、它是什么

本文写的"Spring 中的设计模式"，指的就是：当你读 `spring-core`、`spring-context`、`spring-webmvc`、`spring-aop` 源码时，能认出来的那些经典套路。它不是一个新概念，而是"把设计模式这把钥匙，插进 Spring 这把锁里"。

打个比方：Spring 是一座按"标准户型图"（设计模式）盖起来的大楼。你不用记每块砖，但只要认得"这是承重墙（工厂）、这是电梯（代理）、这是消防通道（观察者）"，整栋楼就一目了然。

## 二、为什么需要它（不用会怎样）

设想没有这些模式，Spring 会是什么样：

- 没有**工厂 / 单例**：每个组件都得自己 `new`，对象满天飞、无法统一管理生命周期。
- 没有**代理**：AOP 无法实现，事务、日志、鉴权全得手写进业务方法，代码脏到没法看。
- 没有**模板方法**：`refresh()` 这套容器启动流程会被复制粘贴几十遍。
- 没有**观察者**：事件机制消失，模块间只能硬调用，耦合爆炸。

正是这些模式，让 Spring 既"功能强大"又"可扩展"。下面用真实源码一一印证。

## 三、结构与角色

从"容器 → AOP → MVC"三条主线看 Spring 的模式分布：

```text
Spring 源码模式地图
 ├─ IOC 容器：工厂 / 单例 / 模板方法 / 策略 / 适配器 / 观察者 / 责任链
 ├─ AOP 模块：代理（JDK / CGLIB） / 工厂（选代理）
 └─ Web MVC：前端控制器(DispatcherServlet) / 适配器 / 策略 / 责任链
```

角色记忆法：Spring 里凡是带 `Factory`、`Proxy`、`Adapter`、`Listener`、`Template`、`Handler` 后缀的类，基本都对应一个模式。

## 四、代码实现

为了让你"亲手感受"Spring 的设计，下面用不到 60 行代码模拟一个迷你 IOC：工厂 + 单例缓存 + 观察者事件。它虽简陋，但骨架与 Spring 一致。

```java
package com.canoe.pattern.springpatterns;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// 模拟 Spring：工厂创建 Bean + 单例缓存 + 事件发布（观察者）
public class MiniBeanFactory {

    // 单例缓存：key=beanName，value=实例（对应 SingletonBeanRegistry）
    private final Map<String, Object> singletonCache = new HashMap<String, Object>();

    // 观察者：监听器集合（对应 ApplicationListener 机制）
    private final List<BeanCreatedListener> listeners = new ArrayList<BeanCreatedListener>();

    public void registerListener(BeanCreatedListener listener) {
        listeners.add(listener);
    }

    // 工厂方法：getBean 按需创建并缓存（对应 BeanFactory.getBean）
    @SuppressWarnings("unchecked")
    public <T> T getBean(String name, Class<T> type) {
        if (singletonCache.containsKey(name)) {
            return (T) singletonCache.get(name);   // 单例：第二次直接取缓存
        }
        try {
            T instance = type.getDeclaredConstructor().newInstance();  // 反射创建
            singletonCache.put(name, instance);                      // 放入单例池
            for (BeanCreatedListener l : listeners) {
                l.onBeanCreated(name);                               // 发布事件（观察者）
            }
            return instance;
        } catch (Exception e) {
            throw new RuntimeException("创建 Bean 失败：" + name, e);
        }
    }

    // 观察者接口（对应 ApplicationListener）
    public interface BeanCreatedListener {
        void onBeanCreated(String beanName);
    }

    // 演示用的业务 Bean
    public static class UserService { }

    public static void main(String[] args) {
        MiniBeanFactory factory = new MiniBeanFactory();
        factory.registerListener(name -> System.out.println("Bean 创建了：" + name));
        UserService a = factory.getBean("userService", UserService.class);
        UserService b = factory.getBean("userService", UserService.class);
        System.out.println("两次拿到的是同一个实例：" + (a == b));   // true，单例生效
    }
}
```

## 五、IOC 容器里的模式清单

下面每个都**贴真实类名**，建议在源码里全局搜索验证。

| 模式 | Spring 中的真实身影 | 为什么这么设计 |
| --- | --- | --- |
| 工厂 | `BeanFactory`、`FactoryBean`、`ApplicationContext`（`AbstractBeanFactory.getBean`） | 把对象创建集中管理，调用方只声明要什么，不关心怎么造 |
| 单例 | `SingletonBeanRegistry`、默认 `scope="singleton"` | 容器级单例，省内存、保状态一致（注意：是容器单例，不是 JVM 单例） |
| 原型 | `scope="prototype"`，每次 `getBean` 新建 | 需要"每用每新"的对象（如多实例 action） |
| 模板方法 | `AbstractApplicationContext.refresh()`（`obtainFreshBeanFactory`/`invokeBeanFactoryPostProcessors`/`finishBeanFactoryInitialization` 等均为 `final` 模板步骤） | 固定容器启动骨架，子类只填空，杜绝流程被改 |
| 策略 | `InstantiationStrategy`（`SimpleInstantiationStrategy` / `CglibSubclassingInstantiationStrategy`）、`BeanDefinition` 解析策略 | 实例化方式可替换（普通反射 or CGLIB 子类化） |
| 适配器 | `HandlerAdapter`（`RequestMappingHandlerAdapter` / `HttpRequestHandlerAdapter` / `SimpleControllerHandlerAdapter`） | 让 `DispatcherServlet` 不必认识每种 Controller，统一调 `handle()` |
| 观察者 | `ApplicationEvent` / `ApplicationListener` / `ApplicationEventPublisher` / `ApplicationEventMulticaster`（`SimpleApplicationEventMulticaster`） | 模块间解耦：发布者只发事件，监听器各自响应 |
| 责任链 | `BeanPostProcessor` 链、`HandlerInterceptor` 拦截器链 | 多个处理器依次"加工"Bean 或请求，可中断（如权限拦截） |
| 代理 | `JdkDynamicAopProxy` / `CglibAopProxy` / `ProxyFactory` | AOP 的核心：在不改业务类的前提下织入增强 |
| 组合 | `CompositeIterator`（core 包）、`CompositePropertySource` | 把多个子迭代器/属性源当成"一个"统一遍历 |
| 装饰器 | `BeanWrapper`、`HttpServletRequestWrapper` | 给对象套壳，动态加能力（如包装请求头） |
| 外观 | `JdbcTemplate`（封装 JDBC 的 connection/statement/exception 全流程） | 把繁琐易错的 JDBC 收口成一个干净入口 |

## 六、AOP 与代理

AOP 的本质就是**代理模式**。Spring 在 `DefaultAopProxyFactory.createAopProxy()` 里决定了用 JDK 动态代理还是 CGLIB，源码判断逻辑如下（精简）：

```java
// org.springframework.aop.framework.DefaultAopProxyFactory
public AopProxy createAopProxy(AdvisedSupport config) throws AopConfigException {
    if (config.isOptimize() || config.isProxyTargetClass()
            || hasNoUserSuppliedProxyInterfaces(config)) {
        Class<?> targetClass = config.getTargetClass();
        if (targetClass.isInterface() || Proxy.isProxyClass(targetClass)) {
            // 目标实现了接口（或本身就是代理类）→ 用 JDK 动态代理
            return new JdkDynamicAopProxy(config);
        }
        // 否则（无接口、或强制 proxyTargetClass）→ 用 CGLIB 生成子类
        return new ObjenesisCglibAopProxy(config);
    } else {
        // 有用户指定接口且未强制 → 默认 JDK 动态代理
        return new JdkDynamicAopProxy(config);
    }
}
```

**选型逻辑一句话**：目标类有接口用 JDK 动态代理（基于接口 + 反射），没有接口或有 `proxyTargetClass=true` 用 CGLIB（基于继承 + ASM 字节码）。CGLIB 不能代理 `final` 类和方法。这就是为什么"给类加 `@Transactional` 却没生效"常常是因为该类没实现接口且用了 final 方法。

## 七、MVC 里的模式

`spring-webmvc` 几乎是模式博览会：

- **前端控制器（Front Controller）**：`DispatcherServlet` 统一接收所有请求，再分发——这是 J2EE 核心模式之一。
- **策略模式**：`HandlerMapping`（URL 到处理器的映射策略）、`ViewResolver`（视图解析策略）都可替换。
- **适配器模式**：`HandlerAdapter` 把千奇百怪的 Controller（注解式、`HttpRequestHandler`、`Controller` 接口）统一适配成 `DispatcherServlet` 能调用的形式。
- **责任链模式**：`HandlerInterceptor` 拦截器链，preHandle → 调用 → postHandle → afterCompletion，任一拦截器返回 `false` 即中断。
- **组合 / 模板**：`ModelAndView` 与视图渲染中也常见模板方法思想。

一条请求的生命线：`DispatcherServlet` → `HandlerMapping`（策略选处理器）→ `HandlerAdapter`（适配调用）→ `HandlerInterceptor`（责任链）→ 返回 `ModelAndView` → `ViewResolver`（策略选视图）。

## 八、MyBatis 里的模式

同为 Java 顶流框架，MyBatis 的模式用法也极具代表性：

| 模式 | MyBatis 真实身影 | 说明 |
| --- | --- | --- |
| 工厂 | `SqlSessionFactory`、`SqlSessionFactoryBuilder` | 负责构建 `SqlSession`（会话工厂） |
| 代理 | `MapperProxy`（JDK 动态代理） | 你只写 `UserMapper` 接口，MyBatis 用代理在运行时生成实现，把方法调用转成 SQL |
| 模板方法 | `BaseExecutor`（`SimpleExecutor` / `ReuseExecutor` / `BatchExecutor`） | `BaseExecutor` 定 `update/query` 骨架，`doUpdate/doQuery` 留给子类 |
| 责任链 | `InterceptorChain` + `Plugin` | 插件（如分页）以责任链方式层层包装 `Executor`/`StatementHandler` |
| 组合 | `SqlNode`（`MixedSqlNode` 持有 `List<SqlNode>`） | 把 `<if>`/`<trim>`/`<foreach>` 等 SQL 片段组合成完整 SQL 树 |
| 装饰器 | `ResultSetHandler` / `CachingExecutor` | `CachingExecutor` 装饰 `BaseExecutor`，在查询前加二级缓存逻辑 |
| 建造者 | `SqlSessionFactoryBuilder`、`XMLConfigBuilder` | 一步步解析配置构建出工厂 |

## 九、优缺点

| 优点 | 缺点 |
| --- | --- |
| 高度解耦，模块间靠接口/事件通信，扩展点极多 | 大量间接层（代理/适配器/包装）让调用栈变深，调试时"跳来跳去" |
| 模式是通用词汇，源码可读性与可维护性强 | 学习曲线陡，新人不懂模式根本读不进源码 |
| 复用经过验证的结构，框架稳定可靠 | 不当扩展（乱写 `BeanPostProcessor`/拦截器）易引入隐蔽 bug |
| AOP 等能力让业务代码极干净（事务/日志无侵入） | 代理带来的反射/字节码开销，极致性能场景需权衡 |

## 十、适用场景

- **想做可插拔架构**：学 Spring 的 `BeanPostProcessor` 责任链与事件观察者，给系统留扩展钩子。
- **想无侵入加横切逻辑**：学 AOP 代理，做日志、鉴权、限流。
- **想统一入口**：学 `JdbcTemplate`/`DispatcherServlet` 门面/前端控制器思想，给杂乱子系统收口。
- **什么情况不要用**：中小项目硬上全套 Spring 模式抽象，反而过度设计；简单 CRUD 不必自己造"迷你 IOC"。

## 十一、在 JDK / 开源框架中的应用

- **JDK 里的模式**：`java.util.EventListener`（观察者）、`java.io.BufferedInputStream`（装饰器）、`java.util.Iterator`（迭代器）、`Proxy`（代理）、`Collections.unmodifiableList`（装饰/保护代理）。
- **Spring 里的模式**：见第五、六、七节，几乎是模式全集。
- **MyBatis 里的模式**：见第八节，代理 + 模板方法 + 责任链 + 组合的组合拳。

## 十二、与相近模式的区别

| 易混对 | 在 Spring 语境下的区分 |
| --- | --- |
| 工厂 vs 单例 | `BeanFactory` 是"怎么造"（工厂）；`scope=singleton` 是"造几个"（单例），二者正交 |
| 适配器 vs 策略 | `HandlerAdapter` 是让异构 Controller 适配统一调用（适配器）；`HandlerMapping` 是选映射方式（策略） |
| JDK 代理 vs CGLIB | 有接口→JDK（反射）；无接口/强制→CGLIB（继承），见第六节 |
| 观察者 vs 责任链 | 事件发布是多监听器各自响应（观察者）；`BeanPostProcessor` 是依次加工同一对象（责任链） |
| 装饰器 vs 代理 | `BeanWrapper` 动态加能力（装饰）；`JdkDynamicAopProxy` 控制访问/织入（代理） |

## 本篇小结

- **Spring 是设计模式的"活体教科书"**，工厂、单例、模板方法是 IOC 的三大支柱。
- **`BeanFactory` 是工厂**，`scope="singleton"` 对应单例，`scope="prototype"` 对应原型。
- **`AbstractApplicationContext.refresh()` 是模板方法**，用 `final` 锁死容器启动骨架。
- **`HandlerAdapter` 是适配器**，让 `DispatcherServlet` 不必认识每种 Controller。
- **`ApplicationListener` 是观察者**，实现模块间事件解耦。
- **`JdkDynamicAopProxy` / `CglibAopProxy` 是代理**，AOP 全靠它织入增强。
- **AOP 选型**：有接口用 JDK 动态代理，无接口或 `proxyTargetClass=true` 用 CGLIB。
- **`DispatcherServlet` 是前端控制器**，统一接收并分发 Web 请求。
- **`BeanPostProcessor` / `HandlerInterceptor` 是责任链**，可依次加工或中断。
- **MyBatis 的 `MapperProxy` 是代理**，`BaseExecutor` 是模板方法，`SqlNode` 是组合。
- **Spring 单例是"容器级单例"**，不等于 JVM 全局唯一，多容器会有多实例。
- **模式让 Spring 可扩展**，但深调用栈也提高了调试与学习成本。

## 参考链接

- [Spring 官方文档](https://docs.spring.io/spring-framework/reference/)
- [Spring Framework 源码（GitHub）](https://github.com/spring-projects/spring-framework)
- [Refactoring Guru · 设计模式中文目录](https://refactoringguru.cn/design-patterns)
- [Baeldung · Spring 中的设计模式](https://www.baeldung.com/spring-design-patterns)
- [GitHub · iluwatar/java-design-patterns](https://github.com/iluwatar/java-design-patterns)
- [MyBatis 官方文档](https://mybatis.org/mybatis-3/)

下一篇 → [26 设计模式面试速查](/java/design-pattern/interview)
