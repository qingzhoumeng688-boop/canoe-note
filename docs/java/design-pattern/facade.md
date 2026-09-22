# 11 外观模式

下班回家，你对着手机喊一句"我回来了"，灯亮了、空调开了、窗帘拉上、热水器开始烧水——你**根本不需要**挨个去按五个开关。外观模式（Facade，也叫门面模式）就是这位"管家"：它把一个复杂子系统的繁琐调用，**打包成一个简单好用的入口**。本篇用"家庭影院一键观影"这根主线，讲清它怎么给复杂系统"瘦身"。

## 一、它是什么

一句话大白话：**外观就是给一堆复杂操作做个"一键"按钮**，你按一下，背后它替你把好几件事都办了。

生活化比喻：家庭影院要观影，得先拉窗帘、调暗灯、开投影、切输入源、开功放、调音量、开 DVD、按播放——八步。外观模式就是遥控器上的"一键观影"键：你只按一下，管家按顺序把八步全做了。你不用记步骤，也不怕漏。

经典定义（GoF）：**为子系统中的一组接口提供一个一致的界面**，Facade 定义了一个高层接口，让子系统更容易使用。

## 二、为什么需要它（不用会怎样）

没有外观时，每一个想看电影的调用方都得亲手把八步全写一遍：

```java
package com.canoe.pattern.facade.before;

// 没有门面：调用方被迫直接摆弄所有子系统，重复且易错
public class Client {
    public static void main(String[] args) {
        Light light = new Light();
        Projector projector = new Projector();
        Curtain curtain = new Curtain();
        Amplifier amplifier = new Amplifier();
        DvdPlayer dvd = new DvdPlayer();

        // 八步顺序全得记，写错一步就翻车
        curtain.down();
        light.dim();
        projector.on();
        projector.setInput("DVD");
        amplifier.on();
        amplifier.setVolume(12);
        dvd.on();
        dvd.play("盗梦空间");

        // 收尾还要再反向写一遍，散落在代码各处
    }
}
```

痛点：

- **重复代码**：每个调用方都把这套八步抄一遍，DRY 全无。
- **高耦合**：调用方必须认识灯光、投影、功放……所有子系统，任一子系统的改名/改参都会让调用方集体崩溃。
- **顺序陷阱**：步骤有先后（先拉窗帘再开投影），散落各处极易写错或漏写。

外观把这套流程收进一个 `watchMovie()`，调用方只调一句，顺序和细节全部内聚。

## 三、结构与角色

```text
        ┌──────────┐
        │  Client  │  只跟门面打交道
        └────┬─────┘
             │ watchMovie() / endMovie()
             ▼
        ┌─────────────────┐
        │ HomeTheaterFacade│  门面：聚合子系统，暴露简单接口
        │    (Facade)      │
        └────┬────┬────┬───┘
             │    │    │  持有并调用各子系统
     ┌───────▼┐ ┌─▼────┐ ┌▼──────┐
     │ Light  │ │Projec│ │Amplif │ ...（子系统群）
     │(子系统)│ │tor   │ │ier    │
     └────────┘ └──────┘ └───────┘
```

| 角色 | 对应到影院 | 职责 |
| --- | --- | --- |
| **Facade（门面）** | `HomeTheaterFacade` | 提供统一简单接口，内部编排子系统调用顺序 |
| **Subsystem（子系统）** | `Light`/`Projector`/`Curtain`/`Amplifier`/`DvdPlayer` | 各自实现具体功能，不知门面存在 |
| **Client（客户端）** | `main` 里的用户 | 只依赖门面，不再直接碰子系统 |

注意：**子系统并不知道门面的存在**，它们之间依旧可以互相独立工作；门面只是"额外"提供了一个入口。

## 四、代码实现

```java
package com.canoe.pattern.facade;

// 子系统：灯光
public class Light {
    public void on() {
        System.out.println("灯光：开");
    }
    public void off() {
        System.out.println("灯光：关");
    }
    public void dim() {
        System.out.println("灯光：调暗到 10%");
    }
}
```

```java
package com.canoe.pattern.facade;

// 子系统：投影仪
public class Projector {
    public void on() {
        System.out.println("投影仪：开机");
    }
    public void off() {
        System.out.println("投影仪：关机");
    }
    public void setInput(String input) {
        System.out.println("投影仪：切换到输入源 " + input);
    }
}
```

```java
package com.canoe.pattern.facade;

// 子系统：电动窗帘
public class Curtain {
    public void down() {
        System.out.println("窗帘：缓缓落下");
    }
    public void up() {
        System.out.println("窗帘：升起");
    }
}
```

