# 18 责任链模式

> 本篇导读：请假 1 天组长批，3 天要经理批，7 天得总监批；请求像击鼓传花一样在审批人之间流转，谁够权限谁处理。这种"把多个处理者串成一条链、请求沿链传递直到被处理"的结构，就是责任链模式。本文用"请假审批"主线，从反面代码重构到 `setNext` 链式调用，讲清纯/不纯责任链、链表 vs 数组两种实现，并扒一扒 Servlet Filter、Spring Security 的源码身影。

## 一、它是什么

一句话大白话：**责任链模式就是把一群"能处理请求的人"串成一条链，请求从链头传下去，谁该管谁就接手，管不了就往下传**。

生活化比喻：公司请假审批就是一条典型责任链。你递请假条给组长，组长一看"才 1 天，我能批"，直接批了；要是 5 天，组长批不了，就转给经理；经理还批不了再转总监。请求像流水一样一级级往下流，直到有人接住为止。

GoF 的官方定义：

> Avoid coupling the sender of a request to its receiver by giving more than one object a chance to handle the request. Chain the receiving objects and pass the request along the chain until an object handles it.
> ——《Design Patterns: Elements of Reusable Object-Oriented Software》

翻译：**让多个对象都有机会处理请求，从而解耦请求的发送者和接收者。把这些接收对象串成一条链，沿链传递请求，直到有对象处理它为止。**

## 二、为什么需要它（不用会怎样）

反面代码——审批逻辑全堆在一个 `if-else` 里：

```java
// ❌ 反面教材：一个大方法里硬编码整条审批链
public class LeaveApprover {
    public String approve(int days) {
        if (days <= 1) {
            return "组长：批准";
        } else if (days <= 3) {
            return "经理：批准";
        } else if (days <= 7) {
            return "总监：批准";
        } else {
            return "CEO：批准";
        }
    }
}
```

痛点：

1. **权限阈值散落在主干**：哪天"经理也能批 5 天"，得改 `else if` 的边界，极易改错。
2. **违反开闭原则**：加一级"副总监"审批，就要插一个分支、动主干。
3. **无法动态编排**：想临时调整审批顺序（如跳过经理直报总监），代码写死做不到。
4. **职责不清**：一个方法包揽了所有人的审批规则，谁也复用不了。

责任链的改善：把每个审批人做成独立 `Handler`，各自声明"我能批几天"，通过 `setNext` 串成链，**请求自动往下传**。新增/调整审批人只操作链，不动处理者内部。

## 三、结构与角色

```text
   Client
     │  new 组长(); 组长.setNext(经理); 经理.setNext(总监);
     ▼
   ┌──────────────┐    setNext()    ┌──────────────┐    setNext()    ┌──────────────┐
   │  TeamLeader   │ ─────────────► │   Manager     │ ─────────────► │   Director    │
   │  (组长)       │                │   (经理)      │                │   (总监)      │
   ├──────────────┤                ├──────────────┤                ├──────────────┤
   │ handle(days) │                │ handle(days) │                │ handle(days) │
   └──────┬───────┘                └──────┬───────┘                └──────┬───────┘
          │ next.handle(days) 若自己不处理    │ next.handle(days)              │ (链尾)
          └──────────────────────────────────┘
```

| 角色 | 职责 |
| --- | --- |
| **Handler（抽象处理者）** | 定义处理请求的接口，并持有对下一个处理者的引用 `next`。 |
| **ConcreteHandler（具体处理者）** | 判断自己能否处理：能则处理，不能则 `next.handle()` 传给下家。 |
| **Client（客户端）** | 负责把各个处理者串成链，并发起第一个请求。 |

## 四、代码实现

完整可运行示例——请假审批链，用 `setNext` 串起 组长 → 经理 → 总监。

```java
package com.canoe.pattern.chain;

/**
 * 抽象处理者：审批人
 */
public abstract class ApprovalHandler {
    protected ApprovalHandler next;   // 链上的下一个处理者

    /** 设置下一个处理者，返回它以便链式调用 */
    public ApprovalHandler setNext(ApprovalHandler next) {
        this.next = next;
        return next;
    }

    /**
     * 处理请假请求
     *
     * @param days 请假天数
     * @return 审批结果；若无人处理返回 null
     */
    public abstract String handle(int days);
}
```

```java
package com.canoe.pattern.chain;

/** 具体处理者：组长，只能批 1 天以内 */
public class TeamLeader extends ApprovalHandler {
    @Override
    public String handle(int days) {
        if (days <= 1) {
            return "组长：批准你请 " + days + " 天假";
        }
        // 批不了，传给下家
        return next == null ? null : next.handle(days);
    }
}
```

