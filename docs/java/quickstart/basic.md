# 03 Java 程序基础

> 本篇导读：装好环境后，我们正式进入 Java 语言的"语法世界"。本篇会从程序的基本结构讲起，带你认识八种基本数据类型、变量的作用域、整数与浮点运算的那些"坑"，再到布尔判断、字符串拼接，最后用输入输出收尾。把这些地基打牢，后面的面向对象才走得不慌。

## 一、程序的基本结构

一个 Java 源文件（`.java`）从外到内的结构是固定的一套：**包声明 → import 导入 → 类定义 → 字段 → 方法**。

```text
package xxx;          // ① 包声明（文件属于哪个命名空间）
import xxx;           // ② 导入别的包里的类（可省略）
public class Xxx {    // ③ 类定义（文件名必须和 public 类名一致）
    int age;          // ④ 字段（成员变量）
    void say() {      // ⑤ 方法
        // 执行语句必须写在方法或代码块里
    }
}
```

**一个关键纪律**：类体里**不能直接写执行语句**，下面的写法会直接编译报错：

```java
package com.canoe.quickstart.basic;

public class WrongDemo {
    int score = 90;
    // ❌ 编译错误：执行语句不能直接写在类体里
    System.out.println(score);
}
```

执行语句（比如打印、计算）必须放进方法或 `{}` 代码块中。看一个正确、可运行的例子 —— 我们用它模拟一张"学生名片"：

```java
package com.canoe.quickstart.basic;

// 文件名：StudentCard.java
// 一张学生名片：保存姓名和分数，并能自我介绍
public class StudentCard {

    // 字段：描述"有什么"
    String name;
    int score;

    // 方法：描述"能做什么"
    void introduce() {
        System.out.println("大家好，我是 " + name + "，这次考了 " + score + " 分。");
    }

    public static void main(String[] args) {
        StudentCard xiaoming = new StudentCard();
        xiaoming.name = "小明";
        xiaoming.score = 92;
        xiaoming.introduce();
    }
}
```

运行输出：`大家好，我是 小明，这次考了 92 分。`

## 二、变量与数据类型

变量就是"一个有名字、能装数据的小盒子"。Java 是**强类型**语言：盒子一旦声明装 `int`，就不能塞 `String`。Java 的数据类型分两大类：

- **基本类型（primitive）**：直接存值，共 8 种。
- **引用类型（reference）**：存的是"对象的地址"，比如 `String`、数组、自己写的类。

八种基本类型逐个看（记住它们占多少字节、取值范围）：

| 类型 | 字节 | 取值范围 / 说明 |
| --- | --- | --- |
| `byte` | 1 | -128 ~ 127，节省空间的整数 |
| `short` | 2 | -32768 ~ 32767 |
| `int` | 4 | 约 -21 亿 ~ 21 亿，最常用整数 |
| `long` | 8 | 范围极大，整数末尾必须加 `L` |
| `float` | 4 | 单精度小数，末尾必须加 `F` |
| `double` | 8 | 双精度小数，默认小数类型 |
| `char` | 2 | 单个字符，如 `'A'`、`'中'` |
| `boolean` | 1(位) | 只有 `true` / `false` |

**两个新手必踩的坑**：

1. `long` 不加 `L`：字面量 `9999999999` 默认是 `int`，超过 `int` 范围直接报错，必须写成 `9999999999L`。
2. `float` 不加 `F`：小数字面量默认是 `double`，把 `double` 塞给 `float` 会精度损失报错，必须写成 `3.14F`。

```java
package com.canoe.quickstart.basic;

// 文件名：DataTypeDemo.java
// 演示八种基本类型，以及 long/float 必须加后缀的坑
public class DataTypeDemo {

    public static void main(String[] args) {
        byte b = 100;                 // byte 在 -128~127 之间
        short s = 30000;              // short
        int age = 18;                 // int 最常用
        long population = 1400000000L; // long 必须加 L（建议大写，避免和数字 1 混淆）
        float height = 1.75F;         // float 必须加 F
        double pi = 3.1415926535;     // double 是小数默认类型
        char letter = '中';           // char 用单引号，单个字符
        boolean passed = true;        // boolean 只有 true / false

        System.out.println("年龄=" + age + " 人口=" + population);
        System.out.println("身高=" + height + " π=" + pi);
        System.out.println("字符=" + letter + " 是否及格=" + passed);
    }
}
```

## 三、变量命名与作用域

**标识符规则**：变量名只能由字母、数字、`_`、`$` 组成，不能以数字开头，不能是关键字（如 `int`、`class`）。

