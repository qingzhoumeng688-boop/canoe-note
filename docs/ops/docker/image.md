# 02 镜像与 Dockerfile 全解

> 本篇解决什么问题：镜像到底是怎么存的、为什么它这么小还这么快？Dockerfile 该怎么写才专业？为什么我的容器一启动就退出？为什么改一行代码重新构建要等十分钟？读完本篇，你能看懂任何一个 Dockerfile，能自己写出生产级别的镜像构建文件（多阶段构建、非 root、镜像瘦身），能把镜像推送到 Docker Hub 或阿里云私有仓库。

## 一、镜像是什么（深入一层）

### 1.1 分层存储

前面说过镜像是"只读模板"，但它是怎么存的？答案是**分层（Layer）**。

镜像不是一整个大文件，而是由多层**只读层**叠加而成，每一层记录的是相对上一层的**增量修改**（增删改了哪些文件）。

```text
┌─────────────────────────────────────────────┐
│  容器层 Container Layer（可读写）            │  ← 容器启动时才创建，容器删除就没了
├─────────────────────────────────────────────┤
│  镜像层 N：COPY app.jar /app/               │  ← 第 N 条 Dockerfile 指令产生
├─────────────────────────────────────────────┤
│  镜像层 3：RUN apt-get install -y curl      │
├─────────────────────────────────────────────┤
│  镜像层 2：RUN apt-get update               │
├─────────────────────────────────────────────┤
│  镜像层 1（基础层）：FROM ubuntu:22.04      │
└─────────────────────────────────────────────┘
          ↓ 通过 UnionFS 联合挂载，对外呈现为一个完整的文件系统
```

### 1.2 为什么要分层

分层有两个巨大好处：

**好处一：下载时能复用。** `docker pull` 时，如果某个层本地已经有了（比如你之前拉过别的 ubuntu 镜像，基础层一样），Docker 会直接跳过：

```text
$ docker pull nginx:1.25-alpine
1.25-alpine: Pulling from library/nginx
c1ec31eb5944: Already exists      ← 这层本地有了，不用下
d5b5b5c1b9e2: Pull complete
...
```

**好处二：磁盘上能共享。** 假设你机器上有 10 个基于 `ubuntu:22.04` 的镜像，那个基础层在磁盘上**只有一份**，10 个镜像共用它。这就是为什么看起来有一堆镜像，实际磁盘占用并不夸张。

### 1.3 Copy-on-Write（写时复制）

这是理解容器文件系统的关键。

镜像层全是**只读**的，容器启动后会在最上面加一层**可写层**。那么当容器要修改底层（比如基础镜像里）的文件时会发生什么？

```text
【读取文件】
容器要读 /etc/hosts
  → 从上往下找：容器层没有 → 镜像层N没有 → ... → 在基础层找到了 → 直接读

【修改文件】
容器要改基础层里的 /etc/nginx/nginx.conf
  → Docker 不会去改只读的镜像层
  → 而是把该文件【复制一份】到容器可写层
  → 然后修改容器层里的这个副本
  → 以后再读这个文件，读到的就是容器层里的新版本（上层覆盖下层）

【删除文件】
容器要删基础层里的 /tmp/foo
  → 也不会真去删镜像层
  → 而是在容器层创建一个 "whiteout" 白障文件，把下层文件遮挡住
  → 对外看起来就是"删掉了"
```

这个机制叫 **Copy-on-Write（写时复制，简称 CoW）**。它的好处是创建容器极快（不用复制整个文件系统，只需要加一层空的），坏处是**修改大文件时第一次会有一次复制开销**。

### 1.4 用 docker history 看真实镜像

纸上谈兵不如看一个真实的镜像：

```bash
$ docker history nginx:alpine
IMAGE          CREATED       CREATED BY                                      SIZE
def76cc65a3c8  2 weeks ago   /bin/sh -c #(nop)  CMD ["nginx" "-g" "daemon…   0B
<missing>      2 weeks ago   /bin/sh -c #(nop)  STOPSIGNAL SIGQUIT           0B
<missing>      2 weeks ago   /bin/sh -c #(nop)  EXPOSE 80                    0B
<missing>      2 weeks ago   /bin/sh -c #(nop)  ENTRYPOINT ["/docker-entr…   0B
<missing>      2 weeks ago   /bin/sh -c #(nop) COPY file:0fd5fca330dcd6a7…   4.15kB
<missing>      2 weeks ago   /bin/sh -c set -x     && addgroup -g 101 -S …   46.4MB
<missing>      2 weeks ago   /bin/sh -c #(nop)  ENV PKG_RELEASE=1            0B
<missing>      2 weeks ago   /bin/sh -c #(nop)  ENV NJS_VERSION=0.8.7        0B
<missing>      2 weeks ago   /bin/sh -c #(nop)  ENV NGINX_VERSION=1.27.3     0B
<missing>      2 weeks ago   /bin/sh -c #(nop)  CMD ["/bin/sh"]              0B
<missing>      2 weeks ago   /bin/sh -c #(nop) ADD file:1e8ad59cc1eaf6c7b…   7.62MB
```

能看出什么？

- 每一行就是一层，对应一条 Dockerfile 指令
- **只有 `RUN` 和 `COPY`/`ADD` 会增加体积**，像 `CMD`、`EXPOSE`、`ENV`、`ENTRYPOINT` 这些元数据指令产生的层大小是 `0B`
- `<missing>` 是因为镜像是下载的（没有本地构建记录），这不影响使用
- 最后一层是基础镜像（alpine），7.62MB

`docker inspect` 里也能看到分层的详细信息：

```bash
# 看镜像的分层 ID
docker inspect nginx:alpine --format '{{json .RootFS.Layers}}'

# 看镜像用的存储驱动和实际数据目录
docker inspect nginx:alpine --format '{{json .GraphDriver.Data}}'

# 看镜像的环境变量
docker inspect nginx:alpine --format '{{json .Config.Env}}'
```

### 1.5 容器层随容器删除而消失

这是最重要的一句话：

::: danger 容器的可写层是临时的
你 `docker exec` 进容器改了配置、程序往容器里写了日志文件、应用上传了图片到容器目录——**这些都在容器层里**。一旦 `docker rm` 删掉容器，这些改动全部消失，下次用同一个镜像启动的容器还是"全新出厂"的状态。

所以：**数据库数据、日志文件、用户上传的文件，必须挂载到容器外部**（数据卷 / bind mount，第 04 章详细讲）。
:::

## 二、镜像命令全解

### 2.1 查看镜像

