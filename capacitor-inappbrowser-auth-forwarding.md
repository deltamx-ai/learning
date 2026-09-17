# Capacitor InAppBrowser 认证转发方案整理

> 来源：用户发送的 txt 文件：`抱歉.txt`
>
> 目的：整理 InAppBrowser 加载 SPA 时，SPA 内部认证需要经过 Capacitor WebView 转发并带 Header 的真实场景、架构边界与实现思路。

---

## 抱歉，之前确实理解偏了。让我重新梳理你的真实场景

```text
[Capacitor 前端]
    │ 打开
    ▼
[InAppBrowser] ── 加载 ──> [SPA 页面]
                                │
                                │ SPA 内部发起认证流程
                                ▼
                          [需要经过 Capacitor WebView 转发(带 Header)]
                                │
                                │ 认证完成拿到 state/code
                                ▼
                          [回传给 InAppBrowser 里的 SPA]
```

```text
关键点：AuthWebview 不是被 SPA 直接调用的，而是被 Capacitor 前端调用；而 state/code 的最终消费者是 InAppBrowser 里的 SPA，不是 Capacitor 前端。所以需要一座"桥"把三者串起来。
```

## 一、整体架构

```text
┌──────────────────────────────────────────────────────────────┐
│  Capacitor 前端 (你的 App)                                     │
│                                                                │
│   ① 打开 InAppBrowser 加载 SPA                                  │
│   ② 监听 beforeload，拦截 SPA 发出的 myauth://start             │
│   ③ 调用 AuthWebview.open() 走认证                             │
│   ④ 拿到 state/code                                             │
│   ⑤ 通过 InAppBrowser.executeScript() 注入回 SPA               │
└──────────────────────────────────────────────────────────────┘
           │                              ▲
           │ ①                            │ ⑤
           ▼                              │
┌────────────────────┐         ┌──────────────────────┐
│  InAppBrowser       │         │  原生 AuthWebView     │
│   (SPA 页面)         │         │  (带 Header 的认证页)  │
│                     │         │                       │
│  SPA 发起认证:       │ ②       │  ④ 认证完成拿到        │
│  location.href =    │─────────│  state/code           │
│  'myauth://start'   │         │                       │
└────────────────────┘         └──────────────────────┘
```

## 唯一约定的协议

· SPA → Capacitor：myauth://start（自定义 scheme）
```text
· Capacitor → SPA：通过 executeScript 调用 SPA 里挂的全局函数 window.__onAuthResult(result)
```

原生端（AuthWebview）完全不用改，复用上一版代码即可。
## 二、SPA 侧代码

## SPA 里只需要两处改动

// 1. 注册全局回调，等待原生结果
```text
window.__onAuthResult = function (result) {
  if (result.error) {
    console.error('认证失败:', result.error);
    return;
  }
  const { state, code } = result;
  console.log('拿到 state/code，继续换 token:', state, code);
```

```text
  // 拿到 state/code 后，继续 SPA 内部的后续逻辑
  // 比如: exchangeToken(code, state)
```

};

// 2. 发起认证：用自定义 scheme 触发原生
```text
function startAuth() {
  // 用 location.href 而不是 window.open，这样才会触发 InAppBrowser 的 beforeload
  window.location.href = 'myauth://start';
```

}

SPA 不用关心 Header、不用关心 WebView，只要触发一个 myauth://start，剩下全交给原生。
## 三、Capacitor 前端编排代码

以 Cordova 的 cordova-plugin-inappbrowser 为例（Capacitor 官方 inappbrowser 类似）：
```text
import { AuthWebview } from 'your-plugin-name';
import { Capacitor } from '@capacitor/core';
```

```text
declare const cordova: any;
```

// ============ 打开 SPA 并挂上桥接逻辑 ============
```text
function openSpaWithAuthBridge(spaUrl: string) {
  // beforeload=yes 才能拦截导航
  const ref = cordova.InAppBrowser.open(spaUrl, '_blank', 'beforeload=yes');
```

```text
  // ============ ① 拦截 SPA 的认证触发 ============
  ref.addEventListener('beforeload', (event: { url: string }) => {
    if (!event.url.startsWith('myauth://start')) return;
```

```text
    // 阻止 InAppBrowser 真的去加载 myauth://start
    event.url = 'about:blank';
```

```text
    // 异步走认证流程
    runAuthAndInjectBack(ref);
  });
```

```text
  return ref;
```

}

// ============ ② 认证 + 注入回 SPA ============
```text
async function runAuthAndInjectBack(ref: any) {
  try {
    // 调用原生 AuthWebview（复用上一版实现）
    const { state, code } = await AuthWebview.open({
      entryUrl: 'https://auth.example.com/start',
      targetUrlPrefix: 'https://auth.example.com/oauth/authorize',
      headers: { 'X-Whitelist-Key': 'your-secret-key' },
      callbackUrl: 'myapp://callback',
    });
```

```text
    // ============ ③ 把结果注入回 SPA ============
    injectResultToSpa(ref, { state, code });
  } catch (e: any) {
    injectResultToSpa(ref, { error: e?.message ?? '认证失败' });
  }
```

}

```text
function injectResultToSpa(ref: any, result: { state?: string; code?: string; error?: string }) {
  const payload = JSON.stringify(result);
  const js = `
    (function() {
      if (typeof window.__onAuthResult === 'function') {
        window.__onAuthResult(${payload});
      } else {
        console.warn('SPA 未注册 window.__onAuthResult');
      }
    })();
  `;
```

```text
  ref.executeScript({ code: js }, () => {
    console.log('已把结果注入回 SPA:', result);
  });
```

}

## 四、完整调用入口

