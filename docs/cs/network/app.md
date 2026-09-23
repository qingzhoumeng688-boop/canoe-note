# 06 应用层核心协议

> 本篇导读：应用层直接服务用户。本篇把 DNS、HTTP、FTP、邮件、DHCP 这些天天用的协议拆开讲，DNS 解析全过程和 HTTP 请求响应模型是重点。HTTP 深入留到下一篇。

## 一、应用层模型

应用层是 OSI/TCP-IP 协议栈的最顶层，直接为应用程序提供"能对话"的规则。它不像传输层那样关心字节怎么送达，而是关心"对话说什么语言、按什么格式"。

### 1.1 三种体系结构

| 结构 | 角色 | 典型例子 | 特点 |
| --- | --- | --- | --- |
| **C/S（客户/服务器）** | 固定服务器，客户端按需连接 | Web、FTP、邮件、DNS 查询 | 服务器集中、易管理；服务器是瓶颈和单点 |
| **P2P（对等）** | 每个节点既是客户端又服务器 | BitTorrent、BT、早期电驴 | 无中心、扩展好、抗封；难管控、节点不稳定 |
| **混合** | 信令用 C/S，数据传输走 P2P | 早期 Skype、很多 IM | 兼顾可用性与去中心化 |

### 1.2 端口与复用

一台机器上同时跑着 Web、SSH、数据库，传输层靠**端口（port）**区分它们。一个 TCP/UDP 连接由"源 IP + 源端口 + 目的 IP + 目的端口"四元组唯一标识（socket 对）。

- **端口号 16 位（0~65535）**。0~1023 是**系统/知名端口**（HTTP 80、HTTPS 443、SSH 22、DNS 53）；1024~49151 是**注册端口**；49152~65535 是**临时端口（ephemeral）**，客户端随机选用。
- **复用（multiplexing）**：多个应用的数据经过同一个 IP 层发出去，靠端口区分；到达对端后再按端口分发给对应进程，这叫**分用（demultiplexing）**。

```text
应用进程 A (端口 12345)  ─┐
应用进程 B (端口 12346)  ─┼─> 传输层按 (IP, port) 复用 ─> 网络 ─> 对端按端口分用
应用进程 C (端口 12347)  ─┘
```

> 为什么需要端口？IP 只把包送到"哪台机器"，端口才把包送到"机器上的哪个进程"。没有端口，操作系统就不知道把数据交给哪个应用。

## 二、DNS

DNS（Domain Name System，域名系统）把人易记的域名（如 `www.example.com`）翻译成机器要用的 IP（如 `93.184.216.34`）。它本质上是**一个分布式的、层级化的命名数据库**。

### 2.1 域名空间结构

域名是一棵倒长的树，从右（根）到左（叶子）逐级细化：

```text
                       .   (根 root, 由 13 组根服务器管理)
                       |
        -----------------+-------------------------
        |                |                          |
      com              org                        cn    (顶级域 TLD)
        |                |                          |
   example.com      wikipedia.org               com.cn
        |                                          |
   www.example.com                              baidu.com
   (主机名)                                       (主机名)
```

| 层级 | 负责者 | 说明 |
| --- | --- | --- |
| **根（root）** | 13 个逻辑根服务器集群（字母 A~M） | 知道所有 TLD 的位置，返回 TLD 服务器地址 |
| **顶级域 TLD** | `com`/`.org`/`.cn` 等 registry | 知道该域下权威服务器的地址 |
| **权威（authoritative）** | 域名所有者配置的 DNS（如 Cloudflare、阿里云解析） | 真正持有 `www.example.com -> IP` 这条记录的服务器 |

### 2.2 递归查询 vs 迭代查询

这两个词常被混淆，关键区别在"**谁替你继续往下问**"：

| 类型 | 特点 | 谁在跑腿 |
| --- | --- | --- |
| **递归（recursive）** | 客户端只问一次，期望"最终结果是 IP" | 本地 DNS 服务器替你逐级去问 |
| **迭代（iterative）** | 每级只回"下一步该问谁"，由询问方自己接着问 | 询问方自己一级级问下去 |

实际部署里是**组合**的：你的电脑 → 本地 DNS（递归，替你跑腿） → 根/TLD/权威（都是迭代，只给"下一家地址"）。

### 2.3 一次完整的解析过程

以浏览器访问 `www.example.com` 为例：

```text
1. 浏览器缓存? 有 -> 直接用; 无 ->
2. 操作系统缓存 (hosts / getaddrinfo) ? 有 -> 用; 无 ->
3. 本地 DNS 解析器 (如 114.114.114.114, 或路由器下发的)
     3.1 问根服务器: "www.example.com 的 IP?"
         根: "我不知道, 去问 com 的 TLD 服务器 (给地址)"
     3.2 问 com TLD: "www.example.com 的 IP?"
         TLD: "去问 example.com 的权威服务器 (给地址)"
     3.3 问 example.com 权威: "www.example.com 的 IP?"
         权威: "93.184.216.34"   <-- 真正的答案
4. 本地 DNS 把结果返回浏览器, 并缓存 TTL 秒
5. 浏览器拿到 IP, 开始建 TCP 连 93.184.216.34:443
```

