# 04 一级缓存二级缓存

MyBatis 自带两层缓存，能减少数据库访问。但用不好反而制造"脏数据"。本篇讲清一级/二级缓存的作用域、命中与失效，并重点剖析二级缓存的硬伤，最后给出生产实践：关掉二级缓存，在 Service 层用 Redis，并警惕缓存击穿/穿透/雪崩。

## 一、为什么要有缓存

缓存的本质是**用空间换时间**：把"查过的结果"暂存起来，下次同样的查询直接命中缓存，省掉一次数据库往返。代价是**一致性问题**——数据被别人改了，你缓存里还是旧值。

```text
        无缓存：每次查询都打 DB（DB 压力大）
        有缓存：命中缓存直接返回（DB 压力小，但有旧数据风险）
```

MyBatis 的缓存分两级：一级缓存是"会话内"的，二级缓存是"跨会话、跨 Mapper namespace"的。下面逐一拆解。

## 二、一级缓存

**一级缓存是 `SqlSession` 级别的，默认开启。** 同一个 `SqlSession` 内，执行相同的查询（相同 statement + 相同参数），第二次会直接走缓存，不再查库。

验证代码（两次查询只打一条 SQL）：

```java
package com.canoe.mybatis.cache;

import java.util.List;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;

public class FirstLevelCacheDemo {

    private SqlSessionFactory factory;

    public void demo(Long id) {
        // 同一个 SqlSession 内
        try (SqlSession session = factory.openSession()) {
            UserMapper mapper = session.getMapper(UserMapper.class);
            User u1 = mapper.selectById(id); // 打 SQL，进一级缓存
            User u2 = mapper.selectById(id); // 命中一级缓存，不再打 SQL
            System.out.println(u1 == u2);    // true：同一对象
        }
    }
}
```

一级缓存**失效的四种情况**：

1. **不是同一个 `SqlSession`**：各自有各自的一级缓存，互不共享；
2. **查询之间穿插了增删改**：MyBatis 会**清空（清空当前 SqlSession 的）一级缓存**，避免读到旧值；
3. **手动调用 `clearCache()`**；
4. **两次查询的条件不同**（不是同一个 key）。

**⚠️ 关键坑（Spring 集成）**：Spring 里每次 `@Transactional` 方法或每次数据库操作，默认会**新建一个 `SqlSession`**。如果你没开事务，每次 `mapper.query()` 背后都是全新的 `SqlSession`，一级缓存**形同失效**——这也是为什么很多人觉得"MyBatis 一级缓存没用"。只有在同一个事务内、同一个 `SqlSession` 复用，一级缓存才真正生效。

## 三、二级缓存

**二级缓存是 `namespace`（即 Mapper）级别的，跨 `SqlSession` 共享**，需要手动开启。开启三步：

1. **全局开关**（默认就开）：`cacheEnabled=true`（`mybatis-config.xml` 的 `settings` 里，默认 `true`）；
2. **Mapper XML 里加 `<cache/>`**（或接口上加 `@CacheNamespace`）；
3. **实体类实现 `Serializable`**（因为二级缓存可能把对象序列化到外部存储/跨 JVM 传递）。

```xml
<!-- UserMapper.xml：声明开启二级缓存 -->
<mapper namespace="com.canoe.mybatis.cache.UserMapper">
    <cache/>
    <select id="selectById" resultType="com.canoe.mybatis.cache.User">
        SELECT id, username, age FROM user WHERE id = #{id}
    </select>
</mapper>
```

```java
package com.canoe.mybatis.cache;

import java.io.Serializable;

/** 实体必须实现 Serializable，二级缓存才存得进去 */
public class User implements Serializable {
    private static final long serialVersionUID = 1L;
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
}
```

开启后，不同 `SqlSession` 查同一数据会命中二级缓存。**注意：SqlSession 关闭/提交后，一级缓存才会刷入二级缓存。**

## 四、二级缓存的配置

`<cache>` 的几个属性：

