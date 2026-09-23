# 07 查找算法

> 本篇导读：查找是"从一堆数据里快速拿到目标"。本篇盘点顺序查找、二分查找（及其变体）、分块索引、BST 查找、哈希查找与 B+ 树范围查找，建立"不同结构下查找复杂度"的整体图。读完你会明白：同样是"找一个数"，为什么数组用二分能 O(log n)、哈希能逼近 O(1)，而链表只能 O(n)，以及工程里应该如何取舍。

## 一、查找基础

查找（Search）的本质，是给定**关键字（key）**和**查找表（search table）**，确定表中是否存在该关键字、若存在则返回其位置。所有查找算法都在回答一个问题：给定一个目标，到哪里、用多少步能拿到它。

理解查找，先分清两类表和两种结果：

- **静态查找表**：建好之后元素不再增删，只查。例如编译期的常量表、一次性加载的配置文件。
- **动态查找表**：查找过程中可能插入或删除元素。例如运行时的缓存、数据库索引。

每次查找的结果只有两种：

- **查找成功**：表中存在该关键字，返回位置或记录。
- **查找失败**：表中不存在，返回失败标志（通常是 -1、null 或特定哨兵值）。

衡量查找好坏，最常用 **ASL（Average Search Length，平均查找长度）**：为确定记录在表中的位置，所需要进行的关键字比较次数的期望值。

对于长度为 n 的查找表，等概率下查找成功的平均查找长度为：

```text
            n
         1  ∑
ASL =  ─────   Cᵢ
         n  i=1
```

其中 `Cᵢ` 是找到第 i 个记录所需的比较次数。ASL 越低，查找越快。后续每种算法我们都会落到 ASL（或最坏比较次数）上对比，这样"快不快"是可量化的，而不是一句空泛的"比较高效"。

为什么复杂度差异这么大？核心在于**数据的组织方式决定了"每次比较能排除多少候选"**：

| 组织方式 | 每次比较能排除的候选 | 典型复杂度 |
| --- | --- | --- |
| 无序数组（顺序扫描） | 只能排除当前一个 | O(n) |
| 有序数组（二分） | 排除一半 | O(log n) |
| 哈希表 | 直接定位桶 | 平均 O(1) |
| B+ 树索引 | 排除整棵子树 | O(log n) 且磁盘友好 |

下一节从最朴素的顺序查找讲起，逐步过渡到这些更优的结构。

## 二、顺序查找

顺序查找（Sequential Search / Linear Search）是最直接的办法：从表头到表尾逐个比对关键字，直到命中或扫完。

### 基本写法

```java
package com.canoe.search;

/**
 * 顺序查找：在数组 arr 中查找 target，返回下标；找不到返回 -1。
 */
public class SequentialSearch {

    public static int search(int[] arr, int target) {
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] == target) {
                return i;
            }
        }
        return -1;
    }
}
```

- **时间复杂度**：O(n)。最坏扫完整个数组。
- **空间复杂度**：O(1)。
- **前提**：无，数组是否有序都能用。
- **ASL（等概率成功）**：`(n+1)/2`；失败则比较 n+1 次（含越界判断）。

### 哨兵优化

基本写法每次循环都要判断 `i < arr.length` 和 `arr[i] == target` 两个条件。把目标放到数组头部当"哨兵"，可以让循环只比关键字，省掉下标越界判断：

```java
package com.canoe.search;

public class SequentialSearchSentinel {

    /**
     * 哨兵优化：把 target 放到 arr[0]，从尾部向 0 扫。
     * 找到哨兵本身即说明没找到。
     */
    public static int search(int[] arr, int target) {
        if (arr.length == 0) {
            return -1;
        }
        int n = arr.length - 1;
        // 备份原 arr[0]，并放置哨兵
        int saved = arr[0];
        arr[0] = target;

        int i = n;
        while (arr[i] != target) {
            i--;
        }

        arr[0] = saved; // 恢复原值，避免副作用
        return i == 0 ? -1 : i; // 停在哨兵位置说明没找到
    }
}
```

哨兵优化的价值不在把 O(n) 变成 O(1)，而在**减少每次循环的边界判断**，当 n 极大时循环体更紧凑、分支预测更友好。工程上这是典型的"用一次预处理换持续的比较成本下降"。

### 适用场景

