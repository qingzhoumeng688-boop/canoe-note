# 04 分支、合并与冲突

> 本篇导读：在 02 篇我们已经知道，一个分支（ref）"只是一个存着 40 位 SHA 的小文件"，所以创建和切换分支近乎零成本。本篇把它落到日常操作上：怎么看、怎么建、怎么切、怎么删；重点拆解 `git merge` 的快进与三路合并、以及"合并提交"为何有两个父；接着用最大篇幅讲清"冲突是怎么产生的、标记怎么读、四步法怎么解、CRLF 为什么会制造满屏冲突"；再用一节讲 `git stash` 这个"切分支前的后悔药"，包括误删 stash 怎么救；最后给出分支管理实践，并指向 09 篇的协作工作流。读完你能在团队里从容开分支、合并、解冲突。

## 一、分支的本质：一个可移动指针

结合 02 篇的引用概念：分支文件（如 `.git/refs/heads/main`）里**只存了它所指向的那次提交的 SHA-1**。所谓"在 main 上"，就是 `HEAD` 这个符号引用指向 `refs/heads/main`（见 02 篇 `HEAD` 一节）。

正因为分支只是"一个 41 字节（40 位SHA + 换行）的文件"，所以：

- **创建分支 = 复制一个 SHA 到新文件**，几乎零成本；
- **切换分支 = 把 `HEAD` 改指到另一个 ref**，几乎零成本；
- **提交前进 = 更新该 ref 文件里的 SHA**，也只改一行。

这跟 SVN 要"拷贝整份目录"形成天壤之别，也是 Git 鼓励"每个小功能都开一个分支"的根本原因。

```bash
# 看 HEAD 当前指向哪个分支
git symbolic-ref HEAD
# refs/heads/main

# 直接看 main 分支文件里存的内容（就是一个 SHA）
cat .git/refs/heads/main
# 9fceb02d0ae598e95dc970b74767f19372d61af8
```

## 二、查看、创建与切换

### 2.1 查看分支

| 命令 | 作用 |
| --- | --- |
| `git branch` | 列出本地分支，当前分支前带 `*` |
| `git branch -a` | 列出本地 + 远程跟踪分支 |
| `git branch -r` | 只列远程跟踪分支（如 `origin/main`） |
| `git branch -vv` | 列出本地分支，并显示**跟踪关系与领先/落后** |

```bash
git branch -vv
#   dev        a1b2c3d [origin/dev: ahead 2, behind 1] 登录功能
# * main       e4f5a6b [origin/main]                    主干
```

`ahead 2` 表示本地比远程 `origin/dev` **多 2 个提交**；`behind 1` 表示远程比本地**多 1 个提交**（别人推了东西，你该 `pull` 了）。这是判断是否要同步的最直观信号。

### 2.2 创建与切换

```bash
git branch <new-branch>          # 仅创建分支，仍留在当前分支
git switch -c <new-branch>        # 创建并立即切换过去（推荐，语义清晰）
git checkout -b <new-branch>      # 老写法，等价于上面（02 篇之前常用）

git switch main                   # 切换到已有分支
git switch -                       # 切回"上一次所在的分支"（像 cd -）
git checkout <new-branch>          # 老写法切换
```

`<new-branch>` 是占位符，实际写成 `feature/login`、`fix/crash` 之类。新建分支默认从**当前 HEAD** 派生，所以先 `switch` 到正确的基线再建。

### 2.3 重命名与删除

```bash
git branch -m <old-branch> <new-branch>   # 把本地分支改名
git branch -m <new-branch>                # 省略旧名时，改当前分支

git branch -d <branch>     # 删除已**完全合并**进当前分支的分支（安全）
git branch -D <branch>     # 强制删除，即使未合并（⚠️ 可能丢工作，慎用）
```

`-d` 与 `-D` 的区别：`git branch -d` 会先检查该分支的提交是否都已并入上游（或当前分支），未合并就拒绝删除，给你兜底；`git branch -D` 不检查直接删，那些"还没合并的提交"会变成孤儿，只能靠 `reflog`/`fsck` 碰运气找回。**日常清理用 `-d`，确认要丢弃才用 `-D`**。

