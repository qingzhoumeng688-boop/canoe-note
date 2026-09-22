# 02 搭建开发环境

> 本篇导读：很多初学者卡在"环境"这一步——装完 JDK 却敲不出第一个 `HelloWorld`，报错信息看得一头雾水。本篇从 JDK/JRE/JVM 的关系讲起，手把手带你装好环境、配好 `JAVA_HOME`、编译运行第一个程序，并整理一份"现象 → 原因 → 解决"的排障清单，让你把地基打牢。

## 一、JDK、JRE、JVM 三者的关系

刚接触 Java，最常听见的三个缩写就是 JDK、JRE、JVM。它们不是三个并列的东西，而是**一层包一层**的包含关系：

```text
┌─────────────────────────────────────────────┐
│  JDK (Java Development Kit 开发工具包)        │
│  ┌───────────────────────────────────────┐  │
│  │  JRE (Java Runtime Environment 运行环境)│  │
│  │  ┌─────────────────────────────────┐   │  │
│  │  │  JVM (Java Virtual Machine 虚拟机) │   │  │
│  │  │  把 .class 字节码翻译成机器指令    │   │  │
│  │  └─────────────────────────────────┘   │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

- **JVM（Java 虚拟机）**：真正执行代码的地方。它把编译好的 `.class` 字节码翻译成所在操作系统的机器指令，这也是 Java "一次编写，到处运行" 的根本原因。
- **JRE（Java 运行环境）**：JVM + 一堆运行 Java 程序必备的类库（比如 `java.lang`、`java.util`）。如果你的电脑只想**运行**别人的 Java 程序，装 JRE 就够了。
- **JDK（Java 开发工具包）**：JRE + 开发工具（`javac` 编译器、`java` 运行器、`javadoc` 文档工具等）。我们要**写**程序，所以必须装 JDK。

一句话：**开发装 JDK，运行装 JRE，底层跑在 JVM 上。**

## 二、JDK 版本怎么选

Java 的版本号有两个体系：早期的 `1.8` 其实就是 JDK 8；从 JDK 9 起改成按年份命名（9、10、11……）。其中每隔几年会有一个 **LTS（Long-Term Support，长期支持）** 版本，企业项目通常只选 LTS。

```text
版本时间线（节选）
1.8(LTS) ─ 11(LTS) ─ 17(LTS) ─ 21(LTS)
   ↑          ↑         ↑          ↑
 存量主力   老牌稳定   现在推荐   新一代
```

- **JDK 8**：历史最悠久、生态最成熟，大量老项目仍在使用，但已停止免费商业更新。
- **JDK 11**：第一个"新命名规则"下的 LTS，很多中间件的最低要求版本。
- **JDK 17（现在推荐）**：功能新、性能强、长期支持，是 2023 年之后新项目的首选 LTS。
- **JDK 21**：最新的 LTS，带来虚拟线程等重磅特性，适合想尝鲜的团队。

**Oracle JDK 与 OpenJDK 的区别**：Oracle JDK 过去有商业授权限制（生产环境收费），而 OpenJDK 是开源免费版本。现在 Oracle 也提供免费的 Oracle JDK（个人与开发免费），但生产环境很多人更倾向用各厂商基于 OpenJDK 构建的发行版：

| 发行版 | 出品方 | 特点 |
| --- | --- | --- |
| Temurin（原 AdoptOpenJDK） | Eclipse 基金会 | 免费、稳定、社区活跃，新手首选 |
| Zulu | Azul | 商用友好，提供多种系统支持 |
| 龙芯 Loongnix | 龙芯 | 支持国产 LoongArch 架构 |
| 毕昇 JDK | 华为 | 针对鲲鹏/ARM 优化 |
| Dragonwell | 阿里 | 针对云场景优化，国内大厂使用多 |

**建议**：学习阶段直接装 **Temurin 的 JDK 17**，免费、省心、文档全。

## 三、Windows 安装 JDK

以 Temurin JDK 17 为例，步骤如下：

1. **下载**：打开 [Adoptium 官网](https://adoptium.net/)，选 `Temurin 17 (LTS)`、操作系统 `Windows`、架构 `x64`，下载 `.msi` 安装包。
2. **安装**：双击运行，一路"下一步"。默认会装到 `C:\Program Files\Eclipse Adoptium\jdk-17.x.x.x-hotspot\`。建议勾选 "Set JAVA_HOME variable" 和 "Add to PATH"，让安装包帮我们配环境。
3. **配置环境变量**（如果安装时没勾选，需手动配）：

```text
此电脑 → 右键"属性" → 高级系统设置 → 环境变量

