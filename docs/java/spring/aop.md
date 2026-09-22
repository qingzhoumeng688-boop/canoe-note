# 04 AOP 面向切面

日志、事务、权限、监控……这些逻辑几乎每个业务方法都要写，却又和"业务逻辑"本身无关。它们横穿在系统各处，被称为**横切关注点（cross-cutting concern）**。AOP 的使命，就是把这些重复代码"抽出来、织回去"。本文从概念、通知、切点表达式、代理原理，到实战与坑，一次讲透。

## 一、为什么需要 AOP

假设一个转账业务：

```java
public void transfer(String from, String to, BigDecimal money) {
    // ① 写日志
    log.info("开始转账 {}->{} {}", from, to, money);
    // ② 开事务
    startTransaction();
    // ③ 真正的业务
    accountDao.decrease(from, money);
    accountDao.increase(to, money);
    // ④ 提交事务 + 记审计
    commit();
    audit.record(...);
}
```

如果每个方法都手写 ①②③④，问题立刻暴露：**重复、散落、难维护**——哪天日志格式要改，得改一百个地方；事务逻辑想统一升级，更是噩梦。

AOP 的做法：把 ①②④ 这些"横切逻辑"写在一个**切面**里，再用规则（切点）告诉 Spring"哪些方法需要织入这些逻辑"，业务方法只留干净的 ③。

```text
没有 AOP：                   有 AOP：
业务方法 ── 内嵌日志/事务      业务方法（只管业务）
业务方法 ── 内嵌日志/事务  →   切面（日志/事务/权限）── 按规则织入
业务方法 ── 内嵌日志/事务
```

## 二、核心概念

| 概念 | 英文 | 含义 | 代码里的对应 |
| --- | --- | --- | --- |
| 切面 | Aspect | 横切逻辑的载体（类） | 一个 `@Aspect` 类 |
| 连接点 | JoinPoint | 可被织入的点（方法执行） | 每一个 Spring Bean 的方法 |
| 切点 | Pointcut | 从连接点中选出的"要对哪些方法动手" | `@Pointcut("execution(...)")` |
| 通知 | Advice | 织入的具体动作与时机 | `@Before` / `@Around` 等方法 |
| 目标对象 | Target | 被增强的原始对象 | 你的 Service |
| 代理 | Proxy | 织入后生成的对象 | 你 `@Autowired` 拿到的其实是它 |
| 织入 | Weaving | 把切面逻辑"缝"进目标的过程 | 容器启动时由 `BeanPostProcessor` 完成 |

一句话串起来：**切面**定义**通知**，通过**切点**匹配**连接点**，在**目标对象**上生成**代理**，完成**织入**。

## 三、五种通知类型

| 注解 | 时机 | 能否拿到返回值 / 异常 |
| --- | --- | --- |
| `@Before` | 目标方法执行前 | 否 |
| `@After` | 目标方法执行后（无论成败） | 否 |
| `@AfterReturning` | 正常返回后 | 能拿返回值 |
| `@AfterThrowing` | 抛异常后 | 能拿异常 |
| `@Around` | 包围目标方法（最强） | 都能，且能决定是否执行目标 |

**执行顺序**（环绕通知包在最外层，像洋葱）：

```text
@Around 开始
  └─ @Before
       └─ 目标方法执行
            ├─ 正常 → @AfterReturning
            └─ 异常 → @AfterThrowing
       └─ @After（总执行）
@Around 结束（返回）
```

```java
package com.canoe.spring.aop;

import org.aspectj.lang.annotation.After;
import org.aspectj.lang.annotation.AfterReturning;
import org.aspectj.lang.annotation.AfterThrowing;
import org.aspectj.lang.annotation.Before;
import org.aspectj.lang.annotation.Pointcut;
import org.springframework.stereotype.Component;

@Component
public class BasicAspect {

    @Pointcut("execution(* com.canoe.spring.aop.OrderService.*(..))")
    public void orderOps() {}

    @Before("orderOps()")
    public void before() {
        System.out.println("[Before] 方法执行前");
    }

    @After("orderOps()")
    public void after() {
        System.out.println("[After] 方法执行后（总执行）");
    }

    @AfterReturning("orderOps()")
    public void afterReturning() {
        System.out.println("[AfterReturning] 正常返回");
    }

    @AfterThrowing("orderOps()")
    public void afterThrowing() {
        System.out.println("[AfterThrowing] 抛异常");
    }
}
```

