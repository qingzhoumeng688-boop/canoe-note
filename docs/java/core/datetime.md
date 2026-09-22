# 05 日期时间 API

日期时间处理是每个项目的刚需，也是 `Date`/`Calendar` 时代开发者永恒的痛。JDK 8 带来了全新的 `java.time` 包（JSR-310），不可变、线程安全、API 清晰。本篇先讲旧 API 的坑，再逐个拆解 `LocalDate`/`LocalDateTime`/`Instant` 等核心类，覆盖创建、运算、格式化、类型互转、时区，以及 Spring Boot 里 `@JsonFormat` 的实战，配可运行代码。

## 一、为什么 JDK 8 要换一套

旧 API（`java.util.Date`、`Calendar`、`SimpleDateFormat`）的设计槽点太多：

- **可变**：`Date` 的 `setYear`/`setMonth` 能改，多线程共享会被悄悄篡改。
- **月份从 0 开始**：`new Date(2026, 0, 1)` 表示 2026 年**1 月**，极易写错。
- **年份从 1900 开始**：`getYear()` 返回的是减去 1900 的值。
- **非线程安全**：`SimpleDateFormat` 内部有共享状态，多线程共用一个实例会出错甚至拿到错误日期。
- **命名混乱**：`Date` 既表示日期又表示时间，时区信息缺失。

```java
// 旧 API 的「反人类」示例
java.util.Date d = new java.util.Date(2026 - 1900, 0, 1); // 月份0基、年份减1900
System.out.println(d); // 实际是 2026-01-01，但写法极反直觉
```

于是 JDK 8 引入了 `java.time`（借鉴 Joda-Time），彻底重写。

## 二、旧 API 速览

了解即可，面试常问「为什么被取代」：

```java
package com.canoe.core.datetime;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;

public class LegacyDemo {
    public static void main(String[] args) throws Exception {
        Date now = new Date();                  // 当前时间（含日期+时间）
        long ts = System.currentTimeMillis();    // 时间戳（毫秒），最稳妥

        Calendar cal = Calendar.getInstance();
        cal.set(2026, Calendar.JANUARY, 1);      // 月份仍是 0 基
        Date newYear = cal.getTime();

        // SimpleDateFormat 非线程安全，多线程共用会出问题
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        String text = sdf.format(now);
        Date parsed = sdf.parse(text);
        System.out.println(text + " -> " + parsed);
    }
}
```

结论：新项目一律用 `java.time`，旧 API 仅在维护老代码时接触。唯一值得记住的兼容手段是 `System.currentTimeMillis()`。

## 三、java.time 核心类

`java.time` 包的核心类：

```text
类名              含义                  是否含时区
LocalDate         日期（年-月-日）        否
LocalTime         时间（时:分:秒.纳秒）    否
LocalDateTime     日期+时间               否
Instant           时间戳（UTC 时刻）       是（UTC）
Duration          时间段（基于时间，精确到纳秒）  -
Period            日期段（基于日期，年/月/日）   -
ZoneId            时区 ID                  -
ZonedDateTime     带时区的完整日期时间      是
```

```java
package com.canoe.core.datetime;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.Period;
import java.time.ZoneId;
import java.time.ZonedDateTime;

public class CoreClassDemo {
    public static void main(String[] args) {
        LocalDate date = LocalDate.now();            // 2026-xx-xx
        LocalTime time = LocalTime.now();            // xx:xx:xx.xxxxxxx
        LocalDateTime dt = LocalDateTime.now();       // 日期+时间
        Instant instant = Instant.now();             // 类似时间戳，UTC

        Duration dur = Duration.ofHours(3);          // 3 小时时间段
        Period per = Period.of(1, 2, 3);            // 1年2月3天

        ZoneId zone = ZoneId.of("Asia/Shanghai");
        ZonedDateTime zdt = ZonedDateTime.now(zone); // 上海时区的完整时间
        System.out.println(zdt);
    }
}
```

记忆诀窍：`Local*` 不带时区、适合「展示和存储本地时间」；`Instant` 是机器视角的时间戳；需要跨时区用 `ZonedDateTime`。

## 四、创建与获取

`java.time` 类大多用 `now()`/`of()`/`parse()` 创建，取值方法一目了然：

