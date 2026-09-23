# 04 哈希表

> 本篇导读：哈希表是"平均 O(1)"查找的魔法。本篇讲清哈希函数设计、冲突的链地址/开放寻址解法、负载因子与扩容，以及 HashMap 背后的实现，破解"为什么哈希表这么快又偶尔慢"。

## 一、哈希表思想

数组的随机访问是 O(1)，但前提是"下标就是整数且连续"。现实里我们要查的 key 往往是字符串、对象、自定义类型——它们不能直接当下标。哈希表（Hash Table / 散列表）做的事，就是**造一座桥，把任意 key 映射成一个整数下标**，从而复用数组的 O(1) 访问。

```text
      key           哈希函数           数组下标          存/取值
   "apple"  --hash()-->  37  --取模-->   [ 37 ]  <-- O(1) 直接落位
   "banana" --hash()--> 102  --取模-->   [102 ]
```

### 1.1 以空间换时间

哈希表的本质哲学是**用额外的空间换查找时间**：它维护一个数组（叫"桶数组 / bucket array"），理想情况下每个 key 都有专属格子，查找、插入、删除都只要算一次下标、跳一次数组。

| 结构 | 查找 | 插入 | 删除 | 备注 |
| --- | --- | --- | --- | --- |
| 数组（已知下标） | O(1) | O(1) | O(1) | 下标受限 |
| 链表 | O(n) | O(1) | O(1) | 要遍历 |
| 平衡 BST | O(log n) | O(log n) | O(log n) | 有序 |
| **哈希表（理想）** | **O(1)** | **O(1)** | **O(1)** | **靠哈希映射** |

### 1.2 理想与现实的差距

理想 O(1) 有个前提：**每个 key 落到不同下标**。但下标范围有限、key 无穷多，不同 key 算出同一个下标是必然的（见第三节"鸽巢原理"）。这个"撞车"叫**哈希冲突**。哈希表设计的核心，就是**如何让冲突可控、让平均代价仍接近 O(1)**。所以"O(1)"前面一定要加"平均"二字。

## 二、哈希函数

哈希函数 `hash(key)` 接过任意 key，吐出一个整数（通常再取模得到数组下标）。它的好坏直接决定冲突率，从而决定性能。

### 2.1 常见构造方法

**取模法（除法散列）**：`index = hash(key) % capacity`，最常用。关键是**容量取质数**（或与 key 分布互质），避免 key 的某些规律被 capacity 整除后集中到少数桶。

```text
key=12345, capacity=16  ->  12345 % 16 = 9   -> 桶[9]
key=12345, capacity=17  ->  12345 % 17 = 1   -> 桶[1]   (质数容量分布更匀)
```

**乘法散列**：`index = floor( capacity * ( (key * A) % 1 ) )`，A 取 `0.618...`（黄金分割相关）。好处是对 capacity 不敏感，不需要是质数。

**折叠 / 平方取中**：把 key 拆成几段相加（折叠），或先平方再取中间几位（平方取中），用来打散 key 各个位的贡献。

### 2.2 好哈希函数的三个要求

| 要求 | 含义 | 为什么重要 |
| --- | --- | --- |
| **确定性** | 同一 key 永远得到同一 hash | 否则存进去取不出来 |
| **高效** | 计算要快，最好 O(1) | 哈希本身不能成为瓶颈 |
| **均匀** | 输出在桶间尽量均匀分布 | 直接决定冲突少不少 |

还有一条隐含要求：**相似的 key 也要尽量散开**。比如 `"user1"`、`"user2"` 不能只差一个桶，否则冲突扎堆。

### 2.3 Java HashMap 的 hash 扰动

Java 8 `HashMap` 不是直接拿 `key.hashCode()` 取模，而是先对 hashCode 做**扰动**：`h = key.hashCode(); h = h ^ (h >>> 16)`，把高 16 位与低 16 位异或混合，再与 `(capacity-1)` 做位与。这样能让 hashCode 高位的变化也参与下标计算，**当 capacity 较小时也能减少冲突**。一句话：**HashMap 用 `hashCode ^ (hashCode >>> 16)` 做扰动，再用 `& (n-1)` 代替取模定位桶**。

### 2.4 为什么容量常取 2 的幂：位与代替取模

