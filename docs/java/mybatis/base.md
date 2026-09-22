# 01 MyBatis 入门

MyBatis 是国内 Java 后端最主流的持久层框架。本篇先回答"它是什么、解决了什么"，再带你从零跑通一个 MyBatis 程序，并讲清它的架构分层、`#{}` 与 `${}` 的区别、自增主键等必考知识点。

## 一、MyBatis 是什么

MyBatis 是一个**半自动 ORM 框架**：你写 SQL，它负责把 SQL 参数绑到 Java 对象、把结果集映射回 Java 对象。

对比一下全自动 ORM（以 Hibernate / JPA 为代表）：

| 维度 | Hibernate / JPA（全自动） | MyBatis（半自动） |
| --- | --- | --- |
| SQL | 框架自动生成，几乎不用写 | **自己写 SQL** |
| 灵活度 | 复杂查询（多表、窗口函数）很难调优 | **完全可控，想怎么写怎么写** |
| 学习成本 | 要学 HQL、一级二级缓存、脏检查等一套体系 | 会 SQL 就能上手 |
| 性能调优 | 生成的 SQL 可能很"傻"，难干预 | **SQL 透明，DBA 也能一起优化** |

为什么国内互联网公司普遍选 MyBatis？一句话：**业务复杂、SQL 要精细调优、DBA 要 review SQL**。全自动 ORM 在简单 CRUD 上省事，但遇到多表关联、分页、统计报表时，生成的 SQL 往往不如手写的高效，出了问题也不好排查。MyBatis 把 SQL 交还给你，反而最贴合国内"重 SQL"的开发现状。

## 二、ORM 是什么

ORM（Object Relational Mapping，对象关系映射）解决的是**"Java 对象和数据库表对不上"**的问题。

数据库是"表/行/列"的世界，Java 是"对象/属性"的世界，两者之间存在经典的**"阻抗不匹配（impedance mismatch）"**：

- 表的一行对应一个对象，但对象之间还有继承、关联（一对多、多对多），表里没有；
- Java 有 `List<String>`、自定义类，数据库列只有 int / varchar / datetime；
- 对象间的引用关系，在表里只能用外键 + JOIN 表达。

ORM 框架的价值，就是替你搬这块砖：**把 `ResultSet` 一行行塞进 Java 对象、把对象的属性拆成 SQL 参数**。MyBatis 用 `resultType`/`resultMap` 做"行→对象"映射，用 `#{}` 做"对象→参数"映射。

## 三、MyBatis 的架构

MyBatis 的运行是一条清晰的调用链，从构建工厂到真正执行 SQL：

```text
SqlSessionFactoryBuilder  （读配置，一次性，方法级）
        |
        v
SqlSessionFactory         （全局单例，应用级）
        |
        v
SqlSession                （一次会话，线程不安全！用完即关）
        |
        v
Executor                  （执行器，真正跑 SQL）
        |
        v
MappedStatement            （一条 SQL 的封装：SQL、入参、出参映射）
        |
        v
      JDBC Statement  ->  DB
```

各组件生命周期很关键：

- **`SqlSessionFactoryBuilder`**：用来读取 `mybatis-config.xml` 并构建出 `SqlSessionFactory`，用完就丢，**方法级**。
- **`SqlSessionFactory`**：重量级对象，创建成本高，**整个应用应当只有一个（单例）**。
- **`SqlSession`**：代表一次数据库会话，**线程不安全**，绝对不能做成成员变量或跨线程共享，**用 `try-with-resources` 或 `finally` 用完即关**。
- **`Executor` / `MappedStatement`**：框架内部组件，你一般不直接碰。

## 四、快速上手

下面是从零跑通的最小示例。

**1) Maven 依赖**

```xml
<dependencies>
    <!-- MyBatis 核心 -->
    <dependency>
        <groupId>org.mybatis</groupId>
        <artifactId>mybatis</artifactId>
        <version>3.5.14</version>
    </dependency>
    <!-- 数据库驱动（以 MySQL 为例） -->
    <dependency>
        <groupId>com.mysql</groupId>
        <artifactId>mysql-connector-j</artifactId>
        <version>8.3.0</version>
    </dependency>
</dependencies>
```

**2) `mybatis-config.xml`（核心配置）**

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE configuration PUBLIC
        "-//mybatis.org//DTD Config 3.0//EN"
        "https://mybatis.org/dtd/mybatis-3-config.dtd">
<configuration>
    <environments default="dev">
        <environment id="dev">
            <transactionManager type="JDBC"/>
            <!-- dataSource：连接池，这里用 MyBatis 内置的 POOLED -->
            <dataSource type="POOLED">
                <property name="driver" value="com.mysql.cj.jdbc.Driver"/>
                <property name="url" value="jdbc:mysql://localhost:3306/canoe"/>
                <property name="username" value="root"/>
                <property name="password" value="root"/>
            </dataSource>
        </environment>
    </environments>
    <!-- mappers：告诉 MyBatis 去哪找 SQL 映射文件 -->
    <mappers>
        <mapper resource="mapper/UserMapper.xml"/>
    </mappers>
