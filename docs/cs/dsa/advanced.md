# 09 高级数据结构

> 本篇导读：工程里光有基础结构不够。数组、链表、栈、队列、哈希表、树这些"基础武器"能解决大部分问题，但一旦遇到"动态连通性""区间最值""海量数据去重""最近最少使用"这类特定场景，基础结构要么写起来很绕，要么复杂度扛不住。本篇盘点并查集、线段树、树状数组、跳表、布隆过滤器、前缀和/差分、堆的进阶、LRU 缓存这些"进阶武器"，讲清它们分别解决什么特定问题、复杂度为何优秀，并给出可直接落地的代码骨架，方便你在工程里直接套用。

## 一、并查集（Union-Find）

并查集（Disjoint-Set Union，DSU）解决的是一个很朴素的问题：**一堆元素被动态地分成若干个互不相交的集合，要快速回答"这两个元素是否在同一个集合"以及"把它们所在集合合并"**。

经典场景：初始有 n 个孤立的点（每个点自成一个集合），不断告诉你"点 a 和点 b 连通了"，你要随时回答"点 x 和点 y 现在连通吗"。如果用图 + DFS 每次重跑，复杂度会爆；并查集把每次操作的均摊成本压到近乎 O(1)。

### 1.1 三个核心操作

- **`find(x)`**：找到 x 所在集合的"代表元"（根节点）。同一个集合的元素 `find` 结果相同，这是判断连通性的依据。
- **`union(x, y)`**：把 x 和 y 所在的集合合并成一个。
- **`same(x, y)`**：等价于 `find(x) == find(y)`，判断连通。

最朴素的实现就是森林：每个集合是一棵树，根为代表元。问题在于，如果合并时总是把一棵树整体挂到另一棵树下面，树会退化成链，最坏 `find` 变成 O(n)。两个解法的组合几乎消除了这个问题。

### 1.2 路径压缩（path compression）

在 `find(x)` 时，把沿途经过的所有节点直接挂到根上，下次查找就一步到位。

```java
// 路径压缩的 find：递归版本
int find(int x) {
    if (parent[x] != x) {
        parent[x] = find(parent[x]); // 沿途全部指向根
    }
    return parent[x];
}
```

### 1.3 按秩合并（union by rank / size）

合并两棵树时，把"较矮/较小"的那棵挂到"较高/较大"的那棵下面，避免树被拉高。`rank` 记录近似高度，`size` 记录集合元素个数，二选一即可。

```java
// 按 size 合并：把小集合挂到大集合根下
void union(int x, int y) {
    int rx = find(x), ry = find(y);
    if (rx == ry) return;           // 已连通，避免成环
    if (size[rx] < size[ry]) {
        parent[rx] = ry;
        size[ry] += size[rx];
    } else {
        parent[ry] = rx;
        size[rx] += size[ry];
    }
}
```

**为什么两者组合后近乎 O(1)**：单用路径压缩，最坏情况 `find` 约 O(log n)；单用按秩合并，树高约 O(log n)；两者兼用，阿克曼函数反函数 `alpha(n)`（增长极慢，n 取宇宙原子数也小于 5）成为单次操作均摊复杂度，实际可视为常数。

### 1.4 ASCII 图：合并两棵树

初始两个独立集合，分别做 `find` 得到根 1 和根 4，执行 `union(1, 4)` 时按秩合并，把较小的集合挂到较大的根下：

```text
union 之前：两个互不相交的集合

   root=1            root=4
      |                |
    1---2            4---5
      |
      3

        执行 union(1,4) 后（2、3、1 同集合，挂到 4 下）

          4
         / \
        5   1
           / \
          2   3

此时 find(2) == find(5) == 4，说明 2 与 5 连通
```

路径压缩后再查 `find(2)`，会把 2 直接指到 4，树被压扁。

### 1.5 典型应用

