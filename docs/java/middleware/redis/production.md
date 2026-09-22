# 08 高可用、集群与生产调优

> 本篇导读：前 7 章我们学会了「怎么用 Redis」，但「用在生产」和「本地跑通」是两码事。Redis 一上生产，立刻要面对一连串灵魂拷问：宕机了数据会不会丢？内存满了怎么办？主库挂了谁顶上？几千个 key 怎么一次删？热点 key 把 CPU 打满怎么破？这一篇就是 Redis 的「生产生存手册」——持久化、过期淘汰、主从、哨兵、Cluster、Big/Hot Key、慢查询、监控告警、系统内核参数，以及一个面试/排障 checklist。读完你应该能在简历上写「熟悉 Redis 高可用与生产调优」而不心虚。

## 本篇要解决的问题

- RDB 和 AOF 到底有啥区别？生产到底开哪个？数据丢了怎么恢复？
- 过期 key 是谁删的？为什么我设了 TTL 内存还涨？
- `maxmemory` 不设置有多可怕？8 种淘汰策略怎么选？LRU 和 LFU 差在哪？
- 主从复制的全量/增量是什么？`repl_backlog` 是干嘛的？
- 哨兵怎么自动选主？`quorum`、脑裂、`min-replicas-to-write` 是什么？
- Cluster 的 16384 个槽、MOVED/ASK 重定向、hash tag 怎么理解？
- 主从+哨兵 vs Cluster 怎么选？
- Big Key、Hot Key、慢查询怎么发现和治理？监控看哪些指标？内核参数怎么调？

## 一、持久化之一：RDB 快照

### 1.1 是什么

RDB（Redis Database）是 Redis 在某个**时刻**的全量数据快照，存成一个**二进制压缩文件**（默认 `dump.rdb`）。恢复时直接把这个文件 load 进内存，速度极快。

::: tip 一句话
RDB = 给内存数据「拍张照」存盘。优点：文件小、恢复快；缺点：两次快照之间宕机，中间的数据会丢。
:::

### 1.2 触发命令：`SAVE` vs `BGSAVE`

| 命令 | 执行方式 | 生产能用吗 |
| --- | --- | --- |
| `SAVE` | **主进程阻塞**执行快照，期间 Redis 不响应任何请求 | ❌ 禁用（数据大时卡死） |
| `BGSAVE` | **fork 子进程**后台异步快照，主进程继续服务 | ✅ 生产用 |

```bash
# 手动触发一次后台快照（推荐）
redis-cli BGSAVE

# 查看最近一次 RDB 是否成功、耗时
redis-cli INFO persistence
```

### 1.3 Copy-On-Write（写时复制）原理

`BGSAVE` 之所以不阻塞，靠的是操作系统的 **Copy-On-Write（COW）**：

::: tip COW 白话版
执行 `BGSAVE` 时，Redis 调用 `fork()` 创建一个**子进程**。fork 出来的瞬间，父子进程**共享同一块物理内存**（页表指向相同内存页，几乎瞬间完成，不复制数据）。之后：
- **主进程（父）** 继续处理写请求。当它要修改某个内存页时，操作系统会**先把这一页复制一份**给主进程改，子进程那份保持原样（这就是「写时复制」）。
- **子进程** 专心把「fork 那一刻的内存快照」写到 RDB 文件，不受后续写入影响。

所以：快照大小 = fork 时刻的数据量；被修改的页才会额外复制，内存占用 = 原数据 + 修改期间新增的脏页。
:::

**为什么 fork 瞬间会有延迟尖刺、内存大时风险高**：
- `fork()` 要复制页表，数据量越大（几十 GB）页表越大，fork 本身可能停顿几十到几百毫秒（甚至秒级）。
- 快照期间主进程大量写入 → 大量 COW 复制 → **内存实际占用可能翻倍**，触发 OOM 风险。
- 因此生产建议：控制单实例内存（如 ≤ 10GB），避免超大实例做 RDB。

### 1.4 配置项详解

```text
# redis.conf 中 RDB 自动触发规则（满足条件就 BGSAVE）
save 3600 1       # 3600 秒内至少有 1 个 key 变化 → 快照
save 300 100      # 300 秒内至少有 100 个 key 变化 → 快照
save 60 10000     # 60 秒内至少有 10000 个 key 变化 → 快照
# 含义：三个条件是「或」的关系，任意一个满足就触发

dbfilename dump.rdb        # 快照文件名
dir /data/redis           # 快照文件存放目录（务必用可靠磁盘）
stop-writes-on-bgsave-error yes  # 快照失败（如磁盘满）时禁止继续写入，避免数据只进内存（保护一致性）
rdbcompression yes        # 对字符串用 LZF 压缩，省磁盘，多耗一点 CPU
rdbchecksum yes           # 文件末尾写 CRC64 校验和，加载时校验完整性
```

### 1.5 触发时机的四种

1. **手动**：执行 `SAVE` / `BGSAVE`。
2. **配置自动**：命中 `save` 规则。
3. **主从全量复制**：从节点第一次连主节点，主节点会 `BGSAVE` 把 RDB 发给从节点。
4. **`SHUTDOWN` / `FLUSHALL`**：默认关闭时若开启 RDB 会存一盘；`FLUSHALL` 也会触发（清空后的空盘）。

### 1.6 优缺点

