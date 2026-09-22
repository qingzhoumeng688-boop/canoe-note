# 07 软件包管理

在 Linux 运维中，"怎么装软件"是最基础也最频繁的动作。不同发行版有不同的包管理体系，但其本质都是解决同一个问题：**把软件及其依赖自动下载、安装、升级、卸载，并随时能查到装了什么、装在哪**。本篇先对比"包安装"与"源码编译"的取舍，再系统梳理 RedHat 系（`rpm`/`yum`/`dnf`）与 Debian 系（`dpkg`/`apt`）两大阵营的常用命令，最后补充源码编译、服务管理、防火墙与 SELinux 等装完软件后绕不开的周边知识。

## 一、源码安装 vs 包安装

| 维度 | 包管理安装 | 源码编译安装 |
| --- | --- | --- |
| 便捷性 | 一条命令自动完成 | 需要手动 `configure`/`make`/`install` |
| 依赖处理 | 自动解析并安装依赖 | 缺什么报什么，自己逐个装 |
| 版本 | 仓库版本通常偏旧 | 可拿到最新稳定版 |
| 可定制 | 固定编译选项 | 可加 `--with-xxx` 定制模块 |
| 维护性 | 升级/卸载干净彻底 | 卸载麻烦，容易残留 |
| 适用场景 | 99% 的常规软件 | 需要特定版本或特性时 |

**结论：优先用包管理**。只有在仓库版本太旧、需要某个编译开关、或官方只提供源码时，才走源码编译。日常运维里为了"追新"而编译安装，往往带来后期升级和排错的痛苦。

## 二、两大阵营

Linux 软件包按发行版分成两大家族，命令高度对应：

| 操作 | RedHat 系（CentOS/RHEL/Rocky） | Debian 系（Ubuntu/Debian） |
| --- | --- | --- |
| 安装本地包 | `rpm -ivh xxx.rpm` | `dpkg -i xxx.deb` |
| 安装（自动解决依赖） | `dnf install` / `yum install` | `apt install` |
| 卸载 | `dnf remove` | `apt remove` |
| 连配置一起删 | 手动清理 | `apt purge` |
| 查询已装包 | `rpm -qa` | `dpkg -l` |
| 查某文件属于哪个包 | `rpm -qf /path` | `dpkg -S /path` |
| 列出包内文件 | `rpm -ql pkg` | `dpkg -L pkg` |
| 升级全部 | `dnf upgrade` | `apt upgrade` |
| 搜索软件 | `dnf search` | `apt search` |
| 查看包详情 | `dnf info` | `apt show` |

记住一个心智模型：**RedHat 系底层是 `rpm`、上层是 `yum`/`dnf`；Debian 系底层是 `dpkg`、上层是 `apt`**。底层命令管"单个包"，上层命令管"依赖与仓库"。

## 三、rpm 与 dpkg

`rpm` 和 `dpkg` 是直接操作包的底层工具，不自动解决依赖，适合"我已经下载好包、只想装/查"的场景。

常用 `rpm` 命令：

```bash
# 安装（i=install, v=显示过程, h=显示进度条）
rpm -ivh nginx-1.20.1-9.el8.x86_64.rpm

# 升级（若未安装则直接安装）
rpm -Uvh nginx-1.20.1-9.el8.x86_64.rpm

# 卸载
rpm -e nginx

# 列出所有已装包（常与 grep 配合）
rpm -qa | grep nginx

# 查看某包的详细信息
rpm -qi nginx

# 列出某包安装到哪些文件
rpm -ql nginx

# 查某个文件属于哪个包（排错神器：比如发现 /usr/bin/curl 异常，先查它归谁管）
rpm -qf /usr/bin/curl
```

对应 `dpkg` 命令：

```bash
dpkg -i  redis-server_6.0.deb   # 安装本地 deb
dpkg -r  redis-server           # 卸载（保留配置）
dpkg -P  redis-server           # 彻底卸载（含配置）
dpkg -l | grep redis            # 列出已装
dpkg -L redis-server            # 列出包内文件
dpkg -S /usr/bin/redis-server   # 反查文件属于哪个包
```

包名命名规则：`名称-版本-发布号.架构.rpm`，例如 `nginx-1.20.1-9.el8.x86_64.rpm` 表示软件名 `nginx`、版本 `1.20.1`、发布号 `9`、适用 `el8`（RHEL8 系）、架构 `x86_64`。

## 四、yum / dnf 详解

`yum`（老）和 `dnf`（新）是带依赖解析的前端。`dnf` 是 `yum` 的下一代，从 CentOS 8 / RHEL 8 起成为默认，`yum` 命令通常只是 `dnf` 的软链接。

```bash
dnf install nginx              # 安装并自动解决依赖
dnf remove nginx               # 卸载
dnf update                     # 升级所有可升级的包
dnf list installed             # 列出已装
dnf list available | head      # 列出仓库里可装但未装的
dnf search mysql               # 按关键字搜索
dnf info nginx                 # 查看详情
dnf provides /usr/bin/curl     # 查"哪个包提供某命令/文件"（比 rpm -qf 更强，仓库里没装的也能查）
dnf grouplist                  # 查看软件包组
dnf history                    # 查看安装历史
dnf history undo 12            # 撤销第 12 条历史操作（装错了可回滚）
```

