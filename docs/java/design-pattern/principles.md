# 02 面向对象设计原则

> 原则比模式更底层：**模式是原则在某类场景下的具体落地**。本文详讲七大原则，每个原则都配"反面代码 → 正面代码 → 记忆口诀"，让你不仅知道是什么，更知道怎么写。

## 一、为什么先学原则

很多同学直接冲设计模式，结果背了一堆类图还是写不好代码。原因很简单：**模式是"术"，原则是"道"**。一个符合开闭原则的代码，自然长成策略模式或模板方法的样子；违背原则，硬套模式也会四不像。

先看一个"没毛病但违背开闭原则"的小例子：一个折扣计算器，每次新增用户类型就要改老代码，改着改着就出 bug。下面的章节会把它治好。记住一句话：**先懂原则，模式只是原则顺理成章的结果。**

## 二、单一职责原则 SRP

**定义**：一个类应该只有一个引起它变化的原因（即只负责一件事）。

反面代码——一个 `UserService` 既管用户逻辑，又发邮件，又写日志，职责搅成一锅粥：

```java
package com.canoe.pattern.principles;

// 反面：一个类包揽了"业务逻辑 + 发邮件 + 记日志"三件事
public class BadUserService {
    public void register(String username) {
        // 1. 业务：保存用户
        System.out.println("保存用户：" + username);
        // 2. 发邮件（这其实不是 UserService 的活）
        System.out.println("给 " + username + " 发注册邮件");
        // 3. 记日志（更不是它的活）
        System.out.println("[LOG] 注册了 " + username);
    }
}
```

正面代码——职责拆分，各管一摊：

```java
package com.canoe.pattern.principles;

// 正面：业务、邮件、日志各司其职
public class GoodUserService {
    private MailService mailService;
    private LogService logService;

    public GoodUserService(MailService mailService, LogService logService) {
        this.mailService = mailService;
        this.logService = logService;
    }

    public void register(String username) {
        System.out.println("保存用户：" + username);          // 只管业务
        mailService.sendRegisterMail(username);             // 发邮件交给专人
        logService.info("注册了 " + username);              // 记日志交给专人
    }
}

class MailService {
    public void sendRegisterMail(String username) {
        System.out.println("给 " + username + " 发注册邮件");
    }
}

class LogService {
    public void info(String msg) {
        System.out.println("[LOG] " + msg);
    }
}
```

**怎么判断"职责太多"**：当你想给类写注释时，要写"它负责 A、B、C、D"好几件事，就该拆了。但注意**粒度过细会类爆炸**——别把一个类拆成十个只有一个方法的"幽灵类"。

**口诀：一个类只干一件事，改动原因只能有一个。**

## 三、开闭原则 OCP

**定义**：对扩展开放，对修改关闭。这是**所有原则里最重要的一条**。

靠"抽象 + 多态"实现：把会变的部分抽象成接口，新增行为时写新实现类，而不是改老类。呼应第一篇里那个折扣计算器的痛点：

```java
package com.canoe.pattern.principles;

// 反面：每加一种用户，就要改这个 if-else → 违反"对修改关闭"
public class BadDiscountCalculator {
    public double discount(String userType, double price) {
        if ("normal".equals(userType)) {
            return price;
        } else if ("vip".equals(userType)) {
            return price * 0.9;
        } else if ("svip".equals(userType)) {   // 新增超级会员？改这里！
            return price * 0.8;
        }
        return price;
    }
}
```

正面代码——用策略模式落地开闭原则：

```java
package com.canoe.pattern.principles;

// 抽象出"折扣策略"接口，扩展新用户类型只需新增实现类，老代码一行不动
public interface DiscountStrategy {
    double calc(double price);
}

class NormalDiscount implements DiscountStrategy {
    @Override
    public double calc(double price) { return price; }
}

class VipDiscount implements DiscountStrategy {
    @Override
    public double calc(double price) { return price * 0.9; }
}

class SvipDiscount implements DiscountStrategy {   // 新增类型：只加这个类
    @Override
    public double calc(double price) { return price * 0.8; }
}

// 使用方依赖抽象，永远不需要改
public class GoodDiscountCalculator {
    public double discount(DiscountStrategy strategy, double price) {
        return strategy.calc(price);
    }
}
```

新增"超级会员送积分"，只要再写一个 `SvipDiscount` 类，老代码纹丝不动——这就是开闭原则带来的抗变更能力。

**口诀：加功能别改老代码，靠抽象和多态去扩展。**

## 四、里氏替换原则 LSP

**定义**：子类必须能透明地替换父类，且程序行为不变（父类出现的地方，换成子类不能出错）。

经典反例——正方形继承长方形。长方形 `setWidth`/`setHeight` 互不影响，正方形要求宽高相等，重写的 setter 会破坏"长方形"的契约：

