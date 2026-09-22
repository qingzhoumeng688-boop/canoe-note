# 12 组合模式

你见过那种"套娃"式的公司架构吗：研发部下面有研发一组、研发二组，组里又有普通员工，组里还能再挂子部门——可不管你是 CEO 还是刚入职的小弟，老板问一句"全公司本月总薪资是多少"，系统得一层层把所有人加起来。组合模式（Composite）就是专门对付这种**"整体—部分"树形结构**的：它让"单个对象"和"对象组合"用**同一套接口**对待，你不用写一堆 `if (是部门) ... else (是员工) ...` 的恶心判断。本文用公司组织架构的例子，把透明式与安全式两种写法一次讲清。

## 一、它是什么

**一句话大白话**：组合模式让"一片叶子"和"一捆树枝"长得一模一样，你随便怎么套娃都能统一处理。

生活化比喻：想象一个文件夹。文件夹里可以放**文件**，也可以放**子文件夹**；而子文件夹里又能继续放文件和文件夹。当你右键"查看文件夹大小"时，系统不会管它是文件还是文件夹，统一递归地把它当成"能算大小的东西"来加总——文件返回自身大小，文件夹返回它所有子项大小之和。这个"一视同仁"的能力，就是组合模式。

GoF 官方定义：

> 将对象组合成**树形结构**以表示"部分—整体"的层次结构，使得用户对单个对象和组合对象的使用具有**一致性**。

关键词是"**一致性**"——客户端不必知道面前这个节点到底是叶子还是容器，调用同一个方法（如 `getSalary()`、`getSize()`）即可。

## 二、为什么需要它（不用会怎样）

还是公司薪资统计的例子。不用组合模式，客户端得自己判断节点类型、写递归：

```java
// 反面教材：没有组合模式，客户端被迫感知"员工 vs 部门"的差异
public class BadClient {
    public static void main(String[] args) {
        // 假设有 Employee 和 Department 两个没有共同父接口的类
        Department 研发部 = new Department("研发部");
        研发部.add(new Employee("张三", 12000));
        Department 研发一组 = new Department("研发一组");
        研发一组.add(new Employee("李四", 15000));
        研发部.add(研发一组);

        // 客户端为了计算总薪资，不得不写一堆 instanceof 分支
        int total = 0;
        for (Object node : 研发部.getChildren()) {
            if (node instanceof Employee) {
                total += ((Employee) node).getSalary();
            } else if (node instanceof Department) {
                // 部门还要继续递归，逻辑散落、易漏写
                total += sumDepartment((Department) node);
            }
        }
        System.out.println("总薪资：" + total);
    }

    // 递归逻辑被甩给客户端，且和 Department 内部实现强耦合
    private static int sumDepartment(Department dept) {
        int sum = 0;
        for (Object node : dept.getChildren()) {
            if (node instanceof Employee) {
                sum += ((Employee) node).getSalary();
            } else if (node instanceof Department) {
                sum += sumDepartment((Department) node);
            }
        }
        return sum;
    }
}
```

痛点：

1. **客户端被迫写 `if-else` 类型分支**：每加一种节点类型，所有调用点都要改。
2. **递归逻辑散落各处**：谁统计谁负责递归，业务代码和树遍历逻辑搅在一起。
3. **违反开闭原则**：新增"外包团队"这类节点，得回去改所有 `instanceof` 判断。

组合模式把"递归加总"的能力**内聚到节点自身**：每个节点都懂"怎么算自己的贡献"，客户端只管对根节点调一次，树自己就遍历完了。

## 三、结构与角色

```text
            ┌─────────────────┐
            │  CompanyNode    │ ← 抽象构件 Component（叶子与容器共同接口）
            │  (抽象节点)     │
            └────────┬────────┘
                     │ 实现
          ┌──────────┴──────────┐
          │                     │
   ┌──────┴──────┐      ┌───────┴────────┐
   │   Employee  │      │   Department    │ ← 容器构件 Composite
   │ (叶子节点)  │      │  (容器/分支节点) │
   │ 返回自身薪资│      │ 持有子节点列表    │
   └─────────────┘      │ 递归汇总子节点   │
                        └───────┬────────┘
                                │ 持有
                        ┌───────┴────────┐
                        │  子 CompanyNode │
                        │ (员工 或 子部门) │
                        └────────────────┘
```