- 数据量小、无序、偶发查询：上复杂结构反而增加维护成本。
- 链表（单链表无法随机访问，二分无从谈起）：只能顺序扫。
- 作为其他算法的兜底：当候选集退化成几个元素时，顺序查反而比调用二分快（分支少、无计算）。

一句话：**顺序查找是"没有结构可用时的最坏退路"，也是"数据太小不值得搭结构时的最优解"**。

## 三、二分查找

二分查找（Binary Search）之所以快，是因为它要求数据**有序**，从而每次比较能砍掉一半候选。

### 前提：必须有序

二分查找依赖"有序性"做决策：比较 `mid` 与目标后，能确定目标只可能在左半或右半。若数组无序，砍掉一半的推理不成立，算法直接失效。这也是为什么很多工程在写入时排序、或单独维护有序索引——为读取时的二分付出一次排序成本是划算的（排序 O(n log n)，之后可多次 O(log n) 查）。

### 标准模板：while `low <= high`

```java
package com.canoe.search;

public class BinarySearch {

    /**
     * 在升序数组 arr 中查找 target。
     * 找到返回下标，找不到返回 -1。
     */
    public static int search(int[] arr, int target) {
        int low = 0;
        int high = arr.length - 1;

        while (low <= high) {
            // 防溢出写法：不要用 (low + high) / 2
            int mid = low + (high - low) / 2;

            if (arr[mid] == target) {
                return mid;                 // 命中
            } else if (arr[mid] < target) {
                low = mid + 1;              // 目标在右半
            } else {
                high = mid - 1;             // 目标在左半
            }
        }
        return -1; // 区间收缩为空
    }
}
```

循环条件 `low <= high` 的含义是"区间 `[low, high]` 还非空就继续"。当 `low > high` 时，闭区间为空，查找失败。

### 在有序数组上折半的 ASCII 图

假设数组 `arr = [1, 3, 5, 7, 9, 11, 13, 15]`，查找 `target = 11`：

```text
下标    0   1   2   3   4   5   6   7
值     1   3   5   7   9  11  13  15
       低                       高
       └───────────────────────┘
       low=0  high=7  mid=3  arr[3]=7 < 11 → 目标在右半

下标    0   1   2   3   4   5   6   7
值     1   3   5   7   9  11  13  15
                  低          高
                  └───────────┘
                  low=4  high=7  mid=5  arr[5]=11 == 11 → 命中，返回 5
```

每一轮 `mid` 把搜索区间对半砍，所以最多 `⌈log₂(n+1)⌉` 轮结束。**这正是 O(log n) 的来源**：区间长度每轮减半，从 n 减到 1 只需约 log₂ n 步。

### 易错点一：mid 溢出

初学者常写 `int mid = (low + high) / 2;`。当 `low` 和 `high` 都接近 `Integer.MAX_VALUE` 时，`low + high` 会**整数溢出变负**，得到错误甚至越界的 `mid`。正确写法：

```java
int mid = low + (high - low) / 2;          // 推荐，无溢出
// 或利用无符号右移（Java）
int mid = (low + high) >>> 1;
```

### 易错点二：循环不变量

二分难写对，根因是没想清"循环不变量（loop invariant）"——每轮循环开始前，`[low, high]` 这个闭区间里**一定还包含目标（若存在）**。维护它要做到两点：

- 命中即返回，没问题。
- 没命中时，必须把**不可能含目标的半个区间排除**：`arr[mid] < target` 说明 `mid` 及其左边都太小，新 `low = mid + 1`；反之 `high = mid - 1`。注意是 `mid ± 1`，否则当区间仅剩两个元素时可能死循环（见下文变体）。

只要不变量成立、边界收缩正确，二分就稳。下节的所有变体，都是在这条不变量上做"等于时往左/右继续"的微调。

## 四、二分变体

标准二分只处理"有没有"。实际更常问"第一个/最后一个等于 target 的位置""target 应该插在哪"。这些变体的差别只在**命中时不等即返回，而是继续往一侧收缩**。

### 查找第一个等于 target（lower_bound 思想）