### 2.4 设置上游跟踪分支

`git branch -vv` 中括号里那个 `origin/main` 就是"上游（upstream）"，它决定了 `git pull` / `git push` 默认跟谁同步。新建的本地分支默认**没有上游**，首次 `push` 时 Git 会提示你设置：

```bash
git push -u origin feature/login     # -u = --set-upstream，把 origin/feature/login 设为上游
# 之后在该分支上 git pull / git push 都无需再写远程名

# 或事后补设上游
git branch --set-upstream-to=origin/main
```

设好上游后，`git status` 会提示 `Your branch is ahead of 'origin/main' by 2 commits`，`git branch -vv` 也会显示领先/落后数——这正是 2.1 里 `ahead/behind` 数字的数据来源。远程协作篇（05/09）会进一步讲 `push`/`pull` 与跟踪的细节。

> 💡 **在 IDEA 里**：分支操作几乎都在**状态栏右下角的分支控件**里（也可从 `Git → Branches` 打开）——
> - 创建 / 切换：**New Branch**、**Checkout**；要从某个提交或标签起分支，在 Log 里右键 → **New Branch from Here**。
> - 从别的分支新建并立即接上：**Checkout and Rebase onto …**，一步完成「建分支 + rebase」。
> - 看差异：**Compare with Current** / **Show Diff with Working Tree**。
> - 重命名、删除：右键分支 → **Rename** / **Delete**，Local 与 Remote 分组分开。
> - **Smart Checkout**：切换分支时若工作区有未提交改动，IDE 会**先自动 stash、切完再自动恢复** —— 所以多数情况下不用手动 `git stash`；万一自动恢复出冲突，IDE 会提示，处理方式与普通冲突一致。

## 三、合并 git merge（核心）

合并的目标：把另一个分支（如 `feature`）的改动汇入当前分支（如 `main`）。当前分支是谁，合并结果就落在谁身上。

### 3.1 快进合并 vs 强制合并提交

**情形 A：快进（fast-forward）**。当 `main` 自 `feature` 分叉以来没有任何新提交（即 `feature` 是 `main` 的直系后代），Git 只是把 `main` 指针直接移到 `feature` 顶端，**不产生新提交**：

```text
合并前：
  main ---E
            \
            A---B---C  feature (HEAD)

执行 git merge feature 后（快进）：
  main, feature 都在 C
  E---A---B---C
  （没有新提交，main 指针只是"快进"到了 C）
```

**情形 B：`--no-ff` 强制生成合并提交**。加 `--no-ff` 后，即使能快进，Git 也**特意创建一个合并提交 M**，让"这次合并"在历史里留痕：

```text
执行 git merge --no-ff feature 后：
  main ---E-----------M  (新合并提交 M)
            \         /
            A---B---C  feature

  M 有两个父提交：第一父 E（main 原来位置），第二父 C（feature 顶端）
```

| 对比 | 快进（默认） | `--no-ff` 强制合并提交 |
| --- | --- | --- |
| 是否产生新提交 | 否，`main` 指针直接移到 `feature` | 是，生成一个合并提交 |
| 历史形态 | 一条直链，分不清哪次合并过 | 有明确的"合并点"，分支结构可见 |
| 适用 | 个人小步、不想留合并噪音 | 团队回顾"哪个功能何时并入主干" |

### 3.2 三路合并与合并提交

当 `main` 与 `feature` **各自都有新提交**（真正的分叉）时，Git 做 **three-way merge（三路合并）**：以"两者的最近共同祖先"为基准，比较三方差异，自动合并不冲突的部分，生成一个**合并提交**。

- 合并提交的特殊之处：它有**两个父提交**——第一父是当前分支（`main`）原位置，第二父是被合并分支（`feature`）顶端。这正好对应 02 篇 `HEAD^2` 的语义。
- 若三方中某处两边改了**不同内容**，Git 无法自动决定，就**产生冲突**（见第四节）。

