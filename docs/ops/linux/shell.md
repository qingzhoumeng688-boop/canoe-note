# 11 Shell 脚本编程

Shell 脚本是把一系列命令写进文件、交给 bash 自动执行的"批处理"。运维日常 80% 的重复活（备份、监控、清理、发布）都能用脚本自动化。本篇从第一个脚本讲起，覆盖变量、字符串、运算符、条件、循环、函数、数组、参数解析，最后给出 3 个可直接上生产的实战脚本和必须养成的脚本规范。

## 一、第一个脚本

```bash
#!/bin/bash
# 这是我的第一个脚本
echo "Hello, Linux"
```

- `#!/bin/bash` 叫 shebang，告诉系统用哪个解释器执行这个文件。
- 三种执行方式：

  ```bash
  bash hello.sh        # 直接用 bash 解释，不需要执行权限
  chmod +x hello.sh
  ./hello.sh           # 需要 x 权限，且当前目录要加点（直接 hello.sh 不行，PATH 里没有）
  source hello.sh      # 在当前 shell 环境执行，变量/函数会带回来（常用于加载配置）
  ```

- 调试：在 bash 后加 `-x` 会逐行打印"实际执行的命令"，排错神器：

  ```bash
  bash -x hello.sh
  ```

## 二、变量

定义和使用，第一个坑：**等号两边不能有空格**。

```bash
name="Tom"          # 正确
# name = "Tom"      # 错误！会被当成命令 name 加参数
echo "$name"        # 用 $ 取变量
echo "${name}cat"   # 用 ${} 界定边界，避免和后面字符粘连（推荐写法）
```

- `readonly` 定义只读变量，`unset` 删除变量：

  ```bash
  readonly PI=3.14
  unset name
  ```

- 环境变量用 `export` 导出，子进程才能继承；局部变量只在本脚本生效：

  ```bash
  export JAVA_HOME=/usr/local/jdk
  export PATH=$PATH:$JAVA_HOME/bin    # 把 jdk 的 bin 追加到 PATH，命令行才能直接敲 java
  ```

`PATH` 的作用：你敲 `ls`、`grep` 时系统按 `PATH` 里的目录顺序去找可执行文件。把自定义程序目录加进去，就能像系统命令一样直接调用。

特殊变量表（脚本里极常用）：

```text
  $0    脚本自身文件名
  $1    第 1 个参数，$2 第 2 个…… 
  $#    参数个数
  $?    上一条命令的退出码（0 成功，非 0 失败）
  $$    当前脚本的进程 PID
  $!    上一个后台进程的 PID
  $*    所有参数（看作一个整体字符串）
  $@    所有参数（看作独立单词列表）
```

`$*` 与 `$@` 加双引号后的区别：`"$*"` 把所有参数拼成一个字符串 `"a b c"`；`"$@"` 保持为独立的 `"a" "b" "c"`，**遍历参数时几乎永远该用 `"$@"`**：

```bash
for arg in "$@"; do
    echo "参数: $arg"
done
```

## 三、字符串与引号

单引号、双引号、无引号的区别，核心在于**变量替换和通配符展开**：

```bash
name="Tom"
echo '$name'        # 单引号：原样输出 $name（不替换变量）
echo "$name"        # 双引号：替换变量，输出 Tom（推荐，能防空格分割）
echo  $name_*       # 无引号：会做通配符展开，匹配当前目录 name_ 开头的文件
```

字符串常用操作：

```bash
s="hello world"
echo ${#s}             # 长度：11
echo ${s:2:5}          # 截取：从下标 2 取 5 个字符 → "llo w"
echo ${s/hello/hi}     # 替换首次：hi world
echo ${s//l/L}         # 全局替换：heLLo worLd

path="/var/log/nginx/access.log"
echo ${path##*/}       # 取文件名：access.log（贪婪删到最后一个 /）
echo ${path%/*}        # 取目录：/var/log/nginx（删掉最后一个 / 及其后）
```

## 四、运算符

- 算术运算：推荐 `$(( ))`，`$[ ]` 已废弃，`expr` 太啰嗦：

  ```bash
  echo $(( 3 + 5 * 2 ))     # 13
  a=10; echo $(( a++ ))     # 自增
  ```

- 浮点运算用 `bc`：

  ```bash
  echo "scale=2; 10 / 3" | bc    # 3.33
  ```

