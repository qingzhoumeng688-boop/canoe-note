# 03 集合框架

集合是 Java 里每天都会打交道的工具箱。`ArrayList`、`HashMap`、`HashSet` 你闭着眼都能写，但它们底下藏着扩容、哈希冲突、树化、并发修改异常一整套机制。本篇先画清 Collection 与 Map 两大体系的家族树，再逐个拆解 `List`/`Set`/`Queue`/`Map` 的选型与原理，重点攻克 `HashMap` 的底层、迭代器的 fail-fast，最后给出一张「选型速查表」，让你拿到需求就知道该 new 哪个。

## 一、集合框架总览

整个集合框架分两大套：**Collection（单列，存元素）**和 **Map（双列，存 key-value）**。

```text
java.util.Collection                        java.util.Map
├── List（有序、可重复、有索引）            ├── HashMap（数组+链表+红黑树，最常用）
│   ├── ArrayList（数组，查快改慢）         ├── LinkedHashMap（保持插入顺序）
│   ├── LinkedList（双向链表，改快查慢）     ├── TreeMap（按 key 排序，红黑树）
│   └── Vector（线程安全，已过时）          ├── Hashtable（线程安全，已过时）
├── Set（无序、不可重复）                    └── ConcurrentHashMap（高并发）
│   ├── HashSet（基于 HashMap）
│   ├── LinkedHashSet（保持插入顺序）
│   └── TreeSet（排序，红黑树）
└── Queue / Deque（队列/双端队列）
    ├── ArrayDeque（推荐替代 Stack）
    └── PriorityQueue（堆，优先级）
```

记住：**Collection 管「装什么」，Map 管「键值对」**。接口与实现类分离，这是面向接口编程的好例子——业务里尽量写 `List<T>` 而不是 `ArrayList<T>`，方便以后换实现。

## 二、List

`List` 的三大实现对比：

```text
实现类        底层结构      随机访问    增删（中间）   线程安全    适用场景
ArrayList     动态数组      快 O(1)     慢 O(n)       否          99% 场景，查多改少
LinkedList    双向链表      慢 O(n)     快 O(1)       否          频繁头尾增删、队列
Vector        动态数组      快 O(1)     慢 O(n)       是(同步)    已过时，别用
```

`ArrayList` 是基于数组的，按下标取值一步到位，但在中间插入/删除要搬移后面所有元素。`LinkedList` 是链表，增删只改指针，但想按下标找元素得从头遍历，所以随机访问慢。

```java
package com.canoe.core.collection;

import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;
import java.util.Vector;

public class ListCompareDemo {
    public static void main(String[] args) {
        // 三者 API 几乎一致，体现面向接口编程
        List<String> arrayList = new ArrayList<>();
        List<String> linkedList = new LinkedList<>();
        List<String> vector = new Vector<>();

        arrayList.add(" canoe ");
        linkedList.add(" canoe ");
        vector.add(" canoe ");

        // 随机访问：ArrayList 最快
        System.out.println(arrayList.get(0));

        // 中间插入：LinkedList 理论更快（这里元素少看不出差别）
        arrayList.add(0, "head");
        linkedList.add(0, "head");
        System.out.println(arrayList);   // [head,  canoe ]
        System.out.println(linkedList);  // [head,  canoe ]
    }
}
```

**结论**：除非有明确的高频头尾增删或队列需求，否则一律用 `ArrayList`，`Vector` 因全方法加锁已过时，请用 `Collections.synchronizedList` 或 `CopyOnWriteArrayList` 代替。

## 三、ArrayList 扩容机制

`ArrayList` 默认空构造时容量为 **0**，第一次 `add` 才扩容到 **10**（`DEFAULT_CAPACITY`）。之后容量不够就扩容为原来的 **1.5 倍**（旧容量 `+` 旧容量右移 1 位），用 `Arrays.copyOf` 把老数组拷贝过去。

```java
// 扩容核心（简化版源码逻辑）
int newCapacity = oldCapacity + (oldCapacity >> 1); // 1.5 倍
elementData = Arrays.copyOf(elementData, newCapacity);
```

扩容要拷贝数组，有性能代价。所以：

