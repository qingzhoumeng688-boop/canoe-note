# 20 状态模式

状态模式（State Pattern）同样是 GoF 的"行为型"模式。它解决的是一类非常常见的问题：**一个对象的行为会随着内部状态改变而改变**。电梯在"开门"时不能运行、在"运行"时不能开门——这些规矩如果用一堆 `if (state == 开门)` 去写，很快就会变成谁都不敢碰的意大利面条。状态模式的解法是：把每一种状态都做成一个类，让状态对象自己决定"在这个状态下能做什么、做完要切到哪个状态"。

## 一、它是什么

一句话大白话：**对象有不同的"心情"，每种心情下对同一句话的反应不一样；把这些心情各自封装成类，对象只要把请求甩给当前心情就行。**

生活化比喻：红绿灯。红灯说"停"、绿灯说"行"、黄灯说"等"——同一个路口，你对它喊"走"，得到的回答完全取决于它此刻亮的是哪盏灯。灯的状态变了，路口的行为就变了，而你（司机）不需要关心背后逻辑。

官方定义（GoF）：*Allow an object to alter its behavior when its internal state changes. The object will appear to change its class.* 即"允许一个对象在其内部状态改变时改变它的行为，对象看起来就像修改了它所属的类"。

## 二、为什么需要它（不用会怎样）

先看一下"不用状态模式"的电梯：用一个 `int` 表示状态，所有动作都靠 `switch` 分发。

```java
package com.canoe.pattern.state.bad;

// 没有状态模式：用常量 + switch 描述电梯行为（痛苦版）
public class BadElevator {
    // 状态常量
    private static final int OPEN = 1;
    private static final int CLOSE = 2;
    private static final int RUN = 3;
    private static final int STOP = 4;

    private int state = CLOSE;

    public void open() {
        switch (state) {
            case OPEN:
                System.out.println("门已经是开着的");
                break;
            case CLOSE:
                System.out.println("开门");
                state = OPEN;
                break;
            case RUN:
                System.out.println("运行状态下禁止开门");
                break;
            case STOP:
                System.out.println("开门");
                state = OPEN;
                break;
            default:
                break;
        }
    }

    public void close() {
        switch (state) {
            case OPEN:
                System.out.println("关门");
                state = CLOSE;
                break;
            case CLOSE:
                System.out.println("门已经是关着的");
                break;
            case RUN:
                System.out.println("运行状态下门已关");
                break;
            case STOP:
                System.out.println("停止状态下门已关");
                break;
            default:
                break;
        }
    }

    // run() / stop() 还要再写两个同样臃肿的 switch ...
}
```

这段代码的问题：

- **状态逻辑散落**：每种动作里都要把 4 个状态分支写一遍，动作越多、分支越密。
- **改动牵一发动全身**：新增一个"故障"状态，要改 `open/close/run/stop` 四个方法的所有 `switch`，极易漏改。
- **违背单一职责**：`BadElevator` 既要管"当前是什么状态"，又要管"每个状态下能做什么"，两件事搅在一起。

状态模式把"每个状态下能做什么"搬进各自的状态类，上面的四个 `switch` 瞬间消失。

## 三、结构与角色

```text
        ┌───────────────────────────┐
        │        Context           │  电梯（环境类）
        │  - currentState:State     │  持有当前状态，把请求委派给它
        │  + open() / close()       │
        │  + run()  / stop()        │
        │  + setState(State)        │◀──────────────┐
        └────────────┬──────────────┘               │ 回调切状态
                     │ 委托                          │
                     ▼                              │
        ┌───────────────────────────┐               │
        │         State             │  抽象状态     │
        │  + open()                 │              │
        │  + close()                │              │
        │  + run()                  │              │
        │  + stop()                 │              │
        └────────────┬──────────────┘              │
        ┌────────────┼────────────┬──────────┐     │
        ▼            ▼            ▼          ▼      │
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
   │ OpenState│ │CloseState│ │ RunState │ │StopState │ │
   │ 开门状态 │ │ 关门状态 │ │ 运行状态 │ │ 停止状态 │ │
   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ │
        │ 在各自方法里调用 context.setState(...) ─────┘
```

| 角色 | 对应类 | 职责 |
| --- | --- | --- |
| 环境类 Context | `Context`（电梯） | 持有当前状态对象，把外部请求委托给当前状态 |
| 抽象状态 State | `LiftState` | 定义每个状态下可响应的动作接口 |
| 具体状态 ConcreteState | `OpenState` 等 | 实现各动作，并在合适时把 Context 切到下一个状态 |

**角色的作用**：`State` 把"状态相关的行为"局部化到状态类里；`Context` 只负责"我现在是谁的状态"，真正的决策权交出去——这叫**行为随状态迁移而迁移**。

## 四、代码实现

抽象状态：

```java
package com.canoe.pattern.state;

// 抽象状态：定义电梯在每种状态下能响应的动作
public abstract class LiftState {
    // 反向持有环境，方便在状态内部切换状态
    protected Context context;

    public void setContext(Context context) {
        this.context = context;
    }

    public abstract void open();
    public abstract void close();
    public abstract void run();
    public abstract void stop();
}
```

