# 01 Redis 入门与环境搭建

> 本篇是「轻舟的 Redis 笔记」的开篇。它要解决的是：Redis 到底是啥、为什么它能当缓存又能干那么多别的活、怎么用 Docker 一分钟把环境跑起来、怎么用 `redis-cli` 和它说话、Spring Boot 怎么连上它。读完这篇，你不仅能在自己机器上跑通一个带密码、带持久化、带内存上限的 Redis，还能用 Java 存一条数据并取回来建立第一份成就感。后面的数据类型、分布式锁、缓存实战，全建立在本文这套环境之上。

## 本篇要解决的问题

- Redis 到底是个啥？它和 MySQL、Memcached 到底有啥区别？是不是就只是个"缓存"？
- 为什么老听说 Redis 很快？它凭什么快？
- 本地怎么用 Docker 跑一个"生产级"的 Redis（密码、持久化、内存上限、重启策略一个不少）？
- `redis-cli` 一堆命令，哪些是日常必会，哪些碰都不能碰？
- Spring Boot 3.5 怎么连 Redis？依赖版本怎么对齐才不踩坑？
- 第一份 Java 连通代码怎么写、`set/get` 怎么跑通？

读完你应该能：在自己的机器上用 Docker 跑起一个 Redis 7.4，用 `redis-cli` 和它交互，并用 Spring Boot 的 `StringRedisTemplate` 存一个 key、取一个 key。

## 一、Redis 到底是什么：先讲一个能记住一辈子的比喻

### 1.1 办公桌上的便签本 vs 档案室的档案柜

想象你在公司干活，有两样东西：

- **档案室的档案柜**：里面整整齐齐码着一摞摞文件，按编号归档，容量巨大，要找一份得走到档案室、翻目录、开柜门、抽出来。东西多、稳当、长期存放没问题，但每次取用都有"走路 + 翻找"的开销。
- **贴在办公桌上的便签本**：你随手写"待办：下午三点开会""张三电话 138xxxx"。就贴在手边，抬眼就能看，抬手就能改。但便签本容量小、一撕就丢，不适合存公司几十年的历史档案。

对应到软件世界：

| 你脑子里的东西 | 软件里的谁 |
| --- | --- |
| 档案室的大柜子 | **MySQL** 这类关系型数据库（磁盘存储、容量大、稳、慢一点） |
| 办公桌上的便签本 | **Redis**（内存存储、容量小、快到飞起、重启可能丢） |

**一句话记住**：MySQL 是"档案柜"，适合长期、大量、要靠谱地存的数据；Redis 是"便签本"，适合放那些"要极快读写、丢了问题也不大、或者本来就带过期时间"的数据。

::: tip 一句话记住
- **MySQL 像档案柜**：数据落磁盘，容量大、可靠、取用稍慢。
- **Redis 像便签本**：数据放内存，快、容量小、重启可丢。
- 真实项目里它们**搭档干活**：MySQL 存权威数据，Redis 放高频访问的"便签"，比如缓存、登录态、计数器。
:::

### 1.2 官方定义

Redis 官网的定义是：

> Redis is an open source, in-memory, key-value data store used as a database, cache, message broker, and queue.

翻译过来：**Redis 是一个开源的、基于内存的键值（key-value）数据存储，既能当数据库，也能当缓存、消息代理和队列。**

抓住三个关键词：

- **开源（open source）**：免费、源码可见、社区活跃。
- **基于内存（in-memory）**：数据主要放在内存里，这是它"快"的根本原因。
- **键值（key-value）**：你给它一个 key（比如 `"user:1:name"`），它给你对应的 value（比如 `"张三"`）；和 MySQL 的"行/列"模型完全不同。

### 1.3 重点纠正一个误区：Redis 不只是缓存

很多人对 Redis 的第一印象就是"缓存"。这没错，但它**远不止缓存**。看 Redis 官方自己列的身份：**数据库、缓存、消息代理、队列**——四个角色。

为什么它能干这么多？因为 Redis 的 value 不只是"一段字符串"，它支持丰富的数据结构（这是 02 篇的主角）：字符串、哈希、列表、集合、有序集合，甚至位图、GEO、流。正是这些结构，让 Redis 能顺手做下面这些事：

| 你以为 Redis 只能干 | 实际上它还常干 |
| --- | --- |
| 缓存热点数据 | 分布式锁（用原子命令抢锁） |
| 存 Session | 排行榜（有序集合天然排序） |
| 当临时存储 | 消息队列（列表的阻塞弹出） |
| —— | 限流（计数器 + 过期） |
| —— | 好友关系 / 共同好友（集合交并差） |

::: warning 别把 Redis 当"银弹"
Redis 是内存数据库，内存比磁盘贵得多、容量小得多。它不是来**替换** MySQL 的，而是来**补 MySQL 短板**的：把"高频、低价值、可重建"的数据放进内存，让系统整体又快又稳。**把核心业务数据（订单、账户余额）只放 Redis 而不同步到 MySQL，是要出生产事故的。**
:::

### 1.4 Redis 名字的来历

Redis 全称是 **REmote DIctionary Server**，翻译："远程字典服务"。

- **DIctionary（字典）**：对应它"键值对"的本质，就像一本字典——你查一个词（key），得到它的释义（value）。
- **Remote（远程）**：它是跑在服务器上的独立进程，你的应用通过网络（TCP，默认端口 6379）去访问它，不是嵌在你程序里的本地变量。
- **Server（服务）**：它是一个服务端程序，可以同时给很多客户端提供服务。

## 二、Redis vs MySQL vs Memcached：三维对比

新手最容易把这三个搞混。先把它们摆上同一张表：

