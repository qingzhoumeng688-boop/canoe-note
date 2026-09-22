# 08 类字节码

> 本篇导读：字节码是 Java 与 JVM 之间的"契约语言"。学会读字节码，很多语言特性的"真相"会豁然开朗——Lambda 怎么实现的、泛型为什么擦除、字符串拼接背后是谁在干活、synchronized 凭什么安全。本文从 class 文件结构讲起，手把手用 `javap` 拆指令、看语法糖，最后落到字节码增强（AOP、MyBatis 代理）这一工程实践。这是把"会用 Java"提升到"懂 Java"的关键一步。

## 一、为什么要学字节码

我们写的是 `.java`，JVM 跑的是 `.class` 字节码。中间这层字节码，掌握它能带来实实在在的收益：

- **看清语言特性的底层真相**：Lambda 表达式、泛型擦除、字符串拼接、自动装箱、synchronized、try-with-resources，源码里看不出的细节，字节码里一清二楚。比如 `String s = a + b` 看似简单，字节码里其实是 `new StringBuilder().append(a).append(b).toString()`——知道这点你才不会在循环里踩性能坑。
- **排查诡异问题**：某些"源码逻辑正确却表现异常"的 bug（如并发下的重排、序列化问题），只有看字节码才能定位。
- **理解框架原理**：Spring AOP、MyBatis 的 Mapper、各种 RPC 框架的代理，底层全靠**字节码增强**在运行时改写/生成类。不懂字节码，就只能把这些当黑盒。

一句话：字节码是连接"Java 语法"与"JVM 执行"的桥梁，是进阶必须跨过的一道坎。

## 二、class 文件结构

`class` 文件是一份**严格的二进制表**，按顺序由以下部分组成（开头 4 字节固定魔数）：

- **魔数（Magic）**：`0xCAFEBABE`，标识这是一个 class 文件。
- **次版本号 / 主版本号**：标识编译所用的 JDK 版本（52=JDK8，61=JDK17）。
- **常量池（Constant Pool）**：**全文件最重要的一块**，存放所有字面量（字符串、数字）和符号引用（类/方法/字段的名字与描述符）。
- **访问标志（Access Flags）**：`ACC_PUBLIC`/`ACC_FINAL`/`ACC_SUPER` 等。
- **类索引 / 父类索引 / 接口索引**：指向常量池，确定本类、父类、实现的接口。
- **字段表（Fields）**：类的成员变量信息。
- **方法表（Methods）**：类的方法，含 `<init>`（构造器）和 `<clinit>`（类构造器）。每个方法里有 `Code` 属性，装的就是字节码指令。
- **属性表（Attributes）**：附加信息（如行号表、源码文件名）。

用 `javap -v` 真实窥探一下：

```bash
javap -v com.canoe.jvm.bytecode.Sample
```

```text
Classfile /.../Sample.class
  Last modified 2024-1-1; size 582 bytes
  MD5 checksum 9f3a...
  Compiled from "Sample.java"
public class com.canoe.jvm.bytecode.Sample
  minor version: 0
  major version: 61
  flags: ACC_PUBLIC, ACC_SUPER
Constant pool:
   #1 = Methodref          #4.#15  // java/lang/Object."<init>":()V
   #2 = String             #16     // hello
   #3 = Fieldref           #3.#17  // com/canoe/jvm/bytecode/Sample.msg:Ljava/lang/String;
   #4 = Class              #18     // java/lang/Object
   ...
{
  public java.lang.String msg;
    descriptor: Ljava/lang/String;
    flags: ACC_PUBLIC

  public com.canoe.jvm.bytecode.Sample();
    descriptor: ()V
    flags: ACC_PUBLIC
    Code:
      stack=1, locals=1, args_size=1
         0: aload_0
         1: invokespecial #1  // Object."<init>":()V
         4: return
}
```

注意 `Constant pool` 里都是"符号引用"（如 `#1` 指向 `Object."<init>"`），真正的地址在**链接阶段**才解析。方法体里的 `Code` 就是字节码指令序列。

## 三、javap 的使用

`javap` 是 JDK 自带的"反汇编器"，常用参数：

```bash
javap -p Sample.class        # 列出所有成员(含 private), 不显示字节码
javap -c Sample.class        # -c: 反汇编, 显示每个方法的字节码指令
javap -v Sample.class        # -v/-verbose: 最详尽, 含常量池/行号/签名
javap -l Sample.class        # -l: 显示行号表(LocalVariableTable)
javap -p -c Sample.class     # 组合: 含 private 并反汇编
```

实战例子，先看源码：

```java
package com.canoe.jvm.bytecode;

public class Add {
    public int add(int a, int b) {
        return a + b;
    }
}
```

