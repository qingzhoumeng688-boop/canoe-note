# 08 进程与服务管理

进程是运行中的程序，服务是跑在后台、长期提供能力的进程。本篇讲清进程的本质、`ps`/`top` 怎么读、负载的含义、`kill` 信号的正确用法、前后台与守护进程，以及现代 Linux 管理服务的标准姿势 systemd。把 Java 服务做成 systemd 单元是运维的必备技能。

## 一、进程是什么

先厘清三个概念：

- **程序**：躺在磁盘上的静态可执行文件（如 `/usr/bin/java`）。
- **进程**：程序被加载到内存、正在运行的实例，有独立 PID。
- **线程**：进程内并发执行的最小单位，共享进程内存。

每个进程有 **PID**（自身编号）和 **PPID**（父进程编号）。`pstree` 能看清进程间的父子关系：

```bash
pstree -p                      # 以树状展示进程及 PID
pstree -p 1234                 # 只看某进程的子树
```

**孤儿进程与僵尸进程**：

- 父进程先退出，子进程被 `init`/`systemd`（PID 1）接管，成为孤儿进程——无害，会被 1 号进程回收。
- 子进程退出但父进程没调用 `wait()` 回收，子进程残留为**僵尸进程（Z 状态）**。僵尸进程不占资源，但占着 PID 槽位；如果父进程是 bug 导致大量僵尸，PID 会被耗尽。**僵尸进程 `kill -9` 杀不掉**——它已经"死"了，只能杀掉或重启它的父进程，让 1 号进程来收尸。

`ps` 里 STAT 列的状态含义：

| 状态 | 含义 |
| --- | --- |
| R | 运行中/可运行（在就绪队列） |
| S | 可中断睡眠（等事件，可被信号唤醒） |
| D | 不可中断睡眠（通常等 IO，kill -9 也杀不掉，常见于磁盘卡死） |
| T | 暂停（被 `Ctrl+Z` 或 `SIGSTOP`） |
| Z | 僵尸进程 |
| s | 会话首进程 |
| `<` | 高优先级 |
| `+` | 前台进程组 |
| N | 低优先级 |

**D 状态不可中断**的原因：进程正在内核态执行关键 IO（如读写磁盘），不能中途被打断，否则数据会不一致。大量 D 状态进程往往意味着底层存储出了问题。

## 二、ps 与 top

`ps aux` 与 `ps -ef` 是两种风格（BSD vs UNIX），输出略有差异：

```bash
ps aux                        # BSD 风格，含 %CPU %MEM 等，最常用
ps -ef                        # UNIX 风格，含 PPID，看父子关系方便
```

`ps aux` 各列含义：

- `USER`：属主；`PID`：进程号；`%CPU`/`%MEM`：占用。
- `VSZ`：虚拟内存大小；`RSS`：常驻物理内存。
- `STAT`：状态（见上表，如 `S+` 表示前台睡眠）。
- `START`：启动时间；`TIME`：累计 CPU 时间；`COMMAND`：命令。

经典用法与去自身干扰：

```bash
ps -ef | grep nginx                 # 找 nginx 进程
ps -ef | grep nginx | grep -v grep  # 去掉 grep 自身那一行
ps -ef | grep "[n]ginx"             # 更优雅的写法，正则让 grep 不匹配自己
```

`top` 界面逐行解读：

```bash
top
# 第一行：当前时间、运行时间、登录用户数、 load average（1/5/15 分钟负载）
# 第二三行：Tasks 总数/状态，以及 %Cpu(s) 各状态占比
# 第四五行：MiB Mem / MiB Swap 的内存与交换分区使用
# 下方列表：每个进程的 CPU/内存/命令
```

常用交互键：

- `P`：按 CPU 排序；`M`：按内存排序；`N`：按 PID 排序。
- `1`：展开显示每个 CPU 核；`k`：输入 PID 杀进程；`q`：退出。

更友好的替代品：`htop`（彩色、可鼠标/方向键操作）、`atop`（记录历史、含 IO/网络）。

## 三、负载 load average

**负载是面试高频也是误解重灾区**。`uptime` 或 `top` 第一行三个数字：

```bash
uptime
#  load average: 1.25, 0.80, 0.50
```

这三个是 **1 分钟、5 分钟、15 分钟的平均负载**，其本质是**可运行（R 状态）+ 不可中断（D 状态）进程数的平均值**，不是 CPU 使用率。

怎么判断高不高？**除以 CPU 核数**：

```bash
nproc                          # 看 CPU 核数
cat /proc/loadavg              # 内核视角的负载原始值
```

- 负载 / 核数 小于 1：轻松。
- 约等于 1：刚好打满。
- 远大于 1（如 5）：严重排队，响应变慢。

**负载高但 CPU 不高说明什么？** 因为负载包含 D 状态进程，这种情况通常是 IO 阻塞（磁盘慢、NFS 卡死）导致大量进程卡在 D 状态，或者频繁上下文切换。`%wa` 高、`vmstat` 的 `b` 列大，是典型特征——不是 CPU 在算，而是大家都在"等"。