```java
package com.canoe.search;

public class BinarySearchVariants {

    /** 第一个等于 target 的下标；不存在返回 -1。 */
    public static int firstEqual(int[] arr, int target) {
        int low = 0;
        int high = arr.length - 1;
        int result = -1;

        while (low <= high) {
            int mid = low + (high - low) / 2;
            if (arr[mid] == target) {
                result = mid;       // 记录候选，继续向左找更早的
                high = mid - 1;
            } else if (arr[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return result;
    }

    /** 最后一个等于 target 的下标；不存在返回 -1。 */
    public static int lastEqual(int[] arr, int target) {
        int low = 0;
        int high = arr.length - 1;
        int result = -1;

        while (low <= high) {
            int mid = low + (high - low) / 2;
            if (arr[mid] == target) {
                result = mid;       // 记录候选，继续向右找更晚的
                low = mid + 1;
            } else if (arr[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return result;
    }
}
```

### 查找插入位置（LeetCode 35）

返回 `target` 若有则下标、若无可插入以保持有序的第一个位置。它就是标准库的 `lower_bound`：

```java
package com.canoe.search;

public class InsertPosition {

    /** 等价于 C++ lower_bound：第一个 >= target 的位置。 */
    public static int lowerBound(int[] arr, int target) {
        int low = 0;
        int high = arr.length; // 注意：这里 high 取长度，区间是 [low, high)

        while (low < high) {    // 左闭右开，用 <
            int mid = low + (high - low) / 2;
            if (arr[mid] < target) {
                low = mid + 1;
            } else {
                high = mid;      // 关键：不 -1，保留候选
            }
        }
        return low;
    }
}
```

注意此处切换成了**左闭右开区间 `[low, high)`**：`high` 初始为 `n`，循环用 `low < high`，命中分支 `high = mid`（不减 1）。两种区间写法都对，关键是**自己选定一种并在全程保持一致**，混用最易出 bug。

### lower_bound / upper_bound 思想小结

- `lower_bound`：第一个 **>=** target 的位置。
- `upper_bound`：第一个 **>** target 的位置。
- 两者相减 `upper_bound - lower_bound` = target 的出现次数，这是统计有序数组中某元素频次的 O(log n) 套路。

```text
数组:   2   4   4   4   7   9
下标:   0   1   2   3   4   5
        ↑            ↑
   lower_bound(4)=1  upper_bound(4)=4
   出现次数 = 4 - 1 = 3
```

## 五、插值查找

二分每次都取中点，是"无差别对半"。但如果数据**均匀分布**且我们知道值的范围，就能根据目标值的大小**估算**它大概在哪儿，不必总走正中——这就是插值查找（Interpolation Search）。

### 核心公式

把"取中点"换成按比例估算位置：

```text
        target - arr[low]
mid = low + ─────────────────── × (high - low)
        arr[high] - arr[low]
```

直观理解：若 `target` 接近 `arr[low]`，`mid` 靠近左端；若接近 `arr[high]`，`mid` 靠近右端。好比在字典里查"张"，你不会先翻到正中，而是直接翻到靠后——插值查找就是按值"翻到该翻的地方"。

```java
package com.canoe.search;

public class InterpolationSearch {

    public static int search(int[] arr, int target) {
        int low = 0;
        int high = arr.length - 1;

        while (low <= high && target >= arr[low] && target <= arr[high]) {
            // 比例估算位置
            int mid = low + (high - low) * (target - arr[low]) / (arr[high] - arr[low]);

            if (arr[mid] == target) {
                return mid;
            } else if (arr[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return -1;
    }
}
```

### 优势与退化

- **均匀分布**时，每次估计极准，平均比较次数可降到 **O(log log n)**，比二分还快一个层级。
- **最坏情况**：数据极端不均匀（例如 `[1, 2, 3, ..., 1000, 1000000]`），插值可能把 `mid` 推到极端，退化为 **O(n)**，和顺序查找一样差。

所以工程实践里，插值查找常作为"数据均匀时的加速器"，并在循环的若干轮内若进展太慢就**回退到二分**，兼顾两种极端。

## 六、分块查找

分块查找（Block Search / Indexed Sequential Search）是顺序查找和二分查找的折中：**块间有序、块内无序**。

思想一句话：**先建一个"索引表"记录每块的最大关键字和起始位置，查时先二分/顺序定位目标所在块，再在块内顺序扫。**

```text
数据(块内无序)      索引表(块间有序)
┌──────┐ ┌──────┐ ┌──────┐   最大key  块起点
│ 18 9 │ │ 35 22│ │ 70 51│   18  → 0
│ 12 6 │ │ 28 30│ │ 60 88│   35  → 4
└──────┘ └──────┘ └──────┘   70  → 8
 块0       块1       块2
```

