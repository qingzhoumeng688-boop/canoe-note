# 09 团队工作流与提交规范

> 本篇导读：Git 命令人人都会敲，但"几个人一起怎么用 Git 才不乱"是另一门学问。本篇先横向对比四种主流分支模型（Git Flow / GitHub Flow / GitLab Flow / Trunk Based Development），帮你按团队体量选对玩法；接着落地两条最该统一的事——分支怎么命名、提交信息怎么写（Conventional Commits 规范）；再讲提交粒度、Code Review 与 PR 礼仪、用 commitlint + husky 把规范自动化；最后延伸到 CI/CD 里的 Git 触发、仓库级协作配置文件，以及五类团队常见事故的规避。读完你会发现：工具永远简单，约束才是协作的护城河，而绝大多数团队其实只需要 GitHub Flow 或一套轻量 Git Flow。

## 一、分支模型对比：选一个适合你的

没有"最好"的分支模型，只有"最匹配当前团队规模与发布节奏"的。先给一张总览表，再逐个拆解。

| 模型 | 核心分支 | 发布方式 | 适合团队 | 复杂度 | 主要痛点 |
| --- | --- | --- | --- | --- | --- |
| **Git Flow** | `main` / `develop` / `feature` / `release` / `hotfix` | 从 `release` 合入 `main` 打 tag | 版本节奏固定、需多版本并行维护 | 高 | 分支多、合并繁琐、与持续交付冲突 |
| **GitHub Flow** | `main` + 短命 `feature` + PR | 合入 `main` 即发布（或紧随） | 持续交付、SaaS / Web 服务 | 低 | 对测试与部署自动化要求高 |
| **GitLab Flow** | `main` + 环境分支（pre-prod / prod） | 按环境分支逐级推进 | 有"预发/生产"多环境、需环境门禁 | 中 | 环境分支需专人维护 |
| **Trunk Based** | 单一主干 + 极短特性分支 + 特性开关 | 主干随时可发布 | 高手云集、CI 极强的大厂/平台 | 中 | 对特性开关与 CI 纪律要求极高 |

::: tip 先给结论
**大部分团队用 GitHub Flow，或"轻量版 Git Flow"就够了。** 真正常态化多版本并行维护（如一个客户端要同时维护 v2.x 与 v3.x）才需要完整 Git Flow；GitHub Flow 配好 CI 与保护分支，已能覆盖八成场景。下面看细节。

### 1.1 Git Flow：五脏俱全但越来越被嫌弃

Git Flow 由 Vincent Driessen 在 2010 年提出，定义了五类分支：

| 分支 | 命名 | 职责 | 从哪来 | 合到哪去 |
| --- | --- | --- | --- | --- |
| 主分支（稳定） | `main` / `master` | **永远可发布**的正式代码，每次合入都对应一个发布版本 | 初始化时建 | 只接收 `release` / `hotfix` |
| 开发分支 | `develop` | 日常集成的"下一版"代码，功能在此汇总 | 从 `main` 拉 | 合到 `release`、`main`（经 release） |
| 功能分支 | `feature/*` | 单功能开发，生命周期短 | 从 `develop` 拉 | 合回 `develop` |
| 发布分支 | `release/*` | 发布前的冻结/打磨（修 bug、改版本号），不再加新功能 | 从 `develop` 拉 | 合到 `main`（打 tag）+ 合回 `develop` |
| 热修分支 | `hotfix/*` | 生产紧急修复 | 从 `main` 拉 | 合到 `main`（打 tag）+ `develop` |

典型流程：`develop` 攒够功能 → 拉 `release/v1.2` 打磨 → 合入 `main` 打 `v1.2` tag，同时把修复合回 `develop`。线上出事从 `main` 拉 `hotfix` 直修。

**优点**：版本边界极其清晰，适合需要长期维护多个历史版本（如操作系统、SDK）。

**缺点（也是被嫌弃的原因）**：在持续交付时代，它太"重"了——`develop` 长期偏离 `main`，合并冲突大；`release` 分支让"发布"变成一个离散事件而非日常；feature 合回 develop 时常要解大冲突。它假设"发布是低频大事件"，而现代服务追求"随时可发"。

::: warning 何时别用完整 Git Flow
如果你的产品是"部署一次、所有用户立刻用上新版"的 Web 服务或 SaaS，**完整 Git Flow 基本是过度设计**。它留下的 `develop`/`release` 双长分支，会和"主干即真理、频繁发布"的节奏打架。

### 1.2 GitHub Flow：永远可发布的极简主义

只有一条长期分支 `main`（永远可发布），新功能从 `main` 拉**短命 `feature` 分支**，做完提 **PR（Pull Request）**，评审 + CI 通过就合回 `main`。

