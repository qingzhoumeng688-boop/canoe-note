# 13 系统监控与性能排查

系统出问题，第一步不是重启，而是"看清到底哪里出了问题"。本篇把监控拆成 CPU、内存、磁盘 IO、网络四大维度，逐一讲清每个指标怎么看、异常说明什么，再给出一套"负载高/CPU 飙高"的完整排查方法论与常见故障案例，最后聊监控体系怎么搭。

## 一、监控的四大指标

运维监控永远围绕四个核心维度，每个维度关注点和工具不同：

| 维度 | 关注什么 | 常用工具 |
| --- | --- | --- |
| CPU | 利用率、负载、上下文切换 | `top`、`vmstat`、`mpstat`、`pidstat` |
| 内存 | 使用率、可用内存、OOM | `free`、`vmstat`、`/proc/meminfo` |
| 磁盘 IO | 利用率、延迟、吞吐 | `iostat`、`iotop`、`fio` |
| 网络 | 带宽、连接数、丢包 | `sar -n`、`iftop`、`nethogs`、`ss` |

四个维度会互相影响：CPU 高可能拖慢网络处理，磁盘 IO 阻塞会让进程进入 D 状态拉高负载。排查时要学会交叉印证，而不是只盯一个面板。

## 二、CPU 怎么看

`top` 里 CPU 那一行（%Cpu(s)）每一项都代表一类开销，必须能读懂：

```bash
top
# %Cpu(s): 12.3 us,  3.1 sy,  0.0 ni, 82.4 id,  1.2 wa,  0.0 hi,  0.5 si,  0.5 st
```

- **`%us`（user）**：用户态 CPU，应用代码消耗。
- **`%sy`（system）**：内核态 CPU，系统调用、中断处理消耗。高说明内核开销大（如大量上下文切换、频繁系统调用）。
- **`%ni`（nice）**：低优先级进程占用。
- **`%id`（idle）**：空闲，越大越闲。
- **`%wa`（iowait）**：CPU 等 IO 的时间。这一项高**几乎可以断定 IO 有瓶颈**（磁盘慢或进程在等磁盘）。
- **`%hi`/`%si`**：硬中断/软中断，网络包过多时会升高。
- **`%st`（steal）**：被宿主机"偷走"的时间。**虚拟机里 `%st` 高，说明宿主机超卖、你在被邻居抢资源**。

更细的工具：

```bash
vmstat 1                       # 每秒刷新，看 procs(r/b)、cs 上下文切换、us/sy/id/wa
mpstat -P ALL 1                # 看每个 CPU 核的利用率，定位"单核被打满"
sar -u 1 5                     # 历史/实时 CPU 采样
pidstat -u 1                   # 按进程看 CPU 占用
```

## 三、内存怎么看

```bash
free -h
#               total        used        free      shared  buff/cache   available
# Mem:           15Gi        4.2Gi        1.1Gi      320Mi       10Gi        10Gi
```

逐字段解释：

- **total**：总物理内存。
- **used**：已被进程使用的（不含 buff/cache）。
- **free**：完全空闲、未被使用的。
- **shared**：tmpfs 等共享内存。
- **buff/cache**：内核用做的文件缓存（buffer + cache），**可被随时回收**。
- **available**：**真正还能被应用使用的内存**，约等于 free + 可回收的 buff/cache。

**重要认知**：Linux 下"空闲内存少"不是问题，因为内核会尽量用内存做文件缓存提升性能；buff/cache 在应用需要时会自动释放。`available` 才是判断"够不够用"的关键指标，别被 `free` 小吓到。

更深一层看 `/proc/meminfo`，以及 OOM 的机制：

```bash
cat /proc/meminfo              # 看 MemAvailable、Buffers、Cached、Slab 等明细
dmesg | grep -i oom            # 查历史 OOM Killer 记录
dmesg -T | grep -i "killed process"   # 看哪些进程被 OOM 杀掉及时间
```

**OOM Killer** 是内核在内存耗尽时的"保命机制"：它按 oom_score 挑选最"该死"的进程杀掉以腾出内存。被它杀掉的服务会莫名消失，排查诡异宕机一定要先看 dmesg 里有没有 OOM。

## 四、IO 与网络监控

磁盘 IO：

```bash
iostat -x 1                    # %util 接近 100% 说明磁盘饱和，await 高说明排队严重
iotop                          # 找哪个进程在大量读写
```

网络：

```bash
sar -n DEV 1                   # 每块网卡的 rx/tx 速率、包速率
iftop                          # 实时看哪些 IP 在占带宽（需安装）
nethogs                        # 按进程看网络流量，定位"哪个程序在偷跑流量"
```

