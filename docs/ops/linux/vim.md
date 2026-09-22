# 05 Vim 编辑器

服务器上几乎没有图形界面，改配置、看日志、写脚本全靠终端里的编辑器。Vim 是 Linux 运维的"标配肌肉记忆"——学会它，你在任何一台机器上都能高效改文件。本篇讲透三模式、光标移动、增删改查、末行命令、分屏与 vimrc 配置，最后专门聊聊"怎么退出 Vim"这个全网梗背后的真痛点。

## 一、为什么必须会 Vim

- 服务器无 GUI，`nano` 太弱、`emacs` 不默认装，**Vim 几乎一定在**。
- 关系：`vi` 是原始版本，`vim` = Vi IMproved（增强版，多了语法高亮、多级撤销等），现在多数系统里 `vi` 就是 `vim` 的别名。
- 一旦远程连上服务器排障，不会 Vim 寸步难行。投资半天练熟，回本极快。

## 二、三种模式

Vim 的核心是"模式"，新手最大的困惑就是"为什么敲不出字 / 为什么输入变成了命令"——本质是没搞清楚当前在哪个模式。

```text
                    i / a / o / I / A / O
   命令模式(Normal) ───────────────────────▶ 输入模式(Insert)
        ▲                                      │
        │ Esc                                  │ Esc
        │                                      ▼
        └──────────────────────────────── 输入模式回到命令模式
   命令模式(Normal) ─────── : ──────────────▶ 末行模式(Command-line)
        ▲                                      │
        │ 回车/Esc 返回                         │
        └──────────────────────────────── 末行模式回到命令模式
```

- **命令模式（Normal）**：打开文件后的默认模式，按键是"命令"不是"文字"，用来移动、删除、复制。
- **输入模式（Insert）**：真正打字的地方。从命令模式按 `i`（当前光标前）、`a`（光标后）、`o`（下方新行）、`I`（行首）、`A`（行尾）、`O`（上方新行）进入。
- **末行模式（Command-line）**：在命令模式按 `:` 进入，用来保存、退出、查找替换、执行外部命令。
- 任何模式按 `Esc` 都回到命令模式（连按两下 `Esc` 更稳）。

进入输入模式的各键区别：

```text
  i  在光标前插入        a  在光标后插入
  I  在行首插入          A  在行尾插入
  o  在下方新建一行插入   O  在上方新建一行插入
```

## 三、光标移动

```text
  基础移动：  h 左   j 下   k 上   l 右
  单词级：    w 下一个词首   b 上一个词首   e 词尾
  行内：      0 行首（第一列）   ^ 行首第一个非空字符   $ 行尾
  全文：      gg 文件第一行   G 文件最后一行   :n 跳到第 n 行
  翻页：      Ctrl+f 下翻一屏   Ctrl+b 上翻一屏
  匹配：      % 在配对的 () [] {} 间跳转
```

移动速查表：

```text
  h/j/k/l   左/下/上/右
  w/b/e     词首/词首(反向)/词尾
  0 /^ /$   行首/行首非空/行尾
  gg / G    文件头/文件尾
  :行号     跳到指定行
  Ctrl+f/b  下翻/上翻
  %         括号配对跳转
```

## 四、编辑：删除 复制 粘贴

```bash
# 删除
x        删除光标处字符
dw       删除一个词
dd       删除整行
d$       删除到行尾
dG       删除到文件尾
d3d 或 3dd  删除 3 行

# 复制（yank）
yw       复制一个词
yy       复制整行
y$       复制到行尾
3yy      复制 3 行

# 粘贴
p        在光标后/下一行粘贴
P        在光标前/上一行粘贴

# 撤销重做
u       撤销
Ctrl+r   重做

# 重复（Vim 精髓）：. 重复上一次修改操作
# 例如 dd 删一行后按 . 再删一行，比 2dd 更灵活

# 替换
r        替换光标处一个字符
R        进入替换模式，覆盖输入
cw       改一个词（删掉并进入输入模式）
cc       改整行

# 可视模式（块选择）
v        字符可视
V        行可视
Ctrl+v   列块可视（批量注释妙用：Ctrl+v 选列 → I# Esc 给多行加 # 注释）
```

寄存器概念：默认粘贴用的是无名寄存器，也可 `"ayy` 复制到 a 寄存器、`"ap` 粘贴 a 寄存器，实现多段内容分别暂存。

## 五、查找与替换

```bash
/pattern    向下查找（如 /error）
?pattern    向上查找
n           跳到下一个匹配
N           跳到上一个匹配
*           光标所在单词，直接查找下一个

:set hlsearch       " 高亮所有匹配
:set incsearch      " 输入时实时跳到匹配

# 末行替换
:%s/old/new/g        " 全文替换（g=每行所有，缺省只换首个）
:%s/old/new/gc       " c=逐个确认（y 替换 n 跳过 a 全部 q 退出）
:10,20s/old/new/g    " 只替换 10 到 20 行
:s/old/new/          " 仅当前行
```

正则捕获组替换（`\1` 引用分组）：

```bash
# 把 "name: tom" 改成 "tom: name"
:%s/name:\s*\(\w\+\)/\1: name/g
```

## 六、末行模式常用命令

