# 04 工厂三兄弟

开一家披萨店，你希望顾客点"芝士披萨"就出芝士、点"榴莲披萨"就出榴莲；换到物流场景，发货时选"顺丰"就走顺丰、选"京东"就走京东。如果让调用方自己 `new CheesePizza()`、`new DurianPizza()`，一旦新增口味或换承运商，所有调用点都得改——这正是工厂模式要收拾的烂摊子。本文用"披萨店"和"物流公司"两条线，把**简单工厂、工厂方法、抽象工厂**这三位"兄弟"讲透：它们不是同一个模式的三种叫法，而是抽象程度递进而已。

## 一、它是什么

一句话大白话：**工厂模式把"new 对象"这件事，从调用方手里收走，交给一个专门的"工厂"去做**。调用方只说"我要什么"，工厂负责"怎么造"。

生活化比喻：你去麦当劳点餐，不会冲进后厨自己炸薯条，而是对收银员说"来份巨无霸"，后厨（工厂）把做好的汉堡递给你。你只关心"要什么"，不关心"怎么做的、用哪个锅"——这就是工厂帮你屏蔽的创建细节。

经典定义（GoF，工厂方法）：**Define an interface for creating an object, but let subclasses decide which class to instantiate.** 定义一个创建对象的接口，让子类决定实例化哪一个类。工厂方法使一个类的实例化延迟到其子类。

三兄弟定位：简单工厂是"小作坊"（一个方法里用 if-else 分拣），工厂方法是"品牌加盟店"（每种产品一个专属工厂），抽象工厂是"跨国集团"（一个工厂能造一整个产品族）。

## 二、为什么需要它（不用会怎样）

先看"不用工厂"的反面教材——披萨店直接 `new`：

```java
package com.canoe.pattern.factory;

// 没有工厂时，调用方被迫认识所有具体类，并自己 new
public class OrderWithoutFactory {
    public static void main(String[] args) {
        String type = "cheese"; // 顾客点的口味
        Pizza pizza;
        // 一大坨 if-else：新增口味就要改这里，违反开闭原则
        if ("cheese".equals(type)) {
            pizza = new CheesePizza();
        } else if ("durian".equals(type)) {
            pizza = new DurianPizza();
        } else if ("seafood".equals(type)) {
            pizza = new SeafoodPizza();
        } else {
            throw new IllegalArgumentException("没有这种口味");
        }
        pizza.bake();
        pizza.cut();
        pizza.box();
    }
}
```

痛点：

- **调用方耦合所有具体类**：想加"培根披萨"，得回每个调用点改 if-else，改一处动全身。
- **开闭原则被破坏**：对扩展（加产品）不友好，每次扩展都改老代码，极易引入回归 BUG。
- **职责混乱**：业务代码里掺着一堆 `new` 和分支判断，越写越像一锅粥。

工厂的作用：把"创建"集中到一个地方，调用方只传一个类型或名字，要什么给什么，**新增产品时调用方一行都不用改**。

## 三、结构与角色

以"工厂方法"为例（最典型的角色划分），ASCII 结构如下：

```text
   Product（抽象产品）          Creator（抽象创建者/工厂）
   ┌────────────┐              ┌──────────────────┐
   │ + bake()   │◄──实现───────│ + factoryMethod() │
   │ + cut()    │              │ + order()         │──调用──► Product
   └────────────┘              └──────────────────┘
        ▲                              ▲
   实现  │                      继承/实现│
        │                              │
   ┌────┴─────┐                 ┌──────┴───────┐
   │CheesePizza│                 │CheeseFactory  │
   │DurianPizza│                 │DurianFactory  │
   └──────────┘                 └──────────────┘
   （具体产品）                    （具体工厂：决定 new 谁）
```

| 角色 | 职责 | 在哪出现 |
| --- | --- | --- |
| `Product`（抽象产品） | 定义产品的共性接口（如 `bake()`/`cut()`） | 三兄弟都有 |
| `ConcreteProduct`（具体产品） | 实现抽象产品，真正的业务对象 | 三兄弟都有 |
| `Creator`（抽象工厂/创建者） | 声明工厂方法，定义"怎么用产品"的流程 | 工厂方法、抽象工厂 |
| `ConcreteCreator`（具体工厂） | 决定实例化哪个具体产品 | 工厂方法、抽象工厂 |
| 静态工厂方法 | 一个方法内按参数 `new` 不同产品 | 仅简单工厂 |

