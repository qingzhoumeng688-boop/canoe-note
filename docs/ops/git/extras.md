# 08 标签、子模块与 Worktree

> 本篇导读：Git 的"主干命令"之外，还有一批让工程化更顺手的周边能力：用 tag 给发布版本钉锚点、用 submodule/subtree 引用别的仓库、用 worktree 同时开多个工作目录、用 LFS 管大文件、用 sparse-checkout 给巨型仓库减负、用 hooks 在提交时自动把关。本篇把这些都串起来，每节给真实命令、典型输出和最常见的坑——尤其是"标签默认不推送""子模块游离头""签出标签进 detached HEAD""clone 没装 LFS 拿到指针文件"这几处的反直觉行为，照着做能少踩无数坑。读完你对 Git 的"全家桶"就有了完整地图。

## 一、标签 tag：给某个提交钉个锚点

标签本质是"指向某个提交的不动指针"，常用于标记**发布版本**（v1.0、v2.1.3）。它和分支的区别：分支会随提交往前走，标签永远钉在创建时的那个提交上。

### 1.1 轻量标签 vs 附注标签

| 维度 | 轻量标签 `git tag v1.0` | 附注标签 `git tag -a v1.0 -m "..."` |
| --- | --- | --- |
| 存储对象 | **直接指向提交**的一个引用（类似分支，但没有对象） | 创建一个独立的 **tag 对象**（annotated tag object） |
| 是否带信息 | 无，仅一个名字 | 带打标签人、时间、说明（message） |
| 能否签名 | 否 | 可 `git tag -s` **GPG 签名**，验证来源 |
| 对象模型 | 引用文件 `.git/refs/tags/v1.0` 直接存 SHA | 引用指向 tag 对象，tag 对象再指向提交（两层） |
| 适用 | 本地临时标记、私人用途 | **发布版本、对外正式 tag**（推荐） |

结合 02 篇的对象模型：附注标签是 Git 对象库里真正的"对象"（有 SHA、有作者元数据），可以被校验和签名；轻量标签只是个"书签"。**发布场景一律用附注标签**：

```bash
git tag v1.0                       # 轻量标签（不推荐用于发布）
git tag -a v1.0 -m "发布 1.0 正式版"   # 附注标签（推荐）
git tag -s v1.0 -m "发布 1.0 正式版"   # 附注 + GPG 签名
```

### 1.2 查看标签

```bash
git tag                         # 列出所有标签（按字母序）
git tag -l 'v1.*'               # 通配符过滤，只看 v1.x
git tag -n                      # 列出标签并显示附注第一行
git show v1.0                   # 看某个标签详情：打标人、时间、指向的提交与 diff
```

`git show v1.0` 对附注标签会显示 tag 对象信息和它指向的提交；对轻量标签则直接显示提交内容。

### 1.3 最常见的坑：标签默认不推送

这是新手翻车第一名：**`git push` 不会把标签推上去**，标签只存在于你本地。别人 `clone`/`pull` 后看不到你的 tag。

```bash
git push origin v1.0            # 显式推送单个标签
git push origin --tags          # 一次性推送所有本地标签
git push origin --follow-tags   # 推送时只带上"已对应的附注标签"（推荐配置为默认）
```

建议把 `--follow-tags` 设为默认，避免漏推：

```bash
git config --global push.followTags true
```

::: warning 漏推标签的连锁反应
CI 常按 tag 触发发布（见 1.5）。如果你打了 `v1.0` 却忘了 `--tags` 推送，CI 收不到、同事也 `git describe` 不到，发布就卡住。养成"打 tag 必推"或开 `push.followTags` 的习惯。
:::

### 1.4 删除本地与远程标签

```bash
git tag -d v1.0                               # 删本地标签
git push origin --delete tag v1.0             # 删远程标签（新写法，推荐）
git push origin :refs/tags/v1.0               # 删远程标签（老写法，等价）
```

注意 `git tag -d` 只删本地；远程标签要用 `push` 形式显式删除，否则别人拉下来又会有。

### 1.5 签出标签会进 detached HEAD

