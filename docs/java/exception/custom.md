# 04 自定义异常

内置异常（`NullPointerException`、`IOException` 等）能描述"技术层面"的问题，却说不清"业务层面"的语义。当系统需要告诉前端"余额不足""订单已取消"时，光抛一个 `RuntimeException("余额不足")` 既不带业务码、也不利于统一处理。本篇带你设计一套**带业务码、带统一返回结构的自定义异常体系**，并用 Spring Boot 的 `@RestControllerAdvice` 做全局兜底。

## 一、为什么要自定义异常

设想一个下单接口，扣款时发现余额不够。如果你直接 `throw new RuntimeException("余额不足")`：

- 前端拿到的只有一句字符串，**无法用代码判断是哪类错误**，只能做字符串匹配（极其脆弱）。
- 没有**业务码 `code`**，前端没法做差异化提示（余额不足 → 跳充值页；订单已取消 → 提示重新下单）。
- 每个方法都自己 `try-catch` 拼返回，逻辑散落各处，**无法集中管控**。

自定义异常的价值，就是给"业务错误"一个**有结构、可编码、可统一处理**的载体：异常里带 `code`（业务码）、`message`（提示）、`cause`（根因），再配合全局处理器，所有 Controller 都不用写重复的 `try-catch`。

## 二、定义方式

自定义异常一般**继承 `RuntimeException`**（非受检），这样不用污染所有方法签名，又能一路冒泡到全局处理器。要提供三组构造器：`message`、`code+message`、以及带 `cause` 的（保留异常链）。

```java
package com.canoe.exception.custom;

/**
 * 业务异常基类：继承 RuntimeException（非受检），便于统一冒泡处理
 */
public class BusinessException extends RuntimeException {

    /** 业务错误码，如 "B00101" */
    private final String code;

    /** 仅带提示信息 */
    public BusinessException(String message) {
        super(message);
        this.code = "B00000";
    }

    /** 带业务码 + 提示信息 */
    public BusinessException(String code, String message) {
        super(message);
        this.code = code;
    }

    /** 带业务码 + 提示 + 根因（保留异常链） */
    public BusinessException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
```

对应业务语义可以再细化子类，例如"余额不足"：

```java
package com.canoe.exception.custom;

/** 余额不足异常：用固定业务码，前端可据此跳充值页 */
public class InsufficientBalanceException extends BusinessException {

    public InsufficientBalanceException(String message) {
        super("B00101", message);
    }

    public InsufficientBalanceException(String message, Throwable cause) {
        super("B00101", message, cause);
    }
}
```

## 三、异常码设计

错误码不是随便写的，建议**有规律、可排序、可定位模块**。一种实用规范：

| 段位 | 含义 | 示例 |
| --- | --- | --- |
| 第 1 位 `B` | 业务异常前缀（系统异常可用 `S`） | `B` / `S` |
| 第 2~3 位 | 模块号（用户 01、订单 02、支付 03…） | `B001` 用户模块 |
| 第 4~6 位 | 序号 | `B00101` 用户-余额不足 |

常见业务分类与推荐码段：

| 类别 | 码段 | 例子 |
| --- | --- | --- |
| 参数错误 | `B00x01` | 手机号格式错误 |
| 权限不足 | `B00x02` | 未登录 / 无操作权限 |
| 资源不存在 | `B00x03` | 用户不存在 / 订单已删除 |
| 业务规则不允许 | `B00x04` | 余额不足 / 库存不足 / 订单已取消 |
| 系统错误 | `S00001` | 下游服务超时（兜底） |

注意：**业务码给前端看、用于分支判断；HTTP 状态码用于协议层（成功 200、参数错 400、未授权 401、系统错 500）。两者职责不同，别混。**

## 四、异常码枚举举例

把错误码定义成枚举，异常持有"枚举值"而不是裸字符串，既能**集中维护**、又能**避免 typo**：

