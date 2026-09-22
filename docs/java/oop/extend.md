# 05 继承

继承（Inheritance）让子类自动拥有父类的本领，是代码复用最直观的手段，也是"多态"的前提。但它是一把双刃剑：用好了减少重复，用错了就是把类绑成死结。本篇从"代码重复的痛"讲起，覆盖 `extends`、`super`、方法重写、`Object` 类，以及最重要的——什么时候该用继承、什么时候该用组合。

## 一、为什么需要继承

先制造痛点。没有继承时，写 `Dog` 和 `Cat`，发现它们都有 `name` 和 `eat()`，代码几乎复制粘贴：

```java
package com.canoe.oop.extend;

// 没有继承：两只动物，重复字段和方法
class DogRaw {
    String name;
    void eat() { System.out.println(name + " 吃狗粮"); }
}

class CatRaw {
    String name;
    void eat() { System.out.println(name + " 吃猫粮"); }
}
```

问题：每加一种动物（鸟、鱼……）就要再抄一遍 `name` 和 `eat()`，改一个逻辑要改 N 处，**违反 DRY（Don't Repeat Yourself）**。

解决办法——把"动物共有的"抽到父类 `Animal`，让 `Dog`、`Cat` 继承它：

```java
package com.canoe.oop.extend;

// 父类：抽取共性
class Animal {
    String name;

    void eat() {
        System.out.println(name + " 在吃东西");
    }
}

// 子类：自动拥有 name 和 eat()
class Dog extends Animal {
    void bark() {
        System.out.println(name + " 汪汪");   // 直接用父类的 name
    }
}

class Cat extends Animal {
    void meow() {
        System.out.println(name + " 喵喵");
    }
}

public class WhyExtend {
    public static void main(String[] args) {
        Dog d = new Dog();
        d.name = "旺财";
        d.eat();    // 来自 Animal
        d.bark();   // 来自 Dog
    }
}
```

## 二、extends 语法

`class 子类 extends 父类` 表示继承。**Java 是单继承：一个类只能 `extends` 一个父类**（但一个父类可以有多个子类）。

```java
package com.canoe.oop.extend;

class Vehicle {            // 父类（也叫超类 / 基类）
    void run() {
        System.out.println("交通工具在跑");
    }
}

class Bike extends Vehicle {   // 子类（派生类）
}

// class Tricycle extends Bike, Vehicle { }  // ❌ 编译错误：不能同时 extends 两个
```

术语对照：**父类 = 超类（super class）= 基类（base class）**；**子类 = 派生类（derived class）**。单继承让类关系呈一棵"树"，结构清晰、不会像 C++ 多继承那样出现"菱形继承"歧义。想要"多份能力"，请用**接口**（见 08 接口）。

## 三、继承了什么，没继承什么

这是重点，很多人以为"private 没继承"——其实**private 成员也被继承了（占内存），只是子类不能直接访问**。

| 成员 | 是否继承 | 子类能否直接访问 |
| --- | --- | --- |
| `public` 成员 | 是 | 能 |
| `protected` 成员 | 是 | 能（同包或子类） |
| 默认（包私有）成员 | 是 | 仅同包能 |
| `private` 成员 | 是（在内存里） | **不能直接访问**，需通过父类 getter |
| 构造器 | **否** | 不能继承，需 `super()` 调用 |

```java
package com.canoe.oop.extend;

class Parent {
    public int a = 1;
    private int secret = 99;

    public int getSecret() {   // 给子类一条合法访问通道
        return secret;
    }
}

class Child extends Parent {
    void show() {
        System.out.println("a = " + a);            // 能：public
        System.out.println("secret = " + getSecret()); // 间接拿 private
        // System.out.println(secret);  // ❌ 不能直接访问父类 private
    }
}

public class InheritWhat {
    public static void main(String[] args) {
        new Child().show();
    }
}
```

## 四、访问修饰符与继承