新建系统变量：
  变量名：JAVA_HOME
  变量值：C:\Program Files\Eclipse Adoptium\jdk-17.0.x.x-hotspot

编辑系统变量 Path，新增一条：
  %JAVA_HOME%\bin
```

> **为什么要配 `JAVA_HOME`？** 很多工具（Maven、Tomcat、IDEA）并不是直接写死 JDK 路径，而是去读 `JAVA_HOME` 这个环境变量来定位 JDK。你以后升级 JDK 版本，只要改 `JAVA_HOME` 一处即可，不用到处改配置。

4. **验证**：打开新的命令行窗口，输入：

```bash
java -version
```

看到类似下面的输出就成功了：

```text
openjdk version "17.0.9" 2023-10-17
OpenJDK Runtime Environment Temurin-17.0.9+9
OpenJDK 64-Bit Server VM Temurin-17.0.9+9
```

**典型报错**：如果提示 `'java' 不是内部或外部命令，也不是可运行的程序`，99% 是 `Path` 没配对（比如 `JAVA_HOME` 路径写错，或 `%JAVA_HOME%\bin` 没加进 `Path`）。注意一定要**重新打开**命令行窗口，环境变量才会生效。

## 四、Linux / macOS 安装

Linux 和 macOS 更常用压缩包或包管理器安装。

**方式一：包管理器（最省事，以 Ubuntu 为例）**

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y temurin-17-jdk

# CentOS / Rocky（用 yum / dnf）
sudo dnf install -y java-17-openjdk-devel
```

**方式二：下载压缩包手动解压**

```bash
# 解压到 /opt 目录
sudo tar -xzf OpenJDK17U-jdk_x64_linux_hotspot_17.0.9.tar.gz -C /opt

# 写入环境变量（对所有用户生效写 /etc/profile，仅当前用户写 ~/.bashrc）
echo 'export JAVA_HOME=/opt/jdk-17.0.9+9' >> ~/.bashrc
echo 'export PATH=$JAVA_HOME/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

> **`/etc/profile` 还是 `~/.bashrc`？** `/etc/profile` 对所有用户生效，适合服务器；`~/.bashrc` 只对当前用户生效，适合个人开发机。普通开发者写在 `~/.bashrc` 即可。

macOS 也可以用 [Homebrew](https://brew.sh/) 一键安装：`brew install --cask temurin@17`。

## 五、多版本 JDK 共存与切换

实际工作中，你可能需要同时维护 JDK 8 的老项目和 JDK 17 的新项目。两个版本可以**都装上，靠 `JAVA_HOME` 切换**。

**目录规划建议**：把不同版本装到各自独立目录，互不干扰：

```text
C:\jdk\
  ├── jdk8u392\        (老项目用)
  └── jdk-17.0.9\      (新项目用)
```

**Windows**：想用哪个版本，就把 `JAVA_HOME` 改成对应路径，再开新命令行验证。

**Linux / macOS**：用 `alternatives` 管理更优雅：

```bash
# 注册两个版本
sudo alternatives --install /usr/bin/java java /opt/jdk-17.0.9/bin/java 2
sudo alternatives --install /usr/bin/java java /opt/jdk1.8.0_392/bin/java 1

# 交互式切换
sudo alternatives --config java
```

**实践建议**：全局 `JAVA_HOME` 设成你最常用的版本（比如 17）；老项目单独在 IDEA 里把该 Module 的 SDK 指向 JDK 8，这样互不干扰，不用每次改环境变量。

## 六、第一个 Java 程序：HelloWorld

激动人心的时刻到了。新建文件 `HelloWorld.java`（**文件名必须和 public 类名完全一致**，包括大小写）：

```java
package com.canoe.quickstart.env;

/**
 * 第一个 Java 程序：向世界问好
 */
public class HelloWorld {

