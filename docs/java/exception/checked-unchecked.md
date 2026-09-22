# 02 受检异常与非受检异常

上篇我们建立了异常的家族树，本篇聚焦其中最容易被混淆的一对概念：**受检异常（checked）与非受检异常（unchecked）**。它们最大的区别不在名字，而在于"编译器管不管你"——这背后是 Java 一套关于"谁该为错误负责"的设计哲学，也引发了长达二十年的争议。

## 一、两者的定义

- **受检异常（checked exception）**：`Exception` 的直接子类，但**不是** `RuntimeException` 的子类。典型如 `IOException`、`SQLException`、`ClassNotFoundException`。编译器在编译期就强制你：要么 `try-catch` 处理，要么在方法签名上 `throws` 声明，否则**编译直接失败**。
- **非受检异常（unchecked exception）**：包含两部分——`RuntimeException` 及其所有子类，以及 `Error`。编译器**不强制**你处理，你既可以不写 `try-catch`，也可以不写 `throws`，代码照样编译通过。

用一句话概括：**"编译器会不会拿着红叉逼你处理"是两者的根本分界线。** 受检异常是"编译器盯着的麻烦"，非受检异常是"编译器放手、靠你自觉的麻烦"。

```java
package com.canoe.exception.checked;

import java.io.FileInputStream;
import java.io.IOException;

public class DefineDemo {

    // 受检异常：不写 throws 或 try-catch，这行方法根本编译不过
    public static void readFile() throws IOException {
        FileInputStream in = new FileInputStream("a.txt");
        in.close();
    }

    // 非受检异常：不处理也不声明，照样编译通过（运行才可能炸）
    public static void divide() {
        int r = 1 / 0; // ArithmeticException，编译器不管
    }
}
```

## 二、为什么要有受检异常

受检异常是 Java 早期（对标 C++ 没有强制异常检查）的一个"理想主义"设计，意图很明确：

> **强迫调用方正视"那些可预期、但程序自身控制不了"的外部问题。**

比如你调用 `new FileInputStream("a.txt")`，文件"可能不存在"是一个**可预期、必然会发生**的外部状况。Java 的设计者认为：这种事调用方迟早要面对，与其让你遗忘、等到线上才崩，不如在**编译期就逼你表态**——"文件读不到你打算怎么办？重试？用默认值？还是干脆报错退出？"

换句话说，受检异常把"错误处理"从一件"运行时才想起来"的事，变成了"写代码时就必须设计"的事。这是一种用编译约束换健壮性的思路。

## 三、争议

受检异常的设计初衷很好，但二十多年下来争议很大，甚至可以说**被很多现代框架"嫌弃"**。我们客观看两边：

**支持受检异常的理由：**
- 编译期强制，杜绝"忘了处理关键错误"的低级失误。
- 方法签名即文档：`throws IOException` 一眼就知道这方法会出什么外部问题。

**反对受检异常的理由（更主流）：**
- **代码被 try-catch 淹没**：一个方法调三个会抛受检异常的方法，你就得写三层 `try-catch`，或者把 `throws` 一路上抛，方法签名越来越丑。
- **`throws` 层层上抛污染签名**：底层一个 `SQLException`，能顺着调用栈一路 `throws` 到 Controller，中间每层都只是"传声筒"，毫无意义。
- **破坏了高层抽象**：业务层只关心"下单失败"，却被逼着声明底层的 `SQLException`/`IOException`，把实现细节泄露给了上层。
- **大多数语言没有受检异常**：C#、Python、Go、Kotlin、Rust 等都选择"一切异常都非受检"，靠约定和文档而非编译强制。Spring 框架更是旗帜鲜明地**全面使用非受检异常**（`RuntimeException` 子类），让业务异常自由地一路冒泡到 `ControllerAdvice` 统一处理。

**结论**：受检异常适合"调用方必须知道并恢复"的场景；但在业务系统里，**约定用自定义非受检异常统一处理**，反而更清爽、耦合更低。这也是为什么本专栏后面会教你自己定义 `RuntimeException` 子类。

## 四、常见受检异常

| 异常 | 触发场景 |
| --- | --- |
| `IOException` | 一切输入输出失败：读写文件、网络断开、管道损坏 |
| `SQLException` | 数据库访问出错：SQL 语法错、连接断了、约束冲突 |
| `ClassNotFoundException` | 按类名加载类时找不到（如 `Class.forName("xxx")` 拼错名字、jar 缺失） |
| `FileNotFoundException` | `IOException` 的子类，特指文件不存在（注意它也是受检的） |
| `InterruptedException` | 线程在 `sleep`/`wait`/`join` 时被别的线程调用 `interrupt()` 打断 |

`InterruptedException` 有个特殊规矩：捕获后最好**把中断状态还原**（`Thread.currentThread().interrupt()`），否则上层就感知不到中断了——这是并发编程里的经典坑。

