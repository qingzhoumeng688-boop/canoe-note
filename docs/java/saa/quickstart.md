# 08 快速上手

> 从零搭一个能跑的 Spring AI Alibaba 工程：先让大模型开口说话，再用不到 10 行业务代码塞给它一个工具，让它变成一个"会查天气的 Agent"。最后用 curl 和一个网页验证它真的跑起来了。

## 本篇要解决的问题

上一章把骨架讲清楚了，这一章**只关心一件事：让你本地跑通第一个 Agent**。具体来说要搞定：

- 工程怎么建？`pom.xml` 到底要哪些依赖、又为什么必须用 BOM 管版本？
- 配置文件怎么写？API Key 放哪才安全？
- 最简的对话接口怎么写？框架自动帮我们配好了什么？
- 怎么在"对话"之外，加一个**真的会调工具的 Agent**（ReactAgent）？那"10 行代码"的传说怎么落地？
- 跑起来后怎么验证？启动报错怎么逐条排查？

动手前请确认：JDK 17 已装、`AI_DASHSCOPE_API_KEY` 已就绪（见下一节）。

## 一、环境准备

SAA 对运行环境有几个硬要求，先逐条核对，能省掉后面 80% 的"启动失败"：

| 项目 | 要求 | 核查命令 |
| --- | --- | --- |
| JDK | **17**（不支持 8/11/21 以外的非 LTS 未必可行，强烈建议 17） | `java -version` |
| Maven | 3.6+ | `mvn -version` |
| Spring Boot | 3.5.5 | 见 `pom.xml` 的 parent |
| Spring AI | 1.1.2 | 由 BOM 统一管理 |
| Spring AI Alibaba | 1.1.2.0 | 由 BOM 统一管理 |
| 网络 | 能访问 `dashscope.aliyuncs.com` | 见排查章节 |
| API Key | 阿里云百炼 `AI_DASHSCOPE_API_KEY` | `echo $AI_DASHSCOPE_API_KEY` |

::: warning 最常被忽略的一条
**JDK 必须是 17。** 不少同学的机器默认 `java -version` 还是 1.8，结果 Maven 编译直接报 `class file version 61.0` 之类的错。先 `java -version` 确认输出里是 `17.x`，不是再切。
:::

## 二、获取 API-KEY

SAA 默认用阿里云百炼（DashScope）的 qwen-plus 模型，需要一个 API Key。

1. 打开 <https://bailian.console.aliyun.com/>，登录后进入「API-KEY 管理」。
2. 创建一个 Key，**创建后只显示一次，立刻复制保存**。
3. 把 Key 放进环境变量（**不要写进代码或配置文件**）：

```bash
# Linux / macOS
export AI_DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx

# Windows PowerShell
$env:AI_DASHSCOPE_API_KEY="sk-xxxxxxxxxxxxxxxx"
```

::: danger 红线
Key 一旦提交到公开仓库，几分钟内就会被扫描盗刷，产生真实账单。**务必用环境变量或配置中心（Nacos / K8s Secret）下发，并把 `application-local.yml`、`*.env` 加进 `.gitignore`。** 怀疑泄露时，第一动作是去控制台「禁用」，而不是删提交记录。
:::

## 三、引入依赖

这是整个工程的地基。先把 `pom.xml` 完整贴出来，再逐段解释"为什么这么写"。

