# Electron 学习地图：IPC 之外必须掌握的主题

> 日期：2026-08-19
> 场景：molecraft（Electron 43 + React 19，本地 Agent 工作台）
> 目的：IPC 之外的完整学习清单，按优先级 T1-T4 组织
> 定位：配合 `electron-architecture.md`（架构）、`electron-ipc-internals.md`（IPC 底层）

---

## 学习地图总览

```text
核心必学（地基）：
  1. 生命周期与窗口管理
  2. 文件系统与路径
  3. 本地持久化
  4. 对话框与原生能力

安全进阶：
  5. Session 与网络控制
  6. 权限处理器（PermissionHandler）

打包分发（上线前）：
  7. asar 与资源路径（最大坑）
  8. electron-builder 全套
  9. 自动更新

健壮性（Agent 应用尤其重要）：
  10. 崩溃与错误处理
  11. 子进程管理（Agent 工作台命门！）
  12. 性能优化

开发体验：
  13. 主进程调试
  14. 测试
  15. 多平台差异
```

---

## 一、核心必学（桌面应用的地基）

### 1. 生命周期与窗口管理

```text
app 生命周期：ready / window-all-closed / activate / before-quit / will-quit
窗口：BrowserWindow 全部选项（frame 无边框、transparent、alwaysOnTop）
多窗口策略：主窗口 + 设置窗 + 对话框窗
窗口状态持久化：位置/大小记住（electron-window-state 类）

molecraft 场景：单主窗口 + 设置弹窗，要学窗口关闭时的状态保存
```

### 2. 文件系统与路径（Agent 工作台核心！）

```text
app.getPath() 全家：
  userData（数据库/密钥放这）
  temp / documents / downloads
path 操作：join / resolve / relative（路径穿越防护的基础）

molecraft 场景：项目打开、文件树、读取文件——已在使用，
特别注意 asar 打包后路径变化（见第 7 节）
```

### 3. 本地持久化

```text
SQLite（better-sqlite3 + Drizzle）—— 已在使用 ✅
electron-store（轻量 JSON 配置）
userData 目录 vs 项目目录的划分

molecraft 场景：数据库已落位，要学"迁移策略"（schema 升级）
```

### 4. 对话框与原生能力

```text
dialog.showOpenDialog（打开项目目录——已用）
dialog.showMessageBox / showSaveDialog
clipboard（复制粘贴）
Notification（系统通知——Agent 任务完成提醒）
shell.openExternal / openPath（打开外链——navigation-policy 在管）

molecraft 场景：打开项目 = 系统目录选择器，通知 = Run 完成提醒
```

---

## 二、安全进阶（已入门，系统化）

### 5. Session 与网络控制

```text
session.defaultSession：
  webRequest（拦截请求——CSP 注入已用 ✅）
  setPermissionRequestHandler（摄像头/麦克风/通知权限——未来需要）
  cookies / proxy / certificate（企业环境）

molecraft 场景：setPermissionRequestHandler 是 Agent 应用必须的
（模型下载、网络请求权限控制）
```

### 6. 权限处理器（PermissionHandler）

```text
session.setPermissionRequestHandler((wc, permission, callback) => {
  // 决定：允许/拒绝 摄像头、地理位置、通知等
})

与渲染进程的"权限弹窗"完全不同——这是 Electron 层的统一闸门
molecraft 未来：Agent 需要网络权限时走这里审批
```

---

## 三、打包与分发（上线前必须懂）

### 7. asar 与资源路径（最大坑）

```text
打包后代码在 app.asar 里：
  不是真实目录！fs.readFile 能读（Electron 虚拟化）
  但 child_process 启动的脚本/二进制、ffmpeg 等原生工具不能直接跑
  → 需要 asarUnpack 解包
  → 资源路径用 app.getAppPath() + process.resourcesPath 区分

molecraft 场景：AI Agent 可能要跑 CLI 工具 → asarUnpack 规划
```