`@Around` 必须调用 `proceed()` 才会执行目标方法，否则目标方法被"拦掉"：

```java
package com.canoe.spring.aop;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;

@Aspect
@Component
public class AroundAspect {

    @Around("execution(* com.canoe.spring.aop.OrderService.*(..))")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        System.out.println("[Around] 前");
        Object result = pjp.proceed(); // 真正执行目标方法
        System.out.println("[Around] 后，结果=" + result);
        return result;
    }
}
```

## 四、Pointcut 表达式

`@Pointcut` / 通知注解里写的字符串就是切点表达式，最常用的是 **`execution()`**。

**完整语法**：

```text
execution(修饰符? 返回类型 包名.类名.方法名(参数) 异常?)
```

**通配符**：

- `*`：匹配任意单个名称（包、类、方法、返回类型）。
- `..`：匹配任意层级的包，或任意多个参数。
- `+`：匹配类及其子类 / 实现类。

**10 个常用示例**：

```text
1. execution(* com.canoe.service.*.*(..))         service 包下所有类的所有方法
2. execution(public * *(..))                      所有 public 方法
3. execution(* *Service.*(..))                    以 Service 结尾的类的所有方法
4. execution(* com.canoe..*(..))                  com.canoe 及其子包所有方法
5. execution(* save*(..))                         所有以 save 开头的方法
6. execution(* *(Long, ..))                       第一个参数是 Long 的方法
7. execution(Long *(..))                          返回类型是 Long 的方法
8. execution(* com.canoe.dao.UserDao+.*(..))      UserDao 及其实现类
9. execution(* *.*(..) throws Exception)          声明抛出 Exception 的方法
10. execution(* com.canoe.web..*Controller.*(..))  web 下所有 Controller 方法
```

**其他切点指示器**：

| 表达式 | 作用 |
| --- | --- |
| `@annotation(注解)` | 标注了某注解的方法（最实用的"按注解切"） |
| `within(包/类)` | 匹配某个类/包内的所有方法（粗粒度） |
| `args(类型)` | 按运行时参数类型匹配 |
| `bean(名字)` | 按 Bean 名字匹配（Spring 特有） |
| `@within(注解)` | 类上标注了某注解 |

**速查表**：要"精确到方法签名"用 `execution`；要"按自定义注解批量生效"用 `@annotation`（实战最常用，见第七节）。

## 五、两种代理方式

Spring AOP 底层靠**动态代理**实现增强，有两种：

| | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| 原理 | 实现目标**接口**，生成接口代理 | **继承**目标类，生成子类 |
| 要求 | 目标**必须实现接口** | 目标不能是 `final` 类/方法 |
| 性能 | 创建快、调用稍慢（反射） | 创建慢、调用快（字节码） |

**Spring 的选择逻辑**：

- 旧版：目标有接口 → JDK；无接口 → CGLIB。
- **Spring Boot 2.x 起，`spring.aop.proxy-target-class=true` 为默认，即优先用 CGLIB**——即使有接口也用 CGLIB，行为更一致（避免"注入接口 vs 实现类"的歧义）。

```text
目标对象
  │
  ├─ 有接口 + 旧默认  → JDK 动态代理（实现接口，代理对象 instanceof 接口）
  └─ 无接口 / Boot 默认 → CGLIB（继承目标，代理对象 instanceof 目标类本身）
```

一个最小演示（JDK 代理）：

```java
package com.canoe.spring.aop;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

// 目标接口
interface Hello {
    void say();
}

// 目标实现
class HelloImpl implements Hello {
    public void say() {
        System.out.println("Hello");
    }
}

// JDK 动态代理演示
public class JdkProxyDemo {
    public static void main(String[] args) {
        Hello target = new HelloImpl();
        Hello proxy = (Hello) Proxy.newProxyInstance(
                target.getClass().getClassLoader(),
                new Class[]{Hello.class},
                new InvocationHandler() {
                    @Override
                    public Object invoke(Object p, Method m, Object[] a) throws Throwable {
                        System.out.println("代理前");
                        Object r = m.invoke(target, a);
                        System.out.println("代理后");
                        return r;
                    }
                });
        proxy.say();
    }
}
```

CGLIB 通过 `Enhancer` 生成子类、重写方法实现增强，原理类似，只是"继承"而非"实现接口"。

