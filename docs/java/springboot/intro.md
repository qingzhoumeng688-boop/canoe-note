# 01 SpringBoot 入门

Spring Boot 不是用来取代 Spring 的，它给 Spring 全家桶套上了一层"自动挡"：你少写配置、少操心依赖版本、不用再单独装一个 Tomcat。本篇从 Spring 的历史痛点讲起，带你从零搭出第一个能跑的项目、看懂启动类上的注解、理解内嵌 Web 容器和可执行 jar，为后面自动配置、配置管理、Web 开发等篇章打地基。

## 一、为什么需要 Spring Boot

先讲一个真实的"远古"故事。当年用原生 Spring 写一个最简单的"查询用户"接口，你要做这么几件事：

- 写一堆 XML（或者注解）把 `DataSource`、`SqlSessionFactory`、`TransactionManager` 一个个 `bean` 配出来；
- 自己盯着 Maven 依赖树，把 Spring Core、Spring MVC、Spring JDBC 的版本对齐，差一个补丁号就可能 `NoSuchMethodError`；
- 单独下载并配置一个外置 Tomcat，把项目打成 `war` 丢进去部署；
- 启动慢、排错难，改一行配置要重启整个容器。

这些事和"业务"没有半毛钱关系，却消耗了大量精力。Spring Boot 用两板斧解决了它：

1. **自动配置（Auto-configuration）**：classpath 下有什么依赖，就自动帮你把对应的 Bean 配好。比如你引入了 `spring-boot-starter-data-redis`，一个开箱即用的 `RedisTemplate` 就直接躺在容器里了。
2. **起步依赖（Starter）**：把"做一件事需要的一组依赖"打包成一个坐标。想写 Web 就加 `spring-boot-starter-web`，它背后已经帮你拉好了 Tomcat、Spring MVC、Jackson 等一整套互相兼容的版本。

一句话总结：**Spring 让你能灵活地组装一切，Spring Boot 让你在大多数情况下不用组装就能直接跑。**

## 二、约定优于配置

"约定优于配置（Convention over Configuration）"是本篇的核心理念：框架先给你一套默认约定，默认情况下不用写任何配置就能跑起来；只有当你想偏离默认值时，才需要显式配置。

Spring Boot 给你的一组开箱约定：

- **默认包扫描**：启动类所在包及其子包下的组件会被自动扫描。`com.canoe.springboot.intro` 下的 `@Component` 都能被找到。
- **默认端口 8080**：应用启动后监听 `http://localhost:8080`。
- **默认静态资源路径**：`classpath:/static`、`classpath:/public`、`classpath:/resources`、`classpath:/META-INF/resources`。把 `logo.png` 丢进 `static` 就能直接访问 `/logo.png`。
- **默认配置文件名**：`application.yml` 或 `application.properties`，放在 `src/main/resources` 根目录即可被自动读取。

它的好处是"零配置即可运行"，代价是初学者容易不知道"为什么它啥都没配就跑起来了"。本篇后面会一层层揭开这些默认约定背后的机制。

## 三、快速上手

用 IDEA 从零搭一个最朴素的 Web 项目，步骤如下：

1. **新建项目**：`File → New → Project → Spring Initializr`，填好 Group（`com.canoe`）、Artifact（`springboot-demo`）、Java 版本。
2. **选依赖**：勾选 `Spring Web`（对应 `spring-boot-starter-web`），其余暂不选。
3. **确认项目结构**：IDEA 会生成启动类、空的 `resources` 目录和两个静态目录。
4. **写 Controller**：在根包下新建一个控制器，返回一句问候。
5. **启动**：直接运行启动类的 `main` 方法，控制台出现 Tomcat 启动日志即成功。
6. **访问验证**：浏览器打开 `http://localhost:8080/hello?name=小明`。

下面是启动类，它是整个应用的入口：

```java
package com.canoe.springboot.intro;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// @SpringBootApplication 是三个注解的合体，下一节细拆
@SpringBootApplication
public class IntroApplication {

    public static void main(String[] args) {
        // 这一行启动整个 Spring 容器并内嵌 Web 服务器
        SpringApplication.run(IntroApplication.class, args);
    }
}
```

再写一个最简单的接口：

```java
package com.canoe.springboot.intro;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

// @RestController = @Controller + @ResponseBody，返回值直接写进响应体
@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello(@RequestParam(defaultValue = "世界") String name) {
        return "你好，" + name + "！欢迎来到 Spring Boot 的世界";
    }
}
```