| 优点 | 缺点 |
| --- | --- |
| 文件紧凑，适合备份/容灾/迁移 | 两次快照间宕机 → 数据丢失（取决于 save 频率） |
| 恢复速度远快于 AOF | fork 有停顿尖刺，大数据量风险高 |
| 对性能影响小（子进程异步） | 无法做到秒级持久化 |

## 二、持久化之二：AOF

### 2.1 是什么

AOF（Append Only File）把**每一条写命令**以 Redis 协议格式追加到日志文件。重启时**重放**这些命令即可恢复数据。

::: tip 与 RDB 的本质区别
RDB 存「结果」（某时刻的数据）；AOF 存「过程」（做过哪些写操作）。AOF 数据更全（默认最多丢 1 秒），但文件更大、恢复更慢。
:::

### 2.2 写后日志（与 MySQL WAL 的区别）

Redis 的 AOF 是**写后日志**：先执行命令、改内存，再把命令追加到 AOF 文件。而 MySQL 的 WAL（Write Ahead Log）是**写前日志**：先写日志再改数据。

::: tip 为什么 Redis 敢「写后」
因为命令已经执行成功（语法、参数都已校验通过），写后记录的是「确定成功的操作」，不会把一条会报错的命令记进日志。代价是：宕机瞬间「已执行但未落盘」的那一条会丢（由 `appendfsync` 控制丢多少）。
:::

### 2.3 `appendfsync` 三种策略

| 策略 | 行为 | 可靠性 | 性能 | 生产建议 |
| --- | --- | --- | --- | --- |
| `always` | 每条写命令都 `fsync` 到磁盘 | 不丢（最强） | 最差（每次都刷盘） | 极少用，性能扛不住 |
| `everysec` | 每秒 `fsync` 一次（默认） | 最多丢 1 秒 | 好（推荐） | ✅ 生产默认 |
| `no` | 交给操作系统决定何时刷盘 | 可能丢较多 | 最好 | 不推荐（不可控） |

```text
# redis.conf
appendonly yes                 # 开启 AOF（Redis 7 起默认 yes）
appendfilename "appendonly.aof"
appendfsync everysec           # 每秒刷盘，生产最常用
```

### 2.4 AOF 重写（Rewrite）

**为什么需要重写**：AOF 不断追加命令，文件会无限膨胀。比如对同一个 key 做了 100 次 `INCR`，AOF 里记了 100 条，但其实只需 1 条 `SET key 100`。

**重写过程**（保证数据一致性）：
- 手动 `BGREWRITEAOF`，或自动触发。
- Redis fork 一个**子进程**扫描当前内存，直接生成「能重建当前数据的最小命令集」新 AOF 文件。
- 重写期间主进程的新写命令，会**同时**写「旧 AOF」和「**重写缓冲区**」；子进程完成后，主进程把重写缓冲区的内容追加到新 AOF，再原子替换旧文件。

```text
# 自动重写阈值
auto-aof-rewrite-percentage 100   # 当前 AOF 比上次重写后体积增长 100%（翻倍）触发
auto-aof-rewrite-min-size 64mb    # 且 AOF 至少 64mb 才重写（避免小文件频繁重写）
```

::: warning 重写也是 fork，同样有 COW 开销
AOF 重写同样 `fork` 子进程，大数据量实例要评估内存与停顿，和 RDB 同理。
:::

### 2.5 混合持久化（Redis 4.0+）

```text
aof-use-rdb-preamble yes   # AOF 文件开头用 RDB 格式，后面追加增量 AOF 命令
```

::: tip 混合持久化的好处
- 恢复时**先按 RDB 秒级加载全量**（快），再**重放后面的增量 AOF**（少）→ 兼顾「恢复速度」和「数据完整性」。
- 这是 Redis 7 的默认推荐组合。
:::

### 2.6 修复损坏的 AOF

```bash
# 用自带工具修复（会丢弃无法解析的那一段之后的命令）
redis-check-aof --fix appendonly.aof.1.incr.aof
```

## 三、RDB vs AOF 对比 + 生产推荐

| 维度 | RDB | AOF |
| --- | --- | --- |
| 数据安全性 | 丢两次快照间的数据 | 默认最多丢 1 秒（`everysec`） |
| 文件大小 | 小（压缩二进制） | 大（命令文本） |
| 恢复速度 | 快 | 慢（重放命令） |
| 宕机影响 | fork 尖刺 | fork 尖刺 + 重放耗时 |
| 适用 | 备份、容灾、主从全量同步 | 作为主要持久化保证数据安全 |

::: danger 生产推荐（明确结论）
**RDB 和 AOF 两个都开，以 AOF 为主、RDB 为辅。**
- 恢复优先级：优先用 AOF（数据最全）；AOF 损坏时用 RDB 兜底。
- 备份策略：定时 `BGSAVE` + 把 `dump.rdb` / AOF 目录**异地/对象存储**备份，保留多份历史，应对「误删 + 已同步删除」的灾难。
- 容灾：主从 + 每日 RDB 归档 + 监控 AOF 重写失败告警。
:::

## 四、过期删除策略

Redis 的 key 设了 TTL 后，谁来删？三种经典策略：

| 策略 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 定时删除 | 到 TTL 立刻开定时器删 | 内存最及时释放 | CPU 压力大，不现实 |
| 惰性删除 | 访问 key 时才检查是否过期，过期就删 | 不占 CPU | 不访问的过期 key 一直占内存（内存泄漏感） |
| 定期删除 | 每隔一段时间（默认 100ms）随机抽一批 key 检查删除 | CPU/内存折中 | 抽样的会漏删一部分 |

