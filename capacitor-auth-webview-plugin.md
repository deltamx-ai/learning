# Capacitor AuthWebview 插件完整代码整理

> 来源：用户发送的 txt 文件：`下面把完整代码整理出来.txt`
>
> 目的：整理一个 Capacitor 原生认证 WebView 插件：前端调用 `AuthWebview.open({ url, headers, callbackUrl })`，Android/iOS 原生创建 WebView，带自定义 Header 加载认证页，拦截回调 URL，解析 `state/code` 后关闭 WebView 并返回给前端。

---

## 0. 整体目标

这个插件解决的问题：

```text
前端需要打开一个认证页面
  ↓
初始请求需要附带自定义 Header
  ↓
用户完成认证后，服务端 302 到 callback URL
  ↓
原生 WebView 拦截 callbackUrl
  ↓
解析 state/code
  ↓
关闭 WebView
  ↓
resolve 给前端
```

---

## 1. TypeScript 层

### 1.1 `src/definitions.ts`

```ts
export interface OpenAuthWebViewOptions {
  /** 要加载的认证页面 URL */
  url: string;
  /** 附加到初始请求的自定义 Header，例如 { 'X-Whitelist-Key': 'xxx' } */
  headers?: Record<string, string>;
  /** 用于识别回调的 URL 前缀，例如 'myapp://callback' */
  callbackUrl: string;
}

export interface AuthWebViewResult {
  state: string;
  code: string;
}

export interface AuthWebviewPlugin {
  /**
   * 打开 WebView 加载认证页面，等待重定向后返回 state 和 code，并自动关闭 WebView。
   */
  open(options: OpenAuthWebViewOptions): Promise<AuthWebViewResult>;
}

```

### 1.2 `src/index.ts`

```ts
import { registerPlugin } from '@capacitor/core';
import type { AuthWebviewPlugin } from './definitions';

const AuthWebview = registerPlugin<AuthWebviewPlugin>('AuthWebview', {
  web: () => import('./web').then(m => new m.AuthWebviewWeb()),
});

export * from './definitions';
export { AuthWebview };

```

### 1.3 `src/web.ts`（浏览器降级）

```ts
import { WebPlugin } from '@capacitor/core';
import type { AuthWebviewPlugin, OpenAuthWebViewOptions, AuthWebViewResult } from './definitions';

export class AuthWebviewWeb extends WebPlugin implements AuthWebviewPlugin {
  async open(_options: OpenAuthWebViewOptions): Promise<AuthWebViewResult> {
    throw this.unimplemented('AuthWebview 仅在原生端可用');
  }
}

```

### 1.4 前端调用示例

```ts
import { AuthWebview } from 'your-plugin-name';

async function doAuth() {
  try {
    const result = await AuthWebview.open({
      url: 'https://auth.example.com/oauth/authorize?client_id=xxx&redirect_uri=myapp://callback&response_type=code',
      headers: { 'X-Whitelist-Key': 'your-secret-key' },
      callbackUrl: 'myapp://callback',
    });
    console.log('state:', result.state);
    console.log('code:', result.code);
  } catch (e) {
    console.error('认证取消或失败', e);
  }
}

```

## 2. Android 完整实现

### 2.1 `android/src/main/java/com/yourcompany/plugins/authwebview/AuthWebviewPlugin.java`