| 角色 | 对应类 | 职责 |
| --- | --- | --- |
| **抽象构件 Component** | `CompanyNode` | 声明叶子和容器共有的方法（如 `getSalary()`、`print()`），也可声明管理子节点的方法 |
| **叶子构件 Leaf** | `Employee` | 没有子节点，方法直接返回自身结果（如自身薪资） |
| **容器构件 Composite** | `Department` | 持有子节点集合，管理子节点，并递归汇总子节点结果 |
| **客户端 Client** | `CompositeDemo` | 面向抽象构件编程，无需区分叶子与容器 |

## 四、代码实现

下面用"透明方式"先写一版完整可运行的代码（管理方法 `add/remove` 都定义在抽象构件里，客户端最省心）。

```java
package com.canoe.pattern.composite;

import java.util.ArrayList;
import java.util.List;

// 抽象构件：公司节点（员工和部门都具备的能力）
interface CompanyNode {
    void add(CompanyNode node);      // 添加下属
    void remove(CompanyNode node);   // 移除下属
    int getSalary();                 // 计算薪酬（叶子返回自身，容器返回汇总）
    void print(String indent);       // 打印组织结构
}

// 叶子构件：普通员工，没有下属
class Employee implements CompanyNode {
    private String name;
    private int salary;

    public Employee(String name, int salary) {
        this.name = name;
        this.salary = salary;
    }

    @Override
    public void add(CompanyNode node) {
        // 叶子不支持添加下属，透明方式下只能抛异常或空实现
        throw new UnsupportedOperationException("员工节点下不能添加下属");
    }

    @Override
    public void remove(CompanyNode node) {
        throw new UnsupportedOperationException("员工节点下不能删除下属");
    }

    @Override
    public int getSalary() {
        return salary; // 叶子直接返回自身薪资
    }

    @Override
    public void print(String indent) {
        System.out.println(indent + "员工：" + name + "，薪资 " + salary);
    }
}

// 容器构件：部门，可包含员工和其他子部门
class Department implements CompanyNode {
    private String name;
    // 子节点列表，元素既可以是员工也可以是部门
    private List<CompanyNode> children = new ArrayList<CompanyNode>();

    public Department(String name) {
        this.name = name;
    }

    @Override
    public void add(CompanyNode node) {
        children.add(node);
    }

    @Override
    public void remove(CompanyNode node) {
        children.remove(node);
    }

    @Override
    public int getSalary() {
        // 容器递归汇总所有子节点的薪资
        int total = 0;
        for (CompanyNode node : children) {
            total += node.getSalary();
        }
        return total;
    }

    @Override
    public void print(String indent) {
        System.out.println(indent + "部门：" + name + "（部门总薪资 " + getSalary() + "）");
        for (CompanyNode node : children) {
            node.print(indent + "  "); // 递归打印子树
        }
    }
}
```

客户端只管对根节点调用，完全不关心里面是员工还是部门：

```java
public class CompositeDemo {
    public static void main(String[] args) {
        // 叶子：普通员工
        Employee 张三 = new Employee("张三", 12000);
        Employee 李四 = new Employee("李四", 15000);
        Employee 王五 = new Employee("王五", 18000);
        Employee 赵六 = new Employee("总监赵六", 40000);

        // 子部门
        Department 研发一组 = new Department("研发一组");
        研发一组.add(张三);
        研发一组.add(李四);

        Department 研发二组 = new Department("研发二组");
        研发二组.add(王五);

        // 根部门：把子部门和员工任意组合成一棵树
        Department 研发部 = new Department("研发部");
        研发部.add(研发一组);
        研发部.add(研发二组);
        研发部.add(赵六);

        // 客户端无差别地调用，树自己递归完成统计
        研发部.print("");
        System.out.println("全公司研发部总薪资：" + 研发部.getSalary());
    }
}
```

运行后输出会漂亮地打印出整棵组织架构树，并打印汇总薪资 `85000`（12000+15000+18000+40000）。

## 五、透明方式 vs 安全方式

组合模式有一个经典的两难选择，关键在于"管理子节点的方法（`add/remove`）放在哪里"：

