# 02 包装类

基本类型（`int`、`double`…）用起来快、占内存少，但它们不是对象——放不进集合、没有方法可调用、也无法表达「空」。于是 Java 给每个基本类型配了一个「孪生兄弟」包装类。`Integer`、`Long`、`BigDecimal` 这些名字你天天见，但 `-128~127` 的缓存、`null` 拆箱 NPE、`BigDecimal` 的精度坑，每一个都是生产事故的高发地。本篇把装箱拆箱、缓存机制、比较陷阱、空安全、`BigDecimal` 高精度计算一次讲清。

## 一、为什么需要包装类

回想泛型那篇：集合的泛型参数**只能是引用类型**，你不能写 `List<int>`。还有数据库查出来的字段可能是 `NULL`，基本类型 `int` 表达不了「没有值」。包装类就是来解决这些问题的。

八种基本类型与包装类一一对应：

```text
基本类型    包装类        位数
boolean  -> Boolean     (1)
byte     -> Byte        (8)
char     -> Character   (16)
short    -> Short       (16)
int      -> Integer     (32)
long     -> Long        (64)
float    -> Float       (32)
double   -> Double      (64)
```

规律：`char` 和 `int` 的包装类名字特殊（Character、Integer），其余都是首字母大写。

包装类带来的能力：

- 能放进 `List<Integer>`、`Map<String, Double>` 这类集合。
- 提供了 `parseInt`、`valueOf` 等实用的类型转换方法。
- 支持 `null` 语义，对应数据库/JSON 里的空值。

## 二、装箱与拆箱

- **装箱**：基本类型 → 包装类，例如 `Integer.valueOf(10)`。
- **拆箱**：包装类 → 基本类型，例如 `integer.intValue()`。

JDK 5 之后有了**自动装箱/拆箱**，编译器帮你加好转换代码：

```java
Integer a = 10;        // 自动装箱：实际调用 Integer.valueOf(10)
int b = a;             // 自动拆箱：实际调用 a.intValue()

// 集合里也在默默装箱
List<Integer> list = new ArrayList<>();
list.add(100);         // 100 被自动装箱成 Integer
int x = list.get(0);   // 取出时自动拆箱成 int
```

自动装箱/拆箱发生在：**赋值、算术运算、方法参数传递、集合存取**时。理解这一点，才能看懂后面那些「隐形的 `valueOf` 调用」。

## 三、Integer 缓存（经典坑）

这是包装类最经典的面试题。看代码猜输出：

```java
package com.canoe.core.wrapper;

public class IntegerCacheDemo {
    public static void main(String[] args) {
        Integer a = 127;
        Integer b = 127;
        System.out.println(a == b);   // true

        Integer c = 128;
        Integer d = 128;
        System.out.println(c == d);   // false  ？？？

        Integer e = new Integer(127); // 已过时但能说明问题
        Integer f = 127;
        System.out.println(e == f);   // false
    }
}
```

为什么 127 相等、128 不相等？秘密在 `Integer.valueOf` 的源码里：

```java
public static Integer valueOf(int i) {
    // 落到 [-128, 127] 区间就返回缓存数组里的同一个对象
    if (i >= IntegerCache.low && i <= IntegerCache.high)
        return IntegerCache.cache[i + (-IntegerCache.low)];
    return new Integer(i); // 超出范围才 new
}
```

默认缓存范围是 **`-128 ~ 127`**。所以 127 命中缓存、两个变量指向同一对象，`==` 为 true；128 没缓存、各 new 各的，地址不同，`==` 为 false。

注意点：

- 缓存**上限 127 可调**，通过 JVM 参数 `-XX:AutoBoxCacheMax=200`。
- `new Integer(...)` 永远走构造函数，**绕过缓存**，所以和 `valueOf` 结果 `==` 一定 false。
- 结论再次强调：比包装类的值用 `equals`，别用 `==`。

## 四、其他包装类的缓存

不只是 `Integer`，其他几个也有缓存，记住这张表：

```text
包装类       缓存范围
Byte        全部（-128~127）
Short       -128 ~ 127
Integer     -128 ~ 127（上限可调）
Long        -128 ~ 127
Character    0 ~ 127
Boolean      TRUE / FALSE 两个常量
Float       无缓存
Double      无缓存
```

为什么浮点型没缓存？因为浮点数在 `-128~127` 之间的取值是无限的，没法用固定数组缓存，所以 `Float`/`Double` 的 `valueOf` 每次都 new。

## 五、包装类的比较

铁律：**包装类一律用 `equals` 或 `compareTo` 比较，绝不用 `==`**。

```java
package com.canoe.core.wrapper;

public class CompareDemo {
    public static void main(String[] args) {
        Integer x = 200;
        Integer y = 200;

        // 错误：比的是地址，200 超出缓存，结果 false
        System.out.println(x == y);        // false
        // 正确：比的是值
        System.out.println(x.equals(y));   // true
        // 正确：compareTo 返回 -1/0/1
        System.out.println(x.compareTo(y)); // 0

        // 包装类与基本类型混比时，包装类会先拆箱，比的是值
        int z = 200;
        System.out.println(x == z);        // true（x 自动拆箱成 int 再比）
    }
}
```

最后一行是个例外：`==` 一边是基本类型时会触发**拆箱**，于是变成值比较。但这恰恰是最容易让人误判的地方，所以统一用 `equals` 最稳妥。

## 六、包装类与 null

拆箱遇到 `null` 会直接抛 `NullPointerException`，这是生产环境最常见的「空指针事故」之一：

```java
Integer score = null;
int s = score;   // NullPointerException！score.intValue() 时炸了
```

