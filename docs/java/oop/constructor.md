# 03 构造方法

`new` 后面那对括号不是随便写的——它调用的是**构造方法（Constructor）**。构造方法专门负责"把对象初始化成我们想要的样子"。本篇讲清它是什么、语法规则、那个经典的"默认构造器消失"坑，以及对象创建时一堆初始化代码的真实执行顺序。

## 一、构造方法是什么

你之前看到的 `Car car1 = new Car();` 里，`Car()` 就是构造方法。它做两件事：

```text
new Car()  =  ① 在堆里"造出"一个空白对象  +  ② 调用构造方法"初始化"它
```

也就是说，**"造对象"和"初始化对象"是两个阶段**：JVM 先按类的大小分配好内存（字段都是默认值 0/null），然后立刻调用构造方法给字段赋上有意义的值。没有构造方法，你拿到的就是个"空壳"。

```java
package com.canoe.oop.constructor;

public class Phone {
    String brand;
    int price;

    // 构造方法：new 时自动调用，用来初始化
    public Phone(String brand, int price) {
        this.brand = brand;
        this.price = price;
        System.out.println("一部 " + brand + " 手机造好了，价格 " + price);
    }

    public static void main(String[] args) {
        Phone p = new Phone("华为", 4999);  // 这里括号就是在调用构造方法
        System.out.println(p.brand);
    }
}
```

## 二、语法规则

构造方法长得很像方法，但有三条硬规矩：

1. **方法名必须与类名完全相同**（包括大小写）；
2. **没有返回值类型，连 `void` 都不能写**——写了 `void` 它就变成普通方法，不再是构造器；
3. **可以重载**（同名不同参，见第四节）。

```java
package com.canoe.oop.constructor;

public class Rule {
    // 这是构造方法：没写返回值，名字 = 类名
    public Rule() {
    }

    // 如果写成 public void Rule() { } 就只是个普通方法，不是构造器！
}
```

> 因为没返回值类型，所以不能用 `return 值;` 返回东西（可以写 `return;` 提前结束，但几乎没人这么干）。

## 三、默认构造器

**这是面试高频坑：你不写任何构造器时，编译器会自动送你一个"无参构造器"；可一旦你手写了任意一个有参构造器，那个免费的无参构造器就消失了。**

```java
package com.canoe.oop.constructor;

public class User {
    private String name;

    // 只写了有参构造器
    public User(String name) {
        this.name = name;
    }
}
```

此时如果在别处写 `new User();`，编译器会报错：

```text
错误: 无法将类 User 中的构造器 User 应用到给定类型;
        需要: String
        找到: 没有参数
```

**为什么这是个坑**：很多框架（Spring、Jackson、反射）会偷偷调用无参构造器来创建对象，你手写了有参构造器却忘了补无参的，框架就炸了。

正确做法——**一旦写了有参构造器，记得手动补一个无参构造器**：

```java
package com.canoe.oop.constructor;

public class User {
    private String name;

    // 手写无参构造器，保平安
    public User() {
    }

    public User(String name) {
        this.name = name;
    }
}
```

## 四、构造器重载

和普方法一样，构造器可以重载：提供多种"初始化套餐"。关键是**用 `this(...)` 复用别的构造器**，避免重复代码——注意 `this(...)` 必须是构造器体的第一行。

```java
package com.canoe.oop.constructor;

public class Computer {
    private String cpu;
    private int memory;
    private String disk;

    // 全参构造器：真正干活的那个
    public Computer(String cpu, int memory, String disk) {
        this.cpu = cpu;
        this.memory = memory;
        this.disk = disk;
    }

    // 两个参数的：复用全参构造器，硬盘给默认值
    public Computer(String cpu, int memory) {
        this(cpu, memory, "512G SSD");   // 必须第一行
    }

    // 无参：复用两参构造器，给一套基础配置
    public Computer() {
        this("i5", 16);                  // 必须第一行
    }

    void show() {
        System.out.println(cpu + " / " + memory + "G / " + disk);
    }

    public static void main(String[] args) {
        new Computer().show();                       // i5 / 16G / 512G SSD
        new Computer("i7", 32).show();               // i7 / 32G / 512G SSD
        new Computer("i9", 64, "2T SSD").show();     // i9 / 64G / 2T SSD
    }
}
```

## 五、构造器的执行顺序

当类有父类时，构造顺序是：**先父类构造 → 再本类成员初始化 → 最后本类构造器体**。下面用打印验证（配合构造代码块）。

```java
package com.canoe.oop.constructor;

class Animal {
    Animal() {
        System.out.println("父类 Animal 构造器");
    }
}

public class Dog extends Animal {
    // 构造代码块：每次 new 都会执行，介于成员初始化和构造器体之间
    {
        System.out.println("子类 Dog 构造代码块");
    }

    private String name = initName();   // 成员字段显式初始化

    private String initName() {
        System.out.println("子类 Dog 字段 name 初始化");
        return "旺财";
    }

    Dog() {
        // 隐含 super() 在第一行，先调父类构造
        System.out.println("子类 Dog 构造器体");
    }

    public static void main(String[] args) {
        new Dog();
    }
}
```

