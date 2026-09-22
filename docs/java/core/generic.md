# 06 泛型

在没有泛型的年代，往 `List` 里塞东西取出来全是 `Object`，要强转、要祈祷类型对，运行期才爆 `ClassCastException`。泛型把类型检查搬到了编译期，还顺带消灭了一大堆强转代码。但它的底层——**类型擦除**——又带来了桥接方法、`<? extends>`/`<? super>` 一堆反直觉规则。本篇从「为什么需要泛型」讲起，覆盖泛型类、方法、擦除、通配符 PECS、八大限制、与反射的配合，最后手写一个 `Result<T>` 通用响应体。

## 一、为什么需要泛型

看一段没有泛型的「原始」集合代码有多糟：

```java
package com.canoe.core.generic;

import java.util.ArrayList;
import java.util.List;

public class BeforeGeneric {
    public static void main(String[] args) {
        List list = new ArrayList(); // 元素类型是 Object
        list.add("canoe");
        list.add(100);                // 编译不报错，埋雷

        // 取出来必须强转，运行期才可能炸
        String s = (String) list.get(0); // "canoe" OK
        String bad = (String) list.get(1); // ClassCastException: Integer 不能转 String
        System.out.println(s);
    }
}
```

痛点：

- 取元素要**手动强转**，代码又臭又长。
- 类型错误**拖到运行期**才暴露，线上才炸。
- 编译器帮不上忙，IDE 也给不出智能提示。

泛型登场后：`List<String>` 让编译器在编译期就拦住「往字符串列表塞整数」：

```java
List<String> list = new ArrayList<>();
list.add("canoe");
// list.add(100);   // 编译期直接报错，错误提前暴露
String s = list.get(0); // 不用强转
```

**一句话**：泛型把类型错误从「运行期爆炸」提前到「编译期拦截」，同时消灭强转。

## 二、泛型类与泛型接口

在类名后加 `<T>` 声明类型参数：

```java
package com.canoe.core.generic;

// 泛型类：T 是类型参数占位符
public class Box<T> {
    private T value;

    public void set(T value) {
        this.value = value;
    }

    public T get() {
        return value;
    }
}
```

使用：

```java
package com.canoe.core.generic;

public class BoxDemo {
    public static void main(String[] args) {
        Box<String> stringBox = new Box<>();
        stringBox.set("canoe");
        System.out.println(stringBox.get());

        Box<Integer> intBox = new Box<>();
        intBox.set(100);
        System.out.println(intBox.get());
    }
}
```

**类型参数命名约定**（一眼能懂是什么）：

```text
字母   含义
T      Type，任意类型
E      Element，集合元素
K      Key，键
V      Value，值
N      Number，数值
R      Result，返回类型
```

泛型接口同理，如 `List<E>`、`Comparator<T>`。

## 三、泛型方法

泛型**方法**的类型参数声明在返回类型之前，且独立于类——类不是泛型类也能有泛型方法。

```java
package com.canoe.core.generic;

import java.util.Arrays;

public class GenericMethodDemo {

    // 泛型方法：<T> 在返回值前声明
    public static <T> T getFirst(T[] array) {
        return array[0];
    }

    // 泛型 + 可变参数
    public static <T> void printAll(T... items) {
        for (T item : items) {
            System.out.println(item);
        }
    }

    public static void main(String[] args) {
        String[] names = {"canoe", "note"};
        Integer[] nums = {1, 2, 3};

        // 类型由实参推断，无需写 <String>
        String first = getFirst(names);
        Integer firstNum = getFirst(nums);
        System.out.println(first + " / " + firstNum);

        printAll("a", 1, 3.14);
    }
}
```

**关键**：静态方法想用泛型，**必须在自己方法上声明 `<T>`**，不能借用类的类型参数（因为静态方法不依赖实例）。

## 四、泛型擦除（重点）

**编译后，泛型类型信息被「擦除」**：`List<String>` 和 `List<Integer>` 在运行时是**同一个类** `List`。验证一下：

```java
package com.canoe.core.generic;

import java.util.ArrayList;
import java.util.List;

public class ErasureDemo {
    public static void main(String[] args) {
        List<String> a = new ArrayList<>();
        List<Integer> b = new ArrayList<>();
        // 运行时都是 ArrayList，getClass 相同
        System.out.println(a.getClass() == b.getClass()); // true
    }
}
```

为什么擦除？为了**兼容 JDK 5 之前的老字节码**——泛型是编译期的「语法糖」，运行时抹掉类型，老代码照常跑。

擦除到什么程度？擦除到**类型边界**：