典型场景：数据库字段允许 `NULL`，查出来映射到 `Integer`，结果没判空直接放进 `int`，一跑就崩。防护写法：

```java
// 写法一：判空给默认值
int s = (score != null) ? score : 0;

// 写法二：Optional 兜底（JDK 8+）
int s = java.util.Optional.ofNullable(score).orElse(0);

// 写法三：数据库/JSON 设计上明确非空时用基本类型 int
```

经验法则：**对外接口、数据库映射、JSON 反序列化**的字段，凡是可能为空的就用包装类；确定有值的内部计算用基本类型，并且拆箱前务必判空。

## 七、类型转换

三个常用方法容易搞混：

- `Integer.parseInt("123")`：字符串 → 基本类型 `int`。
- `Integer.valueOf("123")`：字符串 → 包装类 `Integer`（内部还是调 `parseInt`）。
- `String.valueOf(123)` / `Integer.toString(123)`：数字 → 字符串。

```java
package com.canoe.core.wrapper;

public class ParseDemo {
    public static void main(String[] args) {
        int a = Integer.parseInt("123");               // 123
        Integer b = Integer.valueOf("456");             // 456
        String c = String.valueOf(789);                // "789"

        // 解析失败会抛 NumberFormatException，必须处理
        try {
            int bad = Integer.parseInt("abc");
        } catch (NumberFormatException ex) {
            System.out.println("不是合法数字: " + ex.getMessage());
        }

        // 指定进制
        int hex = Integer.parseInt("1a", 16);          // 26（十六进制）
    }
}
```

`parseInt` 遇到非数字字符直接抛 `NumberFormatException`，调用前最好判空、捕获异常，或者先用正则校验。

## 八、BigInteger 与 BigDecimal

当 `long` 装不下（`±9.2×10¹⁸` 之外）或需要精确小数（钱）时，就要它们出场。

- **`BigInteger`**：任意精度整数，可替代「位数超长」的场景。
- **`BigDecimal`**：任意精度小数，**金融计算的唯一正确答案**。

`BigDecimal` 的**头号坑：构造必须用 `String`**，用 `double` 构造会有精度问题：

```java
package com.canoe.core.wrapper;

import java.math.BigDecimal;
import java.math.RoundingMode;

public class BigDecimalDemo {
    public static void main(String[] args) {
        // 错误：0.1 在二进制里无法精确表示，结果 ≈ 0.10000000000000000555
        BigDecimal wrong = new BigDecimal(0.1);
        System.out.println(wrong);

        // 正确：用字符串构造，得到精确的 0.1
        BigDecimal right = new BigDecimal("0.1");
        System.out.println(right);

        // 运算：加、减、乘、除
        BigDecimal a = new BigDecimal("1.0");
        BigDecimal b = new BigDecimal("0.33");
        System.out.println(a.add(b));             // 1.33
        System.out.println(a.subtract(b));        // 0.67
        System.out.println(a.multiply(b));        // 0.330

        // 除法必须指定舍入模式，否则除不尽抛 ArithmeticException
        System.out.println(a.divide(b, 2, RoundingMode.HALF_UP)); // 3.03

        // 比较：equals 会看标度（1.0 不等于 1.00），比数值请用 compareTo
        BigDecimal oneA = new BigDecimal("1.0");
        BigDecimal oneB = new BigDecimal("1.00");
        System.out.println(oneA.equals(oneB));            // false（标度不同）
        System.out.println(oneA.compareTo(oneB) == 0);    // true（数值相等）
    }
}
```

要点：

- **钱一律用 `BigDecimal(String)`**，别用 `double`/`float`。
- **除法 `divide` 必须指定 `RoundingMode`**，否则除不尽直接抛异常。
- **比数值用 `compareTo`**，别用 `equals`（`equals` 还比标度）。
- 设定小数位数用 `setScale(2, RoundingMode.HALF_UP)`。

## 本篇小结

- **包装类是基本类型的对象版**，用于集合、泛型、表达 `null`。
- 八种基本类型与包装类对应，`char`/`int` 的名字特殊（Character/Integer）。
- **自动装箱/拆箱**由编译器插入 `valueOf`/`intValue`，发生在赋值、运算、集合、参数传递时。
- **`Integer` 缓存 `-128~127`**，范围内 `==` 为 true，超出为 false。
- **缓存上限可调**（`-XX:AutoBoxCacheMax`），`Byte/Short/Long/Character/Boolean` 也有缓存。
- **`Float`/`Double` 没有缓存**，每次 `valueOf` 都 new。
- **包装类比较一律用 `equals`/`compareTo`，绝不用 `==`**。
- **拆箱遇到 `null` 抛 NPE**，数据库/JSON 映射字段务必判空。
- **`parseInt` 解析失败抛 `NumberFormatException`**，需捕获或校验。
- **`BigDecimal` 必须用 `String` 构造**，否则精度失真。
- **除法要指定 `RoundingMode`**，比数值用 `compareTo` 而非 `equals`。

## 参考链接

- [Java 官方文档：Integer](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Integer.html)
- [Java 官方文档：BigDecimal](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/math/BigDecimal.html)
- [OpenJDK Integer 源码（含 IntegerCache）](https://github.com/openjdk/jdk17u/blob/master/src/java.base/share/classes/java/lang/Integer.java)
- [Oracle 教程：Numbers](https://docs.oracle.com/javase/tutorial/java/data/numbers.html)
- [Baeldung：Java BigDecimal](https://www.baeldung.com/java-bigdecimal)
- [Baeldung：Autoboxing and Unboxing](https://www.baeldung.com/java-autoboxing)

下一篇 → [03 集合框架](/java/core/collection)