- 比较运算符：**整数用 `-eq -ne -gt -lt -ge -le`，字符串用 `= != -z -n`**：

  ```bash
  [ 5 -gt 3 ]           # 整数比较，成立
  [ "$name" = "Tom" ]   # 字符串相等
  [ -z "$var" ]         # 字符串为空则成立
  [ ! -z "$var" ]       # 非空则成立
  ```

- 逻辑：`&&`（与）、`||`（或）、`!`（非），以及 test 里的 `-a` `-o`：

  ```bash
  [ 5 -gt 3 ] && echo yes
  [ -f file -o -d dir ]   # file 是文件 或 dir 是目录
  ```

## 五、条件判断

`[ ]`、`[[ ]]`、`test` 三者关系：`test` 是底层命令，`[ ]` 是它的别名，`[[ ]]` 是 bash 增强版。**推荐 `[[ ]]`**：支持正则 `=~`、字符串比较更安全、不需要对 `<` `>` 转义。

```bash
# 文件测试符
[ -e file ]   # 文件存在
[ -f file ]   # 是普通文件
[ -d dir  ]   # 是目录
[ -r file ]   # 可读
[ -w file ]   # 可写
[ -x file ]   # 可执行
[ -s file ]   # 非空（大小大于 0）
```

`if` 完整结构：

```bash
if [ -f "/etc/nginx.conf" ]; then
    echo "配置文件存在"
elif [ -d "/etc/nginx" ]; then
    echo "是目录"
else
    echo "都没有"
fi
```

`case` 多分支（常用于处理命令参数）：

```bash
case "$1" in
    start)
        echo "启动服务"
        ;;
    stop)
        echo "停止服务"
        ;;
    *)
        echo "用法: $0 start|stop"
        ;;
esac
```

## 六、循环

```bash
# for in：遍历列表
for i in 1 2 3; do echo "第 $i 次"; done

# for (( ))：类 C 风格
for ((i=0; i<5; i++)); do echo $i; done

# while：条件成立就循环
while [ $count -lt 3 ]; do echo $count; count=$((count+1)); done

# until：条件不成立才循环（成立即停）
until [ $count -ge 3 ]; do echo $count; count=$((count+1)); done

# break / continue：同其它语言
# select：生成交互菜单
select choice in "北京" "上海" "退出"; do
    [ "$choice" = "退出" ] && break
    echo "你选了 $choice"
done
```

遍历文件 / 读文件每一行：

```bash
# 写法一：for 遍历（文件名含空格会出问题，不推荐读行）
for f in *.log; do echo "$f"; done

# 写法二：while read（正确读行姿势）
while IFS= read -r line; do
    echo "行内容: $line"
done < file.txt
```

`while read line` 的坑：如果写在管道右边（`cat file | while read line`），循环体在**子 shell** 里，里面改的变量出了循环就丢了；用上面的"输入重定向 `< file`"写法能避免。

## 七、函数

```bash
# 定义
say_hi() {
    echo "你好, $1"     # $1 是调用时传的第一个参数
}

# 调用
say_hi "Tom"

# 返回值：return 只能返回 0-255 的状态码，不是"结果"
add() {
    return $(( $1 + $2 ))    # 返回状态码，不直观
}
# 想要"拿到计算结果"，用 echo 输出、调用处用 $() 接收：
add() {
    echo $(( $1 + $2 ))
}
result=$(add 3 5)            # result=8

# 局部变量用 local，避免污染全局
counter() {
    local n=0
    n=$((n+1))
}
```

## 八、数组

```bash
arr=(redis nginx mysql)      # 定义
echo ${arr[0]}               # 取第一个：redis
echo ${arr[@]}               # 取全部元素
echo ${#arr[@]}              # 数组长度：3
arr[3]="etcd"                # 追加

# 遍历
for item in "${arr[@]}"; do
    echo "$item"
done

# 关联数组（键值对，需 declare -A 声明）
declare -A age
age["Tom"]=18
echo ${age["Tom"]}
```

## 九、交互与参数解析

```bash
# read -p 提示用户输入
read -p "请输入用户名: " user
echo "你输入了: $user"

# 判断参数个数（标准写法）
if [ $# -lt 1 ]; then
    echo "用法: $0 <文件名>"
    exit 1
fi

# getopts 解析选项（-a -b xxx 这种）
while getopts "f:n:" opt; do
    case $opt in
        f) file=$OPTARG ;;   # -f 后面的参数存到 OPTARG
        n) name=$OPTARG ;;
        *) echo "未知选项"; exit 1 ;;
    esac
done
echo "文件=$file 名字=$name"
```

## 十、综合实战

### ① 每日备份脚本

