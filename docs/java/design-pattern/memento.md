# 21 备忘录模式

> 本篇导读：打 Boss 前先存个档，死了就回档重来——这是每个玩家刻进 DNA 的习惯。备忘录模式干的就是这件事：在不破坏对象封装的前提下，把对象某个时刻的内部状态"快照"下来，之后随时能原样恢复。它解决的是**如何保存和恢复状态，同时又不让外部代码窥探或篡改状态**的难题。

## 一、它是什么

一句话大白话：**备忘录模式像一个"时光胶囊"，把对象此刻的状态封进一个盒子存起来，将来想回到这一刻，直接打开盒子还原即可。**

生活化比喻：玩 RPG 游戏时按的"保存"按钮。存档文件里记录了你的等级、血量、坐标，但游戏外的你不能拿记事本去把血量改成 99999——存档对你是**只读**的。真要改，也得通过游戏自身的"读档"功能。

GoF 的官方定义是：

> Without violating encapsulation, capture and externalize an object's internal state so that the object can be restored to this state later.
>
> （在不破坏封装性的前提下，捕获一个对象的内部状态，并在该对象之外保存这个状态，以便以后将对象恢复到原先保存的状态。）

## 二、为什么需要它（不用会怎样）

先看一段"裸奔"的反面代码：为了能回档，直接把角色的内部字段公开给调用方管理。

```java
// 反例：把内部状态直接暴露，封装被彻底破坏
public class BadGameRole {
    public String name;   // 谁都能改
    public int hp;        // 谁都能改
    public int mp;
    public int level;

    // 想存档？调用方自己拿字段去拼一个 HashMap 存着
    // 想读档？调用方自己把这些字段写回来
    // 问题：外部可以随手把 hp 改成 999999，毫无防备
}
```

痛点：

1. **封装被破坏**：`hp`、`mp` 全部 `public`，任何代码都能篡改，存档失去意义。
2. **状态不一致风险**：调用方手动拼装/还原，漏一个字段就"半身不遂"。
3. **职责错位**："怎么存、存什么"这种本属于角色自己的事，被甩给了外部。

备忘录模式让**角色自己决定存什么、怎么存**，而把"盒子"交给一个管理者保管，盒子对外只读——封装与恢复两不误。

## 三、结构与角色

```text
   ┌──────────────┐       创建/恢复        ┌──────────────┐
   │  Originator  │ ───────────────────▶ │   Memento    │
   │  (发起人/角色)│ ◀─────────────────── │  (备忘录/存档) │
   └──────┬───────┘       读取状态         └──────┬───────┘
          │                                       │ 只提供只读 getter
          │                                       │
          │           保存 / 取回                   │
          └──────────▶ ┌──────────────┐ ◀─────────┘
                       │  Caretaker   │  管理者只管存取，不读内容
                       │  (管理者/存档槽)│
                       └──────────────┘
```

| 角色 | 类名（示例） | 职责 |
| --- | --- | --- |
| 发起人 Originator | `GameRole` | 创建备忘录保存自身状态，也能用备忘录恢复自己 |
| 备忘录 Memento | `Memento` | 存储 Originator 的内部状态，对外仅提供只读访问 |
| 管理者 Caretaker | `Caretaker` | 负责保存、管理多个备忘录，但**绝不修改或查看**其内容 |

## 四、代码实现

以 RPG 角色打 Boss 前后存档/读档为例，三个角色齐活，可直接运行。

```java
package com.canoe.pattern.memento;

// 备忘录：只存状态，对外只提供只读 getter，无法被篡改
public class Memento {
    private final String roleName;
    private final int hp;
    private final int mp;
    private final int level;

    // 构造由发起人调用，外部拿不到修改入口
    public Memento(String roleName, int hp, int mp, int level) {
        this.roleName = roleName;
        this.hp = hp;
        this.mp = mp;
        this.level = level;
    }

    public String getRoleName() { return roleName; }
    public int getHp() { return hp; }
    public int getMp() { return mp; }
    public int getLevel() { return level; }
}
```

