# 07 适配器模式

你揣着国标的充电插头兴冲冲跑到欧洲，却发现酒店墙上的插座孔位是欧标的三圆脚——插不进去。适配器（Adapter）干的就是这种"转接头"的活儿：它不改变插头、也不改变墙壁，只是**把一方已有的能力，翻译成另一方听得懂的接口**。本篇用"出国充电"这条主线，讲清它解决什么问题、扮演什么角色，以及类适配、对象适配、接口适配三种写法。

## 一、它是什么

一句话大白话：**适配器就是个转接头**，让本来接口对不上、没法一起工作的两个类，能握手合作。

生活化比喻：你去欧洲旅游，带的是国标两脚扁插的手机充电器，而欧洲的插座是欧标圆脚的。你不需要重新买一台手机，也不需要砸了酒店的墙——买一个"国标转欧标"的插头转换器（适配器）就够了。它一头"吃进"国标插头，另一头"插进"欧标插座，中间负责把电信号翻译过去。

经典定义（GoF）：**将一个类的接口，转换成客户期望的另一个接口**。适配器让原本由于接口不兼容而不能一起工作的类，可以协同工作。

## 二、为什么需要它（不用会怎样）

假设你经营一间"共享充电吧"，顾客带着五花八门的插头来充电：国标、美标、欧标。如果你**不用**适配器，充电逻辑会变成这样：

```java
package com.canoe.pattern.adapter.before;

// 欧标插座（标准接口）
public interface EuroSocket {
    void charge();
}

// 国标插头
class ChinaPlug {
    public void chargeWithChinaStandard() {
        System.out.println("国标两脚扁插充电中");
    }
}

// 美标插头
class UsPlug {
    public void chargeWithUsStandard() {
        System.out.println("美标两脚扁插（带孔）充电中");
    }
}

// 没用适配器的"灾难"代码
class ChargingStation {
    // 每来一种新插头，就要加一个分支，方法越来越长
    public void charge(Object plug) {
        if (plug instanceof EuroSocket) {
            ((EuroSocket) plug).charge();
        } else if (plug instanceof ChinaPlug) {
            ((ChinaPlug) plug).chargeWithChinaStandard();
        } else if (plug instanceof UsPlug) {
            ((UsPlug) plug).chargeWithUsStandard();
        } else {
            throw new IllegalArgumentException("不支持的插头类型：" + plug);
        }
    }
}
```

痛点一目了然：

- **`if-else` 无限膨胀**：每多一种插头，就得多写一个 `else if`，方法越滚越长。
- **强耦合**：充电吧必须认识每一种插头的具体类型，用 `instanceof` + 强转，脆弱又丑陋。
- **改一处动全身**：新增插头要改 `charge` 方法，违反了开闭原则。

引入适配器后，所有插头都被"统一"成 `EuroSocket` 这一个接口，充电吧只认 `EuroSocket`，新增插头只需加一个适配器类，老代码一行都不用动。

## 三、结构与角色

```text
        ┌────────────┐
        │  Client    │  只认 Target 接口
        └─────┬──────┘
              │ charge()
              ▼
        ┌────────────┐
        │  Target    │  客户端期望的接口（欧标插座）
        │ (接口)     │
        └─────▲──────┘
              │ 实现
        ┌─────┴─────────┐
        │   Adapter     │  适配器：实现 Target，持有 Adaptee
        │ (对象适配器)   │
        └─────┬─────────┘
              │ 持有/调用
        ┌─────▼──────┐
        │  Adaptee   │  被适配者：已有但接口不兼容（国标插头）
        │ (已有类)    │
        └────────────┘
```

| 角色 | 对应到充电例子 | 职责 |
| --- | --- | --- |
| **Target（目标接口）** | `EuroSocket` | 客户端期望调用的接口 |
| **Adaptee（被适配者）** | `ChinaPlug` | 已存在、功能正确、但接口不兼容的类 |
| **Adapter（适配器）** | `PlugAdapter` | 实现 Target，内部调用 Adaptee，完成"翻译" |
| **Client（客户端）** | 充电吧 / `main` | 只依赖 Target，对 Adaptee 的存在一无所知 |

## 四、代码实现

下面给出**对象适配器**（推荐，用组合）：

```java
package com.canoe.pattern.adapter;

// 目标接口：欧标插座，客户端只认这个
public interface EuroSocket {
    // 欧标供电
    void charge();
}
```

```java
package com.canoe.pattern.adapter;

// 被适配者：国标插头，功能正确但接口和欧标对不上
public class ChinaPlug {
    // 国标供电方式（两脚扁插）
    public void chargeWithChinaStandard() {
        System.out.println("国标插头通电：220V 两脚扁插，设备开始充电");
    }
}
```