| 属性 | 含义 | 可选值 |
| --- | --- | --- |
| `eviction` | 淘汰策略 | `LRU`（默认，最近最少用）/ `FIFO`（先进先出）/ `SOFT`（软引用）/ `WEAK`（弱引用） |
| `flushInterval` | 刷新间隔（毫秒），到点清空 | 默认不定时 |
| `size` | 最多缓存对象数 | 默认 1024 |
| `readOnly` | 是否只读 | `true` 返回同一实例更快但不安全；`false`（默认）返回拷贝更安全 |

`<cache-ref>` 可让一个 namespace **共享另一个 namespace 的缓存**，用于关联紧密的 Mapper。

```xml
<!-- 共享 UserMapper 的二级缓存 -->
<cache-ref namespace="com.canoe.mybatis.cache.UserMapper"/>
```

## 五、缓存的命中与失效

查询时的命中顺序：**二级缓存 → 一级缓存 → 数据库**。

```text
查询请求
   |
   v
二级缓存命中？ ──是──> 返回
   |否
   v
一级缓存命中？ ──是──> 返回
   |否
   v
查数据库 ──> 写入一级缓存（提交后刷入二级）──> 返回
```

失效规则：

- **增删改操作默认 `flushCache=true`**：执行后会清空该 namespace 的**二级缓存**（同时清空当前一级缓存），避免脏读；
- `<select>` 上的 `useCache`：设为 `false` 可让某查询**不进二级缓存**（如实时性要求高的统计）；
- `<select>` 上的 `flushCache`：设为 `true` 可让某查询**先清缓存再查**（强制读库）。

## 六、二级缓存的问题

二级缓存看着美好，实际硬伤很多，生产中常被关掉：

1. **作用域是 namespace，跨 Mapper 修改不失效 → 脏数据。** 例如 `UserMapper` 更新了 `user` 表，但 `OrderMapper` 的二级缓存里还缓存着"包含 user 信息"的订单结果，**它不会被 `UserMapper` 的更新触发失效**，于是读到旧 user。这是最致命的坑。
2. **分布式环境下本地缓存不共享。** 多台机器各有一份二级缓存，A 机器更新了，B 机器还是旧值，集群一致性崩塌。
3. **粒度太粗。** 二级缓存以 namespace 为界，一次更新清空整个 namespace 的所有缓存，命中率受影响；想精确到"某行"做不到。

**结论：实际生产很少用 MyBatis 二级缓存，通常直接关掉，在 Service 层用 Redis 做缓存**（详见 Redis 篇）。二级缓存只适合"单机、读多写少、数据几乎不变"的极个别场景。

## 七、与 Redis 整合

若真要用分布式缓存，可以**自定义 `Cache` 实现接管二级缓存**，用 Redis 存储，解决"多机不共享"问题：

```java
package com.canoe.mybatis.cache;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.ibatis.cache.Cache;

/**
 * 自定义二级缓存：实现 MyBatis 的 Cache 接口，把数据存到 Redis
 * （这里用 Map 示意，真实实现调用 RedisTemplate 读写）
 */
public class RedisCache implements Cache {

    private final String id; // namespace
    private static final Map<Object, Object> HOLDER = new ConcurrentHashMap<Object, Object>();

    public RedisCache(String id) {
        this.id = id;
    }

    @Override
    public String getId() {
        return id;
    }

    @Override
    public void putObject(Object key, Object value) {
        HOLDER.put(key, value); // 真实场景：redisTemplate.opsForValue().set(key, value)
    }

    @Override
    public Object getObject(Object key) {
        return HOLDER.get(key); // 真实场景：redisTemplate.opsForValue().get(key)
    }

    @Override
    public Object removeObject(Object key) {
        return HOLDER.remove(key);
    }

    @Override
    public void clear() {
        HOLDER.clear(); // 真实场景：按 namespace 前缀删除 Redis key
    }

    @Override
    public int getSize() {
        return HOLDER.size();
    }
}
```

```xml
<!-- Mapper XML 里指定用自定义缓存 -->
<cache type="com.canoe.mybatis.cache.RedisCache"/>
```