| 对比维度 | MySQL | Memcached | Redis |
| --- | --- | --- | --- |
| **存储介质** | 磁盘为主，靠缓冲池 | 纯内存 | 纯内存（可持久化到磁盘） |
| **数据结构** | 表/行/列（关系模型） | 只有"字符串"一种 value | 字符串/哈希/列表/集合/有序集合等十多种 |
| **持久化** | 天生持久，事务保证 | 不持久，重启即丢 | 支持 RDB 快照 + AOF 日志，可配置 |
| **线程模型** | 多线程（连接池） | 多线程（非阻塞 IO） | 命令执行单线程（6.0 后网络 IO 多线程） |
| **查询能力** | 强大的 SQL、join、聚合 | 只有 `get/set` 等简单命令 | 丰富命令 + 数据结构级操作 |
| **典型场景** | 权威数据、事务、报表 | 纯缓存、简单 KV | 缓存/锁/排行榜/队列/限流/计数 |
| **value 上限** | 行大小受限但可大 | 单条默认 1MB | 单个 value 最大 512MB |

::: tip 三句话区分
- **MySQL**：要"靠谱、能查、能关联"的数据放这。
- **Memcached**：只想"纯内存放个字符串当缓存"，且不需要持久化、不需要复杂结构——简单的老牌缓存。
- **Redis**：想要"内存级速度"**且**还要数据结构、持久化、丰富场景——选它，功能覆盖 Memcached 还能做更多。
:::

::: warning 现在还该用 Memcached 吗
Memcached 比 Redis 早，当年以"简单纯内存 KV + 多线程"著称。但 Redis 在 6.0 也支持了网络 IO 多线程，功能又远比 Memcached 丰富。**新项目几乎都选 Redis**；只有"极致简单、纯 KV 缓存、不想引入 Redis 其他能力"的老系统还在用 Memcached。本专栏只讲 Redis。
:::

## 三、Redis 的典型使用场景

下面这些场景，每一个都是"用 Redis 特别合适"的经典例子。先有个印象，后面都有专门章节展开。

| 场景 | 一句话说明 | 为什么 Redis 合适 |
| --- | --- | --- |
| **缓存（Cache）** | 把 MySQL 的热点数据放内存，挡在数据库前面 | 内存读写毫秒级，减轻 DB 压力，扛高并发 |
| **分布式锁** | 多台机器抢同一个资源时，谁先抢到谁执行 | 单线程执行命令，原子性操作天然适合"抢锁" |
| **排行榜** | 游戏战力榜、销量榜、热搜榜 | 有序集合（ZSet）自带排序，改分数自动重排 |
| **计数器** | 文章阅读量、点赞数、视频播放量 | `INCR` 命令原子自增，高并发下不会算错 |
| **Session 共享** | 多台 Web 服务器共享登录态 | 集中存内存，任意一台机器都能读，重启不丢（配持久化） |
| **消息队列** | 异步任务、削峰填谷 | 列表的 `LPUSH`/`BRPOP` 可做简单队列 |
| **限流** | 接口 1 秒最多 100 次调用 | 计数器 + 过期时间，轻松实现滑动/固定窗口限流 |
| **GEO 位置** | 附近的人、外卖商家距离排序 | 内置 GEO 命令，基于有序集合做地理索引 |
| **去重 / 布隆** | 用户已读、抽奖不重复 | 集合（Set）天然去重；Bitmap 省内存做大规模去重 |
| **好友关系** | 共同好友、二度人脉 | 集合的交集（`SINTER`）直接算共同好友 |

::: tip 一个判断标准
"数据要**极快**访问、丢了**能重建**、或者**本来就该过期**"→ 大概率是 Redis 的活。"数据**必须靠谱、不能丢、要关联查询**"→ 放 MySQL。两者常配合：Redis 在前面挡流量，MySQL 在后面保真相。
:::

## 四、环境搭建（重点，非常细）

开发学习阶段，最省事、最一致的方式是用 Docker 跑。下面给的是一套**接近生产配置**的单节点 Redis 7.4，把密码、持久化、内存上限、重启策略、日志、健康检查都配齐。你照抄就能用。

::: tip Windows 同学的提醒
下面所有命令在 **Linux / macOS / WSL2 的终端**里直接跑。如果你是纯 Windows 且没装 WSL2，请先装 WSL2（`wsl --install`），或在 Docker Desktop 的终端里执行——**别在 CMD/PowerShell 原生环境里硬跑 bash 命令**，路径和引号容易出问题。WSL2 安装 Redis 的细节见 4.4 节。
:::

### 4.1 完整的 docker-compose.yml

在任意目录（比如 `~/redis-lab/`）新建 `docker-compose.yml`：

```yaml
# docker-compose.yml —— 一套接近生产的单机 Redis 7.4 配置
# 用法：在该目录执行  docker compose up -d
version: "3.8"

services:
  redis:
    # 1) 指定镜像与版本：Redis 7.4 的 alpine 精简版，体积小、启动快
    image: redis:7.4-alpine
    container_name: canoe-redis

    # 2) 重启策略：除非手动 stop，否则总是自动重启（机器重启后 Redis 也会起来）
    restart: unless-stopped

    # 3) 端口映射：宿主机端口:容器端口。6379 是 Redis 默认端口
    ports:
      - "6379:6379"

    # 4) 启动命令：用自定义配置文件启动，并开启 AOF 持久化
    #    --appendonly yes 表示开启 AOF（Append Only File），写命令都会追加到日志
    command: >
      redis-server
      /usr/local/etc/redis/redis.conf
      --appendonly yes

    # 5) 数据卷挂载：
    #    - 把宿主机 ./redis.conf 挂进容器作为配置文件（只读）
    #    - 把容器 /data 挂到命名卷 redis-data，保证重启后数据不丢
    volumes:
      - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
      - redis-data:/data

    # 6) 内存限制：防止 Redis 把宿主机内存吃满导致系统卡死
    #    deploy.resources 在 compose v3 里需要 swarm 才会生效，
    #    本地非 swarm 用下面更通用的方式（见 4.2 的 redis.conf maxmemory）
    #    这里保留注释，真正的内存上限写在 redis.conf 里更稳
    # mem_limit: 512m

    # 7) 日志：限制单个日志文件 100MB、最多保留 5 个，避免磁盘被日志撑爆
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "5"

    # 8) 健康检查：每 10 秒用 redis-cli ping 一下，连不上就标记 unhealthy
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "canoe123456", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

# 命名数据卷：数据持久化到 Docker 管理的卷，比挂宿主机目录更省心
volumes:
  redis-data:
    driver: local
```

