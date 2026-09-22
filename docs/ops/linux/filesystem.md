# 02 文件系统与目录结构

> 本篇导读：Linux 和 Windows 最大的观感差异之一，就是"一切皆文件"和那棵统一的目录树。本篇先讲透"一切皆文件"的设计哲学，再逐目录拆解 FHS 标准目录树，重点攻克 inode 与软硬链接这两个面试高频难点，最后带你认识 /proc、/sys 这种不占磁盘的虚拟文件系统。

## 一、一切皆文件

Unix/Linux 最核心的设计思想就是：**把能操作的东西都抽象成"文件"**，这样读写设备、管道、网络套接字都可以用同一套 `open/read/write/close` 接口。这也是 Linux 下命令组合（管道 `|`）如此强大的根源。

`ls -l` 第一列的第一个字符表示文件类型，速查表如下：

| 首字符 | 类型 | 例子 |
| --- | --- | --- |
| `-` | 普通文件 | 文本、二进制、压缩包 |
| `d` | 目录（directory） | `/home` |
| `l` | 符号链接（软链接） | `java -> /usr/local/jdk17` |
| `b` | 块设备（buffer） | `/dev/sda`（硬盘，按块读写） |
| `c` | 字符设备（char） | `/dev/tty`（键盘鼠标，按字符流） |
| `p` | 管道（pipe） | 进程间通信 |
| `s` | 套接字（socket） | `/run/docker.sock`（本地通信） |

也就是说，连"打印机""网卡""进程间通道"在内核眼里都是一种文件，统一用文件接口操作。

## 二、FHS 目录树逐个讲

FHS（Filesystem Hierarchy Standard）规定了 Linux 目录该放什么。先有一张整体树：

```text
/                       根，所有目录的起点
├── bin       -> usr/bin   基础命令（ls/cp），所有用户可用
├── sbin      -> usr/sbin  管理员命令（fdisk/mkfs）
├── usr                   "Unix Software Resource"，只读的用户程序与数据
│   ├── bin              大多数用户命令
│   ├── sbin             管理员命令
│   ├── local            手动编译/安装的软件（/usr/local/bin）
│   └── lib              程序库文件
├── etc                  配置文件（核心！改服务先看这里）
├── home                 普通用户家目录（/home/alice）
├── root                 root 的家目录
├── var                  经常变化的文件：日志/缓存/数据库（/var/log）
├── tmp                  临时文件，重启可能清空
├── dev                  设备文件（内核映射出来的，不占磁盘）
├── proc                 进程与内核信息（内存里的虚拟文件系统）
├── sys                  内核设备与参数（比 /proc 更结构化）
├── opt                  第三方大型软件（如 /opt/google）
├── mnt / media          挂载点（U 盘、新磁盘）
├── boot                 内核与引导文件（vmlinuz、grub）
├── lib / lib64          系统库（/bin、/sbin 依赖）
└── run                  运行期数据（pid 文件、socket），重启清空
```

逐个说重点：

- **`/bin` vs `/usr/bin`**：早期 `/bin` 在根分区、系统修复时就能用（包含最基础的命令），`/usr/bin` 在 `/usr` 分区、是绝大多数用户命令。现代发行版（如 Ubuntu）把 `/bin` 直接软链到 `/usr/bin`，二者已合并。
- **`/sbin`**：只有管理员常用的命令（`fdisk`、`iptables`、`mkfs`），普通用户一般 PATH 里没有。
- **`/usr/local`**：**你手动 `make install` 或解压安装的软件放这里**，避免污染系统包管理器管理的 `/usr`，优先级高于 `/usr/bin`，是"自定义软件"的标准归宿（部署 JDK 时也常放 `/usr/local/jdk17`）。
- **`/etc`**：所有配置的家，`/etc/nginx/nginx.conf`、`/etc/ssh/sshd_config` 都在这，**改服务先来这里**。
- **`/var`**：日志 `/var/log`、邮件、数据库数据等"会变大的东西"，生产常单独分区，避免把根分区写满。
- **`/home` / `/root`**：家目录，用户数据放这；`~` 就指向当前用户家目录。
- **`/dev` / `/proc` / `/sys`**：都是内核暴露出来的，**不占磁盘空间**，是"看内核状态"的窗口。
- **`/tmp` / `/run`**：放临时/运行数据，重启会清，别把重要东西放这。

## 三、绝对路径与相对路径