### 2.4 常见记录类型

| 类型 | 作用 | 示例 |
| --- | --- | --- |
| **A** | 域名 → IPv4 地址 | `www  A  93.184.216.34` |
| **AAAA** | 域名 → IPv6 地址 | `www  AAAA  2606:2800:220:1:248:1893:25c8:1946` |
| **CNAME** | 域名 → 另一个域名（别名） | `img  CNAME  cdn.example.com` |
| **MX** | 该域的邮件服务器 | `example.com  MX  10 mail.example.com` |
| **NS** | 该域的权威 DNS 服务器 | `example.com  NS  ns1.cloudflare.com` |
| **TXT** | 任意文本（SPF、域名校验用） | `example.com  TXT  "v=spf1 ..."` |
| **PTR** | IP → 域名（反向解析，邮件防垃圾常用） | `34.216.184.93.in-addr.arpa  PTR  www.example.com` |

### 2.5 DNS 缓存与 hosts 与污染

- **缓存**：每一级解析结果都按记录的 **TTL** 缓存若干秒/小时，避免每次都从头问。改 DNS 后"不生效"多半是 TTL 没过期。本地可 `ipconfig /flushdns`（Win）或 `systemd-resolve --flush-caches`（Linux）强制刷新。
- **hosts 文件**：操作系统在查 DNS **之前**先查本地 `hosts`（Win `C:\Windows\System32\drivers\etc\hosts`，Linux `/etc/hosts`）。它优先级最高，常用来做本地调试、屏蔽广告网站。
- **DNS 污染**：指解析结果被中间设备**篡改/投毒**，返回错误的 IP（常用于网络管控或劫持）。一句话记：它不是"解析慢"，而是"解析到了假地址"。

## 三、HTTP/1.1 基础

HTTP（HyperText Transfer Protocol）是 Web 的基石，运行在 TCP 之上。本篇只讲请求/响应模型与基本方法，**深入与 HTTPS/TLS 留到下一篇**。

### 3.1 请求/响应模型

HTTP 是**一问一答**的协议：客户端发一个请求报文，服务器回一个响应报文，然后通常关闭或复用连接。

```text
客户端                                  服务器
  |---- 请求行 + 请求头 + (空行) + 请求体 --->|
  |                                        |
  |<--- 状态行 + 响应头 + (空行) + 响应体 ----|
```

### 3.2 请求行与状态行

请求报文第一行是**请求行**：

```text
GET /index.html HTTP/1.1
```

格式：`方法 路径 版本`。同理响应第一行是**状态行**：

```text
HTTP/1.1 200 OK
```

格式：`版本 状态码 原因短语`。常见状态码分组：

| 范围 | 含义 | 典型 |
| --- | --- | --- |
| **1xx** | 信息/继续 | `100 Continue` |
| **2xx** | 成功 | `200 OK`、`201 Created`、`204 No Content` |
| **3xx** | 重定向 | `301 永久`、`302 临时`、`304 未修改（缓存）` |
| **4xx** | 客户端错 | `400 坏请求`、`401 未认证`、`403 禁止`、`404 不存在`、`429 限流` |
| **5xx** | 服务端错 | `500 内部错`、`502 网关坏`、`503 不可用`、`504 网关超时` |

### 3.3 常见方法

| 方法 | 语义 | 有 body | 幂等 | 说明 |
| --- | --- | --- | --- | --- |
| **GET** | 获取资源 | 否 | 是 | 只取不改，参数放 URL（有长度限制、会进历史/日志） |
| **POST** | 提交/新建 | 是 | 否 | 提交表单、上传、触发处理 |
| **HEAD** | 同 GET 但只返回头 | 否 | 是 | 常用于探测资源是否存在、查看大小/类型而不下载 |

> 幂等：多次执行结果一致（GET 多次拿同一页无副作用；POST 多次提交可能下多笔单）。这个性质对重试很重要——幂等操作可以安全重发。

### 3.5 常见请求头与响应头

头字段是 HTTP 的"元数据"，理解它们能读懂一半的 Web 行为。请求头由客户端发，响应头由服务器回。

**请求头（客户端 → 服务器）：**

