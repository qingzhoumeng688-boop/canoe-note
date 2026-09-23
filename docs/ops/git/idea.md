# 11 在 IDEA 里用 Git

> 本篇导读：前面十篇讲的都是命令行的 Git，但日常写 Java 的人，真正敲 Git 命令的次数可能远少于在 IDEA 里点菜单的次数。本篇把两套操作对齐起来：先说明 IDEA 的 Git 集成到底做了什么（它只是本机 Git 的另一个前端），再给出「五个入口 + 快捷键」，然后用一组对照表把常见命令一一映射到 IDEA 的菜单路径；接着逐个讲清提交窗、Log 工具窗、三栏合并工具、Git Console 这几个高频界面怎么用；最后老实交代 IDEA 做不了的事，以及为什么那些事应该留在命令行。读完你就能在「顺手点菜单」和「关键时刻敲命令」之间自由切换。

## 一、前提：IDEA 只是本机 Git 的另一个前端

这一点必须先立住，否则后面全乱：

**IDEA 不自带 Git 实现。** 它调用的是你机器上安装的那个 `git` 可执行文件。由此推出三条重要结论：

1. **配置是共享的**。你在命令行 `git config --global user.name` 里写的身份、`core.autocrlf` 写的换行符策略、`pull.rebase` 写的拉取策略，IDEA 全部生效，**不需要在 IDE 里再配一遍**。
2. **仓库状态是共享的**。IDE 里提交完，命令行 `git log` 立刻能看到；命令行建的钩子，IDE 提交时也会执行。
3. **能力是共享的**。命令行能做的事，IDE 最差也能通过内置终端做；反过来，IDE 没有的东西不代表 Git 没有。

确认 IDE 找得到 git：`Settings → Version Control → Git`，看 **Path to Git executable**，点 **Test** 应显示版本号。找不到时填绝对路径，例如：

```text
Windows  E:\app\Git\Git\bin\git.exe
macOS    /usr/bin/git          或  /opt/homebrew/bin/git
Linux    /usr/bin/git
```

::: tip 版本差异提醒
IDEA 的 Git 界面在 2020.1 有过一次大改版：旧版的 **Local Changes** 标签变成了独立的 **Commit 工具窗**，Log 移到 **Git 工具窗** 里。本篇的菜单文案以 2023.x / 2024.x 为准，老版本上位置会略有出入 —— **认菜单名字，别认坐标**。
:::

### 最快的找操作方式：Find Action

在 IDEA 里想不起来某个 Git 操作藏哪，按 `Ctrl+Shift+A`（Find Action），输入 `git`，所有能执行的 Git 动作会列出来，直接回车执行。这比翻菜单快得多，也避开了版本差异。

## 二、五个入口与常用快捷键

日常 90% 的操作集中在这五处：

| 入口 | 位置 | 干什么 |
|---|---|---|
| **分支控件** | 状态栏**右下角**的分支名 | 切分支、新建分支、合并、变基、管理远程 |
| **提交窗** | `Ctrl+K` | 勾选文件、写提交信息、Amend、提交并推送 |
| **Git 工具窗** | `Alt+9` | **Log**（历史图）、**Console**（执行日志）、Stashes |
| **更新 / 推送** | `Ctrl+T` / `Ctrl+Shift+K` | pull 与 push |
| **右键菜单** | 编辑器、Project 视图、Log 提交 | Rollback、Annotate、Show History、Cherry-Pick、Reset |

默认快捷键速查（可在 `Settings → Keymap` 里搜命令名查看或改键）：

| 操作 | 快捷键 |
|---|---|
| 提交（Commit） | `Ctrl+K` |
| 推送（Push） | `Ctrl+Shift+K` |
| 更新项目（Update Project，即 pull） | `Ctrl+T` |
| 打开 Git 工具窗 | `Alt+9` |
| 打开提交窗 | `Alt+0` |
| 显示选中文件的差异 | `Ctrl+D` |
| 打开终端 | `Alt+F12` |
| 打开设置 | `Ctrl+Alt+S` |
| 搜索动作（找 Git 菜单最快的办法） | `Ctrl+Shift+A` |
| 重命名文件（自动 `git mv`） | `Shift+F6` |
| Git 操作弹出面板 | `Alt` 键与反引号键一起按 |

