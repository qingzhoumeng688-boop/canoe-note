# 01 Linux 入门与环境准备

> 本篇导读：想在服务端把 Linux 用得稳、用得明白，第一步是把"Linux 到底是什么"搞清楚。本篇从内核、发行版这些容易混淆的概念讲起，对比服务端为什么几乎清一色 Linux，帮你选对发行版，并提供虚拟机、云服务器、WSL2 四种上手环境，最后带你走完登录、换源、SSH 免密这一套标准初始化动作。

## 一、它是什么

很多人说"装个 Linux"，其实指的是一整套东西，里面三层经常被混为一谈：

- **内核（kernel）**：操作系统的核心，负责管 CPU、内存、磁盘、网络、进程调度。它只是一个程序，开机后常驻内存。
- **GNU 工具**： Richard Stallman 发起的 GNU 项目提供了 `ls`、`cp`、`bash`、`gcc` 等一整套用户态工具。光有内核你什么都干不了，必须配 GNU 工具才能用。
- **发行版（distribution）**：把内核 + GNU 工具 + 安装器 + 包管理器 + 桌面/服务打包成一个可安装的成品，比如 CentOS、Ubuntu。

一句话比喻：**内核是发动机，GNU 是方向盘和座椅，发行版是整车**。

Linux 与 Unix 的关系：Unix 是 1969 年贝尔实验室诞生的老祖宗，Linux 是 Linus Torvalds 在 1991 年读大学时写的"类 Unix"内核（当时他 21 岁，最初只是想在自己 386 电脑上跑个能用的系统）。Linux 没有用 Unix 的一行代码，但接口高度兼容 POSIX 标准，所以用法几乎一样。

## 二、为什么服务端几乎都是 Linux

| 维度 | 说明 |
| --- | --- |
| **开源免费** | 不用像商业 Unix（AIX/HP-UX）那样按 CPU 掏授权费，云上大规模部署成本极低 |
| **稳定** | 很多生产机连续运行几年不重启，内核与服务的稳定性经过海量验证 |
| **安全** | 权限模型清晰、漏洞响应快、社区审计充分；默认不跑多余服务，攻击面小 |
| **资源占用低** | 一个最小系统几百 MB 内存就能跑，服务器算力几乎全给业务 |
| **生态与社区** | 从数据库、中间件到编排系统，几乎所有服务端软件都是 Linux 优先支持 |
| **可定制** | 可以从内核裁剪到启动项，做出刚好够用的极简环境 |

反过来，**桌面端份额低**的原因也很现实：图形栈碎片化、软硬件驱动（尤其显卡、打印机）支持不如 Windows 省心、普通用户学习成本高。所以结论是——**桌面办公用 Windows/macOS，跑服务用 Linux**，各司其职。

## 三、发行版怎么选

生产环境最常见的三大家族：

| 家族 | 代表 | 包管理器 | 特点 / 适用场景 | 生命周期 |
| --- | --- | --- | --- | --- |
| **RedHat 系** | RHEL / CentOS / Rocky / Alma / Fedora | `yum`/`dnf`（`rpm`） | 企业级首选，文档全、生态稳，CentOS 停服后由 Rocky/Alma 接班 | RHEL 10 年，Fedora 半年 |
| **Debian 系** | Debian / Ubuntu | `apt`（`deb`） | 社区庞大、云原生友好，Ubuntu LTS 在容器/AI 场景极流行 | Ubuntu LTS 5 年（可延至 10 年） |
| **其他** | Alpine / openSUSE / openEuler | `apk`/`zypper`/`rpm` | Alpine 镜像极小适合容器；openEuler 是国产信创方向 | 各异 |

几个**必须知道的现实**：

- **CentOS 7 已于 2024-06-30 正式停止维护（EOL）**，不再有安全补丁，生产新机器不要再上。
- **CentOS Stream** 从"RHEL 的下游复刻"变成了"RHEL 的上游滚动版"，稳定性定位变了，不建议当生产稳定基线。
- **生产怎么选**：求稳选 **Rocky Linux / AlmaLinux**（CentOS 平替，二进制兼容 RHEL）；想要新特性与云原生生态选 **Ubuntu LTS 22.04/24.04**；容器基础镜像选 **Alpine** 或 **Ubuntu minimal**。

## 四、环境准备：四种方式

① **虚拟机安装（VMware / VirtualBox + ISO）**

适合本地练手。关键步骤：下载 ISO → 新建虚拟机（内存给 2G+、硬盘 20G+ 选"拆分成多个文件"）→ 安装时分区方案建议：

```text
/boot     1G     引导
/         20G    根
swap      2G     交换（内存够大可不要）
/data     剩余    数据（可选）
```

注意：安装类型选"Server"或"Minimal Install"即可，桌面用不到。

② **云服务器（阿里云 / 腾讯云 / 华为云）**

最贴近生产。建实例时**安全组**要提前规划：只放行 22（SSH）、80、443 以及你业务的端口，不要 0.0.0.0/0 全开。拿到公网 IP 后直接用 SSH 连。

③ **WSL2（Windows 下最省事）**

Win10/11 上开 WSL 最快：

```bash
# 管理员 PowerShell 执行
wsl --install            # 默认装 Ubuntu
wsl --list --online      # 看可选发行版
wsl --install -d Ubuntu-24.04
```

**WSL1 vs WSL2 区别**：WSL1 是翻译层（系统调用转 Windows），能直接访问 NTFS、跨系统文件快；WSL2 是轻量虚拟机（Hyper-V），Linux 兼容性与性能更好，但跨文件系统访问慢、需要端口转发。**日常开发推荐 WSL2**。

④ **双系统**

在 Windows 旁边划一个分区装 Linux，适合需要直接吃硬件性能的场景，但分区有风险、切换要重启，新手不优先。