::: warning 关于 redis-cli 带密码的 healthcheck
上面 healthcheck 用 `redis-cli -a canoe123456 ping`。`-a` 后直接跟明文密码，**仅本地开发可用**，生产环境密码会出现在进程列表里不安全。生产建议用 `requirepass` + ACL，并通过 `redis-cli -u redis://:密码@host:port ping` 的方式，或干脆在宿主机用 `CONFIG` 校验。这里为演示直观，先用简单写法。
:::

启动与验证：

```bash
# 进入 compose 文件所在目录
cd ~/redis-lab

# 后台启动
docker compose up -d

# 看启动日志（确认 "Configuration loaded" 和 "Ready to accept connections"）
docker compose logs redis

# 看容器健康状态（STATUS 应为 healthy 或 starting 后转 healthy）
docker ps

# 停止 / 删除（需要时）
docker compose stop
docker compose down        # 会保留数据卷；加 -v 才连数据卷一起删
```

预期输出片段（节选）：

```text
redis      | 1:C 21 Sep 2026 10:00:00.123 # Configuration loaded
redis      | 1:M 21 Sep 2026 10:00:00.124 * Running mode=standalone, port=6379.
redis      | 1:M 21 Sep 2026 10:00:00.125 * Ready to accept connections tcp
```

### 4.2 一份带注释的 redis.conf

上面 compose 把 `./redis.conf` 挂进了容器，所以你还得准备这份文件。在 `~/redis-lab/redis.conf` 写入：

```text
# redis.conf —— 单机开发/学习配置，关键项都有中文注释

# 1) 绑定的网卡地址。0.0.0.0 表示监听所有网卡（容器里常用）
bind 0.0.0.0

# 2) 保护模式：yes 时，若没设密码且没显式 bind，只允许本机连。
#    我们设了密码，这里保持 yes 更安全；云上暴露公网务必设密码 + 防火墙。
protected-mode yes

# 3) 访问密码。客户端连接后必须先 AUTH 这个密码才能操作。
#    ⚠️ 生产请换成强密码，别用示例里的弱密码。
requirepass canoe123456

# 4) 监听端口
port 6379

# 5) 是否以守护进程方式运行。Docker 里由容器管理进程，必须设 no（前台运行）。
daemonize no

# 6) 工作目录：RDB 快照、AOF 文件等都会写到这里。容器里是 /data（已挂卷）。
dir /data

# 7) RDB 快照文件名（默认 dump.rdb）。AOF 文件名默认 appendonly.aof。
dbfilename dump.rdb

# 8) 开启 AOF 持久化：每一条写命令追加到 appendonly.aof，重启可重放恢复。
#    配合 compose 里 --appendonly yes 双保险；这里再写一次更明确。
appendonly yes
# AOF 刷盘策略：everysec = 每秒刷一次（性能与安全的折中，推荐）
appendfsync everysec

# 9) 日志文件路径。容器里可写 /data/redis.log；也可留空让日志打到 stdout（Docker 接管）。
#    这里留空，日志由 Docker logging 驱动收集，更方便看 docker logs。
logfile ""

# 10) 内存上限：Redis 是内存库，必须设上限！这里给 256MB 学习用。
#     超过后按 maxmemory-policy 淘汰（见下）。生产按机器内存给，如 2gb。
maxmemory 256mb

# 11) 内存淘汰策略：内存到上限时怎么办。
#     allkeys-lru = 在所有 key 里淘汰"最久没用"的（经典缓存策略）
maxmemory-policy allkeys-lru

# 12) 客户端空闲多久断开（秒）。0 表示永不断开。
timeout 300

# 13) TCP 心跳保活，避免中间设备把空闲连接掐掉
tcp-keepalive 300
```

::: tip 三处最容易漏的配置
- **`requirepass`**：不设密码 + 暴露公网 = 分钟级被黑、数据被清空甚至被植入挖矿。一定要设。
- **`maxmemory`**：不设上限，Redis 可能把机器内存吃满，触发 OOM，连宿主机一起卡死。
- **`appendonly yes`**：想要重启不丢数据就开；纯缓存可关（见 7 小节的权衡）。
:::

### 4.3 不用 Compose，直接用 docker run

如果只想最快跑起来，一条命令也行（但配置不如 compose 灵活）：

```bash
docker run -d \
  --name canoe-redis \
  -p 6379:6379 \
  -v canoe-redis-data:/data \
  redis:7.4-alpine \
  redis-server --requirepass canoe123456 --appendonly yes --maxmemory 256mb
```

### 4.4 Linux 直接安装 & Windows 提示

**Linux（以 Ubuntu/Debian 为例）直接装：**

```bash
# 更新软件源
sudo apt update

# 安装 redis-server（发行版仓库版本通常略旧，但学习足够）
sudo apt install -y redis-server

# 设为开机自启并启动
sudo systemctl enable --now redis-server

# 确认版本（应显示 7.x 或你系统仓库的版本）
redis-server --version

# 改配置：编辑 /etc/redis/redis.conf，设 requirepass、maxmemory 等，然后重启
sudo systemctl restart redis-server
```

::: tip 想要最新 7.4？
系统仓库的 Redis 可能偏旧。要最新版，可加 Redis 官方 APT 源，或用 Docker（本篇主推）。学习阶段 Docker 最干净、最一致，推荐优先用 Docker。
:::

**Windows 怎么搞：**

