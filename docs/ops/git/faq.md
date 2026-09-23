# 10 常用场景速查与排错

> 本篇导读：这是 Git 篇的"手册 / 字典"页，目标是让你在出事时能**直接查、直接抄**。全文分两半：前半是"我想…… → 用哪条命令"的场景速查大表（建议配合浏览器 `Ctrl+F` 搜关键词），后半是"报什么错 → 怎么修"的逐条排查；最后附排查工具箱、`git bisect` 二分定位、`效率与配置调优`、图形化工具。命令都给真实可执行的写法，关键结论加粗。遇到不在表里的怪事，先跳到「排查工具箱」看 Git 到底在干什么。

**怎么用这篇**：手头要做某件事 → 翻第一节「场景速查大表」；终端突然报错 → 翻第二节「报错逐条排查」；想定位"哪次提交引入的 bug" → 第四节 `git bisect`；卡住看不出原因 → 第三节「排查工具箱」。

## 一、场景速查大表（核心）

"我想……" → 命令 → 备注。复制即用，参数含义见各篇正文。

| 我想…… | 命令 | 备注 |
| --- | --- | --- |
| 撤销工作区某文件改动（未 add） | `git restore <file>` | 新版写法，回到最近提交的样子 |
| 撤销某文件暂存（add 反悔） | `git restore --staged <file>` | 改动保留在工作区 |
| 改上次提交信息 | `git commit --amend -m "新信息"` | 未推送才安全（见 06 篇） |
| 补文件到上次提交 | `git add <file> && git commit --amend --no-edit` | 未推送才安全 |
| 回退一次提交但保留改动 | `git reset --soft HEAD~1` | 改动留在暂存区 |
| 彻底回退两次提交 | `git reset --hard HEAD~2` | 改动物理消失，先 stash/备份 |
| 撤销已推送的提交（留痕） | `git revert <sha>` | 生成反向提交，协作安全 |
| 找回刚删的分支 | `git branch <name> <sha>` | SHA 从 `git reflog` 找（见 06 篇） |
| 找回误 reset 的提交 | `git reflog` → `git reset --hard <sha>` | 动作要快，90 天内 |
| 放弃本次合并 | `git merge --abort` | 或 `git reset --hard ORIG_HEAD` |
| 放弃本次 rebase | `git rebase --abort` | 中途退出最干净 |
| 丢掉所有未提交改动 | `git reset --hard && git clean -fd` | 含未跟踪，无恢复 |
| 只丢弃某文件改动 | `git restore <file>` | 同第一行，单文件版 |
| 找出某段代码是谁加的 | `git blame -L 10,20 <file>` | 看每行作者与提交 |
| 找出某段代码何时被引入 | `git log -S "关键字" -- <file>` | 看增删该字符串的提交 |
| 只看某人最近改动 | `git log --author="张三" --oneline -10` | 按提交者过滤 |
| 查看某文件的历史 | `git log -- <file>` | 只该文件的提交 |
| 比较两个分支差异 | `git diff main..feature` | 或 `git log main..feature --oneline` |
| 把某个提交搬到当前分支 | `git cherry-pick <sha>` | 生成新 SHA，可加 `-x` |
| 只提交文件的部分改动 | `git add -p <file>` | 交互式挑选 hunk |
| 改名远程地址 | `git remote set-url origin <新地址>` | 改 `origin` 的 URL |
| 删除远程分支 | `git push origin --delete <branch>` | 本地分支不受影响 |
| 清理本地已删的远程分支 | `git fetch --prune` | 清掉远程已删的跟踪分支 |
| 查看某个 tag 的代码 | `git show <tag>` / `git switch <tag>` | 后者进 detached HEAD（见 08 篇） |
| 临时保存手头工作 | `git stash` / `git stash pop` | 切分支前先收好 |
| 暂存部分改动先提交 | `git add -p && git commit` | 配合上一行做原子提交 |
| 拉取并以 rebase 接入 | `git pull --rebase` | 保持线性历史（见 07 篇） |
| 看图形化提交树 | `git log --graph --oneline --all` | 或配 `lg` 别名（见第五节） |
| 修改已推送分支历史（自己独占） | `git push --force-with-lease` | 别用 `--force`（见 07 篇） |
| 统计每人提交行数 | `git shortlog -sn --all` | 看贡献分布 |

