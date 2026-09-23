# canoe-notes

> Personal notes site built with VitePress — Java backend, middleware, AI applications, CS fundamentals (networking, OS & DSA), DevOps, plus fitness and cooking notes.
> Diagrams are rendered with Mermaid; see "Misc → Mermaid 图表规范" for authoring conventions.

**Live site: <https://qingzhoumeng688-boop.github.io/canoe-note/>**

This project's main documentation is in Chinese; see [README.md](./README.md) for the full version.

## Content

245 note pages, roughly 118k lines. **239 pages are finished**; only 6 (interview prep + cooking) remain as outlines.

- **Java AI (24 chapters, complete)** — LLM APIs, prompt engineering, streaming & function calling, Spring AI, LangChain4j, Spring AI Alibaba (three-layer architecture, Graph, multi-agent, RAG with Elasticsearch)
- **Middleware (28 chapters, complete)** — Redis (including distributed locks and a full Redisson guide), RabbitMQ, RocketMQ, Elasticsearch
- **CS fundamentals (26 chapters, complete)** — computer networking (8): layered models, physical/data-link layer, IP & subnetting, TCP/UDP, TCP reliability & congestion control, application protocols, HTTP/HTTPS & TLS, socket programming & troubleshooting; operating systems (8): architecture & syscalls, processes & threads, scheduling, IPC, memory management, virtual memory & page replacement, file systems, concurrency & deadlock; data structures & algorithms (10): complexity analysis, linear structures, trees & BST/AVL/red-black/B-tree, hash tables, graphs, sorting, searching, strings (KMP/Trie), advanced structures (union-find/segment tree/bloom filter/LRU), algorithm paradigms (DP/greedy/backtracking)
- **DevOps (31 chapters, complete)** — Git (10), Docker (6), Linux (14), VMware (1)
- **Java tutorials (171 chapters)** — core Java, OOP, collections/IO, concurrency, JVM, MySQL, MyBatis, Spring, Spring Boot, distributed systems, and 26 design-pattern chapters; only the 5 interview-prep pages remain outlines
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
├── cs/                     # CS fundamentals: networking, operating systems, data structures & algorithms
├── ops/                    # Linux, Docker, Git, VMware
├── fitness/
└── cooking/
```

## Deployment

Published to GitHub Pages. Note that `base: '/canoe-note/'` is set in `config.mts` and must match the deployment path.
