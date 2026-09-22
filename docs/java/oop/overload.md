# 04 方法重载

方法重载（Overload）是 Java 多态的"编译期形态"——同一个名字，却能在不同参数下做不同的事（比如 `System.out.println` 能接 int、String、double...）。本篇讲清它怎么构成、怎么不算，并和"重写"做一张彻底对比表，最后聊编译器挑方法的匹配规则与经典陷阱。

## 一、什么是重载

**重载 = 同一个类里，方法名相同、参数列表不同。** 编译器靠"方法名 + 参数列表"这个组合来定位方法，所以判断重载**只看参数列表**，返回值、修饰符都不参与。

```java
package com.canoe.oop.overload;

public class WhatIsOverload {

    // 这三个都是 print 方法的重载
    public void print(int x) {
        System.out.println("int: " + x);
    }

    public void print(String s) {
        System.out.println("String: " + s);
    }

    public void print(int x, int y) {
        System.out.println("int,int: " + x + "," + y);
    }

    public static void main(String[] args) {
        WhatIsOverload o = new WhatIsOverload();
        o.print(10);          // 调 print(int)
        o.print("hi");        // 调 print(String)
        o.print(1, 2);        // 调 print(int,int)
    }
}
```

## 二、构成重载的条件

只要满足"参数不同"之一即可，三种情况各来一段代码：

**（1）参数类型不同**

```java
public void f(int x) { }
public void f(double x) { }
```

**（2）参数个数不同**

```java
public void f(int x) { }
public void f(int x, int y) { }
```

**（3）参数顺序不同**（仅靠顺序，且类型要能区分）

```java
package com.canoe.oop.overload;

public class OrderOverload {
    public void f(int x, String s) { }
    public void f(String s, int x) { }   // 顺序不同，构成重载
}
```

> 单纯靠顺序重载可读性差，真实项目里尽量少用，宁可起不同名字。

## 三、不构成重载的情况

三种"看起来像、其实不是"的写法，全部编译报错（重复定义）：

**（1）仅返回值不同 ❌**

```java
// 编译错误：方法已被定义
public int f(int x) { return x; }
public double f(int x) { return x; }   // 仅仅返回值不同，不算重载
```

原因：调用方写 `f(1);` 时编译器不知道该选哪个，因为返回值可以被忽略（`f(1);` 不接收返回值），无法区分。

**（2）仅参数名不同 ❌**

```java
// 编译错误
public void g(int a) { }
public void g(int b) { }   // 仅仅把 a 改成 b，参数列表一样
```

**（3）仅修饰符不同 ❌**

```java
// 编译错误
public void h(int x) { }
private void h(int x) { }  // 仅仅 public 改 private，不算重载
```

## 四、重载 vs 重写

这是整篇的核心，用一张表讲透（重写详见 05 继承）：

| 维度 | 重载 Overload | 重写 Override |
| --- | --- | --- |
| 发生范围 | **同一个类** | **父子类（有继承关系）** |
| 方法名 | 必须相同 | 必须相同 |
| 参数列表 | **必须不同** | **必须完全相同** |
| 返回值 | 无要求 | 相同或协变（子类更小） |
| 访问修饰符 | 无要求 | 不能比父类更严格 |
| 异常 | 无要求 | 不能抛出更宽泛的受检异常 |
| 绑定时机 | **编译期**（静态绑定） | **运行期**（动态绑定） |
| 本质 | 多个同名不同参的方法 | 子类改写父类的行为 |

一句话区分：**重载是"人多力量大"（同名干不同的活），重写是"子承父业却改了做法"（同名干同样的活、换实现）。**

```java
package com.canoe.oop.overload;

class AnimalOver {
    // 父类方法（将被重写）
    public void speak() {
        System.out.println("动物叫");
    }
}

class CatOver extends AnimalOver {
    // 重写：方法签名完全一致，运行期决定调谁
    @Override
    public void speak() {
        System.out.println("喵喵");
    }
}

public class OverloadVsOverride {
    // 重载：同类同名不同参
    public void test(int x) { }
    public void test(String s) { }

    public static void main(String[] args) {
        AnimalOver a = new CatOver();  // 多态：编译期类型 Animal，运行期 Cat
        a.speak();                     // 运行期动态绑定 → 喵喵（这是重写）
    }
}
```