```text
main ────●─────────●──────────●──────────●───  （永远可发布）
          │         │          │          │
       feature/a  feature/b  feature/c  feature/d   （短命，合完即删）
```

**铁律**：

1. `main` 上的任何提交都**随时可以部署**——所以合入前 CI 必须全绿、评审必须过。
2. 任何改动都走 PR，不可以直接往 `main` 推（靠分支保护规则拦）。
3. 分支必须**短命**（一两天），合完即删，避免长期分叉。

**优点**：心智负担小、反馈快、天然契合持续交付。
**缺点**：对测试自动化和部署流水线要求高——因为 `main` 即生产候选，质量闸门必须硬。

### 1.3 GitLab Flow：给"多环境"加门禁

GitHub Flow 在"只有一套环境"时最爽；但很多团队有"预发 / 灰度 / 生产"多套环境。GitLab Flow 在 `main` 之上再加**环境分支**来逐级推进：

```text
main ────●──────────●──────────●──  （已通过 CI 的集成分支）
              │          │
        pre-production  production   （环境分支，只进不退，靠合并/挑选推进）
```

常见两种思路：

- **环境分支**：`main` → `pre-production` → `production`，代码逐级 merge，哪个环境出问题就立刻知道是哪一段引入。
- **发布分支**：对需要"发布列车"的，从 `main` 拉 `release-1.2` 做发布分支，生产跟这个分支走。

**优点**：兼顾"主干开发"的简洁与"多环境门禁"的严谨。
**缺点**：环境分支需要人维护、合并方向要约定清楚，否则又回到 Git Flow 的繁复。

### 1.4 Trunk Based Development：主干即一切

最强纪律的玩法：**几乎所有开发直接提交到 `main`（或极短命、数小时即合的 `feature` 分支）**，靠两样东西兜底——

- **特性开关（Feature Flag）**：代码合进主干但用开关关着，发布后按需开启，避免"半成品"影响线上。
- **强 CI**：每次 push 都跑完整构建与测试，主干一旦红立刻修。

```text
main ─●─●─●─●─●─●─●─●─   （高频小提交，红即修，随时可发）
       （特性开关控制未完成功能是否对用户可见）
```

**优点**：合并冲突几乎消失（所有人基于同一最新主干）、发布极快、反馈极短。
**缺点**：对工程文化与 CI 强度要求极高，特性开关管理本身也是一门学问；新手团队容易把主干搞红。

::: danger 别盲目追 Trunk Based
Trunk Based 不是"大家都能直接 push main"的借口。它依赖**严格 CI + 特性开关 + 全员纪律**。没有这三项就上，主干会天天红、线上天天炸。中小团队先从 GitHub Flow 起步更稳。

> 💡 **在 IDEA 里**：分支模型不因 IDE 而变，但 IDE 让「照着模型操作」变简单：分支控件里按名字前缀就能一眼看清 `feature/`、`hotfix/`、`release/` 的分布，右键即可 Rebase / Merge / Delete，`release/*` 这类长命分支可以直接钉在 Log 图上看。

## 二、分支命名规范：让人一眼看懂

分支名是"给队友看的注释"。统一前缀 + 关联需求号，能让 `git branch` 列表本身就成为一张任务看板。

### 2.1 前缀表

| 前缀 | 用途 | 示例 |
| --- | --- | --- |
| `feature/` | 新功能开发 | `feature/JIRA-123-user-login` |
| `bugfix/` | 非紧急 bug 修复 | `bugfix/JIRA-456-null-pointer` |
| `hotfix/` | 生产紧急修复（常从 `main` 拉） | `hotfix/prod-timeout-20240901` |
| `release/` | 发布准备分支 | `release/v2.1.0` |
| `refactor/` | 重构（不改行为） | `refactor/order-service` |
| `docs/` | 文档改动 | `docs/update-readme` |
| `test/` | 补测试 | `test/cover-payment` |
| `chore/` | 构建/依赖/杂项 | `chore/bump-springboot` |

### 2.2 可执行命名规则

把下面规则写进 `CONTRIBUTING.md`（见第八节），用脚本或 PR 模板强制：

1. **必须带前缀**：无前缀的分支（`my-work`）一律拒绝合并。
2. **关联需求号**：`feature/<需求号>-<简短描述>`，需求号来自 Jira / TAPD / 内部平台，方便溯源。
3. **描述用 kebab-case**（小写、连字符）：`user-login` 而非 `UserLogin` 或 `user_login`。
4. **长度克制**：80 字符以内，过长的描述说明该拆分支了。
5. **不用中文、不用空格**：避免不同系统对分支名的兼容问题（中文在部分旧 Git 服务上会乱码）。

```bash
# 好例子
git switch -c feature/JIRA-123-user-login main
git switch -c hotfix/prod-null-pointer main

# 坏例子（无前缀、无需求号、用空格）
git switch -c my_login_work
git switch -c fix bug
```

