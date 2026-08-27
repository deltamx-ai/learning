# Electron IPC vs Tauri 2 IPC：底层实现对比

> 日期：2026-08-19
> 场景：molecraft（Electron）vs molecrab（Tauri 2）选型依据补充
> 目的：从底层（传输/序列化/通道/安全/进程边界）对比两者 IPC 的本质差异
> 结论：Electron 把 IPC 当"基础设施"自建（Mojo），Tauri 借用 WebView 的 JSON 桥

---

## 1. 一句话差异

```text
Electron = 自建二进制管道（Chromium Mojo + socketpair + 共享内存）
Tauri 2  = 借用系统 WebView 的 JS↔Native 消息桥（JSON 字符串）
```

---

## 2. 底层传输机制对比（最核心差异）

### Electron：自建 Mojo 管道

```text
Electron 不依赖任何"浏览器内建通信"，它自己造管道：

主进程 ↔ 渲染进程之间：
  socketpair（Unix）/ 管道（Windows）→ 引导通道
  → Chromium Mojo 消息管道（二进制协议，带类型元数据）
  → 支持：句柄传递（SCM_RIGHTS）、共享内存零拷贝、MessagePort 专线

特点：
  ✅ 二进制协议（不是文本，无 JSON 解析开销）
  ✅ 可传文件描述符/句柄（端口、共享内存区域）
  ✅ 大 payload 走共享内存零拷贝
  ✅ 完全受控（Electron 自己实现，不依赖平台 WebView 行为）
```

### Tauri 2：借用 WebView 的 JS↔Native 桥

```text
Tauri 不自己造管道，它用【操作系统 WebView 内建的通信机制】：

Windows WebView2：PostWebMessageAsJson / WebMessageReceived
macOS WKWebView：WKScriptMessageHandler（JS 调原生）
Linux WebKitGTK：WebKitUserContentManager 的 script message

特点：
  ⚠️ 三个平台三种实现，Tauri 只是统一封装
  ⚠️ 本质都是"JS 世界 ↔ 原生世界"的字符串消息通道
  ✅ 不用自己造轮子，但受制于 WebView 的能力边界
```

### 关键推论

```text
Electron：IPC 是"一等公民"，为桌面应用定制（句柄传递、共享内存、专线）
Tauri 2 ：IPC 是"借用来的"，本质是 WebView 的 message bridge，
          能力受限于 WebView 提供的 API（不能传句柄，无共享内存零拷贝）
```

---

## 3. 序列化对比（能传什么、效率如何）

### Electron：V8 结构化克隆（二进制）

```text
v8::ValueSerializer / Deserializer

✅ 原生支持：string / number / boolean / null / undefined
            Array / Object / Date / Map / Set / ArrayBuffer / TypedArray
✅ 支持 Transferable（ArrayBuffer 转移所有权，零拷贝）
✅ 二进制编码，无字符串解析开销
✅ 类型保真（传过去还是 Date/Map/Set，不是字符串）

❌ 不能传：函数 / class 实例 / DOM 节点 / Promise / 循环引用
```

### Tauri 2：JSON 字符串

```text
前端 invoke() 把参数序列化成 JSON → 字符串 → 过 WebView 桥 → Rust serde 反序列化

✅ 通用（任何 JSON 能表达的都行）
⚠️ Date → 字符串（时间精度、时区问题）
⚠️ Map/Set → 需要手动转换（JSON 没有原生 Map/Set）
⚠️ ArrayBuffer/TypedArray → 必须 base64（体积膨胀 33%）
⚠️ 无 Transferable 概念（大二进制只能整体拷贝）
❌ 不能传：函数 / class / 非 JSON 对象

代价：每次 IPC 都是 JSON 编解码（字符串解析 + 对象重建）
```

### 关键推论

```text
小 payload（配置、命令、状态）：两者差不多，Tauri 的 JSON 反而简单
大 payload（文件内容、二进制、模型数据）：
  Electron 传 ArrayBuffer 几乎零成本（Transferable/共享内存）
  Tauri 要 base64 膨胀 + 整段拷贝 → 明显劣势

molecraft 场景：
  传文件内容（上下文文件）→ Electron 明显更优
  流式 token（小字符串）→ 两者都行
```

---

## 4. 通道模型对比

### Electron：多路复用 + 专线

```text
① 共享干线（多路复用）：
   ipcRenderer.invoke('storage:projects:list') → 走同一条 Mojo 管道
   靠 channel 名区分消息类型，靠 requestId 配对响应

② 专线（MessagePort）：
   new MessageChannelMain() → 创建独立管道
   webContents.postMessage(port) → 一对一专线
   适合：高频流、并发隔离

③ 事件推送：
   webContents.send('runs:event', payload) → 主进程主动推
```

### Tauri 2：命令分发 + 全局事件总线

```text
① 命令分发（invoke）：
   invoke('read_settings', args)
   → Rust 端 tauri::ipc 按命令名找到 #[tauri::command] 函数
   → 这是"函数调用"，不是"通道消息"

② 事件系统（emit/listen）：
   Rust 侧：app.emit("event", payload)       → 广播给所有监听者
   JS 侧：  listen("event", callback)        → 订阅
   没有"专属通道"概念，都是全局事件总线

③ 无 MessagePort 等价物：
   Tauri 没有"创建一条专用管道递给对方"的能力
   （受限于 WebView bridge 没有传句柄机制）
```

### 关键推论