很多哈希表（Java `HashMap`、Go `map`）把桶数组容量设为 2 的幂，原因很实际：**当 capacity 是 2 的幂时，`hash % capacity` 等价于 `hash & (capacity - 1)`**，而位与是单条 CPU 指令，比除法 / 取模快得多。

| capacity | capacity-1（二进制） | 定位方式 |
| --- | --- | --- |
| 16 | `1111` | `hash & 15` |
| 32 | `11111` | `hash & 31` |
| 64 | `111111` | `hash & 63` |

代价是：纯位与取模对 hashCode 的低位敏感，若 key 的 hashCode 低位有规律（比如全是偶数），冲突会扎堆——这正是 2.3 节"扰动"要解决的：把高位信息揉进低位，再位与，分布就均匀了。所以"2 的幂容量 + 扰动 + 位与"是一套配套工程方案。下面用一段代码演示扰动 + 位与定位：

```java
package cn.canoe.dsa.hash;

public class HashIndex {
    /** 模仿 HashMap：扰动 + 位与定位桶（capacity 必须是 2 的幂）。 */
    static int indexFor(int h, int capacity) {
        return (h ^ (h >>> 16)) & (capacity - 1);
    }

    public static void main(String[] args) {
        int capacity = 16;
        String key = "apple";
        int idx = indexFor(key.hashCode(), capacity);
        System.out.println("key=" + key + " -> bucket " + idx);
    }
}
```

## 三、冲突

### 3.1 冲突必然存在：鸽巢原理

鸽巢原理（抽屉原理）说：把 `n+1` 只鸽子放进 `n` 个抽屉，**必有至少一个抽屉装了 ≥2 只**。类比哈希表：key 的空间（无穷）远大于桶的数量（有限），所以**只要 key 数超过桶数，冲突在数学上就不可避免**——不存在"完全无冲突"的哈希表，只能把冲突率压低、把冲突处理掉。

```text
桶只有 5 个：  [0] [1] [2] [3] [4]
要放 6 个 key： 必然有某桶 >= 2 个   <- 鸽巢原理
```

所以工程上不追求"零冲突"，而追求两件事：**冲突少（好哈希函数）+ 冲突后能高效处理（链地址 / 开放寻址）**。

### 3.2 两种主流解法

| 解法 | 思路 | 代表 |
| --- | --- | --- |
| **链地址法（Separate Chaining）** | 每个桶挂一条链表 / 树，冲突的 key 串在一起 | Java HashMap、C++ `unordered_map` |
| **开放寻址法（Open Addressing）** | 冲突就按规则在数组里找下一个空位 | Python dict（探测）、ThreadLocalMap |

### 3.3 链地址 vs 开放寻址怎么选

| 维度 | 链地址法 | 开放寻址法 |
| --- | --- | --- |
| 装载率上限 | 可超过 1（一桶多元素） | 必须 < 1（数组不能满） |
| 删除 | 简单（摘链） | 需墓碑，较复杂 |
| 缓存局部性 | 节点分散，较弱 | 连续内存，较好 |
| 对聚集敏感 | 不敏感 | 敏感（需双重哈希缓解） |
| 典型实现 | Java HashMap、C++ `unordered_map` | Python dict、ThreadLocalMap |

经验法则：**内存充裕、增删频繁、要简单删除 → 链地址；内存紧张、查询为主、追求缓存 → 开放寻址**。

## 四、链地址法

每个桶不直接存 value，而是存一个**链表头（或树根）**，所有落到同一桶的 key-value 串在这条链上。

```text
桶数组：
  [0] -> null
  [1] -> ("a",1) -> ("x",9)      <- a、x 冲突，串在同一条链
  [2] -> ("b",2)
  [3] -> null
  [4] -> ("c",3) -> ("d",4) -> ("y",7)
```

查找时：`index = hash(key)`，再沿桶对应的链遍历比较 key（先用 `==`/equals，再比对 value）。插入尾部或更新已有 key，删除摘节点。

### 4.1 Java 8 之前与之后

- **Java 7 及之前**：桶里是纯**链表**。冲突严重时某条链很长，查找退化为 O(n)。
- **Java 8 起**：当链表长度 **≥ 8** 且桶数组容量 **≥ 64** 时，链表**转为红黑树**；当树节点数 **≤ 6** 时又退化为链表。这样即使极端冲突，最坏查找也被拉回 O(log n)。

