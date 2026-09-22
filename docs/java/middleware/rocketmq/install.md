# 02 安装部署与控制台

> 本篇手把手把 RocketMQ 跑起来：Docker Compose 一键部署、二进制包部署、`broker.conf` 每个配置项逐个讲、Dashboard 控制台怎么用、`mqadmin` 命令行速查，最后是一张"启动失败怎么办"的排障表。环境搭好之后，03~06 篇的代码都基于这套环境。

## 本篇要解决的问题

- Docker 怎么一次性起 NameServer + Broker + Dashboard？为什么我起了但连不上？
- 那个默认 8G 内存是什么鬼？我虚拟机只有 2G 怎么办
- `broker.conf` 里几十个配置项都是啥意思
- 控制台怎么建 Topic、怎么看消费进度、怎么查一条消息？
- `No route info of this topic` 到底怎么排查

## 一、Docker Compose 一键部署（推荐）

先看端口，这是最容易搞混的地方：

| 端口 | 属于谁 | 作用 |
| --- | --- | --- |
| **9876** | NameServer | 客户端（Producer/Consumer）连它查路由 |
| **10911** | Broker | **客户端收发消息的主端口** |
| **10909** | Broker | Broker 的 VIP 通道端口（一般是 10911 - 2），客户端也可能连它 |
| **10912** | Broker | HA 端口，主从之间同步数据用 |
| **8080** | Dashboard | 控制台 Web 界面（容器内） |
| **8081** | Proxy（5.x） | 5.x 的 gRPC 接入点，新客户端连它 |

::: warning 端口别只开 9876
新手最常见的错误：只映射了 `9876`，然后 `connect to xxx:10911 failed`。**客户端收发消息走的是 10911**，必须一起映射出来。
:::

### 完整 docker-compose.yml

```yaml
version: '3.8'

services:
  # ============ NameServer ============
  namesrv:
    image: apache/rocketmq:5.3.4
    container_name: rmq-namesrv
    ports:
      - "9876:9876"
    environment:
      # 关键！默认 JVM 是 8G，不改的话内存不够直接起不来
      JAVA_OPT_EXT: "-Xms512m -Xmx512m -Xmn256m"
    command: sh mqnamesrv
    volumes:
      - ./namesrv/logs:/home/rocketmq/logs
    restart: unless-stopped

  # ============ Broker ============
  broker:
    image: apache/rocketmq:5.3.4
    container_name: rmq-broker
    ports:
      - "10909:10909"
      - "10911:10911"
      - "10912:10912"
    environment:
      NAMESRV_ADDR: "namesrv:9876"
      JAVA_OPT_EXT: "-Xms1g -Xmx1g -Xmn512m"
    command: sh mqbroker -n namesrv:9876 -c /home/rocketmq/rocketmq-5.3.4/conf/broker.conf
    volumes:
      # 把 broker.conf 挂进去，方便改配置（下面给出配置内容）
      - ./broker.conf:/home/rocketmq/rocketmq-5.3.4/conf/broker.conf
      - ./broker/store:/home/rocketmq/store
      - ./broker/logs:/home/rocketmq/logs
    depends_on:
      - namesrv
    restart: unless-stopped

  # ============ Dashboard 控制台 ============
  dashboard:
    image: apacherocketmq/rocketmq-dashboard:latest
    container_name: rmq-dashboard
    ports:
      - "8080:8080"
    environment:
      # 指定 NameServer 地址；loginRequired=false 表示不用登录
      JAVA_OPTS: "-Drocketmq.namesrv.addr=namesrv:9876 -Drocketmq.config.loginRequired=false -Dserver.port=8080"
    depends_on:
      - namesrv
    restart: unless-stopped
```

配套的 `broker.conf`（放在 `docker-compose.yml` 同目录下）：

