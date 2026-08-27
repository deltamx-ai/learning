# Electron IPC 底层问答总结（完整 Q&A）

> 日期：2026-08-19
> 对象：molecraft（Electron 43）
> 用途：总结关于 Electron IPC 底层的全部提问与回答，便于分享给他人
> 配套文档：`electron-ipc-internals.md`（详细版）、`electron-architecture.md`（架构版）

---

## 问题总览

```text
Q1: IPC 在 Electron 里是怎么实现的？有封装吗？
Q2: Mojo 创建了一个通信对，所以可以互相通讯，对吗？
Q3: （追问）继续详细一点：通道怎么来的？端口怎么递的？
Q4: fork 后为啥还要交换（握手）才能通信？不是已经知道是一对了吗？
Q5: main 是谁创建的？
```

---

## Q1: IPC 在 Electron 里是怎么实现的？有封装吗？

### 答案：四层封装，底层是 Chromium Mojo

```text
第 4 层  contextBridge          ← 你的代码碰到的（window.desktop.xxx）
第 3 层  ipcMain/ipcRenderer    ← Electron 的 JS API（invoke/send/on）
第 2 层  Electron 的 mojom 接口  ← C++ 层 RPC 定义（ElectronRenderer/ElectronBrowser）
第 1 层  Chromium Mojo           ← 真正的传输（Unix socket + 共享内存）
         ↓
        操作系统
```

**关键认知**：Electron 没有发明传输层，它用 Chromium 现成的 Mojo；
Electron 做的是"把 Node.js 世界接进 Chromium 的 IPC 体系"。

### invoke 的本质

```text
invoke = 用 requestId 手写的异步 RPC（不是真同步）
send   = 单向消息（fire-and-forget）
传参   = V8 结构化克隆（只能传数据，不能传函数/引用）
执行   = 主进程 UI 线程（别阻塞）
```

---

## Q2: Mojo 创建了一个通信对，所以可以互相通讯，对吗？

### 答案：对一半——创建只是第一步，还要"把端口递过去"

```text
MessagePipe.create() 确实产生一对连通的端口（双向）✅
但这对端口默认在【同一个进程】里 ⚠️

跨进程通信 = create 一对 + 把其中一个递给对方
传递动作依赖"已有通道"（第一条是引导通道）
```

### 类比：造了对讲机

```text
create() = 造了一对同频对讲机（两个都在你手里）
跨进程   = 把其中一台递给隔壁房间的人
递的动作 = 通过门缝（已有通道）塞过去
之后     = 你俩用对讲机对话，不再需要门缝
```

### 为什么端口"不可伪造"（安全根基）

```text
端口在 Unix 上本质是一个 fd（文件描述符）
fd 只能通过【已有通道】传递（SCM_RIGHTS）
→ 没有通道就拿不到端口引用
→ 外部进程无法插入通信
→ 这是操作系统层的保证，不是协议层的规矩
```

---

## Q3: 继续详细——通道怎么来的？端口怎么递的？

### 3.1 引导通道（Bootstrap）：进程出生前，通道先造好

```text
第 1 步：主进程调用 socketpair() 创建一对 socket（双向）
         两个端点此刻都在主进程手里

第 2 步：主进程 fork/spawn 渲染进程
         → 子进程【继承】文件描述符表（拷贝）

第 3 步：清理
         主进程关掉自己手里的 B，保留 A
         子进程关掉自己手里的 A，保留 B

第 4 步：A 在主进程、B 在渲染进程 —— 通道打通
```

```text
这就是引导通道的物理真相：
  一对 socketpair + fork 继承 fd = 完成"递送"
```

为什么用 socketpair：双向 + 能传 fd（SCM_RIGHTS）+ 内核级。

### 3.2 端口传递 = 文件描述符搬家（SCM_RIGHTS）

```text
Unix domain socket 支持随数据发送"文件描述符"
技术名：SCM_RIGHTS（ancillary data）

Mojo 端口本质 = socketpair 的一个 fd
传递端口 = 把 fd 塞进消息的辅助数据，经已有通道发给对端
对端 recvmsg 拿到新 fd → 包装成 Mojo port 对象

Windows 对应物：HANDLE + DuplicateHandle（句柄复制）
```

### 3.3 握手（Handshake）：通道通了之后，交换"号码本"

```text
主进程 → 渲染进程：hello 消息
  我的 PID、初始端口列表、共享内存区域、进程类型

渲染进程 → 主进程：hello 回执
  确认版本、自己的状态
```

**注意**：握手不是为了"让通道变通"（通道 fork 完就通了），
而是让双方知道"通道上怎么组织通信"（哪些端口对应什么功能）。

### 3.4 沙箱与 Broker

```text
sandbox: true 时渲染进程受限：
  不能直接分配共享内存、某些句柄操作

→ 这些操作"外包"给主进程里的 Broker
→ 沙箱下传大对象多一跳（安全换性能）
```