```text
方案 A（推荐）：装 WSL2，在 Ubuntu 子系统里按上面 Linux 步骤装，或用 Docker Desktop 跑 compose。
方案 B：用 Memurai —— Windows 上兼容 Redis 的本地服务（社区版免费，www.memurai.com），
        安装后就是个 Windows 服务，redis-cli 也能连，适合不想碰 WSL 的同学。
方案 C（不推荐）：Redis 官方 Windows 版早已停止维护，别用老旧的 msi 包。
```

::: warning Windows 路径坑
如果你在 Windows 里写 `redis.conf` 并挂载到 Docker，注意换行符。Windows 记事本默认 CRLF，Redis 读配置可能报错。**用 VS Code 把文件行尾改成 LF（右下角点 CRLF 切到 LF 再保存）**，或在 WSL 里创建文件。
:::

### 4.5 redis-cli 上手：和它说第一句话

`redis-cli` 是 Redis 自带的命令行客户端。连上容器里的 Redis：

```bash
# 方式一：进容器里直接用（最方便）
docker exec -it canoe-redis redis-cli

# 方式二：从宿主机连（带密码用 -a）
redis-cli -h 127.0.0.1 -p 6379 -a canoe123456
# 注意：-h 主机、-p 端口、-a 密码。密码会提示不安全，可连上后单独 AUTH

# 连上后先认证（如果没用 -a）
127.0.0.1:6379> AUTH canoe123456
OK
```

日常必会的第一批命令：

```bash
# 1) PING：心跳检测，返回 PONG 说明活着
127.0.0.1:6379> PING
PONG

# 2) 存/取一个字符串
127.0.0.1:6379> SET hello "world"
OK
127.0.0.1:6379> GET hello
"world"

# 3) INFO：查看服务器信息（内存、连接数、持久化、key 数量等）
127.0.0.1:6379> INFO
# 输出很长，可只看某一段，比如内存：
127.0.0.1:6379> INFO memory
# 输出片段：
# used_memory_human:1.20M
# maxmemory_human:256.00M

# 4) SELECT：Redis 有 0~15 共 16 个逻辑库，默认在 0 号库
127.0.0.1:6379> SELECT 1
OK
127.0.0.1:6379> DBSIZE
(integer) 0

# 5) DBSIZE：当前库的 key 总数
127.0.0.1:6379> SELECT 0
OK
127.0.0.1:6379> DBSIZE
(integer) 1

# 6) FLUSHDB：清空当前库（危险！）。FLUSHALL 清空所有库（更危险！）
# ⚠️ 生产环境建议禁用这两条命令（用 rename-command 改名），见第 10 节踩坑墙
127.0.0.1:6379> FLUSHDB
OK
```

::: danger FLUSHDB / FLUSHALL 是"删库跑路"按钮
这两条命令会清空数据，且**默认没有确认、没有后悔药**。生产环境一定要用 `rename-command FLUSHALL ""` 和 `rename-command FLUSHDB ""` 把它们禁用或改名，否则一个手滑全公司缓存/数据就没了。
:::

### 4.6 图形化工具：让数据"看得见"

命令行够用，但图形界面排查数据更直观。两款主流：

| 工具 | 特点 | 适合谁 |
| --- | --- | --- |
| **RedisInsight** | Redis 官方出品，免费，功能全（键值浏览、慢日志、内存分析、内置 CLI） | 想要官方、功能全的同学 |
| **Another Redis Desktop Manager** | 开源免费，轻量，中文友好，连接管理方便 | 日常开发、喜欢轻量中文界面的同学 |

::: tip 连图形化工具填什么
- Host：`127.0.0.1`（或你的服务器 IP）
- Port：`6379`
- Password：`canoe123456`（就是 `requirepass` 设的那个）
- 连上后默认进 `db0`，左侧能看所有 key、点开看 value、直接增删改，比命令行直观得多。
:::

## 五、Redis 通用命令详解

不管 value 是字符串还是哈希，key 本身有一批"通用命令"对所有类型都生效。这些命令每个 Redis 开发者都得熟。

### 5.1 键的查看与删除（高危区）

| 命令 | 作用 | 示例 | 注意 |
| --- | --- | --- | --- |
| `KEYS pattern` | 按通配符列出所有匹配的 key | `KEYS user:*` | **生产禁用！** 会全量扫库、阻塞 |
| `SCAN cursor [MATCH p] [COUNT n]` | 游标式渐进遍历 key | `SCAN 0 MATCH user:* COUNT 100` | 安全替代 `KEYS` |
| `EXISTS key` | key 是否存在（可多个） | `EXISTS user:1` | 返回存在的个数 |
| `TYPE key` | 返回 value 的类型 | `TYPE user:1` | `string/hash/list/set/zset` 等 |
| `DEL key [key...]` | 删除 key（同步） | `DEL user:1 user:2` | 大 key 删除会卡，用 `UNLINK` |
| `UNLINK key [key...]` | 异步删除（延迟回收） | `UNLINK bigkey` | 6.0+，不阻塞主线程 |
| `RENAME key newkey` | 改名 | `RENAME a b` | newkey 已存在会被覆盖 |
| `MOVE key db` | 把 key 移到另一个逻辑库 | `MOVE user:1 1` | 集群模式不可用 |
| `RANDOMKEY` | 随机返回一个 key | `RANDOMKEY` | 库空返回 nil |
| `OBJECT ENCODING key` | 看底层编码（int/embstr/raw…） | `OBJECT ENCODING user:1` | 排查底层结构利器 |

**致命重点：生产环境禁用 `KEYS`！**

`KEYS user:*` 会**遍历整个库的所有 key** 来匹配。当你的 Redis 里有上千万个 key 时，这条命令会卡住几秒甚至几十秒，期间**所有其他命令都被阻塞**（因为命令执行是单线程的，见第七节）。结果就是：接口大面积超时、服务雪崩。

```bash
# ❌ 灾难写法：key 一多就拖垮整个 Redis
127.0.0.1:6379> KEYS *

# ✅ 正确写法：用 SCAN 分批游标遍历，每次只扫一小批，不阻塞
127.0.0.1:6379> SCAN 0 MATCH user:* COUNT 100
1) "168"            # 下一次要传的游标 cursor
2) 1) "user:1001"   # 这一批匹配到的 key
   2) "user:1002"
```