### 8. electron-builder 全套

```text
targets：nsis（Windows）/ dmg（macOS）/ AppImage+deb（Linux）
代码签名：Windows 证书、macOS Apple Developer（不签会被系统拦）
图标：ico/icns/png 三平台（molecraft-icon 系列已生成 png/ico，缺 icns）
installer 选项：快捷方式、安装目录、自动更新基础

molecraft 场景：图标已生成，打包已验证过，还差签名与 icns
```

### 9. 自动更新（electron-updater）

```text
发布 → 检查更新 → 下载 → 安装
需要：更新服务器（GitHub Releases / 自建）
macOS 自动更新还要代码签名

molecraft 场景：MVP 阶段可不做，但架构上留位置
```

---

## 四、健壮性（Agent 应用尤其重要）

### 10. 崩溃与错误处理

```text
process.on('uncaughtException' / 'unhandledRejection')
crashReporter（崩溃上报）
渲染进程崩溃检测：'render-process-gone' → 白屏恢复

molecraft 场景：startup.ts 已做启动失败报告 ✅
还差：运行中崩溃的恢复策略
```

### 11. 子进程管理（Agent 工作台命门！）

```text
child_process.spawn / execFile
utilityProcess（Electron 推荐的子进程 API，比 child_process 更受控）
进程超时/杀死/清理（Agent 跑挂了要能回收）

molecraft 场景：未来 Agent/CLI 子进程——Molecraft 的差异化能力
（浏览器扩展做不了这个，Electron 能）
```

### 12. 性能优化

```text
启动速度：懒加载、推迟非关键初始化
内存：渲染进程是内存大头，控制窗口数
大型列表：虚拟滚动
WebContents 生命周期：不用的窗口及时销毁

molecraft 场景：模型下载/加载是重活，别阻塞主进程 UI 线程
```

---

## 五、开发体验（不学就痛苦）

### 13. 主进程调试

```text
VS Code launch.json：--inspect 调试主进程
渲染进程：openDevTools()
Electron F12 / Ctrl+Shift+I 打开 devtools

molecraft 场景：launch.json 已配好 ✅
```

### 14. 测试

```text
单元测试：vitest + mock electron（ipcMain/ipcRenderer 打桩）
E2E：Playwright（可以驱动真实 Electron！）
molecraft 场景：test/e2e/electron-smoke.test.mjs 已有 ✅
```

### 15. 多平台差异（发布时踩坑）

```text
macOS：菜单栏在屏幕顶部、dock、Cmd+Q 退出习惯
Windows：任务栏、最小化到托盘
Linux：不同桌面环境行为差异

molecraft 场景：主要在 Linux/WSL 开发，发布要测三平台
```

---

## 六、优先级排序（molecraft 场景）

```text
T1（马上要）：
  1. 窗口/生命周期（已在用，系统化理解）
  2. 文件系统与路径（已在用，注意 asar）
  4. 对话框/通知（打开项目、Run 完成提醒）

T2（Agent 功能上线前）：
  11. 子进程管理（Agent CLI——差异化核心）
  6. 权限处理器（网络/摄像头审批）
  5. Session 控制（网络请求拦截）

T3（准备发布时）：
  7. asar 与资源（打包坑）
  8. electron-builder（签名/安装包）
  9. 自动更新
  10. 崩溃恢复

T4（长期）：
  12. 性能优化
  14. 测试体系完善
  15. 多平台打磨
```

---

## 七、一句话总结

```text
IPC 只是"怎么说话"，Electron 还有"怎么过日子"：

窗口/生命周期（房子）、文件系统（仓库）、持久化（账本）、
对话框/通知（门铃）、Session/权限（门禁）、子进程（雇人干活）、
打包/更新（搬家）、崩溃恢复（急救）、调试测试（体检）

最特别的是【子进程管理】—— Molecraft 作为本地 Agent 工作台，
能跑 Agent 子进程是它与浏览器扩展的本质区别，必须吃透。
```