| 应用 | 说明 |
| --- | --- |
| **连通分量** | 无向图里数"有多少块互相连通的区域"，每加一条边 `union` 一次，最后统计不同根的数量 |
| **Kruskal 判环** | 最小生成树算法中，加边前若 `same(u, v)` 为真，说明这条边会让图成环，跳过 |
| **岛屿数量** | 网格里每遇到陆地就 `union` 其上下左右陆地，最后不同根数即岛屿数（也可 DFS/BFS） |
| **冗余连接** | 给定一棵树被多加一条边变成图，用并查集找出那条造成环的边 |

### 1.6 完整 Java 实现骨架

一个可直接复用的并查集类大致长这样（注意 Java 示例带 `package`/`import`）：

```java
package dsa.unionfind;

import java.util.Arrays;

public class UnionFind {
    private final int[] parent;
    private final int[] size;
    private int components; // 当前连通块数量

    public UnionFind(int n) {
        parent = new int[n];
        size = new int[n];
        for (int i = 0; i < n; i++) {
            parent[i] = i;
            size[i] = 1;
        }
        components = n;
    }

    public int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]]; // 迭代版路径压缩
            x = parent[x];
        }
        return x;
    }

    public boolean union(int x, int y) {
        int rx = find(x), ry = find(y);
        if (rx == ry) return false; // 已连通
        if (size[rx] < size[ry]) {
            parent[rx] = ry;
            size[ry] += size[rx];
        } else {
            parent[ry] = rx;
            size[rx] += size[ry];
        }
        components--;
        return true;
    }

    public boolean connected(int x, int y) {
        return find(x) == find(y);
    }

    public int countComponents() {
        return components;
    }
}
```

## 二、线段树（Segment Tree）

线段树解决的是**"区间查询 + 单点/区间更新"**：给定一个数组，频繁地问"某段区间的最大值/最小值/和是多少"，或频繁地把某段区间加一个值。暴力遍历区间每次 O(n)，线段树把单点更新和区间查询都降到 O(log n)。

### 2.1 完全二叉树 + 数组

线段树的每个节点代表一个区间 `[l, r]`，叶子节点就是单个元素，内部节点存该区间的聚合值（和/最值）。因为是一棵近似满二叉树，用数组按层序存储最省事：节点 `i` 的左孩子是 `2*i`、右孩子是 `2*i+1`（根从 1 开始）。数组开 `4*n` 足以覆盖所有节点。

### 2.2 三个思想方法

- **`build`**：自底向上构造，先建叶子，再由 `pushup` 汇总。
- **`pushup`**：用左右孩子的值更新当前节点，例如 `tree[node] = tree[left] + tree[right]`。
- **`pushdown`**：做区间更新（而非单点更新）时，把"本节点的待下发标记"下传给左右孩子，保证查询时数据是最新的。这一步也叫懒标记（lazy tag）。

### 2.3 ASCII 图：一棵线段树的区间覆盖

以 8 个元素 `[0..7]` 为例，区间被不断二分：

```text
                    [0,7]
                 sum = 36
                /         \
            [0,3]         [4,7]
           sum=10        sum=26
          /      \       /      \
      [0,1]     [2,3]  [4,5]    [6,7]
      sum=3     sum=7   sum=11   sum=15
      /  \      /  \     /  \     /  \
   [0][1][2][3] [4][5] [6][7]
    1  2  3  4  5  6  7  8
```

查询 `[2,5]` 时，从根往下找，命中 `[2,3]` 和 `[4,5]` 两个整块直接返回，无需下钻到叶子，复杂度 O(log n)。

### 2.4 Java 实现骨架（区间和 + 单点更新）

