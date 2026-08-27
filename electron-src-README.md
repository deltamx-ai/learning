# Electron 源码导读（IPC + contextBridge）

> 日期：2026-08-19
> 来源：electron/electron main 分支（sparse checkout）
> 目的：配合 electron-ipc-internals.md 阅读 Electron 真实源码
> 源码目录：learning/electron-src/

---

## 文件清单

```text
electron-src/
├── context_bridge.cc              ← contextBridge 核心实现（1140 行）
│                                    注入代理对象 / 跨世界调用 / 上下文切换
├── context_bridge.h               ← 头文件
├── context_bridge/
│   ├── object_cache.cc            ← 对象缓存（跨世界对象引用管理）
│   └── object_cache.h
├── ipc_renderer.cc                ← ipcRenderer 实现（298 行）
│                                    invoke / send / sendSync / sendToHost
├── ipc_handler_impl.cc            ← ipcMain 处理实现（194 行）
│                                    Message / Invoke / MessageSync 分发
├── ipc_handler_impl.h             ← 头文件
└── ipc_native.cc                  ← 原生 IPC 桥接（83 行）
```

---

## contextBridge 核心机制（对照代码）

### 1. 上下文切换 = v8::Context::Scope（反复出现）

```text
context_bridge.cc 中 v8::Context::Scope 出现 20+ 次：
  :201  :237  :351  :371  :399  :406  :414  :449  :506  :556
  :595  :628  :643  :657  :690  :727  :850  :883  :975  :1000

这就是我们讲的"跨世界调用"的真实实现：
  调用代理函数 → Context::Scope 切换到目标世界 Context
  → 在目标世界执行真实函数 → 切回
```

### 2. 注入全局 = _overrideGlobalValueFromIsolatedWorld

```text
context_bridge.cc:1129-1131:
  dict.SetMethod("_overrideGlobalValueFromIsolatedWorld", ...);
  dict.SetMethod("_overrideGlobalPropertyFromIsolatedWorld", ...);

→ Electron 内部用这两个方法把隔离世界的值/属性
  覆盖/注入到主世界的全局对象上
→ 这就是 "exposeInMainWorld 把方法挂到 window" 的底层
```

### 3. 函数调用链

```text
context_bridge.cc 关键函数（搜索）：
  CallFunctionWithArgs      ← 调用带参数的函数（跨世界）
  RunFunctionWithReferences ← 执行函数并管理对象引用
  FunctionGetType           ← 判断函数类型（普通/构造/方法）

机制：
  参数序列化 → 目标 Context 执行 → 结果序列化返回
```

---

## ipcRenderer 核心机制（对照代码）

### ipc_renderer.cc 的 API 注册

```cpp
// ipc_renderer.cc:197-200
.SetMethod("send", &T::SendMessage)
.SetMethod("sendSync", &T::SendSync)
.SetMethod("sendToHost", &T::SendToHost)
.SetMethod("invoke", &T::Invoke)
```

→ 这就是 `ipcRenderer.send / sendSync / sendToHost / invoke` 的注册点
→ 每个方法绑定到 C++ 实现

### invoke 的实现（异步 Promise）

```cpp
// ipc_renderer.cc:87-110
v8::Local<v8::Promise> Invoke(v8::Isolate* isolate, ...) {
  ...
  electron_ipc_remote_->Invoke(...);   // 发给主进程
  ...
  return handle;                        // 返回 Promise
}
```

→ invoke 返回 Promise（异步），内部调 `electron_ipc_remote_->Invoke`
→ `electron_ipc_remote_` 是 Mojo remote（跨进程接口）

### send 的实现（单向）

```cpp
// ipc_renderer.cc:71
void SendMessage(...)  // send 的底层
```

---

## ipcMain 处理（对照代码）

### ipc_handler_impl.cc：主进程侧的接收端

```cpp
// ipc_handler_impl.cc:59
void ElectronApiIPCHandlerImpl::Message(bool internal, ...)
// ipc_handler_impl.cc:62
void ElectronApiIPCHandlerImpl::Invoke(bool internal, ...)
// ipc_handler_impl.cc:94
void ElectronApiIPCHandlerImpl::MessageSync(bool internal, ...)
```

→ 这是主进程接收 renderer 消息的入口（mojom 接口实现）
→ `Invoke` 里调用 `session->Get()->Invoke(event_object, channel, args)`
  → 最终触发你注册的 `ipcMain.handle(channel, handler)`

### 连接管理

```cpp
// ipc_handler_impl.cc:30-31
receiver_.set_disconnect_handler(...);   // 连接断开处理
// ipc_handler_impl.cc:36
void ElectronApiIPCHandlerImpl::WebContentsDestroyed()  // 页面销毁清理
```

→ 渲染进程崩溃/关闭时，receiver 断开 → 清理回调

---

## 完整链路（源码级）

```text
renderer 页面:
  window.desktop.storage.projectsList()
    → context_bridge.cc 的代理函数（主世界）
      → v8::Context::Scope 切到隔离世界
        → 真函数执行（preload 定义）
          → ipcRenderer.invoke('storage:projects:list')
            → ipc_renderer.cc:Invoke
              → electron_ipc_remote_->Invoke(...)  [Mojo]
                → 主进程 mojom 接口
                  → ipc_handler_impl.cc:Invoke
                    → session->Get()->Invoke(...)
                      → 你的 ipcMain.handle handler
                        → 数据库 → 返回
        → 结果序列化回主世界
      → Promise resolve
    → React setState
```

---

## 阅读建议

```text
1. 先读 ipc_renderer.cc（298 行，最小）
   → 理解 invoke/send 的 C++ 入口

2. 再读 ipc_handler_impl.cc（194 行）
   → 理解主进程侧如何接收分发

3. 最后读 context_bridge.cc（1140 行，最大）
   → 重点看 v8::Context::Scope 出现的位置
   → 理解"注入 + 跨世界调用"

4. object_cache.cc（最小）
   → 理解跨世界对象引用怎么管理（防泄漏）
```

---

## 与之前文档的关系

```text
electron-ipc-internals.md（概念版）
  → electron-src/（代码版）
    → mojo-src/（更底层：Chromium Mojo）

三层对应：
  概念：ipcRenderer.invoke → Mojo → ipcMain.handle
  代码：ipc_renderer.cc → electron_ipc_remote_ → ipc_handler_impl.cc
  底层：mojo-src/channel_posix.cc（socket 传输）
```
