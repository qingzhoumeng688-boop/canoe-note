# 05 事务管理

数据库事务保证了"要么全做、要么全不做"。但如果在每个业务方法里手写 `conn.setAutoCommit(false)` / `commit()` / `rollback()`，代码会又臭又长。Spring 的事务管理，就是**在数据库连接之上做的一层优雅封装**。本文把声明式事务、七种传播行为、隔离级别、底层原理、失效场景与实战一次讲清。

## 一、事务的概念回顾

呼应 MySQL 事务篇：一个事务的 ACID 靠的是数据库连接的 `Connection`。Spring 事务**并没有发明新东西**，它只是在这个连接之上做了一层封装：

```text
你写的业务代码
   ↓ Spring 事务（AOP 环绕）
关闭自动提交 → 执行 SQL → 成功 commit / 失败 rollback → 恢复连接
   ↓ 底层
JDBC Connection.setAutoCommit(false) / commit() / rollback()
```

也就是说，**Spring 事务的本质就是：在方法开始时关掉自动提交，结束时根据是否抛异常决定提交还是回滚，最后把连接状态还原并归还连接池**。理解了这一点，后面所有"失效场景"都能追到根上。

## 二、编程式 vs 声明式

**编程式事务**：用 `TransactionTemplate` 手动控制，灵活但侵入代码。

```java
package com.canoe.spring.tx;

import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ProgrammaticService {

    private final TransactionTemplate txTemplate;

    public ProgrammaticService(TransactionTemplate txTemplate) {
        this.txTemplate = txTemplate;
    }

    public void doBusiness() {
        // 手动包一层事务，业务逻辑写在回调里
        txTemplate.execute(status -> {
            // 执行多条 SQL……
            return null;
        });
    }
}
```

**声明式事务**：用 `@Transactional` 注解，零侵入、最常用。

```java
package com.canoe.spring.tx;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DeclarativeService {

    // 一个注解搞定：方法内所有 SQL 要么一起成功，要么一起回滚
    @Transactional
    public void doBusiness() {
        // 执行多条 SQL……
    }
}
```

**对比**：编程式灵活（可精细控制回滚点），但每个方法都要包模板；声明式清爽、与业务解耦，**99% 场景用声明式即可**。本篇主要讲声明式。

## 三、@Transactional 的属性

| 属性 | 作用 | 说明 |
| --- | --- | --- |
| `propagation` | 传播行为 | 当前已有事务时，新方法是加入还是新建，见第四节 |
| `isolation` | 隔离级别 | 并发事务的隔离程度，见第五节 |
| `timeout` | 超时（秒） | 超过则回滚，防止长事务 |
| `readOnly` | 只读 | 提示数据库做优化（如 MySQL 只读不写 undo） |
| `rollbackFor` / `noRollbackFor` | 回滚规则 | 指定哪些异常回滚 / 不回滚 |

**最关键的坑 —— `rollbackFor`**：

**`@Transactional` 默认只回滚 `RuntimeException` 和 `Error`，受检异常（checked exception）不会回滚！** 如果你方法声明 `throws IOException` 又抛了它，事务会"照常提交"，数据就脏了。

```java
package com.canoe.spring.tx;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WrongService {

    // 危险：抛出受检异常 FileNotFoundException 时不会回滚！
    @Transactional
    public void importFile() throws java.io.FileNotFoundException {
        // 写库成功
        // throw new java.io.FileNotFoundException(); // 不会回滚！
    }

    // 正确：显式声明要回滚的异常类型
    @Transactional(rollbackFor = Exception.class)
    public void importFileSafe() throws java.io.FileNotFoundException {
        // 写库成功
        // throw new java.io.FileNotFoundException(); // 现在会回滚
    }
}
```

**经验法则**：业务方法一律写上 `rollbackFor = Exception.class`，除非你明确知道只处理运行时异常。

## 四、七种传播行为

传播行为规定了"**当一个事务方法调用另一个事务方法时，事务怎么传播**"。七种含义如下：