- **已知大概数据量时，构造时指定容量**：`new ArrayList<>(1000)`，避免反复扩容。
- 估算例子：要存 1000 条订单，直接 `new ArrayList<>(1000)`，而不要 `new ArrayList<>()` 让它从 10 一路扩到 1500。

```java
package com.canoe.core.collection;

import java.util.ArrayList;
import java.util.List;

public class CapacityDemo {
    public static void main(String[] args) {
        // 不指定：可能扩容多次（10 -> 15 -> 22 -> 33 ...）
        List<Integer> a = new ArrayList<>();

        // 指定初始容量：一次到位，性能更优
        List<Integer> b = new ArrayList<>(1000);
        for (int i = 0; i < 1000; i++) {
            b.add(i);
        }
        System.out.println("容量预估后，无需扩容，直接装满：" + b.size());
    }
}
```

## 四、Set

`Set` 的核心是「不可重复」，三种实现各有侧重：

- **HashSet**：基于 `HashMap`，无序、最快。
- **LinkedHashSet**：在 `HashSet` 基础上用链表记录插入顺序。
- **TreeSet**：基于红黑树，自动按元素排序，查找 `O(log n)`。

**去重原理：hashCode + equals 的约定**。一个对象要进 `HashSet`，先算 `hashCode` 决定落哪个桶，再在同一个桶里用 `equals` 比对。约定是：

- 两个对象 `equals` 为 true，它们的 `hashCode` 必须相等。
- `hashCode` 相等，对象不一定 `equals` 相等（哈希冲突，正常）。

**经典坑：只重写 `equals` 不重写 `hashCode`，去重直接失效**。看错误示例：

```java
package com.canoe.core.collection;

import java.util.HashSet;
import java.util.Objects;
import java.util.Set;

// 错误示范：只重写 equals，没重写 hashCode
class StudentBad {
    private final int id;
    private final String name;

    StudentBad(int id, String name) {
        this.id = id;
        this.name = name;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof StudentBad)) return false;
        StudentBad that = (StudentBad) o;
        return id == that.id && Objects.equals(name, that.name);
    }
    // 没有重写 hashCode —— 两个 equals 相等的对象被当成不同桶，去重失败
}

// 正确示范：equals 和 hashCode 一起重写
class StudentGood {
    private final int id;
    private final String name;

    StudentGood(int id, String name) {
        this.id = id;
        this.name = name;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof StudentGood)) return false;
        StudentGood that = (StudentGood) o;
        return id == that.id && Objects.equals(name, that.name);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, name); // 关键：equals 用到的字段都要进 hashCode
    }
}

public class SetDedupDemo {
    public static void main(String[] args) {
        Set<StudentBad> bad = new HashSet<>();
        bad.add(new StudentBad(1, " canoe "));
        bad.add(new StudentBad(1, " canoe "));
        System.out.println("只重写 equals -> 去重失败, size=" + bad.size()); // 2

        Set<StudentGood> good = new HashSet<>();
        good.add(new StudentGood(1, " canoe "));
        good.add(new StudentGood(1, " canoe "));
        System.out.println("equals+hashCode 都重写 -> 去重成功, size=" + good.size()); // 1
    }
}
```

**铁律**：只要把对象放进 `HashSet`/`HashMap`，`equals` 和 `hashCode` 必须一对儿重写，且用到的字段要保持一致（别拿可变字段算 hash，否则对象进集合后改字段就找不到了）。

## 五、Queue 与 Deque

`Queue`（队列，先进先出）和 `Deque`（双端队列）有一组「容易混淆」的方法，核心区别是**失败时的态度**：

```text
操作      抛异常版          返回特殊值版（推荐）
入队      add(e)            offer(e)      —— 队列满时返回 false
出队      remove()          poll()        —— 队列空时返回 null
查看队首  element()         peek()        —— 队列空时返回 null
```

**常考点**：`add/remove/element` 在失败时会抛 `IllegalStateException`；`offer/poll/peek` 失败只返回 `false`/`null`，更适合常规业务逻辑。

