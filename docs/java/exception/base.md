# 01 异常基础

异常是 Java 程序运行期"出了状况"时抛出的信号。本篇从"异常到底是什么"讲起，梳理 `Throwable` 的家族体系、checked/unchecked 的分类，以及 JVM 自动抛出和程序员手动 `throw` 两种产生方式，最后给出异常信息、异常链和常见异常的排查思路，帮你建立一张完整的异常地图。

## 一、什么是异常

先讲个生活化的例子：你开车去公司，半路车胎爆了。爆胎这件事本身不是"错误"，而是开车过程中一种**非正常情况**——你有两种处理办法：自己换备胎继续开（捕获处理），或者打电话叫救援、今天干脆不去了（抛给别人处理）。Java 的异常也是同一个道理。

所谓**异常（Exception）**，就是程序在运行过程中，因为某种"非正常情况"而中断了正常的指令流，JVM 会把这种情况封装成一个对象抛出来。关键有三点：

- 异常**不是语法错误**。语法错误在编译期就过不了，连 `.class` 都生成不了；异常是代码能编译、能运行，运行到某一步才"出状况"。
- 异常**本身不是 bug**。它更像是一种"通知机制"：告诉调用方"这一步没按预期走完"。处理得当，程序完全可以继续跑。
- 异常是**对象**。它继承自 `Throwable`，所以可以携带信息（`message`）、原因（`cause`）和完整的调用栈（`stack trace`）。

和"错误（Error）"区分一下：车子爆胎你能换备胎（异常，可处理），但发动机直接炸了（Error，如 `OutOfMemoryError`），这种 JVM 层面的灾难你换不了，只能听天由命让程序退出。

## 二、异常的继承体系

Java 的异常体系是一棵以 `Throwable` 为根的家族树。`Throwable` 往下有两个亲儿子：`Error` 和 `Exception`。

```text
                  Throwable
                 /         \
              Error       Exception
             /                \
   （JVM 层面，      RuntimeException        其他受检异常
    程序处理不了）    （非受检，运行期）    （如 IOException）
                       /        \
                  NullPointerException
                  IndexOutOfBoundsException
                  ClassCastException
                  ArithmeticException
                  IllegalArgumentException
```

- **`Throwable`**：所有"可被抛出"事物的祖先，定义了 `getMessage()`、`toString()`、`printStackTrace()` 等核心方法。
- **`Error`**：表示 JVM 自身的严重问题，比如 `OutOfMemoryError`（内存耗尽）、`StackOverflowError`（栈溢出）、`NoClassDefFoundError`。这类问题**程序基本无能为力**，你不应该、也通常不去 `catch` 它。
- **`Exception`**：程序层面能处理的问题，是我们日常打交道的主角。它再分成两支：
  - `RuntimeException` 及其子类：**非受检异常（unchecked）**，编译器不强制你处理。
  - 其它 `Exception` 的直接子类（如 `IOException`、`SQLException`）：**受检异常（checked）**，编译器强制你必须处理或声明抛出。

一句话记住：`Error` 是"天灾"，`Exception` 是"人祸"，`RuntimeException` 是"人祸里那种本来可以避免的粗心"。

## 三、异常的分类

按"编译器是否强制处理"来分，异常只有两类：

| 类别 | 范围 | 编译器要求 | 典型代表 |
| --- | --- | --- | --- |
| **受检异常 checked** | `Exception` 直接子类（非 `RuntimeException`） | 必须 `try-catch` 或 `throws` 声明，否则编译不过 | `IOException`、`SQLException`、`ClassNotFoundException` |
| **非受检异常 unchecked** | `RuntimeException` 子类 + `Error` | 不强制处理 | `NullPointerException`、`IndexOutOfBoundsException`、`ArithmeticException` |

为什么这样分？因为受检异常描述的是"外部可预期、但程序控制不了"的问题（文件不存在、网络断了），编译器逼你正视它；而非受检异常往往是"编程错误"（传了 `null`、数组越界），理论上不该发生，发生了就该改代码而不是 `catch` 住继续跑。

> 注意：`Error` 虽然也属于 unchecked，但正如前面所说，一般不把它和 `RuntimeException` 归为一谈——前者是 JVM 灾难，后者是代码瑕疵。

## 四、异常的产生

异常的产生有两条路：**自动抛出**和**手动抛出**。

**（1）自动抛出（JVM 检测到）**

这是最常见的情况，你没写任何 `throw`，但运行到某一步 JVM 自己把异常抛出来了：