```properties
# 集群名，同一个集群里的 Broker 要保持一致
brokerClusterName = DefaultCluster
# Broker 名，主从用同一个 brokerName
brokerName = broker-a
# 0 表示 Master，非 0 表示 Slave
brokerId = 0
# 删除无用文件的时机，04 表示凌晨 4 点
deleteWhen = 04
# 文件保留时间（小时），默认 48 小时
fileReservedTime = 48
# 角色：ASYNC_MASTER（异步复制主）/ SYNC_MASTER（同步双写主）/ SLAVE
brokerRole = ASYNC_MASTER
# 刷盘方式：ASYNC_FLUSH（异步刷盘，性能好）/ SYNC_FLUSH（同步刷盘，不丢消息）
flushDiskType = ASYNC_FLUSH
# 监听端口，默认 10911
listenPort = 10911
# 存储根目录
storePathRootDir = /home/rocketmq/store
# 自动创建 Topic：测试环境开 true，生产建议关掉
autoCreateTopicEnable = true
# 自动创建消费组：同理
autoCreateSubscriptionGroup = true
# ★ 关键：Docker/多网卡环境必须显式指定，否则客户端拿到容器内网 IP 会连不上
brokerIP1 = 宿主机的真实IP
```

### 启动与验证

```bash
# 启动（后台）
docker compose up -d

# 看容器状态
docker ps

# 看 NameServer 日志，出现下面这行说明启动成功
docker logs -f rmq-namesrv
# The Name Server boot success. serializeType=JSON

# 看 Broker 日志
docker logs -f rmq-broker
# The broker[broker-a, 172.17.0.3:10911] boot success. serializeType=JSON and name server is namesrv:9876

# 打开控制台
# 浏览器访问 http://localhost:8080
```

### 用容器自带的测试工具自测收发

```bash
# 发消息
docker exec -it rmq-broker sh -c \
  'export NAMESRV_ADDR=namesrv:9876 && sh /home/rocketmq/rocketmq-5.3.4/bin/tools.sh \
   org.apache.rocketmq.example.quickstart.Producer'
# SendResult [sendStatus=SEND_OK, msgId=..., offsetMsgId=..., messageQueue=..., queueOffset=...]

# 收消息（Ctrl+C 退出）
docker exec -it rmq-broker sh -c \
  'export NAMESRV_ADDR=namesrv:9876 && sh /home/rocketmq/rocketmq-5.3.4/bin/tools.sh \
   org.apache.rocketmq.example.quickstart.Consumer'
# Consumer Started.
# ConsumeMessageThread_1 Receive New Messages: [MessageExt [...]]
```

## 二、二进制包部署（Linux）

适合不用 Docker 的场景（比如公司服务器上直接装）。

### 步骤 1：下载解压

```bash
# 下载二进制包（版本号按实际替换）
wget https://dist.apache.org/repos/dist/release/rocketmq/5.3.4/rocketmq-all-5.3.4-bin-release.zip

unzip rocketmq-all-5.3.4-bin-release.zip
cd rocketmq-all-5.3.4-bin-release
```

### 步骤 2：改 JVM 内存（新手第一坑）

RocketMQ 默认的 JVM 参数是为生产服务器准备的，一上来就要 8G：

```bash
# runserver.sh 默认（NameServer）
JAVA_OPT="${JAVA_OPT} -server -Xms8g -Xmx8g -Xmn4g ..."

# runbroker.sh 默认（Broker）
JAVA_OPT="${JAVA_OPT} -server -Xms8g -Xmx8g ..."
```

你的虚拟机/开发机只有 2G 内存的话，启动会直接报 `There is insufficient memory for the Java Runtime Environment`。

改法（二选一）：

```bash
# 方式一：直接编辑（推荐，看得清楚）
vim bin/runserver.sh   # 把 -Xms8g -Xmx8g -Xmn4g 改成 -Xms512m -Xmx512m -Xmn256m
vim bin/runbroker.sh   # 把 -Xms8g -Xmx8g 改成 -Xms1g -Xmx1g

# 方式二：用 sed 批量替换
sed -i 's/-Xms8g -Xmx8g -Xmn4g/-Xms512m -Xmx512m -Xmn256m/' bin/runserver.sh
sed -i 's/-Xms8g -Xmx8g/-Xms1g -Xmx1g/' bin/runbroker.sh
```