::: tip 查不到时怎么搜
大表里命令多含 `<file>` / `<sha>` / `<branch>` 这类占位符，复制时**替换成真实值**；在浏览器里按 `Ctrl+F` 输入关键词（如"找回""撤销""冲突"）能秒定位。

> 💡 **在 IDEA 里**：这张表里的命令，绝大多数都能在**提交窗右键菜单**与 **Log 右键菜单**这两个地方找到图形入口。[11 篇](/ops/git/idea) 把它们整理成了一张完整的「命令 ↔ IDEA 菜单」对照表，按 `Ctrl+F` 查比翻菜单快。

## 二、报错逐条排查（核心）

每条固定结构：**错误信息 → 原因 → 解决方案 → 预防**。错误原文用 ` ```text ` 原样展示，方便你比对。

### 2.1 `detached HEAD`（游离头）提示

```text
Note: switching to 'v1.0'.

You are in 'detached HEAD' state. You can look around, make experimental
commits, and abandon them when you switch back.
```

- **原因**：`git checkout/switch <tag>` 或某个 SHA，HEAD 直接指向提交而非分支，提交后改动"无家可归"。
- **解决**：要基于它改东西，先建分支 `git switch -c hotfix-v1.0 v1.0`；纯查看则无所谓，切回分支即自动脱离。
- **预防**：签出 tag 只为看历史；要改必先建分支（见 08 篇 1.5）。

### 2.2 `! [rejected] ... (non-fast-forward)` 推送被拒

```text
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'origin'
hint: Updates were rejected because the tip of your current branch is behind
```

- **原因**：别人先推了，你的本地落后，Git 拒绝覆盖。
- **解决**：先 `git pull --rebase` 把远端更新接上，再 `git push`；有冲突照常解。
- **预防**：推送前先 `pull --rebase`；个人分支整理用 `--force-with-lease`（见 07 篇）。

### 2.3 `fatal: refusing to merge unrelated histories`

```text
fatal: refusing to merge unrelated histories
```

- **原因**：两个仓库历史完全无关（如本地 `init` 后硬连一个空远程，或导入了别的项目），Git 默认拒绝合。
- **解决**：明确要合并时加 `--allow-unrelated-histories`：`git pull origin main --allow-unrelated-histories`。
- **预防**：新项目用 `git clone` 起手，而非本地 `init` 后硬接远程。

### 2.4 合并 / 变基冲突 `CONFLICT (content)`

```text
Auto-merging src/app.js
CONFLICT (content): Merge conflict in src/app.js
Automatic merge failed; fix conflicts and then commit the result.
```

- **原因**：同一文件同一区域两边都改了，Git 无法自动判定。
- **解决**：编辑文件删 `<<<<<<<` / `=======` / `>>>>>>>` 标记、留正确内容 → `git add <file>` → `git commit`（merge）或 `git rebase --continue`（rebase）。
- **预防**：分支寿命短、常 `rebase main`；开 `rerere.enabled true` 让同冲突只解一次（见 07 篇）。

### 2.5 `warning: LF will be replaced by CRLF`

```text
warning: LF will be replaced by CRLF in src/app.js.
The file will have its original line endings in your working directory
```

- **原因**：Windows 上 `core.autocrlf` 与文件实际换行不一致，Git 检出/提交时转换。
- **解决**：统一团队约定——Windows `git config --global core.autocrlf true`，macOS/Linux `input`；仓库加 `.gitattributes`（`* text=auto`）。
- **预防**：所有人按平台配一致；用 `.gitattributes` 锁定（见 09 篇八节）。

### 2.6 `Permission denied (publickey)`

```text
git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.
```

- **原因**：SSH 公钥没贴到平台，或多密钥冲突，或 agent 没加载私钥。
- **解决**：`cat ~/.ssh/id_ed25519.pub` 复制公钥贴到 GitHub/Gitee；多密钥在 `~/.ssh/config` 指定 `IdentityFile`；`ssh -T git@github.com` 验证。
- **预防**：用 SSH 前先 `ssh -T` 验证连通（见 01 篇 5.1）。

### 2.7 `fatal: Authentication failed for 'https://...'`

```text
fatal: Authentication failed for 'https://github.com/you/repo.git'
```

- **原因**：HTTPS 用户名/密码（或个人令牌 PAT）错，或 Git 还在用已失效的缓存凭据。
- **解决**：GitHub 已不支持密码，用 **PAT** 当密码；`git credential reject` 清掉旧凭据重输；或改用 SSH。
- **预防**：HTTPS 配凭据管理器（`credential.helper`）；长期用 SSH 最省心。

### 2.8 `error: Your local changes would be overwritten by checkout`

```text
error: Your local changes to the following files would be overwritten by checkout:
        src/app.js
