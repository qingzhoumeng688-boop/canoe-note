# 03 基础操作：提交、查看与忽略

> 本篇导读：会 `init`、会 `add`、会 `commit` 只是第一步，真正把 Git 用顺手的人，都吃透了"暂存区为什么存在""状态栏里那些字母是什么意思""历史怎么查、怎么追责""误提交的文件怎么让 Git 永远别管"。本篇把日常最常用的一套命令串起来：从初始化与克隆讲起，逐个拆解 `add` 的七十二种姿势、`commit` 的坑与 Amend 红线；再用表格讲清 `status`/`diff` 的字母与箭头；接着给出 `log`/`show`/`blame` 的检索组合拳；最后把 `.gitignore`、已被跟踪文件的"忽略无效"、换行符与 `.gitattributes` 这三大容易翻车的点一次性讲透。读完你再也不会对着 ` M` 和 `??` 发愣。

## 一、初始化与克隆

新建仓库有两种起点：`git init` 在本地凭空建，或 `git clone <url> [dir]` 把远程整库搬回来。

### 1.1 本地初始化

```bash
git init
# Initialized empty Git repository in /path/to/project/.git/

# 指定初始分支名（Git 2.28+ 支持，避免默认叫 master）
git init -b main
# Initialized empty Git repository in /path/to/project/.git/
```

**刚 `init` 完那段提示什么意思？** 如果你没设默认分支，会看到一段 `hint:`：

```text
hint: Using 'master' as the initial branch. This default branch name
hint: is subject to change. To configure the initial branch name
hint: to use on all repositories, use:
hint:   git config --global init.defaultBranch main
```

它的意思是：当前这个新仓库的默认分支叫 `master`，但这名字以后可能变（GitHub/Gitee 现在主流是 `main`）。想一劳永逸统一，就执行它提示的 `git config --global init.defaultBranch main`。两条最省心的做法：

- 全局配置一次：`git config --global init.defaultBranch main`（见 01 篇），以后 `git init` 默认就是 `main`；
- 每次显式指定：`git init -b main`。

此时仓库是**空的**（"No commits yet"），还没有任何提交，`HEAD` 指向的 `refs/heads/main` 还不存在，直到第一次 `commit`。

### 1.2 从远程克隆

```bash
git clone <url> [dir]
# 例：不指定 dir，则按仓库名建目录
git clone git@gitee.com:you/my-repo.git
# 例：指定本地目录名
git clone https://gitee.com/you/my-repo.git my-folder
# Cloning into 'my-folder'...
# remote: Enumerating objects: 42, done.
# Receiving objects: 100% (42/42), done.
```

`git clone <url> [dir]` 里 `<url>` 是远程地址（SSH 或 HTTPS），`[dir]` 是可选的本地目录名（省略时取仓库名）。克隆下来的是**完整副本**：对象库、所有分支引用、提交历史全在本地，能离线看历史、建分支。`clone` 还会自动建立 `origin` 这个远程名，并把默认分支检出到工作区。

> 💡 **在 IDEA 里**：
> - **把项目交给 Git**：`File → Open` 打开目录后若 IDE 没自动识别，用 `Settings → Version Control → Directory Mappings` 把根目录登记为 VCS 根。
> - **从远程克隆**：欢迎页 **Get from VCS**，或 `Git → Clone…`；粘贴 URL、选目录即可，克隆完直接是一个能编译的工程。
> - **初始化**：`Git → Init`，或在欢迎页新建工程时勾选 **Create Git repository**。

## 二、暂存：git add 的七十二变

暂存区（index/Staging Area）是 Git 区别于很多 VCS 的"第三区域"。`git add` 的本质是：**把工作区文件的当前内容写成 blob 存入对象库，并在 `index` 里登记"这个文件下次提交用这个 blob"**（底层细节见 02 篇）。

### 2.1 各种 add 姿势

