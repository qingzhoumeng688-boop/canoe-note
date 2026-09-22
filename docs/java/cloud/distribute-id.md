# 05 分布式 ID

> 本篇导读：分库分表后，MySQL 的自增主键会撞车——两个库各生成 id=1001，一合并就重复。分布式 ID 要解决的是"在无限水平扩展的系统里，给每一条数据一个全局唯一、趋势递增、最好还不暴露业务的编号"。本文从"为什么不用自增"讲起，串讲 UUID、号段、Redis、雪花算法，最后落到订单号这种可读编号的设计实战。

## 一、为什么不能用数据库自增

数据库 `AUTO_INCREMENT` 在单库单表时很好用，但分布式场景有四个硬伤：

1. **分库分表后会重复**：order_db_0 和 order_db_1 各自从 1 自增，两库的 id=1001 直接撞车。
2. **有容量与性能上限**：单表自增到 `INT` 上限约 21 亿、`BIGINT` 虽大但写入需竞争自增锁，高并发下成为瓶颈。
3. **暴露业务量**：订单号是 `10086`、`10087` 连续数字，竞争对手看一眼就知道你一天成交多少单，商业机密全漏。
4. **需要提前建表才能拿到 ID**：很多异步场景（先生成单号再落库）用不了。

所以分布式系统需要一个**不依赖单库、全局唯一、可水平扩展**的 ID 生成方案。

## 二、分布式 ID 的要求

一个好用的分布式 ID，要满足这些：

- **全局唯一**：这是底线，重复就出大事。
- **趋势递增**：新生成的 ID 比旧的大（利于数据库 B+Tree 索引，避免频繁页分裂）。
- **高可用**：ID 生成服务挂了，全业务都发不出单，必须高可用。
- **高性能**：生成要快，通常是本地内存计算，不能每次都远程请求。
- **信息安全**：最好不连续、不可猜，防止被遍历（比如 `/order/{id}` 被爬虫顺手刷）。
- **不要太长**：太长占索引空间、影响传输，常用 64 位 long 或带格式的可读串。

## 三、UUID

JDK 一行就能生成：

```java
package com.canoe.cloud.idgen;

import java.util.UUID;

public class UuidDemo {
    public static void main(String[] args) {
        UUID uuid = UUID.randomUUID();
        // 形如 550e8400-e29b-41d4-a716-446655440000，36 字符
        System.out.println("UUID = " + uuid);
        System.out.println("版本 = " + uuid.version()); // 通常是 4（随机）
    }
}
```

**优缺点**：

- 优点：简单、无中心化、本地生成性能极高。
- 缺点：**无序**——作为数据库主键会导致 B+Tree 频繁页分裂，插入性能差；**太长**（36 字符，含连字符）；**不可读**。

**结论**：不要用作数据库主键；可用于临时标识、traceId、文件名等"不需要排序、不需要短"的场景。UUID 有 1（基于时间+MAC）、3/5（基于命名哈希）、4（随机，最常用）、7（时间有序，较新）等版本。

## 四、数据库号段模式

核心思想：**别每次都去数据库取一个 ID，而是一次批量取"一段"缓存在本地**，用完再取。

```text
DB 里存：biz_tag=order, max_id=2000, step=1000
应用A 取号段 → 拿到 [1001, 2000]，本地慢慢发
应用A 用完后 → 再取 → DB 把 max_id 更新为 3000，发 [2001, 3000]
```

建表 SQL：

```sql
CREATE TABLE id_segment (
    biz_tag    VARCHAR(32) PRIMARY KEY COMMENT '业务标识',
    max_id     BIGINT       NOT NULL COMMENT '当前已分配的最大 id',
    step       INT          NOT NULL COMMENT '每次取的长度',
    version    INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB;
```

取号核心代码（伪逻辑，用乐观锁防并发）：

```java
package com.canoe.cloud.idgen;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

// 号段模式：一次取一段，本地缓存发放（示意核心）
public class SegmentIdDemo {

    // 假设已拿到号段 [current, max]
    private long current = 1001;
    private long max = 2000;

    public synchronized long nextId() {
        if (current > max) {
            // 本地用完了，去 DB 取新号段（UPDATE max_id=max_id+step WHERE ...）
            reloadSegment();
        }
        return current++;
    }

    private void reloadSegment() {
        // 真实实现用乐观锁/原子更新，保证多实例不重复
        current = 2001;
        max = 3000;
    }

    public static void main(String[] args) {
        SegmentIdDemo demo = new SegmentIdDemo();
        System.out.println("生成的 id = " + demo.nextId());
        System.out.println("生成的 id = " + demo.nextId());
    }
}
```

**优点**：数据库压力小（几百次才访问一次）、趋势递增、性能不错。
**缺点**：号段用完后服务重启会浪费一段（区间不连续）；瞬时 ID 不连续（但这点有时反而是优点，不暴露量）。**美团 Leaf-segment** 就是这个思路。

