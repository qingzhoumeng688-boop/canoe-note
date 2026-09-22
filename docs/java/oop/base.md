# 01 面向对象基础

面向对象（OOP）不是一堆新语法的堆砌，而是看待世界的一种方式：把现实里的事物抽象成"对象"，让程序像搭积木一样由对象协作完成。本篇从"把大象装进冰箱"这种生活例子讲起，逐步引出类与对象、封装、`this`、参数传递等最底层的概念，为后面构造方法、继承、多态打地基。

## 一、面向过程 vs 面向对象

先讲个老梗：**"把大象装进冰箱，总共分几步？"**

如果用**面向过程**的写法，我们关心的是"步骤"：

```text
1. 打开冰箱门
2. 把大象塞进去
3. 关上冰箱门
```

用伪代码表示就是：

```java
openFridge();
putIn(elephant);
closeFridge();
```

所有逻辑都是一排函数从上往下流水执行，数据（`elephant`、`fridge`）在函数之间被传来传去。

而**面向对象**关心的是"谁来做、做什么"——冰箱是一个对象，大象是一个对象，它们各自有自己的能力（冰箱能开、能关），我们让对象之间**协作**：

```text
冰箱.开门()
冰箱.装进(大象)
冰箱.关门()
```

区别在于：

- 面向过程是**"我（程序员）指挥流程"**，函数为中心；
- 面向对象是把"冰箱""大象"本身封装成对象，**对象自己知道自己能干什么**，主程序只负责发号施令。

这就引出了面向对象的三大特性：

- **封装（Encapsulation）**：把数据和行为打包到对象内部，藏起实现细节，只暴露必要的接口（对应第五节的 `private` + getter/setter）。
- **继承（Inheritance）**：子类复用父类的代码，建立"is-a"关系（见 05 继承）。
- **多态（Polymorphism）**：同一份指令，不同对象表现不同行为，比如"动物.叫()"——猫叫喵喵、狗叫汪汪（见多态篇）。

> 一句话记忆：面向过程像写菜谱，面向对象像开餐厅——每个角色（对象）各司其职。

## 二、类与对象

**类（Class）是图纸，对象（Object/Instance）是按图纸造出来的真车。**

生活中：汽车厂商先有一张"汽车设计图"（类），图上规定车有颜色、品牌、能加速；然后工厂照着图造出一辆辆具体的车（对象）。你开的那一辆红色的卡罗拉，就是一个对象。

代码里也一样，先定义"类"描述长什么样、能干什么，再用 `new` 造出对象：

```java
package com.canoe.oop.base;

// 类：汽车设计图
public class Car {
    // 字段：对象的状态（属性）
    String brand;   // 品牌
    String color;   // 颜色
    int speed;      // 当前速度

    // 方法：对象的行为（能力）
    void accelerate(int add) {
        speed += add;
        System.out.println(brand + " 加速，当前速度 " + speed + " km/h");
    }

    void showInfo() {
        System.out.println("这是一辆 " + color + " 的 " + brand);
    }
}
```

```java
package com.canoe.oop.base;

// 演示：照图纸造两辆车
public class CarDemo {
    public static void main(String[] args) {
        Car car1 = new Car();   // 对象1：一辆具体的车
        car1.brand = "卡罗拉";
        car1.color = "红色";
        car1.speed = 0;

        Car car2 = new Car();   // 对象2：另一辆具体的车
        car2.brand = "宝马";
        car2.color = "黑色";
        car2.speed = 0;

        car1.showInfo();
        car1.accelerate(60);

        car2.showInfo();
        car2.accelerate(100);
    }
}
```

`car1` 和 `car2` 是同一个 `Car` 类造出来的两个**独立对象**，各自有一份 `brand`、`color`、`speed`，互不影响。

## 三、类的组成

一个 `.java` 类文件里能写什么？下面这张清单请背下来：