```java
package com.canoe.pattern.facade;

// 子系统：功放
public class Amplifier {
    public void on() {
        System.out.println("功放：开机");
    }
    public void off() {
        System.out.println("功放：关机");
    }
    public void setVolume(int level) {
        System.out.println("功放：音量调到 " + level);
    }
}
```

```java
package com.canoe.pattern.facade;

// 子系统：DVD 播放器
public class DvdPlayer {
    public void on() {
        System.out.println("DVD：开机");
    }
    public void off() {
        System.out.println("DVD：关机");
    }
    public void play(String movie) {
        System.out.println("DVD：开始播放《" + movie + "》");
    }
}
```

```java
package com.canoe.pattern.facade;

// 门面：把一堆子系统操作封装成"一键观影"
public class HomeTheaterFacade {
    // 持有所有子系统引用
    private Light light;
    private Projector projector;
    private Curtain curtain;
    private Amplifier amplifier;
    private DvdPlayer dvd;

    // 构造器注入全部子系统（实际项目多由 Spring 注入）
    public HomeTheaterFacade(Light light, Projector projector,
                             Curtain curtain, Amplifier amplifier, DvdPlayer dvd) {
        this.light = light;
        this.projector = projector;
        this.curtain = curtain;
        this.amplifier = amplifier;
        this.dvd = dvd;
    }

    // 一键观影：客户端只调这一句
    public void watchMovie(String movie) {
        System.out.println("=== 准备一键观影 ===");
        curtain.down();        // 1. 拉窗帘
        light.dim();           // 2. 灯光调暗
        projector.on();        // 3. 开投影
        projector.setInput("DVD");
        amplifier.on();        // 4. 开功放
        amplifier.setVolume(12);
        dvd.on();              // 5. 开 DVD
        dvd.play(movie);       // 6. 播放
        System.out.println("=== 观影开始，请享用 ===");
    }

    // 一键结束：反向收尾
    public void endMovie() {
        System.out.println("=== 准备收尾 ===");
        dvd.off();
        amplifier.off();
        projector.off();
        light.on();
        curtain.up();
        System.out.println("=== 已恢复正常，再见 ===");
    }
}
```

```java
package com.canoe.pattern.facade;

// 演示：用户只跟门面打交道，不用关心子系统细节
public class FacadeDemo {
    public static void main(String[] args) {
        // 准备各子系统
        Light light = new Light();
        Projector projector = new Projector();
        Curtain curtain = new Curtain();
        Amplifier amplifier = new Amplifier();
        DvdPlayer dvd = new DvdPlayer();

        // 组装门面
        HomeTheaterFacade homeTheater =
                new HomeTheaterFacade(light, projector, curtain, amplifier, dvd);

        // 一键观影，只需一句话
        homeTheater.watchMovie("盗梦空间");

        System.out.println();

        // 一键收尾
        homeTheater.endMovie();
    }
}
```

运行输出：

```text
=== 准备一键观影 ===
窗帘：缓缓落下
灯光：调暗到 10%
投影仪：开机
投影仪：切换到输入源 DVD
功放：开机
功放：音量调到 12
DVD：开机
DVD：开始播放《盗梦空间》
=== 观影开始，请享用 ===

=== 准备收尾 ===
DVD：关机
功放：关机
投影仪：关机
灯光：开
窗帘：升起
=== 已恢复正常，再见 ===
```

## 五、与"封装"的关系

很多人误以为门面是"把子系统藏起来、不让用"。**错**。外观只是**额外**提供了一个简单入口，并不禁止你直接调子系统：

- 平时想省事，调 `watchMovie()` 一键搞定。
- 想精细控制（只调暗灯、不拉窗帘），照样可以直接 `light.dim()`。

所以外观和"封装"的区别是：**封装是隐藏实现细节、限制访问；外观是降低使用门槛、多给一条捷径**。子系统对熟手始终开放，门面只是给新手和常见场景递了把椅子。

## 六、实际应用

- **智能家居"一键回家/离家"**：聚合灯光、空调、窗帘、热水器等，一句指令完成整套动作。
- **Spring `JdbcTemplate`**：把 JDBC 里 Connection、Statement、ResultSet 的创建、异常转换、资源关闭全包了，你只写 SQL。
- **SLF4J 日志门面**：统一一套 API，背后随便换 Logback / Log4j2，业务代码不感知。
- **Controller 层聚合多个 Service**：一个下单接口内部依次调库存、支付、物流、通知，对外只暴露一个 `createOrder()`。
- **Tomcat `RequestFacade`**：把内部 `Request` 包装成规范的 `HttpServletRequest`，只暴露标准接口，隐藏容器内部方法。