::: tip 更好的做法：别改脚本，用环境变量
RocketMQ 的启动脚本会读取 `JAVA_OPT_EXT` 环境变量并把它拼到 JVM 参数最后面，而**后面的参数会覆盖前面的**，所以不用改脚本：

```bash
export JAVA_OPT_EXT="-Xms1g -Xmx1g -Xmn512m"
```

Docker 部署就是用的这个办法。
:::

### 步骤 3：启动 NameServer

```bash
# 后台启动
nohup sh bin/mqnamesrv &

# 看日志（日志在 ~/logs/rocketmqlogs/ 下）
tail -f ~/logs/rocketmqlogs/namesrv.log
```

看到这一行就是启动成功：

```text
2026-09-21 21:00:00 INFO main - The Name Server boot success. serializeType=JSON
```

### 步骤 4：写 broker.conf 并启动 Broker

```bash
# 用自带的模板改（也可以直接新建）
cat > conf/broker.conf << 'EOF'
brokerClusterName = DefaultCluster
brokerName = broker-a
brokerId = 0
namesrvAddr = 127.0.0.1:9876
listenPort = 10911
deleteWhen = 04
fileReservedTime = 48
brokerRole = ASYNC_MASTER
flushDiskType = ASYNC_FLUSH
autoCreateTopicEnable = true
storePathRootDir = /home/rocketmq/store
EOF

# 启动（-n 指定 NameServer，-c 指定配置文件）
nohup sh bin/mqbroker -n 127.0.0.1:9876 -c conf/broker.conf &

# 看日志
tail -f ~/logs/rocketmqlogs/broker.log
```

成功标志：

```text
The broker[broker-a, 192.168.1.10:10911] boot success. serializeType=JSON and name server is 127.0.0.1:9876
```

### 步骤 5：关闭（顺序很重要）

```bash
# 先关 Broker，再关 NameServer
sh bin/mqshutdown broker
sh bin/mqshutdown namesrv
```

::: warning 一定要用脚本关，别直接 kill -9
`kill -9` 会导致 `store/abort` 文件残留。这个文件的存在表示"上次 Broker 是异常退出的"，下次启动时会触发**文件恢复流程**（重建 ConsumeQueue / IndexFile），启动会很慢。正常关闭会删掉这个文件。
:::

### Windows 部署差异

| 事项 | 说明 |
| --- | --- |
| 环境变量 | 必须设置 `ROCKETMQ_HOME` 指向解压目录 |
| 启动脚本 | 用 `bin/mqnamesrv.cmd` 和 `bin/mqbroker.cmd` |
| 路径 | `storePathRootDir` 用 Windows 路径时盘符要写对，建议用 `/` 或双反斜杠 |
| 内存 | 同样要改 `runserver.cmd` / `runbroker.cmd` 里的 `-Xms`/`-Xmx` |
| 常见问题 | 中文路径、路径里有空格会报 `找不到或无法加载主类` |

## 三、broker.conf 配置项全解

按功能分组，逐个说明（**标 ★ 的是生产必配**）：

### 身份与集群

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `brokerClusterName` | DefaultCluster | 集群名，同集群内所有 Broker 保持一致 |
| `brokerName` | — | Broker 名，**主从用同一个名字** |
| `brokerId` | 0 | **0 = Master，非 0 = Slave**。同 `brokerName` 下只能有一个 0 |
| ★ `namesrvAddr` | — | NameServer 地址，多个用 `;` 分隔。不写的话要用 `-n` 启动参数 |
| ★ `brokerIP1` | 自动探测 | **本机对外 IP**。多网卡 / Docker / 云服务器必配，否则客户端拿到错误地址 |
| `brokerIP2` | 同 brokerIP1 | 主从同步用的 IP，一般不用改 |

### 端口

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `listenPort` | 10911 | 客户端收发消息的主端口 |
| `haListenPort` | `listenPort + 1`（10912） | 主从同步端口 |
| `haHaListenPort` | — | 5.x 新 HA 端口 |