### 3.1 完整 pom.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">

    <modelVersion>4.0.0</modelVersion>

    <!-- ① 继承 Spring Boot 父 POM：统一管理 Spring 生态版本，并锁定 Java 17 -->
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>saa-quickstart</artifactId>
    <version>1.0.0</version>

    <properties>
        <!-- ② 集中声明两个版本变量，下面 BOM 和依赖都引用它，改版本只改一处 -->
        <java.version>17</java.version>
        <spring-ai.version>1.1.2</spring-ai.version>
        <spring-ai-alibaba.version>1.1.2.0</spring-ai-alibaba.version>
    </properties>

    <dependencies>
        <!-- ③ Web 能力：提供 HTTP 接口，让我们可以用浏览器/curl 调 Agent -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- ④ Spring AI Alibaba 的 Agent 框架核心：ReactAgent 就在这里 -->
        <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-agent-framework</artifactId>
        </dependency>

        <!-- ⑤ 百炼 DashScope 的 starter：自动配置好 ChatModel（qwen-plus） -->
        <dependency>
            <groupId>com.alibaba.cloud.ai</groupId>
            <artifactId>spring-ai-alibaba-starter-dashscope</artifactId>
        </dependency>
    </dependencies>

    <dependencyManagement>
        <dependencies>
            <!-- ⑥ Spring AI 官方 BOM：统一 spring-ai-core / model-* 等子模块版本 -->
            <dependency>
                <groupId>org.springframework.ai</groupId>
                <artifactId>spring-ai-bom</artifactId>
                <version>${spring-ai.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
            <!-- ⑦ Spring AI Alibaba 的 BOM：统一所有 com.alibaba.cloud.ai 下依赖的版本 -->
            <dependency>
                <groupId>com.alibaba.cloud.ai</groupId>
                <artifactId>spring-ai-alibaba-bom</artifactId>
                <version>${spring-ai-alibaba.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

### 3.2 为什么必须用 BOM 管版本

`dependencyManagement` 里的两个 BOM（`spring-ai-bom` 和 `spring-ai-alibaba-bom`）是**本项目最不能删的一段**。原因：

- SAA 由十几个子模块组成（`agent-framework`、`graph`、`starter-dashscope`、各种 Saver……），它们之间版本必须严格对齐。
- 如果你**不引入 BOM、自己给每个依赖写版本号**，Maven 依赖仲裁后很容易得到一套"互相打架"的版本，报错信息往往离谱到看不懂（比如 `NoSuchMethodError`、`ClassNotFoundException`）。
- BOM 的好处是：**依赖里不写 `<version>`，版本全部由 BOM 统一拍板**。所以上面 ④⑤ 的依赖都没有版本号——这不是漏写，是故意的。

::: tip 版本对齐的"铁三角"
本专栏固定组合：**Spring Boot 3.5.5 + Spring AI 1.1.2 + SAA 1.1.2.0**。三者是官方验证过的兼容组合。升级时务必三者同步看官方对照表（见第 09 章），不要只升其中一个。
:::

## 四、配置文件

`src/main/resources/application.yml`：

```yaml
spring:
  application:
    name: saa-quickstart
  ai:
    dashscope:
      # 从环境变量读取，绝不写死在这里。变量名要和系统环境变量一致
      api-key: ${AI_DASHSCOPE_API_KEY}
      chat:
        options:
          model: qwen-plus        # 日常首选，性价比均衡
          temperature: 0.7         # 0 最确定，1 更有创造性
          max-tokens: 2048         # 单次最大输出，防止失控烧钱

server:
  port: 8080

logging:
  level:
    # 调试阶段打开框架日志，能看清每次请求/响应，出问题最好用
    org.springframework.ai: DEBUG
    com.alibaba.cloud.ai: DEBUG
```

> 注意：引入 `spring-ai-alibaba-starter-dashscope` 后，只要 `api-key` 配好，**一个 `ChatModel` Bean 会被自动创建并放进 Spring 容器**。后面我们直接 `@Autowired ChatModel` 即可，无需手写客户端。

## 五、第一个 ChatBot（最简对话接口）

先不碰 Agent，用框架自动配置的 `ChatModel` 写一个最朴素的对话接口，确认"模型能通"。

### 5.1 启动类

`src/main/java/com/example/saa/quickstart/SaaQuickstartApplication.java`

```java
package com.example.saa.quickstart;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 启动类。
 *
 * 引入 spring-ai-alibaba-starter-dashscope 后，Spring Boot 自动配置会读取
 * application.yml 里的 dashscope 配置，自动创建一个 ChatModel Bean。
 * 我们后面所有代码都直接注入它，不用自己 new 客户端。
 */
@SpringBootApplication
public class SaaQuickstartApplication {

    public static void main(String[] args) {
        SpringApplication.run(SaaQuickstartApplication.class, args);
    }
}
```

### 5.2 最简 ChatController

`src/main/java/com/example/saa/quickstart/controller/ChatController.java`

```java
package com.example.saa.quickstart.controller;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 最简对话接口：用 Spring AI 的 ChatClient 把用户的话转给模型。
 *
 * 这一步还没用 SAA 的 Agent 能力，目的是先确认"模型链路通了"。
 * ChatClient 是 Spring AI 提供的流式 API 入口，对底层 ChatModel 做了更好用的包装。
 */
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    // ChatClient.Builder 由自动配置提供，已经绑定好 DashScope 的 ChatModel
    private final ChatClient chatClient;

    // 构造器注入 Builder，并统一设一个系统提示词
    public ChatController(ChatClient.Builder builder) {
        this.chatClient = builder
                .defaultSystem("你是一个务实的 Java 助手，回答简洁、直接给结论。")
                .build();
    }

    /**
     * 示例：http://localhost:8080/api/chat/simple?msg=用一句话解释什么是 Agent
     */
    @GetMapping("/simple")
    public String simpleChat(@RequestParam(defaultValue = "介绍一下你自己") String msg) {
        // Fluent API：prompt() 起手 → user() 设定用户输入 → call() 发起调用 → content() 取文本
        return chatClient.prompt()
                .user(msg)
                .call()
                .content();
    }
}
```

启动后验证：

```bash
curl "http://localhost:8080/api/chat/simple?msg=用一句话解释什么是%20Agent"
```

如果返回了模型的回答文本，说明"模型 → 框架 → 你的接口"整条链路通了。接下来才是重头戏：把它升级成真正的 Agent。

## 六、加一个真正的 Agent（ReactAgent 带工具）

光会聊天还不够——Agent 的灵魂在于**能调工具**。这一节我们用 SAA 的 `ReactAgent`，给它挂一个"查天气"的工具，让它从一个"嘴炮选手"变成"能办事的助手"。

### 6.1 先写一个工具类

工具就是普通的 Spring Bean，方法上标 `@Tool`，框架会自动把它变成模型可调用的能力。

`src/main/java/com/example/saa/quickstart/tools/WeatherTools.java`

```java
package com.example.saa.quickstart.tools;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

/**
 * 天气工具：模拟一个"查天气"的能力。
 *
 * 真实项目里，这里应该去调一个真实的天气 API（如高德、和风）。
 * 为了简化，这里直接返回写死的示例数据，重点放在"工具如何被 Agent 调用"上。
 */
@Component
public class WeatherTools {

    /**
     * @Tool 把这个方法暴露成 Agent 可调用的工具。
     *  - description 极其重要：模型靠它判断"什么时候该调这个工具"。
     *    描述写得好不好，直接决定 Agent 会不会用这个工具。
     *  @ToolParam 给参数加说明，模型据此决定传什么值。
     */
    @Tool(description = "根据用户提供的城市名称查询该城市当前的天气情况")
    public String getWeather(
            @ToolParam(description = "城市名称，例如：北京、上海、杭州") String city) {

        // 真实场景：这里发起 HTTP 请求到天气服务，拿到 JSON 再解析
        // 此处用固定返回模拟，便于本地直接跑通
        return String.format("%s：晴，气温 25℃，东南风 3 级，空气质量良。", city);
    }
}
```

### 6.2 用 ReactAgent 包成 Agent（核心不到 10 行）

`src/main/java/com/example/saa/quickstart/config/AgentConfig.java`

```java
package com.example.saa.quickstart.config;

import com.alibaba.cloud.ai.graph.agent.ReactAgent;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import com.example.saa.quickstart.tools.WeatherTools;

/**
 * 把"模型 + 工具"组装成一个 ReactAgent。
 *
 * 注意：这里没有手写任何 ReAct 循环、状态管理、工具调度逻辑——
 * 这些全被 ReactAgent 封装了。业务代码不到 10 行。
 */
@Configuration
public class AgentConfig {

    @Bean
    public ReactAgent weatherAgent(ChatModel chatModel, WeatherTools weatherTools) {
        // 1. 用 MethodToolCallbackProvider 把 @Tool 标注的方法转成 ToolCallback[]
        ToolCallback[] toolCallbacks = MethodToolCallbackProvider.builder()
                .toolObjects(weatherTools)
                .build()
                .getToolCallbacks();

        // 2. 链式构建一个 ReactAgent，build() 即得到一个可立即调用的 Agent
        return ReactAgent.builder()
                .name("weather_agent")                          // Agent 名称，多 Agent 编排时用于区分
                .model(chatModel)                               // 底层模型，来自自动配置的 ChatModel
                .tools(toolCallbacks)                           // 把工具挂上去
                .systemPrompt("你是一个天气助手，用户问天气时必须调用天气工具查询。")
                .build();
    }
}
```

### 6.3 把"10 行代码"逐行讲透

上面 `weatherAgent` 方法虽然短，但每一行都在干一件"没有框架就得自己写几十行"的活：

| 行 | 在干什么 | 没有框架时你要自己做什么 |
| --- | --- | --- |
| `MethodToolCallbackProvider...` | 扫描 `@Tool` 方法，生成工具元数据（名称、描述、JSON Schema） | 手写工具描述、参数 Schema 生成 |
| `.toolObjects(weatherTools)` | 指定从哪个 Bean 抽取工具 | 手动注册每个工具 |
| `ReactAgent.builder()` | 开一个 Agent 构建器 | 自己搭循环骨架 |
| `.name(...)` | 给 Agent 命名，便于编排和日志追踪 | —— |
| `.model(chatModel)` | 绑定底层大模型 | 自己管理模型客户端 |
| `.tools(...)` | 注册工具，模型运行时能"看到"并调用 | 自己实现"模型要求调工具 → 执行 → 回传结果"的闭环 |
| `.systemPrompt(...)` | 设定 Agent 角色与行为约束 | —— |
| `.build()` | **编译成可执行的 Agent**（内部生成 StateGraph） | 自己实现 ReAct 循环 + 状态管理 |

::: tip "10 行"省掉的是"写的功夫"，不是"理解的功夫"
`build()` 这一步在内部会：① 把系统提示词和工具定义一起发给模型；② 解析模型的"我要调 XX 工具"的意图；③ 真正执行你的 Java 方法；④ 把结果塞回上下文让模型继续推理；⑤ 循环直到模型认为任务完成。**这五步你一行都没写，但你必须知道它们在发生**——否则 Agent 不调工具、乱调工具时你无从下手。
:::

### 6.4 调用 Agent 的 Controller

`src/main/java/com/example/saa/quickstart/controller/AgentController.java`

```java
package com.example.saa.quickstart.controller;

import com.alibaba.cloud.ai.graph.agent.ReactAgent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Agent 调用接口。
 *
 * ReactAgent.call(String) 接收用户问题，返回模型最终给出的文本答案。
 * 内部可能经历多轮"思考 → 调工具 → 观察"，对调用方是完全透明的。
 */
@RestController
@RequestMapping("/api/agent")
public class AgentController {

    private final ReactAgent weatherAgent;

    // 注入上面 @Bean 创建的 ReactAgent
    public AgentController(ReactAgent weatherAgent) {
        this.weatherAgent = weatherAgent;
    }

    /**
     * 示例：http://localhost:8080/api/agent/weather?msg=北京今天天气怎么样？
     */
    @GetMapping("/weather")
    public String askWeather(@RequestParam String msg) {
        return weatherAgent.call(msg);
    }
}
```

### 6.5 见证"它真的调了工具"

启动后执行：

```bash
curl "http://localhost:8080/api/agent/weather?msg=%E5%8C%97%E4%BA%AC%E4%BB%8A%E5%A4%A9%E5%A4%A9%E6%B0%94%E6%80%8E%E4%B9%88%E6%A0%B7%EF%BC%9F"
```

你应当看到回答里包含类似"北京：晴，气温 25℃……"的工具返回内容——**这说明模型自己判断"这个问题需要查天气"，主动调用了你的 `getWeather` 方法**。这一步，就是 Agent 和"纯对话"的本质区别。

::: warning 模型可能"不调工具"
如果它直接编了一段天气（幻觉）而不是调用工具，通常是这两个原因：① 你的 `@Tool` 的 `description` 写得太模糊，模型不知道有这能力；② 系统提示词没强调"必须调工具"。**工具描述写得像给同事看的说明书，越清楚越好。**
:::

## 七、用网页验证（/chatui）

除了 curl，给项目加一个最简单的静态聊天页，浏览器打开就能聊。

### 7.1 静态页面

`src/main/resources/static/chatui/index.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>SAA 快速上手 - 聊天测试</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; }
        #log { border: 1px solid #ddd; padding: 12px; height: 320px; overflow: auto; }
        .u { color: #1565c0; } .a { color: #2e7d32; }
        input { width: 70%; padding: 8px; } button { padding: 8px 16px; }
    </style>
</head>
<body>
    <h2>Spring AI Alibaba 快速上手</h2>
    <div id="log"></div>
    <input id="msg" placeholder="问点什么，例如：北京今天天气怎么样？" />
    <button onclick="send()">发送</button>

    <script>
        const log = document.getElementById('log');
        async function send() {
            const msg = document.getElementById('msg').value;
            log.innerHTML += '<div class="u">你：' + msg + '</div>';
            // 打到我们第 6 节的 Agent 接口
            const resp = await fetch('/api/agent/weather?msg=' + encodeURIComponent(msg));
            const text = await resp.text();
            log.innerHTML += '<div class="a">Agent：' + text + '</div>';
            document.getElementById('msg').value = '';
            log.scrollTop = log.scrollHeight;
        }
    </script>
</body>
</html>
```

启动后访问 <http://localhost:8080/chatui/index.html>，输入"上海天气怎么样"，即可看到 Agent 调用工具后的回答。

> 官方 `examples/chatbot` 也内置了一个 `/chatui` 页面，想看更完整的 UI 可以 `git clone` 官方示例直接跑。本专栏为了把原理讲透，这里用最小自写页面。

### 7.2 完整的验证清单

| 验证项 | 命令 / 地址 | 预期结果 |
| --- | --- | --- |
| 纯对话链路 | `curl ".../api/chat/simple?msg=hi"` | 返回模型文本 |
| Agent 调工具 | `curl ".../api/agent/weather?msg=北京天气"` | 返回含工具结果的天气 |
| 网页验证 | 打开 `/chatui/index.html` | 浏览器内可对话 |
| 工具未触发排查 | 看 DEBUG 日志里是否有 `tool_calls` | 有则说明模型决定调工具 |

## 八、启动失败逐条排查

按出现频率排序，遇到报错从第一条往下对。

### 8.1 API Key 没配 / 配错

**现象**：启动报 `IllegalArgumentException` / `Missing required configuration 'spring.ai.dashscope.api-key'`，或调用时报 401。

**排查**：
```bash
echo $AI_DASHSCOPE_API_KEY     # 确认非空
```
- 变量名要和 `application.yml` 里 `${AI_DASHSCOPE_API_KEY}` 完全一致（大小写敏感）。
- 如果是在 IDE 里跑，记得在 Run Configuration 的 Environment 里也设上这个环境变量，IDE 不会自动继承 shell 的。
- 确认 Key 本身有效（去百炼控制台看状态，没被禁用、没过期）。

### 8.2 JDK 版本不对

**现象**：编译期 `class file version 61.0, class com... was compiled by a more recent version of the Java Runtime`；或启动报 `UnsupportedClassVersionError`。

**排查**：
```bash
java -version    # 必须输出 17.x
mvn -version     # 看末尾 "Java version" 也是 17
```
若不是 17，安装 JDK 17 并在 IDE / `JAVA_HOME` 里切过去。Maven 用的 JDK 和项目 `java.version` 要一致。

### 8.3 依赖版本冲突 / BOM 没生效

**现象**：运行时 `NoSuchMethodError`、`ClassNotFoundException`、`No qualifying bean of type 'ChatModel'`。

**排查**：
- 确认 `pom.xml` 的 `dependencyManagement` 里**两个 BOM 都在**，且版本分别是 `1.1.2` 和 `1.1.2.0`。
- 确认 `agent-framework` 和 `starter-dashscope` 这两个依赖**没有手写 `<version>`**（交给 BOM）。
- 执行 `mvn dependency:tree | grep spring-ai` 检查是否混入了不同版本的 `spring-ai-core`。如有，说明某处手动指定了版本，删掉即可。
- 如果同时引入了 `spring-ai-starter-model-openai` 和 `spring-ai-alibaba-starter-dashscope`，两者都会尝试创建 `ChatModel` Bean，注入时会因"多个候选 Bean"失败。**只保留一个模型 starter**。

### 8.4 网络不通 / 区域限制

**现象**：调用超时、连接被拒、DNS 解析失败，或返回 `Request failed` 类错误。

**排查**：
- DashScope 端点为 `https://dashscope.aliyuncs.com`。确认机器能访问外网（公司内网可能限制了出网）。
- 若部署在海外节点，访问百炼可能延迟高或受限，建议在国内可用区运行，或切到对应区域支持的模型端点。
- 临时用 `curl` 直连测试连通性：
```bash
curl -v https://dashscope.aliyuncs.com -o /dev/null
```

### 8.5 工具没被调用 / 调用后报错

**现象**：Agent 直接瞎编答案，或调工具时抛异常。

**排查**：
- 工具方法必须是 `public`、非 `static`，且所在类被 Spring 管理（`@Component`/`@Bean`）。
- `@Tool` 的 `description` 写清楚"做什么、什么时候用"。
- 工具方法的入参/返回值要能被 JSON 序列化（简单类型或 POJO），避免用 `Optional`、`CompletableFuture` 等不支持的类型。
- 工具内部抛异常要捕获并返回友好字符串，否则异常会中断 Agent 的推理循环。

::: tip 排查总原则
**先确认"模型链路通"（6.4 之前的纯对话），再确认"工具链路通"（Agent 调工具）。** 把问题一层层隔离，比对着一大坨报错乱改高效得多。
:::

## 本篇小结

- **依赖地基是 BOM**：`spring-ai-bom:1.1.2` + `spring-ai-alibaba-bom:1.1.2.0` 统一管理版本，SAA 各子模块依赖**不要手写 version**。
- **starter 帮你自动配好 `ChatModel`**：引入 `spring-ai-alibaba-starter-dashscope` 并配好 `api-key`，直接注入即可，无需手写客户端。
- **真正的 Agent 不到 10 行业务代码**：`ReactAgent.builder().name().model().tools().systemPrompt().build()`，工具用 `@Tool` 标注、`MethodToolCallbackProvider` 转成 `ToolCallback[]`。
- **Agent 和纯对话的本质区别是会调工具**：验证时看回答里是否出现工具返回的真实数据，而不是模型瞎编。
- **启动失败按四步走**：API Key → JDK 17 → 依赖冲突 → 网络。绝大多数问题落在这四类。

## 参考链接

- Spring AI Alibaba 官网（快速开始）：<https://java2ai.com/>
- 官方 ChatBot 示例：<https://github.com/alibaba/spring-ai-alibaba/tree/main/examples/chatbot>
- Spring AI Alibaba GitHub：<https://github.com/alibaba/spring-ai-alibaba>
- Spring AI 工具机制文档：<https://docs.spring.io/spring-ai/reference/1.1/api/tools.html>
- 阿里云百炼控制台：<https://bailian.console.aliyun.com/>

下一篇 → [09 版本与生态关系](/java/saa/ecosystem)
