# 08 接口

接口（Interface）是 Java 里"约定能力"的机制——它只说"你能做什么"，不关心"你怎么做"。USB 口就是现实中的接口：不管插的是鼠标还是 U 盘，只要长得合规就能用。本篇从接口定义一路讲到默认方法、函数式接口、标记接口，最后落地到"面向接口编程"这一最重要的工程思想。

## 一、接口是什么

接口是一种**能力约定 / 行为规范**。拿 USB 接口打比方：

```text
USB 规范只规定：插进去要能传数据、要供 5V 电。
至于你插的是鼠标、键盘还是风扇——规范不管，只要符合形状就能用。
```

代码里的接口也一样：它定义"有哪些方法"，但**不写方法体**（JDK 8 之前）。谁想拥有这个能力，谁就去 `implements` 并实现这些方法。好处是**调用方只依赖接口，不依赖具体实现**，随时可替换。

## 二、接口的定义与实现

`interface` 定义接口，`implements` 实现接口。**一个类可以实现多个接口**——这正是弥补单继承短板的地方（既能"is-a"继承一个父类，又能"has-capability"实现多个接口）。

```java
package com.canoe.oop.inter;

// 接口：定义"会飞"的能力
interface Flyable {
    void fly();   // 抽象方法，默认 public abstract
}

// 接口：定义"会游泳"的能力
interface Swimmable {
    void swim();
}

// 鸭子：继承 Animal，同时实现两个接口（多能力）
class Duck extends Animal implements Flyable, Swimmable {
    @Override
    public void fly() {
        System.out.println("鸭子扑腾着飞");
    }

    @Override
    public void swim() {
        System.out.println("鸭子划水");
    }
}

// 父类
class Animal {
    String name;
}

public class InterfaceDemo {
    public static void main(String[] args) {
        Duck d = new Duck();
        d.fly();
        d.swim();
    }
}
```

## 三、接口里能写什么

接口的内容随 JDK 版本演进，不断丰富：

| 版本 | 新增能力 | 说明 |
| --- | --- | --- |
| JDK 7 及之前 | 常量 + 抽象方法 | 只有 `public static final` 常量和抽象方法 |
| JDK 8 | `default` 方法 + `static` 方法 | 接口也能有实现了 |
| JDK 9 | `private` 方法 | 抽取接口内部公共逻辑 |

```java
package com.canoe.oop.inter;

interface Evolution {
    // 1. 常量（默认 public static final，写不写都一样）
    int MAX_SIZE = 100;

    // 2. 抽象方法（默认 public abstract）
    void doWork();

    // 3. JDK 8 default 方法：有默认实现，实现类可不重写
    default void log() {
        System.out.println("默认日志：开始工作");
        innerHelper();   // 可调用 private 方法
    }

    // 4. JDK 8 static 方法：属于接口本身，不能被实现类继承重写
    static void info() {
        System.out.println("这是 Evolution 接口");
    }

    // 5. JDK 9 private 方法：接口内部复用
    private void innerHelper() {
        System.out.println("（私有辅助逻辑）");
    }
}

class Impl implements Evolution {
    @Override
    public void doWork() {
        System.out.println("干活中");
    }
}

public class EvolutionDemo {
    public static void main(String[] args) {
        Impl i = new Impl();
        i.doWork();
        i.log();              // 用默认的，不用自己写
        Evolution.info();     // 静态方法用接口名调
        System.out.println("MAX_SIZE=" + Evolution.MAX_SIZE);
    }
}
```

**为什么要有 `default` 方法**：设想接口 `List` 要在 JDK 8 加 `sort()` 方法。如果只能加抽象方法，那么全世界所有 `List` 实现类（包括你自己写的）都会因没实现 `sort()` 而编译失败。`default` 给了个默认实现，老实现类不用改一行就能编译通过——**接口由此能平滑演进而不破坏实现类**。

## 四、接口的继承

