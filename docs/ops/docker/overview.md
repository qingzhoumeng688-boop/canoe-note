# 01 Docker 入门与安装

> 本篇解决什么问题：你有没有遇到过"代码在我电脑上运行得好好的，一部署到服务器就报错"？本篇带你从零认识 Docker——它到底是什么、解决了什么问题、和虚拟机有什么区别、怎么在自己机器上安装起来并跑通第一个容器。读完本篇，你能独立完成 Docker 的安装配置（含国内镜像加速）、理解镜像/容器/仓库三大核心概念，并且把第一个 Nginx 容器跑起来。

## 一、先聊聊没有 Docker 的日子有多痛

### 1.1 一个真实的场景

假设你写了一个 Spring Boot 项目，本地跑得好好的。现在要部署到服务器上，你可能会遇到这些情况：

- 本地 JDK 17，服务器上是 JDK 8，`UnsupportedClassVersionError` 直接起不来
- 项目依赖了某个系统库（比如图片处理的 `libjpeg`），服务器没装
- 配置文件里写死了 `/home/app/logs`，服务器上没有这个目录
- 端口 8080 被服务器上另一个程序占了
- 好不容易装好了，运维说"这台机器还要跑另外三个项目，你们几个项目依赖的 Python 版本冲突了"

于是就有了那句经典的甩锅名言：

> **"我电脑上明明能跑啊！"**

这句话背后的本质问题是：**应用依赖的环境（操作系统、系统库、运行时、配置）没有被一起交付，只有代码被交付了。**

### 1.2 部署方式的三代演化

| 阶段 | 做法 | 问题 |
|---|---|---|
| **物理机时代** | 一台服务器跑一个应用，直接装在裸机上 | 资源浪费严重（一个小程序独占一台机器）、采购周期长、扩容要买新机器 |
| **虚拟机时代** | 一台物理机用 VMware / KVM 虚拟出多台虚拟机，每台跑一个应用 | 隔离性好但**太重**：每台虚拟机都要装一个完整的操作系统，动辄几个 GB，启动要几分钟 |
| **容器时代** | 应用和它的依赖打包成一个镜像，在容器里跑 | 轻量、秒级启动、资源占用小、环境完全一致 |

用一张文本图直观感受一下三者的结构差异：

```text
【物理机】
┌─────────────────────────────────────────┐
│  App A        App B        App C        │  ← 三个应用挤在一起，互相干扰
├─────────────────────────────────────────┤
│            Host Operating System        │
├─────────────────────────────────────────┤
│                Server (硬件)            │
└─────────────────────────────────────────┘

【虚拟机】
┌──────────┐ ┌──────────┐ ┌──────────┐
│  App A   │ │  App B   │ │  App C   │
├──────────┤ ├──────────┤ ├──────────┤
│ Guest OS │ │ Guest OS │ │ Guest OS │  ← 每个 VM 自带完整操作系统（重！）
│ (Linux)  │ │ (Linux)  │ │ (Linux)  │
├──────────┤ ├──────────┤ ├──────────┤
│          Hypervisor (VMware/KVM)        │  ← 虚拟硬件层
├─────────────────────────────────────────┤
│            Host Operating System        │
├─────────────────────────────────────────┤
│                Server (硬件)            │
└─────────────────────────────────────────┘

【容器】
┌──────────┐ ┌──────────┐ ┌──────────┐
│  App A   │ │  App B   │ │  App C   │
│ +libs    │ │ +libs    │ │ +libs    │  ← 只打包应用和自己需要的库
├──────────┤ ├──────────┤ ├──────────┤
│        Docker Engine (容器运行时)       │  ← 没有 Hypervisor 这一层
├─────────────────────────────────────────┤
│            Host Operating System        │  ← 所有容器共享宿主机内核
├─────────────────────────────────────────┤
│                Server (硬件)            │
└─────────────────────────────────────────┘
```

关键差异就在那句：**虚拟机虚拟的是"硬件"，容器虚拟的是"操作系统"**。容器不需要每个都装一套操作系统，它们共享宿主机的内核，所以能做得又快又小。

### 1.3 虚拟机 vs 容器 对比表

