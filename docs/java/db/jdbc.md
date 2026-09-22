# 07 JDBC 基础

> 本篇导读：前面几篇都在讲 MySQL 本身，但从 Java 程序怎么连上数据库呢？答案就是 JDBC（Java Database Connectivity）。它是 Java 访问数据库的标准接口，各家数据库厂商提供"驱动"来实现它。本篇从第一个 JDBC 程序写起，重点讲 PreparedStatement 为什么能防 SQL 注入、事务怎么用、批处理与自增主键怎么拿，最后介绍连接池的必要性。所有代码都是完整可运行的。

## 一、JDBC 是什么

JDBC 是 Java 访问数据库的**标准 API**。它定义了一套接口（`Connection`、`Statement`、`ResultSet` 等），但具体怎么和 MySQL 通信，由**数据库厂商提供的驱动（driver）**去实现。

```text
┌────────────┐    JDBC API     ┌────────────────┐    网络     ┌──────────┐
│  Java 应用  │ ─────────────▶ │  MySQL 驱动     │ ─────────▶ │  MySQL   │
│  (你的代码) │  Connection/   │ (Driver 实现)  │  TCP+协议  │  数据库  │
└────────────┘  Statement/... └────────────────┘            └──────────┘
```

这正是**桥接模式（Bridge Pattern）**的典型应用：JDBC 定义抽象（API），驱动是实现（Implementor），应用代码只依赖抽象，不关心底层是 MySQL 还是 PostgreSQL——换个驱动就能换数据库。这也是设计模式篇里"桥接模式"的真实落地。

## 二、第一个 JDBC 程序

下面是一个**完整可运行**的示例，演示加载驱动、获取连接、执行查询、遍历结果、关闭资源的全流程：

```java
package com.canoe.db.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * 第一个 JDBC 程序：查询 user 表。
 * 运行前需有可用的 MySQL，且库中有 user 表。
 */
public class FirstJdbcDemo {

    // 数据库连接信息
    private static final String URL = "jdbc:mysql://127.0.0.1:3306/shop_db?useUnicode=true&characterEncoding=utf8mb4";
    private static final String USER = "root";
    private static final String PASSWORD = "root123";

    public static void main(String[] args) {
        // 1) 建立连接（JDBC 4 之后无需 Class.forName，驱动靠 SPI 自动注册）
        try (Connection conn = DriverManager.getConnection(URL, USER, PASSWORD);
             // 2) 创建 Statement
             Statement stmt = conn.createStatement();
             // 3) 执行 SQL 拿到结果集
             ResultSet rs = stmt.executeQuery("SELECT id, username, age FROM user")) {

            // 4) 遍历结果集
            while (rs.next()) {
                long id = rs.getLong("id");
                String username = rs.getString("username");
                int age = rs.getInt("age");
                System.out.println("id=" + id + ", username=" + username + ", age=" + age);
            }
        } catch (SQLException e) {
            // 5) 任何一步出错都会走到这里
            e.printStackTrace();
        }
        // 资源由 try-with-resources 自动关闭，无需手动 close
    }
}
```

注意：**从 JDBC 4.0（JDK 6+）起，`Class.forName("com.mysql.cj.jdbc.Driver")` 可以省略**，驱动 JAR 里通过 SPI（`META-INF/services/java.sql.Driver`）自动注册。老教程还写着这行，现在可以删掉。

## 三、Connection / Statement / ResultSet

三个核心接口各司其职：

| 接口 | 职责 | 常用方法 |
| --- | --- | --- |
| `Connection` | 代表一条数据库连接 | `createStatement()`、`prepareStatement(sql)`、`setAutoCommit()`、`commit()`、`rollback()` |
| `Statement` | 用于执行静态 SQL | `executeQuery()`（查）、`executeUpdate()`（增删改）、`execute()`（通用） |
| `ResultSet` | 查询结果集（游标） | `next()`、`getXxx(列名/下标)`、`wasNull()` |

一个 `Connection` 上可以创建多个 `Statement`，一个 `Statement` 执行后产生一个 `ResultSet`。用完后必须都关闭（见第十节）。

## 四、Statement vs PreparedStatement

**本篇最关键的结论：永远用 `PreparedStatement`，禁止字符串拼接 SQL。** 它有三大优势：