### 4.2 退化为 O(n) 的条件

链地址法最坏情况：所有 key 都算出同一个下标，整张表退化成一条链表，查找 O(n)。触发条件是**哈希函数极差或遭遇哈希碰撞攻击（见第九节）**。正常情况下因为分布均匀 + 扩容 + 树化，退化几乎不会发生。

链地址法优缺点：

| 优点 | 缺点 |
| --- | --- |
| 冲突只是加长链，不会互相覆盖 | 链表指针有额外内存开销 |
| 删除简单（摘节点即可） | 节点分散，Cache 不如开放寻址 |
| 装载度高时仍稳健 | 链过长退化（靠树化缓解） |

### 4.3 手写一个链地址哈希表（Java 骨架）

下面用一个最简实现把"哈希函数 + 取模 + 链表串接"串起来，体会 `HashMap` 的雏形：

```java
package cn.canoe.dsa.hash;

import java.util.LinkedList;

/** 链地址法哈希表（仅演示 put/get，容量固定、不扩容）。 */
public class ChainHashMap {
    static class Node {
        int key;
        String val;
        Node(int k, String v) { key = k; val = v; }
    }

    private final LinkedList<Node>[] buckets;
    private final int capacity;

    @SuppressWarnings("unchecked")
    ChainHashMap(int capacity) {
        this.capacity = capacity;
        this.buckets = new LinkedList[capacity];
        for (int i = 0; i < capacity; i++) buckets[i] = new LinkedList<>();
    }

    private int idx(int key) {
        return Math.floorMod(key, capacity); // 取模保证下标落在 [0, capacity)
    }

    void put(int key, String val) {
        LinkedList<Node> chain = buckets[idx(key)];
        for (Node n : chain) {                // 已有 key 则更新
            if (n.key == key) { n.val = val; return; }
        }
        chain.addLast(new Node(key, val));    // 否则挂到链尾
    }

    String get(int key) {
        for (Node n : buckets[idx(key)]) {
            if (n.key == key) return n.val;
        }
        return null;                          // 没找到
    }
}
```

要点：`idx(key)` 用 `Math.floorMod` 把负数 key 也收进合法范围；`put` 先遍历链查重再挂尾；`get` 沿链线性找。真实 `HashMap` 在此基础上加了**扰动、扩容、树化**，但骨架就是这三步。

## 五、开放寻址法

开放寻址法不另开链表：**所有元素都住在桶数组里**，某个桶被占就按探测序列找下一个空桶。

```text
插入 c：hash(c)=1，但桶[1]已被 a 占
  -> 线性探测：看 [2] 空 -> 放进 [2]
桶数组：
  [0]      [1]=a    [2]=c    [3]
```

### 5.1 三种探测方式

| 探测方式 | 下一个位置公式 | 特点 |
| --- | --- | --- |
| **线性探测** | `(h + i) % capacity`，i=1,2,3... | 简单，但易产生**一次聚集** |
| **二次探测** | `(h + i^2) % capacity` | 缓解一次聚集，但可能**二次聚集** |
| **双重哈希** | `(h1 + i*h2(key)) % capacity` | 用第二个哈希打散，聚集最轻、最均匀 |

### 5.2 聚集（Clustering）问题

线性探测最大的坑是**聚集**：一旦某段桶连续被占，新元素会"贴"着这片已占区域往后排，形成越来越长的连续占用块，进一步加剧冲突，查找变慢。二次探测缓解了但仍有"二次聚集"（同 hash 的 key 走同一探测序列）。**双重哈希**用与 key 相关的第二个哈希决定步长，聚集最轻，是最优的开放寻址策略。

### 5.3 删除用墓碑标记

开放寻址法删除不能简单"把桶清空"，否则会**切断后续元素的探测链**——本来要绕道找的元素会误以为"不存在"。解决方法是放一个**墓碑（tombstone）标记**：查找时墓碑视为"曾有过、但可跳过继续探测"，插入时墓碑位可复用。

```text
删除 a（线性探测场景）：
  删除前: [1]=a [2]=c
  直接清空会丢 c 的探测链 -> 错误!
  正确做法: [1]=墓碑 [2]=c   查找仍会越过墓碑找到 c
```

### 5.4 手写线性探测（Java 骨架）

对照链地址，开放寻址把元素都塞进同一个数组，冲突就往后找空位：