## 五、重载的匹配规则

调用一个重载方法时，编译器按下面的优先级挑选最合适的：

```text
精确匹配（类型完全对上）
   ↓ 不行就
自动类型提升（如 int → long → double，或 char → int）
   ↓ 不行就
自动装箱 / 拆箱（int ↔ Integer）
   ↓ 不行就
可变参数（int...）
```

```java
package com.canoe.oop.overload;

public class MatchRule {

    public void m(int x) {
        System.out.println("m(int)");
    }

    public void m(long x) {
        System.out.println("m(long)");
    }

    public void m(Integer x) {
        System.out.println("m(Integer)");
    }

    public void m(int... x) {
        System.out.println("m(int...)");
    }

    public static void main(String[] args) {
        MatchRule r = new MatchRule();
        r.m(10);        // 精确匹配 → m(int)
        r.m(10L);       // 精确匹配 → m(long)
        r.m((Integer) 10); // m(Integer)
        r.m();          // 没有精确参数，落到可变参数 → m(int...)
    }
}
```

**经典 `null` 陷阱**：当重载方法有 `String` 和 `Object` 两个版本，`m(null)` 会编译失败——因为 `null` 既能匹配 `String` 也能匹配 `Object`，编译器无法确定选谁（歧义）。

```java
package com.canoe.oop.overload;

public class NullTrap {
    public void m(String s) {
        System.out.println("String 版");
    }

    public void m(Object o) {
        System.out.println("Object 版");
    }

    public static void main(String[] args) {
        NullTrap t = new NullTrap();
        // t.m(null);  // 编译错误：对 m 的引用不明确
        t.m((String) null);   // 强转消除歧义 → String 版
    }
}
```

## 六、自动类型转换带来的歧义

当多个重载版本都能通过"类型提升"匹配到实参，且找不到唯一最精确的那一个，编译器就报"引用不明确"：

```java
package com.canoe.oop.overload;

public class Ambiguity {
    public void n(long x) {
        System.out.println("long");
    }

    public void n(double x) {
        System.out.println("double");
    }

    public static void main(String[] args) {
        Ambiguity a = new Ambiguity();
        // a.n(10);  // 编译错误：int 既能提升到 long 也能到 double，二义性
        a.n(10L);   // 明确给 long，消除歧义
    }
}
```

`10` 是 `int`，它同时可以提升到 `long` 和 `double`，两个重载"一样近"，编译器无法取舍就报错。解决：要么实参加类型后缀（`10L`），要么干脆别定义这种互相能提升的同名方法。

## 本篇小结

- **重载**是同类中"方法名相同、参数列表不同"，编译器靠方法签名定位。
- 判断重载**只看参数列表**，返回值和修饰符不参与。
- 构成重载的三条件：**类型不同、个数不同、顺序不同**。
- 仅返回值不同、仅参数名不同、仅修饰符不同 **都不算重载**，会编译报错。
- **重载是编译期静态绑定**，发生在同一个类内部。
- **重写是运行期动态绑定**，发生于有继承的父子类之间。
- 重载匹配优先级：**精确 → 类型提升 → 装箱 → 可变参数**。
- `null` 实参在 `String`/`Object` 重载下产生**二义性编译错误**，需强转消歧。
- `int` 同时可提升到 `long`/`double` 时会造成**模糊匹配报错**。
- 重载提升代码调用友好度（如 `println` 多种类型），但**顺序重载可读性差应少用**。
- 重载与重写一字之差，本质区别在**范围与绑定时机**，务必分清。

## 参考链接

- [Oracle Java 语言规范：方法重载](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.4.9)
- [Oracle Java 教程：方法重载](https://docs.oracle.com/javase/tutorial/java/javaOO/methods.html)
- [Oracle Java 语言规范：方法调用解析](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.12)
- [Oracle Java 教程：多态（含重写）](https://docs.oracle.com/javase/tutorial/java/concepts/polymorphism.html)
- [廖雪峰 Java 教程：方法重载](https://www.liaoxuefeng.com/wiki/1252599548343744/1260451468211664)
- [Baeldung：Java 方法重载](https://www.baeldung.com/java-method-overloading)
- [Stack Overflow：重载与重写的区别](https://stackoverflow.com/questions/1660234/method-overloading-vs-overriding)

下一篇 → [05 继承](/java/oop/extend)
