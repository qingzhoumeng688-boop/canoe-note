# 03 动态 SQL

上篇的 SQL 都是写死的，但真实业务里"条件查询""批量操作"的 SQL 结构是变化的。本篇讲 MyBatis 的九大动态 SQL 标签，以及 MyBatis-Plus 的条件构造器，帮你告别在 Java 里拼字符串的痛苦。

## 一、为什么需要动态 SQL

先看看"不用动态 SQL"有多惨。比如一个用户列表查询，前端可能只传用户名、只传年龄、或都不传。你若在 Java 里拼：

```java
package com.canoe.mybatis.dynamicsql;

import java.util.ArrayList;
import java.util.List;

public class BadConcat {

    // 丑陋且易错的手工拼 SQL：一堆 if + 空格 + 逗号 + AND
    public static String buildSql(String username, Integer age) {
        StringBuilder sql = new StringBuilder("SELECT * FROM user WHERE 1=1");
        List<Object> params = new ArrayList<Object>();
        if (username != null) {
            sql.append(" AND username = ?");
            params.add(username);
        }
        if (age != null) {
            sql.append(" AND age = ?");
            params.add(age);
        }
        return sql.toString();
    }
}
```

问题：要自己处理 `AND` 要不要加、逗号、空格，稍不留神就多一个 `AND` 或漏一个逗号，SQL 直接报错。**动态 SQL 标签就是来解决"按条件拼 SQL"这件恶心事的。**

## 二、`<if>`

`<if test="...">` 按条件决定是否拼接一段 SQL。`test` 里是 **OGNL 表达式**，几个常见坑：

- 判断字符串非空要**同时判 `!= null` 和 `!= ''`**（空串也要排除）；
- 判断字符串相等用 `==` 或 `.equals()`；
- **数字 `0` 在 OGNL 里被当成 `false`**，所以判数字别写 `test="status"`（传 0 会被跳过），要写 `test="status != null"`。

```xml
<select id="selectByCond" resultType="com.canoe.mybatis.dynamicsql.User">
    SELECT * FROM user
    WHERE 1 = 1
    <if test="username != null and username != ''">
        AND username = #{username}
    </if>
    <if test="age != null">
        AND age = #{age}
    </if>
</select>
```

常见错误：只写 `<if test="username">` 而 `username` 是空串时仍为真（空串非 `null`），会拼出 `AND username = ''` 的脏条件。

## 三、`<where>`

`<where>` 专门解决"开头的 AND/OR 去不掉"的问题：它会在**有内容时自动加 `WHERE` 关键字，并智能去掉首部的 `AND`/`OR`**。这样就能丢掉丑陋的 `WHERE 1=1`。

```xml
<!-- 用 <where>，首部 AND 自动被吃掉 -->
<select id="selectByCond" resultType="com.canoe.mybatis.dynamicsql.User">
    SELECT * FROM user
    <where>
        <if test="username != null and username != ''">
            AND username = #{username}
        </if>
        <if test="age != null">
            AND age = #{age}
        </if>
    </where>
</select>
```

前后对比：没有 `<where>` 时，若只满足第二个条件，SQL 会变成 `... WHERE AND age = ?`（语法错误）；用 `<where>` 后自动变成 `... WHERE age = ?`。

## 四、`<trim>`

`<trim>` 是 `<where>` 和 `<set>` 的"底层通用版"，四个属性：

- `prefix`：拼装结果前加的前缀（如 `WHERE`）；
- `suffix`：拼装结果后加的后缀；
- `prefixOverrides`：去掉首部多余的指定内容（如 `AND |OR`）；
- `suffixOverrides`：去掉尾部多余的指定内容（常用于逗号）。

`<where>` 本质就是 `<trim prefix="WHERE" prefixOverrides="AND |OR">`，`<set>` 本质是 `<trim prefix="SET" suffixOverrides=",">`。

```xml
<!-- 用 trim 手写一个 where（等价于 <where>） -->
<trim prefix="WHERE" prefixOverrides="AND |OR">
    <if test="username != null">
        AND username = #{username}
    </if>
</trim>

<!-- suffixOverrides="," 去掉尾部多余逗号 -->
<trim suffixOverrides=",">
    name = #{name},
    age = #{age},
</trim>
```

## 五、`<set>`

`<set>` 用于 `UPDATE`，自动加 `SET` 并**去掉末尾多余的逗号**——手工拼更新语句最怕末尾多一个逗号导致 SQL 报错。

```xml
<update id="updateUser">
    UPDATE user
    <set>
        <if test="username != null">username = #{username},</if>
        <if test="age != null">age = #{age},</if>
    </set>
    WHERE id = #{id}
</update>
```

