# 14 常用服务安装部署实战

前面学的命令最终是为了把服务稳稳地跑起来。本篇从"一台新机器拿到手"的标准初始化开始，依次实战 JDK、MySQL、Redis、Nginx 的安装配置，再走一遍"部署一个完整 Java 项目"的全流程，最后给出一份可打钩的安全基线。照着做，你能在 1 小时内把一台裸机变成能跑业务的生产环境。

## 一、装机后的标准动作

拿到新服务器，先做一份 checklist（按顺序）：

```bash
# 1. 换软件源（国内机器必做，否则 yum/apt 慢到怀疑人生）
#    CentOS: 换成阿里云/腾讯云镜像; Ubuntu: 改 /etc/apt/sources.list

# 2. 更新系统
yum update -y                      # CentOS/RHEL
apt update && apt upgrade -y       # Ubuntu/Debian

# 3. 装常用工具
yum install -y vim wget curl net-tools bind-utils lsof rsync \
    bash-completion tree unzip gzip  # net-tools 提供 ifconfig/route

# 4. 建部署专用用户（别全用 root）
useradd -m -s /bin/bash deploy
passwd deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy

# 5. SSH 加固：禁密码登录、改端口、禁 root 直登
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
#    先配好密钥登录再禁密码！否则会把自己锁在外面
systemctl restart sshd

# 6. 时区与 NTP 时间同步（时间不同步会让很多分布式系统出问题）
timedatectl set-timezone Asia/Shanghai
yum install -y chrony && systemctl enable --now chronyd   # 或 ntpdate

# 7. 文件句柄与内核参数（高并发服务必调）
cat >> /etc/security/limits.conf <<'EOF'
* soft nofile 65535
* hard nofile 65535
EOF
cat >> /etc/sysctl.conf <<'EOF'
vm.swappiness=10
net.core.somaxconn=65535
net.ipv4.tcp_tw_reuse=1
EOF
sysctl -p

# 8. 关 swap（K8s/部分数据库场景需要）
swapoff -a && sed -i '/ swap / s/^/#/' /etc/fstab
```

顺序很重要：第 5 步**务必先部署好公钥再禁密码登录**，否则会把自己挡在门外。

## 二、JDK 安装

两种方式：包管理安装（省事）或手动安装（可控版本，推荐生产）。手动安装：

```bash
# 1. 下载并解压到统一目录
tar -zxvf jdk-17_linux-x64_bin.tar.gz -C /usr/local/
mv /usr/local/jdk-17.0.2 /usr/local/jdk17

# 2. 配置 JAVA_HOME（写到 /etc/profile.d/ 而不是 /etc/profile）
cat > /etc/profile.d/jdk.sh <<'EOF'
export JAVA_HOME=/usr/local/jdk17
export PATH=$JAVA_HOME/bin:$PATH
EOF
source /etc/profile.d/jdk.sh

# 3. 多版本管理用 alternatives
alternatives --install /usr/bin/java java /usr/local/jdk17/bin/java 1
alternatives --config java          # 切换版本

# 4. 验证
java -version
```

**为什么不写 `/etc/profile` 而写 `/etc/profile.d/*.sh`**：`/etc/profile` 是主文件，直接改容易冲突且难维护；`/etc/profile.d/` 下的脚本会被自动 source，按模块拆分、增删干净，是更规范的做法。

## 三、MySQL 安装

以官方 yum/apt 源安装为例：

```bash
# 1. 添加官方源并安装（CentOS 示例）
rpm -Uvh https://dev.mysql.com/get/mysql80-community-release-el7.rpm
yum install -y mysql-community-server
systemctl enable --now mysqld

# 2. 首次启动后会生成临时 root 密码
grep 'temporary password' /var/log/mysqld.log
mysql -uroot -p                       # 用临时密码登录后改密码
ALTER USER 'root'@'localhost' IDENTIFIED BY 'NewStrong@123';

# 3. 配置文件关键项 /etc/my.cnf
#    [mysqld]
#    character-set-server=utf8mb4      # 用 utf8mb4 而非 utf8（真·4字节）
#    max_connections=500
#    innodb_buffer_pool_size=1G        # 视内存调整
#    bind-address=0.0.0.0              # 允许远程（配合授权）
```