::: warning 平台差异
macOS 上把 `Ctrl` 换成 `Command`；`Alt+9` 对应 `⌘9`。另外有些快捷键会被输入法或系统占用，冲突时 IDEA 会提示，改键即可。
:::

## 三、命令 ↔ IDEA 菜单对照总表（核心）

下面按主题分表，**左边是命令行的做法，右边是在 IDEA 里点哪里**。这张表是本篇的骨架，配合 `Ctrl+F` 使用。

### 3.1 仓库与配置

| 命令行 | IDEA 操作 |
|---|---|
| `git init` | `Git → Init`；新建工程时勾 **Create Git repository** |
| `git clone <url>` | 欢迎页 **Get from VCS**；或 `Git → Clone…` |
| 把已有目录纳入管理 | `Settings → Version Control → Directory Mappings` 添加 VCS 根 |
| `git config …`（身份 / 别名 / 换行符） | **没有界面，回命令行**；IDE 自动复用结果（别名对 IDE 无效，见第十节） |
| 指定 git 程序 | `Settings → Version Control → Git → Path to Git executable` |
| 编辑 `.gitignore` | 右键文件或目录 → `Git → Add to .gitignore`（建议装 **.ignore** 插件） |
| `git remote add / set-url` | **Manage Remotes**（Git 工具窗内），增删改 URL |

### 3.2 提交与暂存

| 命令行 | IDEA 操作 |
|---|---|
| `git add <file>` | 提交窗里**勾选文件** |
| `git add -p`（分块暂存） | 差异视图里**逐个勾选改动块** |
| `git restore --staged <file>` | 提交窗里**取消勾选** |
| `git commit -m "…"` | `Ctrl+K` 写信息 → **Commit** |
| `git commit --amend` | 提交窗工具栏勾 **Amend** |
| 补文件进上次提交 | 勾选新文件 + 勾 **Amend** + Commit |
| 只改上次提交信息 | Log 里右键该提交 → **Edit Commit Message** |
| `git commit && git push` | **Commit** 按钮右侧下拉 → **Commit and Push…** |
| `git restore <file>`（丢弃工作区改动） | 提交窗里文件右键 → **Rollback** |
| `git clean -fd` | **Rollback** 对话框里勾选一并删除未跟踪文件（新版 IDE 支持） |
| 夹带格式化 / 检查后再提交 | 提交窗选项区勾 **Reformat code** / **Optimize imports** / **Analyze code** |

### 3.3 查看与追溯

| 命令行 | IDEA 操作 |
|---|---|
| `git status` | 提交窗里的文件列表（颜色 + 状态字母） |
| `git diff <file>` | 双击文件，或 `Ctrl+D` |
| `git diff --cached` | 差异视图左上角把对比目标切到 **HEAD** |
| `git diff -w` | 差异视图右上角齿轮 → **Ignore whitespace** |
| `git log --graph --all` | `Alt+9` → Git 工具窗的 **Log** 标签 |
| `git log --author/--since/--grep` | Log 顶部**筛选栏**（User / Date / 文本） |
| `git log -- <path>` | 文件上右键 → `Git → Show History` |
| `git log -S "内容"` | 打开文件历史后，在历史面板底部搜索框里搜代码内容 |
| `git blame` / `blame -L` | 编辑器**行号栏右键 → Annotate with Git Blame**（选中一段则是 `-L` 效果） |
| `git show <sha>` | Log 里选中提交，下方 **Commit Details** 面板 |
| `git show <sha>:<path>` | Log 里右键 → **Show Repository at Revision** |
| `git diff <sha>` | Log 里右键 → **Compare with Local** |
| `git diff A B` | `Ctrl` 选中两个提交 → **Compare Versions** |
| `git rev-parse HEAD` | Log 里右键 → **Copy Revision Number** |
| `GIT_TRACE=1` 看实际执行 | Git 工具窗的 **Console** 标签 |

