# 12 重定向、管道与定时任务

Shell 最强大的能力之一，是把一堆小程序用"重定向"和"管道"串成数据流水线，再用"定时任务"让它在后台自动跑。本篇先讲清楚 stdin/stdout/stderr 三个文件描述符，再拆解重定向与管道的所有符号和坑，最后用 `crontab` 把脚本变成定时自动执行的任务——这是运维日常写监控、备份、清理脚本的基石。

## 一、标准输入输出

Linux 里一切皆文件，每个进程启动时会默认打开三个"文件描述符"（fd）：

```text
  fd 0  stdin   标准输入   默认来自键盘（终端）
  fd 1  stdout  标准输出   默认送到终端屏幕
  fd 2  stderr  标准错误   默认也送到终端屏幕
```

可以把它们想象成进程身上的三个"水龙头"：0 号管"喂进去什么"，1 号和 2 号管"吐出来什么"，只不过 1 是正常结果、2 是报错信息。默认 1 和 2 都流向同一块屏幕，所以平时你分不清哪些是正常输出、哪些是错误——但重定向可以分别接管它们。

## 二、重定向

重定向就是改变这三个 fd 的流向。常用符号：

```bash
command > file     # 把 stdout（1）覆盖写入 file（文件原有内容被清空）
command >> file    # 把 stdout 追加到 file 末尾
command < file     # 把 file 内容作为 stdin（0）喂给 command
command 2> file    # 只把 stderr（2）写入 file
command 2>> file   # 把 stderr 追加
command &> file    # 把 stdout 和 stderr 一起写入 file（bash 写法）
command > file 2>&1  # 等价上面的 &>，但顺序不能反（见下）
command 2>&1 | less  # 先让 2 合并到 1，再走管道
```

`> file 2>&1` 为什么顺序不能反？重定向从左到右解析：`2>&1` 表示"把 2 指向当前 1 所指向的地方（此时还是屏幕）"，必须**先**重定向 1 到文件、再让 2 指向 1，才能两个都进文件。如果写成 `2>&1 > file`，会先让 2 指向屏幕，再把 1 指向文件，结果错误日志仍落回屏幕。所以记住口诀：**先定 1，再让 2 跟 1**。

其它有用的"特殊文件"与写法：

```bash
command > /dev/null        # /dev/null 是黑洞，丢弃 stdout
command 2> /dev/null       # 丢弃错误（常见：不关心报错时）
command < /dev/zero        # /dev/zero 是无限 \0 源，常用造大文件
dd if=/dev/zero of=test bs=1M count=100   # 造一个 100M 的 test 文件

# here document：把一段文本作为 stdin 喂给命令
cat > config.conf <<EOF
server {
    listen 80;
    root /data/www;
}
EOF

# here string：把字符串直接作为 stdin
grep -q "8080" <<< "port=8080"
```

重定向速查表：

```text
  >    覆盖写 stdout
  >>   追加写 stdout
  <    文件作为 stdin
  2>   覆盖写 stderr
  2>>  追加写 stderr
  &>    stdout+stderr 一起覆盖写（bash）
  >&   file 2>&1 的等价但需注意顺序
  <<EOF  here document（多行输入）
  <<<    here string（单行输入）
```

## 三、管道

管道 `|` 的本质：把**前一个命令的 stdout（fd 1）接到后一个命令的 stdin（fd 0）**。它只传 stdout，不传 stderr。

```bash
ls -l /etc | less          # 长列表分页看
ps aux | grep nginx         # 过滤进程
```

**为什么管道里拿不到 stderr**：因为管道只接 1 号口。想连错误一起处理，要先 `2>&1`：

```bash
# 把错误也送进 grep 一起过滤（先合并再管道）
find / -name "*.conf" 2>&1 | grep "Permission"
```

管道常和 `xargs` 配合，把前一条命令的输出变成后一条命令的参数：

```bash
# 找到 7 天前的日志并删除
find /var/log -name "*.log" -mtime +7 | xargs rm -f

# 文件名带空格或特殊字符时，用 -print0 + xargs -0 避免被拆成多段
find /data -type f -print0 | xargs -0 rm -f
```

`xargs` 与 `find -exec` 的区别：`find ... -exec rm {} \;` 每找到一个就执行一次命令（N 个文件执行 N 次），而 `xargs` 会尽量把参数拼成一批（一次执行多个），效率更高；但参数过长或文件名含空格时要用 `-print0 | xargs -0` 才安全。

## 四、tee 与重定向组合

`tee` 像是三通管：一份输出同时流向屏幕和文件。

