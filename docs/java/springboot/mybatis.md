# 06 整合 MyBatis

在 Spring Boot 里操作数据库，MyBatis 是国内最主流的持久层框架：SQL 自己写、可控性强。本篇对比官方 starter 与 MyBatis-Plus，给出完整可运行的 CRUD 示例，并讲解 MyBatis-Plus 的分页、逻辑删除、乐观锁等核心能力，最后梳理多数据源与高频踩坑。

## 一、整合方式选择

两种方式：

- **`mybatis-spring-boot-starter`（官方）**：轻量，SQL 全靠自己写（XML 或注解），灵活、透明，适合 SQL 复杂、追求掌控的场景。
- **`mybatis-plus-boot-starter`（MyBatis-Plus，苞米豆出品）**：在 MyBatis 上增强，提供 `BaseMapper` 通用 CRUD、条件构造器、分页插件、代码生成器等，**极大减少样板代码**，国内项目首选。

选择建议：新项目几乎都选 MyBatis-Plus，省去大量 `selectById`、`insert` 之类重复方法；若团队规范必须纯手写 SQL 或要兼容老 MyBatis 配置，则用官方 starter。本篇以 MyBatis-Plus 为主线，同时给出原生用法对照。

## 二、依赖与配置

完整 `pom.xml`（以 MySQL 8 + Druid 连接池 + MyBatis-Plus 为例）：

```xml
<dependencies>
    <!-- Web -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <!-- MyBatis-Plus 起步依赖（已内含 mybatis 与 mybatis-spring） -->
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-boot-starter</artifactId>
        <version>3.5.7</version>
    </dependency>

    <!-- MySQL 8 驱动 -->
    <dependency>
        <groupId>com.mysql</groupId>
        <artifactId>mysql-connector-j</artifactId>
        <scope>runtime</scope>
    </dependency>

    <!-- Druid 连接池 -->
    <dependency>
        <groupId>com.alibaba</groupId>
        <artifactId>druid-spring-boot-starter</artifactId>
        <version>1.2.23</version>
    </dependency>

    <!-- Lombok，简化实体类 -->
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <optional>true</optional>
    </dependency>
</dependencies>
```

对应 `application.yml`（MySQL 8 的驱动类是 `com.mysql.cj.jdbc.Driver`，且**必须加 `serverTimezone`**，否则启动报时区错误）：

```yaml
spring:
  datasource:
    # Druid 数据源
    type: com.alibaba.druid.pool.DruidDataSource
    driver-class-name: com.mysql.cj.jdbc.Driver
    url: jdbc:mysql://localhost:3306/canoe?serverTimezone=Asia/Shanghai&useUnicode=true&characterEncoding=utf8&useSSL=false
    username: root
    password: root

mybatis-plus:
  # XML 映射文件位置
  mapper-locations: classpath*:mapper/*.xml
  # 实体类别名包扫描
  type-aliases-package: com.canoe.springboot.mybatis.entity
  # 下划线自动转驼峰（数据库 order_no → 实体 orderNo）
  configuration:
    map-underscore-to-camel-case: true
  global-config:
    db-config:
      # 逻辑删除字段
      logic-delete-field: deleted
```

每一项都已注释：URL 里的 `serverTimezone` 与时区、SSL 相关；`map-underscore-to-camel-case` 让 `create_time` 能自动映射到 `createTime`。

## 三、Mapper 注册

两种方式让 MyBatis 找到 Mapper 接口：

- **`@MapperScan`（推荐）**：在启动类或配置类上一次性扫描整个包。
- **逐个加 `@Mapper`**：每个接口自己标，接口多时繁琐。

```java
package com.canoe.springboot.mybatis;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// 扫描多个包时用逗号分隔：@MapperScan({"com.canoe.mapper","com.canoe.order.mapper"})
@MapperScan("com.canoe.springboot.mybatis.mapper")
@SpringBootApplication
public class MybatisApplication {

    public static void main(String[] args) {
        SpringApplication.run(MybatisApplication.class, args);
    }
}
```

多包扫描：`@MapperScan({"com.canoe.order.mapper", "com.canoe.user.mapper"})`。

## 四、完整 CRUD 示例

建表 SQL：

