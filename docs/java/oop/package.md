# 10 包

> 本篇导读：Java 用"包（package）"把成百上千个类像文件目录一样组织起来。它既解决了类名冲突，又和访问修饰符配合完成封装，还是 jar、classpath、模块系统的基础。本篇从语法一路讲到项目分层，帮你建立完整的"包世界"地图。

## 一、为什么要有包

没有包的世界会怎样？你写了一个 `User` 类，同事也写了一个 `User` 类，编译器根本分不清谁是谁——类名冲突。

包的作用类比**文件系统的目录**：

```
src/
└── com/
    └── canoe/
        ├── oop/
        │   └── User.java
        └── web/
            └── User.java   // 不同包里同名类互不干扰
```

具体价值：

1. **避免类名冲突**：不同包可以有同名类，靠包名区分；
2. **便于管理**：按层、按业务把类归类，项目越大越需要；
3. **配合访问修饰符做封装**：包级私有（默认修饰符）让"同包可见、跨包隐藏"成为可能。

## 二、package 语法

三条铁律：

1. `package` 语句**必须是文件的第一行有效代码**（注释除外）；
2. 命名用**域名倒写**，如 `com.canoe.oop`；
3. **包名必须和目录结构一致**：`com.canoe.oop` 的类必须放在 `com/canoe/oop/` 目录下，否则编译报错。

```java
package com.canoe.oop.pkg;   // 文件必须位于 com/canoe/oop/pkg/ 目录

public class Hello {
    public void say() {
        System.out.println("你好，包世界");
    }
}
```

小坑：`package` 是 Java 关键字，所以**不能用 `package` 当包名的一段**（例如 `com.canoe.package` 编译失败）。写示例时我们用 `com.canoe.oop.pkg` 这类安全命名。

## 三、import

`import` 让你少写全限定名，也带来"同名类"的坑。

- **导入单个类**：`import com.canoe.oop.pkg.Hello;`
- **导入整个包**：`import com.canoe.oop.pkg.*;` —— 注意它**只导入该包下的类，不会递归导入子包**；而且和 IDE 自动补全是两回事，有人嫌它"不够明确"，团队规范里常要求显式导入。
- **同名类冲突**：当你同时需要 `java.util.Date` 和 `java.sql.Date`，`import` 两者会冲突，只能**其中一个写全限定名**。
- **`java.lang` 自动导入**：`String`、`System`、`Math` 等都在这个包，编译器默认帮你导入，无需手写。

```java
package com.canoe.oop.pkg;

import java.util.Date;          // 导入 util 的 Date

public class ImportDemo {
    public static void main(String[] args) {
        Date now = new Date();  // 这里用的是 java.util.Date
        // sql 的 Date 同名，必须写全限定名避免冲突
        java.sql.Date sqlDate = java.sql.Date.valueOf("2026-09-22");
        System.out.println(now);
        System.out.println(sqlDate);
    }
}
```

## 四、JDK 常用包速览

| 包名 | 职责 | 典型类 |
| --- | --- | --- |
| `java.lang` | 语言核心，自动导入 | `String`、`Object`、`Math`、`System` |
| `java.util` | 集合、日期、工具 | `ArrayList`、`HashMap`、`List`、`Scanner` |
| `java.io` | 流式输入输出 | `FileInputStream`、`FileWriter` |
| `java.nio` | 新 I/O，缓冲区与通道 | `Path`、`Files`、`ByteBuffer` |
| `java.net` | 网络编程 | `Socket`、`URL`、`ServerSocket` |
| `java.sql` | 数据库 JDBC | `Connection`、`Statement`、`Date` |
| `java.time` | 现代日期时间（JDK 8+） | `LocalDate`、`Instant`、`Duration` |
| `java.util.concurrent` | 并发与线程池 | `ExecutorService`、`ConcurrentHashMap` |

## 五、jar 包