| 头字段 | 作用 | 示例 |
| --- | --- | --- |
| `Host` | 指明目标虚拟主机（同一 IP 上多个域名靠它区分） | `Host: www.example.com` |
| `User-Agent` | 客户端身份（浏览器/爬虫/App） | `Mozilla/5.0 (Windows)...` |
| `Accept` | 我能接收的媒体类型 | `text/html, application/json` |
| `Accept-Encoding` | 支持的压缩 | `gzip, br` |
| `Authorization` | 凭证（Bearer Token / Basic） | `Authorization: Bearer xxx` |
| `Cookie` | 携带服务端下发的状态 | `Cookie: sid=abc123` |
| `Content-Type` | 请求体的格式 | `application/json; charset=utf-8` |
| `Content-Length` | 请求体字节数 | `Content-Length: 256` |

**响应头（服务器 → 客户端）：**

| 头字段 | 作用 | 示例 |
| --- | --- | --- |
| `Content-Type` | 返回体的媒体类型 | `text/html; charset=utf-8` |
| `Content-Length` | 返回体长度 | `Content-Length: 1024` |
| `Set-Cookie` | 下发 Cookie（带 `HttpOnly`/`Secure`/`SameSite`） | `Set-Cookie: sid=abc; HttpOnly` |
| `Cache-Control` | 缓存策略 | `max-age=3600, public` |
| `ETag` | 资源版本指纹，配合 304 判新鲜度 | `"33a64b"  ` |
| `Location` | 重定向目标（3xx 时用） | `Location: /login` |
| `Server` | 服务器软件（常被故意隐藏） | `nginx` |
| `Connection` | 是否保持连接 | `keep-alive` / `close` |

> `Connection: keep-alive` 是 HTTP/1.1 默认行为：一条 TCP 连接上串行复用多次请求/响应，省去反复三次握手的 RTT。但它是"串行"的，容易因一个慢响应堵住后续（队头阻塞）——这正是 HTTP/2 用多路复用、HTTP/3 换 QUIC 要解决的。

### 3.4 无状态与 Cookie 铺垫

HTTP 本身**无状态**：服务器不记得"上一个请求是谁"。这简化了服务器，但也意味着"登录状态"无法靠协议自带。解决办法是应用层带一个"身份凭证"——最早就是 **Cookie**（服务器通过 `Set-Cookie` 下发，浏览器后续请求自动带上）。下一篇会展开 Cookie、Session、以及为什么 HTTP/2、HTTPS 要这么设计。

## 四、FTP

FTP（File Transfer Protocol）用于在两台机器间传文件，特点是**用两个独立的 TCP 连接**。

| 连接 | 端口 | 作用 | 特点 |
| --- | --- | --- | --- |
| **控制连接** | 21 | 发命令、收应答（USER/PASS/LIST/RETR…） | 全程保持，不传文件数据 |
| **数据连接** | 20（主动）或随机（被动） | 真正传文件内容/目录列表 | 每传一次可能新建一条 |

### 4.1 主动模式 vs 被动模式

这是 FTP 最常被问的坑，区别在于**数据连接由谁发起**：

```text
主动模式 (PORT):
  客户端控制端口 N ---命令---> 服务器 :21
  客户端监听 N+1
  服务器 :20  ---主动连---> 客户端 N+1   (服务器主动连客户端)

被动模式 (PASV):
  客户端 ---发 PASV 命令---> 服务器 :21
  服务器回: "来连我的端口 P"
  客户端 ---连---> 服务器 :P   (客户端主动连服务器)
```

| 模式 | 数据连接发起方 | 客户端在防火墙/NAT 后 | 服务端在防火墙后 |
| --- | --- | --- | --- |
| **主动** | 服务器 → 客户端 | 容易被客户端防火墙挡（入站被拒） | 较友好 |
| **被动** | 客户端 → 服务器 | 友好（出站通常放行） | 需服务器开放一段被动端口区间 |

现代环境多在 NAT/防火墙后，**被动模式（PASV）是默认且更稳的选择**；主动模式常因客户端防火墙拦截入站而失败。

### 4.2 常用 FTP 命令

控制连接上发的是人可读的命令（明文），常见：

| 命令 | 含义 |
| --- | --- |
| `USER` / `PASS` | 提交账号密码 |
| `LIST` | 列目录（走数据连接） |
| `RETR 文件` | 下载（retrieve） |
| `STOR 文件` | 上传（store） |
| `CWD 目录` | 切换工作目录 |
| `PASV` | 进入被动模式，等服务器给端口 |
| `PORT h,h,h,h,p,p` | 主动模式，告知服务器连自己的 IP:端口 |
| `QUIT` | 退出 |

> FTP 的明文特性（账号密码、文件内容都明文）是它逐渐被 **SFTP（跑在 SSH 上，端口 22）/ FTPS（FTP over SSL）** 取代的原因。今天传文件优先用 SFTP，而非裸 FTP。

## 五、电子邮件

邮件系统由几个不同协议拼起来，先发后收、各管一段。

### 5.1 SMTP 发信

SMTP（Simple Mail Transfer Protocol，RFC 5321）负责**把信从发件人送到收件人邮件服务器**（服务器之间也是它）。它只管"投递"，端口 25（明文）/465 或 587（加密提交）。

