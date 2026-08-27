# Capacitor Android / iOS 权限对照表

> 日期：2026-08-19
> 目的：把 Android 和 iOS 常见权限、申请方式、配置位置、特殊坑整理到一张对照表里，方便跨平台开发时快速查阅
> 适用场景：Capacitor / WebView / InAppBrowser / getUserMedia / 原生插件

---

## 1. 总体差异

| 维度 | Android | iOS |
| --- | --- | --- |
| 权限声明位置 | `AndroidManifest.xml` | `Info.plist` |
| 运行时申请 | 危险权限必须手写申请 | 多数权限首次使用由系统自动弹窗 |
| 被拒绝后的处理 | 可再次请求；永久拒绝要去设置页 | 通常直接引导设置页 |
| WebView 摄像头授权 | 插件通常可自动 grant | 常需补 `WKUIDelegate` 的 `requestMediaCapturePermissionFor` |
| 明文本地网络 | 需 `network_security_config.xml` 放行 loopback | 需 ATS / `NSAllowsLocalNetworking` 处理 |
| 本地开发调试 | 常配 `adb reverse` | 模拟器较简单；真机用局域网 IP |

---

## 2. 常见权限对照

| 能力 | Android 权限/配置 | Android 申请方式 | iOS 权限/配置 | iOS 申请方式 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 网络访问 | `INTERNET` | Manifest 声明 | 无显式权限 | 无 | iOS 走 ATS / 网络策略 |
| 网络状态 | `ACCESS_NETWORK_STATE` | Manifest 声明 | 无显式权限 | 无 | |
| 摄像头 | `CAMERA` + `uses-feature` | Manifest + 运行时请求 | `NSCameraUsageDescription` | 系统首次使用弹窗 | iOS WebView 可能还要补 `requestMediaCapturePermissionFor` |
| 麦克风 | `RECORD_AUDIO` | Manifest + 运行时请求 | `NSMicrophoneUsageDescription` | 系统首次使用弹窗 | 常与摄像头一起申请 |
| 相册/照片 | `READ_MEDIA_IMAGES` 等 | Manifest + 运行时请求 | `NSPhotoLibraryUsageDescription` | 系统首次使用弹窗 | iOS 可能出现 limited 模式 |
| 定位 | `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | Manifest + 运行时请求 | `NSLocationWhenInUseUsageDescription` / `NSLocationAlwaysAndWhenInUseUsageDescription` | 系统首次使用弹窗 | iOS “始终/使用期间”区分明显 |
| 通知 | `POST_NOTIFICATIONS`（API 33+） | Manifest + 运行时请求 | User Notifications | 请求通知授权 | iOS 通知通常通过系统授权接口 |
| 蓝牙 | `BLUETOOTH_CONNECT` 等 | Manifest + 运行时（视版本） | `NSBluetoothAlwaysUsageDescription` | 系统授权 | iOS 需要用途说明 |
| 本地网络 | `network_security_config.xml` | 配置放行 loopback | `NSAppTransportSecurity` / `NSAllowsLocalNetworking` | 配置放行局域网 | 调试本地服务常用 |
| 全文件访问 | `MANAGE_EXTERNAL_STORAGE` | 跳系统设置 | 无等价/受限很大 | 无 | Android 特殊权限 |
| 悬浮窗 | `SYSTEM_ALERT_WINDOW` | 跳系统设置 | 无等价 | 无 | Android 特殊权限 |
| 安装未知应用 | `REQUEST_INSTALL_PACKAGES` | 系统设置/安装器流程 | 无等价 | 无 | Android 特殊权限 |

---

## 3. Android 侧最小配置提醒

```xml
<!-- AndroidManifest.xml -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.front" android:required="false" />
```

```xml
<!-- network_security_config.xml -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>
</network-security-config>
```

```java
// MainActivity 最小运行时申请
ActivityCompat.requestPermissions(this, new String[] {
    Manifest.permission.CAMERA,
    Manifest.permission.RECORD_AUDIO,
    Manifest.permission.POST_NOTIFICATIONS,
}, 1001);
```

---

## 4. iOS 侧最小配置提醒

```xml
<!-- Info.plist -->
<key>NSCameraUsageDescription</key>
<string>需要使用摄像头进行姿态识别</string>
<key>NSMicrophoneUsageDescription</key>
<string>需要使用麦克风进行语音输入</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>需要访问相册以选择图片</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>需要定位以提供附近功能</string>
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
```

```objc
// WKUIDelegate 摄像头/麦克风授权（WebView 内 getUserMedia）
- (void)webView:(WKWebView *)webView
requestMediaCapturePermissionFor:(WKFrameInfo *)frame
         initiatedByFrame:(WKFrameInfo *)initiatedByFrame
                     type:(WKMediaCaptureType)type
         decisionHandler:(void (^)(WKPermissionDecision))decisionHandler {
    decisionHandler(WKPermissionDecisionGrant);
}
```

---

## 5. 权限状态建议

| 状态 | Android | iOS | 建议 |
| --- | --- | --- | --- |
| 未请求 | `未弹窗` | `notDetermined` | 触发请求 |
| 已授权 | `granted=true` | `authorized` | 直接使用 |
| 被拒绝 | 可再次请求 | 通常拒绝后引导设置页 | 展示设置入口 |
| 永久拒绝 | 设置里手动关闭 / 不再询问 | `denied` / `restricted` | 直接去设置页 |
| 限定权限 | 部分权限可用 | `limited`（如照片） | 给出扩展入口 |

---

## 6. 设计建议

1. **不要在启动时一次性申请所有权限**，优先按用户触发时申请。
2. **把系统权限和 WebView 权限分开看**：
   - Android：系统权限 + WebView 层通常都要确认；
   - iOS：Info.plist + 系统弹窗 + WKWebView 授权代理。
3. **拒绝后的主路径要通向设置页**，不要死循环弹窗。
4. **本地开发服务要区分平台处理**：Android 常用 `adb reverse`，iOS 模拟器和真机差异更大。

---

## 7. 和你项目的对应关系

- `capa-demo/docs/camera-permission.md`：Android 摄像头权限已验证。
- `capa-demo/docs/ios-camera-comparison.md`：iOS 侧差异和关键坑已记录。
- `android-permissions-capacitor.md` / `ios-permissions-capacitor.md`：分别是单平台详细版。
- 本文件：一张对照总表，方便横向查。

---

## 8. 快速速查口诀

```text
Android 看 Manifest + 运行时 + Settings
iOS 看 Info.plist + 首次弹窗 + WebView 授权代理
```