## 五、Redis 自增

利用 Redis 的单线程原子自增 `INCR` / `INCRBY`（批量取号）生成连续 ID：

```java
package com.canoe.cloud.idgen;

import redis.clients.jedis.Jedis;

public class RedisIdDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("127.0.0.1", 6379)) {
            // INCR 原子自增，返回递增后的值
            long id = jedis.incr("id:order");
            System.out.println("Redis 生成 id = " + id);
            // 批量取号：一次拿 100 个，本地慢慢发
            long next = jedis.incrBy("id:order", 100);
            System.out.println("批量取号到 " + next);
        }
    }
}
```

**优点**：简单、性能高、天然递增。
**缺点**：**依赖 Redis 持久化**——若用 RDB 快照且没落盘就重启，可能从旧值重新自增导致**重复**；要处理好 `appendonly` / 主从复制策略。可靠性弱于号段和雪花。

## 六、雪花算法 Snowflake

本篇重点。Twitter 开源的 Snowflake 用一个 **64 位 long** 装下所有信息：

```text
 0 │ 41 位时间戳 │ 10 位机器ID │ 12 位序列号
───┼────────────┼─────────────┼────────────
 1        41           10            12

符号位(1)  时间戳(41)   机器ID(10)   序列号(12)
  0     ≈69年          1024台       每毫秒4096个
```

- **符号位（1 位）**：固定 0，保证 id 为正数。
- **时间戳（41 位）**：当前时间与自定义纪元（如 2020-01-01）的毫秒差，可用约 69 年。
- **机器 ID（10 位）**：5 位数据中心 + 5 位机器，支持 1024 个节点。
- **序列号（12 位）**：同一毫秒内的自增序号，每毫秒最多 4096 个。

```java
package com.canoe.cloud.idgen;

// 雪花算法完整实现（含时钟回拨保护）
public class Snowflake {

    // 2020-01-01 的毫秒时间戳，作为自定义纪元
    private static final long EPOCH = 1577836800000L;
    private static final long WORKER_BITS = 10L;
    private static final long SEQUENCE_BITS = 12L;
    private static final long MAX_WORKER = ~(-1L << WORKER_BITS);   // 1023
    private static final long MAX_SEQUENCE = ~(-1L << SEQUENCE_BITS); // 4095

    private final long workerId;
    private long sequence = 0L;
    private long lastTimestamp = -1L;

    public Snowflake(long workerId) {
        if (workerId < 0 || workerId > MAX_WORKER) {
            throw new IllegalArgumentException("workerId 超出范围 0~" + MAX_WORKER);
        }
        this.workerId = workerId;
    }

    public synchronized long nextId() {
        long ts = System.currentTimeMillis();
        if (ts < lastTimestamp) {
            // 时钟回拨：直接抛异常（也可改为等待，见下文）
            throw new RuntimeException("时钟回拨，拒绝生成 id，回拨 " + (lastTimestamp - ts) + "ms");
        }
        if (ts == lastTimestamp) {
            sequence = (sequence + 1) & MAX_SEQUENCE;
            if (sequence == 0) {
                // 当前毫秒序号用尽，等到下一毫秒
                ts = waitNextMillis(ts);
            }
        } else {
            sequence = 0L;
        }
        lastTimestamp = ts;
        return ((ts - EPOCH) << (WORKER_BITS + SEQUENCE_BITS))
                | (workerId << SEQUENCE_BITS)
                | sequence;
    }

    private long waitNextMillis(long ts) {
        while (ts <= lastTimestamp) {
            ts = System.currentTimeMillis();
        }
        return ts;
    }

    public static void main(String[] args) {
        Snowflake sf = new Snowflake(1);
        for (int i = 0; i < 3; i++) {
            System.out.println("id = " + sf.nextId());
        }
    }
}
```

**三个必须讲清的坑：**

1. **时钟回拨**：服务器时钟因为 NTP 校时等原因"往回走"，会导致生成重复 ID。解决思路有几种：① 直接抛异常（上例）；② 短暂等待时钟追上；③ 用上次时间戳 + 借用扩展位；④ 像 Leaf-snowflake 那样用 Zookeeper 记录上次时间做校验。
2. **机器 ID 分配**：10 位最多 1024 台，不能手动乱填。要用 **Zookeeper / 配置中心 / 启动脚本**统一分配，避免两台机器 workerId 撞车（撞车 = 生成相同 ID）。
3. **前端 JS 精度问题**：JS 的 `Number` 只能安全表示 53 位整数，而雪花 ID 是 64 位，前端拿到 19 位 ID 会**丢精度**（结尾几位变 0）。解决：后端**把 ID 转成字符串**再返回（`String.valueOf(id)`）。

## 七、美团 Leaf

美团开源的 Leaf，提供两种模式：

