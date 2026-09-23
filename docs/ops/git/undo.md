# 06 撤销、回退与“救火”

> 本篇导读：Git 最让人又爱又怕的就是"翻盘能力"——几乎任何错误都能救，但用错命令也能把工作毁得干干净净。本篇开篇先立一个心智模型：撤销前先问清"改的是哪个区域、有没有推送、想改历史还是留痕"；接着按区域逐个拆解 `restore`/`clean`/`reset`/`amend` 的用法与红线；重点讲透 `reset` 三兄弟的对照、`revert` 的安全回退、`cherry-pick` 的拣选；高潮放在 `reflog`——三个经典"误删/误 reset/ rebase 搞砸"救援剧本，让你再也不怕手滑；最后用一张"我想……"速查大表收尾。读完你会明白：只要对象还在 `.git` 里、reflog 没过期，几乎没有删不回的东西。

## 一、先问三件事：撤销前的心智模型

动手撤销之前，先冷静问自己三个问题，决定了你该用哪一类命令：

1. **改的是哪个区域？** 工作区（未 `add`）/ 暂存区（已 `add` 未 `commit`）/ 本地历史（已 `commit` 未 `push`）/ 远程历史（已 `push`）。区域不同，命令完全不同。
2. **这一步有没有推送出去？** 没推送 → 本地随便改历史都安全；已推送 → **别改写历史**，用"留痕"的 `revert`，否则会坑队友。
3. **想改历史，还是留痕？** 改历史（`reset`/`amend`/`rebase`）让提交"像从没发生过"；留痕（`revert`）生成一个反向提交，历史清清楚楚记着"这里撤销过"。

把这三点想清楚，下面这张"目标 → 命令"导航图就能对号入座（本页的地图，细节在后面各节）：

| 我想…… | 该用命令 | 影响区域 |
| --- | --- | --- |
| 丢弃工作区某文件改动（还没 add） | `git restore <file>` 或 `git checkout -- <file>` | 工作区 |
| 丢弃工作区所有改动 | `git restore .` | 工作区 |
| 删掉未跟踪的文件/目录 | `git clean -fd`（**先 `-n` 预演**） | 工作区（未跟踪） |
| 撤销某文件的暂存（add 反悔） | `git restore --staged <file>` 或 `git reset HEAD <file>` | 暂存区 |
| 改最后一次提交信息 | `git commit --amend -m "新信息"` | 本地历史 |
| 回退一次提交但保留改动 | `git reset --soft HEAD~1` | 本地历史 |
| 回退两次提交并彻底丢弃 | `git reset --hard HEAD~2` | 本地历史（危险） |
| 撤销已推送的提交（留痕） | `git revert <sha>` | 本地+远程历史 |
| 把某次提交搬到当前分支 | `git cherry-pick <sha>` | 本地历史 |
| 找回刚删的分支 | `git branch <name> <sha>`（SHA 从 reflog 找） | 救火 |
| 找回误 reset 的提交 | `git reflog` → `git reset --hard <sha>` | 救火 |
| 放弃本次合并 | `git merge --abort` 或 `git reset --hard ORIG_HEAD` | 救火 |
| 放弃本次 rebase | `git rebase --abort` | 救火 |
| 丢掉所有未提交改动 | `git reset --hard` + `git clean -fd` | 工作区+暂存区 |

> 💡 **在 IDEA 里**：这套「先问三件事」的心智模型在图形界面里**更该记牢** —— 因为 Rollback、Reset、Revert 都只是菜单里的一个词，点错了没有第二次确认。记两句话就够：
> - **没提交的用 Rollback，提交了没推的用 Reset，推出去的用 Revert。**
> - IDE 界面里任何带 `Hard` 字样的选项，点之前先按本节后面的兜底办法（建备份分支）做一次。

## 二、撤销工作区改动

工作区是你直接编辑的文件夹，改动**还没 `add`** 时最好救——Git 根本还没记录它们。

### 2.1 restore 与老写法 checkout

```bash
# 新版推荐：丢弃某文件的工作区改动（回到最近一次 commit 的样子）
git restore src/app.js

# 老写法（等价），注意 `--` 不能省，否则会被当成切换分支
git checkout -- src/app.js

# 丢弃当前目录下所有工作区改动
git restore .
```

