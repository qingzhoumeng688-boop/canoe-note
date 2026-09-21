# 04 流式输出与 Function Calling

> 让回答"打字机般"吐出来，让模型真正"动手"调用外部能力。这两件事，是把 Demo 变成能用的产品体验的关键分水岭。

## 本篇要解决的问题

前面三章我们做出来的对话接口，都是"用户提问 → 后端等几秒 → 一次性返回整段答案"。这有两个致命问题：

1. **体验极差**：模型生成要几秒到几十秒，用户面对一个静止的页面，以为卡死了。
2. **模型"光说不练"**：它只能基于训练知识回答，查不了你的订单、算不了实时数据、调不了你的接口。

这一章解决这两个问题：

- **流式输出**：让答案一个字一个字地流式返回（打字机效果）。
- **Function Calling（工具调用）**：让模型在需要时能"调用你写的 Java 方法"，拿到真实数据后再回答。

读完你能写出一个"边生成边显示、还能查订单"的后端服务。

## 一、流式输出：为什么必须做

回到 01 章的核心认知：**模型是一个字一个字生成 Token 的**。一次回答可能有几百上千个 token，如果每生成一个就发一点给前端，用户几乎立刻看到内容，体感从"卡死"变成"在认真思考"。

对比一下两种体验：

| 方式 | 用户感受 | 首字延迟 | 实现复杂度 |
| --- | --- | --- | --- |
| 非流式（等全部生成完再返回） | 页面静止 5~10 秒，像卡死 | 等于整段生成时间 | 低 |
| 流式（逐字推送） | 立刻开始出字，像真人打字 | 极短（首个 token 时间） | 略高 |

::: tip 结论
只要是面向用户的对话产品，**流式是默认选项，不是可选项**。非流式只适合后端对后端的批量任务。
:::

## 二、SSE 是怎么工作的（通俗讲解）

流式的传输协议，最常见的是 **SSE（Server-Sent Events，服务器推送事件）**。它本质就是**一个长连接 + 服务器不断地往里塞文本**。

它比你自己轮询优雅得多：建立一次 HTTP 连接后，服务器想发多少就发多少，浏览器原声支持。它的"线格式"非常简单——每一段数据长这样：

```text
data: 你好

data: ，我是

data: 你的AI助手

```

规则只有三条：

1. 每段以 `data:` 开头，后面跟内容。
2. 每段以**两个换行 `\n\n`** 结束（这是 SSE 的"分隔符"）。
3. 服务器不主动关闭连接，就一直推；推完了发一个 `data: [DONE]` 之类的结束标记或关闭连接。

浏览器里专门有一个 API 来消费它，叫 `EventSource`，不用你手写解析。下面会用到。

::: warning SSE 不是 WebSocket
SSE 是**单向**的（服务器→浏览器），基于普通 HTTP，自动重连，适合"服务器一直推文本"的场景。WebSocket 是双向全双工，适合聊天室、游戏。做 AI 流式回答，**SSE 就够了，也更简单**。
:::

## 三、后端实现：Spring AI 的 stream() 与 Flux

Spring AI 的 `ChatClient` 把流式封装得很干净：把 `.call()` 换成 `.stream()`，返回类型从 `String` 变成 Project Reactor 的 `Flux<String>`（一串字符串的流）。

`src/main/java/com/example/ai/streamfc/StreamController.java`

```java
package com.example.ai.streamfc;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

/**
 * 流式输出接口。
 *
 * 关键点：
 * 1. .stream().content() 返回 Flux<String>，每个元素是一个（或几个）token 组成的片段。
 * 2. produces = TEXT_EVENT_STREAM_VALUE 告诉 Spring 用 SSE 格式把 Flux 包出去。
 * 3. 引入 spring-boot-starter-webflux 才能在 Spring MVC 控制器里返回 Flux。
 */
@RestController
@RequestMapping("/api/stream")
public class StreamController {

    private final ChatClient chatClient;

    public StreamController(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    @GetMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamChat(@RequestParam(defaultValue = "用三句话介绍 Spring AI") String msg) {
        // call() 换成 stream()，返回的就是逐段推送的内容流
        return chatClient.prompt()
                .user(msg)
                .stream()
                .content();
    }
}
```

需要补充的依赖（在 02 章的 pom 基础上加这一项）：

```xml
<!-- 让 Spring MVC 控制器能够返回 Flux（响应式流），流式输出必备 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>
```

