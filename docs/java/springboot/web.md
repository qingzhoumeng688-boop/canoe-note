# 04 Web 开发

Spring Boot 让写一个 HTTP 接口变得极其简单，但"能跑"和"写得规范"之间还有不少东西：请求怎么进来、参数怎么绑定、校验怎么统一、异常怎么兜底、跨域怎么处理。本篇沿着一次请求的生命周期，把 Spring MVC 的常用注解、参数校验、统一返回、拦截器、CORS、文件上传等逐一讲透，并给出可直接套用的代码。

## 一、Spring MVC 的核心流程

一次请求从浏览器到你的方法，中间经过这条链路（Spring Boot 已经帮你把 `DispatcherServlet` 自动注册好了）：

```text
HTTP 请求
   │
   ▼
DispatcherServlet            ← 前端控制器，总调度
   │
   ├─ HandlerMapping          ← 根据 URL 找到对应的 Controller 方法
   ▼
HandlerAdapter               ← 适配并调用方法，处理参数解析
   │
   ▼
Controller 方法              ← 你的业务代码
   │
   ├─ 返回 ModelAndView ──► ViewResolver（页面渲染）
   └─ 返回对象/JSON   ──► HttpMessageConverter（序列化成 JSON）
```

在 Spring Boot 里你**不需要**自己配 `DispatcherServlet`、`ViewResolver`、`HttpMessageConverter`——`WebMvcAutoConfiguration` 已经按约定配好了 Jackson 作为默认 JSON 转换器、默认静态资源映射等。你要做的只是写 Controller。

## 二、Controller 常用注解

逐个说明，并附一张对照表：

| 注解 | 作用 |
| --- | --- |
| `@Controller` | 传统控制器，返回视图名（页面） |
| `@RestController` | = `@Controller` + `@ResponseBody`，返回数据直接写响应体 |
| `@RequestMapping` | 通用映射，可指定 method |
| `@GetMapping` | 处理 GET 请求（窄化注解） |
| `@PostMapping` | 处理 POST 请求 |
| `@PutMapping` | 处理 PUT 请求 |
| `@DeleteMapping` | 处理 DELETE 请求 |
| `@PathVariable` | 取 URL 路径变量 |
| `@RequestParam` | 取查询参数 / 表单字段 |
| `@RequestBody` | 取请求体（JSON → 对象） |
| `@RequestHeader` | 取请求头 |
| `@CookieValue` | 取 Cookie 值 |
| `@ModelAttribute` | 绑定表单对象到模型 |

`@RestController` 与 `@Controller` 的关系：**前者是后者加 `@ResponseBody` 的组合注解**，所以 `@RestController` 的方法返回值会被消息转换器序列化成 JSON，而不是去解析成视图名。写接口几乎都用 `@RestController`。

```java
package com.canoe.springboot.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/books")
public class BookController {

    // 路径变量：GET /books/42
    @GetMapping("/{id}")
    public String get(@PathVariable Long id) {
        return "查询书籍：" + id;
    }

    // 查询参数：GET /books/search?keyword=spring
    @GetMapping("/search")
    public String search(@RequestParam String keyword) {
        return "搜索：" + keyword;
    }
}
```

## 三、参数绑定

Spring MVC 能把各种来源的参数自动塞进方法入参，常见几种：

- **路径参数**：`@PathVariable`，如上例。
- **查询/表单参数**：`@RequestParam`（GET 的 query、POST 表单字段均可）。
- **JSON 请求体**：**必须加 `@RequestBody`**，框架用 Jackson 把 JSON 反序列化成对象。
- **日期参数**：用 `@DateTimeFormat` 指定格式，或全局配 Jackson。
- **自定义类型转换**：实现 `Converter<S, T>` 并注册到 `WebMvcConfigurer`。

```java
package com.canoe.springboot.web;

import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {

    // JSON 请求体必须加 @RequestBody
    @PostMapping("/orders")
    public String create(@RequestBody OrderForm form) {
        return "创建订单：" + form.getTitle();
    }

    // 日期参数按指定格式解析：/reports?day=2026-09-22
    @PostMapping("/reports")
    public String report(@RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate day) {
        return "报表日期：" + day;
    }

    public static class OrderForm {
        private String title;
        private int amount;

        public String getTitle() {
            return title;
        }

        public void setTitle(String title) {
            this.title = title;
        }

        public int getAmount() {
            return amount;
        }

        public void setAmount(int amount) {
            this.amount = amount;
        }
    }
}
```

