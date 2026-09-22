# 24 解释器模式

> 本篇导读：你有没有想过，"3 + 4 - 2"这种字符串，计算器是怎么一步步算出 5 的？解释器模式就来解决这类问题：给定一门**简单的语言文法**，定义一个解释器，把句子（表达式）翻译成可执行的动作。它解决的是**如何为一类固定、简单的规则构造一个解释引擎**，让新增规则像"拼积木"一样组合语法树。

## 一、它是什么

一句话大白话：**解释器模式把一套规则（文法）写成一个个"表达式类"，再用它们拼成一棵树，让树自己递归地算出结果。**

生活化比喻：小时候玩的电子积木。数字是一块块基础积木（终结符），加减乘除是连接积木的接口件（非终结符）。你把"10、5、加、3、减"按规则拼起来，整座积木塔"通电"后就能跑出答案——这座塔就是抽象语法树，每一块都会"解释"自己该怎么算。

GoF 的官方定义是：

> Given a language, define a representation for its grammar along with an interpreter that uses the representation to interpret sentences in the language.
>
> （给定一个语言，定义它的文法的一种表示，并定义一个解释器，该解释器使用该表示来解释语言中的句子。）

## 二、为什么需要它（不用会怎样）

先看一段"硬算"的反面代码：用一大坨 `if-else` 解析表达式。

```java
// 反例：用 if-else 硬解析，加一种运算就改一通
public class BadCalculator {
    public int calc(String expr) {
        // 假设只支持 "a+b" 或 "a-b"
        if (expr.contains("+")) {
            String[] p = expr.split("\\+");
            return Integer.parseInt(p[0]) + Integer.parseInt(p[1]);
        } else if (expr.contains("-")) {
            String[] p = expr.split("-");
            return Integer.parseInt(p[0]) - Integer.parseInt(p[1]);
        }
        // 想支持 * / 括号？这里会继续膨胀成噩梦
        return 0;
    }
}
```

痛点：

1. **扩展即重写**：每加一种运算符，就要改 `calc()`，违反开闭原则。
2. **无法表达优先级与嵌套**：`(10+5)-3` 这种嵌套，用 split 根本没法优雅处理。
3. **逻辑与数据纠缠**：解析、计算、错误处理全挤在一个方法里。

解释器模式把"每种文法规则"固化成一个类，新的运算 = 新的类，拼成树后由树自己递归求值。

## 三、结构与角色

```text
        ┌───────────────┐
        │  Expression   │  抽象表达式（定义 interpret）
        └───────┬───────┘
      ┌─────────┴─────────┐
      │                   │
┌─────▼─────┐      ┌──────▼──────┐
│ Terminal   │      │ NonTerminal  │  非终结符表达式
│ Expression │      │ Expression   │  (加减等组合规则)
│ (数字/变量) │      └───┬─────┬───┘
└────────────┘          │     │ 持有子表达式
                  ┌─────▼┐   ┌▼─────┐
                  │左表达式│   │右表达式│
                  └──────┘   └──────┘
```

| 角色 | 类名（示例） | 职责 |
| --- | --- | --- |
| 抽象表达式 | `Expression` | 声明 `interpret()` 解释方法 |
| 终结符表达式 | `NumberExpression` | 文法中最基础的单元（数字），无子节点 |
| 非终结符表达式 | `AddExpression` / `SubExpression` | 组合其他表达式，递归解释得到结果 |
| 上下文（可选） | `Context` | 存放全局变量、符号表等解释所需的外部信息 |
| 客户端 | `InterpreterDemo` | 按文法把表达式拼成语法树并触发解释 |

## 四、代码实现

以四则运算中的**加减法**为例，构造一棵表达式树并求值。可直接运行。

```java
package com.canoe.pattern.interpreter;

// 抽象表达式：所有表达式节点都要能"解释"自己
public interface Expression {
    int interpret();   // 解释（求值）
}
```