```java
package com.canoe.pattern.principles;

// 反面：正方形继承长方形，重写了 setter 导致行为不一致
class Rectangle {
    protected int width;
    protected int height;

    public void setWidth(int w) { this.width = w; }
    public void setHeight(int h) { this.height = h; }
    public int getArea() { return width * height; }
}

class Square extends Rectangle {   // 正方形强行继承长方形
    @Override
    public void setWidth(int w) {  // 为了"正方形"，宽高一起改
        this.width = w;
        this.height = w;
    }
    @Override
    public void setHeight(int h) {
        this.width = h;
        this.height = h;
    }
}
```

问题：某段代码 `r.setWidth(5); r.setHeight(4);` 对长方形期望面积 20，换成 `Square` 后面积变成 16——**替换后行为变了，违反 LSP**。另一个经典反例是"企鹅继承鸟"——鸟会飞，企鹅不会飞，强行继承就会在 `fly()` 里抛异常。

**修复思路**：不要为了复用而错误继承。把"长方形/正方形"共同抽象为更高层的 `Shape`（只定义 `getArea()`），二者都实现 `Shape` 而非互相继承；企鹅与鸵鸟归到"不会飞的鸟"分支。继承要看"是不是真的是一种（is-a）"，而不是"有没有部分相同字段"。

**口诀：子类能顶父类班，行为不能变。**

## 五、接口隔离原则 ISP

**定义**：客户端不应被迫依赖它用不到的接口方法。接口要小而专，别搞"胖接口"。

反面代码——一个巨型 `Animal` 接口把飞、游、跑全塞进去，鸭子实现还好，鱼和狗就尴尬了：

```java
package com.canoe.pattern.principles;

// 反面：胖接口，Dog 不会飞却被逼着实现 fly()
public interface Animal {
    void run();
    void swim();
    void fly();   // 不是所有动物都会飞
}

class Dog implements Animal {
    @Override public void run() { }
    @Override public void swim() { }
    @Override public void fly() { /* 被迫写了个空实现，恶心 */ }
}
```

正面代码——拆成小接口，按需实现：

```java
package com.canoe.pattern.principles;

// 正面：把能力拆成独立接口，谁有谁实现
public interface RunnableAnimal { void run(); }
public interface SwimmableAnimal { void swim(); }
public interface FlyableAnimal { void fly(); }

// Dog 只实现它真正拥有的能力
class GoodDog implements RunnableAnimal, SwimmableAnimal {
    @Override public void run() { }
    @Override public void swim() { }
}
```

**口诀：别逼我实现用不上的方法，接口要小而专。**

## 六、依赖倒置原则 DIP

**定义**：高层模块不依赖低层模块，二者都依赖抽象；抽象不依赖细节，细节依赖抽象。说人话就是**面向接口编程**。

反面代码——订单服务直接 `new` 了 MySQL 实现，哪天换 Oracle 就得改 `OrderService`：

```java
package com.canoe.pattern.principles;

// 反面：高层直接依赖低层具体类
public class BadOrderService {
    private MySQLOrderRepository repo = new MySQLOrderRepository();  // 写死具体实现
    public void createOrder() { repo.save(); }
}

class MySQLOrderRepository {
    public void save() { System.out.println("存进 MySQL"); }
}
```

正面代码——依赖抽象（接口），具体实现由外部注入：

```java
package com.canoe.pattern.principles;

// 正面：都依赖 OrderRepository 接口，具体数据库由外部决定
public interface OrderRepository {
    void save();
}

class MySQLOrderRepository implements OrderRepository {
    @Override public void save() { System.out.println("存进 MySQL"); }
}

class OracleOrderRepository implements OrderRepository {
    @Override public void save() { System.out.println("存进 Oracle"); }
}

public class GoodOrderService {
    private OrderRepository repo;   // 依赖抽象，而非具体类

    public GoodOrderService(OrderRepository repo) {  // 构造器注入
        this.repo = repo;
    }
    public void createOrder() { repo.save(); }
}
```

**DIP 与 DI 的关系**：DIP 是"原则"（该面向接口），DI（依赖注入）是"手段"（把实现塞进来的方式）。**Spring 的 IOC 容器就是 DIP 的最佳实践**——你只声明要 `OrderRepository`，容器把具体实现注入进来，高层彻底不认识低层。

**口诀：面向接口编程，高层低层都靠抽象牵线。**

## 七、迪米特法则（最少知识原则）LoD

**定义**：一个对象应尽量少地了解其他对象，只和"直接朋友"说话。所谓直接朋友：成员变量、方法参数、方法返回值的对象；**不要去调"朋友的朋友"**。

反面代码——链式调用一路扒到最底层，A 类为了办点事竟摸清了 B→C→D 的结构：

```java
package com.canoe.pattern.principles;

// 反面：a.getDept().getManager().getName() —— 和陌生人深度耦合
public class BadEmployee {
    private Department dept;
    public Department getDept() { return dept; }
}

class Department {
    private Manager manager;
    public Manager getManager() { return manager; }
}

class Manager {
    public String getName() { return "王经理"; }
}

// 调用方被迫知道"部门里有个经理，经理有名字"这层结构
class Caller {
    public void print(Employee e) {
        System.out.println(e.getDept().getManager().getName());  // 扒了三层
    }
}
```