但这仍绕不开第六节说的"namespace 粒度脏数据"问题。所以**更常见的做法**是：直接关掉 MyBatis 二级缓存，在 Service 层用 **Spring Cache（`@Cacheable`）+ Redis**，缓存 key 自己设计、失效自己控制，清晰可控。

## 八、MyBatis-Plus 的缓存

MyBatis-Plus 基于 MyBatis，**缓存机制与 MyBatis 完全一致**：一级缓存（SqlSession）、二级缓存（namespace，`<cache/>` 开启）都原样可用。Plus 本身没有另搞一套缓存，所谓的"缓存"一般指配合 Redis 的 `RedisCache` 或 Spring Cache。注意：Plus 的 `selectById` 等 CRUD 也走一级缓存，但在 Spring 无事务时同样会因新 `SqlSession` 而失效。

## 九、最佳实践

给出一套稳妥建议：

- **一级缓存保持默认开启**，理解它在"同一事务/同一 SqlSession"才生效即可，别指望它在 Spring 无事务下兜底。
- **生产环境关掉二级缓存**（不写 `<cache/>`，或 `cacheEnabled=false`），避免 namespace 脏数据和分布式不一致。
- 需要缓存就在 **Service 层用 `@Cacheable` + Redis**，key 设计到业务维度，失效可控。
- **缓存与 DB 一致性**：更新 DB 后删除缓存（或延迟双删），详见 Redis 篇第 05 章。
- 用 Redis 做缓存时必须直面三个经典问题：
  - **缓存穿透**：查一个**根本不存在的 key**，缓存和 DB 都没有，请求每次都打到 DB。防护：① 缓存**空值**（短时间）；② 用**布隆过滤器**拦截不存在的 key。
  - **缓存击穿**：某个**热点 key 恰好过期**，瞬间大量请求同时穿透到 DB。防护：**互斥锁**重建缓存，或热点 key **不过期**（逻辑过期）。
  - **缓存雪崩**：大量 key **同一时刻集中过期**，或 Redis 宕机，请求全部压到 DB。防护：过期时间加**随机抖动**，Redis 做**高可用/集群**，并加**限流降级**。

## 本篇小结

- 缓存**用空间换时间**，代价是**一致性问题**（旧数据风险）。
- **一级缓存 = `SqlSession` 级别，默认开启**，同会话同查询命中。
- 一级缓存失效：不同会话、增删改、**`clearCache()`**、条件不同。
- **Spring 无事务时每次新 SqlSession，一级缓存形同失效**，别依赖它。
- **二级缓存 = namespace 级别，需手动开启**（全局开关 + `<cache/>` + 实体 `Serializable`）。
- 查询命中顺序：**二级 → 一级 → 数据库**；增删改默认清二级缓存。
- 二级缓存致命伤：**跨 Mapper 修改不失效 → 脏数据**，且**分布式不共享**。
- **生产建议关掉二级缓存**，改在 Service 层用 **`@Cacheable` + Redis**。
- 自定义 `Cache` 实现可接管二级缓存存 Redis，但仍受 namespace 粒度限制。
- Redis 缓存须防**穿透（空值/布隆）、击穿（互斥锁）、雪崩（随机过期+高可用）**。

## 参考链接

- [MyBatis 官方文档：缓存](https://mybatis.org/mybatis-3/sqlmap-xml.html#cache)
- [MyBatis 官方文档：`cache` 配置属性](https://mybatis.org/mybatis-3/configuration.html#properties)
- [MyBatis 官方文档：`Cache` 接口](https://mybatis.org/mybatis-3/apidocs/reference/org/apache/ibatis/cache/Cache.html)
- [Spring Cache 官方文档（`@Cacheable`）](https://docs.spring.io/spring-framework/docs/current/reference/html/integration.html#cache)
- [Redis 官方文档](https://redis.io/docs/latest/)
- [Baeldung：MyBatis 二级缓存](https://www.baeldung.com/mybatis-second-level-cache)
- [MyBatis-Plus 官方文档](https://baomidou.com/)

下一篇 → [返回专栏首页](/java/mybatis/base)