查 `target = 28`：先比索引 `[18, 35, 70]`，定位到"最大 key >= 28"的块 1（因为 18 < 28 <= 35），再在块 1 内顺序找。

- 索引表块间有序，可用二分定位块，定位 O(log 块数)。
- 块内无序，只能顺序，块内 O(块大小)。
- 整体介于顺序与二分之间，适合**数据动态增删、又想比纯顺序快一点**的场景，且比维护整表有序成本低。

典型应用：电话簿按"姓氏首字母分块"、数据库的"稀疏索引"。

## 七、树表查找

前面都是基于数组。当数据需要**动态增删**且要保持高效查找，树结构登场。

### BST 查找

二叉查找树（Binary Search Tree，BST）满足：左子树所有 key < 根 < 右子树所有 key。查找从根出发，比根小走左、比根大走右：

```java
package com.canoe.search;

class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode(int v) { val = v; }
}

public class BstSearch {

    public static TreeNode search(TreeNode root, int target) {
        TreeNode cur = root;
        while (cur != null) {
            if (cur.val == target) {
                return cur;
            } else if (target < cur.val) {
                cur = cur.left;
            } else {
                cur = cur.right;
            }
        }
        return null; // 查找失败
    }
}
```

- 每次比较排除一整棵子树，查找次数 = 路径深度。
- **最好/平均 O(log n)**（树较平衡），**最坏 O(n)**（退化成链表，例如按顺序插入 `1,2,3,...,n`）。

### 平衡树保证 O(log n)

BST 退化的根因是"不平衡"。平衡二叉搜索树（AVL、红黑树）通过旋转在插入删除时维持树高 O(log n)，从而保证查找**稳定 O(log n)**。Java 的 `TreeMap`、C++ 的 `std::map` 底层就是红黑树。

### B+ 树与磁盘友好（关联第 03 篇）

当数据大到内存放不下、必须落盘时，二叉树每个节点存一个 key、一次磁盘 IO 只取一个 key，树高巨大、IO 次数爆炸。B+ 树（多路平衡查找树）让**每个节点存很多 key、一个节点对应一次磁盘页读取**，大幅压低树高；且**所有记录都在叶子节点、叶子间用链表串起**，天然支持**范围查找**（如 `WHERE id BETWEEN 100 AND 200`）。

这也是为什么关系型数据库索引几乎都用 B+ 树（详见第 03 篇《树与堆》）。它的查找复杂度仍是 O(log n)，但常数意义上的"每次比较的代价"被磁盘页批处理摊薄了。

```text
B+ 树查找 15：
           [10 | 30]            ← 根节点(一次磁盘页读)
          /     |     \
   [3|6]   [12|15|18]   [35|40]  ← 叶子(链表相连,支持范围)
   查 15：根比 10/30 → 走中间 → 叶子里顺序/二分命中 15
   范围 12~18：定位后沿叶子链表横扫即可
```

## 八、哈希查找

哈希查找（Hashing）走另一条路：**不比较，直接算地址**。给定 key，经哈希函数 `h(key)` 算出存储位置，理想情况下一步到位，平均 O(1)。（哈希表的构造与冲突处理详见第 04 篇《哈希表》。）

```java
package com.canoe.search;

public class HashSearch {

    // 极简示例：除留余数法 + 线性探测
    private static final int CAP = 16;
    private Integer[] table = new Integer[CAP];

    private int hash(int key) {
        return key % CAP; // 哈希函数 h(key)
    }

    public boolean contains(int key) {
        int idx = hash(key);
        int start = idx;
        while (table[idx] != null) {
            if (table[idx] == key) {
                return true; // 命中
            }
            idx = (idx + 1) % CAP; // 线性探测下一个桶
            if (idx == start) break; // 表满，避免死循环
        }
        return false; // 查找失败
    }
}
```

### 平均 O(1) 与冲突退化的代价

- 装填因子 `α = 元素数 / 桶数` 较低、哈希函数分散良好时，比较次数趋近 **O(1)**。
- 一旦大量 key 映射到同一桶（**哈希冲突**），该桶退化成链表/探测链，查找退化到 O(n)。
- 工程上用**好的哈希函数 + 动态扩容（rehash）**把 `α` 控制在低位（如 0.75 以下），从而把退化概率压到极低。Java 8 的 `HashMap` 在桶链表过长时还会转成红黑树，把最坏从 O(n) 拉回 O(log n)。

