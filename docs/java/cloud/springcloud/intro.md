# 01 微服务入门

> 本篇导读：微服务不是"把单体拆成很多 Jar 包"那么简单，它是一整套架构哲学，也带来了一整套新麻烦。本文从 Martin Fowler 的定义讲起，对比单体与微服务的利弊，给出拆分原则、核心组件地图、Spring Cloud 三代演进与版本对应关系，最后用一个最小可运行示例让你跑通"两个服务 + Nacos + OpenFeign"。

## 一、什么是微服务

Martin Fowler 在 2014 年的著名文章里给出了微服务的核心定义要点，逐条拆解：

- **一组小的服务**：每个服务只做一件事，代码量小、边界清晰。
- **独立进程**：每个服务跑在自己的进程里，互不干扰（崩溃互不影响）。
- **轻量通信**：服务间通过 HTTP / RPC 等轻量协议通信，而不是复杂的 ESB。
- **围绕业务能力构建**：按业务域（订单、库存、用户）拆，而不是按技术层（Controller/Service/Dao）拆。
- **独立部署**：每个服务可以单独发布，不用全量回归。
- **去中心化治理**：没有统一的技术栈强制，各团队可以选合适的语言/框架（不过现实中大多还是统一栈）。

一句话：**微服务是把"一个大程序"拆成"一堆小而自治、能独立部署的服务"的架构风格**。

## 二、单体 vs 微服务

客观对比，先把账算清楚：

```text
维度          单体                      微服务
-----------------------------------------------
开发效率      小项目快，大项目改一处怕全局   各团队并行，互不阻塞
部署          一次全量发布                各自独立发布
技术栈        统一                       可多语言（现实中多统一）
扩展性        整体扩容，浪费资源           按需对热点服务扩容
故障隔离      一处崩全盘崩                故障被隔离在单服务内
运维复杂度    低                         高（几十上百个服务要治理）
团队协作      大团队易冲突                小团队自治
```

**适用前提**：Martin Fowler 本人也强调 **"Monolith First"（单体优先）**。微服务适合**团队规模大、业务复杂、需要独立伸缩**的场景。小团队、早期产品用微服务只是自找麻烦——直到单体的开发/部署瓶颈真的出现了，再拆不迟。

## 三、微服务拆分原则

一套可落地的方法论：

- **按业务能力拆分**，而非技术分层：拆成"订单服务""库存服务"，而不是"Controller 服务""Dao 服务"。
- **单一职责**：一个服务只对一个业务负责，变更原因单一。
- **领域驱动设计（DDD）的限界上下文**：用 DDD 的"限界上下文"划服务边界，上下文之间明确契约。
- **避免分布式单体**：最怕"拆了但强耦合"——服务间疯狂互相调用、共享数据库，结果比单体还难维护。判断标准：能不能独立部署、独立上线。
- **先粗后细**：先拆大块（用户域、交易域），跑顺了再细分，不要一上来就拆 50 个服务。

常见拆分维度参考：

```text
按业务域：  用户域 / 商品域 / 交易域 / 支付域 / 营销域
按变更频率：核心交易（稳定）vs 推荐/活动（多变）分开
按数据归属：每个服务拥有自己的数据库，禁止跨库直连
```

## 四、微服务的核心组件

一张架构图，逐个点名每个组件解决什么问题：

```text
                ┌─────────────┐
   客户端 ─────► │   网关 Gateway │  路由/鉴权/限流/跨域
                └──────┬──────┘
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ 用户服务 │ │ 订单服务 │ │ 商品服务 │
    └────┬─────┘ └────┬─────┘ └────┬─────┘
         │            │            │
   ┌─────┴────────────┴────────────┴─────┐
   │ 注册中心 │ 配置中心 │ 熔断限流 │ 链路追踪 │ 监控告警 │ 分布式事务
   └────────────────────────────────────┘
```

- **注册中心**：服务地址的"通讯录"（Nacos / Eureka）。
- **配置中心**：集中管理配置并动态刷新（Nacos / Apollo）。
- **网关**：统一入口，做路由、鉴权、限流（Gateway）。
- **服务调用**：声明式远程调用（OpenFeign）。
- **负载均衡**：从多实例里选一个（Spring Cloud LoadBalancer）。
- **熔断限流**：保护系统（Sentinel / Resilience4j）。
- **链路追踪**：还原跨服务调用链（SkyWalking / Sleuth）。
- **日志 / 监控告警**：观测系统健康（Prometheus + Grafana）。
- **分布式事务**：跨服务一致性（Seata）。

## 五、Spring Cloud 生态

Spring Cloud 经历了三代演进：

```text
第一代 Netflix 系（多数已停维）：
  Eureka / Ribbon / Hystrix / Feign / Zuul   → 维护模式，不推荐新项目用

第二代 Spring Cloud Alibaba：
  Nacos(注册+配置) / Sentinel(限流熔断) / Seata(分布式事务) / RocketMQ

第三代 新一代官方：
  Spring Cloud Gateway / OpenFeign / Resilience4j / Spring Cloud LoadBalancer
```