**驼峰命名法**：变量和方法用 `小驼峰`（首字母小写，如 `studentName`）；类用 `大驼峰`（首字母大写，如 `StudentCard`）。

**成员变量 vs 局部变量的默认值差异**——这是很多报错的来源：

- **成员变量**（写在类里、方法外）：有默认值。`int` 默认 `0`，`boolean` 默认 `false`，引用类型默认 `null`。
- **局部变量**（写在方法里）：**没有默认值**，不赋值就使用会直接编译报错。

```java
package com.canoe.quickstart.basic;

// 文件名：ScopeDemo.java
// 演示成员变量有默认值，局部变量必须手动赋值
public class ScopeDemo {

    int memberScore;        // 成员变量，默认值是 0
    boolean memberPassed;   // 成员变量，默认值是 false

    public static void main(String[] args) {
        ScopeDemo demo = new ScopeDemo();
        System.out.println("成员变量 score 默认值=" + demo.memberScore);
        System.out.println("成员变量 passed 默认值=" + demo.memberPassed);

        // 局部变量：必须手动赋值，否则编译报错
        int localScore = 88;
        System.out.println("局部变量 localScore=" + localScore);

        // 下面的变量只在 if 块里有效，出了块就访问不到（作用域）
        if (localScore > 60) {
            String tip = "及格啦";
            System.out.println(tip);
        }
        // System.out.println(tip); // ❌ 编译错误：tip 的作用域已结束
    }
}
```

## 四、整数运算

整数运算看起来简单，却藏着三个经典"坑"：

1. **整除陷阱**：`/` 两边都是整数时，结果只保留整数部分。`5 / 2` 得到 `2`，不是 `2.5`。要想得小数，至少让一边是 `double`（如 `5.0 / 2`）。
2. **取模 `%`**：得到除法的余数。`7 % 3 = 1`，常用来判断奇偶（`n % 2 == 0` 为偶数）。
3. **整数溢出**：`int` 最大值 `+1` 会"绕回"成负数。做可能很大的运算时，用 `long` 或 `BigInteger`。
4. **`++i` 与 `i++`**：都让 `i` 加 1，区别在"返回值"——`++i` 先加后用，`i++` 先用后加。

```java
package com.canoe.quickstart.basic;

// 文件名：IntegerCalc.java
// 演示整除、取模、溢出、前缀/后缀自增
public class IntegerCalc {

    public static void main(String[] args) {
        // ① 整除陷阱
        System.out.println("5 / 2 = " + (5 / 2));        // 2，不是 2.5
        System.out.println("5.0 / 2 = " + (5.0 / 2));    // 2.5，有一边是小数才行

        // ② 取模：判断奇偶
        int n = 7;
        System.out.println(n + " 是" + (n % 2 == 0 ? "偶数" : "奇数")); // 奇数

        // ③ 整数溢出：int 最大值 + 1 变负数
        int max = Integer.MAX_VALUE;     // 2147483647
        System.out.println("int 最大值 + 1 = " + (max + 1)); // -2147483648

        // ④ 前缀 vs 后缀自增
        int a = 5, b = 5;
        System.out.println("++a = " + (++a)); // 先加后用，输出 6，a 现在 6
        System.out.println("b++ = " + (b++)); // 先用后加，输出 5，b 现在 6
    }
}
```

## 五、浮点运算

浮点数最著名的"反直觉"现象：

```java
System.out.println(0.1 + 0.2); // 0.30000000000000004
```

这是因为计算机用二进制表示小数，`0.1` 和 `0.2` 无法被精确存储，于是出现微小误差。**结论：浮点类型绝对不能用于金额计算！**

金额必须用 **`BigDecimal`**。注意两个坑：

- 构造时要用**字符串** `new BigDecimal("0.1")`，不要用 `new BigDecimal(0.1)`（后者先把不精确的 double 传进去）。
- 比较相等别用 `equals`（它连精度标度都比对），要用 `compareTo() == 0`。

```java
package com.canoe.quickstart.basic;

import java.math.BigDecimal;

// 文件名：MoneyDemo.java
// 演示浮点误差，以及用 BigDecimal 正确算钱
public class MoneyDemo {

    public static void main(String[] args) {
        // 浮点误差：0.1 + 0.2 不等于 0.3
        System.out.println("0.1 + 0.2 = " + (0.1 + 0.2));

        // 正确做法：BigDecimal，用字符串构造，避免先把不精确的 double 传入
        BigDecimal price = new BigDecimal("0.1");
        BigDecimal amount = new BigDecimal("0.2");
        BigDecimal total = price.add(amount);
        System.out.println("精确结果=" + total); // 0.3

        // 比较相等用 compareTo，而不是 equals
        BigDecimal a = new BigDecimal("1.0");
        BigDecimal b = new BigDecimal("1.00");
        System.out.println("equals 比较（含标度）=" + a.equals(b));      // false
        System.out.println("compareTo 比较（数值）=" + (a.compareTo(b) == 0)); // true
    }
}
```