| 命令 | 作用 |
| --- | --- |
| `git add <file>` | 暂存单个指定文件 |
| `git add .` | 暂存当前目录及其子目录下**所有改动**（新增、修改、删除都算） |
| `git add -A` / `git add --all` | 暂存**整个工作区**的所有改动（新增+修改+删除），等价于从仓库根 `.` |
| `git add -u` / `git add --update` | 只暂存**已被跟踪文件**的修改与删除，**不纳入新增的未跟踪文件** |
| `git add -p` / `git add --patch` | 逐块（hunk）交互式暂存，挑选"哪些改动进这次提交" |
| `git add -i` / `git add --interactive` | 进入交互菜单，可批量更新、反暂存、加补丁等 |
| `git add -e` | 打开编辑器，手动编辑要暂存的内容差异 |

典型输出：

```bash
git add src/app.js
git status -s
# A  src/app.js      ← A 表示该文件已暂存（Added）

git add -u
# 只把已跟踪文件的改动登记进暂存区，新文件不会被纳入
```

### 2.2 git add -p：分块暂存（交互键）

`-p` 会按"改动块（hunk）"逐个问你。每个提示后的可用键：

| 键 | 作用 |
| --- | --- |
| `y` | 暂存当前这块 hunk |
| `n` | 不暂存当前这块 |
| `s` | 把当前大块拆成更小的几块再逐个决定 |
| `e` | 手动编辑（精确到行级挑选要暂存的行） |
| `a` | 暂存当前文件**剩余所有** hunk |
| `d` | 不暂存当前文件**剩余所有** hunk |
| `q` | 退出，已做的选择保留 |
| `/` | 按正则搜索下一个 hunk |
| `?` | 显示帮助与全部键说明 |

```bash
git add -p
# diff --git a/src/app.js b/src/app.js
# @@ -10,7 +10,9 @@ ...
# Stage this hunk [y,n,s,e,a,d,/?]? y
```

### 2.3 git add -i 简介

`git add -i` 进入交互菜单，常见选项：

```text
*** Commands ***
  1: status      2: update       3: revert       4: add untracked
  5: patch       6: diff         7: quit         8: help
```

日常最常用的是 `2: update`（批量进暂存）和 `5: patch`（进入逐块挑选）。绝大多数场景用 `-p` 就够，交互模式适合要做复杂挑选时。

### 2.4 为什么要有暂存区

很多人觉得"暂存区多余，直接提交不就完了"。其实它是 Git 的**精妙设计**：

- **挑拣（partial staging）**：一个文件里改了三处，但只想把"修复登录bug"那两处提交，另一次提交做"顺手重构"。`git add -p` 让你把一次编辑拆成多次**语义清晰的提交**。
- **原子提交（atomic commit）**：每次提交应该只表达"一个完整、可编译、可回退的逻辑变更"。暂存区让你先组装好"这次提交长什么样"，再一次性 `commit` 固化，而不是"工作区里有什么就全塞进去"。
- **提交前最后检查**：`git diff --cached` 看"即将提交的内容"，确认无误再 `commit`，避免把调试日志、密码、大文件误提交进去。

一句话：**工作区是草稿纸，暂存区是待发清单，提交是把清单印成正式版本**。

> 💡 **在 IDEA 里**：**暂存 = 勾选**。
> - 提交窗（`Ctrl+K`）里的文件列表，勾上就是 `git add`，取消勾选就是 `restore --staged`，双击文件则打开差异对照。
> - **分块暂存**：在差异视图里，每个改动块左侧都有一个复选框 —— 只勾想要的那几块，就等于 `git add -p`，而且所见即所得，不用去猜 `y` / `n` / `s` 该敲哪个。
> - **分批提交**：`Settings → Version Control → Changelists` 打开变更列表后，可以把改动拖进不同列表分别命名、分别提交，比反复 `git add -p` 稳。

## 三、提交：git commit

### 3.1 基本提交

```bash
git commit -m "feat: 新增登录接口"
# [main 9fceb02] feat: 新增登录接口
#  1 file changed, 36 insertions(+), 2 deletions(-)

# 多行说明：用两个 -m，第一个是标题，第二个是正文
git commit -m "feat: 新增登录接口" -m "支持手机号+验证码，兼容旧账号密码登录。"
```

只敲 `git commit`（不带 `-m`）会打开配置的编辑器（如 VS Code / Nano / Vim），按"标题一行 + 空行 + 正文"的格式写。好提交信息遵循 **Conventional Commits** 风格：`type: 一句话`，常见 `type`：`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`、`perf`。

