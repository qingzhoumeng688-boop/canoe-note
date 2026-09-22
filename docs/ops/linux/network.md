# 10 网络配置与排查

网络是服务器对外服务的生命线。本篇从基础概念讲起，覆盖网卡配置、`ip` 命令取代 `ifconfig`、连通性测试、端口与连接状态、`tcpdump` 抓包、防火墙，最后给出一张"现象→原因→命令→解法"的排查速查表。掌握这一篇，大部分"服务起不来 / 访问不通"的问题你都能独立定位。

## 一、网络基础铺垫

几个核心概念用比喻记最牢：

- **IP 地址**：门牌号，标识"这台机器在哪"。
- **MAC 地址**：身份证，网卡出厂烧录的硬件地址，局域网内真正用来寻址。
- **子网掩码**：划分"门牌号里哪部分是小区、哪部分是楼栋"，决定两台机器是否同网段。
- **网关**：小区大门，跨网段通信必须经过它。
- **DNS**：通讯录，把域名翻译成 IP。

`ip a` 看网卡信息，逐行解读：

```bash
ip a
# 1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 ...
#     inet 127.0.0.1/8 scope host lo        # 回环地址，本机内部通信
# 2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...
#     inet 192.168.1.10/24 brd 192.168.1.255 scope global eth0
#     link/ether 52:54:00:xx:xx:xx brd ff:ff:ff:ff:ff:ff   # MAC 地址
```

- `lo` 是**回环接口**，IP `127.0.0.1`，本机服务间通信不走物理网卡。
- `eth0` 的物理网卡，`inet` 后面是 IPv4 地址与掩码（CIDR 表示法 `/24` 即 255.255.255.0）。
- CIDR 的 `/24` 表示前 24 位是网络号，后 8 位是主机号，可用地址 254 个。

## 二、网卡配置

不同发行版配置文件位置不同：

- **CentOS/RHEL**：`/etc/sysconfig/network-scripts/ifcfg-eth0`
- **Ubuntu 18.04+**：`/etc/netplan/*.yaml`（netplan）

CentOS 传统配置逐项解释：

```bash
# /etc/sysconfig/network-scripts/ifcfg-eth0
BOOTPROTO=static          # static 静态 / dhcp 自动获取
ONBOOT=yes                # 开机是否激活该网卡
IPADDR=192.168.1.10       # IP 地址
PREFIX=24                 # 掩码长度，等价于 NETMASK=255.255.255.0
GATEWAY=192.168.1.1       # 网关
DNS1=223.5.5.5            # 首选 DNS
DNS2=223.6.6.6            # 备用 DNS
```

Ubuntu netplan 示例：

```yaml
# /etc/netplan/01-netcfg.yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [192.168.1.10/24]
      gateway4: 192.168.1.1
      nameservers:
        addresses: [223.5.5.5, 223.6.6.6]
```

改完后让配置生效：

```bash
# CentOS
systemctl restart network
# 或用 nmcli
nmcli connection reload
nmcli connection up eth0

# Ubuntu
netplan apply
```

**强烈警告**：云服务器（ECS/云主机）千万不要随手改网卡配置或网关，改错一个字段就可能**失联**，只能进控制台 VNC 救。改动前先保留会话或用"改完自动回滚"的方式。另外 DNS 修改也可以直接编辑 `/etc/resolv.conf`，但 netplan/NetworkManager 可能会覆盖它，持久化要走上面的配置文件。

## 三、ip 命令取代 ifconfig

`net-tools`（`ifconfig`、`netstat`、`route`）已停止维护，官方推荐用 `iproute2` 套件。对照表：

| 老命令 | 新命令 | 说明 |
| --- | --- | --- |
| `ifconfig` | `ip addr` / `ip link` | 看/配 IP 与链路状态 |
| `route -n` | `ip route` | 看路由表 |
| `arp -a` | `ip neigh` | 看 ARP/邻居表 |
| `ifconfig eth0 up` | `ip link set eth0 up` | 启停网卡 |