::: warning 为什么必须加 webflux
Spring AI 文档明确指出：**流式输出仅通过 Reactive 栈支持**。命令式（普通 Spring MVC）应用必须引入 Reactive 栈（如 `spring-boot-starter-webflux`），否则 `.stream()` 在 Web 层无法正确写出。同时引入 `spring-boot-starter-web` 和 `webflux` 时，Spring Boot 默认仍以 Servlet（Tomcat）方式启动应用，webflux 仅提供响应式基础设施——这是被官方支持的组合，放心用。
:::

## 四、前端消费：EventSource

后端用 SSE 推，前端用浏览器原生的 `EventSource` 接收，完全不用引第三方库。

`src/main/resources/static/stream.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>流式对话 Demo</title>
</head>
<body>
    <input id="msg" value="用三句话介绍 Spring AI" size="40">
    <button onclick="start()">发送</button>
    <pre id="out"></pre>

    <script>
        function start() {
            const msg = document.getElementById("msg").value;
            const out = document.getElementById("out");
            out.textContent = "";

            // EventSource 只支持 GET，参数只能拼在 URL 上
            const es = new EventSource("/api/stream/chat?msg=" + encodeURIComponent(msg));

            // 每收到一段 data:，onmessage 就触发一次
            es.onmessage = (e) => {
                if (e.data === "[DONE]") {
                    es.close();          // 收到结束标记，关闭连接
                    return;
                }
                out.textContent += e.data; // 把片段追加到页面，形成打字机效果
            };

            es.onerror = () => {
                es.close();               // 连接异常或正常结束都会触发，直接关掉
            };
        }
    </script>
</body>
</html>
```

用 curl 也能直接看流式效果（`--no-buffer` 让 curl 不缓冲，边收边打印）：

```bash
curl --no-buffer "http://localhost:8080/api/stream/chat?msg=你好"
```

::: warning EventSource 的两个限制
1. **只支持 GET**：不能发 POST，参数只能放 URL 查询串。真实项目里如果问题很长或要带鉴权，通常会先由前端 POST 到一个后端接口，再由后端用 SSE 代理出去，或者把 token 放 cookie 而非 Authorization 头。
2. **不能自定义请求头**：所以鉴权要走 cookie / 查询参数，别指望在 EventSource 里塞 `Authorization`。
:::

## 五、RestController 返回 Flux 的坑（produces 设置）

这是初学者最高频的坑，单列一节。

### 坑 1：忘了设 produces

如果你不写 `produces = MediaType.TEXT_EVENT_STREAM_VALUE`，Spring 可能把 `Flux<String>` 当成普通 JSON 数组去序列化，结果前端拿到的是 `[ "你","好",... ]` 这种被引号包裹的数组，或者直接报错。**一定要显式声明成 SSE。**

### 坑 2：返回 `Flux<String>` 但没引 webflux

见第三节警告——没引 webflux 会报"找不到合适的 HttpMessageConverter 写 Flux"之类错误。

### 坑 3：在流里混业务 JSON

SSE 的每条 `data:` 就是一个文本片段。如果你想同时传"内容 + 是否结束 + token 用量"，别塞进一个 JSON 再切片。正确做法：用 `Flux<ChatResponse>`（`.stream().chatResponse()`）拿元数据，或者自己定义事件类型。简单场景就只推纯文本，结束发一个约定标记。

### 坑 4：浏览器缓存

SSE 在某些代理/浏览器下会被缓冲。可在响应头加 `Cache-Control: no-cache` 兜底（Spring 的 SSE 通常已处理，但过反向代理时要留意）。

### 坑 5：连接没关导致资源泄漏

确保前端 `onerror`/`[DONE]` 时 `es.close()`，后端流正常 `complete`。否则连接堆积，把 Tomcat 线程/文件描述符耗光。

## 六、Function Calling 的调用流程

现在解决第二个问题：让模型"动手"。

模型本身是续写机器，它不会真去查数据库。但我们可以告诉它：**"你有两个工具可以用，需要的时候告诉我用哪个、参数是什么，我去执行，再把结果还给你。"** 这就是 Function Calling（Spring AI 里叫 Tool Calling）。

完整闭环有 5 步，框架会自动跑完：

```text
① 你声明工具（@Tool 方法）并注册给模型
        │
        ▼
② 用户提问，模型"决定"要调哪个工具、参数是什么
        │   （模型返回 finish_reason=tool_calls，而不是答案）
        ▼
③ 框架拿着参数，执行你写的 Java 方法，拿到真实结果
        │
        ▼
④ 框架把"工具结果"作为新消息回传给模型
        │
        ▼
⑤ 模型结合工具结果，生成最终的自然语言答复（二次调用）
```

