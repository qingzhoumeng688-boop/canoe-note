# 02 SQL 语句

> 本篇导读：学会了装 MySQL，下一步就是会"说话"——用 SQL 和它交流。本篇从 SQL 的四大分类讲起，把增删改查、WHERE、JOIN、子查询、聚合、分页、执行顺序逐个拆开，最后给出 10 条实战优化建议和慢查询优化案例。SQL 是程序员和数据库之间唯一的通用语言，值得反复练。

## 一、SQL 分类

SQL 按"干什么活"分成四大类，记这张表就够了：

| 分类 | 全称 | 干啥的 | 代表语句 |
| --- | --- | --- | --- |
| DDL | Data Definition Language 数据定义 | 建/改/删库表结构 | `CREATE` `ALTER` `DROP` `TRUNCATE` |
| DML | Data Manipulation Language 数据操作 | 增删改数据 | `INSERT` `UPDATE` `DELETE` |
| DQL | Data Query Language 数据查询 | 查数据 | `SELECT` |
| DCL | Data Control Language 数据控制 | 权限管理 | `GRANT` `REVOKE` |

> 注意：`SELECT` 严格说属于 DQL，但大家习惯把它和 DML 放一起叫"CRUD"。另外 DDL 语句（`CREATE/ALTER/DROP/TRUNCATE`）一旦执行**不可回滚**，因为它们是隐式提交的。

## 二、INSERT

插入数据有几种姿势，性能差别很大：

```sql
-- 1) 单行插入
INSERT INTO user (username, age) VALUES ('张三', 20);

-- 2) 批量插入（一条 SQL 塞多行，比循环单插快得多）
INSERT INTO user (username, age) VALUES
  ('李四', 21),
  ('王五', 22),
  ('赵六', 23);

-- 3) 主键冲突时改成更新（upsert）
INSERT INTO user (id, username, age) VALUES (1, '张三', 25)
  ON DUPLICATE KEY UPDATE age = 25;

-- 4) 冲突则忽略（不报错也不插入）
INSERT IGNORE INTO user (id, username) VALUES (1, '张三');

-- 5) 从查询结果插入（常用于数据迁移）
INSERT INTO user_bak (id, username)
  SELECT id, username FROM user WHERE age > 18;
```

**性能提示**：循环 1000 次单条 `INSERT` 远慢于一条带 1000 行的批量 `INSERT`，因为前者要 1000 次网络往返和事务开销。MySQL 默认 `max_allowed_packet` 有限制，批量行数别太夸张（几千行一批比较稳）。

## 三、UPDATE 与 DELETE

这两兄弟有个**血泪警告：一定要带 WHERE！**

真实事故：某同事想改一条测试数据，手滑写了 `UPDATE user SET status = 0;`（忘了 WHERE），全公司用户的账号瞬间全被禁用，客服电话被打爆。更可怕的是 `DELETE FROM user;` 直接清空整张表。

防范措施：

1. 线上开启 `sql_safe_updates=1`，没有 WHERE 或 WHERE 没走索引的 UPDATE/DELETE 会被拒绝执行。
2. **先 SELECT 确认范围，再改成 UPDATE/DELETE**。
3. 在事务里操作，确认无误再 COMMIT，出问题 ROLLBACK。

```sql
-- 危险示范（千万别在生产这么干）
DELETE FROM user;

-- 安全做法：先查后删
SELECT * FROM user WHERE created_at < '2020-01-01';
DELETE FROM user WHERE created_at < '2020-01-01';
```

## 四、SELECT 基础

最经典的语法骨架：`SELECT ... FROM ... WHERE ...`。

```sql
SELECT id, username, age + 1 AS next_age
FROM user
WHERE age > 18;
```

几个要点：

- **别名**：用 `AS`（可省略）给列/表起别名，提升可读性。
- **`DISTINCT`**：去重，作用于后面所有列的组合。
- **表达式**：SELECT 里可以直接写运算、函数调用。
- **不要用 `SELECT *`**！原因有三：① 把不需要的列也查出来，浪费网络带宽和内存；② 无法走**覆盖索引**（后面索引篇会细讲）；③ 表结构一加列，你的代码可能读到意料之外的字段。

> 口诀：需要哪些列就写哪些列，`SELECT *` 是懒也是坑。

## 五、WHERE 条件

WHERE 是行级过滤的核心，运算符要记牢：

- 比较：`=  !=  >  <  >=  <=  <>`
- 逻辑：`AND` `OR` `NOT`（**注意优先级：AND 高于 OR，建议一律加括号**）
- 范围：`IN (...)` `BETWEEN a AND b`
- 模糊：`LIKE '张%'`，`%` 表示任意多个字符，`_` 表示单个字符
- 空值判断：**用 `IS NULL` / `IS NOT NULL`，永远不要写 `= NULL`**（NULL 不等于任何值，包括它自己）