```bash
ip addr show                  # 看所有网卡 IP（替代 ifconfig）
ip link show                  # 只看链路层（MAC、状态）
ip route show                 # 看路由表，默认路由 gateway 在此
ip route add default via 192.168.1.1   # 临时加默认网关
ip neigh                      # 看 ARP 缓存（谁连过我）
```

主机名与域名解析相关文件：

```bash
cat /etc/hostname             # 主机名
cat /etc/hosts                # 静态 IP↔主机名 映射，优先级高于 DNS
cat /etc/resolv.conf          # DNS 服务器配置（nameserver 行）
```

## 四、连通性测试

**ping**：测三层连通性（ICMP）。注意**有些机器禁了 ICMP**，ping 不通但服务正常——这时不能断定网络断了，要改用端口测试。

```bash
ping -c 4 192.168.1.1         # 发 4 个包
ping -c 4 www.baidu.com       # 顺便验证 DNS 解析
```

**端口连通性**：比 ping 更贴近"服务通不通"。

```bash
telnet 192.168.1.10 3306      # 测 TCP 端口（无 telnet 可用 nc）
nc -zv 192.168.1.10 8080      # -z 只扫不收发，-v 详细，快速测端口
```

**curl**：测 HTTP 服务并看耗时，定位"慢在哪一步"是神器：

```bash
curl -I https://www.example.com            # 只看响应头
curl -s -o /dev/null -w "%{time_total}\n" https://www.example.com   # 总耗时
curl -w "DNS:%{time_namelookup} TCP:%{time_connect} TTFB:%{time_starttransfer} TOTAL:%{time_total}\n" -o /dev/null -s https://www.example.com
```

`-w` 的各时间字段含义：`time_namelookup` 是 DNS 解析耗时，`time_connect` 是 TCP 建连耗时，`time_starttransfer`（TTFB）是首字节时间，`time_total` 是总耗时。哪个阶段数字异常大，问题就在那一环。

**DNS 排查**：

```bash
nslookup www.example.com                  # 查域名解析
dig www.example.com +short                # 直接返回 IP，脚本友好
dig @223.5.5.5 www.example.com            # 指定 DNS 服务器查，排除本地 DNS 问题
```

**traceroute / mtr**：看路径上哪一跳丢包或变慢：

```bash
traceroute 8.8.8.8            # 逐跳显示路径
mtr -n 8.8.8.8                # 持续采样的 traceroute，看稳定性
```

"从浏览器打不开"的排查顺序：

```text
本机能 ping 通目标 IP？ ──否──▶ 网络层/路由问题（ip route、网关）
   │是
能解析域名？ ────────────否──▶ DNS 问题（dig、resolv.conf）
   │是
目标端口通？ ────────────否──▶ 防火墙/服务没起（nc、ss、telnet）
   │是
HTTP 返回码正常？ ────────否──▶ 应用层问题（curl -I、看业务日志）
   │是
页面内容正确？ ────────────否──▶ 后端逻辑/代理配置问题
```

## 五、端口与连接 ss

`ss` 是查看端口与连接的首选（`netstat` 已废弃但老系统常见）：

```bash
ss -tulnp
# -t TCP  -u UDP  -l 监听中  -n 不解析名字  -p 显示进程
# 输出示例：
# LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("java",pid=1234,fd=45))
```

- 看谁占了某端口：`ss -tlnp | grep 8080` 或 `lsof -i:8080`。
- 连接数汇总：`ss -s` 一眼看总连接与各状态计数。

TCP 连接状态图（高频面试与排障）：

```text
          主动打开               被动打开
  CLOSED ─────▶ SYN_SENT ───▶ SYN_RCVD ───▶ ESTABLISHED
                                                  │
  主动关闭 ── FIN_WAIT_1 ──▶ FIN_WAIT_2 ──▶ TIME_WAIT
  被动关闭 ── CLOSE_WAIT ──▶ LAST_ACK ──▶ CLOSED
                                                  │
                                          ESTABLISHED
```