## 四、代码实现

先给出"披萨"这条线的**公共抽象与具体产品**，后续三种工厂都复用它们：

```java
package com.canoe.pattern.factory;

// 抽象产品：所有披萨都具备"烤、切、装盒"的能力
public abstract class Pizza {
    protected String name;

    public void bake() {
        System.out.println(name + "：进炉烘烤 15 分钟。");
    }

    public void cut() {
        System.out.println(name + "：切成 8 块。");
    }

    public void box() {
        System.out.println(name + "：装盒打包完成。");
    }

    public String getName() {
        return name;
    }
}

// 具体产品：芝士披萨
class CheesePizza extends Pizza {
    public CheesePizza() {
        this.name = "芝士披萨";
    }
}

// 具体产品：榴莲披萨
class DurianPizza extends Pizza {
    public DurianPizza() {
        this.name = "榴莲披萨";
    }
}

// 具体产品：海鲜披萨
class SeafoodPizza extends Pizza {
    public SeafoodPizza() {
        this.name = "海鲜披萨";
    }
}
```

## 五、简单工厂（Simple Factory）

一个工厂类，根据参数 `new` 不同的产品。**注意：简单工厂不属于 GoF 23 种模式**，它只是工程中极其常用的"小技巧"。

```java
package com.canoe.pattern.factory;

// 简单工厂：一个方法 + 一堆 if-else 分拣，集中创建逻辑
public class SimplePizzaFactory {

    // 根据口味名创建对应披萨；新增口味只需改这里（但仍改了代码）
    public Pizza createPizza(String type) {
        Pizza pizza;
        if ("cheese".equals(type)) {
            pizza = new CheesePizza();
        } else if ("durian".equals(type)) {
            pizza = new DurianPizza();
        } else if ("seafood".equals(type)) {
            pizza = new SeafoodPizza();
        } else {
            throw new IllegalArgumentException("没有这种口味：" + type);
        }
        return pizza;
    }

    // 演示：调用方完全不认识具体类，只传字符串
    public static void main(String[] args) {
        SimplePizzaFactory factory = new SimplePizzaFactory();
        Pizza p = factory.createPizza("durian");
        p.bake();
        p.cut();
        p.box();
    }
}
```

- **优点**：调用方彻底解耦具体类，创建逻辑集中、易读。
- **缺点**：不满足开闭原则——新增产品得改 `createPizza()` 里的 if-else。适合产品种类**稳定**的小场景。

## 六、工厂方法（Factory Method）

每种产品配一个专属工厂，抽象出 `Factory` 接口 + 具体工厂。新增口味时只**新增类**，不改老代码。

```java
package com.canoe.pattern.factory;

// 抽象工厂：只声明"造什么"，不关心具体怎么造
public interface PizzaFactory {
    Pizza createPizza();
}

// 具体工厂：芝士披萨工厂，只 new CheesePizza
class CheesePizzaFactory implements PizzaFactory {
    @Override
    public Pizza createPizza() {
        return new CheesePizza();
    }
}

// 具体工厂：榴莲披萨工厂，只 new DurianPizza
class DurianPizzaFactory implements PizzaFactory {
    @Override
    public Pizza createPizza() {
        return new DurianPizza();
    }
}

// 演示：调用方面向接口编程，扩展时只加新工厂类
class FactoryMethodDemo {
    public static void main(String[] args) {
        PizzaFactory factory = new DurianPizzaFactory(); // 想换口味换工厂即可
        Pizza pizza = factory.createPizza();
        pizza.bake();
        pizza.box();
    }
}
```

工厂方法如何用"物流"线再印证一遍——发货选承运商：

```java
package com.canoe.pattern.factory;

// 抽象物流（产品）：都能发货
public interface Logistics {
    void deliver(String packageInfo);
}

// 顺丰
class SFExpress implements Logistics {
    @Override
    public void deliver(String packageInfo) {
        System.out.println("顺丰小哥配送：" + packageInfo + "（次日达）");
    }
}

// 京东物流
class JDLogistics implements Logistics {
    @Override
    public void deliver(String packageInfo) {
        System.out.println("京东小哥配送：" + packageInfo + "（211 限时达）");
    }
}

// 抽象工厂 + 两个具体工厂
interface LogisticsFactory {
    Logistics createLogistics();
}

class SFFactory implements LogisticsFactory {
    @Override
    public Logistics createLogistics() {
        return new SFExpress();
    }
}

class JDFactory implements LogisticsFactory {
    @Override
    public Logistics createLogistics() {
        return new JDLogistics();
    }
}

class LogisticsDemo {
    public static void main(String[] args) {
        LogisticsFactory f = new JDFactory();
        f.createLogistics().deliver("一部手机");
    }
}
```

