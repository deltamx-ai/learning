# Chromium Mojo 底层源码导读

> 日期：2026-08-19
> 目的：配合 electron-ipc-internals.md 阅读真实源码
> 源码：learning/mojo-src/（从 Chromium main 分支拉取）

## 文件清单

- channel_posix.cc  ← Unix socket 传输层（SCM_RIGHTS 句柄传递）
- message.h         ← Mojo 消息结构（数据 + 句柄）
- data_pipe_impl.h  ← 数据管道（共享内存零拷贝）

## 核心代码位置速查

| 概念 | 文件 | 位置 | 做了什么 |
| --- | --- | --- | --- |
| socketpair 引导通道 | channel_posix.cc | :127 | TakeFD() 取 socket 一端 |
| SCM_RIGHTS 句柄传递 | channel_posix.cc | :387 | SendmsgWithHandles(socket, iov, 1, fds) |
| 句柄跟随消息 | channel_posix.cc | :310 | SocketRecvmsg 同时收 incoming_fds |
| 消息 = 数据 + 句柄 | message.h | :37 | Message owns its data and handles |
| 端口是 ScopedHandle | message.h | :231 | vector<ScopedHandle>* handles() |
| 大消息共享内存 | data_pipe_impl.h | :91 | BeginWriteData 给共享缓冲区指针 |
| 零拷贝 | data_pipe_impl.h | :118 | 直接写管道缓冲区，无中间拷贝 |
| fd 生命周期管理 | channel_posix.cc | :406 | 发送失败把 fd 拉回来重试 |

## 一句话总结

Mojo 底层 = 三样东西拼起来：
1. Channel：Unix socket 收发机（数据+句柄一起收发）
2. Message：信封（payload 序列化数据 + handles 句柄列表）
3. DataPipe：共享内存高速路（大数据零拷贝）

Electron IPC 在这上面跑：
  invoke = Message 走 Channel
  大对象 = DataPipe 共享内存
  传端口 = Message 带 handles 走 SCM_RIGHTS