输出（看清先后）：

```text
父类 Animal 构造器
子类 Dog 字段 name 初始化
子类 Dog 构造代码块
子类 Dog 构造器体
```

## 六、创建对象时发生了什么

把第五节的顺序补全到"完整清单"，从类加载到构造器结束，每一步都跑一遍：

```text
1. 类加载（仅首次）：执行静态代码块
2. 在堆分配内存，字段先给默认值（0 / null / false）
3. 字段显式初始化（private int x = 10;）
4. 构造代码块（{ ... }）
5. 构造器体（含隐含的 super() 在最前）
```

用完整示例打印验证：

```java
package com.canoe.oop.constructor;

public class InitOrder {
    // 静态代码块：类加载时执行一次
    static {
        System.out.println("[1] 静态代码块");
    }

    // 字段显式初始化
    private int a = initA();

    private int initA() {
        System.out.println("[3] 字段 a 显式初始化");
        return 1;
    }

    // 构造代码块
    {
        System.out.println("[4] 构造代码块");
    }

    // 构造器
    public InitOrder() {
        System.out.println("[5] 构造器体");
    }

    public static void main(String[] args) {
        System.out.println("[2] main 开始，准备 new");
        new InitOrder();
        System.out.println("再次 new（静态代码块不再执行）");
        new InitOrder();
    }
}
```

输出：

```text
[1] 静态代码块
[2] main 开始，准备 new
[3] 字段 a 显式初始化
[4] 构造代码块
[5] 构造器体
再次 new（静态代码块不再执行）
[3] 字段 a 显式初始化
[4] 构造代码块
[5] 构造器体
```

> 注意 `[1]` 静态代码块**只在类第一次加载时跑一次**，第二次 `new` 不再执行。

## 七、私有构造器

把构造器设为 `private`，外部就**不能用 `new` 创建对象**了。两个经典用途：

1. **单例模式**：整个程序只允许有一个实例，构造器私有，对外提供静态 `getInstance()`；
2. **工具类**：像 `Math`、`Collections` 这种只有静态方法的类，私有构造器防止被人误实例化。

```java
package com.canoe.oop.constructor;

// 单例模式（懒汉式最简版，教学用）
public class ConfigManager {
    // 自己持有一个唯一实例
    private static ConfigManager instance;

    // 私有构造器：外部 new 不了
    private ConfigManager() {
        System.out.println("配置管理器只初始化一次");
    }

    // 对外提供获取实例的静态方法
    public static ConfigManager getInstance() {
        if (instance == null) {
            instance = new ConfigManager();
        }
        return instance;
    }

    public void print() {
        System.out.println("这是全局唯一的配置管理器");
    }

    public static void main(String[] args) {
        ConfigManager a = ConfigManager.getInstance();
        ConfigManager b = ConfigManager.getInstance();
        a.print();
        System.out.println("a 和 b 是同一个对象？ " + (a == b));  // true
    }
}
```

> 工具类写法：`public class MathUtils { private MathUtils() { throw new AssertionError(); } ... }`，连反射都防一手。

## 本篇小结

- **构造方法**负责在 `new` 时初始化对象，分"分配内存"和"初始化"两步。
- 构造方法**名字必须与类名相同，且不能有返回值类型**（连 `void` 都不行）。
- 构造方法**可以重载**，同名不同参提供多种初始化方式。
- **默认无参构造器只在"没写任何构造器"时由编译器赠送**。
- 一旦写了**有参构造器，无参构造器会消失**，框架反射常因此报错。
- 用 **`this(...)` 复用构造器**能消除重复代码，且必须写在第一行。
- 有父类时顺序为 **父类构造 → 子类成员初始化 → 子类构造器体**。
- 完整初始化顺序：**静态块 → 默认值 → 显式初始化 → 构造代码块 → 构造器体**。
- **静态代码块只在类首次加载时执行一次**，与 `new` 次数无关。
- **私有构造器**用于单例和工具类，阻止外部随意 `new` 对象。
- 单例通过**私有构造器 + 静态 getInstance()** 保证全局唯一实例。
- 工具类私有化构造器能**防止被误实例化**，是良好的 API 设计习惯。

## 参考链接

- [Oracle Java 教程：构造方法](https://docs.oracle.com/javase/tutorial/java/javaOO/constructors.html)
- [Oracle Java 语言规范：构造方法](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.8)
- [Oracle Java 语言规范：类实例创建表达式](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.9)
- [Oracle Java 教程：提供构造方法](https://docs.oracle.com/javase/tutorial/java/javaOO/initial.html)
- [廖雪峰 Java 教程：构造方法](https://www.liaoxuefeng.com/wiki/1252599548343744/1260454540160224)
- [Baeldung：Java 构造方法指南](https://www.baeldung.com/java-constructors)
- [Oracle 文档：Math 类（工具类示例）](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Math.html)

下一篇 → [04 方法重载](/java/oop/overload)
