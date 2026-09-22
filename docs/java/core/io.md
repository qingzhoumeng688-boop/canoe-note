# 04 IO 流

Java 的 IO 体系看着类名一大堆，其实规律极清晰：凡 `XxxStream` 是字节流，凡 `XxxReader`/`XxxWriter` 是字符流。本篇先理清分类，再逐个讲 `File`/`Path`、字节流、字符流、缓冲流、对象序列化、转换流与打印流，然后快速过一遍 NIO 的三大组件，最后给出 commons-io/hutool 等「别造轮子」的实战建议和最佳实践。配套代码全部可运行。

## 一、IO 流的分类

从三个维度理解流：

```text
维度            分类                     代表
按方向          输入流（读）              InputStream / Reader
              输出流（写）              OutputStream / Writer
按单位          字节流（8 位，图/视频/一切） FileInputStream / FileOutputStream
              字符流（16 位，纯文本）     FileReader / FileWriter
按角色          节点流（直接接数据源）     FileInputStream
              处理流（包在节点流外增强）  BufferedInputStream
```

命名规律速记：

- 字节流：`InputStream`/`OutputStream` 结尾（如 `FileInputStream`）。
- 字符流：`Reader`/`Writer` 结尾（如 `FileReader`）。
- 带 `Buffered` 的是缓冲处理流，`Object` 的是对象序列化，`Print` 的是打印流。

## 二、File 类与 Path

`java.io.File` 用来描述**文件路径**（不是文件内容），做判断、创建、删除：

```java
package com.canoe.core.io;

import java.io.File;

public class FileDemo {
    public static void main(String[] args) {
        // 路径分隔符用 File.separator，跨平台安全（Windows \，Linux /）
        File dir = new File("logs" + File.separator + "app");
        if (!dir.exists()) {
            dir.mkdirs(); // mkdirs 会创建多级目录，mkdir 只建一级
        }

        File file = new File(dir, "note.txt");
        System.out.println("是否存在: " + file.exists());
        System.out.println("是否文件: " + file.isFile());
        System.out.println("绝对路径: " + file.getAbsolutePath());

        // 删除
        // file.delete();      // 删文件
        // dir.delete();       // 删空目录
    }
}
```

JDK 7 引入的 `java.nio.file.Path` + `Files` 工具类更现代、方法更全：

```java
package com.canoe.core.io;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.stream.Stream;

public class PathDemo {
    public static void main(String[] args) throws IOException {
        Path path = Paths.get("logs", "app", "note.txt");

        if (!Files.exists(path)) {
            Files.createDirectories(path.getParent()); // 建父目录
            Files.createFile(path);
        }

        Files.writeString(path, " canoe notes\n");         // 写字符串
        String content = Files.readString(path);          // 读字符串
        System.out.println(content);

        // 列出目录下所有文件
        try (Stream<Path> stream = Files.list(path.getParent())) {
            stream.forEach(System.out::println);
        }

        // 按行读
        List<String> lines = Files.readAllLines(path);
        System.out.println(lines);
    }
}
```

新项目**优先用 `Path`/`Files`**，API 更一致、异常信息更清晰。

## 三、字节流

`FileInputStream`/`FileOutputStream` 读写原始字节，适合图片、视频、压缩包等一切二进制。

```java
package com.canoe.core.io;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

public class ByteStreamDemo {
    public static void main(String[] args) throws IOException {
        // 必须用 try-with-resources，离开作用域自动关闭流
        try (FileInputStream in = new FileInputStream("src.txt");
             FileOutputStream out = new FileOutputStream("dst.txt")) {

            // 方式一：单字节读（慢，不推荐大文件）
            // int b;
            // while ((b = in.read()) != -1) { out.write(b); }

            // 方式二：字节数组缓冲读（推荐）
            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) != -1) {
                out.write(buffer, 0, len); // 只写有效长度
            }
        }
        System.out.println("拷贝完成");
    }
}
```

**`available()` 的坑**：它返回「当前可读取的估计字节数」，对网络流/管道往往不等于总大小，**别用它来 new 一个正好大小的数组**当总字节数，老老实实用循环读。

**务必使用 try-with-resources**（JDK 7+）：`try(资源){}` 会在 `finally` 自动调用 `close()`，比手写 `finally` 关流优雅且不会漏。

## 四、字符流

字符流按「字符」读写，自动处理编码，适合纯文本。为什么需要它？因为字节流读中文会按字节切，容易把半个汉字读出来导致乱码。

```java
package com.canoe.core.io;

import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

public class CharStreamDemo {
    public static void main(String[] args) throws IOException {
        // FileReader 默认用平台编码，跨平台有风险
        try (FileReader reader = new FileReader("src.txt");
             FileWriter writer = new FileWriter("dst.txt")) {
            char[] buffer = new char[1024];
            int len;
            while ((len = reader.read(buffer)) != -1) {
                writer.write(buffer, 0, len);
            }
        }
    }
}
```