::: tip Redis 的真实做法
Redis 用的是 **「惰性删除 + 定期删除」组合**：
- 惰性删除：每次 `GET` 前先判断过期，过期则删。
- 定期删除：后台 `databasesCron` 每 100ms 随机扫 20 个带 TTL 的 key，删掉过期的，若过期比例高就再扫一轮（有上限，避免阻塞）。

所以「我设了 TTL，但内存还涨」的原因往往是：过期 key 还没被惰性/定期扫到，且这些 key 一直没被访问 → 暂时还在内存里。这是**正常**的，不是 bug；极端情况（大量冷过期 key）可用 `ACTIVE EXPIRE CYCLE` 调参或主动 `SCAN` 触发。
:::

## 五、内存淘汰策略

### 5.1 `maxmemory` 必须设置

::: danger 红线
**64 位系统 `maxmemory` 默认是 0（不限制）**。不设的话 Redis 会一直吃内存直到**把机器物理内存吃满** → OOM → 被 OS 杀掉或拖垮整台机器。生产**必须**显式设置 `maxmemory`（比如机器内存的 70%~75%，给 OS/ fork COW 留余量）。
:::

```text
maxmemory 6gb                 # 单实例最多用 6GB
maxmemory-policy allkeys-lru  # 内存满时的淘汰策略
```

### 5.2 8 种 `maxmemory-policy` 逐个解释

| 策略 | 作用范围 | 行为 |
| --- | --- | --- |
| `noeviction` | — | **不淘汰**，写满直接报错（默认）。只适合「纯内存 DB 不容丢」 |
| `volatile-lru` | 只淘汰**设了 TTL**的 key | 按 LRU 删最近最少用的 |
| `allkeys-lru` | 所有 key | 按 LRU 删最近最少用的（最常用） |
| `volatile-lfu` | 设了 TTL 的 key | 按 LFU 删访问频次最低的 |
| `allkeys-lfu` | 所有 key | 按 LFU 删访问频次最低的 |
| `volatile-random` | 设了 TTL 的 key | 随机删 |
| `allkeys-random` | 所有 key | 随机删 |
| `volatile-ttl` | 设了 TTL 的 key | 优先删**剩余 TTL 最短**的 |

### 5.3 LRU vs LFU 通俗讲

- **LRU（Least Recently Used，最近最少使用）**：看「**多久没被访问**」。最久没摸过的先淘汰。简单，但有个问题——一个 key 历史上被狂访问过一次后再不访问，它仍是「最近被访问过」而不会被淘汰；反之一个「一直稳定热点但刚被访问稍早」的可能被误删。
- **LFU（Least Frequently Used，最不经常使用）**：看「**访问频次**」。Redis 用 **Morris counter**（概率计数器）给每个 key 记访问频率，并随时间**衰减**。更适合「老热点不再热、新热点要起来」的真实场景。

```text
# LFU 调参
lfu-log-factor 10    # 计数器增长的对数因子，越大越难涨到高值（区分度更高）
lfu-decay-time 1     # 多少分钟没访问就衰减一次，默认 1 分钟
```

### 5.4 选择建议

| 场景 | 推荐策略 |
| --- | --- |
| 纯缓存（丢了能从 DB 回源） | `allkeys-lru` |
| 缓存 + 部分需持久化的 key 不想被删 | `volatile-lru`（给持久化 key 不设 TTL） |
| 有长尾热点、访问频次差异大 | `allkeys-lfu` |
| 只淘汰快过期的 | `volatile-ttl` |
| 不允许任何写失败（如会话存储且另有持久化） | `noeviction`（需配足够内存） |

### 5.5 `maxmemory-samples`

LRU/LFU 是**近似**算法：Redis 不会遍历全库找最久未用，而是随机抽 `maxmemory-samples` 个（默认 5）比较。调大更精确但更耗 CPU：

```text
maxmemory-samples 5   # 默认；要更精确可设 10，但高频写入场景慎用
```

## 六、主从复制

### 6.1 作用

- **读写分离**：主库写、从库读，分摊读压力。
- **数据备份**：从库是主库的实时副本。
- **高可用基础**：哨兵/Cluster 的故障转移依赖主从。

### 6.2 全量复制 vs 增量复制

::: tip 核心概念
- **`repl_backlog`**：主库维护的一个**环形缓冲区**，记录「最近写命令」的偏移量（offset）。从库断开重连后，若它的 offset 还在这个缓冲区内，主库就只把「缺口部分」发给它（**增量复制**）；若已滑出缓冲区，则必须**全量复制**（主库 `BGSAVE` 发 RDB + 后续命令）。
- **offset**：主从各自维护的复制偏移，用于判断同步进度。
- **`PSYNC`**：从库向主库发起的同步命令，`PSYNC <runid> <offset>`，主库据此决定全量还是增量。
:::

```text
全量复制流程（首次 / 断线太久）：
  从库 PSYNC → 主库发现需全量 → 主库 BGSAVE 生成 RDB → 发 RDB 给从库
       → 从库清空旧数据 load RDB → 主库把 backlog 期间的新命令发给从库 → 同步完成

增量复制流程（断线短时间重连）：
  从库 PSYNC 带旧 offset → 主库查 repl_backlog → offset 还在 → 只发缺口命令 → 同步完成
```

