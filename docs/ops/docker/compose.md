# 05 Docker Compose 编排实战

> 本篇解决什么问题：每次都要敲一大串 `docker run` 命令，参数一多就忘，换台机器还得重新敲一遍？十几个容器怎么统一管理、一键启停？读完本篇，你能用一份 `docker-compose.yml` 文件描述整套应用栈（应用 + MySQL + Redis + Nginx + MQ），一条命令启动全部、一条命令销毁全部，并且掌握 Compose 的全部常用配置项。

## 一、为什么需要 Docker Compose

### 1.1 没有 Compose 的痛苦

回顾一下第 04 章最后那个实战，我们为了跑起一套环境，敲了四条超长的 `docker run`：

```bash
docker run -d --name mysql --network app-net --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD=root123 -e MYSQL_DATABASE=demo -e TZ=Asia/Shanghai \
  -v mysql-data:/var/lib/mysql -p 3306:3306 --memory=2g \
  mysql:8.0 --character-set-server=utf8mb4 ...

docker run -d --name redis --network app-net ...
docker run -d --name order-service --network app-net ...
docker run -d --name nginx --network app-net ...
```

问题很明显：

| 问题 | 说明 |
|---|---|
| **命令太长，容易敲错** | 一个参数写错就得删容器重来 |
| **不可复用** | 换台机器要把这些命令再敲一遍（或者写在 shell 脚本里，但脚本很丑） |
| **没有版本管理** | 配置散落在命令行历史里，无法 git 管理、无法 review |
| **启停要一个一个来** | 想重启整套环境？得手动按顺序敲四条命令 |
| **依赖关系无法表达** | "应用要等 MySQL 启动后才能起" 这件事没法声明，只能靠 sleep 硬等 |

### 1.2 Compose 是什么

**Docker Compose 是 Docker 官方的多容器编排工具。** 你用一个 YAML 文件（`docker-compose.yml`）描述整套应用需要哪些服务、每个服务用什么镜像、什么配置、挂载什么、依赖谁，然后：

```bash
docker compose up -d      # 一条命令启动全部
docker compose down       # 一条命令销毁全部
```

打个比方：

- **`docker run`** 就像在命令行里一条条敲 Linux 命令
- **`docker compose`** 就像写一个 Shell 脚本，把所有命令固化下来，可以复用和版本管理

### 1.3 Compose 能做什么

- 用一个文件定义**多服务应用栈**
- **一条命令**启停整套环境（开发、测试、CI 环境特别爽）
- 自动创建**专属网络**，服务间用服务名互相访问
- 统一管理**数据卷**
- 声明**依赖关系**和启动顺序
- 支持**环境变量文件**（`.env`）区分不同环境
- 支持**多文件覆盖**（基础配置 + 环境特定配置）

::: tip Compose 的定位
Compose 主要用于**单机的多容器编排**：开发、测试、小型生产部署。

如果你需要**跨多台机器、自动扩缩容、服务发现、滚动更新、自愈**，那是 **Kubernetes** 的领域。Compose 和 K8s 不是竞争关系，而是不同规模下的不同选择。

（Docker 还有个 **Swarm** 模式，是 Docker 自带的集群编排，但目前生态已经被 K8s 碾压，新项目不建议用。）
:::

## 二、安装与基本使用

### 2.1 安装

**方式一：Docker Desktop（Windows/Mac）** — 自带，直接用。

**方式二：Linux 装插件（推荐）**

第 01 章安装 Docker 时已经装了 `docker-compose-plugin`，所以可以直接用 `docker compose`（**注意有空格，不是 `docker-compose`**）：

```bash
docker compose version
# Docker Compose version v2.29.7
```

如果没装：

```bash
# CentOS
sudo yum install -y docker-compose-plugin

# Ubuntu
sudo apt-get install -y docker-compose-plugin
```

**方式三：手动下载二进制（老办法）**

```bash
# 下载（版本号换成你需要的）
sudo curl -L "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose

sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

::: tip `docker compose` vs `docker-compose`
- **`docker compose`（有空格）**：Compose V2，作为 Docker CLI 的插件，Go 语言重写，目前官方推荐
- **`docker-compose`（连字符）**：Compose V1，Python 写的独立二进制，**已停止维护**（2023 年 7 月 EOL）

**本文全部使用 V2 的 `docker compose`。** 如果你看到老教程里的 `docker-compose`，命令参数基本一样，只是写法不同。
:::

### 2.2 第一个 Compose 文件

创建一个目录，写一个最简的 `docker-compose.yml`：

```yaml
services:
  # 服务名（自己起，容器间用它互相访问）
  web:
    image: nginx:1.25-alpine
    ports:
      - "8080:80"
```

**核心规则：Compose 文件的顶层结构是 `services:`，下面每个键是一个服务。**

启动：

```bash
# 启动（前台，能看到日志，Ctrl+C 停止）
docker compose up

# 后台启动（推荐）
docker compose up -d

# 查看状态
docker compose ps
# NAME                IMAGE                SERVICE   STATUS      PORTS
# myproject-web-1     nginx:1.25-alpine    web       running     0.0.0.0:8080->80/tcp

# 查看日志
docker compose logs
docker compose logs -f web          # 跟踪某个服务
docker compose logs --tail 100 web

# 停止（容器还在）
docker compose stop

# 启动已停止的
docker compose start

# 停止并删除容器、网络（数据卷保留）
docker compose down

# 停止并删除容器、网络、数据卷（谨慎！数据会没）
docker compose down -v