### 3.4 分支与合并

| 命令行 | IDEA 操作 |
|---|---|
| `git branch -a` | 状态栏右下角**分支控件**，或 `Git → Branches` |
| `git switch -c <b>` | 分支控件 → **New Branch** |
| `git switch <b>` | 分支控件 → **Checkout**（有未提交改动会 Smart Checkout，见 7.2） |
| 从某提交起分支 | Log 里右键该提交 → **New Branch from Here** |
| `git switch -c <b> <sha>` | 同上（从选中提交新建） |
| `git branch -m` | 分支控件里右键 → **Rename** |
| `git branch -d` / `-D` | 分支控件里右键 → **Delete** |
| `git merge <b>` | 选中分支 → **Merge into Current** |
| `git merge --no-ff` | **无界面**，回命令行（IDEA 在可快进时一律快进） |
| 解决冲突 | **三栏合并工具**（见 7.3） |
| `git merge --abort` | 合并工具工具栏 → **Abort Merge** |
| `git rebase <b>` | 选中目标分支 → **Rebase Current onto Selected** |
| `git rebase --onto` | **无界面**，回命令行 |
| `git rebase -i` | Log 里选中一串提交 → **Interactively Rebase from Here…** |
| `git stash push -u` | Git 工具窗 → Stashes → **Stash Changes…**（勾 Include untracked files） |
| `git stash pop` / `apply` | Stashes → **Unstash Changes…**（勾选 **Pop stash** 则弹出） |
| `git stash list / drop` | Stashes 分组列表，右键 **Drop** / **Clear** |

### 3.5 远程与协作

| 命令行 | IDEA 操作 |
|---|---|
| `git branch -r` | 分支控件的 **Remote** 分组 |
| `git fetch --all` | `Git → Fetch`，或 **Fetch All Remotes** |
| `git pull` | `Ctrl+T` → **Update Project**，弹窗选 **Merge** |
| `git pull --rebase` | `Ctrl+T` → **Update Project**，弹窗选 **Rebase** |
| `git push` | `Ctrl+Shift+K` |
| 首次推送并设上游 | Push 对话框里 IDE 会提示同时设置跟踪关系 |
| `git push origin --delete <b>` | 分支控件 Remote 分组里右键 → **Delete** |
| `git push --force-with-lease` | Push 按钮**下拉** → **Force Push with Lease** |
| `git push --tags` | Push 对话框里的 **Push Tags** 选项选 `All` |
| `git tag -a v1.0 -m "…"` | Log 里右键提交 → **New Tag…**（填说明即为附注标签） |
| `git tag -d` / 删远程标签 | Log 的 **Tags** 分组里右键 → **Delete** |
| 发 PR / MR | **GitHub / GitLab 插件** → Pull Requests 工具窗（Gitee 无官方插件） |

### 3.6 撤销与回退

| 命令行 | IDEA 操作 |
|---|---|
| `git restore <file>` | 提交窗里右键 → **Rollback** |
| `git restore --staged` | 提交窗里取消勾选 |
| `git commit --amend` | 提交窗勾 **Amend** |
| `git reset --soft/--mixed` | Log 右键 → **Reset Current Branch to Here** → 选 Soft / Mixed |
| `git reset --hard` | 同上，选 **Hard**（⚠️ 不可逆） |
| `git revert <sha>` | Log 右键 → **Revert Commit** |
| `git revert -m 1`（合并提交） | 同上；IDE 会提示是合并提交并让你选保留哪个父提交 |
| `git cherry-pick <sha>` | Log 右键 → **Cherry-Pick** |
| `git cherry-pick -n` | **无界面**，回命令行 |
| `git reflog` | **无可用界面**，回命令行（见第九节） |
| 救回从未提交的内容 | 右键文件 → **Local History → Show History**（IDE 自己的快照，与 Git 无关） |

## 四、首次接入：克隆、打开、初始化