- **ESTABLISHED**：已建立连接，正常通信中。
- **TIME_WAIT**：本端主动关闭后进入，等待 2MSL 确保对方收到。短连接过多会累积大量 TIME_WAIT，占端口但不代表故障；可开 `tcp_tw_reuse` 缓解。
- **CLOSE_WAIT**：对端已关闭，本端却没 close——**这是真问题**，说明代码没正确关闭连接，持续堆积会耗尽连接/句柄（典型的连接泄漏）。

```bash
ss -tan | grep TIME_WAIT | wc -l      # 统计 TIME_WAIT 数量
ss -tan | grep CLOSE_WAIT | wc -l     # 统计 CLOSE_WAIT，持续增长要警惕
```

## 六、抓包 tcpdump

当"连接通、请求也发出去了，但没响应"时，只能抓包看原始流量。tcpdump 在服务器上抓包，Wireshark 在本地分析，是排查网络问题的终极手段。

```bash
tcpdump -i any -nn port 80 -w a.pcap      # 抓 80 端口，存文件用 Wireshark 看
tcpdump -i eth0 -nn host 192.168.1.20     # 只看与某 IP 的通信
tcpdump -i any -nn 'tcp port 8080 and host 10.0.0.5'
tcpdump -A -s0 port 80                    # -A 以 ASCII 打印内容，看 HTTP 明文
tcpdump -i any -nn 'tcp[tcpflags] & tcp-syn != 0'   # 只看 SYN 包，查建连
```

- `-i any`：监听所有网卡；`-nn`：不解析主机名和端口名，输出快且干净。
- `-w`：写入文件（pcap），不要用 `-A` 直接看大量流量，会刷屏。
- `-A`：把报文内容按 ASCII 打印，适合快速看 HTTP 明文请求。

**实战：抓 HTTP 请求排查接口不通**：

```bash
tcpdump -i any -nn -A 'tcp port 8080 and (tcp[((tcp[12]&0xf0)>>2):4]=0x47455420 or tcp[((tcp[12]&0xf0)>>2):4]=0x504f5354)'
# 上面的表达式匹配 HTTP 的 GET/POST 请求行；简写可用下面：
tcpdump -i any -nn -A port 8080 | grep -i "GET\|POST"   # 实时看请求
```

抓到后若请求根本没到达服务器，问题在客户端或中间网络；若请求到了但没响应，看服务器应用为何不回包（可能是应用挂死或防火墙 DROP）。

`ngrep` 是 tcpdump 的"应用层"版本，直接按字符串匹配报文内容：

```bash
ngrep -q -d any "GET" port 80        # 抓取含 GET 的 HTTP 流量
```

## 七、防火墙与端口

防火墙是两层：机器自身的 `firewalld`（或 `iptables`/云厂商的 `nftables`）+ 云平台的**安全组**。两者都要放行，否则照样不通。

firewalld 常用操作：

```bash
systemctl status firewalld            # 看状态
firewall-cmd --state                  # 是否在运行
firewall-cmd --list-all               # 看当前 zone 放行的服务/端口
firewall-cmd --permanent --add-port=8080/tcp    # 永久开放 8080
firewall-cmd --permanent --remove-port=8080/tcp # 关闭
firewall-cmd --reload                 # 重载使其生效（不改规则不生效）
firewall-cmd --permanent --add-service=http     # 按服务名开放（含 80）
```

端口转发（把 80 转到 8080）：

```bash
firewall-cmd --permanent --add-forward-port=port=80:proto=tcp:toport=8080
firewall-cmd --reload
```

查看与清空规则（排障时确认到底挡没挡）：

```bash
iptables -L -n -v                      # 直接看 iptables 规则（若底层是它）
```

