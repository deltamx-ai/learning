# Android 权限管理：常用权限、特殊权限与 Capacitor 最小实现

> 日期：2026-08-19
> 场景：Capacitor + Android（含 WebView / InAppBrowser / getUserMedia / 原生能力）
> 目的：整理 Android 常见权限申请表，并给出最小可用的权限配置与 Capacitor 插件代码

---

## 1. 权限分类速览

Android 的权限大致分三类：

1. **普通权限（Normal）**：只要在 `AndroidManifest.xml` 声明即可，安装时自动授予。
2. **运行时危险权限（Dangerous / Runtime）**：除了声明，还要在运行时向用户申请。
3. **特殊权限（Special / App-op / System-level）**：通常不能直接走标准运行时弹窗，要跳系统设置页或走系统专用流程。

---

## 2. 常见权限表

### 2.1 普通权限（声明即可）

| 权限 | 用途 | 申请方式 | 备注 |
| --- | --- | --- | --- |
| `INTERNET` | 网络访问 | Manifest 声明 | WebView / API 请求最常见 |
| `ACCESS_NETWORK_STATE` | 查询网络状态 | Manifest 声明 | 判断是否联网 |
| `FOREGROUND_SERVICE` | 前台服务 | Manifest 声明 + 运行时配合 | Android 9+ 常见 |
| `POST_NOTIFICATIONS`* | 通知 | Android 13+ 运行时申请 | 表面上像普通权限，但 API 33+ 需运行时请求 |

> `POST_NOTIFICATIONS` 在 Android 13+ 需要运行时申请，属于“看起来像普通、实际要 runtime”的常见坑。

### 2.2 运行时危险权限（必须动态申请）

| 权限 | 用途 | 典型场景 | 申请方式 | 备注 |
| --- | --- | --- | --- | --- |
| `CAMERA` | 摄像头 | 相机、扫码、getUserMedia | Manifest + 运行时 | Android 6+ 必须 runtime |
| `RECORD_AUDIO` | 麦克风 | 录音、视频通话、getUserMedia | Manifest + 运行时 | 常与 CAMERA 一起申请 |
| `ACCESS_FINE_LOCATION` | 精确定位 | 地图、打卡、附近功能 | Manifest + 运行时 | 精度更高 |
| `ACCESS_COARSE_LOCATION` | 粗略定位 | 大致位置 | Manifest + 运行时 | 可与精确定位组合 |
| `READ_MEDIA_IMAGES` | 读照片 | 相册选择 | Manifest + 运行时 | Android 13+ 替代旧存储权限 |
| `READ_MEDIA_VIDEO` | 读视频 | 视频选择 | Manifest + 运行时 | Android 13+ |
| `READ_MEDIA_AUDIO` | 读音频 | 音频文件 | Manifest + 运行时 | Android 13+ |
| `READ_CONTACTS` | 读联系人 | 通讯录导入 | Manifest + 运行时 | |
| `POST_NOTIFICATIONS` | 通知 | 推送/本地通知 | Manifest + 运行时 | Android 13+ 重点 |

### 2.3 特殊权限（系统设置/额外流程）

| 权限 | 用途 | 申请方式 | 备注 |
| --- | --- | --- | --- |
| `SYSTEM_ALERT_WINDOW` | 悬浮窗 | 跳系统设置页 | 不是普通弹窗 |
| `MANAGE_EXTERNAL_STORAGE` | 全文件访问 | 跳系统设置页 | Google Play 审核严格 |
| `REQUEST_INSTALL_PACKAGES` | 安装未知应用 | Manifest + 系统设置 | 常用于 APK 安装器 |
| `IGNORE_BATTERY_OPTIMIZATIONS` | 忽略电池优化 | 跳系统设置页 | 后台保活相关 |
| `BIND_ACCESSIBILITY_SERVICE` | 无障碍服务 | 系统设置页 | 极敏感 |
| `USE_FULL_SCREEN_INTENT` | 全屏通知 | 部分设备/版本受限 | 通知类特殊能力 |

---

## 3. Capacitor 最小权限配置

下面给一个最小且常见的 Android 配置骨架。

### 3.1 `AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <!-- 没有摄像头的设备也允许安装 -->
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.front" android:required="false" />

    <application
        android:networkSecurityConfig="@xml/network_security_config"
        android:usesCleartextTraffic="false"
        android:label="@string/app_name">
        ...
    </application>