# 删除并清除镜像
docker compose down --rmi all
```

### 2.3 项目名称（PROJECT NAME）

注意上面 `docker compose ps` 输出的容器名是 `myproject-web-1`，它不是你写的 `web`。

Compose 会**自动给容器名加上前缀**，格式是：

```text
<项目名>-<服务名>-<副本序号>
```

**项目名默认是 `docker-compose.yml` 所在目录的名字。** 所以上面那个例子目录叫 `myproject`，容器就叫 `myproject-web-1`。

指定项目名：

```bash
# 用 -p 指定
docker compose -p myapp up -d

# 或者用环境变量
COMPOSE_PROJECT_NAME=myapp docker compose up -d
```

或者在 `.env` 文件里写 `COMPOSE_PROJECT_NAME=myapp`。

::: tip 为什么要有项目名前缀
为了**隔离**。你在两个不同目录下跑了两套环境（一个测试一个开发），都有 `mysql` 服务，如果没有前缀就会容器名冲突。有了前缀，一个是 `test-mysql-1` 一个是 `dev-mysql-1`，互不干扰。
:::

## 三、docker-compose.yml 完整配置详解

### 3.1 一个完整示例（先有整体印象）

```yaml
# 版本号（新版 Compose 已废弃这个字段，可以不写）
# version: '3.8'

services:
  # ========== 应用服务 ==========
  app:
    build:                          # 从 Dockerfile 构建
      context: .
      dockerfile: Dockerfile
    image: order-service:1.0.0      # 构建出来的镜像名
    container_name: order-service   # 指定容器名（不加前缀）
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: prod
      TZ: Asia/Shanghai
    env_file:
      - .env                        # 从文件读环境变量
    volumes:
      - ./logs:/app/logs
    networks:
      - backend
    depends_on:
      mysql:
        condition: service_healthy  # 等 mysql 健康了才启动
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 60s
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G

  # ========== MySQL ==========
  mysql:
    image: mysql:8.0
    container_name: mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: root123
      MYSQL_DATABASE: demo
      TZ: Asia/Shanghai
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --default-time-zone=+08:00
    volumes:
      - mysql-data:/var/lib/mysql
      - ./mysql/conf:/etc/mysql/conf.d:ro
      - ./mysql/init:/docker-entrypoint-initdb.d:ro
    networks:
      - backend
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ========== Redis ==========
  redis:
    image: redis:7.4-alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes --requirepass redis123
    volumes:
      - redis-data:/data
    networks:
      - backend
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  # ========== Nginx ==========
  nginx:
    image: nginx:1.25-alpine
    container_name: nginx
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/logs:/var/log/nginx
    networks:
      - frontend
      - backend
    depends_on:
      - app

# ========== 数据卷声明 ==========
volumes:
  mysql-data:
    driver: local
  redis-data:
    driver: local

# ========== 网络声明 ==========
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
```

### 3.2 顶层字段

| 字段 | 作用 |
|---|---|
| `services` | **必需**，定义各个服务 |
| `volumes` | 声明数据卷（供 services 引用） |
| `networks` | 声明网络（供 services 引用） |
| `configs` | 配置文件（Swarm 模式用得多） |
| `secrets` | 密钥管理（Swarm 模式用得多） |
| `name` | 指定项目名（替代 `-p`） |
| `version` | **已废弃**，新版不需要写 |

### 3.3 服务配置：镜像相关

```yaml
services:
  # 方式一：直接用现成镜像
  nginx:
    image: nginx:1.25-alpine

  # 方式二：从 Dockerfile 构建
  app:
    build: .
    # 等价于：
    # build:
    #   context: .

  # 方式三：详细构建配置
  app2:
    build:
      context: ./app          # 构建上下文目录
      dockerfile: Dockerfile.prod   # Dockerfile 文件名（默认 Dockerfile）
      args:                   # 构建参数
        APP_VERSION: 1.0.0
        ENV_TYPE: prod
      target: prod            # 多阶段构建时指定目标阶段
      cache_from:             # 缓存来源
        - myapp:latest
      no_cache: false

  # 方式四：既构建又打标签（推荐，这样能 push）
  app3:
    build: .
    image: myapp:1.0.0
```

::: tip build + image 一起写
如果只写 `build`，构建出的镜像没有固定名字（叫 `<项目名>-<服务名>`），很难 push。

**推荐同时写 `image`**，这样构建完会自动打上你指定的标签，方便后续 `docker compose push`。
:::

### 3.4 服务配置：容器运行相关

```yaml
services:
  app:
    image: myapp

    # 容器名（不指定则是 <项目名>-<服务名>-1）
    container_name: my-app

    # 主机名（容器内的 hostname）
    hostname: app-node-1

    # 重启策略
    restart: unless-stopped   # no / always / on-failure / unless-stopped

    # 覆盖镜像的启动命令（相当于 docker run 后面跟的命令）
    command: ["java", "-jar", "/app.jar"]

    # 覆盖 ENTRYPOINT
    entrypoint: ["/entrypoint.sh"]

    # 工作目录
    working_dir: /app

    # 运行用户
    user: "1000:1000"

    # 是否分配伪终端（一般配合交互式程序）
    tty: true

    # 保持 STDIN 打开
    stdin_open: true

    # 特权模式（慎用）
    privileged: false

    # 添加 Linux capabilities（细粒度权限）
    cap_add:
      - NET_ADMIN
    cap_drop:
      - ALL

    # 停止信号和超时
    stop_signal: SIGTERM
    stop_grace_period: 30s

    # 是否以只读文件系统运行
    read_only: false
```

### 3.5 端口映射

```yaml
services:
  web:
    image: nginx
    ports:
      # 简短语法： "宿主机端口:容器端口"
      - "8080:80"

      # 只指定容器端口，宿主机随机分配
      - "80"

      # 指定监听地址（只本机可访问）
      - "127.0.0.1:8080:80"

      # 指定协议
      - "53:53/udp"

      # 端口范围
      - "8000-8010:8000-8010"

      # 长语法（更明确）
      - target: 80
        published: 8080
        protocol: tcp
        mode: host