```bash
command | tee result.log          # 既在屏幕看，又存到 result.log（覆盖）
command | tee -a result.log       # 追加模式
```

一个经典坑：`sudo echo "xxx" > /etc/file` 会报"权限不足"。因为重定向 `>` 由**当前 shell**（非 root）执行，sudo 只罩住了 `echo`。解决：让 `tee` 在 sudo 下写文件：

```bash
# 正确姿势：把内容通过管道交给 sudo tee 写文件
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-forward.conf

# 只写文件、屏幕上不显示，可再丢给 /dev/null
echo "options mydriver" | sudo tee /etc/modprobe.d/mydriver.conf > /dev/null
```

## 五、crontab 定时任务

`cron` 是后台守护进程，按你编辑的 `crontab` 时间表自动执行命令。本篇重点。

```bash
crontab -e    # 编辑当前用户的定时任务（首次会让你选编辑器）
crontab -l    # 列出当前任务
crontab -r    # 删除当前用户的所有任务（危险！见下）
```

五个时间字段语法：`分 时 日 月 周`，取值与特殊符号：

```text
  字段      取值       含义
  分        0-59       第几分钟
  时        0-23       第几小时
  日        1-31       几号
  月        1-12       几月
  周        0-7        周几（0 和 7 都代表周日）

  特殊符号：
  *    任意值（每分/每时/每日……）
  ,    列举（如 1,15 表示 1 和 15）
  -    区间（如 9-18 表示 9 到 18）
  /    步长（如 */5 表示每 5 个单位）
```

10 个示例表达式：

```bash
* * * * *  command          # 每分钟执行一次
0 * * * *  command          # 每小时的第 0 分钟（整点）
30 2 * * * command          # 每天 02:30
0 0 * * 0  command          # 每周日 00:00
0 2 1 * *  command          # 每月 1 号 02:00
*/5 * * * * command          # 每 5 分钟
0 9-18 * * 1-5 command      # 工作日 9 点到 18 点整点（朝九晚六）
0,30 * * * * command         # 每小时的 0 分和 30 分
30 2 1,15 * * command        # 每月 1 号和 15 号 02:30
0 0 1 1 *  command          # 每年 1 月 1 日 00:00
```

还有几个预定义简写：

```bash
@reboot  command    # 开机时执行一次
@daily   command    # 每天（等价于 0 0 * * *）
@weekly  command    # 每周
@monthly command    # 每月
@yearly  command    # 每年
```

> **`crontab -r` 删库的梗**：`-r` 会**毫无确认地清空你全部定时任务**。很多人想 `-l` 查看却手滑成 `-r`。标准姿势：删之前先备份 `crontab -l > cron.bak`，要恢复就 `crontab cron.bak`。

## 六、crontab 的坑

写 cron 最容易踩的坑，几乎都和"cron 不是交互式终端"有关：

1. **环境变量/PATH 不同**：cron 的 PATH 很短（通常只有 `/usr/bin:/bin`），脚本里手敲的 `python`、`mysqldump` 可能找不到——手动能跑、cron 里报错 `command not found`。
   - 解决：脚本里用**绝对路径**，或在 crontab 顶部显式声明：

     ```bash
     PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
     ```

2. **没有终端，输出要重定向**：cron 默认把输出以邮件发给用户，没配邮件就会丢进 `/var/spool/mail`。规范的写法把输出落到日志：

   ```bash
   0 2 * * * /opt/backup.sh >> /var/log/backup.log 2>&1
   ```

3. **`%` 要转义**：cron 里 `%` 是换行符，命令里用到（如 `date +%F`）必须写成 `\%`：

   ```bash
   0 2 * * * tar -zcf /backup/site-$(date +\%F).tar.gz /data/www
   ```

4. **日志查看**：`/var/log/cron`（RHEL 系）或 `grep cron /var/log/syslog`（Debian 系）可看执行记录。

5. **权限与白名单**：`/etc/cron.allow` 存在时，只有其中的用户能用 cron；`/etc/cron.deny` 列出被禁用的用户。

写 cron 的标准姿势 checklist：

```text
  ① 脚本里命令用绝对路径，或 crontab 顶部设 PATH
  ② 所有输出重定向到日志文件（2>&1）
  ③ 命令里的 % 转义为 \%
  ④ 时间字段前加注释说明用途
  ⑤ 改完 crontab -l 核对，并备份到 bak 文件
```

## 七、at 一次性任务与 anacron

`at` 用于"只跑一次"的将来任务：

