# 02 自动配置原理

引入一个 starter，什么配置都不写，一个 `RedisTemplate` 就出现在容器里了——这背后到底发生了什么？本篇把"自动配置"这件听起来很玄的事拆成可追查的代码路径：从 `@EnableAutoConfiguration` 出发，看 Spring Boot 如何读取候选配置、按条件筛选、最终注册 Bean，并手把手带你写一个属于自己的 starter。

## 一、自动配置是什么

一句话：**自动配置就是"根据 classpath 下有什么类，自动帮你把对应的 Bean 配好"**。

举个具体的例子。当你在 `pom.xml` 里加入：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

Spring Boot 在启动时会检测到 classpath 中存在 `RedisOperations` 等相关类，于是触发 `RedisAutoConfiguration`，帮你注册好一个 `RedisTemplate` 和 `StringRedisTemplate`。你无需写任何 `@Bean`，直接注入就能用：

```java
package com.canoe.springboot.autoconfig;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CacheController {

    // 没写任何配置，这个 Bean 是自动配置给的
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @GetMapping("/ping")
    public String ping() {
        redisTemplate.opsForValue().set("k", "v");
        return "ok";
    }
}
```

这就是自动配置的价值：**把"有没有某个依赖"变成"是否启用某套默认 Bean"的开关。**

## 二、@EnableAutoConfiguration

`@EnableAutoConfiguration` 是自动配置的总开关。它的核心实现是借助 `@Import(AutoConfigurationImportSelector.class)`，把一大批"候选自动配置类"导入容器。完整流程如下：

```text
@EnableAutoConfiguration
      │
      ▼
@Import(AutoConfigurationImportSelector.class)
      │
      ▼
selectImports()
      │  1. 读取所有候选自动配置类的全限定名
      ▼
SpringFactoriesLoader / AutoConfiguration.imports
      │  2. 去重 + 排除（spring.autoconfigure.exclude）
      ▼
过滤 @Conditional 条件
      │  3. 按 @ConditionalOnXxx 逐个判断是否满足
      ▼
注册满足条件的配置类 → 其中的 @Bean 进入容器
```

`AutoConfigurationImportSelector` 在 `selectImports()` 阶段做三件事：

1. **读取候选配置**：从 classpath 中收集所有自动配置类的全限定名（来源见下一节）。
2. **排除与去重**：应用 `spring.autoconfigure.exclude` 指定的排除项，并去掉重复。
3. **条件装配**：逐个用 `@Conditional` 家族注解判定是否真的需要注册（比如"类路径上有 Redis 才配"）。

只有三步全部通过，配置类里面的 `@Bean` 才会真正进入 Spring 容器。

## 三、spring.factories 与 AutoConfiguration.imports

自动配置类名单放在哪？这是 Spring Boot 2.7 前后最大的变化，写 starter 时尤其要注意：

- **Spring Boot 2.6 及之前**：名单写在 `META-INF/spring.factories`，键为 `org.springframework.boot.autoconfigure.EnableAutoConfiguration`。
  ```properties
  org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
    com.canoe.demo.MyAutoConfiguration
  ```