`git checkout <tag>` / `git switch <tag>` 会把 `HEAD` 直接指向那个标签提交，进入**游离头（detached HEAD）**状态——此时提交的任何改动不属于任何分支，切走就丢。

```bash
git switch v1.0
# 注意：HEAD 现在指向 v1.0（detached），不在任何分支上
# 想基于这个版本改代码、提一个新修复分支：
git switch -c hotfix-v1.0 v1.0     # 从 v1.0 新建并切到 hotfix-v1.0 分支
```

记住：**看历史用 `git switch <tag>` 没问题，要在标签基础上改东西，先 `git switch -c <branch> <tag>` 建分支再动。**

> 💡 **在 IDEA 里**：标签同样有图形支持 ——
> - **打标签**：Log 里右键某次提交 → **New Tag…**，填标签名与说明（填了说明就是**附注标签**，对应 `-a -m`；留空则是轻量标签）。
> - **看标签**：Log 里显示为灰色小标签，完整列表在下方 **Tags** 分组里。
> - **推送标签**（最容易漏的一步）：Push 对话框里有 **Push Tags** 相关选项，选 `All` 就等于 `git push --tags`。
> - **删除**：Tags 分组里右键 → **Delete**，会提示是否同时删远程标签。

## 二、版本号规范：SemVer 与 git describe

### 2.1 语义化版本 SemVer

版本号形如 `MAJOR.MINOR.PATCH`（如 `2.1.3`），各段含义：

| 段 | 含义 | 何时 +1 |
| --- | --- | --- |
| `MAJOR` | 主版本，不兼容的 API 变更 | 破坏性改动 |
| `MINOR` | 次版本，向下兼容的新功能 | 加了新特性、老功能还能用 |
| `PATCH` | 修订号，向下兼容的 bug 修复 | 只修 bug |

附加标记：

- **预发布**：`-rc.1`、`-beta.2`、`-alpha` 等，放 `PATCH` 之后，表示"还没正式"：`2.1.3-rc.1`。
- **构建元数据**：`+build` 放最后，如 `2.1.3+build.20240901`，仅描述构建、不参与版本比较。

常见打 tag 实践：发布前先打 `v2.2.0-rc.1` 走预发验证；正式发布打 `v2.2.0`；CI 监听 `v*` 标签触发构建与发布。

### 2.2 git describe 怎么算出版本串

`git describe --tags` 能从当前提交反推"离它最近的标签"，输出形如：

```bash
git describe --tags
# v1.2-3-gabc1234
```

拆解 `v1.2-3-gabc1234`：

- `v1.2`：**最近的标签**名；
- `3`：从该标签到当前提交，**中间隔了 3 个提交**；
- `gabc1234`：`g` 是 Git 固定前缀，后面是**当前提交的 abbreviated SHA**（这里 `abc1234`）；
- 如果当前提交恰好就是标签本身，`git describe` 只输出 `v1.2`（没有 `-3-g...`）。

这在 CI 里极好用：自动用 `git describe --tags --dirty` 生成带"距发布多少个提交、是否改过未提交文件（`-dirty`）"的版本号，无需手填。

> 💡 **在 IDEA 里**：SemVer 与 `git describe` 基本是 **CI / 脚本**的事，IDE 侧没有对应功能。想在 IDE 里看「当前版本号」，最实际的办法是打开 **Tags** 分组看最新标签，或在底部 Terminal（`Alt+F12`）里跑 `git describe --tags`。

## 三、子模块 submodule：引用另一个仓库的指定版本

### 3.1 它要解决什么问题

场景：项目 A 想用项目 B 的一份**特定版本**，但又不想走 Maven/npm 这类包管理（比如 B 是还没发包的内部库、或是一段需要改的第三方代码）。submodule 让 A 在指定目录"挂"一个指向 B 某次提交的指针，B 作为独立仓库存在。

```bash
git submodule add <url> libs/foo        # 把 <url> 仓库挂到 libs/foo 目录
git submodule update --init --recursive # 克隆并初始化所有子模块（含嵌套的）
git clone --recurse-submodules <url>    # 克隆主仓库时一并把子模块拉下来
```

