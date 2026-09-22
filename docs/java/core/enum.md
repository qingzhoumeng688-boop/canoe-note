# 09 枚举

用 `int` 常量或字符串常量表示「状态、类型」是 Java 新手最常踩的坑——编译器不校验值、IDE 没补全、传个 `999` 也编译通过。枚举（enum）正是为「**有限个实例的集合**」而生：类型安全、可读、可带行为。本篇从痛点讲起，覆盖枚举的本质（`javap` 验证）、常用方法、带字段的「状态码写法」、实现接口做策略、switch、EnumSet/EnumMap、以及实现单例的最佳姿势。

## 一、为什么需要枚举

用 `int` 常量表示订单状态：

```java
// 反例：魔法数字满天飞
public static final int ORDER_PENDING = 1;
public static final int ORDER_PAID = 2;
public static final int ORDER_DONE = 3;

void handle(int status) {
    if (status == ORDER_PAID) { ... }
}
handle(999); // 编译通过，运行期才崩，编译器完全帮不了你
```

痛点：

- **不安全**：`handle(999)` 能编译，非法值混入。
- **可读性差**：满屏魔法数字，后人看不懂 `2` 是啥。
- **无法约束**：方法参数类型是 `int`，什么值都能传。

枚举把「状态」这群有限的值收进一个类型里，传错类型直接编译失败：

```java
handle(OrderStatus.PAID);   // 类型安全
// handle(999);             // 编译错误
```

**一句话：枚举是「有限个实例的集合」，用类型把取值范围锁死。**

## 二、枚举的定义与使用

`enum` 关键字定义，实例必须写在**第一行**：

```java
package com.canoe.core.enumeration;

public enum OrderStatus {
    PENDING, PAID, SHIPPED, DONE, CANCELLED
}
```

**枚举的本质**：`enum` 是语法糖，编译器会把它编译成 `final class OrderStatus extends java.lang.Enum<OrderStatus>`。用 `javap` 验证：

```bash
javap OrderStatus.class
# 输出（节选）：
# public final class OrderStatus extends java.lang.Enum<OrderStatus> {
#     public static final OrderStatus PENDING;
#     public static final OrderStatus PAID;
#     ...
# }
```

所以每个枚举实例都是 `Enum` 的子类的**单例静态常量**，这就是为什么枚举实例唯一、可以用 `==` 比较。

## 三、枚举的常用方法

`java.lang.Enum` 提供了一批方法：

- **`values()`**：返回所有实例数组（编译器自动生成）。
- **`valueOf(String)`**：按名字取实例（名字拼错抛 `IllegalArgumentException`）。
- **`name()`**：返回实例名（如 `"PAID"`）。
- **`ordinal()`**：返回声明顺序的下标（从 0 开始）。
- **`toString()`**：默认等于 `name()`，可重写。
- **`compareTo()`**：按 `ordinal` 比较。

```java
package com.canoe.core.enumeration;

public class EnumMethodDemo {
    public static void main(String[] args) {
        for (OrderStatus s : OrderStatus.values()) {
            System.out.println(s.name() + " ordinal=" + s.ordinal());
        }
        OrderStatus paid = OrderStatus.valueOf("PAID");
        System.out.println(paid);                       // PAID
        System.out.println(paid.compareTo(OrderStatus.DONE) < 0); // true

        // ⚠️ ordinal 不要持久化！
        // 一旦在 PAID 前插入新状态，所有后续 ordinal 全变，历史数据错乱
    }
}
```

**`ordinal()` 千万不要持久化到数据库或接口**：它是「声明顺序下标」，一旦在中间插入/调整枚举顺序，已存的 `ordinal` 值就会对不上。请改用自定义的 code 字段（见下节）。

## 四、枚举可以有字段和方法

这是项目里**最常用的写法**：带 `code`（持久化用）和 `desc`（展示用）的状态枚举，再加一个 `ofCode` 反查方法。

