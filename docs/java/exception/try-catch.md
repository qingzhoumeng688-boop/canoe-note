# 03 try-catch-finally

上篇讲了异常的"身世"，本篇聚焦"怎么接住异常"。`try-catch-finally` 是最常用的异常处理语法，但里面藏着不少面试高频坑：`finally` 一定执行吗？`finally` 里的 `return` 会覆盖 `try` 的返回值吗？`try-with-resources` 为什么比手写 `finally` 更优雅？一篇文章讲透。

## 一、三种结构

`try` 相关的语法有四种组合，按需取舍：

| 结构 | 用途 |
| --- | --- |
| `try-catch` | 只捕获、不清理 |
| `try-finally` | 不捕获、但无论成败都要做清理（如关闭资源） |
| `try-catch-finally` | 既捕获又清理 |
| `try-with-resources`（JDK 7+） | 自动关闭实现了 `AutoCloseable` 的资源，替代繁琐的 `finally` |

```java
package com.canoe.exception.trycatch;

import java.io.FileInputStream;
import java.io.IOException;

public class StructureDemo {

    // 1. try-catch：捕获但不做资源清理（仅演示）
    public static void tryCatch() {
        try {
            int x = 1 / 0;
        } catch (ArithmeticException e) {
            System.out.println("捕获除零：" + e.getMessage());
        }
    }

    // 2. try-finally：不捕获，但保证 finally 里的清理一定跑
    public static void tryFinally() throws IOException {
        FileInputStream in = new FileInputStream("a.txt");
        try {
            // 可能抛异常的读操作
            in.read();
        } finally {
            in.close(); // 无论成败都关闭
        }
    }

    // 3. try-catch-finally：既捕获又清理
    public static void tryCatchFinally() {
        try {
            int x = 1 / 0;
        } catch (ArithmeticException e) {
            System.out.println("出错啦");
        } finally {
            System.out.println("我一定执行");
        }
    }

    public static void main(String[] args) {
        tryCatch();
        tryCatchFinally();
    }
}
```

## 二、多重 catch

一个 `try` 可以跟多个 `catch`，但**顺序必须"子类在前、父类在后"**——因为 `catch` 是从上往下匹配第一个能接住的。如果把 `Exception` 写在 `NullPointerException` 前面，后面的 `catch` 就永远到不了，编译器直接报"已捕获的异常"。

JDK 7 还支持**多异常合并捕获**：`catch (A | B e)`，多个异常共用一段处理。**注意：多异常捕获时变量 `e` 是隐式 `final` 的，不能再赋值。**

```java
package com.canoe.exception.trycatch;

public class MultiCatchDemo {

    public static void main(String[] args) {
        try {
            String s = null;
            s.length();
        }
        // 顺序错误示范（编译不过）：Exception 在前会"屏蔽"后面的 catch
        // catch (Exception e) { }
        // catch (NullPointerException e) { }  // 编译器：已捕获

        // 正确：子类在前
        catch (NullPointerException e) {
            System.out.println("空指针：" + e.getMessage());
        }
        catch (RuntimeException e) {
            System.out.println("其它运行时异常：" + e.getMessage());
        }

        // JDK 7 多异常合并：变量 e 隐式 final，不能 e = new ...
        try {
            Object o = "x";
            Integer i = (Integer) o;
        } catch (NullPointerException | ClassCastException e) {
            System.out.println("合并捕获：" + e.getClass().getSimpleName());
            // e = new RuntimeException(); // 编译错误：e 是 final
        }
    }
}
```

## 三、finally 的执行时机

`finally` 的承诺是：**只要 `try` 对应的 `try` 块开始执行，finally 就一定会执行**（除非 JVM 直接退出）。以下情况 finally **不会**执行：

- 调用了 `System.exit(0)`（JVM 直接退出）；
- JVM 崩溃（如 `OutOfMemoryError` 后挂掉）；
- 执行 `try` 的线程被操作系统 `kill -9` 强杀。

经典陷阱：**`finally` 里有 `return`，会覆盖 `try` 里的返回值**。看下面的验证：

