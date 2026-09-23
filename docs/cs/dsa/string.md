# 08 字符串算法

> 本篇导读：字符串匹配是搜索、生物信息、安全的基础。本篇讲清朴素匹配、KMP 的 next 数组本质、Rabin-Karp 滚动哈希，以及 Trie 前缀树的工程用法。读完你会明白：为什么朴素匹配在坏数据上会慢到 O(nm)，而 KMP 能"失配时主串不回退"做到 O(n+m)，以及工程里自动补全、敏感词过滤背后其实是同一棵 Trie。

## 一、字符串与编码

字符串本质是**字符的有限序列**。讨论匹配算法前，先把几个常被混用的概念钉死。

### 字符集与编码

- **字符集（Charset）**：字符到编号（码点 code point）的映射，如 ASCII、Unicode。
- **编码（Encoding）**：码点如何在字节里表示。定长（如 ASCII 一字符一字节、UTF-32 一字符四字节）与变长（如 UTF-8：英文 1 字节、中文 3 字节、部分表情 4 字节）之分。
- 变长编码下"第 i 个字符"不能靠 `i * 宽度` 直接定位，需顺序解码——这影响某些字符串算法的下标处理（Java `String.charAt(i)` 按 `char` 即 UTF-16 单元，代理对会拆开，处理 Unicode 需注意）。

### 前缀 / 后缀 / 子串（易混概念澄清表）

设字符串 `S = "abcde"`，三者极易混淆，用表钉死：

| 概念 | 定义 | 是否可空 | 对 `S="abcde"` 的例子 |
| --- | --- | --- | --- |
| **子串（substring）** | 连续的一段 `S[i..j]` | 是（空串） | `"bcd"`、`"a"`、`"abcde"` |
| **前缀（prefix）** | 从首字符起的子串 `S[0..i]` | 是（空串、自身） | `""`、`"a"`、`"ab"`、`"abcde"` |
| **真前缀（proper prefix）** | 前缀且不等于自身 | 否（不含自身） | `""`、`"a"`、`"ab"`、`"abcd"` |
| **后缀（suffix）** | 到末字符结束的子串 `S[i..n-1]` | 是（空串、自身） | `""`、`"e"`、`"de"`、`"abcde"` |
| **真后缀（proper suffix）** | 后缀且不等于自身 | 否（不含自身） | `""`、`"e"`、`"de"`、`"bcd"` |
| **子序列（subsequence）** | 不要求连续，删若干字符 | 是 | `"ace"`（跳过 b、d） |

关键区分：**子串必须连续，子序列可以不连续**。`"ace"` 是 `"abcde"` 的子序列但不是子串。

### 为什么单独讲字符串算法

很多"数组算法"直接套字符序列也成立，但字符串有两个特殊性让专用算法有价值：

1. **数据量巨大且重复度高**：文本、DNA 序列动辄百万字符，O(nm) 的朴素匹配在稍大输入就不可接受。
2. **可利用内部结构**：模式串自身的前缀/后缀关系（KMP）、可滚动计算的哈希（RK）等，都是"字符串独有"的可利用信息。

## 二、朴素匹配

朴素匹配（Naive / Brute-Force，BF）最直白：以主串每个位置为起点，逐位比对模式串。

### 算法过程

主串 `S`（长 n），模式串 `P`（长 m）。对 `i = 0..n-m`，检查 `S[i..i+m-1]` 是否等于 `P`：

```java
package com.canoe.string;

public class BruteForce {

    /** 返回 P 在 S 中首次出现的起始下标；未找到返回 -1。 */
    public static int search(String s, String p) {
        int n = s.length();
        int m = p.length();
        if (m == 0) return 0;

        for (int i = 0; i <= n - m; i++) {
            int j = 0;
            while (j < m && s.charAt(i + j) == p.charAt(j)) {
                j++;
            }
            if (j == m) {
                return i; // 完全匹配
            }
            // 否则 i++，主串指针回退重来
        }
        return -1;
    }
}
```

### 复杂度与最坏情况