Please commit your changes or stash them before you switch branches.
```

- **原因**：工作区有未提交改动，切分支会覆盖。
- **解决**：`git stash` 暂存 → 切分支 → 回来 `git stash pop`；或先 `git commit`。
- **预防**：切分支前先提交或 stash；用 `git status` 确认工作区干净。

### 2.9 `fatal: Unable to create '.../.git/index.lock'`

```text
fatal: Unable to create '/repo/.git/index.lock': File exists.
```

- **原因**：上一次 Git 操作被强杀（断电/Ctrl+C），锁文件残留。
- **解决**：确认没有 Git 在跑，删锁：`rm -f .git/index.lock`（或 `git gc` 后重试）。
- **预防**：别强杀 Git 进程；CI 并发操作注意串行。

### 2.10 `remote: RPC failed` / `fatal: the remote end hung up unexpectedly`

```text
error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413
fatal: the remote end hung up unexpectedly
```

- **原因**：推送体积过大（大文件未走 LFS）、网络不稳或代理限制；HTTP 413 是服务端拒收大包。
- **解决**：大文件改走 LFS（见 08 篇六节）；加大缓冲 `git config --global http.postBuffer 524288000`；换 SSH 协议；检查代理。
- **预防**：大文件尽早 LFS；CI 推送设合理缓冲。

### 2.11 `fatal: Not possible to fast-forward, aborting.`

```text
fatal: Not possible to fast-forward, aborting.
```

- **原因**：`git pull --ff-only` 要求必须快进，但本地与远端已分叉。
- **解决**：改用 `git pull --rebase` 接上远端；或接受合并 `git pull`。
- **预防**：个人分支日常 `git pull --rebase`；设 `pull.rebase true`（见 07 篇）。

### 2.12 `filename too long`（Windows）

```text
fatal: unable to create file '...': Filename too long
```

- **原因**：Windows 默认路径长度上限（260）被突破，常见于 `node_modules` 深层路径。
- **解决**：`git config --global core.longpaths true`；或启用系统长路径组策略。
- **预防**：Windows 全局开 `core.longpaths true`（见 01 篇配置）。

### 2.13 `detected dubious ownership`（Windows 多用户 / 管理员）

```text
fatal: detected dubious ownership in repository at 'D:/repo'
'D:/repo' is owned by 'S-1-5-21-...' but the current user is 'S-1-5-...'
```

- **原因**：仓库属主与当前用户不一致（如用管理员跑、或跨用户目录），Git 防提权攻击拒绝操作。
- **解决**：`git config --global --add safe.directory D:/repo` 加入白名单；或改目录属主。
- **预防**：别用管理员身份乱跑 Git；统一用同一用户操作仓库。

### 2.14 `fatal: bad object HEAD` / 仓库损坏

```text
fatal: bad object HEAD
fatal: your current branch 'main' does not point to a valid object
```

- **原因**：对象库损坏（磁盘坏道、强杀、`.git` 被改）。
- **解决**：先 `git fsck --full` 看损坏范围；尝试 `git reset --hard ORIG_HEAD` 或最近好提交；损坏严重则从远程重新 `git clone`。
- **预防**：定期 `git gc`；不手动改 `.git`；重要仓库多备份。

### 2.15 `error: pathspec 'xxx' did not match any file`

```text
error: pathspec 'xxx' did not match any file(s) known to git
```

- **原因**：文件名拼错、文件未跟踪、或该文件在当前分支不存在。
- **解决**：`git status` / `git ls-files | grep xxx` 确认真实路径；未跟踪文件先 `git add` 再操作。
- **预防**：用 Tab 补全路径；确认所在分支。

### 2.16 `You have divergent branches and need to specify how to reconcile`

```text
hint: You have divergent branches and need to specify how to reconcile them.
hint: You can do so by running one of the following commands:
    git config pull.rebase false   # merge
    git config pull.rebase true    # rebase
    git config pull.ff only        # fast-forward only
