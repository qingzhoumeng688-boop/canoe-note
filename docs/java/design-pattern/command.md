# 19 命令模式

命令模式（Command Pattern）是 GoF 23 种设计模式中的"行为型"成员。它把"发出请求"和"执行请求"这两件本该绑在一起的事拆开，中间塞进一个叫"命令"的对象——就像你去餐厅吃饭，不会自己冲进后厨抄起锅铲炒菜，而是写一张菜单交给服务员，服务员再转手交给厨师。这个"菜单"，就是命令模式最朴素的样子。

## 一、它是什么

一句话大白话：**把"你要我做某事"这句话，包装成一个对象**，于是"请求"本身也能被传递、排队、记录、撤销。

生活化比喻再想一个：你手里的电视遥控器，每一个按键背后都藏着一个命令——"开机""换台""调音量"。你按一下，遥控器并不真的去拧显像管，它只是把对应的命令发出去，真正干活的是电视机。遥控器（调用者）和电视机（接收者）因此彻底解耦。

官方定义（GoF）：*Encapsulate a request as an object, thereby letting you parameterize clients with different requests, queue or log requests, and support undoable operations.* 即"将一个请求封装成对象，从而让你可以用不同的请求参数化客户端、对请求排队或记录日志，并支持可撤销的操作"。

## 二、为什么需要它（不用会怎样）

假设你开了一家小餐馆，让"服务员"直接认识后厨的每一道菜。一旦菜单变长，服务员类就开始膨胀：

```java
package com.canoe.pattern.command.bad;

// 没有命令模式时，调用者被迫认识所有业务细节
public class BadWaiter {
    // 后厨（接收者）
    private Chef chef;

    public BadWaiter(Chef chef) {
        this.chef = chef;
    }

    // 每加一道菜，就要加一个 if 分支，方法无限膨胀
    public void handle(String dish) {
        if ("steak".equals(dish)) {
            chef.cookSteak();
        } else if ("noodle".equals(dish)) {
            chef.cookNoodle();
        } else if ("cake".equals(dish)) {
            chef.bakeCake();
        } else {
            throw new IllegalArgumentException("没有这道菜：" + dish);
        }
    }

    // 后厨，接收者
    public static class Chef {
        public void cookSteak() {
            System.out.println("厨师：煎一份七分熟牛排");
        }
        public void cookNoodle() {
            System.out.println("厨师：煮一碗番茄鸡蛋面");
        }
        public void bakeCake() {
            System.out.println("厨师：烤一个草莓蛋糕");
        }
    }
}
```

这段代码的痛点很清晰：

- **改一处动全身**：加一道"烤鸭"，必须改 `BadWaiter.handle` 这个方法，违反了开闭原则。
- **if-else 膨胀**：菜越多，分支越长，方法越来越难读、难测。
- **调用者与接收者强耦合**：服务员必须认识厨师和每道菜的做法，没法把"点餐"这件事单独存起来、延迟执行、或者批量下单。

引入命令模式后，"点什么菜"变成了一个个 `Command` 对象，服务员只管收命令、触发命令，完全不认识厨师怎么做菜。新增菜品只要新增一个命令类，旧代码一行都不用动。

## 三、结构与角色

```text
        ┌──────────┐
        │  Client  │  创建命令，并指定接收者
        └────┬─────┘
             │ new SteakCommand(chef)
             ▼
        ┌──────────┐     实现      ┌──────────────────┐
        │  Waiter  │◀──────────────│    Command       │
        │ (Invoker)│        ┌──────│  (命令接口)       │
        │  服务员  │        │      │  + execute()      │
        └────┬─────┘        │      └────────┬─────────┘
             │ takeOrder /  │               │ implements
             │ placeOrders  │      ┌────────┴─────────┐
             │              │      │ SteakCommand     │
             │              │      │ NoodleCommand    │
             │              │      │ CakeCommand      │
             └──────────────┼──────│ (具体命令)        │
                            │      │ - chef: Chef     │
                            │      │ + execute()      │
                            │      └────────┬─────────┘
                            │               │ 调用
                            │               ▼
                            │      ┌──────────────────┐
                            │      │     Chef         │
                            │      │ (Receiver 接收者) │
                            │      │ + cookSteak()    │
                            │      │ + cookNoodle()   │
                            │      └──────────────────┘
                            │
                    持有 / 触发命令
```