```java
package com.canoe.exception.trycatch;

public class FinallyReturnDemo {

    public static int finallyOverride() {
        try {
            return 1;          // 准备返回 1
        } finally {
            return 2;          // finally 的 return 把 1 顶掉了！
        }
    }

    public static void main(String[] args) {
        System.out.println(finallyOverride()); // 输出 2，而不是 1
    }
}
```

**结论：永远不要在 `finally` 里写 `return`**，否则 `try`/`catch` 里精心准备的返回值、甚至抛出的异常都会被静默吞掉。

## 四、return 与 finally 的执行顺序

面试高频题：`try` 里有 `return`，`finally` 在什么时候跑？`finally` 对返回值的修改生效吗？

原理：**当 `try` 执行到 `return` 时，JVM 先把返回值（或引用）"暂存"到一个局部槽位，然后去执行 `finally`，最后才把暂存的值真正返回。**

因此：

- `finally` **在 `try` 的 `return` 之前执行**，但在"返回动作真正完成"之前。
- 若返回**基本类型**，`finally` 里修改那个变量**不影响暂存值**（改动无效）。
- 若返回**引用类型**，`finally` 里修改该对象的**属性**会生效（因为暂存的是引用，指向同一对象）。

```java
package com.canoe.exception.trycatch;

public class ReturnOrderDemo {

    // 基本类型：finally 修改无效
    public static int basicType() {
        int x = 10;
        try {
            return x;          // 暂存 10
        } finally {
            x = 20;            // 改的是局部变量，暂存值仍是 10
        }
    }

    // 引用类型：finally 修改属性生效
    static class Box {
        int value = 10;
    }

    public static Box refType() {
        Box b = new Box();
        try {
            return b;          // 暂存的是引用，指向同一个对象
        } finally {
            b.value = 20;      // 改的就是暂存引用指向的对象
        }
    }

    public static void main(String[] args) {
        System.out.println(basicType());   // 10
        System.out.println(refType().value); // 20
    }
}
```

## 五、try-with-resources

JDK 7 引入的语法糖，专门解决"资源忘记关 / 关得很啰嗦"的问题。规则：

- 资源必须实现 `AutoCloseable` 接口（JDK 7+ 里 `Closeable` 也继承了它）；
- 写在 `try( ... )` 的小括号里，JVM 会在块结束（无论正常还是异常）**自动调用 `close()`**；
- **关闭顺序与声明顺序相反**（后声明的先关）；
- 若 `try` 块和 `close()` 都抛异常，**块的异常被保留，`close()` 的异常作为"被抑制异常"挂在 `addSuppressed` 上**，可通过 `getSuppressed()` 拿到。

```java
package com.canoe.exception.trycatch;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;

public class TryWithResourcesDemo {

    // 传统写法：嵌套 finally，关一个资源要判 null，还容易漏
    public static String oldWay() throws IOException {
        BufferedReader br = null;
        try {
            br = new BufferedReader(new FileReader("a.txt"));
            return br.readLine();
        } finally {
            if (br != null) {
                br.close();
            }
        }
    }

    // try-with-resources：自动关闭，后声明的先关，代码清爽
    public static String newWay() throws IOException {
        try (BufferedReader br = new BufferedReader(new FileReader("a.txt"))) {
            return br.readLine();
        } // 这里自动 br.close()，且 close 异常被抑制
    }

    public static void main(String[] args) {
        System.out.println("try-with-resources 让资源关闭自动且安全");
    }
}
```

一个 `try( )` 里可以声明多个资源，用分号隔开，关闭顺序同样"后进先出"。

## 六、catch 里该做什么

`catch` 不是"把异常按住别报错"就完事了，它该承担明确职责：

**该做的：**
- **记录日志并带上上下文**（哪个用户、哪个单号、什么参数），方便复现；
- **转换/包装异常**，把底层异常翻译成业务语义（如 `SQLException` → `OrderSaveException`，记得带 `cause`）；
- **做补偿或降级**（如远程调用失败切到默认配置、走本地缓存）；
- **返回兜底值**，让主流程不至于中断。