### 3.3 其它合并开关

| 命令 | 作用 |
| --- | --- |
| `git merge --squash <branch>` | 把对方分支的所有提交**压缩成工作区改动**，需你手动 `commit`；历史扁平、干净，但丢失对方提交粒度 |
| `git merge --no-commit --no-ff <branch>` | 做完合并但不自动提交，让你有机会先检查/改再提交 |
| `git merge --abort` | 合并进行中（尤其冲突后）想**放弃**，回到合并前状态 |
| `git merge -m "..." <branch>` | 自定义合并提交的说明（默认会带 "Merge branch 'xxx'"） |

::: tip 预演而非臆造
没有"预演合并"这种神命令，但 `git merge --no-commit --no-ff` 可让你在提交前停下来检查合并结果；一旦不满意，用 `git merge --abort` 干净退出。不要听信"先 merge 看看、不行再 reset 瞎搞"的做法。
:::

> 💡 **在 IDEA 里**：在分支控件里选中目标分支 → **Merge into Current** 即触发 `git merge`。
> - **快进 vs 强制合并提交**：当目标分支是当前分支的直接后继时，IDEA 会**快进**（与命令行默认一致）；想在可快进时也留下合并提交，IDEA 没有对应开关，回命令行加 `--no-ff`。
> - 合并前想先探探路：**Compare with Current** 先看差异，或命令行 `git merge --no-commit --no-ff` 试一把。

## 四、冲突的产生与解决（重点）

### 4.1 冲突是怎么产生的

Git 能自动合并的前提是：**两边改的不是同一处**。具体判定是"行级 hunk"——

- 你在文件第 10~15 行改了，对方在 20~25 行改了 → 自动合并，无事发生；
- 你和对方**都改了同一文件的同一区域（相邻/重叠 hunk）**，Git 无法判断保留哪边 → **产生冲突**，把决定权交给你。

冲突只会发生在"合并、变基、cherry-pick、pull"这些需要把两边改动捏到一起的操作里。

### 4.2 读懂冲突标记

冲突时，Git 在被改文件里写入标记：

```text
<<<<<<< HEAD
这是当前分支（main）里这一段的样子
=======
这是被合并分支（feature）里同一段的样子
>>>>>>> feature
```

| 标记 | 含义 |
| --- | --- |
| `<<<<<<< HEAD` | 冲突块开始，下面到 `=======` 是**当前分支**内容 |
| `=======` | 分隔线，上下两边内容的分界 |
| `>>>>>>> feature` | 冲突块结束，`feature` 是**被合并分支**名 |

还有更详细的 **diff3 风格**（需开启 `git config --global merge.conflictStyle diff3`），多一行共同祖先，便于判断"两边各自相对祖先改了啥"：

```text
<<<<<<< HEAD
当前分支的内容
||||||| merged common ancestor
合并共同祖先的内容
=======
被合并分支的内容
>>>>>>> feature
```

### 4.3 四步解决法（标准流程）

1. **定位**：`git status` 看哪些文件处于 `both modified` / `UU` 状态，列出所有冲突文件。
2. **手工编辑**：打开每个冲突文件，找到 `<<<<<<<` / `=======` / `>>>>>>>` 标记，**删掉标记**，保留你认为正确的内容（可以两边各取一部分）。
3. **标记已解决**：`git add <file>`。这一操作等于告诉 Git"这个文件的冲突我已经处理完了"。
4. **完成合并**：`git commit`。Git 会预填一条 "Merge branch 'feature' into main" 的提交信息，生成合并提交，合并结束。

```bash
git merge feature
# CONFLICT (content): Merge conflict in src/app.js
# Automatic merge failed; fix conflicts and then commit the result.

git status
# both modified:   src/app.js     ← 还有冲突没解决

# 编辑 src/app.js，删掉 <<<<<<< ======= >>>>>>> 标记，保留正确内容
git add src/app.js                  # 标记这一个已解决
git commit                          # 完成合并，生成合并提交
```