### 6.3 配置

```text
# 从库 redis.conf
replicaof 127.0.0.1 6379      # 老版本叫 slaveof，Redis 5+ 推荐 replicaof
replica-read-only yes         # 从库默认只读，禁止写（防脑裂数据不一致）
repl-diskless-sync no         # 全量复制是否无盘（直接网络发 RDB）；磁盘快时设 no，网络快盘慢设 yes
repl-backlog-size 1mb         # 环形缓冲大小，调大可减少全量复制概率（推荐 64mb~1gb 视写入量）
```

### 6.4 Docker Compose 一主二从

```yaml
version: "3.8"
services:
  redis-master:
    image: redis:7.4
    container_name: redis-master
    command: ["redis-server", "--requirepass", "123456", "--appendonly", "yes"]
    ports:
      - "6379:6379"
  redis-replica1:
    image: redis:7.4
    container_name: redis-replica1
    command: ["redis-server", "--requirepass", "123456",
              "--replicaof", "redis-master", "6379",
              "--masterauth", "123456"]
    depends_on:
      - redis-master
    ports:
      - "6380:6379"
  redis-replica2:
    image: redis:7.4
    container_name: redis-replica2
    command: ["redis-server", "--requirepass", "123456",
              "--replicaof", "redis-master", "6379",
              "--masterauth", "123456"]
    depends_on:
      - redis-master
    ports:
      - "6381:6379"
```

### 6.5 主从的问题（清醒认识）

::: warning 主从不是银弹
1. **主挂要人工切换**：主库宕机后，从库不会自动升主（除非上哨兵）。
2. **写能力无法扩展**：写只能走主库，主库单点写瓶颈仍在。
3. **主从延迟**：从库异步复制，读从库可能读到旧数据（对一致性要求高的读要走主库）。
4. **主挂时未同步数据会丢**：异步复制下，主库宕机瞬间还没发给从库的那部分写会丢。
:::

## 七、哨兵 Sentinel

### 7.1 三大职责

- **监控**：哨兵不断 `PING` 主从，判断是否存活。
- **自动故障转移**：主库挂了，哨兵自动选一个从库升主，并让其他从库复制新主。
- **通知**：通过 pub/sub 把新主地址通知客户端。

### 7.2 原理（选主全流程）

```text
1) 主观下线 sdown：单个哨兵发现主库 PING 不通（超过 down-after-milliseconds），认为「它挂了」（只是我个人觉得）。
2) 客观下线 odown：足够数量（≥ quorum）的哨兵都标记主库 sdown，达成共识 → 主库「真的挂了」。
3) 选举领头哨兵：多个哨兵用 Raft 思路选出一个「领头哨兵」来干故障转移的活。
4) 选新主：从存活从库中按优先级（replica-priority）→ 复制偏移量最大（数据最新）→ runid 最小 的顺序挑一个，发送 REPLICAOF NO ONE 升主。
5) 通知：让其余从库复制新主；通过 pub/sub 把新主地址推给客户端。
```

### 7.3 `sentinel.conf` 完整配置

```text
# sentinel.conf（哨兵节点的配置）
port 26379
sentinel monitor mymaster 127.0.0.1 6379 2
    # mymaster=主节点名  127.0.0.1:6379=主库地址  2=quorum（至少 2 个哨兵同意才算 odown）
sentinel auth-pass mymaster 123456        # 主库密码
sentinel down-after-milliseconds mymaster 5000   # 5 秒 PING 不通判 sdown
sentinel parallel-syncs mymaster 1        # 故障转移后，同时向新主同步的从库数（1=逐个，减轻新主压力）
sentinel failover-timeout mymaster 180000 # 故障转移超时 180 秒
sentinel resolve-hostnames no
```

### 7.4 Docker Compose 一主二从三哨兵

```yaml
version: "3.8"
services:
  redis-master:
    image: redis:7.4
    command: ["redis-server", "--requirepass", "123456", "--appendonly", "yes"]
    ports: ["6379:6379"]
  redis-replica1:
    image: redis:7.4
    command: ["redis-server", "--requirepass", "123456", "--replicaof", "redis-master", "6379", "--masterauth", "123456"]
    depends_on: [redis-master]
    ports: ["6380:6379"]
  redis-replica2:
    image: redis:7.4
    command: ["redis-server", "--requirepass", "123456", "--replicaof", "redis-master", "6379", "--masterauth", "123456"]
    depends_on: [redis-master]
    ports: ["6381:6379"]
  sentinel1:
    image: redis:7.4
    command: ["redis-sentinel", "--requirepass", "123456"]
    volumes:
      - ./sentinel1.conf:/usr/local/etc/redis/sentinel.conf
    ports: ["26379:26379"]
  sentinel2:
    image: redis:7.4
    command: ["redis-sentinel", "--requirepass", "123456"]
    volumes:
      - ./sentinel2.conf:/usr/local/etc/redis/sentinel.conf
    ports: ["26380:26379"]
  sentinel3:
    image: redis:7.4
    command: ["redis-sentinel", "--requirepass", "123456"]
    volumes:
      - ./sentinel3.conf:/usr/local/etc/redis/sentinel.conf
    ports: ["26381:26379"]
```

三个 `sentinelN.conf` 内容均为上面 7.3 的配置（`sentinel monitor mymaster redis-master 6379 2`，注意容器网络里主机名用 `redis-master`）。