| 传播行为 | 含义 | 典型场景 |
| --- | --- | --- |
| `REQUIRED`（默认） | 有则加入，无则新建 | 绝大多数业务方法 |
| `SUPPORTS` | 有就加入，无就非事务运行 | 查询方法 |
| `MANDATORY` | 必须在已有事务中，否则抛异常 | 强制依赖外层事务 |
| `REQUIRES_NEW` | 挂起当前事务，新建独立事务 | 日志/审计（失败不影响主流程） |
| `NOT_SUPPORTED` | 挂起事务，以非事务方式执行 | 不关心事务的批量操作 |
| `NEVER` | 必须在非事务中，有事务则抛异常 | 明确不要事务 |
| `NESTED` | 在当前事务内开嵌套（savepoint） | 部分失败可回滚到嵌套点 |

**重点 1：`REQUIRED`**——外层没事务就自己建，外层有事务就加入。最常见的"下单"方法就是它。

**重点 2：`REQUIRES_NEW`**——最实用的"独立事务"。场景：**下单失败了，但"失败原因"这个日志必须落库**（不能因为主事务回滚而一起没了）。

```java
package com.canoe.spring.tx;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

@Service
public class OrderService {

    private final FailLogService failLogService;

    public OrderService(FailLogService failLogService) {
        this.failLogService = failLogService;
    }

    @Transactional // 默认 REQUIRED
    public void createOrder() {
        try {
            // 扣库存、创建订单……
            throw new RuntimeException("库存不足");
        } catch (Exception e) {
            // 用独立事务记录失败日志，主事务回滚不影响它
            failLogService.record(e.getMessage());
            throw e; // 继续抛出，让主事务回滚
        }
    }
}

@Service
class FailLogService {

    // 关键：REQUIRES_NEW，挂起主事务，自己独立提交
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String msg) {
        // 插入失败日志表（即使主事务回滚，这条记录也会保留）
        System.out.println("记录失败日志：" + msg);
    }
}
```

**重点 3：`NESTED`**——靠数据库 savepoint 实现"嵌套"。外层回滚会把嵌套一起回滚；但嵌套内部回滚只回到 savepoint，外层仍可继续。适合"批量导入，单条失败只跳过该条"的场景。

## 五、隔离级别

`@Transactional(isolation = ...)` 对应数据库隔离级别：

| 隔离级别 | 含义 | 防住的问题 |
| --- | --- | --- |
| `DEFAULT` | 跟随数据库（**MySQL 默认 REPEATABLE_READ**） | — |
| `READ_UNCOMMITTED` | 读未提交 | 脏读、不可重复读、幻读都可能 |
| `READ_COMMITTED` | 读已提交 | 防脏读 |
| `REPEATABLE_READ` | 可重复读 | 防脏读、不可重复读 |
| `SERIALIZABLE` | 串行化 | 全防，但性能最差 |

**重点**：`DEFAULT` 不是某个固定级别，而是"**沿用底层数据库的设置**"。MySQL 默认 `REPEATABLE_READ`，Oracle 默认 `READ_COMMITTED`。一般不需要改，遇到并发读问题（如不可重复读）再针对性调整。呼应 MySQL 事务篇的隔离级别与锁机制。

## 六、事务的实现原理

`@Transactional` 的底层就是 **AOP 的 `@Around` 环绕通知**，由 `TransactionInterceptor` 完成：

```text
@Around 目标方法：
  1. 从事务管理器获取连接（绑定到当前线程 ThreadLocal）
  2. 关闭自动提交 setAutoCommit(false)
  3. 执行目标方法
  4. 正常 → commit；抛异常且匹配 rollbackFor → rollback
  5. 恢复自动提交，把连接归还连接池
```

**两个必须记住的原理**：

- **事务绑定在线程上**：Spring 用 `ThreadLocal` 把数据库连接绑定到当前线程，同一个事务只在"同一个线程内"有效。所以**跨线程（如 `@Async` 异步、自己 new 线程）调用，事务不生效**——新线程拿不到那个连接。
- **代理才生效**：和 AOP 一样，事务靠代理织入。所有"失效场景"几乎都能归结为"调用绕过了代理"或"连接没绑到当前线程"。