- **时间复杂度**：最好 O(n)（首位置即匹配或首字符就失配）；**最坏 O(n·m)**。
- **最坏样例**：`S = "aaaaaaaaab"`，`P = "aaab"`。每次在 `P` 的最后一个字符才失配，主串指针回退、重新比对大量重复的 `'a'`。

```text
S: a a a a a a a a a b
P: a a a b            ← 第1轮比到第4位失配
   a a a b            ← 第2轮整体右移1，又比到第4位失配
     a a a b          ← 第3轮同理……
每次几乎都比满 m 位才失败，共约 n 轮 → O(n·m)
```

- **空间复杂度**：O(1)。
- **价值**：实现极简、无预处理、对随机文本实际很快（失配常发生在前几位），小模式或偶发匹配够用。但在"主串长+模式有重复前缀+坏数据"时不可接受——这正是 KMP 要解决的。

## 三、KMP 算法

KMP（Knuth–Morris–Pratt）的核心洞察：**失配时，已经匹配的那段前缀里藏着"下一步该从哪比"的信息，主串指针 i 根本不需要回退。**

### 核心：最长相等前后缀

设当前已匹配 `P[0..j-1]` 这段（记为已匹配前缀 `M`）。失配发生在 `P[j]`。若 `M` 有**真前缀 == 真后缀**（比如 `M="abab"`，最长相等前后缀是 `"ab"`），说明主串里那段和 `M` 后缀重合的部分，必然也等于 `M` 的前缀——于是可以直接把模式串向右"滑"到让前缀对齐，主串 `i` 不动，只把 `j` 回退到该前缀长度继续比。

```text
已匹配 M = "abab"（j=4 处失配，主串该位是 'c'）
         abab
前缀集合: a, ab, aba
后缀集合: b, ab, bab
最长相等前后缀 = "ab"（长度 2）
→ 模式串右滑，使前缀 "ab" 对齐主串刚匹配到的 "ab"
→ j 回退到 2，主串 i 不回退
```

这就是 `next[j]` 的含义：**当在 `P[j]` 失配时，下一步该用 `P[next[j]]` 去和主串当前字符比**；等价地，`next[j]` = `P[0..j-1]` 的最长相等前后缀长度。特别地 `next[0] = -1` 表示"第 0 位就失配，主串 i 要前进"。

### next 数组求法（自身匹配）

`next` 是"模式串对自己做 KMP"推出来的。用两个指针 `len`（当前最长前后缀长度，也指向下一候选）和 `i`（当前考察位）：

```java
package com.canoe.string;

public class KMP {

    /** 求 next 数组：next[i] = P[0..i-1] 的最长相等前后缀长度；next[0] = -1。 */
    private static int[] buildNext(String p) {
        int m = p.length();
        int[] next = new int[m];
        next[0] = -1;
        int len = -1; // 已匹配前后缀长度（候选前缀末尾）
        int i = 1;

        while (i < m) {
            if (len == -1 || p.charAt(i - 1) == p.charAt(len)) {
                // 关键：next[i] 是 P[0..i-1] 的最长相等前后缀长度
                // 这里用 i-1 与 len 比对，是为对齐"已匹配段"
                len++;
                next[i] = len;
                i++;
            } else {
                len = next[len]; // 回退，沿用已算出的 next
            }
        }
        // 上面的写法得到的是"标准 next"。若想要更直观的版本见下方注释变体
        return next;
    }
}
```

更直观、最常见的 `next` 递推写法（直接表达"第 j 位失配回退到哪"）：

```java
package com.canoe.string;

public class KMPNext {

    /**
     * next[j]：P 在 j 处失配时，下一步比较 P[next[j]] 与主串当前位。
     * next[0] = -1 表示模式首字符就失配，主串前进。
     */
    private static int[] buildNext(String p) {
        int m = p.length();
        int[] next = new int[m];
        next[0] = -1;
        int i = 0;   // 主串(对自己匹配而言)指针
        int j = -1;  // 模式指针 / 已匹配长度

        while (i < m - 1) {
            if (j == -1 || p.charAt(i) == p.charAt(j)) {
                i++;
                j++;
                next[i] = j; // 推 next[i]
            } else {
                j = next[j]; // 失配回退
            }
        }
        return next;
    }

    /** KMP 主匹配：主串指针 i 永不回退。 */
    public static int search(String s, String p) {
        int[] next = buildNext(p);
        int i = 0, j = 0;
        int n = s.length(), m = p.length();

        while (i < n && j < m) {
            if (j == -1 || s.charAt(i) == p.charAt(j)) {
                i++;
                j++;
            } else {
                j = next[j]; // 主串 i 不动，j 回退
            }
        }
        return j == m ? i - m : -1;
    }
}
```