## 四、kill 与信号

`kill` 不是"杀"，是"发信号"。常用信号：

| 信号 | 编号 | 含义 |
| --- | --- | --- |
| SIGHUP | 1 | 终端断开/重读配置（很多服务用它热加载） |
| SIGINT | 2 | `Ctrl+C`，中断 |
| SIGQUIT | 3 | 退出并 core dump |
| SIGKILL | 9 | 强制杀死，进程无法捕获，**不给清理机会** |
| SIGTERM | 15 | 优雅终止，默认信号，进程可 cleanup 后退出 |

```bash
kill 1234              # 发 SIGTERM(15)，请进程退出
kill -9 1234           # 发 SIGKILL(9)，强杀，不清理
kill -1 1234           # 发 SIGHUP，常用于让服务重读配置（如 nginx -s reload 之外）
killall nginx          # 按名字杀
pkill -f "java -jar"   # -f 匹配完整命令行，杀指定启动参数的进程
kill -0 1234           # 0 号信号不真的发，只探进程是否存在（退出码 0=存在）
```

**能用 15 就别用 9**：SIGTERM 允许进程执行清理（关闭连接、刷盘、触发 shutdown hook）。对 **Java 应用尤其重要**——`kill -9` 会直接夺命，shutdown hook 不执行、没有堆 dump、可能留下未刷写的文件或锁。标准做法是先 `kill PID`（15），等几秒，确认没退再考虑 `kill -9`。探活用 `kill -0`。

## 五、前台后台与守护进程

默认命令在前台跑，占着终端。把它放到后台：

```bash
java -jar app.jar &              # & 放后台，但终端关闭会收到 SIGHUP 而死
```

`Ctrl+Z` 把前台任务暂停挂起，`jobs` 看后台任务，`fg`/`bg` 调回前台/继续后台运行：

```bash
jobs                           # 列出当前 shell 的后台任务
fg %1                          # 把 1 号任务调回前台
bg %1                          # 让暂停的任务在后台继续
```

**`nohup ... &` 与 `&` 的区别**：`nohup`（no hang up）让进程忽略 SIGHUP，所以**退出终端也不会中断**。这是临时后台跑任务的标准写法：

```bash
nohup java -jar app.jar > app.log 2>&1 &
# 输出重定向到 app.log，否则会写进 nohup.out
```

进阶的脱离终端手段：`setsid` 让进程在新会话运行（连父 shell 都不是），`disown` 把任务从 shell 的任务表移除（关终端也不发 SIGHUP）：

```bash
setsid java -jar app.jar > app.log 2>&1 < /dev/null &
disown                        # 对当前后台任务生效
```

**后台跑 Java 服务的标准命令**（临时方案，生产推荐用 systemd）：

```bash
nohup java -Xms512m -Xmx512m -jar /data/app/app.jar \
    > /data/app/app.log 2>&1 &
echo $!                       # 记下 PID，方便后续管理
```

## 六、systemd 全家桶

**systemd 是现代 Linux 的 init 系统**，取代了老的 SysVinit。它启动更快（并行）、管理更统一。它管理的对象叫 **Unit**，常见类型：

| 类型 | 作用 |
| --- | --- |
| service | 服务进程（最常见） |
| target | 一组 unit 的集合（类似运行级别） |
| socket | 基于 socket 激活 |
| timer | 定时任务（替代部分 cron） |
| mount | 挂载点管理 |

`systemctl` 命令速查：

```bash
systemctl start nginx            # 启动
systemctl stop nginx             # 停止
systemctl restart nginx          # 重启
systemctl reload nginx           # 重载配置（不中断）
systemctl status nginx           # 看状态与最近日志
systemctl enable nginx           # 开机自启
systemctl disable nginx          # 取消开机自启
systemctl is-enabled nginx       # 是否开机自启
systemctl mask nginx             # 彻底禁止（连手动 start 也拦）
systemctl list-unit-files        # 列出所有 unit 的开机策略
systemctl --failed               # 看启动失败的服务
```

看服务日志用 `journalctl`：

```bash
journalctl -u nginx -f              # 实时跟踪 nginx 日志
journalctl -u nginx --since "1 hour ago"   # 看近 1 小时
journalctl -u nginx -p err          # 只看错误
```

## 七、编写一个 service 文件

下面是一份完整的 Spring Boot 服务 unit 文件，三段逐项注释：

