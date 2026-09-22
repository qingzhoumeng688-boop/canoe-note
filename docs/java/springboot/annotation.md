# 07 SpringBoot 常用注解

注解是 Spring Boot 的"语法糖核心"：一个 `@RestController` 顶替了过去一堆 XML 配置。本篇把高频注解按用途分类，逐族讲解，并点出 `@Autowired`/`@Resource` 区别、`@Async` 失效、Lombok `@Builder` 与无参构造冲突、以及 Spring 6/Boot 3 的 `javax` → `jakarta` 迁移清单。

## 一、注解分类总览

| 类别 | 代表注解 |
| --- | --- |
| 启动与配置类 | `@SpringBootApplication`、`@Configuration`、`@Bean`、`@ComponentScan`、`@Import`、`@ConfigurationProperties`、`@EnableConfigurationProperties`、`@Value` |
| 组件注册 | `@Component`、`@Service`、`@Repository`、`@Controller`、`@RestController`、`@Configuration` |
| 依赖注入 | `@Autowired`、`@Qualifier`、`@Primary`、`@Resource`、`@Inject` |
| 条件装配 | `@ConditionalOnXxx`、`@Profile` |
| Web 层 | `@RequestMapping`、`@GetMapping`、`@PostMapping`、`@PathVariable`、`@RequestParam`、`@RequestBody`、`@RequestHeader`、`@CookieValue`、`@ResponseBody`、`@RestControllerAdvice`、`@ExceptionHandler`、`@CrossOrigin` |
| 事务与切面 | `@Transactional`、`@Aspect`、`@Before`、`@After`、`@Around`、`@Pointcut`、`@Order` |
| 异步与定时 | `@EnableAsync`、`@Async`、`@EnableScheduling`、`@Scheduled` |
| 校验 | `@Valid`、`@Validated` 及 `@NotNull` 等约束注解 |
| 测试 | `@SpringBootTest`、`@MockBean`、`@Test`、`@BeforeEach`、`@Transactional` |
| 辅助（Lombok） | `@Data`、`@Getter`、`@Setter`、`@NoArgsConstructor`、`@AllArgsConstructor`、`@Builder`、`@Slf4j`、`@RequiredArgsConstructor` |

## 二、启动与配置类

- **`@SpringBootApplication`**：启动类总注解（三个注解合体，见入门篇）。
- **`@Configuration`**：声明配置类，里面用 `@Bean` 注册组件。
- **`@Bean`**：方法返回值作为一个 Bean 交给容器管理。

```java
package com.canoe.springboot.annotation;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AppConfig {

    // 方法名即 Bean 名，类型是返回值类型
    @Bean
    public SmsClient smsClient() {
        return new SmsClient("https://sms.canoe.com");
    }
}
```

- **`@ComponentScan`**：指定扫描范围（启动类上的已默认覆盖根包）。
- **`@Import`**：直接引入其他配置类或 `ImportSelector`/`ImportBeanDefinitionRegistrar`。
- **`@ConfigurationProperties` / `@EnableConfigurationProperties`**：配置绑定（见配置篇、自动配置篇）。
- **`@Value`**：取单个配置值，支持 `${key:default}` 默认值。

## 三、组件注册

`@Component` 是通用组件标记；`@Service`、`@Repository`、`@Controller` 语义化细分（本质都是 `@Component`，但分别带有服务层、持久层、控制层的"标签"含义，便于 AOP 按层切入）。

**`@Controller` 与 `@RestController` 的关系**：`@RestController` 是 `@Controller` 与 `@ResponseBody` 的组合，因此 `@RestController` 的方法返回值直接序列化成 JSON；而 `@Controller` 默认把返回值当视图名解析（配合模板引擎返回页面）。写接口用 `@RestController`，返回页面用 `@Controller`。

`@Configuration` 也可视为一种特殊组件（它标注的类本身也是 Bean，且用于声明其他 Bean）。

## 四、依赖注入