```

::: warning YAML 里端口要加引号
`"8080:80"` 必须加引号！**如果不加，YAML 会把 `8080:80` 解析成 sexagesimal（六十进制）数字**（这是 YAML 1.1 的历史遗留），结果变成 `8080*60+80 = 488080`，报莫名其妙的错。

这是非常经典的坑，务必记住。
:::

### 3.6 环境变量

**三种写法：**

```yaml
services:
  app:
    # 方式一：直接写（数组格式）
    environment:
      - SPRING_PROFILES_ACTIVE=prod
      - TZ=Asia/Shanghai
      - JAVA_OPTS=-Xms512m -Xmx1g

    # 方式二：映射格式（推荐，可读性更好）
    environment:
      SPRING_PROFILES_ACTIVE: prod
      TZ: Asia/Shanghai
      MYSQL_HOST: mysql          # 直接写服务名

    # 方式三：只声明键，值从宿主机或 .env 文件取
    environment:
      - MYSQL_PASSWORD      # 不写 = 值，Compose 会从宿主机环境变量或 .env 里找
```

**用 `.env` 文件（推荐做法）：**

```bash
# .env 文件（放和 docker-compose.yml 同级目录）
MYSQL_ROOT_PASSWORD=root123
MYSQL_DATABASE=demo
REDIS_PASSWORD=redis123
APP_VERSION=1.0.0
TZ=Asia/Shanghai
```

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}    # 引用 .env 里的值
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      TZ: ${TZ}

  app:
    image: order-service:${APP_VERSION}    # 还能用在镜像标签上
    env_file:
      - .env          # 或者整个文件塞进去
      - .env.prod
```

::: danger .env 文件要加进 .gitignore
`.env` 里通常有数据库密码等敏感信息，**绝对不要提交到 git**。

```bash
echo ".env" >> .gitignore
```

团队里一般提供一个 `.env.example`（去掉真实值）作为模板。
:::

**变量的默认值和错误处理：**

```yaml
environment:
  # 如果变量没设置，用默认值
  MYSQL_HOST: ${MYSQL_HOST:-mysql}

  # 如果变量没设置就报错（:?）
  MYSQL_PASSWORD: ${MYSQL_PASSWORD:?错误：必须设置 MYSQL_PASSWORD}
```

### 3.7 数据卷挂载

```yaml
services:
  mysql:
    image: mysql:8.0
    volumes:
      # 具名数据卷（需要在顶层 volumes 里声明）
      - mysql-data:/var/lib/mysql

      # 绑定挂载：宿主机相对路径（相对 compose 文件位置）
      - ./mysql/conf:/etc/mysql/conf.d:ro

      # 绑定挂载：绝对路径
      - /data/mysql/backup:/backup

      # 匿名卷
      - /var/lib/mysql

      # 长语法（更明确）
      - type: volume
        source: mysql-data
        target: /var/lib/mysql
        read_only: false

      - type: bind
        source: ./config
        target: /app/config
        read_only: true

      - type: tmpfs
        target: /tmp
        tmpfs:
          size: 100m

  # MySQL 初始化脚本目录（首次启动时会自动执行里面的 .sql/.sh）
  # 这个目录很常用，可以放建库建表语句
  mysql-init:
    image: mysql:8.0
    volumes:
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
```

**顶层声明具名卷：**

```yaml
volumes:
  mysql-data:
    # 不写就是默认 local 驱动
    driver: local

  # 可以引用外部已存在的卷（Compose 不会创建它，也不会在 down 时删除）
  existing-data:
    external: true

  # 指定卷的详细配置
  app-data:
    driver: local
    driver_opts:
      type: nfs
      o: "addr=192.168.1.100,rw"
      device: ":/path/to/dir"
    labels:
      - "env=prod"

  # 自定义卷名（不加项目名前缀）
  my-vol:
    name: my-custom-volume-name
```

::: tip external: true 的作用
如果你有个数据卷是之前手动 `docker volume create` 创建的，或者被另一个 compose 项目管理的，用 `external: true` 声明后：
- Compose **不会**自动创建它（不存在则报错）
- `docker compose down -v` **不会**删除它（保护数据）

适合多个项目共享数据卷的场景。
:::

### 3.8 网络

```yaml
services:
  nginx:
    image: nginx
    networks:
      - frontend
      - backend

  app:
    image: myapp
    networks:
      - backend
      # 指定固定 IP
      # backend:
      #   ipv4_address: 172.20.0.10

      # 网络别名（额外可解析的名字）
      # backend:
      #   aliases:
      #     - api
      #     - order-api

  mysql:
    image: mysql
    networks:
      - backend

networks:
  frontend:
    driver: bridge

  backend:
    driver: bridge
    # 自定义网段
    ipam:
      config:
        - subnet: 172.20.0.0/16
          gateway: 172.20.0.1

  # 引用外部网络
  shared-net:
    external: true

  # 自定义网络名（不加项目名前缀）
  my-net:
    name: my-custom-network
```

**关键点：**

1. **Compose 会自动创建一个默认网络**（叫 `<项目名>_default`），所有服务默认都接入它
2. 同一 Compose 项目的服务之间，**可以直接用服务名互相访问**（Docker 内置 DNS）
3. 用上面的 frontend/backend 分离配置，MySQL 只接入 backend，**nginx 之外的容器访问不到数据库**

### 3.9 依赖与启动顺序