四种修饰符在"继承 + 跨包"场景下的可见性：

| 修饰符 | 同类 | 同包 | 子类（不同包） | 任意地方 |
| --- | --- | --- | --- | --- |
| `private` | ✅ | ❌ | ❌ | ❌ |
| 默认（无修饰） | ✅ | ✅ | ❌ | ❌ |
| `protected` | ✅ | ✅ | ✅ | ❌ |
| `public` | ✅ | ✅ | ✅ | ✅ |

关键记忆：**`protected` 是"给子类开后门"的**——不同包的子类也能访问父类的 `protected` 成员，但非子类的外部类不行。所以想让子类用、又不想公开给全世界，就用 `protected`。

## 五、方法重写 Override

子类觉得父类的方法不够好，可以**重写（覆盖）**它：方法签名保持一致，换成自己的实现。加上 `@Override` 注解，编译器会帮你检查——方法名写错、参数对不上立刻报错。

重写规则（编译期 / 运行期都会校验）：

1. **方法签名必须一致**（方法名 + 参数列表）；
2. **返回值可协变**：子类返回值可以是父类返回值的"子类"（如父类返回 `Animal`，子类可返回 `Dog`）；
3. **访问权限不能更严格**：父类 `public`，子类不能改成 `protected`/`private`；
4. **不能抛出比父类更宽泛的受检异常**。

```java
package com.canoe.oop.extend;

class AnimalOverride {
    public void speak() {
        System.out.println("动物叫");
    }

    public AnimalOverride born() {   // 返回父类类型
        return new AnimalOverride();
    }
}

class DogOverride extends AnimalOverride {
    @Override                  // 编译期校验：确保真在重写
    public void speak() {      // 签名一致，权限没更严格
        System.out.println("汪汪");
    }

    @Override
    public DogOverride born() {  // 返回值协变：DogOverride 是 AnimalOverride 的子类
        return new DogOverride();
    }
}

public class OverrideDemo {
    public static void main(String[] args) {
        AnimalOverride a = new DogOverride();  // 多态
        a.speak();   // 运行期动态绑定 → 汪汪（调的是子类版本）
    }
}
```

> `@Override` 的价值：某天你把父类方法名改了，子类没跟着改，没有 `@Override` 编译器会以为这是子类新增方法、悄悄放过；有了它立刻红字报错，逼你同步。所以**重写必加 `@Override`**。

## 六、super 关键字

`super` 指"父类对象那部分"，两大用途：

1. 访问父类被重写的成员 / 方法；
2. 调用父类构造器（**必须写在子类构造器第一行**）。

`super` 与 `this` 对比：

| 对比 | `this` | `super` |
| --- | --- | --- |
| 指代 | 当前对象 | 父类部分 |
| 调构造器 | `this(...)` 本类 | `super(...)` 父类 |
| 访问成员 | 本类成员 | 父类成员 |
| 位置限制 | 构造器第一行 | 构造器第一行 |

```java
package com.canoe.oop.extend;

class PhoneBase {
    String brand;

    PhoneBase(String brand) {
        this.brand = brand;
    }

    void feature() {
        System.out.println("基础通话功能");
    }
}

class SmartPhone extends PhoneBase {
    SmartPhone(String brand) {
        super(brand);   // 必须第一行：先让父类初始化 brand
    }

    @Override
    void feature() {
        super.feature();          // 先复用父类实现
        System.out.println("还能上网、拍照");  // 再扩展
    }

    void who() {
        System.out.println("我是 " + super.brand + " 手机"); // 访问父类字段
    }
}

public class SuperDemo {
    public static void main(String[] args) {
        SmartPhone p = new SmartPhone("小米");
        p.feature();
        p.who();
    }
}
```

## 七、继承的内存结构

子类对象在堆里，并不是"父类 + 子类"简单拼起来，而是**子类对象内部包含一整块"父类部分"**。画图示意：