启动后在浏览器访问 `http://localhost:8080/hello?name=小明`，页面会显示 `你好，小明！欢迎来到 Spring Boot 的世界`。就这么几行，一个能处理 HTTP 请求的服务就跑起来了。

## 四、项目结构

用 Initializr 生成的标准 Maven 项目长这样：

```text
springboot-demo
├── pom.xml                      // Maven 依赖与插件配置
├── mvnw / mvnw.cmd              // Maven 包装脚本，无网也能用统一版本构建
└── src
    └── main
        ├── java
        │   └── com/canoe/springboot/intro
        │       ├── IntroApplication.java   // 启动类，必须放根包
        │       └── HelloController.java
        └── resources
            ├── application.yml    // 主配置文件（也可用 .properties）
            ├── static/            // 静态资源：js、css、图片
            └── templates/         // 模板文件：Thymeleaf、Freemarker 等
```

几个关键点：

- **`src/main/java`**：所有 Java 代码，启动类必须放在**根包**（如 `com.canoe.springboot.intro`）下，否则默认包扫描扫不到子包的业务类。
- **`src/main/resources`**：`application.yml` 是配置入口；`static` 放可直接访问的静态文件；`templates` 放需要渲染的模板。
- **`pom.xml`**：声明父工程 `spring-boot-starter-parent`，它统一管理依赖版本，你几乎不用写版本号。
- **`mvnw`**：Maven Wrapper，保证团队每个人都用同一版本的 Maven 构建。

## 五、@SpringBootApplication 拆解

启动类上的 `@SpringBootApplication` 看似一个注解，其实是三个注解的组合：

```java
package com.canoe.springboot.intro;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Inherited;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.AutoConfigurationPackage;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;

// 源码等价写法（精简示意，实际还带 @Inherited 等元注解）
@SpringBootConfiguration        // 本质是 @Configuration，标记这是一个配置类
@EnableAutoConfiguration        // 自动配置的"总开关"
@ComponentScan                  // 扫描当前包及其子包下的组件
public @interface SpringBootApplication {
}
```

逐个解释：

- **`@SpringBootConfiguration`**：点进去就是 `@Configuration`，表示启动类本身也是一个 Spring 配置类，里面可以用 `@Bean` 注册组件。
- **`@EnableAutoConfiguration`**：本篇最关键的开关。它借助 `AutoConfigurationImportSelector` 把 classpath 下所有符合条件的自动配置类批量导入容器（详见第 02 篇）。没有它，Spring Boot 就退化成普通的 Spring。
- **`@ComponentScan`**：默认扫描启动类所在包及其子包，把你写的 `@Controller`、`@Service`、`@Repository`、`@Component` 都扫描进容器。

记住一句话：**启动类放在根包，是为了让 `@ComponentScan` 刚好把整个项目扫进来。**

## 六、内置 Web 容器

Spring Boot 默认内嵌 **Tomcat**，所以你不需要外置服务器，直接 `java -jar` 就能跑一个 Web 服务。原理上，它用的是 `ServletWebServerApplicationContext`，在 Spring 容器刷新时顺手把 Servlet 容器启动起来，二者生命周期绑定在一起。