```java
package com.canoe.pattern.memento;

// 发起人：游戏角色，自己决定存什么、怎么恢复
public class GameRole {
    private String roleName;
    private int hp;
    private int mp;
    private int level;

    public GameRole(String roleName) {
        this.roleName = roleName;
        this.hp = 100;
        this.mp = 100;
        this.level = 1;
    }

    // 打 Boss：扣血扣蓝
    public void fightBoss() {
        this.hp -= 80;
        this.mp -= 50;
    }

    // 升级
    public void levelUp() {
        this.level += 1;
    }

    // 创建存档：把当前状态封进备忘录
    public Memento save() {
        return new Memento(roleName, hp, mp, level);
    }

    // 恢复存档：用备忘录把状态原样还原
    public void restore(Memento memento) {
        this.roleName = memento.getRoleName();
        this.hp = memento.getHp();
        this.mp = memento.getMp();
        this.level = memento.getLevel();
    }

    public void showState() {
        System.out.println("角色[" + roleName + "] 等级=" + level
                + " HP=" + hp + " MP=" + mp);
    }
}
```

```java
package com.canoe.pattern.memento;

import java.util.Stack;

// 管理者：负责保管多个存档，但只存不读
public class Caretaker {
    private final Stack<Memento> history = new Stack<Memento>();

    // 存一个存档
    public void save(Memento memento) {
        history.push(memento);
    }

    // 取最近一次存档（撤销）
    public Memento undo() {
        return history.pop();
    }
}
```

```java
package com.canoe.pattern.memento;

// 演示入口
public class MementoDemo {
    public static void main(String[] args) {
        GameRole role = new GameRole("勇者小柯");
        role.showState();

        // 打 Boss 前先存档
        Caretaker caretaker = new Caretaker();
        caretaker.save(role.save());

        // 打 Boss 升级又掉血
        role.levelUp();
        role.fightBoss();
        System.out.println("打完 Boss 后：");
        role.showState();

        // 读档，满血复活
        role.restore(caretaker.undo());
        System.out.println("使用存档恢复后：");
        role.showState();
    }
}
```

运行后你会看到：升级打怪把血量打到 20，一句 `restore()` 就满血回到了存档点。

## 五、白箱实现 vs 黑箱实现

**白箱实现（宽接口）**：备忘录的状态对所有人可见（如上一节的 `getHp()` 全是 public 的），外界理论上能读。实现简单，但封装性较弱。

**黑箱实现（窄接口）**：让 `Memento` 对外暴露一个**空接口**，真正的状态藏在发起人的**私有内部类**里。管理者只拿到空接口引用，根本无法访问内部字段；只有发起人有资格强转回去。

```java
package com.canoe.pattern.memento;

// 空接口：对 Caretaker 而言，备忘录只是一只"黑盒子"
public interface IMemento {
}
```

```java
package com.canoe.pattern.memento;

// 黑箱实现：真正的状态藏在私有内部类里
public class BlackBoxRole {
    private String name;
    private int hp;

    // 返回的是空接口，Caretaker 拿不到任何内部数据
    public IMemento save() {
        return new Snapshot(name, hp);
    }

    // 只有发起人才知道怎么强转、怎么还原
    public void restore(IMemento m) {
        Snapshot s = (Snapshot) m;
        this.name = s.name;
        this.hp = s.hp;
    }

    // 私有内部类，包外、子类都无法访问
    private static class Snapshot implements IMemento {
        private final String name;
        private final int hp;
        Snapshot(String name, int hp) {
            this.name = name;
            this.hp = hp;
        }
    }
}
```

黑箱是《设计模式之禅》力荐的做法：把"能存"和"能看"彻底分开，**管理者只能保管，不能偷看**。

## 六、实际应用

- **文本编辑器的 Ctrl+Z / 撤销栈**：每次操作生成一个备忘录压栈，撤销就是弹栈恢复。
- **游戏存档 / 读档**：单机游戏的多档位保存，本质是多个 `Memento` 的集合。
- **数据库事务的 rollback**：事务开启时的状态快照，失败就回滚到快照。
- **浏览器 / IDE 的历史记录**：前进后退就是在不同备忘录间跳转。
- **Word 文档的恢复点**：定时生成文档状态快照，崩溃后可恢复。

注意：**大对象频繁备份会有内存开销**。解决思路是增量备忘录（只存变化部分）或限制历史栈深度。

## 七、优缺点

