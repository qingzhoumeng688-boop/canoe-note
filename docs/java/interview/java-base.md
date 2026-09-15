# Java 基础面试题
## 1. equals和双等于(==)的区别
::: tip 总结
-  **`==` 是运算符**：比较**栈里的值**，基本类型比数值，引用类型比**对象地址（是不是同一个对象）**
- **`equals()` 是 `Object` 类的方法**：**默认实现和`==`一样（比地址）**；很多类重写后用来**比较对象内容是否相等**
:::
### 1.1 双等于(==)
#### 1.1.1 基本数据类型
byte/short/int/long/float/double/char/boolean
直接比较变量的值
```java
int a = 10;
int b = 10;
System.out.println(a == b); // true，数值相等
```
#### 1.1.2 引用数据类型
比较**两个引用变量保存的对象内存地址**，判断是不是**同一个对象**
```java
String s1 = new String("abc");
String s2 = new String("abc");
System.out.println(s1 == s2); // false，两个不同对象，地址不一样
```
### 1.2 equals()方法
`equals` 是`Object`的成员方法，**所有 Java 对象都拥有这个方法**  
Object 源码：  
```java
public boolean equals(Object obj) {
    return (this == obj);
}
```
默认就是直接 `==`，**只比较地址**！  
但很多类重写了 equals：String、Integer、Date 等

重写之后不再比较地址，而是**比较对象内部的内容是否相同**
```java
String s1 = new String("abc");
String s2 = new String("abc");
System.out.println(s1.equals(s2)); // true，String重写equals，比较字符内容
```
### 1.3 String 常量池小坑（高频考点）
```java
String s1 = "abc";
String s2 = "abc";
System.out.println(s1 == s2); // true，常量池复用，指向同一个对象

String s3 = new String("abc");
System.out.println(s1 == s3); // false，new出来在堆上新对象
System.out.println(s1.equals(s3)); // true，内容相同
```
```java
// new出来的对象，在堆，不在常量池
String s1 = new String("abc");
String s2 = s1.intern(); // 把s1入池，拿到池内引用

String s3 = "abc"; // 字面量，直接拿常量池

System.out.println(s1 == s2); // false，s1还是堆对象
System.out.println(s2 == s3); // true，s2、s3都指向常量池

```
###  1.4 自定义类的 equals

自己写的实体类**不重写 equals**：调用 equals 依然是对比地址，和`==`效果一样
如果想要比较对象属性值，**必须手动重写 equals（同时建议重写 hashCode）**

```java
class User {
    private String name;
    // 没有重写equals时，equals等价 ==
}
```
## 2. 为什么重写了equals()方法时必须重写hashcode()方法