| 角色 | 对应类 | 职责 |
| --- | --- | --- |
| 命令接口 Command | `Command` | 声明执行动作的方法 `execute()` |
| 具体命令 ConcreteCommand | `SteakCommand` 等 | 绑定一个接收者，调用其方法完成请求 |
| 接收者 Receiver | `Chef` | 真正执行业务逻辑的对象 |
| 调用者 Invoker | `Waiter` | 持有命令，在合适时机触发 `execute()` |
| 客户 Client | `Client` | 创建命令并指定接收者，组装好交给调用者 |

**角色的作用**：`Command` 是连接调用者和接收者的"桥"，它让"请求"第一次具备了对象的身份，于是请求可以被存储、传递、组合、撤销——这是命令模式能玩出花样的根。

## 四、代码实现

接收者：真正炒菜的厨师。

```java
package com.canoe.pattern.command;

// 接收者：厨师，真正干活的人
public class Chef {
    public void cookSteak() {
        System.out.println("厨师：煎一份七分熟西冷牛排");
    }

    public void cookNoodle() {
        System.out.println("厨师：煮一碗番茄鸡蛋面");
    }

    public void bakeCake() {
        System.out.println("厨师：烤一个草莓蛋糕");
    }
}
```

命令接口与具体命令：

```java
package com.canoe.pattern.command;

// 命令接口：所有订单都要实现 execute
public interface Command {
    void execute();
}
```

```java
package com.canoe.pattern.command;

// 具体命令：点牛排
public class SteakCommand implements Command {
    // 绑定接收者
    private Chef chef;

    public SteakCommand(Chef chef) {
        this.chef = chef;
    }

    @Override
    public void execute() {
        chef.cookSteak();
    }
}
```

```java
package com.canoe.pattern.command;

// 具体命令：点面条
public class NoodleCommand implements Command {
    private Chef chef;

    public NoodleCommand(Chef chef) {
        this.chef = chef;
    }

    @Override
    public void execute() {
        chef.cookNoodle();
    }
}
```

```java
package com.canoe.pattern.command;

// 具体命令：点蛋糕
public class CakeCommand implements Command {
    private Chef chef;

    public CakeCommand(Chef chef) {
        this.chef = chef;
    }

    @Override
    public void execute() {
        chef.bakeCake();
    }
}
```

调用者：只收单、下单，不关心怎么做。

```java
package com.canoe.pattern.command;

import java.util.ArrayList;
import java.util.List;

// 调用者：服务员，只负责收订单、统一下单
public class Waiter {
    // 缓存这一轮点的所有菜
    private List<Command> orders = new ArrayList<Command>();

    // 顾客点单：记下来，但不立刻做
    public void takeOrder(Command command) {
        orders.add(command);
        System.out.println("服务员：收到订单，已记录");
    }

    // 统一把订单交给后厨
    public void placeOrders() {
        for (Command command : orders) {
            command.execute();
        }
        orders.clear();
    }
}
```

客户端：顾客点餐。

```java
package com.canoe.pattern.command;

// 顾客（客户端）：点餐
public class Client {
    public static void main(String[] args) {
        Chef chef = new Chef();
        Command steak = new SteakCommand(chef);
        Command noodle = new NoodleCommand(chef);
        Command cake = new CakeCommand(chef);

        Waiter waiter = new Waiter();
        waiter.takeOrder(steak);
        waiter.takeOrder(noodle);
        waiter.takeOrder(cake);

        System.out.println("------ 服务员统一下单给后厨 ------");
        waiter.placeOrders();
    }
}
```

输出：

```text
服务员：收到订单，已记录
服务员：收到订单，已记录
服务员：收到订单，已记录
------ 服务员统一下单给后厨 ------
厨师：煎一份七分熟西冷牛排
厨师：煮一碗番茄鸡蛋面
厨师：烤一个草莓蛋糕
```

## 五、命令模式与"撤销/重做"

命令模式最迷人的能力是**撤销（undo）**：只要给每个命令加一个 `undo()`，再把执行过的命令压进栈，弹栈调用 `undo()` 即可回退。下面用一个极简文本编辑器演示。

接收者与命令接口（带撤销）：

```java
package com.canoe.pattern.command.undo;

// 接收者：一个简单的文本编辑器
public class TextEditor {
    private StringBuilder text = new StringBuilder();

    public void append(String s) {
        text.append(s);
    }

    // 删除末尾指定长度的字符
    public void delete(int length) {
        int start = Math.max(0, text.length() - length);
        text.delete(start, text.length());
    }

    public String getText() {
        return text.toString();
    }
}
```