主仓库里会多两个东西：`.gitmodules`（记录子模块 URL 与路径，进版本库）和"子模块指针"（记录 B 当时所在的 SHA，也进版本库）。

### 3.2 为什么子模块容易踩坑

| 坑 | 现象 | 解决 |
| --- | --- | --- |
| `git pull` 不更新子模块 | 主仓库拉了新指针，但 `libs/foo` 还是旧的 | `git submodule update --init --recursive` |
| 子模块处于游离头 | 进子模块目录能看到 `HEAD detached at xxxx` | 在子模块里 `git switch <branch>` 再改 |
| 父仓库只记一个 SHA | 别人 `update` 后才拿到你指的版本，你忘了 commit 指针，别人就拿到旧版 | 改完子模块要在**父仓库**也提交指针 |
| 忘了 commit 子模块指针 | 你本地子模块升到新 SHA，但父仓库没记，别人 `clone` 拿到旧 SHA | `git add libs/foo && git commit` |
| 嵌套子模块漏拉 | 只 `--init` 没 `--recursive` | 永远加 `--recursive` |

最经典的反模式：在子模块里改了代码、`commit` 了，却忘了回到父仓库 `git add <子模块路径> && git commit`，于是"指针没更新"，队友拉下来仍是旧版本，bug 看似没修。

### 3.3 子模块常用命令表

| 命令 | 作用 |
| --- | --- |
| `git submodule status` | 看各子模块当前 SHA 与是否已初始化（`-` 未初始化、`+` 指针不符） |
| `git submodule foreach '<cmd>'` | 在每个子模块里执行命令，如 `git submodule foreach 'git pull'` |
| `git submodule update --remote` | 把子模块更新到**远端最新**（默认跟踪分支），而非记录的旧 SHA |
| `git submodule update --init --recursive` | 初始化并递归拉取所有子模块 |
| `git submodule deinit libs/foo` | 注销子模块（保留目录，清空 .git 链接） |
| `git submodule remove libs/foo` | 删除子模块（新版本 Git 直接支持） |

::: danger 结论：能用依赖管理就别用 submodule
submodule 的心智负担高、协作坑多。只要是能在 Maven/npm/Go module 里声明的依赖，**优先走包管理**；submodule 只留给"必须改源码、又没法发包"的极端场景。
:::

## 四、subtree 简介：把代码真复制进来

`subtree` 与 `submodule` 目的相似（引用别仓），但机制相反——它把被引用仓库的代码**真的合并进主仓库的某个目录**，使用者完全无感。

| 维度 | submodule | subtree |
| --- | --- | --- |
| 代码存放 | 独立仓库，主仓库只存指针 SHA | **代码真实复制进主仓库** |
| 使用者感知 | 要 `init`/`update`，否则是空目录 | 无感知，正常 `clone` 就有 |
| 仓库体积 | 主仓库小 | 主仓库变大（含子仓库全部历史） |
| 更新方式 | `submodule update --remote` | `git subtree pull` |
| 脱离父仓 | 子模块天然独立 | 要拆分较麻烦 |
| 协作门槛 | 高（坑多） | 低（对使用者透明） |

基本用法：

```bash
# 添加：把 <url> 仓库的某分支合并到 libs/foo 目录
git subtree add --prefix=libs/foo <url> main --squash

# 拉取上游更新（--squash 把上游历史压成一个提交，保持主历史整洁）
git subtree pull --prefix=libs/foo <url> main --squash

# 把本地对 libs/foo 的改动推回上游仓库
git subtree push --prefix=libs/foo <url> main
```

`--squash` 很关键：它把被并入的历史压成单个提交，避免主仓库历史被上游的几百个提交淹没。**选型建议**：想对使用者零门槛、不怕仓库变大，选 subtree；要严格隔离、主仓库要瘦，才考虑 submodule。

> 💡 **在 IDEA 里**：**submodule 与 subtree 都只有很弱的图形支持** —— IDE 会把 submodule 目录显示成一个特殊节点，能提示「有更新 / 有本地改动」，但从子模块内部提交、更新指针、`--remote` 拉取这些操作，用起来都不如命令行顺手。
> subtree **完全没有界面**，只能命令行。这也是「能用包管理器就别用这两个」的又一个理由。

