# 05 远程仓库与团队协作

> 本篇导读：本地仓库再溜也只是你自己的玩具，真正让 Git 成为"协作引擎"的是远程仓库。本篇先厘清最容易混的一对概念——远程跟踪分支 `origin/main` 与本地分支 `main` 到底差在哪，并用表格讲清 `upstream` 上游与 `refs/remotes/...`；接着讲透 `git remote` 全家桶、fork 场景下 `origin` + `upstream` 双远程配置、HTTPS/SSH/git:// / 本地路径四种协议的取舍；再用最大篇幅拆解 clone 的诸多姿势、fetch 与 pull 的本质区别、push 被拒时的三种正确解法；最后覆盖团队协作流程、多账号凭据痛点、仓库瘦身与全量迁移。读完你能在 GitHub/Gitee/内网 GitLab 上从容地 clone、fetch、pull、push 与发起 PR。

## 一、远程仓库是什么：origin 与跟踪分支

Git 是分布式的，每台机器上都是一个**完整仓库**（对象库 + 所有历史）。"远程仓库"不过是"另一台机器（GitHub/Gitee/内网 GitLab/同事电脑）上的那个 `.git`"，你通过 `fetch`/`pull`/`push` 和它交换数据。几个核心概念先摆正：

- **`origin` 只是默认名字，不是关键字**。`git clone` 时 Git 给"你克隆的源"自动起名叫 `origin`，你可以叫它 `foo`、`upstream`、`school`，一个仓库也能挂多个远程。
- **本地分支 `main`**：你本地真实工作、提交的分支，`HEAD` 指向它。
- **远程跟踪分支 `origin/main`**：远程 `main` 在**你本地的一份只读镜像**，路径在 `refs/remotes/origin/main`，记录"上一次和远程通信时远程 `main` 在哪"。你不能直接往它 `commit`，只有 `fetch`/`pull`/`push` 同步时才更新。

### 1.1 `origin/main` 与 `main` 的区别（最容易混的一对）

| 维度 | 本地分支 `main` | 远程跟踪分支 `origin/main` |
| --- | --- | --- |
| **本质** | 你本地可写分支，`HEAD` 可指向 | 远程分支的**只读镜像**，存于 `refs/remotes/origin/main` |
| **谁来移动** | 你 `commit` 时移动 | 只有 `fetch`/`pull`/`push` 同步时才更新 |
| **能否 checkout** | 能，正常切换 | 能，但会进入 detached HEAD（游离头），一般只用来读 |
| **代表"哪个时刻"** | 本地实时状态 | "上次和远程通信那一刻"的状态，**非实时** |
| **删除方式** | `git branch -d <name>` | `git fetch -p` 自动清理，或 `git branch -r -d origin/<name>` |

一句话记忆：**`main` 是你手里的牌，`origin/main` 是你"以为"对方手里的牌**。你 `commit` 改变 `main`，但 `origin/main` 不变，直到 `fetch` 看到对方、或 `push` 把进展告诉对方。领先/落后都是拿两者比出来的。

### 1.2 upstream 上游与 branch -vv 怎么读

"上游（upstream）"指**本地分支所跟踪的远程分支**。设好后 `pull`/`push` 不用写远程名和分支名。`git branch -vv` 中括号里就是上游与领先/落后：

```bash
git branch -vv
#   dev        a1b2c3d [origin/dev: ahead 2, behind 1] 登录功能
# * main       e4f5a6b [origin/main]                    主干
```

- **`ahead 2`（领先 2）**：本地比 `origin/dev` 多 2 个提交（你 `commit` 了没 `push`）。
- **`behind 1`（落后 1）**：`origin/dev` 比你多 1 个提交（同事 `push` 了，你没 `pull`）。

这串数字是"要不要同步"的最直观信号：领先该 `push`，落后该 `pull`，两者都有说明要先 `pull` 再 `push`（`non-fast-forward` 预警）。

> 💡 **在 IDEA 里**：`origin/main` 与 `main` 的区分在界面上一目了然 —— 分支控件的 **Remote** 分组里是 `origin/xxx`，**Local** 分组里是 `xxx`。
> 领先 / 落后在 Log 图里直接画出来：本地提交与远程提交分列两侧、中间有连线；状态栏也会显示待推送、待拉取的提交数。`Ctrl+T`（Update Project）的对话框里则会列出 **Incoming / Outgoing** 的提交清单。

