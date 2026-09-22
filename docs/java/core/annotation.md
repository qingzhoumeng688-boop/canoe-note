# 07 注解

注解（Annotation）就是**贴在代码上的便利贴**——它本身不影响逻辑，但工具、框架、编译器读到它后会产生实际行为。从 `@Override` 到 Spring 的 `@Controller`，再到 Lombok 帮你生成代码，注解早已是 Java 生态的「隐形基础设施」。本篇讲清注解是什么、内置与元注解、如何自定义并用反射解析它，再顺带看 APT 编译期处理与 Spring 的注解世界。

## 一、注解是什么

想象你在代码上贴便利贴：「这个方法已废弃」「这个类交给 Spring 管」「这个方法要记日志」。便利贴不干活，但看到它的人（或机器）会按提示行动——这就是注解。

```java
@Override        // 便利贴：提醒编译器「我在重写父类方法」
@Deprecated      // 便利贴：提醒调用者「这个方法过时了」
public String toString() { return "..."; }
```

关键认知：

- **注解本身不改变程序逻辑**，它只是一份「元数据」。
- 真正产生行为的是**读取注解的工具**：编译器（如 `@Override`）、框架（如 Spring 的 `@Autowired`）、构建工具（如 Lombok 的 `@Data`）。
- 没有「读者」的注解，就是一张没人看的便利贴，毫无作用。

## 二、内置注解

JDK 自带几个高频注解：

- **`@Override`**：标记方法重写父类。若方法签名写错（其实没重写成功），编译器直接报错。强烈建议每次重写都加。
- **`@Deprecated`**：标记已废弃，调用处会收到编译警告，IDE 划删除线。
- **`@SuppressWarnings`**：压制编译器警告，如 `@SuppressWarnings("unchecked")`。
- **`@FunctionalInterface`**：标记「函数式接口」（只有一个抽象方法），不符合时编译报错，lambda 的前提。
- **`@SafeVarargs`**：压制「可变参数 + 泛型」的堆污染警告（JDK 7+）。

```java
package com.canoe.core.annotation;

import java.util.ArrayList;
import java.util.List;

public class BuiltinDemo {

    @Override // 编译器会校验是否真的重写了父类方法
    public String toString() {
        return "BuiltinDemo";
    }

    @Deprecated(since = "1.0", forRemoval = true)
    public void oldMethod() {
        // 老方法，新代码别调
    }

    @SafeVarargs
    public static <T> void safePrint(T... items) {
        for (T item : items) {
            System.out.println(item);
        }
    }

    @FunctionalInterface // 单抽象方法，才能用 lambda
    interface Calculator {
        int calc(int a, int b);
    }

    public static void main(String[] args) {
        List raw = new ArrayList(); // 泛型警告
        @SuppressWarnings("unchecked")
        List<String> safe = raw;    // 压制该警告
        Calculator add = (a, b) -> a + b;
        System.out.println(add.calc(1, 2));
    }
}
```

## 三、元注解

**元注解是「注解的注解」**——用来描述一个注解能用在哪、活到什么时候。重点是这五个：

- **`@Target`**：注解能贴在哪些地方（`ElementType`：TYPE 类/接口、METHOD 方法、FIELD 字段、PARAMETER 参数、CONSTRUCTOR 构造器、LOCAL_VARIABLE 局部变量等）。
- **`@Retention`**：注解保留到哪个阶段（`RetentionPolicy`：
  - `SOURCE`：仅源码期，编译后丢弃（如 `@Override`）。
  - `CLASS`：保留到 class 文件，但 JVM 运行时不加载（默认）。
  - `RUNTIME`：保留到运行期，可被反射读取。
- **`@Documented`**：是否纳入 JavaDoc。
- **`@Inherited`**：子类是否继承父类的注解。
- **`@Repeatable`**：同一个地方能否重复贴同一个注解（JDK 8+）。