```sql
-- 加括号避免优先级坑：本意是(安卓或iOS)且未删除
SELECT * FROM device
WHERE (os = 'android' OR os = 'ios') AND deleted = 0;

-- IN 比一堆 OR 清爽
SELECT * FROM user WHERE id IN (1, 2, 3);

-- LIKE 前缀匹配能走索引；%开头则索引失效
SELECT * FROM user WHERE username LIKE 'zhang%';  -- ✅ 走索引
SELECT * FROM user WHERE username LIKE '%zhang';  -- ❌ 全表扫
```

**`EXISTS` vs `IN` 的选择**：当子查询结果集小、主表大时，用 `IN` 往往更好；当子查询大、主表小时，用 `EXISTS` 更优，因为 `EXISTS` 是"命中即停"。现代 MySQL 优化器会自动改写，但了解原理有助于排查慢 SQL。

## 六、排序与分页

`ORDER BY` 多列排序时，排序方向可逐列指定：

```sql
SELECT * FROM user
ORDER BY age DESC, created_at ASC
LIMIT 0, 10;
```

`LIMIT offset, size` 是分页利器，但**深分页是大坑**。`LIMIT 1000000, 10` 为什么慢？因为 MySQL 要先查出前 1000010 行，再丢掉前 1000000 行，只返回最后 10 行——前面一百多万行白查了。

优化方案有两种：

**方案 A：延迟关联（先查 id 再 JOIN 回原表）**

```sql
-- 慢：回表取了很多无用列
SELECT * FROM user ORDER BY id LIMIT 1000000, 10;

-- 快：先在索引上拿到 10 个 id，再回表取完整行
SELECT u.* FROM user u
INNER JOIN (SELECT id FROM user ORDER BY id LIMIT 1000000, 10) t
  ON u.id = t.id;
```

**方案 B：记录上次最大 id（游标分页，适用于连续翻页）**

```sql
-- 上一页最后一行的 id 是 1000000，直接跳过前面的
SELECT * FROM user WHERE id > 1000000 ORDER BY id LIMIT 10;
```

> 经验：APP 信息流、评论列表这类"只下一页"的场景，用方案 B 性能最佳；"跳到第 N 页"的管理后台，方案 A 更合适。

## 七、聚合函数

聚合函数对一组行算出单个值：

- **`COUNT`**：`COUNT(*)`、`COUNT(1)`、`COUNT(字段)` 怎么选？
  - `COUNT(*)` 统计所有行（包括 NULL），**MySQL 已专门优化，最快**，优先用。
  - `COUNT(1)` 和 `COUNT(*)` 性能几乎无差。
  - `COUNT(字段)` 只统计该列**非 NULL** 的行，且要判空，略慢。
- `SUM` `AVG` `MAX` `MIN`：求和、平均、最大、最小。

`GROUP BY` + `HAVING` 做分组统计，**关键区别**：

- **WHERE 在分组前过滤**（不能用聚合函数）。
- **HAVING 在分组后过滤**（可以用聚合函数）。

```sql
-- 查每个城市的用户数，只要用户数超过 100 的城市
SELECT city, COUNT(*) AS cnt
FROM user
WHERE age > 18          -- 分组前先过滤成年人
GROUP BY city
HAVING cnt > 100;       -- 分组后过滤
```

## 八、JOIN

JOIN 是 SQL 最强大也最容易晕的地方。准备两张表：

```sql
-- 用户表
CREATE TABLE user (id INT, name VARCHAR(20));
INSERT INTO user VALUES (1,'张三'),(2,'李四'),(3,'王五');

-- 订单表（user_id 关联 user.id）
CREATE TABLE orders (id INT, user_id INT, amount INT);
INSERT INTO orders VALUES (10,1,100),(11,1,200),(12,2,150),(13,NULL,300);
```

各种 JOIN 的结果示意：

| JOIN 类型 | 结果示意（user 3 行 × orders 4 行） |
| --- | --- |
| INNER JOIN | 两表都匹配：张三 → 订单 10、11；李四 → 订单 12。王五无订单、订单 13 无所属用户，都不出现 |
| LEFT JOIN | 左表全保留：张三 → 10、11；李四 → 12；王五 → NULL（右表没匹配，补空） |
| RIGHT JOIN | 右表全保留：10 → 张三、11 → 张三、12 → 李四、13 → NULL（无主用户） |
| FULL OUTER | MySQL 不支持，用 LEFT JOIN 的结果 UNION RIGHT JOIN 的结果来模拟 |
| CROSS JOIN | 笛卡尔积：左行数 × 右行数，3 用户 × 4 订单 = 12 行，慎用 |