    public static void main(String[] args) {
        // 在控制台打印一行文字，ln 表示输出后换行
        System.out.println("Hello,  canoe-notes! 我是小明，Java 我来了！");
    }
}
```

**编译**：用 `javac` 把 `.java` 源码编译成 `.class` 字节码。

```bash
javac HelloWorld.java
```

执行后会生成 `HelloWorld.class` 文件。注意：**JVM 运行的是 `.class`，不是 `.java`**。`.class` 里是字节码（一种中间指令），谁都看不懂，只有 JVM 认识。

**运行**：用 `java` 命令运行（注意这里**不要写 `.class` 后缀**，只写类名）。

```bash
java HelloWorld
```

输出：

```text
Hello,  canoe-notes! 我是小明，Java 我来了！
```

**逐行解释**：

- `package com.canoe.quickstart.env;`：声明这个类属于哪个包（文件夹路径对应的命名空间）。
- `public class HelloWorld`：定义一个公开类，**类名必须与文件名 `HelloWorld.java` 一致**。
- `public static void main(String[] args)`：程序的**入口方法**。JVM 启动后只会找这个签名的方法开始执行，一个字母都不能错。
- `System.out.println(...)`：向标准输出（控制台）打印内容并换行。

## 七、编译与运行常见问题

新手第一次跑程序，往往会遇到下面几种报错：

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `'java' 不是内部或外部命令` | `Path` 没配 `JAVA_HOME\bin` | 检查环境变量并重新开命令行 |
| 错误: 找不到或无法加载主类 HelloWorld | 当前目录不在 classpath，或类名写错 | 在 `.class` 所在目录运行 `java HelloWorld` |
| 错误: 在类 HelloWorld 中找不到 main 方法 | `main` 方法签名写错（漏了 `static` 或参数） | 核对 `public static void main(String[] args)` |
| 中文乱码（打印出 `???`） | `.java` 文件是 UTF-8，但 `javac` 默认用系统编码 | 编译时显式指定：`javac -encoding UTF-8 HelloWorld.java` |
| 类名与文件名不一致报错 | `public` 类名必须和文件名相同 | 改文件名或类名，保持大小写一致 | 

> **关于 `CLASSPATH`**：在 Java 9 之前，很多人会配一个全局 `CLASSPATH` 环境变量；但现代 Java（尤其 Java 9 模块化之后）基本不需要手动配 `CLASSPATH`，JVM 默认从当前目录和模块路径查找类。新手**不要乱设 `CLASSPATH`**，否则反而可能找不到类。

## 八、IDE 选择与配置

手写 `javac` 适合理解原理，但日常开发离不开 IDE（集成开发环境）。三款主流工具对比：

| 工具 | 适合人群 | 特点 |
| --- | --- | --- |
| **IntelliJ IDEA**（主力推荐） | 几乎所有 Java 开发者 | 智能提示强、插件丰富，社区版免费够用 |
| Eclipse | 老牌用户、部分企业 | 免费、插件多，但体验略逊于 IDEA |
| VS Code | 轻量党、全栈 | 装 Java 插件可用，但重型项目不如 IDEA |

**IDEA 必配项**（ settings 里设置）：

1. **编码统一 UTF-8**：`Editor → File Encodings`，三项全设 UTF-8，并勾选 `Transparent native-to-ascii conversion`（让中文注释在 properties 文件不乱码）。
2. **Maven 路径**：`Build → Build Tools → Maven`，指定本地 `maven` 和 `settings.xml`。
3. **自动导包**：`Editor → General → Auto Import`，勾选 `Add unambiguous imports on the fly`，少写手动 import。
4. **注释模板**：`Editor → File and Code Templates`，给新建类加上作者、日期注释。
5. **常用快捷键**（务必背下来）：

| 快捷键（Windows） | 作用 |
| --- | --- |
| `Ctrl + Shift + F10` | 运行当前程序 |
| `Ctrl + /` | 单行注释 |
| `Ctrl + Alt + L` | 格式化代码 |
| `Alt + Enter` | 快速修复（导包、改错） |
| `Ctrl + B` | 跳转到定义 |

## 九、Maven 环境

当项目越来越大，自己下载 `jar` 包、手动配依赖会痛苦不堪。**Maven** 就是来解决这件事的：它既是**依赖管理**工具（自动下载第三方库），也是**构建**工具（编译、测试、打包一条龙）。

1. **下载安装**：去 [Maven 官网](https://maven.apache.org/) 下载压缩包，解压后配置 `MAVEN_HOME` 并把它加进 `Path` 的 `bin` 目录。
2. **配置阿里云镜像**：默认的中央仓库在国外，下载很慢。编辑 `conf/settings.xml`，在 `<mirrors>` 标签里加入阿里云镜像：

```xml
<mirror>
    <id>aliyun-maven</id>
    <mirrorOf>*</mirrorOf>
    <name>Aliyun Maven</name>
    <url>https://maven.aliyun.com/repository/public</url>