```java
package com.canoe.exception.custom;

/** 业务错误码枚举：集中定义，避免散落各处写错码 */
public enum ErrorCode {

    PARAM_ERROR("B00001", "参数校验失败"),
    UNAUTHORIZED("B00002", "未登录或登录已过期"),
    NOT_FOUND("B00003", "资源不存在"),
    INSUFFICIENT_BALANCE("B00101", "账户余额不足"),
    ORDER_CANCELLED("B00201", "订单已取消，无法继续支付"),
    SYSTEM_ERROR("S00001", "系统繁忙，请稍后再试");

    private final String code;
    private final String message;

    ErrorCode(String code, String message) {
        this.code = code;
        this.message = message;
    }

    public String getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }
}
```

异常改为持有枚举：

```java
package com.canoe.exception.custom;

/** 持有 ErrorCode 枚举的业务异常，构造更简洁、码不会写错 */
public class CodeException extends RuntimeException {

    private final ErrorCode errorCode;

    public CodeException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    public CodeException(ErrorCode errorCode, String detail) {
        super(errorCode.getMessage() + "：" + detail);
        this.errorCode = errorCode;
    }

    public CodeException(ErrorCode errorCode, Throwable cause) {
        super(errorCode.getMessage(), cause);
        this.errorCode = errorCode;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }
}
```

## 五、Spring Boot 全局异常处理

实战重点来了。用 `@RestControllerAdvice` + `@ExceptionHandler`，把**所有 Controller 可能抛的异常**集中到一处转换成一个统一的 `Result` 返回体，Controller 里就彻底告别 `try-catch`。

先定义统一返回结构：

```java
package com.canoe.exception.custom;

/** 统一接口返回体 */
public class Result<T> {

    private String code;
    private String message;
    private T data;

    public Result(String code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    /** 成功 */
    public static <T> Result<T> success(T data) {
        return new Result<T>("00000", "success", data);
    }

    /** 失败 */
    public static <T> Result<T> fail(String code, String message) {
        return new Result<T>(code, message, null);
    }

    public String getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public T getData() {
        return data;
    }
}
```

全局异常处理器：

```java
package com.canoe.exception.custom;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常处理器：拦截所有 Controller 抛出的异常，转成统一 Result
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** 1. 处理我们的业务异常：返回对应业务码 */
    @ExceptionHandler(CodeException.class)
    public Result<Void> handleBusiness(CodeException e) {
        return Result.fail(e.getErrorCode().getCode(), e.getMessage());
    }

    /** 2. 处理参数校验异常（@Valid 触发）：提取第一个字段错误 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> handleValid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldError().getDefaultMessage();
        return Result.fail("B00001", msg);
    }

    /** 3. 兜底：任何没被上面接住的异常，都按系统错误返回 */
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<Void> handleOther(Exception e) {
        // 生产环境不要把 e.getMessage() 直接给前端，这里仅返回友好提示
        return Result.fail("S00001", "系统繁忙，请稍后再试");
    }
}
```

**效果**：Controller 里只管"愉快地抛异常"，例如 `throw new CodeException(ErrorCode.INSUFFICIENT_BALANCE)`，前端收到的就是 `{"code":"B00101","message":"账户余额不足","data":null}`，干净又统一。

## 六、异常与日志

异常要不要记日志？记什么级别？记住几条：

- **业务异常（如余额不足）通常记 `WARN` 即可**——这是用户行为导致的预期内失败，不是系统 bug。
- **真正的系统异常（NPE、下游超时）记 `ERROR`**——这是需要告警排查的。
- **不要在"捕获后又抛出"的地方重复记日志**：全局处理器已经记了，Service 里再记一遍，一次请求打两条重复堆栈，排查时反而干扰。正确做法是：要么在 catch 里记了就不再抛，要么只抛、交给最上层统一记。
- **日志要带请求 ID（traceId）**：用 MDC 把一次请求的所有日志串起来，线上排查时按 traceId 一拉到底。

```text
只抛不记（交给全局处理器）              catch 里记了就不再抛
─────────────────────────            ─────────────────────────
throw new CodeException(...);         log.warn("余额不足 userId={}", id, e);
                                        // 不再 throw，或抛一个包装后由上层决定
```

## 七、异常与事务

这是个**高频坑**：`@Transactional` 默认**只在抛出 `RuntimeException`（及其子类）时才回滚**；如果你在方法里 `try-catch` 把异常吞了、没有重新抛出，Spring 会认为"一切正常"，**事务不会回滚**，数据就脏了。