### 3.2 -am 的便利与陷阱

```bash
git commit -am "fix: 修正空指针"
```

`-a` 是 `--all` 的缩写，等于**自动帮你对"已跟踪文件的修改/删除"执行一次 `add`**，然后提交。它的**前提与陷阱**：

- **只作用于已跟踪文件**。如果你新建了一个文件还没 `git add` 过，`-am` **不会**把它加进提交，它仍是 `Untracked` 状态，提交里没有它。
- 所以黄金法则：**新增文件必须先 `git add` 一次**；之后反复修改的已跟踪文件才可用 `-am` 偷懒。

```bash
echo "new file" > config.yaml
git commit -am "chore: 加配置"     # ❌ config.yaml 仍是 untracked，没进提交
git add config.yaml               # ✅ 先 add
git commit -m "chore: 加配置"      # ✅ 这次才进去
```

### 3.3 --amend：改最后一次提交

```bash
# 改提交信息
git commit --amend -m "fix: 修正空指针（含边界判断）"

# 补漏文件：先 add 再 amend
git add forgot-to-add.py
git commit --amend --no-edit      # --no-edit 表示信息不变，只把新文件并进去
```

`--amend` 的本质是**用一个新的提交替换掉上一次提交**（旧提交变成无人引用的孤儿，最终被 GC）。因此它改写历史。

::: danger 红线：已推送的提交不要 amend
如果上次提交已经 `push` 到远程、别人可能已经基于它工作，你再 `amend` 会产生一个"SHA 不同但逻辑相同"的新提交，对方 `pull` 时会报 "non-fast-forward" 冲突，被迫手动处理。**已推送的提交要改，应该用 `revert` 或等下一篇（05/06）讲的变基与协作规范**。本地、未推送的提交随便 amend。
:::

### 3.4 其它常用开关

| 命令 | 作用与典型场景 |
| --- | --- |
| `git commit --no-verify` | 跳过 `pre-commit` / `commit-msg` 钩子（紧急绕过，但不建议常开，钩子是为拦低级错误） |
| `git commit --allow-empty -m "ci: 触发流水线"` | 创建一个空提交，常用于重新触发 CI、或在空仓库占位打里程碑 |
| `git commit -v` | 提交时把 `diff` 显示到编辑器里，边写信息边核对改动 |

> 💡 **在 IDEA 里**：`git commit` 的主角是提交窗（`Ctrl+K`）——
> - **提交信息框**：按 `Ctrl+↑` 可调出本仓库的历史提交信息，复用上次措辞很方便。
> - **Amend**：提交窗工具栏上的 **Amend** 复选框，等于 `git commit --amend`；勾上后上一次的改动会落回文件列表，可以增也可以减。
> - **提交前自动处理**：提交窗的选项区有 **Reformat code** / **Optimize imports** / **Analyze code** / **Run Git hooks**，勾上就是「提交顺手格式化」，比记 `-a` 之类省心。
> - **提交并推送**：**Commit** 按钮右侧的下拉 → **Commit and Push…**，一步到位。

## 四、状态与差异：看懂 git status / git diff

### 4.1 git status 的状态字母

`git status` 给人类读，`git status -s`（`-s` = short）给紧凑两列字母。表格列出 `git status -s` 常见标记：

| 标记 | 含义 |
| --- | --- |
| `??` | 未跟踪（Untracked），Git 还不管它 |
| `A ` | 已暂存的新文件（Added，左列 A） |
| `M ` | 已修改**且已暂存**（M 在左列：暂存区相对 HEAD 变了） |
| ` M` | 已修改**未暂存**（M 在右列：工作区相对暂存区变了） |
| `MM` | 暂存后又在工作区改了（左右两列都是 M） |
| `D ` | 已删除**且已暂存**（左列 D） |
| ` D` | 已删除**未暂存**（右列 D） |
| `R ` | 重命名且已暂存（配合 `git mv`） |
| `UU` | 冲突未解决（Unmerged，双方都改了同一处） |

::: tip 看"列"比看"字母"更重要
`git status -s` 的两列：**左列描述"暂存区相对上次提交（HEAD）"，右列描述"工作区相对暂存区"**。所以 `M `（M 在左）= 改动已在暂存区；` M`（M 在右）= 改动只在工作区。这正好对应 `add` 把改动从左推到右（从右列移到左列）。
:::