- `<T>`（无边界）→ 擦成 `Object`。
- `<T extends Number>` → 擦成 `Number`（边界）。
- `<T extends Comparable<T>>` → 擦成 `Comparable`。

所以运行时拿不到 `T` 到底是 `String` 还是 `Integer`（这也是反射拿泛型要绕弯子的原因，见第八节）。

## 五、桥接方法

擦除带来的副作用之一：**桥接方法（bridge method）**。当子类重写父类的泛型方法时，编译器会悄悄生成一个「桥接方法」来保证多态正确。

```java
// 父类
class Node<T> {
    public void setData(T data) { ... }
}
// 子类擦除后 setData(Object)，但子类想提供 setData(Integer) 的覆写
// 编译器生成桥接方法 setData(Object) -> 内部调用 setData(Integer)
```

这是 JVM 兼容泛型与多态的手段，日常开发感知不到，了解「为什么会有个签名奇怪的方法」即可（用 `javap` 能看到）。

## 六、通配符

通配符 `?` 表示「未知类型」，三种用法：

```text
写法              含义              适用
?                无界通配符         只关心是某个 List，不读写元素
? extends T      上界（T 及其子类型）  只能「读」出来当 T 用（Producer）
? super T        下界（T 及其父类型）  只能「写」T 及其子类型进去（Consumer）
```

**PECS 原则**（Producer Extends, Consumer Super），这是通配符的灵魂：

- 如果集合是**生产者**（只往外取），用 `? extends T`。
- 如果集合是**消费者**（只往里放），用 `? super T`。

`Collections.copy` 的源码就是 PECS 的教科书例证：

```java
// 把 src 的元素拷贝到 dest
public static <T> void copy(List<? super T> dest, List<? extends T> src) {
    // dest 是消费者（写），所以用 ? super T
    // src 是生产者（读），所以用 ? extends T
}
```

完整 demo：

```java
package com.canoe.core.generic;

import java.util.ArrayList;
import java.util.List;

class Fruit {}
class Apple extends Fruit {}
class Banana extends Fruit {}

public class PecsDemo {
    // 生产者：读出来当 Fruit 用，用 ? extends Fruit
    static double totalWeight(List<? extends Fruit> fruits) {
        // 只能读不能写（不能 add(new Apple())，因为实际类型可能是 Banana 列表）
        return fruits.size();
    }

    // 消费者：往里放 Apple，用 ? super Apple
    static void addApples(List<? super Apple> list) {
        list.add(new Apple()); // 能写
        // Apple a = list.get(0); // 不能读成 Apple，只能当 Object
    }

    public static void main(String[] args) {
        List<Apple> apples = new ArrayList<>();
        List<Fruit> fruits = new ArrayList<>();
        addApples(apples);
        addApples(fruits);          // ? super Apple，Fruit 是 Apple 的父类型，OK
        System.out.println(totalWeight(apples));
        System.out.println(totalWeight(fruits));
    }
}
```

一句话记：**extends 只读、super 只写**。

## 七、泛型的限制

泛型有「八大限制」，都是擦除导致的：

1. **不能 `new T()`**：运行时不知道 `T` 是什么类，无法实例化。
2. **不能创建泛型数组**：`new T[10]` 不允许（`T[]` 数组类型不确定）。
3. **不能用基本类型作类型参数**：`List<int>` 非法，必须用 `List<Integer>`。
4. **静态成员不能用类的类型参数**：`static T data;` 非法（静态属于类，与实例的 `T` 无关）。
5. **不能对泛型做 `instanceof`**：`if (obj instanceof List<String>)` 非法（运行时已擦除）。
6. **不能抛出或捕获泛型异常**：泛型类不能 `extends Throwable`。
7. **泛型类不能继承 `Throwable`**：`class MyEx<T> extends Exception` 非法。
8. **不能仅以泛型参数不同来重载**：`void f(List<String>)` 和 `void f(List<Integer>)` 擦除后签名相同，编译不过。

```java
package com.canoe.core.generic;

import java.util.ArrayList;
import java.util.List;

public class GenericLimit {
    // 1. 不能 new T()
    // public <T> T create() { return new T(); }  // 编译错误

    // 2. 不能创建泛型数组
    // List<String>[] arr = new List<String>[10]; // 编译错误
    // 变通：用 (List<String>[]) new List[10]
    @SuppressWarnings("unchecked")
    List<String>[] arr = (List<String>[]) new List[10];

    public static void main(String[] args) {
        // 3. 基本类型不行，用包装类
        List<Integer> nums = new ArrayList<>();
        // 5. 不能 instanceof 泛型
        // if (nums instanceof List<String>) {} // 编译错误
    }
}
```