```yaml
services:
  app:
    image: myapp
    depends_on:
      # 简单写法：只保证启动顺序，不保证"就绪"
      - mysql
      - redis

  app2:
    image: myapp
    depends_on:
      mysql:
        condition: service_healthy      # 等 mysql 健康检查通过
      redis:
        condition: service_started      # 等 redis 启动即可
      # condition 可选值：
      #   service_started     - 容器启动了就行
      #   service_healthy     - 健康检查通过
      #   service_completed_successfully - 容器成功运行结束（一次性任务）
```

::: danger depends_on 的常见误解（非常重要）
**`depends_on` 只保证"容器启动的顺序"，不保证"服务就绪"。**

MySQL 容器启动（进程起来了）≠ MySQL 可以接受连接了。MySQL 首次启动要初始化数据字典、建库，可能要 30~60 秒。你的应用容器在 MySQL 进程起来后立刻启动，连数据库时会报 `Connection refused`。

**解决办法（三选一，推荐组合）：**

1. **配 healthcheck + `condition: service_healthy`**（推荐，上面的写法）
2. **应用侧加重试逻辑**（最根本的解决）：连接失败就重试，而不是直接崩
3. **用 `wait-for-it.sh` 或 `dockerize` 这类工具脚本**在启动前等待端口就绪

**最稳妥的是 1 + 2：Compose 层用 healthcheck 控制顺序，应用层自己也有重试，双保险。**
:::

**用 wait-for-it 的例子：**

```yaml
services:
  app:
    image: myapp
    depends_on:
      - mysql
    command: >
      sh -c "
      ./wait-for-it.sh mysql:3306 --timeout=60 --strict -- 
      java -jar /app.jar
      "
```

### 3.10 健康检查

```yaml
services:
  app:
    image: myapp
    healthcheck:
      # test 必须是数组（CMD 格式）或字符串（CMD-SHELL 格式）
      test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
      # 或者
      # test: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]

      interval: 30s      # 每 30 秒检查一次
      timeout: 3s        # 单次检查超时 3 秒
      retries: 3         # 连续失败 3 次标记为 unhealthy
      start_period: 60s  # 启动后 60 秒内失败不计入（给慢启动应用留时间）

    # 禁用镜像自带的健康检查
    # healthcheck:
    #   disable: true
```

**常见服务的健康检查写法：**

```yaml
services:
  mysql:
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  redis:
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  nginx:
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"]
      interval: 30s

  rabbitmq:
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 30s
      timeout: 10s
      retries: 5

  elasticsearch:
    healthcheck:
      test: ["CMD-SHELL", "curl -s http://localhost:9200/_cluster/health | grep -qE '\"status\":\"(green|yellow)\"' || exit 1"]
      interval: 30s
      start_period: 60s
```

### 3.11 资源限制

```yaml
services:
  app:
    image: myapp

    # Compose V2 推荐写法（deploy 段在非 Swarm 模式下也生效）
    deploy:
      resources:
        limits:           # 硬限制
          cpus: '2.0'
          memory: 1G
        reservations:     # 软限制（预留）
          cpus: '0.5'
          memory: 512M

    # 传统写法（Compose 也支持，两者选一即可）
    mem_limit: 1g
    memswap_limit: 1g
    cpus: 2.0
    # 或者
    # cpu_shares: 512
    # cpuset: "0,1"
```

::: tip deploy vs 直接字段
Compose V2 之后，`deploy.resources.limits` 在**非 Swarm 模式**下也会生效（以前只有 Swarm 才认）。

但为了兼容性，很多项目仍用 `mem_limit` / `cpus` 的老字段。**两者不要混用**，选一套即可。新项目推荐 `deploy`。
:::

### 3.12 日志配置

```yaml
services:
  app:
    image: myapp
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "3"
        # 还可以加标签
        labels: "env=prod,service=app"

  # 发送到 syslog
  app2:
    logging:
      driver: syslog
      options:
        syslog-address: "udp://192.168.1.100:514"
        tag: "{{.Name}}"
```

### 3.13 其他常用配置

```yaml
services:
  app:
    image: myapp

    # 添加 hosts 记录
    extra_hosts:
      - "host.docker.internal:host-gateway"
      - "somehost:192.168.1.50"

    # 指定 DNS
    dns:
      - 8.8.8.8
      - 114.114.114.114
    dns_search:
      - example.com

    # 标签（便于批量管理和过滤）
    labels:
      - "com.example.env=prod"
      - "com.example.team=backend"
    # 或映射格式
    labels:
      com.example.env: "prod"

    # 设备（如需要访问 GPU、串口）
    devices:
      - "/dev/ttyUSB0:/dev/ttyUSB0"

    # 共享内存大小（Chrome、某些数据库需要）
    shm_size: 256m

    # ulimits
    ulimits:
      nofile:
        soft: 65536
        hard: 65536

    # 安全选项
    security_opt:
      - no-new-privileges:true

    # sysctl 内核参数
    sysctls:
      - net.core.somaxconn=1024
      - net.ipv4.tcp_syncookies=0
```

## 四、Compose 常用命令

### 4.1 命令速查表

| 命令 | 作用 |
|---|---|
| `docker compose up [-d]` | 创建并启动所有服务 |
| `docker compose down [-v]` | 停止并删除容器、网络（`-v` 连数据卷一起删） |
| `docker compose ps` | 查看服务状态 |
| `docker compose logs [-f] [服务名]` | 查看日志 |
| `docker compose start/stop/restart` | 启停服务 |
| `docker compose pause/unpause` | 暂停/恢复 |
| `docker compose top` | 查看各服务的进程 |
| `docker compose events` | 实时事件流 |
| `docker compose exec 服务名 命令` | 在运行的容器里执行命令 |
| `docker compose run 服务名 命令` | 起一个一次性容器执行命令 |
| `docker compose build` | 构建（或重建）镜像 |
| `docker compose pull` | 拉取所有镜像 |
| `docker compose push` | 推送镜像 |
| `docker compose config` | **校验并打印解析后的完整配置**（调试神器） |
| `docker compose images` | 列出服务用到的镜像 |
| `docker compose port 服务名 端口` | 查看端口映射 |
| `docker compose kill` | 强制杀死 |
| `docker compose rm` | 删除已停止的容器 |
| `docker compose cp` | 拷贝文件 |
| `docker compose stats` | 资源占用统计 |
| `docker compose version` | 版本信息 |