**打开一个已有仓库**：`File → Open`，选中仓库根目录，IDEA 会自动识别其中的 `.git` 并把项目登记为 Git 工程。识别不到时（例如项目根不在 Git 根上），用 `Settings → Version Control → Directory Mappings` 手动加一条。

**从远程克隆**：欢迎页的 **Get from VCS**，或菜单 `Git → Clone…`。粘贴 URL、选目录即可。克隆完 IDEA 会顺手提示导入 Maven / Gradle 依赖 —— 这是 IDE 相对命令行多出来的一步。

**新建工程并初始化仓库**：新建工程向导里有 **Create Git repository** 选项；已有工程则用 `Git → Init`。

::: tip 多模块项目的坑
如果父工程和子模块各是一个 Git 仓库，IDEA 默认只会把**项目根目录**登记为一个 VCS 根，子模块里的改动可能不出现在提交窗。此时用 `Settings → Version Control → Directory Mappings` 把子模块目录也加进去。
:::

## 五、日常提交：勾选即暂存

**提交窗（`Ctrl+K`）是整个 IDE 里最高频的 Git 界面**，它的结构其实是命令行的「三个区域」的图形化：

- **文件列表**：勾选 = `git add`，取消勾选 = `git restore --staged`。文件颜色与 `git status -s` 的字母对应（蓝 = 已修改、绿 = 新增、红 = 未跟踪或冲突）。
- **差异区**：双击文件打开对照视图。**每个改动块左侧都有复选框**，只勾想要的那几块，就等于 `git add -p` —— 而且所见即所得，不用猜 `y` / `n` / `s` 该敲哪个键。
- **提交信息框**：按 `Ctrl+↑` 可以调出本仓库的历史提交信息，复用措辞很方便。
- **选项区**：**Reformat code**、**Rearrange code**、**Optimize imports**、**Analyze code**、**Run Git hooks** 等开关。注意 **Run Git hooks 默认是勾选的**，这意味着 `commitlint`、`pre-commit` 之类的钩子在 IDE 里同样会拦截你的提交。

**几个高频动作**：

| 想做的事 | 怎么做 |
|---|---|
| 提交并立刻推送 | **Commit** 按钮右侧下拉 → **Commit and Push…** |
| 修改上一次提交 | 勾上工具栏的 **Amend** 复选框 |
| 把改动拆成几组分别提交 | 用 **Changelists**（`Settings → Version Control → Changelists` 启用），把文件拖进不同列表 |
| 只提交一个文件里的一部分改动 | 在差异视图里勾选对应的改动块 |

::: warning Changelists 与 stash 不是一回事
**Changelists** 是 IDE 的组织工具，文件仍然在工作区、状态仍是「未提交」，只是被分到了不同的待提交分组里；**Stash** 才是 Git 的功能，会把改动从工作区拿走。别把两者混为一谈，更别把 Changelists 当成备份。
:::

## 六、看历史与追责：Log、Annotate、Console

### 6.1 Log 工具窗

`Alt+9` 打开 Git 工具窗，切到 **Log** 标签。它是图形版的 `git log --graph --all`：

- **筛选栏**可传 **User / Date / Path**，并支持在提交信息与**代码内容**里搜文本 —— 后者部分替代了 `git log -S`。
- 点某个提交，下方 **Commit Details** 显示它的文件清单；双击文件看该版本的差异。
- 右键某次提交是最重要的入口，菜单里集合了 **Checkout Revision**、**New Branch from Here**、**New Tag…**、**Cherry-Pick**、**Revert Commit**、**Reset Current Branch to Here**、**Edit Commit Message**、**Copy Revision Number**、**Compare with Local**、**Show Repository at Revision**、**Create Patch** 等一大批动作 —— 前面几张表里的「Log 右键」说的都是这里。
- 顶部把分支切成 **All** 或指定分支，可以只看某条线的历史。

### 6.2 Annotate：把 blame 搬到行号栏

在编辑器**左侧行号栏右键 → Annotate with Git Blame**，每一行左侧会显示「提交人 + 日期 + 短 SHA」。点这些标注可以：