### 4.4 放弃与辅助工具

| 命令 | 作用 |
| --- | --- |
| `git merge --abort` | 合并过程中想反悔，放弃本次合并，回到合并前状态 |
| `git mergetool` | 调起图形化三向合并工具（如 `vimdiff`、`meld`、`Beyond Compare`），按区块点选 |
| `git checkout --ours <file>` | 冲突时整文件采用**当前分支**版本（注意：是整文件覆盖，不是只解冲突块） |
| `git checkout --theirs <file>` | 冲突时整文件采用**被合并分支**版本 |
| `git checkout -m <file>` | 重新把该文件恢复到"冲突未解决"的标记状态（撤销上面 --ours/--theirs 的整文件选择） |

::: danger 整文件选边要小心
`git checkout --ours/--theirs <file>` 是**用某一边的整个文件覆盖**，不是"智能只解决冲突块"。若你只是想保留某一边、且整文件确实该用那一边，它很方便；但若你只想用一边的"那几行"、文件其它部分还有别的改动，它会把那些改动也一并吞掉。多数情况请**手工编辑**而非整文件选边。
:::

### 4.5 CRLF 造成的"整个文件都冲突"怎么避免

一个典型诡异现象：Windows 与 Linux 协作者改了同一个文件，合并时**整个文件每一行都报冲突**。原因几乎都是换行符：一方用 `CRLF`、另一方用 `LF`，Git 认为"每一行都变了"，于是逐行冲突。

根因与解法：

- 统一团队的换行约定，配对 `core.autocrlf`（Windows=`true`，Linux/macOS=`input`）；
- 用 **`.gitattributes`** 强制归一：`* text=auto`、`*.sh text eol=lf`、`*.py text eol=lf`，让所有人在提交时都转成 `LF`；
- 历史文件若是混用的，先 `git add --renormalize .`（或删掉重加）做一次换行归一化提交，之后再合并就清净了。

### 4.6 一个完整的冲突解决示例

光看标记容易懵，跑一遍最直观。假设 `main` 和 `feature` 都改了 `greeting.txt` 的同一行。

合并前两个分支的文件内容：

```text
# main 上的 greeting.txt
hello world

# feature 上的 greeting.txt
hello git
```

在 `main` 上执行 `git merge feature`，Git 无法抉择，把文件改写成带标记的样子：

```text
<<<<<<< HEAD
hello world
=======
hello git
>>>>>>> feature
```

现在你打开文件，手工决定保留什么（比如合并成 `hello git world`），并**删掉三行标记**：

```text
hello git world
```

最后暂存、提交，完成合并：

```bash
git add greeting.txt
git commit
# [main 7c7b3a8] Merge branch 'feature' into main

git log --graph --oneline -n 3
# *   7c7b3a8 (HEAD -> main) Merge branch 'feature' into main
# |\
# | * 9fceb02 在 feature 上改了问候语
# * | 1a410ef 在 main 上改了问候语
```

注意合并提交 `7c7b3a8` 在 `--graph` 里呈现为"有两个父"的节点，这正是 4.2 节说的"合并提交有两个父提交"。

> 💡 **在 IDEA 里**：冲突会以**三栏合并工具**呈现，比手工删标记直观得多 —— 左栏 **Local Changes**（你当前分支）、中栏 **Result**（最终结果）、右栏是**对方分支的改动**。
> - 每个冲突块左右各有一个 `»` / `«` 箭头，点一下把该侧内容采纳进 Result；**Accept Left** / **Accept Right** 是整块采纳，等价于 `git checkout --ours` / `--theirs`。
> - 改完点 **Apply**，IDE 会自动完成「标记已解决」这一步（相当于 `git add`）。
> - 单个文件想整体选一边：**Resolve using Mine** / **Resolve using Theirs**；只是暂时跳过：**Mark as Resolved**。
> - 想整体放弃：合并工具工具栏的 **Abort Merge**，等价于 `git merge --abort`。