### 4.2 up 的常用参数

```bash
# 后台启动
docker compose up -d

# 强制重新构建镜像后再启动（改了 Dockerfile 时用）
docker compose up -d --build

# 只启动指定的服务（以及它的依赖）
docker compose up -d nginx

# 指定副本数
docker compose up -d --scale app=3

# 强制重新创建容器（配置改了但 Compose 没检测到时）
docker compose up -d --force-recreate

# 只创建不启动
docker compose up --no-start

# 启动时不拉取依赖（用本地镜像）
docker compose up -d --no-deps app

# 前台运行并在退出时删除容器
docker compose up --abort-on-container-exit
```

### 4.3 docker compose config（调试神器）

`config` 会把你的 compose 文件**完整解析并展开**（包括变量替换、默认值填充、多文件合并），打印出最终生效的配置。

```bash
# 打印完整配置
docker compose config

# 只看服务名列表
docker compose config --services
# app
# mysql
# redis
# nginx

# 只输出某个服务
docker compose config --format json

# 校验文件语法（有错会报出来）
docker compose config -q    # quiet 模式，只返回退出码
```

**变量没替换对？默认值没生效？文件没合并？用 `config` 一看便知。**

### 4.4 进入容器

```bash
# 进入服务容器（注意：Compose 的服务名，不是容器名）
docker compose exec app sh
docker compose exec mysql bash

# 执行单条命令
docker compose exec mysql mysql -uroot -proot123 -e "SHOW DATABASES;"
docker compose exec redis redis-cli ping

# 一次性运行（起个新容器，跑完就删）
docker compose run --rm app sh
docker compose run --rm mysql mysql -h mysql -uroot -p
```

### 4.5 构建与推送

```bash
# 构建所有需要构建的服务
docker compose build

# 构建指定服务
docker compose build app

# 不使用缓存重新构建
docker compose build --no-cache app

# 拉取所有镜像
docker compose pull

# 推送镜像（需要服务里配置了 image 字段）
docker compose push
```

## 五、多文件与多环境

### 5.1 基础文件 + 覆盖文件

实际项目中，开发、测试、生产的配置不同（端口、副本数、资源限制、日志级别）。Compose 支持**多文件合并**：

```bash
# 默认会自动读取 docker-compose.yml 和 docker-compose.override.yml
docker compose up

# 手动指定多个文件（后面的覆盖前面的）
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**`docker-compose.yml`（基础配置）：**

```yaml
services:
  app:
    build: .
    image: order-service:1.0.0
    environment:
      SPRING_PROFILES_ACTIVE: dev
      TZ: Asia/Shanghai
    networks:
      - backend
    depends_on:
      mysql:
        condition: service_healthy

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: demo
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - backend
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mysql-data:

networks:
  backend:
```

**`docker-compose.override.yml`（开发环境覆盖，`up` 时自动加载）：**

```yaml
services:
  app:
    ports:
      - "8080:8080"
    volumes:
      - ./src:/app/src          # 挂载源码，热更新
    environment:
      SPRING_PROFILES_ACTIVE: dev
      LOG_LEVEL: DEBUG

  mysql:
    ports:
      - "3306:3306"             # 开发环境暴露端口方便本地连
```

**`docker-compose.prod.yml`（生产环境覆盖）：**

```yaml
services:
  app:
    restart: unless-stopped
    environment:
      SPRING_PROFILES_ACTIVE: prod
      LOG_LEVEL: INFO
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "5"

  mysql:
    restart: unless-stopped
    # 生产不暴露 3306 到宿主机，只在内网访问
    deploy:
      resources:
        limits:
          memory: 2G
```

使用：

```bash
# 开发（自动合并 override）
docker compose up -d

# 生产
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

::: tip 合并规则
- **单值字段**（image、command、container_name）：后面的**覆盖**前面的
- **列表字段**（ports、volumes、environment、networks）：**合并**（追加）
- 想删除基础文件里某个列表项？用 `!reset` 语法（Compose 2.24+）或者在覆盖文件里重新写完整列表
:::

### 5.2 用 profiles 区分服务

有些服务只在特定场景启动（比如开发用的 adminer、调试工具），可以用 `profiles`：

```yaml
services:
  app:
    image: myapp
    # 没写 profiles 的服务总是启动

  mysql:
    image: mysql:8.0

  # 只有指定 dev profile 时才启动
  adminer:
    image: adminer
    profiles:
      - dev
    ports:
      - "8081:8080"

  # 监控工具
  prometheus:
    image: prom/prometheus
    profiles:
      - monitor
```

```bash
# 只启动默认服务（app + mysql）
docker compose up -d

# 启动 dev profile 的服务
docker compose --profile dev up -d

# 启动多个 profile
docker compose --profile dev --profile monitor up -d

# 或者用环境变量
COMPOSE_PROFILES=dev,monitor docker compose up -d
```

## 六、实战一：Spring Boot + MySQL + Redis + Nginx

### 6.1 目录结构