```text
发件人 MUА (Outlook/网页) --SMTP提交(587)--> 发件方 MTA
发件方 MTA --SMTP(25)--> 收件方 MTA (按收件域 MX 记录找)
收件方 MTA 把信存进收件人邮箱
```

`MUA`=邮件客户端，`MTA`=邮件传输代理（如 Postfix、Exchange）。SMTP 本身是"推"模型，不负责用户怎么把信取回本地。

### 5.2 POP3 与 IMAP 收信区别

收信有两条路，这是选型关键：

| 维度 | **POP3** | **IMAP** |
| --- | --- | --- |
| 默认端口 | 110（明文）/995（SSL） | 143（明文）/993（SSL） |
| 邮件存放 | 下载到本地后**通常删除服务端** | 邮件**留在服务器**，本地只是缓存视图 |
| 多设备同步 | 差（手机下了，电脑就没了） | 好（多端状态、文件夹、已读同步） |
| 适合场景 | 单设备、想本地归档 | 多设备、随时查、服务端为主 |

一句话：**IMAP 是"云端邮箱的窗口"，POP3 是"把信搬回家"**。现在几乎所有现代邮箱（Gmail、Outlook、QQ 邮箱）都默认推荐 IMAP。

### 5.3 MIME

早期邮件只能发 ASCII 文本。MIME（Multipurpose Internet Mail Extensions，RFC 2045）扩展了它：在邮件头里用 `Content-Type: text/html`、`multipart/mixed`、Base64 编码等，支持中文、HTML 正文、附件、图片。注意 MIME 是"内容格式标准"，收发仍走 SMTP/POP3/IMAP。

## 六、DHCP

DHCP（Dynamic Host Configuration Protocol）让设备**插上网线/连上 Wi-Fi 就自动拿到 IP**，免去手动配置。它基于 UDP，服务器端口 67、客户端端口 68。

### 6.1 四步交互（DORA）

```text
客户端 (无 IP, 源 0.0.0.0)              服务器
  |                                       |
  | 1) DHCP Discover (广播, 端口 67) --->|
  |<-- 2) DHCP Offer (广播/单播, 含可用 IP) -|
  |                                       |
  | 3) DHCP Request (广播, "我要这个IP")->|
  |<-- 4) DHCP Ack (确认, 含租约/网关/DNS) -|
  |                                       |
  | 客户端配置 IP、子网掩码、网关、DNS    |
```

| 步骤 | 报文 | 含义 |
| --- | --- | --- |
| **D**iscover | 广播"谁是 DHCP 服务器？" | 客户端还没有 IP，只能广播找服务器 |
| **O**ffer | 服务器回"我给你 IP x，租约 y 秒" | 可能多台服务器都回，客户端选第一个 |
| **R**equest | 客户端广播"我选 x，请确认" | 仍广播，是为了**通知其他服务器"我没用你们给的"** |
| **A**ck | 服务器确认，附带网关、DNS、租期 | 客户端正式可用 |

### 6.2 为什么用广播

客户端**一开始连 IP 都没有**，更不知道服务器在哪，所以它只能用**受限广播地址 `255.255.255.255`**（或 `0.0.0.0` 作源）发包，让同网段所有主机都能收到，DHCP 服务器再回应。这也是为什么 DHCP 通常只在"同一广播域"内工作——跨网段要靠 **DHCP 中继代理（relay agent）** 帮忙转发。

### 6.3 租约与续租

IP 不是永久白给，有**租期（lease time）**。客户端到期前会自动续租，避免 IP 被回收：

```text
租期 T:
  到 50% T: 客户端发 DHCP Request (单播) 请求续租 -> 服务器 Ack 则租期重置
  到 87.5% T: 若前面没成功, 改广播 Request 续租
  到 100% T: 仍失败 -> 释放 IP, 回到 Discover 重新申请
```

好处：设备离开网络后 IP 自动回收，地址池可循环复用；设备一直在线则"无感续租"，IP 不变。

## 七、万维网与 URL

"万维网（WWW）"是用 URL 互相链接、用 HTTP 传输、用 HTML 展现的超文本系统，和"互联网"不是一回事——互联网是底层网络，WWW 是跑在上面的一层应用。

### 7.1 URL 结构

一个 URL（统一资源定位符）拆开看：

```text
https://   www.example.com  :443  /path/to/page?q=1  #section
  │            │                │        │              │
scheme       host            port     path           fragment
(协议)      (主机/域名)     (端口)   (资源路径)      (锚点)
```

| 部分 | 说明 | 默认 |
| --- | --- | --- |
| **scheme** | 用哪个协议（http/https/ftp…） | — |
| **host** | 域名或 IP | — |
| **port** | 服务器端口 | http=80, https=443 |
| **path** | 服务器上的资源路径 | `/` |
| **query** | `?` 后的键值参数 | 无 |
| **fragment** | `#` 后页面内锚点，不发往服务器 | 无 |

