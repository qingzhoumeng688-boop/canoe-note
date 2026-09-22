# 06 锁机制

> 本篇导读：前面 MVCC 让"读写"互不阻塞，但"写写"冲突还得靠锁来解决。为什么有时候一条 `UPDATE` 会卡住半天？为什么没走索引的更新会锁整张表？为什么两个事务会"死锁"？本篇把 MySQL 的锁体系拆开：锁的分类、行锁表锁、S/X 锁、意向锁，以及最关键的记录锁/间隙锁/临键锁，最后讲死锁复现与排查、乐观锁实战。看完你就能预判"这条 SQL 到底会锁住哪些数据"。

## 一、锁的分类

先给一张总览表，锁可以从不同维度切分：

| 维度 | 类型 | 说明 |
| --- | --- | --- |
| 按粒度 | 行锁 / 表锁 / 页锁 | InnoDB 主要用行锁，MyISAM 只有表锁 |
| 按模式 | 共享锁 S / 排他锁 X / 意向锁 IS / IX | S 可读不可写，X 独占 |
| 按算法 | 记录锁 / 间隙锁 / 临键锁 | 锁定范围不同（核心） |
| 按态度 | 悲观锁 / 乐观锁 | 悲观锁靠数据库锁，乐观锁靠版本号 |

```text
锁的维度树：
        粒度：行锁 ─┬─ 记录锁 Record Lock
                   ├─ 间隙锁 Gap Lock
                   └─ 临键锁 Next-Key Lock
             表锁 / 页锁
        模式：S 锁 / X 锁 / IS 意向共享 / IX 意向排他
        态度：悲观锁(数据库锁) / 乐观锁(版本号)
```

## 二、表锁与行锁

- **MyISAM 只有表锁**：任何写操作会锁住整张表，并发极差。
- **InnoDB 支持行锁**：只锁受影响的那几行，并发高。

**重中之重：InnoDB 的行锁是加在索引上的！** 如果 `UPDATE` 的 WHERE 条件**没走索引**，MySQL 无法定位到具体行，就会退化为**锁全表**（实际上是把所有聚簇索引记录都加锁）。

验证示例（在 RR 下）：

```sql
-- 假设 user 表的 phone 列没有索引
UPDATE user SET status = 0 WHERE phone = '13800138000';
-- 这条语句会锁住整张表的所有行！其他事务任何写都被阻塞

-- 给 phone 加上索引后
ALTER TABLE user ADD INDEX idx_phone (phone);
UPDATE user SET status = 0 WHERE phone = '13800138000';
-- 只锁住 phone='13800138000' 的那一行（命中索引）
```

> 血泪教训：**更新/删除的 WHERE 条件一定要走到索引，否则就是全表锁，分分钟拖垮线上。**

## 三、共享锁与排他锁

- **共享锁 S（Share）**：`SELECT ... LOCK IN SHARE MODE` 加 S 锁，多个事务可同时持有 S 锁（都能读，但不能写）。
- **排他锁 X（Exclusive）**：`SELECT ... FOR UPDATE` 加 X 锁；**普通的 `INSERT/UPDATE/DELETE` 会自动加 X 锁**。X 锁与任何锁都互斥。

兼容矩阵（Y=兼容，N=冲突）：

| 已持有 \ 请求 | S | X |
| --- | --- | --- |
| S | Y | N |
| X | N | N |

```sql
-- 事务A
SELECT * FROM user WHERE id = 1 LOCK IN SHARE MODE;   -- 加 S 锁
-- 事务B
SELECT * FROM user WHERE id = 1 FOR UPDATE;          -- 想加 X 锁 → 被 A 的 S 锁阻塞！
UPDATE user SET age=20 WHERE id = 1;                 -- 想加 X 锁 → 同样阻塞
```

记忆：**S 和 S 能共存，只要有 X 参与就互斥。**

## 四、意向锁

**为什么需要意向锁？** 假设事务 A 给某一行加了行级 X 锁，此时事务 B 想给整张表加表级 X 锁。如果没意向锁，B 就得**逐行扫描**确认"有没有行被锁了"——太慢。

意向锁（Intention Lock）是**表级锁**，是一个"声明"：

- 事务想给某行加 S 锁前，先给表加 **IS（意向共享）** 锁。
- 事务想给某行加 X 锁前，先给表加 **IX（意向排他）** 锁。

这样事务 B 想加表锁时，只要看表上有没有 IX/IS 冲突即可，**不用逐行查**。

关键性质：**意向锁之间互不冲突（IS 与 IX 可共存），且意向锁不会阻塞行锁**（除了"全表扫描式"的表锁）。它纯粹是为了让"表锁 vs 行锁"能快速判断，是个轻量的协调者。