::: tip 重点
步骤 ③④⑤ 在 Spring AI 里**默认是自动的**（内部工具执行）。你只要声明好工具、注册好工具，然后正常 `.call().content()`，框架会自己循环，最后把融合工具结果的答案返回给你。你不需要手写"回传结果再调一次"的循环——除非你主动关掉自动执行。
:::

## 七、用 @Tool 声明工具

工具的"声明"就是在一个普通类的方法上贴 `@Tool` 注解。方法的参数就是工具的入参，返回值就是工具结果。

`src/main/java/com/example/ai/streamfc/OrderTools.java`

```java
package com.example.ai.streamfc;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;

/**
 * 工具类：模型可以"调用"的本地能力。
 *
 * 每个 @Tool 方法都会被 Spring AI 暴露成一个工具定义（名称 + 描述 + 参数的 JSON Schema），
 * 发给模型。模型决定调用时，框架就执行对应的方法。
 *
 * 注意：方法里要自己处理好异常——一旦抛异常，默认会中断工具循环。
 */
public class OrderTools {

    /**
     * 查询订单。这是一个"标量参数"风格的写法：每个 @ToolParam 是工具的一个独立入参。
     */
    @Tool(description = "根据订单号查询订单状态和物流信息。当用户问到具体订单时优先使用。")
    public String queryOrder(
            @ToolParam(description = "订单号，形如 NO123456") String orderId) {
        try {
            // 真实场景：这里查数据库或调订单微服务
            if ("NO123456".equals(orderId)) {
                return "订单 " + orderId + "：已发货，物流中，预计明天 18:00 前送达。";
            }
            return "未找到订单：" + orderId;
        } catch (Exception e) {
            // 工具方法务必兜底，返回可读的错误字符串，而不是抛异常
            return "查询订单时发生错误：" + e.getMessage();
        }
    }

    /**
     * 计算器类工具。当问题涉及算术时，让模型用工具算，而不是心算（模型心算容易错）。
     */
    @Tool(description = "计算两个整数之和")
    public int add(
            @ToolParam(description = "第一个整数") int a,
            @ToolParam(description = "第二个整数") int b) {
        return a + b;
    }
}
```

### 7.1 工具参数用 record / POJO 描述

当一个工具有多个相关联的参数时，把它们收进一个 `record`（或 POJO），语义更清晰，生成的 JSON Schema 也更规整。Spring AI 支持用 `FunctionToolCallback` 显式指定输入类型：

`src/main/java/com/example/ai/streamfc/WeatherTool.java`

```java
package com.example.ai.streamfc;

import org.springframework.ai.tool.function.FunctionToolCallback;
import org.springframework.ai.tool.ToolCallback;

import java.util.function.Function;

/**
 * 用 record 描述工具参数的示例。
 *
 * 当工具入参较多或成组时，用 record 比一堆散装参数更清晰。
 * 这里用 FunctionToolCallback 把"函数 + 输入类型(record)"绑定成一个工具回调。
 */
public class WeatherTool {

    /** 工具入参：用 record 描述，字段名即 JSON Schema 的属性名 */
    public record WeatherRequest(String city, int days) {}

    /** 工具出参（也可直接返回字符串，这里用 record 演示结构化返回） */
    public record WeatherResponse(String city, int days, String forecast) {}

    /** 真正实现：输入 WeatherRequest，输出 WeatherResponse */
    public static class WeatherFunction implements Function<WeatherRequest, WeatherResponse> {
        @Override
        public WeatherResponse apply(WeatherRequest req) {
            // 真实场景调天气 API；这里返回示例
            return new WeatherResponse(req.city(), req.days(),
                    req.city() + " 未来 " + req.days() + " 天晴，气温 20~28℃。");
        }
    }

    /**
     * 构建这个工具的回调。
     * inputType(WeatherRequest.class) 让 Spring AI 根据 record 生成参数 Schema。
     */
    public static ToolCallback callback() {
        return FunctionToolCallback.builder("getWeather", new WeatherFunction())
                .description("查询指定城市未来几天的天气，当用户问天气时使用。")
                .inputType(WeatherRequest.class)
                .build();
    }
}
```

::: tip @Tool 标量参数 vs record 入参怎么选
- 参数少（1~3 个）、彼此独立：用 `@Tool` + `@ToolParam`，最简单。
- 参数成组、或想用强类型描述：用 `FunctionToolCallback` + `inputType(record)`。
- 两者在"模型眼里"都是一份 JSON Schema，效果等价，只是 Java 侧写法不同。
:::

## 八、用 ToolCallbackProvider 注册工具

