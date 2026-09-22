# 02 Mapper 与 XML

上篇跑通了最小示例，本篇深入 Mapper 层：为什么一个"只有接口、没有实现类"的 `UserMapper` 能直接调用？XML 该怎么写？参数怎么传？结果怎么映射？一对多、多对多怎么查？分页和常见报错又有哪些坑？

## 一、Mapper 接口的设计

MyBatis 的 Mapper 是**接口**，你从来不写实现类，却能在代码里 `userMapper.selectById(1L)` 直接调。秘密在于 **JDK 动态代理**：MyBatis 在运行时为你的接口生成了一个代理实现，方法被调用时，代理根据"接口全限定名 + 方法名"去匹配 XML 里 `namespace` + `id` 对应的 SQL，执行并映射结果。

```text
你调用：userMapper.selectById(1L)
        |
        v
MyBatis 动态代理（Proxy）
        |
        v  按 "namespace + 方法名" 找 SQL
        |
        v
UserMapper.xml 中 <select id="selectById" ...>
        |
        v
执行 JDBC、把 ResultSet 映射成 User 返回
```

为什么没有实现类也能用？因为接口只是"契约"（方法签名），真正的行为由代理 + XML 提供。**这也呼应了代理模式篇：接口定义能力、代理负责把调用转到实际逻辑。**

## 二、XML 映射文件结构

一个 Mapper XML 的核心结构：

- **`<mapper namespace="...">`**：**必须与 Mapper 接口的全限定名完全一致**，否则代理找不到 SQL。
- **`<select>` / `<insert>` / `<update>` / `<delete>`**：四个语句标签，常用属性：

| 属性 | 作用 |
| --- | --- |
| `id` | 语句唯一标识，对应接口方法名 |
| `parameterType` | 入参类型（可省略，MyBatis 能推断） |
| `resultType` | 返回的单条结果类型（自动映射） |
| `resultMap` | 引用一个 `<resultMap>`（手动映射） |
| `flushCache` | 执行前是否清空缓存（增删改默认 `true`） |
| `useCache` | 结果是否进二级缓存（select 默认 `true`） |
| `timeout` | 超时秒数 |
| `statementType` | `STATEMENT` / `PREPARED`（默认，预编译）/ `CALLABLE` |

```xml
<mapper namespace="com.canoe.mybatis.mapper.UserMapper">
    <select id="selectById" resultType="com.canoe.mybatis.mapper.User">
        SELECT id, username, age FROM user WHERE id = #{id}
    </select>
</mapper>
```

## 三、参数传递

参数怎么传，是最容易报 `Parameter 'xxx' not found` 的地方。逐个看：

**单个基本类型**：直接 `#{任意名}`（MyBatis 不校验名字）。

**多个参数**：必须加 **`@Param`**，否则 XML 里只能用 `arg0`/`param1` 这种反人类名字，编译器也不会帮你检查。

```java
package com.canoe.mybatis.mapper;

import java.util.List;
import org.apache.ibatis.annotations.Param;

public interface UserMapper {

    // 单个基本类型
    User selectById(Long id);

    // 多个参数：必须 @Param，否则 XML 找不到 username/age
    List<User> selectByCond(@Param("username") String username,
                            @Param("age") Integer age);

    // JavaBean 参数：XML 里直接用属性名 #{username} #{age}
    List<User> selectByBean(User user);

    // Map 参数：XML 用 key
    List<User> selectByMap(java.util.Map<String, Object> params);

    // 集合/数组参数：@Param 后 XML 用 collection/list/array
    List<User> selectByIds(@Param("ids") List<Long> ids);
}
```

```xml
<select id="selectByCond" resultType="com.canoe.mybatis.mapper.User">
    SELECT * FROM user
    WHERE username = #{username} AND age = #{age}
</select>

<select id="selectByIds" resultType="com.canoe.mybatis.mapper.User">
    SELECT * FROM user
    WHERE id IN
    <foreach collection="ids" item="id" open="(" close=")" separator=",">
        #{id}
    </foreach>
</select>
```

**参数方式速查表：**

| 入参形式 | XML 中引用 | 注意 |
| --- | --- | --- |
| 单个基本类型 | `#{任意}` | 名字随意 |
| 多个基本类型 | `#{@Param名字}` | **必须 `@Param`** |
| JavaBean | `#{属性名}` | 走 getter |
| `Map` | `#{key}` | 走 map.get |
| `List`/`数组` | `#{集合名}` + `<foreach>` | `@Param` 指定，XML 用该名 |

## 四、resultType vs resultMap

- **`resultType`**：告诉 MyBatis "结果就是这种类型"，框架按**列名 = 属性名**（或驼峰）自动设值。简单、省事，但**列名和属性名不一致就映射不上**。
- **`resultMap`**：手写一张"列 → 属性"的映射表，能处理列名不一致、嵌套对象（`association`）、集合（`collection`）。灵活但啰嗦。