### 7.5 Spring Boot 连接哨兵

```yaml
spring:
  data:
    redis:
      password: 123456
      sentinel:
        master: mymaster              # 主节点名（和 sentinel monitor 一致）
        nodes:
          - 127.0.0.1:26379
          - 127.0.0.1:26380
          - 127.0.0.1:26381
```

::: warning 哨兵客户端必须支持哨兵协议
普通 `Jedis`/`Lettuce` 连接哨兵要用「哨兵模式连接工厂」（Spring Data Redis 的 `LettuceConnectionFactory` 配 sentinel 即可），不能直连某个节点 IP——主库地址会变。Redisson 配 `sentinelServersConfig` 同理（见 07 篇 2.2 节）。
:::

### 7.6 常见坑

- **哨兵只解决高可用，不解决扩容**：数据量超单机内存，还得上 Cluster。
- **脑裂（split-brain）**：主库其实没死、只是与哨兵网络隔离，哨兵误判把它降级、另立新主；原主恢复后变成「双主」，写入冲突。缓解：

```text
min-replicas-to-write 1        # 主库至少要有 1 个正常同步的从库才接受写
min-replicas-max-lag 10        # 从库延迟超过 10 秒就不算「正常同步」
```

这样原主在「失联从库」时会拒绝写入，降低脑裂丢数据概率。

## 八、Cluster 集群

### 8.1 为什么需要

- 数据量**超过单机内存**（单实例内存建议 ≤ 10GB，大了 RDB/fork 危险）。
- 写并发**超过单机**（Cluster 把写分散到多主）。

### 8.2 哈希槽 16384

::: tip 核心机制
Cluster 把整个 key 空间切成 **16384 个哈希槽（slot）**。每个 key 算槽：

```text
HASH_SLOT = CRC16(key) mod 16384
```

这些槽被**均匀分配给不同主节点**。客户端请求任意 key，节点算出它的槽，若槽归自己管就直接处理，否则返回重定向告诉客户端去哪。
:::

### 8.3 MOVED 重定向 vs ASK 重定向

- **MOVED**：槽**已经稳定归属**另一个节点（比如扩容迁移完成后）。客户端应**更新本地槽→节点映射缓存**，下次直接去正确节点。
- **ASK**：槽**正在迁移中**（数据一部分在旧节点、一部分在新节点），临时让客户端这次去目标节点取，**不更新**本地缓存（迁移完成后会变成 MOVED）。

```text
客户端 → 节点A：GET key
节点A：槽 8000 归我，返回 value
（若槽已迁走）节点A：MOVED 8000 节点B:7001   → 客户端去节点B
（若槽正在迁）节点A：ASK 8000 节点B:7001     → 客户端这次去节点B，带上 ASKING
```

### 8.4 搭建集群

```bash
# 用 redis-cli 一键创建 3 主 3 从（--cluster-replicas 1 表示每主配 1 从）
redis-cli --cluster create \
  127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 \
  127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 \
  --cluster-replicas 1
```

输出会显示槽分配（0-5460 给节点1，5461-10922 给节点2，10923-16383 给节点3），确认后输入 `yes` 完成。

### 8.5 扩容 / 缩容

```bash
# 扩容：加两个新节点（一个主一个从），然后重新分槽
redis-cli --cluster add-node 127.0.0.1:7006 127.0.0.1:7000      # 加主
redis-cli --cluster add-node 127.0.0.1:7007 127.0.0.1:7000 --cluster-slave --cluster-master-id <新主ID>
redis-cli --cluster reshard 127.0.0.1:7000                      # 交互式迁移槽（填迁移多少、从谁到谁）
redis-cli --cluster rebalance 127.0.0.1:7000                    # 自动均衡各节点槽数

# 缩容：先 reshard 把槽迁走，再 del-node
redis-cli --cluster del-node 127.0.0.1:7000 <要删的节点ID>
```

### 8.6 Spring Boot 连接集群

```yaml
spring:
  data:
    redis:
      password: 123456
      cluster:
        nodes:
          - 127.0.0.1:7000
          - 127.0.0.1:7001
          - 127.0.0.1:7002
```

### 8.7 集群的限制（极易踩坑）

::: danger 集群三大约束
1. **不支持跨槽多 key 操作**：`MSET`、`SUNIONSTORE`、`Lua` 脚本里操作多个 key，若这些 key 不在同一个槽 → 报错 `CROSSSLOT Keys in request don't hash to the same slot`。
   - 解决：用 **hash tag `{xxx}`** 把相关 key 绑到同一槽，如 `user:{1001}:name` 和 `user:{1001}:age`，大括号里的 `1001` 参与算槽，两者必同槽。
2. **`SELECT` 不可用**：Cluster 只有 `db0`，不能切库。
3. **批量操作要自己按槽分组**：`MGET` 多个跨槽 key 需客户端先按槽分组，再分别请求各节点（Redisson/Lettuce 会自动分，但自己写 Pipeline 要注意）。
:::

## 九、主从+哨兵 vs Cluster 选型对比