- **绝对路径**：从 `/` 开始的完整路径，如 `/etc/nginx/nginx.conf`，无论从哪执行都对。
- **相对路径**：相对于当前目录，如 `./start.sh`、`conf/app.yml`。

几个特殊符号：

```bash
.        当前目录
..       上级目录
~        当前用户家目录（root 是 /root，普通用户是 /home/xxx）
-        上一次所在的目录
cd -     回到上一次目录（来回切很方便）
cd ~     回家目录（等价于 cd）
cd       也是回家目录
```

路径补全按 `Tab`；常见"文件不见了"其实是相对路径写错——脚本里尽量用绝对路径，或先 `cd` 到正确目录。

## 四、inode 是什么

这是理解链接、删除、磁盘满的关键。**inode（索引节点）** 是文件系统里管理文件的"元数据卡片"，**block 才是真正存文件内容的数据块**。

比喻：把一本书看成文件——**inode 是书的目录页**（记录作者、页数、出版时间、正文在第几页），**block 是正文页**。你打开书先翻目录页（inode）找到正文位置（block 指针），再去读正文。

`ls -i` 看文件的 inode 号，`stat` 看完整元数据：

```bash
ls -i /etc/hostname
# 67123456 /etc/hostname

stat /etc/hostname
#   File: /etc/hostname
#   Size: 6          Blocks: 0  IO Block: 4096   普通文件
# Device: fd00h/64768d  Inode: 67123456  Links: 1
# Access: 2024-01-01 ...  Modify: 2024-01-01 ...  Change: 2024-01-01 ...
```

关键点：**文件名不属于 inode，文件名只是目录项（dentry）到 inode 的映射**。一个目录里记着"名字 → inode 号"，所以：

- 同一个 inode 可以有多个名字（这就是硬链接）。
- 删文件 = 删目录项里的这条映射；只有当**指向该 inode 的链接数降为 0 且没有任何进程打开它**，block 才真正释放。

## 五、硬链接与软链接

在 inode 基础上就很清楚了：

```bash
ln  source  hardlink     # 硬链接：多个名字指向同一个 inode
ln -s source softlink    # 软链接：新建一个文件，内容存"指向目标的路径"
```

两种链接的指向关系：

```text
硬链接（共享同一个 inode）              软链接（自己独立的 inode）
                               
  dir ── a.txt ─┐                 dir ── softlink ──► a.txt
                ├─► [inode 100]                 (softlink 有自己 inode)
  dir ── a.hard ┘    │ block                      
                     ▼ 数据块                      
                                                  
特点：
硬链接  Links:2，删任意一个，另一个照常访问
软链接  源文件删除后变红闪烁"失效"，打开报 No such file
```

对比：

| 维度 | 硬链接 `ln` | 软链接 `ln -s` |
| --- | --- | --- |
| 跨分区/跨文件系统 | **不能** | 能 |
| 链接目录 | 不能（避免环路） | 能 |
| 源文件删除 | 不影响，数据还在 | 链接失效（悬空） |
| 占用 inode | 与原文件同一个 | 自己独立一个 |
| 可用 `ls -i` 区分 | 两文件 inode 相同 | inode 不同 |

典型用途：**软链接做版本切换**。部署 JDK 时常这样：

```bash
ln -s /usr/local/jdk-17.0.2 /usr/local/java
# 之后 PATH 里配 /usr/local/java/bin
# 升级时只需改软链接指向，不用改所有配置：
ln -sf /usr/local/jdk-21.0.1 /usr/local/java
```

## 六、文件的三个时间

`stat` 能看到三个时间，面试常问区别：

| 时间 | 全称 | 何时更新 | 含义 |
| --- | --- | --- | --- |
| atime | access time | 读取文件内容 | 最后访问时间 |
| mtime | modify time | **内容**被修改 | 数据最后改动（默认 `ls -l` 显示的就是它） |
| ctime | change time | **元数据**（权限/属主/链接数/改名）或内容变 |  inode 信息最后改动 |

关键考点：**什么操作会改 ctime 但不改 mtime？** —— 改权限、改属主、硬链接数变化、重命名（不改内容）都会改 ctime，但 mtime 不变。例如 `chmod 600 file` 后，ctime 变、mtime 不变。

`touch` 的影响：

```bash
touch a.txt         # 文件不存在则新建；存在则把 atime/mtime/ctime 都刷成现在
touch -m a.txt      # 只改 mtime（和 ctime）
touch -a a.txt      # 只改 atime（和 ctime）
touch -d "2023-01-01" a.txt   # 改到指定时间
```