## 二、远程配置：remote 全家桶与多远程

| 命令 | 作用 |
| --- | --- |
| `git remote -v` | 列出所有远程名 + 抓取/推送 URL |
| `git remote add <name> <url>` | 新增远程，如 `git remote add upstream <url>` |
| `git remote set-url <name> <url>` | 修改地址（迁移、换协议时常用） |
| `git remote rename <old> <new>` | 改名（同步更新跟踪分支前缀） |
| `git remote remove <name>` | 删除远程（连带移除其跟踪分支） |
| `git remote show origin` | 查看某远程详情：URL、跟踪分支、领先/落后、push 配置 |

```bash
git remote -v
# origin  https://gitee.com/you/repo.git (fetch)
# origin  https://gitee.com/you/repo.git (push)

git remote show origin
# * remote origin
#   Fetch URL: https://gitee.com/you/repo.git
#   HEAD branch: main   Remote branches: main tracked, dev tracked
```

### 2.1 fork 场景：origin + upstream 双远程

参与开源/公司内部 fork 工作流时，常有两个远程：

- **`origin`**：你**自己账号**下的 fork，你有推送权，日常开发 push 到这里。
- **`upstream`**：**原始仓库**，你通常无推送权，只读，用来同步上游更新。

```bash
git clone git@github.com:you/project.git        # origin 指向你的 fork
cd project
git remote add upstream https://github.com/ORG/project.git   # 加原始仓库
git remote -v
# origin    git@github.com:you/project.git (fetch/push)
# upstream  https://github.com/ORG/project.git (fetch/push)

git fetch upstream                 # 拉上游所有分支到本地 upstream/*
git switch main
git merge upstream/main            # 或 git rebase upstream/main，把上游合进本地
git push origin main               # 推到你自己的 fork
```

### 2.2 四种协议怎么选

| 协议 | 鉴权方式 | 端口 | 国内是否常需代理 | 适用场景 |
| --- | --- | --- | --- | --- |
| **HTTPS** | 用户名 + 个人访问令牌（token） | 443 | 访问 github 常需 | 最通用、防火墙友好、无需配密钥 |
| **SSH** | 公钥 / 私钥 | 22 | SSH 不走 `http.proxy`，需 `ProxyCommand` | 免密安全，开发者首选 |
| **git://** | 无（只读、明文） | 9418 | 同 | 公开只读镜像，越来越少用 |
| **本地路径** | 文件系统权限（`file://`） | 无 | 否 | 同一机器多仓库互推、离线拷贝 |

> 💡 **在 IDEA 里**：多远程在 **Manage Remotes**（Git 工具窗内，不同版本位置略有差异）里维护，可增删改 URL。
> fork 场景（`origin` + `upstream`）IDEA 不会自动配置，需要**手工把 upstream 加进来**，然后 **Fetch All Remotes**；之后在本地下拉里就能方便地 **Rebase Current onto `upstream/main`** 来同步主干。

## 三、克隆的姿势：clone 各种开关

`git clone <url>` 默认拉**整个对象库 + 所有分支引用 + 完整历史**（为什么能拿到全部，见 02 篇）。`clone` 还会自动做两件事：**建立 `origin` 远程**、并把远程 `HEAD` 对应分支设为本地当前分支的上游——所以 clone 完你天然就有"origin + 跟踪关系"。

| 开关 | 作用与场景 |
| --- | --- |
| `git clone <url> <dir>` | 指定本地目录名（否则取仓库名） |
| `git clone --depth 1 <url>` | **浅克隆**，只拿最近 1 个提交，最快，适合 CI |
| `git clone --single-branch --branch <name> <url>` | 只克隆某一分支，省流量 |
| `git clone --bare <url>` | **纯仓库**（无工作区），用于服务器/中转/备份 |
| `git clone --mirror <url>` | **镜像**，等于 `--bare` 且映射所有 refs，常用于整库迁移 |
| `git clone --recurse-submodules <url>` | 递归拉子模块（否则子模块目录是空的） |
| `git clone --reference <path> <url>` | 借用本地已有仓库对象库加速大仓库克隆 |

