# 03 服务调用 OpenFeign

> 本篇导读：用 `RestTemplate` 调远程接口，要手动拼 URL、处理参数、解析响应、吞异常，十行代码干一件事。OpenFeign 让你"把远程调用写成一个本地接口方法"，底层靠动态代理生成实现类。本文从"为什么需要声明式调用"讲起，覆盖快速上手、注解写法、负载均衡、超时、日志、降级、拦截器、性能优化与常见坑。

## 一、为什么需要声明式调用

先看看 `RestTemplate` 的啰嗦写法：

```java
package com.canoe.cloud.sc.openfeign;

import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

// 手动拼 URL、处理参数、解析响应，又长又易错
public class RestTemplateOldWay {

    public static void main(String[] args) {
        RestTemplate restTemplate = new RestTemplate();
        Long id = 1L;
        // 每个调用方都要自己拼 URL、处理参数、解析响应
        String url = "http://user-service/user/" + id;
        ResponseEntity<String> resp = restTemplate.getForEntity(url, String.class);
        String result = resp.getBody();
        System.out.println("RestTemplate 拿到结果：" + result);
    }
}
```

问题：URL 硬编码、参数拼接麻烦、异常要自己处理、类型转换繁琐、难以统一加 token/日志。

**OpenFeign 的思路**：你只定义一个接口 + 注解，像调本地方法一样调远程服务，URL、参数、编解码全部由框架搞定。

## 二、Feign 是什么

OpenFeign 是 **Spring Cloud 官方维护的声明式 HTTP 客户端**。它的核心机制是 **动态代理**：你写的 `@FeignClient` 接口在运行时被 Feign 生成一个实现类，方法被调用时，代理层把注解信息翻译成一次真实的 HTTP 请求。这正是一个典型的**代理模式**应用。

```text
你调用 userClient.getUser(1)
   ↓ (Feign 动态代理拦截)
解析 @GetMapping("/user/{id}")、拼接 URL、编码参数
   ↓
发起 HTTP 请求到 user-service
   ↓
解码响应 → 返回 String
```

> Netflix Feign 是原项目，已捐赠给社区并演进为 **Spring Cloud OpenFeign**，新项目直接用后者。

## 三、快速上手

引入依赖、开启扫描、定义接口、注入调用：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
</dependency>
```

```java
package com.canoe.cloud.sc.openfeign;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication
@EnableFeignClients   // 扫描 @FeignClient 接口
public class ConsumerApplication {
    public static void main(String[] args) {
        SpringApplication.run(ConsumerApplication.class, args);
    }
}
```

```java
package com.canoe.cloud.sc.openfeign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

// name 指向注册中心里的服务名；path 统一前缀
@FeignClient(name = "user-service", path = "/user")
public interface UserClient {

    @GetMapping("/{id}")
    String getUser(@PathVariable("id") Long id);
}
```

`@FeignClient` 常用属性：

```text
属性            说明
--------------------------------------------------
name/value     目标服务名（注册中心里的名字，必填）
url            直接指定地址（不走注册中心，调试用）
path           统一路径前缀
fallback       降级实现类
configuration  自定义配置类
contextId      同一服务定义多个 Client 时用来区分
```

## 四、接口写法与 Spring MVC 注解

Feign 复用了 Spring MVC 的注解（`@RequestMapping`、`@GetMapping`、`@PathVariable`、`@RequestParam`、`@RequestBody`），上手成本极低。唯一要记住的坑：

> **`@RequestParam` 必须写 `value`**，否则编译/运行会找不到参数名。

```java
package com.canoe.cloud.sc.openfeign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;

@FeignClient(name = "user-service")
public interface OrderClient {

    @GetMapping("/order/{id}")
    String getOrder(@PathVariable("id") Long id);

    // 必须写 value，否则参数绑定失败
    @GetMapping("/order/list")
    String list(@RequestParam("status") String status);

    @PostMapping("/order/create")
    String create(@RequestBody OrderDTO dto);
}
```

## 五、负载均衡

Feign 默认集成了 **Spring Cloud LoadBalancer**，从注册中心拿到 `user-service` 的多个实例，按规则选一个发起调用——你完全不用关心背后有几台机器。

```yaml
spring:
  cloud:
    loadbalancer:
      configurations: roundRobin   # 轮询策略（默认）
```

常用策略与定制：

```text
策略                说明
--------------------------------------------------
roundRobin         轮询（默认）
random             随机
Nacos 权重         在 Nacos 控制台给实例配 weight，流量按权重分配
同集群优先         优先调用同 cluster 的实例，降低跨机房延迟
```

> 老项目用的是 **Ribbon**（Netflix），已进入维护模式，**新版默认不用**，改用 Spring Cloud LoadBalancer。若老代码里还有 Ribbon 依赖，建议迁移掉。

## 六、超时配置

超时是两个维度：**连接超时**（建连）和**读取超时**（等响应）。不配的话容易踩坑——默认值在不同版本表现不一，可能长到 60 秒，把线程池拖死。

```yaml
feign:
  client:
    config:
      default:                 # 全局默认
        connectTimeout: 3000   # 连接超时 3 秒
        readTimeout: 5000      # 读取超时 5 秒
      user-service:            # 针对某个服务的特殊配置
        connectTimeout: 1000
        readTimeout: 2000
```

> 经验：读超时 `>` 接口 P99 耗时 且 `<` 调用方线程池容忍上限。配太短会频繁失败，配太长会拖垮线程。

## 七、日志

四种级别，从简到详：

```text
NONE    不打印（默认，生产推荐）
BASIC   只打印请求方法、URL、状态码、耗时
HEADERS 在 BASIC 基础上加请求/响应头
FULL    打印请求和响应的头、体、元数据（调试用，量大别开生产）
```

开启方式有两个要点，缺一不可：

```java
package com.canoe.cloud.sc.openfeign;

