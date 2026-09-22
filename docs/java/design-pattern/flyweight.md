# 13 享元模式

下一盘围棋，棋盘 19×19 共 361 个交叉点，理论上能落几百颗棋子。可你细想：棋子除了"黑或白"这两种颜色，还有什么不同？位置是落子时才决定的——颜色是固定的，坐标是变化的。如果每一颗落子都 `new` 一个对象，几百个对象里 99% 的字段一模一样，纯属浪费内存。享元模式（Flyweight）干的就是"共享"的活儿：把**可以共享的部分（内部状态）**抽出来只存一份，把**随场景变化的部分（外部状态）**交给调用方传入。本文用围棋棋子讲透内部/外部状态，并顺带看清 String 常量池、Integer 缓存、线程池这些天天见的"隐形享元"。

## 一、它是什么

**一句话大白话**：享元模式是"能共用就别重复造"，把大量相似对象里不变的那块抽出来共享，只留会变的那块让外部传。

生活化比喻：公司给员工发工牌，工牌的"公司 LOGO、公司名称"是固定的，但"员工姓名、工号"每人不同。工厂不会给每人重新开模做一块完全不同的牌子——而是**共用同一套模板（享元）**，只在打印时填上各自的姓名工号（外部状态）。这样 1 万张工牌背后其实只有 1 个模板对象，内存和成本都省了。

GoF 官方定义：

> 运用**共享技术**有效地支持大量**细粒度**对象的复用。

关键词是"**共享**"与"**细粒度**"——对象很多、彼此相似、且可抽出共享部分时，享元才划算。

## 二、为什么需要它（不用会怎样）

不假思索地每落一子 `new` 一个对象：

```java
// 反面教材：每颗棋子都新建对象，颜色被重复存储几百次
public class BadGoGame {
    public static void main(String[] args) {
        // 假设有 300 颗棋子，每颗都 new，且每颗都带着"颜色"字段
        for (int i = 0; i < 300; i++) {
            // 一半黑一半白，但黑子被 new 了 150 次，白子也被 new 了 150 次
            GoPiece piece = new GoPiece(i % 2 == 0 ? "黑" : "白", i, i);
            piece.draw(); // 颜色字段在 300 个对象里存了 300 遍，纯浪费
        }
        System.out.println("创建了 300 个棋子对象，其中颜色字段大量重复");
    }
}

// 每颗棋子都持有颜色 + 坐标
class GoPiece {
    private String color; // 黑/白，其实只有两种取值，却存了 300 份
    private int x;
    private int y;
    public GoPiece(String color, int x, int y) { this.color = color; this.x = x; this.y = y; }
    public void draw() { System.out.println(color + "子落于 (" + x + "," + y + ")"); }
}
```

痛点：

1. **内存浪费**：300 颗棋子，颜色字段只有黑、白两种可能，却重复存了 300 遍。
2. **对象爆炸**：细粒度对象数量随规模线性增长，GC 压力大。
3. **无法集中管理**：相同颜色的棋子散落各处，无法统一复用。

享元模式的解法：颜色只有两种，那就**只造两颗"模板棋子"**（黑、白），落子时把坐标（外部状态）传进去即可。300 颗子背后实际只有 2 个对象。

## 三、结构与角色

```text
   客户端 Client
       │  创建/获取棋子时传入外部状态(坐标)
       ▼
   ┌──────────────────┐
   │  GoPieceFactory  │ ← 享元工厂（缓存池，保证同色只造一次）
   │  (棋子工厂)      │
   └────────┬─────────┘
            │ 返回已缓存或新建
            ▼
   ┌──────────────────┐        ┌──────────────────────┐
   │  GoPiece (接口)  │◀──实现──│ ConcreteGoPiece      │ ← 具体享元
   │  (享元抽象)      │        │ 仅持有内部状态 color   │
   └──────────────────┘        └──────────────────────┘
            ▲                            │ 被共享（同色唯一）
            │ 调用 draw(x,y)             │
   客户端传入外部状态 x,y ────────────────┘
```

| 角色 | 对应类 | 职责 |
| --- | --- | --- |
| **抽象享元 Flyweight** | `GoPiece` | 声明业务方法，外部状态以参数形式传入（如 `draw(x, y)`） |
| **具体享元 ConcreteFlyweight** | `ConcreteGoPiece` | 存储**可共享的内部状态**（颜色），方法依赖外部状态 |
| **享元工厂 FlyweightFactory** | `GoPieceFactory` | 维护缓存池 `Map`，保证相同内部状态的对象**只创建一次** |
| **客户端 Client** | `FlyweightDemo` | 通过工厂获取享元，并自行维护/传入外部状态（坐标） |

## 四、代码实现

核心是一个**带缓存的工厂**：相同颜色只 `new` 一次，之后全部复用。