### 4.2 git diff 的四种对比

| 命令 | 对比的两方 | 常见用途 |
| --- | --- | --- |
| `git diff` | 工作区 vs 暂存区 | "我改了啥，还没 `add` 的" |
| `git diff --cached` / `git diff --staged` | 暂存区 vs HEAD | "我 `add` 了啥，即将提交的内容" |
| `git diff HEAD` | 工作区 vs HEAD（含暂存） | "相对上次提交，总共变了啥" |
| `git diff --stat` | 上述任一方 + 统计 | 只显示"哪些文件、增删多少行"，不显示内容 |
| `git diff --word-diff` | 词级差异 | 中文/长行改动时，按词而非整行显示，更易读 |
| `git diff main..feature` | 两分支各自最新提交 | 看两个分支"整体分叉"差了什么 |
| `git diff main...feature` | `main` 与 `feature` 的**共同祖先** vs `feature` | 只看"feature 相对主干新增了什么"（三点语法） |
| `git diff --check` | 工作区改动 | 检查是否有**行尾空白、Windows CRLF 混用**等隐患，提交前扫雷 |

```bash
git diff                       # 工作区里还没 add 的改动
git diff --cached              # 已经 add、准备提交的改动
git diff HEAD -- README.md     # 只看 README.md 相对上次提交的总变化
git diff --stat                # 概览：哪些文件改了、各增删多少行
git diff main...feature        # feature 相对 main 分叉点新增的内容
git diff --check               # 提交前检查尾部空白/CRLF 问题
```

::: tip 两点 vs 三点
`A..B` 是"从 A 到 B 双方各自不同的并集"（两边互相对比）；`A...B` 是"以 A、B 的共同祖先为基，只看 B 比祖先多了什么"——日常想看"我这个分支相对主干开发了啥"，用 **三点 `main...feature`** 最准。
:::

> 💡 **在 IDEA 里**：状态与差异是全图形化的 ——
> - 提交窗里文件的**颜色与状态字母**和 `git status -s` 一致（蓝 = 已修改、绿 = 新增、红 = 未跟踪或冲突）。
> - 选中文件按 `Ctrl+D` 打开差异视图，可**左右并排**也可**统一视图**，右上角齿轮里能开 **Ignore whitespace**（只看实质改动，对应 `git diff -w`）。
> - 想比较「某次提交 vs 当前工作区」：Log 里右键那次提交 → **Compare with Local**。

## 五、查看历史：git log

`git log` 是"时间机器"的仪表盘。下面按使用频率排列最实用的组合。

| 参数 | 作用 |
| --- | --- |
| `--oneline` | 一行一个提交（`短SHA 说明`），速览 |
| `--graph --decorate --all` | 画出分支图、标注分支/标签指针、看全部分支 |
| `-p` | 附带每次提交的 diff 内容 |
| `-n 5` | 只看最近 5 条 |
| `--author="张三"` | 按作者过滤 |
| `--since="2024-01-01"` / `--until` | 按时间过滤（也支持 `--after/--before`） |
| `--grep="登录"` | 按提交信息关键字过滤 |
| `-S"关键词"` | 追踪"哪次提交**增删了**包含该字符串的代码行"（找 bug 引入点神器） |
| `-G"正则"` | 与 `-S` 类似，但用正则匹配 diff |
| `--follow -- <path>` | 跟踪单文件历史（即使它曾被重命名也能串起来） |
| `-- <path>` | 只看某个文件/目录的历史 |
| `--format=...` / `--pretty=...` | 自定义输出格式 |

```bash
# 漂亮的总览：图形 + 装饰 + 单行
git log --oneline --graph --decorate --all

# 看最近 10 条、带作者与时间
git log -n 10 --pretty="%h | %an | %ad | %s"

# 追踪某段代码什么时候出现/消失
git log -S"calculatePrice(" --oneline
# a1b2c3d fix: 重构计价逻辑（这一行被删了）
# e4f5a6b feat: 新增计价函数（这一行被加了）

# 单文件历史，且跟随重命名
git log --follow --format="%h %ad %s" -- README.md

# 某作者的、某时间段内的、信息含"登录"的提交
git log --author="张三" --since="3 weeks ago" --grep="登录" --oneline
```