```sql
-- 内连接：只返回两表都匹配的行
SELECT u.name, o.amount
FROM user u INNER JOIN orders o ON u.id = o.user_id;

-- 左连接：左表全保留
SELECT u.name, o.amount
FROM user u LEFT JOIN orders o ON u.id = o.user_id;

-- MySQL 不支持 FULL OUTER JOIN，用 UNION 模拟
SELECT u.name, o.amount FROM user u LEFT JOIN orders o ON u.id=o.user_id
UNION
SELECT u.name, o.amount FROM user u RIGHT JOIN orders o ON u.id=o.user_id;

-- 自连接：同一张表当两张用（如查"同一城市的用户对"）
SELECT a.name, b.name, a.city
FROM user a JOIN user b ON a.city = b.city AND a.id < b.id;
```

**ON 与 WHERE 在 LEFT JOIN 中的区别（高频坑）**：

```sql
-- 条件放 ON：右表被过滤，但左表行仍保留（右表补 NULL）
SELECT u.name, o.amount
FROM user u LEFT JOIN orders o ON u.id = o.user_id AND o.amount > 150;

-- 条件放 WHERE：左表也被过滤（先 JOIN 再筛，可能把左表行剔掉）
SELECT u.name, o.amount
FROM user u LEFT JOIN orders o ON u.id = o.user_id
WHERE o.amount > 150;   -- 王五(NULL) 和 张三(100) 都会被干掉
```

> 记住：**LEFT JOIN 想保留左表全部，过滤右表的条件要写在 ON 里，写在 WHERE 里会把左表一起筛掉。**

## 九、子查询

子查询是"查询里套查询"，按返回结果分：

- **标量子查询**：返回单个值（可放 SELECT 后）。
- **列子查询**：返回一列（配 `IN` 用）。
- **行子查询**：返回一行。
- **表子查询**：返回一张表（配 FROM 用）。

按相关性分：**非相关子查询**（独立跑一次）vs **相关子查询**（外层每行都跑一次，性能差）。

多数子查询可以改写成 JOIN，且**通常更快**，因为 JOIN 能更好利用索引：

```sql
-- 子查询：查买过东西的用户
SELECT name FROM user
WHERE id IN (SELECT user_id FROM orders);

-- 改写成 JOIN（更优，且能走 user.id 索引）
SELECT DISTINCT u.name
FROM user u INNER JOIN orders o ON u.id = o.user_id;
```

## 十、常用函数

记一批高频函数，写 SQL 如虎添翼：

| 类别 | 函数 | 作用 |
| --- | --- | --- |
| 字符串 | `CONCAT(a,b)` | 拼接 |
| 字符串 | `SUBSTRING(s,pos,len)` | 截取 |
| 字符串 | `REPLACE(s,old,new)` | 替换 |
| 数值 | `ROUND(x,n)` | 四舍五入 |
| 数值 | `CEIL(x)` / `FLOOR(x)` | 向上/向下取整 |
| 日期 | `NOW()` | 当前时间 |
| 日期 | `DATE_FORMAT(d, fmt)` | 格式化 |
| 日期 | `DATEDIFF(a,b)` | 相差天数 |
| 条件 | `CASE WHEN ... THEN ... ELSE ... END` | 分支 |
| 条件 | `IF(cond, a, b)` | 二选一 |
| 空值 | `IFNULL(x, default)` / `COALESCE(x,y,...)` | 空值兜底 |

```sql
SELECT
  name,
  CASE WHEN age < 18 THEN '未成年'
       WHEN age < 60 THEN '成年'
       ELSE '老年' END AS age_stage,
  IFNULL(phone, '未填写') AS phone
FROM user;
```

## 十一、UNION 与 UNION ALL

两者都用于纵向拼接结果集，要求**列数相同、对应列类型兼容**：

- `UNION`：自动去重，会额外排序去重，**更慢**。
- `UNION ALL`：直接拼接不去重，**更快**。

```sql
-- 已知无重复时，务必用 UNION ALL
SELECT id, name FROM user_2023
UNION ALL
SELECT id, name FROM user_2024;
```

> 经验：**确定结果不会重复（或重复无所谓）就用 `UNION ALL`**，别让数据库白做去重。

## 十二、SQL 执行顺序

这是很多人写错 SQL 的根源。**书写顺序 ≠ 执行顺序**：

```text
书写顺序：  SELECT  →  FROM  →  WHERE  →  GROUP BY  →  HAVING  →  ORDER BY  →  LIMIT
执行顺序：  FROM    →  WHERE →  GROUP BY →  HAVING    →  SELECT    →  ORDER BY  →  LIMIT
```

执行时先 `FROM` 找表，再 `WHERE` 过滤行，`GROUP BY` 分组，`HAVING` 筛组，然后才 `SELECT` 决定输出哪些列，最后 `ORDER BY` 排序、`LIMIT` 截取。

这解释了两个现象：