- 跳到对应的提交（等价于 `git show`）；
- **Show Diff** 看这一行当时是怎么被改的（这是排查「这行为什么这么写」最快的方式）；
- 继续向前追（Annotate Previous Revision）。

选中一段代码后再执行同一操作，效果约等于 `git blame -L`。想让 blame 常驻显示、不用每次手动开，装 **GitToolBox** 插件。

### 6.3 Git Console：IDE 到底敲了什么

**这是图形界面下排查 Git 问题最有价值的工具，没有之一。** Git 工具窗的 **Console** 标签会**原样打印 IDEA 执行的每一条 git 命令及其完整输出**，包括你自己从没见过的参数。

典型用法：

1. 在 IDE 里做的某个操作「结果和预期不一样」；
2. 先来 Console 看它实际执行了什么；
3. 把那条命令拿到命令行复现、查明原因。

它同时也接受手动输入命令，等于一个已经站在项目根目录里的内嵌终端 —— 比开一个 Terminal（`Alt+F12`）再 `cd` 过去省事。

### 6.4 Local History：和 Git 无关的第二重保险

右键文件或目录 → **Local History → Show History**。它是 **IDE 自己**按时间做的本地快照，**不进入 Git、不跨机器、别人看不到**，但对「改崩了但还没提交」这种情况意外地好用 —— 比如你误点了 Rollback，Git 已经救不回来了，Local History 里往往还留着几分钟前的那一版。

## 七、分支、合并与冲突

### 7.1 分支控件

状态栏**右下角的分支名**就是分支控件（也可从 `Git → Branches` 打开）。它把本地分支与远程分支分成 **Local** / **Remote** 两组，常用的动作都在右键里：

| 动作 | 说明 |
|---|---|
| **New Branch** | 新建并切换（等于 `git switch -c`） |
| **Checkout** | 切换分支 |
| **Checkout and Rebase onto …** | 新建分支并立即接到目标分支上 |
| **Compare with Current** | 看两个分支的差异 |
| **Show Diff with Working Tree** | 看某分支与当前工作区的差异 |
| **Rebase Current onto Selected** | 等于 `git rebase <选中分支>` |
| **Merge into Current** | 等于 `git merge <选中分支>` |
| **Delete / Rename** | 删分支 / 重命名 |

### 7.2 Smart Checkout：为什么切分支不用手动 stash

在 IDEA 里切换分支时，如果工作区有未提交改动，IDE 会**先自动 stash、切完再自动恢复**（叫 Smart Checkout）。所以多数情况下你不需要手动 `git stash`。

两个注意点：

- 自动恢复**可能产生冲突**，此时 IDE 会像普通冲突一样提示你处理；
- 这个机制只覆盖「切分支」，**切 commit（Checkout Revision）和从远程更新时未必同样处理**，别把它当成万能保险。

### 7.3 三栏合并工具

触发合并或变基后若有冲突，IDEA 会弹出三栏合并视图：

```text
+------------------+------------------+------------------+
|  Local Changes   |      Result      | Changes from X   |
|    (ours)        |   (final file)   |   (theirs)       |
+------------------+------------------+------------------+
```

- **左栏**是你当前分支的版本，**右栏**是对方分支的版本，**中栏**是你最终要保存的内容。
- 每个冲突块左右各有一个 `»` / `«` 箭头，点一下把该侧内容采纳进中栏；**Accept Left** / **Accept Right** 是整块采纳，等价于 `git checkout --ours` / `--theirs`。
- 改完点 **Apply**，IDE 自动完成「标记已解决」这一步（相当于 `git add`），然后你在提交窗里提交即可完成合并。
- 想整体放弃：合并工具工具栏的 **Abort Merge**，等价于 `git merge --abort`。

::: danger rebase 冲突时 ours / theirs 会反过来
合并（merge）时 `ours` 是你当前分支、`theirs` 是对方分支；**变基（rebase）时方向正好相反** —— 左栏变成了「你要变基到的目标分支」，右栏变成了「你自己那条提交」。

