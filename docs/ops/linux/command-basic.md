# 03 文件与目录常用命令

本篇是 Linux 运维的"基本功"章节。无论是排查问题还是部署服务，绝大多数操作都建立在文件与目录操作之上。我们不讲花哨的参数，只把日常最高频的命令（`ls`、`cp`、`rm`、`find`、`tar`、`grep` 配合通配符等）讲透，让你拿到一台新机器就能顺手干活，也避免 `rm -rf` 这类命令酿成事故。

## 一、命令的格式与帮助

Linux 命令的统一形态是 `命令 [选项] [参数]`。选项用来改变命令的行为，参数通常是作用的对象（文件、目录、关键字）。

```bash
ls -l /var/log          # 命令=ls 选项=-l 参数=/var/log
```

选项有两种风格：

- **短选项**：以 `-` 开头，可叠加组合，例如 `-a -l` 通常简写为 `-al`。
- **长选项**：以 `--` 开头，可读性更好，例如 `--all` 等价于 `-a`。

```bash
ls -al                  # 等价于 ls -a -l
ls --all --human-readable
```

记不住命令怎么办？下面这套"查帮助四件套"是入场券：

```bash
ls --help               # 命令自带的简要帮助，最常用
man ls                  # 完整手册页，按 / 搜索、q 退出
info ls                # 比 man 更结构化的超文本文档（较少用）
whatis ls              # 一句话说明命令用途
apropos "list directory"  # 按关键词反查命令，记不住名字时很有用
```

`man` 手册分为多个章节，数字代表命令类型。最常见的两类是 `man 1`（普通用户命令，如 `ls`）和 `man 5`（配置文件格式，如 `fstab`、`crontab`）。查配置文件时务必带章节号，否则可能打开错误的页面：

```bash
man 5 crontab          # 看 crontab 配置文件的语法，而不是 crontab 命令本身
```

## 二、目录操作

| 命令 | 作用 | 高频选项 |
| --- | --- | --- |
| `pwd` | 显示当前所在绝对路径 | 无 |
| `cd` | 切换目录 | `cd -` 回到上一次目录，`cd ..` 上级 |
| `ls` | 列出目录内容 | 见下方逐项说明 |
| `mkdir` | 创建目录 | `-p` 递归创建 |
| `rmdir` | 删除空目录 | 非空用 `rm -r` |

`ls -l` 的每一列都藏着信息，必须能一眼读懂：

```bash
ls -l /etc/hosts
# -rw-r--r--. 1 root root 158 4月  1 10:00 /etc/hosts
```

逐列解释（以 `-rw-r--r--. 1 root root 158 ...` 为例）：

1. **第 1 列权限/类型**：首字符 `-` 表示普通文件，`d` 目录，`l` 软链接；后面 9 位分属主/属组/其他人，每 3 位为 `rwx`（读/写/执行）。末尾的 `.` 表示启用了 SELinux 安全上下文。
2. **第 2 列硬链接数**：文件被多少个硬链接指向，目录则至少是 2（`.` 和自身）。
3. **第 3 列属主**：文件的拥有者，这里是 `root`。
4. **第 4 列属组**：文件所属的用户组。
5. **第 5 列大小**：默认以字节为单位，配合 `-h` 自动换算成 K/M/G。
6. **第 6 列时间**：文件的最后修改时间（`mtime`）。
7. **第 7 列名称**：文件名或目录名。

`ls` 的常用选项组合：

```bash
ls -lh               # 人类可读的大小（K/M/G）
ls -la               # 包含隐藏文件（以 . 开头）
ls -lt               # 按修改时间倒序（最新在上）
ls -ltr              # -r 反向，最新在最后，看最旧文件用
ls -R                # 递归列出子目录
ls -ld /var/log      # -d 只列出目录本身，不展开内容
```

`mkdir -p` 是创建多层目录的救星，父目录不存在会一并建立：

```bash
mkdir -p /data/app/logs      # 一次性建好三层，不会因为父目录不存在报错
```

## 三、文件操作

| 命令 | 作用 | 关键选项 |
| --- | --- | --- |
| `touch` | 创建空文件或更新时间戳 | 无 |
| `cp` | 复制 | `-r` 递归、`-p` 保留属性、`-a` 归档、`-i` 覆盖前确认 |
| `mv` | 移动或重命名 | 同一分区内是"改名"，跨分区才是"移动+删除" |
| `rm` | 删除 | `-r` 递归、`-f` 强制、`-i` 交互确认 |
| `file` | 识别文件真实类型 | 看魔数，不靠后缀 |
| `stat` | 查看文件详细元数据 | 含三个时间、inode、权限 |