- **WHERE 里不能用 SELECT 里的别名**：因为 WHERE 比 SELECT 先执行，别名还没诞生。
- **ORDER BY 能用 SELECT 别名**：因为 ORDER BY 在 SELECT 之后执行。

```sql
-- ❌ 报错：WHERE 阶段不知道 next_age 是啥
SELECT age + 1 AS next_age FROM user WHERE next_age > 20;

-- ✅ 用原始表达式，或改用 HAVING
SELECT age + 1 AS next_age FROM user WHERE age + 1 > 20;
```

## 十三、SQL 优化入门 + 慢查询案例

先给 10 条可落地的优化建议：

1. 避免 `SELECT *`，只取需要的列。
2. 索引列上不做函数运算（如 `WHERE YEAR(created_at)=2024` 会失效）。
3. 避免隐式类型转换（字符串字段传数字）。
4. `LIKE` 不要用 `%` 开头。
5. **用 `EXPLAIN` 看执行计划**，这是优化的第一步。
6. 小表驱动大表（IN 子查询用小表）。
7. 善用**覆盖索引**，让查询只走索引不回表。
8. 大批量操作分批（如每次删 1000 行）。
9. `COUNT(*)` 比 `COUNT(字段)` 快。
10. `UNION ALL` 代替 `UNION`（无需去重时）。

**真实慢查询优化案例**：

某后台"订单列表"接口，随数据增长越来越慢，线上偶发 3 秒以上。原始 SQL：

```sql
SELECT *
FROM orders
WHERE status = 1
  AND created_at >= '2024-01-01'
ORDER BY created_at DESC
LIMIT 1000000, 20;
```

`EXPLAIN` 一看：`type=ALL`（全表扫描），`rows` 上百万，`Extra` 出现 `Using filesort`。问题有三：① `SELECT *` 无法覆盖；② `status` 与 `created_at` 没建联合索引，过滤后还要 filesort；③ 深分页 `LIMIT 1000000` 海量回表。

优化步骤：

```sql
-- 1) 建联合索引（等值在前、范围在后，符合最左前缀）
ALTER TABLE orders ADD INDEX idx_status_created (status, created_at);

-- 2) 改延迟关联，先在索引上拿到 20 个 id
SELECT o.*
FROM orders o
INNER JOIN (
  SELECT id FROM orders
  WHERE status = 1 AND created_at >= '2024-01-01'
  ORDER BY created_at DESC
  LIMIT 1000000, 20
) t ON o.id = t.id;
```

再次 `EXPLAIN`：`type=ref`，`key=idx_status_created`，`Extra` 出现 `Using index`（覆盖索引生效），`rows` 大幅下降，filesort 消失。接口耗时从 3s 降到 80ms。

> 这个案例浓缩了本篇大部分知识点：**联合索引最左前缀 + 覆盖索引 + 延迟关联解决深分页**。后面索引篇会把这些原理讲透。

## 本篇小结

- SQL 分 **DDL / DML / DQL / DCL** 四类，DDL 不可回滚。
- 批量 `INSERT` 远快于循环单插，**注意 `max_allowed_packet` 限制**。
- **UPDATE/DELETE 必须带 WHERE**，可开 `sql_safe_updates` 防误删全表。
- **禁止 `SELECT *`**：费带宽、破覆盖索引、抗表结构变更。
- 判空用 **`IS NULL`**，写 `= NULL` 永远得不到结果。
- **深分页 `LIMIT 1000000` 极慢**，用延迟关联或游标分页优化。
- `COUNT(*)` 最快，`COUNT(字段)` 只计非 NULL。
- **WHERE 分组前过滤，HAVING 分组后过滤**（可用聚合函数）。
- LEFT JOIN 过滤右表条件放 **ON**，放 WHERE 会误删左表行。
- 子查询多数可改写 **JOIN 且更快**。
- 确定无重复时用 **`UNION ALL`** 替代 `UNION`。
- **执行顺序 FROM→WHERE→GROUP BY→HAVING→SELECT→ORDER BY→LIMIT**，故 WHERE 不能用别名。

## 参考链接

- [MySQL 8.0 SELECT 语法官方文档](https://dev.mysql.com/doc/refman/8.0/en/select.html)
- [MySQL JOIN 官方文档](https://dev.mysql.com/doc/refman/8.0/en/join.html)
- [MySQL 优化官方文档](https://dev.mysql.com/doc/refman/8.0/en/optimization.html)
- [MySQL EXPLAIN 官方文档](https://dev.mysql.com/doc/refman/8.0/en/explain-output.html)
- [丁奇《MySQL 实战45讲》](https://time.geekbang.org/column/intro/100020801)
- [《高性能 MySQL（第4版）》](https://www.oreilly.com/library/view/high-performance-mysql/9781492080515/)

下一篇 → [03 索引原理](/java/db/index)