```bash
# 列出本地镜像
docker images
# REPOSITORY   TAG       IMAGE ID       CREATED        SIZE
# nginx        latest    def76cc65a3c8  2 weeks ago    53.6MB
# mysql        8.0       3d1c1c1b9e2d   3 weeks ago    577MB

# 显示所有镜像（含中间层镜像）
docker images -a

# 只显示镜像 ID（常用于批量删除）
docker images -q

# 按条件过滤
docker images --filter "dangling=true"     # 虚悬镜像（仓库名和 tag 都是 <none>）
docker images --filter "reference=nginx:*" # 按名字匹配
docker images --filter "before=nginx:latest"

# 自定义输出格式（只显示仓库名和大小）
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
```

::: tip 什么是虚悬镜像（dangling image）
仓库名和标签都是 `<none>` 的镜像。产生原因：你用同一个 tag 重新构建了一个新镜像，旧镜像就失去了 tag，变成 `<none>:<none>`。它没有名字了但还占着磁盘，可以安全删除：

```bash
docker image prune      # 删除所有虚悬镜像
```
:::

### 2.2 拉取镜像

```bash
# 拉取最新版（默认 latest）
docker pull nginx

# 拉取指定版本
docker pull nginx:1.25.4-alpine

# 拉取指定架构（M1/M2 Mac 拉 x86 镜像时用）
docker pull --platform linux/amd64 mysql:8.0

# 用 digest 拉取（最精确，内容指纹，不可变）
docker pull nginx@sha256:53cc4d415b8398f3a...

# 拉取全部 tag（一般不用，会很慢）
docker pull -a nginx
```

::: tip tag 可以被覆盖，digest 不会
`nginx:1.25` 这个 tag 指向的内容，维护者可以重新推送覆盖掉。但 `sha256:xxxx` 这个 digest 是内容的哈希，永远对应同一份内容。**生产环境追求极致确定性时用 digest。**
:::

### 2.3 搜索镜像

```bash
docker search nginx
```