如果 `username`/`age` 都为 `null`，`<set>` 内为空，MyBatis 会**不生成 SET 子句**（注意此时整条 SQL 会变成 `UPDATE user WHERE id=?` 而报错，所以更新至少要保证一个字段有值，或在业务层校验）。

## 六、`<choose>` / `<when>` / `<otherwise>`

相当于 Java 的 `switch-case` / `if-else if`，**只执行第一个满足条件的分支**，都不满足走 `<otherwise>`。适合"多条件互斥、取其一"的场景。

```xml
<select id="selectByPriority" resultType="com.canoe.mybatis.dynamicsql.User">
    SELECT * FROM user
    <where>
        <choose>
            <when test="id != null">
                AND id = #{id}
            </when>
            <when test="username != null">
                AND username = #{username}
            </when>
            <otherwise>
                AND age >= 18
            </otherwise>
        </choose>
    </where>
</select>
```

## 七、`<foreach>`

`<foreach>` 用来遍历集合，做 `IN` 查询、批量插入、批量更新。六个属性逐个讲：

| 属性 | 含义 |
| --- | --- |
| `collection` | 被遍历的集合名（对应 `@Param`，或 `list`/`array`） |
| `item` | 当前元素变量名 |
| `index` | 当前下标（List 是序号，Map 是 key） |
| `open` | 拼装整体前的起始符号，如 `(` |
| `close` | 拼装整体后的结束符号，如 `)` |
| `separator` | 元素之间的分隔符，如 `,` |

**1) `IN` 查询（最常用）：**

```xml
<select id="selectByIds" resultType="com.canoe.mybatis.dynamicsql.User">
    SELECT * FROM user
    WHERE id IN
    <foreach collection="ids" item="id" open="(" close=")" separator=",">
        #{id}
    </foreach>
</select>
```

**2) 批量插入：**

```xml
<insert id="batchInsert">
    INSERT INTO user(username, age) VALUES
    <foreach collection="list" item="u" separator=",">
        (#{u.username}, #{u.age})
    </foreach>
</insert>
```

配合 MySQL 驱动参数 **`rewriteBatchedStatements=true`**（加在 JDBC url 后），驱动会把多条 `INSERT` 重写成一条多值 `INSERT` 发给 MySQL，**批量性能提升数倍**。不加这个参数，即使批量插入也退化成逐条执行。

**3) 批量更新（用 `foreach` + `case when`）：**

```xml
<update id="batchUpdateAge">
    UPDATE user SET age = CASE id
    <foreach collection="list" item="u">
        WHEN #{u.id} THEN #{u.age}
    </foreach>
    END
    WHERE id IN
    <foreach collection="list" item="u" open="(" close=")" separator=",">
        #{u.id}
    </foreach>
</update>
```

## 八、`<bind>`

`<bind>` 在上下文里创建一个变量，常用于**模糊查询拼接 `%`**，避免在 SQL 里直接写 `'%${name}%'`（既丑又有注入风险）。

```xml
<select id="likeName" resultType="com.canoe.mybatis.dynamicsql.User">
    <bind name="pattern" value="'%' + name + '%'"/>
    SELECT * FROM user WHERE username LIKE #{pattern}
</select>
```

`name` 来自入参，`<bind>` 把它包成 `%name%` 存进 `pattern`，再用 `#{pattern}` 安全传参。

## 九、`<sql>` 与 `<include>`

`<sql>` 定义可复用的 SQL 片段，`<include>` 引用它，**避免到处写 `SELECT *`、统一公共列**。

```xml
<!-- 抽取公共查询列，杜绝 SELECT * -->
<sql id="Base_Column">id, username, age, create_time</sql>

<select id="selectById" resultType="com.canoe.mybatis.dynamicsql.User">
    SELECT <include refid="Base_Column"/>
    FROM user WHERE id = #{id}
</select>

<select id="selectAll" resultType="com.canoe.mybatis.dynamicsql.User">
    SELECT <include refid="Base_Column"/>
    FROM user
</select>
```

最佳实践：**所有查询都引用 `Base_Column`**，以后加字段只改一处，还能避免 `SELECT *` 带来的列顺序/覆盖问题。

## 十、`<script>` 注解版动态 SQL

动态 SQL 也能写在注解里：用 `<script>` 把 XML 标签包起来，放在 `@Select` 等注解的 value 中。

```java
package com.canoe.mybatis.dynamicsql;

import org.apache.ibatis.annotations.Select;
import java.util.List;
import java.util.Map;

public interface ScriptUserMapper {

    @Select({
        "<script>",
        "SELECT * FROM user",
        "<where>",
        "  <if test='username != null'> AND username = #{username} </if>",
        "  <if test='age != null'> AND age = #{age} </if>",
        "</where>",
        "</script>"
    })
    List<User> selectByCond(Map<String, Object> params);
}
```