软件源配置在 `/etc/yum.repos.d/*.repo`，一个典型 repo 文件字段含义：

```ini
[base]                      # 仓库唯一 ID
name=CentOS Base            # 仓库显示名
baseurl=https://mirrors.aliyun.com/centos/$releasever/os/$basearch/
                            # 仓库地址，$releasever/$basearch 会自动替换为系统版本/架构
enabled=1                   # 是否启用（1 启用 0 禁用）
gpgcheck=1                  # 是否校验 GPG 签名（生产建议开启）
gpgkey=https://mirrors.aliyun.com/centos/RPM-GPG-KEY-CentOS-Official
```

换成阿里云 Base 源 + EPEL 扩展源：

```bash
# 备份原 repo
sudo mv /etc/yum.repos.d/CentOS-Base.repo /etc/yum.repos.d/CentOS-Base.repo.bak 2>/dev/null

# 下载阿里云 Base 源（CentOS 7 示例，其他版本换对应链接）
sudo curl -o /etc/yum.repos.d/CentOS-Base.repo https://mirrors.aliyun.com/repo/Centos-7.repo

# 安装 EPEL 源（提供大量官方仓库没有的软件）
sudo dnf install -y epel-release

# 清缓存并重建元数据（换源后必须执行，否则还是用旧缓存）
sudo yum clean all && sudo yum makecache
```

`yum clean all && yum makecache` 的作用是删除本地缓存的包索引、重新从新仓库拉取元数据，换源后不执行就会一直报"找不到包"。

## 五、apt 详解

Debian/Ubuntu 用 `apt`，它的核心习惯是：**装任何东西之前先 `apt update`**。

```bash
sudo apt update                        # 更新软件包索引（必须先执行，否则装的是旧列表）
sudo apt install nginx                 # 安装
sudo apt remove nginx                  # 卸载（保留配置）
sudo apt purge nginx                   # 连配置文件一起删
sudo apt autoremove                    # 删除因依赖装进来、现已无用的包
sudo apt search mysql                  # 搜索
sudo apt show nginx                    # 详情
sudo apt list --installed              # 已装列表
sudo apt upgrade                       # 升级所有可升级包（不删不改现有依赖）
sudo apt full-upgrade                  # 升级时允许删/装包以满足依赖（更彻底，谨慎）
```

源配置文件是 `/etc/apt/sources.list`，以及目录 `/etc/apt/sources.list.d/`（推荐把自定义源放这里，互不干扰）。换成清华源：

```bash
# 备份
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak

# Ubuntu 22.04 替换为清华源（其他版本把 jammy 换成对应代号）
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list
sudo sed -i 's|http://security.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list

# 换完务必更新索引
sudo apt update
```

`apt` 与 `apt-get` 的关系：`apt-get` 是老接口、脚本里更稳；`apt` 是面向人的新封装，输出更友好、自动启用彩色进度条。**交互式操作优先用 `apt`，写自动化脚本用 `apt-get`**（行为更稳定可预期）。

## 六、源码编译三部曲

当必须用源码时，标准流程是 `configure` → `make` → `make install` 三步：

```bash
./configure --prefix=/usr/local/nginx    # 1. 检测环境、生成 Makefile；--prefix 指定安装目录
make                                      # 2. 按 Makefile 编译，生成可执行文件（耗时大户）
make install                              # 3. 把编译结果复制到 --prefix 指定的目录
```

- **为什么推荐装到 `/usr/local/xxx`**：`/usr/local` 是"用户自行编译软件"的标准位置，和系统包管理器 `/usr` 分开，避免和系统包冲突，也方便日后整体删除。
- **卸载**：源码装的一般没有"卸载命令"，要么 `make uninstall`（仅部分软件支持），要么直接 `rm -rf /usr/local/nginx`。所以装之前最好记下来装哪了。
- **常见报错**：`./configure` 报 `C compiler not found` → `dnf install -y gcc`；报缺某库 `error: xxx not found` → 安装对应的 `-devel`/`-dev` 包，例如 `dnf install -y pcre-devel zlib-devel openssl-devel`。

完整实例——编译安装 Nginx：

```bash
# 装编译依赖
sudo dnf install -y gcc make pcre-devel zlib-devel openssl-devel

# 下载并解压
cd /usr/local/src
sudo curl -O https://nginx.org/download/nginx-1.24.0.tar.gz
sudo tar -xf nginx-1.24.0.tar.gz
cd nginx-1.24.0

# 三部曲
sudo ./configure --prefix=/usr/local/nginx \
                 --with-http_ssl_module \
                 --with-http_stub_status_module
sudo make
sudo make install

# 验证
/usr/local/nginx/sbin/nginx -v
```

## 七、systemd 服务管理

装完软件"怎么跑起来"由 systemd 负责（进程章节会展开，这里只讲装完即用的部分）。