### 一次匹配推进的 ASCII 图

主串 `S = "abababca"`，模式 `P = "ababc"`：

```text
第1轮：i 推进，匹配到 j=4 失配（P[4]='c' vs S[4]='a'）
S: a b a b a b c a
P: a b a b c
          ↑ j=4 失配
   next[4]=2（P[0..3]="abab" 最长相等前后缀 "ab" 长2）
   → j 回退到 2，i 不动（停在 S[4]）

第2轮：用 P[2] 与 S[4] 比
S: a b a b a b c a
P:     a b a b c
            ↑ 继续匹配 j=4，P[4]='c' vs S[4]? 这里 S[4]='a' 仍失配
   再回退 next[2]=0，最后 next[0]=-1 → i 前进
   ……最终在主串位置4处找到 "ababc" 起始于 index 4? 实际 S 无，返回-1
（示意：重点看"i 只进不退、j 靠 next 回退"）
```

真正能匹配的例子更直观：`S="ababcabc"`，`P="ababc"`，首轮即整体命中返回 0。图示重在体现 **i 永不回头** 这一 O(n+m) 的关键。

### 复杂度

- `buildNext` 自身是"模式串自我 KMP"，O(m)。
- 主匹配 `i` 只增不减、最多 +n，`j` 回退总次数被 `i` 的增量所限，O(n)。
- **总时间 O(n + m)**，且主串指针不回退，对"流式/不可回退输入"（如网络包、磁带）尤其有价值。

## 四、next 数组优化

基础 `next` 有个瑕疵：当 `P[j]` 失配且 `P[next[j]] == P[j]` 时，回退后仍拿**相同字符**去比主串同一位，必然再次失配，做了一次无效比较。

例：`P = "aaab"`，在 `j=3`（`'b'`）失配，但 `next[3]=2`（字符也是 `'a'`）。主串该位是 `'x'`，回退到 `j=2` 仍是 `'a'` 去比 `'x'`，必然再失配——白比一次。

**nextval（修正 next）**：若 `P[j] == P[next[j]]`，则 `nextval[j] = nextval[next[j]]`，直接跳到"不会重复失配"的位置：

```java
package com.canoe.string;

public class KMPNextVal {

    /** 在 buildNext 基础上求 nextval，避免连续无效比较。 */
    private static int[] buildNextVal(String p) {
        int m = p.length();
        int[] next = new int[m];
        int[] nextval = new int[m];
        next[0] = -1;
        int i = 0, j = -1;

        while (i < m - 1) {
            if (j == -1 || p.charAt(i) == p.charAt(j)) {
                i++; j++;
                next[i] = j;
            } else {
                j = next[j];
            }
        }

        nextval[0] = -1;
        for (int k = 1; k < m; k++) {
            if (p.charAt(k) == p.charAt(next[k])) {
                nextval[k] = nextval[next[k]]; // 跳过会重复失配的位置
            } else {
                nextval[k] = next[k];
            }
        }
        return nextval;
    }
}
```

收益：减少失配时的无效回退步数，最坏情况比较次数进一步收紧，对模式串含大量重复字符（如 `"aaaaa..."`）时效果明显。

## 五、Rabin-Karp

Rabin-Karp（RK）换思路：**不算字符比对，算"哈希"，靠滚动哈希让窗口右移时 O(1) 重算哈希，哈希相等再逐位验证。**

### 滚动哈希

把长度为 m 的子串看成一个"基数为 d 的数"（`d` 取字符集大小，如 256）：`hash = (c₀·d^(m-1) + c₁·d^(m-2) + ... + c_{m-1}) mod q`。

