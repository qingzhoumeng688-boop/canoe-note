# 02 方法

方法是 Java 里最基本的"代码封装单元"：把一段可复用的逻辑起个名字，需要的时候叫一声就行。本篇从方法的定义、形参实参、返回值，一路讲到重载、可变参数、递归，再到静态/实例方法的区别，最后聊聊怎么把方法写得好看又好用。

## 一、方法的定义

方法的标准语法结构是：

```text
[修饰符] 返回值类型 方法名([参数列表]) {
    // 方法体
    [return 返回值;]
}
```

- **修饰符**：`public` / `private` / `static` / `final` 等；
- **返回值类型**：有返回值写具体类型，无返回值写 `void`；
- **方法名**：遵守**小驼峰、动词开头**的命名规范，比如 `calculateScore()`、`sendEmail()`；
- **参数列表**：多个参数用逗号隔开，每个都要写"类型 名字"。

```java
package com.canoe.oop.method;

public class MethodDefine {

    // 完整写法：public 修饰符 + int 返回值 + 小驼峰方法名 + 两个参数
    public int add(int a, int b) {
        return a + b;
    }

    // 无返回值：void
    public void printSum(int a, int b) {
        System.out.println("和是 " + (a + b));
    }

    public static void main(String[] args) {
        MethodDefine m = new MethodDefine();
        int result = m.add(3, 5);
        System.out.println("3 + 5 = " + result);
        m.printSum(10, 20);
    }
}
```

坏的命名反例：`a()`、`doThing()`、`get1()`——看名字完全不知道在干嘛。方法名应该**见名知意，像一句话的动词短语**。

## 二、形参与实参

- **形参（formal parameter）**：方法定义时括号里的变量，只是个"占位符"；
- **实参（actual parameter）**：调用方法时真正传进去的值。

```java
package com.canoe.oop.method;

public class ParamDemo {
    // x、y 是形参
    static int multiply(int x, int y) {
        return x * y;
    }

    public static void main(String[] args) {
        int a = 4, b = 6;
        // a、b 是实参，它们的值被复制给 x、y
        int r = multiply(a, b);
        System.out.println(r);  // 24
    }
}
```

这里再次呼应上一章的结论：**Java 是值传递**。实参把"值"复制一份交给形参，方法里怎么折腾形参，都不影响外面实参本身（除非传的是引用类型、且改的是对象内部属性）。

## 三、返回值

三种要点：

1. 声明了具体返回值类型，就**必须**在所有代码路径上都 `return` 一个同类型的值；
2. `void` 表示不返回任何东西，可以只写 `return;` 提前结束，也可以省略；
3. `return` 一旦执行，方法立即结束，后面代码不再运行。

```java
package com.canoe.oop.method;

public class ReturnDemo {

    // 错误示范（编译不过）：方法声明返回 int，但 if 分支没 return
    // public static int bad(int x) {
    //     if (x > 0) {
    //         return 1;
    //     }
    //     // x <= 0 时没有 return，编译器报错
    // }

    // 正确：每个分支都有返回值
    public static int abs(int x) {
        if (x >= 0) {
            return x;
        }
        return -x;   // 走到这里必然走不到上面的 return，逻辑闭合
    }

    // return 提前结束方法
    public static void check(int age) {
        if (age < 0) {
            System.out.println("年龄非法，直接返回");
            return;   // 提前退出，下面不再执行
        }
        System.out.println("年龄 = " + age);
    }

    public static void main(String[] args) {
        System.out.println("绝对值：" + abs(-9));
        check(-1);
        check(20);
    }
}
```

## 四、方法重载 Overload

同一类里，**方法名相同、参数列表不同**，就叫重载。编译器靠"方法名 + 参数列表"来区分，所以**只看参数列表，返回值类型不同不算重载**。

```java
package com.canoe.oop.method;

public class OverloadDemo {

    // 1. 两个 int 相加
    public int add(int a, int b) {
        return a + b;
    }

    // 2. 三个 int 相加（参数个数不同）
    public int add(int a, int b, int c) {
        return a + b + c;
    }

    // 3. 两个 double 相加（参数类型不同）
    public double add(double a, double b) {
        return a + b;
    }

    public static void main(String[] args) {
        OverloadDemo o = new OverloadDemo();
        System.out.println(o.add(1, 2));
        System.out.println(o.add(1, 2, 3));
        System.out.println(o.add(1.5, 2.5));
    }
}
```

> 正例：`add(int,int)` 与 `add(double,double)` 合法。**反例**：仅把返回值从 `int` 改成 `double`，方法名和参数都不变——这是**重复定义**，编译报错。重载的完整规则在 [04 方法重载](/java/oop/overload) 里细讲。

## 五、可变参数

当参数个数不确定时，用 `类型... 名字` 表示可变参数（varargs）。本质上它就是一个**数组**，调用时可传逗号分隔的多个值，或不传。

```java
package com.canoe.oop.method;

public class VarargsDemo {

    // 求任意个整数的和
    public static int sum(int... nums) {
        int total = 0;
        for (int n : nums) {   // nums 本质是 int[]
            total += n;
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(sum(1, 2));          // 3
        System.out.println(sum(1, 2, 3, 4));   // 10
        System.out.println(sum());             // 0（不传也行）
    }
}
```

三条铁律：

- **必须放在参数列表最后**；
- 一个方法**只能有一个**可变参数；
- 它和"数组参数"重载时会产生歧义（编译器分不清），所以不要同时定义 `sum(int...)` 和 `sum(int[])`。

## 六、递归

递归 = 方法**自己调用自己**。两个必备条件：

1. **终止条件（基线情形）**：什么时候不再递归，直接返回；
2. **递推公式（递归步骤）**：把问题拆成规模更小的同类子问题。

