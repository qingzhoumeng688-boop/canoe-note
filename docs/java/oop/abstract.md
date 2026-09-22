# 07 抽象类

> 本篇导读：当父类"说不清"具体怎么做时（比如动物都会叫，但每种动物叫法不同），抽象类就登场了。它既能保留子类共享的代码与状态，又能用抽象方法"逼着"子类给出自己的实现。本篇还会用"制作饮品"的例子引出模板方法模式，并彻底讲清抽象类与接口该如何选择。

## 一、为什么需要抽象类

设想我们在写一个动物园管理系统。所有动物都会"叫"，于是你在父类 `Animal` 里写下 `shout()`。问题来了：`Animal` 自己该"怎么叫"？它既不是狗也不是猫，根本"说不清"。

如果硬给一个空实现，后果有两个：

1. 编译期无法强制子类必须重写，万一哪个子类忘了写，调用时啥也没发生，bug 藏得很深；
2. `Animal` 还能被直接 `new`，凭空造出一个"不会叫的动物"，在业务上很荒谬。

```java
package com.canoe.oop.abstractclass;

// 不使用抽象类的写法：父类只能留空，毫无约束力
class AnimalOld {
    public void shout() {
        // 不知道怎么叫，只能空着
    }
}

class DogOld extends AnimalOld {
    @Override
    public void shout() {
        System.out.println("汪汪汪");
    }
}

public class OldDemo {
    public static void main(String[] args) {
        AnimalOld a = new AnimalOld(); // 能 new，但它是个"不会叫的动物"
        a.shout();                     // 什么也不输出，问题被藏起来了
    }
}
```

**抽象类的价值**：它允许父类"占个位"却不给实现，同时用语法强制子类必须把这个位补上；并且抽象类本身不能被实例化，从根上杜绝了"无意义的父类对象"。

## 二、抽象类与抽象方法

用 `abstract` 关键字标记。规则很简单：

- 用 `abstract` 修饰的方法是**抽象方法**：只有声明、没有方法体（连 `{}` 都不要，直接以分号结束）；
- **类里只要有一个抽象方法，这个类就必须声明为抽象类**；
- 反过来不成立：抽象类里可以一个抽象方法都没有（纯粹为了"禁止实例化"也存在）；
- **抽象类不能 `new`**。

```java
package com.canoe.oop.abstractclass;

// 抽象类：动物。它知道"动物都会叫"，但不知道具体怎么叫
public abstract class Animal {
    // 抽象方法：没有方法体，由子类实现
    public abstract void shout();

    // 普通方法：所有动物共享的行为，直接给实现
    public void breathe() {
        System.out.println("动物在呼吸");
    }
}

class Dog extends Animal {
    @Override
    public void shout() {
        System.out.println("汪汪汪");
    }
}

class Cat extends Animal {
    @Override
    public void shout() {
        System.out.println("喵喵喵");
    }
}

class AbstractDemo {
    public static void main(String[] args) {
        // Animal a = new Animal(); // 编译错误：抽象类不能实例化
        Animal dog = new Dog();
        dog.shout();   // 汪汪汪
        dog.breathe(); // 动物在呼吸
    }
}
```

## 三、抽象类的规则

抽象类比"纯接口"自由得多，它既能抽象也能具体：

- **可以没有抽象方法**：此时声明为抽象类只是为了禁止外部 `new`（比如只提供静态工具方法的类，或单例的基类）；
- **可以有具体方法和构造器**：构造器虽然不能直接 `new` 调用，但子类实例化时会通过 `super()` 走到它，用来初始化抽象类里那些被共享的成员变量；
- **子类必须重写所有抽象方法**：否则子类也必须声明为 `abstract`；
- **`abstract` 不能与 `final`、`private`、`static` 同用**，原因各不同：
  - `final` 表示"不可被继承/重写"，而抽象方法恰恰要求子类去重写，二者自相矛盾；
  - `private` 方法对子类不可见，子类根本无法重写它；
  - `static` 方法属于类、不依赖对象，不存在"被子类对象动态实现"的多态语义，所以不能是抽象方法（抽象方法本质是"等子类对象来填实现"）。

```java
package com.canoe.oop.abstractclass;

// 一个没有抽象方法的抽象类：只为禁止实例化
public abstract class ShapeUtil {
    // 构造器仍可存在，供子类调用
    protected ShapeUtil() {
        System.out.println("ShapeUtil 构造");
    }

    // 具体方法，子类直接复用
    public static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
```

## 四、模板方法模式的雏形

抽象类最妙的用法：在父类里**定好算法的骨架**，把可变的步骤"挖坑"留给子类填。这正是设计模式里"模板方法模式"的雏形。

以"制作饮品"为例：烧水、倒杯是固定的，而"冲泡"和"加料"每种饮品都不同。