**① 透明方式（上面用的）**：把 `add/remove` 定义在抽象构件 `CompanyNode` 里。优点是客户端可以**无差别地**对任何节点调用 `add`，不用转型；缺点是叶子 `Employee` 被迫实现这些方法，只能空实现或抛 `UnsupportedOperationException`，存在"调用了却不支持"的隐患。

**② 安全方式**：只在容器 `Department` 里声明 `add/remove`，抽象构件只保留 `getSalary/print`。这样叶子绝不会暴露不支持的方法，类型更安全：

```java
// 安全方式：抽象构件只保留公共业务方法
interface SafeNode {
    int getSalary();
    void print(String indent);
}

// 叶子：只有业务方法，根本没有 add/remove
class SafeEmployee implements SafeNode {
    private String name;
    private int salary;
    public SafeEmployee(String name, int salary) { this.name = name; this.salary = salary; }
    @Override public int getSalary() { return salary; }
    @Override public void print(String indent) {
        System.out.println(indent + "员工：" + name + "，薪资 " + salary);
    }
}

// 容器：单独声明管理方法
class SafeDepartment implements SafeNode {
    private String name;
    private List<SafeNode> children = new ArrayList<SafeNode>();
    public SafeDepartment(String name) { this.name = name; }
    public void add(SafeNode node) { children.add(node); }   // 管理方法只在这里
    public void remove(SafeNode node) { children.remove(node); }
    @Override public int getSalary() {
        int total = 0;
        for (SafeNode node : children) { total += node.getSalary(); }
        return total;
    }
    @Override public void print(String indent) {
        System.out.println(indent + "部门：" + name + "（总薪资 " + getSalary() + "）");
        for (SafeNode node : children) { node.print(indent + "  "); }
    }
}
```

| 对比点 | 透明方式 | 安全方式 |
| --- | --- | --- |
| 管理方法位置 | 抽象构件里（叶子也继承） | 只在容器里 |
| 客户端体验 | 统一调用，无需转型（爽） | 操作容器需向下转型或提前持有容器引用 |
| 类型安全 | 弱（叶子可能抛异常） | 强（叶子根本没有管理方法） |
| 适用偏好 | 多数框架默认，代码最简洁 | 对安全性要求极高的场景 |

实践中**透明方式更常用**，因为"一视同仁"正是组合模式的初衷；只要文档写清叶子不支持增删即可。

## 六、实际应用

- **文件系统目录树**：`java.io.File` 既能是文件也能是目录，`listFiles()` 返回的子项仍可继续递归——天然的组合结构。
- **公司组织架构 / 菜单树**：菜单里有"菜单项"，也有"子菜单"，子菜单还能嵌套，渲染和权限统计统一递归处理。
- **杀毒软件扫描**：对"文件"直接扫描，对"文件夹"递归扫描其下所有文件，组合模式让扫描逻辑统一。
- **MyBatis `SqlNode`**：MyBatis 把一条 SQL 拆成一堆 `SqlNode`（`<if>`、`<foreach>`、`<trim>` 等），它们组建成一棵树，`apply` 时统一递归拼接 SQL，正是组合模式的经典落地。
- **Java AWT / Swing `Container`**：`Component` 是抽象构件，`Container` 是容器，`Button`/`Label` 是叶子，布局与事件分发统一对待。

## 七、优缺点

| 优点 | 缺点 |
| --- | --- |
| **客户端一致**：无需区分叶子与容器，代码更干净 | **设计抽象**：对"只有单一类型节点"的场景属于过度设计 |
| **递归内聚**：遍历逻辑收进节点自身，不泄漏给客户端 | **类型安全弱**（透明方式下叶子被迫实现不支持的方法） |
| **易扩展**：新增节点类型只需实现抽象构件，符合开闭原则 | **限制模糊**：运行时才发现叶子不能 add，编译期拦不住 |
| **天然表达树**：部分—整体层次结构一目了然 | **过度通用**：抽象构件接口易被撑大，承载了本不属于叶子的能力 |
| **统一操作**：增删、统计、渲染都能对整棵树一次性完成 | 深层嵌套树递归过深可能有栈溢出风险 |

## 八、适用场景

