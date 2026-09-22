# 06 用户、组与权限

Linux 是多人多任务系统，"谁能访问什么"靠一套用户、组、权限机制来管。理解它，才能正确部署服务、给同事开账号、排查"Permission denied"。本篇从 UID/GID 与三个关键文件讲起，覆盖用户/组管理命令、sudo 提权、rwx 权限位、chmod/chown/umask、特殊权限位与 ACL，最后给出一份"安全给同事开账号"的实战清单。

## 一、用户与组的概念

- **UID**：用户 ID，数字标识；**GID**：组 ID。`root` 的 UID 是 **0**（看到 UID 0 即拥有系统最高权限）。
- 系统用户 UID 通常是 **1-999**（给服务进程用，一般不能登录）；普通用户 UID 从 **1000** 起。
- 每个用户有**主组**（创建时默认生成，GID 同 UID），可加入多个**附加组**。
- 三个关键文件：

`/etc/passwd`（每行 7 列）：

```text
  tom:x:1001:1001:Tom Zhang:/home/tom:/bin/bash
  │   │  │    │   │         │         │
  用户名 密码位  UID GID 描述   家目录    登录 shell
```

密码位早期存密码，现统一为 `x`，表示"真正密码在 `/etc/shadow`"。登录 shell 若是 `/sbin/nologin` 或 `/bin/false`，则该用户不能交互登录（常用于服务账号）。

`/etc/shadow`（9 列，只有 root 可读，存密码哈希与过期策略）：

```text
  tom:$6$盐$哈希:19000:0:99999:7:::
  │   │            │     │  │    │ │ │
  用户 密码哈希      上次改密天数 最小间隔 最大有效期 过期前警告天数
```

`/etc/group`：组名、密码位、GID、组内成员列表。

## 二、用户管理命令

```bash
# 创建用户：-u 指定 UID，-g 主组，-G 附加组，-d 家目录，-s shell，-m 建家目录
useradd -m -s /bin/bash -G wheel,dev tom

# 设密码（交互式）
passwd tom
echo "tom:123456" | chpasswd        # 非交互设密码（--stdin 在部分发行版可用）

passwd -l tom     # 锁定账号（无法登录）
passwd -u tom     # 解锁

# 改用户信息：-aG 追加附加组（关键！）
usermod -aG docker tom     # 把 tom 追加到 docker 组
# 注意：漏掉 -a 会"覆盖"原有附加组，比如 usermod -G docker tom 会把 tom 其它附加组清空，这是经典事故

userdel -r tom     # -r 连家目录一起删
id tom             # 查看 UID/GID/所属组
whoami             # 我是谁
who                # 当前登录的用户
last               # 最近登录记录
```

`su` 与 `su -` 的区别：`su tom` 只切换用户、环境变量还是当前 shell 的；`su - tom` 会**模拟一次完整登录**，加载目标用户的环境（PATH、家目录等），运维几乎永远用 `su -`。

## 三、sudo 提权

为什么不该直接用 root？一旦 root 密码泄露或误操作，后果不可挽回；用普通用户 + sudo 可以细粒度授权并留审计日志。

```bash
visudo                  # 编辑 /etc/sudoers（必须用 visudo，带语法检查，写错会导致所有人无法 sudo）
sudo -l                 # 查看当前用户被授权的 sudo 规则
sudo -i                 # 切换到 root 的登录 shell
```

`/etc/sudoers` 配置格式（逐段）：

```text
  用户/组  主机=(可切换到的用户)  命令
  tom     ALL=(ALL)            NOPASSWD: /usr/bin/systemctl restart nginx
```

- 组用 `%wheel` 表示；`NOPASSWD:` 表示免密（方便但**有安全风险**，只给必要命令）。
- 给用户加 sudo 的标准做法：把它加入 `wheel` 组（CentOS/RHEL 默认该组有 sudo 权限），或直接 drop 一个文件到 `/etc/sudoers.d/`：

  ```bash
  # 创建 /etc/sudoers.d/tom，内容：
  echo "tom ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart nginx, /usr/bin/journalctl" | sudo tee /etc/sudoers.d/tom
  sudo chmod 440 /etc/sudoers.d/tom
  ```

这样 tom 只能用 sudo 执行重启 nginx 和查日志，其它命令仍无权限。

## 四、文件权限 rwx

`ls -l` 输出首段 `-rwxr-xr-x` 共 10 位，拆解：

```text
  -    rwx   r-x   r-x
  │     │     │     │
  类型  属主u  属组g  其他o
  (d目录/-文件/l链接)
  r=读 w=写 x=执行
```