```java
package com.canoe.pattern.adapter;

// 对象适配器：实现目标接口，内部持有被适配者（组合优于继承）
public class PlugAdapter implements EuroSocket {
    // 持有被适配者引用
    private ChinaPlug chinaPlug;

    // 通过构造器把国标插头"塞进"适配器
    public PlugAdapter(ChinaPlug chinaPlug) {
        this.chinaPlug = chinaPlug;
    }

    @Override
    public void charge() {
        System.out.println("适配器：把欧标插座信号转换为国标插头可识别的信号");
        // 翻译并委托给被适配者真正干活
        chinaPlug.chargeWithChinaStandard();
    }
}
```

```java
package com.canoe.pattern.adapter;

// 演示：出国旅游，用适配器把国标插头接到欧标插座上
public class AdapterDemo {
    public static void main(String[] args) {
        // 你带的国标插头
        ChinaPlug chinaPlug = new ChinaPlug();
        // 欧标插座 = 适配器包装后的国标插头
        EuroSocket euroSocket = new PlugAdapter(chinaPlug);
        // 客户端完全不知道里面是国标插头，只当欧标用
        euroSocket.charge();
    }
}
```

运行输出：

```text
适配器：把欧标插座信号转换为国标插头可识别的信号
国标插头通电：220V 两脚扁插，设备开始充电
```

## 五、类适配器 vs 对象适配器

**类适配器**用**继承**实现：适配器同时继承 Adaptee 并实现 Target。但 Java 是单继承，一旦 Adaptee 已是某个类的子类，这条路就被堵死，且适配器和 Adaptee 静态绑定、不够灵活。

```java
package com.canoe.pattern.adapter;

// 类适配器：继承被适配者 + 实现目标接口（受 Java 单继承限制）
public class PlugClassAdapter extends ChinaPlug implements EuroSocket {
    @Override
    public void charge() {
        System.out.println("类适配器：直接复用父类国标供电能力");
        // 直接调用从父类继承来的方法
        super.chargeWithChinaStandard();
    }
}
```

| 对比维度 | 类适配器（继承） | 对象适配器（组合，推荐） |
| --- | --- | --- |
| 实现方式 | 继承 Adaptee + 实现 Target | 实现 Target + 持有 Adaptee 引用 |
| 灵活性 | 低，编译期绑定 | 高，运行期可换 Adaptee |
| 受单继承限制 | 是，Adaptee 不能是 final、不能是别的类子类 | 否，Adaptee 可以是任意类 |
| 能否适配多个 Adaptee | 不能（只能继承一个） | 能（可持有多个引用或动态传入） |

实际开发**几乎都用对象适配器**，组合更灵活、更符合"组合复用原则"。

## 六、接口适配器（缺省适配器）

当一个**接口方法太多**，而你的实现类只关心其中一两个时，逐一把所有方法都实现一遍很痛苦。接口适配器（又称**缺省适配器**）用一个**抽象类空实现**接口的全部方法，你的子类只需重写关心的那几个。

以"智能家居遥控器"为例：遥控器功能一大堆，但一台老风扇只关心开关机。

```java
package com.canoe.pattern.adapter.defaults;

// 功能繁多的智能设备接口
public interface SmartDevice {
    void powerOn();
    void powerOff();
    void setVolume(int v);
    void setChannel(int c);
    void connectWifi(String ssid);
}
```

```java
package com.canoe.pattern.adapter.defaults;

// 缺省适配器：把所有方法都空实现，子类按需重写
public abstract class SmartDeviceAdapter implements SmartDevice {
    @Override
    public void powerOn() { /* 默认什么都不做 */ }
    @Override
    public void powerOff() { /* 默认什么都不做 */ }
    @Override
    public void setVolume(int v) { /* 默认什么都不做 */ }
    @Override
    public void setChannel(int c) { /* 默认什么都不做 */ }
    @Override
    public void connectWifi(String ssid) { /* 默认什么都不做 */ }
}
```

```java
package com.canoe.pattern.adapter.defaults;

// 老风扇：只关心开机、关机，其余方法一概不管
public class OldFan extends SmartDeviceAdapter {
    @Override
    public void powerOn() {
        System.out.println("老风扇：呼呼呼地转起来了");
    }

    @Override
    public void powerOff() {
        System.out.println("老风扇：安静了");
    }
}
```

JDK 里的经典例子就是 AWT/Swing 的 `MouseAdapter`、`WindowAdapter`——它们正是实现了 `MouseListener` / `WindowListener` 的空方法抽象类，你只想处理"点击"就不用把接口所有方法都写一遍。

