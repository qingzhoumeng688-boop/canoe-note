# 03 配置文件

配置文件是 Spring Boot 应用的"旋钮面板"：端口、数据库连接、日志级别、第三方密钥都集中在 `application.yml` 里。本篇讲清两种格式的取舍、配置加载的优先级（为什么运维能在 jar 外改配置覆盖你写的代码）、多环境隔离、以及 `@Value` 与 `@ConfigurationProperties` 两种读取方式的坑与最佳实践。

## 一、两种格式

Spring Boot 同时支持 `application.properties` 和 `application.yml`，二者等价，可以二选一，甚至混用（不推荐）。YAML 用缩进表达层级，读起来更像"树"，适合配置项多的场景；properties 是扁平的 `key=value`，更直观但层级深时很啰嗦。

**注意 YAML 的两个坑**：缩进必须用空格（不能用 Tab），且**冒号后面必须有一个空格**，否则解析报错。

同一段"配置数据源"的两种写法对照：

```properties
# application.properties
spring.datasource.url=jdbc:mysql://localhost:3306/canoe
spring.datasource.username=root
spring.datasource.password=root
spring.datasource.hikari.maximum-pool-size=20
```

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/canoe
    username: root
    password: root
    hikari:
      maximum-pool-size: 20
```

层级越深，YAML 越省行、越易读；但手写时务必把缩进对齐，否则"少一个空格"就可能把配置挂错层级。

## 二、配置文件的位置与优先级

Spring Boot 会从多个位置读取配置，**越靠后的位置优先级越高**（后加载的覆盖先加载的）。完整顺序如下：

```text
高 ┌─────────────────────────────────────────┐
   │ 1. 命令行参数 (--server.port=9090)        │
   │ 2. jar 包外的 config 目录 (./config/)     │
   │ 3. jar 包外的根目录 (./)                  │
   │ 4. jar 包内 classpath:/config/            │
   │ 5. jar 包内 classpath 根目录              │
低 └─────────────────────────────────────────┘
```

举例：你把 `application.yml` 放在可执行 jar 同级的 `config/` 目录下，那么它会**覆盖** jar 内部自带的 `application.yml`。这正是运维部署的关键——**生产配置不进代码仓库**，由运维在服务器上通过外部配置文件或命令行参数注入，避免把数据库密码写死在代码里。

```bash
# 命令行参数优先级最高，临时改端口
java -jar demo.jar --server.port=9090
```

## 三、多环境配置

实际项目至少有开发、测试、生产三套配置。Spring Boot 提供三种隔离方式：

**方式一：`application-{profile}.yml` 拆分文件**（最常用）

```yaml
# application-dev.yml
server:
  port: 8080
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/canoe_dev
```

```yaml
# application-prod.yml
server:
  port: 80
spring:
  datasource:
    url: jdbc:mysql://10.0.0.5:3306/canoe
```

在主文件里激活：

```yaml
# application.yml
spring:
  profiles:
    active: dev
```

**方式二：单文件用 `---` 分隔多文档**（YAML 多文档）

```yaml
# application.yml
spring:
  profiles:
    active: dev

---
spring:
  config:
    activate:
      on-profile: dev
server:
  port: 8080

---
spring:
  config:
    activate:
      on-profile: prod
server:
  port: 80
```

**方式三：`@Profile` 注解**作用于 Bean，按环境决定是否注册（见注解篇）。

激活 profile 不限于改文件，优先级更高的是外部指定：

```bash
# 启动参数指定
java -jar demo.jar --spring.profiles.active=prod

# 环境变量指定（云原生常用）
export SPRING_PROFILES_ACTIVE=prod
```

## 四、profile 分组与激活

当环境变复杂（比如"生产"要同时包含数据库、缓存、消息三组配置），可以用 **`spring.profiles.group`**（Spring Boot 2.4+）把多个 profile 打包成一个逻辑名：

```yaml
spring:
  profiles:
    group:
      # 激活 prod 等价于同时激活 prod-db、prod-redis、prod-mq
      prod:
        - prod-db
        - prod-redis
        - prod-mq
    active: prod
```

而 **`spring.profiles.include`** 表示"在当前 profile 基础上额外包含"，常用于基础配置叠加：

```yaml
spring:
  config:
    activate:
      on-profile: prod
  profiles:
    # 进入 prod 时额外加载 prod-extras
    include: prod-extras
