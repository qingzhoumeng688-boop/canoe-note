# 06 多态

> 本篇导读：多态是面向对象最迷人的特性——同一行 `a.shout()`，因为 `a` 背后真正对象的不同，表现出完全不同的行为。本篇用最小示例讲清它是什么、需要哪三个前提，再深入编译期/运行期的绑定机制，最后看它在 JDK 与框架里无处不在的身影，并提醒你静态方法的"反多态"陷阱。

## 一、什么是多态

一句话：**父类引用指向子类对象，调用方法时执行的是子类的实现**。

```java
package com.canoe.oop.polymorphism;

class Animal {
    public void shout() {
        System.out.println("动物叫");
    }
}

class Dog extends Animal {
    @Override
    public void shout() {
        System.out.println("汪汪汪");
    }
}

public class MiniDemo {
    public static void main(String[] args) {
        Animal a = new Dog(); // 父类引用 a 指向子类对象
        a.shout();            // 输出"汪汪汪"，执行的是 Dog 的实现
    }
}
```

重点是：变量 `a` 的**类型**是 `Animal`，但**运行时真正干活的对象**是 `Dog`。这层"表面类型"与"实际类型"的分离，就是多态的精髓。

## 二、多态的三个前提

缺一不可：

1. **继承（或实现接口）**：`Dog` 必须继承自 `Animal`；
2. **方法重写**：子类重写了父类的 `shout()`；
3. **父类引用指向子类对象**：`Animal a = new Dog();`。

如果子类没重写，调用的是父类原版；如果没继承，连"父类引用"都写不出来。三者合起来，才触发"运行看子类"。

## 三、向上转型与向下转型

- **向上转型**（子类 → 父类）：**自动发生**，安全，因为狗"是一种"动物。

```java
Animal a = new Dog(); // 向上转型，自动
```

- **向下转型**（父类 → 子类）：**必须强转**，且最好先用 `instanceof` 判断，否则类型不符会抛 `ClassCastException`。

```java
package com.canoe.oop.polymorphism;

class Animal {
    public void shout() {
        System.out.println("动物叫");
    }
}

class Dog extends Animal {
    public void watchHouse() {
        System.out.println("狗看家");
    }
}

public class CastDemo {
    public static void main(String[] args) {
        Animal a = new Dog();

        // 推荐：JDK 16+ 的 instanceof 模式匹配，判断同时完成转型
        if (a instanceof Dog d) {
            d.watchHouse();
        }

        // 老写法（也正确）
        if (a instanceof Dog) {
            Dog d2 = (Dog) a;
            d2.watchHouse();
        }

        // 危险：若 a 实际不是 Dog，下面这行会抛 ClassCastException
        // Dog d3 = (Dog) a;
    }
}
```

## 四、动态绑定

这是多态的**原理核心**。

- **编译期看左边（编译看父类）**：`a.shout()` 在编译时只检查 `Animal` 有没有 `shout()`；
- **运行期看右边（运行看子类）**：真正执行时，JVM 根据实际对象 `Dog` 去找 `shout()` 的实现。

这叫**动态绑定（late binding）**。注意一个常被忽略的真相：**成员变量没有多态，只有方法有多态**。下面代码验证：

```java
package com.canoe.oop.polymorphism;

class Animal {
    String name = "动物";      // 父类字段
    public void shout() {
        System.out.println("动物叫");
    }
}

class Dog extends Animal {
    String name = "狗";        // 子类同名字段（遮蔽，不是重写）
    @Override
    public void shout() {
        System.out.println("汪汪汪");
    }
}

public class BindingDemo {
    public static void main(String[] args) {
        Animal a = new Dog();
        a.shout();                  // 汪汪汪（方法多态，看右边）
        System.out.println(a.name); // 动物（字段没有多态，看左边）
    }
}
```

原因是：字段访问在编译期就按声明类型 `Animal` 固定了偏移，JVM 不会去"找子类字段"。所以**多态只发生在方法上**。

## 五、多态的好处

真实场景：动物园要"喂食"每一种动物。没有多态，你得为每个动物写一方法：

```java
void feedDog(Dog d) { d.shout(); }
void feedCat(Cat c) { c.shout(); }
// 每加一种动物，就多写一个方法……
```

