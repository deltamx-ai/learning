# 软件开发能力提升路线：从代码实现到系统设计与工程组织

> 目标：不局限于 Android、前端或后端语言，建立理解系统、设计系统、组织项目和推动系统演化的能力。
>
> 核心路径：
>
> ```text
> 计算机基础 → 软件设计 → 系统设计 → 工程组织 → Android/前端/后端实践
> ```

## 一、真正需要提升的能力

高级开发能力不只是掌握更多框架，而是能够回答：

- 需求如何拆分？
- 模块边界如何划分？
- 数据和状态如何流动？
- 哪些地方需要抽象，哪些地方不应该抽象？
- 如何处理失败、并发、缓存、重试和兼容性？
- 一个项目如何从小规模演化到大规模？
- 如何让代码可测试、可观测、可替换、可维护？
- 如何组织团队和交付流程？

## 二、第一阶段：建立系统世界观

### 1. 计算机组成与程序运行

建议搜索：

- `Computer Architecture CPU RAM Cache Disk Storage`
- `Operating Systems processes threads memory`
- `How Computers Work`
- `Computer Networking fundamentals`

重点理解：

- CPU、内存、磁盘和缓存之间的差异
- 进程、线程和协程
- 堆、栈和虚拟内存
- 文件系统
- 网络 IO
- 程序为什么会慢、阻塞或崩溃

### 2. 网络与 Web 工作原理

推荐：

- Hussein Nasser：Backend Engineering、Network Engineering
- Practical Networking：Networking Fundamentals
- `How browsers work`
- `Critical Rendering Path`
- `DNS HTTP TLS WebSocket`

必须理解这条链路：

```text
输入 URL
→ DNS
→ TCP/TLS
→ HTTP
→ 服务器处理
→ 数据库
→ 返回响应
→ 浏览器解析 HTML/CSS/JS
→ Layout
→ Paint
→ Composite
```

## 三、第二阶段：软件设计和架构思想

### 1. 软件架构基础

推荐：

- freeCodeCamp：System Design Concepts Course and Interview Prep
- A Dev' Story：Software Architecture and Design
- Milan Jovanović：Clean Architecture & Domain-Driven Design
- Gaurav Sen：System Design Playlist
- ByteByteGo：System Design Fundamentals

搜索入口：

- https://www.youtube.com/results?search_query=freeCodeCamp+System+Design+Concepts+Course
- https://www.youtube.com/results?search_query=Gaurav+Sen+System+Design
- https://www.youtube.com/results?search_query=ByteByteGo+System+Design
- https://www.youtube.com/results?search_query=Clean+Architecture+Domain-Driven+Design+Milan+Jovanovic

不要把 Clean Architecture 只理解成文件夹模板。真正要思考：

```text
业务规则应该依赖什么？
变化最频繁的部分在哪里？
哪些东西是稳定核心？
哪些东西只是外部实现？
边界如何保护？
```

例如订单系统，应先从业务能力理解：

```text
订单领域
├── 创建订单
├── 取消订单
├── 支付
├── 发货
└── 退款
```

而不是一开始只按技术分成：

```text
controller
service
repository
utils
common
```

### 2. 系统设计

推荐：

- freeCodeCamp：System Design Concepts Course
- Gaurav Sen：System Design
- ByteByteGo：System Design Fundamentals
- Hello Interview：System Design Walkthroughs
- Martin Kleppmann：Distributed Systems
- MIT 6.824：Distributed Systems

搜索入口：

- https://www.youtube.com/results?search_query=Martin+Kleppmann+Distributed+Systems
- https://www.youtube.com/results?search_query=MIT+6.824+Distributed+Systems+2020
- https://www.youtube.com/results?search_query=Hello+Interview+System+Design

推荐学习顺序：

```text
单体应用
→ 模块化单体
→ 数据库设计
→ 缓存
→ 消息队列
→ 读写分离
→ 分库分表
→ 微服务
→ 分布式一致性
```

不要一开始就学微服务。很多所谓微服务问题，根本原因是模块边界、数据模型、团队职责或测试部署能力没有建立好。

## 四、Android：从 UI 开发到移动端系统设计

### 1. Android 架构

推荐：

- Android Developers：Modern Android Development / MAD Skills
- Android Developers：Building a scalable, modularized, testable app from scratch
- Philipp Lackner：Android Basics、Android Architecture

搜索入口：

- https://www.youtube.com/results?search_query=Android+Developers+Building+a+scalable+modularized+testable+app+from+scratch
- https://www.youtube.com/results?search_query=Android+Developers+Modern+Android+Development+MAD+Skills
- https://www.youtube.com/results?search_query=Philipp+Lackner+Android+Architecture
- https://www.youtube.com/results?search_query=Android+Clean+Architecture+Modularization