### 7.2 代理 / 缓存 / CDN（一句话）

- **代理（Proxy）**：客户端和服务器之间的"中间人"，可用来翻越限制、做访问控制、匿名（正向代理）或隐藏源站（反向代理如 Nginx）。
- **缓存（Cache）**：把响应存在靠近用户的地方（浏览器/CDN/代理），命中就不回源，大幅提速降费，靠 `Cache-Control`/`ETag`/`304` 协调新鲜度。
- **CDN（内容分发网络）**：把静态资源复制到全球边缘节点，用户就近取，既快又抗峰；本质是"分布式的缓存 + 调度"。

## 八、其他常用协议

### 8.1 SSH vs Telnet

| 维度 | **Telnet** | **SSH** |
| --- | --- | --- |
| 端口 | 23 | 22 |
| 加密 | 无（明文，密码可被嗅探） | 有（密钥交换 + 加密通道） |
| 认证 | 明文账号密码 | 密码 / 公钥 |
| 现状 | 基本淘汰，仅老设备应急 | 远程管理事实标准 |

一句话：**Telnet 是明信片，SSH 是加密信件**。今天远程登服务器一律 SSH，Telnet 只在没有加密需求的极老旧设备上偶尔出现。

### 8.2 NTP 时间同步

NTP（Network Time Protocol，端口 123/UDP）让全网机器**时钟对齐到统一标准时间（UTC）**。为什么重要：

-  HTTPS/TLS 证书校验依赖"当前时间"在有效期内，时钟偏差大会导致握手失败。
-  分布式系统（数据库主从、日志、事务）靠时间戳排序与判定，时钟漂移会引发数据错乱、脑裂。
-  日志审计、监控、计费都需要统一时间轴才能对得齐。

客户端向 NTP 服务器（如 `pool.ntp.org`、内网 `chrony`/`ntpd` 服务器）请求带时间戳的包，双方交换后估算网络延迟并修正本地时钟，把误差压到毫秒甚至亚毫秒级。

## 九、URL 编码与国际化域名

你以为 URL 里能随便放中文和空格？不行。URL 只允许一小部分 ASCII 字符"裸奔"，其他都要转义。

### 9.1 百分号编码（Percent-Encoding）

规则：非安全字符用 `%` + 两位十六进制表示其在 UTF-8 下的字节。例如：

| 原始 | 编码后 | 说明 |
| --- | --- | --- |
| 空格 | `%20`（或 `+` 在 query 里） | 空格不能直接出现 |
| 中文"中" | `%E4%B8%AD` | UTF-8 下"中" = `E4 B8 AD` 三字节 |
| `?` `&` `=` | `%3F` `%26` `%3D` | 这些在 query 里是保留字，要当数据传就得编码 |
| `/` | `%2F` | 路径分隔符，要当数据传也编码 |

实战：前端 `encodeURIComponent()` 做百分号编码，后端框架（如 Java `URLDecoder`、Python `urllib.parse.unquote`）再解码。漏编码最常见的 bug 是"参数里带了 `&` 把 query 截断"，或"中文变乱码"。

### 9.2 中文域名（Punycode）

浏览器地址栏能输中文域名（如 `例子.中国`），但 DNS 只认 ASCII。于是有了 **Punycode（RFC 3492）**：把 Unicode 域名编码成 `xn--` 开头的 ASCII 串。例如 `例子.中国` 会被转成 `xn--fsqu00a.xn--fiqs8s` 再去查 DNS。这个过程对用户在地址栏透明，由浏览器/解析库自动完成。

## 十、应用层安全与隐私演进

本篇协议大多是"明文设计"，现代网络给它们逐一补上安全层。

| 机制 | 解决什么 | 说明 |
| --- | --- | --- |
| **DNSSEC** | DNS 响应被篡改/伪造 | 给 DNS 记录加数字签名，验证"这条解析确实是权威者发的"，但**不加密**内容 |
| **DoH（DNS over HTTPS）** | 防止 DNS 查询被窃听/劫持 | DNS 请求走 443，混在普通 HTTPS 流量里，ISP 看不到你查了啥域名 |
| **DoT（DNS over TLS）** | 同上，但走专用 853 端口 | 与 DoH 目的一样，只是没"伪装成网页流量" |
| **HTTPS** | HTTP 明文被窃听/篡改 | 在 HTTP 与 TCP 之间插一层 TLS，下一篇专讲 |

一句话理解演进顺序：**先有明文协议（DNS/HTTP 都是），被发现会被窃听篡改，于是要么给协议本身加密（DoT/DoH、HTTPS），要么给内容加签名防伪（DNSSEC）**。为什么 HTTPS 这么重要——因为明文 HTTP 下，同一局域网的任何人都能抓到你的 Cookie、密码、表单，进而劫持会话。下一篇会展开 TLS 握手如何既协商密钥又不让中间人得逞。