## 七、事务失效的八大场景

这是**本篇实战核心**，每个都给反例与解法：

**① 方法不是 `public`**：Spring 事务基于代理，只能增强 `public` 方法。`private` 方法上的 `@Transactional` 直接被忽略。

**② 方法是 `final` / `static`**：CGLIB 无法重写 `final` 方法，代理生成不了，事务自然失效。

**③ 同类内部调用（`this.xxx()`）**：见 AOP 篇，内部调用绕过代理，事务注解不生效。

```java
package com.canoe.spring.tx;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InnerCallService {

    public void outer() {
        this.inner(); // 失效！this 是原始对象，@Transactional 不起作用
    }

    @Transactional
    public void inner() { /* 实际不在事务中 */ }
}
```

**④ 异常被 catch 吞掉没抛出**：事务拦截器靠"是否抛异常"判断回滚；你 `try-catch` 后不抛，`TransactionInterceptor` 以为一切正常，直接提交。

```java
package com.canoe.spring.tx;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EatExceptionService {

    @Transactional
    public void save() {
        try {
            // 写库
            throw new RuntimeException("出错");
        } catch (Exception e) {
            // 错误：吞掉异常，事务不会回滚！
            log.error("忽略", e);
        }
    }
}
```

**⑤ 抛出受检异常且没配 `rollbackFor`**：默认只回滚 `RuntimeException`，受检异常照常提交（见第三节，补上 `rollbackFor = Exception.class`）。

**⑥ 数据库引擎不支持事务**：如 MySQL 的 **MyISAM** 引擎根本不支持事务，怎么配注解都白搭——用 InnoDB。

**⑦ 没有被 Spring 管理**：类上没加 `@Service` / `@Component`，不是 Bean，自然没有代理、没有事务。

**⑧ 多线程 / 异步调用**：`@Async` 或自己开线程执行的那段代码，跑在别的线程，拿不到当前线程绑定的连接，事务不生效（把事务逻辑放在调用线程里，或给异步方法单独加事务）。

## 八、大事务的危害与优化

把很多操作塞进一个事务，是线上事故的高发区：

- **锁等待 / 死锁**：事务越长，持有的行锁越久，别的事务阻塞甚至死锁。
- **连接池耗尽**：长事务占着连接不释放，并发一高连接池被占满，全站雪崩。
- **接口超时**：事务里调 RPC、查大量数据，RT 飙升，网关直接掐断。

**优化建议**：

1. **拆分事务**：能小则小，把不相干的写操作拆成多个短事务。
2. **查询放到事务外**：只读查询不需要事务，先查后开事务。
3. **异步化非核心操作**：发消息、记日志等用 `REQUIRES_NEW` 或异步，不占主事务。
4. **设置 `timeout`**：`@Transactional(timeout = 3)`，超时自动回滚，兜底防长事务。
5. **统一加锁顺序**：避免交叉加锁导致死锁。

## 九、分布式事务简介

`@Transactional` **只管单库 / 单数据源**。一旦跨服务、跨数据库，本地事务就鞭长莫及了。常见方案：

| 方案 | 原理 | 适用 |
| --- | --- | --- |
| Seata AT | 自动补偿（undo 日志） | 同技术栈多库，对业务侵入小 |
| Seata TCC | Try-Confirm-Cancel 三阶段 | 强一致、高要求 |
| Seata Saga | 长流程状态机 + 补偿 | 长事务、跨多系统 |
| 消息最终一致性 | 本地消息表 / 事务消息 | 可接受短暂不一致 |
| RocketMQ 事务消息 | 半消息 + 回查 | 基于 MQ 的解耦场景 |

选型原则：**能避免分布式事务就避免**（如收敛到单库）；实在避免不了，根据"是否要求强一致"在 TCC/AT 与"消息最终一致性"之间取舍。呼应分布式篇与 RocketMQ 篇。

## 十、实战演练

