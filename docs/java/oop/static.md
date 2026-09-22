# 09 静态字段和静态方法

> 本篇导读：`static` 的意思是"属于类，而不是属于某个对象"。它像教室里那块所有同学共享的公共黑板，而不是每人手里的私人笔记本。本篇从共享变量讲起，覆盖静态方法、静态代码块、静态导入、常量定义、静态内部类，以及那些一不小心就翻车的 static 陷阱。

## 一、static 是什么

一句话：**`static` 成员属于类，被所有对象共享，只有一份**。

比喻：班级里有一块"公共黑板"（静态成员），所有人看到的是同一块；而每个同学有自己的"笔记本"（实例成员），互不影响。

```java
package com.canoe.oop.staticc;

public class Classroom {
    // 公共黑板：所有 Classroom 对象共享同一份
    public static String blackboard = "今日作业：多态";
    // 私人笔记本：每个学生各有一份
    public String notebook;

    public Classroom(String notebook) {
        this.notebook = notebook;
    }
}
```

无论 `new` 多少个 `Classroom`，`blackboard` 在内存里始终只有一份。

## 二、静态变量

静态变量（类变量）的特点：

- **所有对象共享同一份内存**，改一个地方，处处可见；
- 常用于**类级别的共享数据**：比如计数器、全局配置、连接池；
- **在类加载时初始化**（只一次），早于任何对象创建。

```java
package com.canoe.oop.staticc;

public class Student {
    private String name;
    // 静态计数器：统计创建过多少学生
    private static int totalCount = 0;

    public Student(String name) {
        this.name = name;
        totalCount++; // 每创建一个学生，计数 +1
    }

    public static int getTotalCount() {
        return totalCount;
    }

    public String getName() {
        return name;
    }
}

class CounterDemo {
    public static void main(String[] args) {
        new Student("小明");
        new Student("小红");
        new Student("小刚");
        System.out.println("学生总数：" + Student.getTotalCount()); // 3
    }
}
```

## 三、静态方法

- 用**类名直接调用**（`Student.getTotalCount()`），无需对象；
- **不能访问实例成员**（字段、实例方法），也**不能用 `this` / `super`**；
- 原因很自然：静态方法被调用时，可能**根本还没有任何对象**，它去哪找 `this` 对应的那个实例？

```java
package com.canoe.oop.staticc;

public class MathUtil {
    // 工具方法：无状态，只依赖入参，因此写成静态
    public static int add(int a, int b) {
        return a + b;
        // this.xxx;  // 编译错误：静态方法里没有 this
    }

    public static double circleArea(double r) {
        return Math.PI * r * r;
    }
}
```

正因如此，**工具类（如 `Math`、`Collections`）的方法全是静态的**：它们只做计算、不保存状态，用类名调最清爽。

## 四、静态代码块

`static {}` 在**类加载时执行一次**，适合做静态资源的初始化（读配置、建连接池等）。

它和构造器的执行顺序是：先静态（类加载），后实例（每次 `new`）。

```java
package com.canoe.oop.staticc;

import java.util.ArrayList;
import java.util.List;

public class Config {
    public static List<String> servers;

    // 静态代码块：类加载时执行一次
    static {
        servers = new ArrayList<>();
        servers.add("192.168.1.10");
        servers.add("192.168.1.11");
        System.out.println("静态代码块：已加载服务器列表");
    }

    // 实例代码块（每次 new 都执行，位置在构造器之前）
    {
        System.out.println("实例代码块：创建对象");
    }

    public Config() {
        System.out.println("构造器：Config()");
    }
}
```

完整初始化顺序：**静态代码块（仅一次）→ 实例代码块 → 构造器**（详见[构造器篇](/java/oop/constructor)）。

## 五、静态导入

`import static` 可以把类的静态成员"平铺"进当前文件，省去类名前缀。

```java
package com.canoe.oop.staticc;

import static java.lang.Math.PI;
import static java.lang.Math.sqrt;

public class StaticImportDemo {
    public static void main(String[] args) {
        System.out.println("圆周率：" + PI);   // 不用写 Math.PI
        System.out.println("根号 2：" + sqrt(2)); // 不用写 Math.sqrt
    }
}
```

争议：小范围用很方便，但**滥用会让读者找不到常量/方法来自哪个类**，降低可读性。团队规范通常只允许对极常用的常量（如 `PI`）使用。