### 2.3 分支生命周期要短

**黄金法则：一个分支最好在 1~3 天内合完，超过就该拆。** 长命分支（活两周以上）必然：偏离主干越来越远、合并冲突越来越大、评审越拖越烂。

| 分支活了多久 | 风险 | 对策 |
| --- | --- | --- |
| ≤1 天 | 极低 | 正常提 PR |
| 1~3 天 | 低 | 每天 `rebase main` 保持同步 |
| 3~7 天 | 中 | 拆成更小的子分支，或先合半成品（用特性开关） |
| >7 天 | 高 | **必须拆**，否则合并将是一场灾难 |

::: tip 短分支的小技巧
功能太大一时做不完？用**特性开关**把"已完成部分"先合进 `main`（开关关着），剩下的继续在分支里做。这样既缩短分支寿命，又不把半成品暴露给用户。

> 💡 **在 IDEA 里**：分支命名 IDEA **不做校验**，全靠约定；不过 `feature/JIRA-123-login` 这种写法能让 IDE 的任务集成识别出需求号（`Settings → Version Control → Issue Navigation` 可配跳转链接），装了 Jira 插件后还能直接从任务一键创建合规分支名。

## 三、提交信息规范：Conventional Commits（重点）

提交信息是**给未来你和队友看的变更日志**。零散的 `update`、`fix bug`、`改了点东西` 是协作毒药。业界事实标准是 **Conventional Commits（约定式提交）**。

### 3.1 格式拆解：`<type>(<scope>): <subject>`

```text
feat(order): 支持微信支付

为订单服务接入微信支付渠道，新增 WxPayClient 与对应回调处理。
下单时根据 pay_method 路由到对应渠道。

Closes JIRA-123
```

- **`<type>`**（必填）：改动类型，见下表。
- **`<scope>`**（可选）：受影响的模块 / 区域，如 `order`、`auth`、`ui`，帮 `blame`/`log` 时快速定位。
- **`<subject>`**（必填）：一句话摘要，**祈使句、首字母小写、不超过 50 字、结尾不加句号**。
- **空行**后是**正文（body，可选）**：说明"为什么改"，而不只是"改了什么"（代码 diff 自己会说话）。
- **footer（可选）**：`BREAKING CHANGE:` 或关联 `Closes JIRA-123` 等。

### 3.2 type 全表与是否影响版本号

结合 SemVer（见 08 篇），不同 type 决定自动定版本号时该 +哪一段：

| type | 含义 | 是否进 CHANGELOG | 对版本号影响 |
| --- | --- | --- | --- |
| `feat` | 新功能 | 是 | **MINOR（+1 次版本）** |
| `fix` | 修 bug | 是 | **PATCH（+1 修订号）** |
| `docs` | 文档改动 | 是（文档类） | 不影响 |
| `style` | 代码格式（空格、分号，无逻辑变化） | 否 | 不影响 |
| `refactor` | 重构（不改外部行为） | 是（可选） | 不影响 |
| `perf` | 性能优化 | 是 | 通常 PATCH，破坏性则 MAJOR |
| `test` | 增删测试 | 否 | 不影响 |
| `build` | 构建系统/依赖（Maven、webpack 等） | 否 | 不影响 |
| `ci` | CI 配置（GitHub Actions、流水线） | 否 | 不影响 |
| `chore` | 杂项（脚本、版本号 bump） | 否 | 不影响 |
| `revert` | 回退某次提交 | 是 | 取决于被回退内容 |

### 3.3 scope 与 subject 的写法

- **subject 用祈使句**：像下命令一样，如 `add`、`fix`、`remove`，而不是 `added`/`fixed`/`添加了`。
- **首字母小写、不加句号**：`feat: 支持导出 Excel` ✓；`feat: 支持导出 Excel。` ✗（多了句号）。
- **≤50 字**：超过说明你一次提交塞了太多事，该拆（见第四节）。
- **scope 别太细也别太粗**：`feat(payment)` 合适，`feat(the-whole-payment-module-and-ui)` 太啰嗦，`feat:` 空着则丢失定位信息。

### 3.4 正文与 footer 怎么写

正文解释**动机与权衡**，用空行与 subject 隔开，每行建议 ≤72 字符（老式终端友好）：

```text
fix(auth): 修复 token 过期后未刷新

原逻辑在 401 时直接登出，导致高频接口偶发掉线。
改为拦截 401 触发静默刷新，刷新失败再登出。

BREAKING CHANGE: 登录态事件名由 login 改为 auth:changed
Closes JIRA-789
```

