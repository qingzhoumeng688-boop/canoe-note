# 03 Bean 生命周期

当我们写下 `@Component` 把一个类交给 Spring，容器并不是简单地 `new` 一下就完事。从"实例化"到"销毁"，Spring 给 Bean 安排了一整套精心编排的流程。本文用一张完整流程图 + 可运行代码，把生命周期的每一个节点讲清楚。

## 一、生命周期总览

一个 Bean 从生到死，要经过以下关键节点：

```text
实例化(new) → 属性填充(依赖注入) → Aware 回调 → BeanPostProcessor 前置
   → 初始化(@PostConstruct → InitializingBean → init-method)
   → BeanPostProcessor 后置(此处生成 AOP 代理)
   → 【使用中】
   → 销毁(@PreDestroy → DisposableBean → destroy-method)
```

```text
                  ┌─────────────── 出生 ───────────────┐
实例化          属性填充        Aware        BPP 前置      初始化         BPP 后置
 new 对象  ──▶  注入依赖  ──▶  回调接口  ──▶  before  ──▶  @PostConstruct
                                                                  │
                                                          InitializingBean
                                                                  │
                                                              init-method
                                                                  │
                                                          BPP 后置(after)
                                                                  │
                                                          ★ AOP 代理在此生成
                  └─────────────── 使用中 ──────────────┘
销毁：@PreDestroy → DisposableBean → destroy-method（容器关闭时）
```

**最关键的认知**：**AOP 的动态代理是在 `BeanPostProcessor` 后置阶段才生成的**。所以你 `@Autowired` 拿到的，其实常常是一个"代理对象"而非原始对象——这一点在 04 AOP 篇的"代理的坑"里会让你少踩很多雷。

## 二、实例化

实例化就是"把对象 `new` 出来"，此时对象有了，但字段还是空的（依赖尚未注入）。

Spring 支持多种实例化方式：

- **构造器**（最常见）：选一个构造方法（无参或 `@Autowired` 构造器）直接 `new`。
- **工厂方法**：通过 `@Bean` 方法或静态工厂返回实例。
- **`Supplier`**：Spring 5 起支持传入一个 `Supplier` 自定义创建逻辑。

```java
package com.canoe.spring.bean;

import org.springframework.stereotype.Component;

@Component
public class OrderService {

    // 实例化阶段：Spring 调用这个构造器 new 出对象，此时 orderDao 还是 null
    public OrderService() {
        System.out.println("[实例化] OrderService 对象被 new 出来，字段还是空的");
    }
}
```

注意：**实例化 ≠ 可用**。只有走完后面所有步骤，Bean 才是"成品"。

## 三、属性填充

这一步发生**依赖注入**——Spring 把容器里其他 Bean 塞进当前对象的字段 / 构造器 / setter。

```java
package com.canoe.spring.bean;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class OrderService {

    // 属性填充阶段：Spring 把 OrderDao 的实例注入到这里
    @Autowired
    private OrderDao orderDao;

    public OrderService() {
        System.out.println("[实例化] 构造完成");
    }

    // 用于观察：此时若构造器里就用 orderDao 会得到 null
    public void show() {
        System.out.println("[使用中] orderDao = " + orderDao);
    }
}
```

**这里正是循环依赖的产生位置**：填充 A 需要 B，填充 B 又需要 A，于是引出 02 篇讲过的三级缓存机制。

## 四、Aware 接口族

属性填充后，Spring 会回调一系列 `Aware` 接口，把容器底层对象"告诉"Bean：

- `BeanNameAware`：拿到 Bean 的名字。
- `BeanFactoryAware`：拿到 `BeanFactory`。
- `ApplicationContextAware`：拿到 `ApplicationContext`。

```java
package com.canoe.spring.bean;

import org.springframework.beans.factory.BeanNameAware;
import org.springframework.stereotype.Component;

@Component
public class NameAwareBean implements BeanNameAware {

    @Override
    public void setBeanName(String name) {
        System.out.println("[Aware] 我的 Bean 名字是：" + name);
    }
}
```

**注意**：实现 `Aware` 会让你的业务类**与 Spring API 耦合**，一般只在写框架/工具类时才用，普通业务代码应尽量避免，依赖注入足以满足绝大多数需求。

## 五、BeanPostProcessor

这是**本篇最重要的扩展点**。它有两个回调：

- `postProcessBeforeInitialization`：初始化**前**调用。
- `postProcessAfterInitialization`：初始化**后**调用——**AOP 的动态代理就是在这里生成的**。

只要容器里注册了 `BeanPostProcessor`，每个 Bean 初始化前后都会被它"过一道手"。下面写一个自定义处理器，给所有 Bean 打标签：