```bash
#!/bin/bash
# /opt/backup.sh —— 打包网站、按日期命名、保留 7 天、失败告警
set -euo pipefail

SRC=/data/www
DST=/backup/www
DATE=$(date +%F)

mkdir -p "$DST"

# 打包
if tar -zcf "$DST/www-$DATE.tar.gz" -C / "$SRC"; then
    echo "$(date) 备份成功" >> /var/log/backup.log
else
    echo "$(date) 备份失败" | mail -s "备份告警" admin@example.com
    exit 1
fi

# 只保留 7 天
find "$DST" -name "*.tar.gz" -mtime +7 -delete
```

### ② 服务健康检查脚本

```bash
#!/bin/bash
# /opt/health_check.sh —— curl 探活，失败自动重启并写日志
URL="http://127.0.0.1:8080/health"
LOG=/var/log/health.log

if ! curl -fsS --max-time 5 "$URL"; then
    echo "$(date) 服务异常，尝试重启" >> "$LOG"
    systemctl restart myapp
    sleep 3
    if curl -fsS --max-time 5 "$URL"; then
        echo "$(date) 重启后恢复" >> "$LOG"
    else
        echo "$(date) 重启仍失败，请人工介入" | mail -s "服务告警" admin@example.com
    fi
fi
```

### ③ 日志清理脚本（带安全判断）

```bash
#!/bin/bash
# /opt/clean_log.sh —— 按天数清理，先校验目录避免误删
set -u

TARGET=/var/log/myapp
DAYS=30

# 安全检查：目录必须存在且不是根，防止变量为空删到 /
if [ -z "$TARGET" ] || [ "$TARGET" = "/" ]; then
    echo "目标目录非法，退出"
    exit 1
fi
[ -d "$TARGET" ] || { echo "$TARGET 不存在"; exit 1; }

find "$TARGET" -type f -name "*.log" -mtime +"$DAYS" -delete
echo "$(date) 已清理 $DAYS 天前的日志"
```

## 十一、脚本规范与坑

强烈建议每个脚本开头都加：

```bash
set -e          # 任一条命令失败（返回非0）立即退出，避免错误被掩盖继续执行
set -u          # 用到未定义变量直接报错（防拼写错误导致空值）
set -o pipefail # 管道中任一段失败，整条管道都算失败（默认只看最后一段）
```

其它规范：
- 变量加双引号 `"$var"`，防含空格被拆成多段；
- 路径用**绝对路径**，别依赖当前目录；
- 命令替换用 `$()` 而非反引号，可读性更好；
- 脚本要有日志输出和错误处理，让出问题能追溯。

## 本篇小结

- **`#!/bin/bash`** 指定解释器，`./脚本` 执行需 `chmod +x`。
- 变量赋值 **等号两边不能有空格**，取用推荐 `${var}` 写法。
- `export` 导出环境变量让子进程继承，`PATH` 决定命令去哪找。
- 特殊变量 `$0/$1/$#/$?/$$` 在脚本里高频使用。
- 单引号不替换变量、双引号替换且防空格、无引号会通配展开。
- 整数比较用 `-eq -gt`，字符串用 `= -z`，浮点用 `bc`。
- 条件判断优先用 `[[ ]]`，支持正则且更安全。
- 读文件每行用 `while IFS= read -r line; do ... done < file`。
- 函数用 `echo` 返回结果、`local` 声明局部变量。
- 遍历参数用 `"$@"` 而非 `$*`，保持参数独立。
- 解析选项用 `getopts`，交互用 `read -p`。
- 脚本开头必加 `set -euo pipefail`，变量加引号、用绝对路径。

## 参考链接

- [Bash 官方手册（GNU）](https://www.gnu.org/software/bash/manual/)
- [Bash 参考卡片（TLDP）](https://tldp.org/LDP/Bash-Beginners-Guide/)
- [Shell 检查工具 ShellCheck](https://www.shellcheck.net/)
- [Advanced Bash-Scripting Guide](https://tldp.org/LDP/abs/html/)
- [菜鸟教程：Shell 教程](https://www.runoob.com/linux/linux-shell.html)
- [Google Shell 风格指南](https://google.github.io/styleguide/shellguide.html)
- [Bash 严格模式讲解](https://blog.frontendhero.dev/unofficial-bash-strict-mode/)
- [man7: bash(1)](https://man7.org/linux/man-pages/man1/bash.1.html)

下一篇 → [12 重定向、管道与定时任务](/ops/linux/redirect-cron)