## 五、worktree：一个仓库开多个工作目录

### 5.1 应用场景

你常遇到：正在 `feature` 上改到一半，突然要修一个紧急 bug——传统做法是 `git stash` 暂存、切分支、修完再切回来 `pop`。`worktree` 让你**同时开多个工作目录**，各自在不同的分支上，互不干扰，还不用 stash。

```bash
# 在主仓库旁边建一个 hotfix 工作目录，并基于 main 新建 hotfix 分支
git worktree add ../hotfix -b hotfix main

# 进去干活（这是个独立文件夹，和主仓库共享同一个 .git 对象库）
cd ../hotfix
vim src/bug.js && git commit -m "fix: 紧急修复"

# 回到主仓库继续原来的 feature 工作
cd ../canoe-notes
```

### 5.2 管理与约束

| 命令 | 作用 |
| --- | --- |
| `git worktree list` | 列出所有工作目录及其所在分支 |
| `git worktree add <path> -b <newbranch> <base>` | 新建工作目录 + 新分支 |
| `git worktree remove <path>` | 删除一个工作目录（需已干净或已合并） |
| `git worktree prune` | 清理已失效的工作目录记录（目录被手动删了用这个） |
| `git worktree lock <path>` | 锁定，防止 `prune` 误删（如目录在移动存储上） |

**硬约束**：**同一个分支不能被两个 worktree 同时签出**。Git 会拒绝第二个 worktree 签出已在别处签出的分支——这正逼着你"一个 bug 一个分支"。

### 5.3 worktree 与 clone 第二份的区别

| 维度 | 第二个 worktree | 再 clone 一份 |
| --- | --- | --- |
| 对象库 | **共享主仓库的 `.git`**（同一份对象，省磁盘） | 独立 `.git`，重复占空间 |
| fetch 成本 | 一次 fetch 两处都能用 | 各自 fetch 一遍 |
| 切换 | `cd` 切目录即可 | 同样 `cd` |
| 适用 | 同机并行多任务、省空间 | 跨机/隔离需求 |

结论：同一台机器上要并行干活，`worktree` 比 `clone` 第二份更轻——共享对象库、省磁盘、少一次 fetch。

> 💡 **在 IDEA 里**：**worktree 没有管理界面**。可行的用法是：命令行 `git worktree add` 建好目录后，用 `File → Open` 把那个目录**当成独立工程打开**，两边各写各的；它们共享同一个 `.git` 对象库，所以任一边的提交在另一边的 Log 里都看得到。用完回命令行 `git worktree remove` 收拾。

## 六、大文件 LFS：Git 本不适合存二进制

### 6.1 为什么 Git 不适合大文件

Git 每次改动都会把**整个文件的新版本**存进对象库（哪怕只改了一行）。一个 100MB 的 PSD，改 10 次历史就 1GB；团队每人克隆都下载全量历史，仓库迅速爆炸、克隆龟速。

**LFS（Large File Storage）** 的原理：仓库里只存一个**几 KB 的指针文件**（记录真实文件的 SHA 和大小），真实内容存在 LFS 服务器；克隆/检出时 Git 按指针把大文件拉下来替换。

```bash
git lfs install                  # 在本机启用 LFS（一次性，写 hooks）
git lfs track "*.psd"            # 声明：.psd 走 LFS（生成 .gitattributes）
git add .gitattributes           # 把规则提交进版本库（队友才生效）
git add art.psd                  # 之后 add 大文件，Git 自动存指针
git commit -m "feat: 新增设计稿"

# 把历史里已经存在的大文件"搬"进 LFS（改写历史）
git lfs migrate import --include="*.psd,*.zip" --everything
```

### 6.2 常见坑

| 坑 | 现象 | 解决 |
| --- | --- | --- |
| clone 没装 LFS | 拿到的是**指针文件**而非真实内容（打开是乱码文本） | 先 `git lfs install` 再 `git lfs pull` |
| 容量与带宽计费 | LFS 存储/流量常单独计费（GitHub 有免费额度） | 大文件评估是否该入库 |
| 忘记 `track` | 大文件直接进普通对象库，仓库照胀 | 早期就 `git lfs track` |
| migrate 改写历史 | 同 filter-repo，需全员重克隆 | 团队提前通知 |