// App 启动后调用一次
openSpaWithAuthBridge('https://app.example.com/index.html');

## 或者根据业务在某个按钮里调用

```text
document.getElementById('open-app').addEventListener('click', () => {
  openSpaWithAuthBridge('https://app.example.com/index.html');
```

});

## 五、完整时序图

```text
User          Capacitor前端         InAppBrowser(SPA)        原生AuthWebView
 │                  │                     │                       │
 │ click 打开SPA    │                     │                       │
 │─────────────────>│                     │                       │
 │                  │ open(url, beforeload)│                      │
 │                  │────────────────────>│                       │
 │                  │                     │                       │
 │                  │                     │ SPA 渲染              │
 │                  │                     │ 用户点“登录”           │
 │                  │  beforeload:        │ location.href =       │
 │                  │  myauth://start     │ 'myauth://start'      │
 │                  │<────────────────────│                       │
 │                  │ event.url = about:blank                     │
 │                  │                     │                       │
 │                  │ AuthWebview.open({entryUrl, targetUrlPrefix, headers, callbackUrl})
 │                  │─────────────────────────────────────────────>│
 │                  │                     │                       │ 加载认证页(带Header)
 │                  │                     │                       │ 用户完成认证
 │                  │                     │                       │ 302 → myapp://callback?state&code
 │                  │  resolve {state,code}│                      │
 │                  │<─────────────────────────────────────────────│
 │                  │                     │                       │
 │                  │ executeScript(      │                       │
 │                  │  __onAuthResult(...))│                      │
 │                  │────────────────────>│                       │
 │                  │                     │ SPA 拿到 state/code   │
 │                  │                     │ 继续后续逻辑          │
```

## 六、关键点说明

关注点 说明
```text
为什么用 location.href 而不是 window.open beforeload 只拦截主 WebView 的导航。window.open 会走 _system 或新窗口，不一定触发 beforeload。
为什么 SPA 要挂 window.__onAuthResult executeScript 注入的 JS 运行在 SPA 的 window 作用域里，通过全局函数回传结果是最简单的方式。也可以用 postMessage + window.addEventListener('message')，但要多写一层。
```

event.url = 'about:blank' 的作用 Cordova inappbrowser 里，修改 event.url 可以阻止原 URL 加载。如果改成同一个 URL 会重新触发 beforeload 死循环，所以改成 about:blank。
```text
AuthWebview 需不需要改？ 不需要。它只对 Capacitor 前端负责，前端负责和 InAppBrowser 的桥接。
```

executeScript 的时机 必须确保 SPA 已经加载完毕（DOM 就绪、__onAuthResult 已挂载）。如果 SPA 是异步挂载的，可以在 injectResultToSpa 里加轮询重试。
```text
Capacitor 官方 inappbrowser API 和 Cordova 略有差异：监听事件用 InAppBrowser.addListener('beforeLoad', ...)，注入脚本用 InAppBrowser.executeScript({ code })，思路完全一样。
失败兜底 AuthWebview.open reject 时也要注入 { error } 回 SPA，否则 SPA 会一直等下去。
SPA 生命周期 如果用户在认证过程中把 InAppBrowser 关了，注入会失败。可以在 beforeload 里先检查 ref 是否还存在。
```

## 七、如果 SPA 更希望用 postMessage

## 如果你不想让 SPA 挂全局函数，也可以改成

## SPA 侧

```text
window.addEventListener('message', (e) => {
  if (e.data?.type === 'AUTH_RESULT') {
    const { state, code, error } = e.data.payload;
    // 处理结果
  }
```

});

## Capacitor 前端注入的脚本改成

```text
const js = `
  window.postMessage({
    type: 'AUTH_RESULT',
    payload: ${JSON.stringify(result)}
  }, '*');
```

`;

本质上还是 executeScript 注入，只是通信方式从"直接调函数"换成"派发 message 事件"。
## 八、Cordova InAppBrowser 完整 API 参考

## 如果你用的是 Cordova 版本的 inappbrowser

```text
const ref = cordova.InAppBrowser.open(url, target, options);
```

// 事件
```text
ref.addEventListener('loadstart', (event) => {});   // 开始加载
ref.addEventListener('loadstop', (event) => {});    // 加载完成
ref.addEventListener('loaderror', (event) => {});   // 加载错误
ref.addEventListener('beforeload', (event) => {     // 导航前，可拦截
  event.url = 'about:blank'; // 修改 URL 阻止加载
```

});
```text
ref.addEventListener('exit', () => {});             // 关闭
```

// 执行脚本
```text
ref.executeScript({ code: '...' }, (results) => {});
```

// 注入 CSS
```text
ref.insertCSS({ code: '...' }, () => {});
```

// 关闭
ref.close();

Options 必须包含 beforeload=yes，否则 beforeload 事件不会被触发。
```text
这样整个闭环就完成了：InAppBrowser 负责展示 SPA，AuthWebview 负责带 Header 走认证，Capacitor 前端负责用 beforeload + executeScript 在两个 WebView 之间搬运结果。原生插件本身不需要任何改动。
```


---

## 整理结论

- AuthWebview 不应被理解为 SPA 直接调用的插件，而是 Capacitor 宿主侧用来承接/转发认证流程的原生 WebView 能力。
- InAppBrowser 内的 SPA 与 Capacitor 宿主之间需要明确通信边界，不能假设 SPA 直接拥有 Capacitor 插件能力。
- 认证请求需要带 Header 时，应由 Capacitor 原生 WebView 或宿主侧受控通道发起，避免把敏感 Header 暴露给不可信页面。
- 回调 state/code 应通过明确的 callback URL 或受控消息通道返回给宿主，再由宿主转回 InAppBrowser 内的 SPA。
