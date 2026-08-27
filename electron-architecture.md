# Electron 架构拆解（基于 molecraft 真实代码）

> 日期：2026-08-19
> 对象：molecraft（Electron 43 + React 19 + TS 6 + Vite 8）
> 目的：从架构层面理解 Electron，补充官方文档不讲的机制细节
> 方法：以项目真实代码为教材（src/main / src/preload / src/renderer / src/shared）

---

## 1. 核心心智模型：三个"世界"

```text
┌─────────────────────────────────────────────────────┐
│  主进程 (Main)          —— Node.js 世界              │
│  你的 src/main/                                      │
│  ├─ 窗口生命周期（BrowserWindow）                    │
│  ├─ 文件系统 / 数据库 / 网络请求                     │
│  ├─ IPC 服务端（ipcMain.handle）                    │
│  └─ 安全策略（CSP/导航拦截）                         │
│          │                                          │
│          │  ← 通道：ipcMain ↔ ipcRenderer ──┐       │
│          ▼                                    │       │
│  Preload —— 桥（唯一通道）                    │       │
│  你的 src/preload/index.cts                   │       │
│  contextBridge.exposeInMainWorld('desktop', …)│       │
│  只暴露白名单函数，无逻辑                        │       │
│          │                                    │       │
│          │  ← 通道：window.desktop.xxx ──┐   │       │
│          ▼                                │   │       │
│  渲染进程 (Renderer) —— 浏览器世界        │   │       │
│  你的 src/renderer/                        │   │       │
│  React 页面，无 Node 能力                 │   │       │
└─────────────────────────────────────────────────────┘
```

一句话：Electron = 一个 Node 后端 + 一个浏览器前端，中间只有一座窄桥。

## 2. 三个世界的能力边界

| | 主进程 | Preload | 渲染进程 |
| --- | --- | --- | --- |
| 运行环境 | Node.js 完整 | 受限 Node | 浏览器（Chromium） |
| 能碰文件系统 | ✅ | ⚠️ 沙箱内有限 | ❌ |
| 能碰数据库 | ✅（better-sqlite3） | ❌ | ❌ |
| 能发网络请求 | ✅（provider/sse.ts） | ❌ | ⚠️ fetch 受 CORS/CSP |
| 能访问 DOM | ❌ | ❌ | ✅ |
| 能渲染 UI | ❌ | ❌ | ✅ |
| 能拿 API key | ✅（safeStorage） | ⚠️ 传递 | ❌（只经函数调用） |

项目对应：

```text
src/main/storage/database.ts   → 数据库只在主进程
src/main/secrets/store.ts      → safeStorage 只在主进程
src/renderer/…                 → 纯 React，通过 window.desktop 调桥
```

---

## 3. 进程模型（详细）

### 3.1 为什么分两个进程

```text
Chromium 的"渲染进程沙箱"是 Electron 安全的地基：
  - 渲染进程被 XSS → 攻击者拿到的是"浏览器"
  - 浏览器无法直接读文件/数据库 → 危害被限制
  - 要碰敏感资源，必须穿过 IPC → 主进程可校验

类比：渲染进程 = 前台接待，主进程 = 金库
  接待员（渲染）被收买 → 也拿不到金库钥匙（文件/DB）
  只能按流程喊金库管理员（主进程）办事
```

### 3.2 进程清单（Electron 43 实际会有哪些进程）

```text
主进程（1 个）              → package.json main 指向的 out/main/index.js
  应用生命周期 / 窗口 / 原生能力 / IPC 服务端 / 数据库 / 网络

渲染进程（每个窗口 1 个）   → out/renderer/index.html
  你的 React 应用，纯浏览器环境

Preload 脚本（每个渲染进程 1 份）→ out/preload/index.cjs
  夹在主与渲染之间，contextBridge 注入白名单 API

Utility 进程（按需）       → Chromium 内部（GPU、网络、存储等）
  普通开发不用管，但崩溃日志里会看到

子进程（你自己 spawn 的）  → 如未来跑 Agent/CLI 子进程
  主进程用 child_process / execFile 派生
```

### 3.3 进程关系图

```text
┌─ 主进程（Node）────────────────────────────┐
│  app 事件 → 创建 BrowserWindow             │
│  ipcMain.handle('storage:*')  ← 服务端     │
│  better-sqlite3 / safeStorage / fetch      │
└──────────────┬─────────────────────────────┘
               │ ① ipcRenderer.invoke（请求/响应）
               │ ② webContents.send（事件推送）
┌──────────────▼─────────────────────────────┐
│  Preload（沙箱）                           │
│  contextBridge.exposeInMainWorld('desktop')│
│  白名单函数壳，通道名写死，无逻辑           │
└──────────────┬─────────────────────────────┘
               │ window.desktop.storage.projectsList()
┌──────────────▼─────────────────────────────┐
│  渲染进程（Chromium）                      │
│  React 组件 / hooks                        │
│  无 Node、无 fs、无 DB                     │
└────────────────────────────────────────────┘
```