```bash
javap -c com.canoe.jvm.bytecode.Add
```

```text
Compiled from "Add.java"
public class com.canoe.jvm.bytecode.Add {
  public com.canoe.jvm.bytecode.Add();
    Code:
       0: aload_0
       1: invokespecial #1  // Method java/lang/Object."<init>":()V
       4: return

  public int add(int, int);
    Code:
       0: iload_1        // 把第1个局部变量(a)压操作数栈
       1: iload_2        // 把第2个局部变量(b)压栈
       2: iadd           // 弹出两个int相加, 结果压栈
       3: ireturn        // 返回栈顶int
}
```

`-c` 看指令、`-v` 看常量池、`-p` 看私有成员、`-l` 看行号——四个参数基本覆盖日常需要。

## 四、字节码指令集

字节码指令是一个字节的操作码 + 若干操作数。按用途分类（节选常用）：

- **加载与存储**：`iload`/`istore`（int 装载/存储）、`aload`/`astore`（引用）、`iconst_n`/`aconst_null`（压常量、压 null）。
- **运算**：`iadd`/`isub`/`imul`/`idiv`（加减乘除）。
- **类型转换**：`i2l`（int→long）、`i2f`、`l2i` 等。
- **对象操作**：`new`（创建对象）、`dup`（复制栈顶）、`getfield`/`putfield`（读写字段）、`invokevirtual`（调实例方法）。
- **操作数栈管理**：`dup`（复制栈顶）、`pop`（弹栈）、`swap`（交换栈顶两元素）。
- **控制转移**：`ifeq`/`ifne`（为零/非零跳转）、`goto`、`tableswitch`。
- **方法调用与返回**：`invokestatic`/`invokespecial`/`invokevirtual`/`invokeinterface`/`invokedynamic`、`ireturn`/`areturn`/`return`。

**重点：`dup` 为什么总是出现在 `new` 之后？** `new` 指令会在堆上创建对象并把"引用"压入操作数栈，但此时对象还没初始化（`invokespecial` 调构造器需要这个引用作 `this`）。于是紧接着用 `dup` 复制一份引用：一份供 `<init>` 消费（作为 `aload_0` 的 `this`），另一份保留在栈顶，等构造完成后作为"新建好的对象"继续被使用（比如 `astore` 存到变量）。没有 `dup`，构造器用完引用就没了，无法把对象交给后续代码。

```text
new Foo
dup              # 复制引用: 栈=[ref, ref]
invokespecial #x // 用下面那个 ref 调 <init>(this=ref)
astore_1         # 把上面那个 ref 存到变量1
```

## 五、五种方法调用指令

字节码里有五条调用指令，分别对应不同的绑定语义，这是理解多态与动态语言支持的关键：

| 指令 | 作用 | 绑定时机 |
|------|------|----------|
| `invokestatic` | 调用**静态方法** | 编译期确定 |
| `invokespecial` | 调用**构造器、私有方法、super 方法** | 编译期确定（非虚） |
| `invokevirtual` | 调用**普通实例方法（虚方法）** | **运行时按实际类型分派 → 多态的实现** |
| `invokeinterface` | 调用**接口方法** | 运行时分派 |
| `invokedynamic` | **动态调用点**，调用目标在运行时由引导方法决定 | JDK 7 引入，**Lambda、动态语言（Groovy/Kotlin）的基础** |

`invokevirtual` 之所以能实现多态，是因为它在运行时根据对象**实际类型**（而非声明类型）去方法表查找真正实现；而 `invokespecial` 调用 `super.xxx()` 或私有方法时，直接绑定到编译期确定的目标，不会被重写。

```java
package com.canoe.jvm.bytecode;

import java.util.ArrayList;
import java.util.List;

public class InvokeDemo {
    public static void staticMethod() { }

    public void show(List<String> list) {
        list.size();        // invokeinterface: 接口方法
        staticMethod();     // invokestatic: 静态方法
        new ArrayList<>();  // new + invokespecial: 构造器
    }
}
```

`invokedynamic` 则在 Lambda 中被使用：编译期不绑定具体实现，运行时由 `LambdaMetafactory` 生成的引导方法创建函数对象，从而让 Java 支持"行为参数化"。

## 六、通过字节码看语法糖

源码层面的"糖"，编译后都会现出原形。逐个验证：

**① 字符串 `+` 拼接 → 编译成 `StringBuilder`**

```java
package com.canoe.jvm.bytecode;

public class Concat {
    public String build(String a, String b) {
        return a + b;   // 非常量拼接
    }
}
```

