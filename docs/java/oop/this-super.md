# 13 this 与 super

> 本篇导读：`this` 和 `super` 是 Java 里最容易"看着懂、写着错"的两个关键字。`this` 指向"当前对象"，`super` 指向"父类那部分"。本篇逐一拆解它们的四种核心用法，讲清为何一个构造器里二者不能共存、构造链为何常让新手编译报错，以及那些隐藏的致命错误。

## 一、this 的三种用法

`this` 代表"当前对象（正在被创建/调用的那个实例）"，三种用法：

**1. 指代当前对象**，在需要"把我自己传出去"时用：

```java
package com.canoe.oop.thissuper;

// this 用法 1 & 2：指代当前对象、区分成员变量与局部变量
public class Person {
    private String name;

    public Person(String name) {
        this.name = name; // this 区分成员变量与局部变量
    }

    // this 用法 1：返回当前对象自身，支持链式调用
    public Person rename(String name) {
        this.name = name;
        return this;
    }

    public void show() {
        System.out.println("我叫 " + this.name);
    }
}

// 演示 this 的链式调用
class PersonDemo {
    public static void main(String[] args) {
        new Person("小明").rename("小红").show(); // 输出：我叫 小红
    }
}
```

**2. 调用本类其他构造器 `this(...)`**，**必须写在构造器的第一行**：

```java
package com.canoe.oop.thissuper;

public class Book {
    private String title;
    private double price;

    // 全参构造器
    public Book(String title, double price) {
        this.title = title;
        this.price = price;
    }

    // 无参构造器：通过 this(...) 复用上面的逻辑
    public Book() {
        this("未命名", 0.0); // 必须第一行
    }

    public void show() {
        System.out.println(title + " " + price);
    }
}
```

## 二、super 的三种用法

`super` 指向"当前对象里属于父类的那部分"，三种用法：

**1. 访问父类被遮蔽的成员**：

```java
package com.canoe.oop.thissuper;

class Animal {
    protected String name = "动物";
}

class Cat extends Animal {
    private String name = "猫"; // 遮蔽父类 name
    public void showNames() {
        System.out.println(name);        // 猫（子类自己的）
        System.out.println(super.name);  // 动物（父类被遮蔽的）
    }
}
```

**2. 调用父类构造器 `super(...)`**，**必须第一行**：

```java
package com.canoe.oop.thissuper;

class Animal {
    protected String name;
    public Animal(String name) {
        this.name = name;
    }
}

class Cat extends Animal {
    private String color;
    public Cat(String name, String color) {
        super(name);     // 必须第一行：先初始化父类部分
        this.color = color;
    }
}
```

**3. 在重写方法中调用父类的实现**（扩展式重写）：

```java
package com.canoe.oop.thissuper;

class Animal {
    protected String name;
    public Animal(String name) { this.name = name; }
    public void eat() {
        System.out.println(name + "在吃东西");
    }
}

class Cat extends Animal {
    private String color;
    public Cat(String name, String color) {
        super(name);
        this.color = color;
    }
    @Override
    public void eat() {
        super.eat(); // 先执行父类逻辑
        System.out.println(name + "吃的是鱼，毛色 " + color); // 再扩展
    }
}

// 演示 super 的复用效果
class CatDemo {
    public static void main(String[] args) {
        Cat cat = new Cat("咪咪", "橘色");
        cat.eat();
    }
}
```

## 三、this 与 super 不能共存

`this(...)` 和 `super(...)` **都要求写在第一行**，所以一个构造器里**只能有其中一个**（不写时，Java 默认补一个 `super()`）。

```java
package com.canoe.oop.thissuper;

class Conflict {
    // 编译错误示例（示意，实际写进构造器会报错）：
    // public Conflict() {
    //     this("x");   // 想调用本类其他构造器
    //     super();     // 又想调用父类构造器 —— 两者都要第一行，冲突！
    // }
}
```

规则记忆：**构造器第一行要么是 `this(...)`，要么是 `super(...)`，要么都不写（默认 `super()`）**，不可能两个都在。

## 四、构造链

子类构造器**默认先隐式调用 `super()`**（父类的无参构造器）。如果父类**没有无参构造器**，子类又没显式 `super(...)`，就会编译报错——这是新手最高频的错误之一。

错误代码：

```java
package com.canoe.oop.thissuper;

class Parent {
    public Parent(String id) { } // 只有有参构造器，无参构造器消失
}

// 编译错误：隐式 super() 找不到父类的无参构造器
// class Child extends Parent {
//     public Child() { }
// }
```

修复：显式调用父类的有参构造器。

```java
package com.canoe.oop.thissuper;

class Parent {
    public Parent(String id) { }
}

class Child extends Parent {
    public Child() {
        super("default-id"); // 显式调用父类有参构造器，编译通过
    }
}
```

记住：**只要父类写了带参构造器，就顺手补一个无参构造器**，能免去子类一大堆报错。

## 五、方法重写时用 super 复用

这种"先 `super.xxx()` 再补自己的逻辑"的写法叫**扩展式重写**，比完全重写更安全——父类的约束和副作用都被保留了。

```java
package com.canoe.oop.thissuper;

class Logger {
    public void log(String msg) {
        System.out.println("[base] " + msg);
    }
}

class TimestampLogger extends Logger {
    @Override
    public void log(String msg) {
        super.log(msg); // 复用父类输出
        System.out.println("[time] " + System.currentTimeMillis());
    }
}
```

## 六、常见错误清单

**1. 构造器里调用可被重写的方法**：此时子类对象尚未构造完，字段还是默认值，极其危险。

```java
package com.canoe.oop.thissuper;

class Base {
    public Base() {
        init(); // 危险：调用了会被子类重写的方法
    }
    public void init() {
        System.out.println("Base.init");
    }
}

class Derived extends Base {
    private int value = 42;
    @Override
    public void init() {
        System.out.println("value=" + value); // 输出 0！子类字段还没初始化
    }
}
```

**2. 静态方法里用 `this` / `super`**：静态方法没有对象上下文，编译直接报错。

**3. 在构造器中把 `this` 逸出**：比如把 `this` 传给别的线程或静态集合，对象还没构造好就被别人使用，会引发难以排查的并发 bug。

## 本篇小结

- **`this` 指向当前对象**，用于指代自身、区分变量、调用本类构造器。
- **`super` 指向父类的那部分**，用于访问父类成员、调父类构造器、复用父类实现。
- `this(...)` 与 `super(...)` 都**必须写在第一行**，二者互斥。
- 不写 `this(...)` / `super(...)` 时，构造器**默认补 `super()`**。
- 子类构造器**默认先调父类无参构造器**。
- 父类**只写了带参构造器**会丢掉无参构造器，导致子类编译报错。
- 修复办法：子类**显式 `super(实参)`**，或父类补无参构造器。
- **扩展式重写**用 `super.method()` 先复用再增强，比完全重写更安全。
- 构造器里**不要调用可被重写的方法**，子类字段还没初始化。
- **静态方法没有 `this` / `super`**，且禁止在构造器中逸出 `this`。

## 参考链接

- [Oracle 教程：this 关键字](https://docs.oracle.com/javase/tutorial/java/javaOO/thiskey.html)
- [Oracle 教程：super 关键字](https://docs.oracle.com/javase/tutorial/java/javaOO/super.html)
- [Java 语言规范：this 表达式](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.8.3)
- [Java 语言规范：super 表达式](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.11.2)
- [Java 语言规范：构造器调用](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.8.7)
- [Baeldung：Java 中 this 与 super 的区别](https://www.baeldung.com/java-this-super)

下一篇 → [返回专栏首页](/java/oop/base)
