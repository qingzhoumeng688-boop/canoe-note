# 08 反射

正常写代码，是你开着车按既定路线走；反射则是你**掀开引擎盖，直接拨弄里面的零件**——在运行期拿到类的元信息，动态创建对象、调方法、改字段。它让 Java 有了「动态性」，Spring、MyBatis、Jackson 全靠它运转；但代价是性能、封装与安全。本篇讲清 Class 的获取、字段/方法/构造器的操作、优缺点与性能优化，并给一组真实框架应用的简化代码。

## 一、反射是什么

**反射（Reflection）是程序在运行期获取自身元信息并操作它的能力**。

打个比方：平时你开车，只管用油门刹车（`obj.method()`）；反射则是停下车，翻开说明书（Class 对象），知道这车有几个缸、怎么拆火花塞（拿到字段、方法），甚至直接手动拨动零件（`set`/`invoke`）。

它的价值在「**动态**」：你写框架时并不知道用户会传什么类，只能运行期才知道——这时候就必须靠反射。

```java
// 编译期不知道具体类，运行期才决定
Class<?> clazz = Class.forName(userProvidedClassName);
Object obj = clazz.getDeclaredConstructor().newInstance();
```

## 二、Class 对象的获取

一切反射从拿到 `Class` 对象开始，三种方式：

```java
package com.canoe.core.reflection;

public class GetClassDemo {
    public static void main(String[] args) throws ClassNotFoundException {
        // 方式一：类名.class（编译期已知，不触发类初始化）
        Class<String> c1 = String.class;

        // 方式二：对象.getClass()（已有实例）
        String s = "";
        Class<? extends String> c2 = s.getClass();

        // 方式三：Class.forName(全限定名)（最常用，可配字符串，会触发类初始化）
        Class<?> c3 = Class.forName("java.lang.String");

        System.out.println(c1 == c2); // true：同一个 Class 对象
        System.out.println(c1 == c3); // true：JVM 里每个类只有一个 Class
    }
}
```

**关键区别——是否触发类初始化**：

- `类名.class`：**不触发**静态块初始化（只是拿到引用）。
- `对象.getClass()`：类早已加载，当然已初始化。
- `Class.forName()`：**会触发**类的静态初始化块（除非指定 `initialize=false`）。

所以在 JDBC 早期 `Class.forName("com.mysql.cj.jdbc.Driver")` 就是为了触发驱动类的静态注册。

## 三、Class 的常用 API

拿到 `Class` 后能拿到一大堆元信息：

```java
package com.canoe.core.reflection;

import java.io.Serializable;

public class ClassApiDemo {
    public static void main(String[] args) {
        Class<String> clazz = String.class;
        System.out.println(clazz.getName());       // java.lang.String（全名）
        System.out.println(clazz.getSimpleName()); // String（简名）
        System.out.println(clazz.getPackage());     // 包信息
        System.out.println(clazz.getSuperclass());  // class java.lang.Object（父类）
        System.out.println(clazz.getInterfaces().length); // 实现的接口数
        System.out.println(clazz.isInterface());    // false
        System.out.println(clazz.isArray());        // false
        System.out.println(clazz.getModifiers());   // 修饰符掩码（public=1）

        // 判断是否是某个父类的子类
        System.out.println(Serializable.class.isAssignableFrom(clazz)); // true
    }
}
```

`getModifiers()` 返回的是位掩码（`public`=1、`final`=16 等），配合 `java.lang.reflect.Modifier` 工具类可解析。

## 四、获取并操作字段

```java
package com.canoe.core.reflection;

import java.lang.reflect.Field;

class Person {
    public String name = "canoe";
    private int age = 18;   // 私有字段
}

public class FieldDemo {
    public static void main(String[] args) throws Exception {
        Person p = new Person();
        Class<?> clazz = p.getClass();

        // getFields：只拿 public 字段
        Field publicField = clazz.getField("name");
        System.out.println("name=" + publicField.get(p));

        // getDeclaredFields：拿到所有字段，含 private
        Field privateField = clazz.getDeclaredField("age");
        privateField.setAccessible(true); // 关闭访问检查，才能碰 private（暴力反射）
        System.out.println("age(改前)=" + privateField.get(p));
        privateField.set(p, 20);
        System.out.println("age(改后)=" + privateField.get(p));
    }
}
```

要点：