</mirror>
```

3. **本地仓库**：依赖下载后会缓存在本地仓库（默认 `~/.m2/repository`），下次不用重复下载。可在 `settings.xml` 里用 `<localRepository>` 改位置。
4. **常用命令速查表**：

| 命令 | 作用 |
| --- | --- |
| `mvn clean` | 删除 `target` 编译产物 |
| `mvn compile` | 编译主代码 |
| `mvn test` | 运行测试 |
| `mvn package` | 打成 `jar` / `war` 包 |
| `mvn install` | 打包并安装到本地仓库 |

## 十、小结与排障清单

把上面踩过的坑收成一张"现象 → 原因 → 解决"对照表，遇到问题时先查这一张：

```text
┌──────────────────────────────┬─────────────────────────┬──────────────────────────┐
│ 现象                         │ 原因                    │ 解决                     │
├──────────────────────────────┼─────────────────────────┼──────────────────────────┤
│ 'java' 不是内部或外部命令    │ Path 未配 JAVA_HOME/bin │ 配 Path 后重开命令行     │
│ 找不到或无法加载主类        │ 目录/类名不对           │ 在 .class 目录运行      │
│ 找不到 main 方法            │ main 签名写错           │ 核对 static/String[]    │
│ 中文乱码                    │ 编码不一致              │ javac -encoding UTF-8   │
│ 类名与文件名不一致          │ public 类名必须匹配     │ 改文件名或类名          │
│ 依赖下载龟速                │ 连的是国外中央仓库      │ 配阿里云镜像            │
└──────────────────────────────┴─────────────────────────┴──────────────────────────┘
```

## 本篇小结

- **JDK** 包含 JRE，JRE 包含 JVM，开发必须装 JDK。
- **JVM** 是把字节码翻译成机器指令的虚拟机，是 Java 跨平台的核心。
- 新手首选 **Temurin 的 JDK 17（LTS）**，免费又稳定。
- `JAVA_HOME` 指 JDK 安装目录，是 **Maven、Tomcat、IDEA 等工具的寻路依据**。
- Windows 必须把 `%JAVA_HOME%\bin` 加进 **Path** 才能在任意目录用 `java`/`javac`。
- 装完务必用 **`java -version`** 验证，且要**重开命令行窗口**让环境变量生效。
- 多版本 JDK 靠 **`JAVA_HOME` 切换**，Linux/macOS 可用 `alternatives` 管理。
- 第一个程序：**`javac` 编译出 `.class`，再用 `java 类名` 运行**（运行不写后缀）。
- 中文乱码的终极解法是编译时加 **`javac -encoding UTF-8`**。
- 日常开发用 **IntelliJ IDEA**，记得把编码统一设成 UTF-8。
- **Maven** 负责依赖管理与构建，配**阿里云镜像**能大幅提升下载速度。

## 参考链接

- [Oracle 官方 JDK 下载](https://www.oracle.com/java/technologies/downloads/)
- [OpenJDK 项目主页](https://openjdk.org/)
- [Adoptium Temurin 发行版](https://adoptium.net/)
- [Azul Zulu 发行版](https://www.azul.com/products/core/)
- [Apache Maven 官网](https://maven.apache.org/)
- [IntelliJ IDEA 官网](https://www.jetbrains.com/idea/)
- [阿里云 Maven 镜像](https://developer.aliyun.com/mirror/maven)
- [Java 官方教程（Oracle）](https://docs.oracle.com/javase/tutorial/)

下一篇 → [03 Java 程序基础](/java/quickstart/basic)