```java
package cn.canoe.dsa.hash;

/** 线性探测哈希表（固定容量、用墓碑标记删除）。 */
public class LinearProbingMap {
    private final Integer[] keys;
    private final String[] vals;
    private final int capacity;

    LinearProbingMap(int capacity) {
        this.capacity = capacity;
        this.keys = new Integer[capacity];
        this.vals = new String[capacity];
    }

    private int idx(int key) {
        return Math.floorMod(key, capacity);
    }

    void put(int key, String val) {
        int i = idx(key);
        while (keys[i] != null) {            // 线性探测：往后找空位
            if (keys[i] == key) { vals[i] = val; return; }
            i = (i + 1) % capacity;
        }
        keys[i] = key;
        vals[i] = val;
    }

    String get(int key) {
        int i = idx(key);
        while (keys[i] != null) {
            if (keys[i] == key) return vals[i];
            i = (i + 1) % capacity;
        }
        return null;                         // 探测到空位说明不存在
    }
}
```

注意 `get` 遇到"空位"就停——这正是删除必须用墓碑的原因：若直接置 `null`，探测链被截断，原本在更后面的 key 就查不到了。

## 六、负载因子与扩容

### 6.1 负载因子

**负载因子（load factor）`α = 元素数 / 桶容量`**。它衡量表"满"的程度，是触发扩容的开关。

| α 大小 | 含义 | 后果 |
| --- | --- | --- |
| 很小（如 0.25） | 表很空 | 空间浪费，但冲突少 |
| 适中（如 0.75） | 平衡 | 时间与空间折中 |
| 很大（接近 1+） | 表很满 | 冲突暴增，查找退化 |

### 6.2 扩容与 rehash

当 `α` 超过阈值（Java HashMap 默认 `0.75`），就**扩容**：通常把容量 **×2**（保持为 2 的幂，便于位与定位），然后**把所有元素重新哈希（rehash）散列到新桶数组**。

```text
扩容前 capacity=4, 元素 3 个, α=0.75
插入第 4 个 -> α 将超阈值 -> 触发扩容
扩容后 capacity=8, 重新计算每个 key 的新下标, 数据搬过去
```

Java 扩容关键细节：因为容量是 2 的幂，rehash 时每个元素**要么留在原下标，要么搬到"原下标 + 旧容量"**，不需要重新算 hashCode，只需看高位一位即可，非常高效。

### 6.3 扩容代价均摊

单次扩容要把 n 个元素全部 rehash，代价 O(n)，看起来很贵。但因为扩容是**倍增**的（capacity 翻倍），每个元素**平均只被 rehash 常数次**，把一次扩容的代价**均摊**到它之前的所有插入上，均摊成本仍是 O(1)。这正是"均摊分析"的经典例子：偶尔一次贵操作，长期看每次插入还是 O(1)。

## 七、哈希表性能

### 7.1 平均 vs 最坏

| 操作 | 平均（链地址，α 合理） | 最坏（全冲突） |
| --- | --- | --- |
| 查找 | O(1) | O(n)（链地址）/ O(n)（开放寻址聚集） |
| 插入 | O(1) | O(n) |
| 删除 | O(1) | O(n) |

"平均 O(1)"成立的前提：**哈希函数均匀 + 负载因子受控**。一旦这两点被破坏（极差哈希或攻击），就会跌到 O(n)。

### 7.2 哈希表 vs 树

| 维度 | 哈希表 | 平衡 BST（如红黑树） |
| --- | --- | --- |
| 平均查找 | O(1) | O(log n) |
| 最坏查找 | O(n) | O(log n)（稳定） |
| 是否有序 | 否 | 是（中序有序） |
| 范围查询 | 不支持（要全扫） | 天然支持 |
| 内存 | 有空桶浪费 | 紧凑（仅指针开销） |
| 扩容 | 需要 rehash | 不需要 |

一句话取舍：**要极速单点查、不关心顺序，选哈希表；要顺序遍历 / 范围查询 / 稳定最坏性能，选树**。所以 `HashMap` 快但不保证顺序，`TreeMap` 慢一点但 key 有序。

### 7.3 均摊分析：一次扩容 O(n)，为什么每次还是 O(1)

假设容量从 1 开始按 2 倍增长，依次插入 n 个元素。第 k 次扩容发生在元素数达到 `2^k` 时，要 rehash `2^k` 个元素。累计 rehash 工作量：