**为什么框架注解基本都是 `RUNTIME`？** 因为 Spring、JUnit 这类框架是在**运行时**靠反射扫描并处理注解的，只有 `RUNTIME` 保留策略才能被 `getAnnotation` 读到。而 `@Override` 是给编译器看的，编译完就没用了，所以用 `SOURCE`。

## 四、自定义注解

完整语法 + 一个真实可用的例子。先定义一个操作日志注解 `@LogRecord`：

```java
package com.canoe.core.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

// 能贴在方法和类上
@Target({ElementType.METHOD, ElementType.TYPE})
// 保留到运行期，才能被反射读取
@Retention(RetentionPolicy.RUNTIME)
public @interface LogRecord {
    String value() default "";       // 日志内容，default 给默认值
    String operator() default "system";
    int level() default 1;            // 日志级别
}
```

**注解属性支持的类型**：基本类型、`String`、`Class`、枚举、注解，以及它们的**数组**。

使用：

```java
package com.canoe.core.annotation;

public class OrderService {

    @LogRecord(value = "创建订单", operator = "canoe", level = 2)
    public void createOrder(long orderId) {
        System.out.println("创建订单: " + orderId);
    }
}
```

注意：属性名为 `value` 且只传一个值时，可省略 `value=`，直接写 `@LogRecord("创建订单")`，这正是很多框架注解的简写来源。

## 五、注解的解析

**反射读取注解**才能让它「生效」。核心 API：`Class.getAnnotation`、`Method.getAnnotation`、`isAnnotationPresent`。

下面给出一个**最小可运行示例**：扫描方法上的 `@LogRecord`，打印日志内容并「执行」（这里只是打印，真实框架会做切面记录）。

```java
package com.canoe.core.annotation;

import java.lang.reflect.Method;

public class AnnotationParseDemo {
    public static void main(String[] args) throws Exception {
        Class<?> clazz = OrderService.class;
        for (Method method : clazz.getDeclaredMethods()) {
            // 判断方法上是否有 @LogRecord
            if (method.isAnnotationPresent(LogRecord.class)) {
                // 读取注解属性
                LogRecord log = method.getAnnotation(LogRecord.class);
                System.out.println("发现日志注解 -> 方法: " + method.getName()
                        + ", 内容: " + log.value()
                        + ", 操作人: " + log.operator()
                        + ", 级别: " + log.level());

                // 「执行」被注解标记的方法（框架通常配合 AOP 做这件事）
                method.invoke(clazz.getDeclaredConstructor().newInstance(), 1001L);
            }
        }
    }
}
```

输出示例：

```text
发现日志注解 -> 方法: createOrder, 内容: 创建订单, 操作人: canoe, 级别: 2
创建订单: 1001
```

这就是 Spring AOP 记录日志的简化版原理：**扫描注解 → 读取属性 → 在合适时机执行增强逻辑**。

## 六、注解处理器（编译期）

除了运行期反射，注解还能在**编译期**被处理，这叫 APT（Annotation Processing Tool）。

- 自定义处理器继承 `AbstractProcessor`，在 `process()` 里扫描被注解的元素，生成代码或校验。
- **Lombok 就是这么工作的**：`@Data` 在编译期生成 `getter`/`setter`/`equals`/`hashCode`，你源码里没写，class 里却有。
- **MapStruct** 同理：在编译期根据 `@Mapper` 生成类型转换的实现类，零运行时反射开销。
- 这类处理发生在 `SOURCE`/`CLASS` 保留阶段，对运行期零侵入、性能最好。

（原理理解即可，实际写 APT 不在本篇范围。）

## 七、Spring 中的常见注解

Spring 的本质就是「**注解 + 反射 + 容器**」，挑最常用的过一遍：