| 维度 | 主从 + 哨兵 | Cluster |
| --- | --- | --- |
| 数据量 | 单机内存够用 | 超单机内存，需水平分片 |
| 写扩展 | 不行（单主写） | 可以（多主分片写） |
| 高可用 | 哨兵自动故障转移 | 每个分片自带主从 + 自动转移 |
| 运维复杂度 | 低 | 高（槽迁移、客户端路由） |
| 跨槽多 key | 支持 | 受限（需 hash tag） |
| 适用 | 中小规模、读写分离、要高可用 | 大规模、大数据量、高写入 |

::: tip 选型口诀
「**数据量没超单机、只想高可用+读写分离**」→ 主从+哨兵。「**数据量/写入超单机、要分片**」→ Cluster。绝大多数中小业务，哨兵够用。
:::

## 十、生产实战问题

### 10.1 Big Key（大 key）

**定义**（经验值，可配置阈值）：
- `String` 类型 value **超过 10KB**；
- 集合（`Hash`/`List`/`Set`/`ZSet`）元素**超过 5000（或 1 万）个**。

**危害**：
- 阻塞：删除/遍历大 key 是 O(N)，卡住主线程。
- 网络拥塞：一次读几千个元素，撑爆带宽。
- 删除卡死：`DEL` 大 key 阻塞，Redis 假死。

**发现方法**：

```bash
# 1) 交互式扫描找出大 key（不阻塞，生产 safe）
redis-cli --bigkeys

# 2) 找占用内存最大的 key（Redis 4+）
redis-cli --memkeys

# 3) 看单个 key 内存占用
redis-cli MEMORY USAGE my:big:key

# 4) 离线分析 RDB（不连生产）：redis-rdb-tools 把 rdb 转 CSV 再分析
rdb -c memory dump.rdb > memory.csv
```

**拆分方案**：

```text
大 String：拆成 user:1:part1、user:1:part2 ... 多个小 key，应用层拼接。
大 Hash：按字段哈希分段，hash:0{user:1} ~ hash:99{user:1}，每段只放部分 field。
大 List/ZSet：按时间或 id 范围拆成多个 key（list:202601、list:202602）。
删除大 key：用 UNLINK（异步懒删除，Redis 4+）替代 DEL，避免阻塞。
```

### 10.2 Hot Key（热 key）

**定义**：某个 key 被**极高频率**访问（如爆款商品、明星八卦），单节点 CPU/网络被打满。

**发现**：

```bash
# 1) 需要 LFU 策略才能用（allkeys-lfu / volatile-lfu 后）
redis-cli --hotkeys

# 2) 监控 INFO 里某 key 的 QPS（或客户端埋点 / 代理层统计）
# 3) 业务侧：本地计数、网关统计、Redis 代理（如 Twemproxy/Codis）埋点
```

**解决**：

```text
方案 A：本地二级缓存。用 Caffeine 在应用层缓存热 key，请求先打本地，命中就不进 Redis。
方案 B：读写分离 + 加副本。热 key 走从库，多从分担读压力。
方案 C：key 分片。把 hotkey 拆成 hotkey:1 ~ hotkey:N，请求随机/轮询打其中一份，分散压力；写时写全部分片。
```

### 10.3 慢查询

```text
slowlog-log-slower-than 10000   # 执行超过 10000 微秒（10 毫秒）的命令记进慢日志
slowlog-max-len 128             # 慢日志最多保留 128 条（环形，旧的被覆盖）
```

```bash
# 查看慢日志
redis-cli SLOWLOG GET 10        # 最近 10 条
redis-cli SLOWLOG LEN
redis-cli SLOWLOG RESET         # 清空
```

**典型慢命令黑名单**（生产尽量别用或控制规模）：
- `KEYS *`（全库扫，生产禁用，用 `SCAN` 替代）
- `FLUSHALL` / `FLUSHDB`（清空，生产重命名/禁用）
- `SMEMBERS` / `HGETALL` / `LRANGE 0 -1` 大集合（用 `SSCAN`/`HSCAN`/`LRANGE` 分页）
- 大 `Lua` 脚本（脚本里别写循环遍历大 key）

### 10.4 Pipeline 批量优化

```text
Pipeline：把多条命令打包一次性发给 Redis，减少网络往返（RTT）。适合「批量写/读、不需要上一条结果决定下一条」的场景。
MGET：一次取多个 key，本质是服务端合并，但只适用于「同类型、已知 key 列表」。
对比：要取 1000 个已知 key → MGET 一条命令；要「边读边决定」→ 用 Pipeline。
注意：Cluster 下 Pipeline 里的 key 必须同一槽（或用 hash tag），否则跨节点失败。
```

### 10.5 连接池参数建议

| 参数（客户端侧，以 Lettuce/Jedis 为例） | 建议值 | 说明 |
| --- | --- | --- |
| `max-active` / `maxTotal` | 按并发（如 32~64） | 最大连接数，别盲目设 1000 |
| `max-idle` | 同 max-active 或略小 | 最大空闲 |
| `min-idle` | 8~16 | 保底空闲，避免冷启动 |
| `max-wait` | 1~3 秒 | 拿不到连接最多等久，超时报错而非无限阻塞 |
| `timeout`（命令超时） | 1~3 秒 | 单命令超时，防止雪崩 |

### 10.6 监控指标

`INFO` 各段重点：