```bash
systemctl start   nginx     # 启动
systemctl stop    nginx     # 停止
systemctl restart nginx     # 重启
systemctl status  nginx     # 查看状态（是否 running、最近日志）
systemctl enable  nginx     # 设开机自启
systemctl disable nginx     # 取消开机自启
```

服务单元文件（unit）的位置：
- `/usr/lib/systemd/system/`：软件包自带的服务定义；
- `/etc/systemd/system/`：管理员自定义或覆盖的配置（优先级更高）。

改了 unit 文件后必须让 systemd 重新加载：

```bash
sudo systemctl daemon-reload
```

## 八、防火墙

装好服务还要"把端口放开"，否则外部访问不进来。

`firewalld`（CentOS/RHEL 默认）：

```bash
sudo systemctl enable --now firewalld     # 开机并立即启用
sudo firewall-cmd --zone=public --add-port=80/tcp --permanent   # 放通 80 端口（--permanent 持久化）
sudo firewall-cmd --zone=public --add-service=http --permanent # 也可按"服务名"放通
sudo firewall-cmd --reload                # 重新加载使 --permanent 生效（不加 --permanent 的临时规则重启即失效）
sudo firewall-cmd --list-all              # 查看当前 zone 的放行规则
```

`ufw`（Ubuntu 默认，更简洁）：

```bash
sudo ufw allow 80/tcp
sudo ufw allow ssh
sudo ufw enable
sudo ufw status
```

`iptables`（传统底层，四表五链一句话）：**四表**指 `filter`（过滤）、`nat`（地址转换）、`mangle`（修改）、`raw`；**五链**指 `PREROUTING`、`INPUT`、`FORWARD`、`OUTPUT`、`POSTROUTING`，数据包按链的顺序被规则匹配。现代发行版多由 `firewalld`/`ufw` 在 `iptables`/`nftables` 之上做封装。

> **重点**：云服务器（阿里云/腾讯云/AWS 等）除了系统防火墙，还有一层**安全组**。两层都要放通端口，只开系统防火墙、安全组没放，外部照样连不上。

## 九、SELinux 简介

SELinux 是比 `rwx` 更细的强制访问控制（MAC），即使你 `chmod 777` 了，SELinux 策略不允许它访问，照样拒绝。

```bash
getenforce          # 查看当前模式：Enforcing / Permissive / Disabled
sudo setenforce 0   # 临时改为 Permissive（只记录不拦截，重启失效）
sudo setenforce 1   # 临时改回 Enforcing

ls -Z /var/www/html         # 查看文件的安全上下文（那串 user:role:type）
chcon -t httpd_sys_content_t /data/site   # 临时改类型让它被 httpd 访问
sudo grep nginx /var/log/audit/audit.log  # 排错：被 SELinux 拦截的记录在这里
```

三种状态：`Enforcing`（强制拦截）、`Permissive`（只记日志不拦截）、`Disabled`（关闭）。很多新手一上来就 `setenforce 0` 甚至关掉它，因为"改了权限还报错，烦"。**生产建议**：先别急着关，用 `audit.log` 定位是哪个 type 被拦，用 `chcon`/`semanage` 针对性放行；确有兼容问题时再考虑关闭，并在 `/etc/selinux/config` 里把 `SELINUX=` 改成 `disabled` 做永久变更（需重启）。

## 本篇小结

- **优先用包管理**而非源码编译，省心且易维护。
- RedHat 系底层 `rpm`、上层 `yum`/`dnf`；Debian 系底层 `dpkg`、上层 `apt`。
- `rpm -qf` / `dpkg -S` 可反查"某文件属于哪个包"，是排错利器。
- `dnf provides` / `apt` 能查仓库里"哪个包提供某命令"。
- `dnf` 是 `yum` 下一代，CentOS 8+ 起为默认。
- **`apt` 装软件前必须先 `apt update`**，否则索引是旧的，常见"找不到包"。
- 换源后务必 `yum clean all && yum makecache` 或 `apt update` 重建缓存。
- 源码编译 `./configure --prefix=/usr/local/xxx` 便于隔离与卸载。
- 编译报错多因缺 `gcc` 或 `-devel`/`dev` 依赖库。
- 装完用 `systemctl enable --now` 启动并设置开机自启。
- 防火墙与**云安全组**两层都要放通端口才算真正对外可访问。
- SELinux 被拦先看 `audit.log`，别盲目 `setenforce 0` 关闭。

## 参考链接

- [RPM 官方文档](https://rpm.org/documentation.html)
- [DNF 文档](https://dnf.readthedocs.io/)
- [YUM 官方 Wiki](https://yum.baseurl.org/)
- [APT 用户手册](https://wiki.debian.org/Apt)
- [CentOS 镜像站（阿里云）](https://mirrors.aliyun.com/centos/)
- [清华大学开源软件镜像站](https://mirrors.tuna.tsinghua.edu.cn/)
- [firewalld 官方文档](https://firewalld.org/documentation/)
- [SELinux 项目主页](https://selinuxproject.org/)

下一篇 → [08 进程与服务管理](/ops/linux/process)