**转换流 `InputStreamReader`/`OutputStreamWriter` 是桥梁**：把字节流按指定字符集转成字符流。关键点是**显式指定 `Charset`**，避免依赖平台默认编码：

```java
package com.canoe.core.io;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class BridgeDemo {
    public static void main(String[] args) throws IOException {
        // 字节流 -> 字符流，明确指定 UTF-8
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(
                        new FileInputStream("note.txt"), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                System.out.println(line);
            }
        }
    }
}
```

## 五、缓冲流

缓冲流（`BufferedInputStream`/`BufferedReader` 等）在内存里加一层缓冲区，减少物理 IO 次数，**性能飞跃**。

```java
package com.canoe.core.io;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

public class BufferDemo {
    public static void main(String[] args) throws IOException {
        try (BufferedReader br = new BufferedReader(new FileReader("src.txt"));
             BufferedWriter bw = new BufferedWriter(new FileWriter("dst.txt"))) {

            String line;
            while ((line = br.readLine()) != null) { // readLine 读一行，不含换行符
                bw.write(line);
                bw.newLine();   // 显式换行（跨平台正确）
                // bw.flush();  // 必要时手动刷盘，close 时也会自动 flush
            }
        }
        System.out.println("带缓冲的拷贝完成");
    }
}
```

性能对比（思路）：同样拷贝 100MB 文件，未缓冲的 `read()` 单字节要调用约 1 亿次系统调用，缓冲后每 8KB 才调用一次，差距可达几十倍。**结论：几乎所有 IO 都包一层 `Buffered`**。

## 六、对象序列化

把 Java 对象转成字节流叫**序列化**，反之叫**反序列化**。对象要实现 `Serializable` 接口（只是个标记接口，无方法）。

```java
package com.canoe.core.io;

import java.io.Serializable;

// 必须实现 Serializable 才能序列化
class User implements Serializable {
    private static final long serialVersionUID = 1L; // 版本号，强烈建议写
    private String name;
    private transient int tempToken; // transient：不序列化这个字段

    User(String name, int tempToken) {
        this.name = name;
        this.tempToken = tempToken;
    }

    @Override
    public String toString() {
        return "User{name='" + name + "', tempToken=" + tempToken + "}";
    }
}
```

序列化/反序列化代码：

```java
package com.canoe.core.io;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;

public class SerializeDemo {
    public static void main(String[] args) throws IOException, ClassNotFoundException {
        User user = new User(" canoe ", 123);

        // 序列化
        try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream("user.dat"))) {
            oos.writeObject(user);
        }

        // 反序列化
        try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream("user.dat"))) {
            User back = (User) ois.readObject();
            System.out.println(back);
        }
    }
}
```

两个要点：

- **`serialVersionUID` 的作用**：反序列化时会校验字节流里的版本号与当前类是否一致，不一致抛 `InvalidClassException`。**不写会被编译器自动生成**，一旦类结构变了（加字段），自动生成的 UID 也变，旧数据就读不出来了。所以**务必手写固定 UID**。
- **`transient`**：标记不想序列化的字段（如密码、临时令牌），反序列化后该字段是默认值（`0`/`null`）。

## 七、转换流与打印流

- **打印流 `PrintStream`/`PrintWriter`**：提供 `print/println`，永不抛 `IOException`，自动刷新。`System.out` 就是 `PrintStream`。
- 它们支持自动刷新和指定编码，写日志、写输出很方便。

```java
package com.canoe.core.io;

import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

public class PrintDemo {
    public static void main(String[] args) throws IOException {
        // 自动刷新（autoFlush）+ 指定编码的打印流
        try (PrintWriter pw = new PrintWriter(
                new FileWriter("log.txt"), true)) {
            pw.println("start");
            pw.printf("用户 %s 登录，积分 %d%n", "canoe", 100);
            pw.flush();
        }

        // System.out 本质就是 PrintStream
        System.out.println("这是 PrintStream 输出");
    }
}
```

## 八、NIO 简介

JDK 4/7 引入的 NIO（New IO）面向**块**而非流、支持**非阻塞**，三大组件：

```text
Channel（通道）   类似流，但能读能写、双向，如 FileChannel/SocketChannel
Buffer（缓冲区）   数据的中转容器，所有读写都经过 Buffer
Selector（选择器）一个线程监听多个 Channel，实现多路复用（高并发网络）
```

与 BIO 对比：

```text
BIO（传统 IO）          NIO
面向流（Stream）        面向块（Buffer）
阻塞（一连接一线程）     非阻塞 + Selector 多路复用
简单直观，适合低频 IO    适合高并发、海量连接（如 Netty 底层）
```