```java
package com.canoe.pattern.command.undo;

// 支持撤销的命令接口
public interface UndoableCommand {
    void execute();
    void undo();
}
```

```java
package com.canoe.pattern.command.undo;

// 追加文本命令：undo 就是把刚加进去的内容删掉
public class AppendCommand implements UndoableCommand {
    private TextEditor editor;
    private String added;

    public AppendCommand(TextEditor editor, String added) {
        this.editor = editor;
        this.added = added;
    }

    @Override
    public void execute() {
        editor.append(added);
    }

    @Override
    public void undo() {
        editor.delete(added.length());
    }
}
```

调用者：持有撤销栈。

```java
package com.canoe.pattern.command.undo;

import java.util.Stack;

// 调用者：持有历史栈，支持撤销
public class EditorInvoker {
    private Stack<UndoableCommand> history = new Stack<UndoableCommand>();

    // 执行并记录
    public void run(UndoableCommand command) {
        command.execute();
        history.push(command);
    }

    // 撤销最近一次
    public void undo() {
        if (!history.isEmpty()) {
            history.pop().undo();
        }
    }
}
```

```java
package com.canoe.pattern.command.undo;

// 客户端演示撤销
public class UndoClient {
    public static void main(String[] args) {
        TextEditor editor = new TextEditor();
        EditorInvoker invoker = new EditorInvoker();

        invoker.run(new AppendCommand(editor, "你好"));
        invoker.run(new AppendCommand(editor, "世界"));
        System.out.println("当前内容：" + editor.getText());

        invoker.undo();
        System.out.println("撤销一次：" + editor.getText());

        invoker.undo();
        System.out.println("再撤销：" + editor.getText());
    }
}
```

输出：

```text
当前内容：你好世界
撤销一次：你好
再撤销：
```

**要点**：重做（redo）只需再准备一个"重做栈"，`undo()` 时把命令压进重做栈、`redo()` 时弹出来重新 `execute()` 即可。这也是绝大多数编辑器（IDEA、Word、Photoshop）Undo/Redo 的底层思路。

## 六、命令模式与队列/日志

因为命令是一个**对象**，它天然可以：

- **入队**：把命令塞进 `Queue<Command>`，后台线程慢慢消费，这就是"任务调度"。
- **序列化**：命令实现 `Serializable` 后写到磁盘，进程崩溃重启后重新读出执行——这就是数据库 **WAL（Write-Ahead Log，预写日志）** 与消息队列"至少一次投递"的思想源头。

一个命令队列的小例子：

```java
package com.canoe.pattern.command.queue;

import java.util.LinkedList;
import java.util.Queue;

// 命令队列：把命令当任务塞进队列，后台线程逐个消费
public class CommandQueue {
    private Queue<Command> queue = new LinkedList<Command>();

    // 提交任务
    public void submit(Command command) {
        queue.offer(command);
    }

    // 一次性执行队列里所有命令
    public void runAll() {
        Command cmd;
        while ((cmd = queue.poll()) != null) {
            cmd.execute();
        }
    }
}
```

结合上面餐厅的例子，`Waiter` 完全可以把订单 `Command` 先 `submit` 进队列，后厨按单子顺序出菜，高峰期还能限流——命令模式让"异步""削峰""可追溯"都变得自然。

## 七、实际应用

- **线程池的 `Runnable`**：你提交给线程池的每一个 `Runnable` 都是一个命令，`ThreadPoolExecutor`（调用者）在空闲线程上执行它，与你何时、何地创建它毫无关系。
- **消息队列（MQ）的消息体**：一条 JSON/二进制消息就是一条命令，消费者（接收者）收到后执行对应业务逻辑，生产者和消费者解耦。
- **GUI 的菜单/按钮**：一个"保存"按钮绑定一个 `SaveCommand`，菜单项、快捷键、工具栏可以共用同一个命令对象，无需各写一遍逻辑。
- **事务与补偿**：分布式系统里"下单""扣库存"都可封装成命令，失败时用反向命令做补偿。

## 八、优缺点

| 优点 | 缺点 |
| --- | --- |
| **解耦调用者与接收者**，双方互不知晓细节 | 类数量膨胀：每个命令一个类，命令一多类爆炸 |
| **支持撤销/重做**，只需加 `undo()` | 简单场景引入反而增加理解成本 |
| **支持队列、日志、延迟执行**，扩展性强 | 命令接口一旦定义，想给所有命令加新方法较麻烦 |
| **符合开闭原则**，新增命令不改动旧代码 | 需要额外管理命令的生命周期（如栈、队列） |
| 易于组合宏命令（一个命令包含多个子命令） | 过度设计风险：能一行搞定的别硬套 |