```java
package dsa.segtree;

public class SegmentTree {
    private final int[] tree;
    private final int n;

    public SegmentTree(int[] a) {
        n = a.length;
        tree = new int[4 * n];
        build(a, 1, 0, n - 1);
    }

    private void build(int[] a, int node, int l, int r) {
        if (l == r) { tree[node] = a[l]; return; }
        int mid = (l + r) >> 1;
        build(a, node << 1, l, mid);
        build(a, node << 1 | 1, mid + 1, r);
        tree[node] = tree[node << 1] + tree[node << 1 | 1]; // pushup
    }

    public void update(int idx, int val) {
        update(1, 0, n - 1, idx, val);
    }

    private void update(int node, int l, int r, int idx, int val) {
        if (l == r) { tree[node] = val; return; }
        int mid = (l + r) >> 1;
        if (idx <= mid) update(node << 1, l, mid, idx, val);
        else update(node << 1 | 1, mid + 1, r, idx, val);
        tree[node] = tree[node << 1] + tree[node << 1 | 1]; // pushup
    }

    public int query(int ql, int qr) {
        return query(1, 0, n - 1, ql, qr);
    }

    private int query(int node, int l, int r, int ql, int qr) {
        if (ql <= l && r <= qr) return tree[node]; // 整块命中
        int mid = (l + r) >> 1, sum = 0;
        if (ql <= mid) sum += query(node << 1, l, mid, ql, qr);
        if (qr > mid) sum += query(node << 1 | 1, mid + 1, r, ql, qr);
        return sum;
    }
}
```

### 2.5 应用与懒标记

| 场景 | 线段树作用 |
| --- | --- |
| **区间最值** | 每个节点存区间最大/最小值，单点更新后 `pushup` 重算 |
| **区间和** | 每个节点存区间和，查询区间和时分段拼起来 |
| **区间加减** | 配合 `pushdown` 懒标记：更新时只打标记，查询下钻时才真正下发，避免每次都改整棵子树 |

**懒标记一句话**：区间更新不立即改所有叶子，而是给节点贴个"待办标签"，等下次查询途经该节点时（`pushdown`）才把改动下传给子节点，把"更新 + 查询"都维持在 O(log n)。

## 三、树状数组（Fenwick Tree）

树状数组是线段树的"轻量替代品"，由 Peter Fenwick 在 1994 年提出，专门解决**"单点更新 + 前缀和查询"**，代码极短，常数比线段树小。

### 3.1 lowbit 技巧

`lowbit(x) = x & (-x)`，即 x 的二进制表示里"最低位的 1 及其后面的 0"组成的数值。例如 `lowbit(6) = 6 & (-6) = 2`。它告诉我们：节点 `i` 管理的区间长度是 `lowbit(i)`，其父节点是 `i + lowbit(i)`。

```java
int lowbit(int x) {
    return x & (-x);
}

// 单点加 val 到位置 i（以及所有包含 i 的父区间）
void add(int i, int val) {
    for (; i <= n; i += lowbit(i)) tree[i] += val;
}

// 查询前缀和 [1..i]
int query(int i) {
    int s = 0;
    for (; i > 0; i -= lowbit(i)) s += tree[i];
    return s;
}
```

区间 `[l, r]` 的和 = `query(r) - query(l-1)`，同样是 O(log n)。

### 3.2 与线段树对比

| 维度 | 树状数组 | 线段树 |
| --- | --- | --- |
| **代码量** | 极短（十几行） | 较长（递归/结构多） |
| **支持操作** | 单点更新 + 前缀和 | 单点/区间更新 + 区间查询，几乎全能 |
| **区间最值** | 不支持（只能求和类可合并运算） | 支持 |
| **常数** | 小 | 略大 |
| **选择建议** | 只求前缀和、区间和时用它 | 区间最值、复杂区间修改用线段树 |

一句话：**能上树状数组的就用它，它解决不了（如区间最值、区间赋值）再上线段树**。常见衍生用法是求"逆序对"（把元素值离散化后，从后往前 `add(pos,1)` 并 `query(pos-1)` 统计已出现且更小的个数）。

### 3.3 完整 Java 实现骨架

```java
package dsa.fenwick;

public class FenwickTree {
    private final int[] tree;
    private final int n;

    public FenwickTree(int n) {
        this.n = n;
        this.tree = new int[n + 1]; // 下标从 1 开始
    }

    public void add(int i, int delta) {
        for (; i <= n; i += i & (-i)) tree[i] += delta;
    }

    public int prefixSum(int i) {
        int s = 0;
        for (; i > 0; i -= i & (-i)) s += tree[i];
        return s;
    }

    public int rangeSum(int l, int r) {
        return prefixSum(r) - prefixSum(l - 1);
    }
}
```

## 四、跳表（Skip List）