| 组成部分 | 作用 | 是否必须 |
| --- | --- | --- |
| 字段（成员变量） | 描述对象的状态/属性 | 否 |
| 方法 | 描述对象的行为/能力 | 否 |
| 构造器 | 创建对象时初始化（见 03 构造方法） | 不写则编译器自动补 |
| 代码块 | 构造器之外的一段初始化逻辑 | 否 |
| 内部类 | 定义在类里面的类（见 12 内部类） | 否 |

来看一个"全家福"式的类，把上面五种都展示出来：

```java
package com.canoe.oop.base;

public class Composition {

    // 1. 字段（成员变量）
    private int value = 10;

    // 2. 构造代码块（每次 new 都会先执行，先于构造器体）
    {
        System.out.println("构造代码块执行，value 当前 = " + value);
    }

    // 3. 构造器
    public Composition() {
        System.out.println("构造器执行");
    }

    // 4. 方法
    public void print() {
        System.out.println("value = " + value);
    }

    // 5. 内部类（成员内部类）
    class Inner {
        void hi() {
            System.out.println("我是内部类，能访问外部 value = " + value);
        }
    }
}
```

注意：**方法之间、代码块之间是无序的，但执行时有先后顺序**（构造代码块、字段初始化、构造器见第四、六节）。这张表是"能写什么"，后面几篇再讲"什么时候执行"。

## 四、创建对象与内存

关键一行 `Car car1 = new Car();` 背后到底发生了什么？拆开看：

1. **类加载**：JVM 第一次用到 `Car` 时，把 `.class` 文件加载进方法区；
2. **分配内存**：在**堆（Heap）** 里开辟空间，存放对象的所有字段；
3. **初始化**：字段赋默认值（0 / null / false），再执行显式赋值和构造代码块、构造器；
4. **返回引用**：把堆里那块内存的地址交给栈上的引用变量 `car1`。

内存长这样（ASCII 示意）：

```text
┌──────────── 栈 (Stack) ────────────┐        ┌────────── 堆 (Heap) ──────────┐
│                                     │        │                              │
│  main 方法栈帧                       │        │  Car 对象                     │
│  ┌─────────────────────────────┐   │        │  ┌────────────────────────┐  │
│  │ car1 ────────────────────────┼───┼───────►│ │ brand : "卡罗拉"        │  │
│  └─────────────────────────────┘   │        │  │ color : "红色"          │  │
│                                     │        │  │ speed : 60              │  │
│  ┌─────────────────────────────┐   │        │  └────────────────────────┘  │
│  │ car2 ────────────────────────┼───┼───────►│  Car 对象                     │
│  └─────────────────────────────┘   │        │  ┌────────────────────────┐  │
│                                     │        │  │ brand : "宝马"          │  │
└─────────────────────────────────────┘        │  │ color : "黑色"          │  │
                                               │  │ speed : 100             │  │
                                               │  └────────────────────────┘  │
                                               └──────────────────────────────┘
```

关键认知：**引用变量（car1）在栈上，真正的对象在堆上**，引用里存的是地址。这直接决定了下一节"参数传递"的坑。

## 五、封装

直接把字段 `public` 暴露出去会有什么后果？比如学生年龄写成 `-100`、写成 `1000`，程序照样能跑，但数据明显错了。

**封装的核心：把字段藏起来（`private`），只通过受控的方法访问（getter/setter），在方法里做校验。**

```java
package com.canoe.oop.base;

public class Student {
    private String name;
    private int age;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getAge() {
        return age;
    }

    // 关键：setter 里加校验，挡住非法数据
    public void setAge(int age) {
        if (age < 0 || age > 150) {
            throw new IllegalArgumentException("年龄必须在 0~150 之间");
        }
        this.age = age;
    }
}
```

封装带来的好处：

- **控制访问**：外部不能随意篡改内部状态；
- **数据校验**：在 setter 里拦截非法值（如上面的年龄边界）；
- **可维护性**：内部实现改了，只要接口不变，调用方无感知。