```sql
CREATE TABLE `book` (
  `id`          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
  `title`       VARCHAR(100) NOT NULL COMMENT '书名',
  `author`      VARCHAR(50)  NOT NULL COMMENT '作者',
  `price`       DECIMAL(10,2) NOT NULL COMMENT '价格',
  `create_time` DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

实体类（用 Lombok 简化，但保留无参构造，MyBatis 反射需要）：

```java
package com.canoe.springboot.mybatis.entity;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import lombok.Data;

// @Data 提供 getter/setter/equals 等；@NoArgsConstructor 保证无参构造
@Data
@NoArgsConstructor
public class Book {

    private Long id;
    private String title;
    private String author;
    private BigDecimal price;
    private LocalDateTime createTime;

    // 业务构造方便测试用
    public Book(String title, String author, BigDecimal price) {
        this.title = title;
        this.author = author;
        this.price = price;
    }
}
```

Mapper 接口（MyBatis-Plus 直接继承 `BaseMapper`，免写基础 CRUD）：

```java
package com.canoe.springboot.mybatis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.canoe.springboot.mybatis.entity.Book;

public interface BookMapper extends BaseMapper<Book> {
}
```

Service 层：

```java
package com.canoe.springboot.mybatis.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.canoe.springboot.mybatis.entity.Book;
import com.canoe.springboot.mybatis.mapper.BookMapper;
import org.springframework.stereotype.Service;

// 继承 MyBatis-Plus 的 ServiceImpl，获得批量等扩展方法
@Service
public class BookService extends ServiceImpl<BookMapper, Book> {
}
```

Controller：

```java
package com.canoe.springboot.mybatis.controller;

import java.math.BigDecimal;
import java.util.List;
import com.canoe.springboot.mybatis.entity.Book;
import com.canoe.springboot.mybatis.service.BookService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/books")
public class BookController {

    private final BookService bookService;

    public BookController(BookService bookService) {
        this.bookService = bookService;
    }

    @PostMapping
    public boolean add(@RequestBody Book book) {
        return bookService.save(book);
    }

    @GetMapping
    public List<Book> list() {
        return bookService.list();
    }
}
```

用 curl 验证：

```bash
# 新增
curl -X POST http://localhost:8080/books -H "Content-Type: application/json" \
  -d '{"title":"Spring Boot 实战","author":"canoe","price":59.00}'

# 查询
curl http://localhost:8080/books
```

若不想用 MyBatis-Plus，也可纯注解写 SQL：

```java
package com.canoe.springboot.mybatis.mapper;

import java.util.List;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import com.canoe.springboot.mybatis.entity.Book;

@Mapper
public interface PlainBookMapper {

    @Insert("INSERT INTO book(title,author,price) VALUES(#{title},#{author},#{price})")
    int insert(Book book);

    @Select("SELECT * FROM book")
    List<Book> findAll();
}
```

## 五、MyBatis-Plus 核心功能

**1. `BaseMapper` 内置方法**：`selectById`、`insert`、`updateById`、`deleteById`、`selectList` 等开箱即用，上节已用。

**2. 条件构造器**：`QueryWrapper` 与类型安全的 `LambdaQueryWrapper`：

```java
package com.canoe.springboot.mybatis.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.canoe.springboot.mybatis.entity.Book;
import com.canoe.springboot.mybatis.mapper.BookMapper;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class BookQueryService {

    private final BookMapper bookMapper;

    public BookQueryService(BookMapper bookMapper) {
        this.bookMapper = bookMapper;
    }

    // 查询价格大于 50 且作者为 canoe 的书
    public List<Book> query() {
        LambdaQueryWrapper<Book> wrapper = new LambdaQueryWrapper<>();
        wrapper.gt(Book::getPrice, 50)
               .eq(Book::getAuthor, "canoe")
               .orderByDesc(Book::getCreateTime);
        return bookMapper.selectList(wrapper);
    }
}
```

**3. 分页插件**：必须注册 `MybatisPlusInterceptor` 并加入 `PaginationInnerInterceptor`，否则分页会退化为全表查询、`total` 为 0：

```java
package com.canoe.springboot.mybatis.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 分页插件，指定数据库类型
        interceptor.addInnerPlugin(new PaginationInnerInterceptor(DbType.MYSQL));
        return interceptor;
    }
}
```

```java
package com.canoe.springboot.mybatis.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.canoe.springboot.mybatis.entity.Book;
import com.canoe.springboot.mybatis.mapper.BookMapper;
import org.springframework.stereotype.Service;