右移一格时，去掉首位 `c₀`、加入末位 `c_new`，可 O(1) 更新（不必 O(m) 重算）：

```text
旧窗口 hash(S[i..i+m-1]) = h
新窗口 hash(S[i+1..i+m]) = ( h - S[i]·d^(m-1) ) · d + S[i+m]   (mod q)
```

### 模运算防溢出与碰撞

- 直接算 `d^(m-1)` 会整数溢出，故全程 **mod q**（`q` 取大素数，如 `10^9+7`），把值限制在可表示范围。
- **哈希碰撞**：不同串可能同余。所以哈希相等时必须**再逐位比对**确认是否真匹配（伪命中处理）。
- 选两个不同素数做双哈希可进一步降低碰撞率。

```java
package com.canoe.string;

public class RabinKarp {

    private static final int D = 256;     // 字符集基数
    private static final int Q = 1000000007; // 大素数模

    public static int search(String s, String p) {
        int n = s.length(), m = p.length();
        if (m == 0 || m > n) return -1;

        long h = 1; // d^(m-1) mod q
        for (int i = 0; i < m - 1; i++) {
            h = (h * D) % Q;
        }

        long pHash = 0, wHash = 0; // 模式哈希、当前窗口哈希
        for (int i = 0; i < m; i++) {
            pHash = (D * pHash + s.charAt(i)) % Q; // 注：此处用 p 更严谨，示意
            wHash = (D * wHash + s.charAt(i)) % Q;
        }
        // 重新用 p 算模式哈希（上面示意合并，工程应分开）：
        pHash = 0;
        for (int i = 0; i < m; i++) {
            pHash = (D * pHash + p.charAt(i)) % Q;
        }

        for (int i = 0; i <= n - m; i++) {
            if (pHash == wHash) {
                // 哈希相等，逐位验证防碰撞
                boolean ok = true;
                for (int k = 0; k < m; k++) {
                    if (s.charAt(i + k) != p.charAt(k)) { ok = false; break; }
                }
                if (ok) return i;
            }
            if (i < n - m) {
                // 滚动到下一窗口
                wHash = (D * (wHash - s.charAt(i) * h % Q + Q) + s.charAt(i + m)) % Q;
            }
        }
        return -1;
    }
}
```

### 复杂度与多模式串

- **平均/最好 O(n + m)**（哈希不等直接跳，少验证）；最坏 O(n·m)（全是碰撞且每次都验证）。
- 选大素数 `q` + 双哈希，实践中碰撞极少，逼近 O(n+m)。
- **多模式串匹配一句话**：RK 的滚动哈希天然适合"一次扫描同时比对多个模式"（把多个模式的哈希放进集合，窗口哈希命中集合即查），是**多模式匹配（如敏感词批量检测）**的常用基线。

## 六、Boyer-Moore

Boyer-Moore（BM）是实际工程中常最快的算法之一，思想是**从模式串尾部往前比**，并借两条启发式大幅跳跃。

- **坏字符规则（Bad Character）**：失配时，看主串中失配的那个字符，若它出现在模式串更靠右的位置，直接把模式串滑到那里对齐；若模式串根本没有该字符，则可一下跳过整个模式长度。
- **好后缀规则（Good Suffix）**：失配后，已匹配的后缀若在模式串别处也出现，把模式串滑到让那个"好后缀"对齐的位置；否则利用"前缀==后缀"信息跳。

两者取能跳得更远的为准。BM 在**大字符集、模式较长、坏数据少**时极快，平均常优于 KMP，因为很多时候一次失配就跳过很多位。其复杂度最坏仍 O(n·m)，但工程中用"好后缀+坏字符"组合后实际表现优异（文本编辑器/ grep 类工具常用 BM 变体）。

一句话简介：**BM 是"尽量让模式串一次失配就向右跳一大步"的贪心匹配，跳跃幅度由坏字符与好后缀两条启发式共同决定。**

## 七、Trie 前缀树

Trie（前缀树 / 字典树）不为"单次匹配"，而为**多模式/前缀类查询**而生：把一组字符串按字符路径组织成一棵树，路径即词。