::: tip VIP 通道端口是怎么回事
Broker 会在 `listenPort - 2`（即 10909）上再开一个"VIP 通道"，客户端默认优先连这个端口。所以**防火墙要同时放开 10909 和 10911**。

不想用 VIP 通道的话，客户端可以设置 `producer.setVipChannelEnabled(false)`。
:::

### 存储与清理

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `storePathRootDir` | `$HOME/store` | 存储根目录 |
| `storePathCommitLog` | `$HOME/store/commitlog` | CommitLog 目录（消息本体） |
| `storePathConsumeQueue` | `$HOME/store/consumequeue` | ConsumeQueue 目录（索引） |
| `deleteWhen` | 04 | 每天几点执行过期文件清理（04 = 凌晨 4 点） |
| `fileReservedTime` | 48 | **消息保留小时数**，默认 2 天。超过会被删掉 |
| `deleteCommitLogFilesInterval` | 100(ms) | 删除文件的间隔 |
| `diskMaxUsedSpaceRatio` | 75 | 磁盘使用率超过这个值就触发清理（另有两个水位 85/90，逐级变严格） |
| `mappedFileSizeCommitLog` | 1073741824(1G) | 单个 CommitLog 文件大小 |

::: danger fileReservedTime 太短的后果
很多公司为了省磁盘把它设成 24 甚至 12 小时。后果是：**一旦消费者出问题堆积超过这个时间，那些还没消费的消息会被物理删除，永久丢失**。

建议：`fileReservedTime` 至少 72 小时，配合磁盘水位自动清理，并且**监控消费堆积**。
:::

### 可靠性

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| ★ `brokerRole` | ASYNC_MASTER | `ASYNC_MASTER`（主写成功即返回，异步复制给从）、`SYNC_MASTER`（主从都写完才返回）、`SLAVE` |
| ★ `flushDiskType` | ASYNC_FLUSH | `ASYNC_FLUSH`（写 PageCache 就返回，性能好，宕机可能丢少量）、`SYNC_FLUSH`（刷盘才返回，不丢但慢） |
| `syncFlushTimeout` | 5000(ms) | 同步刷盘超时时间 |
| `messageDelayLevel` | 见 04 篇 | 4.x 的 18 个延时等级，可自定义 |

### 功能开关

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `autoCreateTopicEnable` | true | **是否自动创建 Topic。生产建议 false**，测试可 true |
| `autoCreateSubscriptionGroup` | true | 是否自动创建消费组 |
| `traceTopicEnable` | false | 消息轨迹开关，开了会有 `RMQ_SYS_TRACE_TOPIC` |
| `enablePropertyFilter` | false | **SQL92 过滤开关**，要用 SQL 表达式过滤必须开 |
| `timerWheelEnable` | false | 5.x 任意时间定时消息开关（时间轮），与 `timerPrecisionMs`、`timerMaxDelaySec` 配合 |
| `aclEnable` | false | ACL 权限控制开关 |
| `messageIndexEnable` | true | 是否建 IndexFile（支持按 key 查消息） |
| `maxMessageSize` | 4194304(4MB) | 单条消息最大体积 |

::: warning 生产为什么要关 autoCreateTopicEnable
开着的话，任何人代码里写错一个 Topic 名字，Broker 就悄悄给他建一个，结果：
1. Topic 越建越多，运维不知道哪个是干什么的
2. 新建的 Topic 默认只有 4 个队列，性能上不去也不知道
3. 出现脏 Topic 很难清理

生产推荐：关闭自动创建，Topic 走**申请 + 审批 + 用 `mqadmin updateTopic` 显式创建**。
:::

## 四、日志在哪，怎么排查

```bash
ls ~/logs/rocketmqlogs/
```

| 日志文件 | 内容 | 什么时候看它 |
| --- | --- | --- |
| `namesrv.log` | NameServer 运行日志 | NameServer 起不来、路由不对 |
| `broker.log` | Broker 运行日志 | **最重要**，启动、注册、异常都在这 |
| `store.log` | 存储层日志 | 建索引、刷盘、文件删除 |
| `storeerror.log` | 存储层错误 | 刷盘失败、文件损坏 |
| `watermark.log` | 磁盘水位 | 磁盘快满时 |
| `commercial.log` | 统计信息 | — |
| `lock.log` | 文件锁 | — |

