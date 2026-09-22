# 04 文本处理三剑客

在 Linux 上 90% 的"数据"都是文本：日志、配置、CSV、接口返回……`grep`、`sed`、`awk` 被称为文本处理三剑客，因为它们能以极短的命令完成查找、编辑、统计这类脏活。本篇先讲清三者分工与正则基础，再逐一拆解常用参数和实战，最后用一条 Nginx 访问日志分析把三剑客和管道串起来。

## 一、为什么叫三剑客

三者各有所长，常配合管道使用：

```text
  grep   擅长"查找"     —— 按模式把匹配的行筛出来
  sed    擅长"编辑"     —— 按行做替换/删除/插入，流式的文本编辑器
  awk    擅长"按列处理" —— 把每行切成字段，做统计、报表、计算
```

共同点是：都支持正则表达式、都默认逐行处理、都常和 `|` 管道搭档。一句话记忆：**grep 找、sed 改、awk 算**。

## 二、正则表达式铺垫

这是学三剑客的前提。基本正则（BRE）与扩展正则（ERE）的区别：BRE 里 `{n,m}`、`()`、`+`、`|` 需要加反斜杠转义；ERE（用 `grep -E` / `sed -r` / `awk`）默认就是扩展语法，不用转义。

常用元字符：

```text
  ^        行首
  $        行尾
  .        任意单个字符
  *        前一个字符出现 0 次或多次
  []       字符集合，如 [0-9] [a-z]
  [^]      取反集合，如 [^0-9] 表示非数字
  \{n,m\}  BRE 下：前一个字符出现 n 到 m 次
  \( \)    BRE 下：分组
```

`\d \w \s` 这类 Perl 风格简写，**只有在 `grep -P`（PCRE）下才支持**，用 `grep -E` 不认。

5 个练习（用 `grep -P` 或 `grep -E`）：

```bash
# 匹配 IP（简化版，四个 0-255 的点分）
grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}' access.log

# 匹配手机号（中国大陆 1 开头的 11 位）
grep -E '1[3-9][0-9]{9}' users.txt

# 匹配邮箱
grep -Eo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' mail.txt

# 匹配空行（^$ 表示行首紧接行尾，中间什么都没有）
grep -n '^$' config.conf

# 匹配以 # 开头的注释行
grep -n '^#' config.conf
```

## 三、grep 全家桶

```bash
grep -i "error" app.log      # -i 忽略大小写
grep -v "debug" app.log      # -v 反向，排除匹配行
grep -n "error" app.log      # -n 显示行号
grep -r "timeout" /etc/      # -r 递归搜索目录
grep -E "error|warn" app.log # -E 扩展正则
grep -P "\d{4}-\d{2}-\d{2}"  # -P Perl 正则
grep -o "[0-9]+" app.log     # -o 只输出匹配的部分（不是整行）
grep -c "error" app.log      # -c 统计匹配行数
grep -l "main" *.c           # -l 只列出包含匹配的文件名
grep -A 10 "ERROR" app.log   # -A 10 同时显示匹配行之后 10 行
grep -B 5 "ERROR" app.log    # -B 5 显示之前 5 行
grep -C 3 "ERROR" app.log    # -C 3 前后各 3 行
grep --color "error" app.log # --color 高亮（多数发行版默认别名已开）
grep -w "cat" file           # -w 整词匹配，避免匹配 catalog
grep -q "ok" file && echo "找到了"   # -q 静默，只返回状态码用于判断
```

实战：

```bash
# 日志里找 ERROR 并看其后 10 行上下文
grep -A 10 "ERROR" /var/log/app.log

# 排除注释行和空行，看有效配置
grep -vE '^#|^$' nginx.conf

# 递归在代码里搜函数定义
grep -rn "def process" /opt/project/
```

## 四、sed 流编辑器

工作原理：逐行读入"模式空间" → 按命令处理 → 输出；**默认不修改原文件**。

