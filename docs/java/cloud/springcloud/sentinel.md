# 05 Sentinel 熔断限流

> 本篇导读：Hystrix 停维后，Sentinel 成了 Spring Cloud 生态里流量治理的事实标准——它来自阿里双十一的实战沉淀，能限流、能熔断、能热点防护、还能系统自适应保护。本文从"Sentinel 是什么"讲起，拆解核心概念、控制台部署、流控/熔断/热点/系统规则、`@SentinelResource`、与 Feign/Gateway 整合、规则持久化，最后给生产实践建议。

## 一、Sentinel 是什么

Sentinel 是**阿里开源的流量治理组件**，核心能力：

- **流量控制（Flow Control）**：控制 QPS / 线程数，保护系统不被冲垮。
- **熔断降级（Circuit Breaking）**：下游慢/异常比例高时自动熔断，避免雪崩。
- **系统负载保护（System Protection）**：从整体维度（CPU/Load/RT）自适应保护。
- **热点参数限流（Hotspot）**：对"某个商品 ID / 用户 ID"单独限流。

**对比 Hystrix**：

```text
维度            Hystrix            Sentinel
------------------------------------------------
维护状态        已停止维护          活跃（阿里维护）
控制台          无（靠 Turbine）    有可视化控制台
限流维度        仅线程池/信号量     QPS/线程数/关联/链路/热点/系统
熔断策略        异常比例/超时       慢调用比例/异常比例/异常数
自适应保护      无                 有（系统规则）
```

一句话：**Hystrix 退场，Sentinel 上位**。新项目无脑选 Sentinel。

## 二、核心概念

两个词要刻进脑子：

- **资源（Resource）**：**被保护的对象**，可以是一个方法、一段代码、一个 URL、一个服务。Sentinel 的所有规则都挂在"资源"上。
- **规则（Rule）**：作用于资源的控制策略，包括流控规则、熔断规则、系统规则、热点规则、授权规则。

设计理念：以"**流量**"为切入点，把流量当作可被塑形的对象——限流是"塑形"、熔断是"断流"、系统保护是"整体水位"。你先定义资源，再给资源配规则。

## 三、控制台部署

下载 jar 直接跑（默认端口 8080，账号密码 `sentinel/sentinel`）：

```bash
java -Dserver.port=8080 -jar sentinel-dashboard.jar
```

Docker 方式：

```bash
docker run -d -p 8080:8080 --name sentinel bladex/sentinel-dashboard
```

**重要坑**：控制台是**懒加载**——**必须先访问一次被保护接口，资源才会出现在控制台**。你刚启动完控制台看到空空如也，别慌，调一次接口就有了。

## 四、接入 Spring Boot

引入依赖 + 配控制台地址 + 用 `@SentinelResource` 定义资源：

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
</dependency>
```

```yaml
spring:
  cloud:
    sentinel:
      transport:
        dashboard: 127.0.0.1:8080   # 控制台地址
      eager: true                    # 关闭懒加载，启动即注册资源（可选）
```

最小可运行示例：

```java
package com.canoe.cloud.sc.sentinel;

import com.alibaba.csp.sentinel.annotation.SentinelResource;
import com.alibaba.csp.sentinel.slots.block.BlockException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DemoController {

    @GetMapping("/hello")
    @SentinelResource(value = "hello", blockHandler = "block")
    public String hello() {
        return "hello sentinel";
    }

    // 被限流/熔断时走这里
    public String block(BlockException e) {
        return "请求过于频繁，请稍后再试";
    }
}
```

## 五、流控规则

四种维度组合：

1. **基于 QPS**：每秒请求数超过阈值就限流（最常用）。
2. **基于并发线程数**：正在处理的线程数超阈值就限流（保护线程池不被占满）。
3. **流控模式**：
   - **直接**：本资源超阈值直接限流。
   - **关联**：关联资源（如 `writeApi`）超阈值时，限制当前资源（如 `readApi`）——典型用在"读写分离，写压力大时压住读"。
   - **链路**：只对从某条调用链路进来的流量限流，其他链路不受影响。
4. **流控效果**：
   - **快速失败**：直接拒绝（默认）。
   - **Warm Up（预热）**：阈值从低慢慢升到设定值，给冷系统一个缓冲（适合秒杀开场）。
   - **排队等待**：请求匀速通过（漏桶效果），超时就丢弃。

```text
场景建议：
突发秒杀          → QPS + Warm Up（冷启动避免瞬间打满）
保护线程池        → 线程数限流
读写隔离          → 关联模式（写限流波及读）
平稳削峰          → 排队等待
```

## 六、熔断规则

三种熔断策略：

- **慢调用比例**：响应时间（RT）超过阈值的请求占比超阈值，触发熔断。
- **异常比例**：异常请求占比超阈值，触发熔断。
- **异常数**：单位时间异常数超阈值，触发熔断。

熔断三态（呼应限流篇）：Closed → Open（直接拒绝）→ Half-Open（放部分请求试探恢复）。

```yaml
# 示例：慢调用比例熔断（时间窗口内 RT>500ms 占比>50% 即熔断 10 秒）
spring:
  cloud:
    sentinel:
      flow:
        rules:
          - resource: createOrder
            grade: 1            # 1=QPS
            count: 100          # 阈值 100 QPS
      degrade:
        rules:
          - resource: queryUser
            grade: 0            # 0=慢调用比例
            count: 500          # RT 阈值 500ms
            timeWindow: 10      # 熔断 10 秒
            minRequestAmount: 20
            slowRatioThreshold: 0.5