</configuration>
```

**3) `UserMapper.xml`（SQL 映射）**

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper PUBLIC
        "-//mybatis.org//DTD Mapper 3.0//EN"
        "https://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.canoe.mybatis.base.UserMapper">
    <select id="selectById" resultType="com.canoe.mybatis.base.User">
        SELECT id, username, age FROM user WHERE id = #{id}
    </select>
</mapper>
```

**4) 实体与 Mapper 接口 + 测试代码**

```java
package com.canoe.mybatis.base;

public class User {
    private Long id;
    private String username;
    private Integer age;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public Integer getAge() {
        return age;
    }

    public void setAge(Integer age) {
        this.age = age;
    }

    @Override
    public String toString() {
        return "User{id=" + id + ", username='" + username + "', age=" + age + "}";
    }
}
```

```java
package com.canoe.mybatis.base;

import java.util.List;

/** Mapper 接口：方法名要对应 XML 里的 id */
public interface UserMapper {
    User selectById(Long id);
}
```

```java
package com.canoe.mybatis.base;

import java.io.InputStream;
import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;

public class QuickStart {

    public static void main(String[] args) throws Exception {
        // 1. 读配置，构建工厂（应用级单例）
        String resource = "mybatis-config.xml";
        InputStream input = Resources.getResourceAsStream(resource);
        SqlSessionFactory factory =
                new SqlSessionFactoryBuilder().build(input);

        // 2. 开会话（线程不安全，用完关）
        try (SqlSession session = factory.openSession()) {
            UserMapper mapper = session.getMapper(UserMapper.class);
            User user = mapper.selectById(1L);
            System.out.println(user);
        }
    }
}
```

## 五、两种使用方式

MyBatis 写 SQL 有两条路：

- **XML 配置**：SQL 写在 `xxxMapper.xml` 里，和 Java 代码解耦，复杂 SQL（动态 SQL、长 SQL）维护最舒服，**推荐用于绝大多数业务**。
- **注解**：在 Mapper 接口方法上直接写 `@Select` / `@Insert` / `@Update` / `@Delete`，简单 SQL 不用切文件，但**动态 SQL 写在注解里可读性差**。

```java
package com.canoe.mybatis.base;

import org.apache.ibatis.annotations.Select;

public interface AnnotationUserMapper {

    // 简单查询用注解很清爽
    @Select("SELECT id, username, age FROM user WHERE id = #{id}")
    User selectById(Long id);

    // 复杂动态 SQL 仍建议放 XML
}
```

选择建议：**简单 CRUD 注解也行，凡是有 `<if>`/`<foreach>`/多表 JOIN 的，老老实实写 XML。**

## 六、Spring Boot 集成

真实项目不会手写 `SqlSessionFactory`，而是用 `mybatis-spring-boot-starter`（或 `mybatis-plus-boot-starter`）自动装配。

**依赖：**

```xml
<dependency>
    <groupId>org.mybatis.spring.boot</groupId>
    <artifactId>mybatis-spring-boot-starter</artifactId>
    <version>3.0.3</version>
</dependency>
```

**`application.yml` 关键配置：**

```yaml
mybatis:
  # Mapper XML 的位置（扫描路径）
  mapper-locations: classpath*:mapper/**/*.xml
  # 实体类别名包（Mapper 里可直接写类名，不用全限定名）
  type-aliases-package: com.canoe.mybatis.base
  configuration:
    # 下划线转驼峰，必开！否则 user_name 映射不到 userName
    map-underscore-to-camel-case: true
    # 日志实现，便于看到真实执行的 SQL
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
```

**注册 Mapper 的两种方式：**

- 在每个接口上标 `@Mapper`：
  ```java
  @Mapper
  public interface UserMapper { ... }
  ```
- 或在启动类上统一扫包（更省事，**推荐**）：
  ```java
  @MapperScan("com.canoe.mybatis.base")
  @SpringBootApplication
  public class Application { ... }
  ```

## 七、核心配置详解

`configuration` 里常用几项：

| 配置项 | 作用 | 建议 |
| --- | --- | --- |
| `mapUnderscoreToCamelCase` | 下划线列名自动转驼峰属性 | **必开 true**，否则 `user_name` 映射不到 `userName` |
| `log-impl` | 日志实现（如 `StdOutImpl`） | 开发期开 `StdOutImpl` 看 SQL，生产关掉 |
| `lazyLoadingEnabled` | 是否开启延迟加载 | 按需开，缓解 N+1 |
| `defaultExecutorType` | 默认执行器：`SIMPLE`/`REUSE`/`BATCH` | 默认 `SIMPLE` 即可，批量用 `BATCH` |

其中最常被忘的就是 `mapUnderscoreToCamelCase`——开了它，你才不用给每个字段写 `resultMap` 或 SQL 别名。

## 八、生命周期与作用域

再强调一遍作用域，踩错会出并发 bug：

```text
SqlSessionFactoryBuilder  →  方法级（用完即丢）
SqlSessionFactory        →  应用级（单例，全局一个）
SqlSession               →  请求/方法级（线程不安全，用完关）
Mapper 实例              →  方法级（由 SqlSession 创建）
```