```text
public java.lang.String build(java.lang.String, java.lang.String);
  Code:
     0: new           #2  // class java/lang/StringBuilder
     3: dup
     4: invokespecial #3  // StringBuilder.<init>:()V
     7: aload_1            // 压入 a
     8: invokevirtual #4  // StringBuilder.append:(String)
    11: aload_2            // 压入 b
    12: invokevirtual #4  // StringBuilder.append:(String)
    15: invokevirtual #5  // StringBuilder.toString:()
    18: areturn
```

可见 `a + b` 变成了 `new StringBuilder().append(a).append(b).toString()`。这也说明**循环里做 `+=` 会反复 new StringBuilder**，应手动提取到循环外。

**② 自动装箱 → `Integer.valueOf`**

```java
Integer x = 100;   // 编译为 Integer.valueOf(100)
int y = x;         // 编译为 x.intValue()
```

**③ 泛型擦除 → 字节码里是 `Object` + `checkcast`**

```java
package com.canoe.jvm.bytecode;

import java.util.ArrayList;
import java.util.List;

public class Generic {
    public void use() {
        List<String> list = new ArrayList<String>();
        list.add("hi");
        String s = list.get(0);   // 编译器自动插入 checkcast
    }
}
```

```text
  public void use();
    Code:
       0: new           #2  // ArrayList
       3: dup
       4: invokespecial #3  // ArrayList.<init>
       7: astore_1
       8: aload_1
       9: ldc           #4  // "hi"
      11: invokeinterface #5, 2  // List.add:(Object)
      16: pop
      17: aload_1
      18: invokeinterface #6, 2  // List.get:(int)
      23: checkcast     #7  // class java/lang/String  ← 泛型擦除后强转
      26: astore_2
      27: return
```

泛型在编译期就被**擦除**成 `Object`，`List<String>` 和 `List<Integer>` 运行时是同一个类型；取值时编译器自动补 `checkcast` 还原成具体类型。这就是"泛型只在编译期有效"的真相。

**④ foreach → 编译成 `Iterator`**

```java
for (String s : list) { }   // 编译为 list.iterator() + hasNext/next 循环
```

**⑤ 变长参数 → 编译成数组**

```java
void f(String... args) { }   // 编译为 void f(String[] args)
```

**⑥ 内部类 → 生成独立 class 文件**

```java
public class Outer {
    class Inner { }   // 编译产生 Outer$Inner.class, 且 Inner 持有 Outer 的引用(构造器多一个 Outer 参数)
}
```

**⑦ try-with-resources → 编译器补 finally 与 close**

```java
package com.canoe.jvm.bytecode;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;

public class TryWith {
    public String read(String path) throws IOException {
        try (BufferedReader br = new BufferedReader(new FileReader(path))) {
            return br.readLine();
        }   // 编译器自动生成 finally, 无论正常/异常都会调用 br.close()
    }
}
```

编译器会生成一个 `finally` 块，用 `try/finally` 嵌套确保 `close()` 在两条路径（正常结束、发生异常）上都被调用，并对异常做抑制（suppressed）处理。源码的简洁背后是编译器帮你写了繁琐的资源释放逻辑。

**⑧ switch 对 String → `hashCode` + `equals`**

```java
switch (str) {
    case "a": break;
    case "b": break;
}
```

编译后实际是：先对 `str` 取 `hashCode()` 用 `tableswitch`/`lookupswitch` 分流，再对匹配的 case 用 `equals` 二次比较确认（因为不同字符串可能 hash 冲突），最后才进入真正分支。这就是为什么 switch 支持 String 比 int 慢一点的原因。

## 七、synchronized 的字节码

`synchronized` 的互斥能力，落地为字节码的 `monitorenter` / `monitorexit`：

```java
package com.canoe.jvm.bytecode;

public class Sync {
    public void m() {
        synchronized (this) {
            System.out.println("in");
        }
    }
}
```

```text
public void m();
  Code:
     0: aload_0
     1: dup
     2: astore_1
     3: monitorenter     // 进入监视器(加锁)
     4: getstatic     #2  // System.out
     7: ldc           #3  // "in"
     9: invokevirtual #4  // println
    12: aload_1
    13: monitorexit      // 正常路径释放锁
    14: goto          22
    17: aload_1
    18: monitorexit      // 异常路径也要释放锁
    19: athrow
    20: ... (异常表指向 17)
    22: return
```

**为什么会有两个 `monitorexit`？** 因为 `synchronized` 块要保证**无论正常结束还是抛异常，锁都必须释放**（否则会死锁）。所以编译器生成两条 `monitorexit`：一条在正常流程末尾（标号 13），另一条在异常处理的 `finally` 路径上（标号 18），配合异常表确保任何出口都执行解锁。这正是 `synchronized` 不会因异常而"锁泄漏"的原因。