```java
package com.yourcompany.plugins.authwebview;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

@CapacitorPlugin(name = "AuthWebview")
public class AuthWebviewPlugin extends Plugin {

    private WebView webView;
    private FrameLayout containerView;
    private PluginCall savedCall;

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String callbackUrl = call.getString("callbackUrl");
        JSObject headersObj = call.getObject("headers");

        if (url == null || callbackUrl == null) {
            call.reject("url 和 callbackUrl 为必填参数");
            return;
        }

        this.savedCall = call;

        Map<String, String> extraHeaders = new HashMap<>();
        if (headersObj != null) {
            for (Iterator<String> it = headersObj.keys(); it.hasNext(); ) {
                String key = it.next();
                extraHeaders.put(key, headersObj.getString(key));
            }
        }

        getActivity().runOnUiThread(() -> {
            Activity activity = getActivity();

            // ===== 1. 容器 =====
            containerView = new FrameLayout(activity);
            containerView.setLayoutParams(new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
            containerView.setBackgroundColor(Color.WHITE);
            containerView.setFocusableInTouchMode(true);
            containerView.setOnKeyListener((v, keyCode, event) -> {
                if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
                    cancelAndClose("用户取消了认证");
                    return true;
                }
                return false;
            });

            // ===== 2. WebView =====
            webView = new WebView(activity);
            webView.setLayoutParams(new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return handleCallback(request.getUrl().toString(), callbackUrl);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String urlStr) {
                    return handleCallback(urlStr, callbackUrl);
                }
            });

            // ===== 3. 关闭按钮 =====
            Button closeBtn = new Button(activity);
            closeBtn.setText("✕");
            closeBtn.setTextSize(20);
            closeBtn.setBackgroundColor(Color.TRANSPARENT);
            FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.TOP | Gravity.END);
            btnParams.setMargins(0, 80, 24, 0);
            closeBtn.setLayoutParams(btnParams);
            closeBtn.setOnClickListener(v -> cancelAndClose("用户取消了认证"));

            // ===== 4. 组装并挂载 =====
            containerView.addView(webView);
            containerView.addView(closeBtn);

            ViewGroup root = activity.findViewById(android.R.id.content);
            root.addView(containerView);
            containerView.requestFocus();

            // ===== 5. 加载（带自定义 Header）=====
            webView.loadUrl(url, extraHeaders);
        });
    }

    private boolean handleCallback(String currentUrl, String callbackUrl) {
        if (currentUrl == null || !currentUrl.startsWith(callbackUrl)) {
            return false;
        }

        Uri uri = Uri.parse(currentUrl);
        String state = uri.getQueryParameter("state");
        String code = uri.getQueryParameter("code");

        JSObject result = new JSObject();
        result.put("state", state);
        result.put("code", code);

        PluginCall call = this.savedCall;
        this.savedCall = null;

        getActivity().runOnUiThread(() -> {
            removeWebView();
            if (call != null) call.resolve(result);
        });
        return true;
    }

    private void cancelAndClose(String reason) {
        PluginCall call = this.savedCall;
        this.savedCall = null;
        getActivity().runOnUiThread(() -> {
            removeWebView();
            if (call != null) call.reject(reason);
        });
    }

    private void removeWebView() {
        if (containerView != null && containerView.getParent() instanceof ViewGroup) {
            ((ViewGroup) containerView.getParent()).removeView(containerView);
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        containerView = null;
    }

    @Override
    protected void handleOnDestroy() {
        if (savedCall != null) {
            savedCall.reject("插件已销毁");
            savedCall = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        containerView = null;
    }
}

```

## 3. iOS 完整实现

### 3.1 `ios/Sources/AuthWebviewPlugin/AuthWebviewPlugin.swift`

```swift
import Foundation
import Capacitor
import WebKit
import UIKit

@objc(AuthWebviewPlugin)
public class AuthWebviewPlugin: CAPPlugin, WKNavigationDelegate {

    // MARK: - 属性
    private var overlayWindow: UIWindow?
    private var webView: WKWebView?
    private var containerView: UIView?
    private var savedCall: CAPPluginCall?
    private var callbackUrl: String?

    // MARK: - 插件方法
    @objc func open(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let callbackUrl = call.getString("callbackUrl"),
              let url = URL(string: urlString) else {
            call.reject("url 和 callbackUrl 为必填参数")
            return
        }

        self.savedCall = call
        self.callbackUrl = callbackUrl

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.setupAndShow(url: url, call: call)
        }
    }

    // MARK: - 创建视图并显示
    private func setupAndShow(url: URL, call: CAPPluginCall) {
        // ===== 1. 创建独立 window，层级高于 InAppBrowser =====
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.windowLevel = .alert + 1

        // 关联 windowScene（iOS 13+）
        if #available(iOS 13.0, *) {
            let scene = self.bridge?.viewController?.view.window?.windowScene
                ?? UIApplication.shared.connectedScenes
                    .compactMap { $0 as? UIWindowScene }
                    .first
            window.windowScene = scene
        }

        self.overlayWindow = window

        // ===== 2. 容器 =====
        let container = UIView(frame: window.bounds)
        container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.backgroundColor = .white
        self.containerView = container

        // ===== 3. WebView =====
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: container.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        self.webView = webView

        // ===== 4. 关闭按钮 =====
        let closeBtn = UIButton(type: .system)
        closeBtn.setTitle("✕", for: .normal)
        closeBtn.titleLabel?.font = UIFont.systemFont(ofSize: 22, weight: .medium)
        closeBtn.tintColor = .darkGray
        closeBtn.frame = CGRect(
            x: container.bounds.width - 56,
            y: 60,
            width: 40,
            height: 40
        )
        closeBtn.autoresizingMask = [.flexibleLeftMargin, .flexibleBottomMargin]
        closeBtn.addTarget(self, action: #selector(self.closeTapped), for: .touchUpInside)

        // ===== 5. 组装并挂载到 window =====
        container.addSubview(webView)
        container.addSubview(closeBtn)

        let rootVC = UIViewController()
        rootVC.view.backgroundColor = .white
        rootVC.view.addSubview(container)
        window.rootViewController = rootVC
        window.makeKeyAndVisible()

        // ===== 6. 构造带自定义 Header 的请求 =====
        var request = URLRequest(url: url)
        if let headers = call.getObject("headers") {
            for (key, value) in headers {
                if let valueStr = value as? String {
                    request.setValue(valueStr, forHTTPHeaderField: key)
                }
            }
        }
        webView.load(request)
    }

    // MARK: - WKNavigationDelegate
    public func webView(_ webView: WKWebView,
                        decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {

        guard let requestUrl = navigationAction.request.url?.absoluteString,
              let callbackUrl = self.callbackUrl else {
            decisionHandler(.allow)
            return
        }

        if requestUrl.hasPrefix(callbackUrl) {
            let components = URLComponents(string: requestUrl)
            let state = components?.queryItems?.first(where: { $0.name == "state" })?.value
            let code = components?.queryItems?.first(where: { $0.name == "code" })?.value

            let result = JSObject()
            result["state"] = state
            result["code"] = code

            let call = self.savedCall
            self.savedCall = nil

            DispatchQueue.main.async {
                self.removeWebView()
                call?.resolve(result)
            }

            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    // MARK: - 关闭处理
    @objc private func closeTapped() {
        let call = self.savedCall
        self.savedCall = nil
        DispatchQueue.main.async {
            self.removeWebView()
            call?.reject("用户取消了认证")
        }
    }

    private func removeWebView() {
        DispatchQueue.main.async {
            self.webView?.stopLoading()
            self.webView?.navigationDelegate = nil
            self.webView?.removeFromSuperview()
            self.webView = nil

            self.containerView?.removeFromSuperview()
            self.containerView = nil

            self.overlayWindow?.isHidden = true
            self.overlayWindow = nil
        }
    }

    deinit {
        if self.webView != nil || self.overlayWindow != nil {
            self.webView?.stopLoading()
            self.webView?.navigationDelegate = nil
            self.webView?.removeFromSuperview()
            self.overlayWindow?.isHidden = true
        }
    }
}

```

