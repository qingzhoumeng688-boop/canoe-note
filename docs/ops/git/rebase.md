# 07 变基 rebase 与历史整理

> 本篇导读：当 `merge` 把分支搅成一团麻花，`rebase` 是让历史重新变直的利器——但它改写历史、重算 SHA，用错了同样能把协作搅成一锅粥。本篇先用一张提交图讲清"rebase 到底搬了什么"，再对比 `merge` 与 `pull --rebase` 的差异；重点落在交互式 rebase（`-i`）的拾取、压缩、改写、删除，以及冲突处理和"出事怎么回滚"。读完你会建立一条铁律：**个人分支随便 rebase，共享分支绝不 rebase**；并掌握 `--onto`、`--autosquash`、`rerere` 这些让历史整洁如新的高阶武器。

## 一、rebase 到底做了什么

一句话区分两者：

- **`merge`**："合并留下分叉"——把两条分支的交点用一个**合并提交**连起来，历史呈 Y 形。
- **`rebase`**："搬家变成一条直线"——把你分支上的提交一个个摘下来，重新"长"到目标分支的最新提交之后，历史是一条直线。

`rebase` 的内部动作分四步：① 找到当前分支与目标分支（`<upstream>`）的**共同祖先**；② 把"共同祖先之后、当前分支上的那批提交"逐个**摘下来**（暂存为补丁）；③ 把 `HEAD` 切到目标分支最新提交，再把摘下的提交**按顺序逐个应用**；④ 应用完后，当前分支指针指向最后一个重放出来的新提交。

关键在于：被重放的提交是**全新的提交，SHA 全变了**——内容一样，父提交却变了，哈希自然不同。用提交图感受一下，假设 `feature` 基于 `main` 的早期提交 `B`：

```text
        A---B---C main
       /
  D---E---F feature
```

执行 `git rebase main` 后，Git 把 `D、E、F` 摘下、依次接到 `C` 之后：

```text
              D'---E'---F' feature
             /
        A---B---C main
```

`D'、E'、F'` 带了撇号——SHA 已和原来的 `D、E、F` 不同，旧的变成悬空对象、最终被 `gc` 回收。`main` 自己**一动没动**，rebase 只改了当前所在的分支。

## 二、git rebase 基础用法

### 2.1 把当前分支接到另一分支之上

最常用形式：站在要搬的分支上，指定目标基底。

```bash
git switch feature
git rebase main            # 把 feature 接到 main 最新提交之后

git rebase origin/main     # 把当前分支接到"远程 main 的最新抓取结果"之后
```

`origin/main` 是你上次 `fetch` 时记录的**远程跟踪提交**（本地缓存），`main` 是你本地分支；别人推了新东西而你还没 fetch 时，以 `origin/main` 为准更贴近"远端真实状态"。

### 2.2 --onto：精准指定"搬哪一段、搬到哪"

`git rebase --onto <newbase> <upstream> <branch>` 语义：**把 `<branch>` 上、但不在 `<upstream>` 上的提交，重放到 `<newbase>` 之后**。

真实场景：你本想在 `main` 上开 `topic`，却误基于 `other` 开干，结果 `topic` 带上了 `other` 的 `Z` 依赖，而 `Z` 你根本不想要：

```text
        A---B---C main
       /
  X---Y---Z other
           \
            D---E topic          (topic 挂在 other 上，含 Z 的包袱)
```

只想保留 `D、E` 两个提交，让它脱离 `other`、直接长在 `main` 上：

```bash
git rebase --onto main other topic
# 含义：把 topic 有、other 没有的提交（D、E）搬到 main(C) 之后
```

结果：

```text
        A---B---C main
       /         \
  X---Y---Z other  D'---E' topic
```

`<branch>` 省略时默认对当前分支操作（前提是当前在 `topic`）。

### 2.3 git pull --rebase 与 git pull 的差异

`git pull` 默认是 `fetch + merge`；`git pull --rebase` 是 `fetch + rebase`：

| 维度 | `git pull`（fetch + merge） | `git pull --rebase`（fetch + rebase） |
| --- | --- | --- |
| 历史形态 | 产生一个**合并提交**，历史分叉 | **线性历史**，本地提交排在远端更新之后 |
| 本地提交 SHA | 不变 | 全部重算（变新 SHA） |
| 是否改写本地历史 | 否 | **是** |
| 多余提交 | 多一个 `Merge branch 'main' ...` | 无 |
| 冲突处理 | 一次性解决合并冲突 | 可能**逐个提交**重放时反复冲突 |
| 适用 | 公共分支、想保留合并记录 | 个人特性分支、追求干净线性 |
| 等价写法 | `git fetch && git merge origin/main` | `git fetch && git rebase origin/main` |