"下单扣库存"：订单表插入 + 库存扣减必须在一个事务里。先演示**错误写法**（吞异常导致没回滚），再给**正确写法**。

```java
package com.canoe.spring.tx;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderServiceImpl {

    private final OrderDao orderDao;
    private final StockDao stockDao;

    public OrderServiceImpl(OrderDao orderDao, StockDao stockDao) {
        this.orderDao = orderDao;
        this.stockDao = stockDao;
    }

    // ❌ 错误：catch 吞掉异常，事务以为成功，库存扣了、订单却没回滚的脏数据
    @Transactional
    public void createOrderWrong(Long userId, Long itemId, int count) {
        try {
            orderDao.insert(userId, itemId, count);
            stockDao.decrease(itemId, count); // 假设这里抛异常
        } catch (Exception e) {
            // 吞异常 → 不会回滚 → 数据不一致
        }
    }

    // ✅ 正确：异常抛出由 TransactionInterceptor 统一回滚；必要时显式 rollbackFor
    @Transactional(rollbackFor = Exception.class)
    public void createOrderRight(Long userId, Long itemId, int count) {
        orderDao.insert(userId, itemId, count);
        stockDao.decrease(itemId, count); // 抛异常 → 订单插入与库存扣减一起回滚
        // 不吞异常，或者需要局部处理后仍要回滚时手动 throw
    }
}
```

**关键结论**：声明式事务要"让异常冒泡到拦截器"。要么不 catch，要么 catch 后重新 `throw`，千万别静默吞掉。配合 `rollbackFor = Exception.class` 和"非 public/final/内部调用"的规避，事务就能稳定可靠地工作。

## 本篇小结

- **Spring 事务是 JDBC `Connection` 之上的一层封装**，本质是关自动提交、提交/回滚、还原连接。
- **声明式事务（`@Transactional`）零侵入、最常用**，编程式 `TransactionTemplate` 仅在需精细控制时用。
- **默认只回滚 `RuntimeException` 和 `Error`**，受检异常不回滚，务必写 `rollbackFor = Exception.class`。
- **七种传播行为中 `REQUIRED` 是默认**，`REQUIRES_NEW` 适合独立日志，`NESTED` 靠 savepoint 做部分回滚。
- **隔离级别 `DEFAULT` 跟随数据库**，MySQL 默认 `REPEATABLE_READ`，一般无需改动。
- **事务靠 AOP 环绕通知实现**，由 `TransactionInterceptor` 完成提交与回滚。
- **事务绑定在线程 `ThreadLocal` 上**，跨线程 / 异步调用事务不生效。
- **事务失效八大场景**：非 public、`final`/静态、内部调用、吞异常、受检异常未配、MyISAM、非 Bean、多线程。
- **大事务会拖垮连接池与锁**，要拆分、查询外移、异步化非核心、设 `timeout`。
- **`@Transactional` 只管单库**，跨库跨服务需 Seata / 消息最终一致性等分布式方案。
- **实战铁律：异常要冒泡**，不要 catch 吞掉，否则事务"假成功"造成数据不一致。

## 参考链接

- [Spring 官方文档：事务管理](https://docs.spring.io/spring-framework/docs/current/reference/html/data-access.html#transaction)
- [Spring 官方文档：@Transactional 参考](https://docs.spring.io/spring-framework/docs/current/reference/html/data-access.html#transaction-declarative-annotations)
- [Spring 官方文档：事务传播行为](https://docs.spring.io/spring-framework/docs/current/reference/html/data-access.html#tx-propagation)
- [Spring Boot 官方文档：事务](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#data.sql.jpa-and-spring-data)
- [Baeldung：Spring @Transactional 指南](https://www.baeldung.com/transaction-configuration-with-jpa-and-spring)
- [Baeldung：Spring 事务传播](https://www.baeldung.com/spring-transactional-propagation)
- [Seata 官方文档](https://seata.io/zh-cn/docs/overview/what-is-seata.html)
- [《Spring 实战（第 6 版）》](https://www.manning.com/books/spring-in-action-sixth-edition)

下一篇 → [返回专栏首页](/java/spring/intro)