跳表是一种用"概率"换"简单"的有序数据结构。它在普通有序链表之上加了几层"快进指针"，让查找也能像二分一样跳着走。
### 4.1 多层有序链表 + 随机层数

每个节点除了存值，还带若干个"前进指针"。最底层是完整有序链表（包含所有元素），往上每一层是下一层的"稀疏抽样"。插入节点时，用随机函数决定它出现在哪几层（层数越大概率越小，期望层数 O(log n)）。

```text
level 3:  head -------------------------> 7 -------->
level 2:  head ------------> 3 ---------> 7 -------->
level 1:  head -> 1 ------> 3 ------> 5 -> 7 ------> 9
level 0:  head -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9

查找 6：从顶层 head 起，能跳就跳，
         level3 不动 -> level2 到 3 -> level1 到 5 -> level0 到 6
```

查找时从左上角 head 出发，能往右跳且不越过目标就跳，跳不动就下一层，直到最底层定位。每层平均跳过一半，总步数 O(log n)。插入/删除也是先查到位置再改指针，同样是 O(log n)。
### 4.2 与平衡树对比

| 维度 | 跳表 | 平衡树（AVL / 红黑树） |
| --- | --- | --- |
| **实现难度** | 低，链表 + 随机 | 高，旋转逻辑繁琐 |
| **查找/插入/删除** | 均摊 O(log n) | 严格 O(log n) |
| **范围遍历** | 底层链表天然有序，很方便 | 需要中序遍历 |
| **稳定性** | 依赖随机，期望好但偶发偏慢 | 最坏也稳 |

一句话：**跳表用随机层数换来和平衡树同级的 O(log n)，却比平衡树好写得多，因此成了 Redis 有序集合 ZSet 的底层之一**（ZSet 用跳表 + 哈希表组合实现，跳表保序、哈希表按成员查分）。
### 4.3 节点结构示意

```java
package dsa.skiplist;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

class SkipNode {
    int val;
    List<SkipNode> forward = new ArrayList<>();
    SkipNode(int val, int level) {
        this.val = val;
        for (int i = 0; i < level; i++) forward.add(null);
    }
}

public class SkipList {
    private static final double P = 0.5;
    private static final int MAX_LEVEL = 16;
    private final SkipNode head = new SkipNode(-1, MAX_LEVEL);
    private final Random rng = new Random();
    private int level = 1;

    private int randomLevel() {
        int lvl = 1;
        while (rng.nextDouble() < P && lvl < MAX_LEVEL) lvl++;
        return lvl;
    }
    // search / insert / delete 均沿多层指针定位，复杂度 O(log n)
}
```

## 五、布隆过滤器（Bloom Filter）

布隆过滤器是**"用极小空间判断一个元素是否'可能已经存在'"**的概率型结构，1970 年由 Burton Bloom 提出。它不存元素本身，只用一个位数组 + 多个哈希函数。

### 5.1 原理：多个哈希位图

初始化一个长度为 m 的 bit 数组（全 0）和 k 个独立哈希函数。

- **插入 x**：用 k 个哈希函数算出 k 个位置，把这些 bit 全部置 1。
- **查询 x**：同样算 k 个位置，只要**有一个 bit 是 0**，就说明 x **一定没插入过**（无假阴性）；如果**全是 1**，则 x **可能存在**（有误判，因为别的元素的哈希可能恰好把这些位也置 1）。
### 5.2 ASCII 图：插入与查询

```text
bit array (m=16), 初始全 0
index: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
value: 0 0 0 0 0 0 0 0 0 0  0  0  0  0  0  0

插入 "apple": h1=1, h2=5, h3=11
index: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
value: 0 1 0 0 0 1 0 0 0 0  0  1  0  0  0  0

查询 "banana": h1=1, h2=9, h3=11
         -> bit1=1, bit9=0, bit11=1
         -> 出现 0，所以 banana 一定不存在

查询 "pear": h1=1, h2=5, h3=11
         -> 全是 1，可能已存在（实际没插过，这就是误判）
```

### 5.3 应用与误判