### 节点结构与基本操作

```java
package com.canoe.string;

import java.util.HashMap;
import java.util.Map;

public class Trie {

    static class Node {
        Map<Character, Node> children = new HashMap<>();
        boolean isEnd = false; // 到此是否构成一个完整词
    }

    private final Node root = new Node();

    /** 插入一个词：沿字符逐层建/走节点。 */
    public void insert(String word) {
        Node cur = root;
        for (char c : word.toCharArray()) {
            cur.children.putIfAbsent(c, new Node());
            cur = cur.children.get(c);
        }
        cur.isEnd = true;
    }

    /** 精确查找：词是否作为完整词存在。 */
    public boolean search(String word) {
        Node cur = root;
        for (char c : word.toCharArray()) {
            cur = cur.children.get(c);
            if (cur == null) return false;
        }
        return cur.isEnd;
    }

    /** 前缀查询：是否存在以 prefix 开头的词。 */
    public boolean startsWith(String prefix) {
        Node cur = root;
        for (char c : prefix.toCharArray()) {
            cur = cur.children.get(c);
            if (cur == null) return false;
        }
        return true; // 走到前缀末尾即可，不要求 isEnd
    }
}
```

### 一棵 Trie 的 ASCII 图

插入 `"cat"`, `"car"`, `"dog"`, `"do"`：

```text
                (root)
               /      \
            c          d
            |          |
            a          o
           / \         | \
          t   r        g  (end:do)
        (end) (end)
        cat   car         dog

查找 "car"：root→c→a→r，且 r.isEnd=true → 命中
前缀 "ca"：root→c→a 走到即可 → startsWith=true（无论是否成词）
```

- **插入/查找/前缀查询**复杂度均为 O(L)，L 为词长，与词典总大小无关（对比哈希表也 O(L) 但 Trie 额外支持前缀）。
- **空间**：最坏 O(总字符数 × 字符集大小)，可用"压缩 Trie（Radix Tree）"合并单链节点节省。

### 工程应用

- **自动补全 / 输入框联想**：`startsWith(prefix)` 找出所有以输入为前缀的词，DFS 子树收集。
- **敏感词过滤**：把敏感词建 Trie，扫描文本时沿 Trie 走，命中 `isEnd` 即拦截；多模式一次扫描，比逐个 KMP 高效。
- **路由匹配**：Web 框架（如 HTTP 路由 `<T>` 参数路径）用 Trie/压缩 Trie 存路由表，按段前缀匹配。
- **拼写检查 / 词频统计 / IP 路由表（最长前缀匹配）**：本质都是"前缀/字典"问题的变体。

## 八、字符串哈希与去重

除了匹配，哈希还常用于"字符串判等/去重/子串问题"，核心是**把子串映射成整数，O(1) 比较两个子串是否相同**。

### 多项式滚动哈希（通用）

类似 RK，把子串 `S[i..j]` 哈希为 `(cᵢ·d^(k-1) + ... + cⱼ) mod q`。预处理前缀哈希后，**任意子串哈希可 O(1) 算出**：

```text
pre[i] = 前 i 个字符的哈希
hash(i,j) = ( pre[j+1] - pre[i]·d^(j-i+1) ) mod q
```

由此两个子串是否相等 → 比哈希即可，用于：

- **Anagram 判定**：把字符出现次数编码进哈希（或排序后比对）。两串是变位词 ⇔ 字符计数向量相同。
- **最长无重复子串**：用"滑动窗口 + 已出现位置哈希/数组"记录每个字符上次下标，遇到重复就收缩左边界，`O(n)` 推进（关联 LeetCode 3）。
- **最长重复子串 / 回文**：二分答案 + 哈希判定子串相等，把 O(n²) 比对降为 O(n log n)。

一句话：**字符串哈希把"慢的比对"变成"快的整数比较"，是大量子串题目的通用加速器**（务必配合冲突验证或双哈希）。

## 九、小结对比

把本篇五种方法按"适用场景"落到一张表，便于选型：