可读性明显不如 XML，**仅适合非常短的动态 SQL**；复杂逻辑老老实实写 XML。

## 十一、MyBatis-Plus 的条件构造器

如果你用了 MyBatis-Plus，连 XML 都不用写，用 **`QueryWrapper` / `LambdaQueryWrapper`** 在 Java 里拼条件。

```java
package com.canoe.mybatis.dynamicsql;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import java.util.List;

public class PlusDemo {

    // 推荐 LambdaQueryWrapper：编译期检查字段名，改名不会漏
    public List<User> query(String username, Integer age) {
        LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<User>()
                .eq(username != null, User::getUsername, username) // 条件成立才拼
                .eq(age != null, User::getAge, age)
                .like(username != null, User::getUsername, username)
                .in(User::getId, java.util.Arrays.asList(1L, 2L, 3L))
                .between(User::getAge, 18, 60)
                .orderByDesc(User::getCreateTime)
                .select(User::getId, User::getUsername); // 指定查询列

        return userMapper.selectList(wrapper);
    }

    private UserMapper userMapper;
}
```

对比 XML：`<if>` 对应 `eq(...条件, ...)` 的第一个布尔参数；`LambdaQueryWrapper` 用方法引用 `User::getUsername`，**字段名写错编译就报错**，比 XML 里字符串 `username` 更稳。常用方法：`eq` `ne` `like` `in` `between` `orderBy` `select` `last`（追加原生 SQL，如分页 `limit`）。

## 十二、几个易错点

- **`test` 里判空要写 `!= null`**；数字类型千万别只写 `test="status"`，**`0` 会被当成 `false`** 跳过，应写 `test="status != null"`。
- `<if>` 里**不要写 `${}`** 拼接用户输入，有注入风险；要用 `#{}`。
- `<foreach>` 的 `collection` 名字**必须和 `@Param` 一致**（或默认 `list`/`array`），否则 `Parameter not found`。
- 批量插入 SQL 过长会超 `max_allowed_packet`，**要分批**（如每 500 条一批）。
- `<set>` 内全空会变成无 `SET` 的非法 SQL，更新前**确保至少一个字段有值**。

## 本篇小结

- 动态 SQL 解决"**按条件拼 SQL**"，取代 Java 里易错的字符串拼接。
- `<if test="...">` 用 OGNL：**字符串判空要 `!= null` 且 `!= ''`**。
- `<where>` 自动加 `WHERE` 并**吃掉首部多余 AND/OR**，告别 `WHERE 1=1`。
- `<trim>` 是 `<where>`/`<set>` 的底层版，用 `prefixOverrides`/`suffixOverrides` 去冗余。
- `<set>` 用于 UPDATE，**自动去掉末尾逗号**。
- `<choose>`/`<when>`/`<otherwise>` **只执行首个满足分支**，等价 switch。
- `<foreach>` 六属性：`collection`/`item`/`index`/`open`/`close`/`separator`。
- 批量插入配 **`rewriteBatchedStatements=true`** 才能真批量、提升数倍。
- `<bind>` 安全拼 `%` 做模糊查询，**避免 `'%${x}%'` 注入**。
- `<sql>`/`<include>` 复用查询列，**杜绝 SELECT \***。
- MyBatis-Plus 用 **`LambdaQueryWrapper`** 编译期检查字段名，比 XML 更稳。
- 易错：**数字 `0` 当 false、`test` 要 `!= null`、`<foreach>` 的 collection 要对名**。

## 参考链接

- [MyBatis 官方文档：动态 SQL](https://mybatis.org/mybatis-3/dynamic-sql.html)
- [MyBatis 官方文档：`<foreach>`](https://mybatis.org/mybatis-3/dynamic-sql.html#foreach)
- [MyBatis-Plus 官方文档：条件构造器](https://baomidou.com/pages/10c804/)
- [MyBatis-Plus `LambdaQueryWrapper`](https://baomidou.com/pages/10c804/#lambdaquerywrapper)
- [MySQL `rewriteBatchedStatements` 说明](https://dev.mysql.com/doc/connector-j/en/connector-j-connp-props-performance-extensions.html)
- [Baeldung：MyBatis 动态 SQL](https://www.baeldung.com/mybatis-dynamic-sql)
- [MyBatis GitHub 仓库](https://github.com/mybatis/mybatis-3)

下一篇 → [04 一级缓存二级缓存](/java/mybatis/cache)
