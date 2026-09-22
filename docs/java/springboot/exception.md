# 05 全局异常处理

没有全局异常处理时，每个 Controller 都得 try-catch，或者异常直接把 500 堆栈抛给前端——既难看又不安全。本篇讲清 `@RestControllerAdvice` 的工作机制、如何用 `@ExceptionHandler` 精确捕获各类异常、设计一套业务错误码，并补齐 Filter、异步等"捕获不到"的坑。

## 一、为什么需要全局异常处理

先看"没有它"的两种糟糕局面：

- **局面 A：到处 try-catch**。每个接口都包一层 `try { ... } catch (Exception e) { ... }`,代码里全是样板，业务被淹没在防御代码里。
- **局面 B：异常裸奔**。没捕获的异常被 Spring 转成默认错误页或一段 JSON 堆栈，前端拿到 `500` 加一堆 `at com.canoe...`，既暴露实现细节，又无法给产品化的错误提示。

全局异常处理的收益：**一处定义、全局兜底**，所有异常集中转成统一的 `Result` 结构返回，前端永远拿到稳定格式的响应，同时敏感堆栈不外露。

## 二、@ControllerAdvice 与 @RestControllerAdvice

两者都是"控制器增强"，区别在于：

- **`@ControllerAdvice`**：增强所有 `@Controller`，处理方法返回值会走视图解析（适合返回页面）。
- **`@RestControllerAdvice`**：= `@ControllerAdvice` + `@ResponseBody`，返回值直接写进响应体（适合返回 JSON），写接口几乎都用它。

`@ControllerAdvice` 还能**限定作用范围**，避免"一刀切"：

```java
package com.canoe.springboot.exception;

import org.springframework.web.bind.annotation.ControllerAdvice;

// 只增强指定包下的控制器
@ControllerAdvice(basePackages = "com.canoe.order")
public class OrderExceptionAdvice {
}

// 只增强指定类型的控制器
// @ControllerAdvice(assignableTypes = {BookController.class})

// 只增强带特定注解的控制器
// @ControllerAdvice(annotations = RestController.class)
```

范围控制的价值：订单模块想用自己的异常策略、公共模块用另一套时，可以并存多个 Advice 而互不干扰。

## 三、@ExceptionHandler

`@ExceptionHandler` 标注在 Advice 内部的方法上，声明"我能处理哪类异常"。匹配规则是**最精确的异常类型优先**：比如同时有 `Exception` 和 `IllegalArgumentException` 两个处理器，抛出 `IllegalArgumentException` 时优先命中更具体的那个。

方法可以接收的参数包括：异常对象本身、`WebRequest`、`HttpServletRequest`、`HttpServletResponse`。返回 `ResponseEntity` 可以**精确控制 HTTP 状态码**：

```java
package com.canoe.springboot.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;

@RestControllerAdvice
public class DemoExceptionHandler {

    // 精确处理参数非法异常，返回 400
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<String> handleIllegal(IllegalArgumentException ex, WebRequest request) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("参数非法：" + ex.getMessage());
    }
}
```

## 四、完整的全局异常处理器

下面是一份可直接用的完整处理器，覆盖常见异常类型。注意 Spring Boot 3 的 404 异常是 `NoResourceFoundException`（2.x 是 `NoHandlerFoundException`，需确认版本）：

```java
package com.canoe.springboot.exception;

import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

// 统一响应结构（与 Web 篇一致）
class ApiResult {
    private int code;
    private String message;

    public ApiResult(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public static ApiResult fail(int code, String message) {
        return new ApiResult(code, message);
    }

    public int getCode() {
        return code;
    }

    public void setCode(int code) {
        this.code = code;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}

// 自定义业务异常
class BizException extends RuntimeException {
    private final int code;

    public BizException(int code, String message) {
        super(message);
        this.code = code;
    }

    public int getCode() {
        return code;
    }
}

@RestControllerAdvice
public class GlobalExceptionHandler {

    // 1. 自定义业务异常
    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResult> handleBiz(BizException ex) {
        return ResponseEntity.ok(ApiResult.fail(ex.getCode(), ex.getMessage()));
    }

    // 2. 参数校验失败（@Valid 触发）
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResult> handleValid(MethodArgumentNotValidException ex) {
        String msg = ex.getBindingResult().getFieldErrors().stream()
                .map((FieldError e) -> e.getField() + ":" + e.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiResult.fail(20000, msg));
    }

    // 3. 缺少必填请求参数
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResult> handleMissing(MissingServletRequestParameterException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResult.fail(20001, "缺少参数：" + ex.getParameterName()));
    }

    // 4. 参数类型不匹配（如字符串转 Long 失败）
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResult> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResult.fail(20002, "参数类型错误：" + ex.getName()));
    }

    // 5. 请求体无法读取（JSON 格式错）
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResult> handleNotReadable(HttpMessageNotReadableException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResult.fail(20003, "请求体格式错误"));
    }

    // 6. 请求方式不支持（如用 GET 访问只接受 POST 的接口）
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResult> handleMethodNotSupported(org.springframework.web.HttpRequestMethodNotSupportedException ex) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(ApiResult.fail(20004, "不支持的请求方式：" + ex.getMethod()));
    }

    // 7. 404（Spring Boot 3 的写法）
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResult> handle404(NoResourceFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResult.fail(40004, "资源不存在：" + ex.getResourcePath()));
    }

    // 8. 兜底异常
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResult> handle(Exception ex) {
        // 生产环境不要把 ex.getMessage() 原样抛给前端，这里仅示例
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResult.fail(10000, "系统开小差了，请稍后重试"));
    }
}
```