```java
package com.canoe.core.datetime;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class CreateDemo {
    public static void main(String[] args) {
        // now()：当前
        LocalDate today = LocalDate.now();

        // of()：指定，月份终于从 1 开始了！
        LocalDate birth = LocalDate.of(2026, 1, 1);
        LocalDateTime meeting = LocalDateTime.of(2026, 1, 1, 9, 30);

        // parse()：解析字符串，默认 ISO 格式
        LocalDate parsed = LocalDate.parse("2026-12-25");
        LocalDateTime parsedDt = LocalDateTime.parse("2026-12-25T09:30:00");

        // 取年月日、星期
        int year = birth.getYear();
        int month = birth.getMonthValue();
        int day = birth.getDayOfMonth();
        DayOfWeek dow = birth.getDayOfWeek(); // FRIDAY
        System.out.println(year + "-" + month + "-" + day + " 是 " + dow);

        // 取时间戳（Instant）
        long epochMilli = meeting.toInstant(java.time.ZoneOffset.of("+8")).toEpochMilli();
        System.out.println("毫秒时间戳: " + epochMilli);
    }
}
```

## 五、运算与比较

**核心特性：`java.time` 的所有修改方法都返回新对象，原对象不变（不可变）**——这正是它比 `Date` 安全的地方。

```java
package com.canoe.core.datetime;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

public class ComputeDemo {
    public static void main(String[] args) {
        LocalDate d = LocalDate.of(2026, 1, 1);

        // plus / minus：加、减
        LocalDate plus7 = d.plusDays(7);
        LocalDate minus1 = d.minusMonths(1);
        System.out.println(plus7); // 2026-01-08
        System.out.println(minus1); // 2025-12-01

        // with：直接设置某个字段
        LocalDate firstDay = d.withDayOfMonth(1);
        System.out.println(firstDay); // 2026-01-01

        // 比较
        LocalDate target = LocalDate.of(2026, 6, 1);
        System.out.println(d.isBefore(target));  // true
        System.out.println(d.isAfter(target));   // false
        System.out.println(d.isEqual(LocalDate.of(2026, 1, 1))); // true

        // 间隔计算
        long days = ChronoUnit.DAYS.between(d, target); // 151
        long months = ChronoUnit.MONTHS.between(d, target);
        System.out.println("相差 " + days + " 天，" + months + " 个月");
    }
}
```

不可变的好处：可以放心把日期对象当方法参数传来传去，不用担心被别人改掉。

## 六、格式化与解析

`DateTimeFormatter` 是**线程安全**的（与 `SimpleDateFormat` 相反），可以放心做成静态常量。

```java
package com.canoe.core.datetime;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class FormatDemo {
    public static void main(String[] args) {
        LocalDateTime now = LocalDateTime.now();

        // 预定义格式
        String iso = now.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);

        // 自定义 pattern
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        String text = now.format(fmt);
        System.out.println(text);

        // 解析
        LocalDateTime parsed = LocalDateTime.parse("2026-01-01 09:30:00", fmt);
        System.out.println(parsed);

        // 常用字母表
        // y 年  M 月  d 日  H 24小时制  h 12小时制  m 分  s 秒  S 毫秒  E 星期
    }
}
```

常用 pattern 字母：

```text
字母   含义        示例
y      年          yyyy -> 2026
M      月          MM -> 01
d      日          dd -> 05
H      24小时制     HH -> 14
h      12小时制     hh -> 02
m      分          mm -> 30
s      秒          ss -> 45
S      毫秒         SSS -> 123
E      星期        E -> 周五
```

## 七、类型转换

实际项目里 `LocalDateTime` ↔ `String` ↔ `Date` ↔ 时间戳 互转极高频，这里给一套完整工具思路：

```java
package com.canoe.core.datetime;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Date;

public class ConvertDemo {
    // 1. LocalDateTime -> String
    static String toStr(LocalDateTime dt) {
        return dt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    // 2. String -> LocalDateTime
    static LocalDateTime fromStr(String s) {
        return LocalDateTime.parse(s, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    // 3. LocalDateTime -> Date（旧 API，兼容老代码）
    static Date toDate(LocalDateTime dt) {
        return Date.from(dt.toInstant(ZoneOffset.of("+8")));
    }

    // 4. Date -> LocalDateTime
    static LocalDateTime fromDate(Date date) {
        return date.toInstant().atZone(ZoneOffset.of("+8")).toLocalDateTime();
    }

    // 5. LocalDateTime -> 时间戳(毫秒)
    static long toEpochMilli(LocalDateTime dt) {
        return dt.toInstant(ZoneOffset.of("+8")).toEpochMilli();
    }

    // 6. 时间戳(毫秒) -> LocalDateTime
    static LocalDateTime fromEpochMilli(long milli) {
        return Instant.ofEpochMilli(milli).atZone(ZoneOffset.of("+8")).toLocalDateTime();
    }

    public static void main(String[] args) {
        LocalDateTime now = LocalDateTime.now();
        System.out.println("String: " + toStr(now));
        System.out.println("Date:   " + toDate(now));
        System.out.println("时间戳: " + toEpochMilli(now));
        System.out.println("回转:   " + fromEpochMilli(toEpochMilli(now)));
    }
}
```