- **Leaf-segment（号段模式）**：即本文第四节的方案，双 buffer 优化（一个号段快用完时异步预取下一个，避免取号时阻塞）。
- **Leaf-snowflake**：解决雪花算法的两个坑——用 **Zookeeper 分配 workerId**（机器重启也能复用/不冲突），并**监控时钟回拨**做保护。

设计要点就是"把雪花的坑都填上"，生产可直接用。

## 八、百度 UidGenerator / 滴滴 Tinyid

- **百度 UidGenerator**：基于 Snowflake 改进，把 64 位重新划分（给机器位和序列号更多空间），用 `DefaultUidGenerator` 和 `CachedUidGenerator`（ RingBuffer 缓存，性能更高），依赖数据库分配 workId。
- **滴滴 Tinyid**：号段模式的另一种实现，支持多 client 拉取号段、REST/SDK 两种接入，主打轻量易部署。

## 九、方案选型

```text
方案        趋势递增   性能     可用依赖       信息安全    适用
------------------------------------------------------------------
UUID        否        极高     无            好(随机)   临时标识/traceId
号段        是        高       数据库         一般       内部主键
Redis       是        很高      Redis         一般       简单递增需求
Snowflake   是        极高      (时钟/worker)  好(不连续) 分库分表主键(首选)
Leaf/Tinyid 是        极高      中间件         好         中大型生产
```

**推荐**：分库分表主键用 **Snowflake 或 Leaf-segment**；对外展示的单号用"业务前缀 + 日期 + 序列"的可读方案（见下节）。

## 十、实战：订单号设计

数据库主键用雪花（内部、不暴露），但**给用户看的订单号**要可读、可排查、还不能被猜。一套实用方案：

```text
订单号 = 业务码(2) + 日期(8) + 用户ID后4位 + 随机/序列(4)

例： 订单  20240101   1001   8F3K
     业务码  yyyyMMdd   uid后4  随机串
```

- **业务码(2)**：区分订单/退款单/售后单，便于客服一眼识别。
- **日期(8)**：`yyyyMMdd`，排查时按天归档。
- **用户ID后 N 位**：出现客诉时快速定位到是谁的单。
- **随机/序列(N)**：保证唯一 + 防猜测（避免被遍历 `/order/{id}`）。

```java
package com.canoe.cloud.idgen;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ThreadLocalRandom;

// 可读订单号生成（业务码 + 日期 + uid后4 + 随机）
public class OrderNoDemo {

    private static final DateTimeFormatter FMT = DateTimeFormatter.BASIC_ISO_DATE;

    public static String genOrderNo(long userId) {
        String biz = "DD";                                  // 订单业务码
        String date = LocalDate.now().format(FMT);          // 20240101
        String uidTail = String.format("%04d", userId % 10000); // uid后4位
        String rand = String.format("%04d",
                ThreadLocalRandom.current().nextInt(10000));  // 4位随机防猜
        return biz + date + uidTail + rand;
    }

    public static void main(String[] args) {
        System.out.println("订单号 = " + genOrderNo(100123));
        System.out.println("订单号 = " + genOrderNo(100456));
    }
}
```

**唯一性**：同用户同毫秒随机碰撞概率极低，再加数据库唯一索引兜底即可。**防猜测**：末尾随机串让单号不可遍历。

## 本篇小结

- **数据库自增** 分库分表后会重复，且会暴露业务量。
- **好 ID** 要全局唯一、趋势递增、高可用、高性能、不暴露业务。
- **UUID** 简单但无序，不适合做数据库主键。
- **号段模式** 批量取 ID，数据库压力小，Leaf-segment 即此思路。
- **Redis 自增** 简单高性能，但依赖持久化、重启可能重复。
- **雪花算法** 是 64 位 long：时间戳41 + 机器10 + 序列12。
- **雪花坑一**：时钟回拨会生成重复 ID，需抛异常/等待/校验。
- **雪花坑二**：workerId 必须由配置中心统一分配防冲突。
- **雪花坑三**：JS 只能安全表示 53 位，ID 要转字符串返回前端。
- **Leaf / UidGenerator / Tinyid** 是工业级实现，填了雪花的坑。
- **订单号** 用"业务码+日期+uid尾+随机"兼顾可读与防猜。

## 参考链接

- [Twitter Snowflake 原始实现](https://github.com/twitter-archive/snowflake)
- [美团技术团队：Leaf 分布式 ID 方案](https://tech.meituan.com/2017/04/21/mt-leaf.html)
- [百度 UidGenerator](https://github.com/baidu/uid-generator)
- [滴滴 Tinyid](https://github.com/didi/tinyid)
- [UUID 规范 RFC 4122](https://www.rfc-editor.org/rfc/rfc4122)
- [Redis INCR 命令文档](https://redis.io/docs/latest/commands/incr/)
- [MongoDB ObjectId 设计](https://www.mongodb.com/docs/manual/reference/method/ObjectId/)
- [JS 安全整数 Number.MAX_SAFE_INTEGER](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)

下一篇 → [06 接口幂等性](/java/cloud/idempotent)