## 八、字节码增强技术

既然 class 文件就是结构化的字节流，我们就能在"类加载前"或"运行时"改写/生成它，这就是**字节码增强（Bytecode Instrumentation）**。主流工具：

- **ASM**：最底层、性能最好，直接操作字节码指令（visitor 模式）。Spring、CGLib 底层都靠它。
- **Javassist**：提供更高层 API，可以用"类似 Java 源码的字符串"来改类，门槛低。
- **ByteBuddy**：现代、声明式 API，写起来最优雅，很多新框架首选。

它们支撑了无数基础设施：**Spring AOP** 用 CGLib/ByteBuddy 生成代理类织入切面；**MyBatis** 的 Mapper 接口在运行时被生成实现类；**SkyWalking** 的 Java 探针在类加载时插入埋点代码实现无侵入监控。

ByteBuddy 最小示例——给一个方法加上"执行前打印日志"的逻辑：

```java
package com.canoe.jvm.bytecode;

import net.bytebuddy.ByteBuddy;
import net.bytebuddy.implementation.MethodDelegation;
import net.bytebuddy.matcher.ElementMatchers;

public class ByteBuddyDemo {
    public static class Hello {
        public String say() { return "hello"; }
    }

    public static void main(String[] args) throws Exception {
        Class<?> dynamic = new ByteBuddy()
                .subclass(Hello.class)
                .method(ElementMatchers.named("say"))
                .intercept(MethodDelegation.to(Interceptor.class))
                .make()
                .load(ByteBuddyDemo.class.getClassLoader())
                .getLoaded();

        Hello proxy = (Hello) dynamic.getDeclaredConstructor().newInstance();
        System.out.println(proxy.say());
    }
}
```

无需修改 `Hello` 源码，就在运行时生成了它的子类并织入逻辑——这正是 AOP 的字节码级实现思路。

## 九、类加载与字节码

字节码与类加载篇（02 篇）首尾呼应：一个 `.class` 从磁盘到内存可用，字节码本身要在类加载流程里被反复"关照"：

- 在**验证阶段**，JVM 严格校验字节码的合法性——魔数是否 `CAFEBABE`、版本号是否兼容、指令是否合法、跳转是否越界。**这一段字节码若被手工篡改或不符合规范，验证阶段直接拒绝加载**，这是 JVM 安全性的第一道关。
- 在**准备阶段**，字节码里描述的 `static` 字段会被分配内存并赋零值；而 `static final` 常量若带 `ConstantValue` 属性，则在此阶段直接赋上编译期值。
- 到**初始化阶段**，字节码里的 `<clinit>` 方法（由所有 static 赋值与 static 块合并而成）才真正执行，把类"激活"。

所以"字节码"既是类加载的输入，也是其校验与初始化的依据——理解字节码，才能彻底理解类从何而来、为何安全。

## 本篇小结

- **学字节码能看清语法真相、排查问题、理解框架原理**（AOP/代理本质都是增强）。
- **class 文件是结构化表**：魔数 CAFEBABE、版本号、常量池、字段表、方法表、属性表。
- **`javap -c/-v/-p/-l` 分别看指令/常量池/私有成员/行号**，是读字节码的主工具。
- **`new` 后必跟 `dup`**，因为构造器要消费一份引用、另一份留给后续使用。
- **五种调用指令**：static/special/virtual/interface/dynamic，virtual 实现多态、dynamic 支撑 Lambda。
- **字符串拼接编译成 StringBuilder**，循环内拼接要手动提取避免反复 new。
- **泛型擦除**：运行期是 Object，取值自动补 `checkcast`。
- **foreach→Iterator、变参→数组、内部类→独立 class、try-with-resources→自动 finally close、switch String→hashCode+equals**。
- **synchronized 用 monitorenter/monitorexit**，两个 exit 保证异常路径也释放锁。
- **ASM/Javassist/ByteBuddy 实现字节码增强**，支撑 AOP、MyBatis、SkyWalking 探针。

## 参考链接

- [The Java Virtual Machine Specification - 字节码指令集](https://docs.oracle.com/javase/specs/jvms/se17/html/jvms-6.html)
- [Oracle - javap 工具文档](https://docs.oracle.com/en/java/javase/17/docs/specs/man/javap.html)
- [ASM 官方文档](https://asm.ow2.io/)
- [ByteBuddy 官网](https://bytebuddy.net/)
- [Javassist 官网](https://www.javassist.org/)
- [周志明《深入理解Java虚拟机》](https://book.douban.com/subject/34927789/)

下一篇 → [返回专栏首页](/java/jvm/structure)