## 九、适用场景

- 需要把"动作"当作参数传来传去（如回调、回调式 API）。
- 需要实现撤销/重做（编辑器、配置中心回滚）。
- 需要把请求排队、异步执行或记录日志（任务调度、MQ）。
- 需要一套统一的"操作"抽象，让菜单、按钮、快捷键共用（GUI 框架）。

**什么时候不要用**：业务逻辑就一行、且未来几乎不会扩展时，直接调用方法更简单，硬套命令模式只会徒增类。

## 十、在 JDK / 开源框架中的应用

- **JDK `java.lang.Runnable`**：最经典的命令接口，`run()` 就是 `execute()`，线程池、定时器都靠它解耦"任务"与"执行"。
- **JDK `java.util.concurrent.Callable<V>`**：带返回值的命令，配合 `FutureTask` 使用。
- **Swing `javax.swing.Action`**：一个 `Action` 同时携带"做什么"和"按钮上显示什么文字/图标/快捷键"，是命令模式 + 状态的组合。
- **Spring `org.springframework.core.task.TaskExecutor`**：`execute(Runnable)` 把 `Runnable`（命令）交给线程执行，正是命令模式的调度形态。

为什么这么设计：`Runnable` 把"任务定义"和"任务执行"彻底分开，才让线程池能复用线程、能排队、能限流——这正是命令模式价值的体现。

## 十一、与相近模式的区别

| 对比 | 命令模式 | 策略模式 | 职责链模式 |
| --- | --- | --- | --- |
| 目的 | 把请求封装成对象，支持撤销/队列/日志 | 封装"算法"，让算法可互换 | 多个处理器依次尝试处理同一请求 |
| 结构 | 调用者持有单个命令并触发 | 上下文持有单个策略并委托 | 处理器串成链，请求沿链传递 |
| 关注点 | **请求本身**可被存储/传递 | **怎么做**这件事可替换 | **谁来处理**这件事不确定 |
| 典型场景 | 遥控器按键、Undo/Redo | 排序算法切换、折扣策略 | 审批流、过滤器链 |

一句话区分：策略和命令都"包了一层"，但**策略换的是算法、命令包的是动作**；命令和职责链都解耦请求与处理，但**命令一对一、职责链一对多沿链走**。

## 本篇小结

- **命令模式把"请求"封装成对象**，让请求能像数据一样被传递、存储、延迟。
- **调用者与接收者彻底解耦**，新增动作只加命令类，不动旧代码（开闭原则）。
- **核心是 `Command` 接口**，通常只定义 `execute()` 一个方法。
- **具体命令绑定一个接收者**，在 `execute()` 里调用接收者的业务方法。
- **撤销靠 `undo()` + 栈**：执行入栈、撤销弹栈回放反向操作。
- **重做靠"重做栈"**：撤销时把命令挪到重做栈，`redo()` 重新执行。
- **命令可入队**：实现任务调度、削峰、异步执行。
- **命令可序列化**：落盘后宕机恢复，是 WAL 与 MQ 的思想源头。
- **JDK 的 `Runnable`/`Callable` 就是命令模式**，线程池是现成的最佳范例。
- **GUI 的按钮/菜单共用命令对象**，避免到处重复业务代码。
- **缺点是指令一多类会爆炸**，简单场景别过度设计。
- **它与策略、职责链易混**：记住"策略换算法、命令包动作、职责链沿链走"。

## 参考链接

- [Refactoring Guru · Command Pattern（中文）](https://refactoringguru.cn/design-patterns/command)
- [Refactoring Guru · Command Pattern（英文）](https://refactoring.guru/design-patterns/command)
- [菜鸟教程 · 命令模式](https://www.runoob.com/design-pattern/command-pattern.html)
- [图说设计模式 · 命令模式](https://design-patterns.readthedocs.io/zh_CN/latest/behavioral_patterns/command.html)
- [Wikipedia · Command pattern](https://en.wikipedia.org/wiki/Command_pattern)
- [Oracle Java Docs · Runnable](https://docs.oracle.com/javase/8/docs/api/java/lang/Runnable.html)
- [Spring Docs · TaskExecutor](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/task/TaskExecutor.html)

下一篇 → [20 状态模式](/java/design-pattern/state)