阶乘 `n! = n * (n-1)!`：

```java
package com.canoe.oop.method;

public class RecursionDemo {

    // 阶乘：n! = n * (n-1)!
    static long factorial(int n) {
        if (n <= 1) {          // 终止条件
            return 1;
        }
        return n * factorial(n - 1);  // 递推，规模 -1
    }

    // 斐波那契：f(n) = f(n-1) + f(n-2)
    static long fib(int n) {
        if (n == 1 || n == 2) {
            return 1;
        }
        return fib(n - 1) + fib(n - 2);
    }

    public static void main(String[] args) {
        System.out.println("5! = " + factorial(5));  // 120
        System.out.println("fib(7) = " + fib(7));    // 13
    }
}
```

**栈溢出风险**：每递归一层就压一个栈帧，没有终止条件或层数太深会抛 `StackOverflowError`。而且像斐波那契这样直接递归会大量重复计算（`fib(5)` 算了两次 `fib(3)`），性能很差——这种情况**应当改用循环或记忆化（缓存中间结果）**。经验法则：能用循环清晰表达的，就别硬上递归；树、图、分治这类天然递归结构才适合递归。

## 七、静态方法与实例方法

| 维度 | 实例方法 | 静态方法（`static`） |
| --- | --- | --- |
| 调用方式 | `对象.方法()` | `类名.方法()`（也可对象调，但不推荐） |
| 能否访问实例字段 | 能 | **不能**（没有 `this`） |
| 能否访问静态成员 | 能 | 能 |
| 典型用途 | 对象行为 | 工具函数、工厂方法 |

```java
package com.canoe.oop.method;

public class StaticVsInstance {

    private int count = 0;          // 实例字段
    private static int total = 0;   // 静态字段（类级别）

    // 实例方法：依赖具体对象的状态
    public void increment() {
        count++;
        total++;
    }

    // 静态方法：不依赖任何对象，不能访问 count
    public static int getTotal() {
        return total;   // 只能访问静态字段
        // return count;  // 编译报错：静态方法无 this
    }

    public static void main(String[] args) {
        StaticVsInstance a = new StaticVsInstance();
        a.increment();
        StaticVsInstance b = new StaticVsInstance();
        b.increment();

        System.out.println("总次数（类级别）：" + StaticVsInstance.getTotal());
    }
}
```

**什么时候用 `static`**：这个方法不依赖对象状态、纯靠参数算结果（如 `Math.max`），或想当工具类方法（如 `Collections.sort`）。反之，方法要读写对象自己的字段，就必须是实例方法。

## 八、方法的设计原则

好的方法像好员工：职责单一、交代清楚、不捅娄子。

- **单一职责**：一个方法只做一件事。别写个 `saveUserAndSendEmailAndLog()`，拆成三个。
- **控制参数个数**：参数超过 4 个就考虑封装成对象（如 `QueryParam`），不然调用方记不住顺序。
- **避免副作用**：名字叫 `calculateX()` 就别顺手改了数据库；方法做了什么要和它的名字一致。
- **命名表达意图**：`getUserById(id)` 比 `proc(id)` 强一百倍。

```java
package com.canoe.oop.method;

import java.util.List;
import java.util.ArrayList;

public class MethodDesign {

    // 反例：参数太多、名字含糊、还顺带干别的事
    // void proc(int a, String b, boolean c, double d) { ... }

    // 正例：职责单一、见名知意、参数少
    static List<String> findActiveUsers(List<String> allUsers) {
        List<String> active = new ArrayList<String>();
        for (String u : allUsers) {
            if (u != null && !u.isEmpty()) {
                active.add(u);
            }
        }
        return active;
    }

    public static void main(String[] args) {
        List<String> users = new ArrayList<String>();
        users.add("小明");
        users.add("");
        users.add("小红");
        System.out.println("活跃用户：" + findActiveUsers(users));
    }
}
```

## 本篇小结

- 方法语法由**修饰符、返回值、方法名、参数列表、方法体**组成，命名用小驼峰动词开头。
- **形参**是定义时的占位符，**实参**是调用时传入的值，Java 传递始终为值传递。
- 声明了返回值类型就**所有分支都必须 `return`**，`void` 可不写返回值。
- `return` 执行即**方法结束**，后续代码不再运行。
- **重载**靠"方法名 + 参数列表"区分，**仅返回值不同不算重载**。
- **可变参数**本质是数组，必须放最后、且一个方法只能有一个。
- **递归**需有终止条件与递推公式，滥用会 `StackOverflowError` 且重复计算。
- **静态方法**无 `this`，不能访问实例成员，适合纯工具函数。
- **实例方法**依赖具体对象状态，可访问静态与实例成员。
- 方法应遵循**单一职责**，参数别超过四个，避免名字与行为不符的副作用。
- 好方法名要**见名知意**，让调用方一眼看懂做了什么。

## 参考链接

- [Oracle Java 教程：定义方法](https://docs.oracle.com/javase/tutorial/java/javaOO/methods.html)
- [Oracle Java 教程：可变参数](https://docs.oracle.com/javase/tutorial/java/javaOO/arguments.html#varargs)
- [Oracle Java 语言规范：方法](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.4)
- [Oracle Java 语言规范：方法调用](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.12)
- [Oracle Java 教程：递归](https://docs.oracle.com/javase/tutorial/java/javaOO/recursion.html)
- [廖雪峰 Java 教程：方法](https://www.liaoxuefeng.com/wiki/1252599548343744/1260451468211664)
- [Baeldung：Java 方法重载](https://www.baeldung.com/java-method-overloading)

下一篇 → [03 构造方法](/java/oop/constructor)