| 对比维度 | 虚拟机 (VM) | 容器 (Container) |
|---|---|---|
| **隔离级别** | 操作系统级别，强隔离 | 进程级别，通过 Namespace 隔离 |
| **虚拟化层次** | Hypervisor 虚拟硬件 | Docker Engine 直接使用宿主机内核 |
| **操作系统** | 每个 VM 自带 Guest OS | 共享宿主机内核，只打包应用和库 |
| **体积** | GB 级（一个 CentOS 镜像就 4GB+） | MB 级（Alpine 基础镜像才 5MB） |
| **启动速度** | 分钟级（要开机） | 秒级甚至毫秒级（就是启动一个进程） |
| **性能损耗** | 较大（多一层虚拟化） | 极小（接近原生，通常 <5%） |
| **单机可运行数量** | 十几台 | 上百甚至上千个 |
| **隔离性** | 强（内核都隔离了） | 相对弱（共享内核，理论上内核漏洞会影响所有容器） |
| **适用场景** | 需要完整 OS、跑不同内核的系统、强隔离 | 微服务、CI/CD、应用打包分发、弹性扩缩容 |

::: tip 一句话总结
虚拟机是"在硬件层面分家"，容器是"在操作系统层面分家"。容器更轻、更快，但隔离性不如虚拟机。如果你的需求只是"把应用和它的运行环境打包带走"，容器是更合适的选择。
:::

## 二、Docker 是什么

### 2.1 官方定义

Docker 是一个**开源的容器化平台**，用 Go 语言开发，2013 年由 dotCloud 公司开源（后来公司干脆改名叫 Docker Inc.）。

它的核心思想是：**把应用连同它依赖的所有东西（代码、运行时、系统工具、系统库、配置）一起打包成一个标准化的单元（镜像），这个单元可以在任何支持 Docker 的地方以相同的方式运行。**

一句话口号：**Build once, Run anywhere（一次构建，到处运行）**。

### 2.2 集装箱比喻（一定要理解这个）

Docker 的 Logo 是一只鲸鱼驮着一堆集装箱，这不是随便画的，它背后是整个设计哲学：

| 现实中的集装箱 | Docker 中的容器 |
|---|---|
| 货主不用关心这箱货会上哪条船、哪辆卡车 | 开发者不用关心应用会跑在什么服务器、什么 Linux 发行版上 |
| 只要箱子规格统一（20 尺/40 尺），任何交通工具都能运 | 只要打包成标准镜像，任何装了 Docker 的机器都能跑 |
| 装卸用统一的吊机，效率极高 | 部署用统一的 `docker run`，效率极高 |
| 箱子里的货互相隔离，不会串味 | 容器之间互相隔离，不会互相干扰 |

在集装箱发明之前，码头的装卸效率极低，因为每件货物的形状、包装都不一样，得一件一件地搬。集装箱统一了规格，才有了今天的全球化贸易。**Docker 对软件交付做的事，和集装箱对货运做的事，是同一件事。**

### 2.3 Docker 能干什么

| 能力 | 说明 |
|---|---|
| **环境一致性** | 开发、测试、生产用同一个镜像，从根本上消灭"我电脑上能跑" |
| **快速部署与扩缩容** | 容器启动是秒级的，流量来了 10 秒扩容 20 个实例，走了再销毁 |
| **资源隔离与限制** | 可以精确限制某个容器最多用 2 核 CPU、1GB 内存，不会拖垮宿主机 |
| **微服务与 CI/CD 的基础** | 每个微服务独立打包成镜像，流水线自动构建、测试、部署 |
| **新人环境搭建神器** | 新同事入职，一条 `docker compose up` 把 MySQL、Redis、RabbitMQ、ES 全套依赖拉起来 |
| **充分利用资源** | 一台机器跑几十个相互隔离的服务，而不是只能跑几个虚拟机 |

### 2.4 Docker 不能干什么（防止滥用）

::: danger 别把容器当虚拟机用
- **容器不是虚拟机**。容器里不应该跑 `systemd`，不应该跑多个进程（如 SSH + Nginx + 应用）。一个容器**只做一件事**，这是容器的最佳实践。
- **容器是"用完即扔"的（ephemeral）**。容器被删除，里面产生的数据也没了。数据库、日志、上传的文件必须挂载到外部（数据卷，第 04 章详细讲）。
- **有状态服务放容器要谨慎**。虽然现在数据库也能跑在容器里（配合数据卷 + 资源限制），但在生产上你还需要考虑备份、故障漂移、存储性能等，通常云厂商的托管数据库是更省心的选择。
- **容器共享宿主机内核**。所以 Windows 容器不能在 Linux 上跑（反过来也需要特殊支持），且内核漏洞的影响面是所有容器。
:::

## 三、三大核心概念（本篇最重要的部分）

Docker 有三个必须搞清楚的概念：**镜像（Image）**、**容器（Container）**、**仓库（Repository）**。

### 3.1 三个比喻帮你记住它们