1. **想表示"部分—整体"的层次结构**：文件系统、组织架构、菜单、UI 组件树。
2. **希望客户端统一对待单个对象和组合对象**：不想写一堆 `instanceof` 分支。
3. **需要频繁对整棵树做递归操作**：统计汇总、权限遍历、渲染、扫描。
4. **节点类型会动态增减**：新增一种"外包组"也能无缝接入现有树。

**什么情况下不要用**：如果系统里**根本没有树形、也没有"整体—部分"关系**，或者节点类型永远单一（只有叶子没有容器），硬套组合模式只会增加无谓的抽象层。

## 九、在 JDK / 开源框架中的应用

- **`java.awt.Container` / `java.awt.Component`**：Swing 的 UI 树，容器持有子组件，布局与绘制统一递归——组合模式的教科书级实现。
- **`java.io.File`**：`File` 既表示文件也表示目录，`listFiles()` 返回的数组元素本身又是 `File`，可继续递归，隐式地是组合结构。
- **MyBatis `SqlNode`**：`MixedSqlNode`、`IfSqlNode`、`ForEachSqlNode` 等构成 SQL 片段树，`DynamicContext` 递归 `apply` 拼出最终 SQL。
- **Spring `CompositeBeanDefinition` / 各种 `*Composite`**：Spring 内部常用组合模式把多个同类型组件聚合成一个逻辑组件对外暴露。

设计意图一致：**用统一的抽象构件抹平"单个 vs 组合"的差异，把递归遍历的责任交给节点自身**。

## 十、与相近模式的区别

| 模式 | 目的 | 与组合的区别 |
| --- | --- | --- |
| **装饰器 Decorator** | 给对象**动态叠加功能**，结构也是嵌套 | 装饰器强调"增强"，且通常只包装**单个**对象；组合强调"树形整体—部分"，包装的是**一组**对象 |
| **享元 Flyweight** | 共享细粒度对象**节省内存** | 享元关注对象内部状态共享；组合关注对象的**层次组织**，二者关注点完全不同，甚至可协作（组合树的叶子用享元共享） |

记忆口诀：**组合管"怎么把一堆东西组织成树"，装饰器管"给一个东西加戏"**。

## 本篇小结

- **组合模式**用统一接口对待"单个对象"和"对象组合"，消除 `if-else` 类型分支。
- 经典三角色：**抽象构件、叶子构件、容器构件**，容器持有子节点列表。
- 递归汇总逻辑被**内聚到节点自身**，客户端只调根节点一次即可。
- **透明方式**把 `add/remove` 放进抽象构件，客户端最省心但类型安全弱。
- **安全方式**只在容器里声明管理方法，类型更安全但客户端需持有容器引用。
- 叶子节点在透明方式下对 `add/remove` 只能**空实现或抛异常**。
- 适合"**部分—整体**"树形结构：文件系统、组织架构、菜单、UI 组件树。
- MyBatis 的 **`SqlNode`** 就是组合模式的经典落地（SQL 片段树）。
- Java AWT 的 **`Container`/`Component`** 是组合模式的原生范例。
- 组合模式符合**开闭原则**：新增节点类型不改动现有遍历代码。
- 它和**装饰器**不同：装饰器增强单个对象，组合组织一组对象成树。
- 深层嵌套树递归要警惕**栈溢出**，超大树建议改写迭代或限制深度。

## 参考链接

- [Refactoring Guru · Composite Pattern（英文）](https://refactoring.guru/design-patterns/composite)
- [Refactoring Guru · 组合模式（中文）](https://refactoringguru.cn/design-patterns/composite)
- [菜鸟教程 · 组合模式](https://www.runoob.com/design-pattern/composite-pattern.html)
- [Oracle JDK · java.awt.Container](https://docs.oracle.com/javase/8/docs/api/java/awt/Container.html)
- [Oracle JDK · java.io.File](https://docs.oracle.com/javase/8/docs/api/java/io/File.html)
- [MyBatis 官方文档](https://mybatis.org/mybatis-3/)
- [Wikipedia · Composite Pattern](https://en.wikipedia.org/wiki/Composite_pattern)

下一篇 → [13 享元模式](/java/design-pattern/flyweight)