想让 `pull` 默认用 rebase（避免本地历史被合并提交污染）：

```bash
git config --global pull.rebase true
```

::: warning 接远程共享分支别用 rebase
`pull --rebase` 改写的是**你本地**的提交，只要还没推给别人就安全；若在 `main` 这种共享分支上 `pull --rebase`，等于改写"可能已被别人拉走的提交"，慎用（详见第四节）。
:::

> 💡 **在 IDEA 里**：常用的 rebase 有两个图形入口 ——
> - **把当前分支接到另一个分支上**：分支控件里选中目标分支 → **Rebase Current onto Selected**（等于 `git rebase main`）。
> - **拉取时用 rebase**：`Ctrl+T` → **Update Project** 弹窗里选 **Rebase**（等于 `git pull --rebase`）。
> `--onto` 这种「把某一段搬到别处」的场景没有对应界面，回命令行最清楚。

## 三、rebase vs merge 全面对照

| 维度 | `merge` | `rebase` |
| --- | --- | --- |
| 历史形态 | **分叉**（Y 形，有合并提交） | **线性**（一条直线） |
| 可读性 | 保留"何时合入"的真实时间线 | 提交顺序被重排，看起来更整洁 |
| 定位问题（bisect/blame） | 原始提交原封不动，`blame` 指向真实作者 | 提交被复制，**blame 指向重放者**，定位稍绕 |
| 冲突处理次数 | **一次**解决合并冲突 | 可能**每个提交重放都冲突一次**，需反复解决 |
| 适用分支 | **公共/共享分支**、需审计记录 | **个人/特性分支**、本地整理 |
| 是否改写 SHA | 否（新增合并提交，原提交不动） | **是**（被搬的提交全部换新 SHA） |
| 审计与回滚 | 合并提交清晰，回滚用 `revert` | 改写历史后别人基线错位，回滚麻烦 |
| 协作影响 | 队友正常 `pull` 无感 | 队友若已基于旧 SHA，需 `rebase`/`reset` 对齐 |

**结论（什么时候用哪个）**：