### 3.1 浅克隆的坑

`--depth 1` 很好用，但"砍掉了历史"，有三个坑：

- **看不到完整历史**：早于浅层边界的提交都拉不下来，`git log` 只能看到指定深度。
- **回推受限**：浅克隆**可以** push（除非服务器禁止），但你上传的是"没有完整祖先"的提交，对方 `fetch` 时可能缺父对象报错 `shallow update not allowed`，故多用于"拉来看/构建"，不是开发后回推。
- **补全历史**：`git fetch --unshallow` 把缺失历史一次性补齐，变回普通克隆；或 `git fetch --deepen 100` 再加深 100 层。

```bash
git clone --depth 1 https://github.com/ORG/project.git
git fetch --unshallow          # 之后 git log 就能看完整历史
```

### 3.2 --bare 与 --mirror

```bash
git clone --bare https://github.com/ORG/project.git project.git     # 纯仓库，无工作区
git clone --mirror https://github.com/ORG/project.git mirror.git    # 镜像，含所有 refs
```

`--bare` 只是"不带工作区"；`--mirror` 是 `--bare` 且**映射全部引用**（含标签、notes），配合 `git push --mirror` 做整库迁移最合适。

> 💡 **在 IDEA 里**：克隆走欢迎页 **Get from VCS** 或 `Git → Clone…`，只有 URL、目录、可选深度几个输入框 —— `--single-branch`、`--bare`、`--mirror` 这些**没有界面**，要回命令行。
> 克隆完成后 IDE 会自动**建工程并装依赖**（检测到 Maven / Gradle 会提示导入），这是命令行 `clone` 之后还得手动做的部分。

## 四、抓取与拉取：fetch 与 pull 的本质

| 命令 | 本质 | 会不会动你的工作 |
| --- | --- | --- |
| `git fetch` | 只把远程最新对象与引用拉到本地，更新 `origin/*` | **不动**工作区、不动本地分支 |
| `git pull` | = `git fetch` + `git merge`（或 `rebase`） | **会动**当前本地分支，把远程进展并进来 |

`fetch` 永远安全——随时 `git fetch` 看别人推了啥再决定；`pull` 直接合并可能触发冲突。

```bash
git fetch origin
git log --oneline origin/main -3    # 看远程新推了啥（此时 main 还没变）
git status
# Your branch is behind 'origin/main' by 3 commits, and can be fast-forwarded.
```

让 pull 更优雅、更安全：

```bash
git pull --rebase              # 单次：把本地提交接在远程之后，历史线性
git config --global pull.rebase true     # 全局：以后 pull 默认 rebase
git config --global pull.ff only         # 更狠：只允许快进，拒绝隐式合并
```

`pull.ff only` 是最推荐的"防呆"配置：只有能快进才自动合并，否则报错让你手动处理，绝不会在 `pull` 时莫名多出一个合并提交。

```bash
git config --global pull.ff only
git pull
# fatal: Not possible to fast-forward, aborting.
```

清理与定点抓取：

| 命令 | 作用 |
| --- | --- |
| `git fetch --all` | 抓取**所有**远程 |
| `git fetch --prune` / `git fetch -p` | 抓取同时删除本地"远程已不存在"的跟踪分支 |
| `git remote prune origin` | 只清理，不抓新数据 |
| `git fetch origin <branch>` | 只抓某一分支，如 `git fetch origin dev` |

> 💡 **在 IDEA 里**：`Ctrl+T`（**Update Project**）就是 `pull`，弹窗里三个单选按钮正好对应三种策略 ——
> - **Merge** → `git pull`（`pull.rebase=false`）
> - **Rebase** → `git pull --rebase`
> - **Branch Default** → 让 Git 按分支配置自己决定
>
> 选完可以勾 **Don't ask again**，它会把这个选择写进 `git config`（`pull.rebase`），命令行也认。
> 只想取不合并（`git fetch`）：`Git → Fetch` 或 **Fetch All Remotes**，然后在 Log 里看 Incoming 的提交。

## 五、推送：push 与推送被拒的处理