四个具体状态：

```java
package com.canoe.pattern.state;

// 开门状态：门已开，不能运行，只能关门
public class OpenState extends LiftState {
    @Override
    public void open() {
        System.out.println("电梯门已经是开着的");
    }

    @Override
    public void close() {
        System.out.println("关门");
        context.setState(context.closeState());
    }

    @Override
    public void run() {
        System.out.println("开门状态下不能运行，请先关门");
    }

    @Override
    public void stop() {
        System.out.println("开门状态下本就处于停靠");
    }
}
```

```java
package com.canoe.pattern.state;

// 关门状态：门已关，可以开门、运行或停止
public class CloseState extends LiftState {
    @Override
    public void open() {
        System.out.println("开门");
        context.setState(context.openState());
    }

    @Override
    public void close() {
        System.out.println("电梯门已经是关着的");
    }

    @Override
    public void run() {
        System.out.println("运行");
        context.setState(context.runState());
    }

    @Override
    public void stop() {
        System.out.println("停止");
        context.setState(context.stopState());
    }
}
```

```java
package com.canoe.pattern.state;

// 运行状态：运行中，禁止开门，可停止
public class RunState extends LiftState {
    @Override
    public void open() {
        System.out.println("运行状态下禁止开门");
    }

    @Override
    public void close() {
        System.out.println("运行状态下门已经是关着的");
    }

    @Override
    public void run() {
        System.out.println("电梯正在运行中");
    }

    @Override
    public void stop() {
        System.out.println("停止");
        context.setState(context.stopState());
    }
}
```

```java
package com.canoe.pattern.state;

// 停止状态：已停靠，可开门或继续运行
public class StopState extends LiftState {
    @Override
    public void open() {
        System.out.println("开门");
        context.setState(context.openState());
    }

    @Override
    public void close() {
        System.out.println("停止状态下门本就是关着的");
    }

    @Override
    public void run() {
        System.out.println("运行");
        context.setState(context.runState());
    }

    @Override
    public void stop() {
        System.out.println("电梯已经停下了");
    }
}
```

环境类：持有状态并委派请求。

```java
package com.canoe.pattern.state;

// 环境类：电梯，持有一个当前状态，并把请求委派给当前状态
public class Context {
    // 延迟创建各状态实例的工厂方法，避免共享可变状态带来的串扰
    public LiftState openState() {
        return new OpenState();
    }

    public LiftState closeState() {
        return new CloseState();
    }

    public LiftState runState() {
        return new RunState();
    }

    public LiftState stopState() {
        return new StopState();
    }

    // 当前状态
    private LiftState currentState;

    public Context() {
        // 初始为关门状态
        setState(closeState());
    }

    public void setState(LiftState state) {
        this.currentState = state;
        // 把环境回灌给状态，方便状态内部切状态
        this.currentState.setContext(this);
    }

    // 以下四个方法全部委托给当前状态
    public void open() {
        this.currentState.open();
    }

    public void close() {
        this.currentState.close();
    }

    public void run() {
        this.currentState.run();
    }

    public void stop() {
        this.currentState.stop();
    }
}
```

客户端：

```java
package com.canoe.pattern.state;

// 客户端演示：模拟一次完整乘梯流程
public class Client {
    public static void main(String[] args) {
        Context elevator = new Context();
        elevator.open();   // 关门 -> 开门
        elevator.close();  // 开门 -> 关门
        elevator.run();    // 关门 -> 运行
        elevator.stop();   // 运行 -> 停止
        elevator.open();   // 停止 -> 开门
    }
}
```

输出：

```text
开门
关门
运行
停止
开门
```

## 五、状态模式 vs if-else / switch 状态机

第二节那段 `BadElevator` 就是最典型的反面教材：4 个状态 × 4 个动作 = 16 个分支散落在 4 个 `switch` 里。一旦要加"故障态"，你得在 4 处同时动手，漏掉一处就是 bug。

重构为状态模式后：

- **分支消失**：`open/close/run/stop` 在 `Context` 里只剩一行委托：`currentState.xxx()`。
- **状态自洽**：每个状态类只关心"我在此时能做什么、做完去哪"，逻辑内聚。
- **扩展安全**：新增状态只要新建一个 `XxxState` 类并在 `Context` 加一个工厂方法，旧状态类一行不用改。

代价是**类变多了**——这是用"类数量"换"分支复杂度"，通常非常划算。

## 六、状态流转由谁驱动

状态切换有两条路线，上面例子用的是**状态类自驱动**：`OpenState.close()` 里主动调 `context.setState(context.closeState())`。优点是切换逻辑内聚在状态里，调用者无感知；缺点是状态类之间会产生依赖（每个状态要知道"下一个状态是谁"）。

另一种叫**环境类驱动**：`Context` 在业务方法里根据返回值决定切到哪个状态，状态类只回报"能不能做"，不碰切换。优点是状态类之间零依赖、更纯粹；缺点是 `Context` 重新承担了部分流转判断。

经验法则：**状态少、流转规则稳定 → 状态自驱动更清爽；状态多、流转复杂 → 环境驱动或引入一张"状态表"集中管理**，避免状态类之间盘根错节。