`SCAN` 的玩法：第一次传游标 `0`，它返回"下次的游标 + 这一批 key"。你拿返回的游标再传进去继续扫，**直到游标重新变成 `0`**，说明扫完了。每次只处理一小批，不阻塞服务。

::: warning SCAN 的"可能重复 / 可能漏"特性
`SCAN` 不保证：① 同一 key 在一次完整遍历里**可能返回多次**；② 遍历期间被删的 key 不会返回、被加的可能返回也可能不返回。所以它适合"全量扫描做统计/清理"，不适合"精确一次"的强一致场景。去重逻辑要在你代码里处理。
:::

### 5.2 过期时间（TTL）相关命令

缓存、验证码、登录态全靠"过期"活着。这批命令必须会：

| 命令 | 作用 | 示例 |
| --- | --- | --- |
| `EXPIRE key 秒` | 设置多少秒后过期 | `EXPIRE code:138001 120` |
| `PEXPIRE key 毫秒` | 毫秒级过期 | `PEXPIRE code:138001 120000` |
| `TTL key` | 还剩多少秒（-1 永不过期，-2 已删除） | `TTL code:138001` |
| `PTTL key` | 毫秒级剩余时间 | `PTTL code:138001` |
| `PERSIST key` | 取消过期，变永久 | `PERSIST code:138001` |
| `EXPIREAT key 时间戳` | 到指定 Unix 秒时间戳过期 | `EXPIREAT token 1700000000` |

```bash
# 存一个验证码，120 秒后自动失效
127.0.0.1:6379> SET code:138001 "8848"
OK
127.0.0.1:6379> EXPIRE code:138001 120
(integer) 1

# 看还剩多少秒
127.0.0.1:6379> TTL code:138001
(integer) 117

# 返回 -1 表示"永不过期"（没设过过期）
# 返回 -2 表示"key 已经不存在了"（可能过期被删了）
```

::: tip 一个隐藏坑：覆盖写会清掉过期
`SET` 一个**已有过期时间**的 key，会**抹掉原来的过期时间**，变成永不过期！

```bash
127.0.0.1:6379> SET token "abc"; EXPIRE token 300
OK
(integer) 1
127.0.0.1:6379> TTL token
(integer) 298
127.0.0.1:6379> SET token "def"     # ⚠️ 重新 SET，过期被清空！
OK
127.0.0.1:6379> TTL token
(integer) -1                          # 变成永不过期，泄漏！
```

想"覆盖值但保留过期"，用 `SET key value KEEPTTL`（Redis 6.0+）。这个坑在缓存场景会直接导致"本该过期的缓存变成了永久脏数据"。

### 5.3 用 Java 代码做 SCAN 渐进遍历

下面这段 Java 代码，演示在 Spring Boot 里如何用 `StringRedisTemplate` + `ScanOptions` 安全地遍历大量 key（替代危险的 `KEYS *`）。

`src/main/java/com/canoe/redis/ScanDemo.java`：

```java
package com.canoe.redis;

import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 演示用 Spring Data Redis 安全地遍历 key（替代生产禁用的 KEYS *）。
 *
 * 等价 redis-cli：SCAN 0 MATCH user:* COUNT 100
 */
public class ScanDemo {

    // Spring 注入的 StringRedisTemplate（key/value 都是 String 类型）
    private final StringRedisTemplate stringRedisTemplate;

    public ScanDemo(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    /**
     * 渐进式扫描匹配 pattern 的所有 key，逐个打印。
     * 用 Cursor 游标，每次只取一小批，不会阻塞 Redis。
     */
    public void scanAllKeys(String pattern) throws IOException {
        // 构造扫描选项：匹配 user:*，每批建议 100 个（COUNT 只是 hint）
        ScanOptions options = ScanOptions.scanOptions()
                .match(pattern)
                .count(100)
                .build();

        // try-with-resources：退出时自动关闭 cursor（连带关闭底层连接）
        try (Cursor<byte[]> cursor = stringRedisTemplate.getConnectionFactory()
                .getConnection()
                .scan(options)) {

            // 循环拿游标返回的每一个 key（字节数组），转成字符串打印
            while (cursor.hasNext()) {
                byte[] rawKey = cursor.next();
                String key = new String(rawKey, StandardCharsets.UTF_8);
                System.out.println("扫到 key = " + key);
            }
        }
        // 游标走到末尾（cursor 内部游标归 0）即遍历完成
    }
}
```

::: tip 为什么不用 keys() 方法
`StringRedisTemplate` 也有 `keys(pattern)` 方法，它底层就是 `KEYS` 命令，**生产同样禁用**。上面用 `scan` 才是正路。另外 `Cursor<byte[]>` 里的泛型是代码块内部写法，不受"裸泛型加反引号"限制——只有代码块外面的正文才需要把 `List<String>` 这种写成带反引号的形式。
:::

## 六、Redis 为什么这么快（面试高频）

"Redis 怎么这么快？"是后端面试八百年不变的问题。答好它，先记住四个核心原因，再用比喻讲明白。

### 6.1 四大原因一览

| 原因 | 通俗解释 |
| --- | --- |
| **纯内存操作** | 数据在内存，读写不碰磁盘，速度是磁盘的十万倍级 |
| **单线程执行命令** | 不用加锁、不用上下文切换，避免了多线程的锁竞争和并发 bug |
| **IO 多路复用（epoll）** | 一个线程同时盯住成千上万个连接，谁有数据来了就处理谁 |
| **高效数据结构** | 底层用 SDS、跳表、哈希表等精心设计的结构，操作基本 O(1) |

### 6.2 比喻：一个手脚特别快的收银员

**"单线程"听起来不是应该慢吗？** 这是最大的直觉误区。

想象超市结账：

