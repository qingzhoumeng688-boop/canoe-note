---
title: Java 教程简介
---

<video controls style="width:100%;border-radius:8px;">
  <source src="./demo.mp4" type="video/mp4">
  你的浏览器不支持视频播放，请更换浏览器。
</video>

# Java 教程

::: tip 说明
本教程面向所有想从零开始学习 Java 的读者，从最基础的语法讲起，逐步深入到并发、JVM、框架、分布式与 AI 应用，配合大量代码示例与面试总结。
:::

## 为什么选择 Java？

Java 自 1995 年诞生以来，一直是全球最流行的编程语言之一。它凭借 **跨平台、面向对象、生态成熟** 三大特性，在如下领域被广泛使用：

- **企业级后端开发**：绝大多数公司核心业务系统基于 Java + Spring 构建
- **大数据与中间件**：Hadoop、Kafka、Elasticsearch 等底层均由 Java 编写
- **Android 开发**：安卓原生应用使用 Java / Kotlin
- **金融、电商、通信**：高并发、高可用系统首选语言

### Java 的核心优势

| 优势 | 说明 |
|---|---|
| 跨平台 | 一次编写，处处运行（Write Once, Run Anywhere） |
| 面向对象 | 封装、继承、多态，代码易维护、易扩展 |
| 生态丰富 | Spring 全家桶、海量开源库与框架 |
| 性能稳定 | JVM 自动内存管理 + JIT 编译优化 |
| 就业面广 | 后端岗位需求量大，发展路径清晰 |

## 学习路线总览

本教程按照**由浅入深、循序渐进**的原则编排，共分为以下几个阶段：

| 阶段 | 内容 | 目标 |
|---|---|---|
| 第一阶段 | Java 快速入门 | 掌握基础语法、流程控制、数组 |
| 第二阶段 | 面向对象编程 | 理解封装、继承、多态、接口、内部类 |
| 第三阶段 | Java 核心 API | 集合、IO、泛型、反射、注解 |
| 第四阶段 | 异常处理 | 掌握异常机制与自定义异常 |
| 第五阶段 | 多线程与并发 | 线程池、锁、并发工具、CAS/AQS |
| 第六阶段 | JVM 虚拟机 | 内存结构、类加载、GC、调优 |
| 第七阶段 | 数据库 & MyBatis | MySQL、JDBC、持久层框架 |
| 第八阶段 | Spring / SpringBoot | IOC、AOP、自动配置、Web 开发 |
| 第九阶段 | 分布式 & 微服务 | 分布式理论、Spring Cloud |
| 第十阶段 | 中间件 | Redis、RabbitMQ、Elasticsearch |
| 第十一阶段 | AI 应用 | 大模型接入、RAG、Spring AI |
| 第十二阶段 | 面试专题 | 高频面试题总结 |

## 需要准备的环境

学习本教程前，建议先搭建好开发环境：

1. **JDK**：推荐安装 **JDK 17**（长期支持版本）或 JDK 21
2. **开发工具**：推荐 **IntelliJ IDEA**（社区版免费，功能强大）
3. **构建工具**：Maven 或 Gradle，用于管理依赖
4. **数据库**：MySQL（练习 JDBC 与 MyBatis 时需要）

> 环境搭建的具体步骤见 [搭建开发环境](/java/quickstart/env)

## 第一个 Java 程序

我们从一个经典的 Hello World 开始：

```java
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello, Java!");
    }
}
```

编译运行：

```bash
javac Hello.java   # 编译生成 Hello.class
java Hello         # 运行，输出 Hello, Java!
```

::: warning 提示
Java 要求文件名必须与 `public class` 的类名一致，例如上面的类名是 `Hello`，文件名必须是 `Hello.java`，否则编译报错。
:::

## 学习建议

- **多写代码**：只看不写学不会 Java，每个知识点都动手敲一遍
- **善用调试**：用 IDEA 断点调试，观察程序执行过程
- **先原理后框架**：先把 Java 基础和 JVM 学扎实，再学框架事半功倍
- **做好笔记**：建议按本教程目录结构同步记录自己的学习笔记

## 开始学习

- 从 [Java 历史](/java/quickstart/history) 开始，了解 Java 的诞生与发展
- 或直接进入 [搭建开发环境](/java/quickstart/env)，动手安装配置
- 想快速回顾重点，可查看 [面试专题](/java/interview/java-base)