- **`@Autowired`**：Spring 自带，按**类型**注入，有多个候选时配合 `@Qualifier` 指定名字。
- **`@Primary`**：当同一类型有多个 Bean，标 `@Primary` 的优先注入。
- **`@Qualifier`**：精确按 Bean 名注入。

```java
package com.canoe.springboot.annotation;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;

interface PayChannel {
    String pay();
}

@Component("alipay")
class AlipayChannel implements PayChannel {
    public String pay() {
        return "alipay";
    }
}

@Primary        // 同类型多个时默认选它
@Component("wechat")
class WechatChannel implements PayChannel {
    public String pay() {
        return "wechat";
    }
}

@Service
class OrderService {

    // 按类型注入，因有 @Primary 会选 WechatChannel
    @Autowired
    private PayChannel defaultChannel;

    // 按名字精确注入 alipay
    @Autowired
    @Qualifier("alipay")
    private PayChannel alipayChannel;
}
```

- **`@Resource`**（JSR-250，来自 `jakarta.annotation`）：先按**名字**再按类型注入，来自 Java 标准而非 Spring。
- **`@Inject`**（JSR-330）：与 `@Autowired` 类似但无 `required` 属性。

三者区别：**`@Autowired` 按类型优先、`@Resource` 按名称优先、`@Inject` 是 JSR-330 标准实现**。推荐用构造器注入（不可变、易测试）：

```java
package com.canoe.springboot.annotation;

import org.springframework.stereotype.Service;

@Service
public class BookService {

    private final BookRepository repository;

    // 构造器注入：Spring 4.3+ 单构造器可省 @Autowired
    public BookService(BookRepository repository) {
        this.repository = repository;
    }
}
```

## 五、条件装配

`@ConditionalOnXxx` 系列（`@ConditionalOnClass`、`@ConditionalOnMissingBean` 等）是自动配置的基础，详见自动配置篇。`@Profile` 则按环境决定是否注册 Bean：

```java
package com.canoe.springboot.annotation;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
public class DataSourceConfig {

    // 仅 dev 环境注册
    @Bean
    @Profile("dev")
    public String devOnly() {
        return "dev-bean";
    }

    // 非 prod 环境注册
    @Bean
    @Profile("!prod")
    public String notProd() {
        return "non-prod-bean";
    }
}
```

## 六、Web 层

Web 篇已详细展开，这里给出速查：

- **映射**：`@RequestMapping`（通用）、`@GetMapping`、`@PostMapping`、`@PutMapping`、`@DeleteMapping`。
- **取参**：`@PathVariable`（路径变量）、`@RequestParam`（查询/表单）、`@RequestBody`（JSON 体）、`@RequestHeader`（请求头）、`@CookieValue`（Cookie）。
- **响应**：`@ResponseBody`（返回值写入响应体，`@RestController` 已隐含）。`@RestControllerAdvice` + `@ExceptionHandler` 做全局异常处理。
- **跨域**：`@CrossOrigin` 精确到方法/类。

```java
package com.canoe.springboot.annotation;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/books")
@CrossOrigin(origins = "http://localhost:3000")   // 允许前端域名跨域
public class BookApi {

    @GetMapping("/{id}")
    public String get(@PathVariable Long id,
                      @RequestHeader("Authorization") String token) {
        return "book=" + id + ", token=" + token;
    }
}
```

## 七、事务与切面

**`@Transactional`**：标注方法/类开启事务（见 MyBatis 篇失效场景）。

**AOP 注解**：`@Aspect` 声明切面，`@Pointcut` 定义切点，`@Before`/`@After`/`@Around` 定义通知，`@Order` 控制多个切面顺序。

```java
package com.canoe.springboot.annotation;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Pointcut;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

@Aspect
@Component
@Order(1)                       // 数值越小越先执行
public class LogAspect {

    // 切所有 Service 的 public 方法
    @Pointcut("execution(public * com.canoe.springboot.annotation..*Service.*(..))")
    public void servicePointcut() {
    }

    // 环绕通知：统计耗时
    @Around("servicePointcut()")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            return pjp.proceed();
        } finally {
            System.out.println(pjp.getSignature() + " 耗时 " + (System.currentTimeMillis() - start) + "ms");
        }
    }
}
```