## 五、记录锁、间隙锁、临键锁

这是 InnoDB 行锁的三种算法，也是本篇核心。假设 `id` 索引上有值 `10, 20, 30`：

```text
索引 id 上的区间示意：
(-∞, 10)   [10]   (10, 20)   [20]   (20, 30)   [30]   (30, +∞)
 间隙       记录     间隙        记录    间隙       记录    间隙
```

- **记录锁 Record Lock**：锁单条索引记录 `[10]`。别的的事务不能改/删这一行。
- **间隙锁 Gap Lock**：锁**两条记录之间的间隙**，如 `(10, 20)`。它不锁任何已存在的数据，只**阻止往这个间隙插入新数据**——这是解决幻读的关键。
- **临键锁 Next-Key Lock**：= **记录锁 + 它前面的间隙锁**，是**前开后闭**区间。如 `(10, 20]` 表示锁住间隙 (10,20) 加上记录 20。这是 **InnoDB 在 RR 下的默认加锁算法**。

```text
Next-Key Lock 示例（RR 默认），对 id=20 加锁实际锁住 (10, 20]：

   (10, 20]  ← 即：间隙(10,20) + 记录[20]
   ▲             ▲
   阻止插入id在  锁住id=20本身，
   11~19的新行   别人不能改/删
```

**为什么默认用临键锁？** 因为它既锁住已有记录（防改），又锁住前面的间隙（防插），一次性堵住了"幻读"的插入路径。

## 六、加锁规则

参考丁奇《MySQL 实战45讲》总结的可操作规则（RR 下）：

1. **加锁的基本单位是 next-key lock（前开后闭区间）**。
2. **查找过程中访问到的对象才会加锁**（没访问到的不加）。
3. **等值查询，且命中唯一索引时，next-key lock 退化为记录锁**（只锁那一行，因为唯一索引保证只有一条）。
4. **等值查询，向右遍历到第一个不满足条件的值时，next-key lock 退化为间隙锁**。
5. **唯一索引的范围查询，会一直访问到第一个不满足条件的记录为止**。

练习几个例子（假设 `id` 唯一索引，现有 `10, 20, 30`）：

```sql
-- 例1：等值命中唯一索引 → 退化成记录锁，只锁 id=20
SELECT * FROM t WHERE id = 20 FOR UPDATE;     -- 锁 [20]

-- 例2：等值但记录不存在（id=25 不存在）→ 退化成间隙锁 (20,30)
SELECT * FROM t WHERE id = 25 FOR UPDATE;     -- 锁 (20,30)，阻止插入 21~29

-- 例3：范围查询 id>=20 → 访问到 30 仍满足，继续到 +∞ 前的不满足值
SELECT * FROM t WHERE id >= 20 FOR UPDATE;    -- 锁 [20] (20,30] (30,+∞)
```

> 注意：以上是在 RR 且命中索引的场景。如果是普通索引或 RC 级别，规则会变化（RC 下基本没有间隙锁）。

## 七、锁与隔离级别

- **RC（读已提交）下没有间隙锁**（除了外键约束检查等特殊场景）。因为 RC 容忍"不可重复读"和"幻读"，所以不需要靠间隙锁去防插入，只锁住已存在的记录。
- **RR（可重复读）下才有完整的 next-key lock**。

这解释了**为什么 RC 下会有幻读**：事务 A 两次当前读之间，事务 B 插入了一条新记录，由于 RC 没有间隙锁拦着插入，A 第二次读就多了一行"幻影"。RR 因为间隙锁挡住了插入，所以当前读也不会幻读。

## 八、死锁

**死锁**：两个（或多个）事务互相持有对方需要的锁，又都在等对方释放，形成环路，谁都走不了。

**复现示例**（两个事务交叉更新两行）：

```sql
-- 事务A
BEGIN;
UPDATE account SET money = money - 100 WHERE id = 1;   -- A 锁住 id=1
-- 事务B（在另一个会话）
BEGIN;
UPDATE account SET money = money - 100 WHERE id = 2;   -- B 锁住 id=2
-- 事务A 继续
UPDATE account SET money = money + 100 WHERE id = 2;   -- A 等 B 释放 id=2 的锁
-- 事务B 继续
UPDATE account SET money = money + 100 WHERE id = 1;   -- B 等 A 释放 id=1 的锁
-- → 死锁！MySQL 检测到环路，回滚其中一个事务并报错
-- ERROR 1213 (40001): Deadlock found when trying to get lock
```

MySQL 处理死锁的两把武器：

- **死锁超时**：`innodb_lock_wait_timeout` 默认 **50 秒**，等这么久没拿到锁就报错。
- **死锁检测**：`innodb_deadlock_detect` 默认开启，主动检测等待图里的环路，立即回滚代价小的事务，不用傻等。