| 概念 | 比喻一（编程） | 比喻二（生活） | 比喻三 |
|---|---|---|---|
| **镜像 Image** | 类（Class） | 模具 / 月饼模子 | 一个安装包（ISO 光盘镜像） |
| **容器 Container** | 对象（Object，类的实例） | 用模具做出来的月饼 | 装好的系统 / 跑起来的程序 |
| **仓库 Repository** | Maven 仓库 | 应用商店 | Docker Hub |

**镜像是静态的、只读的定义；容器是镜像跑起来的动态实例。** 一个镜像可以启动任意多个容器，就像一个类可以 new 出无数个对象。

### 3.2 关系图

```text
    Dockerfile                    Registry（仓库，如 Docker Hub）
        │                                  │
        │  docker build                    │ docker pull（下载）
        │  （按 Dockerfile 构建）           │ docker push（上传）
        ▼                                  ▼
   ┌─────────────────────────────────────────────┐
   │            Image（镜像，只读模板）            │
   │   分层存储：base 层 + 层1 + 层2 + ...        │
   └─────────────────────────────────────────────┘
        │
        │  docker run（运行）
        ▼
   ┌─────────────────────────────────────────────┐
   │            Container（容器，运行实例）        │
   │   镜像的只读层（共享） + 容器可写层（独有）    │
   └─────────────────────────────────────────────┘
        │
        │  docker commit（一般不用，用 Dockerfile 才是正道）
        ▼
      新镜像
```

### 3.3 镜像 Image

- **只读的模板**，包含了运行应用所需的一切：代码、运行时、库、环境变量、配置文件
- **分层存储**：镜像不是一整个大文件，而是由多层（Layer）叠加而成，每层是前一层的增量修改。这个设计让镜像可以被复用和共享（第 02 章深入讲）
- 镜像本身不能被修改，只能基于它创建新的镜像

### 3.4 容器 Container

- 镜像的**运行实例**，是真正跑起来的进程
- 每个容器都有自己的：**文件系统、网络、进程空间**，相互隔离
- 容器 = **镜像的只读层** + **最上面一层可写层**（容器层）
- 容器可以被创建、启动、停止、删除、暂停
- **容器的生命周期和它的主进程绑定：主进程结束，容器就退出**（这个特性后面会反复提到）

### 3.5 仓库 Repository 与 tag

**仓库**是集中存放镜像的地方。

| 概念 | 说明 |
|---|---|
| **Registry（注册服务器）** | 存放仓库的服务器，如 Docker Hub（`docker.io`）、阿里云 ACR、私有 Harbor |
| **Repository（仓库）** | 一个 Registry 上可以有多个仓库，每个仓库存**同一个软件的不同版本**，如 `nginx`、`mysql` |
| **Tag（标签）** | 仓库里每个镜像的版本标识，如 `1.25`、`8.0`、`alpine` |

一个完整的镜像名长这样：

```text
registry.cn-hangzhou.aliyuncs.com/myproject/myapp:1.0.0
└────────────┬────────────────┘└────┬────┘└──┬──┘ └──┬──┘
          Registry 地址         命名空间  仓库名    Tag
```

常用的简写规则（以 Docker Hub 为例）：

| 写法 | 实际等价于 |
|---|---|
| `nginx` | `docker.io/library/nginx:latest` |
| `nginx:1.25` | `docker.io/library/nginx:1.25` |
| `mysql:8.0` | `docker.io/library/mysql:8.0` |
| `bitnami/redis:7.4` | `docker.io/bitnami/redis:7.4`（`bitnami` 是命名空间/组织名） |

::: danger latest 的坑（非常重要）
**如果你不写 tag，Docker 默认用 `latest`。但 `latest` 只是一个普通的 tag，它不代表"最新版本"！**

- `latest` 是镜像维护者手动打上去的，他忘了打，那 latest 就是一个月前的老版本
- 今天 `docker pull nginx` 拿到的 latest，和三个月后拉到的，可能完全不是同一个版本
- **生产环境千万不要用 latest**：无法确定跑的是哪一版，出了问题无法回滚，别人不知道你用的什么版本

正确做法：明确指定版本，例如 `nginx:1.25.4-alpine`、`openjdk:17-jdk-slim`。
:::

## 四、Docker 的架构

### 4.1 架构图