接口之间也能继承，而且**一个接口可以 `extends` 多个接口**（接口支持多继承，类不行）。子接口合并了所有父接口的方法。

```java
package com.canoe.oop.inter;

interface A {
    void a();
}

interface B {
    void b();
}

// 接口多继承：同时拥有 a() 和 b()
interface C extends A, B {
    void c();
}

class AllImpl implements C {
    @Override public void a() { System.out.println("a"); }
    @Override public void b() { System.out.println("b"); }
    @Override public void c() { System.out.println("c"); }
}
```

## 五、常量接口

接口里的字段默认是 `public static final`，于是有人把接口当"常量容器"用：

```java
// 反模式！别这么写
interface Constants {
    String RED = "red";
    int MAX = 100;
}
```

**这是反模式**：接口本意是"能力约定"，塞常量违背语义；而且实现类会"继承"这些常量，造成命名污染、调用方还能写 `Constants.RED` 暴露实现细节。常量应该放：

- 相关类的 `public static final` 字段（如 `Integer.MAX_VALUE`）；
- 或独立 `final class`；
- 或更好的 **枚举 `enum`**。

## 六、函数式接口

**只有一个抽象方法的接口**叫函数式接口，加 `@FunctionalInterface` 注解让编译器帮你检查。它能被 **Lambda 表达式** 直接实现——这是 Java 8 函数式编程的基石。

```java
package com.canoe.oop.inter;

@FunctionalInterface   // 注解校验：抽象方法只能有一个
interface Calculator {
    int calc(int x, int y);
}

public class FunctionalDemo {
    public static void main(String[] args) {
        // 传统：匿名内部类
        Calculator add = new Calculator() {
            @Override
            public int calc(int x, int y) {
                return x + y;
            }
        };

        // 函数式：Lambda，一行搞定
        Calculator mul = (x, y) -> x * y;

        System.out.println("加：" + add.calc(2, 3));   // 5
        System.out.println("乘：" + mul.calc(2, 3));   // 6

        // JDK 自带的函数式接口：Runnable（无参无返回）、Comparator（比较）
        Runnable r = () -> System.out.println("Runnable 是函数式接口");
        r.run();
    }
}
```

`Runnable`、`Comparator`、`Callable` 都是 JDK 内置的函数式接口，是 Lambda 的直接受益者。

## 七、标记接口

**标记接口（Marker Interface）**：一个方法都没有的接口，纯粹用来"打标记"，告诉 JVM / 框架"这个类的对象具备某种特殊身份"。

最典型的两个：

- `java.io.Serializable`：标记"对象可被序列化"（写入磁盘 / 网络）；
- `java.lang.Cloneable`：标记"对象可被 `clone()`"。

```java
package com.canoe.oop.inter;

import java.io.Serializable;

// 实现 Serializable 这个标记接口，表示 Person 允许序列化
class PersonSerializable implements Serializable {
    private static final long serialVersionUID = 1L;
    String name;
}
```

> 注意：标记接口没有方法，它的"能力"靠 JVM 或框架在运行期检查 `if (obj instanceof Serializable)` 来触发。JDK 8 后部分标记场景可用**注解**替代（如 `@FunctionalInterface` 本质是注解），但 `Serializable` / `Cloneable` 仍坚守标记接口形式。

## 八、接口 vs 抽象类（深入）

JDK 8 之后接口也能有 `default` 方法、静态方法，和抽象类的界限变模糊了。但本质区别仍在：

| 维度 | 接口 interface | 抽象类 abstract class |
| --- | --- | --- |
| 能否实例化 | 不能 | 不能 |
| 继承 / 实现 | 类可 `implements` 多个 | 类只能 `extends` 一个 |
| 字段 | 只能是 `public static final` 常量 | 可有普通实例字段（状态） |
| 构造器 | 没有 | 有 |
| 方法 | 抽象 + `default`/`static`/`private` | 抽象 + 任意普通方法 |
| 设计意图 | "能做什么"（规范 / 能力） | "是什么"（含状态与共享逻辑） |