三个对象：**u** 属主、**g** 属组、**o** 其他人、**a** 全部。

**文件与目录的 rwx 含义不同**，这是核心：

```text
  文件           目录
  r 可读内容      r 可列出目录内文件名（ls）
  w 可改内容      w 可在目录内增删文件（创建/删除/改名）
  x 可执行        x 可进入该目录（cd），没有 x 连 ls 都看不全
```

反直觉的点：**能不能删除一个文件，取决于它所在目录的 w 权限，而不是文件本身的权限**。文件所有者就算把自己的文件设成 `r--`（只读），只要他对所在目录有 w，照样能删掉它。所以"保护文件不被删"要靠目录权限或特殊位（见第八节）。

## 五、chmod 的两种写法

数字法：`r=4 w=2 x=1`，三者相加。

```bash
chmod 755 file    # rwxr-xr-x：属主全权，组和其他只读+执行
chmod 644 file    # rw-r--r--：属主读写，其他只读
chmod 600 file    # rw-------：仅属主读写（密钥文件常用）
chmod 700 dir     # rwx------：仅属主可用（私目录）
chmod 777 file    # rwxrwxrwx：所有人全权（危险，见下）
```

符号法：`u/g/o/a` + `+`/`-`/`=` + `rwx`。

```bash
chmod u+x file     # 给属主加执行
chmod g-w file     # 去掉属组写
chmod o= file      # 其他人权限位清空（无任何权限）
chmod a+r file     # 所有人加读
```

常用权限对照：

```text
  644  普通文件：属主读写，他人只读
  600  私钥/敏感文件：仅属主读写
  755  可执行脚本/目录：属主全权，他人读+执行
  700  个人私目录：仅自己可用
  777  所有人全权（强烈反对！相当于把文件敞给全网）
```

> **明确反对 `chmod 777` 解决问题**：它常被人用来"消除 Permission denied"，但等于把所有访问权限放开，既不安全也掩盖了真正的归属/组问题。正确做法是用 `chown` 改归属或用 ACL 精细授权。

## 六、chown 与 chgrp

```bash
chown tom file              # 改属主
chown tom:dev file          # 同时改属主 tom、属组 dev
chown -R www:www /data/www  # -R 递归，部署目录常用
chgrp dev file              # 只改属组
```

实战：把 Nginx 静态目录归属给 web 运行用户，让服务能读、其他人不越权：

```bash
chown -R nginx:nginx /usr/share/nginx/html
chmod -R 755 /usr/share/nginx/html
```

## 七、umask 默认权限

`umask` 是"创建文件/目录时的权限掩码"，决定新文件默认是什么权限。

计算规则：文件初始权限 `666 - umask`，目录初始权限 `777 - umask`（文件默认不带 x，所以基数是 666）。

```bash
umask              # 查看当前 umask，常见 022
umask 027          # 临时改为 027（当前 shell 生效）
# 永久修改：写入 ~/.bashrc（仅当前用户）或 /etc/profile（全局）
echo "umask 027" >> ~/.bashrc
```

对照表：

```text
  umask   新建文件(666-)   新建目录(777-)
  022     644 (rw-r--r--)   755 (rwxr-xr-x)
  027     640 (rw-r-----)   750 (rwxr-x---)
  002     664 (rw-rw-r--)   775 (rwxrwxr-x)
  077     600 (rw-------)   700 (rwx------)
```

## 八、特殊权限 SUID SGID Sticky

三个特殊位：

- **SUID**（`u+s`）：普通用户执行该程序时，临时拥有**文件属主**的权限。`passwd` 命令就是典型——它要改只有 root 能写的 `/etc/shadow`，靠 SUID 让普通用户执行 `passwd` 时获得 root 权限完成改密。

  ```bash
  chmod u+s /usr/bin/passwd
  ls -l /usr/bin/passwd     # 显示 -rwsr-xr-x，属主 x 位变成 s
  ```

- **SGID**（`g+s`）：对目录生效时，目录下新建的文件**自动继承目录的属组**，团队共享目录必用（多人协作的文件始终同组，互不踢皮球）。

  ```bash
  chmod g+s /data/shared
  ```

- **Sticky**（`o+t`）：对目录生效时，用户只能删**自己**的文件，不能删别人的。`/tmp` 就是如此——谁都能写，却删不掉别人的文件。

  ```bash
  chmod o+t /tmp
  ls -ld /tmp               # 显示 drwxrwxrwt，其他 o 的 x 位变成 t
  ```