自定义类型转换器示例：把字符串 `"1,2,3"` 直接转成 `List<Integer>`：

```java
package com.canoe.springboot.web;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.format.FormatterRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addFormatters(FormatterRegistry registry) {
        // 把逗号分隔字符串转成 List<Integer>
        registry.addConverter(new Converter<String, List<Integer>>() {
            @Override
            public List<Integer> convert(String source) {
                return Arrays.stream(source.split(","))
                        .map(Integer::valueOf)
                        .collect(Collectors.toList());
            }
        });
    }
}
```

## 四、参数校验

先引入校验起步依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

在入参对象上用约束注解，Controller 用 `@Valid`/`@Validated` 触发校验。**注意：嵌套对象要对其内部字段加 `@Valid` 才能真正级联校验；分组校验可让同一对象在不同场景用不同规则**。

```java
package com.canoe.springboot.web;

import javax.validation.Valid;
import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {

    @PostMapping("/users")
    public String register(@Valid @RequestBody UserForm form) {
        return "注册成功：" + form.getEmail();
    }

    public static class UserForm {
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        private String email;

        @NotBlank(message = "昵称不能为空")
        @Size(min = 2, max = 20, message = "昵称长度 2-20")
        private String nickname;

        // 嵌套对象：必须加 @Valid 才校验内部字段
        @NotNull(message = "地址不能为空")
        @Valid
        private Address address;

        public static class Address {
            @NotBlank(message = "城市不能为空")
            private String city;

            public String getCity() {
                return city;
            }

            public void setCity(String city) {
                this.city = city;
            }
        }

        public String getEmail() {
            return email;
        }

        public void setEmail(String email) {
            this.email = email;
        }

        public String getNickname() {
            return nickname;
        }

        public void setNickname(String nickname) {
            this.nickname = nickname;
        }

        public Address getAddress() {
            return address;
        }

        public void setAddress(Address address) {
            this.address = address;
        }
    }
}
```

校验失败会抛出 `MethodArgumentNotValidException`，在全局异常处理器里捕获并返给前端字段级错误信息（见异常篇与下节）。

## 五、统一返回结构

团队协作时，所有接口应当返回一致的 JSON 结构，前端才好统一处理。定义一个 `Result<T>`：

```java
package com.canoe.springboot.web;

import java.io.Serializable;

// 通用响应体：code 业务码，message 提示，data 数据
public class Result<T> implements Serializable {

    private int code;
    private String message;
    private T data;

    public Result() {
    }

    public Result(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    // 成功：带数据
    public static <T> Result<T> success(T data) {
        return new Result<>(0, "success", data);
    }

    // 成功：无数据
    public static <T> Result<T> success() {
        return new Result<>(0, "success", null);
    }

    // 失败：带码与消息
    public static <T> Result<T> fail(int code, String message) {
        return new Result<>(code, message, null);
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

    public T getData() {
        return data;
    }

    public void setData(T data) {
        this.data = data;
    }
}
```

统一返回让前端只需判断 `code === 0` 即可，不必每个接口各写一套格式。

## 六、统一异常处理

用 `@RestControllerAdvice` + `@ExceptionHandler` 把异常集中处理，返回统一结构（与异常篇呼应）：

```java
package com.canoe.springboot.web;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class WebExceptionHandler {

    // 参数校验失败
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> handleValid(MethodArgumentNotValidException ex) {
        String msg = ex.getBindingResult().getFieldErrors().stream()
                .map(e -> e.getField() + ":" + e.getDefaultMessage())
                .findFirst()
                .orElse("参数错误");
        return Result.fail(20000, msg);
    }

    // 兜底异常
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<Void> handle(Exception ex) {
        return Result.fail(10000, "系统异常：" + ex.getMessage());
    }
}
```

## 七、静态资源

Spring Boot 默认从以下位置提供静态资源，访问时不需要前缀：

```text
classpath:/static/
classpath:/public/
classpath:/resources/
classpath:/META-INF/resources/
```

把 `logo.png` 放在 `static` 下，直接访问 `http://localhost:8080/logo.png`。自定义方式：

```yaml
spring:
  mvc:
    static-path-pattern: /assets/**     # 访问前缀
  web:
    resources:
      static-locations: classpath:/static/, file:/data/uploads/  # 额外目录（含服务器本地路径）
```