```xml
<!-- resultType：列名与属性名一致/已开驼峰，直接映射 -->
<select id="selectById" resultType="com.canoe.mybatis.mapper.User">
    SELECT id, username, age FROM user WHERE id = #{id}
</select>

<!-- resultMap：列名不一致（user_name -> userName）时手动指定 -->
<resultMap id="userMap" type="com.canoe.mybatis.mapper.User">
    <id column="user_id" property="id"/>
    <result column="user_name" property="username"/>
    <result column="user_age" property="age"/>
</resultMap>
<select id="selectById2" resultMap="userMap">
    SELECT user_id, user_name, user_age FROM user WHERE user_id = #{id}
</select>
```

## 五、ResultMap 详解

`<resultMap>` 的子标签：

- `<id>`：主键映射，**用于缓存的 identity 比较**，比 `<result>` 更重要；
- `<result>`：普通列；
- `<constructor>`：用构造器注入（适合不可变对象）；
- `<association>`：**一对一**嵌套对象；
- `<collection>`：**一对多**嵌套集合。

一对多完整示例——"订单 + 订单项"：

```xml
<resultMap id="orderMap" type="com.canoe.mybatis.mapper.Order">
    <id column="id" property="id"/>
    <result column="order_no" property="orderNo"/>
    <!-- 一对多：一个订单含多个订单项 -->
    <collection property="items"
                ofType="com.canoe.mybatis.mapper.OrderItem">
        <id column="item_id" property="id"/>
        <result column="product_name" property="productName"/>
        <result column="qty" property="qty"/>
    </collection>
</resultMap>

<select id="selectOrderWithItems" resultMap="orderMap">
    SELECT o.id, o.order_no,
           i.id AS item_id, i.product_name, i.qty
    FROM orders o
    LEFT JOIN order_item i ON i.order_id = o.id
    WHERE o.id = #{id}
</select>
```

## 六、嵌套查询与嵌套结果

查关联对象有两种套路，性能差异巨大：

**嵌套查询（Nested Query）**：主查询查出订单，再用 `<association select="...">` 为每条订单**再发一条 SQL** 查用户。问题明显——N 条订单就发 N+1 条 SQL，即经典的 **N+1 问题**。

**嵌套结果（Nested Result）**：用一条 `JOIN` SQL 把订单和用户**一次查出来**，MyBatis 按 `resultMap` 自己分组装配。只发 1 条 SQL，性能最好。

```text
嵌套查询：SELECT 订单(1条) → 循环 N 次 SELECT 用户  = N+1 条 SQL  ❌
嵌套结果：SELECT 订单 JOIN 用户(1条) → MyBatis 分组   = 1 条 SQL     ✅
```

选择建议：**优先嵌套结果（一条 JOIN）**；只有在"关联数据很大、主表很小"时才考虑嵌套查询，并用**延迟加载**缓解 N+1。

## 七、延迟加载

延迟加载（Lazy Loading）：关联对象**等真正用到时才去查**，避免一上来就把所有关联都查出来。开关：

- `lazyLoadingEnabled=true`：开启延迟加载；
- `aggressiveLazyLoading`：是否"碰一下就加载所有懒属性"。**JDK 8 之后该值默认 `false`**（即按需加载），早期版本默认 `true`，这是个升级时容易踩的坑。

配合第六节的嵌套查询，延迟加载能让"只访问订单、不访问用户"时不发那条用户 SQL，从而缓解 N+1。

## 八、自动映射的三种模式

`autoMappingBehavior` 控制 MyBatis 自动把列映射到属性的激进程度：

| 模式 | 行为 |
| --- | --- |
| `NONE` | 完全不自动映射，所有列必须手写 `resultMap` |
| `PARTIAL`（默认） | 自动映射简单属性，**遇到嵌套（association/collection）就停止自动映射该层** |
| `FULL` | 无论嵌套多深都尝试自动映射 |

一般保持默认 `PARTIAL` 即可；用了 `resultMap` 又想全自动填简单字段时，`FULL` 更省事，但要小心列名冲突。

## 九、列名与属性名映射

三种让 `user_name` → `userName` 对上的方案：

1. **SQL 别名**：`SELECT user_name AS userName ...`（直观但每个 SQL 都要写）；
2. **开驼峰自动映射**：`mapUnderscoreToCamelCase=true`（**推荐，一劳永逸**）；
3. **`resultMap` 手动映射**：`<result column="user_name" property="userName"/>`（最灵活，处理复杂映射）。

实际项目里：**全局开驼峰 + 个别不一致处用 `resultMap`**，是最省心的组合。

## 十、多表关联查询

三个完整例子：

**一对一（用户 + 身份证）：**

```xml
<resultMap id="userCardMap" type="com.canoe.mybatis.mapper.User">
    <id column="id" property="id"/>
    <result column="username" property="username"/>
    <association property="card"
                 javaType="com.canoe.mybatis.mapper.IdCard">
        <id column="card_id" property="id"/>
        <result column="card_no" property="cardNo"/>
    </association>
</resultMap>
<select id="selectUserWithCard" resultMap="userCardMap">
    SELECT u.id, u.username, c.id AS card_id, c.card_no
    FROM user u LEFT JOIN id_card c ON c.user_id = u.id
    WHERE u.id = #{id}
</select>
```