## 五、合并后想撤销

合并不是"泼出去的水"，但撤销方式取决于**有没有推送到远程**。

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 合并后**未推送** | `git reset --hard ORIG_HEAD` | `ORIG_HEAD` 在 merge 前记录了旧 HEAD，一条命令回到合并前（见 02 篇） |
| 合并已**推送远程** | `git revert -m 1 <merge_commit>` | 生成一个"反向提交"抵消合并效果，**不改写历史**，协作安全 |
| 合并中想立刻停 | `git merge --abort` | 还没 commit 时就放弃，回到合并前 |

为什么已推送不能用 `reset --hard`？因为 `reset` 会**改写历史**（丢掉合并提交），远程和同事的本地历史还留着旧提交，你强推后大家历史对不上，协作崩坏。已推送必须用 `revert`——它"加"一个提交而非"删"历史，所有人都只需正常 `pull`。

::: warning "合并丢代码"其实是冲突时误删
很多人喊"合并把我的代码弄丢了"，真相往往是：合并冲突时，他在编辑器里**顺手把对方那段整块删了**（或 `--ours` 整文件覆盖），合并提交里自然就没了。解决冲突务必**逐块核对**，保留双方该留的逻辑；合并前 `git diff main...feature` 先看清对方到底改了什么，能大幅降低误删。
:::

::: tip 不要在一个分支上长期不合并
`feature` 长期不并入 `main`，分叉会越来越大：每次 `main` 有进展，你的 `feature` 与它的差异就更多，最终合并时冲突成爆炸式。实践上应：**小步开发、频繁把 `main` 合进 `feature`（或 rebase 到 `main`）**，让冲突在早期小批量暴露、好解决。
:::

> 💡 **在 IDEA 里**：撤销一次合并有三个图形入口，理解上等同于 `reset` 与 `revert` 的区别 ——
> - **还没推送**：Log 里右键**合并提交之前那个提交** → **Reset Current Branch to Here** → 选 `Hard`（HEAD 回退，丢弃合并结果）。
> - **已经推送**：Log 里右键那次**合并提交** → **Revert Commit**；IDEA 会提示这是合并提交并让你选择保留哪个父提交（等于 `git revert -m 1`），然后自动生成反向提交。**公共分支上永远选这个**。
> - 只是想丢掉本地还没提交的合并痕迹：合并工具里的 **Abort Merge**。

## 六、git stash：切分支前先收好手头

### 6.1 为什么需要 stash

你要切到另一个分支修紧急 bug，但当前分支手头改动**还没写完、不能 `commit` 成半个功能**。直接 `switch` 会被拦（Git 不允许带未提交改动切到会覆盖它们的分支），或改动被带过去污染别的分支。`git stash` 就是"把当前工作区+暂存区的改动临时压栈封存，让工作区变干净"，切回来再弹出来。

```bash
# 手头有改动，想先切去修 bug
git status -s
#  M src/app.js      ← 改到一半，不想提交

git stash                # 封存改动，工作区回到 HEAD 干净状态
# Saved working directory and index state WIP on main

git switch -c hotfix/bug
# ... 修完提交 ...
git switch main
git stash pop           # 把改动弹回来，继续写
```

### 6.2 stash 的常用操作

| 命令 | 作用 |
| --- | --- |
| `git stash` / `git stash push` | 封存工作区+暂存区改动（默认不收未跟踪文件） |
| `git stash push -u` | 连**未跟踪文件**一起存（`-u` = `--include-untracked`） |
| `git stash push -a` | 连**忽略文件**也一起存（`-a` = `--all`） |
| `git stash list` | 列出栈里所有 stash，形如 `stash@{0}: WIP on main: 9fceb02 ...` |
| `git stash show -p stash@{0}` | 查看某条 stash 的具体 diff |
| `git stash apply stash@{0}` | 恢复某条 stash，**但保留栈中记录**（可重复 apply） |
| `git stash pop` | 恢复**栈顶** stash 并删除该记录（= apply + drop） |
| `git stash drop stash@{0}` | 删除某条 stash（不恢复） |
| `git stash clear` | 清空整个 stash 栈 |