```java
package com.canoe.exception.base;

import java.util.ArrayList;
import java.util.List;

/**
 * 演示 JVM 自动抛出的几种常见运行时异常
 */
public class AutoThrowDemo {

    public static void main(String[] args) {
        // 1. 空指针：在一个 null 引用上调用方法
        String name = null;
        // name.length();  // 抛 NullPointerException

        // 2. 数组越界：下标超出合法范围
        int[] nums = new int[3];
        // nums[5] = 10;   // 抛 ArrayIndexOutOfBoundsException

        // 3. 类型转换错误：向下转型不匹配
        Object obj = "我其实是字符串";
        // Integer value = (Integer) obj;  // 抛 ClassCastException

        // 4. 算术异常：除数为 0
        // int r = 1 / 0;   // 抛 ArithmeticException

        // 5. 非法参数：JDK 自带校验，例如线程睡眠负值
        // Thread.sleep(-1);  // 抛 IllegalArgumentException

        List<String> list = new ArrayList<String>();
        System.out.println("上面都是会抛异常的例子，已注释，避免 main 中断");
    }
}
```

**（2）手动抛出（`throw`）**

当你的业务规则被打破，需要主动"喊停"，就用 `throw new XxxException(...)`：

```java
package com.canoe.exception.base;

/**
 * 手动 throw 演示：年龄不合法时主动抛出异常
 */
public class ManualThrowDemo {

    public static void main(String[] args) {
        setAge(-5);
    }

    public static void setAge(int age) {
        if (age < 0 || age > 150) {
            // 主动抛出一个非受检异常，把"为什么错"写进 message
            throw new IllegalArgumentException("年龄必须在 0~150 之间，当前传入：" + age);
        }
        System.out.println("年龄设置成功：" + age);
    }
}
```

`throw` 后面必须跟一个 `Throwable` 的实例（通常是它的子类）。一旦执行到 `throw`，当前方法立刻结束，异常沿着调用栈往上抛。

## 五、异常处理的两种方式

遇到异常，你有两个选择：**就地捕获**（`try-catch`）或**声明抛出**（`throws`）。

- **`try-catch`：我自己能处理，就在这里消化掉。**
- **`throws`：我处理不了（或该由调用方决定怎么处理），就甩给上层。**

怎么选？记住一个核心原则：

> **"谁能恢复，谁就捕获；谁该知情，谁就捕获；谁都处理不了，就抛出。"**

具体决策：

- 如果这个异常在当前方法内**能够优雅恢复**（比如读文件失败就换个默认配置），就 `try-catch`。
- 如果这个异常属于**业务流程的一部分**，应该由上层根据业务语义决定（比如"余额不足"该提示用户还是走降级），就 `throws` 抛上去，通常一直抛到 Controller / 全局异常处理器统一兜住。
- **不要**为了"让方法签名干净"而用 `try-catch` 吞掉本该上抛的异常——那是把地雷埋给别人。

```java
package com.canoe.exception.base;

import java.io.FileInputStream;
import java.io.IOException;

/**
 * 演示 try-catch 与 throws 的取舍
 */
public class HandleWayDemo {

    // 读取配置：本方法内无法决定"读不到怎么办"，所以 throws 抛给调用方
    public static String readConfig() throws IOException {
        FileInputStream in = new FileInputStream("config.txt");
        in.close();
        return "ok";
    }

    // 读取默认名称：读不到就给个兜底值，自己消化掉
    public static String loadName() {
        try {
            return readConfig();
        } catch (IOException e) {
            // 兜底：读不到就用默认值，不打断主流程
            System.out.println("配置文件缺失，使用默认名称");
            return "canoe";
        }
    }

    public static void main(String[] args) {
        System.out.println(loadName());
    }
}
```

## 六、异常信息

异常对象自带三件套，但用途完全不同，别用错：

| 方法 | 返回内容 | 适用场景 |
| --- | --- | --- |
| `getMessage()` | 构造异常时传入的那句描述 | 给用户/日志一句简短原因 |
| `toString()` | 类名 + `getMessage()` | 一行概览 |
| `printStackTrace()` | 完整调用栈（**最详细**） | 排查问题根因 |

```java
package com.canoe.exception.base;

public class ExceptionInfoDemo {

    public static void main(String[] args) {
        try {
            int x = 1 / 0;
        } catch (ArithmeticException e) {
            System.out.println("getMessage: " + e.getMessage());
            System.out.println("toString  : " + e.toString());
            // 生产环境千万别直接 e.printStackTrace() 打到控制台
            // 应该用日志框架记录，例如：log.error("除法出错", e);
            e.printStackTrace();
        }
    }
}
```