```java
package com.canoe.core.enumeration;

public enum OrderStatus {
    PENDING(1, "待支付"),
    PAID(2, "已支付"),
    SHIPPED(3, "已发货"),
    DONE(4, "已完成"),
    CANCELLED(5, "已取消");

    private final int code;     // 持久化到数据库的才是这个，不是 ordinal
    private final String desc;

    OrderStatus(int code, String desc) {
        this.code = code;
        this.desc = desc;
    }

    public int getCode() { return code; }
    public String getDesc() { return desc; }

    // 按 code 反查枚举（数据库读出来的是 code，要转回枚举）
    public static OrderStatus ofCode(int code) {
        for (OrderStatus s : values()) {
            if (s.code == code) return s;
        }
        throw new IllegalArgumentException("未知订单状态码: " + code);
    }

    public static void main(String[] args) {
        OrderStatus s = OrderStatus.PAID;
        System.out.println(s.getCode() + " / " + s.getDesc()); // 2 / 已支付

        OrderStatus fromDb = OrderStatus.ofCode(3);
        System.out.println(fromDb); // SHIPPED
    }
}
```

要点：**持久化用自定义 `code`，绝不用 `ordinal`**；`ofCode` 让「数据库整数 → 枚举」可反查。

## 五、枚举实现接口

枚举可以实现接口，更妙的是**每个实例可以用匿名内部类给出不同行为**——这就是「策略枚举」。

```java
package com.canoe.core.enumeration;

// 折扣策略接口
interface DiscountStrategy {
    double calc(double price);
}

public enum MemberLevel implements DiscountStrategy {
    NORMAL {
        @Override
        public double calc(double price) { return price; }          // 不打折
    },
    SILVER {
        @Override
        public double calc(double price) { return price * 0.95; }    // 95 折
    },
    GOLD {
        @Override
        public double calc(double price) { return price * 0.9; }     // 9 折
    };

    // 注意：每个实例 override 后，这里不需要再实现，也可留默认
    @Override
    public double calc(double price) { return price; }
}
```

使用：

```java
package com.canoe.core.enumeration;

public class StrategyDemo {
    public static void main(String[] args) {
        double price = 100.0;
        System.out.println("普通: " + MemberLevel.NORMAL.calc(price)); // 100
        System.out.println("银卡: " + MemberLevel.SILVER.calc(price)); // 95
        System.out.println("金卡: " + MemberLevel.GOLD.calc(price));   // 90
    }
}
```

比起写一堆 `if/else` 或独立的策略类，策略枚举把「类型 + 行为」绑在一起，简洁又类型安全。

## 六、枚举与 switch

`switch` 天然支持枚举，比用 `int` 安全得多（编译器保证覆盖、不会漏分支）：

```java
package com.canoe.core.enumeration;

public class SwitchDemo {
    public static void handle(OrderStatus status) {
        switch (status) {
            case PENDING:
                System.out.println("等待支付");
                break;
            case PAID:
                System.out.println("已支付，准备发货");
                break;
            case SHIPPED:
                System.out.println("运输中");
                break;
            case DONE:
                System.out.println("交易完成");
                break;
            case CANCELLED:
                System.out.println("已取消");
                break;
        }
    }

    public static void main(String[] args) {
        handle(OrderStatus.PAID);
    }
}
```

JDK 17 起可用 **switch 模式匹配**（预览/正式特性）进一步精简，配合 `->` 箭头语法省略 `break`，并能在分支里直接绑定数据。

## 七、枚举的集合

当 key 是枚举时，请用专用集合，性能碾压通用实现：

- **`EnumSet`**：用一个 `long`（位向量）的每一位表示一个枚举实例，空间极小、增删查都是 O(1) 位运算，**极快**。
- **`EnumMap`**：底层用数组而非哈希表，key 是枚举时比 `HashMap` 更快、更省内存。

```java
package com.canoe.core.enumeration;

import java.util.EnumMap;
import java.util.EnumSet;

public class EnumCollectionDemo {
    public static void main(String[] args) {
        // EnumSet：一组枚举的集合
        EnumSet<OrderStatus> processing = EnumSet.of(OrderStatus.PENDING, OrderStatus.PAID);
        System.out.println(processing.contains(OrderStatus.PAID)); // true

        // EnumMap：key 为枚举的映射
        EnumMap<OrderStatus, String> note = new EnumMap<>(OrderStatus.class);
        note.put(OrderStatus.DONE, "订单已结束");
        System.out.println(note.get(OrderStatus.DONE));
    }
}
```

**什么时候用**：权限集合、状态标记位、按枚举分桶统计时，`EnumSet`/`EnumMap` 是首选。

## 八、枚举与单例

**Effective Java 推荐：枚举是实现单例的最佳方式。** 看代码：

```java
package com.canoe.core.enumeration;

public enum Singleton {
    INSTANCE;

    public void doWork() {
        System.out.println("单例干活");
    }
}

// 使用：全局唯一，随便取
// Singleton.INSTANCE.doWork();
```