```text
┌──────────────────┐                        ┌──────────────────────────┐
│  Docker Client   │   REST API over        │      Docker Host         │
│  （docker 命令）  │ ◄──── unix socket ────► │                          │
│                  │      或 TCP:2375       │  ┌────────────────────┐  │
│  docker build    │                        │  │  Docker Daemon     │  │
│  docker pull     │                        │  │  (dockerd)         │  │
│  docker run      │                        │  │  真正干活的守护进程 │  │
└──────────────────┘                        │  └─────────┬──────────┘  │
                                            │            │             │
                                            │  ┌─────────▼──────────┐  │
                                            │  │  Containers 容器   │  │
                                            │  │  Images 镜像       │  │
                                            │  └───────────────────┘  │
                                            └────────────┬─────────────┘
                                                         │ pull / push
                                            ┌────────────▼─────────────┐
                                            │   Registry（Docker Hub / │
                                            │   阿里云 ACR / Harbor）  │
                                            └──────────────────────────┘
```

### 4.2 各个角色说明

| 角色 | 是什么 | 说明 |
|---|---|---|
| **Docker Client** | 你敲的 `docker` 命令 | 命令行工具，通过 REST API 跟 Daemon 通信。**Client 和 Daemon 可以在不同机器上**，所以能远程管理 |
| **Docker Daemon (dockerd)** | 常驻后台的守护进程 | Docker 的核心，负责构建、运行、管理容器。它监听 `unix:///var/run/docker.sock` |
| **Docker Host** | 运行 Docker 的机器 | 上面有 Daemon、容器、镜像 |
| **Registry** | 镜像仓库 | 默认 Docker Hub，可配私有仓库 |
| **Images / Containers** | 镜像和容器 | 前面讲过 |

输入 `docker version` 你会看到两段输出，这正好对应了 Client 和 Server：

```bash
$ docker version
Client: Docker Engine - Community      # ← 客户端信息
 Version:           27.3.1
 API version:       1.47
 Go version:        go1.22.7
 Built:             ...
 OS/Arch:           linux/amd64
 Context:           default

Server: Docker Engine - Community      # ← 服务端（Daemon）信息
 Engine:
  Version:          27.3.1
  API version:      1.47 (minimum version 1.24)
  ...
 containerd:
  Version:          1.7.24
 runc:
  Version:          1.1.13
```

::: tip 常见报错
如果只显示了 `Client` 段，`Server` 段报错 `Cannot connect to the Docker daemon`，说明 **Daemon 没启动**。执行 `systemctl start docker` 即可。
:::

### 4.3 Docker 底层依赖的三大技术

Docker 之所以能做到"轻量隔离"，靠的是 Linux 内核的这三个特性（面试常问）：

| 技术 | 作用 | 具体内容 |
|---|---|---|
| **Namespace（命名空间）** | **隔离**：让容器以为自己独占了一台机器 | 见下表六种 |
| **Cgroups（Control Groups）** | **限制**：限制容器能用多少资源 | CPU、内存、磁盘 IO、网络带宽 |
| **UnionFS（联合文件系统）** | **分层**：让镜像能一层层叠加并复用 | OverlayFS、AUFS 等 |

六种 Namespace 分别隔离了什么：

| Namespace | 隔离内容 | 举例（容器里的现象） |
|---|---|---|
| **pid** | 进程 ID | 容器内 `ps` 看到的 1 号进程是自己的应用，看不到宿主机和其他容器的进程 |
| **net** | 网络（网卡、IP、端口、路由表） | 容器有自己的 IP 和端口，8080 不会被宿主机占用 |
| **mnt** | 文件系统挂载点 | 容器有自己的根目录 `/`，看不到宿主机的文件 |
| **uts** | 主机名和域名 | 容器可以有自己的 hostname |
| **ipc** | 进程间通信（消息队列、共享内存） | 容器内的 IPC 不会串到别的容器 |
| **user** | 用户和用户组 | 容器里的 root 不一定是宿主机的 root（可以做 UID 映射） |

一句话记：**Namespace 解决"看不见"，Cgroups 解决"抢不走"，UnionFS 解决"存得省"。**

## 五、安装 Docker（Linux 为主）

### 5.1 环境准备

Docker 运行在 Linux 上，对内核有要求：

```bash
# 查看内核版本，需要 3.10 以上，推荐 4.x 或更高
uname -r
# 输出示例：5.15.0-91-generic

# 查看发行版
cat /etc/os-release
```

::: tip Windows 和 Mac 用户
Linux 用户直接装 Docker Engine；Windows / Mac 请装 **Docker Desktop**（见 5.5 节）。注意：**Docker Desktop 在 Windows 上依赖 WSL2，在 Mac 上依赖一个 Linux 虚拟机**，因为 Docker 容器本质是 Linux 技术。
:::

### 5.2 卸载旧版本（新机器可跳过）

如果机器上以前装过旧版本，先卸掉，避免冲突：

**CentOS：**