哈希查找的代价不在比较，而在**哈希计算本身 + 冲突处理的额外开销 + 内存（为低 α 预留空桶）**。它适合"等值精确查找"，但不擅长"范围查找"——这正是 B+ 树的主场。

## 九、各类查找对比

把本篇所有结构放在一张表里，方便按场景选型：

| 查找方式 | 前提条件 | 平均复杂度 | 最坏复杂度 | 是否需有序 | 典型用途 |
| --- | --- | --- | --- | --- | --- |
| 顺序查找 | 无 | O(n) | O(n) | 否 | 小数据/链表/兜底 |
| 二分查找 | 数组有序 | O(log n) | O(log n) | 是 | 静态有序数组检索 |
| 插值查找 | 数组有序且分布均匀 | O(log log n) | O(n) | 是 | 均匀大数组（如字典） |
| 分块查找 | 块间有序 | O(√n)~O(log n)+块内 | O(√n) | 块间是 | 动态数据+稀疏索引 |
| BST 查找 | 二叉查找树 | O(log n) | O(n) | 结构保证 | 内存中动态有序集 |
| 平衡树查找 | 平衡 BST | O(log n) | O(log n) | 结构保证 | `TreeMap`/`std::map` |
| B+ 树查找 | 多路平衡、落盘 | O(log n) | O(log n) | 结构保证 | 数据库/磁盘索引、范围查 |
| 哈希查找 | 良好哈希函数 | O(1) | O(n) | 否 | 等值精确查找、缓存 |

选型口诀：

- **只查不改、数据在内存、已知有序** → 二分（或插值若均匀）。
- **要动态增删且保持有序** → 平衡树 / BST。
- **等值查、追求极致速度、能接受额外内存** → 哈希。
- **落盘、还要范围查** → B+ 树。
- **什么都谈不上、数据又小** → 顺序查找，别过度设计。

## 本篇小结

- **查找**是"给定 key 在表中定位记录"，结果只有成功/失败两种，用 ASL 量化平均代价。
- 静态查找表只查不改，动态查找表允许插入删除，选型先看数据是否动态。
- **顺序查找**无前提、O(n)，适合小数据、链表和作为兜底，哨兵优化省掉循环里的越界判断。
- **二分查找**前提是数组有序，靠"每轮砍半"达到 O(log n)，循环用 `while low <= high` 且 `mid = low + (high-low)/2` 防溢出。
- 二分的核心护身符是**循环不变量**：`[low,high]` 闭区间内一定还含目标（若存在），收缩时排除不含目标的半边。
- **二分变体**（首/末等于、插入位置）只在命中后不立即返回、继续向一侧收缩；`lower_bound`/`upper_bound` 相减得出现次数。
- **插值查找**按值比例估算 mid，均匀分布时可达 O(log log n)，但分布不均最坏退化 O(n)，可回退二分。
- **分块查找**块间有序、块内无序，用索引表先定位块再块内顺序，是顺序与二分的折中。
- **树表查找**中 BST 平均 O(log n)、最坏 O(n) 退化；平衡树/红黑树稳住 O(log n)；B+ 树节点对应磁盘页、叶子链表支持范围查，是数据库索引主力（关联第 03 篇）。
- **哈希查找**平均 O(1) 但不比较只算地址，冲突会让桶退化成链，靠好哈希+低装填因子+扩容兜底（关联第 04 篇），不擅长范围查。

## 参考链接

- [Binary search - Wikipedia](https://en.wikipedia.org/wiki/Binary_search_algorithm)
- [Interpolation search - Wikipedia](https://en.wikipedia.org/wiki/Interpolation_search)
- [Binary Search - GeeksforGeeks](https://www.geeksforgeeks.org/binary-search/)
- [Interpolation Search - GeeksforGeeks](https://www.geeksforgeeks.org/interpolation-search/)
- [Binary Search - LeetCode 题目 704](https://leetcode.com/problems/binary-search/)
- [Search Insert Position - LeetCode 题目 35](https://leetcode.com/problems/search-insert-position/)
- [Introduction to Algorithms (CLRS) 第三版，第 11 章](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/)

下一篇 → [08 字符串算法](/cs/dsa/string)