| 命令 | 作用 |
| --- | --- |
| `git push` | 把当前分支推到其上游（需已设 upstream） |
| `git push -u origin <branch>` / `--set-upstream` | 首次推送并设上游，之后该分支直接 `git push` |
| `git push origin <local>:<remote>` | 本地分支推到**远程不同名**分支（`<remote>` 不存在则新建） |
| `git push origin --delete <branch>` | **删远程分支**（旧写法 `git push origin :<branch>` 等价） |
| `git push --tags` | 推送**所有**标签（默认 push 不带标签） |
| `git push --follow-tags` | 只推"本次提交可达的注释标签"，更精细 |
| `git push --dry-run` | **预演**：不真推，只列"会推什么" |

```bash
git push -u origin feature/login
#  * [new branch]      feature/login -> feature/login
# branch 'feature/login' set up to track 'origin/feature/login'.

git push origin --delete feature/login   # 删远程分支
git push --dry-run origin main           # 预演，不真推
```

### 5.1 推送被拒（non-fast-forward）怎么办

```bash
git push
#  ! [rejected]        main -> main (fetch first)
# error: failed to push some refs to 'github.com:you/project.git'
# hint: Updates were rejected because the remote contains work that you do not have locally.
```

**根因**：远程有你本地没有的提交（同事先 `push`）。Git 拒绝"非快进"以免覆盖别人。三种正解，按推荐排序：

1. **先 pull 再 push（最常规）**：`git pull --rebase` 把本地提交接在远程之后，解决冲突后 `git push`。协作默认动作。
2. **检查是否真的该强推**：只有当你**确定**远程多出的提交是错误、且无人基于它们工作（如自己的临时分支），才考虑强推。公共分支、主干**绝对不要强推**。
3. **`--force-with-lease`（强推但安全）**：比 `--force` 安全。只在"远程分支与你上次已知状态一致"时才强推；若期间别人又推了新提交，会被拒绝（而非覆盖别人）。

```bash
git push --force origin feature/login                 # 无脑覆盖，危险
git push --force-with-lease origin feature/login      # 远程已变就拒绝，安全
```

::: danger 公共分支严禁 --force
`--force` 直接拿本地历史**覆盖**远程，同事若已基于旧历史工作，下次 `pull` 会产生诡异分叉甚至丢提交。**主干、已共享分支一律不用 `--force`**；确需重写自己独占分支，也优先 `--force-with-lease`。
:::

### 5.2 push.default 配置差异

`git push`（不带分支名）推谁，由 `push.default` 决定：

| 值 | 行为 | 适用 |
| --- | --- | --- |
| **`simple`**（Git 2.x 默认） | 只推当前分支到其 upstream，且**名字必须一致** | 日常推荐 |
| `current` | 推当前分支到远程**同名**分支（不要求有 upstream） | 个人多分支 |
| `upstream` | 推到**上游**分支（本地与远程名字可不同） | 少用，易误推 |
| `matching`（旧默认） | 推送**所有**本地与远程同名的分支 | 不推荐 |

```bash
git config --global push.default simple   # 保持默认即可，最省心
```

> 💡 **在 IDEA 里**：推送是 `Ctrl+Shift+K`，弹窗里会列出**将要推送的提交**，底部可切「推送全部 / 只推当前分支」。
> - **推送被拒**（non-fast-forward）时 IDE 只弹错误、不会替你决定怎么办 —— 正确动作仍是先 `Ctrl+T` 更新再推，与本节正文结论一致。
> - **强制推送藏在按钮的下拉里**：**Push** 按钮旁的下拉箭头 → **Force Push** 或 **Force Push with Lease**。**永远选 with Lease**（等价 `--force-with-lease`），它会先检查远程是否有你还不知道的新提交，比 `--force` 安全得多。
> - Force Push **不是默认选项**，必须在那个下拉里显式选择，算是一道防手滑的设计。

## 六、团队协作流程：集中式 vs Fork + PR

| 模式 | 做法 | 优点 | 缺点 | 适用 |
| --- | --- | --- | --- | --- |
| **集中式** | 所有人往同一仓库的共享分支（main/develop）直接 push | 简单、无 fork 心智负担 | 易互相阻挡、无评审门禁 | 小团队、内网可信环境 |
| **Fork + PR/MR** | 各自 fork → feature 分支开发 → 向原仓库发 PR/MR → 评审后合并 | 有评审门禁、权限清晰 | 流程稍重、需维护双远程 | 开源、跨团队协作 |

