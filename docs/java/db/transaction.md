# 04 事务与 ACID

> 本篇导读：你有没有想过，银行转账时"我账户扣了 100，对方却没收到"这种事为什么几乎不会发生？答案就是事务。本篇从转账故事讲起，拆开 ACID 四大特性各自靠什么实现，深入 redo/undo/binlog 与两阶段提交，再把四种隔离级别、脏读/不可重复读/幻读讲透，最后收尾于"MySQL 的 RR 到底能不能解决幻读"和 Spring 事务失效的坑。这是后端面试的高频重灾区。

## 一、事务是什么

最经典的例子就是**转账**：张三给李四转 100 元。这件事包含两个动作：

1. 张三余额减 100：`UPDATE account SET money = money - 100 WHERE name='张三';`
2. 李四余额加 100：`UPDATE account SET money = money + 100 WHERE name='李四';`

如果这两个动作之间数据库崩了，就会变成"张三扣了钱、李四没收到"——钱凭空消失。事务保证的是：**这两个动作要么都成功，要么都失败回滚**，绝不允许只做一半。

```sql
-- 没有事务时，第一步成功、第二步崩溃 → 数据不一致
UPDATE account SET money = money - 100 WHERE name='张三';
-- 假设这里数据库宕机
UPDATE account SET money = money + 100 WHERE name='李四';
```

事务的四个边界词：**开启（BEGIN）→ 业务 → 提交（COMMIT）或回滚（ROLLBACK）**。

## 二、ACID 四大特性

ACID 不是空话，每个特性背后都有具体的实现机制——这是面试重点。

- **原子性 Atomicity**：事务里的操作要么全做要么全不做。**靠 undo log 实现**——每一步修改前先记一条"反向操作"到 undo log，回滚时按 undo log 反向执行即可。
- **一致性 Consistency**：事务前后，数据从一个合法状态到另一个合法状态（如转账总额不变）。它是**最终目标**，由 A、I、D 共同保证，再加上应用层业务逻辑的"正确"（比如你不能写一个转账只减不加的代码）。
- **隔离性 Isolation**：多个并发事务互不干扰。**靠锁 + MVCC 实现**——写写冲突用锁，读写冲突用 MVCC（详见 MVCC 篇）。
- **持久性 Durability**：一旦提交，数据永久生效，即使宕机也不丢。**靠 redo log 实现**——提交前先写 redo log，宕机后靠它恢复。

```text
原子性 ──▶ undo log
一致性 ──▶ AID 共同 + 业务正确
隔离性 ──▶ 锁 + MVCC
持久性 ──▶ redo log
```

## 三、事务的使用

基础语法：

```sql
START TRANSACTION;          -- 或 BEGIN
UPDATE account SET money = money - 100 WHERE name='张三';
UPDATE account SET money = money + 100 WHERE name='李四';
COMMIT;                     -- 提交，两行改动生效

-- 若出错：
ROLLBACK;                   -- 回滚，两行改动都撤销
```

**保存点 SAVEPOINT**：大事务里可以设中途存档点，只回滚到某个点而不全废：

```sql
SAVEPOINT sp1;
-- ...一些操作...
ROLLBACK TO sp1;            -- 只回滚到 sp1，之前的操作保留
```

**`autocommit`**：MySQL 默认开启自动提交，即每条单独 SQL 自动包成一个事务。想手动控制事务，要先 `SET autocommit = 0;` 或显式 `BEGIN`。

在 Java 里，Spring 的 **`@Transactional`** 注解就是帮我们自动 `BEGIN/COMMIT/ROLLBACK` 的（底层仍是 JDBC，详见 JDBC 篇）。但要注意它有不少失效场景（见第十一节）。

## 四、redo log

redo log 是 InnoDB 特有的**物理日志**，记录"某个数据页做了什么修改"。它是 **WAL（Write-Ahead Logging，预写日志）** 思想的体现：**先写日志，再慢慢刷磁盘**。

写入路径：`redo log buffer`（内存）→ `page cache`（OS 缓存）→ 磁盘文件。关键参数是 `innodb_flush_log_at_trx_commit`：

| 值 | 行为 | 可靠性 | 性能 |
| --- | --- | --- | --- |
| 0 | 每秒写盘一次 | 可能丢 1 秒数据 | 最好 |
| 1 | **每次提交都刷盘（默认）** | 不丢数据 | 略差 |
| 2 | 每次提交写缓存，每秒刷盘 | 宕机不丢，OS 崩溃可能丢 | 居中 |

**为什么有了 redo log 还要 binlog？** 这是面试高频题：

- **redo log 属于 InnoDB 层**，是**循环写**的固定大小文件，专为崩溃恢复设计。
- **binlog 属于 Server 层**，是**追加写**的日志，用于**主从复制和数据归档恢复**。
- 两者职责不同：redo 保崩溃恢复（已提交的事务不丢），binlog 保主从一致与按时间点恢复。

