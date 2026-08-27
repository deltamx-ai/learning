# Electron IPC 底层实现拆解

> 日期：2026-08-19
> 对象：molecraft（Electron 43）
> 目的：从底层理解 Electron IPC 是怎么实现的、有哪些封装层
> 内容：Mojo 传输 → Electron mojom 接口 → ipcMain/ipcRenderer → contextBridge

---

## 1. 总览：IPC 的四层封装

> 与 pose-demo 的应用层流程对应的教材见：`/home/delta/workspace/ai/pose-demo/docs/electron-main-renderer-ipc-flow.md`；从用户点击图标到 Electron runtime、Main、BrowserWindow、preload、Renderer、Mojo 消息和屏幕更新的逐跳底层说明见：`/home/delta/workspace/ai/pose-demo/docs/electron-from-click-to-ipc.md`。当前 pose-demo 仍是 Web 项目，相关文档描述的是未来 Electron 化边界，不表示 Electron 主进程已经存在。

```text
第 4 层  contextBridge          ← 你的代码碰到的（window.desktop.xxx）
第 3 层  ipcMain/ipcRenderer    ← Electron 提供的 JS API（invoke/send/on）
第 2 层  Electron 的 mojom 接口  ← C++ 层，renderer ↔ browser 的 RPC 定义
第 1 层  Chromium Mojo           ← 真正的进程间传输管道
         ↓
        操作系统（Unix socket / 共享内存 / 管道）
```

**关键认知**：Electron 没有发明 IPC 传输层，它用的是 Chromium 现成的 Mojo；
Electron 做的是"把 Node.js 世界接进 Chromium 的 IPC 体系"。

---

## 2. 第 1 层：Chromium Mojo（真正的传输）

Mojo 是 Chromium 内部通用的 IPC 框架：

```text
核心概念：
  MessagePipe —— 一对双向管道（port 对）
  Endpoint    —— 管道的一端（每个进程持有一端）
  序列化      —— 消息打成字节流（带类型元数据）
  共享内存    —— 大数据 payload 直接映射共享内存，不走管道拷贝
```

```text
进程 A                    进程 B
┌──────────┐            ┌──────────┐
│ port A   │◄──管道────►│ port B   │
│ 发送/接收 │            │ 发送/接收 │
└──────────┘            └──────────┘
```

底层承载（Linux/macOS）：

```text
同一机器上的两个进程之间：
  Unix domain socket（本机管道）
  + 大对象用共享内存（shm）零拷贝
```

Mojo 不是"发字符串"，而是定义好接口后生成类型安全的 RPC 绑定（类似 gRPC 但进程内）。

---

## 2A. 引导通道（Bootstrap）：第一条通道怎么来的

> 追加：2026-08-19。回答"通道从哪来"——进程出生前通道就造好了。

### 2A.1 进程还没出生，通道先造好

```text
主进程要创建渲染进程时，顺序是【先造通道，再造进程】：

第 1 步：主进程调用 socketpair() 创建一对 socket
         （Unix domain socket，双向）
         ┌─ socket A ─┐   ┌─ socket B ─┐
         │            │   │            │
         └────────────┘   └────────────┘
         这俩是连通的，且此刻都在主进程手里

第 2 步：主进程 fork/spawn 子进程（渲染进程）
         → 子进程【继承】socket B 的文件描述符（fd）
         → 因为 fork 时子进程拷贝父进程的文件描述符表

第 3 步：主进程关掉自己手里的 socket B（只留 A）
         子进程关掉自己手里的 socket A（只留 B）

第 4 步：现在 A 在主进程、B 在渲染进程 —— 通道打通了！
```

```text
┌─ 主进程 ──────────┐         ┌─ 渲染进程 ──────────┐
│  socket A (fd 5)   │◄══════►│  socket B (fd 5)    │
│                    │ 双向管道 │                    │
└────────────────────┘         └────────────────────┘
```

**这就是引导通道（bootstrap channel）的物理真相：一对 socketpair，靠 fork 继承 fd 完成跨进程"递送"。**

### 2A.2 为什么用 socketpair 而不是别的方式

```text
socketpair = 同一台机器上两个进程间的双向管道
  ✅ 双向（A 发 B 收，B 发 A 收）
  ✅ 支持"传文件描述符"（SCM_RIGHTS，这是关键）
  ✅ 内核级，无用户态锁
  ❌ 不能跨机器（但这本来就是本机进程通信）

对比：
  TCP localhost → 可以但绕（走网络栈）
  pipe() → 只能单向
  socketpair → 双向 + 能传 fd，完美
```