`git restore <file>` 默认就是"从 `HEAD` 把文件捞回工作区"，即**丢弃该文件自上次提交以来的所有编辑**。如果只是想"取消刚才误改"，这是最常用的一招。

::: warning `checkout --` 的 `--` 不能省
`git checkout src/app.js` 和 `git checkout -- src/app.js` 意思完全不同：前者可能切到名为 `src/app.js` 的分支，后者才是"丢弃改动"。新写法 `git restore` 没有这个歧义，更推荐。
:::

### 2.2 git clean：删未跟踪文件（危险动作先预演）

`git clean` 删的是**未跟踪（Untracked）** 的文件和目录——这些是 `git` 还没管的"游离"文件，`restore` 管不到它们。

| 参数 | 作用 |
| --- | --- |
| `git clean -n` | **预演（dry-run）**：只列出"会删哪些"，不真删，最安全的第一步 |
| `git clean -f` | 真删未跟踪文件（不加 `-f` 默认不执行删除，有保护） |
| `git clean -d` | 连**未跟踪的目录**一起删 |
| `git clean -x` | 连被 `.gitignore` 忽略的文件也删（如 `node_modules/`、构建产物） |
| `git clean -X` | 只删被 `.gitignore` 忽略的文件（保留普通未跟踪文件） |
| `git clean -fd` | 删未跟踪文件 + 目录（常用组合，但很猛） |

```bash
git status -s
# ?? temp.log
# ?? build/

git clean -n -d          # 预演：我会删掉什么
# Would remove temp.log
# Would remove build/

git clean -fd            # 确认无误后真删
# Removing temp.log
# Removing build/
```

::: danger `-fd` 会真删未跟踪文件，先 `-n` 看清楚
`git clean -fd` 删掉的文件**不在 Git 管理内，没有任何恢复手段**（reflog 也救不了，因为它们从没进过对象库）。执行前务必先 `git clean -n -d` 看清单。再加 `-x` 会连 `node_modules` 这种大目录一起干掉，更要谨慎。
:::

> 💡 **在 IDEA 里**：丢弃工作区改动 = **Rollback** —— 在提交窗（`Ctrl+K`）的文件上右键 → **Rollback**；新版 IDE 的 Rollback 对话框里还能勾选一并删除新建的未跟踪文件（相当于 `git clean`）。
> ⚠️ **`Ctrl+Z` 不是 Git 撤销**：它只是编辑器的撤销，关掉文件或重启 IDE 后就没了，别拿它当 `git restore`。真正的「回到最近一次提交的样子」永远是 Rollback。

## 三、撤销暂存：把文件从"待提交"退回工作区

你 `git add` 了某个文件，又反悔不想这次提交它——这时改动**已经进暂存区**，要"退出来"。

```bash
git add config.yaml
git status -s
# A  config.yaml      ← 已暂存

# 新版：把 config.yaml 从暂存区撤回，改动仍保留在工作区（未暂存）
git restore --staged config.yaml
git status -s
#  M config.yaml      ← 回到工作区已修改、未暂存

# 老写法（等价）
git reset HEAD config.yaml
```

关键语义：**撤销暂存只挪动文件在"暂存区 ↔ 工作区"的位置，文件内容一个字都不会变**。它和"丢弃改动"完全是两回事——想丢弃内容要用第二节的 `git restore <file>`。两者常配合：

```bash
git restore --staged .     # 把所有暂存撤出（保留改动）
git restore .              # 再把所有工作区改动也丢弃（彻底回到 HEAD）
```

> 💡 **在 IDEA 里**：撤销暂存就是**取消勾选** —— 提交窗里把文件前面的复选框点掉，改动退回「未暂存」，磁盘上的内容一个字不动，随便点。
> 文件多的时候，可以用提交窗工具栏里按目录分组的开关先收拢，再整组取消勾选，比一个个点省事。

## 四、修改最后一次提交：--amend

`--amend` 用"一个新的提交"替换掉上一次提交，常用于"提交信息写错了"或"漏了文件"。

```bash
# 改提交信息（内容不变）
git commit --amend -m "fix: 修正空指针（含边界判断）"

# 补漏文件：先 add，再合并进上次提交，信息不变
git add forgot-to-add.py
git commit --amend --no-edit

# 改作者（比如提交时用了错邮箱）
git commit --amend --author="张三 <zhangsan@example.com>"
git commit --amend --reset-author      # 用当前 user.name/user.email 覆盖作者
```