```bash
echo "shutdown -h now" | at 23:30          # 今晚 23:30 关机
at now + 1 hour <<EOF                      # 1 小时后执行
/usr/local/bin/optimize.sh
EOF
atq                                        # 查看待执行队列
atrm 3                                     # 删除第 3 号任务
```

`batch` 与 `at` 类似，但只在系统负载低于阈值时才执行。

`anacron` 解决"关机错过定时任务"的问题：它会记录上次运行时间，开机后若发现该跑的没跑（比如笔记本合盖错过了凌晨备份），就补跑一次。服务器常年开机用不上，但笔记本/台式机常用。

现代替代方案是 **systemd timer**，精度更高、可设随机延迟、带日志：

```ini
# /etc/systemd/system/backup.timer
[Unit]
Description=Daily backup timer

[Timer]
OnCalendar=*-*-* 02:00:00     # 每天 02:00
Persistent=true               # 错过（关机）后开机补跑，等价于 anacron

[Install]
WantedBy=timers.target
```

配套 `backup.service` 用 `systemctl enable --now backup.timer` 启用。

## 八、实战：定时备份与同步

需求：每天 02:00 备份 MySQL，本地保留 7 天，同步到备份机，失败就告警。

```bash
#!/bin/bash
# /opt/mysql_backup.sh —— MySQL 定时备份
set -euo pipefail

BACKUP_DIR=/backup/mysql
REMOTE=user@backup-host:/backup/mysql
DATE=$(date +%F)
DB_USER=backup
DB_PASS='xxxxxx'

mkdir -p "$BACKUP_DIR"

# 1. 导出
if ! mysqldump -u"$DB_USER" -p"$DB_PASS" --single-transaction --all-databases \
     | gzip > "$BACKUP_DIR/all-$DATE.sql.gz"; then
    echo "$(date) 备份失败" | mail -s "MySQL 备份告警" admin@example.com
    exit 1
fi

# 2. 同步到备份机
rsync -az --delete "$BACKUP_DIR/" "$REMOTE/"

# 3. 本地只保留 7 天
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete

# 4. 完整性校验（抽查最新备份能否被 zcat 读取）
zcat "$BACKUP_DIR/all-$DATE.sql.gz" > /dev/null && echo "$(date) 备份成功" >> /var/log/mysql_backup.log
```

crontab 行（注意 `%` 已移入脚本，这里无需转义）：

```bash
0 2 * * * /opt/mysql_backup.sh >> /var/log/mysql_backup.log 2>&1
```

## 本篇小结

- **三个文件描述符**：stdin=0、stdout=1、stderr=2，管道重定向只动它们。
- `> file 2>&1` 顺序不能反，须"先定 1 再让 2 跟 1"，`&>` 是其简写。
- `/dev/null` 丢弃输出，`/dev/zero` 造数据，`<<EOF` 多行输入、`<<<` 单行输入。
- 管道 `|` 只接 stdout，要含 stderr 须先 `2>&1 |`。
- 文件名含空格用 `find -print0 | xargs -0`，避免被拆成多段。
- `sudo echo > file` 会权限不足，改用 `echo ... | sudo tee file`。
- crontab 五字段为 `分 时 日 月 周`，`*` `,` `-` `/` 四种特殊符号。
- **`crontab -r` 无确认清空全部任务**，删前先 `crontab -l > bak` 备份。
- cron 的 PATH 很短，脚本用绝对路径或顶部声明 `PATH=...`。
- cron 无终端，输出必须重定向到日志，命令中 `%` 要写成 `\%`。
- 一次性任务用 `at`，错过补跑交给 `anacron` 或 systemd `Persistent=true` timer。

## 参考链接

- [Cron 表达式文档（Wikipedia）](https://en.wikipedia.org/wiki/Cron)
- [GNU Coreutils: tee](https://www.gnu.org/software/coreutils/manual/html_node/tee-invocation.html)
- [Bash 重定向指南（GNU）](https://www.gnu.org/software/bash/manual/html_node/Redirections.html)
- [crontab(5) 手册页](https://man7.org/linux/man-pages/man5/crontab.5.html)
- [systemd.timer 手册](https://www.freedesktop.org/software/systemd/man/systemd.timer.html)
- [at 命令手册（man7）](https://man7.org/linux/man-pages/man1/at.1p.html)
- [Arch Wiki: Cron](https://wiki.archlinux.org/title/Cron)
- [rsync 官方文档](https://rsync.samba.org/documentation.html)

下一篇 → [13 系统监控与性能排查](/ops/linux/monitor)