不要只停留在：

```text
Jetpack Compose 怎么写
ViewModel 怎么写
Room 怎么用
Retrofit 怎么配置
```

还要继续追问：

- 为什么 UI 状态应该单向流动？
- 为什么 ViewModel 不应该承载所有业务逻辑？
- Repository 的边界是什么？
- 什么场景适合多模块？
- 模块之间如何控制依赖方向？
- 离线、重试、缓存和分页如何设计？
- Activity 被销毁重建时，状态在哪里？
- 后台任务如何处理？
- 网络失败时用户看到什么？
- 如何测试业务逻辑而不只测试 UI？

一个可参考的组织方式：

```text
app
features
  ├── home
  ├── detail
  └── profile
core
  ├── network
  ├── database
  ├── design-system
  └── common
domain
data
```

多模块的目的不是让目录看起来高级，而是控制变化范围和依赖关系。

### 2. Android 的系统设计问题

推荐搜索：

- `Mobile System Design`
- `Android app architecture large scale`
- `offline first mobile architecture`
- `mobile sync architecture`
- `Android performance profiling`

手机应用必须处理：

- 网络随时断开
- 应用随时可能被杀
- 屏幕旋转和生命周期变化
- 电量、内存和存储受限
- 系统版本碎片化
- 设备厂商行为差异
- 发布后无法立即控制所有用户升级

## 五、前端：从组件开发到浏览器和交互系统

### 1. 浏览器原理与性能

推荐搜索：

- `How Browsers Render Websites`
- `Critical Rendering Path`
- `Chrome DevTools Performance`
- `Web Performance Optimization`
- `JavaScript event loop`
- `Browser rendering pipeline`

推荐内容：

- theSeniorDev：Every Frontend Architecture Pattern Explained
- Eric Tech：14 Front End System Design Concepts
- Dmitriy Zhiganov：Frontend System Design
- Web Performance Optimization 系列

搜索入口：

- https://www.youtube.com/results?search_query=theSeniorDev+Frontend+Architecture+Patterns
- https://www.youtube.com/results?search_query=Eric+Tech+Frontend+System+Design
- https://www.youtube.com/results?search_query=Dmitriy+Zhiganov+Frontend+System+Design
- https://www.youtube.com/results?search_query=How+Browsers+Render+Websites+Critical+Rendering+Path

必须理解：

```text
HTML Parser
→ DOM
CSS Parser
→ CSSOM
→ Render Tree
→ Layout
→ Paint
→ Composite
```

还要理解：

- reflow 和 repaint
- 为什么某些动画使用 transform
- JavaScript 如何阻塞渲染
- 事件循环如何工作
- SSR、SSG、CSR、ISR 的差异
- 浏览器缓存与 HTTP 缓存
- Web Worker 与主线程
- 前端性能如何通过工具测量

### 2. 前端架构取舍

重点比较：

```text
单体前端 vs 微前端
CSR vs SSR vs SSG
本地状态 vs 服务端状态
组件复用 vs 业务边界
全局状态 vs 局部状态
设计系统 vs 页面级样式
```

大型项目可以按业务能力组织：

```text
features
  ├── authentication
  ├── project-management
  ├── task-execution
  └── settings

shared
  ├── ui
  ├── api
  ├── hooks
  └── utilities
```

不要让 `components`、`hooks`、`utils`、`services` 变成没有边界的垃圾场。

## 六、后端：数据、网络、并发和失败

### 1. 后端工程基础

推荐 Hussein Nasser 的：

- Backend Engineering Beginner
- Backend Engineering Intermediate
- Backend Engineering Advanced
- Database Engineering
- Network Engineering

搜索入口：

- https://www.youtube.com/results?search_query=Hussein+Nasser+Backend+Engineering+Beginner
- https://www.youtube.com/results?search_query=Hussein+Nasser+Backend+Engineering+Intermediate
- https://www.youtube.com/results?search_query=Hussein+Nasser+Database+Engineering
- https://www.youtube.com/results?search_query=Hussein+Nasser+Network+Engineering

重点学习：

```text
HTTP
TCP
TLS
反向代理
负载均衡
连接池
线程模型
协程
数据库索引
事务
锁
缓存
消息队列
重试
幂等
限流
超时
熔断
日志
监控
```

### 2. 数据库

至少完整学习：

- SQL 执行计划
- 索引结构和 B+ Tree
- 事务、ACID、MVCC
- 锁和隔离级别
- 主从复制
- 分库分表
- 数据一致性
- Redis 的适用边界