1. **预编译性能更好**：SQL 模板先发给数据库编译一次，之后只传参数反复执行，省去重复解析。
2. **防止 SQL 注入**：参数与 SQL 语义分离，参数永远不会被当成 SQL 代码解析。
3. **类型处理方便**：`setInt/setString/setDate` 自动做类型转换与转义。

```java
package com.canoe.db.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * PreparedStatement 使用示例：按用户名查询。
 */
public class PreparedStatementDemo {

    private static final String URL = "jdbc:mysql://127.0.0.1:3306/shop_db?useUnicode=true&characterEncoding=utf8mb4";

    public static void main(String[] args) throws SQLException {
        String username = "张三";   // 实际场景下来自用户输入

        try (Connection conn = DriverManager.getConnection(URL, "root", "root123");
             // 1) 预编译带 ? 占位符的 SQL
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT id, age FROM user WHERE username = ?")) {

            // 2) 按位置设置参数（从 1 开始），自动转义，安全
            ps.setString(1, username);

            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    System.out.println("id=" + rs.getLong("id") + ", age=" + rs.getInt("age"));
                }
            }
        }
    }
}
```

## 五、SQL 注入

**SQL 注入**是指把恶意字符串拼进 SQL，改变了原语义。经典攻击：`OR 1=1` 恒成立，让 WHERE 条件永远为真，从而拖出全表甚至绕过登录。

**危险的反例（字符串拼接）**：

```java
// 假设用户输入的用户名是： ' OR '1'='1
String input = "' OR '1'='1";
// 拼接后 SQL 变成：
// SELECT * FROM user WHERE username = '' OR '1'='1'
// 由于 '1'='1' 恒真，等价于没有 WHERE，返回所有用户！
String sql = "SELECT * FROM user WHERE username = '" + input + "'";
Statement stmt = conn.createStatement();
stmt.executeQuery(sql);
```

**为什么 PreparedStatement 能防？** 因为参数通过 `setString` 传给数据库时，**被当作纯数据，不再参与 SQL 的语义解析**。即使用户输入 `' OR '1'='1`，它也只会被当成"要查找用户名等于这个字符串"的值，而那个字符串本身不存在，返回空结果，注入失败。

```java
// 安全的写法：参数永远是数据，不是代码
PreparedStatement ps = conn.prepareStatement("SELECT * FROM user WHERE username = ?");
ps.setString(1, "' OR '1'='1");   // 被当作普通字符串，查不到任何行
```

> 铁律：**任何来自用户的输入，都必须用 PreparedStatement 的占位符传参，绝不字符串拼接。**

## 六、事务处理

用 JDBC 手动控制事务：先关掉自动提交，执行业务，成功 `commit()`，异常 `rollback()`。下面用**转账**做完整示例：

```java
package com.canoe.db.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * JDBC 事务示例：张三给李四转 100 元，要么都成功要么都失败。
 */
public class TransactionDemo {

    private static final String URL = "jdbc:mysql://127.0.0.1:3306/shop_db?useUnicode=true&characterEncoding=utf8mb4";

    public static void main(String[] args) {
        Connection conn = null;
        try {
            conn = DriverManager.getConnection(URL, "root", "root123");
            // 1) 关闭自动提交，开启事务
            conn.setAutoCommit(false);

            // 2) 张三减 100
            PreparedStatement ps1 = conn.prepareStatement(
                    "UPDATE account SET money = money - 100 WHERE name = ?");
            ps1.setString(1, "张三");
            ps1.executeUpdate();

            // 模拟中途出错（比如余额不足校验）
            // int x = 1 / 0;

            // 3) 李四加 100
            PreparedStatement ps2 = conn.prepareStatement(
                    "UPDATE account SET money = money + 100 WHERE name = ?");
            ps2.setString(1, "李四");
            ps2.executeUpdate();

            // 4) 全部成功，提交
            conn.commit();
            System.out.println("转账成功");

        } catch (Exception e) {
            // 5) 任何异常都回滚，保证一致性
            if (conn != null) {
                try {
                    conn.rollback();
                    System.out.println("发生异常，已回滚");
                } catch (SQLException ex) {
                    ex.printStackTrace();
                }
            }
            e.printStackTrace();
        } finally {
            // 6) 关闭连接
            if (conn != null) {
                try {
                    conn.close();
                } catch (SQLException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
```