`.jar`（Java Archive）本质是 **class 文件与资源的 zip 压缩包**。把编译产物打成一个 jar，就能像"一摞文件"一样分发和引用。

关键组成：

- **打 jar**：`jar cf mylib.jar -C out/ .`（或 `jar cvfe` 指定入口）；
- **`MANIFEST.MF`**：jar 里的清单文件，记录版本、依赖等元信息；
- **可执行 jar**：在清单里写 `Main-Class: com.canoe.oop.pkg.Hello`，再用 `java -jar mylib.jar` 直接运行；
- **依赖的 classpath 问题**：jar A 依赖 jar B 时，运行时必须把它们都放进 classpath，否则 `NoClassDefFoundError`。现代项目用 Maven/Gradle 的 `dependencies` 来管理，本质就是自动拼 classpath。

```
mylib.jar
├── META-INF/
│   └── MANIFEST.MF        # Main-Class: com.canoe.oop.pkg.Hello
└── com/canoe/oop/pkg/
    └── Hello.class
```

## 六、classpath 与模块

- **classpath**：JVM 寻找 class 的"搜索路径"。你写 `java -cp lib/a.jar:lib/b.jar com.canoe.oop.pkg.Hello`，JVM 就按这个顺序找类。找不到就 `ClassNotFoundException`。
- **模块系统（JDK 9+）**：当 classpath 越来越大，"JAR 地狱"和隐式依赖难以管控。Java 9 引入 **module-info.java**，用 `requires` / `exports` 显式声明依赖与对外暴露的包，让依赖关系在编译期就可见、可控。

```java
// module-info.java 示例
module com.canoe.app {
    requires com.canoe.lib;   // 声明依赖
    exports com.canoe.app.api; // 只暴露 api 包
}
```

## 七、项目分层与包的划分

最常见的"按技术分层"：

```
com.canoe.app
├── controller   // 接收请求、参数校验
├── service      // 业务逻辑
├── mapper       // 数据访问（DAO）
├── entity       // 实体 / 领域对象
├── config       // 配置类
└── util         // 工具方法
```

另一种思路是**按业务分包**（`com.canoe.app.order`、`com.canoe.app.user`），每个包内部再含自己的 service/mapper。取舍：

- 小项目、团队按层分工 → 按技术分层，结构一目了然；
- 大项目、按业务线划分团队 → 按业务分包，减少跨包改动、便于微服务拆分。

## 本篇小结

- **包解决类名冲突**，并用目录结构把类组织起来。
- `package` 必须是文件**第一行有效代码**，且包名要与目录一致。
- 包名用**域名倒写**，且不能用 Java 关键字当包名段。
- `import` 只是省去全限定名，**不递归导入子包**。
- 同名类冲突时，只能**一方写全限定名**。
- `java.lang` 包被编译器**自动导入**。
- **jar 是 class 的 zip 包**，`MANIFEST.MF` 记录元信息与入口。
- **classpath** 是 JVM 查找类的路径，缺依赖会 `ClassNotFoundException`。
- JDK 9+ 的**模块系统**用 `module-info.java` 显式管理依赖。
- 项目分包可**按技术分层**或**按业务划分**，按规模和团队选择。

## 参考链接

- [Oracle 教程：创建与使用包](https://docs.oracle.com/javase/tutorial/java/package/packages.html)
- [Oracle 教程：管理源文件与 CLASSPATH](https://docs.oracle.com/javase/tutorial/java/package/managingfiles.html)
- [Java 语言规范：包](https://docs.oracle.com/javase/specs/jls/se17/html/jls-7.html)
- [jar 工具官方文档](https://docs.oracle.com/en/java/javase/17/docs/specs/man/jar.html)
- [Java 模块系统（Project Jigsaw）](https://openjdk.org/projects/jigsaw/)
- [Maven 中央仓库与依赖管理](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html)
- [Baeldung：Java 包与可见性](https://www.baeldung.com/java-packages)

下一篇 → [11 访问作用域](/java/oop/scope)
