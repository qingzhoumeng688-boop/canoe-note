# 轻舟的笔记（canoe-notes）

> 一个用 VitePress 搭建的个人学习笔记站，记录 Java 后端、中间件、AI 应用、运维，以及健身和做饭。

**在线阅读：<https://qingzhoumeng688-boop.github.io/canoe-note/>**

---

## 站点内容

共 **207 篇** Markdown，约 **6.6 万行**。其中 **75 篇已成文**（5.6 万行），132 篇为待补充的框架页。

### Java AI 应用（24 篇 · 已完稿）

| 分组 | 章节 |
| --- | --- |
| 基础篇 6 章 | AI 开发概览 · 大模型 API 接入 · 提示词工程 · 流式输出与 Function Calling · Spring AI · LangChain4j |
| Spring AI Alibaba 12 章 | 概览与三层架构 · 快速上手 · 版本生态 · ReactAgent · 多 Agent 编排 · 上下文工程 · 人机协同 HITL · Graph 构图 / 状态 / 持久化 · 模型与 ChatClient · Tool 与 MCP |
| 检索增强 RAG 2 章 | RAG 检索增强 · RAG 进阶调优（统一使用 Elasticsearch 做向量库） |
| 工程化与落地 4 章 | 可观测性与评估 · Studio 与 Admin · 实战案例 · 常见问题与踩坑 |

### 中间件（28 篇 · 已完稿）

- **Redis 8 章** — 环境与命令、五大数据类型、高级类型（BitMap / HyperLogLog / GEO / Stream）、Java 客户端、**Spring Boot 缓存（穿透 / 击穿 / 雪崩）**、**分布式锁七版演进**、**Redisson 全解**、集群与调优
- **RabbitMQ 6 章** — 入门与选型、交换机与六种消息模型、Spring Boot 整合、可靠性投递、高级特性与延迟队列、集群与 Quorum Queue
- **RocketMQ 6 章** — 架构与选型、安装与 mqadmin、生产者消费者 API、消息类型（含事务消息）、Spring Boot 整合、存储原理与调优
- **Elasticsearch 8 章** — 环境与倒排索引、Mapping、DSL 查询、聚合分析、官方 Java Client、Spring Data ES、生产调优

### 运维（20 篇）

- **Docker 6 章（已完稿）** — 入门安装、镜像与 Dockerfile、容器命令、数据卷与网络、Compose 编排、生产实践
- **Linux 14 章（框架）** — 文件系统、文本三剑客、Vim、权限、软件包、进程、磁盘、网络、Shell、监控、部署

### Java 教程（92 篇 · 框架）

Java 基础 / 面向对象 / 核心类库 / 异常 / 并发 / JVM / MySQL / MyBatis / Spring / SpringBoot / 分布式与微服务 / 面试题，以及 **设计模式 26 篇**。每篇已搭好小节结构，节下带具体的写作提示。

### 生活

- **健身 8 篇（已完稿）** — 训练原则 + 胸背肩手臂腿臀核心六部位，每部位 3~5 个动作，标注目标肌肉、动作要点、常见错误，嵌入 29 个 B 站教学视频（**点击才加载，不会自动播放**）
- **做饭 2 篇（框架）** — 入门指南、家常菜

---

## 本地运行

需要 Node.js 18+（本项目在 Node 22 上验证）。

```bash
# 安装依赖
npm install

# 启动开发服务器（推荐，改动实时生效）
npm run docs:dev

# 构建静态站点，产物在 docs/.vitepress/dist
npm run docs:build

# 预览构建产物
npm run docs:preview
```

> 本机 Windows 上 `vitepress build` 有时跑完不自动退出。构建是否成功请以 `docs/.vitepress/dist/` 下的产物为准，或直接用 `npm run docs:dev` 预览。

## 目录结构

```
canoe-notes/
├── docs/                          # 站点根目录（VitePress 的 srcDir）
│   ├── .vitepress/
│   │   ├── config.mts             # 站点配置与侧边栏
│   │   ├── theme/                 # 自定义主题（BiliVideo 组件）
│   │   └── dist/                  # 构建产物（不入库）
│   ├── index.md                   # 首页
│   ├── java/                      # Java 教程 / AI 应用 / 中间件
│   ├── ops/                       # 运维：Linux、Docker、VMware
│   ├── fitness/                   # 健身
│   └── cooking/                   # 做饭
└── package.json
```

## 写作约定

给以后补内容时对齐用的几条：

1. **禁止 `mermaid` 代码块** —— 站点没装插件，流程图用 ```` ```text ```` 的 ASCII 图或表格代替。
2. **代码块外的裸泛型必须包反引号** —— 正文里要写成带反引号的形式，不能直接写裸的 `List<String>`，否则 Vue 编译器会当成未闭合 HTML 标签，报 `Element is missing end tag`，**整站构建失败**。尖括号同理。
3. **行内反引号里不要出现 `{{ }}`** —— 会被 Vue 当插值表达式解析（代码块内不受影响）。
4. **小节编号用中文**：`#` 篇名 → `##` 一、xxx → `###` 小节。
5. **篇末固定三块**：`## 本篇小结` → `## 参考链接` → `下一篇 → [...](...)`，导航首尾相接。
6. **骨架页的灰色提示行写完要删掉**，那是写作要求不是正文。
7. 代码示例要写全 `package` 与**逐条 import**（禁止 `import xxx.*;`），关键行加中文注释。

## 部署

站点部署在 GitHub Pages，构建产物推送后自动发布。

- 访问地址：<https://qingzhoumeng688-boop.github.io/canoe-note/>
- 注意 `config.mts` 里配了 `base: '/canoe-note/'`，本地开发和线上路径都依赖它，不要随意改动。

## 其他

- 笔记内容以自用为主，部分章节的 API 细节可能随框架版本变化，遇到与官方文档不一致的地方以官方为准。
- 健身篇的教学视频来自 B 站公开频道，文中保留了原始链接，UP 主删档时可据此核对。