## 六、代理的坑

这是 AOP 最容易翻车的地方，**逐个看反例**：

**① 同类内部调用不走代理**（最常见）。在同一个 Service 里，`this.methodB()` 调用的是原始对象，AOP 完全失效：

```java
package com.canoe.spring.aop;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

    public void placeOrder() {
        // 错误：this 是原始对象，@Transactional / 切面都不会生效！
        this.innerSave();
    }

    @Transactional
    public void innerSave() {
        // 以为有事务，其实没有
    }
}
```

**解决方案**：注入自己（或同类型 Bean）再调用，或用 `AopContext.currentProxy()`（需开启 `exposeProxy=true`）：

```java
package com.canoe.spring.aop;

import org.springframework.aop.framework.AopContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderServiceFixed {

    public void placeOrder() {
        // 方案 A：通过代理对象调用，AOP 生效
        ((OrderServiceFixed) AopContext.currentProxy()).innerSave();
    }

    @Transactional
    public void innerSave() {
        // 现在事务/切面真正生效
    }
}
```

（使用 `AopContext` 记得在 `@EnableAspectJAutoProxy(exposeProxy = true)` 开启暴露代理。）

**② `private` / `final` 方法无法被增强**：CGLIB 靠继承重写，无法重写 `private`/`final`；JDK 代理只代理接口方法。所以增强方法必须是 `public` 且非 `final`。

**③ 代理对象的类型判断**：用 `AopUtils.isAopProxy(obj)` 判断是不是代理；用 `AopProxyUtils.ultimateTargetClass(obj)` 拿到原始目标类——调试"注入的到底是什么"时特别有用。

## 七、实战：自定义注解 + AOP

最实用的 AOP 场景：用自定义注解标记"要记录日志的方法"，切面统一处理。

**① 定义注解**：

```java
package com.canoe.spring.aop;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

// 运行时保留、只能用在方法上
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface LogRecord {
    String value() default ""; // 操作描述
}
```

**② 切面**：

```java
package com.canoe.spring.aop;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import java.lang.reflect.Method;

@Aspect
@Component
public class LogRecordAspect {

    // 切点：所有标注了 @LogRecord 的方法
    @Around("@annotation(com.canoe.spring.aop.LogRecord)")
    public Object record(ProceedingJoinPoint pjp) throws Throwable {
        Method method = ((MethodSignature) pjp.getSignature()).getMethod();
        LogRecord anno = method.getAnnotation(LogRecord.class);
        String op = anno.value();

        long start = System.currentTimeMillis();
        System.out.println("【操作开始】" + op);
        try {
            Object result = pjp.proceed();
            System.out.println("【操作成功】" + op + " 耗时=" + (System.currentTimeMillis() - start) + "ms");
            return result;
        } catch (Throwable t) {
            System.out.println("【操作失败】" + op + " 异常=" + t.getMessage());
            throw t;
        }
    }
}
```

**③ 使用**：

```java
package com.canoe.spring.aop;

import org.springframework.stereotype.Service;

@Service
public class UserService {

    @LogRecord("创建用户")
    public void createUser(String name) {
        System.out.println("正在创建用户：" + name);
    }
}
```

调用 `createUser("canoe")` 会输出：`【操作开始】创建用户 → 正在创建用户：canoe → 【操作成功】创建用户 耗时=…ms`。业务方法零侵入，日志逻辑全在切面里。

## 八、实战：接口耗时与审计日志

用 `@Around` 统计接口耗时、记录入参出参，并演示**敏感字段脱敏**：

```java
package com.canoe.spring.aop;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;

@Aspect
@Component
public class ApiMonitorAspect {

    @Around("execution(* com.canoe.spring.aop..*Controller.*(..))")
    public Object monitor(ProceedingJoinPoint pjp) throws Throwable {
        String method = pjp.getSignature().toShortString();
        Object[] args = pjp.getArgs();

        // 入参脱敏：把可能是密码的字段打码（示例：简单替换 String 里的 password）
        System.out.println("【入参】" + method + " args=" + mask(args));

        long start = System.currentTimeMillis();
        Object result = pjp.proceed();
        long cost = System.currentTimeMillis() - start;

        // 出参脱敏（同理）
        System.out.println("【出参】" + method + " result=" + mask(new Object[]{result}) + " 耗时=" + cost + "ms");
        return result;
    }

    // 极其简化的脱敏：实际项目应基于字段名/注解识别敏感字段
    private String mask(Object[] args) {
        StringBuilder sb = new StringBuilder("[");
        for (Object a : args) {
            sb.append(a == null ? "null" : a).append(",");
        }
        return sb.append("]").toString().replace("password", "****");
    }
}
```