**绝对不该做的（重点批判）：**
- **空 `catch` 块**：`catch (Exception e) {}`——异常被彻底吃掉，线上出事时你连痕迹都找不到，是新人最常犯的"埋雷"写法；
- **只 `e.printStackTrace()`**：打到控制台、不进日志框架、高并发还抢锁，等于没记；
- **吞掉异常后继续跑**，导致数据处于不一致状态（如扣了库存却没下单，还返回"成功"）。

```java
package com.canoe.exception.trycatch;

import java.util.logging.Logger;

public class CatchPracticeDemo {

    private static final Logger LOG = Logger.getLogger("CatchPractice");

    // 错误：空 catch，异常消失无踪
    // try { risky(); } catch (Exception e) { }

    // 正确：记录 + 返回兜底
    public static String safeRead() {
        try {
            return readFromRemote();
        } catch (Exception e) {
            LOG.warning("远程配置读取失败，使用本地默认值，原因：" + e.getMessage());
            return "default-config"; // 降级兜底
        }
    }

    private static String readFromRemote() {
        throw new IllegalStateException("模拟远程不可用");
    }

    public static void main(String[] args) {
        System.out.println(safeRead());
    }
}
```

## 七、性能

异常不是"免费的"，滥用会拖累性能：

- **创建异常对象开销不小**：构造时要调用 `fillInStackTrace()` 填充整条调用栈，这是异常比普通返回慢几十倍的主因。
- **绝不要用异常做流程控制**：比如"用 `try-catch` 判断字符串能不能转数字"是反模式，正常分支也走异常，性能灾难。该用 `tryParse`、`StringUtils.isNumeric` 或先判空判格式。
- **`StackTraceElement` 读取成本高**：高并发路径上若频繁 `getStackTrace()` 会明显拖慢；若业务只需要 `message`，可重写异常构造器跳过栈填充（如某些框架的 `FastException`），但一般无需过度优化。

```java
package com.canoe.exception.trycatch;

public class PerfDemo {

    // 反模式：拿异常当分支控制
    public static boolean isNumberBad(String s) {
        try {
            Integer.parseInt(s);
            return true;
        } catch (NumberFormatException e) {
            return false; // 慢！且语义混乱
        }
    }

    // 推荐：正常判断，异常留给真正的意外
    public static boolean isNumberGood(String s) {
        if (s == null) {
            return false;
        }
        for (int i = 0; i < s.length(); i++) {
            if (!Character.isDigit(s.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isNumberGood("123")); // true，无需异常
    }
}
```

## 本篇小结

- `try` 语法有 **`try-catch`、`try-finally`、`try-catch-finally`、`try-with-resources`** 四种。
- 多重 `catch` 必须**子类在前、父类在后**，否则编译报错。
- JDK 7 **多异常捕获 `catch (A | B e)` 中 `e` 隐式 `final`**。
- `finally` **几乎一定执行**，仅 `System.exit`、JVM 崩溃、线程被杀例外。
- **`finally` 里的 `return` 会覆盖 `try` 的返回值，严禁这么写**。
- `try` 的 `return` 会**先暂存返回值再跑 finally**：基本类型改动无效、引用类型改属性生效。
- `try-with-resources` **自动关闭 `AutoCloseable` 资源，关闭顺序后进先出**。
- 被抑制的异常可通过 **`getSuppressed()`** 获取，不会丢失。
- `catch` 里应**记日志/转换/降级/兜底**，别写空块、别只 `printStackTrace`。
- **异常创建有性能成本，绝不用异常做正常流程控制**。

## 参考链接

- [Oracle 官方教程：The try-with-resources Statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html)
- [Oracle 官方教程：Catching and Handling Exceptions](https://docs.oracle.com/javase/tutorial/essential/exceptions/handling.html)
- [Oracle 官方教程：The finally Block](https://docs.oracle.com/javase/tutorial/essential/exceptions/finally.html)
- [Java SE 21 `AutoCloseable` 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html)
- [Java SE 21 `Throwable.getSuppressed()`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Throwable.html#getSuppressed())
- [Baeldung：Java 异常处理最佳实践](https://www.baeldung.com/java-exceptions)

下一篇 → [04 自定义异常](/java/exception/custom)