### 3.4 进程生命周期（app 事件顺序）

```text
app.whenReady() 触发前：
  - 主进程加载，读取 package.json main
  - 解析命令行 / 环境变量

whenReady() 之后（你的 index.ts 主流程）：
  1. 解析 dev server URL（resolveDevServerUrl）
  2. 启动存储（openStorage / runMigrations / recoverInterruptedRuns）
  3. 创建服务（provider / run / secrets / workspace）
  4. 注入 CSP（applyContentSecurityPolicy）
  5. 注册 IPC handlers
  6. 创建 BrowserWindow → loadURL(dev) 或 loadFile(prod)

退出阶段：
  - 窗口关闭 → window-all-closed → app.quit()
  - 你的 cleanup：closeStorage / checkpoint
  - 单实例锁（requestSingleInstanceLock）防止多开
```

---

## 3A. 进程模型深度：为什么 Chromium 要这么多进程

> 这部分是官方文档最绕的地方，单独拆透。
> 理解了它，就理解了 Electron 一切"奇怪"行为（内存占用、白屏、OOM）。

### 3A.1 Chromium 的多进程设计动机

```text
浏览器把"一个网页"拆成多个进程，三个理由：

1. 稳定性：一个标签页崩溃 → 只死那个进程，不影响其他标签/整个应用
   （单进程时代：一个网页崩 = 整个浏览器崩）

2. 安全性：进程是操作系统级隔离（sandbox）
   → 恶意网页无法读其他网页/系统内存
   → 进程间只能通过受限 IPC 通信

3. 性能：多核利用（每个进程一个核）
```

Electron 继承了全部：**每个 BrowserWindow 就是一个独立的 Chromium 渲染进程**。

### 3A.2 Electron 里的进程分工

```text
浏览器进程 (Browser Process) = Electron 主进程
  一个，负责：窗口管理、菜单、IPC、原生模块、生命周期

渲染进程 (Renderer Process) = 每个窗口一个
  负责：DOM、CSS、JS 执行、页面渲染

GPU 进程：合成加速、WebGL（崩溃多为显卡驱动问题）

网络进程：所有网络请求（代理、缓存、DNS）

存储进程：IndexedDB、localStorage 等浏览器存储

Utility 进程：音视频解码等临时任务

进程间通信：IPC（进程间消息）+ Mojo（Chromium 内部管道）
```

### 3A.3 进程隔离的三个层次（从弱到强）

```text
第 1 层：代码层隔离
  渲染进程的 JS 运行在受限环境
  → 拿不到 Node 的 require/process/fs（nodeIntegration: false）

第 2 层：context 隔离（contextIsolation: true）
  preload 与页面各自独立的 JS 世界
  → 页面脚本无法直接触碰 preload 注入的对象内部

第 3 层：OS 级沙箱（sandbox: true）
  渲染进程运行在受限 OS 权限下
  → 即使被攻破，也无法直接写文件/读系统
```

你的 `webPreferences` 三层全开 ✅

### 3A.4 进程崩溃时会发生什么

```text
渲染进程崩溃 → 主进程收到 'render-process-gone' 事件
  → 白屏/死窗口，但主进程还活着
  → 你的应用可以：弹窗提示 → 重新 load 或重建窗口

主进程崩溃 → 整个应用死（没有兜底）
  → 所以主进程代码要最稳：异常捕获、启动失败报告（你的 startup.ts）

GPU 崩溃 → 自动重启 GPU 进程（Chromium 内置）
  → 偶尔白屏闪烁，通常无害
```

### 3A.5 多窗口的真相（常见误解）

```text
❌ 误解：多窗口 = 复用同一个渲染进程
✅ 事实：每个 BrowserWindow 独立渲染进程，共享主进程

多窗口内存：
  每个窗口一份 V8 堆 + DOM 树 → 内存翻倍
  共享的：主进程、数据库连接、网络会话

实践含义：
  - 两个窗口不要各拉一遍大对象（模型、数据）→ 放主进程共享
  - 渲染进程间不能直接通信 → 必须经主进程转发
```

### 3A.6 进程与你的 AI 场景

```text
为什么 AI 流式要走主进程（再次强调，这是 Electron 做 AI 的命门）：

模型请求放渲染进程会怎样？
  - fetch 受 CORS 限制（模型 API 可能不允许）
  - API key 暴露在渲染进程 → XSS 即泄露
  - 大响应在渲染进程 → 卡 UI 线程

模型请求放主进程（正确姿势）：
  - Node fetch 无 CORS
  - key 只在主进程（safeStorage 加密存储）
  - 主进程解析 SSE → webContents.send 推流 → 渲染进程只画
```