## 五、常见非受检异常

| 异常 | 触发场景 |
| --- | --- |
| `NullPointerException` | 在 `null` 引用上调用方法/取属性、自动拆箱 `null` |
| `IllegalArgumentException` | 参数非法（如传了负数、非法枚举），JDK 自带校验最爱抛 |
| `IllegalStateException` | 对象状态不对（如还没初始化就调用、重复 `start` 线程） |
| `IndexOutOfBoundsException` | 数组/列表下标越界（含 `ArrayIndexOutOfBoundsException`、`StringIndexOutOfBoundsException`） |
| `ClassCastException` | 向下转型不匹配（泛型擦除后尤易踩） |
| `ArithmeticException` | 整数除以 0 |
| `ConcurrentModificationException` | 遍历集合时并发修改（如 `for` 循环里 `remove`，却没用迭代器） |

这些大多属于"本可以避免的编程错误"，所以编译器不强制你处理——理论上你改好代码就不该再出现。

## 六、如何选型

当你要设计自己的异常（或决定抛哪种），用下面这条决策流程：

```text
                    这个"意外"属于什么性质？
                          |
            ┌─────────────┴─────────────┐
            |                           |
   调用方必须知道并恢复？        编程错误 / 参数非法？
   （外部可控、可预期）          （本不该发生）
            |                           |
            v                           v
     抛【受检异常】            抛【非受检异常】
   Exception 直接子类          RuntimeException 子类
            |                           |
            v                           v
   例如：PaymentGatewayException    例如：自定义 BusinessException
   （强制调用方处理网络问题）    （冒泡到全局处理器统一兜）
```

补充一条项目级经验：**业务系统里，约定所有业务异常都用自定义非受检异常（继承 `RuntimeException`）**，再配合 Spring 的 `@RestControllerAdvice` 全局兜住。这样方法签名干净，错误处理又集中可控——这是当下最主流的做法。

## 七、Lombok 的 @SneakyThrows

既然受检异常这么烦人，Lombok 提供了一个"作弊"注解 `@SneakyThrows`：它让你**不写 `try-catch`、也不写 `throws`，方法却能抛出受检异常**，而且编译能通过。

原理很巧妙：它**不是在编译期绕开检查，而是用泛型 + 在字节码层面用"伪泛型技巧"把 checked 异常强转后抛出**，让 JVM 在运行期照样把异常抛出去，只是编译器被"骗"过去了。

```java
package com.canoe.exception.checked;

import lombok.SneakyThrows;
import java.io.FileInputStream;

public class SneakyDemo {

    // 没有 throws，也没有 try-catch，但能抛 IOException
    @SneakyThrows
    public static void read() {
        FileInputStream in = new FileInputStream("a.txt");
        in.close();
    }
}
```

**争议**：它确实能让代码变短，但代价是**方法签名不再诚实**——调用方看签名以为"很安全"，实际会被 `IOException` 炸到。Spring 等框架内部就用了类似技巧。笔者的建议：**业务代码慎用**，它掩盖了"这里会出外部问题"的事实；真想统一处理，不如直接用自定义非受检异常。

## 本篇小结

- **受检异常 = `Exception` 直接子类（非 `RuntimeException`），编译器强制处理或声明。**
- **非受检异常 = `RuntimeException` 子类 + `Error`，编译器不强制处理。**
- 受检异常的设计意图是**逼调用方处理可预期的外部问题**。
- 受检异常的代价是**代码被 try-catch 淹没、`throws` 层层污染签名**。
- 大多数现代语言**没有受检异常**，Spring 全面采用非受检异常。
- `InterruptedException` 捕获后**应还原中断状态**，否则上层感知不到。
- 选型原则：**调用方必须恢复用受检，编程错误用非受检。**
- 业务系统普遍约定**用自定义非受检异常 + 全局处理器**统一兜底。
- `@SneakyThrows` 用字节码技巧绕过编译检查，**使签名不再诚实、慎用**。
- `Error` 虽属 unchecked，但**不应被当作普通异常去 catch**。

## 参考链接

- [Oracle 官方教程：Unchecked Exceptions — 争议与设计](https://docs.oracle.com/javase/tutorial/essential/exceptions/runtime.html)
- [Oracle 官方教程：Catch or Specify Requirement](https://docs.oracle.com/javase/tutorial/essential/exceptions/catchOrDeclare.html)
- [Java SE 21 `RuntimeException` 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/RuntimeException.html)
- [Java SE 21 `IOException` 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/IOException.html)
- [Project Lombok `@SneakyThrows`](https://projectlombok.org/features/SneakyThrows)
- [Baeldung：Checked vs Unchecked Exceptions](https://www.baeldung.com/java-checked-unchecked-exceptions)
- [Spring 官方：`DataAccessException`（统一非受检异常体系）](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/dao/DataAccessException.html)

下一篇 → [03 try-catch-finally](/java/exception/try-catch)