```bash
sudo yum remove -y docker \
    docker-client \
    docker-client-latest \
    docker-common \
    docker-latest \
    docker-latest-logrotate \
    docker-logrotate \
    docker-engine
```

**Ubuntu：**

```bash
sudo apt-get remove -y docker docker-engine docker.io containerd runc
```

::: tip 注意
卸载时**不会**自动删除 `/var/lib/docker` 目录下的镜像、容器、数据卷。如果你想彻底清空，手动 `rm -rf /var/lib/docker`（**危险操作，确认没有重要数据再执行**）。
:::

### 5.3 CentOS 安装（yum）

```bash
# 1. 安装 yum 工具包（提供 yum-config-manager）
sudo yum install -y yum-utils

# 2. 添加 Docker 官方仓库
#    国内建议用阿里云镜像源，速度快很多：
sudo yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
#    官方源（国内较慢）：https://download.docker.com/linux/centos/docker-ce.repo

# 3. 安装 Docker Engine
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

装完后，这四个/五个包分别是干什么的：

| 包名 | 作用 |
|---|---|
| `docker-ce` | Docker 社区版引擎（核心，包含 dockerd 守护进程） |
| `docker-ce-cli` | Docker 命令行工具（你敲的 `docker` 命令） |
| `containerd.io` | 底层容器运行时（真正创建/运行容器的组件） |
| `docker-buildx-plugin` | 增强的构建工具，支持多平台构建（`docker buildx`） |
| `docker-compose-plugin` | Compose 插件，可以用 `docker compose` 命令（第 05 章讲） |

::: tip 为什么要装 containerd？
Docker 的架构是分层的：`dockerd` → `containerd` → `containerd-shim` → `runc` → 容器进程。真正跟内核打交道、创建容器的是最底层的 `runc`，中间由 `containerd` 管理容器的生命周期。Docker 把这些拆成独立项目捐给了 CNCF，所以现在要单独装。
:::

### 5.4 Ubuntu 安装（apt）

```bash
# 1. 更新 apt 索引并安装依赖
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# 2. 添加 Docker 官方 GPG 密钥（用阿里云镜像的 key）
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 3. 添加 apt 源（阿里云）
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://mirrors.aliyun.com/docker-ce/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 4. 安装
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 5.5 Windows / Mac 安装

| 平台 | 做法 | 注意事项 |
|---|---|---|
| **Windows 10/11** | 装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，后端选 **WSL2** | 需要先开启 WSL2（`wsl --install`）和虚拟机平台；**家庭版也能用**（WSL2 后端不需要 Hyper-V）；内存建议 8GB 以上 |
| **Mac** | 装 Docker Desktop（Intel 芯片和 Apple 芯片版本不同） | Mac 上 Docker 实际跑在一个轻量 Linux VM 里，磁盘 IO 性能比 Linux 原生差；M1/M2 拉 x86 镜像要加 `--platform linux/amd64` |
| **Linux** | 直接装 Docker Engine（本节主体） | 性能最好，生产环境的标准做法 |

::: warning Docker Desktop 的授权
2021 年起，**Docker Desktop 对员工超过 250 人或年收入超过 1000 万美元的企业开始收费**（个人、小企业、教育、开源项目仍然免费）。服务器上请用 Docker Engine（免费开源），不要装 Desktop。
:::

### 5.6 启动与验证

```bash
# 启动 Docker 服务
sudo systemctl start docker

# 设置开机自启
sudo systemctl enable docker

# 查看运行状态（看到 active (running) 就对了）
sudo systemctl status docker
# ● docker.service - Docker Application Container Engine
#      Loaded: loaded (/usr/lib/systemd/system/docker.service; enabled; ...)
#      Active: active (running) since Mon 2026-09-21 10:00:00 CST; 5s ago
```

验证安装：

```bash
# 查看版本信息（Client + Server 两段都要有）
docker version

# 查看详细信息（镜像数、容器数、存储驱动、Registry 等）
docker info

# 跑一个测试镜像（最关键的验证）
docker run hello-world
```

### 5.7 hello-world 的输出逐行解读

`docker run hello-world` 的输出是理解 Docker 工作流程最好的教材，我们来逐行看：

```text
$ docker run hello-world
Unable to find image 'hello-world:latest' locally          # ①
latest: Pulling from library/hello-world                    # ②
c1ec31eb5944: Pull complete                                 # ③
Digest: sha256:53cc4d415b8398f3a...                        # ④
Status: Downloaded newer image for hello-world:latest       # ⑤

Hello from Docker!                                          # ⑥
This message shows that your installation appears to be working correctly.

To generate this message, Docker took the following steps:  # ⑦
 1. The Docker client contacted the Docker daemon.
 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.
    (amd64)
 3. The Docker daemon created a new container from that image
    which runs the executable that produces the output you are currently reading.
 4. The Docker daemon streamed that output to the Docker client
    and sent it to your terminal.
```