- **`BREAKING CHANGE:`**（footer 里，全大写加冒号）：标记**不兼容变更**，自动定版本会触发 **MAJOR** 升级。
- 等价简写：在 type 后加 `!`，如 `feat!: 移除旧版 HTTP 客户端`，效果等同 `BREAKING CHANGE`，更省事。
- `Closes` / `Fixes` + 需求号：多数平台（GitHub/GitLab）会自动关闭对应 issue。

### 3.5 好例子 vs 坏例子（5 组对照）

| 编号 | 坏例子 | 好例子（Conventional Commits） |
| --- | --- | --- |
| 1 | `update` | `docs: 补充 README 中的安装步骤` |
| 2 | `修复登录bug` | `fix(auth): 修复会话过期后未刷新 token` |
| 3 | `改了点东西` | `refactor(order): 抽离订单校验为独立服务` |
| 4 | `add wechat pay and fix style` | `feat(pay): 接入微信支付` + `style(pay): 格式化回调处理器` |
| 5 | `升级版本` | `chore(release): 升级至 v2.1.0` |

::: tip 一条提交只说一件事，名字才好起
如果你写不出一句 ≤50 字的 subject，多半是这次提交混了多件事——拆分后，每一条自然就有清晰名字了。

### 3.6 它对 CHANGELOG 与自动定版本的作用

Conventional Commits 不只是"好看"，它是**机器可读的**：

- **CHANGELOG 自动生成**：工具（如 `standard-version`、`lerna`）按 type 把提交聚合成 `Features` / `Bug Fixes` / `Breaking Changes` 三栏，无需手维护。
- **语义化版本自动定**：`semantic-release` 读提交历史——有 `feat` 就 MINOR，有 `fix` 就 PATCH，有 `BREAKING CHANGE` 或 `feat!:` 就 MAJOR，然后**自动打 tag + 发 GitHub Release**。你只管写规范的提交，版本号交给流水线。

```bash
# 装了 conventional-changelog 后，本地也能预览
npx conventional-changelog -p angular -i CHANGELOG.md -s
```

> 💡 **在 IDEA 里**：`commitlint` 是通过 Git 钩子生效的，**在 IDE 里提交同样会被校验**（提交窗的 **Run Git hooks** 默认开启），所以规范一旦落地，从 IDE 里也没法绕。
> 写消息时有两个小工具：提交信息框里按 `Ctrl+↑` 调历史消息；装 **Git Commit Message Helper** 之类的插件可获得模板与格式提示（IDE 本身不带 Conventional Commits 校验）。

## 四、提交粒度：原子提交原则

"一次提交该多大"和"提交信息怎么写"同样重要。

### 4.1 原子提交三原则

一个**原子提交（atomic commit）**应满足：

1. **只做一件事**：要么加功能、要么修 bug、要么重构，别把三件打包。
2. **可独立回滚**：`git revert` 它不会牵连无关改动。
3. **可独立编译通过**：任意提交 checkout 出来，项目都能构建（不能"提交 A 编译不过、靠提交 B 才补齐"）。

```bash
# 反例：一次提交混了"新功能 + 格式化 + 修 bug"
git commit -m "feat: 用户模块一大堆改动"

# 正例：拆成三笔
git commit -m "refactor(user): 统一用户实体命名风格"   # 纯格式/重命名
git commit -m "feat(user): 新增手机号登录"             # 一个功能
git commit -m "fix(user): 修复登录后头像为空"          # 一个修复
```

### 4.2 什么时候该拆 / 该合

| 情况 | 处理 |
| --- | --- |
| 格式化改动与逻辑改动混在一起 | **拆开**：`style:` 单独一笔，逻辑改动一笔，评审一眼看清"这次到底改了什么" |
| 顺手改了无关文件 | **拆开或退回**：不属于本次目标的小改，单独提交或 `restore --staged` 拿掉 |
| 开发中一堆 `wip`/`tmp` 调试小提交 | **合掉**：用 `git rebase -i`（见 07 篇）的 `squash`/`fixup` 压成一笔干净的 `feat`/`fix` 再提 PR |
| 一个功能天然分几步（建表、接口、前端） | **保留多笔**：每步一个原子提交，历史更易 `bisect` 定位 |

::: tip "先提交再重构"的心态
遇到"先小改试一下，对了再整理"的场景：先 `git commit` 把当前能跑的状态存住（哪怕信息写 `wip`），放开手脚重构，最后用 `rebase -i` 把探索过程压成几笔干净的原子提交再提 PR。**提交是草稿，PR 才是成品**——本地历史随便整理，推出去前务必干净。

> 💡 **在 IDEA 里**：**原子提交靠勾选实现** —— 提交窗里勾哪几个文件、差异视图里勾哪几个改动块，就只提交那些，天然支持「拆开提交」。
> 要把一堆改动分成几个互不相干的组，用 **Changelists**（`Settings → Version Control → Changelists` 启用）分别命名、分别提交，比反复 `git add -p` 更稳。