另外两个和启动相关的文件：

| 文件 | 作用 |
| --- | --- |
| `store/abort` | **存在 = 上次是异常退出**，下次启动会走文件恢复流程。正常关闭后会自动删除 |
| `store/checkpoint` | 记录各文件的刷盘时间点，恢复时用来判断从哪里开始 |

## 五、RocketMQ Dashboard 控制台

### 部署

```bash
docker run -d --name rmq-dashboard \
  -p 8080:8080 \
  -e "JAVA_OPTS=-Drocketmq.namesrv.addr=你的IP:9876 -Drocketmq.config.loginRequired=false" \
  apacherocketmq/rocketmq-dashboard:latest
```

::: tip 新版 Dashboard 的配置项前缀
不同版本配置项前缀可能是 `rocketmq.config.*` 或 `rocketmq.namesrv.*`。如果配了不生效，去容器里看 `/rocketmq-dashboard.jar` 同目录的 `application.properties`，或者直接进容器 `env | grep JAVA_OPTS` 确认。

常用几个：
- `-Drocketmq.namesrv.addr=host:9876` — NameServer 地址
- `-Drocketmq.config.loginRequired=true` — 开启登录（开启后默认账号 admin/admin，在 `users.properties` 里配）
- `-Drocketmq.config.dataPath=/tmp/rocketmq-console/data` — 数据目录
- `-Dserver.port=8080` — 端口
:::

### 界面功能逐个讲

#### 1）Cluster（集群）

看有多少个 Broker、各自的角色（Master/Slave）、地址、每天生产和消费多少条消息。**一眼确认 Broker 有没有正常注册到集群**。

如果这里是空的，说明 Broker 没启动成功或 `namesrvAddr` 配错了。

#### 2）Topic（主题）

- **列表**：所有 Topic、队列数（`writeQueueNums` / `readQueueNums`）、权限 perm
- **新建/更新 Topic**：`ADD/UPDATE` 按钮，填 `topicName`、`clusterName`、`brokerName`、`writeQueueNums`、`readQueueNums`、`perm`
  - `readQueueNums`：**读队列数**，决定了**消费端最大并发数**
  - `writeQueueNums`：**写队列数**，决定消息往几个队列里分
  - 两者一般设成一样。**写队列数 > 读队列数** 时，多出来的写队列里的消息**永远不会被消费**——这是个经典事故
- **ROUTE**：看这个 Topic 的队列分布在哪些 Broker 上
- **SEND MESSAGE**：手动发一条消息（调试神器）
- **CONSUMER MANAGER**：看这个 Topic 被哪些消费组订阅了

#### 3）Consumer（消费者）

- 看消费组的**订阅关系**、消费者实例数、每个队列的消费进度
- **`Delay` 列**：**堆积量** = 该队列总消息数 - 已消费数。这一列是监控的核心指标
- 可以在这里重置消费位点（对应 `resetOffsetByTime`）

::: danger 监控就看一个数字：Delay
消费组的 `Delay` 持续增长 = **消费堆积**，说明消费者挂了、或者消费太慢。这是生产上必须配告警的指标（比如 Delay > 10000 持续 5 分钟就告警）。
:::

#### 4）Message（消息查询）

按不同维度查消息：

| 查询方式 | 用什么 | 什么时候用 |
| --- | --- | --- |
| 按 **Topic + 时间范围** | 兜底查 | 不知道具体是哪条 |
| 按 **MessageKey** | 业务唯一 ID（订单号） | **最常用**，前提是发送时设了 `keys` |
| 按 **MessageId** | `SendResult.getMsgId()` | 拿到 msgId 时精确查 |
| 按 **UniqueKey（UNIQ_KEY）** | 系统自动生成的唯一键 | 重试消息追踪 |