## 七、批处理

要往库里插一万条数据，一条条 `executeUpdate` 会有一万次网络往返，极慢。**批处理**把多条 SQL 攒成一批，一次性发给数据库：

```java
package com.canoe.db.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * JDBC 批处理：批量插入。
 */
public class BatchDemo {

    private static final String URL = "jdbc:mysql://127.0.0.1:3306/shop_db?useUnicode=true&characterEncoding=utf8mb4&rewriteBatchedStatements=true";

    public static void main(String[] args) throws SQLException {
        try (Connection conn = DriverManager.getConnection(URL, "root", "root123");
             PreparedStatement ps = conn.prepareStatement(
                     "INSERT INTO user (username, age) VALUES (?, ?)")) {

            // 关自动提交，整批一次性提交
            conn.setAutoCommit(false);

            for (int i = 1; i <= 10000; i++) {
                ps.setString(1, "user_" + i);
                ps.setInt(2, 18 + (i % 50));
                // 1) 加入批
                ps.addBatch();
                // 2) 每 1000 条刷一次，避免内存暴涨
                if (i % 1000 == 0) {
                    ps.executeBatch();
                    ps.clearBatch();
                }
            }
            // 刷剩余
            ps.executeBatch();
            conn.commit();
            System.out.println("批量插入完成");
        }
    }
}
```

关键点：**MySQL 连接串必须加 `rewriteBatchedStatements=true`**，否则驱动会退化成"逐条发送"，批处理等于没用。这个参数让驱动把多条 INSERT 重写合并成一条多值 INSERT，性能提升数倍。

## 八、获取自增主键

插入后想立刻拿到数据库生成的自增 id，要用 `Statement.RETURN_GENERATED_KEYS`：

```java
package com.canoe.db.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * 获取自增主键示例。
 */
public class GeneratedKeyDemo {

    private static final String URL = "jdbc:mysql://127.0.0.1:3306/shop_db?useUnicode=true&characterEncoding=utf8mb4";

    public static void main(String[] args) throws SQLException {
        try (Connection conn = DriverManager.getConnection(URL, "root", "root123");
             // 1) 声明需要返回自增主键
             PreparedStatement ps = conn.prepareStatement(
                     "INSERT INTO user (username, age) VALUES (?, ?)",
                     java.sql.Statement.RETURN_GENERATED_KEYS)) {

            ps.setString(1, "新用户");
            ps.setInt(2, 20);
            ps.executeUpdate();

            // 2) 从生成键结果集里取
            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (keys.next()) {
                    long id = keys.getLong(1);
                    System.out.println("新插入的用户 id = " + id);
                }
            }
        }
    }
}
```

## 九、结果集处理

`ResultSet` 本质是一个**游标**，初始指向第一行之前，必须 `next()` 前移；列取值可用**列名**（推荐，健壮）或**下标**（从 1 开始，快但脆弱）；日期类型用 `getDate`/`getTimestamp` 或映射到 `LocalDateTime`。

```java
package com.canoe.db.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;

/**
 * ResultSet 处理：列名取值、日期映射、NULL 判断。
 */
public class ResultSetDemo {

    private static final String URL = "jdbc:mysql://127.0.0.1:3306/shop_db?useUnicode=true&characterEncoding=utf8mb4";

    public static void main(String[] args) throws SQLException {
        try (Connection conn = DriverManager.getConnection(URL, "root", "root123");
             PreparedStatement ps = conn.prepareStatement(
                     "SELECT id, username, age, created_at FROM user WHERE id = ?")) {

            ps.setLong(1, 1);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    long id = rs.getLong("id");              // 按列名取
                    String username = rs.getString("username");
                    int age = rs.getInt("age");
                    // 处理可能为 NULL 的日期
                    LocalDateTime createdAt = null;
                    java.sql.Timestamp ts = rs.getTimestamp("created_at");
                    if (ts != null) {
                        createdAt = ts.toLocalDateTime();
                    }
                    System.out.println(id + "/" + username + "/" + age + "/" + createdAt);
                }
            }
        }
    }
}
```