## 七、优缺点

| 优点 | 缺点 |
| --- | --- |
| **降低耦合**：客户端只认门面，不认识子系统 | 门面可能变成"上帝类"，把所有逻辑堆在一起 |
| **减少重复代码**：通用流程只写一遍 | 若子系统接口频繁变动，门面也得跟着改 |
| **提升易用性**：复杂操作一键完成 | 过度封装会挡住对底层精细控制的需求 |
| **符合迪米特法则**（最少知识）：客户端依赖更少 | 加一层调用，理论上多一次转发开销（可忽略） |

## 八、适用场景

- **为一个复杂子系统提供简单入口**（如第三方 SDK、遗留系统）。
- **系统分层时，为每层定义一个门面**，降低层间耦合。
- **客户端需要调用一组高度相关的操作**，且顺序固定。
- **想隔离变化**：子系统可能替换/升级，用门面挡在前面，调用方不受影响。

什么情况下**不要**用：如果子系统本来就只有一两个简单方法，或者调用方必须精细控制每一步，强加门面反而画蛇添足。

## 九、在 JDK / 开源框架中的应用

- **Spring `JdbcTemplate`**：门面包住 JDBC 的 Connection/Statement/ResultSet 管理、异常翻译与资源关闭，调用方只写 SQL 与回调。
- **Tomcat `RequestFacade` / `ResponseFacade`**：把容器内部的 `Request`/`Response` 包成规范接口，只暴露 Servlet 标准方法，隐藏内部实现以防误用。
- **SLF4J**：日志门面，提供统一 API，后端可自由切换 Logback、Log4j2、java.util.logging。
- **Spring 各种 Template**（`RestTemplate`、`TransactionTemplate`、`RedisTemplate`）：对底层复杂 API 的简化入口。
- **JDK `Runtime`**：对外提供 `exec()`、`freeMemory()`、`gc()` 等简化接口，内部封装与 JVM/操作系统交互的细节。

它们都用门面**把复杂、易错的底层流程收敛成一个干净入口**。

## 十、与相近模式的区别

| 模式 | 目的 | 结构 | 使用场景 |
| --- | --- | --- | --- |
| **适配器** | 改变接口以兼容不兼容的类 | 包一层做翻译 | 对接旧接口/第三方 |
| **中介者** | 让对象之间不直接通信，由它统一协调 | 同事间只认中介 | 对象间交互复杂、易混乱 |
| **外观** | 给子系统提供简单统一入口 | 聚合子系统调用 | 降低复杂系统的使用门槛 |

区分要点：**外观是"简化了的好用入口"，子系统仍可独立被调；中介者是"强中介"，对象之间干脆不直接说话；适配器是"改接口"，外观通常不改接口只是聚合**。

## 本篇小结

- **外观核心**是给复杂子系统提供一个简单统一的高层接口。
- 它把多步、易错的操作流程**内聚**成一个"一键"方法。
- 结构三角色：**Facade、Subsystem、Client**。
- 门面**不隐藏**子系统，只是额外提供捷径，熟手仍能直接调用。
- 它**降低耦合**、减少重复代码，符合迪米特法则。
- 缺点：门面可能膨胀成"上帝类"，且要跟着子系统变更而改。
- Spring `JdbcTemplate` 是外观模式的经典范例。
- Tomcat 的 `RequestFacade` 用门面隔绝容器内部实现。
- SLF4J 是日志领域的标准门面。
- 与中介者区别：外观不禁止对象间直接通信，中介者禁止。
- 口诀：**外观给简单入口，适配器改接口，中介者当传声筒**。

## 参考链接

- [Refactoring Guru · 外观模式](https://refactoringguru.cn/design-patterns/facade)
- [Spring 官方文档 · JdbcTemplate](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/jdbc/core/JdbcTemplate.html)
- [Apache Tomcat · RequestFacade 源码](https://github.com/apache/tomcat/blob/main/java/org/apache/catalina/connector/RequestFacade.java)
- [SLF4J 官方文档](https://www.slf4j.org/manual.html)
- [Head First Design Patterns（O'Reilly）](https://www.oreilly.com/library/view/head-first-design/9781492078005/)
- [维基百科 · Facade pattern](https://en.wikipedia.org/wiki/Facade_pattern)
- [IBM Developer · 设计模式：外观模式](https://developer.ibm.com/articles/design-patterns-facade/)

下一篇 → [12 组合模式](/java/design-pattern/composite)