::: danger 红线：已推送的提交不要 amend
`--amend` 本质是**替换提交**（旧提交变成孤儿），SHA 会变。如果上次提交已经 `push`、同事可能基于它工作，你 amend 后再 push 会被拒（non-fast-forward），强制推送会让大家历史对不上。**已推送的提交要改，请用 `revert`**（第六节）或在确认为自己独占分支时 `--force-with-lease`。本地、未推送的提交随便 amend。
:::

> 💡 **在 IDEA 里**：**Amend** —— 提交窗工具栏上的复选框。勾上后提交框进入「修改上一次提交」模式：既能改消息（等于 `--amend -m`），也能把新勾上的文件并入上一次提交（等于「先 add 再 `--amend --no-edit`」）。
> 只想改消息不想动文件：Log 里右键那次提交 → **Edit Commit Message**。
> ⚠️ 红线照旧：**已推送过的提交不要 amend** —— IDE 不会拦你，等推送时才以 `--force` 的形式炸出来。

## 五、git reset 三兄弟（重点）

`git reset` 是"移动当前分支指针（`HEAD` 指向的 ref）到某个目标提交"，根据参数决定**暂存区和工作区怎么变**。三个模式是最容易混、也最该记牢的：

| 模式 | 移动 HEAD？ | 暂存区 | 工作区 | 一句话用途 |
| --- | --- | --- | --- | --- |
| `--soft` | 是 | **不变**（改动留在暂存区，像已 add） | 不变 | 回退提交但保留改动，方便"重新提交/拆分" |
| `--mixed`（默认） | 是 | **清空**到目标状态 | 不变（改动落回工作区未暂存） | 回退提交并取消暂存，最常用 |
| `--hard` | 是 | **清空** | **清空（直接丢弃改动）** | 彻底丢弃，回到目标提交的样子，**危险** |

```bash
git log --oneline -3
# c3 完善校验 (HEAD -> main)
# c2 新增接口
# c1 初始化

# --soft：HEAD 回到 c2，但 c3 的改动还在暂存区
git reset --soft HEAD~1
git status -s
# M  src/app.js      ← 改动仍在，且已暂存，可立即重新 commit

# --mixed（默认，可省略）：HEAD 回到 c2，改动落回工作区未暂存
git reset HEAD~1          # 等价于 git reset --mixed HEAD~1
git status -s
#  M src/app.js      ← 改动还在，但未暂存

# --hard：HEAD 回到 c2，c3 的所有改动直接消失
git reset --hard HEAD~1   # ⚠️ c3 的改动从工作区消失
```

### 5.1 目标写法：`<sha>` / HEAD~1 / HEAD^

```bash
git reset --hard 9fceb02          # 回到指定 SHA
git reset --hard HEAD~1           # 回退 1 个提交（~1 = 第一父）
git reset --hard HEAD~2           # 回退 2 个提交
git reset --hard HEAD^            # 回退 1 个（^ 与 ~1 在第一父上等价）
```

`HEAD~1` 与 `HEAD^` 区别见 02 篇：`~` 沿父链直线后退，`^` 在合并提交上选第几父（如 `HEAD^2` 是被合并分支）。日常回退用 `HEAD~N` 最直观。

### 5.2 --hard 之前一定要兜底

`--hard` 会**物理丢弃工作区与暂存的改动**，这些改动若从没 commit 过就再也找不回。好习惯：

```bash
# 兜底 1：先把改动暂存起来，搞砸了再 pop
git stash
git reset --hard HEAD~1
git stash pop          # 确认无误再恢复

# 兜底 2：先建个备份分支，留住当前状态
git branch backup-before-reset
git reset --hard HEAD~1
# 万一后悔：git reset --hard backup-before-reset
```

### 5.3 reset 只影响本地历史

`reset` 改写的是**你本地的分支指针**。如果目标提交**已经 push 到公共分支**，`reset` 后再强推会改写公共历史，坑队友（见 05 篇"推送被拒"）。**已推送的公共分支不要用 `reset`**，改用 `revert`。