**现代选择建议**：

- 优先用**接口**——更灵活，一个类能实现多个，解耦调用方与实现；
- 只有当需要**共享状态（实例字段）或构造逻辑**时，才用抽象类。

JDK 里经典的"抽象类 + 接口"组合：`List`（接口，定规范）与 `AbstractList`（抽象类，把各 `List` 通用的骨架实现好，具体实现类如 `ArrayList` 只继承 `AbstractList` 补差异）。这样既灵活又避免重复。

## 九、面向接口编程

**本节最重要的思想：声明变量用接口类型，实现可随时替换。** 调用方只认接口，不认具体类。

```java
package com.canoe.oop.inter;

import java.util.List;
import java.util.ArrayList;
import java.util.LinkedList;

public class ProgramToInterface {
    public static void main(String[] args) {
        // 声明用接口 List，右边实现可替换
        List<String> list = new ArrayList<String>();   // 今天用 ArrayList
        list.add("a");
        list.add("b");

        // 哪天想换成 LinkedList，只改这一行，后面代码完全不动
        List<String> list2 = new LinkedList<String>();
        list2.add("x");

        // Service 层同理：用接口声明，注入不同实现
        UserService service = new UserServiceImpl();
        service.register("小明");
    }
}

// 接口 + 实现类分离的典范
interface UserService {
    void register(String name);
}

class UserServiceImpl implements UserService {
    @Override
    public void register(String name) {
        System.out.println("注册用户：" + name);
    }
}
```

面向接口编程带来的好处：上层代码**不依赖具体实现**，测试时可换 Mock 实现、运行时可换不同策略，是 Spring 依赖注入（DI）的根基。

## 本篇小结

- **接口是能力约定**，只规定"能做什么"，不关心"怎么做"，调用方只依赖接口。
- 类用 `implements` 实现接口，且**可实现多个接口**，弥补单继承的不足。
- 接口随版本演进：**JDK8 加 `default`/`static`，JDK9 加 `private` 方法**。
- **`default` 方法**让接口能平滑演进，新增方法不破坏已有实现类。
- **接口可多继承**（extends 多个接口），合并所有父接口方法。
- **常量接口是反模式**，常量应放 `final class` 或枚举。
- **函数式接口**只有一个抽象方法，加 `@FunctionalInterface`，可被 Lambda 实现。
- **标记接口**（如 `Serializable`）无方法，仅用于运行期"打标记"识别身份。
- 接口 vs 抽象类：**接口无状态多实现，抽象类有状态单继承**。
- 现代建议**优先接口**，仅在需共享状态 / 构造逻辑时才用抽象类。
- JDK 中 **`List` + `AbstractList`** 是接口与抽象类协作的典范。
- **面向接口编程**：声明用接口、实现可替换，是解耦与测试的基础。

## 参考链接

- [Oracle Java 教程：接口](https://docs.oracle.com/javase/tutorial/java/concepts/interface.html)
- [Oracle Java 教程：默认方法](https://docs.oracle.com/javase/tutorial/java/IandI/defaultmethods.html)
- [Oracle Java 语言规范：接口](https://docs.oracle.com/javase/specs/jls/se17/html/jls-9.html#jls-9.4)
- [Oracle Java 文档：函数式接口](https://docs.oracle.com/javase/8/docs/api/java/lang/FunctionalInterface.html)
- [Oracle Java 文档：Serializable 标记接口](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/io/Serializable.html)
- [廖雪峰 Java 教程：接口](https://www.liaoxuefeng.com/wiki/1252599548343744/1260464665484160)
- [Baeldung：Java 接口指南](https://www.baeldung.com/java-interfaces)

下一篇 → [09 静态字段和静态方法](/java/oop/static)
