# 10 桥接模式

家里遥控器丢了，你随手用手机 App 也能开电视——因为"遥控"这件事和"电视品牌"被拆成了两件事：**不管电视是海信还是索尼，遥控指令都一样；不管你用原装遥控器还是手机，都能控任意一台电视**。桥接模式（Bridge）干的就是这种"拆两维"的活儿：把**抽象**和**实现**解耦，让它们各自独立变化。本篇用"消息类型 × 发送渠道"这根主线，讲清它怎么消灭"类爆炸"。

## 一、它是什么

一句话大白话：**桥接就是搭一座桥，把"会变的抽象"和"会变的实现"两拨东西分开，各自发展、自由组合**。

生活化比喻：你有一堆遥控器（抽象维度的变化：普通遥控、语音遥控、手机遥控），又有一堆电视（实现维度的变化：海信、索尼、小米）。**好设计**是：遥控器只发"开机/换台"的标准指令，电视各自负责把这些指令变成自己的动作——于是"3 种遥控器 × 3 个品牌"只需 3+3 = 6 个类。**烂设计**是：为"海信的语音遥控""索尼的手机遥控"……每种组合都造一个专属类，直接 3×3 = 9 个，再多加一个品牌或一种遥控就爆炸。

经典定义（GoF）：**将抽象部分与其实现部分分离，使它们都可以独立地变化**。

## 二、为什么需要它（不用会怎样）

沿用"消息系统"的例子。业务有**两个独立变化的方向**：

1. **消息类型**：普通消息、加急消息、特急消息（会不断增加）。
2. **发送渠道**：短信、邮件、微信（也会不断增加）。

如果**不用**桥接，你只能把它们"钉死"在一起，用继承造出每一种组合：

```java
package com.canoe.pattern.bridge.before;

// 没有桥接：每种"消息类型 × 发送渠道"都得单独建一个类
public class CommonSmsMessage { /* 普通 + 短信 */ }
class CommonEmailMessage { /* 普通 + 邮件 */ }
class CommonWechatMessage { /* 普通 + 微信 */ }
class UrgentSmsMessage { /* 加急 + 短信 */ }
class UrgentEmailMessage { /* 加急 + 邮件 */ }
class UrgentWechatMessage { /* 加急 + 微信 */ }
class EmergencySmsMessage { /* 特急 + 短信 */ }
// ... 3 种类型 × 3 种渠道 = 9 个类，还得继续乘以更多组合
```

痛点：

- **类爆炸**：类型有 M 种、渠道有 N 种，就要写 M×N 个类。
- **改一处动全身**：给"加急消息"统一加一条"已读回执"，得改遍所有 `UrgentXxxMessage`。
- **无法独立扩展**：新增一个渠道（钉钉），要为每种消息类型都补一个类。

桥接把"消息类型"和"发送渠道"拆成两条独立继承线，再用一座桥连起来，M×N 直接降成 M+N。

## 三、结构与角色

```text
  抽象维度（消息类型）               实现维度（发送渠道）
  ┌──────────────┐                ┌──────────────────┐
  │   Message    │  ──持有引用──▶  │  MessageSender   │
  │  (抽象类)    │                │  (实现者接口)     │
  └──────┬───────┘                └────────┬─────────┘
   ┌─────┼─────┐                    ┌──────┼──────┐
   │     │     │                    │      │      │
 Common Urgent Emergency          Sms   Email  Wechat
（扩展抽象）                  （具体实现者）
```

| 角色 | 对应到消息系统 | 职责 |
| --- | --- | --- |
| **Abstraction（抽象类）** | `Message` | 定义高层抽象，并**持有**一个 Implementor 的引用（桥） |
| **RefinedAbstraction（扩展抽象）** | `CommonMessage`/`UrgentMessage`/`EmergencyMessage` | 抽象的具体变体，扩展/细化抽象 |
| **Implementor（实现者接口）** | `MessageSender` | 定义实现维度的接口，与抽象无关 |
| **ConcreteImplementor（具体实现者）** | `SmsSender`/`EmailSender`/`WechatSender` | 实现 Implementor 的具体行为 |

关键：**桥是 Abstraction 里那一个 `sender` 引用**，它让两个维度在运行时"接上"。

## 四、代码实现

```java
package com.canoe.pattern.bridge;

// 实现者接口：消息发送方式（桥的另一头）
public interface MessageSender {
    // 真正负责把消息发出去
    void send(String message);
}
```