## 十一、电子邮件安全：SPF / DKIM / DMARC

邮件系统天生容易被伪造发件人（SMTP 不验证"你真的是你声称的那个邮箱"），于是三层机制补身份：

| 机制 | 验证维度 | 原理一句话 |
| --- | --- | --- |
| **SPF** | IP 是否授权 | 收件方查发件域的 DNS `TXT`，看连接来源 IP 是否在允许列表 |
| **DKIM** | 内容是否篡改 | 发件方用私钥给邮件签名，收件方用 DNS 里的公钥验签 |
| **DMARC** | 前两者策略 + 对齐 | 告诉收件方"SPF/DKIM 不过怎么办（拒收/ quarantine/放行）"，并出报告 |

三者配合：SPF 管"谁能用这个域名发"，DKIM 管"内容没被改"，DMARC 把策略和执行对齐。这也是为什么你现在很难伪造 `boss@bigcompany.com` 发钓鱼信——除非攻击者同时拿下对方域名解析或邮件服务器。

## 十二、端口速查与解析排障

### 12.1 常用应用层端口速查

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| 20/21 | FTP | 数据/控制 |
| 22 | SSH | 安全远程 Shell |
| 23 | Telnet | 明文远程（淘汰） |
| 25 | SMTP | 服务器间发信 |
| 53 | DNS | 域名解析（UDP 为主，大响应转 TCP） |
| 67/68 | DHCP | 自动分配 IP |
| 80 | HTTP | 明文 Web |
| 110/995 | POP3 | 收信（明文/SSL） |
| 143/993 | IMAP | 收信（明文/SSL） |
| 443 | HTTPS | 加密 Web |
| 465/587 | SMTP | 提交发信（SSL/STARTTLS） |
| 123 | NTP | 时间同步 |

### 12.2 排障命令

DNS 解析是最高频的故障点，几个立即能用的命令：

```bash
# Windows 查解析结果和用哪台 DNS
nslookup www.example.com
ipconfig /all | findstr "DNS"

# Linux/macOS：更现代，显示用哪个服务器、耗时、全过程
dig +trace www.example.com
dig www.example.com A +short        # 只看 IPv4 结果
drill www.example.com AAAA          # 看 IPv6

# 清缓存后再测
systemd-resolve --flush-caches      # Linux
ipconfig /flushdns                  # Windows

# 看邮件路由（MX 记录）
dig example.com MX +short
```

> 排障顺序：先 `dig` 看解析对不对（是 DNS 问题还是服务端问题），再 `ping`/`telnet 主机 端口` 看通不通，最后才怀疑应用层。很多人一上来就怪代码，其实 `telnet www.example.com 443` 连不上就已经说明是网络/防火墙问题。

## 十三、面试速答

| 问题 | 一句话答案 |
| --- | --- |
| DNS 递归和迭代区别？ | 递归：本地 DNS 替你跑腿问到底；迭代：每级只给"下一家地址" |
| 一次完整 DNS 解析经过哪些？ | 浏览器缓存→hosts→本地 DNS→根→TLD→权威 |
| CNAME 是什么？ | 域名的别名，指向另一个域名（不能和 MX/NS 同名为同记录共存） |
| HTTP 无状态怎么补？ | 应用层用 Cookie/Session/Token 携带状态 |
| GET 和 POST 区别？ | GET 取、参数在 URL、幂等；POST 交、参数在 body、非幂等 |
| FTP 主动被动区别？ | 数据连接由谁发起：主动=服务器连客户端，被动=客户端连服务器 |
| POP3 和 IMAP 区别？ | POP3 把信搬本地、多端不同步；IMAP 信留服务器、多端同步 |
| DHCP 为什么用广播？ | 客户端还没 IP、不知道服务器在哪，只能广播找 |
| SSH 为什么取代 Telnet？ | Telnet 明文、密码可被嗅探；SSH 全程加密 |
| NTP 为什么重要？ | HTTPS 校验、分布式时序、日志对账都依赖统一时钟 |

## 十四、各应用层协议跑在 TCP 还是 UDP 上

回到传输层：同样是"应用层协议"，底层选 TCP 还是 UDP 差别很大，这张表把本篇串起来：