| 算法 | 核心思想 | 时间复杂度（平均/最坏） | 预处理 | 最适用场景 |
| --- | --- | --- | --- | --- |
| **BF 朴素** | 逐位比对、失配回退 | O(n+m) / O(n·m) | 无 | 小模式、随机文本、实现求快 |
| **KMP** | 失配时主串不回退，`next` 利用相等前后缀 | O(n+m) / O(n+m) | O(m) 求 next | 单模式、流式/不可回退输入、理论稳 |
| **Rabin-Karp** | 滚动哈希，哈希相等再验证 | O(n+m) / O(n·m) | O(m) 哈希 | 多模式匹配、哈希去重、子串判等 |
| **Boyer-Moore** | 坏字符+好后缀，失配大跳 | 快 / O(n·m) 最坏 | O(m) 表 | 大字符集、长模式、工程检索（grep） |
| **Trie** | 字符路径成树，共享前缀 | O(L) 查 / O(L) | O(总字符) 建树 | 前缀查询、自动补全、敏感词、路由 |

选型口诀：

- 单模式 + 要理论稳定 O(n+m) → **KMP**。
- 一次扫描查很多模式 / 子串去重 → **Rabin-Karp**。
- 文本编辑器/搜索工具、长模式 → **Boyer-Moore** 变体。
- 自动补全 / 敏感词 / 路由 → **Trie**。
- 临时用用、数据小 → **BF**，别为了"高级"而上重武器。

## 本篇小结

- 字符串是字符序列；**子串必须连续、子序列可不连续**，前缀/后缀是"从端点起的子串"，这些定义是后续算法的语言基础。
- 变长编码（UTF-8）下字符不能按固定宽度随机定位，处理 Unicode 需注意 `char` 与码点的区别。
- **BF 朴素匹配**实现最简、无预处理，但坏数据（如全 `'a'` 串）上退化为 O(n·m)，只适合小输入。
- **KMP** 的灵魂是 `next[j]` = `P[0..j-1]` 的**最长相等前后缀长度**，失配时主串指针不回退、只靠 `next` 回退模式指针，做到稳定 O(n+m)。
- `next` 数组由"模式串自我匹配"推出，循环不变量是"已匹配长度 = 最长相等前后缀长"。
- **nextval** 修正 `P[j]==P[next[j]]` 导致的连续无效比较，对重复字符多的模式更有效。
- **Rabin-Karp** 用滚动哈希让窗口右移 O(1) 重算，哈希相等再逐位验证防碰撞；模大素数防溢出，天然适合多模式匹配。
- **Boyer-Moore** 从模式尾部比，借坏字符+好后缀两条启发式让失配时大幅右跳，大字符集长模式下工程最快。
- **Trie** 以字符路径成树，插入/查找/前缀查询均 O(L) 且与词典大小无关，是自动补全、敏感词过滤、路由匹配的核心结构。
- **字符串哈希与选型**字符串哈希把子串比对变整数比较，是 Anagram 判定、最长无重复子串等子串题的通用加速器（需配合冲突验证）；选型上稳定单模式用 KMP、多模式用 RK、长模式检索用 BM、前缀类需求用 Trie，小数据用 BF 即可。

## 参考链接

- [Knuth–Morris–Pratt algorithm - Wikipedia](https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm)
- [Boyer–Moore string-search algorithm - Wikipedia](https://en.wikipedia.org/wiki/Boyer%E2%80%93Moore_string-search_algorithm)
- [Rabin–Karp algorithm - Wikipedia](https://en.wikipedia.org/wiki/Rabin%E2%80%93Karp_algorithm)
- [Pattern Searching - GeeksforGeeks](https://www.geeksforgeeks.org/pattern-searching-set-1-naive-pattern-searching/)
- [KMP Algorithm - GeeksforGeeks](https://www.geeksforgeeks.org/kmp-algorithm-for-pattern-searching/)
- [Trie - GeeksforGeeks](https://www.geeksforgeeks.org/trie-insert-and-search/)
- [Implement strStr() - LeetCode 题目 28](https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/)
- [Introduction to Algorithms (CLRS) 第三版，第 32 章](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/)

下一篇 → [09 高级数据结构](/cs/dsa/advanced)