```java
package com.canoe.oop.abstractclass;

// 饮品制作模板：不变的流程固定在父类，可变的步骤留给子类
public abstract class Beverage {
    // 模板方法：用 final 锁死算法骨架，防止子类破坏流程
    public final void make() {
        boilWater();
        brew();
        pourInCup();
        if (needCondiment()) {
            addCondiment();
        }
    }

    private void boilWater() {
        System.out.println("烧开水");
    }

    private void pourInCup() {
        System.out.println("倒入杯子");
    }

    // 抽象：冲泡方式由具体饮品决定
    protected abstract void brew();

    // 抽象：加料由具体饮品决定
    protected abstract void addCondiment();

    // 钩子方法：子类可选择性覆盖，默认需要加料
    protected boolean needCondiment() {
        return true;
    }
}

class Tea extends Beverage {
    @Override
    protected void brew() {
        System.out.println("用 80℃ 水泡茶叶");
    }

    @Override
    protected void addCondiment() {
        System.out.println("加柠檬片");
    }
}

class Coffee extends Beverage {
    @Override
    protected void brew() {
        System.out.println("用 95℃ 水冲咖啡粉");
    }

    @Override
    protected void addCondiment() {
        System.out.println("加糖和奶");
    }

    // 黑咖啡不要料：覆盖钩子方法
    @Override
    protected boolean needCondiment() {
        return false;
    }
}

class BeverageDemo {
    public static void main(String[] args) {
        Beverage tea = new Tea();
        tea.make();
        System.out.println("------");
        Beverage coffee = new Coffee();
        coffee.make();
    }
}
```

输出：

```
烧开水
用 80℃ 水泡茶叶
倒入杯子
加柠檬片
------
烧开水
用 95℃ 水冲咖啡粉
倒入杯子
```

你看，父类牢牢掌控"先烧水、再冲泡、后倒杯"的顺序，子类只管自己那两勺风味。到了[设计模式篇](/java/design/template-method)我们会把它正式提炼成"模板方法模式"。

## 五、抽象类 vs 接口

JDK 8 之后接口也能有默认方法（`default`）和静态方法，常被问"那还要抽象类干嘛"。一张表说清：

| 维度 | 抽象类 | 接口 |
| --- | --- | --- |
| 继承数量 | 单继承，一个类只能 `extends` 一个抽象类 | 多实现，一个类可 `implements` 多个接口 |
| 成员变量 | 可以有各种字段（含实例字段、静态字段） | 只能是 `public static final` 常量 |
| 方法 | 抽象方法 + 任意具体方法，可加访问修饰 | 抽象方法 + `default` / `static`（JDK 8+） |
| 构造器 | 有构造器（供子类 `super` 调用） | 没有构造器 |
| 设计理念 | **is-a**：强调"是一种"的父子关系，共享代码与状态 | **can-do / has-a**：强调"具备某种能力" |
| 状态 | 可持有并管理实例状态 | 基本无状态（只有常量） |

一句话：**抽象类是"父子"，接口是"能力证书"**。

## 六、什么时候用抽象类

做决策时问自己两个问题：

- 子类之间**要共享代码或共享状态**（比如都要用一个计数器、一段公共逻辑）？→ 用**抽象类**，把公共部分放进父类；
- 只是想**约定一组能力**，且不同类毫无"血缘"关系，甚至一个类要同时具备多种能力？→ 用**接口**。

实战经验：当你需要"模板方法"式的骨架 + 可变步骤，抽象类几乎是唯一选择；纯行为规范（如 `Comparable`、`Runnable`）则用接口。

## 本篇小结

- **抽象方法**只有声明没有方法体，且所在类必须声明为抽象类。
- **抽象类不能 `new`**，从语法上杜绝了无意义的父类对象。
- 抽象类**可以没有抽象方法**，此时常用来单纯禁止实例化。
- 抽象类**可以有具体方法和构造器**，构造器供子类通过 `super()` 初始化。
- 子类**必须重写全部抽象方法**，否则自身也要是抽象类。
- `abstract` **不能和 `final`、`private`、`static` 同用**，因为彼此语义冲突。
- **模板方法模式**的雏形：父类定骨架、子类填空，用 `final` 锁流程。
- `protected` 的钩子方法可以让子类**选择性定制**行为。
- 抽象类强调 **is-a** 的继承关系，适合共享代码与状态。
- 接口强调 **can-do** 的能力约定，支持多实现。
- 选型的判断标准：**要共享 → 抽象类；只约定能力 → 接口**。

## 参考链接

- [Oracle 教程：抽象方法与抽象类](https://docs.oracle.com/javase/tutorial/java/IandI/abstract.html)
- [Oracle 教程：接口](https://docs.oracle.com/javase/tutorial/java/IandI/createinterface.html)
- [Oracle 教程：接口中的默认方法](https://docs.oracle.com/javase/tutorial/java/IandI/defaultmethods.html)
- [Java 语言规范：类声明](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.1.1.1)
- [Java 语言规范：抽象方法](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.4.3.1)
- [Baeldung：抽象类与接口的区别](https://www.baeldung.com/java-abstract-class-vs-interface)

下一篇 → [08 接口](/java/oop/interface)