| 协议 | 传输层 | 为什么这么选 |
| --- | --- | --- |
| HTTP / HTTPS | TCP | 要可靠、有序、完整，网页丢一个字节就坏 |
| FTP | TCP | 文件传输不容错 |
| SMTP / POP3 / IMAP | TCP | 邮件不能丢、不能乱序 |
| SSH / Telnet | TCP | 交互式远程，要可靠 |
| DNS | **UDP 为主，大响应转 TCP** | 单次查询小、要快；响应超 512 字节（EDNS 更大）或区传送用 TCP 保证完整 |
| DHCP | UDP | 客户端还没 IP，只能广播，且要极简 |
| NTP | UDP | 时间同步对延迟敏感，偶尔丢包可下次补 |
| TFTP | UDP | 极简文件传输，自己轻量重传 |
| QUIC（HTTP/3） | UDP | 在 UDP 上自建可靠+拥塞控制，规避 TCP 队头阻塞 |

规律：**要可靠/完整 → TCP；要快/能忍丢/或自己管可靠 → UDP**。DNS 是个"混合派"——日常小查询用 UDP 省 RTT，只有应答太大或需要可靠（区传送 AXFR）才用 TCP。

## 十五、从敲下网址到看到页面：全栈串联

把本篇和前几篇串成一次完整访问，你能看清各层怎么接力：

```text
1. 浏览器输入 https://www.example.com
2. 应用层 DNS: 解析 www.example.com -> 93.184.216.34  (本篇第二节)
3. 传输层 TCP: 与 93.184.216.34:443 三次握手建连      (上篇 TCP)
4. 安全层 TLS: 握手协商密钥 (下篇深入)                  (下篇)
5. 应用层 HTTP: 发 GET / HTTP/2 请求, 带 Host/Cookie
6. 传输层: 请求按 TCP 分段、滑动窗口、拥塞控制发出去
7. 网络层 IP: 路由寻址; 链路层: 帧封装/ARP 找 MAC
8. 服务器反向过程: TCP 收齐 -> TLS 解密 -> HTTP 处理 -> 回 200 + HTML
9. 浏览器: 解析 HTML, 里面引用的 css/js/图片 -> 再次走 2~8 步拉取
10. 渲染: 像素上屏, 你能看到了
```

每一步出问题表现不同：

| 卡在哪 | 现象 |
| --- | --- |
| DNS（第 2 步） | 浏览器一直"正在解析主机"，最终 `DNS_PROBE_FINISHED` |
| TCP 握手（第 3 步） | 连接超时，页面打不开 |
| TLS（第 4 步） | `ERR_SSL_*` 证书错误或握手失败 |
| HTTP（第 5 步） | 能连上但返回 4xx/5xx |
| 渲染（第 10 步） | 白屏/样式错，但网络其实通了 |

> 这张串联图也是排障索引：用户说"网页打不开"，先判断卡在 DNS、TCP、TLS 还是 HTTP 哪一层，再用对应工具（dig / telnet / 浏览器控制台）定点排查，而不是笼统地"重启试试"。

## 十六、动手配置：改 hosts 与指定 DNS

理论落地到本机，两个最常改的地方就是 `hosts` 和 DNS 服务器。

### 16.1 改 hosts 做本地劫持/调试

`hosts` 在 DNS 之前生效，适合把某个域名临时指向测试服务器、或屏蔽广告域名。

```text
# Windows: C:\Windows\System32\drivers\etc\hosts
# Linux/macOS: /etc/hosts
# 格式: IP  域名  (每行一条)
127.0.0.1   localhost
192.168.1.20  api.example.com      # 把 api 指向内网测试机
0.0.0.0     ads.tracking.com      # 屏蔽广告域名
```

注意：Windows 下改 `hosts` 需要**以管理员身份**保存；改完浏览器可能还读旧结果，记得清 DNS 缓存（`ipconfig /flushdns`）。

### 16.2 指定 DNS 服务器

默认 DNS 是路由器下发的（通常是运营商的）。想用更快/更隐私的，可手动指定：

| 公共 DNS | 地址 | 特点 |
| --- | --- | --- |
| Google DNS | `8.8.8.8` / `8.8.4.4` | 全球快，但查询可能被 Google 看到 |
| Cloudflare | `1.1.1.1` | 主打隐私，承诺不记录 |
| 阿里 DNS | `223.5.5.5` | 国内速度快 |
| 腾讯 DNSPod | `119.29.29.29` | 国内速度快 |

Windows 改法：网卡属性 → IPv4 → 手动填 DNS；Linux 改 `/etc/resolv.conf`（写 `nameserver 1.1.1.1`）；macOS 在系统设置里填。改完用 `dig www.example.com` 验证是否走了新服务器。

> 结合第十节：若你关心隐私，选支持 DoH/DoT 的解析器或浏览器设置（Chrome/Firefox 可在设置里开启"安全 DNS"），让查询内容也加密，避免被局域网/运营商窥探。

## 十七、常见误区澄清

几个本篇最容易混淆的点，单独拎出来：