统一漂亮别名（已在 01 篇给出，复习一下）：

```bash
git config --global alias.lg "log --color --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"
git lg          # 之后直接 git lg 看彩色分支图
```

> 💡 **在 IDEA 里**：`Alt+9` → Git 工具窗的 **Log** 标签，就是图形版的 `git log --graph --all` ——
> - 顶部筛选栏可按 **User / Date / Path / Branch** 过滤，等价于 `--author` / `--since` / 路径过滤。
> - 在某个文件上点 **Show History**（对应 `git log -- 路径`），历史面板里还能再按文本搜提交信息。
> - 想追某段代码何时出现：在文件历史里逐条看差异，或在历史面板底部的搜索框里直接搜代码内容。

## 六、查看某次提交与文件

### 6.1 git show：看某次提交细节

```bash
git show HEAD            # 看当前提交（diff + 元信息）
git show HEAD~2          # 看上上个提交
git show 9fceb02         # 看指定 SHA 的提交
git show --stat HEAD     # 只看该提交改了哪些文件、各增删多少行
```

`git show <sha>:<path>` 能直接"取出某个历史版本里某个文件的内容"，无需切分支：

```bash
git show 9fceb02:src/app.js     # 打印该提交时 src/app.js 的内容
git show HEAD~1:README.md > old-readme.md   # 导出旧版本做对比
```

### 6.2 git blame：逐行追责

`git blame` 标注文件中**每一行最后一次被谁、在哪次提交、什么时间改动**：

```bash
git blame README.md
# ^9fceb02 (张三 2024-05-01 10:22:03 +0800 1) # 我的项目
# a1b2c3d  (李四 2024-05-03 14:05:11 +0800 2) 这是一个示例仓库。

git blame -L 10,20 src/app.js     # 只看第 10~20 行
git blame -C src/app.js           # 检测"行是从别处复制/移动过来的"（跨文件溯源）
git blame -w src/app.js           # 忽略纯空白变化，避免把"只调了缩进"算成改动
```

**blame 的正确用法与局限**：

- 用法：定位"这行是谁写的 / 哪次提交引入的"，配合 `git show <sha>` 看上下文。
- 局限：它只标注"最后触碰该行的提交"，**不是原创作者**——某人只是顺手改了空格，整行就记他名下；代码若被**移动/复制**，`blame` 默认追不到原出处（要靠 `-C`/`-M`）。所以 blame 是"线索"不是"判决"，下结论前要结合 `log --follow` 与 `show`。

### 6.3 git describe：用标签描述位置

```bash
git describe --tags          # 输出离当前提交最近的、带注释/轻量标签的名字
# v1.2.0-3-g9fceb02         ← 表示：v1.2.0 之后又过了 3 个提交，当前在 9fceb02
git describe --tags --long   # 强制带 -N-gSHA 后缀
```

常用于发布脚本里"给当前构建起一个可读的版本名"。

> 💡 **在 IDEA 里**：
> - **`git blame` → 行内标注**：在编辑器**左侧行号栏右键 → Annotate with Git Blame**，每一行左侧会显示「提交人 + 日期 + SHA」；点这些标注可以跳到对应提交或 **Show Diff** 看该行当时怎么改的。选中一段代码再执行同一操作，就相当于 `git blame -L`。装了 GitToolBox 插件后可常驻显示，不必手动开。
> - **`git show` → 单个提交详情**：Log 里点某次提交，下方 **Commit Details** 面板就是它（含文件清单，双击文件看该版本的差异）。
> - **`git show <sha>:<path>` → 看某提交时的文件**：Log 里右键 → **Show Repository at Revision**，整个工程切到那一版；或直接双击某次提交里的文件。

## 七、删除、移动与重命名

### 7.1 git rm：从版本库移除

```bash
git rm file.txt              # 同时删除工作区文件并暂存"删除"
git rm -r src/old/           # 递归删除目录

git rm --cached file.txt     # 只从版本库移除（停止跟踪），工作区文件保留
# file.txt 变成 Untracked，本地还在
```