```java
package com.canoe.pattern.chain;

/** 具体处理者：经理，能批 3 天以内 */
public class Manager extends ApprovalHandler {
    @Override
    public String handle(int days) {
        if (days <= 3) {
            return "经理：批准你请 " + days + " 天假";
        }
        return next == null ? null : next.handle(days);
    }
}
```

```java
package com.canoe.pattern.chain;

/** 具体处理者：总监，能批 7 天以内 */
public class Director extends ApprovalHandler {
    @Override
    public String handle(int days) {
        if (days <= 7) {
            return "总监：批准你请 " + days + " 天假";
        }
        return next == null ? null : next.handle(days);
    }
}
```

```java
package com.canoe.pattern.chain;

/** 演示：组装责任链并发起请求 */
public class ChainDemo {
    public static void main(String[] args) {
        // 组装：组长 -> 经理 -> 总监
        ApprovalHandler leader = new TeamLeader();
        ApprovalHandler manager = new Manager();
        ApprovalHandler director = new Director();
        leader.setNext(manager).setNext(director);

        int[] requests = {1, 2, 5, 10};
        for (int days : requests) {
            String result = leader.handle(days);
            System.out.println(days + " 天 -> " + (result == null ? "无人能批（需 CEO）" : result));
        }
    }
}
```

运行输出：

```text
1 天 -> 组长：批准你请 1 天假
2 天 -> 经理：批准你请 2 天假
5 天 -> 总监：批准你请 5 天假
10 天 -> 无人能批（需 CEO）
```

`setNext` 返回 `next` 这个写法很关键——让组装链能写成 `a.setNext(b).setNext(c)`，清爽利落。

## 五、纯的与不纯的责任链

- **纯的责任链**：一个请求**有且仅有**一个处理者处理（处理后即终止，绝不再往下传），或者**完全没人处理**。上面请假审批就是纯的——组长批了就结束，不会经理再批一道。GoF 原教旨意义上的责任链是纯的。

- **不纯的责任链**：每个处理者**先处理一部分，然后继续往下传**，链上多个节点都贡献处理。典型如 Servlet 的 `Filter` 链：每个过滤器都做一点事（如记日志、校验 token），再 `chain.doFilter()` 放给下一个，请求会一路穿过整条链。

| 维度 | 纯责任链 | 不纯责任链 |
| --- | --- | --- |
| 处理者数量 | 仅一个处理 | 多个都处理一部分 |
| 是否继续传递 | 处理后即停 | 处理后仍 `next` |
| 例子 | 请假审批 | Servlet Filter、日志拦截器 |

实际项目里**不纯的更常见**，因为"先做点事再放行"比"只能一人接手"实用得多。

## 六、实际应用

- **Servlet `Filter` 链**：`Filter.doFilter(req, resp, chain)` 中调 `chain.doFilter()` 放行到下一个过滤器，属于不纯责任链。
- **Spring MVC `HandlerInterceptor`**：`preHandle` / `postHandle` / `afterCompletion` 沿拦截器链顺序/逆序执行。
- **Spring Security 过滤器链 `SecurityFilterChain`**：从 `UsernamePasswordAuthenticationFilter` 到 `FilterSecurityInterceptor`，一环扣一环鉴权。
- **Netty `ChannelPipeline`**：入站/出站事件沿 `ChannelHandler` 链传播，是责任链的网络版实现。
- **MyBatis `Interceptor` 插件链**：拦截 `Executor` / `StatementHandler` 等，多个插件依次增强。

**重点扒一个源码例子——Servlet Filter**：容器启动时把配置的 `Filter` 排成数组，用一个 `ApplicationFilterChain` 维护 `pos` 游标，每次 `doFilter` 就让 `pos++` 调用下一个过滤器，最后一个过滤器才真正交给 `Servlet`。这正是"数组实现 + 不纯责任链"的教科书案例。

## 七、链表实现 vs 数组实现

**链表实现（本文第四节）**：每个处理者持有 `next` 引用，客户端手动 `setNext` 串链。

```java
// 链表：灵活，可运行时动态增删节点
leader.setNext(manager).setNext(director);
```

- 优点：节点**可动态增删**，顺序运行时可变，扩展方便。
- 缺点：断链（某个 `next` 漏设）会导致**请求丢失**；调试时要顺着引用跳。

**数组实现**：把所有处理者先收进 `List<Handler>`，用一个游标顺序遍历。

```java
package com.canoe.pattern.chain.array;

import java.util.ArrayList;
import java.util.List;

/** 用数组/列表维护责任链，游标 pos 推进 */
public class HandlerChain {
    private final List<ApprovalHandler> handlers = new ArrayList<ApprovalHandler>();
    private int pos = 0;

    public void add(ApprovalHandler h) {
        handlers.add(h);
    }

    public String handle(int days) {
        while (pos < handlers.size()) {
            ApprovalHandler h = handlers.get(pos++);
            String r = h.handle(days);   // 注意：此处 handler 需改为不自带 next、只处理
            if (r != null) {
                return r;
            }
        }
        return null;
    }
}
```