- **Spring Boot 2.7**：引入新机制 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`，纯换行分隔，读起来更清爽。
- **Spring Boot 3.x**：**彻底移除 `spring.factories` 的自动配置功能**，自动配置名单只能放在 `AutoConfiguration.imports` 里（`spring.factories` 仍在用，但不再用于自动配置导入）。

```text
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.canoe.demo.MyAutoConfiguration
com.canoe.demo.OtherAutoConfiguration
```

所以现在写 starter，请直接采用 `AutoConfiguration.imports` 方式，兼容性最好。

## 四、条件注解家族

自动配置之所以"聪明"，靠的是 `@Conditional` 家族按条件决定是否装配。常用成员：

| 注解 | 作用 |
| --- | --- |
| `@ConditionalOnClass` | classpath 中存在指定类时才装配 |
| `@ConditionalOnMissingBean` | 容器中**还没有**该类型 Bean 时才装配 |
| `@ConditionalOnProperty` | 指定配置项满足条件时才装配 |
| `@ConditionalOnBean` | 容器中**已有**指定 Bean 时才装配 |
| `@ConditionalOnWebApplication` | 当前是 Web 应用时才装配 |
| `@ConditionalOnExpression` | SpEL 表达式为 true 时才装配 |

其中最巧妙的是 **`@ConditionalOnMissingBean`**：它表示"用户没配，我才给默认实现；用户自己配了，我就让位"。这正实现了"用户配置优先"的设计哲学。

```java
package com.canoe.springboot.autoconfig;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class GreetingAutoConfiguration {

    // 用户没自己提供 GreetingService 时，用这个默认实现
    @Bean
    @ConditionalOnMissingBean
    public GreetingService greetingService() {
        return new DefaultGreetingService();
    }
}
```

`@ConditionalOnProperty` 也很常见，比如"开关配置":

```java
package com.canoe.springboot.autoconfig;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
// 当配置 canoe.feature.enabled=true（默认值 true）时才生效
@ConditionalOnProperty(prefix = "canoe.feature", name = "enabled", havingValue = "true", matchIfMissing = true)
public class FeatureAutoConfiguration {

    @Bean
    public FeatureService featureService() {
        return new FeatureService();
    }
}
```

## 五、自动配置的顺序

自动配置类之间有时存在依赖关系，比如 Jackson 的自动配置要在 MVC 之前生效，否则消息转换器顺序会乱。Spring Boot 提供三个注解控制顺序：

- **`@AutoConfigureBefore`**：在本配置类之前执行。
- **`@AutoConfigureAfter`**：在本配置类之后执行。
- **`@AutoConfigureOrder`**：给一个数值优先级（类似 `@Order`）。

```java
package com.canoe.springboot.autoconfig;

import org.springframework.boot.autoconfigure.AutoConfigureAfter;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;

// 确保在 WebMvc 自动配置之后再配置，便于覆盖默认消息转换器
@AutoConfigureAfter(WebMvcAutoConfiguration.class)
public class CustomWebAutoConfiguration {
}
```

排序的意义在于：让"基础组件"先就绪，"定制组件"后覆盖，避免出现"我的配置没生效"的诡异问题。

## 六、实战：读一个真实自动配置源码

以 `RedisAutoConfiguration` 为例，我们看它核心片段（精简并加注释）：

```java
package com.canoe.springboot.autoconfig;

import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;

@Configuration(proxyBeanMethods = false)
// 1. 类路径上有 RedisOperations 才启用本配置
@ConditionalOnClass(RedisTemplate.class)
// 2. 把 RedisProperties 绑定成可注入的 Bean
@EnableConfigurationProperties(RedisProperties.class)
public class RedisAutoConfiguration {

    // 3. 用户没提供 RedisTemplate 时给默认实现
    @Bean
    @ConditionalOnMissingBean(name = "redisTemplate")
    public RedisTemplate<Object, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<Object, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        return template;
    }

    // 同样，用户没提供 StringRedisTemplate 时给默认实现
    @Bean
    @ConditionalOnMissingBean
    public StringRedisTemplate stringRedisTemplate(RedisConnectionFactory connectionFactory) {
        StringRedisTemplate template = new StringRedisTemplate();
        template.setConnectionFactory(connectionFactory);
        return template;
    }
}
```

逐行看三个关键点：

1. **`@ConditionalOnClass(RedisTemplate.class)`**：你没引 redis 依赖时，这个配置压根不会加载，避免 `ClassNotFound`。
2. **`@EnableConfigurationProperties(RedisProperties.class)`**：把 `spring.redis.*` 配置绑定到 `RedisProperties`，供这里使用。
3. **`@ConditionalOnMissingBean`**：用户若在配置类里自己声明了 `RedisTemplate`，这里的默认版本就自动让位——这就是"可覆盖"的来源。

## 七、@ConfigurationProperties

自动配置大量使用 `@ConfigurationProperties` 做**配置绑定**：把配置文件里的一段前缀属性，整体映射成一个 Java 对象。

```java
package com.canoe.springboot.autoconfig;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