**`apply` 与 `pop` 的区别**：`apply` 恢复后 stash 记录还在栈里（你可以反复 apply 到多个分支）；`pop` 恢复后顺手把这条记录删了。一般确认没问题就用 `pop`，想留个底就用 `apply`。

### 6.3 从 stash 新建分支（处理冲突最稳）

如果直接 `pop` 到当前分支又冲突了，最稳的办法是 `git stash branch <name>`：**基于"当时 stash 所基于的那次提交"新建一个分支，并把 stash 内容恢复上去**。这样 stash 的上下文最干净，冲突概率最低。

```bash
git stash branch fix-login
# Switched to a new branch 'fix-login'
# On branch fix-login
# Changes not staged ...（stash 内容已恢复）
```

### 6.4 stash 的局限与误删补救

- **stash 是本地栈，不会随 `push` 同步到远程**。换机器、推给别人都带不走；需要共享就老老实实 `commit`（或 `git format-patch`）。
- **误 `drop` / `clear` 后怎么救**：stash 本质是一次提交，被 drop 只是"引用没了"，对象还在仓库里一段时间（未 GC）。用以下方式找回来：

```bash
git fsck --unreachable        # 列出所有不可达（悬空）对象，从中找你的 stash 提交
git fsck --lost-found         # 把悬空提交/对象写到 .git/lost-found 便于查看

git log -g stash              # 用 reflog 看 stash 的变动历史，找到被删的那条 SHA
git stash apply <找到的SHA>   # 再 apply 回来（SHA 形如 stash@{0} 对应的 commit）
```

越早补救越容易——触发 `git gc` 后悬空对象可能被清掉。所以**重要改动别长期压在 stash 里**，该提交就提交。

> 💡 **在 IDEA 里**：**Git 工具窗（`Alt+9`）的 Stashes 分组**就是 stash 的管理界面（`Git → Stash Changes…` 也能开）——
> - **新建**：**Stash Changes…**，可以顺手写一句说明（等于 `git stash push -m`）；对话框里勾上 **Include untracked files** 等于 `-u`。
> - **恢复**：**Unstash Changes…**，对话框里勾 **Pop stash** 是恢复并从栈里删掉（等于 `git stash pop`），不勾则只应用（等于 `apply`）；也能从某个 stash 直接新建分支。
> - **删除**：右键 → **Drop** / **Clear**。
> - ⚠️ **别把 IDEA 的 Shelf 和 Git 的 stash 搞混**：**Shelf** 是 IDE 自己的功能，数据存在 `.idea/shelf`，**不进入 Git、不跨机器、别人看不到**；要跟 Git 走就用 **Stash**。

## 七、分支管理实践预告

### 7.1 命名与生命周期

| 实践 | 建议 |
| --- | --- |
| **feature 分支命名** | `feature/login`、`fix/crash`、`hotfix/oom`，前缀表意图，便于 `git branch` 一眼归类 |
| **短生命周期** | 一个分支只做一件事，合并进 `main` 后尽快删，避免分支堆积、长期分叉 |
| **及时删已合并分支** | 合并完就清，保持本地分支列表清爽 |

```bash
git branch --merged             # 列出"已完全合并进当前分支"的所有本地分支
git branch -d $(git branch --merged | grep -v '\*')   # 批量删（排除当前分支）

git remote prune origin         # 清理本地过期的远程跟踪分支（如 origin/old-feature）
git fetch -p                    # 等价简写：fetch 时顺手 prune
```

### 7.2 指向 09 篇的工作流

本篇只讲"单机怎么开/合/解冲突"。团队级协作规范——Git Flow、GitHub Flow、Trunk-Based Development，以及 `rebase` 怎么代替 merge、PR/MR 怎么评审——放在 **09 远程与协作工作流** 一篇系统讲。那里会解释：为什么主干要受保护、feature 分支该多久合一次、`rebase` 与 `merge` 分别适合什么场景。