```bash
touch app.log                      # 不存在则创建，存在则更新访问/修改时间
cp -a /data/app /data/app_bak      # -a 保留所有属性，常用于整目录备份
mv app.jar app.jar.bak            # 同目录下就是重命名
mv app.jar /data/app/             # 移动到别的目录
rm -rf /tmp/test                  # 递归强制删除（极度危险，见下文）
file weirdfile                     # 输出如 "ELF 64-bit executable" 或 "PNG image"
stat app.jar                       # 看 Atime/Mtime/Ctime、大小、inode
```

`cp -a` 与 `cp -r` 的区别：`cp -a` 是归档模式，会连同权限、属主、时间戳原封不动复制，是做**备份**的首选；`cp -r` 只做递归复制，可能丢失属性。

**`rm -rf` 的危险性与防护**。这是运维圈"删库跑路"的主角，几个真实翻车案例：

- 变量未赋值就拼接路径：`rm -rf $DIR/`，结果 `$DIR` 为空，变成 `rm -rf /`。
- 多打一个空格：`rm -rf / tmp/x`，系统当场没了一半。
- 在错误目录下执行 `rm -rf *`。

防护手段：

```bash
alias rm='rm -i'                 # 覆盖前逐一确认（root 用户建议默认加上）
# 更稳妥：用 trash-cli 代替真正的删除，误删可恢复
yum install -y trash-cli         # 或 apt install trash-cli
trash /tmp/test                  # 进回收站而非直接消失
```

习惯上，删之前先 `ls` 看一眼目标，确认无误再替换为 `rm`，宁可多一步也不要事后救火。

## 四、查看文件内容

| 命令 | 作用 |
| --- | --- |
| `cat` | 一次性输出全部内容 |
| `tac` | 逆序输出（最后一行在最上） |
| `more` | 分页查看，只能向下翻 |
| `less` | 分页查看，可上下翻、可搜索，首选 |
| `head -n` | 看开头 n 行 |
| `tail -n` | 看末尾 n 行 |
| `wc` | 统计行数/词数/字节数 |

`less` 是日常查看日志的主力，掌握交互键能极大提升效率：

```bash
less app.log
```

进入 `less` 后常用的键：

- `/关键字` 向下搜索，`?关键字` 向上搜索，`n` 跳到下一个匹配。
- `G` 跳到文件末尾，`gg` 跳到开头。
- `F` 进入实时追踪模式（类似 `tail -f`），`Ctrl+C` 退出追踪回到浏览。
- 方向键/PageUp/PageDown 翻页，`q` 退出。

查看大文件首尾：

```bash
head -n 20 app.log               # 看前 20 行
tail -n 50 app.log               # 看最后 50 行
wc -l app.log                    # 统计总行数
```

**`tail -f` 与 `tail -F` 的区别**（追日志必用）：

- `tail -f app.log`：按文件描述符跟踪，文件被重命名或轮转后，它还在跟踪"那个旧文件"。
- `tail -F app.log`：按文件名跟踪，文件被删除重建后仍能继续追到新内容，适合有 `logrotate` 的场景。

```bash
tail -f app.log                  # 日志轮转后可能"追丢"
tail -F app.log                  # 轮转友好，生产环境推荐
```

## 五、查找命令 find

`find` 是 Linux 下最强大的文件查找工具，语法是 `find 路径 条件 动作`。它实时遍历磁盘，结果精准，代价是比基于数据库的工具慢。

按名字查找：

```bash
find /var/log -name "*.log"          # 精确匹配后缀
find /etc -iname "*.CONF"            # -i 忽略大小写
```

按类型查找，`-type f` 文件、`d` 目录、`l` 软链接：

```bash
find /data -type d -name "logs"      # 找名为 logs 的目录
```

按大小，`+` 表示大于、`-` 表示小于，单位 `k`/`M`/`G`：

```bash
find / -type f -size +100M           # 找大于 100M 的大文件
find . -type f -size -10k            # 找小于 10K 的小文件
```

按时间，**`-mtime`（修改时间）是最容易用错的**：

- `-mtime +7`：修改时间 **大于（更早于）** 7 天前，即 7 天以前的文件。
- `-mtime -7`：修改时间在 **最近 7 天内** 的文件。
- `-mtime 7`：恰好第 7 天当天（实际很少用，区间很窄）。

```bash
find /var/log -name "*.log" -mtime +7      # 7 天前的旧日志
find /var/log -name "*.log" -mtime -1      # 最近 1 天产生的日志
```

按权限找 SUID 文件（安全排查常用，SUID 文件可被提权，需定期检查）：

```bash
find / -type f -perm -4000 2>/dev/null     # 找所有带 SUID 位的文件
```