工厂方法解决了简单工厂的开闭问题：**新增产品 = 新增一个具体工厂类**，老工厂与老调用方一行都不用动。

## 七、抽象工厂（Abstract Factory）

工厂方法管"一个产品等级"（只造披萨）；抽象工厂管"**一整个产品族**"（一个工厂同时造多个相关产品）。用"小米/华为"举例：同是工厂，能造"手机 + 路由器"这一族，且保证搭配一致。

```java
package com.canoe.pattern.factory;

// ========== 产品族：电子产品 ==========
// 抽象产品：手机
interface Phone {
    void call();
}
// 抽象产品：路由器
interface Router {
    void wifi();
}

// 小米产品族
class MiPhone implements Phone {
    @Override
    public void call() { System.out.println("小米手机：高清通话。"); }
}
class MiRouter implements Router {
    @Override
    public void wifi() { System.out.println("小米路由器：全屋覆盖。"); }
}

// 华为产品族
class HuaweiPhone implements Phone {
    @Override
    public void call() { System.out.println("华为手机：卫星通话。"); }
}
class HuaweiRouter implements Router {
    @Override
    public void wifi() { System.out.println("华为路由器：鸿蒙组网。"); }
}

// ========== 抽象工厂：承诺能造一族产品 ==========
interface ElectronicFactory {
    Phone createPhone();
    Router createRouter();
}

// 具体工厂：小米工厂，只产小米一族
class MiFactory implements ElectronicFactory {
    @Override
    public Phone createPhone() { return new MiPhone(); }
    @Override
    public Router createRouter() { return new MiRouter(); }
}

// 具体工厂：华为工厂，只产华为一族
class HuaweiFactory implements ElectronicFactory {
    @Override
    public Phone createPhone() { return new HuaweiPhone(); }
    @Override
    public Router createRouter() { return new HuaweiRouter(); }
}

class AbstractFactoryDemo {
    public static void main(String[] args) {
        ElectronicFactory factory = new MiFactory();
        factory.createPhone().call();
        factory.createRouter().wifi();
        // 关键点：同一工厂保证"手机+路由器"是同一品牌，搭配不会错乱
    }
}
```

**产品族 vs 产品等级**：产品等级是"手机这一类"（工厂方法管的）；产品族是"小米牌的手机+路由器"（抽象工厂管的）。抽象工厂的价值在于**约束搭配**——你绝不会用小米工厂造出华为手机。

## 八、三种工厂对比

| 维度 | 简单工厂 | 工厂方法 | 抽象工厂 |
| --- | --- | --- | --- |
| 抽象程度 | 最低（一个方法） | 中（每产品一工厂） | 最高（每族一工厂） |
| 开闭原则 | 不符合（改 if-else） | 符合（加类即可） | 符合（加族加类） |
| 复杂度 | 最简单 | 适中 | 较复杂（类数量多） |
| 管理对象 | 单一产品 | 单一产品等级 | 一整个产品族 |
| 典型场景 | 产品稳定、种类少 | 产品常扩展 | 多产品需成套搭配 |

## 九、优缺点

| 优点 | 缺点 |
| --- | --- |
| **解耦调用方与具体类**：只面向产品/工厂接口编程 | **类数量膨胀**：每加一个产品就多一个类，工厂方法/抽象工厂尤甚 |
| **集中创建逻辑**：易维护和统一控制（如加缓存、日志） | **抽象工厂改接口代价大**：给抽象工厂加一个方法，所有具体工厂都要改 |
| **符合开闭原则**（工厂方法/抽象工厂）：扩展不改老代码 | **多一层间接**：小项目用工厂反而增加理解成本 |
| **利于替换实现**：换工厂即换整套行为（如测试时换 Mock 工厂） | **简单工厂仍违反开闭**：扩展要改核心方法 |
| **配合依赖注入**：Spring 等容器天然契合工厂思想 | **调试链路变长**：对象从哪来不再一目了然 |