## 七、实际应用

- **订单状态机**：待支付 → 已支付 → 已发货 → 已完成 → 已退款，每个状态对"取消""发货"的响应天差地别。
- **审批流**：草稿 → 待审批 → 已通过/已驳回，审批动作只在特定状态合法。
- **TCP 连接状态**：CLOSED / LISTEN / ESTABLISHED / TIME_WAIT，收发包行为随状态变化。
- **线程状态**：NEW / RUNNABLE / BLOCKED / TERMINATED，不同状态下对 `start()`、`wait()` 反应不同。

## 八、优缺点

| 优点 | 缺点 |
| --- | --- |
| **消除庞大的条件分支**，代码清爽 | 状态类数量增加，简单场景偏重 |
| **状态相关行为局部化**，符合单一职责 | 状态自驱动时状态类相互依赖 |
| **新增状态只加类**，符合开闭原则 | 状态太多时切换逻辑分散，需集中管理 |
| 运行时行为随状态平滑切换 | 共享状态时要注意实例隔离，避免串扰 |
| 易于为每个状态独立做单元测试 | 初学者容易和策略模式混淆 |

## 九、适用场景

- 对象行为依赖状态，且状态较多、状态间有清晰流转规则。
- 代码里出现大量 `if (state == X)` / `switch (state)` 且随状态增长而膨胀。
- 状态转换规则需要集中、显式、可维护（如订单、审批、连接）。

**什么时候不要用**：状态只有两三种、分支很少时，直接 `if` 更简单；若状态会频繁新增且每种状态行为差异极小，也要权衡是否值得拆类。

## 十、在 JDK / 开源框架中的应用

- **JDK 线程状态机**：`java.lang.Thread` 内部用状态（`NEW`/`RUNNABLE`/`BLOCKED`/`TERMINATED` 等）约束 `start()`、`sleep()`、`wait()` 的合法性，本质就是状态模式思想。
- **Servlet 生命周期**：`javax.servlet.Servlet` 的 `init` / `service` / `destroy` 由容器按状态调用，不同阶段做不同事。
- **Spring 状态机 `spring-statemachine`**：官方把状态模式做成框架，用 `State`、`Transition`、`StateMachine` 描述完整状态机，常用于订单、工单流转。
- **工作流引擎（Activiti/Flowable）**：节点即状态，流转即 `setState`，是状态模式在 BPM 领域的工业化版本。

为什么这么设计：把"状态"从散落的 `if` 里抽出来，系统在新增状态时不用通读全部旧逻辑，安全性与可维护性都上一个台阶。

## 十一、与相近模式的区别

| 对比 | 状态模式 | 策略模式 |
| --- | --- | --- |
| 目的 | 让对象随内部状态自动改变行为 | 让对象在运行时切换"算法/策略" |
| 谁切类 | **状态自己**驱动切换（`setState`） | **客户端**主动选择并注入策略 |
| 状态间关系 | 状态彼此知晓流转关系（常相互切换） | 策略彼此独立、可互换、互不知晓 |
| 典型场景 | 电梯、订单、TCP 连接 | 排序算法、折扣计算、压缩方式 |

一句话区分：**策略是"我替你选个算法"，状态是"我自己会随情况变算法"**；策略由外部注入、状态由内部迁移。

## 本篇小结

- **状态模式让对象行为随内部状态改变**，看起来像换了类。
- **核心是把每种状态封装成类**，状态相关行为局部化、内聚。
- **`Context` 持有当前 `State`**，所有请求委托给当前状态处理。
- **状态切换可自驱动**：在状态方法里调 `context.setState(...)` 切到下一态。
- **它消除了膨胀的 `if/switch`**，新增状态只加类、不动旧代码。
- **切换驱动分两派**：状态自驱动（内聚）与环境驱动（状态零依赖）。
- **缺点是类会增多**，简单两态场景不必硬上。
- **订单、审批流、TCP、线程状态**都是它的典型战场。
- **JDK 线程状态、Servlet 生命周期**暗含状态模式思想。
- **Spring Statemachine / 工作流引擎**是状态模式的工业化产品。
- **别和策略模式混**：策略由外部注入算法，状态由内部迁移行为。

## 参考链接

- [Refactoring Guru · State Pattern（中文）](https://refactoringguru.cn/design-patterns/state)
- [Refactoring Guru · State Pattern（英文）](https://refactoring.guru/design-patterns/state)
- [菜鸟教程 · 状态模式](https://www.runoob.com/design-pattern/state-pattern.html)
- [图说设计模式 · 状态模式](https://design-patterns.readthedocs.io/zh_CN/latest/behavioral_patterns/state.html)
- [Wikipedia · State pattern](https://en.wikipedia.org/wiki/State_pattern)
- [Spring Statemachine 官方文档](https://spring.io/projects/spring-statemachine)
- [Oracle Java Docs · Thread.State](https://docs.oracle.com/javase/8/docs/api/java/lang/Thread.State.html)

下一篇 → [21 备忘录模式](/java/design-pattern/memento)
