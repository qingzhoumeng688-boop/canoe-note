# 01 String 字符串

字符串大概是 Java 里我们用得最频繁、却最容易掉坑的类型。`String` 看起来平平无奇，背后却藏着常量池、不可变性、编码、拼接优化一整套设计哲学。本篇从「为什么 String 不可变」这个核心讲起，把创建方式、常量池、常用 API、`==` 与 `equals` 的辨析、以及 `StringBuilder` 的性能玄学一次讲透，配可运行代码和经典面试题，争取让你以后再也不踩坑。

## 一、String 的不可变性

一句话概括：**`String` 一旦创建，内容就不能改**。这不是因为我们用得规矩，而是 Java 从语言层面把它焊死了。

看 JDK 源码（以 JDK 8 为例）：

```java
public final class String
    implements java.io.Serializable, Comparable<String>, CharSequence {
    // JDK 8 及以前是 char[]，JDK 9 起改为 byte[] 以节省内存
    private final char value[];
    private int hash; // 缓存哈希值
}
```

注意两个关键词：`final class`（不能被继承）和 `private final char value[]`（保存字符的数组是 final 且私有的，外面改不了）。`String` 提供的所有「修改」方法（`substring`、`replace`、`toUpperCase` 等）**都不会改动原对象**，而是返回一个新 `String`。

为什么这么设计？三个理由足够硬：

- **安全**：类加载器用字符串当类名、网络请求用字符串当 host，如果字符串能被篡改，整个系统都不安全。
- **哈希可缓存**：`HashMap` 的 key 经常是 `String`。因为不可变，`hash` 算一次就缓存住了，后面直接用，性能杠杠的。
- **线程安全**：不可变对象天然线程安全，多个线程读同一份不用加锁。

一句话总结：`String` 的不可变不是偷懒，而是安全、性能、并发三者权衡后的最佳选择。

## 二、创建方式的区别

这是面试必考题：`String s = "abc"` 和 `String s = new String("abc")` 到底创建了几个对象？

先看第一种——**字面量方式**：

```java
String s1 = "abc";
```

JVM 会去**字符串常量池**里找有没有 `"abc"`。没有就创建一个放进去，然后 `s1` 指向它；已经有了就直接复用。所以这一句，**最多创建 1 个对象**。

第二种——**new 方式**：

```java
String s2 = new String("abc");
```

这里分两步：常量池里没有 `"abc"` 的话先建一个（1 个），`new` 又会在**堆**上创建一个 `String` 对象（第 2 个），`s2` 指向堆上的这个。所以是 **1 到 2 个对象**。

内存示意（用 `s2 = new String("abc")` 且常量池原本为空）：

```text
  栈          堆                         字符串常量池
s1 ────────────────────────────────▶ "abc"   ← 字面量创建，直接指向常量池
s2 ──▶ String 对象 ──value──▶ 字符数据
        （堆上）            （实际字符在常量池或堆，分版本）
```

`intern()` 方法负责「手动入池」：如果常量池里已有相等字符串就返回那个引用，没有就把当前字符串加入池再返回。JDK 7 起常量池搬到了**堆**，所以 `intern()` 返回的引用可能和堆上对象相同。

```java
String a = new String("abc");
String b = a.intern();      // 去常量池找 "abc"
System.out.println(a == b); // false：a 是堆对象，b 是常量池对象
System.out.println("abc" == b); // true：常量池本来就复用 "abc"
```

## 三、字符串常量池

常量池的位置历史上有变化，记住三句话：

- **JDK 6 及以前**：常量池在**永久代（PermGen）**，容易 OOM。
- **JDK 7**：搬到**堆**里，可以用 `-Xmx` 控制大小，不再受永久代限制。
- **JDK 8**：永久代被元空间取代，常量池继续待在堆里。

还有两个编译期优化要懂：

**常量折叠**：两个编译期确定的字面量拼接，编译器直接算好。

```java
String x = "a" + "b";   // 编译后等价于 String x = "ab"; 只产生一个对象
```

**变量拼接走 `StringBuilder`**：只要拼接项里有变量，编译器就会悄悄 `new StringBuilder().append().append().toString()`。

```java
String name = "canoe";
String greet = "hi " + name;  // 约等于 new StringBuilder().append("hi ").append(name).toString()
```

这正解释了为什么循环里用 `+` 拼接会又慢又耗内存——每次循环都 new 一个 `StringBuilder`。

## 四、常用 API

挑高频的逐个给例子，建议直接复制到本地跑一遍：