```java
package com.canoe.core.collection;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.PriorityQueue;
import java.util.Queue;

public class QueueDemo {
    public static void main(String[] args) {
        // ArrayDeque 推荐替代 Stack，既快又安全
        Deque<String> stack = new ArrayDeque<>();
        stack.push("a");
        stack.push("b");
        System.out.println(stack.pop()); // b（后进先出）

        // PriorityQueue 是堆，出队按优先级（默认自然序）
        Queue<Integer> pq = new PriorityQueue<>();
        pq.offer(3);
        pq.offer(1);
        pq.offer(2);
        System.out.println(pq.poll()); // 1（最小的元素先出）
        System.out.println(pq.peek()); // 2（看队首不删除，返回特殊值版）
    }
}
```

`ArrayDeque` 既当栈又当队列，性能比老古董 `Stack`（继承自 `Vector`，全同步）好得多，**别再用 `Stack` 了**。

## 六、Map

`Map` 存键值对，常见实现对比：

```text
实现类             底层            顺序        线程安全    适用
HashMap           数组+链表+红黑树 无序        否         最常用
LinkedHashMap     同 HashMap       保持插入顺序 否         需要按插入/访问顺序
TreeMap           红黑树           key 排序    否         需要排序
Hashtable         数组+链表        无序        是(同步)   已过时
ConcurrentHashMap 数组+链表+红黑树 无序        是(CAS)    高并发
```

**遍历 Map 的四种方式**：

```java
package com.canoe.core.collection;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

public class MapTraverseDemo {
    public static void main(String[] args) {
        Map<String, Integer> map = new HashMap<>();
        map.put("apple", 1);
        map.put("banana", 2);
        map.put("cherry", 3);

        // 1. 通过 keySet 遍历（要二次查表，最慢）
        for (String k : map.keySet()) {
            System.out.println(k + "=" + map.get(k));
        }

        // 2. 通过 entrySet 遍历（最常用，一次拿到 k 和 v）
        for (Map.Entry<String, Integer> entry : map.entrySet()) {
            System.out.println(entry.getKey() + "=" + entry.getValue());
        }

        // 3. 通过 values 只取 value
        for (Integer v : map.values()) {
            System.out.println(v);
        }

        // 4. JDK 8 forEach + Lambda（最简洁）
        map.forEach((k, v) -> System.out.println(k + "->" + v));
    }
}
```

**推荐用 `entrySet`**：它一次把 key 和 value 都拿到，不用像 `keySet` 那样每轮再 `get` 一次（HashMap 的 `get` 是 O(1) 但也是浪费）。

## 七、HashMap 底层原理

这是集合篇最难也最重要的一节。`HashMap` 在 JDK 8 的数据结构是：**数组 + 链表 + 红黑树**。

```text
HashMap 结构示意
table[]  ──▶ [null]
          [桶0] ──▶ Node("k1",v1) ──▶ Node("k2",v2)   （链表，hash 冲突时挂后面）
          [桶1] ──▶ null
          [桶2] ──▶ TreeNode(红黑树)  （链表长度超过 8 且数组容量≥64 时树化）
```

几个关键点一次讲透：

- **hash 扰动函数**：`key.hashCode()` 高位也参与运算，减少冲突：
  `(h = key.hashCode()) ^ (h >>> 16)`。
- **下标计算**：`(n - 1) & hash`，`n` 是容量。因为容量是 2 的幂，`(n-1)` 是低位的全 1 掩码，与运算等价于取模且更快。
- **为什么容量是 2 的幂**：只有 2 的幂减 1 才是 `...1111` 的掩码，才能让 `&` 运算均匀散列到每个桶。
- **链表树化阈值 8**：链表长度 ≥ 8 且数组容量 ≥ 64 时转红黑树（查询从 O(n) 降到 O(log n)）；**退树化阈值 6**：树节点降到 6 时退回链表（避免 7/8 之间反复横跳）。
- **负载因子 0.75**：元素数超过 `容量 × 0.75` 就扩容（2 倍）并 rehash。0.75 是「空间」与「冲突概率」的折中——太小浪费空间，太大冲突加剧。
- **JDK 8 头插改尾插**：JDK 7 扩容时链表头插法在并发下会形成环形链表导致死循环；JDK 8 改成尾插，避免了这个问题（但 `HashMap` 本身仍**非线程安全**，别在并发里用）。