> 💡 **在 IDEA 里**：清理分支在分支控件里做 —— **Delete** 删本地已合并分支，Remote 分组里删远程分支；想先确认哪些已经合并，看 Log 图里分支之间是否还有连线即可。
> 唯一的坑：`git fetch --prune` 的「同步远程已删分支」不会自动发生，需要手动执行 **Fetch All Remotes**，或回命令行 `git remote prune origin`。

## 本篇小结

- 分支只是一个**指向某次提交的可移动指针**（一个 41 字节文件），所以创建/切换近乎零成本；这与 02 篇的 ref/HEAD 概念一脉相承。
- 查看用 `git branch` / `-a` / `-r` / `-vv`（领先 `ahead`、落后 `behind` 一目了然）；创建切换用 `git switch -c <new-branch>`，老写法是 `git checkout -b`。
- `git switch -` 回到上一个分支；`git branch -m` 改名；`-d` 安全删（仅已合并）、`-D` 强删（可能丢工作）。
- `git merge` 默认**快进**（`main` 指针直接移动，无新提交）；`--no-ff` 强制生成有**两个父提交**的合并提交，历史更可读。
- 真正的分叉合并是 **three-way merge**（以最近共同祖先为基）；`--squash` 压成扁平改动需手动 commit；`git merge --abort` 可放弃。
- **冲突产生条件**：同一文件同一区域（hunk）被两边改，Git 无法自动抉择；标记 `<<<<<<<`/`=======`/`>>>>>>>` 与 diff3 的 `|||||||` 要会读。
- **四步解决法**：`git status` 定位 → 手工编辑删标记 → `git add` 标记已解决 → `git commit` 完成合并。
- `git checkout --ours/--theirs <file>` 是**整文件**选边、有覆盖风险；应急可用 `git mergetool` 图形化解。
- **CRLF 混用**会让整个文件逐行冲突，靠 `core.autocrlf` + `.gitattributes`（`* text=auto`、`*.sh text eol=lf`）统一换行根治。
- 撤销合并：未推送用 `git reset --hard ORIG_HEAD`；**已推送必须用 `git revert -m 1`**（不改写历史）；"合并丢代码"多是冲突时误删。
- 不要长期不合并 `feature`，应小步频繁把 `main` 合进来，让冲突早暴露、好解决。
- `git stash` 是切分支前的"后悔药"：`push -u` 含未跟踪、`-a` 含忽略；`apply`（留记录）vs `pop`（删记录）；`git stash branch <name>` 从 stash 建分支最稳。
- stash 是**本地栈、不同步远程**；误 `drop` 后用 `git fsck --unreachable` 或 `git log -g stash` 找悬空提交可救。
- 分支管理：`feature/` 前缀命名、短生命周期、`git branch --merged` + `-d` 批量清理、`git remote prune origin` 清过期远程跟踪；团队工作流见 09 篇。

## 参考链接

- [Pro Git 第 3 章：Git 分支 - 分支简介](https://git-scm.com/book/zh/v2/Git-%E5%88%86%E6%94%AF-%E5%88%86%E6%94%AF%E7%AE%80%E4%BB%8B)
- [Pro Git 第 3 章：Git 分支 - 分支的新建与合并](https://git-scm.com/book/zh/v2/Git-%E5%88%86%E6%94%AF-%E5%88%86%E6%94%AF%E7%9A%84%E6%96%B0%E5%BB%BA%E4%B8%8E%E5%90%88%E5%B9%B6)
- [git-branch 官方手册](https://git-scm.com/docs/git-branch)
- [git-merge 官方手册](https://git-scm.com/docs/git-merge)
- [git-stash 官方手册](https://git-scm.com/docs/git-stash)
- [git-merge 冲突解决（GitHub Docs）](https://docs.github.com/zh/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts)
- [gitattributes 与合并策略（含冲突风格）](https://git-scm.com/docs/gitattributes)

下一篇 → [05 远程仓库与团队协作](/ops/git/remote)