- **`getFields` 只返回 public；`getDeclaredFields` 返回全部（含 private）**，但 private 默认不能访问。
- **`setAccessible(true)` 关闭 Java 访问检查**，才能读写 private（俗称「暴力反射」）。
- **JDK 9+ 模块系统限制**：如果被反射的类在强封装模块（如 `java.base`）里，会抛 `InaccessibleObjectException`，需用 `--add-opens` 开放模块。这是 JDK 9 之后对反射的收紧。

## 五、获取并调用方法

```java
package com.canoe.core.reflection;

import java.lang.reflect.Method;

class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    private void secret() {
        System.out.println("私有方法被调用");
    }

    public static String info(String name) {
        return "hi " + name;
    }

    public void greet(String... names) { // 可变参数
        for (String n : names) System.out.println("hello " + n);
    }
}

public class MethodDemo {
    public static void main(String[] args) throws Exception {
        Calculator calc = new Calculator();
        Class<?> clazz = calc.getClass();

        // 调用 public 方法
        Method add = clazz.getMethod("add", int.class, int.class);
        int result = (int) add.invoke(calc, 3, 5);
        System.out.println("3+5=" + result);

        // 调用私有方法：declare + setAccessible
        Method secret = clazz.getDeclaredMethod("secret");
        secret.setAccessible(true);
        secret.invoke(calc);

        // 调用静态方法：第一个参数传 null
        Method info = clazz.getMethod("info", String.class);
        String msg = (String) info.invoke(null, "canoe");
        System.out.println(msg);

        // 调用可变参数方法：传一个数组
        Method greet = clazz.getMethod("greet", String[].class);
        greet.invoke(calc, (Object) new String[]{"a", "b"});
    }
}
```

要点：

- **`invoke(obj, args...)`** 第一个参数是「在哪个实例上调用」；**静态方法传 `null`**。
- 私有方法要用 `getDeclaredMethod` + `setAccessible(true)`。
- **可变参数**：底层就是数组，反射调用时把实参数组整体作为 `Object` 传入（强转 `(Object) new String[]{...}` 防止被当多个参数展开）。

## 六、获取并调用构造器

```java
package com.canoe.core.reflection;

import java.lang.reflect.Constructor;

class Book {
    private String title;

    public Book() { this.title = "未知"; }
    private Book(String title) { this.title = title; }

    @Override
    public String toString() { return "Book{title='" + title + "'}"; }
}

public class ConstructorDemo {
    public static void main(String[] args) throws Exception {
        Class<?> clazz = Book.class;

        // public 无参构造
        Constructor<?> c1 = clazz.getConstructor();
        Object b1 = c1.newInstance();
        System.out.println(b1);

        // 私有有参构造：declare + setAccessible
        Constructor<?> c2 = clazz.getDeclaredConstructor(String.class);
        c2.setAccessible(true);
        Object b2 = c2.newInstance("反射入门");
        System.out.println(b2);
    }
}
```

注意：JDK 9 起 `Class.newInstance()` 已**过时**，请改用 `getDeclaredConstructor().newInstance()`，后者能区分异常类型、更安全。

## 七、反射的优缺点

**优点**：

- **极其灵活**：运行期动态加载类、调用方法，框架的基石。
- **解耦**：调用方不依赖具体类，只依赖接口/字符串，插件化、热更新成为可能。

**缺点**：

- **性能差**：反射调用要经过运行时解析、访问检查，且**难以被 JIT 内联优化**。粗略数量级：单次反射调用比直接调用慢一个数量级（几十倍），高频调用差距明显（见下节优化）。
- **破坏封装**：`setAccessible(true)` 能改 private，把类的不变量搞乱。
- **安全风险**：能绕过权限、访问内部 API，模块系统已限制它。
- **代码可读性差**：动态调用让 IDE 无法跳转、编译期查不出错，重构风险高。

```java
package com.canoe.core.reflection;

import java.lang.reflect.Method;

public class PerfDemo {
    public static void main(String[] args) throws Exception {
        StringBuilder sb = new StringBuilder();
        Method append = sb.getClass().getMethod("append", String.class);

        int n = 1_000_000;
        long t1 = System.currentTimeMillis();
        for (int i = 0; i < n; i++) sb.append("x"); // 直接调用
        long t2 = System.currentTimeMillis();

        StringBuilder sb2 = new StringBuilder();
        long t3 = System.currentTimeMillis();
        for (int i = 0; i < n; i++) append.invoke(sb2, "x"); // 反射调用
        long t4 = System.currentTimeMillis();

        System.out.println("直接: " + (t2 - t1) + "ms, 反射: " + (t4 - t3) + "ms");
    }
}
```