- **主干（main/master、已发布 release）**：用 `merge`，保留真实合并记录、不改写公共历史，回滚 `revert` 干净。
- **个人特性分支（feature/*、没推或推了没人基于它）**：用 `rebase`，让历史线性、提交干净，合进主干前先 `rebase` 到最新 `main`。
- 团队约定一句话概括：**"个人分支 rebase、主干 merge；还没推就整理，推了就别改。"**

> 💡 **在 IDEA 里**：正因为 IDE 把 merge 和 rebase 都做成了**右键一下就执行**，误操作成本比命令行更低 —— 命令行至少还要把分支名敲出来。
> 建议把这条准则变成肌肉记忆：**在 IDE 里对任何分支点 Merge / Rebase 之前，先看状态栏确认当前分支是不是自己那条。**

## 四、黄金准则：绝对不要改写共享历史

rebase 最大的坑不是命令本身，而是**把改写后的历史推到共享分支**。

### 4.1 为什么不能 rebase 已推送的共享提交

假设 `feature` 已被同事 `clone`、基于旧 SHA 在工作；你 `rebase` 了 `feature` 并强制推送：你本地的 `D、E` 变成 `D'、E'`，而同事本地 `D、E` 还在、且可能已在其上提交了 `G`；同事 `pull` 时发现与远端分叉、历史对不上，他的 `G` 会基于一个不存在的旧 SHA，合并乱套，甚至把旧提交重新拉回来。一句话：**rebase 已公开的历史 = 让所有人的基线同时断裂**。

### 4.2 如果必须强制推送：用 --force-with-lease

确认只有自己在用该分支（个人 `feature`、CI 临时分支），rebase 后必须强推，也**别用 `--force`**，用更安全的 `--force-with-lease`：

```bash
git push --force-with-lease origin feature
```

`--force` 是无脑覆盖远端、不管别人有没有新提交；`--force-with-lease` 会先检查"远端分支是否还停在你上次 fetch 的状态"——若远端有别人的新提交，推送被**拒绝**，避免默默覆盖同事工作。这是对 `--force` 的最低限度保护。

### 4.3 团队约定建议

| 分支类型 | 整理方式 | 推送方式 | 理由 |
| --- | --- | --- | --- |
| 个人 `feature/*`（未协作） | 可 `rebase`/`reset` 整理 | 正常 push，或 `--force-with-lease` | 没人基于它工作 |
| 公共 `main`/`master` | **只 `merge`** | 正常 push（ff 或 merge commit） | 改写会坑全队 |
| 已发布 `release/*` | 用 `revert` 回退 | 正常 push | 需审计、可追溯 |
| 长期共享 `develop` | 用 `merge --no-ff` 保留记录 | 正常 push | 协作需可见合并点 |

把"已推送历史禁止 rebase"写进团队 `CONTRIBUTING.md` 或提交规范（见 09 篇），比靠自觉可靠。

> 💡 **在 IDEA 里**：**Force Push with Lease** 藏在 Push 对话框按钮旁的下拉里（见 [05 篇](/ops/git/remote)）；IDE 里没有「无 lease 强推」的便捷入口，这是好事 —— 想强推就顺手拿到安全版本。
> 另有一个更省事的替代：如果只是自己的分支 rebase 后推不上去，先 `Ctrl+T` → Rebase 把本地对齐远程，往往就不需要强推了。

## 五、交互式 rebase（重点）

`git rebase -i`（interactive）是 rebase 的精华：在编辑器里**逐个决定**每个提交怎么处理，能做压缩、改信息、删除、拆分。

### 5.1 进入交互式编辑

```bash
git rebase -i HEAD~3        # 整理最近 3 个提交
git rebase -i <sha>         # 整理 <sha> 之后的所有提交（不含 <sha> 本身）
git rebase -i --root        # 从"有史以来第一个提交"开始整理（见第八节）
```

执行后 Git 打开默认编辑器（`core.editor`，通常 `vim`），列出每个提交及其动作指令：

```text
pick a1b2c3d feat: 新增登录表单
pick 9fceb02 fix: 修样式
pick 7c7b3a8 fix: 又修了一处样式
pick e4f5a6b wip: 草稿先提交
```

### 5.2 七种指令对照表

每行第一个词是"动作指令"，决定该提交怎么被处理：

| 指令 | 含义 | 典型用途 |
| --- | --- | --- |
| `pick`（p） | 原样保留该提交 | 默认，不动 |
| `reword`（r） | 保留改动，但**改提交信息** | 信息写错、想补上下文 |
| `edit`（e） | 保留改动，但**停下来让你改内容** | 拆分提交、补改文件 |
| `squash`（s） | 把该提交**合并进上一个**，并**编辑合并后信息** | 把零碎提交压成一个 |
| `fixup`（f） | 同 `squash`，但**丢弃本提交信息** | 只想要改动、不想要它的信息 |
| `drop`（d） | **删除该提交** | 误提交、不要的草稿 |
| `exec`（x） | 在每轮重放间**执行一条 shell 命令** | 跑测试、lint 校验 |

改完指令保存退出，Git 按写的顺序重放。下面是三个最常演的剧本。

### 5.3 剧本一：把 5 个零碎提交压成 1 个（squash）

日志里一堆 "wip"、"fix"、"又 fix"，合进主干前想并成一个干净 `feat`：

```text
pick a1b2c3d feat: 新增导出功能
squash 9fceb02 fix: 修了空指针
squash 7c7b3a8 fix: 修了编码
squash e4f5a6b wip: 先提交
squash b2c3d4e style: 格式化
```

保存后 Git 打开第二个编辑器让你**编辑合并后的提交信息**（把几条合成一条）。最终结果是 1 个提交，包含原来 5 个的全部改动。

### 5.4 剧本二：改中间某条提交信息（reword）

只想改第二条信息，其它不动：

```text
pick a1b2c3d feat: 新增导出功能
reword 9fceb02 fix: 修了空指针
pick 7c7b3a8 feat: 补充单元测试
```

Git 重放到第二条会停下，让你重写信息（如改成 `fix: 导出时空指针校验`）。改完保存继续，`9fceb02` 变成新 SHA，其余提交 SHA 因父链变化也跟着变。

### 5.5 剧本三：删掉一个错误提交（drop）

某次提交误加了调试日志或敏感文件，想让它"像从没存在过"：

```text
pick a1b2c3d feat: 新增导出功能
drop 9fceb02 debug: 临时打印密钥
pick 7c7b3a8 feat: 补充单元测试
```

保存后 `9fceb02` 整条被跳过，不进新历史。**注意**：若被删提交之后的提交改了同一文件，重放时可能冲突，照常解决（见第六节）。

### 5.6 edit：拆分一个提交

想把"一个太大、混了多件事"的提交拆成两个，用 `edit`：

```text
pick a1b2c3d feat: 新增导出功能
edit 9fceb02 refactor: 顺便重构了导出与日志
pick 7c7b3a8 feat: 补充单元测试
```

Git 重放到 `9fceb02` 会停下（`Stopped at 9fceb02...`）。拆分步骤：

```bash
git reset HEAD^                          # 把这个提交"拆回"工作区
git add src/export.js
git commit -m "refactor: 重构导出逻辑"    # 先提交"导出重构"部分
git add src/logger.js
git commit -m "refactor: 重构日志输出"    # 再提交"日志重构"部分
git rebase --continue                    # 继续后续提交重放
```

### 5.7 --autosquash + fixup：边写边整理的高效流

若习惯"先随便提交、最后再压"，`--autosquash` 能把整理自动化：

```bash
git config --global rebase.autoSquash true      # 全局开启（一次配置永久生效）

git commit --fixup=a1b2c3d      # 开发中：a1b2c3d 是"想并入的那个提交"的 SHA
git rebase -i --autosquash a1b2c3d~1   # autosquash 已开，自动把 fixup 排到目标后
```

`--fixup=<sha>` 生成的提交信息形如 `fixup! <目标提交信息>`，rebase 时自动排到目标提交之后并 `fixup` 掉——**不用手动改指令表**。这比"先记着待会儿 squash"省心得多，是日常最推荐的工作流。

> 💡 **在 IDEA 里**：**交互式 rebase 有图形界面** —— 在 Log 里选中一串连续的提交，右键 → **Interactively Rebase from Here…**。弹窗里逐行就是那些提交，每行有一个动作下拉（`Pick` / `Reword` / `Squash` / `Fixup` / `Drop` 等，与上面的七种指令对应），拖动行可以**调整顺序**，改完点 **Start Rebasing**。
> 用来做「把 5 个零碎提交压成 1 个」「改中间某条提交信息」「删掉一个错误提交」这三个剧本，比手改编辑器里的 todo 列表直观得多。
> ⚠️ 前提照旧：**只对未推送的本地提交这么干**。

## 六、rebase 冲突处理

rebase 是"逐个提交重放"，冲突可能在一个提交上冒出来、解决后又在下一个再冒一次——这是它比 merge 麻烦的地方。

### 6.1 读懂 git status 的提示

重放某提交遇冲突时，Git 停下并提示：

```text
Auto-merging src/app.js
CONFLICT (content): Merge conflict in src/app.js
error: could not apply d4e5f6a... feat: 新增导出功能
hint: Resolve all conflicts, then run:
hint:   git rebase --continue
hint: or:   git rebase --abort
```

此时 `git status` 会显示：

```text
You are currently rebasing branch 'feature' on 'c3d4e5f'.
  (fix conflicts and then run "git rebase --continue")
  (use "git rebase --skip" to skip this patch)
  (use "git rebase --abort" to checkout the original branch)
Unmerged paths:
  both modified:   src/app.js
```

### 6.2 --continue / --skip / --abort

| 命令 | 作用 | 何时用 |
| --- | --- | --- |
| `git rebase --continue` | 解决完冲突、`git add` 后继续重放下一个提交 | 冲突已解决，想继续 |
| `git rebase --skip` | **丢弃当前这个冲突的提交**，跳到下一个 | 这个提交不要了（谨慎，会丢改动） |
| `git rebase --abort` | **放弃整次 rebase**，回到操作前状态 | 冲突太乱、想重来 |

典型解决流程：

```bash
vim src/app.js              # 手工编辑，删掉 <<<<<<< ======= >>>>>>> 标记、保留正确内容
git add src/app.js          # 标记已解决
git rebase --continue       # 继续（可能再次冲突，循环处理）
```

### 6.3 git rerere：让"反复冲突"只解决一次

`rerere`（reuse recorded resolution）记录你**每次冲突解决的结果**，再遇相同冲突 Git 自动套用——对 rebase 反复冲突是救命药：

```bash
git config --global rerere.enabled true     # 全局开启
```

开启后第一次手动解决冲突时 Git 会记下（`Resolved 'src/app.js' using previous resolution.`），下次 rebase 到同一点直接复用。可查看/清空：

```bash
git rerere status          # 看当前记录的冲突解决
git rerere diff            # 看记录的"冲突前→解决后"差异
git rerere clear           # 清空所有记录（一般不用）
```

::: tip rerere 最佳实践
做长期特性分支、需反复 `rebase main` 时务必开 `rerere.enabled true`，把"同一冲突解决 N 次"变"解决 1 次"，尤其适合周期变基的发布分支。
:::

> 💡 **在 IDEA 里**：rebase 冲突用的是**和合并冲突同一套三栏工具**，只是含义变了 —— **左栏变成「你要变基到的目标分支」的内容，右栏变成「你自己那条提交」的内容**。这是最容易搞反的地方：`--ours` 在 rebase 下指的是目标分支，不是你原来的分支。
> 想确认方向，就看窗口标题与栏头文字（`Local Changes` / `Changes from <branch>`），不要凭记忆。
> 收尾：三栏工具点 **Apply** 后 IDE 会提示继续 —— 等价于 `git rebase --continue`；想整体放弃则用 **Abort Rebase**（等价 `--abort`）。

## 七、rebase 出事了怎么办（承接 06 篇）

rebase 也是改写历史，搞砸了同样能救——和 06 篇"救火"是同一套机制。

### 7.1 ORIG_HEAD 与 --abort

每次 `rebase`/`merge`/`reset` 前，Git 都把旧 HEAD 写进 `ORIG_HEAD`。rebase 刚结束就发现不对：

```bash
git rebase --abort         # 中途放弃，最干净
git reset --hard ORIG_HEAD # rebase 已完成才发现问题：一键回到 rebase 之前
```

只要 rebase 还在"进行中"（没 `--continue` 到结束），随时 `--abort` 都能干净退出，是最安全的后悔键。

### 7.2 用 reflog 找回 rebase 前的状态

若 rebase 已完成、`--abort` 已来不及（已做了别的操作），靠 `reflog` 兜底（详见 06 篇第八节）：

```bash
git reflog
# c3d4e5f HEAD@{0}: rebase (finish): returning to refs/heads/feature
# a1b2c3d HEAD@{1}: rebase (start): checkout main      ← rebase 之前的状态

git reset --hard HEAD@{1}    # 回到 rebase 开始前那个 SHA
```

`rebase (start)` 那条就是"动手术前"的现场，重置回去即可满血复活。**核心前提：动作要快**——悬空对象默认 30 天后被 `gc` 清掉（见 06 篇）。

> 💡 **在 IDEA 里**：rebase 出事后最省事的出口还是**放弃**（IDE 的 **Abort Rebase**）。已经完成才发现搞砸，就得靠 reflog —— **IDE 的 Log 只显示可达提交，找不回来**，请照本节命令回命令行执行。

## 八、历史清理进阶

rebase 不只整理近期提交，还能做更彻底的历史手术。

### 8.1 git rebase -i --root：改最初的提交

`--root` 表示"从仓库第一个提交开始"，可改最早提交信息、或清理根提交里的垃圾文件：

```bash
git rebase -i --root        # 编辑器列出从创世第一个提交至今的全部
```

用法和普通 `-i` 一样，只是范围拉到最前。常见用途：把首次提交里误加的 `passwords.txt` 从一开始就剔除（但会改写**整条历史的所有 SHA**，见 8.3 风险）。

### 8.2 git commit --amend 与 rebase 的关系

`git commit --amend` 本质是"只针对**最后一个**提交的微型 rebase"——用新提交替换旧提交、SHA 会变（见 06 篇四节）。只想改最近一次用 `--amend`；要改最近 N 次或中间某次才上 `rebase -i`。两者同一族：**都是改写历史**，已推送的提交都别碰。

### 8.3 删除历史中的敏感/大文件：filter-repo

敏感文件或大文件已进历史深处时，普通 rebase 够不着（它只在提交列表工作、不遍历所有对象），要用 `filter-repo`/`filter-branch` 重写**整条历史**：

```bash
pip install git-filter-repo                 # 老版本需单独装，新版 Git 自带
git filter-repo --path secrets.txt --invert-paths   # 删 secrets.txt（--invert-paths 反选保留其余）
git filter-repo --path huge.zip --invert-paths     # 删大文件
```

`filter-repo` 比老旧 `filter-branch` 更快更安全（官方推荐）。`filter-branch` 写法（了解即可，新项目别用）：

```bash
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch secrets.txt' \
  --prune-empty -- --all
```

**重大风险**：这两个命令会**改写仓库每个相关提交的 SHA**；**协作仓库改写历史后，所有协作者必须删除旧克隆、重新 `clone`**——旧历史上的分支/标签/未推送提交都会和新地对不上，强行 `pull` 会制造灾难性分叉；远程也要强推（`git push --force --all` + `--tags`），且 `GitHub` 等平台会保留原对象缓存一段时间，敏感文件可能仍未真正消失，必要时联系平台彻底清理。结论：**敏感文件尽早用 filter-repo 清理，但务必提前通知全员"准备重新克隆"**。

::: danger 不要随手对协作仓库跑 filter-repo
`filter-repo` 是"核选项"：能抹掉历史，但副作用是强制全员重新克隆。没有团队共识、没通知到位就跑，等于把队友本地工作全部作废。
:::

> 💡 **在 IDEA 里**：**`filter-repo` / `filter-branch` 没有图形界面**，删历史里的敏感文件或大文件必须在命令行做，且必须全团队重新克隆；IDE 侧能配合的只有改完之后重新导入工程。
> 另外提醒：`rebase -i --root`（改最初的提交）在 IDEA 的交互式界面里**选不到最早那个提交之前的位置**，回命令行。

## 本篇小结

- **rebase = 搬家**：把当前分支提交摘下、重放到目标分支最新提交之后，**产生全新提交、SHA 全变**；merge 则"留分叉"、SHA 不变。
- 基础用法 `git rebase <upstream>`（用 `main` 或 `origin/main`）；`--onto <newbase> <upstream> <branch>` 精准挑"搬哪段、搬到哪"。
- `git pull` = fetch+merge（留合并提交）；`git pull --rebase` = fetch+rebase（线性）；可用 `pull.rebase true` 设为默认。
- rebase vs merge 总对照：**线性 vs 分叉、改写 SHA vs 不改、可能反复冲突 vs 一次冲突、个人分支 vs 公共分支**。
- **黄金准则：已推送到共享分支的提交绝不做 rebase**；必须强推时用 `--force-with-lease` 而非 `--force`。
- 团队约定：**个人分支 rebase、主干 merge；没推就整理，推了就别改**。
- 交互式 rebase（`-i`）七指令：`pick`/`reword`/`edit`/`squash`/`fixup`/`drop`/`exec`；三剧本：压成 1 个（squash）、改中间信息（reword）、删错误提交（drop）。
- `edit` 拆提交：先 `git reset HEAD^` 分批 `add`/`commit` 再 `--continue`；`--fixup` + `rebase.autoSquash true` 是边写边整理的最佳流。
- 冲突处理：`--continue`/`--skip`/`--abort`；`rerere.enabled true` 让反复冲突只解决一次。
- 出事回滚：`git rebase --abort`（中途）、`git reset --hard ORIG_HEAD`、`git reflog` 找 rebase 前 SHA（动作要快）。
- 历史清理进阶：`rebase -i --root` 改创世提交；删敏感/大文件用 `filter-repo --path ... --invert-paths`，但**协作仓库改写历史须全员重新克隆**。

## 参考链接

- [Pro Git 第 3 章：Git 分支 - 变基](https://git-scm.com/book/zh/v2/Git-%E5%88%86%E6%94%AF-%E5%8F%98%E5%9F%BA)
- [git-rebase 官方手册](https://git-scm.com/docs/git-rebase)
- [git-config 官方手册（pull.rebase / rebase.autoSquash / rerere.enabled）](https://git-scm.com/docs/git-config)
- [git-rerere 官方手册](https://git-scm.com/docs/git-rerere)
- [git-filter-repo 官方文档](https://github.com/newren/git-filter-repo)
- [git-push 官方手册（--force-with-lease）](https://git-scm.com/docs/git-push)
- [Atlassian：Merging vs. Rebasing](https://www.atlassian.com/git/tutorials/merging-vs-rebasing)
- [Git 官方：Rewriting history](https://git-scm.com/book/en/v2/Git-Tools-Rewriting-History)

下一篇 → [08 标签、子模块与 Worktree](/ops/git/extras)