## 七、优缺点

| 优点 | 缺点 |
| --- | --- |
| 让**不兼容的接口**可以协同工作，复用老代码 | 增加了一层间接调用，运行时多一次方法转发 |
| **符合开闭原则**：新增适配只需加适配器类 | 过度使用会让系统里充斥"转接头"，结构变绕 |
| **解耦**客户端与被适配者，双方互不知道对方存在 | 类适配器受 Java 单继承限制，Adaptee 不能是 final |
| 可以把多个旧系统统一成一致的新接口，方便整合 | 接口语义被"翻译"后，出问题时定位链路更长 |

## 八、适用场景

- **接入第三方/遗留系统**：对方接口已固定、改不动，你又必须调用它。
- **复用老类**：老模块功能正确但接口对不上新规范，用适配器包一层。
- **统一多个相似但接口不同**的外部服务（如多家支付/短信网关）。
- **接口适配器**场景：接口方法很多，而你的实现只关心少数几个。
- **适配不同数据格式**：如把旧 XML 接口适配成新 JSON 接口。

什么情况下**不要**用：如果两个接口本来就同源、只是名字不同，直接重构改名比加适配器更干净；当系统到处都是适配器，反而说明抽象分层出了问题。

## 九、在 JDK / 开源框架中的应用

- **`java.util.Arrays#asList(T... a)`**：把数组"适配"成 `List` 接口，让数组能当列表用。
- **`java.io.InputStreamReader` / `OutputStreamWriter`**：字节流（`InputStream`）适配成字符流（`Reader`），典型流适配器。
- **`java.sql` 与 `javax.sql`**：JDBC 把各家数据库驱动的不同实现，统一适配成标准的 JDBC 接口。
- **Spring `HandlerAdapter`**：DispathcerServlet 不直接调用 Controller，而是用各种 `HandlerAdapter` 把不同类型的 Handler（@Controller、HttpRequestHandler、Servlet 等）适配成统一的 `handle()` 调用。
- **Spring `Adapter` 在 AOP / 消息**中**：如 `MessageListenerAdapter` 把普通的 POJO 方法适配成 JMS 消息监听器。

它们这么设计，都是为了**在不改动已有实现的前提下，把它们接进一套统一的上层接口**。

## 十、与相近模式的区别

| 模式 | 目的 | 使用时机 | 与适配器的区别 |
| --- | --- | --- | --- |
| **桥接模式** | 设计之初就把抽象与实现分离，让两者独立变化 | 事先规划 | 适配器是**事后补救**兼容已有接口；桥接是**事前设计**防爆炸 |
| **装饰器模式** | 不改变接口，给对象**动态增加**职责 | 增强功能 | 装饰器**保持原接口不变**并叠加能力；适配器是**改变接口**以便对接 |

一句话记：适配器是"**改接口以对接**"，装饰器是"**保接口以加料**"，桥接是"**拆两维以扩展**"。

## 本篇小结

- **适配器本质**是一个"转接头"，把已有能力翻译成目标接口。
- **核心目的**是解决接口不兼容，让老类、第三方类能协同工作。
- 结构四角色：**Target、Adaptee、Adapter、Client**。
- **对象适配器**用组合，最常用，不受 Java 单继承限制。
- **类适配器**用继承，灵活度低，Adaptee 不能是 final。
- **接口适配器**用空实现的抽象类，减少无关方法的重写负担。
- JDK 中 `InputStreamReader`、`Arrays#asList` 都是适配器。
- Spring 的 `HandlerAdapter` 是适配器的典型工业级应用。
- 适配器**符合开闭原则**：新增适配只加类、不动老代码。
- 适配器**解耦**了客户端与被适配者，双方互不知晓。
- 别滥用：到处是转接头说明抽象分层可能出了问题。
- 记住口诀：**适配器改接口，装饰器保接口，桥接拆两维**。

## 参考链接

- [Refactoring Guru · 适配器模式](https://refactoringguru.cn/design-patterns/adapter)
- [Oracle JavaDoc · InputStreamReader](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/io/InputStreamReader.html)
- [Oracle JavaDoc · Arrays#asList](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Arrays.html#asList(T...))
- [Spring 官方文档 · HandlerAdapter](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/HandlerAdapter.html)
- [Head First Design Patterns（O'Reilly）](https://www.oreilly.com/library/view/head-first-design/9781492078005/)
- [维基百科 · Adapter pattern](https://en.wikipedia.org/wiki/Adapter_pattern)
- [IBM Developer · 设计模式：适配器模式](https://developer.ibm.com/articles/design-patterns-adapter/)

下一篇 → [08 装饰器模式](/java/design-pattern/decorator)