> 💡 **在 IDEA 里**：`git reset` 对应 Log 里右键 → **Reset Current Branch to Here**，弹窗里的三个选项与三兄弟一一对应：
>
> | IDEA 选项 | 命令行 | 结果 |
> | --- | --- | --- |
> | **Soft** | `reset --soft` | HEAD 回退，改动留在暂存区（提交窗里仍是勾选状态） |
> | **Mixed** | `reset --mixed` | HEAD 回退，改动落回工作区、未暂存 |
> | **Hard** | `reset --hard` | **丢弃改动**，不可逆（只能靠 reflog 救） |
>
> 无脑点 `Hard` 之前，先在 Log 里右键当前提交 → **New Branch from Here** 建个备份分支，这就是本节推荐的兜底习惯。

## 六、安全回退：git revert（重点）

`revert` 的思路和 `reset` 相反：它**不删除任何历史，而是生成一个"反向提交"**，把目标提交的改动"抵消掉"。历史里清清楚楚记着"这里撤销过一次"，所以**适合已推送的公开分支**——所有人只需正常 `pull`，不会冲突。

```bash
# 撤销单个提交（生成一个新的反向提交）
git revert 9fceb02
# [main a1b2c3d] Revert "完善校验"
#  1 file changed, 10 deletions(-)

# 撤销但不立即提交，方便把多个 revert 攒成一个提交
git revert -n 9fceb02
git revert -n 1a410ef
git commit -m "revert: 回退校验与接口改动"
```

### 6.1 撤销一个区间

```bash
# 撤销从 A（不含）到 B（含）的这段提交，逐个生成反向提交
git revert A..B
```

注意 `A..B` 是"左开右闭"：A 本身不被撤销，B 会被撤销，区间是 A 之后到 B 之间的所有提交。执行时会按**从新到旧**的顺序逐个 revert，遇到冲突逐个解决。

### 6.2 撤销"合并提交"必须 -m

合并提交有两个父（第一父 = 当时所在分支，第二父 = 被合并进来的分支）。`revert` 一个合并提交时，Git 不知道"该以哪边为基准生成反向 diff"，必须指定 `-m`（parent number）：

```bash
git revert -m 1 <merge_commit>
```

**`-m 1` 的含义**：以"第一父"为基准来撤销。也就是"回到合并之前、还在主分支上的样子"，把被合并分支带进来的改动全部抵消掉。一般地：

- **`-m 1`** = 撤销"合并带来的改动"，回到合并前主分支状态（最常用）。
- **`-m 2`** = 以被合并分支为基准，等价于"让主分支看起来像那个分支"，几乎不用。

### 6.3 revert 之后再 revert（撤销"撤销"）

如果你 `revert` 了某次提交，后来又想"把那次改动加回来"，**不要去 reset**，而是对"那个 revert 提交"再 revert 一次：

```bash
git revert <revert_commit>     # 等于把之前的撤销再抵消，改动重新回来
```

这样历史始终是"加法"，链路干净、协作安全。

### 6.4 revert vs reset 对照表

| 维度 | `git reset` | `git revert` |
| --- | --- | --- |
| 是否改历史 | **是**，移动/删除提交 | **否**，新增反向提交 |
| 对他人影响 | 改写公共历史，会坑队友 | 只加提交，队友正常 pull 即可 |
| 历史形态 | 提交"像从没发生过" | 明确记着"这里撤销过" |
| 适用场景 | **未推送**的本地提交整理 | **已推送**的公开分支回退 |
| 找回难度 | 需 reflog 救（见第八节） | 天然可见，无需救 |

一句话：**没推就用 `reset` 整理，推了就用 `revert` 回退**。

> 💡 **在 IDEA 里**：**Revert Commit** —— Log 里右键要撤销的那次提交，IDE 会生成反向提交，等于 `git revert <sha>`，历史留痕、可直接推送，这是公共分支上的正确做法。
> - 碰到**合并提交**，IDE 会明确提示这是 merge commit 并让你选择保留哪个父提交（对应 `-m 1`），比纯命令行更不容易选错。
> - 想攒多个 revert 合成一笔提交：IDEA 每次 Revert 都会直接生成提交，没有 `-n` 的对应项，需要攒就回命令行。

## 七、拣选：git cherry-pick