有了多态，**一个方法通吃所有动物**：

```java
package com.canoe.oop.polymorphism;

class Animal {
    public void shout() { System.out.println("动物叫"); }
}
class Dog extends Animal {
    @Override public void shout() { System.out.println("汪汪汪"); }
}
class Cat extends Animal {
    @Override public void shout() { System.out.println("喵喵喵"); }
}

public class FeedDemo {
    // 只写一次，却能喂任何动物
    public static void feed(Animal animal) {
        animal.shout();
    }

    public static void main(String[] args) {
        feed(new Dog()); // 汪汪汪
        feed(new Cat()); // 喵喵喵
        // 将来新增 Bird，feed 方法一行都不用改 —— 这就是"对扩展开放，对修改关闭"的开闭原则
    }
}
```

新增动物类型时，`feed` 方法**一行都不用改**。这就是多态带来的**开闭原则**。

## 六、多态的实际应用

多态在 JDK 和框架里随处可见：

- **面向接口编程**：`List<String> list = new ArrayList<>();` —— 变量类型是接口 `List`，实际对象是 `ArrayList`，将来想换成 `LinkedList` 只改右边一处。
- **DAO / Service 接口 + 实现类**：业务代码依赖 `UserDao` 接口，运行时注入 `UserDaoImpl`，切换数据库实现不影响调用方。
- **Spring 的依赖注入**：`@Autowired UserService userService` 注入的其实是某个实现类的对象，多态让"按接口编程、运行时换实现"成为现实。

```java
package com.canoe.oop.polymorphism;

import java.util.ArrayList;
import java.util.List;

public class InterfaceDemo {
    public static void main(String[] args) {
        // 多态：接口引用指向实现类对象
        List<String> list = new ArrayList<>();
        list.add("多态");
        list.add("无处不在");
        System.out.println(list);
    }
}
```

## 七、反多态：静态方法的坑

**静态方法不能被重写，只能被"隐藏"**。因为静态方法属于类、不依赖对象，所以调用时**看左边（引用类型）**，不走动态绑定。

```java
package com.canoe.oop.polymorphism;

class Animal {
    public static void info() {
        System.out.println("Animal 的静态方法");
    }
}

class Dog extends Animal {
    public static void info() {  // 这是隐藏，不是重写（没有 @Override）
        System.out.println("Dog 的静态方法");
    }
}

public class StaticMethodDemo {
    public static void main(String[] args) {
        Animal a = new Dog();
        a.info(); // 输出"Animal 的静态方法"——看左边，没有多态
    }
}
```

结论：**想享受多态，就用实例方法；静态方法永远按引用类型决定调用谁**。所以工具类的静态方法天然不参与多态。

## 本篇小结

- **多态**是父类引用指向子类对象，调用方法时执行子类实现。
- 多态三前提：**继承、重写、父类引用指向子类对象**，缺一不可。
- **向上转型自动**，向下转型需**强转并先 `instanceof`** 判断。
- JDK 16+ 可用 `instanceof` **模式匹配**一步完成判断与转型。
- **编译看左边、运行看右边**，这叫动态绑定。
- **成员变量没有多态**，只有方法有多态（字段访问按声明类型）。
- 多态带来**开闭原则**：新增类型不改调用方代码。
- `List<String> list = new ArrayList<>()` 是接口多态的经典写法。
- **静态方法不参与多态**，它只能被隐藏、调用看左边。
- 子类**独有方法**需向下转型后才能调用。

## 参考链接

- [Oracle 教程：多态](https://docs.oracle.com/javase/tutorial/java/IandI/polymorphism.html)
- [Oracle 教程：继承](https://docs.oracle.com/javase/tutorial/java/IandI/subclasses.html)
- [Oracle 教程：向上转型](https://docs.oracle.com/javase/tutorial/java/IandI/override.html)
- [Java 语言规范：方法调用表达式](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.12)
- [Baeldung：Java 中的多态](https://www.baeldung.com/java-polymorphism)
- [Oracle 教程：接口与实现](https://docs.oracle.com/javase/tutorial/java/IandI/createinterface.html)

下一篇 → [07 抽象类](/java/oop/abstract)