工具声明好之后，要把它"交给"模型。你要求的是用 `ToolCallbackProvider` 注册，这正是 Spring AI 推荐的"按业务分组批量提供工具"的方式。

`src/main/java/com/example/ai/streamfc/ToolConfig.java`

```java
package com.example.ai.streamfc;

import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 工具注册配置。
 *
 * MethodToolCallbackProvider 会把"带 @Tool 注解的对象"扫描成工具回调数组。
 * 它实现了 ToolCallbackProvider 接口，可以整体交给 ChatClient。
 */
@Configuration
public class ToolConfig {

    @Bean
    public ToolCallbackProvider orderToolProvider() {
        // toolObjects(...) 接受一个或多个包含 @Tool 方法的对象
        return MethodToolCallbackProvider.builder()
                .toolObjects(new OrderTools())
                .build();
    }

    @Bean
    public ToolCallbackProvider weatherToolProvider() {
        // 另一个分组：天气工具（用 FunctionToolCallback 方式声明的）
        return ToolCallbackProvider.from(WeatherTool.callback());
    }
}
```

然后在控制器里把工具绑定到 `ChatClient`：

`src/main/java/com/example/ai/streamfc/FcController.java`

```java
package com.example.ai.streamfc;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Function Calling 演示接口。
 *
 * 工具通过 defaultToolCallbacks(...) 注册到 ChatClient。
 * 之后正常 .call().content()，框架会自动完成"模型决定调用→执行→回传→二次生成"的闭环。
 */
@RestController
@RequestMapping("/api/fc")
public class FcController {

    private final ChatClient chatClient;

    public FcController(ChatClient.Builder builder,
                        ToolCallbackProvider orderToolProvider,
                        ToolCallbackProvider weatherToolProvider) {
        this.chatClient = builder
                // 把两个分组的工具都注册进来；多工具共存就是这么简单
                .defaultToolCallbacks(orderToolProvider.getToolCallbacks())
                .defaultToolCallbacks(weatherToolProvider.getToolCallbacks())
                // system 里明确要求"遇到相关问题时必须用工具"，能显著提升调用率
                .defaultSystem("你是一个智能助理。涉及订单或天气的问题，必须使用提供的工具查询，不要凭空编造。")
                .build();
    }

    @GetMapping("/ask")
    public String ask(@RequestParam(defaultValue = "帮我查一下订单 NO123456 到哪了") String q) {
        // 不需要手写工具循环！框架在内部：
        //   1) 模型返回 tool_calls
        //   2) 执行 OrderTools/WeatherTool 的方法
        //   3) 把结果回传模型
        //   4) 模型生成最终答复
        return chatClient.prompt()
                .user(q)
                .call()
                .content();
    }
}
```

curl 测试：

```bash
# 触发订单工具
curl "http://localhost:8080/api/fc/ask?q=帮我查一下订单NO123456到哪了"
# 触发天气工具（注意 record 入参 city/days 由模型自己填）
curl "http://localhost:8080/api/fc/ask?q=上海未来3天天气怎么样"
# 触发计算器工具
curl "http://localhost:8080/api/fc/ask?q=23加45等于多少"
```

## 九、多工具共存

多工具共用没有任何特殊语法——就是把更多 `@Tool` 方法放进同一个（或不同）工具类，再用 `ToolCallbackProvider` 一起注册。模型会根据每个工具的 `description` 自己判断该用哪个。

关键是两个"坑"：

1. **工具名必须唯一**：如果不同工具类里出现了同名方法（或同名 `@Tool(name=...)`），Spring AI 会报重复工具名错误。用 `ToolUtils.getDuplicateToolNames(...)` 可以排查。
2. **description 要互相区分**：模型靠 description 选工具。两个工具的 description 太像，模型会选错。把"什么时候用我"写清楚。

::: tip 让模型更听话的小技巧
- 在 `defaultSystem` 里明确写"涉及 X 类问题必须用工具 Y"。
- 工具的 `description` 写成"动作 + 适用场景"，例如"查询指定城市的天气，当用户问天气时使用"，而不是干巴巴的"天气查询"。
- 参数用 `@ToolParam(description=...)` 写清楚每个字段的含义和单位。
:::

## 十、两者组合时的坑（流式 + Function Calling）

把流式和工具调用一起用，有几个容易踩的点：