---

## 2B. 端口传递的底层：SCM_RIGHTS（文件描述符搬家）

> Mojo 的"端口"在 Unix 上本质是一个文件描述符，传递端口 = 通过 Unix socket 传 fd。

### 2B.1 Unix socket 的一个特殊能力

```text
普通 socket 只能发数据字节
Unix domain socket 额外支持：随数据一起发送"文件描述符"

技术名：SCM_RIGHTS（ancillary data，辅助数据）
  sendmsg() 时带上 fd 的引用
  recvmsg() 时对端拿到一个新的 fd（指向同一个内核对象）
```

### 2B.2 Mojo 端口 = 什么

```text
Mojo 的 MessagePipe 在 Unix 上的实现：
  create() = 内部创建一对 socketpair（或 eventfd 等）
  → port 本质 = 这个 socketpair 的一个 fd

传递端口：
  port B 作为"句柄"塞进一条 Mojo 消息的辅助数据里
  → 通过已存在的通道（如引导通道）发给对端
  → 对端 recvmsg 时拿到 fd → 包装成新的 Mojo port 对象
```

```text
┌─ 进程 X ────────────────────────┐
│  port A（socketpair 一端）      │
│                                │
│  新建：port C + port D          │
│  把 port D 塞进消息辅助数据     │
│  sendmsg(引导通道, 数据, fd=D)  │
└──────────┬─────────────────────┘
           │  SCM_RIGHTS：fd 跟着消息走
┌──────────▼─────────────────────┐
│  进程 Y                        │
│  recvmsg(引导通道)             │
│  → 拿到数据 + 一个新的 fd      │
│  → 包装成 port D'              │
│  → 现在 Y 有 port D'，与 X 的 port C 连通 │
└────────────────────────────────┘
```

### 2B.3 为什么这决定了安全模型

```text
传递 fd 只能通过【已有的通道】进行
→ 你没有通道，就拿不到任何端口引用
→ 通道是主进程亲手建立的（引导通道）
→ 外部进程无法凭空获得端口 → 无法插入通信

这就是"端口不可伪造"的物理根基：
  不是协议层的规矩，是操作系统层（fd 只能经通道传递）
```

### 2B.4 Windows 上对应物

```text
Windows 没有 Unix fd 概念，对应的是 HANDLE：
  Mojo 在 Windows 上用"句柄复制"（DuplicateHandle）
  + 命名管道/共享内存作为通道
  语义一样：句柄只能经已有通道传给对端进程
```

---

## 2C. 握手（Handshake）：通道建好后先"互相认识"

```text
主进程 → 渲染进程：hello 消息
  我的 PID
  初始端口列表（几个关键 mojom 接口的端口）
  共享内存区域（用于大消息零拷贝）
  进程类型信息

渲染进程 → 主进程：hello 回执
  确认版本
  自己的状态
```

握手完成后，双方才进入正常工作状态——**ipcMain/ipcRenderer 是握手完成之后才可用的**。

```text
时序：
  spawn（socketpair 就绪）
    → Mojo 握手（交换初始端口）
      → Electron 的 ElectronRenderer/ElectronBrowser 接口建立
        → preload 加载
          → window.desktop.xxx 可用了
            → 渲染进程开始跑 React
```

---

## 2D. Electron 启动时有多少条"命脉"

渲染进程手里通常有几类通道：

```text
1. 引导通道（bootstrap）        第一条，后续一切的载体
2. Mojo 初始接口端口            几个固定的 mojom 接口（含 ElectronRenderer）
3. 共享内存区域                 大消息零拷贝用（文件映射）
4. 各平台的专用通道             如 Windows 的 job object 控制
```

与你直接相关的：

```text
ElectronRenderer 接口端口
  → ipcRenderer.send/invoke/sendSync 全走它
  → 它上面可以继续派生新端口（比如 MessagePort 传递）
```

---

## 2E. 沙箱（sandbox: true）与 Broker

沙箱开启后，渲染进程被限制系统调用，Mojo 层面多了个角色：**Broker（代理）**。

