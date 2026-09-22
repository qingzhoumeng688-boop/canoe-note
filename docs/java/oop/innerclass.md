# 12 内部类

内部类（Inner Class）就是"写在类里面的类"。它常被初学者当成语法糖忽略，却是 JDK 和 Spring 里的常客——`HashMap.Node`、`LinkedList.Node`、各种 `Builder` 都是它。本篇把成员、静态、局部、匿名四种内部类讲透，并说清为什么静态内部类更安全、Lambda 又是怎么取代匿名内部类的。

## 一、内部类是什么

**内部类 = 定义在另一个类（外部类）内部的类。** 它存在的理由：

1. **逻辑归属**：某个类只对外部类有用（如 `HashMap` 里的 `Node` 节点），就该"关在"外面类里，避免污染包命名空间；
2. **访问外部私有成员**：内部类能直接访问外部类的 `private` 字段，像开了后门；
3. **多重继承的变通**：Java 单继承，但一个类可以写多个内部类各自继承不同父类，变相"多继承"。

```java
package com.canoe.oop.innerclass;

public class OuterBasic {
    private int outerField = 10;

    // 这就是内部类
    class Inner {
        void visit() {
            System.out.println("内部类访问外部私有字段：" + outerField);  // 直接访问
        }
    }

    public static void main(String[] args) {
        OuterBasic outer = new OuterBasic();
        Inner inner = outer.new Inner();   // 成员内部类的创建方式
        inner.visit();
    }
}
```

## 二、成员内部类

成员内部类像外部类的"实例成员"，地位等同于字段和方法。特性：

- **隐式持有外部类引用**（通过 `Outer.this` 取得），所以能访问外部一切成员；
- **不能定义 static 成员**（除编译期常量 `static final`），因为它依附于外部实例存在；
- 创建方式：`外部对象.new 内部类()`。

```java
package com.canoe.oop.innerclass;

public class MemberInner {
    private String title = "外部标题";

    class Content {
        private String body = "内部正文";

        void show() {
            // 访问外部私有字段
            System.out.println(title);
            // 显式拿到外部类引用
            System.out.println("外部引用== " + MemberInner.this.title);
            System.out.println(body);
        }

        // static int x = 1;  // ❌ 成员内部类不能有 static 成员（常量除外）
        static final int MAX = 100;   // ✅ 编译期常量可以
    }

    public static void main(String[] args) {
        MemberInner outer = new MemberInner();
        Content c = outer.new Content();   // outer.new Inner()
        c.show();
    }
}
```

## 三、静态内部类

在内部类前加 `static`，它就变成**静态内部类**：不再依附外部实例，**不持有外部类引用**。

```java
package com.canoe.oop.innerclass;

public class StaticInner {
    private static String label = "静态标签";
    private String instanceField = "实例字段";

    static class Box {
        void show() {
            System.out.println(label);            // 能访问外部 static 成员
            // System.out.println(instanceField); // ❌ 没有外部实例，访问不了
        }
    }

    public static void main(String[] args) {
        // 直接用 外部类.内部类 创建，无需外部实例
        Box b = new StaticInner.Box();
        b.show();
    }
}
```

成员 vs 静态对比：

| 维度 | 成员内部类 | 静态内部类 |
| --- | --- | --- |
| 是否持有外部引用 | 是（`Outer.this`） | **否** |
| 创建方式 | `outer.new Inner()` | `new Outer.Inner()` |
| 能否访问外部实例成员 | 能 | 不能 |
| 能否有 static 成员 | 仅常量 | 能 |
| 内存泄漏风险 | 有（隐式引用） | **无** |

**为什么推荐静态内部类**：成员内部类悄悄攥着外部类引用，如果这个内部类对象被长期持有（比如塞进静态集合、或被线程拿着），外部类就**永远无法被 GC 回收**，造成内存泄漏。能用静态就尽量静态。

## 四、局部内部类

定义在**方法内部**的类，作用域仅限于该方法。它能访问外部类的成员，也能访问方法的**局部变量——但那些局部变量必须是 `final` 或"事实上 final"（effectively final，即赋值后不再修改）**。

为什么必须是 final？因为局部变量存在栈上，方法结束就没了；而局部内部类的对象可能还活着（比如被返回出去）。JVM 实际是把这个变量**复制了一份**进内部类，若允许修改就会产生"内部类看到的还是旧值"的诡异不一致，所以干脆禁止修改，强制 effectively final。

```java
package com.canoe.oop.innerclass;

public class LocalInner {
    void process() {
        int limit = 5;          // effectively final（没再改过）
        // limit = 6;           // 一旦改成这行，下面局部内部类就编译报错

        class Counter {         // 局部内部类，仅本方法可见
            void run() {
                for (int i = 0; i < limit; i++) {
                    System.out.println("计数 " + i);
                }
            }
        }

        new Counter().run();
    }

    public static void main(String[] args) {
        new LocalInner().process();
    }
}
```

## 五、匿名内部类

**本节重点**：没有名字、用完即弃的内部类，常用于"只实现一次"的接口/抽象类。语法是 `new 接口/父类() { 重写方法 }`。

典型场景：**事件监听、线程、`Comparator` 排序。**

```java
package com.canoe.oop.innerclass;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class AnonymousInner {
    public static void main(String[] args) {
        // 场景1：线程（Runnable 是接口，直接 new 并写实现）
        new Thread(new Runnable() {
            @Override
            public void run() {
                System.out.println("匿名内部类跑在子线程");
            }
        }).start();

        // 场景2：Comparator 排序
        List<String> names = new ArrayList<String>();
        names.add("banana");
        names.add("apple");
        names.add("cherry");

        names.sort(new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                return a.length() - b.length();   // 按字符串长度排
            }
        });
        System.out.println(names);
    }
}
```