```java
package com.canoe.core.collection;

import java.util.HashMap;
import java.util.Map;

public class HashMapDemo {
    public static void main(String[] args) {
        Map<String, String> map = new HashMap<>(16); // 指定初始容量减少扩容
        map.put("name", " canoe ");
        map.put("site", "notes");
        System.out.println(map.get("name")); //  canoe

        // 允许一个 null key 和多个 null value（Hashtable 不允许）
        map.put(null, "空键也行");
        System.out.println(map.get(null));
    }
}
```

## 八、ConcurrentHashMap

并发安全的 Map。两个版本差异巨大：

- **JDK 7**：分段锁 `Segment`，把数据分成 16 段，每段一把锁，并发度 16。
- **JDK 8**：废弃分段锁，改用 **`CAS` + `synchronized`** 锁定单个桶的头节点，锁粒度更细，并发度更高。

几个要点：

- **不允许 `null` key/value**：并发下 `get` 返回 `null` 无法区分「没这 key」还是「value 就是 null」，会带来歧义，所以直接禁止。
- **`size()` 实现**：不是简单维护一个计数器，而是用分片计数（`baseCount` + `CounterCell[]`），求和时近似准确，避免为计数加全局锁。

```java
package com.canoe.core.collection;

import java.util.concurrent.ConcurrentHashMap;

public class ConcurrentMapDemo {
    public static void main(String[] args) {
        ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();
        map.put("a", 1);
        // 线程安全的 compute，原子地「没有就放、有就加」
        map.computeIfAbsent("b", k -> 2);
        map.merge("a", 10, Integer::sum); // a 变成 11
        System.out.println(map); // {a=11, b=2}
    }
}
```

更深入的分段、扩容转移、`ForwardingNode` 等见并发专题。

## 九、Collections 与 Collection 的区别

名字只差一个 `s`，天差地别：

- **`Collection`**：是接口，顶层父接口（`List`、`Set` 都继承它）。
- **`Collections`**：是工具类，一堆静态方法，专门操作集合。

```java
package com.canoe.core.collection;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class CollectionsDemo {
    public static void main(String[] args) {
        List<String> list = new ArrayList<>();
        list.add("b");
        list.add("a");
        list.add("c");

        Collections.sort(list);                 // 排序
        System.out.println(list);               // [a, b, c]
        System.out.println(Collections.max(list)); // c

        // 不可变集合（只读，写会抛 UnsupportedOperationException）
        List<String> frozen = Collections.unmodifiableList(list);
        // JDK 9+ 更简洁：List.of("a", "b", "c")
        List<String> of = List.of("a", "b");
        System.out.println(of);

        // 空集合单例，避免返回 null
        List<String> empty = Collections.emptyList();
        System.out.println(empty.isEmpty()); // true

        // 单元素集合
        List<String> one = Collections.singletonList("only");
        System.out.println(one);
    }
}
```

**经验**：需要返回空集合时返回 `Collections.emptyList()` 而不是 `null`，调用方就不用担心 NPE。

## 十、迭代器 Iterator

`Iterator` 是遍历集合的统一方式，基于**迭代器模式**：`hasNext()` 判断还有没有、`next()` 取下一个。

```java
package com.canoe.core.collection;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class IteratorDemo {
    public static void main(String[] args) {
        List<String> list = new ArrayList<>();
        list.add("a");
        list.add("b");
        list.add("c");

        Iterator<String> it = list.iterator();
        while (it.hasNext()) {
            String s = it.next();
            if ("b".equals(s)) {
                it.remove(); // 正确姿势：用迭代器自己的 remove
            }
        }
        System.out.println(list); // [a, c]
    }
}
```

**fail-fast（快速失败）机制**：`ArrayList` 内部有个 `modCount`（修改次数）计数器。迭代过程中一旦发现集合被结构性修改（新增/删除），就会抛 `ConcurrentModificationException`。

```java
// 错误：用集合的 remove 会破坏 fail-fast，抛异常
for (String s : list) {
    if ("b".equals(s)) {
        list.remove(s); // ConcurrentModificationException
    }
}
```

删除元素的**正确姿势**有两个：