## 八、异步与定时

**`@EnableAsync` + `@Async`**：在配置类开异步，方法标 `@Async` 即异步执行。

```java
package com.canoe.springboot.annotation;

import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
public class NotifyService {

    // 异步发送通知，调用方不阻塞
    @Async
    public void sendAsync(String message) {
        // 耗时操作
        System.out.println("发送：" + message);
    }
}
```

`@Async` **失效场景**：方法必须是 public、须通过 Spring 代理调用（同类内 `this.xxx()` 不生效）、且不要在同一个类里"直接调用"。**自定义线程池**：实现 `AsyncConfigurer` 或声明 `ThreadPoolTaskExecutor`  Bean 并用 `@Async("executorName")` 指定。

**`@EnableScheduling` + `@Scheduled`**：定时任务，`cron` 表达式控制周期：

```java
package com.canoe.springboot.annotation;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CleanJob {

    // 每天凌晨 2 点执行：秒 分 时 日 月 周
    @Scheduled(cron = "0 0 2 * * ?")
    public void clean() {
        System.out.println("执行清理");
    }
}
```

**坑**：`@Scheduled` 默认是**单线程**调度，一个任务阻塞会拖住其他任务。需配置 `ThreadPoolTaskScheduler` 开启多线程，或给慢任务单独指定线程池。

## 九、校验

`spring-boot-starter-validation` 提供约束注解。`@Valid` 与 `@Validated` 都能触发校验，区别：`@Validated` 是 Spring 的、支持**分组校验**；`@Valid` 是 JSR-303 标准、支持**嵌套级联校验**。

常用约束：

| 注解 | 含义 |
| --- | --- |
| `@NotNull` | 不能为 null |
| `@NotBlank` | 字符串非空且去空格后非空 |
| `@NotEmpty` | 集合/数组/字符串非空 |
| `@Size(min,max)` | 长度范围 |
| `@Min` / `@Max` | 数值范围 |
| `@Pattern` | 正则匹配 |
| `@Email` | 邮箱格式 |
| `@Past` / `@Future` | 日期过去/未来 |

```java
package com.canoe.springboot.annotation;

import javax.validation.Valid;
import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RegisterApi {

    @PostMapping("/register")
    public String register(@Valid @RequestBody UserForm form) {
        return "ok";
    }

    public static class UserForm {
        @NotBlank
        @Email
        private String email;

        @NotBlank
        @Size(min = 6, max = 20)
        private String password;

        public String getEmail() {
            return email;
        }

        public void setEmail(String email) {
            this.email = email;
        }

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }
    }
}
```

## 十、测试

```java
package com.canoe.springboot.annotation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
class BookServiceTest {

    @Autowired
    private BookService bookService;

    // 用 Mock 替换真实依赖
    @MockBean
    private BookRepository bookRepository;

    @BeforeEach
    void setUp() {
        // 每个测试前准备数据
    }

    @Test
    @Transactional   // 测试后自动回滚，不污染数据库
    void testSave() {
        // bookService.save(...);
    }
}
```

`@SpringBootTest` 启动完整上下文；`@MockBean` 注入模拟对象；`@Transactional` 让测试数据自动回滚。

## 十一、Lombok 常用注解

| 注解 | 作用 |
| --- | --- |
| `@Data` | 生成 getter/setter/`equals`/`hashCode`/`toString` |
| `@Getter` / `@Setter` | 仅生成读/写方法 |
| `@NoArgsConstructor` | 无参构造（MyBatis/JSON 反序列化需要） |
| `@AllArgsConstructor` | 全参构造 |
| `@Builder` | 建造者模式 |
| `@Slf4j` | 注入 `log` 静态字段 |
| `@RequiredArgsConstructor` | 为 `final` 字段生成构造（配合注入很香） |