## 六、布尔运算与短路

布尔类型只有 `true` / `false`，配合三个运算符：

- `&&`（与）：两边都真才真。
- `||`（或）：有一边真就真。
- `!`（非）：取反。

**短路求值**是重点：`a && b` 中若 `a` 为假，就不会去算 `b`。这不只是提速，更能**避免空指针**：

```java
// 如果 a 是 null，a.length() 会抛异常；
// 但用 && 短路：a != null 为假时，后面的 a.length() 根本不会执行
if (a != null && a.length() > 0) { ... }
```

**三元运算符** `条件 ? 值1 : 值2` 是 `if-else` 的简写：

```java
String result = score >= 60 ? "及格" : "不及格";
```

```java
package com.canoe.quickstart.basic;

// 文件名：BooleanDemo.java
// 演示布尔运算、短路求值、三元运算符
public class BooleanDemo {

    public static void main(String[] args) {
        int score = 75;
        boolean good = score >= 60 && score <= 100; // 与运算
        boolean free = score < 60 || score == 100;  // 或运算
        System.out.println("成绩合法=" + good + " 免考或满分=" + free);

        // 短路：左边为假，右边不执行（不会空指针）
        String text = null;
        boolean safe = text != null && text.length() > 0;
        System.out.println("text 非空=" + safe);

        // 三元运算符：一行搞定及格判断
        String level = score >= 60 ? "及格" : "不及格";
        System.out.println("成绩等级=" + level);
    }
}
```

## 七、字符与字符串初步

- **`char`**：单个字符，用**单引号** `'A'`、`'中'`，占 2 字节（UTF-16）。
- **`String`**：一串字符，用**双引号** `"hello"`，是引用类型（对象）。

**转义字符**：当字符本身有特殊含义时需转义，常见有 `\n`（换行）、`\t`（制表符）、`\"`（双引号）、`\\`（反斜杠）。

**字符串拼接**：用 `+` 很方便，但在**循环里反复用 `+` 拼接会极低效**——每次 `+` 都会生成新 `String` 对象。大量拼接请用 `StringBuilder`。

```java
package com.canoe.quickstart.basic;

// 文件名：StringDemo.java
// 演示 char 与 String 区别、转义、+ 拼接、StringBuilder
public class StringDemo {

    public static void main(String[] args) {
        char c = '中';
        String name = "小明";
        System.out.println("单个字符：" + c + "，名字：" + name);

        // 转义字符：\n 换行，\t 制表符，\" 双引号
        System.out.println("姓名：\"小明\"\n年龄：\t18");

        // 循环里用 + 拼接：每次都新建 String，低效
        String slow = "";
        for (int i = 0; i < 3; i++) {
            slow = slow + i; // 不推荐
        }

        // 正确做法：StringBuilder 可变，高效
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 3; i++) {
            sb.append(i);
        }
        System.out.println("拼接结果=" + sb.toString()); // 012
    }
}
```

## 八、数组初步

数组是"装同一类型数据的固定长度容器"，存放**连续内存**中，下标从 **0** 开始。详细用法见下一篇，这里先认识它：

- 声明 + 初始化有三种写法；
- `length` 是**属性**（不是方法），表示数组长度；
- 数组是**引用类型**；
- 打印数组别直接 `println(arr)`，要用 `Arrays.toString(arr)`。

```java
package com.canoe.quickstart.basic;

import java.util.Arrays;

// 文件名：ArrayIntro.java
// 演示数组的三种初始化、length、Arrays.toString 打印
public class ArrayIntro {

    public static void main(String[] args) {
        // 写法一：先指定长度，元素取默认值（int 默认 0）
        int[] scores = new int[3];

        // 写法二：直接给值，长度由元素个数决定
        int[] ages = new int[]{18, 20, 19};

        // 写法三：简写（声明时才能用，不能拆成两行）
        String[] names = {"小明", "小红", "小刚"};

        scores[0] = 95; // 下标从 0 开始
        System.out.println("第一个分数=" + scores[0]);
        System.out.println("数组长度=" + names.length); // length 是属性

        // 直接打印数组得到的是地址，要用 Arrays.toString
        System.out.println("ages=" + Arrays.toString(ages));
    }
}
```