::: warning 查不到消息？先检查有没有设 keys
`message.setKeys("ORDER_10086")` 这一步**必须做**。没设的话只能靠 MessageId 或扫时间范围，排查问题时非常痛苦。

这也是 01 篇强调 `Message(topic, tags, keys, body)` 四参数的原因。
:::

#### 5）Message Trace（消息轨迹）

需要先在 Broker 开 `traceTopicEnable=true`，且发送时设置了 `enableMsgTrace=true`。开了之后能看到一条消息：

```text
Producer 发送时间 / 发送耗时 / 发送状态
  ↓
Broker 存储时间 / 所在 Broker / 所在队列
  ↓
Consumer 消费时间 / 消费耗时 / 消费结果（成功 or 失败）
```

排查"消息到底丢没丢""为什么重复消费"的利器。

## 六、mqadmin 命令行速查表

`mqadmin` 在 `bin/` 目录下。先用环境变量省掉每个命令都要写 `-n`：

```bash
export NAMESRV_ADDR=127.0.0.1:9876
```

### Topic 相关

| 命令 | 作用 | 示例 |
| --- | --- | --- |
| `updateTopic` | **创建/更新 Topic** | `sh mqadmin updateTopic -n 127.0.0.1:9876 -c DefaultCluster -t OrderTopic -w 8 -r 8` |
| `topicList` | 列出所有 Topic | `sh mqadmin topicList -n 127.0.0.1:9876` |
| `topicStatus` | **看每个队列的消息数、最小/最大 offset** | `sh mqadmin topicStatus -n 127.0.0.1:9876 -t OrderTopic` |
| `topicRoute` | 看 Topic 路由（队列分布在哪台 Broker） | `sh mqadmin topicRoute -n 127.0.0.1:9876 -t OrderTopic` |
| `topicClusterList` | 看 Topic 在哪些集群上 | `sh mqadmin topicClusterList -n 127.0.0.1:9876 -t OrderTopic` |
| `deleteTopic` | 删除 Topic | `sh mqadmin deleteTopic -n 127.0.0.1:9876 -c DefaultCluster -t OrderTopic` |
| `updateTopicPerm` | 改 Topic 权限（2=禁写 4=只读 6=读写） | `sh mqadmin updateTopicPerm -n 127.0.0.1:9876 -t OrderTopic -p 6` |

`updateTopic` 常用参数：

```text
-n  NameServer 地址
-c  集群名
-t  Topic 名
-w  写队列数（writeQueueNums）
-r  读队列数（readQueueNums）
-p  权限 perm（2=禁写 4=只读 6=读写）
-o  是否有序（true/false）
```

### 消费组 / 消费者相关

| 命令 | 作用 | 示例 |
| --- | --- | --- |
| `updateSubGroup` | 创建/更新消费组 | `sh mqadmin updateSubGroup -n 127.0.0.1:9876 -c DefaultCluster -g order_consumer_group` |
| `deleteSubGroup` | 删除消费组 | `sh mqadmin deleteSubGroup -n 127.0.0.1:9876 -g order_consumer_group` |
| ★ `consumerProgress` | **看消费进度和堆积量** | `sh mqadmin consumerProgress -n 127.0.0.1:9876 -g order_consumer_group` |
| `consumerConnection` | 看这个组有哪些客户端连着 | `sh mqadmin consumerConnection -n 127.0.0.1:9876 -g order_consumer_group` |
| `consumerStatus` | 看客户端消费状态（含每个队列进度） | `sh mqadmin consumerStatus -n 127.0.0.1:9876 -g order_consumer_group -i 客户端ID` |
| ★ `resetOffsetByTime` | **按时间点重置消费位点（消息回溯）** | `sh mqadmin resetOffsetByTime -n 127.0.0.1:9876 -g order_consumer_group -t OrderTopic -s now` |

`resetOffsetByTime` 的 `-s` 参数：

```text
now                              跳到最后（丢弃堆积）
"2026-09-21#21_00_00_000"        跳到指定时间点
```