`cherry-pick` 把**某一个（或一段）已有提交**"复制"一份应用到当前分支。经典场景：**在 `main` 发现紧急 bug，先在 `hotfix` 修好并合并，再把那个修复提交回灌到 `develop`/发布分支**。

```bash
# 把某个提交搬到当前分支（生成一个新的 SHA，内容相同）
git cherry-pick 9fceb02
# [release 7c7b3a8] fix: 紧急修复登录崩溃
```

| 参数 | 作用 |
| --- | --- |
| `git cherry-pick <sha>` | 拣选单个提交 |
| `git cherry-pick -n <sha>` | 拣选但**不自动提交**，改动放到暂存区，让你和其他改动一起提交 |
| `git cherry-pick -x <sha>` | 提交信息里**记录来源**（"cherry picked from commit ..."），便于溯源 |
| `git cherry-pick A..B` | 拣选 A（不含）到 B（含）的连续区间 |
| `git cherry-pick --continue` | 冲突解决后继续 |
| `git cherry-pick --skip` | 跳过当前这个冲突的提交 |
| `git cherry-pick --abort` | 放弃整次拣选，回到操作前 |

冲突处理与 `merge` 类似：出现冲突时手工编辑 → `git add` → `git cherry-pick --continue`（或 `--abort` 取消）。

### 7.1 cherry-pick 与 rebase 的区别

两者都能"把提交搬来搬去"，但粒度不同：

- **`cherry-pick`**：精确挑**个别**提交搬到当前分支，不改原分支、不影响其它提交。适合"只想要那一个修复"。
- **`rebase`**：把**当前分支上一段连续提交**整体"挪"到另一个基底之上（见 07 篇）。适合"整条分支重新接轨主干"。

::: tip 怎么选
只想要一两个散落的提交 → `cherry-pick`；想让整条 feature 分支基于最新 `main` 重排 → `rebase`。别用 `cherry-pick` 去搬一长串连续提交，那正是 `rebase` 的活。
:::

> 💡 **在 IDEA 里**：**Cherry-Pick** —— 先 Checkout 到目标分支，再在 Log 里选中要搬的提交右键 → **Cherry-Pick**。
> 多选提交（`Ctrl` 点选或 `Shift` 连选）后右键，IDE 会按顺序依次拣选；冲突处理和普通合并一样走三栏工具。
> 想拣选后先不提交、看看效果，命令行 `git cherry-pick -n` 更灵活 —— IDE 默认是拣选完立即提交。

## 八、reflog 救火（本页高潮）

这是 Git 最让人安心的后盾：**只要提交对象还在 `.git` 里、reflog 还没过期，几乎没有删不回的东西**。

### 8.1 reflog 是什么、保留多久

`reflog`（reference log）记录 **`HEAD` 和各个分支指针的每一次移动**——每次 `commit`、`checkout`、`reset`、`merge`、`rebase` 都会留一条。它**只存在于你本地**，不会随 `push` 出去，是纯本机的"操作黑匣子"。

- **默认保留 90 天**（对可达对象的 reflog 条目）；
- **不可达对象默认 30 天**（`gc.reflogExpireUnreachable`）——超过 30 天且没人引用的悬空对象会被 `gc` 真正清掉，所以**救火要趁早**。

```bash
git reflog
# 9fceb02 HEAD@{0}: commit: 完善校验
# 1a410ef HEAD@{1}: commit: 新增接口
# e4f5a6b HEAD@{2}: checkout: moving from dev to main
# ...

git reflog show main        # 只看 main 分支指针的移动历史
```

### 8.2 剧本一：误 reset --hard 丢了提交

```bash
# 手滑把 main 硬回退了，c3 的改动从工作区消失
git reset --hard HEAD~1
git log --oneline -1
# c2 新增接口   ← c3 不见了

# 从 reflog 找到 reset 前的那个 SHA（HEAD@{1} 就是 reset 之前）
git reflog
# 1a410ef HEAD@{0}: reset: moving to HEAD~1
# 9fceb02 HEAD@{1}: commit: 完善校验      ← 这是我们要的

git reset --hard 9fceb02    # 把 main 指回 c3，工作区恢复
```

### 8.3 剧本二：误删分支 git branch -D