```java
package com.canoe.pattern.flyweight;

import java.util.HashMap;
import java.util.Map;

// 抽象享元：棋子
interface GoPiece {
    // 坐标 x,y 是外部状态，由调用方传入，不存进享元
    void draw(int x, int y);
}

// 具体享元：只持有内部状态"颜色"，可安全共享
class ConcreteGoPiece implements GoPiece {
    // 内部状态：颜色（黑/白），只有两种，值得共享
    private String color;

    public ConcreteGoPiece(String color) {
        this.color = color;
        System.out.println("创建了一颗" + color + "色棋子（整局只创建一次）");
    }

    @Override
    public void draw(int x, int y) {
        // 内部状态 + 外部状态 结合完成绘制
        System.out.println("在棋盘 (" + x + "," + y + ") 落下" + color + "色棋子");
    }
}

// 享元工厂：缓存池，保证同色对象单例复用
class GoPieceFactory {
    // 缓存池：key 是颜色，value 是共享的棋子对象
    private static final Map<String, GoPiece> pool = new HashMap<String, GoPiece>();

    public static GoPiece getPiece(String color) {
        GoPiece piece = pool.get(color);
        if (piece == null) {
            // 池中还没有才真正创建，并放入缓存
            piece = new ConcreteGoPiece(color);
            pool.put(color, piece);
        }
        return piece; // 之后同色一律返回缓存中的同一个对象
    }

    public static int getPoolSize() {
        return pool.size();
    }
}
```

客户端这样落子——表面落了 3 子，实际只创建了 2 个对象：

```java
public class FlyweightDemo {
    public static void main(String[] args) {
        // 棋盘上落很多子，但颜色只有黑白两种，对象只创建 2 个
        GoPiece black1 = GoPieceFactory.getPiece("黑");
        black1.draw(1, 2);

        GoPiece white1 = GoPieceFactory.getPiece("白");
        white1.draw(2, 3);

        GoPiece black2 = GoPieceFactory.getPiece("黑");
        black2.draw(3, 4);

        System.out.println("棋子对象池中实际对象数量：" + GoPieceFactory.getPoolSize());
        System.out.println("black1 与 black2 是否为同一对象：" + (black1 == black2));
    }
}
```

运行输出会显示"黑棋子只创建一次"，且 `black1 == black2` 为 `true`——300 颗黑子背后其实只有 1 个黑子对象在反复被复用。

## 五、内部状态 vs 外部状态

这是享元模式**最核心**的一对概念，必须分得清：

```text
   一颗"逻辑上的棋子" = 内部状态(可共享) + 外部状态(不可共享)
   ┌─────────────────────────┐   ┌─────────────────────────┐
   │  内部状态 InternalState   │   │  外部状态 ExternalState   │
   │  · 存在享元对象内部       │   │  · 由客户端持有、调用时传入│
   │  · 与具体场景无关         │   │  · 随使用场景变化         │
   │  · 可安全共享（不变）     │   │  · 不可共享（会变）       │
   │  例：棋子颜色 = 黑/白     │   │  例：棋子坐标 = (x, y)    │
   └─────────────────────────┘   └─────────────────────────┘
```

- **内部状态（Intrinsic）**：存储在享元内部、与所处场景无关、可安全共享。如围棋子的颜色、工牌的公司 LOGO、字符的字形。它们不随调用位置变化，所以可以只存一份。
- **外部状态（Extrinsic）**：依赖具体使用场景、会变化、不可共享。如棋子的坐标、工牌上的员工姓名、字符在文本里的位置。它们必须由客户端在每个调用点传入，享元自己不存。

**设计铁律**：能共享的才放进内部状态；会变、随场景走的全丢给外部状态。享元模式能否省内存，就看你能从对象里抽走多少内部状态。

## 六、实际应用

你每天都在用享元，只是没意识到：

- **JDK `Integer.valueOf` 常量池**：`Integer.valueOf(127)` 返回的永远是同一个缓存对象，因为 JDK 缓存了 `-128 ~ 127` 的 `Integer`。`valueOf(200)` 超出范围才会 `new`。这正是享元：数值小、常用、可共享。
- **String 常量池（String Pool）**：`String a = "hello"; String b = "hello";` 中 `a == b` 为 `true`，因为字符串字面量在常量池里共享。字符串内容（内部状态）不可变，所以能安全复用。
- **线程池 / 数据库连接池**：线程、连接是"创建成本高"的对象，池子缓存它们反复借出归还——本质是对"昂贵资源"做享元式复用。
- **文本编辑器中的字符**：一篇几万字的文档，如果每个字符都 `new` 一个对象（带字体、颜色），内存会爆；享元把"字符的字形/样式"共享，只在外层记录每个字符的位置。

## 七、优缺点