## 七、挂载 mount

Linux 里**设备（硬盘、U 盘、ISO）必须挂到目录树的某个目录上才能访问**，这个动作叫挂载（mount）。挂载点原本目录里的内容会被"遮住"，卸载后恢复。

```bash
lsblk               # 看块设备与挂载情况
df -h               # 看已挂载文件系统的用量
blkid /dev/sdb1     # 看分区的 UUID 与文件系统类型

# 挂载一块新盘到 /data
mkdir -p /data
mount /dev/sdb1 /data

# 卸载（用完 U 盘务必先 umount，否则数据可能还在缓存没落盘）
umount /data
# 若提示 Device is busy，用 lsof 查谁在用：
lsof +D /data
fuser -mv /data
```

**`/etc/fstab` 开机自动挂载**，六列含义：

```text
UUID=xxxx   /data   xfs   defaults,noatime   0   0
│           │       │      │                  │   │
│           │       │      │                  │   └─ 自检顺序(0不检,1根,2其他)
│           │       │      │                  └───── dump 备份(0不用)
│           │       │      └──────────────────────── 挂载选项
│           │       └─────────────────────────────── 文件系统类型
│           └─────────────────────────────────────── 挂载点
└─────────────────────────────────────────────────── 设备(强烈建议用 UUID 而非 /dev/sdb1)
```

为什么用 UUID 不用 `/dev/sdb1`：服务器上盘序可能变（sdb 变 sda），用设备名会导致挂错分区甚至起不来，**UUID 唯一稳定**。改完 fstab 务必先测：

```bash
mount -a            # 按 fstab 重新挂载一遍，不报错再重启（否则可能开不了机）
```

## 八、虚拟文件系统 /proc 与 /sys

`/proc` 和 `/sys` **不占任何磁盘空间**，是内核把运行时状态"伪装成文件"暴露给你读写的窗口，重启即失。

常用查看入口：

```bash
cat /proc/cpuinfo            # CPU 型号、核数
cat /proc/meminfo            # 内存详情（free 命令的数据来源）
cat /proc/loadavg            # 系统负载（uptime 的数据来源）
cat /proc/version            # 内核版本
ls /proc/1/                  # 1 号进程（systemd）的所有信息：cmdline/environ/fd/status
cat /proc/1/cmdline          # 该进程启动命令
cat /sys/class/net/eth0/operstate   # 网卡是否 up（up/down）
```

`/sys` 更结构化，常用来自驱动与设备参数（如网卡速率、电源管理）。排查时这两个目录比翻命令快得多，是"看内核现场"的第一手资料。

## 本篇小结

- Linux 奉行**"一切皆文件"**，设备、管道、socket 都用统一文件接口操作。
- 文件类型看 `ls -l` 首字符：`- d l b c p s` 各有含义。
- FHS 规定目录职责，`/etc` 放配置、`/var` 放变化数据、`/usr/local` 放自装软件。
- 现代发行版 `/bin`、`/sbin` 多已软链到 `/usr/bin`、`/usr/sbin`。
- **inode 存元数据、block 存内容**，文件名只是目录项到 inode 的映射。
- 删文件只是删映射，链接数为 0 且无进程占用时 block 才真正释放。
- **硬链接共享 inode**（不能跨分区/链目录），**软链接独立 inode**（源删即失效）。
- 软链接经典用法是做版本切换（`java -> jdk17`），升级只改链接。
- 三个时间中 **ctime 改元数据也会变、mtime 只在内容变时变**，是高频面试题。
- 挂载是把设备接进目录树，开机自动挂载写在 **`/etc/fstab`**，强烈建议用 UUID。
- 改完 fstab 务必先 `mount -a` 测试，否则可能**开不了机**。
- `/proc`、`/sys` 不占磁盘，是**内核实时状态窗口**，排查首选。

## 参考链接

- [Filesystem Hierarchy Standard 官网](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html)
- [Arch Wiki - File systems](https://wiki.archlinux.org/title/File_systems)
- [Linux 中国 - inode 详解](https://linux.cn/article-8385-1.html)
- [Red Hat - 理解 Linux 链接](https://access.redhat.com/documentation/zh-cn/red_hat_enterprise_linux/)
- [The /proc Filesystem 内核文档](https://www.kernel.org/doc/html/latest/filesystems/proc.html)
- [man7.org - inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)

下一篇 → [03 文件与目录常用命令](/ops/linux/command-basic)