| 行号 | 含义 |
|---|---|
| ① | 本地找不到 `hello-world:latest` 这个镜像（**没写 tag 就默认 latest**） |
| ② | 去 Docker Hub 的 `library` 命名空间拉取 |
| ③ | 正在下载镜像层（`c1ec31eb5944` 是这一层的 ID），下载完成 |
| ④ | 镜像的摘要（SHA256），是内容的指纹，可以用来精确锁定版本 |
| ⑤ | 下载完成 |
| ⑥ | **容器运行后输出的内容**（这才是容器里程序真正打印的东西） |
| ⑦ | Docker 官方贴心地告诉了你刚才发生的四步流程 |

这四步就是 Docker 的完整工作流：

```text
1. Client 通知 Daemon        →  你敲了 docker run
2. Daemon 拉取镜像           →  本地没有就去 Registry 下载
3. Daemon 用镜像创建容器      →  镜像变成运行中的容器
4. Daemon 把输出传回 Client   →  你在终端看到结果
```

### 5.8 让非 root 用户也能用 docker（重要）

默认情况下，`docker` 命令只有 root 和 docker 用户组能用，普通用户执行会报：

```text
Got permission denied while trying to connect to the Docker daemon socket
```

解决办法是把当前用户加入 `docker` 用户组：

```bash
# 1. 把当前用户加入 docker 组
sudo usermod -aG docker $USER

# 2. 刷新用户组（或者干脆退出重新登录）
newgrp docker

# 3. 验证（不加 sudo 也能跑就对了）
docker run hello-world
```

::: danger 安全警告（必须知道）
**拥有 docker 权限 ≈ 拥有 root 权限。**

因为你可以执行 `docker run -v /:/host-root -it alpine chroot /host-root`，把宿主机的根目录挂载进容器，然后以 root 身份读写宿主机的任何文件。

所以：
- 不要给不信任的用户加 docker 组
- 生产服务器上要谨慎授权
- 更安全的替代方案是 rootless mode（无 root 模式），可参考官方文档
:::

## 六、配置镜像加速器（国内必配）

### 6.1 为什么要配

Docker Hub 的服务器在海外，国内拉取镜像经常是几十 KB/s，甚至超时失败。配置**镜像加速器**（Registry Mirror）后，Docker 会先去国内镜像站拉，速度能快几十倍。

### 6.2 配置方法

编辑（或新建）`/etc/docker/daemon.json`：

```bash
sudo mkdir -p /etc/docker
sudo vi /etc/docker/daemon.json
```

写入以下内容：

```json
{
  "registry-mirrors": [
    "https://<你的ID>.mirror.aliyuncs.com",
    "https://docker.m.daocloud.io",
    "https://hub-mirror.c.163.com"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  },
  "exec-opts": ["native.cgroupdriver=systemd"],
  "data-root": "/var/lib/docker",
  "live-restore": true
}
```

然后重启 Docker：

```bash
# 重新加载配置文件
sudo systemctl daemon-reload

# 重启 Docker
sudo systemctl restart docker

# 验证：看到你配置的镜像地址就成功了
docker info | grep -A 8 "Registry Mirrors"
#  Registry Mirrors:
#   https://xxxxxx.mirror.aliyuncs.com/
#   https://docker.m.daocloud.io/
```

### 6.3 daemon.json 常用配置项说明

| 配置项 | 作用 | 说明 |
|---|---|---|
| `registry-mirrors` | 镜像加速器地址列表 | 按顺序尝试，第一个不通会试下一个 |
| `log-driver` | 容器日志驱动 | 默认 `json-file`，日志存在 `/var/lib/docker/containers/<id>/` |
| `log-opts.max-size` | 单个日志文件最大大小 | **必须设置！**否则日志会无限增长撑爆磁盘 |
| `log-opts.max-file` | 保留几个日志文件 | 配合 max-size 做日志轮转 |
| `exec-opts` | 运行时执行选项 | `native.cgroupdriver=systemd` 让 Docker 用 systemd 管理 cgroup（**K8s 环境必须配**） |
| `data-root` | Docker 数据根目录 | 镜像、容器、数据卷都存在这里。**如果根分区小，建议改到大磁盘上** |
| `live-restore` | 守护进程重启时容器不停止 | 升级 Docker 时业务不中断 |
| `insecure-registries` | 允许 http 访问的私有仓库 | 自建 Registry 用 http 时必须配 |
| `dns` | 容器使用的 DNS 服务器 | 容器内解析不了域名时可以配 |