| 优点 | 缺点 |
| --- | --- |
| 完美保持封装，外部无法篡改状态 | 频繁/大对象备份消耗大量内存 |
| 提供干净的"保存-恢复"机制 | 管理者若保存过多历史，内存压力陡增 |
| 简化发起人，状态管理职责分离 | 实现黑箱需要内部类，代码略繁琐 |
| 支持任意数量的历史快照 | 序列化备忘录时要注意敏感字段安全 |
| 撤销/重做实现起来非常自然 | 每次保存都需拷贝状态，有性能成本 |

## 八、适用场景

- 需要保存对象在**某一时刻的完整状态**，并支持回退（撤销、事务回滚）。
- 不想暴露对象内部结构，却又要把状态交给外部保管。
- 实现编辑器、画图软件的**多步撤销/重做**。
- 游戏、仿真系统的**存档点**机制。
- 需要记录操作日志并支持"回放"的业务。

**什么时候不要用**：对象状态巨大且变更极频繁、对内存极度敏感时；或状态本就可以通过重新计算 cheaply 得到，没必要存。

## 九、在 JDK / 开源框架中的应用

- **`java.io.Serializable` + 快照**：很多框架通过序列化对象生成"备忘录"实现状态持久化（如会话复制）。
- **Spring 的 `StateManageableMessageSource` / 事务同步**：Spring 事务在 `TransactionSynchronizationManager` 中保存资源快照，回滚时恢复线程绑定资源。
- **`java.util.Date` 的 `clone()` 思路**：虽然 `Date` 本身不是备忘录，但其"拷贝一份旧值再操作"的思想与备忘录一致。
- **IntelliJ IDEA / Eclipse 的 UndoManager**：文档编辑的每一步都生成备忘录压入撤销栈。
- **MyBatis 的一级缓存**：`PerpetualCache` 保存查询结果快照，事务回滚时清空恢复。

## 十、与相近模式的区别

| 对比模式 | 目的 | 结构 | 使用场景 |
| --- | --- | --- | --- |
| 备忘录 vs 命令 | 备忘录保存"状态"用于恢复；命令封装"操作"用于执行/撤销 | 备忘录存数据；命令存行为 | 要回退状态用备忘录；要记录并 reversible 操作序列用命令 |
| 备忘录 vs 原型 | 原型用于克隆对象；备忘录用于保存并恢复对象状态 | 原型靠 `clone()`；备忘录靠专用快照类 | 只是复制一份对象用原型；需要受控的历史回退用备忘录 |

## 本篇小结

- **备忘录模式**在不破坏封装的前提下，把对象状态快照保存、日后可原样恢复。
- 三大角色：**发起人 Originator**、**备忘录 Memento**、**管理者 Caretaker**。
- 发起人自己决定**存什么、怎么恢复**，管理者只负责**存取、绝不偷看**。
- 白箱实现简单但封装弱；**黑箱实现**用私有内部类 + 空接口，安全性最佳。
- 它和**命令模式**常搭档：命令负责"做什么"，备忘录负责"撤回到哪"。
- 文本编辑器 **Ctrl+Z**、游戏**存档**、数据库**事务回滚**都是经典应用。
- 缺点是**内存开销**：大对象频繁备份要谨慎，建议增量或限长。
- 多步撤销本质是**一个备忘录栈**，撤销=弹栈、重做=再压栈。
- 黑箱里管理者拿到的只是**空接口**，无法强转访问内部字段。
- 序列化（`Serializable`）可视为备忘录的一种"持久化"变体。
- 使用时应区分**敏感字段**，避免存档泄露隐私数据。
- 与**原型模式**不同：原型克隆对象，备忘录管控历史状态。

## 参考链接

- [Refactoring Guru · Memento](https://refactoring.guru/design-patterns/memento)
- [SourceMaking · Memento Pattern](https://sourcemaking.com/design_patterns/memento)
- [GeeksforGeeks · Memento Design Pattern](https://www.geeksforgeeks.org/memento-design-pattern/)
- [TutorialsPoint · Memento Pattern](https://www.tutorialspoint.com/design_pattern/memento_pattern.htm)
- [Wikipedia · Memento pattern](https://en.wikipedia.org/wiki/Memento_pattern)
- [菜鸟教程 · 备忘录模式](https://www.runoob.com/design-pattern/memento-pattern.html)

下一篇 → [22 访问者模式](/java/design-pattern/visitor)