```

- **原因**：新版 Git 在 `pull` 遇到分叉时不再默认 merge，要求你显式选策略（与 `pull.ff` 设置相关）。
- **解决**：按提示设一项，推荐 `git config --global pull.rebase true`（线性历史）。
- **预防**：装好 Git 就配 `pull.rebase true`，避免每次被问。

### 2.17 分支已存在 / 找不到分支

```text
fatal: A branch named 'feature/x' already exists.
error: branch 'feature/x' not found
```

- **原因**：建分支重名，或删/切一个不存在的分支。
- **解决**：换名 `git switch -c feature/y`；或先 `git branch -a` 看全部分支（含远程）。
- **预防**：分支名加需求号降低撞名概率（见 09 篇二节）。

### 2.18 中文文件名显示成 `\344\270\255` 乱码

```text
\344\270\255\345\217\221\346\226\207\346\234\211.txt
```

- **原因**：`core.quotepath` 默认 `true`，非 ASCII 路径被八进制转义显示。
- **解决**：`git config --global core.quotepath false`，中文路径正常显示。
- **预防**：首次装 Git 就设 `core.quotepath false`（见 01 篇 4.2）。

### 2.19 `OpenSSL SSL_read: Connection was reset` / 代理失败

```text
fatal: OpenSSL SSL_read: Connection was reset, errno 10054
fatal: unable to access 'https://github.com/...': Failed to connect
```

- **原因**：网络不稳、代理配置错误、或被墙。
- **解决**：检查代理 `git config --global http.proxy`；必要时 unset；或换 SSH 协议（见 05 篇代理说明）；重试。
- **预防**：国内访问 GitHub 按需配代理（给特定域名走代理）；SSH 不受 http.proxy 影响。

### 2.20 GPG 签名失败 / `hunks failed`

```text
error: gpg failed to sign the data
fatal: failed to write commit object
# 或 add -p 时：
error: patch does not apply
fetching ...
hunks failed
```

- **原因（GPG）**：没配 GPG 密钥或 agent 没启，提交时 `--gpg-sign` 失败；**hunks failed**：`git add -p` 时手动改了 hunk 导致补丁对不上。
- **解决**：GPG 失败先 `git config --global user.signingkey <keyid>` 并 `gpgconf --kill gpg-agent` 重启 agent，或临时 `git commit --no-gpg-sign`；hunks 失败用 `git checkout -p` / 重新 `add -p`，不要手改补丁。
- **预防**：配好 GPG agent 自动启动；`add -p` 编辑时只删上下文、别动 `+`/`-` 行。

> 💡 **在 IDEA 里**：几条高频报错在 IDE 里的表现与对策 ——
>
> | 报错 | 在 IDEA 里你会看到 | 怎么办 |
> | --- | --- | --- |
> | `detached HEAD` | 顶部黄色提示条 | 用提示条上的 **New Branch from Here** 建分支，或直接 Checkout 回原分支 |
> | `non-fast-forward` 推送被拒 | Push 失败弹窗 | 先 `Ctrl+T` 更新再推，别顺手去点 Force Push |
> | 合并 / 变基冲突 | 文件节点显示 **Merge Conflicts**，双击开三栏工具 | 解决后点 Apply，再提交 |
> | `LF will be replaced by CRLF` | 通常不可见，但提交后整个文件都变了 | 见 [03 篇](/ops/git/basic) 的 `.gitattributes` 方案 |
> | `detected dubious ownership` | Git 功能整体失效，提示仓库不可用 | 照下面正文在命令行加 `safe.directory` |
> | 中文名显示成 `\344\270\255` | 提交窗 / Log 里显示成转义串 | 命令行 `core.quotepath false` 后重启 IDE |
>
> 还有一个 IDE 专属的排错入口见下一节：**Git Console 会原样打印 IDE 执行的每一条 git 命令。**

## 三、排查工具箱

卡住时，这些命令帮你"看 Git 到底在干什么"：

| 命令 | 作用 |
| --- | --- |
| `git fsck --full` | 全面体检对象库，列出悬空/损坏对象（救火/查损坏） |
| `git count-objects -vH` | 看仓库体积、悬空对象占用（`-H` 人类可读） |
| `git gc --prune=now` | 立即回收悬空对象、压缩仓库（清理用） |
| `git verify-pack -v <pack>` | 看某个 pack 文件里对象明细，定位大文件 |
| `git diff --check` | 只检查空白错误（行尾空格、制表符混用），不输出 diff |
| `GIT_TRACE=1 git <cmd>` | 打印 Git 内部执行细节（函数调用/命令），排疑难 |
| `GIT_CURL_VERBOSE=1 git pull` | 打印 HTTP 层细节，**排网络/代理问题利器** |
| `git config --list --show-origin` | 看每条配置从哪个文件来、最终生效哪条 |
| `git status --porcelain` | 机器友好的紧凑状态，写脚本/CI 用 |
| `git var -l` | 列出 Git 全部环境变量与配置（含 `GIT_AUTHOR` 等） |

::: tip 网络问题先开这两个
推拉不动、代理诡异时，先 `GIT_CURL_VERBOSE=1 git pull` 看 HTTP 请求到底卡在哪；想看 Git 内部流程用 `GIT_TRACE=1`。两个都能直接前缀在任意 `git` 命令前，无需持久配置。

> 💡 **在 IDEA 里**：**Git 工具窗 → Console** 标签是图形界面下排查 Git 问题最好用的东西 —— **IDEA 执行的每一条 git 命令、以及它的完整输出，都会打印在这里**，包括你从没见过的参数。
> 用法：从 IDE 里做的操作「结果不对」时，先来 Console 看它实际执行了什么，再原样拿到命令行复现；这里同时也接受手动敲命令，等于一个贴着项目根目录的内嵌终端。相比 `GIT_TRACE=1`，它省掉了自己搭环境那一步。

## 四、git bisect 二分查找实战

"功能昨天还好好的，今天挂了，是哪次提交搞的？"——`bisect` 在"好的提交"和"坏的提交"之间**二分查找**，约 `log2(N)` 次就能定位。1000 次提交也只需约 10 轮。

### 4.1 手动二分

```bash
git bisect start            # 进入二分模式
git bisect bad              # 标记当前（HEAD）为"坏的"
git bisect good v1.2.0      # 标记某个已知好的旧提交（也可用 <sha>）
# 之后 Git 自动 checkout 中间提交，你测试它好不好：
#   好 → git bisect good
#   坏 → git bisect bad
# Git 再跳到剩余区间的中点，循环直到只剩一个"首个坏提交"
git bisect reset           # 查完退出，HEAD 回到原分支
```

完整一次的真实会话（假设在 `v1.2.0` 与 `HEAD` 间查）：

```text
$ git bisect start
$ git bisect bad
$ git bisect good v1.2.0
Bisecting: 7 revisions left to test after this (roughly 3 steps)
[9f3a1c2] fix: 调整分页逻辑        ← Git 自动 checkout 到中间提交