::: warning 命令行搜索不太好用
`docker search` 的结果信息有限（看不到具体有哪些 tag、更新时间），而且需要联网访问 Docker Hub。**更推荐直接去 [hub.docker.com](https://hub.docker.com/) 网页上搜索**，能看到所有 tag、镜像大小、Dockerfile 链接、漏洞扫描结果。
:::

### 2.4 删除镜像

```bash
# 按 名字:标签 删除
docker rmi nginx:1.25

# 按镜像 ID 删除（ID 可以只写前几位，能唯一识别就行）
docker rmi def76cc
docker rmi def76cc65a3c8

# 强制删除（即使有容器正在用它）
docker rmi -f nginx

# 批量删除所有镜像（危险！）
docker rmi $(docker images -q)
```

**常见报错：镜像被容器占用，删不掉。**

```text
Error response from daemon: conflict: unable to delete def76cc65a3c8 (must be forced)
- image is being used by stopped container 3f8a5c1b9e2d
```

意思是：有个**已停止的容器**是基于这个镜像创建的，所以镜像还被引用着。解决办法：

```bash
# 1. 先删除那个容器
docker rm 3f8a5c1b9e2d

# 2. 再删镜像
docker rmi def76cc65a3c8

# 或者（不推荐）：强制删除镜像，但容器会变成"残废"状态
docker rmi -f def76cc65a3c8
```

### 2.5 清理空间

```bash
# 删除所有虚悬镜像（安全，推荐定期执行）
docker image prune

# 删除所有未被任何容器使用的镜像（谨慎！）
docker image prune -a

# 清理一切：停止的容器 + 未被使用的网络 + 虚悬镜像 + 构建缓存
docker system prune

# 清理一切，包括未被容器使用的镜像（危险！生产慎用）
docker system prune -a

# 查看 Docker 占用了多少磁盘空间
docker system df
# TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
# Images          15        3         4.2GB     3.1GB (73%)
# Containers      8         2         1.2GB     900MB (75%)
# Local Volumes   5         2         800MB     300MB (37%)
# Build Cache     -         -         2.5GB     2.5GB
```

::: danger docker system prune -a 会删什么
它会删除：所有停止的容器、所有未被使用的网络、所有**没有被任何容器引用**的镜像、所有构建缓存。

如果你的镜像是刚 pull 下来还没 run 过的，**也会被删掉**。生产环境执行前务必先 `docker system df` 看清楚，或者只执行不带 `-a` 的版本。
:::

### 2.6 导入导出（离线环境必备）

有些生产服务器**不能连外网**，这时需要在能联网的机器上把镜像打包，拷贝到目标机器再导入。

```bash
# 导出镜像为 tar 包
docker save -o nginx.tar nginx:1.25-alpine

# 导出并压缩（镜像通常很大，强烈建议压缩）
docker save nginx:1.25-alpine | gzip > nginx.tar.gz

# 导出多个镜像到一个包
docker save -o apps.tar nginx:1.25 mysql:8.0 redis:7.4

# 在目标机器上导入
docker load -i nginx.tar
docker load < nginx.tar.gz      # 压缩包也能直接导入
```

::: tip docker save vs docker export
这两个容易混淆，完全不同：

| 命令 | 对象 | 保存内容 | 用途 |
|---|---|---|---|
| `docker save` | **镜像** | 完整镜像（含所有层、历史、元数据、tag） | 备份/迁移镜像 |
| `docker export` | **容器** | 容器当前的文件系统快照（一层，丢失历史和元数据） | 制作基础镜像、导出容器状态 |

日常用 `save`/`load`（配对使用），`export`/`import` 是另一对，很少用。
:::

### 2.7 打标签与推送

```bash
# 给镜像打一个新标签（不会复制镜像，只是多了一个"别名"，IMAGE ID 相同）
docker tag nginx:1.25 mynginx:v1
docker tag nginx:1.25 registry.cn-hangzhou.aliyuncs.com/myns/nginx:1.25

# 推送到仓库（必须先登录）
docker push registry.cn-hangzhou.aliyuncs.com/myns/nginx:1.25
```

::: tip docker tag 不占额外空间
打标签只是给同一个 IMAGE ID 加了一个引用，不会产生镜像副本。你可以给同一个镜像打十几个 tag，磁盘占用不变。
:::

### 2.8 命令速查表

| 命令 | 作用 |
|---|---|
| `docker images` / `docker image ls` | 列出本地镜像 |
| `docker pull 镜像[:tag]` | 拉取镜像 |
| `docker push 镜像[:tag]` | 推送镜像 |
| `docker rmi 镜像` | 删除镜像 |
| `docker tag 源 目标` | 打标签 |
| `docker build -t 名字 .` | 构建镜像 |
| `docker history 镜像` | 查看镜像分层历史 |
| `docker inspect 镜像` | 查看镜像详细信息 |
| `docker save -o file.tar 镜像` | 导出镜像 |
| `docker load -i file.tar` | 导入镜像 |
| `docker image prune` | 清理虚悬镜像 |
| `docker system df` | 查看磁盘占用 |

## 三、Dockerfile 是什么

Dockerfile 是一个**纯文本文件**，里面写了一系列指令，Docker 按顺序执行这些指令，最终构建出一个镜像。

打个比方：**Dockerfile 就是"菜谱"或者"施工图纸"**。镜像是"做好的菜"，容器是"正在吃的菜"。

一个最简单的 Dockerfile：

```dockerfile
# 指定基础镜像
FROM alpine:3.20

# 设置工作目录
WORKDIR /app

# 复制文件
COPY hello.sh /app/

# 容器启动时执行的命令
CMD ["sh", "/app/hello.sh"]
```

**核心规则：Dockerfile 里每一条指令都会产生一层镜像。**

```text
FROM     →  第 1 层
WORKDIR  →  第 2 层（元数据，0 字节）
COPY     →  第 3 层
CMD      →  第 4 层（元数据，0 字节）
```

所以**层数不是越多越好**，一会儿会讲怎么优化。

## 四、Dockerfile 指令逐个精讲

### 4.1 FROM —— 基础镜像

```dockerfile
FROM ubuntu:22.04
FROM openjdk:17-jdk-slim
FROM alpine:3.20 AS builder      # AS 给这个阶段起个名字（多阶段构建用）
FROM scratch                      # 空镜像，从零开始
```

- **必须是 Dockerfile 的第一条指令**（除了 `ARG` 可以放在前面）
- 指定了你的镜像基于什么构建。一般是一个操作系统镜像（ubuntu、alpine、centos）或一个运行时镜像（openjdk、node、python）
- **`scratch`** 是一个特殊的空镜像，表示"什么都不基于"。如果你想做一个只有自己二进制文件的极小镜像（比如 Go 程序），可以从 scratch 开始
- **`AS builder`** 是多阶段构建里的命名，后面 4.8 节讲

::: tip 如何选基础镜像
- **追求极致小**：`alpine`（5MB）— 但要注意 musl libc 兼容性问题（见第 5 节）
- **追求兼容性**：`ubuntu:22.04` / `debian:bookworm-slim`（30~80MB）
- **Java 应用**：`eclipse-temurin:17-jre-alpine` 或 `eclipse-temurin:17-jdk`（**注意：只运行用 jre，要编译才用 jdk**）
- **官方镜像优先**，不要用来源不明的第三方镜像
:::

### 4.2 RUN —— 执行命令

两种格式：

```dockerfile
# shell 格式（推荐，可读性好，会用 /bin/sh -c 执行）
RUN apt-get update && apt-get install -y curl

# exec 格式（JSON 数组，不会经过 shell，所以不能用变量替换、管道等 shell 特性）
RUN ["apt-get", "install", "-y", "curl"]
```

**最重要的一条实践：用 `&&` 把相关命令串成一条 RUN，减少层数。**

```dockerfile
# ❌ 错误示范：4 条 RUN = 4 层，而且 apt 缓存没清理
RUN apt-get update
RUN apt-get install -y curl
RUN apt-get install -y vim
RUN rm -rf /var/lib/apt/lists/*

# ✅ 正确示范：1 条 RUN = 1 层，且在同一层里清理缓存
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl vim \
    && rm -rf /var/lib/apt/lists/*
```

::: warning 为什么要写在一行里清理
前面说过镜像是分层的。**如果你在下一层执行 `rm -rf /var/cache/apt`，删除的只是"下一层的记录"——上一层的那些文件依然在镜像里躺着你删不掉**（只是被 whiteout 遮挡了）。所以镜像体积不会变小！

**必须把"下载安装"和"清理缓存"放在同一条 RUN 里。**
:::

### 4.3 COPY vs ADD

```dockerfile
COPY app.jar /app/app.jar
COPY src/ /app/src/          # 复制目录内容
COPY --chown=app:app . /app  # 复制时顺便改属主

ADD app.tar.gz /app/         # ADD 会自动解压缩 tar 包
ADD https://example.com/f.zip /tmp/   # ADD 支持 URL 下载
```

**结论：优先用 `COPY`。**

| 对比 | COPY | ADD |
|---|---|---|
| 复制本地文件 | ✅ | ✅ |
| 自动解压 tar | ❌ | ✅ |
| 从 URL 下载 | ❌ | ✅（但不推荐） |
| 语义清晰度 | 高（就是复制） | 低（行为不确定） |

::: warning 为什么 ADD 不推荐
1. **行为不透明**：`ADD xxx.tar.gz /app/` 到底解压了没有？看代码的人得先猜一下文件格式
2. **URL 下载的坑**：`ADD https://...` 下载的文件**不会自动解压**，而且会多产生一层，还无法配合缓存
3. 官方 Dockerfile 最佳实践文档明确写着：**"优先使用 COPY"**

如果确实需要下载远程文件，用 `RUN curl -o file URL && ...` 更清晰，还能在同一层里清理。
:::

### 4.4 CMD vs ENTRYPOINT（最大的坑）

这两个都是"指定容器启动时要执行什么命令"，但**行为完全不同**，是最容易踩坑的地方。

**核心区别：**

| | CMD | ENTRYPOINT |
|---|---|---|
| **作用** | 容器启动的**默认命令** | 容器启动的**主命令（入口点）** |
| **`docker run` 后面跟命令时** | CMD 会被**整体覆盖掉** | ENTRYPOINT **一定执行**，`docker run` 后面的内容当作**参数**传给它 |
| **典型用法** | 提供默认参数，允许被覆盖 | 固定住主程序 |

**情况一：只有 CMD**

```dockerfile
FROM ubuntu:22.04
CMD ["echo", "hello"]
```

```bash
docker run myimage
# 输出：hello

docker run myimage echo world
# 输出：world        ← CMD 被完全覆盖了
```

**情况二：只有 ENTRYPOINT**

```dockerfile
FROM ubuntu:22.04
ENTRYPOINT ["echo", "hello"]
```

```bash
docker run myimage
# 输出：hello

docker run myimage world
# 输出：hello world   ← "world" 变成了 echo 的第二个参数
```

**情况三：两者都有（推荐做法）**

```dockerfile
FROM ubuntu:22.04
ENTRYPOINT ["echo", "hello"]
CMD ["world"]
```

```bash
docker run myimage
# 输出：hello world   ← CMD 作为默认参数追加到 ENTRYPOINT 后面

docker run myimage docker
# 输出：hello docker  ← CMD 被覆盖成 "docker"，ENTRYPOINT 仍然执行
```

**完整行为对照表：**

| | 无 ENTRYPOINT | ENTRYPOINT ["echo","hello"] |
|---|---|---|
| **无 CMD** | 报错：没有指定命令 | 执行 `echo hello` |
| **CMD ["world"]** | 执行 `world` | 执行 `echo hello world` |
| **run 时带参数 `abc`** | 执行 `abc`（覆盖 CMD） | 执行 `echo hello abc` |

::: danger 三个必须记住的规则
1. **Dockerfile 里写多个 CMD 或 ENTRYPOINT，只有最后一个生效**！前面的会被静默忽略，这是个很隐蔽的坑。
2. **推荐使用 exec 格式（JSON 数组），不要用 shell 格式。**

   ```dockerfile
   # ❌ shell 格式：CMD sh -c "java -jar app.jar"，java 进程的 PID 不是 1，
   #    导致 docker stop 发的 SIGTERM 信号传给不了 java 进程（只能等 10 秒后被 SIGKILL 强杀）
   CMD java -jar app.jar

   # ✅ exec 格式：java 进程就是 PID 1，能正确收到信号，优雅停机
   CMD ["java", "-jar", "app.jar"]
   ```

3. **ENTRYPOINT + CMD 的组合是最佳实践**：ENTRYPOINT 定死主程序，CMD 给默认参数。
:::

### 4.5 ENV vs ARG

| 对比项 | ENV | ARG |
|---|---|---|
| **构建期（docker build 时）** | ✅ 可用 | ✅ 可用 |
| **运行期（容器运行时）** | ✅ 可用（会写进镜像，容器里 `env` 能看到） | ❌ 不可用（构建完就消失了） |
| **能否在 CMD 里引用** | ✅ 可以 | ❌ 不可以 |
| **怎么传值** | Dockerfile 里写死 | `docker build --build-arg KEY=VALUE` |
| **能否被 `docker run -e` 覆盖** | ✅ 可以 | 不适用 |
| **典型用途** | 运行时配置（JAVA_OPTS、TZ、PATH） | 构建期参数（版本号、代理地址） |

```dockerfile
# ARG：构建期变量
ARG APP_VERSION=1.0.0
ARG HTTP_PROXY

# ENV：运行时环境变量
ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    JAVA_OPTS="-Xms512m -Xmx1024m"

# ENV 可以在 CMD 里用
CMD ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
```

构建时传参：

```bash
docker build --build-arg APP_VERSION=2.0.0 --build-arg HTTP_PROXY=http://proxy:8080 -t myapp:2.0.0 .
```

::: warning 别用 ARG 传密钥
`ARG` 的值会被记录在镜像的历史（`docker history` 能看到）里，即使后面的层删掉了，历史信息里依然能翻出来。**密码、token 之类的敏感信息绝对不要用 ARG 或 ENV 写进 Dockerfile**，应该运行时通过 `-e` 或挂载配置文件、secret 注入。
:::

### 4.6 WORKDIR —— 工作目录

```dockerfile
WORKDIR /app
```

- 设置后续指令（RUN / CMD / COPY 的相对路径等）的默认目录
- **目录不存在时会自动创建**（包括多级目录）
- 可以写多次，后面覆盖前面

::: danger 绝对不要用 RUN cd
```dockerfile
# ❌ 错误：cd 只对当前这一条 RUN 有效，下一条指令的工作目录又变回去了
RUN cd /app
RUN pwd          # 输出的是 /，不是 /app！

# ✅ 正确：用 WORKDIR，会持续生效
WORKDIR /app
RUN pwd          # 输出 /app
```

原因很简单：每一条 RUN 都是独立的层、独立的一个 shell 进程，进程结束环境变量和工作目录就都没了。
:::

### 4.7 EXPOSE —— 声明端口

```dockerfile
EXPOSE 8080
EXPOSE 8080/udp
```

**EXPOSE 只是一个"声明"/"文档"，它不会真的把端口映射出来！**

真正的端口映射靠 `docker run -p 宿主机端口:容器端口`。EXPOSE 的作用：
1. 给看 Dockerfile 的人一个提示："这个容器用 8080 端口"
2. `docker run -P`（大写 P，随机端口映射）时，Docker 会读取 EXPOSE 声明的端口来分配

::: tip 常见误解
很多人配了 `EXPOSE 8080` 然后 `docker run myimage`，发现访问不了 8080，就以为是 EXPOSE 没生效。其实是你没加 `-p`。必须写成：

```bash
docker run -p 8080:8080 myimage
```
:::

### 4.8 VOLUME —— 声明匿名卷

```dockerfile
VOLUME /data
VOLUME ["/data", "/logs"]
```

在镜像里声明一个挂载点。运行时如果没手动 `-v` 指定，Docker 会自动创建一个匿名卷挂上去。

**这个指令有个隐蔽的坑：** 对于 Java 应用，如果日志目录被声明成 VOLUME，你 `docker run` 时没挂卷，日志会写进一个随机名字的匿名卷，你在宿主机上找不到日志文件，而且容器删了数据就没了。

实践建议：**在 Dockerfile 里少用 VOLUME，挂载的事情交给 `docker run -v` 或 compose 去声明，更清晰可控。**

### 4.9 USER —— 指定运行用户

```dockerfile
# 创建一个非 root 用户
RUN groupadd -r app && useradd -r -g app app

# 切换用户（这条指令之后的 RUN/CMD/ENTRYPOINT 都以该用户身份执行）
USER app

CMD ["java", "-jar", "/app/app.jar"]
```

::: tip 安全最佳实践
**容器里的进程默认是 root 用户。** 虽然这个 root 被 user namespace 限制了权限，但万一容器被突破，攻击者拿到的是 root，配合挂载的宿主机目录就可能逃逸。

生产镜像应该：
1. 创建专用用户（如 `app`）
2. 确保应用需要的目录（日志、临时文件）**属主改成该用户**（否则会报权限错误）
3. 用 `USER app` 切换

注意顺序：**先 `COPY` 文件并 `chown`，再 `USER` 切换**。如果先切用户再 COPY，文件属主是 root，应用可能读不了。
:::

### 4.10 HEALTHCHECK —— 健康检查

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1
```

| 参数 | 默认值 | 含义 |
|---|---|---|
| `--interval` | 30s | 每隔多久检查一次 |
| `--timeout` | 30s | 单次检查超时时间 |
| `--start-period` | 0s | 启动宽限期，这段时间内的失败不计入重试次数（**给慢启动应用留时间**） |
| `--retries` | 3 | 连续失败几次才标记为 unhealthy |

配了之后，`docker ps` 的 STATUS 列会显示健康状态：

```text
CONTAINER ID   IMAGE   STATUS
3f8a5c1b9e2d   myapp   Up 2 minutes (healthy)
```

::: tip start-period 很重要
Java 应用启动通常要 30~60 秒。如果没设 `--start-period`，健康检查在启动阶段就开始失败，容器可能还没起来就被标记为 unhealthy，编排系统（Swarm/K8s）可能会把它杀掉重启，陷入死循环。
:::

### 4.11 LABEL —— 元数据

```dockerfile
LABEL maintainer="canoe@example.com"
LABEL version="1.0.0"
LABEL description="订单服务镜像"

# 推荐使用 OCI 标准标签
LABEL org.opencontainers.image.title="order-service" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.authors="canoe" \
      org.opencontainers.image.source="https://github.com/xxx/order-service" \
      org.opencontainers.image.created="2026-09-21T10:00:00Z"
```

LABEL 是键值对形式的元数据，不产生实际文件，用 `docker inspect` 能看到。老式的 `MAINTAINER` 指令已废弃，改用 `LABEL maintainer="..."`。

### 4.12 其他指令

| 指令 | 作用 | 使用频率 |
|---|---|---|
| `SHELL` | 指定 shell 格式用的 shell，Windows 下改 powershell | 少 |
| `STOPSIGNAL` | 设置停止容器时发的信号（如 `STOPSIGNAL SIGTERM`） | 少 |
| `ONBUILD` | 定义"当本镜像被别人当作基础镜像时才执行"的指令 | 极少（容易踩坑） |
| `MAINTAINER` | 作者信息，**已废弃**，用 LABEL 代替 | 不要用 |

### 4.13 .dockerignore（必须有！）

`.dockerignore` 的作用和 `.gitignore` 一模一样：**告诉 Docker 构建时忽略哪些文件，不要把它们送进构建上下文。**

一个 Java 项目的 `.dockerignore`：

```text
# 版本控制
.git
.gitignore

# 构建产物（我们要在容器里构建，或者只 copy 打好的 jar）
target/
build/
*/target/

# 依赖缓存
.mvn/
~/.m2/

# IDE 配置
.idea/
*.iml
.vscode/

# 日志和临时文件
*.log
logs/
tmp/

# 本地配置（可能含密码！）
application-local.yml
*.local

# 敏感文件
.env
*.pem
*.key

# 文档和图片（减少上下文大小）
docs/
*.md
```

**为什么必须有：**

1. **减小构建上下文，加快构建速度。** 不配的话，`.git` 目录（可能几百 MB）会被整个打包传给 Docker daemon
2. **防止敏感信息泄露进镜像。** `.env`、密钥文件、本地配置不该进镜像
3. **避免缓存失效。** 如果 `COPY . .` 把 `.git` 也复制进去，你每次 git 操作改变了文件，`COPY . .` 这层的缓存就失效

## 五、构建上下文（build context）

### 5.1 那个点是什么

```bash
docker build -t myapp:1.0 .
                        ↑
                      这个点
```

这个 `.` 就是**构建上下文路径**。它的含义是："以当前目录为上下文，把里面的文件打包发送给 Docker daemon，Dockerfile 里的 `COPY`/`ADD` 只能从这个目录里取文件。"

### 5.2 常见的坑

```bash
# ❌ 灾难：把根目录当上下文，Docker 会把整个磁盘的文件传给 daemon
cd / && docker build -t myapp -f /home/user/Dockerfile .

# ❌ 也很慢：文档目录里有很多大文件
docker build -t docs ~/Documents
```

**正确的做法：把 Dockerfile 放在项目根目录，或者单独建一个 build 目录，只放构建需要的文件。**

```bash
# 项目结构
my-project/
├── Dockerfile
├── .dockerignore    ← 必须有
├── pom.xml
└── src/

# 在项目根目录构建
docker build -t myapp:1.0 .
```

构建时你会看到这一行，这就是上下文的大小：

```text
$ docker build -t myapp:1.0 .
[+] Building 1.2s (10/10) FINISHED
 => [internal] load build definition from Dockerfile                    0.0s
 => [internal] load .dockerignore                                       0.0s
 => [internal] load build context                                       0.1s
 => => transferring context: 15.23MB      ← 关注这个数字！太大说明 .dockerignore 没配好
```

### 5.3 常用构建参数

```bash
# -t 指定镜像名和标签（可以打多个 -t）
docker build -t myapp:1.0 -t myapp:latest .

# -f 指定 Dockerfile 的路径（不在当前目录时）
docker build -f docker/Dockerfile.prod -t myapp:1.0 .

# --build-arg 传构建参数
docker build --build-arg APP_VERSION=2.0.0 -t myapp:2.0.0 .

# --no-cache 禁用缓存，全部重新构建
docker build --no-cache -t myapp:1.0 .

# --pull 强制拉取最新的基础镜像（防止用了本地过期的 base）
docker build --pull -t myapp:1.0 .

# --target 多阶段构建时只构建到某个阶段（调试用）
docker build --target builder -t myapp:debug .

# --platform 构建指定架构的镜像
docker build --platform linux/amd64 -t myapp:1.0 .
```

## 六、构建缓存机制（重点）

### 6.1 缓存怎么工作

Docker 构建时，**每一层都会缓存**。构建某层前，Docker 会检查：
- 这条指令的内容是否和上次完全一样？
- 它的**父层**是否也一样？
- `COPY`/`ADD` 还额外检查**文件内容**（计算 checksum）有没有变

如果都一样，直接复用缓存，跳过执行（输出里会显示 `CACHED`）：

```text
 => [1/5] FROM docker.io/library/openjdk:17-jdk-slim             0.0s
 => CACHED [2/5] WORKDIR /app                                    0.0s
 => CACHED [3/5] COPY pom.xml .                                  0.0s
 => CACHED [4/5] RUN mvn dependency:go-offline                   0.0s
 => [5/5] COPY src ./src                                         0.1s   ← 只有这层变了
```

**关键规则：一旦某一层的缓存失效，它之后的所有层都会重新构建（即使内容没变）。**

### 6.2 经典反例 vs 正确做法

这是 Dockerfile 优化最重要的一课，尤其对 Java 项目。

```dockerfile
# ❌ 错误示范
FROM maven:3.9-eclipse-temurin-17
WORKDIR /app
COPY . .                          # ← 把整个项目（含 src）复制进去
RUN mvn -B -q clean package        # ← 下载所有依赖 + 编译打包
CMD ["java", "-jar", "target/app.jar"]
```

**问题在哪？** 你只改了 `src/` 里的一行 Java 代码：
- `COPY . .` 这层的文件内容变了 → 缓存失效
- 后面的 `RUN mvn package` 也跟着失效 → **重新下载所有 Maven 依赖**（几百 MB，几分钟）

```dockerfile
# ✅ 正确示范：分两步 COPY，把"下载依赖"和"编译代码"拆开
FROM maven:3.9-eclipse-temurin-17
WORKDIR /app

# 第一步：只复制依赖描述文件
COPY pom.xml .
# 下载依赖（这一步很慢，但只要 pom.xml 不变就会走缓存）
RUN mvn -B -q dependency:go-offline

# 第二步：复制源码
COPY src ./src
# 编译打包（改代码只会让这一步重新执行，依赖是缓存的，几秒钟）
RUN mvn -B -q clean package -DskipTests

CMD ["java", "-jar", "target/app.jar"]
```

效果对比：

| | 第一次构建 | 改一行代码后重新构建 |
|---|---|---|
| 错误示范 | 5 分钟 | **5 分钟**（重新下依赖） |
| 正确示范 | 5 分钟 | **15 秒**（依赖走缓存） |

**核心思想：把"变化频率低、耗时长的步骤"放在前面，"变化频率高、耗时短的步骤"放在后面。**

::: tip 前端项目同理
```dockerfile
COPY package.json package-lock.json ./
RUN npm ci          # 依赖安装（慢，缓存）
COPY . .            # 源码（快，经常变）
RUN npm run build
```
:::

### 6.3 什么时候缓存会失效

- 指令文本改了（哪怕只改一个空格）
- `COPY`/`ADD` 的文件内容变了
- `ADD` 一个 URL（Docker 无法判断远程内容是否变化，**会缓存住不更新** — 所以 ADD URL 不推荐）
- 使用了 `--no-cache`
- 父层失效了
- `RUN` 里有不稳定操作（如 `apt-get update` 拉到新版本，但 Docker 不知道，还是会走缓存）

::: tip 想强制刷新 apt 缓存怎么办
`RUN apt-get update` 会被缓存住，导致你永远装的是构建第一天那一刻的软件源快照。想要刷新：

```bash
# 方法 1：构建时加 --no-cache
# 方法 2：用 --pull 拉新基础镜像
# 方法 3（巧妙）：注入一个变化的 ARG 让该层缓存失效
ARG CACHE_BUST=1
RUN apt-get update && apt-get install -y curl
```
:::

## 七、多阶段构建（Multi-stage Build）

### 7.1 解决什么问题

看这个场景：你用 Maven 编译一个 Spring Boot 项目。

- **构建时**需要：JDK（300MB+）、Maven（50MB）、所有依赖的 jar（200MB）、源码
- **运行时**只需要：JRE（100MB）+ 你的 app.jar（50MB）

如果全塞进一个镜像，最终镜像会有 **800MB+**，其中 600MB 是完全用不到的构建工具。而且构建环境里还有源码、`.m2` 缓存，既占空间又有安全风险。

**多阶段构建**就是为了解决这个：允许一个 Dockerfile 里有多个 `FROM`，前面的阶段负责构建，后面的阶段只从前面阶段"拿"产物。

### 7.2 语法

```dockerfile
# 第一阶段：构建（起个名字叫 builder）
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B clean package -DskipTests

# 第二阶段：运行（这才是最终镜像）
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
# 从前一个阶段复制产物
COPY --from=builder /build/target/*.jar app.jar
CMD ["java", "-jar", "app.jar"]
```

关键点：
- 每个 `FROM` 开始一个新阶段
- `AS builder` 给阶段命名
- `COPY --from=builder` 从指定阶段复制文件（也可以用序号 `--from=0` 表示第一个阶段）
- **只有最后一个 FROM 产生的镜像是最终产物**，前面的都是临时的

### 7.3 完整的 Spring Boot 生产级 Dockerfile

```dockerfile
# ============ 第一阶段：构建 ============
FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /build

# 先只复制 pom.xml，利用缓存下载依赖
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

# 再复制源码编译
COPY src ./src
RUN mvn -B -q clean package -DskipTests \
    && cp target/*.jar /build/app.jar

# ============ 第二阶段：运行 ============
FROM eclipse-temurin:17-jre-alpine

# 安装一些常用工具（curl 用于健康检查，tzdata 用于时区）
RUN apk add --no-cache curl tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app

# 从构建阶段复制 jar
COPY --from=builder /build/app.jar /app/app.jar

# 创建非 root 用户并授权
RUN addgroup -S app && adduser -S -G app app \
    && chown -R app:app /app

# 切换到非 root 用户
USER app

# 环境变量
ENV TZ=Asia/Shanghai \
    JAVA_OPTS="-Xms256m -Xmx512m -XX:+UseContainerSupport"

# 声明端口
EXPOSE 8080

# 健康检查（Spring Boot Actuator）
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/actuator/health || exit 1

# 启动（exec 格式，让 java 成为 PID 1 能收到信号）
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
```

对应构建和运行：

```bash
# 构建
docker build -t order-service:1.0.0 .

# 运行
docker run -d \
  -p 8080:8080 \
  --name order \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e JAVA_OPTS="-Xms512m -Xmx1g" \
  --restart unless-stopped \
  order-service:1.0.0
```

### 7.4 效果对比

| | 单阶段构建 | 多阶段构建 |
|---|---|---|
| 基础镜像 | maven:3.9-eclipse-temurin-17（~800MB） | eclipse-temurin:17-jre-alpine（~180MB） |
| 包含内容 | JDK + Maven + 源码 + .m2 缓存 + jar | JRE + jar |
| 最终镜像大小 | **~1.1 GB** | **~230 MB** |
| 安全风险 | 源码和构建工具都在镜像里 | 只有运行必需的东西 |
| 攻击面 | 有 shell、有 mvn、有源码 | 极小 |

### 7.5 只构建到某个阶段（调试用）

```dockerfile
FROM ... AS builder
...
FROM ... AS tester
...
FROM ... AS prod
```

```bash
# 只构建到 builder 阶段，方便进去看构建产物
docker build --target builder -t myapp:debug .
docker run -it --rm myapp:debug sh
```

## 八、镜像瘦身技巧清单

### 8.1 选小的基础镜像

| 基础镜像 | 大小 | 优点 | 缺点 |
|---|---|---|---|
| `ubuntu:22.04` | ~78MB | 软件全、兼容性好 | 相对大 |
| `debian:bookworm-slim` | ~80MB | 比 ubuntu 精简 | — |
| `alpine:3.20` | **~7MB** | 极小 | **用 musl libc，不是 glibc** |
| `eclipse-temurin:17-jre-alpine` | ~180MB | Java 运行时 + alpine | 同上 |
| `gcr.io/distroless/java17-debian12` | ~200MB | **连 shell 都没有**，攻击面最小 | 没法 `docker exec` 进去调试 |

::: danger alpine 的坑（Java 项目特别注意）
Alpine Linux 用的是 **musl libc**，而绝大多数 Java 库（以及 glibc 生态的软件）是按 glibc 编译的。可能出现的问题：

- 某些 JNI 本地库加载失败（`java.lang.UnsatisfiedLinkError`）
- 字体渲染异常（生成图片验证码、PDF 时中文变方块）
- 时区数据缺失（需要 `apk add tzdata`）
- 某些 DNS 解析行为不一致
- 性能略低（musl 的内存分配器不如 glibc）

**建议**：先试 alpine，如果有诡异问题就退回 `debian-slim` 或 `ubuntu`。不要为了省 50MB 换来一堆排查不到头的怪问题。
:::

### 8.2 合并 RUN 并及时清理

```dockerfile
# ✅ 同一层里安装 + 清理
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Alpine 版本
RUN apk add --no-cache curl tzdata
# 注意：apk 的 --no-cache 就自带了清理，不需要再 rm
```

`--no-install-recommends` 能避免装上一堆"建议"的额外包，能省不少空间。

### 8.3 用 .dockerignore

前面讲过，尤其要排除 `.git`、`node_modules`、`target`、日志文件。

### 8.4 多阶段构建

前面讲过，效果最显著。

### 8.5 优化前后对比

| 优化手段 | 大约能省 |
|---|---|
| 大基础镜像 → alpine/slim | 50% ~ 80% |
| 多阶段构建 | 60% ~ 80% |
| 合并 RUN + 清理缓存 | 10% ~ 30% |
| .dockerignore | 不影响镜像大小，但**大幅加快构建** |
| 不装不必要的包（`--no-install-recommends`） | 10% ~ 20% |

## 九、推送到镜像仓库

### 9.1 Docker Hub

```bash
# 1. 登录（会提示输入用户名密码）
docker login
# 或者用 token（推荐，Docker Hub → Account Settings → Security → New Access Token）
docker login -u 你的用户名 -p 你的token

# 2. 打标签（格式必须是：你的DockerHub用户名/镜像名:tag）
docker tag order-service:1.0.0 canoe/order-service:1.0.0

# 3. 推送
docker push canoe/order-service:1.0.0
```

::: danger 必须先打对标签才能推送
直接 `docker push order-service:1.0.0` 会报错：

```text
denied: requested access to the resource is denied
```

因为不带用户名的镜像默认推到 `library` 命名空间，那是 Docker 官方的，你没权限。**必须先 `docker tag` 成 `用户名/镜像名` 的格式。**
:::

### 9.2 阿里云容器镜像服务 ACR（国内推荐）

1. 登录 [阿里云容器镜像服务控制台](https://cr.console.aliyun.com/)
2. 创建**命名空间**（如 `canoe-ns`，全局唯一）
3. 创建**镜像仓库**（如 `order-service`），选择"本地仓库"
4. 按页面提示推送：

```bash
# 登录（用户名是阿里云账号全称，密码是开通时设置的独立密码）
docker login --username=你的阿里云账号 registry.cn-hangzhou.aliyuncs.com

# 打标签
docker tag order-service:1.0.0 registry.cn-hangzhou.aliyuncs.com/canoe-ns/order-service:1.0.0

# 推送
docker push registry.cn-hangzhou.aliyuncs.com/canoe-ns/order-service:1.0.0

# 拉取
docker pull registry.cn-hangzhou.aliyuncs.com/canoe-ns/order-service:1.0.0
```

::: tip 阿里云地域与网络
- 阿里云 ECS 上拉取同地域的 ACR 镜像可以走**内网地址**（如 `registry-vpc.cn-hangzhou.aliyuncs.com`），速度快且不耗公网流量
- 公网地址是 `registry.cn-hangzhou.aliyuncs.com`
- 个人版 ACR 免费，企业版收费
:::

### 9.3 自建私有 Registry

```bash
# 启动一个私有仓库容器
docker run -d \
  -p 5000:5000 \
  --restart=always \
  --name registry \
  -v /opt/registry:/var/lib/registry \
  registry:2
```

推送时，因为默认只允许 HTTPS，用 HTTP 的私有仓库会报错。需要配置：

```json
// /etc/docker/daemon.json
{
  "insecure-registries": ["192.168.1.100:5000"]
}
```

```bash
systemctl daemon-reload && systemctl restart docker

# 打标签并推送
docker tag myapp:1.0 192.168.1.100:5000/myapp:1.0
docker push 192.168.1.100:5000/myapp:1.0

# 查看仓库里有哪些镜像
curl http://192.168.1.100:5000/v2/_catalog
# {"repositories":["myapp"]}

# 查看某个镜像的 tag 列表
curl http://192.168.1.100:5000/v2/myapp/tags/list
```

::: tip Harbor
自建 Registry 只提供了基本的存储能力，没有 Web UI、权限管理、漏洞扫描、镜像复制。**生产环境推荐用 [Harbor](https://goharbor.io/)**（CNCF 毕业项目，VMware 开源），它提供了完整的镜像仓库管理能力。
:::

## 十、镜像版本管理规范

### 10.1 不要用 latest 做生产部署

前面第 01 章提过，这里重申并给出规范：

| ❌ 坏做法 | ✅ 好做法 |
|---|---|
| `image: nginx` | `image: nginx:1.25.4-alpine` |
| `image: myapp:latest` | `image: myapp:1.0.0` |
| 每次构建都覆盖同一个 tag | 每次构建用唯一 tag |

**推荐的 tag 打法（可以同时打多个）：**

```bash
GIT_SHA=$(git rev-parse --short HEAD)
VERSION=1.0.0

docker build \
  -t myapp:${VERSION} \
  -t myapp:${VERSION}-${GIT_SHA} \
  -t myapp:${GIT_SHA} \
  .

docker push --all-tags myapp
```

这样你既能看到语义化版本 `1.0.0`，也能精确定位到是哪次提交 `a3f9c21`，出问题时一眼就知道该回滚到哪个镜像。

### 10.2 镜像安全扫描

```bash
# 用 trivy 扫描镜像漏洞（需要单独安装 trivy）
trivy image myapp:1.0.0

# Docker 自带的扫描（需要登录 Docker Hub，且是付费功能）
docker scan myapp:1.0.0
```

建议在 CI 流水线里加上镜像扫描步骤，发现高危漏洞就阻断发布。

## 十一、常见坑清单

### 11.1 COPY 路径写错

```dockerfile
# ❌ 错误：COPY 的源路径是相对"构建上下文"的，不是相对 Dockerfile 所在目录
COPY ../common/pom.xml .     # 报错：forbidden path outside the build context

# ✅ 正确：需要的文件必须在构建上下文目录里
COPY pom.xml .
```

如果你执行的是 `docker build -f docker/Dockerfile .`（上下文是 `.`，Dockerfile 在子目录），**相对路径是相对上下文 `.` 而不是相对 Dockerfile 的位置**。这一点很容易搞混。

### 11.2 容器一启动就退出（最重要）

```bash
$ docker run -d --name test myimage
$ docker ps
CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES
# 空的！容器不见了

$ docker ps -a
CONTAINER ID   IMAGE      STATUS
3f8a5c1b9e2d   myimage    Exited (0) 2 seconds ago
```

**原因：容器的生命周期和它的主进程绑定。主进程结束 → 容器退出。**

这不是 bug，是 Docker 的核心设计。常见触发场景：

| 场景 | 为什么退出 | 解决 |
|---|---|---|
| `CMD ["echo", "hi"]` | 打印完就结束了 | 换成能持续运行的命令 |
| `CMD service nginx start` | 用 service 启动是后台守护进程，CMD 那条 shell 执行完就退出了 | 改成前台运行：`CMD ["nginx", "-g", "daemon off;"]` |
| `CMD ["java", "-jar", "app.jar"]` 但 jar 启动失败 | Java 进程报错退出了 | `docker logs` 看错误 |
| 用 shell 格式且命令执行完 | `sh -c` 执行完就退出 | 用前台进程 |

**排查步骤：**

```bash
# 1. 查看退出码
docker ps -a    # 看 STATUS 列的 Exited (N)，N 就是退出码
# Exited (0)    → 正常结束
# Exited (1)    → 程序报错
# Exited (137)  → 被 SIGKILL 杀掉（通常是 OOM 内存超限）
# Exited (139)  → 段错误

# 2. 查看日志（最重要）
docker logs 容器ID

# 3. 如果是想进去调试，可以这样"挂住"容器
docker run -d --name debug myimage tail -f /dev/null
# 或者
docker run -d --name debug myimage sleep infinity

# 然后 exec 进去看
docker exec -it debug sh
```

::: tip 关键认知
**Docker 容器里必须有且只有一个前台进程。** 所有后台 daemon 的写法（service、systemctl、nohup &）在容器里都不适用，因为 CMD 那条 shell 一结束容器就死了。

正确的做法是让主程序**前台运行**：
- Nginx：`nginx -g 'daemon off;'`
- Tomcat：`catalina.sh run`
- Java：`java -jar app.jar`（本身就是前台）
- Redis：`redis-server`（配置文件里不要 `daemonize yes`）
:::

### 11.3 构建时网络不通

```text
=> ERROR [3/5] RUN apt-get update
Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]
Err:1 http://deb.debian.org/debian bookworm InRelease
  Could not connect to deb.debian.org:80
```

解决：
- 换国内源（阿里云、清华、中科大）
- 或者配置构建时的代理：

```bash
docker build --build-arg HTTP_PROXY=http://proxy:8080 \
             --build-arg HTTPS_PROXY=http://proxy:8080 \
             -t myapp .
```

### 11.4 中文乱码与时区不对

```dockerfile
# 时区（Alpine 需要装 tzdata）
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

# 中文编码（Debian/Ubuntu 需要设置 locale）
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Java 应用额外加 JVM 参数（JDK 18+ 默认 UTF-8，JDK 17 及以前要显式设置）
ENV JAVA_OPTS="-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8"
```

### 11.5 容器内时间差 8 小时

Java 应用打印日志时间比实际早 8 小时 —— 典型的新手问题。原因通常是：

1. 容器时区是 UTC（加上面 11.4 的 `TZ=Asia/Shanghai`）
2. JDK 读的是 `/etc/timezone`， Alpine 里没这个文件（要 `apk add tzdata` 并写 `/etc/timezone`）
3. Java 的 `new Date()` 用的是 JVM 默认时区，可以在启动参数里强制：`-Duser.timezone=Asia/Shanghai`

## 本篇小结

- **镜像是分层的只读模板**，容器 = 镜像只读层 + 一层可写层；**容器删除，可写层数据随之消失**。
- 修改底层文件靠 **Copy-on-Write**（复制到容器层再改），删除靠 whiteout 白障文件遮挡。
- `docker history` 能看到每层由哪条指令产生；**只有 RUN/COPY/ADD 会增加体积**，元数据指令是 0 字节。
- **Dockerfile 每条指令产生一层**，用 `&&` 合并 RUN 能减少层数。
- **CMD 会被 `docker run` 后面的命令整体覆盖，ENTRYPOINT 一定执行并把后面的内容当参数**。推荐 `ENTRYPOINT` 定主程序 + `CMD` 给默认参数。
- **必须用 exec 格式（JSON 数组）**：`CMD ["java","-jar","app.jar"]`，否则主进程收不到 SIGTERM，无法优雅停机。
- **多个 CMD/ENTRYPOINT 只有最后一个生效**。
- `ENV` 构建期和运行期都有效且能被 `docker run -e` 覆盖；`ARG` 只在构建期有效，且不能在 CMD 里用。**别用 ARG 传密钥**（会留在镜像历史里）。
- **绝对不要用 `RUN cd`**（只对当层有效），用 `WORKDIR`。
- **`EXPOSE` 只是声明不会真映射端口**，真正映射靠 `docker run -p`。
- `.dockerignore` 必须有：减小构建上下文、防止密钥进镜像、避免缓存失效。
- **构建缓存**：某层失效则其后所有层重新构建。**Java 项目要先 COPY pom.xml 下依赖，再 COPY src 编译**，能把重新构建从 5 分钟降到 15 秒。
- **多阶段构建**是最有效的瘦身手段：构建用 JDK+Maven，运行只用 JRE，镜像能从 1.1GB 降到 230MB。
- **alpine 用 musl libc**，可能踩 JNI、字体、时区的坑，出问题就退回 debian-slim。
- **清理缓存必须和安装放在同一条 RUN 里**（下一层删不掉上一层的文件）。
- 推送镜像前**必须先打上 `用户名/镜像名:tag` 格式的标签**。
- 生产环境**不要用 latest**，用语义化版本 + git sha 双标签。
- **容器秒退是因为主进程结束了**——容器里必须有且只有一个前台进程，用 `tail -f /dev/null` 挂住容器便于调试。

## 参考链接

- [Dockerfile 参考（官方）](https://docs.docker.com/reference/dockerfile/)
- [Dockerfile 最佳实践（官方）](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [多阶段构建官方文档](https://docs.docker.com/build/building/multi-stage/)
- [Docker 构建缓存](https://docs.docker.com/build/cache/)
- [Docker Hub 官方镜像仓库](https://hub.docker.com/)
- [阿里云容器镜像服务 ACR](https://cr.console.aliyun.com/)
- [Harbor 企业级镜像仓库](https://goharbor.io/)
- [Trivy 镜像漏洞扫描工具](https://github.com/aquasecurity/trivy)

下一篇 → [03 容器与常用命令](/ops/docker/container)