**排查命令**：

```sql
SHOW ENGINE INNODB STATUS;
-- 看其中的 "LATEST DETECTED DEADLOCK" 段，能拿到两个事务各自持有什么锁、在等什么锁
```

**规避死锁的方案**：

- **固定访问顺序**：所有事务都按 id 从小到大更新（如上例都先改 1 再改 2），避免交叉。
- **拆大事务**：事务越短，持锁时间越短，撞车概率越低。
- **降低隔离级别**到 RC（减少间隙锁范围）。
- **加索引**：让更新精确命中行锁，缩小锁范围，避免锁升级成全表。

## 九、锁等待排查

当某事务卡住（不是死锁，只是等锁），可以这样查：

```sql
-- MySQL 5.7：information_schema
SELECT * FROM information_schema.innodb_locks;        -- 当前持有的锁
SELECT * FROM information_schema.innodb_lock_waits;  -- 谁在等谁的锁

-- MySQL 8.0：改到 performance_schema
SELECT * FROM performance_schema.data_locks;          -- 所有锁（含意向锁）
SELECT * FROM performance_schema.data_lock_waits;     -- 锁等待关系

-- 看所有连接/正在执行的语句，找到卡住的那个
SHOW PROCESSLIST;
```

有了 `data_locks` 表，你能精确看到某事务持有了哪种锁（RECORD/GAP）、锁在哪张表哪一行、处于 WAITING 还是 GRANTED 状态，定位"是谁堵住了谁"。

## 十、乐观锁与悲观锁

| 对比项 | 悲观锁 | 乐观锁 |
| --- | --- | --- |
| 思路 | 认为一定会冲突，先加锁再操作 | 认为很少冲突，提交时校验版本 |
| 实现 | `SELECT ... FOR UPDATE` | 版本号 / 时间戳字段 |
| 适用 | 写冲突频繁、强一致 | 读多写少、冲突少 |
| 缺点 | 锁住期间别人不能动，并发低 | 冲突时重试，高冲突下频繁失败 |

**乐观锁版本号实现**（秒杀/库存扣减经典场景）：

```sql
-- 商品表有 version 字段
UPDATE product
SET stock = stock - 1,
    version = version + 1
WHERE id = 1001
  AND version = 5;        -- 只有版本号匹配才更新成功

-- Java 侧判断：若影响行数 = 0，说明版本已被别人改过 → 重试或提示失败
int rows = stmt.executeUpdate();
if (rows == 0) {
    // 乐观锁冲突，重试或返回"手慢了"
}
```

这样不需要数据库行锁，高并发下多个请求同时扣库存，只有一个能成功（version 匹配），其余自动失败重来，**避免了超卖**。

## 本篇小结

- 锁按粒度分**行锁/表锁/页锁**，按模式分 **S/X/IS/IX**，按算法分**记录/间隙/临键锁**。
- **InnoDB 行锁加在索引上**，不走索引会**锁全表**。
- **S 锁共享、X 锁独占**；DML 自动加 X 锁；S 与 S 兼容、含 X 则互斥。
- **意向锁是表级"声明"**，让表锁不必逐行查即可判断，不阻塞行锁。
- **记录锁锁单行；间隙锁锁空隙防插入；临键锁=记录锁+前面间隙（RR 默认）**。
- 加锁规则核心：**等值唯一索引退化为记录锁**；**向右到第一个不满足值退化为间隙锁**。
- **RC 无间隙锁 → 会有幻读；RR 有 next-key lock → 防幻读**。
- **死锁**是互相等锁成环；MySQL 靠 **`innodb_deadlock_detect`** 检测并回滚一方。
- 排查用 **`SHOW ENGINE INNODB STATUS`** 看 LATEST DETECTED DEADLOCK。
- MySQL 8 锁信息在 **`performance_schema.data_locks`**。
- **乐观锁用版本号**（`WHERE version=?`）适合库存/秒杀，避免超卖。

## 参考链接

- [MySQL 官方：InnoDB 锁类型](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking.html)
- [MySQL 官方：事务隔离级别与锁](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html)
- [MySQL 官方：死锁检测](https://dev.mysql.com/doc/refman/8.0/en/innodb-deadlocks.html)
- [MySQL 官方：INFORMATION_SCHEMA 锁表（5.7）](https://dev.mysql.com/doc/refman/5.7/en/innodb-locks-table.html)
- [MySQL 官方：performance_schema.data_locks（8.0）](https://dev.mysql.com/doc/refman/8.0/en/performance-schema-data-locks-table.html)
- [丁奇《MySQL 实战45讲》](https://time.geekbang.org/column/intro/100020801)

下一篇 → [07 JDBC 基础](/java/db/jdbc)