```bash
# 误删了一个还没合并的分支
git branch -D feature/login
# Deleted branch feature/login (was a1b2c3d).

# 从 reflog 找到该分支顶端的 SHA（删之前它还在 HEAD 里）
git reflog
# a1b2c3d HEAD@{2}: commit: 登录功能收尾      ← 分支顶端

git branch feature/login a1b2c3d    # 用同一个 SHA 重建分支
git switch feature/login            # 满血复活
```

### 8.4 剧本三：rebase 搞砸了想回原状

```bash
git rebase main
# 冲突解决一通后，发现 rebase 搞乱了，想回到 rebase 之前

# 方式 1：rebase 中途直接放弃
git rebase --abort

# 方式 2：rebase 已完成才发现有问题，靠 reflog 找回
git reflog
# ... HEAD@{3}: rebase (finish): ...
# ... HEAD@{4}: rebase (start): checkout main     ← rebase 之前的状态
git reset --hard HEAD@{4}          # 或 reset 到对应 SHA
```

### 8.5 fsck 找"失联"提交与 ORIG_HEAD

当 reflog 也找不到（比如对象已不可达且 reflog 过期，或 `gc` 清过），用 `fsck` 扫描仓库里所有"悬空/不可达"对象：

```bash
git fsck --unreachable             # 列出所有不可达对象（含悬空提交）
git fsck --lost-found              # 把悬空 commit/blob 写到 .git/lost-found 便于查看
```

对每个找到的悬空 commit，用 `git show <sha>` 确认内容，再用 `git branch <name> <sha>` 接住。

**`ORIG_HEAD`** 是 Git 在做 `merge`/`rebase`/`reset` **之前**自动备份的旧 HEAD 位置，是"后悔药"快捷方式：

```bash
git reset --hard ORIG_HEAD         # 撤销刚才那次 merge/rebase/reset，回到操作前
```

::: tip 救火三板斧
1. `git reflog` 看指针移动，找到"出事前"的 SHA；2. `git reset --hard <sha>` 或 `git branch <name> <sha>` 接回；3. reflog 没有就 `git fsck --unreachable` 兜底。**核心前提：动作要快，别等 `gc` 把悬空对象清掉**。
:::

> 💡 **在 IDEA 里**：reflog 的图形支持有限，**这三个救援剧本建议直接照着本节命令回命令行做** —— IDE 的 Log 只显示可达提交，`--hard` 丢掉的提交在界面里根本看不见，而那恰恰是最需要 reflog 的时刻。
> 可以借力的是 **Local History**：右键文件或目录 → **Local History → Show History**，能救回**从未提交过**的内容。它是 IDE 自己的定时快照，与 Git 无关，但对「改崩了还没提交」这种情况意外地好用。

## 九、撤销类速查大表："我想……"

把全篇命令收进一张"以意图检索"的表，遇到场景直接抄：

| 我想…… | 命令 | 注意 |
| --- | --- | --- |
| 丢弃工作区某个文件的改动 | `git restore <file>` 或 `git checkout -- <file>` | `checkout` 的 `--` 不能省 |
| 丢弃工作区所有改动 | `git restore .` | 不影响已暂存内容 |
| 删除未跟踪的文件 | `git clean -f` | 先 `-n` 预演；`-d` 含目录 |
| 删除未跟踪文件+目录（含忽略的） | `git clean -fdx` | 极猛，先 `-n` 看清单 |
| 撤出某文件的暂存（保留改动） | `git restore --staged <file>` 或 `git reset HEAD <file>` | 内容不变，只挪区域 |
| 撤出全部暂存（保留改动） | `git restore --staged .` | 改动落回工作区 |
| 改最后一次提交信息 | `git commit --amend -m "..."` | 未推送才安全 |
| 给上次提交补漏文件 | `git add <f>` 后 `git commit --amend --no-edit` | 同上 |
| 回退一次提交、保留改动待重提 | `git reset --soft HEAD~1` | 改动留在暂存区 |
| 回退一次提交、改动落回工作区 | `git reset HEAD~1`（--mixed） | 改动未暂存 |
| 彻底回退两次提交（丢弃） | `git reset --hard HEAD~2` | 改动物理消失，先 stash/备份 |
| 撤销已推送的单个提交（留痕） | `git revert <sha>` | 历史加反向提交，协作安全 |
| 撤销一段提交（A 之后到 B） | `git revert A..B` | 逐个生成反向提交 |
| 撤销一个合并提交 | `git revert -m 1 <merge_commit>` | `-m 1` = 回到主分支状态 |
| 把某次提交搬到当前分支 | `git cherry-pick <sha>` | 生成新 SHA，可加 `-x` 记录来源 |
| 拣选区间提交 | `git cherry-pick A..B` | 冲突用 `--continue/--abort` |
| 找回刚删的分支 | `git branch <name> <sha>`（SHA 从 `git reflog` 找） | 90 天内可救 |
| 找回误 reset 的提交 | `git reflog` → `git reset --hard <sha>` | 动作要快 |
| 放弃本次合并 | `git merge --abort` 或 `git reset --hard ORIG_HEAD` | 未提交时用 `--abort` |
| 放弃本次 rebase | `git rebase --abort` | 中途退出最干净 |
| 丢掉所有未提交改动（含未跟踪） | `git reset --hard` + `git clean -fd` | 终极清空，无恢复 |

