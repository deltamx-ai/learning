# CodeGraph 命令职责：`scan` 与查询命令的分工

> 日期：2026-09-14
> 项目：code-engine / CodeGraph MVP
> 目的：明确 `scan`、`tree`、`symbols`、`calls`、`callers`、`graph`、`stats` 的职责边界，避免每个命令重复扫描和解析源码。

---

## 1. 核心结论

`scan` 和其他命令的关系是：

```text
scan 做“底层数据建设”
tree / symbols / calls / callers / graph / stats 做“查询和展示”
```

也就是说：

```text
scan 必须先把后续命令需要的数据准备好；
后续命令只读取 scan 生成的 CodeGraph。
```

它们不是都在“实现 scan”，而是：

```text
scan = 建图 / 建索引
其他命令 = 查图 / 展示视图
```

---

## 2. 最核心的分工

```text
code-engine scan .
  ↓
读取源码
解析 AST
提取符号
解析调用
建立 CodeGraph
保存 .codegraph/graph.json
```

然后：

```text
code-engine tree
code-engine symbols User
code-engine calls main
code-engine calls create_user --direction callers
code-engine graph main --format mermaid
code-engine stats
```

这些命令都只是：

```text
读取 .codegraph/graph.json
查询 nodes / edges / warnings / summary
格式化输出
```

它们不应该：

```text
❌ 重新扫描源码
❌ 重新解析 Rust AST
❌ 重新构建 CodeGraph
❌ 各自实现一套 parser / resolver
```

---

## 3. `scan` 要为哪些命令准备数据

### 3.1 `tree` 需要什么

`tree` 需要展示项目/代码结构，所以它需要：

```text
Project / Directory / File / Module / Struct / Impl / Function / Method 节点
Contains / Defines 边
```

因此 `scan` 必须构建：

```text
Project
  Contains → Directory
  Contains → File
  Defines  → Function / Struct / Impl / Method
```

例如：

```text
src/user.rs
  Defines → struct User
  Defines → impl User
  Defines → fn create_user

impl User
  Contains → method new
```

`tree` 自己不解析源码，只查询这些结构关系。

---

### 3.2 `symbols` 需要什么

`symbols User` 需要查符号，所以它需要：

```text
所有符号节点
符号名
qualified_name
kind
location
字段 / 方法 / 引用关系
```

因此 `scan` 必须提取：

```text
Struct User
Function create_user
Method User::new
Trait xxx
Enum xxx
Field id/name
```

并且形成可查询的数据：

```text
name -> NodeId[]
qualified_name -> NodeId
kind -> NodeId[]
```

这个 index 可以先不单独存储，也可以由 `symbols` 命令读取 nodes 后临时构建。

---

### 3.3 `calls` 需要什么

`calls main` 需要查看从某个函数调用出去的函数，所以它需要：

```text
main Calls run
run Calls create_user
create_user Calls User::new
```

因此 `scan` 必须：

1. 在 parser 阶段提取函数体里的调用表达式；
2. 在 resolver 阶段尽量把调用目标解析到某个 `NodeId`；
3. 在 graph 阶段写入 `Calls` 边。

如果解析不了，也不能假装解析成功。

例如：

```rust
client.send()
```

如果 MVP1 不知道 `client` 的类型，就应该记录：

```text
UnresolvedCall: client.send at src/foo.rs:42
```

---

### 3.4 `callers` 需要什么

`callers create_user` 和 `calls` 用的是同一批 `Calls` 边，只是查询方向相反。

```text
calls main:
  从 main 沿 Calls 边往外走

callers create_user:
  从 create_user 沿 Calls 边反向找谁指向它
```

所以：

```text
callers 不需要 scan 额外做一套数据；
它复用 Calls edges，只是反向查询。
```

MVP1 可以先不单独拆 `callers` 命令，而是使用：

```bash
code-engine calls create_user --direction callers
```

后面如果使用体验需要，再加糖：

```bash
code-engine callers create_user
```

本质仍然是同一个查询。

---

### 3.5 `graph` 需要什么

`graph main --format mermaid` 需要输出一个子图，所以它需要：

```text
nodes + edges
```

`scan` 必须保存完整的 Graph，而不只是统计摘要。

`graph` 命令做的是：

```text
读取 graph.json
找到 main 节点
沿 Calls / Depends / UsesType 等边取子图
渲染成 Mermaid / JSON / DOT
```

MVP1 先做调用图即可：

```bash
code-engine graph main --format mermaid
```

内部使用 `Calls` 边输出 Mermaid。

---

### 3.6 `stats` 需要什么

`stats` 需要统计信息：

```text
文件数
符号数
边数
未解析数量
```

它可以直接从 `graph.json` 计算：