// 绑定前缀 canoe.mail，支持嵌套、集合、Map
@Configuration
@EnableConfigurationProperties(MailProperties.class)
public class MailAutoConfiguration {
}

@ConfigurationProperties(prefix = "canoe.mail")
public class MailProperties {

    // 基础字段
    private String host = "smtp.canoe.com";
    private int port = 25;

    // 嵌套对象
    private Credentials credentials = new Credentials();

    // List 绑定：canoe.mail.servers[0].host=...
    private java.util.List<Server> servers = new java.util.ArrayList<>();

    // Map 绑定：canoe.mail.tags.order=xxx
    private java.util.Map<String, String> tags = new java.util.HashMap<>();

    public static class Credentials {
        private String username;
        private String password;

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }
    }

    public static class Server {
        private String host;
        private int port;

        public String getHost() {
            return host;
        }

        public void setHost(String host) {
            this.host = host;
        }

        public int getPort() {
            return port;
        }

        public void setPort(int port) {
            this.port = port;
        }
    }

    public String getHost() {
        return host;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public int getPort() {
        return port;
    }

    public void setPort(int port) {
        this.port = port;
    }

    public Credentials getCredentials() {
        return credentials;
    }

    public void setCredentials(Credentials credentials) {
        this.credentials = credentials;
    }

    public java.util.List<Server> getServers() {
        return servers;
    }

    public void setServers(java.util.List<Server> servers) {
        this.servers = servers;
    }

    public java.util.Map<String, String> getTags() {
        return tags;
    }

    public void setTags(java.util.Map<String, String> tags) {
        this.tags = tags;
    }
}
```

对应配置：

```yaml
canoe:
  mail:
    host: smtp.canoe.com
    port: 465
    credentials:
      username: admin
      password: secret
    servers:
      - host: s1.canoe.com
        port: 465
      - host: s2.canoe.com
        port: 465
    tags:
      order: order-mail
      notify: notify-mail
```

**宽松绑定（Relaxed Binding）** 是它的一大特性：属性名不区分大小写、连字符、下划线。下面的写法都能绑定到 `mail.host`：

```text
canoe.mail.host      → mail.host
canoe.mail.HOST      → mail.host
CANOE_MAIL_HOST      → mail.host（环境变量）
canoe.mail.host-name → mail.hostName
```

`@ConfigurationProperties` 与 `@Value` 的对比：**前者适合"批量、结构化"绑定一大段配置，后者适合"零散、单个"取值**。两者可共存。

## 八、自定义一个 starter

这是面试高频题。目标：封装一个"短信发送" starter，别人引入后零配置就能注入 `SmsService`。步骤：

1. **建 autoconfigure 模块**：承载自动配置代码。
2. **写 `SmsProperties`**：用 `@ConfigurationProperties` 绑定 `canoe.sms.*`。
3. **写 `SmsAutoConfiguration`**：`@ConditionalOnClass` + `@ConditionalOnMissingBean` 注册默认 `SmsService`。
4. **写 `AutoConfiguration.imports`**：登记自动配置类。
5. **建 starter 模块**：只做依赖聚合（空 jar，引 autoconfigure 模块）。
6. **使用验证**：引入 starter，直接 `@Autowired SmsService`。

核心代码：

```java
package com.canoe.springboot.autoconfig;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "canoe.sms")
public class SmsProperties {

    // 是否启用，默认 true
    private boolean enabled = true;
    // 接入商地址
    private String endpoint = "https://sms.canoe.com";
    // 密钥
    private String accessKey;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getEndpoint() {
        return endpoint;
    }

    public void setEndpoint(String endpoint) {
        this.endpoint = endpoint;
    }

    public String getAccessKey() {
        return accessKey;
    }

    public void setAccessKey(String accessKey) {
        this.accessKey = accessKey;
    }
}
```

```java
package com.canoe.springboot.autoconfig;