```text
沙箱渲染进程不能直接做的事（举例）：
  - 分配共享内存（mmap 某些操作受限）
  - 某些句柄/端口操作

→ 这些操作"外包"给主进程里的 Broker
→ 渲染进程发请求 → Broker 代办 → 返回结果

┌─ 主进程 ────────────┐      ┌─ 渲染进程（沙箱）─────┐
│  Broker 服务         │◄────►│ 受限的 Mojo 客户端     │
│  分配共享内存/句柄    │      │ 不能直接 mmap 大内存   │
└─────────────────────┘      └───────────────────────┘
```

**影响**：沙箱下某些"传端口/传大对象"的操作多一跳（经过 Broker），
这是"安全换性能"的典型权衡——molecraft 开了 sandbox，代价就是大消息传递会经过 Broker。

---

## 2F. 落到代码：webContents.postMessage 传端口（MessagePort 专线）

### 主进程侧

```ts
import { MessageChannelMain } from 'electron'

// 主进程创建一对端口
const { port1, port2 } = new MessageChannelMain()

// 把 port2 通过已有的 IPC 通道"递"给渲染进程
win.webContents.postMessage('dedicated-channel', 'channel-ready', [port2])

// port1 留在主进程用
port1.on('message', (event) => {
  console.log('来自渲染进程:', event.data)
})
port1.start()
```

### 渲染进程侧

```ts
// 接收传递过来的端口（标准的 window.postMessage 路径）
window.addEventListener('message', (event) => {
  if (event.data === 'channel-ready' && event.ports.length > 0) {
    const port = event.ports[0]   // 拿到专用端口

    port.onmessage = (e) => {
      console.log('来自主进程:', e.data)
    }
    port.start()

    // 之后双方用 port 直接通信，不再走 ipcMain
    port.postMessage('hello from renderer')
  }
})
```

### 底层发生了什么

```text
new MessageChannelMain() 
  → C++ 里 create 一对 Mojo MessagePipe（port1/port2）

webContents.postMessage(..., [port2])
  → 把 port2 的句柄塞进一条 Mojo 消息的辅助数据
  → 走 ElectronBrowser 接口（已有的命脉）
  → 渲染进程收到 → 解出 fd → 包装成 MessagePort

之后 port1 ↔ port2 直接通信：
  → 走各自的 socketpair，不再经过 ipcMain/ipcRenderer
  → 这是一条"专属对讲机"，别人拿不到
```

### 什么时候该用 MessagePort 而不是 invoke

```text
invoke（现在 runs:event 的模式）：
  广播/共享通道，简单直接
  适合：低频请求响应、全局事件

MessagePort（专属管道）：
  一对一专线，互不干扰
  适合：
    - 某次 Run 的 AI token 流（每个 Run 一条专线）
    - 大文件分片传输
    - 长时间高频通信（日志流、进度流）
    - 多个并发任务隔离（任务 A 的消息不会混进任务 B）
```

---

## 2G. 完整链路图（最底层到你的代码）

```text
OS: socketpair() → fork 继承 fd            ← 引导通道（物理）
    ↓
Chromium: Mojo 握手 → 交换初始端口          ← 第一条命脉
    ↓
Electron: ElectronRenderer/Browser 接口     ← IPC 的"干线"
    ↓
          ipcMain/ipcRenderer              ← 你用的 API（invoke/send）
    ↓
          contextBridge                    ← 安全外壳（白名单）
    ↓
          window.desktop.xxx               ← 你的代码
    ↓
          MessagePort（可选的"专线"）       ← 一对一快速通道
```

---

## 2H. 底层知识速查表

| 概念 | 本质 | 关键点 |
| --- | --- | --- |
| socketpair | 本机双向管道 | fork 时靠 fd 继承完成"递送" |
| SCM_RIGHTS | Unix socket 传 fd | 端口传递的物理机制 |
| 引导通道 | 第一条 socketpair | 进程出生前就造好 |
| 握手 | 交换初始端口 | 之后 IPC 才可用 |
| Broker | 沙箱的代理 | 沙箱进程间接做受限操作 |
| MessagePort | 专属 MessagePipe | postMessage 传端口，一对一 |

---

## 3. 第 2 层：Electron 的 mojom 接口（C++ RPC 定义）

Electron 在 Chromium 的 Mojo 之上定义了**自己的一对接口**（shell/common/api/ 下的 mojom）：

```text
ElectronRenderer（renderer → browser 方向）：
  Message(...)              ← ipcRenderer.send 的底层
  Invoke(...)               ← ipcRenderer.invoke 的底层
  MessageSync(...)          ← ipcRenderer.sendSync 的底层
  ...

ElectronBrowser（browser → renderer 方向）：
  Message(...)              ← webContents.send 的底层
  ...
```