日常文件操作，NIO 的 `Files` 工具类已经足够：`Files.readAllLines`、`Files.copy`、`Files.writeString`，还有高性能的**内存映射文件**（`FileChannel.map`）适合超大文件。

```java
package com.canoe.core.io;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class NioDemo {
    public static void main(String[] args) throws IOException {
        Path src = Paths.get("src.txt");
        Path dst = Paths.get("dst.txt");
        Files.copy(src, dst);                 // 一行完成拷贝
        System.out.println(Files.size(dst));  // 文件大小
    }
}
```

一句话引出 **Netty**：它正是基于 NIO 的 `Selector` 多路复用，把高并发网络编程封装得又好用又高性能。

## 九、commons-io 与 hutool

生产项目**别自己造文件读写轮子**，直接用成熟工具库。

Maven 坐标：

```xml
<!-- Apache Commons IO -->
<dependency>
    <groupId>commons-io</groupId>
    <artifactId>commons-io</artifactId>
    <version>2.16.1</version>
</dependency>

<!-- Hutool 国产工具集 -->
<dependency>
    <groupId>cn.hutool</groupId>
    <artifactId>hutool-all</artifactId>
    <version>5.8.27</version>
</dependency>
```

常用方法：

```java
package com.canoe.core.io;

import org.apache.commons.io.FileUtils;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.List;

public class CommonsIoDemo {
    public static void main(String[] args) throws Exception {
        // Commons IO：一行读全文件、写文件、复制目录
        String text = FileUtils.readFileToString(new File("note.txt"), StandardCharsets.UTF_8);
        FileUtils.writeStringToFile(new File("out.txt"), text, StandardCharsets.UTF_8);
        List<String> lines = FileUtils.readLines(new File("note.txt"), StandardCharsets.UTF_8);
        System.out.println(lines);
    }
}
```

```java
package com.canoe.core.io;

import cn.hutool.core.io.FileUtil;

public class HutoolDemo {
    public static void main(String[] args) {
        // Hutool：极简 API
        String text = FileUtil.readUtf8String("note.txt");
        FileUtil.writeUtf8String("out.txt", text);
        long size = FileUtil.size(new File("note.txt"));
        System.out.println("文件字节数: " + size);
    }
}
```

## 十、IO 最佳实践

- **资源一定要关**：优先 `try-with-resources`，绝不留 `finally` 里手动关的隐患。
- **显式指定字符集**：所有读写字串的地方写明 `StandardCharsets.UTF_8`，别信任平台默认。
- **大文件用缓冲流**：`BufferedInputStream`/`BufferedReader` 必包一层。
- **别用 `readAllLines` 读超大文件**：会把全部内容加载进内存 OOM；应流式逐行读。
- **及时清理临时文件**：`Files.createTempFile` 生成的文件用完记得 `delete` 或 `deleteOnExit`。
- **大文件拷贝优先 NIO**：`Files.copy` 或内存映射，比手写循环高效。
- **序列化对象务必写 `serialVersionUID`**，并慎用 `transient` 保护敏感字段。

## 本篇小结

- **流按单位分字节流（`XxxStream`）和字符流（`XxxReader/Writer`）**，按角色分节点流与处理流。
- **字节流读法宝是 8KB 缓冲数组**，别用单字节 `read()` 拷大文件。
- **必须 try-with-resources 自动关流**，否则资源泄露。
- **字符流处理文本、自动编码**；跨平台务必用转换流显式指定 `Charset`。
- **缓冲流大幅减少物理 IO**，几乎所有读写都该包一层 `Buffered`。
- **`readLine()` 不含换行符**，写回时记得 `newLine()`。
- **对象序列化要实现 `Serializable`**，否则抛 `NotSerializableException`。
- **务必手写 `serialVersionUID`**，类结构变化也不丢旧数据。
- **`transient` 字段不参与序列化**，适合密码等敏感信息。
- **`System.out` 是 `PrintStream`**，打印流会吞掉 `IOException`。
- **NIO 面向块、非阻塞、Selector 多路复用**，是 Netty 的基石。
- **生产用 commons-io / Hutool**，别重复造文件读写轮子。

## 参考链接

- [Java 官方文档：Java IO 概览](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/io/package-summary.html)
- [Java 官方文档：Files (NIO)](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/nio/file/Files.html)
- [Oracle 教程：I/O Streams](https://docs.oracle.com/javase/tutorial/essential/io/)
- [Oracle 教程：NIO.2 (Path/Files)](https://docs.oracle.com/javase/tutorial/essential/io/fileio.html)
- [Apache Commons IO](https://commons.apache.org/proper/commons-io/)
- [Hutool 官方文档](https://doc.hutool.cn/)
- [Baeldung：Java IO](https://www.baeldung.com/java-io)

下一篇 → [05 日期时间 API](/java/core/datetime)