`git rm --cached <file>` 是"误提交文件的标准处理入口"：**本地文件不丢，只是 Git 不再管它**，紧接着把它写进 `.gitignore` 就彻底清净了（见第八节）。

```bash
# 经典场景：想把"已跟踪的所有文件"改为"按 .gitignore 白名单重新跟踪"
git rm -r --cached .         # 把所有已跟踪文件从版本库移除（本地全保留）
# 此时按 .gitignore 规则，只有白名单里的会被重新 add
git add .
git commit -m "chore: 按 .gitignore 重新整理跟踪范围"
```

### 7.2 git mv：重命名

```bash
git mv old-name.js new-name.js
# 等价于：mv old-name.js new-name.js + git rm old-name.js + git add new-name.js
```

用 `git mv` 而非手动 `mv`，Git 才能识别为"重命名"而非"删旧+加新"，`log --follow` 也才能把历史接上。

> 💡 **在 IDEA 里**：
> - **删除**：Project 视图里直接 `Delete`，IDE 会问是否**同时从 Git 移除**（勾上等于 `git rm`，不勾则只删本地文件）。
> - **重命名 / 移动**：用 `Shift+F6` 重命名或直接拖拽，IDE 会**自动完成 `git mv`**。强烈建议走这条路径 —— 手工 `mv` 之后忘记 `git add` 是历史断链的常见原因。
> - **取消跟踪但保留文件**：本质就是本节讲的 `git rm --cached`，也可以在 `Delete` 对话框里勾选「从 Git 移除」达到同样效果。

## 八、.gitignore：让 Git 视而不见

`.gitignore` 决定"哪些文件 Git 永远不主动跟踪"。配套还有 `.git/info/exclude`（本仓库私有、不进版本库）和全局 `core.excludesfile`。

### 8.1 生效范围与优先级

| 来源 | 位置 | 是否进版本库 | 优先级（同规则冲突时） |
| --- | --- | --- | --- |
| `.gitignore` | 仓库内各目录（可有多份） | 是，团队共享 | **离文件越近的 .gitignore 优先级越高** |
| `.git/info/exclude` | 单仓库本地 | 否，仅本机本仓库 | 低于同目录 `.gitignore` |
| 全局 `core.excludesfile` | 用户主目录（如 `~/.gitignore_global`） | 否 | 最低 |

注意：对于**同一个文件路径**，Git 从"文件所在目录"向上逐级查找 `.gitignore`，**更靠近该文件的规则胜出**；而 `.git/info/exclude` 与全局排除文件作为补充，只在前面都没匹配时才看。换句话说——**就近原则 + 顺序在后**。

### 8.2 语法速查表

| 写法 | 含义 |
| --- | --- |
| `# 注释` | 注释行 |
| `/TODO` | **锚定仓库根**：只忽略根目录的 `TODO`，不匹配 `sub/TODO` |
| `build/` | 忽略名为 `build` 的目录（及其内容），结尾 `/` 表示目录 |
| `*.log` | 忽略任意层级的 `*.log` 文件（`*` 不匹配跨目录的 `/`） |
| `**/foo` | 任意层级下的 `foo`（`a/foo`、`a/b/foo` 都算） |
| `**/logs/**` | 任意目录里的 `logs` 目录及其内部一切 |
| `?` | 匹配单个字符，如 `log?.txt` 匹配 `log1.txt` |
| `[abc]` | 字符集合，如 `file[12].txt` 匹配 `file1.txt`/`file2.txt` |
| `!` | 取反（**但父目录已被忽略时，子项无法被重新包含**） |
| `dir/` | 结尾斜杠 = 目录 |

取反的坑：

```text
# 想忽略 doc/ 但保留 doc/keep.md —— 下面这样写是无效的：
doc/
!doc/keep.md
# 因为 doc/ 整目录被忽略后，Git 根本不会进去看 keep.md

# 正确写法：先忽略目录内文件，再放行具体文件
doc/*
!doc/keep.md
```

### 8.3 常见语言模板入口