在 IDEA 里判断方向，别凭记忆，**看栏头文字**（`Local Changes` / `Changes from <branch>`）。搞反了会把对方的代码整段覆盖成自己的。
:::

## 八、推送、更新与强推

### 8.1 Update Project（`Ctrl+T`）

`Ctrl+T` 就是 `pull`，弹窗里三个单选按钮正好对应三种策略：

| IDEA 选项 | 等价命令 | 说明 |
|---|---|---|
| **Merge** | `git pull` | 默认策略，产生合并提交 |
| **Rebase** | `git pull --rebase` | 把本地提交搬到远程之上，历史线性 |
| **Branch Default** | 由分支配置决定 | 相当于交给 `pull.rebase` 与 `branch.<name>.rebase` |

选好后可以勾 **Don't ask again**，这个选择会被写进 `git config`，命令行也认。

只想取不合并（`git fetch`）：`Git → Fetch` 或 **Fetch All Remotes**，然后在 Log 里看 Incoming 的提交。

### 8.2 Push（`Ctrl+Shift+K`）

Push 对话框里会列出**将要推送的提交**，底部可切换「推送全部 / 只推当前分支」。几个要点：

- **推送被拒**（non-fast-forward）时，IDE 只弹错误、不会替你决定怎么办 —— 正确动作仍是先 `Ctrl+T` 更新再推，与 [05 篇](/ops/git/remote) 的结论一致。
- **强制推送藏在按钮的下拉里**：**Push** 按钮旁的下拉箭头 → **Force Push** 或 **Force Push with Lease**。**永远选 with Lease**（等价于 `--force-with-lease`），它会先检查远程有没有你还不知道的新提交。
- Force Push **不是默认选项**，必须在那个下拉里显式选择 —— 算是一道防手滑的设计，别嫌它麻烦。
- 推标签用对话框里的 **Push Tags** 选项（选 `All` 等于 `git push --tags`）。

## 九、撤销与救火：IDEA 给到什么程度

### 9.1 三条口诀

图形界面里 Rollback、Reset、Revert 都只是一个菜单词，点错了没有第二次确认，所以口诀比命令行更要紧：

1. **没提交的 → Rollback**（提交窗里右键文件）
2. **提交了没推的 → Reset**（Log 右键 → Reset Current Branch to Here，选 Soft / Mixed / Hard）
3. **推出去的 → Revert**（Log 右键 → Revert Commit，生成反向提交，历史留痕）

::: warning `Ctrl+Z` 不是 Git 撤销
它只是编辑器的撤销栈，关掉文件或重启 IDE 就没了。真正的「回到最近一次提交的样子」永远是 **Rollback**。
:::

### 9.2 IDEA 救不了的时候

| 场景 | 为什么 IDE 救不了 | 怎么办 |
|---|---|---|
| 误 `reset --hard` 丢了提交 | Log 只显示**可达**提交，被丢弃的提交在图上根本看不见 | `git reflog` → `git reset --hard <sha>`（见 [06 篇](/ops/git/undo)） |
| 误删分支 | 同上，分支节点已从图上消失 | `git reflog show <branch>` 或 `git branch <name> <sha>` |
| rebase 搞砸了想回原状 | reflog 里的中间状态不在图上 | `git reflog` 找到 `rebase (start)` 那条 |
| 仓库损坏 | 无界面 | `git fsck`、必要时重新 clone |

**一个例外**：如果丢的是**从未提交过**的内容，试试 **Local History**（见 6.4）—— 它虽然与 Git 无关，却常常是最后的救命稻草。

## 十、IDEA 不做的那些事

这一节同样重要：知道 IDE 的边界，才不会在关键时刻白翻菜单。