| 指标 | 命令 | 说明 / 告警 |
| --- | --- | --- |
| 命中率 | `INFO stats` 的 `keyspace_hits` / `keyspace_misses` | 命中率 = hits/(hits+misses)，低于 80% 查缓存设计 |
| 内存 | `INFO memory` 的 `used_memory` | 接近 `maxmemory` 要告警 |
| 内存碎片率 | `mem_fragmentation_ratio` | 远大于 1.5 表示碎片多，可 `activedefrag`；接近 1 正常 |
| 客户端 | `connected_clients` | 突增可能是连接泄漏 |
| 拒绝连接 | `rejected_connections` | 大于 0 说明连接数打满 |
| 每秒命令 | `instantaneous_ops_per_sec` | 衡量真实 QPS |

**Prometheus + Grafana 看板**：

```text
# redis_exporter 采集，Grafana 导入官方 Redis 看板
docker run -d --name redis_exporter -p 9121:9121 \
  -e REDIS_ADDR=redis://127.0.0.1:6379 \
  -e REDIS_PASSWORD=123456 \
  oliver006/redis_exporter
```

**告警阈值建议表**：

| 指标 | 告警阈值 | 级别 |
| --- | --- | --- |
| `used_memory / maxmemory` | > 85% | warning；> 95% critical |
| `mem_fragmentation_ratio` | > 1.5 或 < 1.0 | warning |
| `connected_clients` | > 预期 2 倍 | warning |
| `rejected_connections` | > 0 | critical |
| `instantaneous_ops_per_sec` | 突增 3 倍 | warning |
| 主从延迟 `master_repl_offset - slave_offset` | > 10MB | warning |
| `rdb_last_bgsave_status != ok` | 出现 | critical |

### 10.7 安全与规范

```text
# 禁用/重命名危险命令（redis.conf）
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command KEYS "GUARDKEYS"     # 重命名而非禁用，运维还能用
rename-command CONFIG "GUARDCONFIG"

# 必须设密码
requirepass 123456

# 保护模式（禁止无密码被外网访问）
protected-mode yes

# 不要暴露公网！用安全组/防火墙只放内网 IP

# 限制输出缓冲区（防止大 key 把输出缓冲撑爆，挤垮其他连接）
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60
```

### 10.8 系统层参数

::: warning Linux 内核调优（上线前必做）
- `vm.overcommit_memory = 1`：允许过量分配内存，避免 fork 时因「内存不足」分配失败（Redis 官方强制建议）。
- 关闭 THP（Transparent Huge Pages）：`echo never > /sys/kernel/mm/transparent_hugepage/enabled`，否则 fork/COW 时大页复制导致延迟尖刺。
- `ulimit -n 65535`：提高文件描述符上限（连接数 = 文件句柄）。
- `tcp-backlog` / `somaxconn`：提高 TCP 全连接队列，应对突发连接。
:::

```bash
# 临时设置（重启失效），生产写进 /etc/sysctl.conf 与 rc.local
sysctl -w vm.overcommit_memory=1
sysctl -w net.core.somaxconn=1024
echo never > /sys/kernel/mm/transparent_hugepage/enabled
```

### 10.9 Redis 6/7 新特性速览

| 特性 | 版本 | 说明 |
| --- | --- | --- |
| 多线程 IO | 6.0+ | `io-threads` 让网络读写多线程（命令执行仍单线程），高吞吐场景开 2~4 个 |
| RESP3 | 6.0+ | 新协议，支持更丰富数据类型推送 |
| 客户端缓存（client-side caching / tracking） | 6.0+ | 服务端通知客户端失效，客户端本地缓存自动失效，降低读压力 |
| Function | 7.0+ | 替代 Lua 脚本的「服务端函数」，可持久化、可管理 |
| listpack | 7.0+ | 替代 ziplist，更省内存、更不易产生碎片 |
| Sharded Pub/Sub | 7.0+ | 发布订阅按槽分片，突破单节点瓶颈 |

```text
# 多线程 IO 示例（CPU 多核且网络瓶颈时）
io-threads 4
io-threads-do-reads yes
```

### 10.10 常见故障排查速查表

生产出问题往往「现象相似、根因不同」，下面把高频故障的现象→可能根因→排查命令列成一张速查表，遇事先对表：

| 现象 | 可能根因 | 第一时间排查命令 |
| --- | --- | --- |
| 响应突然变慢、偶发卡顿 | 大 key / 慢查询 / fork 尖刺 | `SLOWLOG GET`、 `--bigkeys`、看 `INFO persistence` 的 `latest_fork_usec` |
| 内存持续上涨不降 | 过期 key 未被访问（惰性未触发）/ 没设淘汰策略 / 大 key | `INFO memory`、检查 `maxmemory-policy`、扫 `--bigkeys` |
| 内存打满、写报 `OOM command not allowed` | `maxmemory` 触顶且不淘汰（`noeviction`） | 看 `used_memory` vs `maxmemory`、`maxmemory-policy` |
| 从库数据比主库旧（读不一致） | 主从延迟 | `INFO replication` 的 `master_repl_offset` 与从库 `slave_replication_offset` 差值 |
| 主库挂了没人顶上 | 哨兵没配/没起来，或 `quorum` 太高 | `redis-cli -p 26379 SENTINEL master mymaster` 看状态 |
| 客户端连不上 / 拒绝连接 | `maxclients` 满、连接泄漏 | `INFO clients` 的 `connected_clients`、`rejected_connections` |
| 集群某些 key 报错 `CROSSSLOT` | 跨槽多 key 操作 | 用 hash tag `{xxx}` 绑定同槽 |
| 重启后数据全没 | 持久化没开 / AOF 损坏 | `INFO persistence` 看 `aof_enabled`、`rdb_last_bgsave_status` |