一次完整 PR 流程（命令在终端，发 PR 在网页）：

```bash
git switch main && git pull origin main     # 1) 从最新 main 切出分支
git switch -c feature/login
# 2) 本地正常 add/commit
git push -u origin feature/login            # 3) 首次推送并设上游
# 4) 网页发 PR：feature/login -> main
# 5) 同事 Review 提意见
# 6) 改代码后直接 push 回同一分支（PR 自动刷新，不用新开 PR）
git add . && git commit -m "fix: 按 review 调整" && git push
# 7) 网页合并；8) 删分支；9) 同步主干
git switch main && git pull origin main && git branch -d feature/login
```

::: tip Review 改代码就 push 回原分支
被要求改代码后，**继续往同一个 feature 分支 push 即可**，PR 实时反映最新提交。不要为"改一点"新开 PR，否则评审重看一遍、历史也乱。
:::

保护分支与三种合并方式（`git request-pull` 命令现多被网页 PR/MR 取代，本篇略过）：

| 合并方式 | 做了什么 | 历史形态 | 取舍 |
| --- | --- | --- | --- |
| **Create a merge commit** | 保留 feature 全部提交 + 生成合并提交 | 有分叉、有合并点，最完整 | 可追溯"哪个功能何时并入"，主干略臃肿 |
| **Squash and merge** | 把 feature 所有提交**压成 1 个**再并入 | 主干线性、干净 | 丢失 feature 内部粒度，不利 `git bisect` |
| **Rebase and merge** | 把 feature 每个提交重放到 main 顶端再快进 | 线性且保留每个提交 | 要求 feature 历史干净、未公开复杂分叉 |

取舍：**求主干整洁**用 squash；**需逐提交追溯、便于二分定位 bug** 用 merge commit 或 rebase merge。

> 💡 **在 IDEA 里**：PR / MR 可以不出 IDE 就完成 —— 装好 **GitHub** / **GitLab** 插件并登录后，会出现 **Pull Requests** 工具窗，可看列表、看 diff、留评审意见、直接合并；分支右键还有 **Create Pull Request**。
> **Gitee 没有官方插件**，只有功能有限的第三方插件；国内团队通常的做法是：**提交推送用 IDEA，开 PR / 评审回网页**。
> 注意 IDE 的评审界面是「浏览器之外的第二个入口」，**评审结论仍以平台上的记录为准**，别在 IDE 里点完就当完事。

## 七、多账号与凭据：国内读者高频痛点

### 7.1 凭据助手 credential.helper

| 配置 | 含义 | 注意 |
| --- | --- | --- |
| `manager` | **Git Credential Manager**（Windows/macOS 走系统钥匙串） | 最推荐，安全 |
| `osxkeychain` | macOS 系统钥匙串 | 仅 macOS |
| `store` | 明文存到 `~/.git-credentials` | 公共/共享机慎用 |
| `"cache --timeout 3600"` | 内存缓存，3600 秒后失效 | 不落盘，临时机友好 |

```bash
git config --global credential.helper store
git push        # 第一次输账号+令牌，之后免密
```

::: warning 令牌替代密码
GitHub/Gitee 已不支持"账户密码"直接 push，必须用**个人访问令牌（token）**当密码。生成后当密码填，并配合 `credential.helper` 记住。
:::

### 7.2 SSH 多密钥共存（一机多账号）

一台机器连 GitHub 又连 Gitee，或两个 GitHub 账号，靠 `~/.ssh/config` 给不同 host 指定不同私钥。完整示例：

```text
# ~/.ssh/config

# GitHub 个人账号
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes

# Gitee 账号
Host gitee.com
    HostName gitee.com
    User git
    IdentityFile ~/.ssh/id_ed25519_gitee
    IdentitiesOnly yes

# 同一平台多账号：用别名区分（clone 时改用别名 host）
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
```

配套生成各自密钥并把**公钥**（`.pub`）贴到对应平台：
```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_github -C "you@gmail.com"
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_gitee  -C "you@gitee.com"
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_work  -C "you@work.com"

git clone git@github-work:you/project.git    # 别名的账号：仍连 github.com，但用 work 密钥
```