```text
Electron 通道 = 可以"开专线"（MessagePort），粒度精细
Tauri 通道  = 全局总线 + 命令分发，粒度粗（无法开专线）

并发隔离场景（多个 Run 同时跑）：
  Electron：每个 Run 一条 MessagePort → 互不串扰
  Tauri：事件都要带 runId 自己过滤 → 容易串
```

---

## 5. 安全校验时机对比

### Electron：sender 校验 + schema 校验（业务层）

```text
校验发生在【你的 handler 里】：

ipcMain.handle('settings:save', async (event, raw) => {
  assertTrustedSender(event.sender)      // ① sender 校验（webContents.id/URL/frame）
  const input = SaveSchema.parse(raw)    // ② schema 校验（zod）
  ...
})

→ 框架只保证"消息能到"，安全全靠你在 handler 里写
→ 写漏了 = 漏洞（所以 molecraft 有 sender.ts / registry.ts）
```

### Tauri 2：capabilities（IPC 层拦截）

```text
校验发生在【IPC 框架层】，你的命令函数之前：

tauri.conf.json 的 capabilities：
{
  "identifier": "main-window",
  "windows": ["main"],
  "permissions": ["core:default", "allow:read_settings"]
}

→ 请求进入 Rust IPC 层时先查：
   这个窗口允许调 read_settings 吗？
   不允许 → 直接拒绝，命令函数根本不执行
→ 参数反序列化（serde）失败 → 自动拒绝（类型校验内置）
```

### 关键推论

```text
Electron：安全是"可选的"（你要自己写 sender/schema 校验）
Tauri 2 ：安全是"框架强制的"（capabilities 白名单 + serde 类型校验）

→ Tauri 的默认安全姿态更硬（忘写 = 拒绝，不是忘写 = 暴露）
→ Electron 需要纪律（molecraft 已经做成了纪律）
```

---

## 6. 进程边界对比（IPC 的"两侧"是谁）

```text
Electron：
  IPC 两侧 = 独立进程
    主进程（Node.js 世界）↔ 渲染进程（Chromium 世界）
  中间隔着一层 OS 进程边界 → 隔离强、崩溃隔离好

Tauri 2：
  IPC 两侧 = Rust 主进程 ↔ WebView 进程
  中间隔着的也是进程边界（WebView 是独立进程）
  → 隔离同样存在，但通信通道由 WebView 提供（Tauri 不控制细节）

一个隐蔽差异：
  Electron 主进程里你能同时访问 Node 生态 + Chromium 的 browser 能力
  Tauri Rust 主进程里你能访问系统 API，但"浏览器内部"（DOM 渲染细节）
  归 WebView 管，Tauri 只能通过公开 API 间接控制
```

---

## 7. 完整对比表

| 维度 | Electron IPC | Tauri 2 IPC |
| --- | --- | --- |
| 传输层 | Chromium Mojo（自建） | WebView 消息桥（借用） |
| 底层载体 | socketpair + 共享内存 | WebView2 / WKScriptMessageHandler / WebKitGTK |
| 序列化 | V8 结构化克隆（二进制） | JSON 字符串 |
| 二进制大对象 | ArrayBuffer 原生 + Transferable | base64 膨胀 33% |
| 传句柄/端口 | ✅（SCM_RIGHTS / MessagePort） | ❌ |
| 通道粒度 | 干线 + 专线（MessagePort） | 命令分发 + 全局事件总线 |
| 请求/响应 | invoke（requestId 配对） | invoke（命令分发） |
| 事件推送 | webContents.send | emit / listen |
| 专属通道 | MessageChannelMain ✅ | ❌ 无 |
| 安全 | handler 内 sender + schema 校验（可选） | capabilities + serde（框架强制） |
| 校验失败行为 | 取决于你写没写 | 默认拒绝 |
| 崩溃隔离 | 渲染进程崩 → 白屏可恢复 | WebView 崩 → 白屏可恢复 |
| 性能（小 payload） | 二进制快 | JSON 解析略慢但可接受 |
| 性能（大 payload） | 零拷贝优势明显 | base64 + 拷贝，劣势 |

---

## 8. 一句话总结

```text
Electron IPC = 自建二进制管道（Mojo）
  强：二进制、零拷贝、可传句柄、可开专线、完全可控
  弱：安全要自己写纪律

Tauri 2 IPC = 借用 WebView 的 JSON 桥
  强：框架强制安全（capabilities）、实现简单、天然隔离
  弱：JSON 低效、无句柄传递、无专线、受制于 WebView

本质：Electron 把 IPC 当"基础设施"自己造；
      Tauri 把 IPC 当"辅助功能"借用平台。
      所以 Electron 能做更底层的通信（句柄/零拷贝/专线），
      Tauri 胜在"少操心"（安全默认强制）。
```

---

## 9. 场景结论（molecraft 为什么选 Electron）

```text
molecraft 需要：
  - 传文件内容（上下文）→ Electron 二进制优势 ✅
  - AI 流式 token → 两者都行（小字符串）
  - 未来 Agent 子进程通信 → Electron 更顺手
  - 多 Run 并发隔离 → Electron MessagePort 更干净

→ 底层 IPC 能力上，Electron 对你的场景全面占优
→ Tauri 的"安全默认强制"是加分，但 molecraft 已用纪律补上了

结论：从 IPC 底层看，Electron 是正确选择（不是体积/生态，
      而是"你能做更底层的通信"——这正是 Agent 工作台需要的）
```