```java
package com.canoe.pattern.bridge;

// 具体实现者：短信发送
public class SmsSender implements MessageSender {
    @Override
    public void send(String message) {
        System.out.println("[短信] " + message);
    }
}
```

```java
package com.canoe.pattern.bridge;

// 具体实现者：邮件发送
public class EmailSender implements MessageSender {
    @Override
    public void send(String message) {
        System.out.println("[邮件] " + message);
    }
}
```

```java
package com.canoe.pattern.bridge;

// 具体实现者：微信发送
public class WechatSender implements MessageSender {
    @Override
    public void send(String message) {
        System.out.println("[微信] " + message);
    }
}
```

```java
package com.canoe.pattern.bridge;

// 抽象化角色：消息，持有发送方式的引用（这就是"桥"）
public abstract class Message {
    // 桥：指向实现者，运行期可替换
    protected MessageSender sender;

    // 通过构造器把发送方式注入进来
    public Message(MessageSender sender) {
        this.sender = sender;
    }

    // 具体怎么组织内容由子类决定，最后委托给发送方式
    public abstract void send(String content);
}
```

```java
package com.canoe.pattern.bridge;

// 扩展抽象：普通消息
public class CommonMessage extends Message {
    public CommonMessage(MessageSender sender) {
        super(sender);
    }

    @Override
    public void send(String content) {
        sender.send("【普通】" + content);
    }
}
```

```java
package com.canoe.pattern.bridge;

// 扩展抽象：加急消息
public class UrgentMessage extends Message {
    public UrgentMessage(MessageSender sender) {
        super(sender);
    }

    @Override
    public void send(String content) {
        sender.send("【加急，请尽快处理】" + content);
    }
}
```

```java
package com.canoe.pattern.bridge;

// 扩展抽象：特急消息
public class EmergencyMessage extends Message {
    public EmergencyMessage(MessageSender sender) {
        super(sender);
    }

    @Override
    public void send(String content) {
        sender.send("【特急，立刻处理】" + content);
    }
}
```

```java
package com.canoe.pattern.bridge;

// 演示：消息类型 × 发送渠道 两个维度自由组合
public class BridgeDemo {
    public static void main(String[] args) {
        // 用短信发一条加急消息
        Message urgentSms = new UrgentMessage(new SmsSender());
        urgentSms.send("服务器 CPU 飙到 95%");

        // 用邮件发一条特急消息
        Message emergencyEmail = new EmergencyMessage(new EmailSender());
        emergencyEmail.send("支付网关宕机");

        // 用微信发一条普通消息
        Message commonWechat = new CommonMessage(new WechatSender());
        commonWechat.send("今日站会改到 10 点");
    }
}
```

运行输出：

```text
[短信] 【加急，请尽快处理】服务器 CPU 飙到 95%
[邮件] 【特急，立刻处理】支付网关宕机
[微信] 【普通】今日站会改到 10 点
```

## 五、为什么需要桥接

用经典的"**形状 × 颜色**"算一笔账：

- 形状有 4 种：圆形、方形、三角形、五角星。
- 颜色有 3 种：红、绿、蓝。
- **不用桥接（继承钉死）**：4 × 3 = **12 个类**（红圆、绿圆、蓝圆、红方……）。再加一种颜色，立刻 +4 个类。
- **用桥接**：形状 4 个类 + 颜色 3 个接口实现 = **7 个类**。再加一种颜色，只加 1 个类。

```text
  不用桥接：笛卡尔积爆炸
  红圆 绿圆 蓝圆  红方 绿方 蓝方 ……  = 12 个类

  用桥接：两维各自独立
  形状(4)  +  颜色(3)  = 7 个类，组合在运行期完成
```

桥接把"**编译期乘法**"变成了"**运行期组合**"。它适合那种**一个类有两个（或多个）独立变化方向**的场景——这正是它存在的全部理由。

## 六、与适配器、装饰器的区别

- **桥接 vs 适配器**：桥接是**设计之初**就主动把抽象和实现分开，防爆炸；适配器是**事后补救**，给一个已经存在、改不动的旧接口套个壳去兼容新接口。
- **桥接 vs 装饰器**：桥接是**拆两维**，让抽象和实现各自演化；装饰器是**在一条继承线上动态叠加职责**，且不改变接口。
- 口诀：**桥接防患于未然（拆），适配器救火于既倒（补），装饰器锦上添花（加）**。