**云服务器一定要去控制台安全组放行端口**，本地 firewalld 关了也不代表外部能进来。

## 八、网络性能

排查带宽打满、丢包、重传：

```bash
sar -n DEV 1                    # 每块网卡 rx/tx kB/s、包速率
iftop                           # 实时看哪些连接占带宽
nethogs                         # 按进程看网络流量
ethtool eth0                    # 看网卡速率（Speed: 1000Mb/s）和双工
netstat -s | grep -i retransmit # 看 TCP 重传计数，持续增长说明丢包
netstat -s | grep -i drop       # 看丢包
```

丢包与重传是网络质量恶化的信号：可能物理链路差、带宽跑满、或远端有问题。先看 `sar -n DEV` 是否打满，再看重传计数定位。

## 九、常见故障排查表

| 现象 | 可能原因 | 排查命令 | 解决办法 |
| --- | --- | --- | --- |
| ping 不通 | 网络隔离/禁 ICMP/路由错 | `ip route`、`ping` | 查路由与防火墙，禁 ICMP 不用 ping 判断 |
| 能 ping 端口不通 | 服务没起/防火墙挡 | `ss -tlnp`、`nc -zv` | 起服务、放行端口/安全组 |
| 能连但慢 | DNS 慢/链路差/重传 | `curl -w`、`mtr` | 换 DNS、查链路质量 |
| DNS 解析失败 | resolv.conf 错/ DNS 挂 | `dig`、`nslookup` | 改 nameserver |
| TIME_WAIT 暴涨 | 短连接过多 | `ss -s` | 开 `tcp_tw_reuse`、用连接池 |
| CLOSE_WAIT 积压 | 代码未关连接 | `ss -tan` | 修复连接泄漏 |
| 网关不通 | 网关配错/宕 | `ip route` | 修正网关 |
| 网卡没起来 | 配置错/被 down | `ip link`、`ip addr` | 检查 ifcfg/netplan |
| IP 冲突 | 同网段重复 IP | `arping` | 改 IP |

```bash
arping -I eth0 192.168.1.10     # 检测该 IP 是否在网内冲突（有多个回复即冲突）
```

## 本篇小结

- **IP 是门牌号、MAC 是身份证、网关是小区大门、DNS 是通讯录**。
- **`ip` 命令已取代 `ifconfig`**，`ip addr`/`ip route`/`ip neigh` 是日常三件套。
- **云服务器别乱改网卡配置**，改错会失联，改动前留后路。
- **ping 不通 ≠ 网络断**，很多机器禁 ICMP，要用 `nc`/`ss` 测端口。
- **`curl -w` 拆解各阶段耗时**，精准定位 DNS/建连/TTFB 哪环慢。
- **`ss -tulnp` 看监听端口**，`lsof -i:8080` 查端口占用者。
- **CLOSE_WAIT 持续增长是连接泄漏**，比 TIME_WAIT 更值得警惕。
- **tcpdump 抓包是排查接口不通的终极手段**，配合 Wireshark 分析。
- **防火墙有两层**：本机 firewalld + 云安全组，都要放行。
- **网络性能看 `sar -n DEV` 与重传计数**，重传增长说明丢包。

## 参考链接

- [Linux 命令大全（菜鸟教程）](https://www.runoob.com/linux/linux-command-manual.html)
- [iproute2 手册 (man7)](https://man7.org/linux/man-pages/man8/ip.8.html)
- [tcpdump 官方文档](https://www.tcpdump.org/manpages/tcpdump.1.html)
- [firewalld 官方文档](https://firewalld.org/documentation/)
- [Arch Wiki - Networking](https://wiki.archlinux.org/title/Networking)
- [ss 命令手册 (man7)](https://man7.org/linux/man-pages/man8/ss.8.html)
- [curl 项目主页](https://curl.se/docs/manpage.html)

下一篇 → [11 Shell 脚本编程](/ops/linux/shell)