编译后，匿名内部类会被生成成单独的 `.class` 文件，命名规则是 `外部类$数字.class`，例如上面的会生成 `AnonymousInner$1.class`。**自 Java 8 起，当匿名内部类只实现一个抽象方法（函数式接口）时，可以用 Lambda 表达式替换**，代码更短：

```java
// 用 Lambda 改写线程
new Thread(() -> System.out.println("Lambda 跑在子线程")).start();

// 用 Lambda 改写 Comparator
names.sort((a, b) -> a.length() - b.length());
```

> 经验：只有一个抽象方法的接口，优先用 Lambda；需要多个方法或有状态的复杂实现，才保留匿名内部类。

## 六、Lambda 与内部类

匿名内部类和 Lambda 看着像，底层却完全不同：

- **匿名内部类**：编译期实实在在生成一个 `.class` 文件，运行时 `new` 出一个对象；
- **Lambda**：编译期**不生成独立类**，靠 `invokedynamic` 指令在运行期动态调用（JVM 用 `LambdaMetafactory` 生成调用点），更轻量、启动更快。

`this` 指向的区别尤为关键：

- 匿名内部类里的 `this` 指的是**匿名类自己**（要拿外部类得写 `Outer.this`）；
- **Lambda 里的 `this` 就是外部类**（因为它不是独立类，只是外部类的一段代码）。

```java
package com.canoe.oop.innerclass;

public class LambdaThis {
    private String who = "外部类";

    void demo() {
        // 匿名内部类：this 指匿名类自身
        Runnable r1 = new Runnable() {
            @Override
            public void run() {
                System.out.println("匿名类 this：" + this.getClass().getSimpleName());
            }
        };

        // Lambda：this 就是 LambdaThis（外部类）
        Runnable r2 = () -> System.out.println("Lambda this：" + this.who);

        new Thread(r1).start();
        new Thread(r2).start();
    }

    public static void main(String[] args) {
        new LambdaThis().demo();
    }
}
```

## 七、内部类的实际应用

真实代码库里内部类随处可见：

1. **`HashMap.Node`**：`HashMap` 把"链表节点"定义为静态内部类 `Node<K,V>`，因为它只服务 `HashMap`，且无需持有外部引用；
2. **`LinkedList.Node`**：同理，节点类嵌套在链表里；
3. **Builder 模式**：经典写法是在类里放一个静态内部类 `Builder` 来分步构造对象。

```java
package com.canoe.oop.innerclass;

// 用静态内部类实现 Builder 模式（参考 StringBuilder / OkHttp 等）
public class Computer {
    private String cpu;
    private String memory;

    // 私有构造器，只允许 Builder 调用
    private Computer(Builder b) {
        this.cpu = b.cpu;
        this.memory = b.memory;
    }

    // 静态内部类 Builder
    public static class Builder {
        private String cpu;
        private String memory;

        public Builder cpu(String cpu) {
            this.cpu = cpu;
            return this;   // 链式调用
        }

        public Builder memory(String memory) {
            this.memory = memory;
            return this;
        }

        public Computer build() {
            return new Computer(this);
        }
    }

    @Override
    public String toString() {
        return "Computer{cpu='" + cpu + "', memory='" + memory + "'}";
    }

    public static void main(String[] args) {
        Computer c = new Computer.Builder()
                .cpu("i9")
                .memory("32G")
                .build();
        System.out.println(c);
    }
}
```

把 `Builder` 设为静态内部类，既表达了"它是 Computer 的一部分"，又**不持有外部 Computer 引用**，是安全的写法。

## 本篇小结

- **内部类**定义在外部类内部，便于逻辑归属并可直接访问外部私有成员。
- **成员内部类**隐式持有外部引用（`Outer.this`），不能定义非 final 的 static 成员。
- 成员内部类创建用 **`outer.new Inner()`**，普通内部类依附外部实例。
- **静态内部类**不持有外部引用，用 `new Outer.Inner()` 创建，无内存泄漏风险。
- 优先使用**静态内部类**，避免隐式引用导致外部类无法被 GC 回收。
- **局部内部类**作用域仅限方法，只能访问 effectively final 的局部变量。
- 局部变量须 final 是因为其**被复制进内部类**，禁止修改以保证一致性。
- **匿名内部类**语法为 `new 接口/父类(){ 重写 }`，常用于线程、监听、Comparator。
- 匿名内部类编译生成 **`外部类$数字.class`**，Lambda 则用 `invokedynamic` 更轻量。
- **Lambda 里的 `this` 指外部类**，匿名内部类里的 `this` 指自己，二者不同。
- 单方法接口优先用 **Lambda** 替代匿名内部类，代码更简洁。
- JDK 中 **`HashMap.Node`、`Builder`** 都是静态内部类的经典实战。

## 参考链接

- [Oracle Java 教程：内部类](https://docs.oracle.com/javase/tutorial/java/javaOO/innerclasses.html)
- [Oracle Java 语言规范：内部类](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.1.3)
- [Oracle Java 文档：HashMap.Node](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/HashMap.html)
- [Oracle Java 教程：Lambda 表达式](https://docs.oracle.com/javase/tutorial/java/javaOO/lambdaexpressions.html)
- [廖雪峰 Java 教程：内部类](https://www.liaoxuefeng.com/wiki/1252599548343744/1260467028961680)
- [Baeldung：Java 内部类指南](https://www.baeldung.com/java-inner-classes)
- [Oracle 文档：invokedynamic 与 Lambda](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.27)

下一篇 → [13 this 与 super](/java/oop/this-super)