## 十、适用场景

- **日志框架**：按级别/目标（控制台、文件、远程）创建不同 `Appender`，调用方只传类型。
- **数据库驱动**：`DriverManager.getConnection(url)` 根据 URL 协议选不同驱动实现。
- **UI 跨平台**：同一套界面代码，切换"Win 工厂/ Mac 工厂"产出不同风格控件（抽象工厂经典场景）。
- **支付/物流网关**：顺丰、京东、中通统一抽象成 `LogisticsFactory`，业务只调接口。
- **测试替身**：生产用真工厂，单测用 Mock 工厂注入假对象。

**什么情况下不要用**：对象创建极其简单、种类永不变更（比如永远只有一个 `Config`），硬套工厂只是徒增类与间接层，反而拖慢理解。

## 十一、在 JDK / 开源框架中的应用

- **`java.util.Calendar.getInstance()`**：JDK 里的简单工厂思路，按 `Locale`/`TimeZone` 返回不同 `Calendar` 子类。
- **`java.util.ResourceBundle.getBundle()`**：根据语言环境创建对应的资源包实例，典型的工厂方法变体。
- **`javax.xml.parsers.DocumentBuilderFactory`**：抽象工厂模式，`newInstance()` 得到工厂后再 `newDocumentBuilder()`，不同 JAXP 实现提供不同具体工厂。
- **Spring `BeanFactory` / `ApplicationContext`**：Spring 的 `getBean()` 本质是工厂（容器式单例 + 工厂结合），根据 Bean 名/类型返回实例。
- **MyBatis `SqlSessionFactory`**：`SqlSessionFactoryBuilder.build()` 解析配置后产出 `SqlSessionFactory`，再由它开 `SqlSession`，是工厂方法的典型落地。

## 十二、与相近模式的区别

| 对比项 | 工厂模式 | 单例模式 | 建造者模式 |
| --- | --- | --- | --- |
| **目的** | 屏蔽创建细节、解耦"要哪个" | 保证唯一、全局共享 | 分步拼装复杂对象 |
| **产出** | 想要几个有几个 | 永远只有一个 | 每拼一次产一个完整对象 |
| **使用场景** | 产品种类多、要扩展 | 资源唯一 | 对象字段多、构造步骤多 |

## 本篇小结

- **简单工厂**用一个方法 + if-else 分拣产品，最常用但**不属于 GoF 23 种**。
- **简单工厂不满足开闭原则**：新增产品要改核心 `createXxx()` 方法。
- **工厂方法**让每种产品配一个专属工厂，扩展靠加类、不改老代码。
- **工厂方法**把"实例化哪个类"延迟到子类，符合开闭原则。
- **抽象工厂**面向"产品族"，一个工厂产出一整套配套产品，约束搭配不乱。
- **产品等级**指"同一类"（如手机），**产品族**指"同品牌整套"（如小米手机+路由器）。
- **工厂三兄弟**抽象程度递进：小作坊 → 品牌加盟店 → 跨国集团。
- **工厂核心价值**是解耦调用方与具体类，调用方只面向接口编程。
- **JDK 的 `Calendar`/`ResourceBundle`** 都用了工厂思想。
- **Spring 的 `BeanFactory.getBean()`** 是工厂 + 单例的集大成者。
- 产品种类**永不变更**时别硬套工厂，否则徒增类与理解成本。
- 抽象工厂一旦给接口加新方法，**所有具体工厂都要跟着改**，扩展代价需注意。

## 参考链接

- [Refactoring Guru · 工厂方法](https://refactoringguru.cn/design-patterns/factory-method)
- [Refactoring Guru · 抽象工厂](https://refactoringguru.cn/design-patterns/abstract-factory)
- [菜鸟教程 · 工厂模式](https://www.runoob.com/design-pattern/factory-pattern.html)
- [Spring 官方文档 · BeanFactory](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-factory)
- [Oracle JavaDoc · Calendar](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Calendar.html)
- [MyBatis 官方文档 · SqlSessionFactory](https://mybatis.org/mybatis-3/zh/getting-started.html)
- [廖雪峰的 Java 教程 · 工厂方法](https://www.liaoxuefeng.com/wiki/1252599548343744/1281793558599186)

下一篇 → [05 建造者模式](/java/design-pattern/builder)