组件对照表：

```text
能力           Netflix 旧        官方/Alibaba 新
------------------------------------------------
注册中心       Eureka            Nacos
配置中心       Config+Bus        Nacos / Apollo
网关           Zuul              Gateway
服务调用       Feign             OpenFeign
熔断           Hystrix           Sentinel / Resilience4j
负载均衡       Ribbon            Spring Cloud LoadBalancer
```

**结论**：新项目直接用第三代 + Alibaba 组合（Nacos + Gateway + OpenFeign + Sentinel + Seata），别再碰 Netflix 遗留组件。

## 六、版本对应关系

**Spring Boot 与 Spring Cloud 的版本必须匹配**，这是新手最容易踩的坑——版本不对，依赖冲突、注解不生效、启动报错满天飞。

官方提供版本对应表（务必照表选用）：

```text
Spring Cloud                Spring Boot
-----------------------------------------
2023.0.x (Leyton)          3.2.x / 3.3.x
2022.0.x (Kilburn)         3.0.x / 3.1.x
2021.0.x (Jubilee)         2.6.x / 2.7.x
2020.0.x (Ilford)          2.4.x / 2.5.x
```

同时 **Spring Cloud Alibaba** 也有自己的版本矩阵，要同时满足"Boot ↔ Cloud ↔ Alibaba"三者匹配。建议直接查官方"版本说明"页面，不要凭记忆填版本号。

## 七、一个最小微服务示例

两个服务：provider（服务提供方）和 consumer（消费方），通过 Nacos 做注册发现，OpenFeign 做调用。

**provider 端（提供接口）**：

```java
package com.canoe.cloud.sc.intro.provider;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class ProviderApplication {
    public static void main(String[] args) {
        SpringApplication.run(ProviderApplication.class, args);
    }
}

@RestController
class UserController {
    @GetMapping("/user/{id}")
    public String getUser(@PathVariable Long id) {
        return "用户-" + id;
    }
}
```

**consumer 端（OpenFeign 调用）**：

```java
package com.canoe.cloud.sc.intro.consumer;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@SpringBootApplication
@EnableFeignClients   // 开启 Feign 扫描
public class ConsumerApplication {
    public static void main(String[] args) {
        SpringApplication.run(ConsumerApplication.class, args);
    }
}

// 声明式调用：接口即远程服务
@FeignClient(name = "user-service")
interface UserClient {
    @GetMapping("/user/{id}")
    String getUser(@PathVariable("id") Long id);
}
```

本例会用到 Nacos（见下一篇），这里重点是理解"声明一个接口方法 = 一次远程调用"的范式。

## 八、微服务的挑战

客观列出微服务带来的新负担，提醒别只看到好处：

- **分布式复杂度**：网络不可靠、延迟、分区。
- **数据一致性**：每个服务独立库，跨库事务难。
- **服务治理**：注册发现、配置、版本、灰度。
- **测试困难**：要起一堆依赖服务才能测一个接口。
- **运维成本**：容器化、CI/CD、监控告警一套基建。
- **排障困难**：一个请求穿越十几个服务，必须有链路追踪。

**一句话**：微服务不是免费的午餐，它需要一整套"配套基建"才能发挥价值。没有基建就上微服务，等于没穿盔甲就上战场。

## 本篇小结

- **微服务** 是小而自治、独立部署、围绕业务能力构建的服务集合。
- **Martin Fowler 建议单体优先**，业务复杂、团队大了再拆。
- **拆分按业务域** 而非技术层，警惕"分布式单体"伪拆分。
- **核心组件** 含注册中心、配置中心、网关、调用、限流、追踪、事务。
- **Spring Cloud 三代**：Netflix 旧系已停维，新项目用 Gateway+OpenFeign+Alibaba。
- **Boot 与 Cloud 版本必须匹配**，版本不对坑最多。
- **最小示例** 用 OpenFeign 把远程调用写成接口方法。
- **DDD 限界上下文** 是划服务边界的有力工具。
- **微服务挑战** 在于分布式复杂度与运维成本。
- **没有基建别上微服务**，否则弊大于利。

## 参考链接

- [Martin Fowler：Microservices](https://martinfowler.com/articles/microservices.html)
- [Martin Fowler：Monolith First](https://martinfowler.com/bliki/MonolithFirst.html)
- [Spring Cloud 官方文档](https://spring.io/projects/spring-cloud)
- [Spring Cloud Alibaba 版本说明](https://github.com/alibaba/spring-cloud-alibaba/wiki/%E7%89%88%E6%9C%AC%E8%AF%B4%E6%98%8E)
- [Spring Boot 官方文档](https://spring.io/projects/spring-boot)
- [Nacos 官方文档](https://nacos.io/zh-cn/docs/what-is-nacos.html)
- [OpenFeign 官方文档](https://spring.io/projects/spring-cloud-openfeign)
- [Spring Cloud Gateway 文档](https://spring.io/projects/spring-cloud-gateway)

下一篇 → [02 注册中心 Nacos](/java/cloud/springcloud/nacos)