这层是 C++ 的 mojom 生成代码，负责：

```text
把 JS 侧传过来的参数 → 序列化成 Mojo 消息 → 发到对端
对端反序列化 → 调对应的 C++ 回调
```

**这就是"封装"的真相**：`ipcRenderer.invoke('storage:projects:list')` 最终变成一次 Mojo RPC 调用，消息里带：

```text
{
  channel: 'storage:projects:list',   // 你的通道名
  args: [...],                          // 参数
  requestId: 'uuid',                    // 调用 ID（用于配对响应）
  senderId: 1                           // 哪个渲染进程发的
}
```

---

## 4. 第 3 层：ipcMain / ipcRenderer（你用的 API）

这一层是 Node.js 原生模块绑定（C++ 暴露给 JS）：

```text
ipcRenderer（渲染进程侧）：
  send(channel, ...args)      → 发消息，不等响应（fire-and-forget）
  invoke(channel, ...args)    → 发消息，返回 Promise（等响应）
  sendSync(channel, ...args)  → 发消息，阻塞等待（同步）
  on(channel, cb)             → 订阅主进程推送

ipcMain（主进程侧）：
  handle(channel, handler)    → 注册 invoke 的处理器
  on(channel, cb)             → 注册 send 的监听
  webContents.send(channel)   → 主动推给渲染进程
```

### 4.1 invoke 的完整旅程（一次调用的解剖）

```text
renderer:
  window.desktop.storage.projectsList()
    │
    ▼
  ipcRenderer.invoke('storage:projects:list')
    │  生成 requestId，记入"等待中的调用表"
    ▼
  C++ 绑定 → ElectronRenderer.Invoke(...) → Mojo 序列化
    │
    ▼ （穿过管道，到主进程）
  ipcMain.handle 注册的回调被触发
    │
    ▼
  你的 handler 执行（读数据库等）
    │
    ▼
  返回值 → ElectronBrowser.Message(...) → Mojo 回传
    │  带上 requestId
    ▼
renderer:
  收到消息 → 查"等待中的调用表" → 找到 requestId
    │
    ▼
  resolve 那个 Promise
```

**invoke 的本质 = 手写的 request/response 协议**（requestId 配对），底层是异步消息，不是真正的同步 RPC。

### 4.2 send vs invoke 的底层区别

```text
send      = 单向消息，不配对，不等待（底层 Message）
invoke    = 双向配对，内部维护 requestId → Promise 映射（底层 Invoke）
sendSync  = 用同步 Mojo 调用 + 阻塞渲染进程（性能杀手，能不用就不用）
```

---

## 5. 序列化：能传什么、不能传什么

IPC 传参用的是 **V8 结构化克隆**（`v8::ValueSerializer`）：

```text
✅ 能传：string / number / boolean / null / undefined
        数组 / 普通对象 / Date / Map / Set / ArrayBuffer / TypedArray
        Error（部分字段）

❌ 不能传：函数 / class 实例 / DOM 节点 / Promise / WeakMap
         Symbol / 带循环引用的对象（会报错）
```

```text
所以：
  ipcRenderer.invoke('x', myFunction)   → 序列化失败
  ipcRenderer.invoke('x', myClassInstance) → 变成普通对象（原型丢失）

实践含义：
  跨 IPC 只能传"数据"，不能传"代码/引用"
  → shared/contracts 全是纯数据接口，正是这个原因
```

---

## 6. contextBridge（第 4 层）和它包了什么

```text
contextBridge.exposeInMainWorld('desktop', api)
  → 把 api 里的函数包装成"代理函数"暴露到 window.desktop

它做的封装：
  1. 遍历 api 对象，把函数包一层
  2. 包出来的函数内部调 ipcRenderer（但它不暴露 ipcRenderer 本身）
  3. 支持 Promise 透传、事件订阅（ipcRenderer.on 的包装）
```

```text
你的 window.desktop.runs.onEvent(cb)
  → contextBridge 包装层
    → ipcRenderer.on('runs:event', ...)
      → ElectronBrowser.Message（主进程推送）
```

**contextBridge 不是 IPC 实现，是"安全外壳"**——它让页面拿到的是一组固定函数，而不是原始的 ipcRenderer 对象（那样页面就能发任意通道）。

---

## 7. 更底层的通信方式：MessagePort