::: warning 回溯前先停消费者
重置位点时**必须先停掉消费者**，否则消费者正在消费会立刻把位点又推回去。正确顺序：
1. 停消费者应用
2. `resetOffsetByTime`
3. 重新启动消费者
:::

### 集群 / Broker 相关

| 命令 | 作用 | 示例 |
| --- | --- | --- |
| `clusterList` | **看集群：有哪些 Broker、角色、地址、TPS** | `sh mqadmin clusterList -n 127.0.0.1:9876` |
| `brokerStatus` | 看 Broker 运行时状态（含各项统计） | `sh mqadmin brokerStatus -n 127.0.0.1:9876 -b 127.0.0.1:10911` |
| `getBrokerConfig` | 看 Broker 的配置 | `sh mqadmin getBrokerConfig -n 127.0.0.1:9876 -b 127.0.0.1:10911` |
| `updateBrokerConfig` | 动态改配置（不用重启） | `sh mqadmin updateBrokerConfig -n 127.0.0.1:9876 -b 127.0.0.1:10911 -k fileReservedTime -v 72` |
| `wipeWritePerm` | 摘除 Broker 写权限（优雅下线用） | `sh mqadmin wipeWritePerm -n 127.0.0.1:9876 -b broker-a` |

### 消息查询相关

| 命令 | 作用 | 示例 |
| --- | --- | --- |
| `queryMsgById` | 按 MessageId 查 | `sh mqadmin queryMsgById -n 127.0.0.1:9876 -i 0A0B0C0D00002A9F0000000000000000` |
| `queryMsgByKey` | 按 MessageKey 查 | `sh mqadmin queryMsgByKey -n 127.0.0.1:9876 -t OrderTopic -k ORDER_10086` |
| `queryMsgByUniqueKey` | 按 UNIQ_KEY 查 | `sh mqadmin queryMsgByUniqueKey -n 127.0.0.1:9876 -t OrderTopic -i UNIQ_KEY值` |
| `queryMsgByOffset` | 按队列 offset 精确查 | `sh mqadmin queryMsgByOffset -n 127.0.0.1:9876 -t OrderTopic -b broker-a -i 0 -o 1234` |
| `sendMsgStatus` | 发一条测试消息看 RT | `sh mqadmin sendMsgStatus -n 127.0.0.1:9876 -t OrderTopic -s 1024 -c 3` |
| `statsAll` | 全局统计 | `sh mqadmin statsAll -n 127.0.0.1:9876` |

## 七、常见启动故障排查表

| 现象 | 原因 | 排查 / 解决 |
| --- | --- | --- |
| `There is insufficient memory for the Java Runtime Environment` | 默认 8G 内存不够 | 改 `runserver.sh`/`runbroker.sh` 的 `-Xms`/`-Xmx`，或设 `JAVA_OPT_EXT` |
| **★ `No route info of this topic: xxx`** | Topic 不存在 / NameServer 地址错 / `autoCreateTopicEnable=false` / `brokerIP1` 不对 | 见下方专项排查 |
| `connect to 172.17.0.x:10911 failed` | Broker 注册的是容器内网 IP | `broker.conf` 里显式配 `brokerIP1=宿主机IP` |
| `connect to <ip>:10909 failed` | VIP 通道端口没放开 | 防火墙放开 10909 和 10911；或客户端 `setVipChannelEnabled(false)` |
| `Disk space is not enough` / `TooManyRequestsException` | 磁盘空间不足或超过水位 | 清磁盘；调 `diskMaxUsedSpaceRatio`；清理旧的 CommitLog |
| Broker 起来又退出，日志里 `Address already in use` | 端口被占用 | `netstat -tunlp | grep 10911` 查是谁占了，改 `listenPort` 或杀掉 |
| Dashboard 打开是空白 / 连不上 | `namesrvAddr` 没配对 / 容器网络不通 | 进容器 `env\|grep JAVA_OPTS` 确认；宿主机 telnet 9876 试试 |
| Dashboard 能看到集群但看不到 Topic | 客户端和 Dashboard 版本差异 | 换对应版本镜像；或直接用 `mqadmin topicList` 确认 |
| `RemotingTooMuchRequestException` | 请求太密集被流控 | 调 `sendMessageThreadPoolNums`；或客户端限流 |
| 启动特别慢（几分钟） | 上次 `kill -9` 留下 `abort` 文件，走恢复流程 | 等它恢复完；下次别用 `kill -9` |
| `The broker is slave, not support` | 往 Slave 发消息了 | 检查 `brokerId`，Slave 不接受写 |