```

## 五、读取配置的方式

有三种常见读取方式，逐个给代码。

**1. `@Value`：取单个值，支持默认值**

```java
package com.canoe.springboot.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ValueDemoController {

    // 取配置项，冒号后是默认值；若没有 canoe.app.name 则用 "canoe"
    @Value("${canoe.app.name:canoe}")
    private String appName;

    @Value("${canoe.app.max-retry:3}")
    private int maxRetry;

    @GetMapping("/app")
    public String info() {
        return appName + "，最大重试=" + maxRetry;
    }
}
```

`@Value` 的坑：**不能直接注入到 `static` 字段**（静态字段在 Spring 注入之前就初始化了），且字段所在类必须被 Spring 管理（加了 `@Component` 等）。需要静态可用时，改用 setter 注入。

**2. `@ConfigurationProperties`：整段绑定（推荐）**

适合把 `canoe.app.*` 一大段绑成一个对象，详见第七节。

**3. `Environment` 对象：运行时动态取**

```java
package com.canoe.springboot.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class EnvController {

    @Autowired
    private Environment environment;

    @GetMapping("/env")
    public String env() {
        // 运行时按 key 取，可带默认值
        String name = environment.getProperty("canoe.app.name", "canoe");
        return name;
    }
}
```

## 六、@ConfigurationProperties 详解

`@ConfigurationProperties` 能绑定各种复杂结构，下面覆盖嵌套对象、集合、Map，以及校验与构造器绑定。

```java
package com.canoe.springboot.config;

import java.util.List;
import java.util.Map;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.ConstructorBinding;
import org.springframework.validation.annotation.Validated;

// 绑定前缀 canoe.order，并开启校验
@ConfigurationProperties(prefix = "canoe.order")
@Validated
public class OrderProperties {

    // 基础字段 + 校验
    @NotNull
    private Integer timeout;

    @NotEmpty
    private String topic;

    // 嵌套对象
    private Notify notify = new Notify();

    // List 绑定：canoe.order.channels[0]=sms
    private List<String> channels = new java.util.ArrayList<>();

    // Map 绑定：canoe.order.extra.max=100
    private Map<String, Integer> extra = new java.util.HashMap<>();

    public static class Notify {
        private String url;
        private int retry;

        public String getUrl() {
            return url;
        }

        public void setUrl(String url) {
            this.url = url;
        }

        public int getRetry() {
            return retry;
        }

        public void setRetry(int retry) {
            this.retry = retry;
        }
    }

    public Integer getTimeout() {
        return timeout;
    }

    public void setTimeout(Integer timeout) {
        this.timeout = timeout;
    }

    public String getTopic() {
        return topic;
    }

    public void setTopic(String topic) {
        this.topic = topic;
    }

    public Notify getNotify() {
        return notify;
    }

    public void setNotify(Notify notify) {
        this.notify = notify;
    }

    public List<String> getChannels() {
        return channels;
    }

    public void setChannels(List<String> channels) {
        this.channels = channels;
    }

    public Map<String, Integer> getExtra() {
        return extra;
    }

    public void setExtra(Map<String, Integer> extra) {
        this.extra = extra;
    }
}
```

**宽松绑定**：`canoe.order.timeout` 也能写成 `CANOE_ORDER_TIMEOUT`（环境变量）、`canoe.order.timeout-seconds` 对应字段 `timeoutSeconds`。

**构造器绑定**（不可变对象，Spring Boot 2.2+）：在类上加 `@ConstructorBinding`，字段用 `final`，由全参构造注入，适合追求不可变配置的场景：

```java
package com.canoe.springboot.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.ConstructorBinding;

@ConfigurationProperties(prefix = "canoe.point")
@ConstructorBinding
public class PointProperties {

    private final int x;
    private final int y;