GitHub 官方维护了大量语言/框架的 `.gitignore` 模板：[github/gitignore](https://github.com/github/gitignore)。常见片段：

```text
# Node.js
node_modules/
dist/
npm-debug.log*

# Python
__pycache__/
*.pyc
.venv/
*.egg-info/

# IDE
.idea/
.vscode/
```

### 8.4 已被跟踪的文件，.gitignore 为什么"无效"

这是高频误区：**`.gitignore` 只对"尚未被跟踪"的文件生效**。如果某文件已经被提交进版本库，之后再写进 `.gitignore`，Git 照样跟踪它的变化——因为"忽略规则管的是要不要开始跟踪，不管已经在册的"。

解决办法两条路：

| 目标 | 命令 | 说明 |
| --- | --- | --- |
| 彻底不再跟踪（推荐） | `git rm --cached <file>` 然后写进 `.gitignore` | 文件变 Untracked，之后被忽略；本地文件保留 |
| 仅"本地改动不想提交"，仍保留跟踪 | `git update-index --assume-unchanged <file>` | 告诉 Git"假定它没变"，性能优化用，**上游一改你就冲突** |
| 同上但更稳 | `git update-index --skip-worktree <file>` | 明确"跳过此文件"，适合本地配置长期不提交 |

`--assume-unchanged` vs `--skip-worktree` 的区别：

- `--assume-unchanged` 本意是**性能提示**（文件很大且确定不变，省去反复比对），Git 仍可能在需要时重置它；若别人改了同一文件并合进来，你会很困惑。
- `--skip-worktree` 语义是"**我有本地修改，请永远别动它**"，更适合 `config.local.js` 这类"基于模板、本机私有"的文件。
- 两者都**不修改历史、不进版本库**，只是本地对索引的标记；换机器/换clone即失效。要撤销：`git update-index --no-assume-unchanged <file>` / `--no-skip-worktree <file>`。

> 真要"以后都不跟踪某个文件"，首选 `git rm --cached` + `.gitignore`，而不是这两个 `--update-index` 开关。

排查"为什么没被忽略"：

```bash
git check-ignore -v config.local.js
# .gitignore:12:config.local.js  config.local.js
# 输出"哪个文件第几行规则"命中了它；没输出说明根本没被忽略
```

> 💡 **在 IDEA 里**：
> - **把文件加进忽略**：Project 视图里右键文件或目录 → `Git → Add to .gitignore`；菜单里没有这一项时，装官方 **.ignore** 插件，它提供 `.gitignore` 语法高亮、模板与一键添加。
> - **查某文件为什么被忽略**：IDE 里看不出来，回命令行 `git check-ignore -v <file>` 最直接。
> - ⚠️ IDE 会把被忽略的文件**折叠成灰色**，但**已被跟踪的文件不会因为写进 `.gitignore` 就消失** —— 这一点在图形界面里比命令行更隐蔽，别被骗了。

## 九、换行符与文件属性

跨平台协作时，Windows 的 `CRLF`（`\r\n`）和 Linux/macOS 的 `LF`（`\n`）会制造大量"假差异"。核心是 `core.autocrlf` 与 `.gitattributes`。

### 9.1 core.autocrlf 三档对照

| 值 | 平台建议 | 检出到工作区 | 提交进仓库 |
| --- | --- | --- | --- |
| `true` | Windows | 转成 `CRLF` | 转成 `LF` 存 |
| `input` | macOS / Linux | 保持 `LF` | 转成 `LF` 存 |
| `false` | 不自动转换 | 原样 | 原样 |

```bash
git config --global core.autocrlf true     # Windows 用户
git config --global core.autocrlf input    # macOS / Linux 用户
```

常见报错与原因：

```text
warning: LF will be replaced by CRLF
fatal: CRLF would be replaced by LF
```

多半是 Windows 上 `autocrlf` 误设成 `false`，而工作区文件又混了 `CRLF`。**根治：统一团队换行约定 + 配对 `autocrlf`**，别靠手工来回转换。

### 9.2 用 .gitattributes 强制策略（比 autocrlf 更可靠）

`.gitattributes` 进版本库、团队共享，能"按文件类型"强制规则，优先级高于 `autocrlf`：

```text
# 自动判定文本，换行统一处理
*           text=auto

# 脚本强制 LF，避免 Windows 上变成 CRLF 导致 shell 执行报错
*.sh        text eol=lf
*.py        text eol=lf
*.bat       text eol=crlf

# 二进制文件，禁止行尾转换与 diff
*.png       binary
*.jpg       binary
*.zip       binary
```

`* text=auto` 让 Git 自动识别文本并按需归一化；对明确类型再用 `eol=lf/crlf` 锁定。二进制加 `binary` 可避免被当文本处理（否则图片可能被"换行转换"搞坏，或产生无意义 diff）。

> 💡 **在 IDEA 里**：IDEA 自己**也有一份换行符设置**（`Settings → Editor → Code Style → General → Line separator`），新建与保存文件时按它写盘。它和 `core.autocrlf` 是两个独立开关，方向不一致时就会出现「IDE 里看着好好的，一提交整个文件都变了」。
> 稳妥做法：**项目里放 `.gitattributes` 定死规则**，IDE 的 Line separator 设为 `System Dependent` 或与项目一致，别让两套规则打架。

## 本篇小结

- 初始化用 `git init` 或 `git init -b main`；`init` 后提示"默认分支名"只是善意的提醒，用 `init.defaultBranch` 全局设成 `main` 即可。
- `git clone <url> [dir]` 拉的是**整个对象库+全部历史**，所以克隆后能离线看任意提交、建任意分支。
- `git add` 家族：`add <file>`、`.`、`-A`、`-u`、`-p`（逐块 `y/n/s/e/a/d/q/?`）、`-i`（交互菜单）；核心目的是**挑拣与原子提交**。
- 暂存区是"待发清单"，让你在 `commit` 前组装好"这次版本长啥样"，并用 `git diff --cached` 做最后核对。
- `git commit -am` 只自动暂存**已跟踪文件**，新增文件必须先 `git add`，否则留在 Untracked。
- `--amend` 改写最近一次提交；**已推送的提交严禁 amend**（会制造历史分歧），应改用 revert 或后续协作篇的方案。
- `git status -s` 的两列：左列=暂存区相对 HEAD，右列=工作区相对暂存区；`??/A /M / M/MM/D / D` 都要认得。
- `git diff` 四类：无参（工作区vs暂存）、`--cached`（暂存vsHEAD）、`HEAD`（工作区vsHEAD）、`--check`（扫尾随空白/CRLF）。
- 查历史靠 `git log`：`--oneline --graph --decorate --all` 总览；`-S"串"` 追踪代码增删；`--follow` 跟单文件重命名；配合 `--author/--since/--grep`。
- `git show <sha>:<path>` 直接取历史文件内容；`git blame -L/-C/-w` 逐行追责，但要懂它的局限（只标最后触碰者）。
- 删除用 `git rm`/`git rm --cached`（只退跟踪不删本地）；重命名用 `git mv` 才能被识别为 rename。
- `.gitignore` 只管**未跟踪**文件；已被跟踪的再写忽略无效，要用 `git rm --cached` 退跟踪或 `--skip-worktree` 标记。
- `git check-ignore -v <file>` 能告诉你"哪条规则忽略了它"，是排查忽略失效的利器。
- 换行符靠 `core.autocrlf`（Windows=`true`、Linux/macOS=`input`）+ `.gitattributes`（`* text=auto`、`*.sh text eol=lf`、`*.png binary`）双保险。

## 参考链接

- [Pro Git 第 2 章：Git 基础 - 记录每次更新到仓库](https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E8%AE%B0%E5%BD%95%E6%AF%8F%E6%AC%A1%E6%9B%B4%E6%96%B0%E5%88%B0%E4%BB%93%E5%BA%93)
- [git-add 官方手册](https://git-scm.com/docs/git-add)
- [git-commit 官方手册](https://git-scm.com/docs/git-commit)
- [git-diff 官方手册](https://git-scm.com/docs/git-diff)
- [git-log 官方手册](https://git-scm.com/docs/git-log)
- [gitignore 官方手册（含语法与优先级）](https://git-scm.com/docs/gitignore)
- [gitattributes 官方手册](https://git-scm.com/docs/gitattributes)
- [GitHub .gitignore 官方模板集](https://github.com/github/gitignore)

下一篇 → [04 分支、合并与冲突](/ops/git/branch)