- **多线程方案**：开 10 个收银台（10 个线程），但顾客得排隊、换台要交接、台子之间还要抢同一台打印机（锁竞争）→ 看起来人多，其实大量时间花在"排队 + 交接 + 等锁"上。
- **单线程方案**：只开 1 个收银台，但**这个收银员手脚快到离谱**，每个顾客 0.01 秒就结完。因为只有一个台子，**根本不用排队、不用交接、不用抢打印机**——没有一丝内耗。

Redis 就是那个"手脚离谱快的收银员"：它每个命令执行极快（微秒级），且全程不用来回切换、不用抢锁，**单线程反而没有多线程的那些开销**。只要单个命令别太慢（所以禁用 `KEYS`、避免大 key），单线程完全能扛住每秒十万级的请求。

### 6.3 IO 多路复用：一个收银员怎么同时盯 1000 个顾客

那你肯定想问：单线程的 Redis，怎么同时服务几万个客户端连接？

答案是 **IO 多路复用**（Linux 上用 `epoll`）。还是比喻：收银员虽然一次只结一个账，但他有个"呼叫器"能同时监听 1000 个收银通道——**哪个通道的顾客准备好了（数据到了），呼叫器就提醒他"去结这个"**。他挨个快速处理，看起来就像同时服务了所有人。

```text
客户端A ─┐
客户端B ─┤
客户端C ─┼──► [epoll 多路复用器] ──► 单线程命令执行器 ──► 逐个处理
  ...   ─┤      （谁有数据唤醒谁）        （快、无锁）
客户端N ─┘
```

::: tip 关键区分
- **网络 IO（读客户端请求、写回响应）**：Redis 6.0 起可以多线程干（见 6.4），利用多核搬数据。
- **命令执行（真正读/写内存数据）**：始终单线程，保证原子性、无锁。

所以"单线程"准确说是"命令执行单线程"，不是"整个 Redis 只有一个线程"。
:::

### 6.4 反驳"单线程一定慢" + Redis 6.0 的多线程

**反驳误区**：单线程 ≠ 慢。慢不慢取决于"每个任务耗时 × 是否内耗"。Redis 的任务（内存读写）耗时极短且零内耗，所以单线程反而高效。很多"慢"其实是多线程的锁竞争、上下文切换带来的内耗造成的。

**Redis 6.0 引入的多线程是什么？**

Redis 6.0（2020）开始，把**网络 IO 的读写**改成了多线程（通过 `io-threads` 配置），但**命令执行仍然是单线程**。为什么这么设计？

```text
Redis 6.0 之前：
   单线程：读网络 → 执行命令 → 写网络      （网络 IO 也占单线程时间）

Redis 6.0 之后：
   多个 IO 线程：读网络 / 写网络（搬数据，可并行用多核）
   单线程：    执行命令（保持原子、无锁）
```

原因：当客户端很多、网络带宽很大时，"把请求从网络读进来、把结果写出去"这个**搬运**动作本身会吃掉单线程不少时间。把它多线程化，能更好利用多核 CPU 来"搬数据"，**但命令执行这一环仍单线程**，所以你写的 Lua、事务、单条命令的原子性不受影响。

::: warning 版本差异请以官方最新文档为准
`io-threads` 相关配置在 Redis 6.0 引入，默认 `io-threads 4`（且默认只读阶段多线程，写回仍需配合 `io-threads-do-reads yes`）。不同小版本默认值可能调整，**生产调优请以你所用的 Redis 版本的官方文档为准**。面试答到"6.0 网络 IO 多线程、命令执行单线程"就到位了。
:::

## 七、数据库与 Key 命名规范

### 7.1 16 个逻辑库的来历与争议

Redis 默认有 **0 到 15 共 16 个"逻辑库"（db）**，用 `SELECT n` 切换。这 16 个库**共享同一份内存和配置**，纯粹是命名空间隔离，不是物理隔离。

```bash
127.0.0.1:6379> SELECT 0
OK
127.0.0.1:6379> SELECT 15
OK
```

但业界对"用不用多库"有争议：

| 观点 | 理由 |
| --- | --- |
| **不推荐用多库** | 16 个库混在一个实例里，运维、监控、迁移都按"整个实例"来，分库意义不大；容易搞混 |
| **集群模式只有 db0** | Redis Cluster 直接**不支持 `SELECT`**，所有数据都在 `db0`，用多库的代码到集群就报错 |
| **推荐做法** | 真要隔离，就**起多个 Redis 实例**，而不是在同一个实例里开多库 |

::: tip 实践建议
学习和单机随便用 `SELECT` 都行；但**写业务代码时，默认就用 `db0`**，用"好的 key 命名"来做逻辑隔离，别依赖多库。这样将来要上 Redis Cluster 也不用改代码。Spring Boot 里 `database: 0` 是默认值。
:::

### 7.2 Key 命名规范：业务名:对象名:id[:field]

Redis 的 key 是全局扁平的字符串，没有"表"概念，所以命名全靠约定。业界通用格式：

```text
业务名:对象名:id[:字段]
```

举例：

```text
user:1001:name          # 用户 1001 的昵称
user:1001:age           # 用户 1001 的年龄
order:8899:status       # 订单 8899 的状态
cart:u1001:sku2001      # 用户 u1001 购物车里 sku2001 的数量
```

好处：

- **一眼看懂**这是什么数据、属于谁。
- **方便用 `SCAN`/`KEYS`（仅开发）按前缀批量操作**，比如 `user:1001:*` 能拿到这个用户的所有字段。
- **避免冲突**：加了业务名前缀，不同模块不会误覆盖对方的 key。

::: tip 用 `:` 而不是 `.` 或 `_` 的原因
Redis 官方和社区习惯用冒号 `:` 做层级分隔，因为很多图形化工具（如 RedisInsight）会把 `user:1001:name` 在树状视图里按 `:` 自动折叠成层级，排查数据特别清爽。用 `.` 或 `_` 就没有这效果。
:::