```text
nodes 按 kind 分组统计
edges 按 kind 分组统计
warnings 按 kind 分组统计
```

也可以使用 `scan` 时保存的一份 summary：

```json
{
  "summary": {
    "files": 42,
    "nodes": {
      "Function": 95,
      "Struct": 34
    },
    "edges": {
      "Calls": 438
    },
    "warnings": {
      "UnresolvedCall": 37
    }
  }
}
```

---

## 4. `scan` 到底要做多深

MVP1 的 `scan` 至少要做到三层。

### 4.1 第一层：结构层

支撑命令：

```text
tree
stats
```

需要构建：

```text
File
Module
Struct
Enum
Trait
Impl
Function
Method
Field
Contains
Defines
```

---

### 4.2 第二层：符号层

支撑命令：

```text
symbols
```

需要构建：

```text
name
qualified_name
kind
location
fields
methods
```

---

### 4.3 第三层：关系层

支撑命令：

```text
calls
callers
graph
```

需要构建：

```text
Imports
Calls
Implements
UsesType
```

MVP1 关系层可以不完美，但一定要显式标记 unresolved。

---

## 5. 命令职责表

| 命令 | 是否扫描源码 | 是否解析 AST | 是否构建 Graph | 是否读取 Graph | 职责 |
| --- | --- | --- | --- | --- | --- |
| `scan` | ✅ | ✅ | ✅ | 可选 | 构建 / 刷新 CodeGraph |
| `tree` | ❌ | ❌ | ❌ | ✅ | 展示项目/代码结构 |
| `symbols` | ❌ | ❌ | ❌ | ✅ | 查符号 |
| `calls` | ❌ | ❌ | ❌ | ✅ | 查调用出去的函数 |
| `callers` | ❌ | ❌ | ❌ | ✅ | 查谁调用了我 |
| `graph` | ❌ | ❌ | ❌ | ✅ | 输出子图 / Mermaid |
| `stats` | ❌ | ❌ | ❌ | ✅ | 统计 nodes / edges / warnings |

一句话：

```text
除了 scan，其他命令都不碰源码，只碰 graph.json。
```

---

## 6. `scan` 是索引构建管线

可以把 `scan` 理解为：

```text
scan = index pipeline
```

内部包含：

```text
Scanner
Parser
Symbol Builder
Resolver
Graph Builder
Storage
```

而用户命令是：

```text
Query Commands
```

包括：

```text
tree
symbols
calls
callers
graph
stats
```

它们类似数据库查询：

```text
scan     = 建库 / 建索引
tree     = SELECT structure
symbols  = SELECT symbol WHERE name = ?
calls    = SELECT edges WHERE source = ?
callers  = SELECT edges WHERE target = ?
graph    = SELECT subgraph
stats    = GROUP BY kind
```

---

## 7. 推荐实现顺序

不一定要等 `scan` 一口气支持所有命令后才写查询命令。更好的方式是分版本推进。

```text
第一阶段：scan-v1 + tree/stats
  1. 扫文件
  2. 解析 top-level items
  3. 建 File / Struct / Function / Impl / Method
  4. 保存 graph.json
  5. stats 能读 counts
  6. tree 能输出结构

第二阶段：scan-v2 + symbols
  7. 增加 qualified_name
  8. 增加 SymbolId
  9. symbols 能查 name/kind/location

第三阶段：scan-v3 + calls/graph
  10. 提取函数体 call expr
  11. 基础 resolver
  12. Calls edges
  13. calls main 能输出调用树
  14. graph --format mermaid 输出调用图

第四阶段：scan-v4 + callers
  15. 复用 Calls edges 做反向查询
```

架构原则始终不变：

```text
scan 负责建图；
其他命令负责查图。
```

---

## 8. 最容易犯的错误

错误做法：

```text
❌ tree 自己重新 scan
❌ symbols 自己重新 parse
❌ calls 自己重新解析函数体
❌ graph 自己重新遍历源码
❌ 每个命令都有一套 parser
```

后果：

```text
代码重复
结果不一致
性能差
后面没法做增量
没法做统一 AI Context
```

正确做法：

```text
所有命令共享：
  .codegraph/graph.json
  GraphRepository
  QueryService
```

---

## 9. 最终结论

```text
calls / callers / symbols / tree / graph / stats 这些命令需要的数据，
都应该由 scan 构建出来。

但这些命令本身不是 scan 的一部分；
它们是 scan 之后的 Graph 查询视图。
```

最佳实现顺序：

```text
scan-v1 → tree/stats
scan-v2 → symbols
scan-v3 → calls/graph
scan-v4 → callers
```

核心原则：

```text
scan 是唯一写 Graph 的命令；
其他命令只读 Graph，不重新解析源码。
```