## 八、泛型与反射

泛型擦除了，那 Jackson 反序列化 `List<User>` 怎么知道元素类型是 `User`？答案是**借助匿名内部类保留泛型信息**——`TypeReference`。

```java
package com.canoe.core.generic;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

class User {
    public String name;
    public int age;
}

public class TypeReferenceDemo {
    public static void main(String[] args) throws Exception {
        String json = "[{\"name\":\"canoe\",\"age\":18},{\"name\":\"note\",\"age\":20}]";

        ObjectMapper mapper = new ObjectMapper();
        // 关键：new TypeReference<List<User>>() {} 用匿名类保留泛型
        List<User> users = mapper.readValue(json, new TypeReference<List<User>>() {});
        System.out.println(users.get(0).name); // canoe
    }
}
```

原理：`new TypeReference<List<User>>(){}` 是匿名子类，其泛型父类 `TypeReference<List<User>>` 的泛型参数会被编译器保留在字节码的 `Signature` 属性里（不被擦除），运行时通过 `getGenericSuperclass()` 就能拿回 `List<User>`。

Gson 的 `new TypeToken<List<User>>(){}`、Fastjson 的 `new TypeReference<>(){}` 同理。

## 九、实战：自定义泛型

Web 项目里最常见的泛型实践——统一响应体 `Result<T>`：

```java
package com.canoe.core.generic;

import java.io.Serializable;

// 通用响应体：data 的类型由调用方决定
public class Result<T> implements Serializable {
    private int code;
    private String message;
    private T data;

    private Result(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    // 成功（带数据）
    public static <T> Result<T> success(T data) {
        return new Result<>(0, "ok", data);
    }

    // 成功（无数据）
    public static <T> Result<T> success() {
        return new Result<>(0, "ok", null);
    }

    // 失败
    public static <T> Result<T> fail(int code, String message) {
        return new Result<>(code, message, null);
    }

    public int getCode() { return code; }
    public String getMessage() { return message; }
    public T getData() { return data; }
}
```

使用：

```java
package com.canoe.core.generic;

public class ResultDemo {
    public static void main(String[] args) {
        Result<String> r1 = Result.success("操作成功");
        Result<User> r2 = Result.success(new User());
        Result<Void> r3 = Result.fail(500, "服务器错误");
        System.out.println(r1.getData());
    }
}
```

这就是泛型的价值：**一套 `Result` 模板，包住任意类型的数据**，Controller 层统一返回，前端约定一致。

## 本篇小结

- **泛型把类型错误从运行期提前到编译期**，并消灭强转代码。
- **泛型类在类名后声明 `<T>`**，命名约定 `T/E/K/V/N/R`。
- **泛型方法类型参数声明在返回值前**，静态方法必须自己声明 `<T>`。
- **类型擦除**：运行时 `List<String>` 与 `List<Integer>` 是同一类。
- **擦除到边界**：`<T>` → `Object`，`<T extends Number>` → `Number`。
- **桥接方法**是擦除后保证多态正确的编译器产物。
- **PECS 原则**：`? extends T` 只读（生产者），`? super T` 只写（消费者）。
- **`Collections.copy` 用 `? super`/`? extends`** 是 PECS 典范。
- **八大限制**：不能 `new T`、不能泛型数组、不能用基本类型等。
- **泛型与反射靠 `TypeReference` 保留类型**（匿名类 Signature 不被擦除）。
- **`Result<T>` 通用响应体**是泛型最常见的工程实践。
- **`instanceof` 不能用泛型、不能仅以泛型参数重载方法**。

## 参考链接

- [Java 官方文档：泛型教程](https://docs.oracle.com/javase/tutorial/java/generics/)
- [Oracle 官方：Generics FAQ (Angelika Langer)](https://angelikalanger.com/GenericsFAQ/JavaGenericsFAQ.html)
- [Java 官方文档：Class.getTypeParameters](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Class.html#getTypeParameters())
- [Baeldung：Java 泛型通配符](https://www.baeldung.com/java-generics-wildcards)
- [Baeldung：类型擦除](https://www.baeldung.com/java-type-erasure)
- [Jackson TypeReference 文档](https://fasterxml.github.io/jackson-core/javadoc/2.14/com/fasterxml/jackson/core/type/TypeReference.html)
- [Wikipedia: PECS](https://en.wikipedia.org/wiki/Wildcard_%28Java%29)

下一篇 → [07 注解](/java/core/annotation)