## 五、第一次登录与初始化

登录后第一件事是标准化初始化。下面是 CentOS/Rocky 一类的操作（Ubuntu 把 `yum` 换成 `apt` 即可）：

```bash
# 1) 改主机名（立刻生效 + 写入配置）
hostnamectl set-hostname web01

# 2) 换国内 yum 源（阿里云，Rocky 用对应 repo 文件同理）
mv /etc/yum.repos.d/CentOS-Base.repo /etc/yum.repos.d/CentOS-Base.repo.bak
curl -o /etc/yum.repos.d/CentOS-Base.repo https://mirrors.aliyun.com/repo/Centos-7.repo
yum makecache

# 3) 更新系统 + 装常用工具
yum update -y
yum install -y vim wget curl net-tools lsof htop tree bash-completion

# 4) 同步时间（时间不同步会让 HTTPS、分布式系统各种诡异报错）
yum install -y chrony
systemctl enable --now chronyd
timedatectl set-timezone Asia/Shanghai
```

Ubuntu 换清华源的命令：

```bash
sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list
sed -i 's|http://security.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list
apt update && apt upgrade -y
```

防火墙：学习阶段可先放行或关闭 firewalld（生产务必开并只放必要端口）：

```bash
systemctl stop firewalld && systemctl disable firewalld
# 生产建议：firewall-cmd --add-service=ssh --permanent && firewall-cmd --reload
```

## 六、远程连接

SSH 本质是"加密的远程 Shell"：客户端用服务器的公钥做密钥交换，之后所有流量都加密，比 telnet 安全得多。

**账号密码登录**：

```bash
ssh root@192.168.1.10
```

**免密登录（生产推荐，且禁用密码登录）**：

```bash
# 本地生成密钥对（一路回车，默认 ~/.ssh/id_rsa）
ssh-keygen -t ed25519

# 把公钥推到服务器（自动写入 ~/.ssh/authorized_keys）
ssh-copy-id user@192.168.1.10
```

权限是个经典坑：`.ssh` 目录必须是 `700`，`authorized_keys` 必须是 `600`，否则 SSH 会拒绝使用：

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

常用客户端：**Xshell / FinalShell（国内常用，带文件管理）/ MobaXterm（自带 X11 转发）/ VS Code + Remote-SSH 插件**（写代码最顺手）。Windows 上现在自带 `ssh` 命令（OpenSSH 客户端），PowerShell 直接能用。

## 七、终端与 Shell 基础

先理清几个关系：

- **终端（Terminal）**：你输入命令的那个"窗口/程序"，负责显示和键盘输入。
- **Shell**：真正解释你命令的程序，最常见是 `bash`，还有 `zsh`（Oh My Zsh 很流行）。
- **Bash / Zsh**：都是 Shell 的具体实现。

```bash
echo $SHELL        # 看当前用的哪个 shell，比如 /bin/bash
cat /etc/shells    # 看系统装了哪些 shell
```

提示符含义：`[user@host 当前目录]$`，`#` 结尾表示你是 root。

**效率快捷键**（记住能省一半时间）：

| 快捷键 | 作用 |
| --- | --- |
| `Tab` | 命令/路径补全，双击看候选 |
| `Ctrl+R` | 反向搜索历史命令 |
| `Ctrl+C` | 终止当前前台进程 |
| `Ctrl+L` | 清屏（等同 `clear`） |
| `Ctrl+A` / `Ctrl+E` | 光标跳到行首 / 行尾 |
| `Ctrl+U` / `Ctrl+K` | 删光标前 / 光标后所有内容 |
| `↑` / `↓` | 翻历史命令 |

```bash
history          # 列出历史命令
history | grep ssh   # 找之前输过的 ssh 相关命令
!123             # 重新执行历史里第 123 条
```

## 本篇小结

- **内核 + GNU 工具 + 发行版**三者组合才是日常说的"Linux"，内核只是发动机。
- 服务端偏爱 Linux 主要因为**开源免费、稳定、安全、资源占用低、生态全**。
- 生产发行版优先选 **Rocky/Alma（RHEL 系）** 或 **Ubuntu LTS**，CentOS 7 已停服不要再用。
- **CentOS Stream** 已变成 RHEL 上游滚动版，不适合当稳定生产基线。
- 本地练手最省事是 **WSL2**，最贴近生产是**云服务器**。
- 装完系统第一件事是**换国内源、更新、装常用工具、同步时间（NTP）**。
- 时间不同步会导致 **HTTPS 证书校验失败、分布式系统时钟漂移**等诡异问题。
- SSH 登录优先用**密钥而非密码**，且 `.ssh` 权限必须是 `700`、`authorized_keys` 是 `600`。
- 生产机务必**开防火墙并只放行必要端口**，不要 0.0.0.0/0 全开。
- 终端负责显示、Shell 负责解释命令，日常默认是 **bash**（`echo $SHELL` 可查）。
- `Tab` 补全与 `Ctrl+R` 历史搜索是两个最值得养成的习惯。

## 参考链接

- [The Linux Kernel Archives 官网](https://www.kernel.org/)
- [Ubuntu 官方文档](https://ubuntu.com/tutorials)
- [Rocky Linux 官方文档](https://docs.rockylinux.org/)
- [ AlmaLinux 官网](https://almalinux.org/)
- [WSL 官方文档（Microsoft Learn）](https://learn.microsoft.com/zh-cn/windows/wsl/)
- [清华大学开源软件镜像站](https://mirrors.tuna.tsinghua.edu.cn/)
- [阿里云开源镜像站](https://mirrors.aliyun.com/)

下一篇 → [02 文件系统与目录结构](/ops/linux/filesystem)
