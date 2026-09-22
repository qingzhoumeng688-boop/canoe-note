# 11 访问作用域

> 本篇导读：访问修饰符决定了"谁能看到谁"，它是封装的守门人。本篇给出 private / 默认 / protected / public 的完整可见性矩阵，讲清外部类与内部类的修饰差异、protected 那点反直觉的规则，再落到封装实践、final 变量与变量遮蔽，帮你少踩 90% 的可见性坑。

## 一、四种访问修饰符

从"最封闭"到"最开放"依次是：

| 修饰符 | 同类 | 同包 | 子类(同/异包) | 其他包 |
| --- | --- | --- | --- | --- |
| `private` | 是 | 否 | 否 | 否 |
| 默认(包级) | 是 | 是 | 否 | 否 |
| `protected` | 是 | 是 | 是 | 否 |
| `public` | 是 | 是 | 是 | 是 |

记忆口诀：**private 关上门，默认关上楼，protected 给自家孩子留钥匙，public 敞开大门**。

## 二、类的访问修饰

- **外部类**：只能是 `public` 或默认（包级）。不能写 `private` / `protected`，因为外部类没有"外部包裹者"去限制它。
- **内部类**：可以任意修饰，包括 `private`，从而把内部类彻底藏起来只给外部类用。

```java
package com.canoe.oop.scope;

public class Outer {            // 外部类：public
    private class HiddenInner { // 内部类：private，外部完全看不到
        void secret() { System.out.println("只有 Outer 能用"); }
    }
}
```

## 三、protected 的特殊性

`protected` 有两种访问途径，后一种最容易踩坑：

1. **同包内任意类**都能访问（和默认修饰符一样宽松）；
2. **不同包的子类**，只能通过"子类自身（或其子类）的实例"访问，**不能通过父类引用或"兄弟子类"访问**。

经典反例：子类在另一个包，试图用父类引用去读 `protected` 成员——编译失败。

```java
package com.canoe.oop.scope;

// 基类放在 com.canoe.oop.scope
public class Parent {
    protected String secret = "只有子类能看";
    protected void showSecret() {
        System.out.println(secret);
    }
}
```

```java
package com.canoe.oop.scope.other;

import com.canoe.oop.scope.Parent;

// 子类放在另一个包
public class Child extends Parent {
    public void test() {
        System.out.println(secret);   // OK：通过子类自身实例访问
        showSecret();                 // OK：继承自父类的方法

        Parent p = new Parent();
        // System.out.println(p.secret); // 编译错误：跨包不能用父类引用访问
    }
}
```

为什么这么设计？`protected` 的本意是"给家族内部用"，既然你已是 `Parent` 的子孙，用自己的家族身份访问没问题；但用"旁系父类对象"去翻它的隐私，就越界了。

## 四、封装的实践

封装的黄金法则：**字段一律 `private`，通过方法暴露"行为"而非"数据"**。

反模式——"问对象要数据，再替它做事"：

```java
// 糟糕：把内部状态交出去，调用方随意修改，对象失去控制权
user.getAge();        // 拿到年龄
// ...外部一堆逻辑基于 age 计算...
```

正解——让对象自己做事：

```java
package com.canoe.oop.scope;

public class Account {
    private double balance;

    public Account(double balance) {
        this.balance = balance;
    }

    // 暴露行为，而不是暴露 balance 字段
    public void deposit(double amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("金额必须为正");
        }
        balance += amount;
    }

    public boolean canAfford(double price) {
        return balance >= price; // 业务规则留在对象内部
    }
}
```

这样余额怎么变、有哪些约束，全由 `Account` 自己把控，外部无法绕过。

## 五、final 修饰符

`final` = "不可变"，但作用对象不同，含义不同：

- 修饰**类**：不能被继承（`String` 就是 `final` 类，所以没人能继承它）；
- 修饰**方法**：不能被子类重写；
- 修饰**变量**：**引用不可变，但对象内容可变**——这是重点。

```java
package com.canoe.oop.scope;

import java.util.ArrayList;
import java.util.List;

public class FinalDemo {
    public static void main(String[] args) {
        final List<String> list = new ArrayList<>();
        list.add("A");   // OK：对象内容可以改
        list.add("B");
        System.out.println(list);

        // list = new ArrayList<>(); // 编译错误：引用不能再指向别的对象
    }

    // final 方法：子类不能重写
    public final void locked() {
        System.out.println("不可被重写");
    }
}
```

`final` 的变量常用来定义常量，但真正的"常量"要配合 `static`（见下文）。

## 六、变量作用域

Java 有三层变量：

- **成员变量**（类里、方法外）：随对象存在；
- **局部变量**（方法/代码块内）：出了作用域就失效；
- **块级变量**（如 `for` 循环里）：只在块内可见。

当局部变量和成员变量**同名**，会发生**遮蔽（shadowing）**：局部变量"盖住"成员变量。用 `this` 区分：

```java
package com.canoe.oop.scope;

public class Shadow {
    private int value = 10; // 成员变量

    public void print(int value) { // 局部变量，与成员变量同名
        System.out.println(value);      // 10? 不，是参数值，比如传入 99
        System.out.println(this.value); // 用 this 指向成员变量 -> 10
    }

    public static void main(String[] args) {
        new Shadow().print(99);
    }
}
```

遮蔽本身不是错误，但容易让读代码的人（和你三个月后）头晕，建议**避免同名**；实在撞名就用 `this.` 明确。

## 本篇小结

- 四种修饰符开放度：`private` 小于 默认 小于 `protected` 小于 `public`。
- **外部类只能是 `public` 或默认**；内部类可以是 `private`。
- `protected` 支持**同包任意访问 + 异包子类自身实例访问**。
- 异包子类**不能用父类引用**访问 `protected` 成员（经典反例）。
- 封装原则：**字段 `private`，通过方法暴露行为**而非数据。
- `final` 类不可继承，`final` 方法不可重写。
- **`final` 引用不可变，但对象内容可变**。
- 变量分**成员、局部、块级**三层作用域。
- 同名时局部变量会**遮蔽成员变量**，用 `this.` 区分。
- 真实常量应写成 `public static final`（见[静态篇](/java/oop/static)）。

## 参考链接

- [Oracle 教程：访问控制](https://docs.oracle.com/javase/tutorial/java/javaOO/accesscontrol.html)
- [Java 语言规范：成员与构造器访问控制](https://docs.oracle.com/javase/specs/jls/se17/html/jls-6.html#jls-6.6)
- [Java 语言规范：final 变量](https://docs.oracle.com/javase/specs/jls/se17/html/jls-4.html#jls-4.12.4)
- [Baeldung：Java 中 protected 的访问规则](https://www.baeldung.com/java-protected-access-modifier)
- [Oracle 教程：封装](https://docs.oracle.com/javase/tutorial/java/javaOO/accesscontrol.html)
- [Baeldung：变量遮蔽与隐藏](https://www.baeldung.com/java-variable-shadowing-hiding)

下一篇 → [12 内部类](/java/oop/innerclass)