`sar` 来自 `sysstat` 包，能记录历史数据，对"昨天那个时间点出了啥事"的复盘极有价值。

## 五、综合工具

除了单项工具，还有一些"一屏看全部"的综合面板：

```bash
vmstat 1                       # 综合：procs/内存/swap/IO/CPU 一行全有
```

`vmstat 1` 逐列含义：

- `r`：可运行进程数，长期大于 CPU 核数说明 CPU 不够。
- `b`：不可中断（D 状态）进程数，也就是阻塞在 IO 上的。
- `si`/`so`：从 swap 换入/换出的速率，非零说明在频繁换页。
- `bi`/`bo`：块设备读/写速率。
- `cs`：上下文切换次数，过高说明进程/线程切换太频繁。
- `us/sy/id/wa/st`：同 top 的 CPU 拆解。

其他综合工具：

```bash
dstat 1                        # 比 vmstat 更彩色的综合视图（需安装）
glances                        # 类 htop 的一屏全监控（需安装）
nmon                           # 性能采集老牌工具，支持导出
sar -A                         # 历史全量数据回放，配合 sysstat 的定时采集
```

## 六、日志在哪里

系统与应用的"案发现场"都在日志里。常见位置：

| 日志 | 内容 |
| --- | --- |
| `/var/log/messages` | 系统通用日志（CentOS/RHEL） |
| `/var/log/secure` | 认证、SSH 登录相关 |
| `/var/log/dmesg` | 内核启动与硬件信息 |
| `/var/log/cron` | 定时任务执行记录 |
| `/var/log/boot.log` | 开机过程 |
| 应用目录 `logs/` | 业务自身日志 |

systemd 系统用 `journalctl` 统一查日志，非常好用：

```bash
journalctl -xe                       # 看最近报错，-x 加解释 -e 跳末尾
journalctl -u nginx -f               # 实时跟踪 nginx 服务日志
journalctl -u app --since "2026-09-20 10:00" --until "11:00"   # 按时间范围
journalctl -p err -b                 # 本次启动以来的 error 级日志
```

**日志必须轮转**，否则再大的盘也会被写满。`logrotate` 配置示例（每天切、保留 7 天、压缩、不中断服务）：

```bash
# /etc/logrotate.d/app
/var/log/app/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    copytruncate
}
```

`copytruncate` 适合不能发信号重新打开日志的进程：先拷一份再截断原文件，避免进程继续写已删除的旧文件（那正是"df 满了但 du 找不到"的元凶）。

## 七、排查方法论

**CPU 100% 的完整排查流程**（Java 应用版）：

```text
top                          → 找到 CPU 最高的进程 PID
  │
  ▼
top -Hp <PID>                → 找到该进程里最忙的线程 TID（十进制）
  │
  ▼
printf "%x\n" <TID>          → 把线程号转成十六进制 nid
  │
  ▼
jstack <PID> > /tmp/stack.txt   → 导出线程栈
  │
  ▼
grep -A 20 <nid> /tmp/stack.txt   → 在栈里搜索 nid，定位到具体代码行
```

```bash
# 实际操作串起来
top                          # 看哪个 PID 吃 CPU
top -Hp 1234                 # 1234 是该进程，看哪个线程（TID）
printf "%x\n" 1256           # 假设 TID 1256 → 十六进制 4e8
jstack 1234 > /tmp/stack.txt
grep -A 30 "nid=0x4e8" /tmp/stack.txt   # 找到对应线程栈，定位死循环/热点代码
```

**"负载高但 CPU 不高"的分支**：这种情况通常不是 CPU 计算忙，而是进程在等——要么 IO 慢（看 `%wa` 和 `iostat`），要么大量进程卡在 D 状态（不可中断，通常是磁盘/网络存储挂死），要么频繁上下文切换（`vmstat` 的 `cs` 飙升、`r` 队列长）。决策树如下：

```text
负载高，但 %us+%sy 不高
│
├─ %wa 高 ───────────────▶ 磁盘 IO 瓶颈 → iostat/iotop 找进程
│
├─ vmstat 的 b 列高（D 进程多）▶ 不可中断等待 → 多为 NFS/磁盘挂死
│
├─ cs 上下文切换极高 ─────▶ 线程/进程切换过频 → pidstat -w 查
│
└─ r 队列长但都空闲 ─────▶ 锁竞争/等网络 → 看网络与业务日志
```

## 八、常见故障案例

**1. CPU 100%**

- 现象：`top` 里某进程 `%us` 接近 100%，系统卡顿。
- 命令：`top -Hp PID` → `jstack` 定位线程。
- 原因：死循环、正则灾难回溯、频繁 GC。
- 解决：定位代码修复；临时可 `kill -15` 重启，或 `renice` 降优先级。

**2. 内存 OOM**