`SqlSession` 内部持有数据库连接和执行器，**不是线程安全的**。把它声明成 `static` 字段或在线程间共享，会出现"张三的查询返回了李四的数据"这种诡异问题。Spring 集成后，每次请求都会从 `SqlSessionTemplate` 拿到独立的会话，你通常感知不到，但自己手写原生 MyBatis 时务必注意。

## 九、#{} 与 ${} 的区别

这是 MyBatis 面试第一题。

- **`#{}`：预编译占位符。** MyBatis 把它替换成 `?`，靠 `PreparedStatement` 设参数，**自动做类型转换和转义，防 SQL 注入**。绝大多数场景用它。
- **`${}`：字符串拼接。** 把值原样拼进 SQL 文本，**不做任何转义，有注入风险**。

```java
package com.canoe.mybatis.base;

import org.apache.ibatis.annotations.Select;

public interface InjectMapper {

    // 安全：#{} 预编译，参数作为值传入
    @Select("SELECT * FROM user WHERE username = #{name}")
    User safeFind(String name);

    // 危险：${} 直接拼接，若 name = "' OR '1'='1" 会被注入
    // @Select("SELECT * FROM user WHERE username = '${name}'")
    // User unsafeFind(String name);
}
```

`${}` 什么时候**不得不用**？当要替换的是"SQL 结构"而非"值"时：

- **动态表名**：`SELECT * FROM ${tableName}`（表名不能是 `?` 参数）；
- **动态排序字段**：`ORDER BY ${column}`（排序字段也不能是 `?`）。

用 `${}` 的安全姿势——**白名单校验**，绝不接收用户自由输入：

```java
package com.canoe.mybatis.base;

import java.util.Arrays;
import java.util.List;

public class OrderColumnGuard {

    // 允许排序的字段白名单
    private static final List<String> ALLOWED = Arrays.asList("id", "age", "create_time");

    public static String guard(String column) {
        if (!ALLOWED.contains(column)) {
            throw new IllegalArgumentException("非法排序字段：" + column);
        }
        return column; // 通过后才是安全的 ${column}
    }
}
```

## 十、获取自增主键

插入后想拿回数据库生成的自增 `id`，用 `useGeneratedKeys="true"` + `keyProperty`：

```xml
<insert id="insertUser" useGeneratedKeys="true" keyProperty="id">
    INSERT INTO user(username, age) VALUES(#{username}, #{age})
</insert>
```

插入完成后，传入的 `User` 对象的 `id` 字段会被自动回填，直接 `user.getId()` 就能拿到。MySQL 靠 `AUTO_INCREMENT`，PostgreSQL 等可用 `keyColumn` 指定序列列。

## 十一、日志与 SQL 打印

看不到 SQL，排查就像盲人摸象。几种办法：

- 配 `configuration.log-impl: org.apache.ibatis.logging.stdout.StdOutImpl`，SQL 直接打到控制台（开发期最方便）；
- 用 **P6Spy** 代理驱动，打印带参数的"真实 SQL"（把 `?` 替换成实际值），生产也能用且性能友好；
- IDEA 装 **MyBatisX** 插件：点击接口方法左边的小鸟图标直接跳到对应 XML，反向也能跳。

## 本篇小结

- MyBatis 是**半自动 ORM**：自己写 SQL，框架做参数绑定与结果映射。
- 相比 Hibernate，**MyBatis 的 SQL 透明可控、利于调优**，契合国内重 SQL 现状。
- ORM 解决的是**对象与表之间的"阻抗不匹配"**问题。
- 调用链：**`SqlSessionFactoryBuilder` → `SqlSessionFactory`(单例) → `SqlSession`(线程不安全) → `Executor` → `MappedStatement`**。
- **`SqlSession` 必须用完即关，绝不能跨线程共享**。
- 写 SQL 有 **XML 与注解两种方式**，复杂 SQL 用 XML。
- `mapUnderscoreToCamelCase` **必开**，否则下划线列映射不到驼峰属性。
- **`#{}` 预编译防注入，`${}` 拼接有注入风险**。
- **`${}` 仅用于动态表名/排序字段，且必须白名单校验**。
- `useGeneratedKeys="true"` + `keyProperty` 可**回填自增主键**。
- 看 SQL 用 **`StdOutImpl` / P6Spy / MyBatisX 插件**。

## 参考链接

- [MyBatis 官方文档（英文）](https://mybatis.org/mybatis-3/)
- [MyBatis 官方文档（XML 映射）](https://mybatis.org/mybatis-3/sqlmap-xml.html)
- [MyBatis Spring Boot Starter](https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/)
- [MyBatis GitHub 仓库](https://github.com/mybatis/mybatis-3)
- [MySQL Connector/J 官方文档](https://dev.mysql.com/doc/connector-j/en/)
- [Baeldung：MyBatis 入门](https://www.baeldung.com/mybatis)
- [P6Spy 官方文档](https://p6spy.readthedocs.io/)

下一篇 → [02 Mapper 与 XML](/java/mybatis/mapper)