为什么它比「双重检查锁」的写法更优？

- **防反射破坏**：普通单例的私有构造器能被反射 `setAccessible(true)` 强行调用来创建第二个实例；枚举的构造器由 JVM 保证只调用一次，反射创建会抛 `IllegalArgumentException`。
- **防序列化破坏**：普通单例实现 `Serializable` 后，反序列化会生成新对象（要额外写 `readResolve` 兜底）；枚举的序列化机制由 JVM 保证，反序列化回来还是同一个 `INSTANCE`。
- **写法极简**：三行搞定，线程安全由 JVM 类加载保证（类加载是线程安全的）。

```java
// 对比：传统双重检查锁单例（易被反射/序列化破坏，代码冗长）
class ClassicSingleton {
    private static volatile ClassicSingleton instance;
    private ClassicSingleton() {} // 反射仍能绕过
    public static ClassicSingleton getInstance() {
        if (instance == null) {
            synchronized (ClassicSingleton.class) {
                if (instance == null) instance = new ClassicSingleton();
            }
        }
        return instance;
    }
}
```

结论：除非单例需要继承或延迟到特定时机加载，否则**直接用枚举单例**。

## 九、枚举的注意事项

- **比较用 `==` 而不是 `equals`**：因为枚举实例天然唯一（JVM 保证单例常量），`==` 既正确又比 `equals` 快，且不会 NPE。
- **枚举不能被继承**：`enum` 编译后是 `final class`，不能再 `extends`。但可以实现接口（见第五节）。
- **序列化安全**：枚举的序列化由 JVM 控制，反序列化不会新建对象，天然单例。
- **前后端交互**：默认 Jackson 把枚举序列化成 `name()`（如 `"PAID"`）。需用 `@JsonValue` 指定序列化哪个字段，或 `@JsonFormat` 控制：
  - `@JsonValue` 标注在 `getCode()` 上 → 序列化输出 `2` 而不是 `"PAID"`。
  - 反序列化想按 code 回来，可配 `@JsonCreator` 调用 `ofCode`。

```java
package com.canoe.core.enumeration;

import com.fasterxml.jackson.annotation.JsonValue;

public enum OrderStatus {
    PENDING(1, "待支付"), PAID(2, "已支付");
    private final int code;
    private final String desc;
    OrderStatus(int code, String desc) { this.code = code; this.desc = desc; }

    @JsonValue // Jackson 序列化时输出 code（2）而非名字（"PAID"）
    public int getCode() { return code; }
}
```

## 本篇小结

- **枚举替代 int/字符串常量**，类型安全、可读、可约束取值范围。
- **`enum` 本质是 `final class extends Enum`**，每个实例是单例静态常量。
- **用 `javap` 可验证**枚举被编译成 `Enum` 子类。
- **`values()`/`valueOf()`/`name()`/`ordinal()`** 是常用方法。
- **`ordinal()` 是声明顺序下标，绝不能持久化**，改顺序就错乱。
- **项目首选「code + desc + ofCode」写法**，持久化用自定义 code。
- **枚举可实现接口 + 匿名内部类**，做出「策略枚举」替代 if/else。
- **`switch` 支持枚举**，比 int 更安全、分支不漏。
- **`EnumSet`/`EnumMap` 用位向量/数组**，枚举做 key/集合时性能最佳。
- **枚举是实现单例的最佳方式**（Effective Java），天然防反射与序列化破坏。
- **枚举比较用 `==`**，实例唯一、快且不会 NPE。
- **前后端用 `@JsonValue` 指定序列化字段**，避免输出 `name()`。

## 参考链接

- [Java 官方文档：枚举类型教程](https://docs.oracle.com/javase/tutorial/java/javaOO/enum.html)
- [Java 官方文档：Enum 类](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Enum.html)
- [Oracle 官方：EnumSet](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/EnumSet.html)
- [Effective Java（Joshua Bloch）条目 34：用枚举替代 int 常量](https://www.oreilly.com/library/view/effective-java-3rd/9780134686097/)
- [Baeldung：Java 枚举指南](https://www.baeldung.com/java-enum)
- [Baeldung：枚举实现单例](https://www.baeldung.com/java-singleton-enum)
- [Jackson @JsonValue 文档](https://fasterxml.github.io/jackson-annotations/javadoc/2.14/com/fasterxml/jackson/annotation/JsonValue.html)

下一篇 → [返回专栏首页](/java/core/string)