```

## 七、热点参数限流

场景：对"某个商品 ID"或"某个用户 ID"单独限流，而不是整体限流。比如秒杀时，1 号商品被疯狂点，但其他商品正常。

```java
package com.canoe.cloud.sc.sentinel;

import com.alibaba.csp.sentinel.annotation.SentinelResource;
import com.alibaba.csp.sentinel.slots.block.BlockException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HotController {

    // 对参数 productId 做热点限流
    @GetMapping("/seckill")
    @SentinelResource(value = "seckill", blockHandler = "block")
    public String seckill(@RequestParam Long productId) {
        return "秒杀成功：" + productId;
    }

    public String block(Long productId, BlockException e) {
        return "该商品太火爆，请稍后再试";
    }
}
```

在控制台"热点规则"里配置资源 `seckill`、参数索引 0（即 `productId`）、设置限流阈值，并可配"例外项"（给某些 VIP 商品更高阈值）。

## 八、系统规则

与前面"针对某个资源"不同，系统规则是**从整体维度保护整个应用**：

- **Load**：系统负载（Linux 的 load1）超过阈值则拒绝。
- **CPU 使用率**：CPU 超过阈值触发保护。
- **平均 RT**：所有入口平均响应时间超阈值则限流。
- **并发线程数**：总体并发线程数超阈值则限流。
- **入口 QPS**：总体入口 QPS 超阈值则限流。

它不针对单资源，而是"整个机器快不行了，先整体踩刹车"，是兜底的兜底。

## 九、@SentinelResource 注解

两个核心属性，容易混淆：

- **`blockHandler`**：处理 **`BlockException`**——即被**限流/熔断/系统保护**拦截时调用。参数要包含原方法参数 + `BlockException`。
- **`fallback`**：处理**业务异常**（如 `NullPointerException`）——即资源方法自己抛了业务异常时调用。参数可只含原参数，或加 `Throwable`。

```java
package com.canoe.cloud.sc.sentinel;

import com.alibaba.csp.sentinel.annotation.SentinelResource;
import com.alibaba.csp.sentinel.slots.block.BlockException;

public class ResourceDemo {

    // blockHandler 处理被限流/熔断；fallback 处理业务异常
    @SentinelResource(
        value = "queryOrder",
        blockHandler = "onBlock",
        fallback = "onError")
    public String queryOrder(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("id 不能为空"); // 走 fallback
        }
        return "order-" + id;
    }

    // 被限流/熔断
    public String onBlock(Long id, BlockException e) {
        return "被限流";
    }

    // 业务异常
    public String onError(Long id, Throwable e) {
        return "业务异常：" + e.getMessage();
    }
}
```

**`blockHandlerClass`**：把处理方法抽到单独类（静态方法），避免污染业务类：

```java
package com.canoe.cloud.sc.sentinel;

import com.alibaba.csp.sentinel.annotation.SentinelResource;
import com.alibaba.csp.sentinel.slots.block.BlockException;

// 业务类里只引用 handler 类，保持干净
public class OrderService {

    @SentinelResource(value = "queryOrder",
            blockHandler = "handleBlock",
            blockHandlerClass = OrderBlockHandler.class)
    public String queryOrder(Long id) {
        return "order-" + id;
    }
}