::: tip 替代方案
设计稿、视频、数据集这类超大二进制，**优先考虑不入库**：放制品库（Nexus/Artifactory）、对象存储（S3/OSS）或网盘，仓库里只留链接。LFS 是无奈之选，不是万能药。
:::

> 💡 **在 IDEA 里**：LFS 需要**本机装好 `git-lfs`**（IDE 不自带），之后 clone / 检出由 Git 自己处理，IDE 里看不出差别；但 **LFS 本身没有界面**，`track`、`migrate import`、`lfs pull` 都得命令行。
> 一个常见的 IDE 现象：机器上没装 LFS 时，在 IDE 里打开大文件看到的是一行指针文本 —— 不是文件坏了，是 LFS 没生效。

## 七、稀疏检出与部分克隆：给巨型仓库减负

### 7.1 sparse-checkout：只检出需要的目录

超大单仓（monorepo）里你只改其中一个目录，没必要把几万文件全拉到工作区：

```bash
git sparse-checkout init --cone        # 开启稀疏检出（cone 模式，按目录）
git sparse-checkout set src/app docs   # 只检出 src/app 和 docs 两个目录
git sparse-checkout list               # 看当前包含的目录
git sparse-checkout disable            # 关掉，恢复全量检出
```

`sparse-checkout` 只影响**工作区**（哪些文件落盘），对象库仍完整；适合"提速单测、减少磁盘占用"。

### 7.2 部分克隆 --filter：连对象都少拉

部分克隆在**克隆时**就按规则跳过某些对象，比 sparse-checkout 更省：

```bash
git clone --filter=blob:none <url>       # 不拉 blob（文件内容），用时按需再取
git clone --filter=tree:0 <url>          # 连 tree 都不拉，最激进，仅取 commit
```

| 参数 | 含义 | 适用 |
| --- | --- | --- |
| `--filter=blob:none` | 克隆只拿 commit/tree，文件内容懒加载 | 大仓只想先有结构、按需取文件 |
| `--filter=tree:0` | 只拿 commit，tree/blob 都懒加载 | CI 只查提交、不需文件内容时 |
| `--filter=blob:limit=1M` | blob 小于 1M 才拉，大的懒加载 | 折中方案 |

限制：部分克隆依赖"懒加载"，离线时缺的对象拿不到；老旧 Git 或某些平台可能不支持 filter，需 Git 2.19+。

> 💡 **在 IDEA 里**：稀疏检出与部分克隆都**没有图形入口**，`sparse-checkout set`、`--filter=blob:none` 这些只能在 clone / 命令行里做；之后按普通工程用 IDE 打开即可，功能正常。

## 八、钩子 hooks：提交时自动把关（总览）

`.git/hooks/` 下有一堆 `.sample` 文件，把后缀去掉就能生效——钩子是**在特定 Git 动作前后自动执行的脚本**（如提交前跑 lint、推送前跑测试）。

### 8.1 客户端 vs 服务端钩子

| 类型 | 钩子 | 触发时机 |
| --- | --- | --- |
| 客户端 | `pre-commit` | `git commit` 前，可拦截（代码格式/lint 检查） |
| 客户端 | `commit-msg` | 提交信息写好后，可校验格式（如 Conventional Commits） |
| 客户端 | `pre-push` | `git push` 前，可跑测试 |
| 客户端 | `post-merge` | `merge` 完成后，如自动 `npm install` |
| 服务端 | `pre-receive` | 服务端收到 push 时最先跑，可拒绝不合规范 |
| 服务端 | `update` | 每个分支更新前逐个校验 |
| 服务端 | `post-receive` | push 成功后，如触发部署/通知（CI 常用） |

### 8.2 钩子不进版本库，为什么需要 husky

`.git/hooks` 在 `.git` 目录内，**不会被 `commit` 出去**，所以团队没法靠它共享钩子。解决方案是用 `husky`（或框架自带机制）把钩子脚本放到仓库里、安装时自动软链到 `.git/hooks`。这是团队落地提交规范（见 09 篇）的前提。