Electron 还暴露了 Chromium 的原生 MessagePort（`MessageChannelMain` / `MessagePortMain`）：

```text
区别于 invoke：
  invoke   = 请求/响应（你问一句答一句）
  MessagePort = 建立一条"专用管道"，双方任意时间互发

底层 = 直接包装 Mojo MessagePipe：
  主进程 MessageChannelMain.create()
  → port1 留在主进程，port2 通过 IPC 传给渲染进程
  → 之后 port1/port2 之间直接管道通信，不再走 ipcMain/ipcRenderer

适用：高频流式数据（AI token 流、日志流、大文件分片）
```

```text
runs:event 目前用 webContents.send —— 广播式，所有监听都能收
如果以后要"一对一专用流"（某次 Run 专属通道）→ MessagePort 更合适
```

---

## 8. 线程模型（底层的一个关键约束）

```text
主进程的 IPC 处理器跑在【UI 线程】（browser main thread）

→ ipcMain.handle 里做阻塞操作（大文件读、同步 DB、重计算）
  = 卡住整个主进程 = 所有窗口一起卡

正确做法：
  - handler 里只做快操作
  - 慢操作：异步化（fs.promises / async DB）
    或丢到 worker_threads / utilityProcess
  - better-sqlite3 是同步的 → 注意包一层 async，或接受小查询

同理渲染进程的 ipcRenderer 回调也在页面主线程：
  - on 回调里别做重活
```

---

## 9. 完整封装链（一次点按钮的旅程全景）

```text
你点按钮
  → React onClick
    → window.desktop.storage.projectsList()      [contextBridge 包装]
      → ipcRenderer.invoke('storage:projects:list')  [Electron JS API]
        → C++ 绑定 ElectronRenderer.Invoke()      [mojom RPC]
          → Mojo 序列化 + 结构化克隆              [Chromium Mojo]
            → Unix socket / 共享内存               [OS]
              → 主进程 Mojo 反序列化
                → ipcMain.handle 回调触发          [Electron JS API]
                  → 你的 handler 读 better-sqlite3
                    → 返回 → 一路原路回传
                      → Promise resolve → React setState → UI 更新
```

**每一层都是封装，没有一层是"自己造轮子"**：

```text
OS 层：Unix socket / 共享内存（操作系统提供）
Chromium 层：Mojo（通用 IPC 框架，带序列化/管道/RPC）
Electron 层：mojom 接口 + ipcMain/ipcRenderer（Node 绑定）
你的层：contextBridge 白名单 + shared/contracts 类型契约
```

---

## 10. 一句话总结

```text
Electron IPC 底层 = Chromium Mojo（Unix socket + 共享内存）
之上包了 Electron 的 C++ mojom 接口
再之上是 ipcMain/ipcRenderer JS API
最外面是 contextBridge 安全外壳

invoke = 用 requestId 手写的异步 RPC（不是真同步）
send   = 单向消息（fire-and-forget）
传参   = V8 结构化克隆（只能传数据，不能传函数/引用）
执行   = 主进程 UI 线程（别阻塞）
```

---

## 11. 进阶实验（把底层看穿）

```text
实验 1：抓真实 IPC 消息
  启动时加环境变量：
    ELECTRON_ENABLE_LOGGING=1 electron .
  或命令行：
    electron --enable-logging --v=1 .
  → 日志里能看到 Mojo 消息收发（IPC::Message / mojo 相关输出）

实验 2：观察序列化失败
  ipcRenderer.invoke('x', () => {})       → 报 DataCloneError
  ipcRenderer.invoke('x', new Map([...])) → 成功（Map 可克隆）

实验 3：感受 sendSync 阻塞
  主进程 handler 里 sleep 2s，renderer sendSync → 整个页面卡 2s
  → 体会为什么不能用 sendSync

实验 4：MessagePort 一对一
  主进程 MessageChannelMain.create()
  → port2 用 webContents.postMessage 传给渲染进程
  → 之后 port1/port2 直接通信，绕过 ipcMain
```

---

## 12. 参考

- Electron IPC 文档：https://www.electronjs.org/docs/latest/api/ipc-main
- Electron contextBridge：https://www.electronjs.org/docs/latest/api/context-bridge
- Electron MessagePortMain：https://www.electronjs.org/docs/latest/api/message-port-main
- Chromium Mojo：https://chromium.googlesource.com/chromium/src/+/main/mojo/README.md
- V8 结构化克隆（DataCloneError）：https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
