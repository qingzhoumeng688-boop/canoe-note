import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: '/canoe-note/',
  ignoreDeadLinks: true,
  title: "轻舟的笔记",
  description: "轻舟的一些学习和生活笔记",
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
  ],
  themeConfig: {
    outline: {
      level: 'deep',
      label: '本页目录'
    },
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: 'Java', link: '/java/intro' },
      { text: 'AI 应用', link: '/java/ai/overview' },
      { text: '运维', link: '/java/intro' },
      { text: '工具', link: '/java/intro' },
      { text: '健身', link: '/fitness/intro' },
      { text: '做饭', link: '/cooking/intro' },
      { text: '其他', link: '/other/intro' }
    ],

    sidebar: [
      {
        text: 'Java教程',
        items: [
          { text: '简介', link: '/java/intro' },
          {
            text: 'Java快速入门',
            collapsed: true,
            items: [
              { text: 'Java历史', link: '/java/quickstart/history' },
              { text: '搭建开发环境', link: '/java/quickstart/env' },
              { text: 'Java程序基础', link: '/java/quickstart/basic' },
              { text: '流程控制', link: '/java/quickstart/control' },
              { text: '数组操作', link: '/java/quickstart/array' },
            ]
          },
          {
            text: '面向对象编程',
            collapsed: true,
            items: [
              { text: '面向对象基础', link: '/java/oop/base' },
              { text: '方法', link: '/java/oop/method' },
              { text: '构造方法', link: '/java/oop/constructor' },
              { text: '方法重载', link: '/java/oop/overload' },
              { text: '继承', link: '/java/oop/extend' },
              { text: '多态', link: '/java/oop/polymorphism' },
              { text: '抽象类', link: '/java/oop/abstract' },
              { text: '接口', link: '/java/oop/interface' },
              { text: '静态字段和静态方法', link: '/java/oop/static' },
              { text: '包', link: '/java/oop/package' },
              { text: '访问作用域', link: '/java/oop/scope' },
              { text: '内部类', link: '/java/oop/innerclass' },
              { text: 'this与super', link: '/java/oop/this-super' },
            ]
          },
          {
            text: 'Java核心API',
            collapsed: true,
            items: [
              { text: 'String字符串', link: '/java/core/string' },
              { text: '包装类', link: '/java/core/wrapper' },
              { text: '集合框架', link: '/java/core/collection' },
              { text: 'IO流', link: '/java/core/io' },
              { text: '日期时间API', link: '/java/core/datetime' },
              { text: '泛型', link: '/java/core/generic' },
              { text: '注解', link: '/java/core/annotation' },
              { text: '反射', link: '/java/core/reflection' },
              { text: '枚举', link: '/java/core/enum' },
            ]
          },
          {
            text: '异常处理',
            collapsed: true,
            items: [
              { text: '异常基础', link: '/java/exception/base' },
              { text: '受检异常与非受检异常', link: '/java/exception/checked-unchecked' },
              { text: 'try-catch-finally', link: '/java/exception/try-catch' },
              { text: '自定义异常', link: '/java/exception/custom' },
            ]
          },
          {
            text: '多线程与并发',
            collapsed: true,
            items: [
              { text: '线程基础', link: '/java/thread/base' },
              { text: '线程创建方式', link: '/java/thread/create' },
              { text: '线程状态与生命周期', link: '/java/thread/lifecycle' },
              { text: 'synchronized锁', link: '/java/thread/synchronized' },
              { text: 'volatile关键字', link: '/java/thread/volatile' },
              { text: 'Lock锁', link: '/java/thread/lock' },
              { text: '线程池', link: '/java/thread/pool' },
              { text: '并发工具类', link: '/java/thread/util' },
              { text: 'CAS与AQS', link: '/java/thread/cas-aqs' },
              { text: 'ThreadLocal', link: '/java/thread/threadlocal' },
              { text: '并发安全问题', link: '/java/thread/safe' },
            ]
          },
          {
            text: 'JVM虚拟机',
            collapsed: true,
            items: [
              { text: 'JVM基础结构', link: '/java/jvm/structure' },
              { text: '类加载机制', link: '/java/jvm/classload' },
              { text: '运行时数据区', link: '/java/jvm/runtime' },
              { text: '垃圾回收GC', link: '/java/jvm/gc' },
              { text: '垃圾收集器', link: '/java/jvm/gc-collector' },
              { text: '内存模型JMM', link: '/java/jvm/jmm' },
              { text: 'JVM调优', link: '/java/jvm/tune' },
              { text: '类字节码', link: '/java/jvm/bytecode' },
            ]
          },
          {
            text: '数据库 & JDBC',
            collapsed: true,
            items: [
              { text: 'MySQL基础', link: '/java/db/mysql-base' },
              { text: 'SQL语句', link: '/java/db/sql' },
              { text: '索引原理', link: '/java/db/index' },
              { text: '事务与ACID', link: '/java/db/transaction' },
              { text: 'MVCC', link: '/java/db/mvcc' },
              { text: '锁机制', link: '/java/db/lock' },
              { text: 'JDBC基础', link: '/java/db/jdbc' },
              { text: '连接池', link: '/java/db/pool' },
            ]
          },
          {
            text: 'MyBatis',
            collapsed: true,
            items: [
              { text: 'MyBatis入门', link: '/java/mybatis/base' },
              { text: 'Mapper与XML', link: '/java/mybatis/mapper' },
              { text: '动态SQL', link: '/java/mybatis/dynamic-sql' },
              { text: '一级缓存二级缓存', link: '/java/mybatis/cache' },
            ]
          },
          {
            text: 'Spring框架',
            collapsed: true,
            items: [
              { text: 'Spring简介', link: '/java/spring/intro' },
              { text: 'IOC容器', link: '/java/spring/ioc' },
              { text: 'Bean生命周期', link: '/java/spring/bean' },
              { text: 'AOP面向切面', link: '/java/spring/aop' },
              { text: '事务管理', link: '/java/spring/tx' },
            ]
          },
          {
            text: 'SpringBoot',
            collapsed: true,
            items: [
              { text: 'SpringBoot入门', link: '/java/springboot/intro' },
              { text: '自动配置原理', link: '/java/springboot/autoconfig' },
              { text: '配置文件', link: '/java/springboot/config' },
              { text: 'Web开发', link: '/java/springboot/web' },
              { text: '全局异常处理', link: '/java/springboot/exception' },
              { text: '整合MyBatis', link: '/java/springboot/mybatis' },
              { text: 'SpringBoot常用注解', link: '/java/springboot/annotation' },
            ]
          },
          {
            text: '分布式 & 微服务',
            collapsed: true,
            items: [
              { text: '分布式基础概念', link: '/java/cloud/distribute-base' },
              { text: 'CAP与BASE理论', link: '/java/cloud/cap-base' },
              { text: '分布式事务', link: '/java/cloud/distribute-tx' },
              { text: '分布式锁', link: '/java/cloud/distribute-lock' },
              { text: '分布式ID', link: '/java/cloud/distribute-id' },
              { text: '接口幂等性', link: '/java/cloud/idempotent' },
              { text: '限流熔断降级', link: '/java/cloud/rate-limit' },
            ]
          },
          {
            text: 'Spring Cloud',
            collapsed: true,
            items: [
              { text: '微服务入门', link: '/java/cloud/springcloud/intro' },
              { text: '注册中心Nacos', link: '/java/cloud/springcloud/nacos' },
              { text: '服务调用OpenFeign', link: '/java/cloud/springcloud/openfeign' },
              { text: '网关Gateway', link: '/java/cloud/springcloud/gateway' },
              { text: 'Sentinel熔断限流', link: '/java/cloud/springcloud/sentinel' },
              { text: '配置中心', link: '/java/cloud/springcloud/config' },
            ]
          },
          {
            text: '中间件',
            collapsed: true,
            items: [
              { text: 'Redis', link: '/java/middleware/redis' },
              { text: 'RabbitMQ', link: '/java/middleware/rabbitmq' },
              { text: 'Elasticsearch', link: '/java/middleware/es' },
            ]
          },
          {
            text: '面试专题',
            collapsed: true,
            items: [
              { text: 'Java基础面试题', link: '/java/interview/java-base' },
              { text: '并发面试题', link: '/java/interview/thread' },
              { text: 'JVM面试题', link: '/java/interview/jvm' },
              { text: '框架面试题', link: '/java/interview/framework' },
              { text: '分布式面试题', link: '/java/interview/distribute' },
            ]
          },
        ]
      },
      {
        text: 'Java AI 应用',
        collapsed: true,
        items: [
          {
            text: '基础篇',
            collapsed: true,
            items: [
              { text: '01 AI 开发概览', link: '/java/ai/overview' },
              { text: '02 大模型 API 接入', link: '/java/ai/llm-api' },
              { text: '03 提示词工程', link: '/java/ai/prompt' },
              { text: '04 流式输出与 Function Calling', link: '/java/ai/stream-fc' },
              { text: '05 Spring AI 框架', link: '/java/ai/spring-ai' },
              { text: '06 LangChain4j 框架', link: '/java/ai/langchain4j' },
            ]
          },
          {
            text: 'Spring AI Alibaba',
            collapsed: true,
            items: [
              { text: '07 概览与三层架构', link: '/java/saa/intro' },
              { text: '08 快速上手', link: '/java/saa/quickstart' },
              { text: '09 版本与生态关系', link: '/java/saa/ecosystem' },
              { text: '10 ReactAgent', link: '/java/saa/reactagent' },
              { text: '11 多 Agent 编排', link: '/java/saa/multi-agent' },
              { text: '12 上下文工程', link: '/java/saa/context-engineering' },
              { text: '13 人机协同 HITL', link: '/java/saa/hitl' },
              { text: '14 Graph 构图基础', link: '/java/saa/graph-basics' },
              { text: '15 状态与流程控制', link: '/java/saa/graph-state' },
              { text: '16 持久化与断点续跑', link: '/java/saa/graph-persist' },
              { text: '17 模型与 ChatClient', link: '/java/saa/model' },
              { text: '18 Tool 与 MCP', link: '/java/saa/tool-mcp' },
            ]
          },
          {
            text: '检索增强 RAG',
            collapsed: true,
            items: [
              { text: '19 RAG 检索增强', link: '/java/saa/rag' },
              { text: '20 RAG 进阶调优', link: '/java/saa/rag-advanced' },
            ]
          },
          {
            text: '工程化与落地',
            collapsed: true,
            items: [
              { text: '21 可观测性与评估', link: '/java/saa/observability' },
              { text: '22 Studio 与 Admin', link: '/java/saa/studio-admin' },
              { text: '23 实战案例', link: '/java/saa/cases' },
              { text: '24 常见问题与踩坑', link: '/java/saa/faq' },
            ]
          },
        ]
      },
      {
        text: '运维',
        items: [
          { text: 'VMware', link: '/ops/vmware/vmware' },

        ]
      },
      {
        text: '健身',
        items: [
          { text: '入门指南', link: '/fitness/intro' },
          { text: '腹部训练', link: '/fitness/abdominal' },
          { text: '背部训练', link: '/fitness/back' },
          { text: '胸部训练', link: '/fitness/chest' },
          { text: '腿部训练', link: '/fitness/legs' },
          { text: '肩部训练', link: '/fitness/shoulders' },
          { text: '手臂训练', link: '/fitness/arms' }
        ]
      },{
        text: '做饭',
        items: [
          { text: '入门指南', link: '/cooking/intro' },
          { text: '家常菜', link: '/cooking/home' }
        ]
      },{
        text: '其他',
        items: [
          { text: '入门指南', link: '/other/intro' },
        ]
      }
    ],
    // socialLinks: [
    //   { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    // ]
  }
})