```java
package com.canoe.core.string;

import java.util.Locale;

public class StringApiDemo {
    public static void main(String[] args) {
        String s = "  Canoe Notes 2026  ";

        System.out.println(s.length());          // 19：字符个数（含空格）
        System.out.println(s.charAt(2));         // 'n'：按下标取字符
        System.out.println(s.substring(2, 7));   // "noe N"：左闭右开区间
        System.out.println(s.indexOf("No"));     // 5：首次出现下标，-1 表示没有
        System.out.println(s.lastIndexOf("2"));  // 15：最后一次出现下标
        System.out.println(s.equals("canoe"));   // false：区分大小写
        System.out.println(s.equalsIgnoreCase("  canoe notes 2026  ")); // true
        System.out.println(s.startsWith("  Ca"));// true
        System.out.println(s.endsWith("26  "));  // true
        System.out.println(s.contains("Note"));  // true
        System.out.println(s.replace("2026", "2027")); // "  Canoe Notes 2027  "
        System.out.println(s.trim());            // 去首尾空格（JDK 11 前）
        System.out.println(s.strip());           // JDK 11+：去首尾 Unicode 空白更彻底
        System.out.println(s.toUpperCase(Locale.ROOT)); // 全大写
        System.out.println(String.join("-", "a", "b", "c")); // "a-b-c"
        System.out.println("-".repeat(5));       // "-----"：JDK 11+ 重复
    }
}
```

注意 `split` 的坑：**点号 `.` 要转义**，因为它按正则拆：

```java
"a.b.c".split("\\.");   // 正确：得到 ["a","b","c"]
"a.b.c".split(".");     // 错误：点号是正则通配符，什么都匹配不到
```

`format` 就是字符串版的 `printf`，适合拼 SQL、日志模板：

```java
String sql = String.format("select * from user where id = %d and name = '%s'", 1, "canoe");
```

## 五、equals 与 ==

这是最容易被混淆的一对：

- `==` 比的是**内存地址**（是不是同一个对象）。
- `equals` 比的是**内容**（字符序列是否相等）。

`String` 重写了 `equals`，所以用它才是比内容。来几道预测题练手（先别看答案）：

```java
String a = "abc";
String b = "abc";
System.out.println(a == b);              // ① true：常量池复用同一对象

String c = new String("abc");
System.out.println(a == c);              // ② false：c 是堆上新建对象
System.out.println(a.equals(c));         // ③ true：内容相同

String d = "a" + "b" + "c";
System.out.println(a == d);              // ④ true：常量折叠，d 就是 "abc"

String e = "ab";
String f = e + "c";
System.out.println(a == f);              // ⑤ false：变量拼接走 StringBuilder，是新对象

String g = new String("abc").intern();
System.out.println(a == g);              // ⑥ true：intern 后指向常量池
```

记住铁律：**比字符串内容永远用 `equals`**，别用 `==`。

## 六、StringBuilder 与 StringBuffer

`String` 不可变，意味着频繁拼接会疯狂产生中间对象。于是有了**可变字符序列**：

- `StringBuilder`：JDK 5 引入，**非线程安全**，但快。
- `StringBuffer`：老前辈，**方法加了 `synchronized`，线程安全**，但慢一点。

日常 99% 场景用 `StringBuilder` 就够了（方法内部局部变量不存在并发问题）。链式调用很好用：

```java
StringBuilder sb = new StringBuilder();
sb.append("订单号:").append(1001).append(", 状态:").append("已支付");
System.out.println(sb);   // 订单号:1001, 状态:已支付
```

**循环拼接必须用 `StringBuilder`**，这是性能分水岭：

```java
// 错误示范：每次 + 都 new StringBuilder，O(n) 变 O(n²) 的对象
String bad = "";
for (int i = 0; i < 10000; i++) {
    bad += i;
}

// 正确示范
StringBuilder good = new StringBuilder();
for (int i = 0; i < 10000; i++) {
    good.append(i);
}
```

`StringBuilder` 默认容量 16，不够了会**扩容为约 2 倍**。如果要拼很多内容，提前 `new StringBuilder(1024)` 指定容量，能少几次拷贝。

## 七、String 的编码

字符串在内存里是 `char`（UTF-16），但落盘、传网络时是字节，需要编码。最常见的坑就是**编解码用了不同字符集**，于是出现「锘夸唔」之类的乱码。