- 用 `iterator.remove()`（如上例）。
- JDK 8+ 用 `list.removeIf(s -> "b".equals(s))`。

## 十一、Stream API 简介

`Stream` 让集合操作像写 SQL 一样声明式，配合 Lambda 清爽无比：

```java
package com.canoe.core.collection;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public class StreamDemo {
    public static void main(String[] args) {
        List<Integer> nums = Arrays.asList(5, 3, 8, 1, 3, 9, 2);

        // 传统写法：过滤偶数 + 排序 + 收集
        // Stream 写法：
        List<Integer> result = nums.stream()
                .filter(n -> n % 2 == 1)   // 只留奇数
                .distinct()                // 去重
                .sorted()                  // 排序
                .collect(Collectors.toList());
        System.out.println(result); // [1, 3, 5, 9]

        // 链式统计
        long count = nums.stream().filter(n -> n > 3).count();
        System.out.println("大于3的个数: " + count); // 4

        // 转 map：name -> length
        List<String> names = Arrays.asList("canoe", "note", "java");
        names.stream().map(String::length).forEach(System.out::println); // 5 4 4
    }
}
```

常用算子：`filter`（过滤）、`map`（转换）、`sorted`（排序）、`distinct`（去重）、`collect`（收集）、`forEach`（遍历）。注意 `Stream` 本身不存数据，是「流水线」，用过即弃。

## 十二、集合选型速查

拿到需求，先问几个问题：

```text
需求                        该选
要保留插入顺序、按索引访问      ArrayList
频繁在头部/中间增删             LinkedList
要「去重」                      HashSet（要排序用 TreeSet）
要去重且保持插入顺序            LinkedHashSet
要「键值对」查询                HashMap（要顺序用 LinkedHashMap/TreeMap）
要按 key 排序                   TreeMap
要先进先出队列                  ArrayDeque / LinkedList
要优先级出队                    PriorityQueue
要高并发读写 Map                ConcurrentHashMap
要线程安全的 List               CopyOnWriteArrayList
只读/空/单元素集合              List.of / Collections.emptyList / singletonList
```

一句话：**日常 90% 用 `ArrayList` + `HashMap`**，其余按上表对号入座。

## 本篇小结

- **集合分 Collection（单列）与 Map（双列）** 两大体系，面向接口编程用 `List`/`Map`。
- **`ArrayList` 查快改慢、`LinkedList` 改快查慢**，99% 场景用 `ArrayList`。
- **`Vector` 已过时**，并发请用 `CopyOnWriteArrayList` 或 `Collections.synchronizedList`。
- **`ArrayList` 默认容量 10、扩容 1.5 倍**，已知量时构造指定初始容量。
- **`Set` 去重靠 `hashCode` + `equals`**，两者必须一起重写，否则去重失效。
- **`Queue` 优先用 `offer/poll/peek`**，失败返回特殊值而非抛异常。
- **`ArrayDeque` 应替代 `Stack`**，既当栈又当队列且更快。
- **遍历 `Map` 首选 `entrySet`**，避免 `keySet` 二次查表。
- **`HashMap` 是数组+链表+红黑树**，下标用 `(n-1)&hash`，容量必须为 2 的幂。
- **树化阈值 8、退树化 6、负载因子 0.75**，JDK 8 尾插避免并发死循环。
- **`ConcurrentHashMap` 用 CAS+synchronized`，不允许 null 键值**。
- **遍历中删除用 `iterator.remove()` 或 `removeIf`**，否则触发 fail-fast 异常。

## 参考链接

- [Java 官方文档：Collection Framework](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Collection.html)
- [Java 官方文档：HashMap](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/HashMap.html)
- [OpenJDK HashMap 源码](https://github.com/openjdk/jdk17u/blob/master/src/java.base/share/classes/java/util/HashMap.java)
- [Oracle 教程：Aggregate Operations (Stream)](https://docs.oracle.com/javase/tutorial/collections/streams/)
- [Baeldung：Java Collections](https://www.baeldung.com/java-collections)
- [Baeldung：Guide to ConcurrentHashMap](https://www.baeldung.com/java-concurrent-hashmap)
- [Java 官方文档：ConcurrentHashMap](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html)

下一篇 → [04 IO 流](/java/core/io)