## 七、优缺点

| 优点 | 缺点 |
| --- | --- |
| 消灭**类爆炸**，把 M×N 降为 M+N | 设计前期就要识别出"两个独立变化维度"，门槛较高 |
| **符合开闭原则**：任一方扩展都不影响另一方 | 类数量虽少，但多了一层抽象，初读代码稍绕 |
| 抽象与实现**彻底解耦**，可独立演化、独立测试 | 若维度识别错误（其实只有一个维度会变），反而过度设计 |
| 运行期可动态替换实现者，灵活组合 | 桥接关系若设计不当，易出现"伪桥接"（只是普通组合） |

## 八、适用场景

- **一个类有两个（或多个）独立变化方向**：如"消息类型 × 发送渠道""操作系统 × 图形绘制"。
- **不希望用继承把变体钉死**，又想灵活组合。
- **需要运行时切换实现**：如数据库驱动、日志框架后端切换。
- **GUI 跨平台**：窗口/按钮的"控件"抽象 × 不同 OS 的"原生绘制"实现。
- **驱动/插件架构**：抽象 API × 多种底层驱动。

什么情况下**不要**用：如果只有一个维度会变化，老老实实用继承或组合就够了，上桥接就是过度设计。

## 九、在 JDK / 开源框架中的应用

- **JDBC**：`Driver` 是实现者维度（MySQL、PostgreSQL 各自实现），`Connection`/`Statement` 等是抽象维度，应用代码通过桥接在不同数据库间切换而不改业务。
- **Java AWT**：`Graphics`/`Component`（抽象）与不同平台的 `Graphics2D`/`Peer` 实现（实现者）通过桥接跨平台绘制。
- **SLF4J**：日志门面（`Logger`，抽象）与实际后端（`Logback`、`Log4j2`，实现者）通过桥接自由组合。
- **Spring**：`View`（抽象）与具体视图技术（`JspView`、`FreemarkerView`、`ThymeleafView`，实现者）解耦，Controller 不关心用哪种模板引擎。

它们都用桥接把"**上层抽象**"和"**底层实现**"彻底脱钩，从而做到换实现不换业务代码。

## 十、与相近模式的区别

| 模式 | 目的 | 结构 | 使用场景 |
| --- | --- | --- | --- |
| **适配器** | 事后兼容已有接口 | 包一层翻译接口 | 老系统/第三方接口对不上时 |
| **装饰器** | 动态叠加职责，接口不变 | 同接口层层包裹 | 给对象加功能、加料 |
| **桥接** | 事前拆两维，独立演化 | 抽象持有实现引用 | 有两个独立变化方向时 |

一句话：**适配器改接口，装饰器保接口加料，桥接拆两维各走各路**。

## 本篇小结

- **桥接核心**是把抽象与实现分离，让两者独立变化。
- 它专门解决**一个类有两个独立变化方向**导致的类爆炸。
- 结构四角色：**Abstraction、RefinedAbstraction、Implementor、ConcreteImplementor**。
- 那座"桥"就是抽象类里**持有的实现者引用**。
- 类数量从 M×N 降为 **M+N**，编译期乘法变运行期组合。
- 桥接是**事前设计**，适配器是**事后补救**，两者方向相反。
- JDBC、`SLF4J`、AWT 都是桥接的工业级范例。
- 桥接**符合开闭原则**：扩展任一维度都不动另一维度。
- 缺点是需要**提前识别变化维度**，否则容易过度设计。
- 运行期可动态替换实现者，组合非常灵活。
- 口诀：**桥接防患于未然，适配器救火于既倒，装饰器锦上添花**。

## 参考链接

- [Refactoring Guru · 桥接模式](https://refactoringguru.cn/design-patterns/bridge)
- [Oracle JavaDoc · JDBC Driver](https://docs.oracle.com/en/java/javase/17/docs/api/java.sql/java/sql/Driver.html)
- [SLF4J 官方文档](https://www.slf4j.org/manual.html)
- [Head First Design Patterns（O'Reilly）](https://www.oreilly.com/library/view/head-first-design/9781492078005/)
- [维基百科 · Bridge pattern](https://en.wikipedia.org/wiki/Bridge_pattern)
- [IBM Developer · 设计模式：桥接模式](https://developer.ibm.com/articles/design-patterns-bridge/)
- [Spring 官方文档 · View 技术](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-view)

下一篇 → [11 外观模式](/java/design-pattern/facade)