## 五、Code Review 与 PR 规范

PR 是代码进入共享主干前的"质量闸门"，也是团队知识流转的场合。

### 5.1 PR 描述模板（可直接复制）

在 `.github/PULL_REQUEST_TEMPLATE.md`（见第八节）放一份，提 PR 时自动带出：

```markdown
## 背景（为什么做）
<!-- 需求来源、要解决的问题，让评审者先理解动机 -->

## 改动内容
<!-- 核心改动点，分条列；复杂逻辑可贴关键代码片段 -->

## 验证方式
<!-- 怎么测的：单测/手动步骤/截图。例：本地 `mvn test` 全绿，浏览器走通登录链路 -->

## 影响面
<!-- 影响了哪些模块、是否改了公共接口、是否需要数据迁移/配置变更 -->

## 截图（如有 UI 改动）
<!-- 贴 before / after -->

## 关联需求
Closes JIRA-123
```

### 5.2 小 PR 原则：单 PR < 400 行

研究与实践都表明：**PR 越大，评审质量越差、合并越慢、引入 bug 越多**。把 400 行作为软上限：

| PR 行数 | 评审体验 | 建议 |
| --- | --- | --- |
| < 100 行 | 极佳，几分钟审完 | 鼓励 |
| 100~400 行 | 良好 | 正常 |
| 400~800 行 | 开始疲劳，易漏看 | 考虑拆分 |
| > 800 行 | 几乎没人认真看 | **必须拆**，或开多次小 PR |

::: warning 巨型 PR 的代价
一个 2000 行的 PR，评审者往往会"扫一眼就点 Approve"——这时 PR 的把关作用已经失效，bug 全流式进主干。能用特性开关拆的就拆，不能拆的至少按模块分多个 PR 串行合。

### 5.3 评审方关注点清单

评审不只是"找 bug"，更是守门。按这张清单逐条过：

| 维度 | 关注点 |
| --- | --- |
| **正确性** | 逻辑对不对？边界条件（空、0、负数、超长）处理了吗？ |
| **边界** | 并发、超时、异常输入、国际化（时区/编码）考虑了吗？ |
| **命名** | 变量/函数/类命名是否表意？有无 `tmp`、`data2` 这类糊弄名？ |
| **日志与异常** | 异常有没有被吞？日志能否定位问题？有没有打敏感信息？ |
| **性能** | 有没有 N+1 查询、循环里查库、无缓存的大对象？ |
| **安全** | 输入校验、鉴权、SQL 注入、密钥硬编码（见第九节）？ |
| **测试覆盖** | 核心路径有单测吗？这次改动降低了覆盖率吗？ |

### 5.4 提交者怎么回应意见

- **别 `force push` 后就沉默**：改完代码、强推后，在 PR 里**逐条回复**每条意见"已修改 / 为何不改"，让评审者知道改了哪。
- **用 `git range-diff` 展示"前后差异"**：当 rebase / squash 后提交长相变了，评审者可用它看"我的新版本相对旧版本改了什么"，而不是重看全部 diff：

```bash
# 展示：旧 PR 分支 old 相对 base，与新分支 new 相对 base，两段改动的范围差异
git range-diff base old new
```

- **意见分歧**：线上讨论或当面沟通，别在 PR 评论里吵；结论记入代码或文档。

### 5.5 三种合并方式对比

GitHub / GitLab 在合 PR 时通常给三种方式，历史形态完全不同：

| 合并方式 | 历史形态 | 适用场景 | 注意 |
| --- | --- | --- | --- |
| **Merge commit** | 生成一个**合并提交**，保留"谁在何时合入"的真实分叉 | 想保留完整 PR 上下文、审计要求高 | 历史有较多 Merge 节点，但 `git log --first-parent` 仍能看主干 |
| **Squash and merge** | 把 PR 里**所有提交压成 1 个**合入主干 | 个人 feature 分支一堆零碎 `wip`，合前不想保留 | 丢失 PR 内部提交粒度，`bisect` 只能定位到整个 PR |
| **Rebase and merge** | 把 PR 提交**逐个重放到主干之后，变线性**（SHA 变） | 追求完全线性、干净历史 | 改写 SHA，合后本地分支需 `git pull --rebase` 对齐 |

::: tip 怎么选合并方式
- 想保留"哪次 PR、谁合入"的审计线索 → **Merge commit**（配 `main` 保护 + `--first-parent` 看主干）。
- PR 内部一堆草稿提交、只想留一个干净 `feat` → **Squash and merge**（最常用）。
- 团队强推"纯线性历史" → **Rebase and merge**，但合后务必通知大家 `pull --rebase`。

**合并后删分支**：PR 合完顺手点 "Delete branch"（或 `git branch -d <branch>`），避免分支列表越积越乱。远程分支删了不影响历史——合并提交/压扁提交已进主干。