（实测反射通常明显更慢，量级差距取决于 JVM 版本与调用次数。）

## 八、反射的性能优化

反射慢，但有办法救：

- **缓存 `Class`/`Method`/`Field` 对象**：别每次 `getMethod`，查一次缓存复用（Spring 就是这么干的）。
- **`setAccessible(true)`**：关闭访问检查，少一道权限校验，私有成员反射更快。
- **`MethodHandle`（JDK 7+）**：更贴近底层、可被 JIT 更好优化的「方法指针」，适合极端高频场景。
- **膨胀阈值**：JVM 对同一个反射方法调用超过一定次数（默认 15 次，inflation threshold）后，会生成字节码访问器（字节码生成的方法，绕过原生反射），之后性能接近直接调用。所以**偶尔的反射调用无所谓，真正高频才要优化**。

```java
package com.canoe.core.reflection;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

public class MethodHandleDemo {
    public static void main(String args[]) throws Throwable {
        // 查找 append(String) 的方法句柄
        MethodType mt = MethodType.methodType(StringBuilder.class, String.class);
        MethodHandle mh = MethodHandles.lookup()
                .findVirtual(StringBuilder.class, "append", mt);

        StringBuilder sb = new StringBuilder();
        // 像方法指针一样调用，比反射更易被 JIT 优化
        mh.invoke(sb, "canoe");
        System.out.println(sb);
    }
}
```

## 九、反射的典型应用

真实世界里全是反射的身影（简化代码）：

**① Spring IOC 依赖注入**：扫描 `@Component` 类 → 反射 `newInstance` 创建 Bean → 反射 `set`/`field.set` 注入依赖。

```java
// 简化版：根据类名反射创建对象并注入字段
Class<?> clazz = Class.forName("com.canoe.core.reflection.UserService");
Object bean = clazz.getDeclaredConstructor().newInstance();
Field f = clazz.getDeclaredField("repo");
f.setAccessible(true);
f.set(bean, repoInstance); // 注入依赖
```

**② MyBatis 结果集映射**：把 JDBC 的 `ResultSet` 按列名反射 `setter`/`field.set` 填进实体对象。

**③ Jackson 序列化**：反射读字段/`getter`，把对象转 JSON；反序列化时反射 `newInstance` + `set`。

**④ 动态代理**：`Proxy.newProxyInstance` 底层用反射生成代理类，实现 AOP、事务、RPC。

**⑤ JUnit**：运行时扫描 `@Test` 注解，反射 `newInstance` 创建测试类并 `invoke` 测试方法。

**⑥ ORM 通用 DAO**：`BaseDao<T>` 通过反射 `T` 的字段拼 SQL，一套代码服务所有实体。

## 本篇小结

- **反射是运行期获取并操作类元信息的能力**，赋予 Java 动态性。
- **获取 Class 三种方式**：`类名.class`、`对象.getClass()`、`Class.forName()`。
- **`Class.forName` 会触发类初始化**，`类名.class` 不会。
- **`getDeclaredFields/Methods` 含 private**，`getFields/Methods` 只取 public。
- **`setAccessible(true)` 暴力反射访问 private**，JDK 9+ 受模块系统限制。
- **`invoke(obj, args)` 调方法，静态方法首参传 `null`**。
- **可变参数反射调用要传 `Object` 数组**，防止被展开。
- **构造器用 `getDeclaredConstructor().newInstance()`**，`Class.newInstance()` 已过时。
- **反射优点：灵活、框架基石；缺点：慢、破坏封装、有安全风险**。
- **反射单次调用慢约一个数量级**，高频需缓存 + `MethodHandle` 优化。
- **JVM 调用超阈值后生成字节码访问器**，反射性能回升。
- **Spring/MyBatis/Jackson/JUnit/动态代理**全部建立在反射之上。

## 参考链接

- [Java 官方文档：反射教程](https://docs.oracle.com/javase/tutorial/reflect/)
- [Java 官方文档：java.lang.reflect 包](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/reflect/package-summary.html)
- [Java 官方文档：Class](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/Class.html)
- [Baeldung：Java 反射入门](https://www.baeldung.com/java-reflection)
- [Baeldung：MethodHandle 指南](https://www.baeldung.com/java-method-handles)
- [Oracle 文档：JDK 9 强封装与 --add-opens](https://docs.oracle.com/en/java/javase/17/migrate/index.html#JIGBF-ADFBDJB)
- [Spring 官方：IoC 容器](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans)

下一篇 → [09 枚举](/java/core/enum)