如果你想换成 Jetty 或 Undertow（比如 Undertow 在高并发下内存更省），只需在 `spring-boot-starter-web` 里排除 Tomcat，再引入目标容器即可：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <!-- 排除默认的 Tomcat -->
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-tomcat</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<!-- 改用 Undertow -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-undertow</artifactId>
</dependency>
```

换成 Jetty 同理，引入 `spring-boot-starter-jetty` 并排除 Tomcat。

## 七、打成 jar 直接运行

传统 Spring 项目打 `war` 包，要丢进外置 Tomcat；Spring Boot 打的是 **fat jar（胖 jar）**，里面自带容器和所有依赖，一条命令就能跑：

```bash
mvn clean package
java -jar target/springboot-demo-0.0.1-SNAPSHOT.jar
```

`spring-boot-maven-plugin` 负责把普通 jar 重新打包成可执行的胖 jar，它的内部结构是这样的：

```text
demo.jar
├── BOOT-INF
│   ├── classes/          # 你自己的 .class 和 resources
│   └── lib/              # 所有第三方依赖 jar
├── META-INF
│   └── MANIFEST.MF       # Main-Class 指向 Spring Boot 的启动器 JarLauncher
└── org/springframework/boot/loader/   # Spring Boot 的类加载器
```

`MANIFEST.MF` 里的 `Main-Class` 是 `JarLauncher`，它用自定义类加载器先加载 `BOOT-INF/lib` 下的依赖，再加载你的业务类。这就是为什么胖 jar 能"自带一切"。

和 `war` 部署的区别：jar 适合云原生、容器化、一条命令启动；war 适合必须塞进既有外置 Tomcat 的传统运维场景。新项目几乎都选 jar。

## 八、三种启动方式

1. **IDE 直接运行**：在启动类上右键 Run，最方便调试，断点随便打。
2. **Maven 插件启动**：
   ```bash
   mvn spring-boot:run
   ```
3. **可执行 jar 启动**：
   ```bash
   java -jar demo.jar
   ```

无论哪种方式，都可以通过命令行参数临时覆盖配置，例如指定环境：

```bash
java -jar demo.jar --spring.profiles.active=prod --server.port=9090
```

命令行参数优先级最高，常用于运维在不同机器上指定不同端口或环境，而无需改代码。

## 九、常用起步依赖

起步依赖是 Spring Boot 的"积木"，下面是一张速查表：

| 起步依赖 | 作用 | 典型场景 |
| --- | --- | --- |
| `spring-boot-starter-web` | Web MVC + Tomcat + Jackson | 写 HTTP 接口 |
| `spring-boot-starter-data-jpa` | JPA + Hibernate | 用 ORM 操作数据库 |
| `spring-boot-starter-data-redis` | Redis 客户端 | 缓存、分布式锁 |
| `spring-boot-starter-amqp` | RabbitMQ | 消息队列 |
| `spring-boot-starter-validation` | 参数校验 | 接口入参校验 |
| `spring-boot-starter-security` | 安全框架 | 登录鉴权 |
| `spring-boot-starter-actuator` | 监控端点 | 健康检查、指标 |
| `spring-boot-starter-test` | 测试套件 | 单元测试/集成测试 |
| `mybatis-plus-boot-starter` | MyBatis-Plus | 国内主流持久层 |

选依赖的原则是"用到什么加什么"，不要一股脑全引，否则 fat jar 会越来越大、启动越来越慢。

## 十、热部署

`spring-boot-devtools` 能在你修改代码后自动重启应用（其实是重启类加载器，速度比冷启动快很多），开发体验提升明显：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <scope>runtime</scope>
    <optional>true</optional>
</dependency>
```

它的原理是：把不变的第三方依赖用"基础类加载器"加载，你改动的代码用"重启类加载器"加载，改动时只丢弃后者、保留前者，因此重启很快。

**生产环境必须禁用**。devtools 会暴露一些仅供开发使用的端点，并带来额外开销。Spring Boot 默认在打成可执行 jar 时自动排除 devtools；若用 war 部署或特殊打包，务必手动确认生产 profile 下未启用。

## 本篇小结

- **Spring Boot 核心是自动配置与起步依赖**，让开发从"拼装"变为"开箱即用"。
- **约定优于配置**：默认端口 8080、默认包扫描、默认静态资源路径，不配也能跑。
- **启动类必须放在根包下**，否则 `@ComponentScan` 扫不到业务组件。
- **`@SpringBootApplication` 是三个注解合体**：`@SpringBootConfiguration`、`@EnableAutoConfiguration`、`@ComponentScan`。
- **默认内嵌 Tomcat**，可通过排除依赖换成 Jetty 或 Undertow。
- **可执行 fat jar 自带容器与依赖**，用 `java -jar` 即可独立运行。
- **三种启动方式**：IDE 运行、`mvn spring-boot:run`、可执行 jar。
- **命令行参数优先级最高**，常用于临时指定端口与环境。
- **起步依赖按需引入**，避免 fat jar 体积膨胀。
- **devtools 提升开发效率但生产必须禁用**，防止暴露调试端点。

## 参考链接

- [Spring Boot 官方文档（Reference Documentation）](https://docs.spring.io/spring-boot/docs/current/reference/html/)
- [Spring Boot 官方入门指南](https://spring.io/guides/gs/spring-boot/)
- [Spring Initializr 在线脚手架](https://start.spring.io/)
- [Spring Boot GitHub 仓库](https://github.com/spring-projects/spring-boot)
- [Baeldung：Spring Boot 入门](https://www.baeldung.com/spring-boot)
- [Spring Boot 可执行 jar 结构说明](https://docs.spring.io/spring-boot/docs/current/reference/html/appendix-executable-jar-format.html)

下一篇 → [02 自动配置原理](/java/springboot/autoconfig)