- 现象：进程莫名消失，`free` 见底。
- 命令：`dmesg | grep -i oom`、`cat /var/log/messages | grep OutOfMemory`。
- 原因：内存泄漏、给 JVM 配了过大堆。
- 解决：调小堆/修复泄漏；加 swap 缓冲；限制 cgroup 内存上限。

**3. 磁盘满**

- 现象：`df -h` 某分区 Use% 100%，写文件报错 `No space left on device`。
- 命令：`du -sh * | sort -h` 下钻，`lsof | grep deleted` 查幽灵文件。
- 原因：日志无轮转、Docker 堆积、大文件删了没释放。
- 解决：清日志/清理 Docker；`logrotate`；重启占用进程释放空间。

**4. 负载高但 CPU 不高**

- 现象：`uptime` 显示 load 远超核数，`top` 的 CPU 却闲。
- 命令：`vmstat 1` 看 `b` 列与 `%wa`，`iostat -x 1`。
- 原因：IO 阻塞导致进程排队，或大量 D 状态。
- 解决：定位慢 IO 源头，优化磁盘或存储。

**5. 文件句柄耗尽**

- 现象：应用报 `Too many open files`，新连接/文件打不开。
- 命令：`lsof -p PID | wc -l` 看进程句柄数，`ulimit -n` 看上限。
- 原因：连接/文件没关闭，或默认 1024 太小。
- 解决：改 `/etc/security/limits.conf` 调大 `nofile`，修复代码泄漏。

**6. 端口耗尽**

- 现象：大量 `TIME_WAIT`，新 outbound 连接建立慢或失败。
- 命令：`ss -s` 看连接汇总，`ss -tan | wc -l`。
- 原因：短连接过多，本地端口（`ip_local_port_range`）不够用。
- 解决：启用端口复用 `net.ipv4.tcp_tw_reuse=1`，用连接池，调大端口范围。

## 九、监控体系建设

单机靠命令，集群靠体系。两条主流路线：

- **Zabbix**：老牌、开箱即用的模板与告警，适合传统运维。
- **Prometheus + node_exporter + Grafana**：云原生标配，`node_exporter` 采集主机指标，Prometheus 存时序数据，Grafana 出图与告警。

**告警阈值建议**（经验值，按业务微调）：

| 指标 | 告警阈值 |
| --- | --- |
| CPU 使用率 | 大于 80% 持续 5 分钟 |
| 磁盘使用率 | 大于 85%（提前扩容/清理） |
| 内存可用率 | 小于 10%（或 available 过低） |
| inode 使用率 | 大于 80% |
| 负载 | 大于 CPU 核数 × 1.5 持续 5 分钟 |
| TCP `TIME_WAIT` 数 | 异常暴涨时告警 |

阈值"持续 N 分钟"很重要，能过滤掉瞬时抖动带来的误报。

## 本篇小结

- **四大监控维度**是 CPU、内存、磁盘 IO、网络，需交叉印证而非单点判断。
- **`%wa` 高 = IO 有问题**，`%sy` 高 = 内核开销大，`%st` 高 = 虚拟机被抢资源。
- **`available` 才是真可用内存**，空闲少是 Linux 缓存机制，不是故障。
- **OOM Killer 会杀进程保命**，诡异宕机先 `dmesg | grep oom`。
- **日志必须轮转**，否则 `copytruncate` 缺失会导致"已删未释放"撑满磁盘。
- **CPU 飙高标准链路**：top 找进程 → `top -Hp` 找线程 → 转十六进制 → `jstack` 定位代码。
- **负载高 CPU 不高**多半是 IO 阻塞或 D 状态进程多，看 `%wa` 与 `vmstat b`。
- **`Too many open files`** 是句柄耗尽，调 `ulimit` 与 `limits.conf` 解决。
- **`journalctl -u -f --since`** 是查 systemd 服务日志的利器。
- **监控体系用 Prometheus + Grafana** 或 Zabbix，阈值带"持续时长"防误报。

## 参考链接

- [Linux 命令大全（菜鸟教程）](https://www.runoob.com/linux/linux-command-manual.html)
- [sysstat (sar/iostat/mpstat) 文档](https://github.com/sysstat/sysstat)
- [Prometheus 官方文档](https://prometheus.io/docs/introduction/overview/)
- [node_exporter 项目](https://github.com/prometheus/node_exporter)
- [Grafana 官方文档](https://grafana.com/docs/)
- [Zabbix 官方文档](https://www.zabbix.com/documentation/current/en/manual)
- [Linux 内核 OOM Killer 说明](https://www.kernel.org/doc/gorman/html/understand/understand016.html)

下一篇 → [14 常用服务安装部署实战](/ops/linux/deploy)