```text
order-system/
├── docker-compose.yml
├── .env                      # 环境变量（git ignore）
├── .env.example              # 环境变量模板
├── order-service/
│   ├── Dockerfile
│   ├── pom.xml
│   └── src/
├── mysql/
│   ├── conf/
│   │   └── my.cnf
│   └── init/
│       └── 01-init.sql       # 初始化 SQL（首次启动自动执行）
├── nginx/
│   └── nginx.conf
└── logs/                     # 应用日志（挂载出来）
```

### 6.2 .env.example

```bash
# 复制这个文件为 .env 后填写真实值
# cp .env.example .env

# 项目名
COMPOSE_PROJECT_NAME=order-system

# 应用版本
APP_VERSION=1.0.0

# MySQL
MYSQL_ROOT_PASSWORD=root123
MYSQL_DATABASE=order_db
MYSQL_USER=order
MYSQL_PASSWORD=order123

# Redis
REDIS_PASSWORD=redis123

# 时区
TZ=Asia/Shanghai
```

### 6.3 docker-compose.yml

```yaml
services:
  # ========== 应用服务 ==========
  order-service:
    build:
      context: ./order-service
      dockerfile: Dockerfile
    image: order-service:${APP_VERSION:-latest}
    container_name: order-service
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: prod
      SPRING_DATASOURCE_URL: jdbc:mysql://mysql:3306/${MYSQL_DATABASE}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false
      SPRING_DATASOURCE_USERNAME: ${MYSQL_USER}
      SPRING_DATASOURCE_PASSWORD: ${MYSQL_PASSWORD}
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PORT: 6379
      SPRING_DATA_REDIS_PASSWORD: ${REDIS_PASSWORD}
      JAVA_OPTS: "-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"
      TZ: ${TZ}
    volumes:
      - ./logs:/app/logs
    networks:
      - backend
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8080/actuator/health || exit 1"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 60s
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "3"

  # ========== MySQL ==========
  mysql:
    image: mysql:8.0
    container_name: mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      TZ: ${TZ}
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --default-time-zone=+08:00
      - --max_connections=500
      - --innodb_buffer_pool_size=512M
    volumes:
      - mysql-data:/var/lib/mysql
      - ./mysql/conf:/etc/mysql/conf.d:ro
      - ./mysql/init:/docker-entrypoint-initdb.d:ro
    networks:
      - backend
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 60s
    deploy:
      resources:
        limits:
          memory: 2G
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "3"

  # ========== Redis ==========
  redis:
    image: redis:7.4-alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    command: >
      sh -c "redis-server --appendonly yes --requirepass ${REDIS_PASSWORD} --maxmemory 512mb --maxmemory-policy allkeys-lru"
    volumes:
      - redis-data:/data
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a ${REDIS_PASSWORD} ping | grep PONG"]
      interval: 10s
      timeout: 3s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 768M
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"

  # ========== Nginx 反向代理 ==========
  nginx:
    image: nginx:1.25-alpine
    container_name: nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/logs:/var/log/nginx
    networks:
      - frontend
      - backend
    depends_on:
      order-service:
        condition: service_started
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"

# ========== 数据卷 ==========
volumes:
  mysql-data:
    driver: local
  redis-data:
    driver: local

# ========== 网络 ==========
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
```

### 6.4 初始化 SQL

`mysql/init/01-init.sql`（**只在数据卷为空即首次启动时执行**）：

```sql
-- 创建订单表
CREATE TABLE IF NOT EXISTS `t_order` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '订单ID',
  `order_no`    VARCHAR(64)  NOT NULL COMMENT '订单号',
  `user_id`     BIGINT       NOT NULL COMMENT '用户ID',
  `amount`      DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '订单金额',
  `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '状态：0待支付 1已支付 2已取消',
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单表';

-- 插入测试数据
INSERT INTO `t_order` (`order_no`, `user_id`, `amount`, `status`) VALUES
  ('ORD202609210001', 1001, 99.50, 0),
  ('ORD202609210002', 1002, 158.00, 1);
```

### 6.5 Nginx 配置

`nginx/nginx.conf`：

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    error_log  /var/log/nginx/error.log warn;

    sendfile        on;
    keepalive_timeout 65;
    gzip            on;

    # 上游服务：直接写 compose 服务名
    upstream order_backend {
        server order-service:8080;
        keepalive 32;
    }

    server {
        listen 80;
        server_name localhost;

        # 限流（每秒 100 个请求，突发 200）
        limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;

        location / {
            limit_req zone=api_limit burst=200 nodelay;

            proxy_pass http://order_backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_connect_timeout 5s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;
        }

        # 健康检查
        location /nginx-health {
            access_log off;
            return 200 "ok\n";
        }
    }
}
```

### 6.6 启动与验证

```bash
# 1. 准备环境变量
cp .env.example .env
vi .env       # 填真实密码

# 2. 校验配置（有问题会在这里暴露）
docker compose config

# 3. 构建并启动
docker compose up -d --build

# 4. 查看状态（等 healthcheck 变 healthy）
docker compose ps
# NAME             SERVICE          STATUS                    PORTS
# order-service    order-service    Up 30 seconds (healthy)   0.0.0.0:8080->8080/tcp
# mysql            mysql            Up 40 seconds (healthy)   0.0.0.0:3306->3306/tcp
# redis            redis            Up 40 seconds (healthy)   0.0.0.0:6379->6379/tcp
# nginx            nginx            Up 25 seconds             0.0.0.0:80->80/tcp

# 5. 看日志（观察应用是否连上数据库）
docker compose logs -f order-service

# 6. 验证接口
curl http://localhost:8080/actuator/health
curl http://localhost/api/orders

# 7. 进数据库看数据
docker compose exec mysql mysql -uorder -porder123 order_db \
  -e "SELECT * FROM t_order;"

# 8. 停掉
docker compose down

# 9. 彻底清理（含数据卷，数据会没了！）
docker compose down -v
```