## 九、输入与输出

**输出**：

- `System.out.println(x)`：打印并换行；
- `System.out.print(x)`：打印不换行；
- `System.out.printf(格式, 参数)`：像 C 语言一样格式化，`%d` 整数、`%s` 字符串、`%.2f` 保留两位小数的浮点数。

**输入**：用 `Scanner` 读取。一个经典坑——先 `nextInt()` 读整数，再 `nextLine()` 读字符串，会发现 `nextLine()` 直接读到了**空行**。原因是 `nextInt()` 只消费了数字，把后面的换行符留在了缓冲区，`nextLine()` 一上来就吃掉了这个换行。解决办法：在 `nextInt()` 后面补一个 `nextLine()` 把换行消费掉。

```java
package com.canoe.quickstart.basic;

import java.util.Scanner;

// 文件名：IoExample.java
// 演示格式化输出，以及 Scanner 的 nextInt 后 nextLine 坑
public class IoExample {

    public static void main(String[] args) {
        // 格式化输出
        String name = "小明";
        int score = 92;
        double avg = 91.567;
        System.out.printf("学员：%s，分数：%d，平均分：%.2f%n", name, score, avg);

        Scanner sc = new Scanner(System.in);
        System.out.print("请输入年龄：");
        int age = sc.nextInt();          // 只读整数，留下换行符在缓冲区

        sc.nextLine();                   // ✅ 吃掉残留的换行，避免下一个 nextLine 读到空

        System.out.print("请输入爱好：");
        String hobby = sc.nextLine();
        System.out.println("你 " + age + " 岁，爱好是 " + hobby);

        sc.close();
    }
}
```

## 十、注释与代码规范

三种注释：

- 单行：`// 这是单行注释`
- 多行：`/* 这是多行注释 */`
- 文档注释：`/** ... */`，可被 `javadoc` 工具提取成 API 文档。

**Javadoc 规范**：在类、方法前用 `/** */` 写说明，并用 `@param` 标参数、`@return` 标返回值。IDEA 输入 `/**` 回车会自动生成模板。

```java
package com.canoe.quickstart.basic;

/**
 * 计算器工具类：演示规范的 Javadoc 写法
 */
public class Calculator {

    /**
     * 求两个整数的和
     *
     * @param a 第一个加数
     * @param b 第二个加数
     * @return 两数之和
     */
    public int add(int a, int b) {
        return a + b;
    }
}
```

> 好的注释解释"为什么"，而不是复述"做了什么"。`i++` 这种代码不需要注释，但一段复杂的业务规则值得写清楚背景。

## 本篇小结

- 一个 `.java` 文件结构是 **package → import → class → 字段 → 方法**，执行语句只能写在方法里。
- Java 有 **8 种基本类型**，整数首选 `int`，小数首选 `double`。
- `long` 字面量必须加 **`L`**，`float` 字面量必须加 **`F`**，否则编译报错。
- **成员变量有默认值**，局部变量没有，不赋值就用会编译失败。
- 整数除法 `/` 会**整除**（`5/2=2`），取模 `%` 常用来判断奇偶。
- `int` 溢出会绕回负数，大数运算用 **`long` 或 `BigDecimal`**。
- 浮点有精度误差，**金额必须用 `BigDecimal`**，且比较用 `compareTo` 而非 `equals`。
- `&&` / `||` 具有**短路求值**，可安全写出 `a != null && a.length() > 0`。
- `char` 用单引号、`String` 用双引号；循环里拼字符串请用 **`StringBuilder`**。
- 数组下标从 **0** 开始，`length` 是属性，打印用 **`Arrays.toString`**。
- 读取输入用 `Scanner`，注意 **`nextInt` 后补一个 `nextLine`** 吃掉残留换行。

## 参考链接

- [Oracle Java 教程：语言基础](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/index.html)
- [Oracle Java 教程：数据类型](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/datatypes.html)
- [Java 语言规范（官方）](https://docs.oracle.com/javase/specs/)
- [BigDecimal 官方 API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html)
- [String 官方 API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/String.html)
- [Scanner 官方 API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Scanner.html)
- [Javadoc 工具文档](https://www.oracle.com/java/technologies/javase/javadoc-tool.html)
- [廖雪峰 Java 教程](https://www.liaoxuefeng.com/wiki/1252599548343744)

下一篇 → [04 流程控制](/java/quickstart/control)