### 3A.7 子进程（未来 Agent 场景）

```text
Molecraft 未来要跑 Agent/CLI：
  main 进程用 child_process.spawn / execFile 派生
  → 每个 Agent 一个独立进程，崩溃不影响主应用
  → 进程间通信：stdout/stderr 管道 + 消息协议
  → 权限：子进程也要沙箱/白名单（不能给完整 shell）

这正是"本地 Agent 工作台"与浏览器扩展的本质区别：
  浏览器扩展无子进程能力，Electron 有 —— 这是选 Electron 的核心原因之一
```

---

## 4. IPC 通信（详细）

### 4.1 两种通信形态

```text
形态 A：请求/响应（renderer → main）
  renderer: window.desktop.storage.projectsList()
       ↓ ipcRenderer.invoke('storage:projects:list')
  main:    ipcMain.handle('storage:projects:list', handler)
       ↓ 返回 Promise
  renderer: 拿到 Result<Project[]>

形态 B：事件推送（main → renderer，流式）
  main:    webContents.send('runs:event', payload)
       ↓
  preload: ipcRenderer.on('runs:event', cb)  ← 桥接订阅
       ↓
  renderer: window.desktop.runs.onEvent(cb)  ← 订阅回调
```

项目对应：

```text
src/main/ipc/*.ts        → 每个域一组 handler（provider/run/storage/workspace）
src/main/ipc/registry.ts → 注册集中地
src/main/ipc/sender.ts   → TrustedRenderer（安全的 webContents.send 封装）
src/shared/contracts/*   → 双向类型契约
```

### 4.2 AI 流式的标准姿势（Electron 做 AI 应用必懂）

```text
模型 API（网络）
  → 主进程 fetch + 解析 SSE（src/main/provider/sse.ts）
  → 主进程逐段 webContents.send('runs:event', chunk)
  → preload 桥接转发
  → renderer 增量渲染（打字机效果）

为什么必须主进程消费 SSE？
  1. Node fetch 无 CORS 限制
  2. API key 不出主进程
  3. renderer 只拿"已授权的数据流"
```

### 4.3 IPC 安全要点

```text
1. 通道白名单：preload 只暴露固定函数，ipcRenderer 本体不进 renderer
2. 校验在主进程：renderer 传来的参数一律不可信，主进程重校验
3. 契约驱动：shared/contracts 类型约束通道名与消息形状，
   两边形变 = 编译错误（你的通道名写死 + satisfies 断言）
4. sender 校验：多窗口时按 webContents.id 区分，防止串窗口
```

---

## 5. Preload 桥（详细）

### 5.1 角色：唯一通道，只转发不思考

```text
你的 preload 三大特征（全是加分项）：
  1. 无逻辑：不校验、不转换，纯转发 → 逻辑都放主进程
  2. 白名单：只暴露固定函数集合，通道名写死
  3. 契约驱动：channel 名用类型约束，两边形变 = 编译错误
```

### 5.2 为什么"无逻辑"

```text
preload 运行在"半可信"边界：
  - 它有 ipcRenderer（能喊主进程）
  - 沙箱下 preload 与页面隔离，但它是桥梁
  → preload 里写校验 = 可被绕过（renderer 可能骗过它）
  → 校验必须在主进程（真正的信任边界）

项目注释原话：
  "Nothing is validated here. Validation … the main process is
   where it has to happen, and does." ✅
```

### 5.3 沙箱 preload 的限制

```text
sandbox: true 时：
  - preload 不能用 require 加载兄弟文件
  - 只能 require('electron') 的少量模块（contextBridge / ipcRenderer）
  → 通道名必须写死为字面量，不能从 shared 模块 import
  → 你的写法：写死字符串 + satisfies Record<string, Channel> 编译期校验
```

---

## 6. 安全模型（详细）

### 6.1 三个开关

```text
BrowserWindow webPreferences（src/main/index.ts）：
  contextIsolation: true     ← renderer 与 preload 隔离（默认 true）
  nodeIntegration: false     ← renderer 拿不到 Node
  sandbox: true              ← preload 也受限
```

### 6.2 策略外置（security-policy.ts）

```text
CSP 注入：
  session.defaultSession.webRequest.onHeadersReceived
  → 每个响应头注入 Content-Security-Policy

导航拦截：
  will-navigate        → 非内部 URL 一律 preventDefault
  setWindowOpenHandler → 外部链接交 shell.openExternal（白名单校验）
  will-attach-webview  → 直接拒绝（<webview> 不在架构内）

效果：渲染进程被 XSS 也跳不出白名单、开不了新窗、挂不了 webview
```