- **"互联网 = WWW"**：错。互联网是底层网络（IP），WWW 只是跑在上面、用 HTTP+HTML 的一层应用；Email、FTP、游戏都不属于 WWW，但都属于互联网。
- **"DNS 只用 UDP，所以不可靠"**：日常小查询用 UDP（快），但应答超阈值、区传送、重试场景会用 TCP，整体仍可靠。
- **"DHCP 分配的 IP 是永久的"**：错，有租期，到期续租，设备离开后回收；否则地址池早耗尽。
- **"POP3 比 IMAP 先进"**：恰恰相反。POP3 是"搬回家"，多设备不同步；IMAP 是"云端窗口"，现代首选。
- **"关掉 Cookie 就完全匿名"**：Cookie 只是状态载体之一；服务端还能用 Token、指纹、IP 关联你，关 Cookie 只是少了一种。
- **"HTTPS = HTTP + 加密，仅此而已"**：它还包含身份认证（证书证明对方是真站点）和完整性（防篡改），下篇展开。
- **"FTP 和 SFTP 是一回事"**：FTP 是 21 端口明文协议；SFTP 是 SSH 子系统（端口 22），两者协议完全无关，只是名字像。

## 十八、协议在分层模型中的位置

把本篇所有协议放回 TCP/IP 与 OSI 模型，建立整体地图，方便和下一篇、以及前面的网络层/传输层笔记对应：

| 协议 | TCP/IP 层 | OSI 层 | 底层传输 | 在本篇哪节 |
| --- | --- | --- | --- | --- |
| HTTP / HTTPS | 应用层 | 应用层(7) | TCP | 三、十、十五 |
| FTP / SFTP | 应用层 | 应用层(7) | TCP | 四 |
| SMTP / POP3 / IMAP | 应用层 | 应用层(7) | TCP | 五 |
| DNS | 应用层 | 应用层(7) | UDP/TCP | 二 |
| DHCP | 应用层 | 应用层(7) | UDP | 六 |
| SSH / Telnet | 应用层 | 应用层(7) | TCP | 八 |
| NTP | 应用层 | 应用层(7) | UDP | 八 |
| TLS（下篇） | 应用层与传输层之间 | 表示层(6) | TCP | 下篇 |

记忆锚点：**凡是"用户直接感知、带端口号、跑在 TCP/UDP 之上"的，几乎都在应用层**。本篇是网络栈离你最近的一层；再往下分别是传输层（TCP/UDP，上篇）、网络层（IP，路由）、链路层（以太网/ARP），它们共同托起本篇这些协议。

## 本篇小结

- **应用层**直接服务程序，靠**端口**区分进程，靠 socket 四元组（IP+port×2）标识一条连接。
- **三种结构**：C/S（集中易管）、P2P（去中心）、混合；复用/分用靠端口实现。
- **DNS** 是层级分布式命名库，树形结构 = 根 → TLD → 权威；递归由本地 DNS 跑腿，迭代各级只给下一家。
- **完整解析**：浏览器缓存 → 系统/hosts → 本地 DNS → 根 → TLD → 权威，结果按 TTL 缓存。
- **记录类型**：A(IPv4)/AAAA(IPv6)/CNAME(别名)/MX(邮件)/NS(权威)/TXT(SPF 等)/PTR(反向)。
- **HTTP/1.1** 是一问一答模型，请求行 `方法 路径 版本`、状态行 `版本 状态码 原因`；GET/POST/HEAD 最常用，协议无状态需 Cookie 补。
- **FTP** 用两条连接：控制 21 + 数据连接；被动模式（客户端连服务器）在现代 NAT 环境下更稳。
- **邮件**：SMTP 发信（推）、POP3 把信搬本地、IMAP 云端窗口多端同步、MIME 解决中文/附件。
- **DHCP** 四步 DORA 自动分配 IP，起步用广播因客户端尚无 IP，IP 有租期并自动续租回收。
- **URL** 由 scheme/host/port/path/query/fragment 组成；代理、缓存、CDN 是 Web 提速与管控的三件套；SSH 取代明文 Telnet，NTP 保证全网时钟一致。

## 参考链接

- [RFC 1034 - Domain Names: Concepts and Facilities](https://www.rfc-editor.org/rfc/rfc1034)
- [RFC 1035 - Domain Names: Implementation and Specification](https://www.rfc-editor.org/rfc/rfc1035)
- [RFC 2616 - HTTP/1.1](https://www.rfc-editor.org/rfc/rfc2616)
- [RFC 2131 - Dynamic Host Configuration Protocol](https://www.rfc-editor.org/rfc/rfc2131)
- [RFC 5321 - Simple Mail Transfer Protocol](https://www.rfc-editor.org/rfc/rfc5321)
- [Wikipedia - Domain Name System](https://en.wikipedia.org/wiki/Domain_Name_System)
- [Cloudflare - What is DNS?](https://www.cloudflare.com/learning/dns/what-is-dns/)
- [MDN Web Docs - HTTP overview](https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview)

下一篇 → [07 HTTP/HTTPS 深入与 TLS](/cs/network/https)