## 七、实战二：一键拉起全套中间件

开发时经常需要 MySQL、Redis、RabbitMQ、Elasticsearch、Nacos 这些中间件。用 Compose 一次拉起，换台机器也能一键复现。

```yaml
services:
  # ========== MySQL 8.0 ==========
  mysql:
    image: mysql:8.0
    container_name: dev-mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: root123
      TZ: Asia/Shanghai
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
    volumes:
      - mysql-data:/var/lib/mysql
    networks: [dev]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-proot123"]
      interval: 10s
      timeout: 5s
      retries: 10

  # ========== Redis 7.4 ==========
  redis:
    image: redis:7.4-alpine
    container_name: dev-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes --requirepass redis123
    volumes:
      - redis-data:/data
    networks: [dev]
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a redis123 ping | grep PONG"]
      interval: 10s
      timeout: 3s
      retries: 5

  # ========== RabbitMQ 4.0 ==========
  rabbitmq:
    image: rabbitmq:4.0-management-alpine
    container_name: dev-rabbitmq
    restart: unless-stopped
    ports:
      - "5672:5672"      # AMQP
      - "15672:15672"    # 管理界面
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    networks: [dev]
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 30s
      timeout: 10s
      retries: 5

  # ========== Elasticsearch 8.18 ==========
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.18.0
    container_name: dev-es
    restart: unless-stopped
    ports:
      - "9200:9200"
      - "9300:9300"
    environment:
      discovery.type: single-node
      xpack.security.enabled: "false"      # 开发环境关闭安全认证
      ES_JAVA_OPTS: "-Xms512m -Xmx512m"
    volumes:
      - es-data:/usr/share/elasticsearch/data
    networks: [dev]
    healthcheck:
      test: ["CMD-SHELL", "curl -s http://localhost:9200/_cluster/health | grep -qE '\"status\":\"(green|yellow)\"' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536

  # ========== Nacos 注册/配置中心 ==========
  nacos:
    image: nacos/nacos-server:v2.3.2
    container_name: dev-nacos
    restart: unless-stopped
    ports:
      - "8848:8848"
      - "9848:9848"
    environment:
      MODE: standalone                     # 单机模式
      NACOS_AUTH_TOKEN: bmFjb3NfZGV2X3Rva2VuX2Zvcl90ZXN0XzEyMzQ1Njc4OTA=
      NACOS_AUTH_IDENTITY_KEY: serverIdentity
      NACOS_AUTH_IDENTITY_VALUE: security
      JVM_XMS: 512m
      JVM_XMX: 512m
    volumes:
      - nacos-data:/home/nacos/data
    networks: [dev]
    depends_on:
      mysql:
        condition: service_healthy

  # ========== MinIO 对象存储（可选） ==========
  minio:
    image: minio/minio:latest
    container_name: dev-minio
    restart: unless-stopped
    ports:
      - "9000:9000"      # API
      - "9001:9001"      # 控制台
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio-data:/data
    networks: [dev]

volumes:
  mysql-data:
  redis-data:
  rabbitmq-data:
  es-data:
  nacos-data:
  minio-data:

networks:
  dev:
    driver: bridge
```

```bash
# 启动全部
docker compose up -d

# 或者只启动需要的（不要一次起太多，吃内存）
docker compose up -d mysql redis
docker compose up -d rabbitmq
docker compose up -d elasticsearch

# 查看资源占用
docker compose stats
```

::: warning 内存提醒
上面这一套全起来大约需要 4~6GB 内存。**开发机内存不够就按需启动**，不要一次性全 up。

ES 和 Nacos 都是 JVM 应用，比较吃内存，可以用 `ES_JAVA_OPTS`、`JVM_XMX` 限制。
:::

## 八、常见坑清单

### 8.1 YAML 语法错误

```yaml
# ❌ 错误：缩进不一致（YAML 靠缩进表达层级）
services:
  app:
    image: nginx
     ports:       # ← 多了一个空格，层级错了
      - "80:80"

# ❌ 错误：tab 缩进（YAML 不允许用 Tab，必须用空格）
services:
	app:
		image: nginx

# ❌ 错误：端口没加引号（前面讲过，会被解析成六十进制）
ports:
  - 8080:80

# ❌ 错误：冒号后面没空格
environment:
  KEY:value       # 应该是 KEY: value

# ✅ 正确
services:
  app:
    image: nginx
    ports:
      - "8080:80"
```

**排查：** 用 `docker compose config` 校验，语法错会直接报出来（还会告诉你行号）。

### 8.2 环境变量没生效

```bash
# 1. 确认 .env 文件在 compose 文件同级目录
ls -la .env

# 2. 用 config 看变量是否被替换了
docker compose config | grep MYSQL_ROOT_PASSWORD

# 3. 注意：.env 只对 compose 文件里的 ${} 生效
#    不会自动注入到容器里！容器要用的话得在 environment 里显式声明
services:
  app:
    environment:
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}    # ← 必须这样写才会传进容器
```

### 8.3 改了配置但重启后没生效

```bash
# 场景：改了 environment 或 command，docker compose restart 后没变化？

# 原因：restart 只是重启容器，不会重建。某些配置（如挂载、端口、环境变量）
#       需要 recreate 才生效。

# 解决：用 up -d 而不是 restart（Compose 会检测到变化并重建容器）
docker compose up -d

# 或者强制重建
docker compose up -d --force-recreate
```

