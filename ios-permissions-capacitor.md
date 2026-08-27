# iOS 权限管理：常见权限、特殊权限与 Capacitor 最小实现

> 日期：2026-08-19
> 场景：Capacitor + iOS（含 WebView / InAppBrowser / getUserMedia / 原生能力）
> 目的：整理 iOS 常见权限、特殊能力、最小配置与 Capacitor 插件示例

---

## 1. iOS 权限管理的基本特点

iOS 和 Android 最大的不同是：

1. 很多权限**不需要你手写运行时请求 API**，而是由系统在首次使用时自动弹窗。
2. 但你仍然必须在 `Info.plist` 里提前写清楚用途说明，否则会直接崩溃或拒绝。
3. 某些能力（比如定位精度、照片访问、蓝牙、局域网、通知）仍然需要显式处理状态与授权。
4. Capacitor 8 不再支持通过 `capacitor.config.ts` 注入 `ios.infoPlist`，要直接改原生 `Info.plist`。

---

## 2. 常见权限表

### 2.1 常用权限

| 权限 | 用途 | 配置位置 | 是否有系统弹窗 | 备注 |
| --- | --- | --- | --- | --- |
| 摄像头 | 拍照、扫码、getUserMedia | `Info.plist` | 是，首次使用时 | 必须写 `NSCameraUsageDescription` |
| 麦克风 | 录音、视频通话、getUserMedia | `Info.plist` | 是，首次使用时 | 必须写 `NSMicrophoneUsageDescription` |
| 相册读写 | 选图、保存图片 | `Info.plist` | 是，首次访问时 | 新版 iOS 支持有限选择（limited） |
| 定位（精确/粗略） | 地图、附近功能 | `Info.plist` | 是，首次使用时 | 可能分“始终/使用期间” |
| 通知 | 推送、本地通知 | Cap 插件/系统设置 | 是，通常在首次请求时 | 需要用户允许 |
| 蓝牙 | 外设连接 | `Info.plist` | 是，首次使用时 | 可能需要后台模式 |
| 本地网络 | 局域网设备发现 | `Info.plist` | 是/或受系统策略影响 | iOS 14+ 常见 |
| 日历/提醒事项/通讯录 | 同步、导入导出 | `Info.plist` | 是，首次使用时 | 各自独立权限 |

### 2.2 常见特殊能力

| 能力 | 用途 | 申请方式 | 备注 |
| --- | --- | --- | --- |
| 后台定位 | 持续定位 | `Info.plist` + 开启后台模式 | 审核较严格 |
| 后台音频 | 音频播放/录制 | `Info.plist` + Background Modes | 要求明确场景 |
| 局域网访问 | 访问本地开发机 / 设备 | `NSAppTransportSecurity` / `NSAllowsLocalNetworking` | 真机常用 |
| 访问相册“全部/有限” | 照片权限分级 | Photos 框架 + 系统授权 | 需要处理 limited 状态 |
| 访问摄像头 in WKWebView | WebView 内 getUserMedia | `Info.plist` + `WKUIDelegate` | iOS 15+ 关键坑 |

---

## 3. Capacitor 最小配置

### 3.1 直接修改 `Info.plist`

Capacitor 8 下，建议在 `ios/App/App/Info.plist` 里直接写：

```xml
<key>NSCameraUsageDescription</key>
<string>需要使用摄像头进行姿态识别</string>

<key>NSMicrophoneUsageDescription</key>
<string>需要使用麦克风进行语音或视频输入</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>需要访问相册以选择图片</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>需要使用定位来提供附近功能</string>

<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
```

> 缺少用途说明会导致系统直接拒绝或崩溃，不会给你“温柔”的失败提示。

### 3.2 真机访问本地开发服务器

- 模拟器：`localhost` 就是宿主 Mac，本地开发通常可直接访问。
- 真机：`localhost` 指向手机自己，要改成 Mac 的局域网 IP，例如 `http://192.168.x.x:4200`。
- 如果你访问的是局域网 HTTP，建议用 `NSAllowsLocalNetworking`，而不是全局放开 ATS。

---

## 4. iOS 权限管理的最小原生代码

iOS 里很多权限不是“手写弹窗请求”，而是框架在首次用时自动触发。你通常需要做的是：

1. 在原生层**检查当前授权状态**；
2. 在需要时**调用对应框架的 request/authorization 方法**；
3. 在权限被拒绝后，**引导用户去系统设置**。

下面给一个最小 Capacitor 插件，示例用 **摄像头**。

---

## 5. 最小 Capacitor 插件：摄像头权限

### 5.1 Swift 插件代码