```java
package com.canoe.spring.bean;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.stereotype.Component;

@Component
public class LogBeanPostProcessor implements BeanPostProcessor {

    // 初始化前：可以给 Bean 做预处理、属性修正
    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName)
            throws BeansException {
        // System.out.println("[BPP-前] " + beanName);
        return bean;
    }

    // 初始化后：经典的"返回代理对象"时机，AOP 就在这里把原始对象换成代理
    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName)
            throws BeansException {
        // System.out.println("[BPP-后] " + beanName + " 已就绪（AOP 代理可能在此生成）");
        return bean; // 真实场景里 AOP 会在这里返回代理对象而非 bean 本身
    }
}
```

**一句话**：`BeanPostProcessor` 是 Spring 几乎所有"黑魔法"（AOP、事务、`@Async`、校验）的共同入口。理解了它，你就理解了 Spring 为什么能"无侵入"地增强你的代码。

## 六、初始化

初始化是"Bean 彻底准备好之前做最后配置"的环节，有三种方式，**执行顺序固定为**：

1. **`@PostConstruct` 注解方法**（JSR 标准，最推荐）
2. **`InitializingBean.afterPropertiesSet()`**（Spring 接口）
3. **`init-method` / `@Bean(initMethod=...)`**（XML 或注解指定）

```java
package com.canoe.spring.bean;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;
import jakarta.annotation.PostConstruct;

@Component
public class InitDemoBean implements InitializingBean {

    @PostConstruct
    public void initByAnnotation() {
        System.out.println("[初始化] 1. @PostConstruct 执行");
    }

    @Override
    public void afterPropertiesSet() {
        System.out.println("[初始化] 2. InitializingBean.afterPropertiesSet 执行");
    }

    // 若同时在 @Bean 上配了 initMethod，它会在第 3 步执行
    public void customInit() {
        System.out.println("[初始化] 3. init-method 执行");
    }
}
```

**选择建议**：优先用 `@PostConstruct`（与 Spring 解耦、是通用规范）；`init-method` 适合给第三方类补初始化；`InitializingBean` 与 Spring 耦合，非必要不用。

## 七、销毁

容器关闭时，单例 Bean 会按以下顺序销毁（**与初始化顺序相反**）：

1. **`@PreDestroy` 注解方法**
2. **`DisposableBean.destroy()`**
3. **`destroy-method` / `@Bean(destroyMethod=...)`**

```java
package com.canoe.spring.bean;

import org.springframework.stereotype.Component;
import jakarta.annotation.PreDestroy;

@Component
public class DestroyDemoBean {

    @PreDestroy
    public void cleanup() {
        System.out.println("[销毁] @PreDestroy 释放资源");
    }
}
```

**两个重点**：

- 销毁只在**容器正常关闭**时触发，需要调用 `context.close()` 或注册 `context.registerShutdownHook()`（Spring Boot 已自动注册）。
- **`prototype` 作用域的 Bean，容器不负责销毁**——它把对象交给你后就"撒手不管"了，销毁逻辑得你自己处理（或用别的机制）。

## 八、完整验证代码

光看顺序不过瘾，下面写一个 Bean，**实现所有回调并打印**，跑一遍看真实顺序。

```java
package com.canoe.spring.bean;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.BeanNameAware;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

// 1) 业务 Bean：实现全部生命周期接口
@Component
public class LifeCycleBean implements BeanNameAware, InitializingBean, DisposableBean {

    public LifeCycleBean() {
        System.out.println("1. 实例化：构造器被调用");
    }

    @Override
    public void setBeanName(String name) {
        System.out.println("3. Aware：BeanName = " + name);
    }

    @PostConstruct
    public void postConstruct() {
        System.out.println("5. 初始化：@PostConstruct");
    }

    @Override
    public void afterPropertiesSet() {
        System.out.println("6. 初始化：InitializingBean.afterPropertiesSet");
    }

    @PreDestroy
    public void preDestroy() {
        System.out.println("8. 销毁：@PreDestroy");
    }

    @Override
    public void destroy() {
        System.out.println("9. 销毁：DisposableBean.destroy");
    }
}

// 2) 自定义 BeanPostProcessor：打印前置/后置
@Component
class TraceBeanPostProcessor implements BeanPostProcessor {
    @Override
    public Object postProcessBeforeInitialization(Object bean, String name) {
        if (bean instanceof LifeCycleBean) {
            System.out.println("4. BPP-前置：" + name);
        }
        return bean;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String name) {
        if (bean instanceof LifeCycleBean) {
            System.out.println("7. BPP-后置：" + name + "（AOP 代理在此生成）");
        }
        return bean;
    }
}

// 3) 配置类 + 启动类
@Configuration
@ComponentScan("com.canoe.spring.bean")
class LifeCycleConfig {
}

class LifeCycleDemo {
    public static void main(String[] args) {
        AnnotationConfigApplicationContext context =
                new AnnotationConfigApplicationContext(LifeCycleConfig.class);
        System.out.println("--- 容器启动完成，Bean 进入使用中 ---");
        context.close(); // 触发销毁
    }
}
```