## 4. 关键设计汇总

| 关注点 | Android | iOS |
| --- | --- | --- |
| 挂载点 | activity.findViewById(android.R.id.content) | 独立 UIWindow（windowLevel = .alert + 1） |
| 为什么 | Activity 根布局即最上层 | 必须高于 InAppBrowser 的 window |
| 带 Header 加载 | webView.loadUrl(url, extraHeaders) | URLRequest + setValue(forHTTPHeaderField:) |
| 回调拦截 | shouldOverrideUrlLoading（双版本兼容） | decidePolicyFor navigationAction |
| 关闭处理 | 关闭按钮 + 返回键拦截 | 关闭按钮 |
| 销毁顺序 | stopLoading → destroy → 移除容器 | stopLoading → navigationDelegate = nil → 移除视图 → window 置空 |
| 线程 | 全部 runOnUiThread | 全部 DispatchQueue.main.async |
## 5. 整体流程图

```text
前端 AuthWebview.open({ url, headers, callbackUrl })
        │
        ▼
原生 open()
  1. 创建容器（FrameLayout / UIView）
  2. 创建 WebView + 关闭按钮
  3. 挂载到 Activity 根布局 / 独立高优先级 UIWindow
  4. webView.loadUrl(url, headers) / webView.load(URLRequest with headers)
        │
        ▼
用户完成认证，服务器 302 重定向到 myapp://callback?state=xxx&code=yyy
        │
        ▼
拦截层捕获回调 URL：
  1. 匹配 callbackUrl 前缀
  2. 解析 state / code
  3. removeWebView() 关闭并销毁
  4. call.resolve({ state, code })
        │
        ▼
前端 await 得到 { state, code }，继续换 token

这份代码两端对称、结构完整，iOS 端通过独立 UIWindow 彻底解决了被 InAppBrowser 覆盖的问题。可以直接按文件对照创建，跑通后再做细节调整。
```


---

## 6. 注意事项

- Android 端通过 `activity.findViewById(android.R.id.content)` 把 WebView 容器挂到 Activity 根布局。
- iOS 端用独立 `UIWindow` 且 `windowLevel = .alert + 1`，用于避免被 InAppBrowser 的窗口层级覆盖。
- 初始请求自定义 Header 只保证首个请求带上；后续跳转是否继续带 Header 取决于 WebView/服务端流程。
- callback URL 使用 `startsWith/hasPrefix` 匹配，生产环境建议同时校验 scheme、host、path，避免误拦截。
- Header 中如果包含敏感白名单 key，要避免进入前端日志、崩溃日志和普通业务日志。