**安全授权**：不要直接 `root@%` 开放公网。建专用用户并限制来源 IP：

```bash
CREATE USER 'app'@'192.168.1.%' IDENTIFIED BY 'AppPwd@123';
GRANT SELECT,INSERT,UPDATE,DELETE ON app_db.* TO 'app'@'192.168.1.%';
FLUSH PRIVILEGES;
```

数据目录与备份：

```bash
# 数据目录规划：大磁盘挂到 /data/mysql，改 datadir 后迁移
mkdir -p /data/mysql && chown -R mysql:mysql /data/mysql
# my.cnf 中 datadir=/data/mysql

# 备份用 mysqldump 或 xtrabackup
mysqldump -uroot -p --single-transaction app_db > app_db.sql
```

## 四、Redis 安装

源码编译或包安装均可，这里用包安装更省事：

```bash
yum install -y redis               # 或 apt install redis-server
```

关键配置 `/etc/redis.conf`：

```bash
bind 127.0.0.1                     # 默认只监听本机，公网务必保留，别 bind 0.0.0.0
protected-mode yes                 # 保护模式，无密码时不暴露公网
requirepass YourStrongPwd@123      # 必须设密码
daemonize no                       # 交给 systemd 管理时设为 no（前台跑）
dir /data/redis                    # 持久化目录，放空间大的盘
```

做成 systemd 服务并开机自启：

```bash
systemctl enable --now redis
redis-cli -a YourStrongPwd@123 ping     # 返回 PONG 即正常
```

基本安全提醒：**不要把 Redis 暴露公网**（大量被挖矿案例源于此），禁用危险命令防止误删：

```bash
# redis.conf 中重命名/禁用危险命令
rename-command FLUSHALL ""
rename-command KEYS ""
```

## 五、Nginx 安装

```bash
yum install -y nginx               # 或 apt install nginx
```

目录结构：主配置 `/etc/nginx/nginx.conf`，站点放 `/etc/nginx/conf.d/*.conf`，日志在 `/var/log/nginx/`。

主配置结构（反向代理后端 8080）：

```nginx
# /etc/nginx/conf.d/app.conf
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /static/ {
        alias /data/app/static/;     # 静态资源直出，不走后端
        expires 30d;
    }
}
```

校验与启动：

```bash
nginx -t                          # 改配置后必跑，语法错会让 reload 失败
systemctl enable --now nginx
systemctl reload nginx            # 平滑重载，不中断连接
```

HTTPS 用 Let's Encrypt 的 `certbot` 自动签发：

```bash
yum install -y certbot python3-certbot-nginx
certbot --nginx -d example.com    # 自动申请证书并改写配置
# 证书自动续期由 certbot 的 timer 负责
```

日志切割：Nginx 自带 `logrotate` 配置（`/etc/logrotate.d/nginx`），默认每日切割，无需手管。

## 六、其他常用环境

最简可用步骤：

```bash
# Node.js（用 nvm 管理多版本）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20 && nvm use 20

# Python（venv 隔离 + 换国内 pip 源）
python3 -m venv /data/venv && source /data/venv/bin/activate
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# Maven（阿里云镜像加速）
# settings.xml 的 <mirrors> 加：
#   <mirror><id>aliyun</id><url>https://maven.aliyun.com/repository/public</url>
#   <mirrorOf>central</mirrorOf></mirror>

# Git
yum install -y git
git config --global user.name "deploy"
git config --global user.email "deploy@example.com"

# Docker（详见本站 Docker 专栏）
curl -fsSL https://get.docker.com | bash -s docker
systemctl enable --now docker
```

## 七、部署一个完整 Java 项目

从零走一遍完整链路（假设已有 `app.jar`）：