### 专项：`No route info of this topic` 四步排查

这是**新手第一大坑**，按这个顺序查：

```bash
# 第 1 步：确认 NameServer 起来了，且 Broker 注册上去了
sh mqadmin clusterList -n 127.0.0.1:9876
# 如果列表是空的 → Broker 没起来或 namesrvAddr 配错，去看 broker.log

# 第 2 步：确认 Topic 存在
sh mqadmin topicList -n 127.0.0.1:9876 | grep 你的Topic
# 如果不存在 → 要么开 autoCreateTopicEnable，要么手动创建：
sh mqadmin updateTopic -n 127.0.0.1:9876 -c DefaultCluster -t 你的Topic -w 8 -r 8

# 第 3 步：确认 Topic 的路由正常（有队列、有 Broker）
sh mqadmin topicRoute -n 127.0.0.1:9876 -t 你的Topic
# 如果 queueDatas 是空的 → Topic 建了但没分配到 Broker，重建 Topic 时 -c 集群名要写对

# 第 4 步：确认客户端能连上路由里的 Broker 地址
sh mqadmin topicRoute -n 127.0.0.1:9876 -t 你的Topic   # 看 brokerAddrs
telnet 那个IP 10911
# 不通 → brokerIP1 配错了，或者防火墙没开 10911
```

## 本篇小结

- 端口别只开 9876：**客户端收发消息走 10911（还有 VIP 通道 10909）**，9876 只是查路由。
- Docker 部署必须设 `JAVA_OPT_EXT` 降内存，否则**默认 8G** 直接起不来。
- `broker.conf` 里最关键的几个：`brokerId`（0=主）、`brokerRole`、`flushDiskType`、`fileReservedTime`、**`brokerIP1`（多网卡/Docker 必配）**。
- **生产建议关掉 `autoCreateTopicEnable`**，Topic 走显式创建，避免脏 Topic 泛滥。
- Dashboard 里最该盯的是 **Consumer 页的 `Delay` 列**（堆积量），这是必须告警的指标。
- 查消息靠 **MessageKey**，所以发消息时务必 `message.setKeys(业务唯一ID)`。
- `mqadmin` 高频命令：`clusterList`（看集群）、`topicStatus`（看队列消息数）、`consumerProgress`（看堆积）、`resetOffsetByTime`（回溯，要先停消费者）、`queryMsgByKey`（查消息）。
- **`No route info of this topic`** 按四步查：clusterList → topicList → topicRoute → telnet 10911。
- 关闭用 `mqshutdown`，**别 `kill -9`**，否则留 `abort` 文件导致下次启动要走恢复流程。
- `fileReservedTime` 别设太短（建议 ≥72 小时），否则堆积超时未消费的消息会被物理删除。

## 参考链接

- [RocketMQ 快速开始（官方）](https://rocketmq.apache.org/zh/docs/quick-start/)
- [RocketMQ 部署最佳实践](https://rocketmq.apache.org/zh/docs/bestPractice/01dployment/)
- [mqadmin 操作手册（官方）](https://rocketmq.apache.org/zh/docs/deploymentOperations/01deploy/)
- [Docker Hub apache/rocketmq](https://hub.docker.com/r/apache/rocketmq)
- [rocketmq-dashboard GitHub](https://github.com/apache/rocketmq-dashboard)
- [RocketMQ 配置文件说明](https://github.com/apache/rocketmq/blob/develop/docs/cn/best_practice.md)

下一篇 → [03 生产者与消费者原生 API](/java/middleware/rocketmq/producer-consumer)