```text
第1次扩容 rehash: 1
第2次扩容 rehash: 2
第3次扩容 rehash: 4
...
第m次扩容 rehash: 2^m
总 rehash ≈ 1 + 2 + 4 + ... + n/2  <  n   (等比数列求和)
```

也就是说，n 次插入的**累计 rehash 代价 < n**，平均到每次插入仅 **< 1 次操作**——这就是"均摊 O(1)"。单次插入可能偶发地触发一次 O(n) 扩容，但长期平均被完全摊薄，所以工程上仍说哈希表插入是 O(1)。

## 八、字符串哈希

字符串哈希把"一整段字符串 / 子串"浓缩成一个整数，常用于**子串比较、查重、模式匹配**。

### 8.1 Rabin-Karp 滚动哈希

核心思想：把字符串当成一个**基数进制的数**（如把字符当 256 进制或按字符 ASCII），对大质数取模，得到哈希值。关键技巧是**滚动**：窗口从 `s[i..i+m-1]` 滑到 `s[i+1..i+m]` 时，可以**用上一个哈希 O(1) 推出下一个**，不必重新算整个窗口。

```text
字符串 "ABCD"，窗口长 m=2，基数 b=256，模 p
hash("AB") = (A*b + B) % p
hash("BC") = ( (hash("AB") - A*b^(m-1)) * b + C ) % p   <- 滚动推出，O(1)
```

```java
package cn.canoe.dsa.hash;

/** Rabin-Karp 滚动哈希：判断 pattern 是否出现在 text 中。 */
public class RabinKarp {
    static final int BASE = 256;
    static final int MOD = 1000000007;

    boolean contains(String text, String pat) {
        int n = text.length(), m = pat.length();
        if (m > n) return false;
        long hPat = 0, hTxt = 0, power = 1;
        for (int i = 0; i < m - 1; i++) power = (power * BASE) % MOD;
        for (int i = 0; i < m; i++) {
            hPat = (hPat * BASE + pat.charAt(i)) % MOD;
            hTxt = (hTxt * BASE + text.charAt(i)) % MOD;
        }
        if (hTxt == hPat && text.regionMatches(0, pat, 0, m)) return true;
        for (int i = m; i < n; i++) {
            // 滑窗：去掉最高位、加入新字符
            hTxt = (hTxt - text.charAt(i - m) * power % MOD + MOD) % MOD;
            hTxt = (hTxt * BASE + text.charAt(i)) % MOD;
            if (hTxt == hPat && text.regionMatches(i - m + 1, pat, 0, m)) return true;
        }
        return false;
    }
}
```

> 注意哈希可能**碰撞**（不同串同 hash），所以哈希相等后还要 `regionMatches` 做一次真实字符比对，避免误判。

### 8.2 前缀哈希与滚动应用

若预先算出字符串每个前缀的哈希，则**任意子串 `s[l..r]` 的哈希可在 O(1) 推出**（类似区间和的差分思想）。这让"判断两子串是否相等""找最长重复子串"变成 O(1) 查询 + 预处理。

应用一句话：**字符串哈希 + 滚动窗口**广泛用于重复子串检测、文档相似度 / 抄袭（plagiarism）检测、以及把长文本指纹化成定长整数做快速比对。LeetCode 上"最长重复子串""找出变位词"等题都吃这套。

### 8.3 多项式哈希与模数选择

字符串哈希常写成"多项式哈希"：`H(s) = (s[0]*b^(L-1) + s[1]*b^(L-2) + ... + s[L-1]) % p`。选基数 `b`（如 257）和**大质数模数 `p`**（如 `10^9+7`）能在极大概率上避免碰撞。两个实现风险要注意：

- **溢出**：中间项可能超过 `int` 范围，必须用 `long` 并在每步取模防止溢出（见 8.1 的 `MOD` 常量）。
- **碰撞**：单个模数仍有小概率碰撞，更稳的做法是用**双模数**（两个不同质数各算一次），两哈希同时相等才算匹配，进一步压低碰撞概率。

这套思路是许多"字符串快速比较"题的工程基线。

## 九、应用与坑

### 9.1 常见应用