**WebJars**：把前端库（如 jQuery）以 jar 形式引入，通过 `/webjars/...` 访问：

```xml
<dependency>
    <groupId>org.webjars</groupId>
    <artifactId>jquery</artifactId>
    <version>3.7.1</version>
</dependency>
```

访问 `http://localhost:8080/webjars/jquery/3.7.1/jquery.min.js`。

## 八、拦截器

`HandlerInterceptor` 提供三个钩子：`preHandle`（控制器前）、`postHandle`（控制器后、视图前）、`afterCompletion`（完成后，常用于资源清理）。通过 `WebMvcConfigurer` 注册，并可排除特定路径。下面给一个登录拦截的完整示例：

```java
package com.canoe.springboot.web;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

// 登录拦截器：未携带 token 直接拒绝
@Component
public class LoginInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String token = request.getHeader("Authorization");
        if (token == null || token.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":401,\"message\":\"未登录\"}");
            return false; // 返回 false 则不再继续执行 Controller
        }
        return true;
    }
}
```

```java
package com.canoe.springboot.web;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class InterceptorConfig implements WebMvcConfigurer {

    @Autowired
    private LoginInterceptor loginInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(loginInterceptor)
                .addPathPatterns("/**")          // 拦截所有路径
                .excludePathPatterns("/login", "/error", "/static/**"); // 排除登录与静态资源
    }
}
```

**拦截器与过滤器的区别**：`Filter` 是 Servlet 规范层，作用在 `DispatcherServlet` 之前，无法拿到 Spring 的 Controller 信息；`HandlerInterceptor` 是 Spring MVC 层，能感知到你具体调用了哪个处理器方法。需要基于业务语义（如登录、权限、日志）拦截时优先用拦截器。

## 九、过滤器与监听器

Filter 可用 `@WebFilter` + `@ServletComponentScan`，或更推荐用 `FilterRegistrationBean` 精确控制顺序：

```java
package com.canoe.springboot.web;

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
public class FilterConfig {

    // 记录每个请求耗时的过滤器
    @Bean
    public FilterRegistrationBean<TraceFilter> traceFilter() {
        FilterRegistrationBean<TraceFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new TraceFilter());
        bean.addUrlPatterns("/*");
        bean.setOrder(1); // 数值越小越先执行
        return bean;
    }

    public static class TraceFilter extends OncePerRequestFilter {
        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            long start = System.currentTimeMillis();
            chain.doFilter(request, response);
            System.out.println(request.getRequestURI() + " 耗时 " + (System.currentTimeMillis() - start) + "ms");
        }
    }
}
```

监听器（如 `ServletRequestListener`）同理可用 `ServletListenerRegistrationBean` 注册。

## 十、跨域 CORS

同源策略要求协议、域名、端口三者一致。前后端分离时前端（`:3000`）调后端（`:8080`）会触发跨域。分简单请求与预检请求（Preflight，OPTIONS）：复杂请求（带自定义头、非 GET/POST 等）浏览器会先发 OPTIONS 探路。三种解决方式：

1. **`@CrossOrigin`**：精确到方法或类。
2. **全局 `WebMvcConfigurer.addCorsMappings`**：一劳永逸。
3. **Nginx 反向代理**：让前后端同域，最彻底。

全局配置示例：

```java
package com.canoe.springboot.web;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")                 // 对所有路径生效
                .allowedOriginPatterns("*")        // 允许的源（生产应写具体域名）
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)            // 允许携带 Cookie
                .maxAge(3600);                     // 预检结果缓存 1 小时
    }
}
```

## 十一、文件上传下载

用 `MultipartFile` 接收上传，注意配置文件大小限制（Spring Boot 默认单文件 1MB、总 10MB，常需调大）：

```java
package com.canoe.springboot.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class FileController {

    private static final String UPLOAD_DIR = "/data/uploads/";

    // 上传：POST /upload，表单字段 file
    @PostMapping("/upload")
    public String upload(@RequestParam("file") MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            return "文件为空";
        }
        Path dest = Paths.get(UPLOAD_DIR + file.getOriginalFilename());
        Files.createDirectories(dest.getParent());
        file.transferTo(dest);
        return "已保存到 " + dest;
    }

    // 下载：GET /download?name=xxx.png
    @GetMapping("/download")
    public ResponseEntity<byte[]> download(@RequestParam String name) throws IOException {
        Path path = Paths.get(UPLOAD_DIR + name);
        byte[] data = Files.readAllBytes(path);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .body(data);
    }
}
```