| 优点 | 缺点 |
| --- | --- |
| **大幅省内存**：相同内部状态只存一份，细粒度对象越多越划算 | **逻辑变复杂**：要拆分内部/外部状态，设计成本上升 |
| **减少对象数**：降低 GC 压力，提升性能 | **外部状态外泄**：状态从对象内移到客户端，调用更繁琐 |
| **集中复用**：工厂统一管理共享对象，便于管控 | **线程安全隐忧**：共享对象若有可变内部状态需额外同步 |
| **符合单例思想**：同类享元天然唯一 | **适用前提苛刻**：对象必须"大量且相似"才有收益 |

## 八、适用场景

1. **大量细粒度、且彼此相似的对象**：围棋/五子棋棋子、字符、图标。
2. **对象大部分状态可抽取为内部状态**：能共享的占比越高，收益越大。
3. **对象创建/销毁成本高、需复用**：线程池、连接池、对象池。
4. **缓存型共享**：`Integer` 缓存、`String` 常量池这类"常用值复用"。
5. **内存敏感的系统**：如嵌入式、移动端或长生命周期服务。

**什么情况下不要用**：如果对象**种类多、状态各不相同、几乎无法共享**，或者对象总数本来就很少，享元只会增加复杂度却省不下多少内存——那就别用。

## 九、在 JDK / 开源框架中的应用

- **`Integer.valueOf(int)`**：JDK 缓存 `-128~127` 的对象，超出才新建，是享元的官方范例。
- **`String` 常量池**：字面量在池中共享，`intern()` 可手动入池，字符串不可变使其可安全共享。
- **`Boolean.valueOf` / `Byte` / `Character` 等包装类**：`Boolean` 只有 `TRUE`/`FALSE` 两个共享常量，`Character` 缓存部分常用字符。
- **线程池 `ThreadPoolExecutor` / 连接池（`HikariCP`、`Druid`）**：对昂贵资源做池化复用，享元思想在"资源池"上的延伸。
- **`java.lang.Integer` 源码**：`IntegerCache` 内部类就是那个"享元工厂"，在类加载时预建缓存数组。

设计意图一致：**用"共享不变部分 + 外部传入变化部分"换取内存与性能的双重收益**。

## 十、与相近模式的区别

| 模式 | 目的 | 与享元的区别 |
| --- | --- | --- |
| **单例 Singleton** | 整个系统**只一个**实例 | 单例是"全局唯一 1 个"；享元是"**按内部状态分组的多个共享对象**"（黑子一个、白子一个），数量可为多个 |
| **工厂 Factory** | 负责**创建**对象 | 工厂只管生产；享元工厂额外多了"**缓存复用**"的职责，是带池的工厂 |
| **原型 Prototype** | 通过**拷贝**快速造新对象 | 原型是复制出新对象（每份独立）；享元是复用同一份（共享），方向相反 |

记忆口诀：**单例要"唯一"，享元要"分组共享"；工厂只造，享元工厂既造又存**。

## 本篇小结

- **享元模式**用共享技术支持大量细粒度对象复用，核心是"能共用就别重复造"。
- 关键拆两类状态：**内部状态可共享**（如棋子颜色），**外部状态随场景变不可共享**（如坐标）。
- **享元工厂**维护缓存池 `Map`，保证相同内部状态的对象**只创建一次**。
- 围棋/五子棋是经典案例：数百颗子背后实际只有黑、白两个共享对象。
- JDK 的 **`Integer.valueOf`** 缓存 `-128~127` 是享元的官方范例。
- **`String` 常量池**本质也是享元：字面量不可变，可安全共享。
- **线程池、连接池**是对"昂贵资源"做享元式复用，省去反复创建开销。
- 享元**前提是对象大量且相似**，否则只会增加复杂度、无收益。
- 享元与**单例**不同：单例全局唯一，享元是按状态分组的多个共享对象。
- 享元与**工厂**不同：享元工厂在"创建"之外多了"缓存复用"职责。
- 共享对象若有**可变内部状态**需额外做线程同步，否则有并发隐患。
- 享元常与**组合模式**协作：组合树的叶子节点可用享元共享以进一步省内存。

## 参考链接

- [Refactoring Guru · Flyweight Pattern（英文）](https://refactoring.guru/design-patterns/flyweight)
- [Refactoring Guru · 享元模式（中文）](https://refactoringguru.cn/design-patterns/flyweight)
- [菜鸟教程 · 享元模式](https://www.runoob.com/design-pattern/flyweight-pattern.html)
- [Oracle JDK · Integer.valueOf(int)](https://docs.oracle.com/javase/8/docs/api/java/lang/Integer.html#valueOf-int-)
- [Oracle JDK · String](https://docs.oracle.com/javase/8/docs/api/java/lang/String.html)
- [Wikipedia · Flyweight Pattern](https://en.wikipedia.org/wiki/Flyweight_pattern)
- [Oracle JDK · ThreadPoolExecutor](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ThreadPoolExecutor.html)

下一篇 → [14 策略模式](/java/design-pattern/strategy)