**重要冲突**：`@Builder` 会生成一个**全参私有构造**且**不生成无参构造**；而 MyBatis、Jackson 反序列化需要无参构造。若同时用 `@Builder` 又需要无参，必须显式加 `@NoArgsConstructor` 和 `@AllArgsConstructor`，否则启动或反序列化报错：

```java
package com.canoe.springboot.annotation;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

// 三者一起用：Builder 提供链式构建，NoArgsConstructor 保证反序列化
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OrderDto {
    private Long id;
    private String title;
}
```

`@RequiredArgsConstructor` + `final` 字段是构造器注入的优雅写法：

```java
package com.canoe.springboot.annotation;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor   // 为 final 字段生成构造，等价于手写构造注入
public class BookService2 {
    private final BookRepository repository;
}
```

## 十二、Spring 6 / Boot 3 的变化

Spring Boot 3 基于 Jakarta EE 9+，**所有 `javax.*` 命名空间迁移到 `jakarta.*`**。升级时务必替换：

| 旧（javax） | 新（jakarta） |
| --- | --- |
| `javax.servlet.*` | `jakarta.servlet.*` |
| `javax.validation.*` | `jakarta.validation.*` |
| `javax.persistence.*` | `jakarta.persistence.*` |
| `javax.annotation.*` | `jakarta.annotation.*` |

升级清单建议：

1. **依赖升级**：Spring Boot 3.x、Spring 6.x，Java 17 起步。
2. **包名替换**：全局把 `javax.servlet`、`javax.validation`、`javax.persistence` 改为 `jakarta.*`（IDEA 的 Replace in Files 配合正则）。
3. **第三方库兼容**：确认 MyBatis、Hibernate、Tomcat 等都已支持 Jakarta；老版本会报 `ClassNotFoundException`。
4. **Jakarta Validation**：校验注解从 `javax.validation.constraints.*` 改为 `jakarta.validation.constraints.*`。
5. **JPA 注解**：`@Entity`、`@Table` 等迁移到 `jakarta.persistence.*`。

例如校验代码在 Boot 3 中应写为：

```java
package com.canoe.springboot.annotation;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public class ProfileForm {
    @NotBlank
    @Email
    private String email;

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
```

## 本篇小结

- **`@SpringBootApplication` 是启动核心**，组合了配置、自动配置、包扫描三注解。
- **`@RestController` = `@Controller` + `@ResponseBody`**，接口开发首选。
- **`@Autowired` 按类型、`@Resource` 按名称、`@Inject` 是 JSR-330 标准**。
- **构造器注入优于字段注入**，不可变且易测试。
- **`@ConditionalOnMissingBean` 是自动配置可覆盖的关键**，条件装配基础。
- **`@Transactional` 须 public 且经代理调用**，异常别吞以免不回滚。
- **`@Async` 同类内调用失效，默认单线程需配线程池**；`@Scheduled` 同样默认单线程。
- **`@Valid` 支持嵌套级联，`@Validated` 支持分组校验**。
- **Lombok `@Builder` 与 `@NoArgsConstructor` 需同时写**，否则反序列化缺无参构造。
- **Boot 3 全面迁移到 `jakarta.*`**，升级时替换 javax 包名。
- **`@RequiredArgsConstructor` + final 字段是优雅的构造注入写法**。

## 参考链接

- [Spring Boot 注解官方文档](https://docs.spring.io/spring-boot/docs/current/reference/html/)
- [Spring Framework 注解（Core）](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-annotation-config)
- [Spring @Transactional](https://docs.spring.io/spring-framework/docs/current/reference/html/data-access.html#transaction-declarative-annotations)
- [Spring AOP 文档](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#aop)
- [Jakarta EE 官方站点](https://jakarta.ee/)
- [Spring Boot 3.0 迁移指南](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide)
- [Project Lombok 特性说明](https://projectlombok.org/features/)

下一篇 → [返回专栏首页](/java/springboot/intro)