## 五、错误码设计

一套清晰的错误码让前后端协作更顺畅。建议分段编排：1xxxx 系统异常、2xxxx 参数异常、3xxxx 业务异常。用枚举维护可读性：

```java
package com.canoe.springboot.exception;

// 业务错误码枚举：code 全局唯一，message 给用户看
public enum ErrorCode {

    SYSTEM_ERROR(10000, "系统异常，请稍后重试"),
    PARAM_INVALID(20000, "参数校验失败"),
    PARAM_MISSING(20001, "缺少必填参数"),
    PARAM_TYPE_ERROR(20002, "参数类型错误"),
    BIZ_ORDER_NOT_FOUND(30001, "订单不存在"),
    BIZ_BALANCE_NOT_ENOUGH(30002, "余额不足");

    private final int code;
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }
}
```

业务代码里直接抛：`throw new BizException(ErrorCode.BIZ_ORDER_NOT_FOUND.getCode(), ErrorCode.BIZ_ORDER_NOT_FOUND.getMessage());`。前端按 code 段判断错误大类，再决定弹窗、跳转还是重试。

## 六、与 @ResponseStatus 的对比

`@ResponseStatus` 可以直接标注在异常类或方法上，固定返回某个状态码：

```java
package com.canoe.springboot.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

// 抛出此异常时固定返回 404
@ResponseStatus(HttpStatus.NOT_FOUND)
public class ResourceNotFoundException extends RuntimeException {
}
```

但它的局限是：**状态码和消息都写死了，无法根据上下文动态变化，也无法统一返回 body 结构**。因此在需要返回统一 `Result` 的接口项目里，更推荐交给 `@RestControllerAdvice` 统一处理，`@ResponseStatus` 可作为简单场景的补充。

## 七、404 与 500 的统一处理

Spring Boot 默认会把未处理的错误导向 `/error`，返回白标错误页或默认 JSON。要让 404 也走你的统一结构，需要两步（Spring Boot 2.3+）：

```yaml
spring:
  # 找不到 handler 时抛异常而非静默跳转
  mvc:
    throw-exception-if-no-handler-found: true
  # 关闭静态资源映射的兜底（否则静态资源找不到不会走 DispatcherServlet）
  web:
    resources:
      add-mappings: false
```

这样未匹配到 Controller 的请求会抛出 `NoResourceFoundException`，被第四节的处理器捕获并返回统一结构。若需要更深定制（如给 `/error` 返回特殊页面或 JSON），可实现 `ErrorController` 或自定义 `ErrorAttributes`：

```java
package com.canoe.springboot.exception;

import java.util.Map;
import org.springframework.boot.web.error.ErrorAttributeOptions;
import org.springframework.boot.web.servlet.error.DefaultErrorAttributes;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.WebRequest;

@Component
public class CustomErrorAttributes extends DefaultErrorAttributes {

    @Override
    public Map<String, Object> getErrorAttributes(WebRequest webRequest, ErrorAttributeOptions options) {
        Map<String, Object> map = super.getErrorAttributes(webRequest, options);
        // 在默认错误属性上追加自定义字段
        map.put("app", "canoe-springboot");
        return map;
    }
}
```

## 八、异常日志

全局处理器是记日志的最佳位置，规范如下：

- **级别用 ERROR**：业务可预期的校验失败可用 WARN，真正的异常用 ERROR。
- **打印完整堆栈**：`log.error("接口异常", ex)`，不要只打 `ex.getMessage()`，否则排查时丢失现场。
- **带上请求上下文**：URL、参数、traceId、用户 ID，方便链路追踪。
- **不要重复打印**：`@ExceptionHandler` 里记一次即可，别在 Controller 又记一遍，否则日志里同一异常出现多次。