// 统一的限流/熔断处理类（方法必须是 public static）
class OrderBlockHandler {
    public static String handleBlock(Long id, BlockException e) {
        return "订单查询被限流，请稍后再试";
    }
}
```

## 十、Feign 整合

开启 Feign 的 Sentinel 支持后，`@FeignClient` 的调用自动被 Sentinel 保护，并可用 `fallback`：

```yaml
feign:
  sentinel:
    enabled: true   # 开启 Feign 调用被 Sentinel 包裹
```

```java
package com.canoe.cloud.sc.sentinel;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@FeignClient(name = "user-service", fallback = UserClientFallback.class)
public interface UserClient {
    @GetMapping("/user/{id}")
    String getUser(@PathVariable("id") Long id);
}
```

每个 Feign 接口方法在 Sentinel 里对应一个资源（`user-service@getUser`），可在控制台单独配流控/熔断。

## 十一、Gateway 整合

在网关维度做限流（按 route ID / API 分组）：

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/order/**
    sentinel:
      transport:
        dashboard: 127.0.0.1:8080
```

网关侧对每个 route 生成 Sentinel 资源，可配流控/熔断，实现"入口处就把洪水挡住"。

## 十二、规则持久化

**默认规则存在内存里，重启就丢**——这是生产必须解决的事。三种持久化方式：文件、Nacos、Apollo。推荐 Nacos。

```xml
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-datasource-nacos</artifactId>
</dependency>
```

```yaml
spring:
  cloud:
    sentinel:
      datasource:
        flow-ds:
          nacos:
            server-addr: 127.0.0.1:8848
            data-id: sentinel-flow-rules
            group-id: DEFAULT_GROUP
            rule-type: flow        # 流控规则
        degrade-ds:
          nacos:
            data-id: sentinel-degrade-rules
            group-id: DEFAULT_GROUP
            rule-type: degrade     # 熔断规则
```

规则在 Nacos 控制台编辑后即推送生效，应用重启也能从 Nacos 拉回，不再丢失。

## 十三、生产实践

几点建议，都是血泪教训：

- **阈值靠压测确定**，不要拍脑袋（呼应限流篇容量规划）。
- **规则一定要持久化**（Nacos/Apollo），否则一次重启全丢。
- **配合监控告警**：Sentinel 接入 Prometheus，规则触发、系统负载异常要能告警。
- **灰度调整**：新规则先小流量验证，再全量；别一上来就把阈值压得很低把正常流量也挡了。
- **区分 block 与 fallback**：限流提示 vs 业务报错，给用户的话术要不一样。

## 本篇小结

- **Sentinel** 是阿里开源的流量治理组件，Hystrix 停维后的事实标准。
- **核心概念**：资源（被保护对象）+ 规则（限流/熔断/系统/热点/授权）。
- **控制台懒加载**：先访问一次接口资源才显示，这是正常行为。
- **流控维度** 有 QPS / 线程数，模式有 直接/关联/链路，效果有 快速失败/WarmUp/排队。
- **熔断三策略**：慢调用比例、异常比例、异常数，三态 Closed/Open/Half-Open。
- **热点参数限流** 可对单个商品/用户 ID 单独塑形。
- **系统规则** 从整体（CPU/Load/RT）维度保护整个应用。
- **`blockHandler`** 处理被限流/熔断，**`fallback`** 处理业务异常，两者时机不同。
- **Feign 整合** 开 `feign.sentinel.enabled=true` 即可自动保护调用。
- **规则持久化** 用 Nacos/Apollo，否则重启即丢。
- **阈值靠压测**，不拍脑袋，且要配告警。

## 参考链接

- [Sentinel 官方文档](https://sentinelguard.io/zh-cn/docs/introduction.html)
- [Sentinel GitHub](https://github.com/alibaba/Sentinel)
- [Sentinel 流控规则](https://sentinelguard.io/zh-cn/docs/flow-control.html)
- [Sentinel 熔断降级](https://sentinelguard.io/zh-cn/docs/circuit-breaking.html)
- [Sentinel 热点参数限流](https://sentinelguard.io/zh-cn/docs/parameter-flow-control.html)
- [Sentinel 与 Nacos 规则持久化](https://sentinelguard.io/zh-cn/docs/dynamic-rule-configuration.html)
- [Sentinel + Spring Cloud Gateway](https://sentinelguard.io/zh-cn/docs/api-gateway-flow-control.html)
- [Spring Cloud Alibaba Sentinel](https://spring-cloud-alibaba-group.github.io/github-pages/2022/zh-cn/spring-cloud-alibaba.html)

下一篇 → [06 配置中心](/java/cloud/springcloud/config)