> 💡 **在 IDEA 里**：把上面那张速查表当成「菜单速查」用 —— 表里绝大多数命令都能在**提交窗右键菜单**和 **Log 右键菜单**这两个地方找到图形入口；找不到的就是 IDE 没提供（`cherry-pick -n`、`reflog`、`fsck` 这类），回命令行即可。

## 本篇小结

- 撤销前先问三件事：**哪个区域、有没有推送、改历史还是留痕**——这决定了用 `restore`/`reset`/`revert` 哪一类。
- 工作区未 add 的改动：`git restore <file>`（新版）/ `git checkout -- <file>`（老写法，`--` 不能省）；`git restore .` 全弃。
- 未跟踪文件要用 **`git clean`**：`-n` 预演、`-f` 真删、`-d` 含目录、`-x` 含忽略项；**`-fd` 会真删且无回收，务必先 `-n`**。
- 撤销暂存：`git restore --staged <file>` / `git reset HEAD <file>`，**只挪区域、不改内容**。
- **`--amend` 改写最后一次提交**（改信息/补漏/改作者）；红线：**已推送的提交严禁 amend**，改用 revert。
- **`reset` 三兄弟**：`--soft`（改动留暂存）、`--mixed`（默认，改动落工作区）、`--hard`（**丢弃改动，危险**）；只影响本地历史，已推送公共分支别用。
- `--hard` 前先用 `git stash` 或 `git branch backup` 兜底；目标写法 `<sha>`/`HEAD~1`/`HEAD^`。
- **`revert` 生成反向提交、不改写历史**，是已推送分支回退的正确姿势；合并提交必须 `git revert -m 1`（第一父=主分支）。
- `cherry-pick` 拣选**个别**提交到当前分支（hotfix 回灌经典）；连续整段挪动交给 `rebase`。
- **`reflog` 是救火黑匣子**，记录 HEAD/分支每次移动，默认保留 **90 天、不可达对象 30 天**；误 reset、误删分支、rebase 搞砸都能靠它 + `git reset --hard <sha>` 找回。
- reflog 没有时 `git fsck --unreachable`/`--lost-found` 兜底找悬空提交；`ORIG_HEAD` 是 merge/rebase/reset 前的快捷备份。
- 救火核心：**动作要快**，别等 `git gc` 把悬空对象清掉；已 push 的东西别用 `reset`/`amend` 改写。

## 参考链接

- [Pro Git 第 2 章：Git 基础 - 撤消操作](https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E6%92%A4%E6%B6%88%E6%93%8D%E4%BD%9C)
- [git-restore 官方手册](https://git-scm.com/docs/git-restore)
- [git-reset 官方手册](https://git-scm.com/docs/git-reset)
- [git-revert 官方手册](https://git-scm.com/docs/git-revert)
- [git-cherry-pick 官方手册](https://git-scm.com/docs/git-cherry-pick)
- [git-reflog 官方手册](https://git-scm.com/docs/git-reflog)
- [git-clean 官方手册](https://git-scm.com/docs/git-clean)
- [git-fsck 官方手册](https://git-scm.com/docs/git-fsck)

下一篇 → [07 变基 rebase 与历史整理](/ops/git/rebase)