```yaml
spring:
  servlet:
    multipart:
      max-file-size: 20MB       # 单文件上限
      max-request-size: 100MB   # 单次请求总上限
```

生产环境大文件通常直传 OSS/对象存储，后端只签发上传凭证。

## 十二、WebMvcConfigurer 常用扩展

`WebMvcConfigurer` 是个"扩展插槽"，除了上面用到的拦截器、CORS、格式化器，还常用：

- **消息转换器**：定制 Jackson 日期/空值处理。
- **视图控制器**：`addViewControllers` 把 `/` 直接映射到首页，免写 Controller。
- **参数解析器 `HandlerMethodArgumentResolver`**：一个实用技巧——自动把"当前登录用户"注入到方法参数。

```java
package com.canoe.springboot.web;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class ArgumentResolverConfig implements WebMvcConfigurer {

    @Override
    public void addArgumentResolvers(java.util.List<HandlerMethodArgumentResolver> resolvers) {
        // 自定义注解 @CurrentUser，自动注入当前登录用户
        resolvers.add(new HandlerMethodArgumentResolver() {
            @Override
            public boolean supportsParameter(MethodParameter parameter) {
                return parameter.hasParameterAnnotation(CurrentUser.class);
            }

            @Override
            public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                          NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
                // 实际项目从 token/Session 解析出用户
                return new LoginUser(1L, "canoe");
            }
        });
    }

    public @interface CurrentUser {
    }

    public static class LoginUser {
        private final Long id;
        private final String name;

        public LoginUser(Long id, String name) {
            this.id = id;
            this.name = name;
        }

        public Long getId() {
            return id;
        }

        public String getName() {
            return name;
        }
    }
}
```

这样 Controller 方法里写 `@CurrentUser LoginUser user` 就能直接拿到登录用户，省去每处重复解析。

## 十三、接口文档

推荐 `springdoc-openapi`（基于 Jakarta/Spring Boot 3 友好），零入侵生成 OpenAPI 文档与 Swagger UI：

```xml
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.6.0</version>
</dependency>
```

```yaml
springdoc:
  swagger-ui:
    path: /swagger-ui.html   # 访问地址
  api-docs:
    path: /v3/api-docs       # OpenAPI JSON 地址
```

启动后访问 `http://localhost:8080/swagger-ui.html` 即可在线调试。常用注解：`@Tag`（给 Controller 分组）、`@Operation`（描述接口）、`@Parameter`（描述参数）。

## 本篇小结

- **`DispatcherServlet` 在 Boot 中已自动注册**，只需专注写 Controller。
- **`@RestController` = `@Controller` + `@ResponseBody`**，接口开发首选。
- **JSON 请求体必须加 `@RequestBody`**，否则无法反序列化。
- **参数校验用 `@Valid`/`@Validated`，嵌套对象要再加 `@Valid` 才级联**。
- **统一返回 `Result<T>` 让前端按 code 一致处理**，避免格式碎片化。
- **`@RestControllerAdvice` 集中处理异常并返回统一结构**。
- **静态资源默认在 `static` 等目录，可用 `static-locations` 扩展到本地路径**。
- **拦截器在 Spring 层、过滤器在 Servlet 层**，业务拦截优先用拦截器。
- **跨域用全局 `addCorsMappings` 最省心**，复杂请求注意预检 OPTIONS。
- **文件上传用 `MultipartFile`，记得调大 `max-file-size`**。
- **`HandlerMethodArgumentResolver` 可自动注入当前登录用户**，减少样板代码。
- **`springdoc-openapi` 零入侵生成接口文档**，便于联调。

## 参考链接

- [Spring MVC 官方文档](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc)
- [Spring Boot Web 开发文档](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.developing-web-applications)
- [Spring Boot 校验（Validation）](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.validation)
- [springdoc-openapi 项目](https://springdoc.org/)
- [Spring CORS 官方说明](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-cors)
- [Baeldung：Spring MVC Interceptor](https://www.baeldung.com/spring-mvc-handlerinterceptor)

下一篇 → [05 全局异常处理](/java/springboot/exception)
