# 从 Electron IPC 底层看安全通信设计原则（8 条启发）

> 日期：2026-08-19
> 来源：Electron IPC 底层研究（Mojo / contextBridge / 进程模型）
> 用途：把底层机制提炼成可迁移的设计原则，映射到 molecraft / single-spa-mfe / oneapp
> 关系：本文件是 electron-ipc-internals.md（概念）+ electron-src/（源码）的思想提炼

---

## 启发 1：安全不是"过滤坏人"，是"根本不存在的入口"

```text
Electron 的做法：
  白名单不是"拦截非法请求"——是 ipcRenderer 本体根本不过去
  页面想发明新 channel？连入口都不存在

对你的启发（oneapp 微前端）：
  你的 iframe 能力请求已经做了白名单映射 ✅
  但要问自己：iframe 是不是【连 window.mobileApp 的存在都感知不到】？
  如果 iframe 能调用任意 bridge method、只是被过滤 → 防御降级了
  理想状态：iframe 只见过"请求名"，不知道"method 全貌"
  （设计文档已写这条，这就是"入口不存在"思想）
```

---

## 启发 2：信任边界必须清晰，校验必须在对侧

```text
Electron 的做法：
  preload 无逻辑（不校验）→ 校验在主进程
  因为 preload 和页面同进程，preload 校验可被绕过

对你的启发（molecraft IPC）：
  你的 preload 注释已写 "Nothing is validated here" ✅
  检查有没有把校验放在【渲染进程侧】的：
  - sender 校验 → 必须在主进程（在做 ✅）
  - payload schema 校验 → 必须在主进程（在做 ✅）
  - 业务权限（路径边界）→ 必须在主进程（在做 ✅）
  原则：校验永远放在"离资源最近的那一侧"，而不是"离用户最近的那一侧"
```

---

## 启发 3：通道即信任——"fd 只能经已有通道传递"

```text
Electron 的做法：
  端口/句柄只能经已有通道传递 → 无法伪造 → 通信不可插入
  这是操作系统层的保证，不是协议层的约定

对你的启发（iframe MessageChannel）：
  你的 MessageChannel 设计正是这个思想 ✅
  但注意边界（之前讨论过）：
  - 建通道的握手消息必须校验 origin + ports
  - 一旦 XSS，端口引用同样会被拿到（JS 对象没有 OS 级保护）
  → 所以业务层白名单照做（已做 ✅）
  启发点：真正的"不可伪造"要下沉到 OS 层，
  Web 场景没有 OS 级句柄 → 靠严格握手 + 白名单补偿
```

---

## 启发 4：调用 vs 消息——选对通信原语

```text
Electron 内部其实有两条路：
  - 同进程跨世界：Context::Scope 上下文切换（像"调用"）
  - 跨进程：Mojo 消息传递（像"消息"）

对你的启发（架构设计时）：
  同进程/同世界内 → 直接函数调用（快，无需序列化）
  跨信任边界     → 必须消息传递（带校验、带序列化）

  molecraft 里：
    React 组件之间 → 直接调用 ✅
    renderer → main → IPC 消息 ✅
  别把"同一个信任域内"的东西也套上 IPC（过度设计）

  single-spa-mfe 里：
    base 和 react-app 同源 → 可以直接共享 store？
    还是必须 postMessage？→ 看信任边界：同源可直连，跨源必须消息
```

---

## 启发 5：初始握手是信任的种子（Bootstrap）

```text
Electron 的做法：
  socketpair 在进程出生前建立 → 之后一切通信依赖它
  第一条通道的建立方式决定了整个信任链

对你的启发：
  所有通信系统都需要一个"bootstrap 时刻"：
  - iframe MessageChannel：init 握手（校验 origin + 换端口）✅ 已做
  - oneapp bridge：sessionId + trustedOrigin 交换 ✅ 已做
  - molecraft 未来 Agent 子进程：spawn 时就要决定 env/cwd 白名单
  → 设计新通信时先问：谁建立第一条通道？怎么保证它可信？
```

---

## 启发 6：序列化边界 = 契约边界

```text
Electron 的做法：
  IPC 只能传数据（结构化克隆），函数/引用过不去
  → 强制你设计成"纯数据接口"

对你的启发（molecraft shared/contracts）：
  你的 contracts 全是纯数据 ✅ 这是对的
  反面教训：
  如果某个"接口"需要传函数/回调 → 说明它不该走 IPC
  → 重新设计：要么把逻辑移到对侧，要么换通信方式
  契约不仅是"类型定义"，是"边界声明"——哪里能传什么，写清楚
```

---

## 启发 7：资源生命周期要显式管理

```text
Electron 的做法：
  ScopedFD（RAII，fd 自动关闭）
  发送失败 → 句柄拉回来重试（不丢资源）
  渲染进程崩溃 → receiver 断开 → 清理回调

对你的启发：
  - molecraft 未来 Agent 子进程：超时回收、退出清理、孤儿进程防泄漏
    （runs/service.ts 的 whenSettled/cancelAll 就是这个思想 ✅）
  - 事件监听器：onEvent 必须返回取消订阅函数（preload 已做 ✅）
  - iframe 通信：页面卸载时关闭 port、清理监听
  原则：谁创建，谁负责回收；崩溃/失败也要能清理
```

---

## 启发 8：性能分层——小消息走管道，大对象走共享内存

```text
Electron 的做法：
  小 payload → 消息管道
  大 payload → DataPipe 共享内存零拷贝
  帧级数据 → 根本不过 IPC（留在 renderer）

对你的启发：
  pose-demo 的逐帧数据不过 IPC ✅（文档已强调）
  延伸原则（molecraft）：
  - 配置/命令 → IPC（小消息）
  - 大文件内容 → 共享内存/直接文件句柄（别塞 IPC）
  - 高频流（AI token）→ 事件通道或 MessagePort 专线
  设计 API 前先按"数据大小 × 频率"分类，选对通道
```

---

## 总结：一套"安全通信"的完整哲学

```text
1. 入口不存在（比过滤更强）
2. 校验在对侧（离资源最近）
3. 通道即信任（握手建立，不可伪造）
4. 选对原语（调用 vs 消息看信任边界）
5. 握手是种子（bootstrap 决定信任链）
6. 契约即边界（纯数据接口）
7. 资源显式管理（谁创建谁回收）
8. 性能分层（按数据特性选通道）

对照你的项目：
  ✅ 已做到：白名单映射、主进程校验、MessageChannel 握手、
     contracts 纯数据、preload 无逻辑、监听器清理
  ⚠️ 可加强：iframe 是否"感知不到入口"、资源回收完整性、
     数据大小×频率分类选通道
```

---

## 落地检查清单（下次设计通信时过一遍）

```text
□ 接收方能感知到完整能力面吗？（应只看到请求名/白名单）
□ 校验在哪一侧？（应在离资源最近侧）
□ 第一条通道怎么建立的？握手可信吗？
□ 用的调用还是消息？（看信任边界）
□ 接口是纯数据吗？（有函数/回调 = 设计错了）
□ 资源谁创建谁回收？崩溃了能清理吗？
□ 数据按大小×频率分类选对通道了吗？
```