- 优点：**顺序明确、便于调试**，不易断链，天然支持遍历与插队（按索引）。
- 缺点：节点顺序在**组装时**就定死，运行时动态改链不如链表灵活。

**对比小结**：要**灵活增删、运行时编排**选链表；要**顺序稳定、易调试**选数组。Servlet 容器就是"数组 + 游标"派。

## 八、优缺点

| 优点 | 缺点 |
| --- | --- |
| 请求发送者与接收者**解耦**，互不知道对方 | 请求**可能无人处理**（链尾没兜底） |
| 符合开闭原则，新增处理者只加节点不改旧逻辑 | 链过长时**性能与延迟**累积 |
| 可**动态编排**处理顺序、运行时增删节点 | 调试时调用链**跳来跳去**，不如顺序代码直观 |
| 单一职责，每个处理者只管自己那一段 | 若某节点漏设 `next`，请求会**悄悄丢失** |

## 九、适用场景

- 一个请求需要**多个对象中的一个或几个**处理（请假审批、报销审批）。
- 想**动态指定/重排**处理顺序（如不同环境用不同过滤链）。
- 多个处理步骤要**依次执行并可短路**（校验链：非空→格式→权限）。
- Web 中间件的**过滤器链 / 拦截器链**（鉴权、日志、限流）。
- 事件/日志的**多级处理**（责任链式 handler）。

**什么情况下不要用**：如果处理者只有固定一个、或必须严格顺序且不可变，直接调用更简单，上责任链反而绕；若要求"必须全部处理且不可中断"，用管道/流水线更合适。

## 十、在 JDK / 开源框架中的应用

- **`java.util.logging` / `Logger` 的 `Handler` 链**：日志经 `Filter` 后交给各级 `Handler`（Console/File）处理，是不纯责任链。
- **Servlet `Filter` + `ApplicationFilterChain`**：见第六节源码剖析。
- **Spring Security `SecurityFilterChain`**：鉴权链路，见第六节。
- **MyBatis `Interceptor` 插件链**：多个插件沿 `Plugin` 链依次增强目标对象。
- **Netty `ChannelPipeline`**：入站/出站事件沿 handler 链传播。

它们这么设计的原因一致：**把"请求的处理过程"拆成多个独立、可插拔的环节，避免把所有判断堆在一个方法里**。

## 十一、与相近模式的区别

| 对比模式 | 区别点 | 责任链模式 |
| --- | --- | --- |
| **观察者模式** | 观察者**广播**给所有观察者、互不干扰；责任链**沿链传递、可中断** | 关注"请求找人处理" |
| **装饰器模式** | 装饰器**增强对象能力**且通常全部生效；责任链是**选择/传递**，可短路 | 关注"请求处理流程" |

## 本篇小结

- **责任链模式**把多个处理者**串成链**，请求沿链传递直到被处理。
- 核心是**解耦发送者与接收者**，双方互不知道对方具体是谁。
- 每个处理者通过 **`setNext`** 指向下家，自己不处理就 `next.handle()`。
- **纯责任链**仅一人处理即终止；**不纯责任链**（如 Filter）多个节点都处理。
- 新增处理者只加节点，**不改旧逻辑**，符合**开闭原则**。
- **链表实现**灵活可动态增删，断链风险高；**数组实现**顺序稳定易调试。
- Servlet 的 **`Filter` 链**是"数组 + 游标 + 不纯责任链"的经典源码。
- Spring Security 的 **`SecurityFilterChain`**、Netty 的 **`ChannelPipeline`** 都是责任链。
- 风险点：**链尾无兜底时请求可能无人处理**；长链有性能损耗。
- 某个节点**漏设 `next`** 会导致请求悄悄丢失，组装链要小心。
- 处理者唯一且顺序固定时**不必使用**，直接调用更清晰。

## 参考链接

- [Refactoring Guru · 责任链模式](https://refactoringguru.cn/design-patterns/chain-of-responsibility)
- [Oracle JavaDoc · Filter (Servlet)](https://docs.oracle.com/javaee/7/api/javax/servlet/Filter.html)
- [Spring Security · SecurityFilterChain](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
- [Netty · ChannelPipeline](https://netty.io/wiki/user-guide-for-4.x.html#wiki-h2-9)
- [MyBatis · Interceptor 插件](https://mybatis.org/mybatis-3/configuration.html#plugins)
- [维基百科 · Chain-of-responsibility pattern](https://en.wikipedia.org/wiki/Chain-of-responsibility_pattern)
- [GoF 设计模式 · 责任链](https://en.wikipedia.org/wiki/Design_Patterns)

下一篇 → [19 命令模式](/java/design-pattern/command)