# 在该提交上跑测试 / 启动验证
$ npm test
... 1 failing ...

$ git bisect bad                 # 这个提交已经是坏的
Bisecting: 3 revisions left to test after this (roughly 2 steps)
[e4b7d90] feat: 新增缓存层

$ npm test
... all pass ...

$ git bisect good                # 这个提交还是好的
Bisecting: 1 revision left to test after this (roughly 1 step)
[c1a2b3d] refactor: 重构查询入口

$ npm test
... 1 failing ...

$ git bisect bad
c1a2b3d is the first bad commit     ← 找到了！首个引入 bug 的提交
Author: 张三 <zhangsan@example.com>
Date:   Thu Sep 11 10:22:00 2025 +0800
    refactor: 重构查询入口

$ git bisect reset                # 收尾，回到原分支
```

### 4.2 自动化：`git bisect run`

如果"好/坏"能用一条命令判定（脚本返回退出码 **0 = good，非 0 = bad**），让 Git 全自动跑完：

```bash
# 写个判定脚本 test.sh：能跑通退出 0，挂了退出 1
cat > test.sh <<'EOF'
#!/bin/sh
npm test -- --watch=false >/dev/null 2>&1
EOF
chmod +x test.sh

git bisect start
git bisect bad HEAD
git bisect good v1.2.0
git bisect run ./test.sh        # 全自动二分，结束直接告诉你首个坏提交
git bisect reset
```

::: tip bisect 的三个要点
1. **`good`/`bad` 标记的是"提交状态"，不是"提交好坏评价"**——分别指"这个提交上 bug 不存在/存在"。
2. 遇到某次提交**编不过、无法判定**，用 `git bisect skip` 跳过，Git 会另选附近提交。
3. **务必 `git bisect reset` 收尾**，否则 HEAD 停在中间提交，容易误提交。

> 💡 **在 IDEA 里**：**`git bisect` 没有图形界面**，请照本节命令在 Terminal（`Alt+F12`）里做。
> IDE 能帮上的只有辅助判断：二分过程中 Git 会检出中间态，这时直接用 IDE 打开工程跑测试即可，比「命令行切换 + 另开编辑器」省事；但哪一步算「好」，仍要你自己判定。

## 五、效率与配置调优

### 5.1 必备别名合集（整段复制）

```bash
git config --global alias.st   "status -sb"
git config --global alias.co   "checkout"
git config --global alias.br   "branch -vv"
git config --global alias.cm   "commit -m"
git config --global alias.unstage "restore --staged"
git config --global alias.last "log -1 --stat"
git config --global alias.amend "commit --amend"
git config --global alias.undo "reset --soft HEAD~1"
git config --global alias.lg  "log --color --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"
git config --global alias.visual "!git log --graph --oneline --all"
```

之后 `git st` / `git co <branch>` / `git unstage <file>` / `git lg` 随手可用。

### 5.2 性能与体验调优

| 配置 | 命令 | 作用 |
| --- | --- | --- |
| 文件系统监视 | `git config --global core.fsmonitor true` | 大仓库状态查询大幅提速（Git 2.37+） |
| 并行抓取 | `git config --global fetch.parallel 0` | 多远程/子模块并行 fetch（`0`=自动） |
| 子模块并行 | `git config --global submodule.fetchJobs 4` | 子模块并行拉取 |
| 更优 diff | `git config --global diff.algorithm histogram` | 比默认 `myers` 更易读的差异 |
| 冲突显示祖先 | `git config --global merge.conflictStyle zdiff3` | 冲突块里多显示**共同祖先**，更易判断保留哪边 |
| 冲突解决复用 | `git config --global rerere.enabled true` | 同冲突只解一次（见 07 篇） |
| 首次 push 免 `-u` | `git config --global push.autoSetupRemote true` | Git 2.37+，首次 `git push` 自动建跟踪 |
| 关掉噪声提示 | `git config --global advice.statusUptodate false` | 减少无用 `advice.*` 提示 |

::: tip 两个最值得开
`merge.conflictStyle zdiff3`（冲突时多给祖先上下文，判断更准）+ `push.autoSetupRemote true`（第一次 push 不用记 `-u`）。这两项是"开了就回不去"的体验升级。

> 💡 **在 IDEA 里**：上面那些 `alias` **对 IDE 完全无效** —— IDE 是直接调 git 命令、不经过 shell。所以别名是给终端里的自己用的，别指望 IDE 因此变快。
> IDE 里对应「调优」的等价物是：**Keymap 改快捷键**、`Settings → Version Control → Git` 里的行为开关（自动 fetch、提交前检查等），以及下面提到的插件。

## 六、图形化与效率工具

命令行是根本，但可视化能显著降低认知负担。

| 工具 | 定位 | 适合 |
| --- | --- | --- |
| **VS Code 内置 Git** | 编辑器内看 diff、暂存单个 hunk、行级撤销 | 所有人，性价比最高 |
| **lazygit** | 终端 TUI，键盘流管理分支/提交/暂存 | 命令行老手 |
| **tig** | 终端提交树浏览器（只读为主） | 喜欢终端看 log 树 |
| **git-delta** | 替代默认 diff/pager，彩色语义化 diff | 常看 diff 的人 |
| **git-extras** | 一堆便捷子命令（`git summary` 等） | 想要更多现成命令 |
| **GitHub Desktop** | GUI，傻瓜式 clone/commit/PR | 图形界面偏好者、新手 |
| **SourceTree** | 功能全的桌面 Git 客户端 | 不想碰命令行的团队 |
| **TortoiseGit** | Windows 资源管理器右键集成 | Windows 重度用户 |

::: tip 结论：命令行 + VS Code 内置 Git 是最优组合
日常**提交/分支/推送用命令行**保证精确可控；**看 diff、挑 hunk、行级撤销用 VS Code 内置 Git 的可视化**（右侧对比、点 `+`/`-` 暂存单块）。这套组合零额外安装、学习成本最低、覆盖 95% 场景。lazygit / tig 是锦上添花，不是必须。

> 💡 **在 IDEA 里**：如果日常主力就是 IDEA，本节列的工具**大半可以不装** —— 自带的分支控件、Log 图、三栏合并工具已经覆盖了 Git GUI 的绝大部分需求。值得额外装的只有两类：**GitToolBox**（行内常驻 blame、自动 fetch，弥补 IDE 默认要手动开 Annotate）和 **.ignore**（`.gitignore` 语法高亮与模板）。
> 命令行仍不可替代的场合：`reflog` 救援、`bisect`、`filter-repo`、LFS、复杂的 submodule 操作 —— 也就是 [11 篇](/ops/git/idea) 最后列出的那些「IDE 不干的活」。

## 本篇小结

- 场景速查大表（30 行）覆盖撤销/回退/找回/对比/搬运/远程/暂存等高频意图，**复制替换 `<file>`/`<sha>`/`<branch>` 即用**。
- 20 类报错逐条给了"错误原文 → 原因 → 解决 → 预防"：`detached HEAD` 先建分支、`non-fast-forward` 先 `pull --rebase`、`unrelated histories` 加 `--allow-unrelated-histories`、冲突删标记后 `add`+`commit`、CRLF 配 `core.autocrlf`、公钥贴对、`413`/大文件走 LFS、乱码设 `core.quotepath false`。
- 排查工具箱：`git fsck --full` 体检、`git count-objects -vH` 看体积、`GIT_TRACE=1` / `GIT_CURL_VERBOSE=1` 看内部与网络、`git config --list --show-origin` 查配置来源。
- **`git bisect`**：`start`→`bad`→`good <sha>`→测→`good/bad` 循环→`reset` 收尾；脚本退出码 **0=good** 可 `git bisect run ./test.sh` 全自动；跳过用 `git bisect skip`。
- 效率别名：`st`/`co`/`br`/`unstage`/`last`/`amend`/`undo`/`lg` 整段可复制；进阶开 `core.fsmonitor`、`fetch.parallel`、`diff.algorithm=histogram`、`merge.conflictStyle=zdiff3`、`rerere.enabled`、`push.autoSetupRemote`。
- 工具结论：**命令行 + VS Code 内置 Git 可视化 diff** 是性价比最高组合，lazygit / tig / git-delta 按需补充。
- 所有"救火"类操作的共同前提：**动作要快**，悬空对象默认 30 天被 `gc` 清掉（详见 06 篇）。

## 参考链接

- [Pro Git 第 7 章：Git 工具 - 调试（bisect / blame）](https://git-scm.com/book/zh/v2/Git-%E5%B7%A5%E5%85%B7-%E8%B0%83%E8%AF%95)
- [git-bisect 官方手册](https://git-scm.com/docs/git-bisect)
- [git-fsck 官方手册](https://git-scm.com/docs/git-fsck)
- [git-config 官方手册（core.* / merge.* / push.*）](https://git-scm.com/docs/git-config)
- [git-stash 官方手册](https://git-scm.com/docs/git-stash)
- [git-cherry-pick 官方手册](https://git-scm.com/docs/git-cherry-pick)
- [git-remote 官方手册（set-url / prune）](https://git-scm.com/docs/git-remote)
- [git-delta 项目](https://github.com/dandavison/delta)
- [lazygit 项目](https://github.com/jesseduffield/lazygit)
- [tig 项目](https://jonas.github.io/tig/)

下一篇 → [11 在 IDEA 里用 Git](/ops/git/idea)