组合条件 `-a`（与）、`-o`（或）、`!`（非）：

```bash
find /data -type f -name "*.tmp" -o -name "*.bak"   # 找 tmp 或 bak
find /data -type f ! -user root                     # 不是 root 拥有的文件
```

动作：`-delete` 直接删、`-exec` 对结果执行命令、`-maxdepth` 限制搜索深度：

```bash
# 找 7 天前的日志并删除（先不带 -delete 跑一遍确认，再执行）
find /var/log -name "*.log" -mtime +7 -delete

# 对找到的 .jpg 执行 ls -l（{} 代表每个结果，\; 结束）
find . -name "*.jpg" -exec ls -lh {} \;

# 只查当前目录，不下钻子目录
find . -maxdepth 1 -type f -name "*.conf"
```

六个实战例子汇总：

```bash
find / -type f -size +500M -exec ls -lh {} \;     # 1. 全盘找大于 500M 的文件
find /var/log -name "*.log" -mtime +7 -delete     # 2. 删 7 天前日志
find / -type f -perm -4000 2>/dev/null            # 3. 找 SUID 提权文件
find . -type f -mmin -60                          # 4. 最近 60 分钟改过的文件
find /data -type d -name node_modules             # 5. 找所有 node_modules 目录
find . -type f -name "*.sh" -exec chmod +x {} \;  # 6. 给所有脚本加执行权限
```

## 六、其他查找

`find` 是实时扫盘，慢但准。下面几个工具各有侧重：

| 命令 | 原理 | 特点 |
| --- | --- | --- |
| `locate` | 查预建数据库 | 极快但不实时，需 `updatedb` |
| `which` | 查 `PATH` 中的可执行文件 | 只找命令，返回绝对路径 |
| `whereis` | 查二进制+源码+手册 | 比 `which` 范围略宽 |
| `type` | shell 内建，识别别名/内建/外部 | 判断命令到底是什么 |
| `command -v` | 脚本里探命令是否存在 | 推荐在脚本中使用 |

```bash
locate nginx.conf              # 秒级返回，但可能漏掉刚建的文件
sudo updatedb                  # 手动更新数据库
which java                    # /usr/bin/java
whereis java                  # java: /usr/bin/java /usr/share/man/...
type ls                       # ls 是 cp 的别名 / 或 ls is aliased to ...
command -v git >/dev/null || echo "git 未安装"   # 脚本里判断命令是否存在
```

`command -v` 在写 shell 脚本时特别有用，可以先判断依赖命令是否就绪再往下执行。

## 七、打包压缩

先厘清**打包**与**压缩**是两件事：`tar` 负责把一堆文件"粘"成一个文件（不减小体积），`gzip`/`bzip2`/`xz` 负责压缩。常见格式对比：

| 格式 | 命令 | 压缩率 | 速度 | 备注 |
| --- | --- | --- | --- | --- |
| `.tar` | `tar -cf` | 无 | 最快 | 只打包不压缩 |
| `.tar.gz` | `tar -zcf` | 中 | 快 | 最通用 |
| `.tar.bz2` | `tar -jcf` | 较高 | 慢 | CPU 占用高 |
| `.tar.xz` | `tar -Jcf` | 最高 | 最慢 | 日志/源码归档首选 |
| `.zip` | `zip -r` | 中 | 快 | 跨平台，Windows 也能解 |

`tar` 选项拆解：

- `-c` 创建、`-x` 解包、`-t` 查看列表（不解包）。
- `-v` 显示过程、`-f` 指定文件名（必须紧跟文件名）。
- `-z` gzip、`-j` bzip2、`-J` xz。
- `-C` 指定解压/打包的目录、`-p` 保留权限、`--exclude` 排除。

```bash
tar -zcvf app.tar.gz /data/app           # 打包并 gzip 压缩
tar -jcvf app.tar.bz2 /data/app          # bzip2 压缩
tar -Jcvf app.tar.xz /data/app           # xz 压缩（最高压缩率）
tar -ztvf app.tar.gz                     # 不解包，先看看里面有什么
tar -zcvf app.tar.gz /data/app --exclude=/data/app/logs   # 排除 logs 目录
```

**解压"散一地"的坑**：直接 `tar -zxvf app.tar.gz` 会把文件解到当前目录，如果包里没有顶层目录，就会铺满当前路径。正确姿势是先用 `-t` 看一眼，再用 `-C` 解到指定目录：

```bash
tar -ztvf app.tar.gz                    # 先看目录结构
tar -zxvf app.tar.gz -C /data/app/     # 解到目标目录，整齐不污染
```

`zip`/`unzip` 跨平台：