```bash
# 1. 传 jar 包到服务器（本地执行）
scp target/app.jar deploy@192.168.1.10:/data/app/

# 2. 建目录与专用用户
ssh deploy@192.168.1.10
sudo useradd -r -s /sbin/nologin appuser
sudo mkdir -p /data/app && sudo cp ~/app.jar /data/app/
sudo chown -R appuser:appuser /data/app

# 3. 写 systemd unit（/etc/systemd/system/app.service）
#    见上一篇"编写 service 文件"，Type=simple 前台跑

# 4. 配 Nginx 反向代理（上一节 app.conf），把 80 转到 8080

# 5. 开防火墙与安全组（80/443 对外，8080 仅本机）
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
#    云控制台安全组放行 80/443

# 6. 开机自启并验证
sudo systemctl daemon-reload
sudo systemctl enable --now app
sudo systemctl enable --now nginx
systemctl status app              # Active: running
curl -I http://localhost/         # 经 Nginx 打到后端
journalctl -u app -f              # 看应用日志
```

完整 unit 示例（与上一篇呼应）：

```ini
[Unit]
Description=My App
After=network.target mysql.service redis.service

[Service]
Type=simple
User=appuser
WorkingDirectory=/data/app
Environment="JAVA_HOME=/usr/local/jdk17"
Environment="JAVA_OPTS=-Xms512m -Xmx1g -Dspring.profiles.active=prod"
ExecStart=/usr/local/jdk17/bin/java $JAVA_OPTS -jar /data/app/app.jar
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 八、安全基线

一份可打钩的检查清单（上线前逐条核对）：

- [ ] **禁 root 直登**：`PermitRootLogin no`
- [ ] **密钥登录、禁密码**：`PasswordAuthentication no`（先布好公钥）
- [ ] **改 SSH 端口**：降低被扫风险（非必须但推荐）
- [ ] **最小权限用户跑服务**：每个服务独立低权限账号，不用 root
- [ ] **防火墙只开必要端口**：22/80/443 等，其余默认拒
- [ ] **云安全组同步收口**：控制台也只放行业务端口
- [ ] **定期更新补丁**：`yum update`/`apt upgrade` 纳入计划
- [ ] **日志与审计**：`journalctl`/`/var/log` 可查，关键操作有记录
- [ ] **备份与恢复演练**：数据库定期备份，且**定期演练恢复**（只备不演练等于没备）
- [ ] **数据库/Redis 不暴露公网**：绑定内网，强密码
- [ ] **关 swap / 调内核参数**：按业务场景

安全是"木桶效应"，最短那块板决定整体水位，别漏掉任何一项。

## 本篇小结

- **新机器先做标准 checklist**：换源、更新、建部署用户、SSH 加固、NTP 同步。
- **SSH 加固必须先布密钥再禁密码**，否则会把自己锁在门外。
- **JAVA_HOME 写到 `/etc/profile.d/*.sh`** 而非 `/etc/profile`，更规范易维护。
- **MySQL 用 utf8mb4**，建专用受限用户而非 `root@%` 开放公网。
- **Redis 必须设 `requirepass` 且不暴露公网**，禁用 `FLUSHALL`/`KEYS` 防误删。
- **Nginx 改完必跑 `nginx -t`**，反向代理用 `proxy_pass` 转发后端。
- **HTTPS 用 `certbot` 自动签发续期**，免费且省心。
- **部署 Java 项目链路**：传包 → 建用户 → 写 unit → Nginx 反代 → 防火墙/安全组 → 开机自启。
- **systemd `Type=simple` 前台跑 jar** 是官方推荐姿势。
- **安全基线是木桶效应**，密钥登录、最小权限、防火墙、备份演练缺一不可。

## 参考链接

- [Linux 命令大全（菜鸟教程）](https://www.runoob.com/linux/linux-command-manual.html)
- [MySQL 官方安装文档](https://dev.mysql.com/doc/refman/8.0/en/installing.html)
- [Redis 官方文档](https://redis.io/docs/latest/operate/oss_and_stack/)
- [Nginx 官方文档](https://nginx.org/en/docs/)
- [certbot 官方文档](https://certbot.eff.org/docs/)
- [Oracle JDK 安装指南](https://docs.oracle.com/en/java/javase/17/install/)
- [Arch Wiki - Security](https://wiki.archlinux.org/title/Security)

下一篇 → [01 Linux 入门与环境准备](/ops/linux/overview)