</manifest>
```

### 3.2 只放行 localhost 的明文 HTTP

```xml
<!-- android/app/src/main/res/xml/network_security_config.xml -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>
</network-security-config>
```

> 这比 `android:usesCleartextTraffic="true"` 更安全，只允许 loopback 明文。

---

## 4. 运行时权限请求的最小代码

### 4.1 `MainActivity` 里直接申请（最小实现）

```java
package com.example.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String[] REQUIRED_PERMISSIONS = {
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.POST_NOTIFICATIONS,
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestMissingPermissions();
    }

    private void requestMissingPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }

        boolean missing = false;
        for (String permission : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, permission)
                    != PackageManager.PERMISSION_GRANTED) {
                missing = true;
                break;
            }
        }

        if (missing) {
            ActivityCompat.requestPermissions(this, REQUIRED_PERMISSIONS, 1001);
        }
    }
}
```

### 4.2 适合的时机

- **启动就要权限**：像摄像头首页就必须用，可在 `onCreate` / `onStart` 请求。
- **按需权限**：更推荐在用户点击功能按钮时再请求，体验更好。
- **永久拒绝**：如果用户在设置里关闭了权限，继续弹请求通常不会成功，应引导去系统设置页。

---

## 5. 最小 Capacitor 插件：按需申请权限

下面是一个最小插件骨架，用来把“检查 / 请求 / 打开系统设置”封装成 Capacitor API。

### 5.1 Java 插件代码

```java
package com.example.app.plugins;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;

@CapacitorPlugin(name = "AppPermission")
public class AppPermissionPlugin extends Plugin {
    private static final String[] REQUIRED = {
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.POST_NOTIFICATIONS,
    };

    private static final int REQUEST_CODE = 2001;
    private PluginCall pendingCall;

    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (hasAllPermissions()) {
            call.resolve(buildStatus());
            return;
        }

        if (!canAskAgain()) {
            call.resolve(buildStatus());
            return;
        }

        pendingCall = call;
        ActivityCompat.requestPermissions(getActivity(), REQUIRED, REQUEST_CODE);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private boolean hasAllPermissions() {
        for (String permission : REQUIRED) {
            if (ContextCompat.checkSelfPermission(getContext(), permission)
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private boolean canAskAgain() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        for (String permission : REQUIRED) {
            boolean granted = ContextCompat.checkSelfPermission(getContext(), permission)
                    == PackageManager.PERMISSION_GRANTED;
            if (!granted && !ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), permission)) {
                return false;
            }
        }
        return true;
    }

    private JSObject buildStatus() {
        JSObject ret = new JSObject();
        ret.put("granted", hasAllPermissions());
        ret.put("canAskAgain", canAskAgain());
        return ret;
    }
}
```

### 5.2 处理权限回调

```java
@Override
public void handleRequestPermissionsResult(int requestCode,
        String[] permissions,
        int[] grantResults) {
    super.handleRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != 2001 || pendingCall == null) {
        return;
    }

    if (hasAllPermissions()) {
        pendingCall.resolve(buildStatus());
    } else {
        pendingCall.resolve(buildStatus());
    }

    pendingCall = null;
}
```

> 注意：Capacitor 8 用的是 `handleRequestPermissionsResult(...)`，不是旧名字。

### 5.3 注册插件

```java
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPermissionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

### 5.4 前端调用

```ts
import { registerPlugin } from '@capacitor/core';

const AppPermission = registerPlugin<{
  check(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  request(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  openSettings(): Promise<void>;
}>('AppPermission');

const status = await AppPermission.check();
if (!status.granted) {
  const next = await AppPermission.request();
  if (!next.granted && !next.canAskAgain) {
    await AppPermission.openSettings();
  }
}
```

---

## 6. 设计建议：什么时候申请、怎么申请

### 推荐策略

| 场景 | 策略 |
| --- | --- |
| App 一进来就必须用摄像头 | 启动时请求 |
| 只有用户点功能时才需要 | 用户触发时再请求 |
| 用户拒绝过一次 | 先解释用途，再请求 |
| 系统已永久拒绝 | 直接引导去设置页 |

### 不推荐

- 一进 App 就把所有权限一次性全申请。
- 永久拒绝后反复 `requestPermissions()`。
- 在 WebView 里以为“网页会自己弹权限”，Android 系统权限不会自动给。

---

## 7. 这个文档和你项目的关系

你现在的 `capa-demo` 已经验证过：

- `CAMERA` / `RECORD_AUDIO` 必须 manifest + runtime 双层都做
- InAppBrowser 的 WebView 层可以自动放行，但系统层还得自己申请
- `localhost` 明文访问要用 `network_security_config.xml` 做局部放行

所以这份表可以作为：

- **Capacitor Android 权限清单**
- **原生插件最小模板**
- **后续补相机 / 麦克风 / 通知 / 定位时的参考基线**

---

## 8. 落地检查清单

```text
□ 这个权限属于普通 / 运行时 / 特殊 哪一类？
□ manifest 是否声明？
□ 运行时是否需要申请？
□ 用户拒绝后是否要引导到设置页？
□ 是否需要 Capacitor 插件封装？
□ WebView 层与系统层是否都处理了？
□ 清明文 HTTP 是否只放行 loopback？
```