运行 `LifeCycleDemo.main`，控制台会依次打印：

```text
1. 实例化：构造器被调用
3. Aware：BeanName = lifeCycleBean
4. BPP-前置：lifeCycleBean
5. 初始化：@PostConstruct
6. 初始化：InitializingBean.afterPropertiesSet
7. BPP-后置：lifeCycleBean（AOP 代理在此生成）
--- 容器启动完成，Bean 进入使用中 ---
8. 销毁：@PreDestroy
9. 销毁：DisposableBean.destroy
```

（注：属性填充第 2 步发生在构造器之后、Aware 之前，因无注入字段此处未单独打印。）

## 九、Spring Boot 中的生命周期

在 Spring Boot 里，除了上面的 Bean 级生命周期，还有**应用启动级**的钩子：

- **`ApplicationRunner` / `CommandLineRunner`**：容器完全刷新后执行，适合做启动初始化（如预热缓存、打印启动信息）。区别在于参数类型（`ApplicationArguments` vs `String[]`）。
- **启动事件**：`ApplicationStartingEvent` → `ApplicationPreparedEvent` → `ApplicationStartedEvent` → `ApplicationReadyEvent`，可以在不同阶段监听。

```java
package com.canoe.spring.bean;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class StartupRunner implements ApplicationRunner {

    // 容器就绪后执行一次，比 @PostConstruct 更靠后（所有 Bean 都初始化完了）
    @Override
    public void run(ApplicationArguments args) {
        System.out.println("应用启动完成，参数：" + args.getOptionNames());
    }
}
```

**时机差异**：`@PostConstruct` 是每个 Bean 自己初始化时跑；`ApplicationRunner` 是整个应用"全部就绪"后才跑，适合依赖全局状态的初始化。

## 十、常见坑

1. **`@PostConstruct` 里做耗时操作**：它会拖慢启动，甚至导致健康检查超时。重活儿放到 `ApplicationRunner` 或异步线程。
2. **在构造器里使用依赖**：构造器执行时依赖还没注入（属性填充在构造之后），此时用 `@Autowired` 字段会得到 `null`。要用依赖，请放到 `@PostConstruct` 或构造器参数里。
3. **初始化方法抛异常**：会导致容器启动直接失败（应用起不来），初始化逻辑务必做好异常兜底。
4. **prototype Bean 的销毁不生效**：以为写了 `@PreDestroy` 就会被调用，其实容器不管理它的销毁。
5. **把 `BeanPostProcessor` 写成懒加载或非单例**：它会失去"对每个 Bean 生效"的能力，通常应为单例且无依赖懒加载。

## 本篇小结

- **Bean 生命周期是一条编排好的流水线**：实例化 → 属性填充 → Aware → BPP 前置 → 初始化 → BPP 后置 → 使用 → 销毁。
- **实例化只是 `new` 出对象，字段还是空的**，真正可用要等流程走完。
- **属性填充阶段发生依赖注入**，也是循环依赖的产生位置。
- **AOP 动态代理在 `BeanPostProcessor` 后置阶段生成**，所以注入的常是代理对象。
- **`BeanPostProcessor` 是 Spring 一切增强能力的发动机**，AOP、事务都源于它。
- **初始化三种方式顺序固定**：`@PostConstruct` → `InitializingBean` → `init-method`。
- **销毁顺序相反**：`@PreDestroy` → `DisposableBean` → `destroy-method`。
- **销毁只在容器关闭时触发**，需 `close()` 或注册关闭钩子。
- **prototype Bean 容器不负责销毁**，用完即"撒手不管"。
- **`Aware` 接口会与 Spring 耦合**，普通业务应尽量避免。
- **常见坑**：构造器里用依赖会 NPE、`@PostConstruct` 耗时拖慢启动、初始化抛异常导致启动失败。

## 参考链接

- [Spring 官方文档：Bean 生命周期回调](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-factory-lifecycle)
- [Spring 官方文档：BeanPostProcessor](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-factory-extension-bpp)
- [Spring 官方文档：自定义 Bean 性质（Aware）](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-factory-nature)
- [Spring Boot 官方文档：ApplicationRunner / CommandLineRunner](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#features.spring-application.application-arguments)
- [Baeldung：Spring Bean 生命周期](https://www.baeldung.com/spring-bean-lifecycle)
- [Baeldung：Spring BeanPostProcessor](https://www.baeldung.com/spring-beanpostprocessor)
- [《Spring 实战（第 6 版）》](https://www.manning.com/books/spring-in-action-sixth-edition)

下一篇 → [04 AOP 面向切面](/java/spring/aop)