脱敏要点：**绝不在日志里明文打印密码、身份证、手机号、token**，应基于 `@Sensitive` 之类的注解或字段名规则统一处理。

## 九、Spring 的声明式事务就是 AOP

这里埋一个伏笔：**`@Transactional` 的底层，本质上就是一个 `@Around` 环绕通知**。

它做的事和手写的事务模板一模一样：

```text
@Around 目标方法：
  1. 获取连接，关闭自动提交（setAutoCommit(false)）
  2. 执行目标方法
  3. 正常 → commit；异常 → rollback
  4. 恢复连接（归还连接池）
```

所以 05 事务篇要讲的"事务失效场景"，绝大多数都能用本篇的"代理的坑"来解释——比如"同类内部调用导致 `@Transactional` 不生效"，根因就是内部 `this` 调用绕过了代理。理解 AOP，就理解了事务。

## 十、多个切面的执行顺序

当多个切面同时匹配一个方法，用 **`@Order(数字)`** 或实现 `Ordered` 接口控制顺序，**数字越小优先级越高**。

```java
package com.canoe.spring.aop;

import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

@Aspect
@Component
@Order(1) // 先执行
public class LogAspect {
    @Before("execution(* com.canoe.spring.aop.OrderService.*(..))")
    public void before() { System.out.println("日志切面 @Before"); }
}

@Aspect
@Component
@Order(2) // 后执行
public class AuthAspect {
    @Before("execution(* com.canoe.spring.aop.OrderService.*(..))")
    public void before() { System.out.println("权限切面 @Before"); }
}
```

**`@Around` 的洋葱模型**：优先级高的切面在外层，包裹优先级低的切面：

```text
Order=1 的 @Around 开始
  └─ Order=2 的 @Around 开始
       └─ 目标方法
  └─ Order=2 的 @Around 结束
Order=1 的 @Around 结束
```

即"前置通知按 Order 升序、后置/返回通知按 Order 降序"——像剥洋葱一样层层进出。

## 本篇小结

- **AOP 解决横切关注点（日志/事务/权限）重复散落**的问题，把它们抽成切面统一织入。
- **核心概念**：切面、连接点、切点、通知、目标、代理、织入，一一对应代码里的注解。
- **五种通知**中 `@Around` 最强，必须调用 `proceed()` 才执行目标，顺序是洋葱模型。
- **`execution()` 是最常用的切点表达式**，`*` `..` `+` 三个通配符要记牢；`@annotation` 最实用。
- **JDK 代理要求实现接口，CGLIB 靠继承**；Spring Boot 默认优先 CGLIB。
- **同类内部 `this` 调用不走代理**，是 AOP/事务失效的头号原因，用注入自己或 `AopContext` 解决。
- **`private` / `final` 方法无法被增强**，增强方法必须 `public` 且非 `final`。
- **自定义注解 + `@annotation` 切点**是最实用的 AOP 落地方式（日志、鉴权、限流）。
- **接口耗时/审计日志要做敏感字段脱敏**，绝不能明文打印密码等。
- **`@Transactional` 本质就是 AOP 环绕通知**，事务失效根因多在代理。
- **多切面用 `@Order` 控制顺序**，数字越小越外层，前置升序、后置降序。

## 参考链接

- [Spring 官方文档：AOP（AspectJ）](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#aop)
- [Spring 官方文档：AOP 代理机制](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#aop-proxying)
- [AspectJ 切点表达式官方文档](https://www.eclipse.org/aspectj/doc/released/adk15notebook/pointcuts.html)
- [Baeldung：Spring AOP 通知类型](https://www.baeldung.com/spring-aop-advice-tutorial)
- [Baeldung：Spring AOP Pointcut 表达式](https://www.baeldung.com/spring-aop-pointcut-tutorial)
- [Baeldung：Spring 代理机制 JDK vs CGLIB](https://www.baeldung.com/spring-aop-vs-aspectj)
- [《Spring 实战（第 6 版）》](https://www.manning.com/books/spring-in-action-sixth-edition)

下一篇 → [05 事务管理](/java/spring/tx)