import feign.Logger;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FeignConfig {
    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.FULL;
    }
}
```

```yaml
# 关键坑：必须把这个 Feign 接口的日志级别设为 DEBUG 才生效
logging:
  level:
    com.canoe.cloud.sc.openfeign.UserClient: DEBUG
```

## 八、降级与容错

两种方式：

- **`fallback`**：实现接口，返回兜底值（拿不到异常信息）。
- **`fallbackFactory`**：能拿到触发降级的异常，便于打日志/告警。

```java
package com.canoe.cloud.sc.openfeign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.cloud.openfeign.FallbackFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@FeignClient(name = "user-service", fallbackFactory = UserClientFallbackFactory.class)
public interface UserClient {

    @GetMapping("/user/{id}")
    String getUser(@PathVariable("id") Long id);
}

// 能拿到异常，推荐
@Component
class UserClientFallbackFactory implements FallbackFactory<UserClient> {
    @Override
    public UserClient create(Throwable cause) {
        return id -> {
            System.out.println("调用 user-service 失败，降级：" + cause.getMessage());
            return "默认用户"; // 兜底
        };
    }
}
```

需要开启断路器开关（以 Sentinel 为例）：

```yaml
feign:
  sentinel:
    enabled: true   # 开启 Feign 的 Sentinel 熔断降级
```

## 九、拦截器

`RequestInterceptor` 用于**统一传递 token / traceId**，这是微服务链路追踪与鉴权的关键一环——一次请求跨多个服务，必须在请求头里把 `Authorization`、`traceId` 透传下去。

```java
package com.canoe.cloud.sc.openfeign;

import feign.RequestInterceptor;
import feign.RequestTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import jakarta.servlet.http.HttpServletRequest;

@Component
public class TokenRelayInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        // 从当前请求上下文拿到 token，往下透传
        ServletRequestAttributes attrs =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attrs == null) {
            return;
        }
        HttpServletRequest request = attrs.getRequest();
        String token = request.getHeader("Authorization");
        if (token != null) {
            template.header("Authorization", token);
        }
        // 同理透传 traceId 用于链路追踪
    }
}
```

## 十、性能优化

Feign 默认用 JDK 的 `HttpURLConnection`，性能一般且不支持连接池。生产换成 **Apache HttpClient 5** 或 **OkHttp**：

```xml
<dependency>
    <groupId>io.github.openfeign</groupId>
    <artifactId>feign-httpclient</artifactId>
</dependency>
```

```yaml
feign:
  httpclient:
    enabled: true
    max-connections: 200        # 总连接数
    max-connections-per-route: 50  # 单路由连接数
```

> GZIP 压缩（见下节）配合连接池，能显著降延迟、省带宽。

## 十一、压缩

开启请求/响应 gzip 压缩：

```yaml
feign:
  compression:
    request:
      enabled: true
      mime-types: text/xml, application/json
      min-request-size: 1024   # 大于 1KB 才压缩
    response:
      enabled: true
```

**注意**：压缩要客户端和服务端都支持，且对小请求反而增加 CPU 开销，按业务体量大决定。

## 十二、常见问题

一张排错表：

```text
现象                    原因
--------------------------------------------------
404                     path 或 url 写错；@FeignClient 没配 path 但方法里漏了前缀
参数丢失                @RequestParam 没写 value；@RequestBody 漏注
超时                    没配超时或配得太大/太小；下游真慢
LoadBalancer 找不到服务  服务名大小写不一致；服务没注册上
GET 传对象失败           GET 不支持 @RequestBody，改用 @SpringQueryMap
日志不打印              没把接口日志级别设 DEBUG（常见坑）
fallback 不生效         没开 feign.circuitbreaker/sentinel.enabled
```

## 本篇小结

- **OpenFeign** 是声明式 HTTP 客户端，底层用**动态代理**把接口翻译成 HTTP 请求。
- **声明式** 让远程调用像调本地方法，告别 RestTemplate 的啰嗦拼装。
- **`@RequestParam` 必须写 value**，否则参数绑定失败。
- **默认集成 LoadBalancer**，自动从注册中心选实例做负载均衡。
- **Ribbon 已停维**，新项目用 Spring Cloud LoadBalancer。
- **超时** 要配 connectTimeout/readTimeout，别用危险默认值。
- **日志 FULL** 必须同时把接口日志级别设为 DEBUG 才生效。
- **降级** 用 fallback / fallbackFactory，需开启断路器。
- **RequestInterceptor** 统一透传 token / traceId，是链路追踪关键。
- **性能优化** 换 HttpClient5/OkHttp + 连接池。
- **GET 传对象** 用 `@SpringQueryMap`，别用 `@RequestBody`。

## 参考链接

- [Spring Cloud OpenFeign 官方文档](https://spring.io/projects/spring-cloud-openfeign)
- [OpenFeign GitHub](https://github.com/OpenFeign/feign)
- [Spring Cloud LoadBalancer 文档](https://spring.io/projects/spring-cloud-commons)
- [Feign 注解与编码器说明](https://github.com/OpenFeign/feign#features)
- [Sentinel 与 Feign 整合](https://sentinelguard.io/zh-cn/docs/openfeign-support.html)
- [Spring Cloud Alibaba Sentinel](https://spring-cloud-alibaba-group.github.io/github-pages/2022/zh-cn/spring-cloud-alibaba.html)
- [Ribbon（维护模式，参考）](https://github.com/Netflix/ribbon)
- [HttpURLConnection vs HttpClient 性能对比](https://hc.apache.org/)

下一篇 → [04 网关 Gateway](/java/cloud/springcloud/gateway)