| 应用 | 说明 |
| --- | --- |
| **缓存穿透防护** | 查询 DB 前先过布隆过滤器，不存在的请求直接拦截，避免恶意查不存在的 key 打垮数据库 |
| **爬虫去重** | 已访问 URL 放进过滤器，避免重复抓取 |
| **HBase / Cassandra** | 用布隆过滤器快速判断某行/某列是否可能存在，减少无谓的磁盘读取 |
**误判率与大小关系一句话**：在哈希函数个数固定时，bit 数组 m 越大、已插入元素 n 越少，误判率越低；工程上通常按目标误判率反推 m ≈ -n·ln(p) / (ln2)² 来定大小。

### 5.4 简易 Java 草图

```java
package dsa.bloom;

import java.util.BitSet;
import java.util.function.Function;

public class BloomFilter {
    private final BitSet bits;
    private final int m;
    private final Function<String, Integer>[] hashes;

    public BloomFilter(int m, Function<String, Integer>[] hashes) {
        this.m = m;
        this.bits = new BitSet(m);
        this.hashes = hashes;
    }

    public void add(String x) {
        for (var h : hashes) bits.set(h.apply(x) % m);
    }

    public boolean mightContain(String x) {
        for (var h : hashes) {
            if (!bits.get(h.apply(x) % m)) return false; // 一定不存在
        }
        return true; // 可能存在
    }
}
```

## 六、前缀和（Prefix Sum）

前缀和是最朴素却最常用的一维/二维加速技巧，核心思想是把"反复求区间和"预处理成 O(1)。

### 6.1 一维前缀和

```java
// 原数组 a[1..n]，构造前缀和 s[i] = a[1]+...+a[i]
s[0] = 0;
for (int i = 1; i <= n; i++) s[i] = s[i - 1] + a[i];

// 查询区间 [l, r] 的和，O(1)
long sum = s[r] - s[l - 1];
```

### 6.2 二维前缀和

二维矩阵里求任意子矩形和，用容斥：

```text
令 S(x,y) = 以 (1,1) 为左上、 (x,y) 为右下的矩形和
则矩形 [x1..x2][y1..y2] 的和 =
    S(x2,y2) - S(x1-1,y2) - S(x2,y1-1) + S(x1-1,y1-1)
```

构造 `S` 时也用容斥累加，预处理 O(n·m)，每次查询 O(1)。

### 6.3 差分数组：配合做区间加减

前缀和的"逆运算"是差分。给定数组 `a`，差分 `d[i] = a[i] - a[i-1]`。对区间 `[l, r]` 整体加 v，只需 `d[l] += v; d[r+1] -= v`，最后对 d 求前缀和即得新数组——把"m 次区间加减"从 O(m·n) 降到 O(m + n)。

| 技巧 | 解决的问题 | 复杂度 |
| --- | --- | --- |
| **前缀和** | 反复求区间和 | 预处理 O(n)，查询 O(1) |
| **差分** | 反复对区间整体加减 | 更新 O(1)，还原 O(n) |

二者常配合：先用差分把所有区间修改一次性做完，再一次性求前缀和还原，得到最终数组。典型题如"航班预订统计""小朋友排队"等。

### 6.4 例题：和为 k 的子数组

问数组里有多少个连续子数组的和恰好等于 k。用前缀和 + 哈希表：维护"到当前位置的前缀和 cur"，若之前出现过 `cur - k`，说明中间那段子数组和为 k。边走边把出现次数记入 `HashMap`，复杂度 O(n)：

```java
int countSubarraySumK(int[] a, int k) {
    java.util.Map<Integer, Integer> freq = new java.util.HashMap<>();
    freq.put(0, 1); // 前缀和为 0 出现 1 次（空前缀）
    int cur = 0, ans = 0;
    for (int x : a) {
        cur += x;
        ans += freq.getOrDefault(cur - k, 0);
        freq.put(cur, freq.getOrDefault(cur, 0) + 1);
    }
    return ans;
}
```

## 七、堆的进阶

基础篇讲过二叉堆（优先级队列），这里补三个进阶视角。