```bash
:w          保存
:q          退出（有未保存改动会提示）
:q!         强制退出，丢弃改动
:wq         保存并退出
:x          保存并退出（与 :wq 区别：:x 在没有改动时不会更新 mtime，:wq 总会刷新）
:w!         强制写入只读文件（配合 sudo tee 技巧，见下）
:e!         重新加载文件，丢弃当前未保存改动
:set nu     显示行号
:set nonu   关行号
:set paste  进入粘贴模式（粘贴代码不乱缩进的关键！）
:set nopaste 退出粘贴模式
:!command   在 Vim 里执行外部命令（如 :!ls）
:r !command 把外部命令的输出读入当前文件（如 :r !date 插入当前时间）
```

只读文件强制保存技巧（和 shell 里 `sudo tee` 同理）：

```bash
# 打开系统文件后发现没权限保存
:w !sudo tee %     " % 代表当前文件名，借助 sudo tee 提权写入
```

## 七、分屏与多文件

```bash
:sp  file           " 横向分屏打开 file
:vsp file           " 纵向分屏打开 file
Ctrl+w h/j/k/l      " 在分屏间切换（左下上右）
Ctrl+w =            " 等分窗口大小
Ctrl+w o            " 只保留当前窗口

:e  file            " 在当前窗口打开另一文件
:ls                 " 列出缓冲区（已打开的文件列表）
:bn / :bp           " 下一个 / 上一个缓冲区
:bd                 " 关闭当前缓冲区
```

缓冲区（buffer）概念：Vim 打开的文件都放在缓冲区里，`:bn`/`:bp` 在它们之间切换，比反复 `:e` 退出再打开高效。

## 八、vimrc 配置

一份带注释的 `~/.vimrc`（用户级，只影响自己）：

```vim
" 基础显示
set nu                  " 显示行号
syntax on               " 开启语法高亮
set hlsearch            " 搜索高亮
set incsearch           " 增量搜索

" 缩进（4 空格，替代 Tab）
set tabstop=4
set shiftwidth=4
set expandtab           " 输入 Tab 自动转成空格
set autoindent          " 自动沿用上一行缩进

" 编辑体验
set paste               " 手动 :set paste 防粘贴乱缩进（或在插入模式 Ctrl+Shift+v 前开启）
set showcmd             " 右下角显示已输入命令
set ruler               " 显示光标位置
set mouse=a             " 允许鼠标（终端支持时）

" 括号补全
inoremap ( ()<Left>
inoremap { {}<Left>
inoremap [ []<Left>

" 主题（需终端支持 256 色）
colorscheme desert
```

全局配置在 `/etc/vimrc`，对所有用户生效；用户级的 `~/.vimrc` 优先级更高，会覆盖全局同名设置。推荐把个人习惯放 `~/.vimrc`，不动系统文件。

## 九、Vim 练手与退出

`vimtutor` 是官方自带的交互教程，约 20 分钟走完就能上手，强烈推荐：

```bash
vimtutor        # 打开官方教程，跟着做一遍
```

**专门讲"怎么退出 Vim"**：新手卡住大多是因为误入了某模式，记住万能退出法——

```text
  1. 连按 Esc 回到命令模式
  2. 输入 :q!   强制退出（丢弃改动）
     或   :wq   保存并退出
     或   ZZ    命令模式下直接保存退出（大写 Z 按两下）
```

如果按 `Ctrl+Z` 把 Vim 挂起到了后台（它其实还在跑，只是回终端了），用 `fg` 把它调回前台继续编辑，**别以为关了终端就行**——`fg` 回来再正常 `:wq`。

## 本篇小结

- Vim 三模式：**命令模式 / 输入模式 / 末行模式**，靠 `Esc` 回命令模式。
- 进入输入模式 `i a o I A O` 各有插入位置差异，记住 `i` 最常用。
- 移动核心 `hjkl`，行内 `0 ^ $`，全文 `gg`/`G`，跳行 `:n`。
- 删除 `d`、复制 `y`、粘贴 `p`；`u` 撤销、`Ctrl+r` 重做。
- **`.` 重复上次操作是 Vim 精髓**，批量修改效率倍增。
- 列块可视 `Ctrl+v` 可批量注释/编辑多行。
- 查找 `/` `?`，替换 `:%s/old/new/g`，`c` 逐个确认。
- `:x` 与 `:wq` 区别在是否刷新 mtime，无改动用 `:x` 更稳。
- 粘贴代码前 `:set paste`，否则缩进会乱套。
- 分屏 `:sp`/`:vsp`，窗口切换 `Ctrl+w` 方向键。
- 卡住退出：先 `Esc` 再 `:q!`（丢弃）或 `:wq`（保存）。

## 参考链接

- [Vim 官方文档](https://www.vim.org/docs.php)
- [vimtutor 在线版（Open Vim）](https://www.openvim.com/)
- [Vim 交互教程（Vim Adventures 之外）](https://vim-adventures.com/)
- [Vim Tips Wiki](https://vim.fandom.com/wiki/Vim_Tips_Wiki)
- [菜鸟教程：Vim 教程](https://www.runoob.com/linux/linux-vim.html)
- [vimrc 示例配置（GitHub）](https://github.com/amix/vimrc)
- [man7: vim(1)](https://man7.org/linux/man-pages/man1/vim.1.html)
- [为什么 Vim 用 hjkl 移动（历史）](https://catonmat.net/why-vim-uses-hjkl)

下一篇 → [06 用户、组与权限](/ops/linux/user-permission)