```java
String text = " canoe笔记 "; // 含中文

// 编码：字符串 -> 字节（指定 UTF-8）
byte[] utf8 = text.getBytes(java.nio.charset.StandardCharsets.UTF_8);

// 解码：字节 -> 字符串（必须和编码时一致）
String back = new String(utf8, java.nio.charset.StandardCharsets.UTF_8);
System.out.println(back); // 正常

// 乱码根源：用 GBK 去解 UTF-8 的字节
String mess = new String(utf8, java.nio.charset.StandardCharsets.ISO_8859_1);
System.out.println(mess); // 乱码
```

**最佳实践**：永远显式指定 `StandardCharsets.UTF_8`，别依赖平台默认编码。

```java
// 推荐写法
byte[] bytes = text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
```

## 八、StringJoiner 与 String.join

JDK 8 提供了专门的拼接工具，省得手写分隔符和前后缀：

```java
package com.canoe.core.string;

import java.util.StringJoiner;
import java.util.Arrays;
import java.util.List;

public class JoinerDemo {
    public static void main(String[] args) {
        // StringJoiner：可加前后缀
        StringJoiner sj = new StringJoiner(", ", "[", "]");
        sj.add("苹果").add("香蕉").add("橙子");
        System.out.println(sj); // [苹果, 香蕉, 橙子]

        // String.join：简单拼接
        List<String> list = Arrays.asList("Java", "Go", "Rust");
        System.out.println(String.join(" | ", list)); // Java | Go | Rust
    }
}
```

对比手写 `StringBuilder` 拼分隔符（要判空、要处理最后一个不要分隔符），`StringJoiner` 清爽太多，拼 SQL `in (...)` 或 CSV 时特别香。

## 九、面试高频

收集 8 道经典题，先想答案再看解析：

1. **`String s = new String("abc")` 创建了几个对象？**
   1 到 2 个：常量池没有就创建 1 个，堆上 `new` 再 1 个。
2. **`==` 和 `equals` 区别？**
   `==` 比地址，`equals` 比内容，比字符串一律用 `equals`。
3. **`intern()` 有什么用？**
   把字符串放入常量池并返回池中引用；JDK 7 起常量池在堆。
4. **为什么 String 不可变？**
   安全（类名/host）、可缓存 hash、天然线程安全。
5. **`StringBuilder` 线程安全吗？**
   不安全；`StringBuffer` 安全但慢。高并发拼接才考虑 `StringBuffer`。
6. **`String s = null; s += "x"` 结果？**
   不报 NPE，结果是 `"nullx"`——`null` 被当成字符串 `"null"` 拼接（陷阱，注意）。
7. **为什么循环里不要用 `+` 拼接？**
   每次都隐式 new `StringBuilder`，产生大量中间对象，复杂度退化。
8. **JDK 9 的 String 有什么变化？**
   底层 `char[]` 改为 `byte[]` + 编码标识，纯 Latin-1 字符串省一半内存。

## 本篇小结

- **`String` 不可变**是由 `final class` + `private final char[]` 双重保证的。
- **不可变的三大理由**：安全性、哈希可缓存、天然线程安全。
- **字面量复用常量池**，`new` 一定在堆上另建对象（1~2 个）。
- **字符串常量池**在 JDK 7 从永久代搬到了堆。
- **常量折叠**让 `"a"+"b"` 编译期直接变 `"ab"`，变量拼接走 `StringBuilder`。
- **比内容永远用 `equals`**，别用 `==` 比地址。
- **循环拼接必须用 `StringBuilder`**，否则对象暴涨、性能退化。
- **`StringBuilder` 快但不安全**，`StringBuffer` 安全但慢，日常用前者。
- **编码解码必须同一字符集**（推荐 `StandardCharsets.UTF_8`），否则乱码。
- **`StringJoiner`** 适合带分隔符/前后缀的拼接，比手写 `StringBuilder` 干净。
- **`split` 按正则**，点号要写成 `\\.`。
- **`intern()`** 可手动入池，JDK 7 后常量池在堆中。

## 参考链接

- [Java 官方文档：String](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/String.html)
- [Java 8 String 源码（GitHub OpenJDK）](https://github.com/openjdk/jdk8u/blob/master/jdk/src/share/classes/java/lang/String.java)
- [Java 11 String 源码（byte[] 实现）](https://github.com/openjdk/jdk11u/blob/master/src/java.base/share/classes/java/lang/String.java)
- [Oracle 教程：Strings](https://docs.oracle.com/javase/tutorial/java/data/strings.html)
- [Baeldung：Java String](https://www.baeldung.com/java-string)
- [Java 字符集 Charset 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/nio/charset/Charset.html)

下一篇 → [02 包装类](/java/core/wrapper)