::: tip 阿里云加速器地址怎么拿
登录 [阿里云控制台](https://cr.console.aliyun.com/) → 容器镜像服务 ACR → 镜像工具 → 镜像加速器，页面上会给你一个专属地址（形如 `https://abc123.mirror.aliyuncs.com`）。**每个人的地址不一样，不要照抄别人的。**
:::

::: warning 注意
网上流传的很多公共加速器地址会失效。如果你发现拉取还是很慢或报 `error pulling image configuration`，说明这个加速器挂了，换一个或者直接用阿里云给你的专属地址。
:::

### 6.4 Docker 的重要目录

| 路径 | 作用 |
|---|---|
| `/etc/docker/daemon.json` | Docker 守护进程的主配置文件 |
| `/var/lib/docker` | 数据根目录 |
| `/var/lib/docker/containers/<容器ID>/` | 每个容器的配置和日志（`*-json.log` 就是 `docker logs` 读的文件） |
| `/var/lib/docker/image/` | 镜像的元数据 |
| `/var/lib/docker/overlay2/` | 镜像和容器的实际分层数据 |
| `/var/lib/docker/volumes/` | 数据卷（第 04 章讲） |
| `/var/run/docker.sock` | Daemon 的 Unix socket，Client 通过它通信 |

## 七、第一个实战：跑一个 Nginx

### 7.1 启动容器

```bash
docker run -d -p 80:80 --name my-nginx nginx
```

逐个参数解释：

| 参数 | 含义 |
|---|---|
| `docker run` | 创建并启动一个容器 |
| `-d` | **detached**，后台运行（不加 `-d` 会占用当前终端，Ctrl+C 容器就停了） |
| `-p 80:80` | **端口映射**，格式 `-p 宿主机端口:容器端口`。把宿主机的 80 端口映射到容器的 80 端口 |
| `--name my-nginx` | 给容器起个名字。不指定 Docker 会随机生成一个（如 `boring_bose`） |
| `nginx` | 使用的镜像名（等价于 `nginx:latest`） |

第一次运行会先下载镜像，输出类似：

```text
Unable to find image 'nginx:latest' locally
latest: Pulling from library/nginx
a2abf6c4d29d: Pull complete
...
Status: Downloaded newer image for nginx:latest
3f8a5c1b9e2d7a6b4c5e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c
```

最后那串长字符就是**容器 ID**。

### 7.2 验证

```bash
# 浏览器访问 http://你的服务器IP
# 或者用 curl 测试
curl http://localhost
# 应该看到 "Welcome to nginx!" 的 HTML
```

### 7.3 完整生命周期操作

```bash
# 1. 查看正在运行的容器
docker ps
# CONTAINER ID   IMAGE   COMMAND                  CREATED        STATUS        PORTS                 NAMES
# 3f8a5c1b9e2d   nginx   "/docker-entrypoint.…"   2 minutes ago   Up 2 minutes  0.0.0.0:80->80/tcp   my-nginx

# 2. 查看所有容器（包括已停止的）
docker ps -a

# 3. 查看容器日志
docker logs my-nginx
# 加上 -f 可以实时跟踪（类似 tail -f）
docker logs -f my-nginx

# 4. 进入容器内部（交互式）
docker exec -it my-nginx /bin/bash
# -i 交互式（保持标准输入打开）
# -t 分配一个伪终端
# 进去后可以执行：ls /usr/share/nginx/html、cat /etc/nginx/nginx.conf 等
# 输入 exit 退出（退出后容器不会停止）

# 5. 停止容器
docker stop my-nginx
# 实际是发 SIGTERM 信号，10 秒后还没停就发 SIGKILL

# 6. 启动已停止的容器
docker start my-nginx

# 7. 重启
docker restart my-nginx

# 8. 删除容器（必须先停止，或用 -f 强制删除运行中的）
docker rm my-nginx
docker rm -f my-nginx   # 强制删除运行中的容器

# 9. 删除镜像
docker rmi nginx
```

### 7.4 用这条链路理解容器生命周期

```text
                    docker create                     docker start
  镜像 Image    ──────────────────►  容器 Created  ──────────────────►  容器 Running
                                          │                                  │
                                          │                                  │ docker stop
                                          │                                  ▼
                                          │                            容器 Exited
                                          │                                  │
                                          │         docker rm                 │
                                          └──────────────────────────────────┴──►  删除
                                          
  docker run  =  docker create + docker start + (可选) docker attach
```

容器的几种状态：

| 状态 | 含义 |
|---|---|
| `Created` | 已创建但未启动 |
| `Up` / `Running` | 运行中 |
| `Exited` | 已停止（主进程结束了） |
| `Paused` | 已暂停（进程被冻结，仍占内存） |
| `Restarting` | 正在重启中 |

::: tip 容器状态为 Exited 是正常的
看到 `Exited (0)` 不要慌。容器的设计就是**主进程结束，容器生命周期结束**。像 `hello-world` 这种打印完就退出的程序，容器当然是 Exited 状态。这在第 02 章讲 "容器秒退" 时会详细说。
:::

## 八、常见踩坑墙

| 现象 / 报错 | 原因 | 解决办法 |
|---|---|---|
| `Got permission denied while trying to connect to the Docker daemon socket` | 当前用户不在 docker 组 | `sudo usermod -aG docker $USER` 后重新登录 |
| `Cannot connect to the Docker daemon` | Docker 服务没启动 | `systemctl start docker` |
| `Error response from daemon: Get "https://registry-1.docker.io/v2/": net/http: request canceled` | 拉不到 Docker Hub（网络问题） | 配置镜像加速器（第 6 节） |
| `docker: Error response from daemon: driver failed programming external connectivity ... port is already allocated` | 宿主机端口已被占用 | `netstat -tlnp \| grep 80` 查占用，换端口或停掉占用程序 |
| `WARNING: IPv4 forwarding is disabled. Networking will not work` | 内核没开启 IP 转发 | `echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf && sysctl -p` |
| 容器起来后外网访问不了 | 防火墙/安全组没放行端口 | `firewall-cmd --add-port=80/tcp --permanent && firewall-cmd --reload`；云服务器还要配安全组 |
| Windows 上 `Docker Desktop 启动卡在 Starting` | WSL2 没装好或版本旧 | `wsl --update`，或在 Docker Desktop 设置里切换后端 |
| 磁盘很快被占满 | 容器日志无限制增长 + 残留镜像 | daemon.json 配 `log-opts`，定期 `docker system prune` |
| `no space left on device` | `/var/lib/docker` 所在分区满了 | 清理无用镜像容器，或改 `data-root` 到大磁盘 |

## 本篇小结

- **Docker 解决的问题**是"环境不一致"，它把应用连依赖一起打包，实现 **Build once, Run anywhere**。
- **容器 vs 虚拟机**：虚拟机虚拟硬件、每个带完整 Guest OS（GB 级、分钟级启动）；容器共享宿主机内核（MB 级、秒级启动），隔离性稍弱但更轻更快。
- **三大核心概念**：**镜像**是只读模板（类 / 模具），**容器**是镜像的运行实例（对象 / 产品），**仓库**是存放镜像的地方。
- **镜像是分层的**，容器 = 镜像只读层 + 一层可写层，容器删除时可写层数据随之消失。
- **不要依赖 `latest` 标签**：它只是个普通 tag，不代表最新版本，生产环境必须指定明确版本号。
- Docker 架构是 **Client（命令行）→ REST API → Daemon（dockerd）→ containerd → runc → 容器进程**。
- Docker 的底层三件套：**Namespace 做隔离、Cgroups 做资源限制、UnionFS 做分层存储**。
- 六种 Namespace 分别隔离 **pid / net / mnt / uts / ipc / user**。
- 安装后必做三件事：**启动服务 `systemctl start docker`、配置镜像加速器、把用户加入 docker 组**（注意 docker 权限≈root）。
- 一条完整生命周期：`docker run` → `docker ps` → `docker logs` → `docker exec -it` → `docker stop` → `docker rm`。
- `-p 宿主机端口:容器端口` 是端口映射；`-d` 是后台运行；`--name` 给容器命名。
- **容器主进程结束，容器就退出**，这是设计而不是 bug；持久化数据必须挂载数据卷。

## 参考链接

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Engine 安装指南（CentOS）](https://docs.docker.com/engine/install/centos/)
- [Docker Engine 安装指南（Ubuntu）](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Desktop for Windows（WSL2 后端）](https://docs.docker.com/desktop/wsl/)
- [Docker 概览（Get Started）](https://docs.docker.com/get-started/overview/)
- [阿里云容器镜像服务 ACR](https://cr.console.aliyun.com/)
- [Docker 命令速查手册](https://docs.docker.com/reference/cli/docker/)
- [Docker 底层技术：Namespace 与 Cgroups](https://docs.docker.com/engine/security/)

下一篇 → [02 镜像与 Dockerfile 全解](/ops/docker/image)