**一对多（订单 + 订单项）**：见第五节 `<collection>` 示例。

**多对多（用户 + 角色）**：靠中间表 `user_role` 连接，本质是两次一对多：

```xml
<resultMap id="userRoleMap" type="com.canoe.mybatis.mapper.User">
    <id column="id" property="id"/>
    <collection property="roles" ofType="com.canoe.mybatis.mapper.Role">
        <id column="role_id" property="id"/>
        <result column="role_name" property="roleName"/>
    </collection>
</resultMap>
<select id="selectUserWithRoles" resultMap="userRoleMap">
    SELECT u.id, r.id AS role_id, r.role_name
    FROM user u
    LEFT JOIN user_role ur ON ur.user_id = u.id
    LEFT JOIN role r ON r.id = ur.role_id
    WHERE u.id = #{id}
</select>
```

## 十一、分页

**`RowBounds` 是内存分页**：它先查出**所有**符合条件的行，再在内存里截取你要的那一页——数据量大时就是灾难，**生产禁用**。

正确做法是用 **PageHelper** 插件（或 MyBatis-Plus 的分页插件），它在 SQL 发出前**自动改写 SQL 加上 `LIMIT`**，是真正的物理分页。

```xml
<dependency>
    <groupId>com.github.pagehelper</groupId>
    <artifactId>pagehelper-spring-boot-starter</artifactId>
    <version>1.4.7</version>
</dependency>
```

```java
package com.canoe.mybatis.mapper;

import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import java.util.List;

public class PageDemo {

    // 紧跟查询方法前调用 startPage，PageHelper 才会改写这条 SQL
    public PageInfo<User> page(int pageNum, int pageSize) {
        PageHelper.startPage(pageNum, pageSize);
        List<User> list = userMapper.selectAll(); // 这一行被自动 LIMIT 改写
        return new PageInfo<User>(list); // 内含 total、pages 等分页信息
    }

    private UserMapper userMapper;
}
```

**注意事项**：`startPage` **必须紧挨着查询方法**，中间插别的查询会被"误伤"；拿到 `PageInfo` 后**不要再对 `list` 做二次过滤**，否则分页总数和实际数据对不上。

## 十二、常见报错

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `BindingException: Parameter 'xxx' not found` | 多参数没加 `@Param` | 给接口参数加 `@Param("xxx")` |
| `Invalid bound statement (not found)` | XML 没被扫描到 | 检查 `mapper-locations` 路径，且 XML 的 `namespace` 与接口全限定名一致、`id` 与方法名一致 |
| `TooManyResultsException` | 返回多条却用 `User` 接收 | 改用 `List<User>` 或加 `LIMIT 1` |
| `Mapped Statements collection does not contain value` | 调了不存在的 statement | 核对 `id` 拼写 |
| 属性为 `null` | 列名与属性名不一致且没开驼峰 | 开 `mapUnderscoreToCamelCase` 或写 `resultMap` |

## 本篇小结

- Mapper 接口靠 **JDK 动态代理**生成实现，无需手写实现类。
- XML 的 **`namespace` 必须 = 接口全限定名**，`id` = 方法名才能匹配。
- 多个参数**必须加 `@Param`**，否则报 `Parameter not found`。
- 参数形式速查：单值随意、多值 `@Param`、Bean 用属性、集合用 `<foreach>`。
- **`resultType` 自动映射，`resultMap` 手动映射**（列名不一致/嵌套）。
- **一对一用 `<association>`，一对多用 `<collection>`**。
- 关联查询优先**嵌套结果（一条 JOIN）**，别用嵌套查询踩 N+1。
- 延迟加载 `aggressiveLazyLoading` **JDK 8 后默认 `false`**（按需加载）。
- 列名映射三方案：**SQL 别名 / 开驼峰（推荐）/ resultMap**。
- **`RowBounds` 是内存分页，生产禁用**；用 PageHelper 做物理分页。
- `startPage` **必须紧跟查询方法**，且别对结果二次过滤。

## 参考链接

- [MyBatis 官方文档：Mapper XML](https://mybatis.org/mybatis-3/sqlmap-xml.html)
- [MyBatis 官方文档：Java API（SqlSession / Mapper）](https://mybatis.org/mybatis-3/java-api.html)
- [MyBatis 官方文档：Result Maps](https://mybatis.org/mybatis-3/sqlmap-xml.html#Result_Maps)
- [PageHelper 官方文档](https://github.com/pagehelper/Mybatis-PageHelper)
- [MyBatis Spring 官方文档](https://mybatis.org/spring/docs.html)
- [Baeldung：MyBatis Mapper 详解](https://www.baeldung.com/mybatis)
- [MyBatis GitHub 仓库](https://github.com/mybatis/mybatis-3)

下一篇 → [03 动态 SQL](/java/mybatis/dynamic-sql)