```java
package com.canoe.pattern.interpreter;

// 终结符表达式：数字，最底层的叶子节点
public class NumberExpression implements Expression {
    private final int value;

    public NumberExpression(int value) {
        this.value = value;
    }

    @Override
    public int interpret() {
        return value;   // 数字直接返回自身
    }
}
```

```java
package com.canoe.pattern.interpreter;

// 非终结符表达式：加法
public class AddExpression implements Expression {
    private final Expression left;   // 左子树
    private final Expression right;  // 右子树

    public AddExpression(Expression left, Expression right) {
        this.left = left;
        this.right = right;
    }

    @Override
    public int interpret() {
        // 递归解释左右子树，再相加
        return left.interpret() + right.interpret();
    }
}
```

```java
package com.canoe.pattern.interpreter;

// 非终结符表达式：减法
public class SubExpression implements Expression {
    private final Expression left;
    private final Expression right;

    public SubExpression(Expression left, Expression right) {
        this.left = left;
        this.right = right;
    }

    @Override
    public int interpret() {
        return left.interpret() - right.interpret();
    }
}
```

```java
package com.canoe.pattern.interpreter;

// 演示入口：计算 (10 + 5) - 3
public class InterpreterDemo {
    public static void main(String[] args) {
        // 表达式：(10 + 5) - 3
        Expression expr = new SubExpression(
                new AddExpression(
                        new NumberExpression(10),
                        new NumberExpression(5)),
                new NumberExpression(3));

        System.out.println("计算结果：" + expr.interpret());  // 输出 12
    }
}
```

注意每个非终结符都持有子表达式，并**递归调用** `interpret()`——这正是解释器模式的核心：用组合 + 递归把文法"跑"起来。

## 五、抽象语法树 AST

上面的 `(10 + 5) - 3` 拼出来的抽象语法树长这样：

```text
            SubExpression (-)
           /                  \
   AddExpression (+)        NumberExpression(3)
        /        \
NumberExpression(10)   NumberExpression(5)
```

解释过程自底向上：叶子节点 `10`、`5` 先返回自身 → 加法节点算出 `15` → 减法节点用 `15 - 3` 得到 `12`。

- **终结符表达式（Terminal）**：对应文法里不可再分的基本符号，如数字、变量。它是树的叶子，没有子节点。
- **非终结符表达式（Non-terminal）**：对应文法里的组合规则（如加减），它持有若干子表达式，通过递归组合出复杂含义。

文法可以形式化写成：

```text
Expression ::= AddExpression | SubExpression | NumberExpression
AddExpression ::= Expression '+' Expression
SubExpression ::= Expression '-' Expression
NumberExpression ::= 数字字面量
```

理解了这条文法，你就知道为什么加一种运算（比如乘法）只需新增一个 `MulExpression` 类，无需碰原有代码。

## 六、实际应用与局限

**应用场景：**

- **正则表达式引擎**：正则本身就是一门小语言，匹配过程就是解释执行。
- **SQL 解析**：数据库把 SQL 解析成执行计划树，本质是对 SQL 文法的解释。
- **EL / SpEL 表达式**：Spring 的 `#{...}`、JSP 的 EL 表达式求值。
- **规则引擎 / 配置 DSL**：把业务规则写成简单脚本由解释器执行。
- **布尔表达式求值**：权限系统里 `(A AND B) OR C` 这类条件组合。

**局限（务必看清）：**

解释器模式**只适合文法简单、变化不频繁**的场景。一旦文法变复杂（多层括号、优先级、自定义函数），类数量会爆炸，性能也堪忧。工业级需求请直接使用 **ANTLR、JavaCC、Antlr4** 等 parser 生成器，或交给现成的脚本引擎（如 Groovy、JS 引擎）。

## 七、优缺点

| 优点 | 缺点 |
| --- | --- |
| 文法规则清晰，每种规则一个类，易读 | 文法复杂时类数量急剧膨胀 |
| 扩展新运算只需加类，符合开闭原则 | 递归解释，深层表达式性能差 |
| 用组合表达嵌套，天然支持优先级 | 难以处理左递归等复杂文法 |
| 易于实现小型 DSL | 错误处理、调试不如专用 parser |
| 把"数据"和"行为"绑在节点上 | 不适合大规模、高频解释场景 |