```bash
zip -r app.zip /data/app               # 压缩（-r 递归）
unzip app.zip -d /tmp/app              # 解压到指定目录
```

## 八、通配符与转义

shell 通配符（glob）和正则不是一回事。通配符是 shell 在调用命令前就展开的路径匹配，正则才是 `grep`、`sed` 内部用的模式。

| 通配符 | 含义 | 示例 |
| --- | --- | --- |
| `*` | 任意长度任意字符 | `*.log` 所有日志 |
| `?` | 单个任意字符 | `app?.jar` app 后一个字符 |
| `[]` | 字符集之一 | `[abc].txt` |
| `{}` | 枚举展开 | `mv app.{jar,bak}` |

引号与命令替换的区别是新手高频坑：

| 写法 | 名称 | 行为 |
| --- | --- | --- |
| `'...'` | 单引号 | 强引用，里面的一切原样输出，变量不展开 |
| `"..."` | 双引号 | 弱引用，变量、命令替换仍生效 |
| `` `...` `` | 反引号 | 命令替换（老写法） |
| `$(...)` | 美元括号 | 命令替换（推荐，可嵌套） |

```bash
name=canoe
echo '$name'          # 输出 $name（不展开）
echo "$name"          # 输出 canoe（展开）
echo "当前时间：$(date)"   # 推荐写法：命令替换
echo "列表：$(ls)"         # 比反引号可读性好，且支持嵌套
```

转义用反斜杠 `\`，让特殊字符失去特殊含义：

```bash
echo 3 \* 5 = 15        # 输出 3 * 5 = 15
rm -rf \*.tmp          # 删名为 *.tmp 的文件，而不是所有 tmp（极端谨慎）
```

## 九、常用快捷键与别名

掌握 shell 快捷键能让命令行操作效率翻倍：

| 快捷键 | 作用 |
| --- | --- |
| `Tab` | 自动补全命令/路径，双击列出候选 |
| `Ctrl+C` | 中断当前前台进程 |
| `Ctrl+Z` | 把前台进程挂起到后台（暂停） |
| `Ctrl+D` | 关闭当前 shell 会话（等价 exit） |
| `Ctrl+L` | 清屏（等价 clear） |
| `Ctrl+A` | 光标跳到行首 |
| `Ctrl+E` | 光标跳到行尾 |
| `Ctrl+U` | 删除光标到行首的内容 |
| `Ctrl+K` | 删除光标到行尾的内容 |
| `Ctrl+R` | 反向搜索历史命令 |

别名可以给自己常用命令"减负"，写在 `~/.bashrc` 里持久化：

```bash
alias ll='ls -lh'
alias rm='rm -i'
alias grep='grep --color=auto'
```

如果某次想临时绕过别名（比如绕开 `rm -i` 的询问），在命令前加反斜杠：

```bash
\rm -rf /tmp/test      # 忽略 rm 别名，直接执行原始 rm
```

## 本篇小结

- **命令统一形态**是 `命令 [选项] [参数]`，短选项可叠加，长选项可读性更好。
- **查帮助优先**用 `--help` 和 `man`，配置文件记得带 `man 5` 章节号。
- **`ls -l` 七列**分别对应权限、硬链接数、属主、属组、大小、时间、名称。
- **`cp -a` 适合备份**，会完整保留权限与时间等元数据。
- **`rm -rf` 极度危险**，建议用 `rm -i` 别名或 `trash-cli` 替代，删除前先 `ls` 确认。
- **`less` 是看日志首选**，`/` 搜索、`F` 实时追踪、`G/gg` 跳转首尾。
- **`tail -F` 比 `tail -f` 更安全**，文件轮转后仍能继续追踪。
- **`find` 的 `-mtime +7` 是 7 天前**，`-7` 是最近 7 天，方向别搞反。
- **`locate` 快但不实时**，依赖数据库，需 `updatedb` 更新。
- **解压前先 `tar -tf` 看结构**，用 `-C` 指定目录避免散一地。
- **单引号强引用、双引号弱引用、推荐 `$(...)` 做命令替换**。

## 参考链接

- [Linux 命令大全（菜鸟教程）](https://www.runoob.com/linux/linux-command-manual.html)
- [GNU Coreutils 手册](https://www.gnu.org/software/coreutils/manual/coreutils.html)
- [tar 官方文档](https://www.gnu.org/software/tar/manual/tar.html)
- [findutils 官方文档](https://www.gnu.org/software/findutils/manual/find.html)
- [Bash 参考手册](https://www.gnu.org/software/bash/manual/bash.html)
- [Arch Wiki - Core utilities](https://wiki.archlinux.org/title/Core_utilities)

下一篇 → [04 文本处理三剑客](/ops/linux/text-tools)