> 💡 **在 IDEA 里**：PR 描述在**网页里**写最省事；装了 GitHub / GitLab 插件后，也可以在 **Pull Requests** 工具窗里创建 PR 并填写描述（仓库里的 `.github/PULL_REQUEST_TEMPLATE.md` 会被平台自动套用）。
> 评审时最有用的 IDE 能力是 **Annotate（行 blame）** 和 **Show History**：看不懂某段代码为什么这么写，直接查它属于哪个提交、哪次评审，比在网页里翻文件快得多。

## 六、提交门禁与自动化：commitlint + husky + lint-staged

规范再好，靠人记总会漏。用工具在**提交瞬间**把关。

### 6.1 三者分工

- **commitlint**：校验提交信息是否符合 Conventional Commits 格式，不合规直接拒绝。
- **husky**：把 Git hooks（`pre-commit` / `commit-msg` 等）纳入版本库管理（hooks 默认不进版本库，见 08 篇八节），团队共享。
- **lint-staged**：只对**暂存区**的文件跑 lint / 格式化，避免每次全量扫描拖慢提交。

### 6.2 配置示例

`package.json` 片段：

```json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{js,ts,vue}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml}": ["prettier --write"]
  },
  "devDependencies": {
    "husky": "^9.0.0",
    "@commitlint/cli": "^19.0.0",
    "@commitlint/config-conventional": "^19.0.0",
    "lint-staged": "^15.0.0"
  }
}
```

`commitlint.config.js`（提交信息规则）：

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // subject 不超过 50 字、必须小写开头、结尾不加句号
    'subject-case': [2, 'always', 'lower-case'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 50],
  },
};
```

`.husky/commit-msg`（提交信息钩子，校验格式）：

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx --no-install commitlint --edit "$1"
```

`.husky/pre-commit`（提交前跑 lint-staged，做格式化与静态检查）：

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx --no-install lint-staged
```

`.husky/pre-push`（推送前跑单测，拦住明显坏代码）：

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npm test -- --watch=false --bail
```

### 6.3 钩子能被绕过，所以 CI 必须再查一遍

::: warning `--no-verify` 能跳过所有本地钩子
任何人都能 `git commit --no-verify -m "update"` 强行绕过 husky。所以**本地钩子只是"善意提醒"，不是安全边界**——真正的硬关卡必须放在 CI（见第七节）：CI 里再跑一遍 commitlint、lint、测试，钩子过了 CI 不过一样合不进去。

> 💡 **在 IDEA 里**：`pre-commit` 这类钩子（跑格式化、静态检查）在 IDE 里提交时**会真的执行**，所以本地就能被拦住，不必等 CI。
> 但要记住上面的关键提醒：**钩子能用 `--no-verify` 绕过**（命令行如此，IDE 里则是不勾 Run Git hooks），所以服务端的检查不能省 —— 门禁永远要在 CI 再落一道。

## 七、CI/CD 中的 Git：触发、版本与发布

Git 不只是存储，它是 CI/CD 的"扳机"。

### 7.1 常见触发策略

| 触发事件 | 用途 | 典型动作 |
| --- | --- | --- |
| `push` 到分支 | 跑构建 + 单测，给分支质量反馈 | `build` + `test` |
| `pull_request` | PR 评审期间跑校验，决定能否合 | `lint` + `test` + 覆盖率高水位 |
| `tag` 推送（`v*`） | **发布**：只有打 tag 才走发布流水线 | `build` + 打 Release + 部署 |
| `schedule` | 定时（如每晚全量回归 / 安全扫描） | 重活 |

### 7.2 为什么常需要 `fetch-depth: 0`

默认 GitHub Actions 的 `checkout` 是**浅克隆**（只拉最近 1 个提交），为了快。但很多步骤需要完整历史：