```text
new SmartPhone("小米") 在堆里：

┌────────────── SmartPhone 对象 ──────────────┐
│  ┌──────── 父类 PhoneBase 部分 ────────┐     │
│  │ brand : "小米"                       │     │
│  └─────────────────────────────────────┘     │
│  ┌──────── SmartPhone 自身部分 ───────┐       │
│  │ （子类新增的字段都在这里）           │       │
│  └────────────────────────────────────┘      │
└──────────────────────────────────────────────┘
```

因为父类部分就在对象里，所以 `super.feature()` 能直接找到父类方法，`super.brand` 能直接拿到父类字段——它们本来就是同一个对象的一块内存。

## 八、继承的优缺点与替代

**重点提醒：继承是强耦合。** 子类紧紧扒着父类的实现，父类一改，子类可能全线崩溃；继承层次太深（爷→父→子→孙）更难维护。

正确姿势：

- **"is-a" 才用继承**：`Dog` 是 `Animal`，理直气壮继承；`HashSet` 是 `Collection`，没问题。
- **不是 "is-a" 就用组合**（合成复用原则）：`Car` 有 `Engine`，应该 `Car` 里**持有**一个 `Engine` 对象，而不是让 `Car extends Engine`。
- **继承层次别超过三层**，否则改一处牵全身。

```java
package com.canoe.oop.extend;

// 反例：Car 不是 Engine，却去继承 → 强耦合、语义错误
// class Car extends Engine { }

// 正例：组合（has-a）
class Engine {
    void start() {
        System.out.println("引擎启动");
    }
}

class CarComposition {
    private Engine engine = new Engine();  // 持有，而非继承

    void run() {
        engine.start();   // 通过组合复用能力
        System.out.println("车开起来了");
    }
}

public class CompositionDemo {
    public static void main(String[] args) {
        new CarComposition().run();
    }
}
```

组合比继承灵活：`Engine` 想换种实现，只要 `Car` 换一个持有的实例即可，不影响类层级。业内有句老话——**"多用组合，少用继承"（Composition over Inheritance）。**

## 本篇小结

- 继承用于**消除重复代码**，把共性抽到父类让子类复用。
- Java 是**单继承**，一个类只能 `extends` 一个父类，多能力靠接口补。
- `private` 成员**也被继承（占内存）**，只是子类不能直接访问，需经父类 getter。
- **构造器不被继承**，子类必须通过 `super(...)` 调用父类构造器。
- 四种修饰符中 **`protected` 专给子类开后门**（不同包子类可访问）。
- **重写**需方法签名一致，返回值可协变、权限不能更严、异常不能更宽。
- **`@Override` 注解**能在编译期捕获"假重写"，强烈建议必加。
- `super` 指代**父类部分**，访问父类成员或构造器，且 `super(...)` 须第一行。
- 子类对象内存里**包含一整块父类部分**，故能访问父类成员。
- 继承是**强耦合**，父类改动会波及所有子类，需谨慎使用。
- 只有 **"is-a" 关系才用继承**，否则用**组合（has-a）** 更灵活。
- 遵循**合成复用原则**，继承层次建议不超过三层。

## 参考链接

- [Oracle Java 教程：继承](https://docs.oracle.com/javase/tutorial/java/concepts/inheritance.html)
- [Oracle Java 教程：重写与隐藏方法](https://docs.oracle.com/javase/tutorial/java/IandI/override.html)
- [Oracle Java 语言规范：继承](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.4.8)
- [Oracle Java 文档：Object 类](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Object.html)
- [廖雪峰 Java 教程：继承](https://www.liaoxuefeng.com/wiki/1252599548343744/1260454540164544)
- [Baeldung：Java 继承](https://www.baeldung.com/java-inheritance)
- [Oracle 技术文章：组合优于继承](https://docs.oracle.com/javase/tutorial/java/IandI/summaryinheritance.html)

下一篇 → [06 多态](/java/oop/polymorphism)