## 六、常量定义

真正不可变的常量写成 `public static final`：

- `public static`：类级别、对外可见；
- `final`：引用不可变；
- **命名全大写下划线**：`MAX_RETRY_COUNT`。

```java
package com.canoe.oop.staticc;

public final class Constants {
    public static final int MAX_RETRY_COUNT = 3;
    public static final String DEFAULT_CHARSET = "UTF-8";

    private Constants() { } // 工具类私有构造，禁止实例化
}
```

注意：接口里字段默认就是 `public static final`，所以**有人用接口当常量桶**——但这是不推荐的反模式（接口应只定义行为，详见[接口篇](/java/oop/interface)）。专门用一个 `final` 工具类更清晰。

## 七、静态内部类 vs 非静态内部类

关键区别：**静态内部类不持有外部类引用**。

- 非静态内部类会**隐式持有外部类实例**的引用，若内部类对象被长期持有（比如放进静态集合），外部类就无法被 GC，造成**内存泄漏**；
- 静态内部类**没有外部类引用**，更轻量、更安全，可独立 `new`。

```java
package com.canoe.oop.staticc;

public class Outer {
    private String tag = "outer";

    // 非静态内部类：隐含持有 Outer 实例
    public class Inner {
        public void show() {
            System.out.println(tag); // 能直接访问外部成员
        }
    }

    // 静态内部类：不持有外部类引用
    public static class StaticInner {
        public void show() {
            System.out.println("静态内部类，独立于外部实例");
        }
    }
}

class InnerDemo {
    public static void main(String[] args) {
        // 非静态内部类：必须先有外部实例
        Outer.Inner a = new Outer().new Inner();
        a.show();

        // 静态内部类：可直接创建，无需外部实例
        Outer.StaticInner b = new Outer.StaticInner();
        b.show();
    }
}
```

## 八、static 的坑

1. **静态方法不能被重写，只能被隐藏**（看左边），详见[多态篇](/java/oop/polymorphism)第七节。
2. **Web 容器里的共享问题**：在 Spring 单例 Bean 或 Servlet 中用静态变量存"用户相关数据"，会被所有请求共享，导致串号——静态变量不是请求级的存储。
3. **静态集合导致内存泄漏**：`public static List` 一直往里 `add` 却从不清理，对象永远可达，GC 收不掉。
4. **多线程下非线程安全**：静态变量是共享状态，多个线程同时读写需要加锁或用原子类，否则出现竞态。

```java
package com.canoe.oop.staticc;

public class StaticPitfall {
    // 多线程下危险的共享计数器
    private static int counter = 0;

    public static void increment() {
        counter++; // 非原子操作，并发下会丢失更新
    }
}
```

正确做法是用 `AtomicInteger` 或在方法上加 `synchronized`。

## 本篇小结

- **`static` 成员属于类、被所有对象共享，内存只有一份**。
- 静态变量常用于**计数器、全局配置**等类级共享数据。
- 静态变量在**类加载时初始化**，早于任何对象。
- **静态方法只能访问静态成员**，没有 `this` / `super`。
- 工具类方法多为静态，因为**无状态、只依赖入参**。
- **静态代码块在类加载时执行一次**，适合初始化资源。
- `import static` 可平铺静态成员，但**滥用损害可读性**。
- 常量应写成 **`public static final`**，全大写下划线命名。
- **静态内部类不持有外部类引用**，更安全、避免内存泄漏。
- 静态变量在 **Web 容器、集合、多线程**场景下各有坑，需谨慎。

## 参考链接

- [Oracle 教程：类变量（静态字段）](https://docs.oracle.com/javase/tutorial/java/javaOO/classvars.html)
- [Oracle 教程：静态导入](https://docs.oracle.com/javase/tutorial/java/javaOO/staticimport.html)
- [Java 语言规范：静态初始化块](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.7)
- [Java 语言规范：静态字段与静态方法](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.3.1.1)
- [Baeldung：Java 静态内部类](https://www.baeldung.com/java-static-inner-classes)
- [Baeldung：Java 静态变量陷阱](https://www.baeldung.com/java-static-variables)
- [Oracle 教程：Math 工具类](https://docs.oracle.com/javase/tutorial/java/data/math.html)

下一篇 → [10 包](/java/oop/package)