### 6.3 信任边界结论

```text
渲染进程内容不可信（它渲染模型输出/Markdown/工具结果）
  → 一切敏感操作走 IPC 到主进程校验
  → 网络请求由主进程发起（provider）
  → 密钥只存在主进程（safeStorage）
```

---

## 7. 构建与打包

### 7.1 tsconfig 分工

```text
tsconfig.web.json       → src/renderer（浏览器目标，DOM 类型）
tsconfig.electron.json  → src/main + src/preload（Node 目标，CommonJS）
tsconfig.json           → 根 + shared 契约（共享类型）
```

### 7.2 构建流（pnpm build）

```text
tsc -b                  → 编译 main/preload → out/
vite build              → 编译 renderer → out/renderer/
pnpm run build:electron → tsc 主进程 → out/main + out/preload

打包（electron-builder）：
  全部塞进 app.asar → 分发为安装包
```

### 7.3 关键点

```text
main/preload 是 CommonJS（.cjs / .cts），renderer 是 ESM
  → 不同运行时（Node vs 浏览器）
  → .cts/.cjs 后缀正是这个原因
```

---

## 8. 开发 vs 生产：一个 URL 的区别

```text
开发（dev:electron）：
  VITE_DEV_SERVER_URL=http://localhost:5173
  主进程 loadURL(devServer) → Vite HMR 热更新

生产：
  主进程 loadFile(rendererEntry) → 加载打包好的 index.html

resolveDevServerUrl() 处理分叉：
  只有未打包 + 本地 5173 才接受 dev URL（防注入）
```

---

## 9. 常见困惑澄清

```text
1. "为什么 preload 用 CommonJS 不能 import？"
   sandbox: true 时 preload 无法 require 兄弟文件 → 写死字符串 + 类型断言

2. "renderer 能 fetch 吗？"
   能，但受 CORS 限制 → AI 请求放主进程（Node 无 CORS）

3. "contextBridge 和 window 的关系"
   注入的是"函数壳"，不是 ipcRenderer 本体

4. "为什么有两份 tsconfig"
   浏览器代码（DOM 类型） vs Node 代码（process/fs 类型），混用会错乱
```

---

## 10. 学习建议

```text
官方文档只读这几页（其余过时/太深）：
  - Process Model
  - contextBridge + IPC
  - BrowserWindow webPreferences
  - app lifecycle

调试才是最快学习路径：
  - 主进程：vscode 断点（launch.json 已配好）
  - 渲染进程：DevTools（webContents.openDevTools()）
  - 在关键 IPC 处打断点，看消息怎么走

动手实验（在 molecraft 里做）：
  - 加一个 IPC：renderer 按钮 → 主进程读文件 → 返回
  - 改 preload 暴露方式，观察 contextBridge 行为
  - 把 runs:event 改成两条流，感受事件推送
```

---

## 11. 一句话总结

```text
Electron = Node 后端（主进程）+ Chromium 前端（渲染进程）+ 窄桥（preload）

安全铁律：渲染进程当"不可信"处理，一切敏感操作走 IPC 到主进程校验
数据铁律：数据库/密钥/网络请求全在主进程，renderer 只拿"结果"
流式铁律：AI 的 SSE 由主进程消费，再经事件通道推给 renderer 渲染

molecraft 全部踩在铁律上 —— 缺的不是架构理解，而是机制手感
（IPC 断点调试、事件流、打包细节），做几个实验就通了。
```

---

## 12. 关联教材：pose-demo 的 Main → Preload → Renderer 完整流程

pose-demo 当前仍是 React + Vite + MediaPipe Web 应用，并未实现 Electron 主进程；完整的逐步流程、窗口创建、`BrowserWindow` 安全配置、`contextBridge`、`ipcRenderer.invoke`、`ipcMain.handle`、`webContents.send`、Result、sender/schema 校验，以及 Web iframe `postMessage` 与 Electron IPC 的差异，见：

`/home/delta/workspace/ai/pose-demo/docs/electron-main-renderer-ipc-flow.md`

从用户点击图标、操作系统创建 Electron 进程、Electron runtime 初始化、Main 入口解析、BrowserWindow/WebContents 创建、preload 加载、Renderer/React 启动，到 Mojo IPC 消息逐跳抵达 `ipcMain.handle` 并返回屏幕更新的底层版本，见：

`/home/delta/workspace/ai/pose-demo/docs/electron-from-click-to-ipc.md`

这份教材以 pose-demo 的姿态识别场景映射 Electron 边界：逐帧视频和关键点留在 renderer，主进程只承载窗口、配置、系统能力和低频状态事件。