::: tip 哪些改动需要重建容器
| 改动 | restart 够吗 | 需要重建吗 |
|---|---|---|
| 镜像版本 `image` | ❌ | ✅ |
| 环境变量 `environment` | ❌ | ✅ |
| 端口 `ports` | ❌ | ✅ |
| 挂载 `volumes` | ❌ | ✅ |
| 命令 `command` | ❌ | ✅ |
| 网络 `networks` | ❌ | ✅ |
| 只是容器内文件内容变了 | ✅ | ❌ |

**不确定就用 `docker compose up -d`，让 Compose 自己判断。**
:::

### 8.4 端口冲突

```text
Error starting userland proxy: listen tcp4 0.0.0.0:3306: bind: address already in use
```

宿主机 3306 已被占用（可能是本机装了 MySQL）。解决：

```yaml
ports:
  - "3307:3306"    # 换成宿主机的 3307
```

或者不映射端口（容器间通过服务名访问就够了）：

```yaml
# 去掉 ports，MySQL 只在 compose 网络内可访问
```

::: tip 生产环境建议不暴露数据库端口
MySQL、Redis 这些**只在容器网络内被应用访问**的服务，生产环境**不应该映射端口到宿主机**。这样外部直接连不上数据库，安全得多。需要管理时通过 `docker compose exec mysql mysql -uroot -p` 进去。
:::

### 8.5 容器名冲突

```text
Error response from daemon: Conflict. The container name "/mysql" is already in use
```

用了 `container_name: mysql`，但宿主机上已经有一个叫 mysql 的容器。

```bash
# 查看并删除冲突的容器
docker ps -a | grep mysql
docker rm -f mysql

# 或者去掉 container_name，让 Compose 用默认的 <项目名>-<服务名>-1
```

### 8.6 depends_on 不等待就绪

前面讲过，`depends_on` 只保证启动顺序。完整的解决方案：

```yaml
services:
  app:
    depends_on:
      mysql:
        condition: service_healthy    # ← 关键：配了 healthcheck 才能用
    # 应用层也要有连接重试逻辑

  mysql:
    healthcheck:                      # ← 必须配健康检查
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 60s               # ← 给首次初始化留时间
```

Spring Boot 侧可以配置连接重试（HikariCP）：

```yaml
spring:
  datasource:
    hikari:
      initialization-fail-timeout: 60000   # 启动时最多等 60 秒，超时才失败
```

### 8.7 数据卷权限问题

```text
mysqld: Can't create/write to file '/var/lib/mysql/xxx' (OS errno 13 - Permission denied)
```

宿主机挂载的目录属主不对。

```bash
# 查看挂载目录属主
ls -ln ./mysql/data

# 改成容器里服务用的 UID（MySQL 镜像用的是 uid 999）
sudo chown -R 999:999 ./mysql/data

# 或者干脆用具名卷，让 Docker 自己管理权限（推荐）
```

**结论：数据库数据优先用具名卷（volume），不要用 bind mount，能避开大部分权限问题。**

## 本篇小结

- **Compose 是单机多容器编排工具**，用一份 YAML 描述整套应用栈，一条命令启停全部。
- 用 **`docker compose`（V2，有空格）** 而不是已停止维护的 `docker-compose`（V1，连字符）。
- 顶层结构是 `services`（必需）、`volumes`、`networks`；**`version` 字段已废弃，不用写**。
- **端口映射必须加引号**（`"8080:80"`），否则 YAML 会按六十进制解析出错。
- **项目名默认是 compose 文件所在目录名**，容器名格式是 `<项目名>-<服务名>-<序号>`，用 `-p` 或 `COMPOSE_PROJECT_NAME` 指定。
- **同一 Compose 项目的服务之间可以直接用服务名互访**（Docker 内置 DNS），这是 Compose 最方便的地方。
- **`depends_on` 只保证启动顺序，不保证服务就绪**——必须配 `healthcheck` + `condition: service_healthy`，且应用层要有连接重试。
- **MySQL 的 `/docker-entrypoint-initdb.d` 目录**里的 `.sql`/`.sh` 会在首次启动（数据卷为空）时自动执行，非常适合放初始化脚本。
- **环境变量推荐用 `.env` 文件**（记得加进 `.gitignore`），compose 里用 `${变量名}` 引用，支持 `${VAR:-默认值}` 和 `${VAR:?错误信息}`。
- **多环境用多文件覆盖**：基础 `docker-compose.yml` + `docker-compose.override.yml`（自动加载）+ `docker-compose.prod.yml`（用 `-f` 指定）。合并规则是单值覆盖、列表追加。
- **`profiles`** 可以标记某些服务只在特定场景启动（如开发工具、监控）。
- **`docker compose config` 是调试神器**：校验语法、查看变量替换结果、确认多文件合并效果。
- `docker compose up -d` 会自动检测配置变化并重建容器，**比 `restart` 更可靠**（restart 不会应用配置变更）。
- **生产环境不要把数据库端口映射到宿主机**，只在容器网络内访问更安全。
- 数据库数据优先用**具名卷**而不是 bind mount，能避开大部分权限问题。
- **资源限制、日志轮转、健康检查、重启策略**是生产配置的四件套，缺一不可。

## 参考链接

- [Docker Compose 官方文档](https://docs.docker.com/compose/)
- [Compose 文件规范](https://docs.docker.com/compose/compose-file/)
- [Compose 命令参考](https://docs.docker.com/compose/reference/)
- [Compose 环境变量](https://docs.docker.com/compose/environment-variables/)
- [Compose 中的网络](https://docs.docker.com/compose/networking/)
- [多文件合并与覆盖](https://docs.docker.com/compose/multiple-compose-files/)
- [Compose 实战示例（官方 awesome-compose）](https://github.com/docker/awesome-compose)

下一篇 → [06 生产实践与踩坑](/ops/docker/production)