在 IDEA 里按 `Alt + Insert`（或右键 → Generate）可一键生成 getter/setter。再进阶一点，**Lombok** 的 `@Data` 注解能在编译期自动生成这些样板代码：

```java
import lombok.Data;

@Data   // 编译期自动生成 getter/setter/equals/hashCode/toString
public class Student {
    private String name;
    private int age;
}
```

> 小争议：Lombok 虽香，但它依赖注解处理器在编译期"改写"字节码，新人读源码时会困惑"这些方法哪来的"。团队项目里建议统一约定后再用。

## 六、方法的参数传递

**这是新手最容易错的一节：Java 只有"值传递"（pass by value），没有引用传递。**

"值传递"的意思是：调用方法时，实参把自己的**值**复制一份传给形参。区别来了：

- 基本类型（int、double...）：传的是"数值的副本"，方法里改了，外面原值不变；
- 引用类型（对象、数组）：传的是"引用的副本"（也就是地址的副本），方法里通过这个副本**改对象内部的属性，外面能看见**；但**在方法里把形参重新指向新对象，外面那个引用不受影响**。

先看基本类型——交换失败：

```java
package com.canoe.oop.base;

public class PassByValueDemo {
    // 试图交换两个 int，但这是徒劳的
    static void swap(int a, int b) {
        int temp = a;
        a = b;
        b = temp;
        System.out.println("方法内：a=" + a + ", b=" + b);
    }

    public static void main(String[] args) {
        int x = 10, y = 20;
        swap(x, y);
        // 外面 x、y 没变，因为 swap 拿到的是副本
        System.out.println("方法外：x=" + x + ", y=" + y);
    }
}
```

输出：

```text
方法内：a=20, b=10
方法外：x=10, y=20
```

再看引用类型——改属性生效、重新赋值不生效：

```java
package com.canoe.oop.base;

class Person {
    String name;
}

public class PassByValueRefDemo {
    // 改属性：生效（因为副本和原引用指向同一个堆对象）
    static void rename(Person p) {
        p.name = "张三";
    }

    // 重新赋值：不生效（只改了副本的指向，原引用没动）
    static void reassign(Person p) {
        p = new Person();
        p.name = "李四";
    }

    public static void main(String[] args) {
        Person person = new Person();
        person.name = "王五";

        rename(person);
        System.out.println("rename 后：" + person.name);   // 张三（生效）

        reassign(person);
        System.out.println("reassign 后：" + person.name); // 仍是 张三（不生效）
    }
}
```

记住口诀：**传引用类型时，"改它里面的东西"能传出去，"让它指向别的对象"传不出去。**

## 七、this 关键字

`this` 永远指代**"当前对象"**（正在调用方法的那个对象）。三个常见用途：

1. **区分同名成员变量和局部变量**（最常用，见第五节 `this.name = name`）；
2. **调用本类其他构造器**（必须写在第一行）；
3. **把当前对象作为参数传递**。

```java
package com.canoe.oop.base;

public class ThisDemo {
    private String name;

    // 用途2：无参构造器复用有参构造器（this 必须在第一行）
    public ThisDemo() {
        this("默认名字");
    }

    public ThisDemo(String name) {
        this.name = name;   // 用途1：this.name 指成员变量，右边的 name 是形参
    }

    void print() {
        // 用途3：把当前对象传出去
        Printer.printThis(this);
    }
}

class Printer {
    static void printThis(ThisDemo demo) {
        System.out.println("收到的对象 name = " + demo.name);
    }
}
```

## 八、对象的生命周期

一个对象从生到死经历四步：

1. **创建**：`new` 出来，进堆；
2. **使用**：通过引用访问它的字段和方法；
3. **不可达**：没有任何引用再指向它（例如 `obj = null;` 或引用出了作用域）；
4. **回收**：垃圾回收器（GC）在合适时机回收堆内存，释放空间。