### 3.5 MessagePort：专属"专线"

```text
new MessageChannelMain() → create 一对 Mojo MessagePipe
webContents.postMessage(..., [port2]) → 把 port2 递给渲染进程
之后 port1 ↔ port2 直接通信，不再走 ipcMain

适用：AI token 流、大文件分片、高频通信、并发任务隔离
```

### 3.6 完整链路图

```text
OS: socketpair() → fork 继承 fd          ← 引导通道（物理）
    ↓
Chromium: Mojo 握手 → 交换初始端口        ← 第一条命脉
    ↓
Electron: ElectronRenderer/Browser 接口   ← IPC 的"干线"
    ↓
          ipcMain/ipcRenderer            ← 你用的 API
    ↓
          contextBridge                  ← 安全外壳（白名单）
    ↓
          window.desktop.xxx             ← 你的代码
    ↓
          MessagePort（可选专线）          ← 一对一快速通道
```

---

## Q4: fork 后为啥还要握手才能通信？不是已经知道是一对了吗？

### 答案：通道早就通了，握手交换的是"协议"，不是"通道"

```text
socketpair + fork 完成那一刻：
  两端已经物理连通 ✅ 立刻能传字节 ✅（不需要握手）

握手在做什么：
  不是"打通电话"，是"第一次通话时报身份、交换号码本"
```

### 类比：拉电话线 vs 第一次通话

```text
第 1 步：拉电话线（socketpair）
  → 线接通了，两边拿起话筒就能听见对方（物理连通）

第 2 步：第一次通话（握手）
  老李：我是老李，我这边 3 个分机：
        101=数据库，102=文件系统，103=密钥
        有块大黑板（共享内存）写大段内容用
  老王：收到，我这边也有几个分机……

第 3 步：之后才能"有组织地"干活
  老王拨 101 → 老李知道是找数据库 → 正确响应
```

```text
关键：
  第 1 步之后两人已经能说话了
  第 2 步交换的是"号码本"（哪个端口对应什么功能）
  没有第 2 步，电话是通的，但不知道"该拨哪个号"
```

### 我之前那句"握手完成后 ipcMain 才可用"的准确含义

```text
不是"通道靠握手才通"
而是"握手后高层 API 才可用"
（ipcMain 需要知道哪个端口是 ElectronRenderer 接口）

一句话：通道通 ≠ 知道怎么用，握手是"教会双方怎么用这条已通的通道"
```

---

## Q5: main 是谁创建的？

### 答案：main 是操作系统创建的（它是"根"）

```text
你运行 electron . （或双击应用图标）
  → shell 调用 execve → 操作系统加载 electron 可执行文件
  → 内核创建第一个进程 = 主进程（main）
  → 主进程初始化 Node.js + Chromium 浏览器进程

所以：
  main    ← 操作系统创建（应用入口，根）
  渲染进程 ← main 创建的（fork/posix_spawn）
```

```text
这就解释了为什么 socketpair 是 main 先造的：
  因为 main 是第一个活着的进程
  只能它来造通道、造孩子（渲染进程）
```

---

## 总结：一条线串起所有答案

```text
main 是操作系统从可执行文件拉起的第一个进程（根）
  ↓ 它调用 socketpair() 造了一对双向管道
    ↓ 它 fork/posix_spawn 渲染进程，子进程继承 fd
      ↓ 各留一端，引导通道打通（物理层就绪）
        ↓ Mojo 握手：交换端口/身份/共享内存（协议层就绪）
          ↓ ipcMain/ipcRenderer 可用（应用层）
            ↓ contextBridge 白名单包装（安全层）
              ↓ 你的 window.desktop.xxx
                ↓ 需要专线时：MessagePort（create + 递端口）
```

```text
三个最关键的认知：
1. Electron IPC = Chromium Mojo + Electron 封装（没造轮子）
2. 端口靠"继承 + 传递"跨进程，fd 只能经已有通道传 → 安全根基
3. 通道通 ≠ 知道怎么用：握手是教双方"怎么用这条已通的通道"
```

---

## 附：底层术语速查

| 术语 | 本质 | 一句话 |
| --- | --- | --- |
| socketpair | 本机双向管道 | fork 继承 fd 完成"递送" |
| SCM_RIGHTS | Unix socket 传 fd | 端口传递的物理机制 |
| 引导通道 | 第一条 socketpair | 进程出生前就造好 |
| 握手 | 交换初始端口/身份 | 之后高层 API 才可用 |
| Broker | 沙箱的代理 | 沙箱进程间接做受限操作 |
| MessagePort | 专属 MessagePipe | postMessage 传端口，一对一 |
| mojom | Chromium 的 RPC 定义语言 | 类型安全的跨进程接口 |
| 结构化克隆 | V8 序列化 | IPC 只能传数据，不能传函数 |