`IdentitiesOnly yes` 很关键：强制 SSH **只用** `IdentityFile` 指定的密钥，避免默认把所有密钥都塞过去被服务器"尝试过多"拒绝。验证身份：`ssh -T git@github.com`（成功会显示 `Hi you! ... authenticated`）、`ssh -T git@gitee.com`。

### 7.3 known_hosts 变更告警

第一次连某 host，SSH 把对方指纹记进 `~/.ssh/known_hosts`。若服务器重装或换网络，可能看到：

```text
WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!
IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NUDGY!
```

表示对方指纹与记录不一致，可能是重装（正常）也可能是中间人（危险）。确认是重装后删除旧记录再连：

```bash
ssh-keygen -R github.com      # 删掉 known_hosts 里 github.com 旧记录
ssh -T git@github.com         # 重新连，提示接受新指纹
```

::: danger 不要盲目关闭校验
有人图省事在 `~/.ssh/config` 写 `StrictHostKeyChecking no` 消告警——这会让你**完全失去中间人防护**。除非临时可信内网自动化，否则别这么干；正确做法是用 `ssh-keygen -R` 清理旧记录。
:::

### 7.4 走代理的几种姿势

Git 的 HTTP 流量和 SSH 流量走两套机制：

```bash
# ① 给 Git 自身所有 HTTP/HTTPS 流量设代理
git config --global http.proxy  http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
git config --global --unset http.proxy          # 取消

# ② 只给某域名设代理（Gitee 国内一般不用代理，单独排除）
git config --global http.https://github.com.proxy http://127.0.0.1:7890
```

SSH 协议的 push/pull **不走 `http.proxy`**，要在 `~/.ssh/config` 用 `ProxyCommand` 让 SSH 走 SOCKS5：

```text
# ~/.ssh/config 内
Host github.com
    HostName github.com
    User git
    ProxyCommand nc -X 5 -x 127.0.0.1:7890 %h %p
    # 若用 connect 工具（Windows 常见）：ProxyCommand connect -S 127.0.0.1:7890 %h %p
```

`-X 5` 表示 SOCKS5，`%h %p` 被替换成目标主机和端口。配好后 `ssh -T git@github.com` 走代理验证一次即可。

> 💡 **在 IDEA 里**：**让 IDE 能登上远程** —— `Settings → Version Control → GitHub / GitLab` 加账号（OAuth 或 Token）；Gitee 走 HTTPS + 凭据管理器，由系统凭据存储接管。
> - **SSH 多密钥**：IDE 复用 `~/.ssh/config`，按本节配好之后，clone 时要选 **SSH 形式**的地址（`git@github.com:...`）才会走到对应密钥。
> - ⚠️ 再提醒一次：`Settings → Appearance & Behavior → System Settings → HTTP Proxy` 只管 IDE 自己联网，**不会改变 `git` 走不走代理**；`git config --global http.proxy` 才是 git 的。

## 八、仓库瘦身与迁移

### 8.1 误提交大文件，为什么历史里还在

结合 02 篇对象模型：Git 提交是**快照**，每次提交完整指向那一时刻的 tree/blob。大文件（如 500MB 的 `big.iso`）一旦进历史，那个 blob 就留在旧提交里；之后即便 `git rm` 再提交，也只是"新提交不再引用它"，**旧提交仍指向那个大 blob**，`.git` 体积不减。`.gitignore` 只能阻止"未跟踪"文件被加进来，对已进历史的大文件无能为力。所以"删文件"≠"仓库变小"，真正减体积必须**改写历史**。
### 8.2 整理与重写历史

- **`git gc`**：打包压缩、回收悬空对象。Git 平时自动跑；仓库变慢/变大时 `git gc --aggressive` 深度整理，但**不会删除已进历史的大文件**。
- **`git filter-repo`**（官方推荐，替代老旧的 `filter-branch` 与 BFG）：彻底移除某文件的所有历史副本。
  ```bash
  git filter-repo --path path/to/big.iso --invert-paths    # 删掉该文件全部历史
  ```
- **BFG Repo-Cleaner**：第三方 Java 工具，处理超大仓库比 `filter-repo` 更快，适合清一堆大文件/密码。