### 7.3 Key 的长度控制

key 不是越长越好。两点注意：

- **别太长**：key 本身也占内存。一个 value 才 10 字节，key 却 200 字节，内存就浪费在 key 上了。建议 key 控制在几十字节内，用缩写（如 `u:1001:n` 而非 `user:1001:name`，前提团队约定统一）。
- **别太短到看不懂**：`a:1` 省内存但三个月后你不知道它是啥。在"可读"和"省内存"间取平衡，学习阶段优先可读。

::: warning 大 key 是另一个雷
不光 key 长不行，**单个 value 特别大**也是雷（比如一个 Hash 存了 100 万个 field、一个 String 存了 50MB 的 JSON）。大 key 在删除、序列化、网络传输时都会卡住单线程。后面缓存章节会专门讲"大 key 拆分"。
:::

## 八、Spring Boot 最小连通 Demo

终于到代码了。这一步跑通，你就拥有"Java 程序 ↔ Redis"的第一条通路。

### 8.1 完整 pom.xml

`pom.xml`（Spring Boot 3.5.5 父工程统一管理版本，配置给全）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
                             http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <!-- 1) Spring Boot 父工程：统一管理所有依赖版本，避免冲突 -->
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.5</version>
        <relativePath/>
    </parent>

    <groupId>com.canoe</groupId>
    <artifactId>redis-demo</artifactId>
    <version>1.0.0</version>
    <name>redis-demo</name>

    <!-- 2) 用 properties 统一管 Java 版本等属性 -->
    <properties>
        <java.version>17</java.version>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
        <!-- Web 起步依赖：提供 Spring 容器、内嵌 Tomcat，方便跑 CommandLineRunner -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- Redis 起步依赖：spring-boot-starter-data-redis，
             底层默认用 Lettuce 客户端（不是 Jedis） -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-redis</artifactId>
        </dependency>

        <!-- Lombok：少写 getter/setter（可选，但习惯用） -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>

        <!-- 测试起步依赖 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <!-- Spring Boot 打包插件：打出可直接运行的 fat-jar -->
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

::: tip 为什么是 spring-boot-starter-data-redis
这个 starter 自动帮你配置好 `RedisTemplate` 和 `StringRedisTemplate` 两个 Bean，并默认使用 **Lettuce** 客户端（基于 Netty，天然支持 Redis 6.0 的 IO 多线程、响应式）。早期老项目用 Jedis，新项目默认 Lettuce 即可，无需额外引 Jedis 依赖。
:::

### 8.2 完整 application.yml

`src/main/resources/application.yml`（每项带注释）：

```yaml
spring:
  application:
    name: redis-demo
  data:
    redis:
      # 1) Redis 主机地址（连容器就填 localhost；连远程填 IP 或域名）
      host: 127.0.0.1
      # 2) 端口（默认 6379）
      port: 6379
      # 3) 密码（对应 redis.conf 里的 requirepass）
      password: canoe123456
      # 4) 使用哪个逻辑库，默认 0（集群模式只能是 0）
      database: 0
      # 5) 连接超时时间
      connect-timeout: 5000ms
      # 6) Lettuce 连接池配置（避免每次操作都新建连接）
      lettuce:
        pool:
          # 连接池最大连接数
          max-active: 8
          # 最大空闲连接
          max-idle: 8
          # 最小空闲连接
          min-idle: 0
          # 连接池耗尽时最多等待多久
          max-wait: 2000ms

# 7) 应用自己的端口（和 Redis 的 6379 无关，这是 Web 服务端口）
server:
  port: 8080
```

::: warning 密码里有特殊字符怎么办
如果 `requirepass` 里包含 `@`、`:` 这类 URL 特殊字符，`host/port/password` 分开写没问题；但如果用 `spring.data.redis.url` 这种 `redis://user:pass@host:port` 形式，特殊字符要 URL 编码。推荐像上面这样**拆成 host/port/password 三个字段**，最省心。
:::

### 8.3 一个 CommandLineRunner 跑通 set/get

`src/main/java/com/canoe/redis/RedisDemoApplication.java`：

```java
package com.canoe.redis;

import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.data.redis.core.StringRedisTemplate;

import org.springframework.beans.factory.annotation.Autowired;

/**
 * 启动类。实现 CommandLineRunner，让 Spring 容器起来后自动跑一段初始化代码，
 * 用来验证 "Java → Redis" 的连通：存一个 key，再取出来打印。
 */
@SpringBootApplication
public class RedisDemoApplication implements CommandLineRunner {

    // 注入 Spring 自动配置的 StringRedisTemplate（key 和 value 都是字符串）
    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    public static void main(String[] args) {
        // 启动 Spring Boot 应用；容器就绪后会回调下面的 run() 方法
        SpringApplication.run(RedisDemoApplication.class, args);
    }

    @Override
    public void run(String... args) throws Exception {
        // 1) opsForValue() 拿到操作 String 类型的入口
        // 2) set 一个 key="canoe:hello"，value="你好，Redis"
        stringRedisTemplate.opsForValue().set("canoe:hello", "你好，Redis");

        // 3) get 取回来
        String value = stringRedisTemplate.opsForValue().get("canoe:hello");

        // 4) 打印，控制台看到 "你好，Redis" 就说明连通成功
        System.out.println("从 Redis 读到的 value = " + value);

        // 5) 顺手验证一下 TTL：存个带 60 秒过期的，再查剩余时间
        stringRedisTemplate.opsForValue().set("canoe:temp", "稍纵即逝", java.time.Duration.ofSeconds(60));
        Long ttl = stringRedisTemplate.getExpire("canoe:temp");
        System.out.println("canoe:temp 剩余过期秒数 = " + ttl);
    }
}
```

跑起来：

```bash
# 在项目根目录
mvn spring-boot:run
```

控制台预期输出（节选）：

```text
从 Redis 读到的 value = 你好，Redis
canoe:temp 剩余过期秒数 = 60
```