记忆：`java.time` 与旧 `Date` 之间靠 `Instant` + `ZoneOffset` 桥接；与字符串之间靠 `DateTimeFormatter`。

## 八、时区处理

为什么需要 `ZonedDateTime`？因为全球用户处在不同时区，服务器若存「本地时间」会乱套。

**最佳实践**：

- 服务器内部统一用 **UTC** 存储和运算（`Instant` / `ZonedDateTime` with `ZoneOffset.UTC`）。
- 只在「给用户看」的时候，按用户所在时区转成本地时间。

```java
package com.canoe.core.datetime;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;

public class ZoneDemo {
    public static void main(String[] args) {
        // 服务器统一存 UTC
        Instant utcNow = Instant.now();
        System.out.println("UTC: " + utcNow);

        // 展示时转成用户时区
        ZonedDateTime shanghai = utcNow.atZone(ZoneId.of("Asia/Shanghai"));
        ZonedDateTime tokyo = utcNow.atZone(ZoneId.of("Asia/Tokyo"));
        System.out.println("上海: " + shanghai);
        System.out.println("东京: " + tokyo); // 东京比上海早 1 小时
    }
}
```

这样同一个 UTC 时刻，上海显示 09:00、东京显示 10:00，逻辑清晰不混乱。

## 九、Spring Boot 中的日期处理

Web 项目里前后端日期交互常见问题：前端传 `"2026-01-01"` 后端收不到、后端返回的日期带 `T` 和时区。

```java
// 1. 入参绑定：前端字符串 -> LocalDateTime
//    GET 参数用 @DateTimeFormat
//    JSON 请求体用 @JsonFormat
import com.fasterxml.jackson.annotation.JsonFormat;
import org.springframework.format.annotation.DateTimeFormat;
import java.time.LocalDateTime;

public class OrderDTO {
    // 前端 JSON: "2026-01-01 09:30:00"
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private LocalDateTime orderTime;

    // 表单/GET 参数: 2026-01-01
    @DateTimeFormat(pattern = "yyyy-MM-dd")
    private LocalDateTime payDate;
}

// 2. 全局 Jackson 配置（application.yml）
// spring:
//   jackson:
//     date-format: yyyy-MM-dd HH:mm:ss
//     time-zone: GMT+8
//     default-property-inclusion: non_null

// 3. 数据库 datetime 字段映射 LocalDateTime（JPA / MyBatis 都支持）
//    MyBatis 需保证 mysql-connector-j 版本较新，自动映射 datetime -> LocalDateTime
```

要点：

- **入参/出参**：`@JsonFormat` 管 JSON，`@DateTimeFormat` 管表单/GET 参数。
- **全局配置**统一格式，避免每个字段都标注解。
- **数据库 `datetime` 直接映射 `LocalDateTime`**，现代驱动都支持。

## 本篇小结

- **旧 `Date`/`Calendar` 可变、月份0基、年减1900、`SimpleDateFormat` 非线程安全**，所以被取代。
- **`java.time` 不可变、线程安全**，设计借鉴 Joda-Time。
- **`LocalDate`/`LocalDateTime` 不含时区**，`Instant` 是 UTC 时间戳。
- **`plus`/`minus`/`with` 都返回新对象**，原对象不变，线程安全。
- **`DateTimeFormatter` 线程安全**，可做成静态常量放心复用。
- **pattern 字母**：`y`年 `M`月 `d`日 `H`24小时 `m`分 `s`秒。
- **`LocalDateTime` ↔ `Date` 用 `Instant` + `ZoneOffset` 桥接**。
- **时间戳互转**靠 `toEpochMilli` / `Instant.ofEpochMilli`。
- **服务器统一存 UTC**，展示时再转用户时区。
- **`ZonedDateTime` 适合跨时区**，`Asia/Shanghai` 等 `ZoneId` 表达时区。
- **Spring Boot 用 `@JsonFormat`/`@DateTimeFormat`** 处理前后端日期。
- **数据库 `datetime` 直接映射 `LocalDateTime`**，现代驱动都支持。

## 参考链接

- [Java 官方文档：java.time 包](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/time/package-summary.html)
- [Java 官方文档：LocalDateTime](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/time/LocalDateTime.html)
- [Java 官方文档：DateTimeFormatter](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/time/format/DateTimeFormatter.html)
- [Oracle 教程：Date Time](https://docs.oracle.com/javase/tutorial/datetime/)
- [Baeldung：Java 8 Date/Time API](https://www.baeldung.com/java-8-date-time-intro)
- [Spring Boot 日期格式化文档](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/)
- [JSR-310 规范](https://jcp.org/en/jsr/detail?id=310)

下一篇 → [06 泛型](/java/core/generic)