::: danger 重写历史是破坏性操作
`filter-repo`/BFG 会**改变所有后续提交的 SHA**（父链变了）。协作者必须**重新 clone**，旧仓库 `pull` 会冲突。务必：① 在**副本**上操作、先备份；② 提前通知全员；③ 推送用 `git push --force --all`（自己独占或已协调分支用 `--force-with-lease`）。
:::

### 8.3 迁移到新远程

```bash
# 方式 A：改地址，推全部分支与标签
git remote set-url origin https://new-host.com/you/project.git
git push -u origin --all && git push origin --tags

# 方式 B：整库镜像（含分支、标签、notes），常用于平台搬迁
git clone --mirror https://old-host.com/you/project.git
cd project.git
git push --mirror https://new-host.com/you/project.git
```

`--mirror` 是"全量、强制一一对应"的推送，会清掉新远程与旧远程不一致的分支，所以**只用于整库迁移、且新远程是空的**，别对已有内容的仓库乱用。

> 💡 **在 IDEA 里**：**仓库瘦身（`filter-repo` / BFG）没有图形界面**，这类改写历史的重活必须在命令行做，且改完需要团队**全部重新克隆**（见 [07 篇](/ops/git/rebase)）。
> 单纯换远程地址倒可以在界面里做：**Manage Remotes** 改 URL 即可（等于 `git remote set-url`）；整库镜像迁移（`git push --mirror`）仍建议命令行，免得漏掉标签与其它分支。

## 本篇小结

- **`origin` 只是默认名字**，非关键字；一个仓库可挂多个远程（fork 场景 `origin` + `upstream`）。
- **`origin/main` 是远程的本地只读镜像**，`main` 才是你真正提交的对象；两者之差就是 `ahead`/`behind` 来源。
- **upstream 上游**决定 `pull`/`push` 默认跟谁同步；`branch -vv` 中 `ahead 2, behind 1` = 本地多 2、远程多 1。
- 协议选型：**SSH 免密安全（22）** 优先，封端口用 **HTTPS + 令牌（443）**；别用 `git://`，本地迁移用 `file://`。
- `clone` 自动建 `origin` 与跟踪关系；**浅克隆 `--depth 1` 看不到完整历史、回推受限**，用 `git fetch --unshallow` 补全。
- **`fetch` 只刷新 `origin/*`、不动本地**；`pull` = `fetch` + `merge/rebase`，推荐 `pull.rebase true` 或 `pull.ff only`。
- `git fetch -p`/`remote prune` 清理"远程已删"的本地跟踪分支；推送被拒三正解：**先 pull --rebase 再 push** / 确认独占后强推 / **`--force-with-lease` 比 `--force` 安全**。
- PR 改代码直接 **push 回同一分支**刷新；合并方式 merge/squash/rebase 按"是否保留提交粒度"取舍。
- 多账号靠 **`~/.ssh/config` 给不同 host 指定 `IdentityFile` + `IdentitiesOnly yes`**；HTTPS 用 `credential.helper` 记密码，`known_hosts` 变了用 `ssh-keygen -R` 清理。
- 误提交大文件历史里仍在（快照模型）；瘦身要 `git filter-repo`/BFG **重写历史**（破坏性、需通知重 clone）；整库迁移用 `remote set-url` 或 `git push --mirror`。

## 参考链接

- [Pro Git 第 2 章：Git 基础 - 远程仓库的使用](https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E8%BF%9C%E7%A8%8B%E4%BB%93%E5%BA%93%E7%9A%84%E4%BD%BF%E7%94%A8)
- [git-remote 官方手册](https://git-scm.com/docs/git-remote)
- [git-fetch 官方手册](https://git-scm.com/docs/git-fetch)
- [git-pull 官方手册](https://git-scm.com/docs/git-pull)
- [git-push 官方手册](https://git-scm.com/docs/git-push)
- [GitHub Docs：关于 fork（中文）](https://docs.github.com/zh/pull-requests/collaborating-with-pull-requests/working-with-forks/about-forks)
- [Git Credential Manager 文档](https://github.com/git-ecosystem/git-credential-manager)
- [git-filter-repo 官方项目](https://github.com/newren/git-filter-repo)

下一篇 → [06 撤销、回退与“救火”](/ops/git/undo)