```ini
# /etc/systemd/system/app.service
[Unit]
Description=My Spring Boot App
After=network.target mysql.service     # 网络与 MySQL 起来后再启动本服务
Wants=mysql.service

[Service]
Type=simple                            # simple：ExecStart 前台运行（推荐）
# Type=forking 用于会自己 fork 后台的进程
User=appuser                           # 用专用低权限用户跑，别用 root
WorkingDirectory=/data/app             # 工作目录
Environment="JAVA_HOME=/usr/local/jdk17"
Environment="JAVA_OPTS=-Xms512m -Xmx512m"
ExecStart=/usr/bin/java $JAVA_OPTS -jar /data/app/app.jar
ExecStop=/bin/kill -15 $MAINPID        # 优雅停止
Restart=always                         # 进程挂了自动拉起
RestartSec=10                          # 重启前等 10 秒，避免雪崩
StandardOutput=journal                 # 输出进 journal，用 journalctl 看
StandardError=journal

[Install]
WantedBy=multi-user.target             # 多用户模式（运行级 3）下开机自启
```

写完让 systemd 重新加载并启用：

```bash
systemctl daemon-reload                # 改了 unit 文件必须 reload
systemctl enable app                   # 开机自启
systemctl start app                    # 启动
systemctl status app                   # 验证
```

**`Failed with result` 排查**：若 `systemctl status` 显示 failed，常见原因——`ExecStart` 路径错、用户无权访问 jar、`JAVA_HOME` 未生效、端口被占。看具体报错用 `journalctl -u app -xe`。

## 八、开机启动的几种方式

| 方式 | 适用场景 | 注意 |
| --- | --- | --- |
| `systemctl enable` | 服务类，首选 | 标准、可管理、有依赖顺序 |
| `/etc/rc.local` | 简单脚本 | 需加执行权限，且要确保 systemd 启用了 rc-local 服务 |
| `crontab @reboot` | 用户级一次性任务 | 用户登录相关，环境可能不全 |
| `~/.bashrc` | 仅交互登录 shell | **不适合放服务**，每次开终端都会执行 |

```bash
crontab -e
# 加入一行：@reboot /data/app/start.sh     # 开机执行脚本
```

经验：**服务一律用 systemd**，别往 `.bashrc` 塞启动命令——它只在交互登录时跑，且会污染每个新 shell。

## 九、实战：把 Spring Boot jar 做成服务

从临时跑法到标准服务，完整走一遍：

```bash
# 1. 临时跑（不推荐长期，仅调试）
nohup java -jar /data/app/app.jar > /data/app/app.log 2>&1 &

# 2. 写 unit 文件（见第七节示例），放 /etc/systemd/system/app.service

# 3. 建专用用户跑服务，降低风险
useradd -r -s /sbin/nologin appuser
chown -R appuser:appuser /data/app

# 4. 设 JVM 参数与日志（在 unit 的 Environment 里）
#    StandardOutput=journal，日志交给 journalctl

# 5. 重载并开机自启
systemctl daemon-reload
systemctl enable --now app

# 6. 验证
systemctl status app                  # 看 Active: running
journalctl -u app -f                   # 看实时日志
ss -tlnp | grep 8080                   # 确认端口在监听
```

**关键原则**：把 jar 用 `Type=simple` 跑在**前台**（ExecStart 直接 `java -jar`，不要再加 `&` 或 `nohup`），让 systemd 接管进程生命周期，这是 systemd 推荐的姿势，重启、看状态、拉起都最顺手。如果设成 `forking` 却没真正 fork，systemd 会以为启动失败。

## 本篇小结

- **程序是静态文件，进程是运行实例**，PID 是身份证、PPID 是父亲。
- **僵尸进程 `kill -9` 杀不掉**，只能重启其父进程让其被 1 号进程回收。
- **D 状态不可中断**，大量出现通常意味着磁盘/存储卡死。
- **`ps aux` 看资源、`ps -ef` 看父子**，用 `[n]ame` 写法过滤 grep 自身。
- **负载是 R+D 进程平均数，要除以 CPU 核数**判断高低。
- **负载高 CPU 不高 = IO 阻塞或 D 状态多**，看 `%wa` 与 `vmstat b`。
- **优先 `kill -15` 优雅退出**，Java 应用被 `-9` 杀无 shutdown hook、无 dump。
- **`nohup ... &` 退出终端不中断**，但生产推荐 systemd 而非 nohup。
- **systemd 是标准 init**，service/target/socket/timer 是常见 unit 类型。
- **`Type=simple` 前台跑 jar 是推荐姿势**，让 systemd 托管生命周期。
- **开机启动首选 `systemctl enable`**，别把服务塞进 `.bashrc`。

## 参考链接

- [Linux 命令大全（菜鸟教程）](https://www.runoob.com/linux/linux-command-manual.html)
- [systemd.service 官方文档](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [systemctl 手册 (man7)](https://man7.org/linux/man-pages/man1/systemctl.1.html)
- [journalctl 手册 (man7)](https://man7.org/linux/man-pages/man1/journalctl.1.html)
- [Arch Wiki - systemd](https://wiki.archlinux.org/title/systemd)
- [signal(7) 信号手册](https://man7.org/linux/man-pages/man7/signal.7.html)

下一篇 → [09 磁盘与存储管理](/ops/linux/disk)