注意：若原本没有 x 权限，加上特殊位会显示**大写 S/T**（如 `rwS` `rwT`），表示特殊位生效但执行位缺失，通常意味着配置有问题。

## 九、ACL 精细授权

rwx 只能给"属主、属组、其他人"三类，不够细时上 ACL（访问控制列表）。

```bash
setfacl -m u:tom:rw file       # 单独给 tom 用户 rw 权限（不影响原有 rwx）
setfacl -m g:dev:r-x dir       # 给 dev 组 r-x
getfacl file                   # 查看 ACL 规则
setfacl -x u:tom file          # 删除某条 ACL
setfacl -R -m u:tom:rwx dir    # -R 递归
setfacl -d -m u:tom:rwx dir    # -d 设默认 ACL，目录下新建文件自动继承
```

`mask` 是 ACL 的上限，最终有效权限 = 规则与 mask 的"与"。设了 ACL 后 `ls -l` 权限位会出现 `+` 号（如 `rw-rwx---+`），提示有扩展 ACL。

## 十、实战：安全地给同事开账号

标准流程 checklist：

```bash
# 1. 建用户（指定 shell 与附加组）
sudo useradd -m -s /bin/bash -G dev tom

# 2. 设强密码（或要求对方用密钥）
echo "tom:Complex#Pass2024" | sudo chpasswd

# 3. 按需加 sudo（仅必要命令，写入 /etc/sudoers.d/）
echo "tom ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart tomapp" | sudo tee /etc/sudoers.d/tom
sudo chmod 440 /etc/sudoers.d/tom

# 4. 家目录权限收紧（仅自己可读写执行）
sudo chmod 700 /home/tom

# 5. 限制用密钥登录、禁用密码（编辑 /etc/ssh/sshd_config 或该用户的 authorized_keys）
# 在 /etc/ssh/sshd_config 设 PasswordAuthentication no（全局）或在 ~/.ssh/config 限制

# 6. 审计：查看该用户最近登录
sudo lastlog -u tom
```

清单要点：

```text
  ✓ 用 useradd -m 建家目录，shell 指定为 /bin/bash
  ✓ passwd 设强密码，或强制密钥登录禁用密码
  ✓ sudo 只授必要命令，写入 /etc/sudoers.d/ 而非乱改主文件
  ✓ 家目录 700，避免他人窥探
  ✓ 必要时用 setfacl 做精细授权，而非 chmod 777
  ✓ 最后用 lastlog / last 审计登录行为
```

## 本篇小结

- **root 的 UID 是 0**，看到 UID 0 即拥有最高权限。
- 三个关键文件：`/etc/passwd`（账号）、`/etc/shadow`（密码哈希）、`/etc/group`（组）。
- `usermod -aG` 的 `-a` 不可漏，否则会清空用户原有附加组。
- `sudo` 编辑必须用 `visudo`，写错会导致全员无法提权。
- 给 sudo 推荐 drop 文件到 `/etc/sudoers.d/`，只授必要命令。
- **rwx 对文件和目录含义不同**：目录的 w 决定能否增删文件、x 决定能否进入。
- **能否删文件取决于目录权限，而非文件本身权限**，反直觉但关键。
- `chmod` 数字法 `755`/`644`/`600`/`700` 各司其职，`777` 坚决反对。
- `chown user:group` 同时改属主属组，`-R` 递归部署目录。
- `umask` 决定新文件权限：文件 `666-umask`、目录 `777-umask`。
- SUID/SGID/Sticky 用 `u+s`/`g+s`/`o+t`，大写 S/T 表示缺 x 权限异常。
- ACL（`setfacl`/`getfacl`）突破三类人限制，做精细授权。

## 参考链接

- [Linux 用户和组管理（鸟哥私房菜）](https://linux.vbird.org/linux_basic/linux_account_110.html)
- [Arch Wiki: Users and groups](https://wiki.archlinux.org/title/Users_and_groups)
- [sudoers 手册（man7）](https://man7.org/linux/man-pages/man5/sudoers.5.html)
- [chmod 文档（GNU）](https://www.gnu.org/software/coreutils/manual/html_node/chmod-invocation.html)
- [chown 文档（GNU）](https://www.gnu.org/software/coreutils/manual/html_node/chown-invocation.html)
- [umask 说明（GNU）](https://www.gnu.org/software/coreutils/manual/html_node/umask-invocation.html)
- [ACL 管理（setfacl/getfacl）](https://man7.org/linux/man-pages/man1/setfacl.1.html)
- [Red Hat: 管理用户与权限](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/)

下一篇 → [07 软件包管理](/ops/linux/package)