一个 `pre-commit` 跑 lint 的最小 shell 示例：

```sh
#!/bin/sh
# .git/hooks/pre-commit（或 husky 管理的 pre-commit）
# 提交前对暂存区的 js 文件跑 eslint，有错则拒绝提交

files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.js$')
if [ -n "$files" ]; then
  echo "pre-commit: 正在 lint 暂存文件..."
  npx eslint $files
  if [ $? -ne 0 ]; then
    echo "pre-commit: lint 未通过，提交被拒绝。请先修复后再提交。"
    exit 1
  fi
fi
exit 0
```

脚本 `exit 1` 即中断提交；`exit 0` 放行。钩子出错或耗时过长会影响体验，建议只做"快且关键"的校验（如格式、静态检查），重测试放 `pre-push` 或服务端 CI。

> 💡 **在 IDEA 里**：钩子在 IDE 提交时**会被执行** —— 提交窗里的 **Run Git hooks** 选项控制它（默认勾选），所以 `commitlint` 拦不住的提交，在 IDE 里一样会被拦下，报错信息显示在提交窗底部。
> 反过来这也是「装好钩子后 IDE 提交突然失败」的常见原因：别急着翻 IDE 设置，先在 Terminal 里手动 `git commit` 复现一次，看是不是钩子在挡。

## 本篇小结

- **标签**是钉在提交上的"不动指针"：轻量标签只存 SHA，附注标签是带元数据的 tag 对象（发布推荐，`-s` 可签名）。
- **标签默认不推送**是头号坑：用 `git push origin v1.0` / `--tags` / `--follow-tags`（设 `push.followTags true`）。
- 删标签：本地 `git tag -d`、远程 `git push origin --delete tag v1.0`（或老写法 `:refs/tags/v1.0`）。
- 签出标签进 **detached HEAD**：要基于标签改代码，先 `git switch -c <branch> <tag>`。
- **SemVer** = `MAJOR.MINOR.PATCH`，加 `-rc.1` 预发布、`+build` 构建元数据；`git describe --tags` 输出 `v1.2-3-gabc1234`（最近标签-间隔提交数-当前SHA）。
- **submodule** 解决"引用别仓指定版本"，但坑多：pull 不更新、游离头、父仓只记 SHA、易忘提交指针；**能用 Maven/npm 就别用 submodule**。
- **subtree** 把代码真复制进主仓、对使用者无感，用 `add/pull/push --prefix=... --squash`；主仓会变大但协作门槛低。
- **worktree** 开多工作目录并行干活，省 stash；约束：同一分支不能被两个 worktree 同时签出；比 clone 第二份更省（共享 `.git`）。
- **LFS** 用指针文件替大文件，真实内容放 LFS 服务器；坑：`clone` 没装 lfs 拿到的是指针、`migrate import` 改写历史需重克隆。
- **sparse-checkout** 只检出部分目录（提速单测）；`--filter=blob:none`/`tree:0` 部分克隆懒加载对象，需 Git 2.19+。
- **hooks** 在动作前后自动执行：客户端 `pre-commit`/`commit-msg`/`pre-push`/`post-merge`，服务端 `pre-receive`/`update`/`post-receive`；钩子不进版本库，靠 husky 共享。

## 参考链接

- [Pro Git 第 2 章：Git 基础 - 打标签](https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E6%89%93%E6%A0%87%E7%AD%BE)
- [git-tag 官方手册](https://git-scm.com/docs/git-tag)
- [SemVer 语义化版本官网](https://semver.org/lang/zh-CN/)
- [git-submodule 官方手册](https://git-scm.com/docs/git-submodule)
- [git-worktree 官方手册](https://git-scm.com/docs/git-worktree)
- [Git LFS 官方文档](https://git-lfs.github.com/)
- [git-sparse-checkout 官方手册](https://git-scm.com/docs/git-sparse-checkout)
- [Git Hooks 官方文档（githooks）](https://git-scm.com/docs/githooks)

下一篇 → [09 团队工作流与提交规范](/ops/git/workflow)