| 坑 | 现象 | 解决 |
| --- | --- | --- |
| 流里看不到工具调用过程 | 直接用 `.stream().content()` 只拿到最终回答的片段，看不到"正在调工具" | 要暴露中间过程，用 `.stream().chatResponse()` 或关掉内部执行手动循环 |
| 工具执行期间前端空等 | 框架先同步跑完工具循环，才开始流式输出最终答案 | 这是正常的：工具结果出来前没东西可流。可在前端显示"正在查询…"过渡 |
| 工具方法抛异常导致流中断 | 异常直接冒泡，SSE 连接异常关闭 | 工具方法内部 try-catch，返回错误字符串（见 OrderTools 示例） |
| 模型无限循环调工具 | 模型反复调同一个工具，请求迟迟不结束 | 关注工具 description 是否引导过度；必要时关掉 `internalToolExecutionEnabled` 手动控制迭代次数 |
| SSE + POST 鉴权 | EventSource 不能带 Authorization 头 | 用 cookie 鉴权，或前端 POST 到后端再由后端代理 SSE |

::: details 想手动控制工具循环？
默认内部工具执行够用了。如果你要精确控制（比如限制最多迭代 3 次、或想在每次工具调用间插入业务逻辑），可以关掉自动执行：

```java
// 思路：通过 ToolCallingChatOptions 关闭内部执行，然后自己写 while 循环
// 用 toolCallingManager.executeToolCalls(prompt, chatResponse) 执行
// 具体 API（类名/方法名）以你所用版本官方文档为准：
// 包路径 org.springframework.ai.tool.execution / org.springframework.ai.chat
```

生产环境一般不必手动控制，默认闭环已经覆盖了绝大多数场景。
:::

## 十一、常见报错排查

| 报错/现象 | 可能原因 | 排查动作 |
| --- | --- | --- |
| 模型从不调用工具 | description 太含糊；system 没要求用工具 | 写清 description 与适用场景；system 明确要求用工具 |
| 参数解析失败 / 工具报错 | record/POJO 字段类型复杂（嵌套、泛型） | 工具入参保持简单：基础类型或扁平 record；避免深层嵌套 |
| 工具名重复 | 不同类有同名 @Tool | 用 `ToolUtils.getDuplicateToolNames` 排查；显式指定 `@Tool(name=...)` |
| 流式控制器启动报错"无法写 Flux" | 没引 webflux | 加 `spring-boot-starter-webflux` 依赖 |
| SSE 前端收到的是 JSON 数组而非文字 | 没设 `produces = TEXT_EVENT_STREAM_VALUE` | 显式声明 SSE 媒体类型 |
| 工具执行异常中断回答 | 工具方法抛了未捕获异常 | 工具方法内部 try-catch，返回安全字符串 |
| 响应极慢且反复调工具 | 模型陷入工具循环 | 检查 description；必要时关闭内部执行手动限制迭代 |
| JSON 解析异常（用了 BeanOutputConverter） | 模型偶尔输出不合规 JSON | 开启原生结构化输出（`ENABLE_NATIVE_STRUCTURED_OUTPUT`）提升可靠性 |

## 本篇小结

- **流式输出是面向用户对话的默认选项**：把几秒等待变成即时打字机效果，靠的是 SSE（长连接 + 逐段 `data:`）。
- **Spring AI 流式 = `.stream().content()` 返回 `Flux<String>`**，控制器要加 `produces = TEXT_EVENT_STREAM_VALUE` 并引入 `webflux`。
- **前端用原生 `EventSource` 接收**，但注意它只支持 GET、不能自定义头。
- **Function Calling 五步闭环**：声明 @Tool → 模型决定调用 → 框架执行 Java 方法 → 回传结果 → 模型二次生成。默认自动完成。
- **`ToolCallbackProvider`（如 `MethodToolCallbackProvider`）** 是按业务分组批量注册工具的标准方式；多工具共存只需一起注册，靠 description 区分。
- **工具参数用 record/POJO 描述**（`FunctionToolCallback.inputType(record)`），语义清晰、Schema 规整。
- **组合流式和工具**时，工具执行是同步的、在流式开始前跑完；务必让工具方法兜底异常。

## 参考链接

- Spring AI Tool Calling 文档：<https://docs.spring.io/spring-ai/reference/api/tools.html>
- Spring AI ChatClient 文档（含 streaming）：<https://docs.spring.io/spring-ai/reference/api/chatclient.html>
- Spring AI ToolCallbackProvider 类（Javadoc）：<https://docs.spring.io/spring-ai/docs/1.1.x/api/org/springframework/ai/tool/ToolCallbackProvider.html>
- MDN EventSource：<https://developer.mozilla.org/zh-CN/docs/Web/API/EventSource>
- 阿里云百炼：<https://bailian.console.aliyun.com/>

下一篇 → [05 Spring AI 框架](/java/ai/spring-ai)