```java
package com.canoe.oop.base;

public class LifeCycleDemo {
    public static void main(String[] args) {
        Object o = new Object();  // 创建 + 使用
        o = null;                 // 显式断开引用，o 原来指向的对象变成"不可达"
        // 此后某刻 GC 会回收它；也可以建议 JVM 回收（不保证立即执行）：
        System.gc();
    }
}
```

把引用置 `null` 的意义：告诉 GC"我不用它了，你可以回收"。在缓存、大对象、监听器这种场景里，及时断开引用能避免**内存泄漏**。

## 九、一个完整的练习

把前面所有知识点揉进一个"学生类"：字段 + 构造器 + getter/setter + 行为方法，并用 `main` 演示。

```java
package com.canoe.oop.base;

public class StudentExercise {
    // 字段（成员变量）
    private String name;
    private int age;
    private String major;

    // 构造器：创建对象时一次性初始化
    public StudentExercise(String name, int age, String major) {
        this.name = name;
        // 复用 setter，顺便享受校验逻辑
        setAge(age);
        this.major = major;
    }

    // getter / setter
    public String getName() {
        return name;
    }

    public int getAge() {
        return age;
    }

    public void setAge(int age) {
        if (age < 0 || age > 150) {
            throw new IllegalArgumentException("年龄非法");
        }
        this.age = age;
    }

    public String getMajor() {
        return major;
    }

    // 行为方法
    public void study() {
        System.out.println(name + "（" + age + "岁）正在学 " + major);
    }

    public void introduce() {
        System.out.println("大家好，我是 " + name + "，专业 " + major);
    }

    // 演示
    public static void main(String[] args) {
        StudentExercise s = new StudentExercise("小明", 20, "计算机科学");
        s.introduce();
        s.study();

        StudentExercise s2 = new StudentExercise("小红", 19, "软件工程");
        s2.introduce();

        System.out.println(s.getName() + " 的年龄是 " + s.getAge());
    }
}
```

运行输出：

```text
大家好，我是 小明，专业 计算机科学
小明（20岁）正在学 计算机科学
大家好，我是 小红，专业 软件工程
小明的 年龄是 20
```

## 本篇小结

- **面向对象**以"对象协作"替代"流程指挥"，具备**封装、继承、多态**三大特性。
- **类是图纸，对象是实例**，二者是模板与具体产品的从属关系。
- 类内部可包含**字段、方法、构造器、代码块、内部类**五种成员。
- `new` 对象时经历**类加载 → 分配堆内存 → 初始化 → 返回引用**四个阶段。
- **引用在栈、对象在堆**，引用变量里存的是堆内存地址。
- **封装**通过 `private` + getter/setter 控制访问并校验数据，保证对象状态合法。
- Java 只有**值传递**：基本类型传数值副本，引用类型传地址副本。
- 引用类型参数**改属性对外可见**，但**重新指向新对象对外不可见**。
- `this` 指代**当前对象**，常用于区分同名变量与调用本类构造器。
- 构造器调用本类构造器时，**`this(...)` 必须写在第一行**。
- 对象经历**创建 → 使用 → 不可达 → GC 回收**的完整生命周期。
- 及时把无用引用置 **`null`** 有助于 GC 回收，避免内存泄漏。

## 参考链接

- [Oracle Java 教程：对象和类](https://docs.oracle.com/javase/tutorial/java/concepts/)
- [Oracle Java 教程：声明类](https://docs.oracle.com/javase/tutorial/java/javaOO/classes.html)
- [Oracle Java 教程：向方法传递信息（参数）](https://docs.oracle.com/javase/tutorial/java/javaOO/arguments.html)
- [Oracle Java 语言规范：类体](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html)
- [Oracle Java 语言规范：方法调用表达式](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.12)
- [Lombok 官方文档](https://projectlombok.org/features/Data)
- [廖雪峰 Java 教程：面向对象基础](https://www.liaoxuefeng.com/wiki/1252599548343744/1260451488854880)

下一篇 → [02 方法](/java/oop/method)