- `git describe --tags` 要数"离最近 tag 几个提交"——浅克隆数不准。
- 版本工具按提交历史定版本号——浅克隆会出错。
- `git diff` 对比远端基线——浅克隆可能缺对象。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0   # 拉全量历史，保证 describe / 定版本可用
```

### 7.3 用 tag 做版本发布 + 注入版本号

发布流水线监听 tag，构建时把版本号写进产物：

```yaml
name: release
on:
  push:
    tags: ['v*']          # 只有推送 v 开头 tag 才触发发布

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write    # 允许 GH Actions 写 Release（GITHUB_TOKEN 默认无此权限）
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: 计算版本号
        run: |
          # git describe 给出 "v1.2-3-gabc1234" 形式；--short HEAD 给 7 位 SHA
          VERSION=$(git describe --tags --always)
          SHORT=$(git rev-parse --short HEAD)
          echo "VERSION=$VERSION" >> "$GITHUB_ENV"
          echo "构建版本: $VERSION ($SHORT)"
      - name: 构建并打 Release
        run: |
          ./build.sh --version "$VERSION"
          gh release create "$VERSION" ./dist/* --title "$VERSION"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**`GITHUB_TOKEN` 与权限**：流水线里默认注入的 `GITHUB_TOKEN` 权限很有限（不能随便写 Release / 推 tag）。需要写发布的动作，要像上面那样显式声明 `permissions: contents: write`，或用自己的 Personal Access Token / Deploy Key（密钥更细粒度、可审计）。

### 7.4 本地也能注入版本号

就算不玩 CI，本地构建也能用这两条拿版本串：

```bash
git describe --tags --dirty      # v1.2-3-gabc1234，若工作区有未提交改动会带 -dirty
git rev-parse --short HEAD       # abc1234（7 位短 SHA）
```

> 💡 **在 IDEA 里**：CI 日志在网页看；IDE 侧能帮上的是**把该跑的检查在提交前跑掉** —— 提交窗里勾上 **Analyze code**、**Reformat code**，再配合钩子，能让 CI 少红几次。本地先跑一遍与 CI 相同的构建命令，比事后翻日志快。

## 八、仓库级协作配置文件

这些文件放进仓库根目录，让"规范"成为仓库的一部分，新人 clone 下来即生效。

| 文件 / 目录 | 放哪 | 作用 |
| --- | --- | --- |
| `.gitattributes` | 仓库根 | 统一换行符（`* text=auto`）、标记生成文件（`linguist-generated`） |
| `CODEOWNERS` | `.github/CODEOWNERS` 或根 | 指定哪些目录由谁审批，PR 自动 @ 负责人 |
| `.github/PULL_REQUEST_TEMPLATE.md` | `.github/` | PR 默认描述模板（见 5.1） |
| `.github/ISSUE_TEMPLATE/` | `.github/` | Issue 模板，规范 bug / 需求上报格式 |
| `CONTRIBUTING.md` | 仓库根 | 贡献指南：分支规范、提交规范、开发环境搭建 |
| `CODE_OF_CONDUCT.md` | 仓库根 | 社区行为准则（开源项目常见） |

目录结构示例：

```text
my-repo/
├── .gitattributes
├── .github/
│   ├── CODEOWNERS
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
├── CONTRIBUTING.md
├── package.json
└── src/
```

`.gitattributes` 关键两行（与 01 篇换行符坑呼应）：

```text
* text=auto                       # 自动按平台转换换行，仓库内统一 LF
*.png binary                      # 二进制文件不碰换行、不 diff
```

`CODEOWNERS` 示例（PR 改到对应目录会自动请求审批）：

```text
*                       @team-lead
/src/payment/           @pay-team
/docs/                  @docs-team
```

::: tip 这些文件是"软约束"
配置文件本身不强制人遵守——关键还是写进 `CONTRIBUTING.md` 并靠 Code Review 落实。但有了 `CODEOWNERS`，至少 PR 不会"没人审"；有了 `.github/PULL_REQUEST_TEMPLATE.md`，至少描述不会空着。

> 💡 **在 IDEA 里**：`.gitattributes`、`CODEOWNERS`、PR / ISSUE 模板这些都是**仓库里的普通文件**，IDE 不做特殊处理；`.gitattributes` 的换行符规则由 Git 在读写时生效，与 IDE 无关，放进去就行。
> 唯一要留心的是别让 `.gitattributes` 与 `Settings → Editor → Code Style → General → Line separator` 设成互相矛盾的值（见 [03 篇](/ops/git/basic)）。

## 九、团队常见事故与规避

| 事故 | 根因 | 规避 |
| --- | --- | --- |
| **误推密钥 / 密码** | 临时调试把 `.env`、token 直接 `add` 进库 | ① 立刻**改密钥**（泄露即作废）② 用 `filter-repo` 清历史（见 07 篇 8.3）③ 加 `.gitignore` + 预提交扫描（如 `gitleaks`） |
| **强推覆盖别人提交** | 在共享分支 `--force` 推送 | ① 保护分支禁止强推（GitHub 可设 "Require linear history" + 禁 force）② 个人分支强推也只用 `--force-with-lease`（见 07 篇 4.2） |
| **大文件入库导致仓库膨胀** | 把 PSD / 模型 / 数据集直接 `add` | ① 走 **Git LFS**（见 08 篇六节）② 或拒绝入库，放对象存储只留链接 ③ CI 加 `git lfs` 体积检查 |
| **develop 直接合 main 跳过测试** | 图省事、关了 CI 门禁 | ① 保护分支强制"必需检查通过"才能合 ② PR 合入前 CI 必须全绿，不能绕过 |
| **提交信息 `update` 满天飞** | 无规范、无门禁 | ① `commitlint` + husky 拦格式（见第六节）② Code Review 把"烂信息"打回 ③ 用 `semantic-release` 让规范产生收益 |

::: danger 密钥泄露的第一动作是"改"不是"删"
发现密钥进库，**第一优先级是去对应平台把密钥吊销/重置**——因为历史可能已被 clone、已进别人机器，清历史只是"减少未来扩散"，救不了已经拿到的人。改完密钥，再清历史。

> 💡 **在 IDEA 里**：上面的事故表在 IDE 里同样成立，其中两条有 IDE 专属的防手滑机制可以借力 ——
> - **强推覆盖别人提交**：IDEA 只把 **Force Push with Lease** 暴露在下拉里，等于默认给你上了保险。
> - **误提交密钥**：IDE 的 **Local History** 帮不上（它只管未提交内容），密钥一旦进了提交，就得照 [07 篇](/ops/git/rebase) 清历史，并**立刻把那个密钥换掉**。

## 本篇小结

- 四种分支模型：**Git Flow**（五类分支、适合多版本并行但偏重）、**GitHub Flow**（main+短命 feature+PR，持续交付首选）、**Git Lab Flow**（main+环境分支、多环境门禁）、**Trunk Based**（主干+特性开关+强 CI，对纪律要求最高）。
- **结论：大部分团队 GitHub Flow 或轻量 Git Flow 足够**，完整 Git Flow 只在"需长期维护多个历史版本"时划算。
- 分支命名：`feature/` `bugfix/` `hotfix/` `release/` `refactor/` `docs/` 前缀 + 需求号（`feature/JIRA-123-user-login`）；**生命周期 1~3 天，超 7 天必须拆**。
- Conventional Commits 格式 `<type>(<scope>): <subject>`：type 决定版本号（`feat`→MINOR、`fix`→PATCH、`BREAKING CHANGE`/`feat!:`→MAJOR）；subject **祈使句、≤50 字、不加句号**。
- 它对 `standard-version` / `semantic-release` 是输入：自动生成 CHANGELOG、自动定版本、自动打 Release。
- 原子提交三原则：**只做一件事、可独立回滚、可独立编译通过**；草稿用 `rebase -i` 的 squash/fixup 压干净再提 PR（见 07 篇）。
- PR 规范：描述含背景/改动/验证/影响面；**单 PR < 400 行**；评审关注正确性/边界/命名/日志异常/性能/安全/测试；回应意见别强推后沉默，用 `git range-diff` 展示差异。
- 三种合并：**Merge commit**（留审计）/ **Squash**（压成 1 个，最常用）/ **Rebase**（线性，合后需 `pull --rebase`）；合完删分支。
- 门禁三件套：**commitlint + husky + lint-staged**；`pre-commit` 格式化/静态检查、`pre-push` 跑单测；**钩子可被 `--no-verify` 绕过，CI 必须再查一遍**。
- CI 触发：`push`/`pull_request` 跑校验、`tag` 触发发布；常需 `fetch-depth: 0`；`GITHUB_TOKEN` 默认权限低，发 Release 要显式开 `permissions: contents: write`；`git describe`/`git rev-parse --short HEAD` 注入版本号。
- 仓库级配置：`.gitattributes`（换行+`linguist-generated`）、`CODEOWNERS`、`.github/PULL_REQUEST_TEMPLATE.md`、`ISSUE_TEMPLATE`、`CONTRIBUTING.md`，让规范随仓库生效。
- 五类事故规避核心：**密钥泄露先改后清**、禁用保护分支强推、大文件走 LFS、保护分支卡 CI、烂信息靠 commitlint 拦截。

## 参考链接

- [Conventional Commits 官方规范](https://www.conventionalcommits.org/zh-hans/v1.0.0/)
- [语义化版本 SemVer](https://semver.org/lang/zh-CN/)
- [Git Flow 原始博文（Vincent Driessen）](https://nvie.com/posts/a-successful-git-branching-model/)
- [GitHub Flow 指南](https://docs.github.com/zh/pull-requests/collaborating-with-pull-requests/getting-started/about-collaborative-development-models)
- [GitLab Flow 文档](https://docs.gitlab.com/ee/topics/gitlab_flow.html)
- [Trunk Based Development 官网](https://trunkbaseddevelopment.com/)
- [commitlint 官方文档](https://commitlint.js.org/)
- [husky 官方文档](https://typicode.github.io/husky/)
- [lint-staged 官方文档](https://github.com/lint-staged/lint-staged)
- [semantic-release 官方文档](https://semantic-release.gitbook.io/)
- [GitHub Actions: checkout 与 fetch-depth](https://github.com/actions/checkout)

下一篇 → [10 常用场景速查与排错](/ops/git/faq)