| 功能 | IDEA 支持情况 | 建议 |
|---|---|---|
| `git bisect` | 无界面 | 用 Terminal（`Alt+F12`）做，IDE 只用来跑测试 |
| `git reflog` 深度救援 | 基本没有 | 命令行 |
| `filter-repo` / `filter-branch` | 无 | 命令行；且改完要全团队重新克隆 |
| `git lfs`（track / migrate / pull） | 无界面（要求本机装 git-lfs） | 命令行 |
| `git subtree` | 无 | 命令行 |
| `git submodule` 高级操作 | 只有很弱的节点提示 | 命令行 |
| `git worktree` | 无管理界面 | 命令行建，再 `File → Open` 当独立工程打开 |
| `git sparse-checkout` / `--filter` 部分克隆 | 无 | clone 或命令行 |
| `git rebase --onto` | 无 | 命令行 |
| `git cherry-pick -n` | 无 | 命令行 |
| `git merge --no-ff` | 无开关（可快进时一律快进） | 命令行 |
| 别名 `alias.*` | **完全无效**（IDE 绕过 shell 直接调 git） | 只对终端里的自己有用 |
| 全局配置 / 钩子脚本 / 服务端钩子 | 无 | 命令行 + 手工编辑文件 |
| 脚本化输出（`status --porcelain`、`--format`） | 无 | CI 里用命令行 |

一句话总结：**IDEA 覆盖了约 90% 的日常操作，剩下 10% 恰好是「出事时最需要的那部分」**。所以 [10 篇](/ops/git/faq) 的速查表和 [06 篇](/ops/git/undo) 的 reflog 剧本，建议还是保持能在命令行里默写出来的熟练度。

## 本篇小结

- **IDEA 只是前端**：它调用本机 `git`，所以 `git config` 的配置、钩子、仓库状态全部共享，不需要在 IDE 里重配。
- **先确认能连上 Git**：`Settings → Version Control → Git → Path to Git executable`，Test 通过再用。
- **五个入口**：右下角分支控件、提交窗（`Ctrl+K`）、Git 工具窗（`Alt+9`）、`Ctrl+T` / `Ctrl+Shift+K`、各处右键菜单。
- **勾选即暂存**：提交窗勾选文件 = `git add`，差异视图里逐块勾选 = `git add -p`，取消勾选 = `restore --staged`。
- **Log 右键是藏宝箱**：Cherry-Pick、Revert、Reset、New Tag、Edit Commit Message 全在那里。
- **Git Console 是最强排错入口**：IDE 执行的每条命令都会打印出来，比 `GIT_TRACE` 更省事。
- **Annotate 替代 blame**：行号栏右键即可，选中一段代码则是 `blame -L` 的效果。
- **冲突用三栏工具**：Accept Left / Right 等于 `--ours` / `--theirs`，但 **rebase 时方向会反过来**，看栏头文字判断。
- **撤销三口诀**：没提交的 Rollback、没推的 Reset、推了的 Revert；任何带 `Hard` 的选项先建备份分支。
- **强推只选 with Lease**：它在 Push 按钮的下拉里，IDE 不提供无 lease 的便捷入口，这是好事。
- **明确边界**：`bisect`、`reflog`、`filter-repo`、`lfs`、`subtree`、`worktree` 以及所有别名与脚本化场景，老老实实回命令行。

## 参考链接

- [IntelliJ IDEA 官方文档：版本控制集成](https://www.jetbrains.com/help/idea/version-control-integration.html)（站点右上角可切中文）
- [IntelliJ IDEA 官方文档：提交与推送更改](https://www.jetbrains.com/help/idea/commit-and-push-changes.html)
- [IntelliJ IDEA 官方文档：把项目交给 Git 管理](https://www.jetbrains.com/help/idea/set-up-a-git-repository.html)
- [IntelliJ IDEA 官方文档：与远程仓库同步](https://www.jetbrains.com/help/idea/sync-with-a-remote-repository.html)
- [IntelliJ IDEA 官方文档：解决冲突](https://www.jetbrains.com/help/idea/resolving-conflicts.html)
- [IntelliJ IDEA 官方文档：配置快捷键映射](https://www.jetbrains.com/help/idea/configuring-keyboard-and-mouse-shortcuts.html)
- [Git 官方文档](https://git-scm.com/docs)
- [Pro Git 中文版](https://git-scm.com/book/zh/v2)

下一篇 → 回到 [01 Git 入门与安装配置](/ops/git/overview)（Git 篇到此结束）