```bash
sed -n '5p' file              # -n 静默；只打印第 5 行
sed -n '10,20p' file          # 打印 10 到 20 行
sed '3d' file                 # 删除第 3 行（仅输出，不改原文件）
sed 's/old/new/' file         # 每行第一个 old 替换为 new
sed 's/old/new/g' file        # g 全局替换（一行内所有）
sed 's/old/new/2' file        # 只替换第 2 次出现
sed 's#/old/#/new/#' file     # 分隔符可换，路径含 / 时用 # 更清爽
sed -i 's/old/new/g' file     # -i 直接改文件（危险）
sed -i.bak 's/old/new/g' file # -i.bak 改前先备份为 file.bak（好习惯）
sed -e 's/a/b/' -e 's/c/d/' file   # -e 多个表达式
```

地址定界（决定作用在哪行）：

```bash
sed '1,5d' file          # 删 1 到 5 行
sed '/^#/d' file         # 删所有以 # 开头的行
sed '/start/,/end/d' file # 删从 start 到 end 之间的行
sed '2i\插入的内容' file  # i 在指定行前插入
sed '2a\追加的内容' file   # a 在指定行后追加
sed '2c\整行替换' file     # c 把整行替换
```

6 个实战：

```bash
# 1. 注释掉含 "listen 8080" 的行
sed -i.bak 's/^listen 8080/#listen 8080/' nginx.conf

# 2. 批量替换配置里的旧域名
sed -i 's/old.example.com/new.example.com/g' /etc/nginx/conf.d/*.conf

# 3. 删除空行
sed -i '/^$/d' config.conf

# 4. 取第 20 到 30 行
sed -n '20,30p' bigfile.txt

# 5. 在文件第一行前插入注释
sed -i '1i\# 这是自动生成的配置' nginx.conf

# 6. 删除从 <VirtualHost> 到 </VirtualHost> 的整段
sed -i '/<VirtualHost>/,/<\/VirtualHost>/d' httpd.conf
```

## 五、awk 报表生成器

最难也最有用。核心模型是三段式：`BEGIN{}` 在处理前执行、`模式{}` 对每行处理、`END{}` 在处理后执行。

```bash
# 字段：默认以空白分割，$0 整行，$1 第一列，$NF 最后一列，$(NF-1) 倒数第二列
awk '{print $1}' file              # 打印第一列
awk '{print $1, $NF}' file         # 打印第一列和最后一列

# 内置变量：NR 当前行号，NF 当前行字段数，FNR 多文件时各自行号
awk '{print NR, $0}' file          # 带行号打印
awk 'NF>3 {print}' file            # 只打印字段数大于 3 的行

# FS 输入分隔符，OFS 输出分隔符；-F 指定分隔符
awk -F: '{print $1}' /etc/passwd          # 以 : 分割，取用户名
awk -F, 'BEGIN{OFS="|"} {print $1,$2}' data.csv   # 输入逗号、输出竖线

# BEGIN/END：统计求和
awk '{sum+=$1} END{print "总和:", sum}' nums.txt
```

条件与流程控制：

```bash
awk '$3 > 100 {print $1}' file     # 第三列大于 100 才打印
awk '{if($1>10) print "大"; else print "小"}' file
awk 'NR%2==0 {print}' file         # 只打印偶数行
```

5 个实战：

```bash
# 1. 取 ps 中 COMMAND 列（最后一列）
ps aux | awk '{print $NF}'

# 2. 统计日志里每个 IP 出现次数，按次数排序
awk '{print $1}' access.log | sort | uniq -c | sort -rn

# 3. 求某列总和与平均（如第 5 列是响应时间）
awk '{sum+=$5; n++} END{print "平均:", sum/n}' access.log

# 4. 按条件过滤并格式化输出（第三列大于 2M 的文件）
awk '$5 > 2097152 {printf "大文件: %s %d\n", $9, $5}' <(ls -l /data)

# 5. 统计每个状态码出现次数
awk '{print $9}' access.log | sort | uniq -c | sort -rn
```

## 六、其他文本小工具