## 五、undo log

undo log 是**逻辑日志**，记录"反向操作"——比如你 `UPDATE age=20`，它就记一条"把 age 改回原来的值"。它有两个核心用途：

1. **事务回滚**：回滚时按 undo log 反向执行，实现原子性。
2. **MVCC 的基础**：旧版本数据就藏在 undo log 的版本链里，快照读靠它拿到历史版本（详见 MVCC 篇）。

不同操作的 undo 类型：

- `INSERT`：回滚时直接删除这行（undo 类型是 `TRX_UNDO_INSERT_REC`）。
- `UPDATE` / `DELETE`：记"改前的值"，回滚时还原。

旧版本不会被无限堆积——**purge 线程**会在"没有任何事务还需要这个旧版本"时把它回收。

## 六、binlog

binlog（binary log）是 Server 层的归档日志，有三种格式：

| 格式 | 记录内容 | 优点 | 缺点 |
| --- | --- | --- | --- |
| statement | 原始 SQL 语句 | 日志小 | 函数/随机数等可能导致主从不一致 |
| row | 每行的前后镜像 | **主从绝对一致，最安全** | 日志大 |
| mixed | 两者混合 | 折中 | 已较少使用 |

**现在主流用 `row` 格式**，因为主从数据一致性最重要。刷盘参数 `sync_binlog`：设为 1 表示每次提交都刷盘（最安全，配合 `redo=1` 做到不丢数据）。

binlog 的两大作用：**主从复制**（从库读主库 binlog 重放）和**数据恢复**（`mysqlbinlog` 按时间点回放）。

## 七、两阶段提交

既然 redo log 和 binlog 各写各的，怎么保证它们"状态一致"？答案是**两阶段提交（2PC）**。

```text
事务提交时：
  阶段一：prepare
    1. 写 redo log，标记状态为 prepare
  阶段二：commit
    2. 写 binlog
    3. 再把 redo log 标记为 commit
```

**为什么需要它？** 假设先写 redo 再写 binlog，写完 redo 后宕机，binlog 没写——重启后 redo 说"事务已提交"，从库却因为没 binlog 而"不知道这回事"，主从数据就不一致了。两阶段提交保证：只有 binlog 也写完了，事务才算真正提交。

**崩溃恢复判断逻辑**：

- 如果 redo 是 prepare、binlog 完整 → 提交（补一个 commit 标记）。
- 如果 redo 是 prepare、binlog 不完整/缺失 → 回滚（这个事务视为没发生过）。

这样无论在哪一步崩溃，重启后 redo 和 binlog 的状态都能对齐，主从不会错位。

## 八、四种隔离级别

SQL 标准定义了四种隔离级别，解决不同程度的并发问题。MySQL 默认是 **REPEATABLE READ（可重复读，RR）**：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
| --- | --- | --- | --- |
| 读未提交 READ UNCOMMITTED | ❌ 有 | ❌ 有 | ❌ 有 |
| 读已提交 READ COMMITTED (RC) | ✅ 无 | ❌ 有 | ❌ 有 |
| 可重复读 REPEATABLE READ (RR) | ✅ 无 | ✅ 无 | ⚠️ 快照读无 |
| 串行化 SERIALIZABLE | ✅ 无 | ✅ 无 | ✅ 无 |

- **读未提交**：能读到别人**未提交**的数据，最危险，几乎不用。
- **读已提交 RC**：只能读到已提交的，解决了脏读，但同事务内两次读可能不一样（不可重复读）。
- **可重复读 RR**：同事务内多次读结果一致，MySQL 默认。
- **串行化**：所有读写加锁串行执行，绝对安全但性能最差。

可用 `SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;` 设置。

## 九、并发的三大问题

**脏读（Dirty Read）**：事务 A 读到了事务 B **未提交**的数据。B 万一回滚，A 读到的就是"脏"的。

```text
时刻1: B 改了张三余额=0（未提交）
时刻2: A 读到张三余额=0         ← 脏读！
时刻3: B 回滚，张三余额其实是 100
```

**不可重复读（Non-Repeatable Read）**：同一事务内，**同一行数据**被别的事务改了，两次读结果不同。

```text
时刻1: A 读 age=20
时刻2: B 提交 UPDATE age=21
时刻3: A 再读 age=21           ← 同一条记录变了（不可重复读）
```

**幻读（Phantom Read）**：同一事务内，两次**按相同条件查**，第二次查出了**新插入的行**（行数变了，像幻觉）。

```text
时刻1: A 查 WHERE age>18 → 返回 5 行
时刻2: B 提交 INSERT 一条 age=20 的新人
时刻3: A 再查 WHERE age>18 → 返回 6 行  ← 多了"幻影"行
```

**核心区别**：不可重复读是**同一行的值变了**，幻读是**满足条件的行数变了**。

