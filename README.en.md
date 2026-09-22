# canoe-notes

> Personal notes site built with VitePress — Java backend, middleware, AI applications, DevOps, plus fitness and cooking notes.

**Live site: <https://qingzhoumeng688-boop.github.io/canoe-note/>**

This project's main documentation is in Chinese; see [README.md](./README.md) for the full version.

## Content

207 Markdown files, roughly 66k lines. **75 chapters are finished** (~56k lines); the remaining 132 are structured outlines awaiting content.

- **Java AI (24 chapters, complete)** — LLM APIs, prompt engineering, streaming & function calling, Spring AI, LangChain4j, Spring AI Alibaba (three-layer architecture, Graph, multi-agent, RAG with Elasticsearch)
- **Middleware (28 chapters, complete)** — Redis (including distributed locks and a full Redisson guide), RabbitMQ, RocketMQ, Elasticsearch
- **DevOps (20 chapters)** — Docker (6 complete), Linux (14 outlines), VMware
- **Java tutorials (92 outlines)** — core Java, OOP, collections/IO, concurrency, JVM, MySQL, MyBatis, Spring, Spring Boot, distributed systems, interview questions, and 26 design-pattern chapters
- **Life** — fitness (8 complete, with embedded Bilibili demo videos that load on click) and cooking (2 outlines)

## Run locally

Requires Node.js 18+ (verified on Node 22).

```bash
npm install
npm run docs:dev      # dev server with hot reload
npm run docs:build    # build to docs/.vitepress/dist
npm run docs:preview  # preview the build output
```

## Layout

```
docs/
├── .vitepress/config.mts   # site config and sidebar
├── .vitepress/theme/       # custom theme (BiliVideo component)
├── index.md                # home page
├── java/                   # Java tutorials, AI apps, middleware
├── ops/                    # Linux, Docker, VMware
├── fitness/
└── cooking/
```

## Deployment

Published to GitHub Pages. Note that `base: '/canoe-note/'` is set in `config.mts` and must match the deployment path.