同时开一个 `redis-cli` 验证：

```bash
127.0.0.1:6379> GET canoe:hello
"你好，Redis"
```

::: tip StringRedisTemplate vs RedisTemplate
- `StringRedisTemplate`：key 和 value 都按 **String** 序列化，最直观，日常 90% 场景用它。
- `RedisTemplate`：是泛型版 `RedisTemplate<K, V>`，默认用 JDK 序列化（value 会变成乱码二进制）。要用它存对象，得自己配 JSON 序列化器。本篇先只用 `StringRedisTemplate` 建立连通；存对象（如 `User`）会在后面章节用 JSON 序列化专门讲。
:::

## 九、常见踩坑墙

把新手最容易摔的坑集中贴在这面墙上，照着避：

```text
┌─────────────────────────────────────────────────────────────────┐
│ 坑 1：生产用 KEYS * 全量扫描 → 服务雪崩                          │
│   正解：用 SCAN 游标遍历                                          │
│                                                                 │
│ 坑 2：SET 覆盖了带过期的 key → 缓存变永久脏数据                   │
│   正解：保留过期用 SET key val KEEPTTL，或先读 TTL 再重设         │
│                                                                 │
│ 坑 3：不设 maxmemory → Redis 吃满内存触发 OOM                     │
│   正解：redis.conf 必设 maxmemory + maxmemory-policy             │
│                                                                 │
│ 坑 4：不设 requirepass 还暴露公网 → 分钟级被黑清空                │
│   正解：强密码 + 防火墙 + (可选) rename-command 禁用危险命令     │
│                                                                 │
│ 坑 5：用 SELECT 切换多库，后来上了 Redis Cluster 报错            │
│   正解：业务默认用 db0，靠 key 命名做逻辑隔离                     │
│                                                                 │
│ 坑 6：大 key（百万 field 的 Hash / 几十 MB 的 String）           │
│   正解：拆分；删除大 key 用 UNLINK 而非 DEL                      │
│                                                                 │
│ 坑 7：用 DEL 删大 key 卡住单线程                                 │
│   正解：Redis 4.0+ 用 UNLINK 异步删除                            │
│                                                                 │
│ 坑 8：把 Redis 当主库，核心数据只放内存不同步 MySQL               │
│   正解：Redis 是缓存/辅助，权威数据放 MySQL                      │
└─────────────────────────────────────────────────────────────────┘
```

::: danger 危险命令建议直接禁用
在 `redis.conf` 里用 `rename-command` 把"删库级"命令改名甚至清空，生产强烈建议：

```text
rename-command FLUSHALL ""
rename-command FLUSHDB  ""
rename-command KEYS     ""
```

设为 `""` 表示彻底禁用该命令（调用会报未知命令错误）。这能从配置层面堵死误操作和恶意删库。
:::

::: warning 版本差异请以官方最新文档为准
文中命令与配置基于 Redis 7.4 验证。部分配置项名随版本变化（如 7.0 起 `hash-max-ziplist-*` 已更名为 `hash-max-listpack-*`，见 02 篇）。**一切以你所使用 Redis 版本的官方文档为准**；不确定时用 `redis-cli` 的 `CONFIG GET *` 或 `OBJECT ENCODING` 亲自验证。
:::

## 本篇小结

- **Redis 是"便签本"式的内存键值库**：快，但容量小、重启可丢；MySQL 是"档案柜"，稳、大、慢一点，二者搭档而非替代。
- **Redis 全称 REmote DIctionary Server**，不只是缓存，还能做锁、排行榜、队列、限流、去重等十多种活。
- **Redis vs Memcached**：Redis 数据结构更丰富、支持持久化、功能覆盖更广，新项目基本选 Redis。
- **环境搭建用 Docker 最稳**：`redis:7.4-alpine` + 密码 + `appendonly yes` + `maxmemory` + `restart` + 数据卷，照 4.1 的 compose 抄即可。
- **`redis-cli` 入门命令**：`PING` 探活、`SET/GET` 读写、`INFO` 看状态、`SELECT/DBSIZE` 切库看量、`FLUSHDB` 危险。
- **生产禁用 `KEYS`**，用 `SCAN` 游标渐进遍历，不阻塞服务；大 key 删除用 `UNLINK` 而非 `DEL`。
- **Redis 快的四因**：纯内存、命令执行单线程（无锁无切换）、IO 多路复用（epoll）、高效数据结构。
- **Redis 6.0 多线程只在线程 IO（网络读写），命令执行仍单线程**，原子性和锁语义不受影响。
- **Key 命名用 `业务名:对象名:id[:field]`**，用冒号分层、控制长度；业务默认用 `db0`，别依赖多库（集群不支持 `SELECT`）。
- **Spring Boot 连通**：`spring-boot-starter-data-redis` + `application.yml` 配 host/port/password/lettuce pool，注入 `StringRedisTemplate` 即可 `opsForValue().set/get`。
- **配置三大红线**：`requirepass`、`maxmemory`、持久化（`appendonly yes`），缺一个都可能出生产事故。

## 参考链接

- Redis 官方文档（总入口）：<https://redis.io/docs/latest/>
- Redis 官方简介（what is redis）：<https://redis.io/docs/latest/about/>
- Docker 官方 Redis 镜像：<https://hub.docker.com/_/redis>
- Redis 持久化（RDB 与 AOF）：<https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/>
- Redis 内存淘汰策略（maxmemory-policy）：<https://redis.io/docs/latest/operate/oss_and_stack/reference/eviction/>
- Spring Data Redis 官方文档：<https://docs.spring.io/spring-data/redis/docs/current/reference/html/>
- Redis 命令参考（KEYS/SCAN/EXPIRE 等）：<https://redis.io/docs/latest/commands/>
- RedisInsight 下载：<https://redis.io/docs/latest/develop/connect/redisinsight/>

下一篇 → [02 数据类型与常用命令](/java/middleware/redis/data-types)