### 10.11 容量规划建议

上线前先做一道简单的容量题，避免「拍脑袋」：

```text
1) 估算总数据量（含副本）：单实例内存建议 ≤ 10GB（RDB/fork 安全线）。
   - 若预估数据 30GB → 至少 3 个主分片（Cluster），每主配 1 从 = 6 节点。
2) 估算写入 QPS：单主写入上限约数万 QPS（受命令复杂度影响）。
   - 超了 → 多主分片分摊写。
3) 内存预算 = 数据量 × (1 + 碎片率预留 20% + fork COW 峰值 100%)。
   - 例：数据 6GB → maxmemory 设 6~7GB，机器内存预留 ≥ 14GB 防 fork 翻倍 OOM。
4) 副本数：至少 1 从（高可用）；读多写少用 2 从做读写分离。
```

## 十一、面试 / 排障 checklist

::: tip 可打钩清单（上生产前逐条确认）
- [ ] `maxmemory` 已设置且有淘汰策略（非 `noeviction` 除非有特殊理由）
- [ ] RDB + AOF 双开，AOF 为主；`appendfsync everysec`
- [ ] 混合持久化 `aof-use-rdb-preamble yes`
- [ ] 主从已配，`repl-backlog-size` 足够大（防频繁全量复制）
- [ ] 高可用：哨兵（小业务）或 Cluster（大数据量）已部署，`quorum`/`min-replicas-to-write` 合理
- [ ] 危险命令 `KEYS`/`FLUSHALL` 已重命名/禁用，`requirepass` 已设
- [ ] `vm.overcommit_memory=1`、THP 已关、`ulimit -n` 已调
- [ ] 慢日志阈值已设，`KEYS *` 在代码里零出现（用 `SCAN`）
- [ ] 监控（redis_exporter + Grafana）已接，命中率/内存/连接告警已配
- [ ] Big Key / Hot Key 已排查（用 `--bigkeys`/`--hotkeys`），大 key 用 `UNLINK` 删
- [ ] 连接池参数已压测调优，无连接泄漏（`connected_clients` 稳定）
- [ ] 客户端支持高可用协议（哨兵/Cluster），主库地址变更能自动感知
- [ ] 备份策略：定时 `BGSAVE` + RDB/AOF 异地归档，做过恢复演练
:::

## 本篇小结

- **持久化**：RDB 是「快照」、快但丢数据；AOF 是「命令日志」、全但慢；生产**两者都开、AOF 为主、RDB 兜底**。
- **过期删除**：Redis 用「惰性 + 定期」组合，设了 TTL 内存仍涨是正常现象（未被访问到的冷过期 key 暂留）。
- **内存淘汰**：64 位 `maxmemory` 默认 0（不限制），**生产必须设**；纯缓存用 `allkeys-lru`，有长尾热点用 `allkeys-lfu`。
- **LRU vs LFU**：LRU 看「多久没访问」，LFU 看「访问频次」且用 Morris counter 概率衰减，更适合真实热点。
- **主从复制**：靠 `repl_backlog` 环形缓冲 + offset 决定全量还是增量；主从只解决备份/读写分离，不解决扩容。
- **哨兵**：监控 + 自动故障转移 + 通知；`quorum` 定客观下线门槛；用 `min-replicas-to-write` 缓解脑裂。
- **Cluster**：16384 槽，`CRC16(key) mod 16384` 定槽；MOVED=稳定归属、ASK=迁移中；跨槽多 key 需 hash tag `{xxx}`。
- **选型**：数据量没超单机要高可用 → 哨兵；超单机要分片 → Cluster。
- **Big Key**：定义 String>10KB / 集合>5000 元素；用 `--bigkeys`/`MEMORY USAGE` 发现，拆分 + `UNLINK` 删。
- **Hot Key**：用本地二级缓存（Caffeine）/ 读写分离 / key 分片 解决。
- **慢查询**：`SLOWLOG GET`，禁用 `KEYS *`，大集合用 `SCAN` 分页。
- **系统层**：`vm.overcommit_memory=1`、关 THP、`ulimit -n`、调 `somaxconn`、`io-threads` 多线程 IO。

## 参考链接

- [Redis 官方文档（持久化）](https://redis.io/docs/latest/operate/oss_and_enterprise/management/persistence/)
- [Redis 官方文档（复制）](https://redis.io/docs/latest/operate/oss_and_enterprise/management/replication/)
- [Redis 官方文档（Sentinel）](https://redis.io/docs/latest/operate/oss_and_enterprise/management/sentinel/)
- [Redis 官方文档（Cluster 教程）](https://redis.io/docs/latest/operate/oss_and_enterprise/management/scaling/)
- [Redis 内存淘汰策略文档](https://redis.io/docs/latest/operate/oss_and_enterprise/management/eviction/)
- [Redis 延迟与 Big Key 排查](https://redis.io/docs/latest/operate/oss_and_enterprise/management/optimization/latency/)
- [redis_exporter（Prometheus 监控）](https://github.com/oliver006/redis_exporter)
- [Redis 官方 linux 调优建议](https://redis.io/docs/latest/operate/oss_and_enterprise/management/optimization/)

下一篇 → [01 Redis 入门与环境搭建](/java/middleware/redis/overview)（Redis 篇到此结束）