```java
package com.canoe.springboot.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class LoggingExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(LoggingExceptionHandler.class);

    @ExceptionHandler(Exception.class)
    public ApiResult handle(Exception ex) {
        // 一次打印：完整堆栈 + 上下文
        log.error("全局异常捕获: {}", ex.getMessage(), ex);
        return ApiResult.fail(10000, "系统异常");
    }
}
```

## 九、在 Filter 中抛出的异常

**重点坑**：`@RestControllerAdvice` 只能捕获进入 `DispatcherServlet` 之后的异常。而 `Filter` 在 `DispatcherServlet` 之前执行，里面抛的异常**不会被 Advice 捕获**，会直接暴露成容器默认错误。

处理方式：在 Filter 里自己 try-catch，捕获后直接写 JSON 响应；或注册一个位于链末端的兜底 Filter。示例：

```java
package com.canoe.springboot.exception;

import java.io.IOException;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
public class FilterExceptionConfig {

    @Bean
    public FilterRegistrationBean<SafeFilter> safeFilter() {
        FilterRegistrationBean<SafeFilter> bean = new FilterRegistrationBean<>(new SafeFilter());
        bean.setOrder(Integer.MAX_VALUE); // 放在最后，兜底
        return bean;
    }

    // 在 Filter 内捕获异常并直接写回统一结构
    public static class SafeFilter extends OncePerRequestFilter {
        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            try {
                chain.doFilter(request, response);
            } catch (Exception ex) {
                response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"code\":10000,\"message\":\"网关层异常\"}");
            }
        }
    }
}
```

## 十、异步与全局异常

`@Async` 方法、`CompletableFuture` 里的异常**不在请求线程上抛出**，因此 `@RestControllerAdvice` 同样捕获不到。处理方式：

- **`@Async` 方法**：在方法内部 try-catch 自行处理；或用 `AsyncUncaughtExceptionHandler` 全局兜底（实现 `AsyncConfigurer` 的 `getAsyncUncaughtExceptionHandler`）。
- **`CompletableFuture`**：用 `exceptionally` 或 `handle` 在异步链末端捕获：

```java
package com.canoe.springboot.exception;

import java.util.concurrent.CompletableFuture;

public class AsyncService {

    public CompletableFuture<String> doWork() {
        return CompletableFuture.supplyAsync(() -> {
            // 业务逻辑
            return "ok";
        }).exceptionally(ex -> {
            // 异步链路内自行兜底，否则异常会"消失"
            return "fallback";
        });
    }
}
```

记住：**Advice 只管"请求线程"，管不到"异步线程"和"Filter 之前"。**

## 本篇小结

- **全局异常处理避免每个接口重复 try-catch 并防止堆栈泄露**。
- **`@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`**，返回 JSON 首选。
- **`@ControllerAdvice` 可用 `basePackages` 等限定作用范围**，支持多套策略并存。
- **`@ExceptionHandler` 按最精确异常类型优先匹配**，可返回 `ResponseEntity` 自定义状态码。
- **完整处理器应覆盖业务异常、校验异常、404、类型不匹配、兜底 Exception**。
- **Spring Boot 3 的 404 是 `NoResourceFoundException`**，2.x 为 `NoHandlerFoundException`（注意版本）。
- **错误码建议分段（系统/参数/业务）并用枚举维护**，便于前后端协作。
- **`@ResponseStatus` 固定状态码不够灵活**，复杂场景交给 Advice。
- **让 404 走统一结构需开启 `throw-exception-if-no-handler-found`**。
- **异常日志应 ERROR 级、带完整堆栈与请求上下文，且不重复打印**。
- **Filter 内异常不会被 Advice 捕获**，需 Filter 内自行兜底。
- **`@Async`/`CompletableFuture` 异常不在请求线程**，需异步链内处理。

## 参考链接

- [Spring Boot 错误处理官方文档](https://docs.spring.io/spring-boot/docs/current/reference/html/web.html#web.servlet.spring-mvc.error-handling)
- [Spring @ControllerAdvice / @ExceptionHandler](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-ann-exceptionhandler)
- [Spring Boot ErrorController](https://docs.spring.io/spring-boot/docs/current/api/org/springframework/boot/web/servlet/error/ErrorController.html)
- [Baeldung：Exception Handling in Spring REST](https://www.baeldung.com/exception-handling-for-rest-with-spring)
- [Spring @ResponseStatus 文档](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/bind/annotation/ResponseStatus.html)

下一篇 → [06 整合 MyBatis](/java/springboot/mybatis)