    public PointProperties(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public int getX() {
        return x;
    }

    public int getY() {
        return y;
    }
}
```

## 七、配置加密

把数据库密码明文写在 `application.yml` 里是重大风险：代码仓库一泄露，数据库就裸奔。常见解决方案：

- **Jasypt**：对配置值做对称加密，配置里只放密文，启动时用密钥解密。
- **Spring Cloud Config + Vault / Nacos**：配置中心集中管理，敏感信息不落在文件里。

Jasypt 用法示例：

```xml
<dependency>
    <groupId>com.github.ulisesbocchio</groupId>
    <artifactId>jasypt-spring-boot-starter</artifactId>
    <version>3.0.5</version>
</dependency>
```

```yaml
# 密文用 ENC(...) 包裹，启动时用密钥解密
spring:
  datasource:
    password: ENC(X9fK2sD8aQ0zB3cV)
# 密钥通过启动参数传入，绝不写进仓库
# java -jar demo.jar --jasypt.encryptor.password=mySecretKey
```

加密命令由 Jasypt 提供的工具完成，密钥只在部署环境以环境变量或启动参数形式提供，从根源上避免明文泄露。

## 八、配置刷新

在微服务里，改个配置就重启所有实例显然不可接受。**`@RefreshScope`**（Spring Cloud 环境）让被标记的 Bean 在配置变更后重新创建，从而"热"生效：

```java
package com.canoe.springboot.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RefreshScope
@RestController
public class RefreshController {

    @Value("${canoe.feature.flag:off}")
    private String flag;

    @GetMapping("/flag")
    public String flag() {
        return flag;
    }
}
```

配合配置中心（Nacos、Spring Cloud Config），调用 `/actuator/refresh` 或监听总线事件即可把新值推送到各实例。其基本原理是：配置中心推送变更 → 触发 `Environment` 更新 → 销毁 `@RefreshScope` 标记的 Bean → 下次访问时按新配置重建。

## 九、常用内置配置速查

| 类别 | 配置项 | 说明 |
| --- | --- | --- |
| server | `server.port` | 监听端口，默认 8080 |
| server | `server.servlet.context-path` | 统一上下文路径，如 `/api` |
| server | `server.tomcat.threads.max` | Tomcat 最大工作线程数 |
| spring | `spring.mvc.throw-exception-if-no-handler-found` | 404 时抛异常（便于统一处理） |
| spring | `spring.jackson.date-format` | 全局日期格式 |
| spring | `spring.datasource.url/username/password` | 数据源连接信息 |
| spring | `spring.redis.host/port` | Redis 连接 |
| spring | `spring.rabbitmq.addresses` | RabbitMQ 地址 |
| logging | `logging.level.<包名>` | 指定包日志级别 |
| logging | `logging.file.name` | 日志输出文件 |
| logging | `logging.pattern.console` | 控制台日志格式 |
| management | `management.endpoints.web.exposure.include` | 暴露哪些 Actuator 端点 |

## 十、IDEA 的配置提示

引入 `spring-boot-configuration-processor` 后，你自定义的 `@ConfigurationProperties` 类也会在 `application.yml` 里获得自动补全和文档提示：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-configuration-processor</artifactId>
    <optional>true</optional>
</dependency>
```

编译时它会根据你的属性类和字段上的 Javadoc 生成 `META-INF/spring-configuration-metadata.json`，IDEA 据此给出智能提示。建议给字段写清晰的 Javadoc，这样队友在写配置时能看到说明。

## 本篇小结

- **YAML 与 properties 等价**，YAML 层级更清晰但冒号后必须空格、缩进用空格。
- **外部配置优先级高于内部**：命令行 > jar 外 config > jar 外根 > jar 内 config > jar 内根。
- **外部配置优先是运维部署关键**，生产配置不进代码仓库。
- **多环境用 `application-{profile}.yml` + `spring.profiles.active`** 最清晰。
- **`spring.profiles.group` 可把多组 profile 打包成一个逻辑名**便于激活。
- **`@Value` 适合取单个值但静态字段无效**，且类须被 Spring 管理。
- **`@ConfigurationProperties` 适合整段结构化绑定**，并支持校验与宽松绑定。
- **构造器绑定 `@ConstructorBinding` 适合不可变配置对象**。
- **敏感配置应加密**：Jasypt 密文 + 启动参数传密钥。
- **`@RefreshScope` 配合配置中心实现配置热刷新**，免重启生效。

## 参考链接

- [Spring Boot 外部化配置官方文档](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.external-config)
- [Spring Boot 配置格式（YAML/Properties）](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.external-config.typesafe-configuration-properties)
- [Spring Boot Profile 文档](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.profiles)
- [Jasypt Spring Boot Starter](https://github.com/ulisesbocchio/jasypt-spring-boot)
- [Spring Cloud @RefreshScope](https://docs.spring.io/spring-cloud-commons/docs/current/reference/html/#_refresh_scope)
- [Spring Boot Configuration Processor](https://docs.spring.io/spring-boot/docs/current/reference/html/appendix-configuration-metadata.html)

下一篇 → [04 Web 开发](/java/springboot/web)