```bash
cut -d: -f1 /etc/passwd          # -d 指定分隔符，-f 取第几列
sort -n -r -k2 data.txt          # -n 数值排序 -r 倒序 -k2 按第2列
sort -t, -k3 data.csv            # -t 分隔符
uniq -c counts.txt               # 去重并计数（必须先 sort）
wc -l file                       # 统计行数
tr 'a-z' 'A-Z' < file            # 大小写转换
diff a.txt b.txt                 # 比较两个文件差异
vimdiff a.txt b.txt              # 可视化对比
paste a.txt b.txt                # 左右拼接
split -l 1000 big.txt part_      # 按每 1000 行拆成多个文件
column -t data.txt               # 按列对齐成表格，便于人看
```

> `uniq` 必须先 `sort` 再 `uniq`，因为它只合并**相邻**的重复行。

统计访问日志 Top10 IP 的组合管道：

```bash
awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -10 | column -t
```

## 七、综合实战：分析 Nginx 访问日志

假设 Nginx 默认日志格式，一行形如：

```text
192.168.1.10 - - [22/Sep/2024:10:23:45 +0800] "GET /index.html HTTP/1.1" 200 1024 "..." "Mozilla/5.0"
```

逐步拆解：

```bash
# 1. 取 IP 列（第一列）
awk '{print $1}' access.log | head

# 2. 排序 + 去重计数，得到每个 IP 访问次数
awk '{print $1}' access.log | sort | uniq -c | head

# 3. 取访问最多的 Top10 IP
awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -10

# 4. 统计状态码分布（第 9 列）
awk '{print $9}' access.log | sort | uniq -c | sort -rn

# 5. 找出耗时最长的请求（$request_time 假设在第 12 列，需按实际 log_format 调整）
awk '{print $12, $7}' access.log | sort -rn | head -10

# 6. 统计每分钟 QPS（提取时间中的 时:分 部分做分组）
awk '{print substr($4, 2, 15)}' access.log | cut -d: -f1,2 | uniq -c
```

输出片段示例（Top IP）：

```text
  15230 192.168.1.10
   8932 10.0.0.5
   2104 203.0.113.8
```

掌握以上组合，日常日志分析基本不用写 Python，一条管道就出结果。

## 本篇小结

- **grep 找、sed 改、awk 算**：三者分工明确、都能接管道。
- 正则分 BRE 与 ERE，`grep -E` 开启扩展正则免转义。
- `\d \w \s` 等 Perl 简写只有 `grep -P` 支持。
- `grep -n` 带行号、`-A/-B/-C` 看上下文、`-v` 反向、`-o` 只取匹配。
- `sed` 默认不改原文件，`-i` 才改，改前用 `-i.bak` 备份。
- `sed 's/a/b/g'` 的 `g` 是整行全局替换，否则只换首个。
- `awk` 三段式 `BEGIN{} 模式{} END{}`，`$1` 第一列 `$NF` 最后一列。
- `awk` 内置 `NR`(行号) `NF`(列数) `FS`(输入分隔符) `OFS`(输出分隔符)。
- `uniq` 必须配合 `sort` 才有意义（只合并相邻重复）。
- `cut -d -f` 取列、`wc -l` 数行、`column -t` 对齐成表。
- 日志分析标准姿势：`awk 取列 | sort | uniq -c | sort -rn | head`。

## 参考链接

- [GNU Grep 文档](https://www.gnu.org/software/grep/manual/)
- [GNU Sed 文档](https://www.gnu.org/software/sed/manual/)
- [GNU Awk 文档（GAWK）](https://www.gnu.org/software/gawk/manual/)
- [正则表达式 30 分钟入门（RUNOOB）](https://www.runoob.com/regexp/regexp-tutorial.html)
- [AWK 简明教程（酷壳）](https://coolshell.cn/articles/9070.html)
- [Sed 简明教程（酷壳）](https://coolshell.cn/articles/9104.html)
- [man7: grep(1)](https://man7.org/linux/man-pages/man1/grep.1.html)
- [ explainshell（命令拆解工具）](https://explainshell.com/)

下一篇 → [05 Vim 编辑器](/ops/linux/vim)