- **单调队列（Monotonic Queue）**：维护一个"值随时间单调"的双端队列，常用于"滑动窗口最大值"。队首始终是当前窗口最大/最小值，新元素入队前从队尾弹出比它小的，保证队列单调；同时队首超出窗口范围就出队。窗口最大值的经典解法是它，复杂度 O(n)。
- **可并堆（Leftist Heap / Skew Heap）一句话**：支持 O(log n) 把两个堆合并的堆结构，普通二叉堆合并要 O(n)，左偏堆靠"右路径短"的性质保证合并高效。
- **延迟删除（Lazy Deletion）一句话**：堆不支持随机删指定元素，就只在堆顶弹出时再检查"这个元素是否已被标记删除"，是堆里删元素的通用技巧。

### 7.1 单调队列求窗口最大值草图

```java
// 返回每个长度为 k 的窗口的最大值
int[] maxSlidingWindow(int[] a, int k) {
    java.util.ArrayDeque<Integer> dq = new java.util.ArrayDeque<>();
    java.util.List<Integer> out = new java.util.ArrayList<>();
    for (int i = 0; i < a.length; i++) {
        while (!dq.isEmpty() && a[dq.peekLast()] <= a[i]) dq.pollLast(); // 维护递减
        dq.addLast(i);
        if (dq.peekFirst() == i - k) dq.pollFirst(); // 队首出窗口
        if (i >= k - 1) out.add(a[dq.peekFirst()]);   // 窗口形成
    }
    return out.stream().mapToInt(x -> x).toArray();
}
```

## 八、LRU 缓存

LRU（Least Recently Used，最近最少使用）缓存是面试和工程的常客：容量满时，淘汰"最久没被访问"的条目。

### 8.1 为什么是"双向链表 + 哈希"

- **哈希表**：O(1) 通过 key 找到节点。
- **双向链表**：按"访问时间"排序，最近访问的放表头，最久未访问的在表尾；淘汰时直接删表尾。

两者结合，使得 `get` 和 `put` 都是 O(1)：命中后把节点移到表头（最近使用），插入新节点放表头，超容量删表尾（最久未用）。

### 8.2 关联前文

- 双向链表正来自**第 02 篇（线性表 / 链表）**——链表节点能在 O(1) 内从中间摘除并插到头部，正是 LRU 需要的操作。
- 哈希表来自**第 04 篇（哈希表）**——它让"按 key 定位节点"不必遍历链表。

### 8.3 Java 实现思路

Java 的 `LinkedHashMap` 自带"按访问顺序"模式，开 `accessOrder=true` 即近访问的排后面，重写 `removeEldestEntry` 即可：

```java
import java.util.LinkedHashMap;
import java.util.Map;

public class LRUCache<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;

    public LRUCache(int capacity) {
        super(capacity, 0.75f, true); // accessOrder = true
        this.capacity = capacity;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;     // 超容量自动淘汰最老
    }
}
```

手写思路（不用现成类）：自己维护 `HashMap<K, Node>` 和一条双向链表，封装 `moveToHead`、`removeTail` 两个内部操作，`get`/`put` 都围绕它们转即可。下面给出一个完整手写骨架：

```java
package dsa.cache;

import java.util.HashMap;
import java.util.Map;

public class LRUCacheHandwritten {
    private final int capacity;
    private final Map<Integer, Node> map = new HashMap<>();
    private final Node head = new Node(-1, -1); // 哑结点，头=最近
    private final Node tail = new Node(-1, -1); // 尾=最久

    public LRUCacheHandwritten(int capacity) {
        this.capacity = capacity;
        head.next = tail; tail.prev = head;
    }

    public int get(int key) {
        Node n = map.get(key);
        if (n == null) return -1;
        moveToHead(n);
        return n.val;
    }

    public void put(int key, int val) {
        Node n = map.get(key);
        if (n != null) { n.val = val; moveToHead(n); return; }
        n = new Node(key, val);
        map.put(key, n);
        addToHead(n);
        if (map.size() > capacity) {
            Node old = tail.prev;
            remove(old);
            map.remove(old.key);
        }
    }

    private void addToHead(Node n) { n.next = head.next; n.prev = head; head.next.prev = n; head.next = n; }
    private void remove(Node n) { n.prev.next = n.next; n.next.prev = n.prev; }
    private void moveToHead(Node n) { remove(n); addToHead(n); }

    static class Node {
        int key, val;
        Node prev, next;
        Node(int k, int v) { key = k; val = v; }
    }
}
```