**重要实践**：`printStackTrace()` 直接打印到标准错误流，**无法被日志框架收集、无法带请求 ID、高并发下还会争抢 `System.err` 锁**。生产代码务必用 `log.error("描述信息", e)` 把完整堆栈交给日志框架（Logback/Log4j2），让它落盘或上报到集中式日志平台。

## 七、异常链

实际开发中，你常常会在底层捕获一个"低级"异常（比如 `SQLException`），然后想在业务层抛出一个"高级"异常（比如 `OrderSaveException`）。这时候**务必用异常链把原始异常保留下来**，否则排查时就像断了线的风筝。

正确的做法——把 `cause` 传进新异常的构造器：

```java
package com.canoe.exception.base;

public class ExceptionChainDemo {

    public static void main(String[] args) {
        try {
            saveOrder();
        } catch (RuntimeException e) {
            // 用 getCause() 能一路回溯到最原始的 SQLException
            System.out.println("业务异常：" + e.getMessage());
            System.out.println("根因：" + e.getCause());
        }
    }

    public static void saveOrder() {
        try {
            // 模拟底层数据库操作失败
            throw new java.sql.SQLException("连接超时");
        } catch (java.sql.SQLException cause) {
            // 正确：保留 cause，形成异常链
            throw new RuntimeException("保存订单失败", cause);
        }
    }
}
```

反面的"血泪教训"——吞掉原因，只抛一个光秃秃的新异常：

```java
// 错误示范：原始异常被吃掉，线上排查直接抓瞎
try {
    // ...数据库操作...
} catch (SQLException e) {
    throw new RuntimeException("保存订单失败"); // 没有传 cause！
}
```

`e.getCause()` 就是顺着这条链往回找根因的钥匙。永远记得：**保留 `cause`，就是保留给未来排查问题的自己一条活路。**

## 八、常见异常的排查

| 异常 | 典型成因 | 排查思路 |
| --- | --- | --- |
| `NullPointerException` | 在 `null` 引用上调用方法/取属性；自动拆箱时 `null` 转基本类型 | 看堆栈定位"哪一行、哪个变量为 `null`"；用 `Objects.requireNonNull` / `Optional` 提前防御；开启 IDE 的 `@Nullable` 注解检查 |
| `ClassCastException` | 泛型擦除后强行向下转型；从集合取出对象时类型不符 | 转型前用 `instanceof` 判断；尽量用泛型 `List<String>` 避免原始类型 |
| `IndexOutOfBoundsException` | 循环条件写错、下标从 1 开始数、并发修改集合 | 检查循环的 `<` 与 `<=`；确认下标范围；遍历用增强 `for` 或迭代器 |
| `IllegalArgumentException` | 调用方传了非法参数（JDK 自带校验最多） | 看 `message` 里的参数值，校验入口参数 |
| `StackOverflowError` | 方法无限递归；对象循环引用导致 `toString` 递归 | 检查递归终止条件；小心 `toString` 里互相引用 |

排查的通用套路：**先看异常类型和 `message` 定方向 → 顺着 `printStackTrace` 的调用栈找到你自己的代码那一行 → 在该行上下推断哪个变量/状态不符合预期 → 加日志或用断点复现**。

## 本篇小结

- **异常是对象**，继承自 `Throwable`，可携带 `message`、`cause` 和调用栈。
- 异常**不是语法错误**，而是运行期的中断信号，处理得当程序可继续运行。
- `Throwable` 的两大分支是 **`Error`（JVM 灾难）和 `Exception`（可处理问题）**。
- `Error` 如 **`OutOfMemoryError`、`StackOverflowError` 程序通常处理不了，不要去 catch**。
- 异常按编译器要求分为 **checked（受检）和 unchecked（非受检）** 两类。
- **非受检异常 = `RuntimeException` 子类**，编译器不强制处理。
- 异常产生有**自动抛出（JVM）和手动 `throw`（程序员）**两条路。
- 处理原则：**能恢复/该知情的就地 `try-catch`，否则用 `throws` 抛出**。
- `printStackTrace()` **生产环境要交给日志框架**，别直接打控制台。
- **保留 `cause` 形成异常链**，千万别吞掉原始异常。
- 排查先看**异常类型 + message + 调用栈**定位到自己的代码行。

## 参考链接

- [Oracle 官方教程：Java 异常](https://docs.oracle.com/javase/tutorial/essential/exceptions/)
- [Java SE 21 `Throwable` 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html)
- [Java SE 21 `Exception` 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Exception.html)
- [Java SE 21 `RuntimeException` 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/RuntimeException.html)
- [Java SE 21 `Error` 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Error.html)
- [Baeldung：Java 异常处理指南](https://www.baeldung.com/java-exceptions)

下一篇 → [02 受检异常与非受检异常](/java/exception/checked-unchecked)