- **HashSet 去重**：`add` 一个元素前先 `contains` 判重，平均 O(1)，比排序去重 O(n log n) 快。
- **缓存（Cache）**：用 key 快速命中数据，如本地缓存、Memoization 记忆化递归。
- **索引 / 字典**：语言内置的 `dict`、`map`、`object` 属性表底层多半是哈希表。
- **数据库哈希索引**：等值查询极快（但无范围查询能力，故多配合 B+ 树）。

### 9.2 一致性哈希（分布式）

普通哈希 `server = hash(key) % N` 在**扩缩容（N 变化）**时会让几乎所有 key 重新映射，导致海量数据迁移、缓存雪崩。

**一致性哈希**把服务器和 key 都映射到一个**环形哈希空间（0 ~ 2^32）**，key 顺时针找最近的服务器。这样**增减一个节点只影响环上相邻的一小段数据**，其余 key 映射不变，把迁移量从 O(n) 降到 O(n/N)。

```text
普通取模：N 2->3，key 几乎全重映射（灾难）
一致性哈希环：
   keyA --顺时针--> Node1
   keyB --顺时针--> Node2
   新增 Node3 只"截走"环上一小段，其余 key 不动
```

一句话：**一致性哈希通过哈希环 + 顺时针查找，让分布式扩缩容时只需迁移少量数据**，是 Redis 集群、一致性缓存分片的关键技术。

### 9.3 哈希碰撞攻击（DoS）

前面说过"哈希函数要均匀"。如果攻击者**精心构造大量落入同一桶的 key**（利用已知哈希算法弱点），就能把哈希表退化成 O(n) 链表，使单次操作变慢、CPU 被打满——这就是**哈希碰撞拒绝服务攻击（Hash Collision DoS）**。经典案例是早年 Java / 语言对字符串 hashCode 的可预测性被利用。

防御手段一句话：**使用带随机盐（随机化哈希种子 / SipHash 之类）的哈希函数，让攻击者无法预先预测冲突分布**，从而无法构造恶意输入。现代语言（如 Python 3 的 hash 随机化、Java 8 的树化兜底）都已加入此类防护。

## 本篇小结

- 哈希表用**哈希函数把任意 key 映射成数组下标**，复用数组 O(1) 访问，本质是**以空间换时间**。
- 理想 O(1) 的前提是**无冲突**，但鸽巢原理决定冲突**必然存在**，只能压低 + 善后。
- 好哈希函数要满足**确定性、高效、均匀**；HashMap 用 `hashCode ^ (hashCode>>>16)` 扰动再做位与定位。
- **链地址法**把冲突串成链表，Java 8 起链表长 ≥8 且表 ≥64 时**转红黑树**兜底最坏 O(log n)。
- **开放寻址法**冲突就在数组内探测空位，分线性 / 二次 / 双重哈希，代价是**聚集**问题。
- 开放寻址删除要用**墓碑标记**，否则会切断后续元素的探测链导致误判。
- **负载因子 `α = 元素数 / 容量`** 超过阈值（默认 0.75）触发**扩容 ×2 + rehash**，均摊后仍 O(1)。
- 哈希表**平均 O(1)、最坏 O(n)**；与树相比快但**无序、不支持范围查询、最坏不稳定**。
- **字符串滚动哈希（Rabin-Karp）** 用 O(1) 窗口推进做子串匹配，应用于重复子串 / 抄袭检测。
- **一致性哈希**减少分布式扩缩容的数据迁移；**哈希碰撞攻击**靠随机化哈希种子防御。

## 参考链接

- [Hash table - Wikipedia](https://en.wikipedia.org/wiki/Hash_table)
- [Java `HashMap` 官方文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashMap.html)
- [Java `HashSet` 官方文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashSet.html)
- [GeeksforGeeks - Hashing Tutorial](https://www.geeksforgeeks.org/hashing-data-structure/)
- [GeeksforGeeks - Internal Working of HashMap in Java](https://www.geeksforgeeks.org/internal-working-of-hashmap-java/)
- [Consistent hashing - Wikipedia](https://en.wikipedia.org/wiki/Consistent_hashing)
- [Rabin–Karp algorithm - Wikipedia](https://en.wikipedia.org/wiki/Rabin%E2%80%93Karp_algorithm)
- [LeetCode - Hash Table Problems](https://leetcode.com/tag/hash-table/)

下一篇 → [05 图](/cs/dsa/graph)