```java
package com.canoe.exception.custom;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionAspectSupport;

// 示例：扣库存 + 扣款，任一步失败必须整体回滚
public class OrderService {

    /** 错误：catch 后没抛，事务不回滚，库存已扣但余额没扣 → 数据不一致 */
    // @Transactional
    // public void wrongPay(Long userId) {
    //     deductStock();
    //     try {
    //         deductBalance();
    //     } catch (Exception e) {
    //         // 吞掉异常，Spring 以为成功，不回滚！
    //     }
    // }

    /** 正确做法一：重新抛出 RuntimeException，触发回滚 */
    // @Transactional
    // public void rightPay(Long userId) {
    //     deductStock();
    //     deductBalance(); // 抛 RuntimeException 自动回滚
    // }

    /** 正确做法二：捕获后手动标记回滚（适合要吞异常、做兜底返回的场景） */
    // @Transactional
    // public void payWithManualRollback(Long userId) {
    //     deductStock();
    //     try {
    //         deductBalance();
    //     } catch (Exception e) {
    //         // 手动标记当前事务为仅回滚
    //         TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
    //         throw e; // 仍然抛出去让全局处理器接
    //     }
    // }
}
```

结论：**要么不 catch 让它滚，要么 catch 后 `setRollbackOnly()` + 重新抛出**。需要回滚的异常若是受检异常，还要在 `@Transactional(rollbackFor = XxxException.class)` 显式声明。

## 八、给用户的提示

最后一条铁律：**给用户看的提示 ≠ 给开发看的堆栈**。

- 堆栈（`stack trace`）包含类路径、方法名、行号、甚至可能的内网 IP，**绝不能返回前端**——既暴露系统实现，又可能被攻击者利用。
- 给前端的应该是**友好的、与业务码对应的中文提示**（来自 `ErrorCode.message`），例如"账户余额不足，请充值后重试"。
- 真正的堆栈只在**服务端日志**里，配合 traceId 留存，供开发排查。

```text
前端看到（友好、可分支判断）          服务端日志看到（含行号、根因）
─────────────────────────          ─────────────────────────
{ "code":"B00101",                  ERROR 2026-... [traceId=abc]
  "message":"账户余额不足" }            com.canoe...InsufficientBalance
                                          at OrderService.pay(OrderService.java:42)
```

## 本篇小结

- **自定义异常让业务错误"有码可判、有结构可统一处理"**，告别字符串匹配。
- 自定义异常一般**继承 `RuntimeException`（非受检）**，避免污染方法签名。
- 异常应提供**`message`、`code`、带 `cause`** 三组构造器以保留异常链。
- 错误码建议**有规律（前缀+模块+序号）**，方便定位和排序。
- 用**枚举 `ErrorCode` 集中管理错误码**，避免散落各处写错。
- `@RestControllerAdvice` + `@ExceptionHandler` **集中兜底，Controller 免写 try-catch**。
- 统一返回体 `Result` 让**成功/失败结构一致**，前端处理更简单。
- 业务异常记 **`WARN`**、系统异常记 **`ERROR`**，且**不要重复记日志**。
- `@Transactional` 默认**只在抛 RuntimeException 时回滚**，吞异常会导致不回滚。
- **堆栈绝不返回前端**，给用户友好提示、给开发留服务端日志。

## 参考链接

- [Spring 官方：`@RestControllerAdvice`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/bind/annotation/RestControlleAdvice.html)
- [Spring 官方：`@ExceptionHandler`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/bind/annotation/ExceptionHandler.html)
- [Spring 官方：`@Transactional` 与回滚规则](https://docs.spring.io/spring-framework/docs/current/reference/html/data-access.html#transaction-declarative-rolling-back)
- [Spring 官方：`MethodArgumentNotValidException`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/bind/MethodArgumentNotValidException.html)
- [Spring Boot 官方文档：Validation](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#io.validation)
- [Baeldung：Spring 全局异常处理](https://www.baeldung.com/exception-handling-for-rest-with-spring)
- [Lombok 官方：`@Slf4j` 日志注解](https://projectlombok.org/features/Log)

下一篇 → [返回专栏首页](/java/exception/base)