## 九、小结：各结构解决的问题与复杂度

| 结构 | 解决的核心问题 | 关键操作复杂度 | 典型场景 |
| --- | --- | --- | --- |
| **并查集** | 动态连通性 / 集合合并 | `find`/`union` 均摊 ~O(1)（`alpha(n)`） | 连通分量、Kruskal、岛屿数 |
| **线段树** | 区间查询 + 区间更新 | 更新/查询 O(log n) | 区间最值、区间和、区间加减 |
| **树状数组** | 单点更新 + 前缀和 | 更新/查询 O(log n) | 频繁前缀和、逆序对计数 |
| **跳表** | 有序集合 + 范围查询 | 查找/插入/删除 O(log n) | Redis ZSet、内存有序表 |
| **布隆过滤器** | 海量元素存在性判断（省空间） | 插入/查询 O(k) | 缓存穿透、去重（有误判） |
| **前缀和** | 反复求区间和 | 预处理 O(n)，查询 O(1) | 区间和、子数组统计 |
| **差分** | 反复区间整体加减 | 更新 O(1)，还原 O(n) | 多次区间修改 |
| **单调队列** | 滑动窗口最值 | O(n) | 窗口最大值、单调最值 |
| **LRU 缓存** | 最近最少使用淘汰 | get/put O(1) | 缓存、页置换 |

## 本篇小结

- **并查集**：解决动态连通性，`find` + `union` 配合**路径压缩 + 按秩合并**，单次操作均摊约 O(1)（`alpha(n)`）。
- **并查集应用**：三大场景——连通分量计数、Kruskal 判环、岛屿数量，本质都是"边加入时维护集合"。
- **线段树**：把区间查询/区间更新压到 O(log n)，完全二叉树用数组存，核心是 `build`/`pushup`/`pushdown` 三段式。
- **懒标记**：让线段树区间更新不必改到叶子，等查询下钻时再 `pushdown` 下发，保证更新与查询都 O(log n)。
- **树状数组**：用 `lowbit` 技巧，代码远短于线段树，擅长单点更新 + 前缀和，但不支持区间最值。
- **跳表**：用多层有序链表 + 随机层数实现 O(log n) 查找，比平衡树好写，是 Redis ZSet 底层之一。
- **布隆过滤器**：空间极小、查询 O(k)，**无误判"假阴性"但有误判"假阳性"**，适合缓存穿透防护与去重。
- **前缀和/差分**：前缀和把反复区间和降到 O(1)，差分把反复区间加减降到 O(1) 更新，二者常配合使用。
- **堆的进阶**：单调队列解滑动窗口最值，可并堆支持合并，延迟删除是堆里删元素的通用技巧。
- **LRU 缓存**：= 双向链表（保序）+ 哈希表（定位），get/put 均 O(1)，复用第 02 篇链表与第 04 篇哈希思想。

## 参考链接

- [Disjoint-set data structure - Wikipedia](https://en.wikipedia.org/wiki/Disjoint-set_data_structure)
- [Fenwick tree - Wikipedia](https://en.wikipedia.org/wiki/Fenwick_tree)
- [Bloom filter - Wikipedia](https://en.wikipedia.org/wiki/Bloom_filter)
- [Segment Tree - GeeksforGeeks](https://www.geeksforgeeks.org/segment-tree-data-structure/)
- [Union-Find Algorithm - GeeksforGeeks](https://www.geeksforgeeks.org/union-find/)
- [Skip List - GeeksforGeeks](https://www.geeksforgeeks.org/skip-list/)
- [LeetCode 并查集题目集](https://leetcode.com/tag/union-find/)
- [LeetCode 线段树 / 树状数组相关题目](https://leetcode.com/tag/binary-indexed-tree/)

下一篇 → [10 算法思想与实战](/cs/dsa/algo)