## 十、MySQL 的 RR 能解决幻读吗

这是本篇难点。结论先给：**RR 下，快照读靠 MVCC 解决幻读，当前读靠 next-key lock（记录锁+间隙锁）解决幻读；但有一种情况仍会出现"幻读现象"**。

- **快照读**（普通 `SELECT`）：通过 MVCC 读历史版本，别的事务新插入的"未来版本"对你不可见，因此无幻读。
- **当前读**（`SELECT ... FOR UPDATE`、`UPDATE`、`DELETE`）：InnoDB 在 RR 下用 **next-key lock** 锁住"记录+间隙"，别的事务插不进来，因此也无幻读。

**但坑在这**：如果在同一事务里**先快照读、再当前读**，就可能出现看似幻读的现象：

```sql
-- 事务 A（RR）
SELECT * FROM user WHERE age > 18;     -- 快照读，返回 5 行（MVCC 版本，看不到 B 的插入）
-- 此时事务 B 插入一条 age=20 并提交
SELECT * FROM user WHERE age > 18 FOR UPDATE;  -- 当前读，加 next-key lock
-- 这次返回 6 行！因为当前读看到最新已提交数据
```

注意：这**不是**数据库的 bug，而是"快照读和当前读混用"的预期行为。当前读本就该看到最新数据。真正要避免幻读，应全程保持一致（都用快照读，或都用当前读加锁）。所以严谨说法是：**RR 在"纯快照读"或"纯当前读"下都能避免幻读，但混用会暴露新插入的行**。下一章锁机制会展开 next-key lock。

## 十一、Spring 中事务失效的场景

`@Transactional` 用着方便，但下列场景会悄悄失效，逐条记：

1. **方法非 public**：Spring 的事务代理只拦截 public 方法，private/protected 上的注解不生效。
2. **方法是 final / static**：CGLIB 无法对 final 方法生成代理子类，事务不生效。
3. **同类内部调用**：`this.methodB()` 调用带 `@Transactional` 的 methodB，绕过了代理，事务失效。解决：注入自己（`@Autowired` 自身）再调用，或拆到另一个 Bean。
4. **异常被 catch 吞掉**：方法内 `try-catch` 吞了异常，Spring 感知不到，不会回滚。
5. **抛的是受检异常**：`@Transactional` 默认只对 `RuntimeException` 及其子类回滚，抛 `Exception`（受检）不回滚。需配 `rollbackFor = Exception.class`。
6. **数据库引擎不支持事务**：用了 MyISAM 而非 InnoDB，事务根本不存在。
7. **传播行为设置错误**：如设成 `PROPAGATION_NOT_SUPPORTED` 会挂起事务。
8. **多数据源未指定事务管理器**：多数据源时要 `@Transactional("txManager2")` 指明用哪个。

```java
// 反例：同类内部调用，事务失效
@Service
public class OrderService {
    public void create() {
        insertOrder();          // this 调用，没走代理 → 事务不生效
    }
    @Transactional
    public void insertOrder() { ... }
}
```

## 本篇小结

- 事务保证**一组操作要么全成功要么全失败**，转账是经典场景。
- **原子性靠 undo log，隔离性靠锁+MVCC，持久性靠 redo log，一致性靠三者+业务正确**。
- `autocommit` 默认开启，手动控制事务要先 `BEGIN`。
- **redo log 是 InnoDB 层循环写（崩溃恢复）**，binlog 是 Server 层追加写（主从复制）。
- **两阶段提交**保证 redo 与 binlog 状态一致，否则主从数据错位。
- 四种隔离级别：RU < RC < RR(默认) < SERIALIZABLE，依次解决更多并发问题。
- **脏读=读未提交**；**不可重复读=同行值变**；**幻读=行数变**。
- RR 下**快照读靠 MVCC、当前读靠 next-key lock** 避免幻读，但两者混用会暴露新行。
- binlog 主流用 **row 格式**保证主从绝对一致。
- `innodb_flush_log_at_trx_commit=1` + `sync_binlog=1` 最安全（双 1 配置）。
- **Spring 事务失效**常见于：非 public、final、同类自调用、吞异常、受检异常未配 rollbackFor。

## 参考链接

- [MySQL 官方：事务与 ACID](https://dev.mysql.com/doc/refman/8.0/en/glossary.html#glos_acid)
- [MySQL 官方：隔离级别](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html)
- [MySQL 官方：两阶段提交与崩溃恢复](https://dev.mysql.com/doc/refman/8.0/en/innodb-redo-log.html)
- [MySQL 官方：binlog 格式](https://dev.mysql.com/doc/refman/8.0/en/binary-log-setting.html)
- [Spring 官方：@Transactional 文档](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Transactional.html)
- [丁奇《MySQL 实战45讲》](https://time.geekbang.org/column/intro/100020801)

下一篇 → [05 MVCC](/java/db/mvcc)