@Service
public class BookPageService {

    private final BookMapper bookMapper;

    public BookPageService(BookMapper bookMapper) {
        this.bookMapper = bookMapper;
    }

    public IPage<Book> page(int current, int size) {
        return bookMapper.selectPage(new Page<>(current, size), null);
    }
}
```

**4. 逻辑删除**：实体加 `@TableLogic`，配合全局 `logic-delete-field`，删除变更新 `deleted` 字段，查询自动过滤已删除：

```java
package com.canoe.springboot.mybatis.entity;

import com.baomidou.mybatisplus.annotation.TableLogic;
import lombok.Data;

@Data
@NoArgsConstructor
public class Book {

    private Long id;
    private String title;

    // 逻辑删除标记：0 未删，1 已删
    @TableLogic
    private Integer deleted;
}
```

**5. 自动填充**：`@TableField(fill = ...)` + `MetaObjectHandler` 自动写入 `createTime`、`updateTime`：

```java
package com.canoe.springboot.mybatis.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@NoArgsConstructor
public class Book {

    private Long id;
    private String title;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
```

```java
package com.canoe.springboot.mybatis.config;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import java.time.LocalDateTime;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.stereotype.Component;

@Component
public class TimeMetaHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());
        strictInsertFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }
}
```

**6. 乐观锁**：`@Version` + 插件，避免并发更新覆盖：

```java
package com.canoe.springboot.mybatis.entity;

import com.baomidou.mybatisplus.annotation.Version;
import lombok.Data;

@Data
@NoArgsConstructor
public class Book {

    private Long id;
    private String title;

    // 乐观锁版本号，更新时自动加条件 version=? 并自增
    @Version
    private Integer version;
}
```

```java
package com.canoe.springboot.mybatis.config;

import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OptimisticConfig {

    @Bean
    public MybatisPlusInterceptor interceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerPlugin(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }
}
```

## 六、代码生成器

不想手写 Entity/Mapper/Service？两种途径：

- **MyBatisX 插件（IDEA）**：连库后右键表即可生成全套代码，最省事。
- **`FastAutoGenerator`（代码层面）**：在测试或脚本里运行即可批量生成。

```java
package com.canoe.springboot.mybatis.generator;

import com.baomidou.mybatisplus.generator.FastAutoGenerator;
import com.baomidou.mybatisplus.generator.config.OutputFile;

import java.util.Collections;

public class CodeGen {

    public static void main(String[] args) {
        FastAutoGenerator.create(
                    "jdbc:mysql://localhost:3306/canoe?serverTimezone=Asia/Shanghai",
                    "root", "root")
                .globalConfig(b -> b.author("canoe").outputDir("src/main/java"))
                .packageConfig(b -> b.parent("com.canoe.springboot.mybatis")
                        .pathInfo(Collections.singletonMap(OutputFile.xml, "src/main/resources/mapper")))
                .strategyConfig(b -> b.addInclude("book", "order"))
                .execute();
    }
}
```

## 七、事务

在 Service 方法上加 `@Transactional` 即可开启事务（Spring 自动代理）。常见失效场景（与 Spring 事务篇呼应）：

- **方法必须是 public**，且**通过 Spring 代理调用**（同类内部 `this.xxx()` 调用不会触发）。
- **异常被 catch 吞掉**：默认只对 `RuntimeException` 回滚，若 catch 后不抛出则不会回滚（可显式 `rollbackFor = Exception.class`）。
- **数据源未配置事务管理器**：MyBatis-Plus starter 已自动配好。

```java
package com.canoe.springboot.mybatis.service;

import com.canoe.springboot.mybatis.entity.Book;
import com.canoe.springboot.mybatis.mapper.BookMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BookTxService {

    private final BookMapper bookMapper;

    public BookTxService(BookMapper bookMapper) {
        this.bookMapper = bookMapper;
    }

    // 两张表操作要么同时成功，要么同时回滚
    @Transactional(rollbackFor = Exception.class)
    public void transfer(Book a, Book b) {
        bookMapper.insert(a);
        bookMapper.insert(b); // 若此处抛异常，a 的插入一并回滚
    }
}
```

## 八、多数据源

常用苞米豆的 `dynamic-datasource-spring-boot-starter`，用 `@DS` 注解切换数据源：

```xml
<dependency>
    <groupId>com.baomidou</groupId>
    <artifactId>dynamic-datasource-spring-boot-starter</artifactId>
    <version>4.3.1</version>