> 提示：`getInt` 等基础类型遇到 NULL 会返回 0，容易掩盖空值。可用 `wasNull()` 判断，或改用 `getObject` 配合包装类型。

## 十、资源关闭

JDBC 资源（`Connection`/`Statement`/`ResultSet`）都持有底层 socket，**不关闭会耗尽连接池、撑爆文件描述符**。**必须用 try-with-resources**，它会在作用域结束自动按逆序关闭，即使抛异常也关：

```java
// 推荐：try-with-resources 自动关闭（本篇所有示例都用它）
try (Connection conn = DriverManager.getConnection(URL, USER, PASSWORD);
     PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    // 业务逻辑
} catch (SQLException e) {
    e.printStackTrace();
}
// 不用写任何 close()，编译器自动生成 finally 关闭逻辑
```

不要手动 `close()` 三件套，既啰嗦又容易在异常分支漏关。Java 7+ 的 try-with-resources 是标准答案。

## 十一、Druid 与 HikariCP

原生 JDBC 每次 `getConnection` 都是一次 **TCP 握手 + MySQL 认证 + 权限校验**，频繁建连/断连在高并发下会把数据库拖垮。所以 **JDBC 之上必须加连接池**（下一章专讲）。这里先简介两款主流连接池：

- **HikariCP**：Spring Boot 2/3 的**默认连接池**，极致轻量、性能最好。
- **Druid**：阿里开源，最大亮点是**监控**——SQL 监控、慢 SQL 统计、Web 监控页面、WallFilter 防 SQL 注入。

```java
package com.canoe.db.jdbc;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * 用 HikariCP 连接池获取连接（替代 DriverManager）。
 */
public class HikariDemo {

    public static void main(String[] args) throws SQLException {
        // 1) 配置连接池
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://127.0.0.1:3306/shop_db?useUnicode=true&characterEncoding=utf8mb4");
        config.setUsername("root");
        config.setPassword("root123");
        config.setMaximumPoolSize(10);
        config.setMinimumIdle(2);

        // 2) 创建数据源（线程安全，全局一个即可）
        DataSource dataSource = new HikariDataSource(config);

        // 3) 从池里借连接，用完自动归还（不是关闭）
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM user");
             ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                System.out.println("用户总数：" + rs.getInt(1));
            }
        }
    }
}
```

注意：从连接池拿到的 `Connection.close()` 并**不是真正关闭**，而是把连接**重置状态后归还**给池子，供下一个请求复用——这正是连接池提速的核心。

## 本篇小结

- **JDBC 是 Java 访问数据库的标准接口**，驱动实现它，是**桥接模式**的典型应用。
- **JDBC 4 起可省略 `Class.forName`**，驱动靠 SPI 自动注册。
- 三大核心接口：**`Connection` 连库、`Statement` 执行、`ResultSet` 取结果**。
- **永远用 `PreparedStatement`**，禁止字符串拼接 SQL。
- **PreparedStatement 防注入**靠"参数不参与 SQL 语义解析"。
- 事务：`setAutoCommit(false)` → 业务 → `commit()` / 异常 `rollback()`。
- 批处理用 `addBatch`/`executeBatch`，MySQL 须加 **`rewriteBatchedStatements=true`**。
- 自增主键用 **`Statement.RETURN_GENERATED_KEYS`** 取。
- `ResultSet` 是游标，用 `next()` 前移，按列名取值更健壮。
- **必须用 try-with-resources** 关闭资源，否则连接耗尽。
- JDBC 之上**必须有连接池**；HikariCP 是 Spring Boot 默认，Druid 监控强。

## 参考链接

- [JDBC 官方教程（Oracle）](https://docs.oracle.com/javase/tutorial/jdbc/)
- [MySQL Connector/J 官方文档](https://dev.mysql.com/doc/connector-j/en/)
- [HikariCP GitHub](https://github.com/brettwooldridge/HikariCP)
- [Druid GitHub](https://github.com/alibaba/druid)
- [PreparedStatement 官方 Javadoc](https://docs.oracle.com/javase/8/docs/api/java/sql/PreparedStatement.html)
- [丁奇《MySQL 实战45讲》](https://time.geekbang.org/column/intro/100020801)

下一篇 → [08 连接池](/java/db/pool)