推荐搜索：

- `Hussein Nasser Database Engineering`
- `Relational Database ACID Transactions`
- `Database Indexing and Query Optimization`
- `Martin Kleppmann Designing Data-Intensive Applications`

### 3. 分布式系统

建议顺序：

```text
分布式系统为什么难
→ RPC
→ 线程与并发
→ 一致性
→ 日志
→ Raft
→ 容错
→ 分布式事务
```

Martin Kleppmann 更适合建立思想，MIT 6.824 更适合深入实现。

## 七、真正提升组织架构能力的内容

### 1. 软件演化

推荐搜索：

- `Refactoring large codebases`
- `Legacy code modernization`
- `Modular monolith architecture`
- `Evolutionary architecture`
- `Architecture decision records`
- `Software architecture tradeoffs`

要学习项目如何演化：

```text
原型
→ 可用版本
→ 模块化
→ 测试体系
→ 持续集成
→ 监控
→ 扩展
→ 性能优化
→ 团队协作
```

### 2. 工程组织

推荐搜索：

- `trunk based development`
- `continuous delivery`
- `software team topology`
- `code review best practices`
- `observability for software systems`
- `incident response engineering`
- `architecture decision record`

重点理解：

- Git 分支策略
- Code Review
- CI/CD
- 发布策略
- Feature Flag
- 灰度发布
- 日志、指标和链路追踪
- 事故复盘
- 技术债管理
- ADR 架构决策记录
- 如何控制项目复杂度

### 3. 领域驱动设计

不要先背术语，要先理解：

```text
业务能力
→ 领域边界
→ 聚合
→ 领域事件
→ 应用服务
→ 基础设施
```

DDD 的价值不是让代码变复杂，而是帮助团队把业务边界说清楚。

## 八、建议的 24 周路线

如果每周投入 8～10 小时：

### 第 1～4 周：计算机与网络

```text
CPU、内存、进程、线程
TCP、HTTP、DNS、TLS
浏览器渲染
数据库基本原理
```

### 第 5～8 周：软件设计

```text
模块化
SOLID
依赖倒置
Clean Architecture
DDD
测试设计
```

### 第 9～12 周：系统设计

```text
缓存
数据库扩展
消息队列
负载均衡
限流
幂等
一致性
可观测性
```

### 第 13～16 周：Android 和前端架构

```text
Android 生命周期、状态、模块化、离线
前端渲染、状态管理、性能、微前端
```

### 第 17～20 周：后端工程

```text
API 设计
数据库性能
并发模型
任务队列
错误处理
部署和监控
```

### 第 21～24 周：完整跨端项目

可以做一个本地优先的任务管理系统：

```text
Android 客户端
Web 管理端
Backend API
PostgreSQL
Redis
后台任务
认证
离线缓存
同步冲突处理
日志和监控
CI/CD
```

这个项目比做十个 Todo Demo 更有价值，因为它会迫使你面对真实的架构问题。

## 九、看视频时的复盘模板

不要只收藏视频或抄笔记。每看完一个系统设计视频，回答：

1. 这个系统的核心业务是什么？
2. 哪些是稳定规则，哪些是可替换实现？
3. 数据从哪里来，到哪里去？
4. 哪些地方会失败？
5. 规模扩大后，哪里先成为瓶颈？
6. 如果需求变化，哪些模块需要修改？

可使用下面的 Markdown 模板：

```markdown
# 系统名称

## 核心需求

## 主要用例

## 模块边界

## 数据流

## 关键技术取舍

## 失败场景

## 扩展瓶颈

## 如果重新设计，我会怎么改

## 我还没有理解的地方
```

## 十、最值得执行的主线

如果只选一条路线：

```text
Hussein Nasser
→ freeCodeCamp System Design
→ Gaurav Sen / ByteByteGo
→ Martin Kleppmann
→ Android Developers 架构内容
→ 前端浏览器与性能
→ 自己做一个跨端项目并持续重构
```

最终目标不是“看完所有课程”，而是建立三种能力：

```text
看懂系统：理解代码为什么这样组织
设计系统：能做边界和取舍
改造系统：能让已有项目逐步变好
```

语言只是实现细节，真正能拉开差距的是：边界、数据流、失败处理、演化能力和工程组织。

## 十一、视频来源说明

视频名称、频道和搜索入口基于整理时的 YouTube 搜索结果。视频可能因平台地区、频道更新或标题变化而变化；学习时应以频道内的最新课程和播放列表为准。

整理日期：2026-09-23