</dependency>
```

```yaml
spring:
  datasource:
    dynamic:
      primary: master            # 默认数据源
      datasource:
        master:
          driver-class-name: com.mysql.cj.jdbc.Driver
          url: jdbc:mysql://localhost:3306/canoe_master?serverTimezone=Asia/Shanghai
          username: root
          password: root
        slave:
          driver-class-name: com.mysql.cj.jdbc.Driver
          url: jdbc:mysql://localhost:3306/canoe_slave?serverTimezone=Asia/Shanghai
          username: root
          password: root
```

```java
package com.canoe.springboot.mybatis.service;

import com.baomidou.dynamic.datasource.annotation.DS;
import com.canoe.springboot.mybatis.entity.Book;
import com.canoe.springboot.mybatis.mapper.BookMapper;
import org.springframework.stereotype.Service;

@Service
public class ReportService {

    private final BookMapper bookMapper;

    public ReportService(BookMapper bookMapper) {
        this.bookMapper = bookMapper;
    }

    // 从从库读
    @DS("slave")
    public Book read(Long id) {
        return bookMapper.selectById(id);
    }

    // 写主库（默认 master，可不写 @DS）
    public int write(Book book) {
        return bookMapper.insert(book);
    }
}
```

**事务注意**：多数据源下单一 `@Transactional` 默认只管 `primary` 数据源；跨库事务需要引入 Seata 等分布式事务方案，不要指望本地事务跨库生效。

## 九、常见问题

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `Invalid bound statement (not found)` | XML 没被扫描到 | 检查 `mapper-locations` 路径与 XML 的 `namespace`/`id` 是否匹配 |
| 参数找不到 `Parameter 'xxx' not found` | 多参数未加 `@Param` | 方法参数加 `@Param("xxx")` 或在 XML 用 `param1` |
| 下划线字段映射不到驼峰属性 | 未开驼峰转换 | 开启 `map-underscore-to-camel-case: true` |
| `The server time zone value` 报错 | MySQL 8 没设时区 | URL 加 `serverTimezone=Asia/Shanghai` |
| SSL 警告 | 未关闭 SSL | URL 加 `useSSL=false` |
| `Public Key Retrieval is not allowed` | 认证方式问题 | URL 加 `allowPublicKeyRetrieval=true` |
| 分页 `total` 为 0 | 没配分页插件 | 注册 `MybatisPlusInterceptor` + `PaginationInnerInterceptor` |

## 本篇小结

- **MyBatis-Plus 在 MyBatis 上增强，国内项目首选**，省去大量基础 CRUD。
- **MySQL 8 驱动为 `com.mysql.cj.jdbc.Driver`，URL 必须带 `serverTimezone`**。
- **`@MapperScan` 一次扫描整包，比逐个 `@Mapper` 更省事**。
- **`BaseMapper` 提供开箱 CRUD，条件构造器 `LambdaQueryWrapper` 类型安全**。
- **分页必须注册 `PaginationInnerInterceptor`，否则 total 为 0**。
- **`@TableLogic` 逻辑删除把 DELETE 变 UPDATE**，查询自动过滤。
- **`@TableField(fill)` + `MetaObjectHandler` 实现时间字段自动填充**。
- **`@Version` + 乐观锁插件防止并发更新覆盖**。
- **`@Transactional` 要求 public 且经 Spring 代理调用，异常别吞**。
- **多数据源用 `dynamic-datasource` + `@DS`，跨库事务需分布式方案**。
- **`Invalid bound statement` 多因 XML 未扫到或 namespace 不匹配**。

## 参考链接

- [MyBatis-Plus 官方文档](https://baomidou.com/)
- [MyBatis 官方文档](https://mybatis.org/mybatis-3/zh/index.html)
- [mybatis-spring-boot-starter](https://github.com/mybatis/spring-boot-starter)
- [dynamic-datasource 多数据源](https://github.com/baomidou/dynamic-datasource-spring-boot-starter)
- [MyBatisX 插件](https://baomidou.com/pages/ba5e9e/)
- [MySQL Connector/J 8.0 文档](https://dev.mysql.com/doc/connector-j/8.0/en/)

下一篇 → [07 SpringBoot 常用注解](/java/springboot/annotation)