正面代码——给 `Employee` 加一个"门面方法"，调用方只和直接朋友说话：

```java
package com.canoe.pattern.principles;

// 正面：把"查经理名字"封装进 Employee，调用方只调一层
public class GoodEmployee {
    private Department dept;
    public String getManagerName() {   // 自己内部去问，不暴露结构
        return dept.getManagerName();
    }
}

class Department {
    private Manager manager;
    public String getManagerName() { return manager.getName(); }
}

class Manager {
    public String getName() { return "王经理"; }
}
```

注意别矫枉过正——为了 LoD 给每个类都加一堆转发方法，反而制造"上帝中介"。LoD 反对的是"和陌生人深度耦合"，不是禁止任何委托。

**口诀：只和直接朋友说话，别扒朋友的朋友。**

## 八、合成复用原则 CRP

**定义**：优先使用组合/聚合，而不是继承来达到复用的目的。

继承的三大问题：①**破坏封装**——子类能看到父类protected成员，耦合深；②**白箱复用**——父类实现细节暴露给子类；③**静态绑定**——编译期就定死，运行期换不了。组合则是"黑箱复用"，运行时还能换实现。

反面代码——为了复用 `Engine` 的能力，让 `Car` 继承 `Engine`：

```java
package com.canoe.pattern.principles;

// 反面：Car 继承 Engine，"汽车是一种引擎"明显说不通，且强耦合
public class Engine {
    public void start() { System.out.println("引擎启动"); }
}

class BadCar extends Engine {   // 继承是为了复用 start()，但语义错、耦合死
    public void run() { start(); }
}
```

正面代码——用组合，把 `Engine` 作为成员：

```java
package com.canoe.pattern.principles;

// 正面：Car 拥有 Engine（组合），语义正确、可运行时替换引擎
public class GoodCar {
    private Engine engine;

    public GoodCar(Engine engine) {
        this.engine = engine;   // 组合：has-a，而不是 is-a
    }
    public void run() {
        engine.start();
    }
}
```

**口诀：能组合就别继承，黑箱复用更灵活。**

## 九、SOLID 速查表

七条原则里，前五个首字母正好拼成 **SOLID**，后两条（迪米特、合成复用）是重要补充：

| 原则 | 英文全称 | 中文名 | 一句话核心 | 违反的典型症状 | 典型落地模式 |
| --- | --- | --- | --- | --- | --- |
| SRP | Single Responsibility Principle | 单一职责 | 一个类只干一件事 | 类越来越大、改一处影响多面 | 无（拆分即可） |
| OCP | Open Closed Principle | 开闭 | 加功能不改老代码 | if-else 随需求膨胀 | 策略、模板方法 |
| LSP | Liskov Substitution Principle | 里氏替换 | 子类能顶父类班 | 子类重写后行为异常 | 用组合替代错误继承 |
| ISP | Interface Segregation Principle | 接口隔离 | 接口要小而专 | 实现类有一堆空方法 | 无（拆接口） |
| DIP | Dependency Inversion Principle | 依赖倒置 | 面向接口编程 | 高层 new 低层具体类 | 工厂、观察者、DI |
| LoD | Law of Demeter | 迪米特/最少知识 | 只和直接朋友说话 | 链式 `a.b().c().d()` | 外观、中介者 |
| CRP | Composite Reuse Principle | 合成复用 | 优先组合而非继承 | 为复用强行继承 | 装饰器、代理、策略 |

## 本篇小结

- **原则比模式更底层**，模式只是原则在场景下的落地。
- **SRP**：一个类只负责一件事，改动原因唯一。
- **OCP 最重要**：靠抽象 + 多态实现"对扩展开放、对修改关闭"。
- **LSP**：子类必须能替换父类且行为不变，错误继承是头号陷阱。
- **ISP**：拆胖接口，别逼实现类写用不上的空方法。
- **DIP**：高层低层都依赖抽象，Spring IOC 是其最佳实践。
- **DI 是手段、DIP 是原则**，二者经常一起出现。
- **LoD**：只和直接朋友说话，杜绝链式扒三层调用。
- **CRP**：优先组合/聚合，继承会破坏封装且耦合死。
- 七大原则方向一致：**高内聚、低耦合、面向抽象**。
- 原则是方向不是教条，必要时可为性能/可读性做权衡。

## 参考链接

- [Refactoring Guru · 设计原则](https://refactoringguru.cn/design-patterns/design-principles)
- [Baeldung · SOLID 原则](https://www.baeldung.com/solid-principles)
- [Wikipedia · SOLID](https://en.wikipedia.org/wiki/SOLID)
- [美团技术团队 · 设计模式与原则实践](https://tech.meituan.com/)
- [SourceMaking · Principles of Object-Oriented Design](https://sourcemaking.com/design_patterns)
- [Spring 官方文档（依赖注入与 IOC）](https://docs.spring.io/spring-framework/reference/core/beans/dependencies.html)

下一篇 → [03 单例模式](/java/design-pattern/singleton)