```swift
import Capacitor
import AVFoundation
import Photos

@objc(CameraPermissionPlugin)
public class CameraPermissionPlugin: CAPPlugin {

    @objc func check(_ call: CAPPluginCall) {
        let status = currentStatus()
        call.resolve(status)
    }

    @objc func request(_ call: CAPPluginCall) {
        let current = AVCaptureDevice.authorizationStatus(for: .video)
        switch current {
        case .authorized:
            call.resolve(currentStatus())
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { _ in
                DispatchQueue.main.async {
                    call.resolve(self.currentStatus())
                }
            }
        case .denied, .restricted:
            call.resolve(currentStatus())
        @unknown default:
            call.resolve(currentStatus())
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            call.reject("Invalid settings URL")
            return
        }
        UIApplication.shared.open(url)
        call.resolve()
    }

    private func currentStatus() -> JSObject {
        let auth = AVCaptureDevice.authorizationStatus(for: .video)
        let granted = (auth == .authorized)
        let canAskAgain = (auth == .notDetermined)

        return [
            "granted": granted,
            "canAskAgain": canAskAgain,
            "status": statusString(auth)
        ]
    }

    private func statusString(_ auth: AVAuthorizationStatus) -> String {
        switch auth {
        case .authorized: return "granted"
        case .notDetermined: return "not-determined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "unknown"
        }
    }
}
```

### 5.2 这个插件做了什么

- `check()`：查询当前摄像头授权状态。
- `request()`：如果没请求过，就触发系统授权弹窗；如果已经拒绝，就不会强行再弹。
- `openSettings()`：引导用户进入系统设置页。

> iOS 里不像 Android 那样“反复请求”很有意义；一旦 `denied`，更常见的做法是直接去设置页。

### 5.3 注册插件

在 `AppDelegate` 或 Capacitor 的插件注册处把插件暴露给前端。多数 Capacitor 项目可直接通过 `registerPlugin()` 调用；如果是自定义原生桥接，则按你的工程结构注册。

前端调用示例：

```ts
import { registerPlugin } from '@capacitor/core';

const CameraPermission = registerPlugin<{
  check(): Promise<{ granted: boolean; canAskAgain: boolean; status: string }>;
  request(): Promise<{ granted: boolean; canAskAgain: boolean; status: string }>;
  openSettings(): Promise<void>;
}>('CameraPermission');

const status = await CameraPermission.check();
if (!status.granted) {
  const next = await CameraPermission.request();
  if (!next.granted) {
    await CameraPermission.openSettings();
  }
}
```

---

## 6. WebView / InAppBrowser 的关键坑

如果你在 iOS 的 `WKWebView` 或 `cordova-plugin-inappbrowser` 里跑 `getUserMedia`，还需要补一个关键能力：

- `WKUIDelegate` 的 `requestMediaCapturePermissionFor`。

### 最小补丁示意

```objc
- (void)webView:(WKWebView *)webView
requestMediaCapturePermissionFor:(WKFrameInfo *)frame
         initiatedByFrame:(WKFrameInfo *)initiatedByFrame
                     type:(WKMediaCaptureType)type
         decisionHandler:(void (^)(WKPermissionDecision))decisionHandler {
    decisionHandler(WKPermissionDecisionGrant);
}
```

> 否则即使系统摄像头权限已授予，WebView 内的 `getUserMedia` 也可能静默失败。

---

## 7. 常见状态处理建议

### 状态建议

| 状态 | 含义 | 建议 |
| --- | --- | --- |
| `notDetermined` | 还没请求过 | 调 `request()` |
| `authorized` | 已授权 | 直接使用 |
| `denied` | 用户拒绝 | 引导去设置页 |
| `restricted` | 系统限制/家长控制 | 提示不可用 |
| `limited` | 部分权限（如相册） | 提供继续扩展入口 |

### 体验建议

- 不要在 App 启动时把所有权限一次性弹完。
- 尽量在用户触发具体功能时再申请。
- 权限被拒绝后，给一个明确的“去设置开启”按钮。

---

## 8. 和你项目的关系

你前面做的 `capa-demo` 已经验证过：

- iOS 不能只靠配置，`Info.plist` 必须写用途说明；
- WebView 里的摄像头权限还要补 `requestMediaCapturePermissionFor`；
- 如果是局域网访问本地开发服务，要处理 ATS / Local Networking；
- Android 和 iOS 的权限策略在“系统授权 + WebView 授权”两层上是不同的。

---

## 9. 落地检查清单

```text
□ 这个能力是否需要在 Info.plist 里声明用途？
□ 首次使用时系统是否会自动弹窗？
□ 是否需要自己写 check/request/openSettings？
□ WebView / InAppBrowser 是否还缺一层授权代理？
□ 拒绝后是否直接引导去系统设置？
□ 真机和模拟器的 localhost / ATS 是否区分处理？
```