## 八、适用场景

- 需要解释执行一门**简单、稳定**的语言或规则（计算器、配置表达式）。
- 文法可以表示成**层次清晰的树结构**。
- 效率不是首要矛盾，代码清晰度更重要。
- 规则需要被**频繁组合**但类型有限（加减、与或非）。
- 想用少量代码快速验证一个 DSL 原型。

**什么时候不要用**：文法复杂多变、性能敏感、或需要完整词法/语法错误提示时，请直接上 **ANTLR** 这类工具，别硬撸解释器。

## 九、在 JDK / 开源框架中的应用

- **`java.util.regex.Pattern`**：正则表达式编译后形成内部匹配结构，匹配即"解释执行"正则文法（虽非教科书式解释器，思想同源）。
- **`javax.el.ELResolver` / Spring `SpEL`**：`org.springframework.expression.Expression` 及其实现就是典型的表达式解释体系。
- **`java.beans.Expression`**：JavaBeans 里的表达式封装，用于动态执行属性/方法调用。
- **`java.text.MessageFormat`**：按模式串 `{0}` 解释并填充参数，是轻量解释思想。
- **Groovy / JavaScript 引擎 (`ScriptEngine`)**：把脚本语言编译成可执行结构后解释运行，是解释器模式在工业级的延伸。

## 十、与相近模式的区别

| 对比模式 | 目的 | 结构 | 使用场景 |
| --- | --- | --- | --- |
| 解释器 vs 组合 | 解释器用组合来表达文法并求值；组合只描述"部分-整体"树形结构 | 解释器节点带 `interpret()` 行为；组合节点通常只存数据/操作 | 要"算"出结果用解释器；只组织层级结构用组合 |
| 解释器 vs 访问者 | 解释器在节点内自带解释逻辑；访问者把操作抽出来集中到 Visitor | 解释器逻辑分散在各节点；访问者逻辑集中在访问者类 | 文法稳定、操作也稳定用解释器；操作常变、结构稳定用访问者 |

## 本篇小结

- **解释器模式**为简单文法定义表示，并提供解释器把句子翻译成动作。
- 核心是**抽象语法树（AST）**，靠组合 + 递归 `interpret()` 求值。
- 两类节点：**终结符**（数字/变量，叶子）与**非终结符**（加减等组合规则）。
- 新增一种运算只需新增一个表达式类，**符合开闭原则**。
- 每类规则一个类，文法清晰但**复杂文法会类爆炸**。
- 经典应用：正则、**SQL 解析**、**SpEL/EL 表达式**、规则引擎。
- 它只适合**简单、稳定**的文法，别拿它硬刚复杂语言。
- 工业级需求请改用 **ANTLR / JavaCC** 或脚本引擎，而非手写解释器。
- 与**组合模式**形似：都用语法树，但解释器节点自带求值行为。
- 与**访问者模式**互补：操作多变时用访问者把逻辑从节点中抽离。
- 递归解释有**性能成本**，深层表达式要谨慎。
- JDK 的 `Pattern`、Spring 的 `SpEL` 都体现了解释器思想。

## 参考链接

- [Refactoring Guru · Interpreter](https://refactoring.guru/design-patterns/interpreter)
- [SourceMaking · Interpreter Pattern](https://sourcemaking.com/design_patterns/interpreter)
- [GeeksforGeeks · Interpreter Design Pattern](https://www.geeksforgeeks.org/interpreter-design-pattern/)
- [TutorialsPoint · Interpreter Pattern](https://www.tutorialspoint.com/design_pattern/interpreter_pattern.htm)
- [Wikipedia · Interpreter pattern](https://en.wikipedia.org/wiki/Interpreter_pattern)
- [ANTLR 官方文档](https://www.antlr.org/)
- [菜鸟教程 · 解释器模式](https://www.runoob.com/design-pattern/interpreter-pattern.html)

下一篇 → [25 Spring 框架中的设计模式](/java/design-pattern/spring-patterns)