```text
注解                 作用
@Component           把类交给 Spring 容器管理（通用组件）
@Service             语义化的 @Component，标记业务层
@Controller          标记控制器（MVC），返回视图
@RestController      控制器 + 直接返回 JSON
@Autowired           按类型自动注入依赖
@RequestMapping      映射 HTTP 请求路径与 method
@GetMapping/@PostMapping  具体 HTTP 方法的快捷映射
@Transactional       声明式事务，方法内失败自动回滚
@Configuration       标记配置类（替代 XML）
@Bean                在配置类里声明一个 Bean
@Value               注入配置文件中的值（${key}）
```

```java
package com.canoe.core.annotation;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Service                 // ① 告诉 Spring：请把我放进容器
public class UserService {

    @Autowired           // ② 告诉 Spring：请把依赖注入进来
    private UserRepository repo;

    @Transactional       // ③ 告诉 Spring：这方法要事务，出错回滚
    public void register(String name) {
        repo.save(name);
    }
}
```

**核心认知**：这些注解自己不做事，是 Spring 在启动时**扫描 `@Component` 等注解 → 反射创建实例 → 通过 `@Autowired` 反射注入依赖 → 用 `@Transactional` 生成代理做事务**。没有反射，就没有 Spring。

## 八、注解 vs 配置文件

两种「配置方式」的取舍：

```text
维度            注解                      配置文件（XML/YAML）
侵入性         侵入代码，改了要重编译       与代码解耦，可热改
集中性         配置分散在各类，难全局看     集中一处，一览无余
灵活性         编译期固化，改需重新部署     运行期/外部可改，适合环境差异
可读/可搜      配合 IDE 跳转方便           全局搜索、集中管理方便
典型场景        Spring Bean、路由、事务     数据库连接、开关、多环境参数
```

经验法则：

- **代码结构、依赖关系、路由**这类「随代码走」的配置，用注解（开发爽、重构安全）。
- **环境相关、可能随时调、不希望动代码**的配置（如超时时间、开关、数据库连接），放配置文件或配置中心。
- 现代趋势是「注解为主 + 少量外部配置覆盖」（如 Spring Boot 的 `@Value` + `application.yml`）。

## 本篇小结

- **注解是贴在代码上的「便利贴」**，本身不改逻辑，靠读者（编译器/框架）产生行为。
- **`@Override`/`@Deprecated`/`@SuppressWarnings`/`@FunctionalInterface`/`@SafeVarargs`** 是高频内置注解。
- **元注解描述注解本身**：`@Target` 限定使用位置，`@Retention` 决定活到哪。
- **框架注解基本都是 `RUNTIME` 保留**，否则反射读不到。
- **`@Inherited` 让子类继承注解**，`@Repeatable` 支持同处重复标记。
- **自定义注解属性支持**：基本类型、`String`、`Class`、枚举、注解及其数组。
- **`value` 是默认属性名**，单值可省略 `value=` 简写。
- **反射 `getAnnotation`/`isAnnotationPresent` 是注解生效的钥匙**。
- **APT 在编译期处理注解**，Lombok、MapStruct 借此生成代码。
- **Spring = 注解 + 反射 + 容器**，`@Component`/`@Autowired`/`@Transactional` 都靠反射落地。
- **注解 vs 配置**：结构用注解、环境差异用配置文件，现代以注解为主。

## 参考链接

- [Java 官方文档：注解教程](https://docs.oracle.com/javase/tutorial/java/annotations/)
- [Java 官方文档：java.lang.annotation 包](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/annotation/package-summary.html)
- [Oracle 官方：@Repeatable](https://docs.oracle.com/javase/tutorial/java/annotations/repeating.html)
- [Baeldung：Java 注解指南](https://www.baeldung.com/java-annotations)
- [Spring 官方：Annotation-based Container Configuration](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-annotation-config)
- [Lombok 官网](https://projectlombok.org/)
- [MapStruct 官网](https://mapstruct.org/)
- [Baeldung：自定义注解处理器](https://www.baeldung.com/java-annotation-processing-builder)

下一篇 → [08 反射](/java/core/reflection)