import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnClass(SmsService.class)
@EnableConfigurationProperties(SmsProperties.class)
public class SmsAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public SmsService smsService(SmsProperties properties) {
        return new DefaultSmsService(properties);
    }
}
```

```java
package com.canoe.springboot.autoconfig;

public class SmsService {

    private final SmsProperties properties;

    public SmsService(SmsProperties properties) {
        this.properties = properties;
    }

    public String send(String phone, String content) {
        return "向 " + phone + " 发送[" + content + "]，接入点=" + properties.getEndpoint();
    }
}

class DefaultSmsService extends SmsService {
    public DefaultSmsService(SmsProperties properties) {
        super(properties);
    }
}
```

在 `autoconfigure` 模块的 `src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 中登记：

```text
com.canoe.springboot.autoconfig.SmsAutoConfiguration
```

starter 模块的 `pom.xml` 只需依赖 autoconfigure 模块即可。使用者引入后直接注入：

```java
package com.canoe.springboot.autoconfig;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SmsController {

    @Autowired
    private SmsService smsService;

    @GetMapping("/sms")
    public String send() {
        return smsService.send("13800138000", "验证码1234");
    }
}
```

## 九、怎么知道有哪些自动配置生效了

调试自动配置有三类常用手段：

1. **`--debug` 启动**：在启动命令行加 `--debug`，控制台会打印 `CONDITIONS EVALUATION REPORT`，逐条列出每个自动配置类是"匹配（positive）"还是"未匹配（negative）"及原因。
   ```bash
   java -jar demo.jar --debug
   ```
2. **Actuator 端点**：引入 `spring-boot-starter-actuator` 并暴露 `conditions` 端点，访问 `/actuator/conditions` 查看 JSON 报告。
   ```yaml
   management:
     endpoints:
       web:
         exposure:
           include: conditions
   ```
3. **排除某个自动配置**：用 `spring.autoconfigure.exclude` 主动关掉你不想要的。
   ```yaml
   spring:
     autoconfigure:
       exclude:
         - org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
   ```

掌握这三招，再也不用"猜"为什么某个 Bean 冒出来或没冒出来。

## 本篇小结

- **自动配置本质是按 classpath 内容自动注册 Bean**，引入依赖即启用默认组件。
- **`@EnableAutoConfiguration` 通过 `AutoConfigurationImportSelector` 导入候选配置类**。
- **Spring Boot 3.x 已移除 `spring.factories` 的自动配置功能**，改用 `AutoConfiguration.imports`。
- **`@ConditionalOnMissingBean` 实现"用户配置优先"**，是默认实现可被覆盖的关键。
- **`@ConditionalOnClass` 保证缺依赖时不加载配置**，避免 `ClassNotFound`。
- **`@AutoConfigureBefore/After/Order` 控制自动配置顺序**，避免覆盖错位。
- **`@ConfigurationProperties` 适合批量结构化绑定**，比 `@Value` 更适合整段配置。
- **宽松绑定允许多种命名风格**：驼峰、连字符、下划线、环境变量全大写。
- **自定义 starter 是面试高频题**，核心在 `AutoConfiguration.imports` + 条件注解。
- **`--debug` 与 `/actuator/conditions` 可查看自动配置匹配报告**，定位装配问题。

## 参考链接

- [Spring Boot 自动配置官方文档](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.developing-auto-configuration)
- [Spring Boot @ConfigurationProperties 文档](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.external-config.typesafe-configuration-properties)
- [Creating Your Own Auto-configuration](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.developing-auto-configuration.custom-starter)
- [AutoConfiguration.imports 迁移说明](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.7-Release-Notes)
- [Baeldung：Spring Boot Auto Configuration](https://www.baeldung.com/spring-boot-auto-configuration)
- [Spring Boot Condition 注解源码](https://github.com/spring-projects/spring-boot/tree/main/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/condition)

下一篇 → [03 配置文件](/java/springboot/config)
