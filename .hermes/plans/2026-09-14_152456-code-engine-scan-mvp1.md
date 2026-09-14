# Code Engine `scan` MVP1 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the first vertical slice of `code-engine scan`: given a Rust project path, scan `.rs` files, parse Rust syntax, extract symbols and basic relationships, build a minimal CodeGraph, save it to `.codegraph/graph.json`, and print a useful scan summary.

**Architecture:** Implement `scan` before `tree` because every later read command (`tree`, `symbols`, `calls`, `graph`, `stats`) must query the same saved CodeGraph instead of reparsing source independently. The implementation should separate CLI parsing, filesystem scanning, Rust parsing, symbol extraction, resolution, graph building, storage, and rendering of scan summaries.

**Tech Stack:** Rust CLI, `clap` for CLI parsing, `walkdir` for directory traversal, `ignore` or explicit filters for excludes, `syn` for Rust parsing, `serde`/`serde_json` for graph serialization, `anyhow` + `thiserror` for error handling, `tempfile` for tests, optional `insta` snapshots later.

---

## Current Context / Assumptions

- No `code-engine` project exists yet under `/home/delta/workspace/ai/`.
- Target project path: `/home/delta/workspace/ai/code-engine`.
- MVP1 language: Rust only.
- MVP1 output storage: `.codegraph/graph.json` under the scanned project root unless `--output` is specified.
- `scan` is the only command that builds/writes Graph in MVP1.
- `tree`, `symbols`, `calls`, `graph`, and `stats` will be read-only Graph query commands later.
- MVP1 should not attempt full Rust semantic correctness. Complex macros, cfg, generics, trait dispatch, proc macros, and cross-crate resolution can be marked as unresolved/unsupported.

---

## Dependency Plan

Add these dependencies in `Cargo.toml`:

```toml
[dependencies]
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
syn = { version = "2", features = ["full", "visit"] }
quote = "1"
proc-macro2 = { version = "1", features = ["span-locations"] }
walkdir = "2"
ignore = "0.4"
anyhow = "1"
thiserror = "2"
camino = { version = "1", features = ["serde1"] }
```

Dev/test dependencies:

```toml
[dev-dependencies]
tempfile = "3"
pretty_assertions = "1"
assert_cmd = "2"
predicates = "3"
```

Dependency rationale:

| Dependency | Why |
| --- | --- |
| `clap` | typed CLI arguments for `scan [path] --exclude --format --output` |
| `syn` | parse Rust files into AST; `full` allows item/expression traversal, `visit` supports visitors |
| `proc-macro2 span-locations` | line/column locations for symbols where available |
| `walkdir` / `ignore` | reliable recursive traversal and default ignore patterns |
| `serde_json` | save `.codegraph/graph.json` |
| `camino` | UTF-8 path types; easier serialization and cross-platform behavior |
| `anyhow` / `thiserror` | app-level context + domain errors |
| `tempfile` / `assert_cmd` | fixture-driven CLI tests |

---

## Target MVP1 `scan` CLI

First usable commands:

```bash
code-engine scan .
code-engine scan ./my-rust-project
code-engine scan . --exclude "examples/**"
code-engine scan . --format json
code-engine scan . --output .codegraph/graph.json
```

Supported arguments:

| Arg | MVP1 | Behavior |
| --- | --- | --- |
| `[path]` | required with default `.` | project root to scan |
| `--exclude <glob>` repeatable | yes | add extra exclude patterns |
| `--format text,json` | yes | scan summary output format |
| `--output <path>` | yes | graph output path, default `<project>/.codegraph/graph.json` |

Explicit non-goals:

```text
--watch
--incremental
--threads
--follow-symlinks
full .gitignore fidelity
cross-crate resolution
proc macro expansion
```

---

## Proposed Module Layout

Create:

```text
/home/delta/workspace/ai/code-engine/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── cli.rs
│   ├── scanner.rs
│   ├── rust_parser.rs
│   ├── symbol.rs
│   ├── resolver.rs
│   ├── graph.rs
│   ├── storage.rs
│   ├── summary.rs
│   └── errors.rs
└── tests/
    ├── fixtures/
    │   └── simple-rust-project/
    │       ├── Cargo.toml
    │       └── src/
    │           ├── main.rs
    │           └── user.rs
    └── scan_cli.rs
```

Module responsibilities:

| Module | Responsibility |
| --- | --- |
| `cli.rs` | clap command/args definitions |
| `scanner.rs` | enumerate Rust files under root with excludes and safety checks |
| `rust_parser.rs` | parse one Rust file with `syn` and collect AST facts |
| `symbol.rs` | define Symbol, SymbolId, SymbolKind, SourceLocation |
| `resolver.rs` | basic same-module and path-based resolution; unresolved warnings |
| `graph.rs` | Node/Edge/CodeGraph types and GraphBuilder |
| `storage.rs` | write/read `.codegraph/graph.json` |
| `summary.rs` | scan counters and text/json summary output |
| `errors.rs` | domain errors and warning types |

---

## Data Model MVP1

Use stable, JSON-serializable model:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeGraph {
    pub schema_version: u32,
    pub project_root: Utf8PathBuf,
    pub generated_at_ms: i64,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub warnings: Vec<GraphWarning>,
    pub summary: ScanSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub kind: NodeKind,
    pub name: String,
    pub qualified_name: String,
    pub location: SourceLocation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub source: NodeId,
    pub target: NodeId,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NodeKind {
    Project,
    Directory,
    File,
    Module,
    Struct,
    Enum,
    Trait,
    Function,
    Method,
    Impl,
    Field,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EdgeKind {
    Contains,
    Defines,
    Imports,
    Calls,
    Implements,
    UsesType,
}
```

`NodeId` recommendation for MVP1:

```text
node id = deterministic string from kind + qualified_name + file + line
```

Example:

```text
function:crate::user::create_user@src/user.rs:42
```

This is good enough for MVP1 and can be replaced by stronger SymbolId later.

---

## Task Plan

### Task 1: Bootstrap Rust CLI project

**Objective:** Create a new `code-engine` Rust CLI project with a runnable binary.

**Files:**
- Create: `/home/delta/workspace/ai/code-engine/Cargo.toml`
- Create: `/home/delta/workspace/ai/code-engine/src/main.rs`
- Create: `/home/delta/workspace/ai/code-engine/src/cli.rs`

**Steps:**
1. Run `cargo new code-engine --bin` under `/home/delta/workspace/ai`.
2. Add dependencies listed above.
3. Implement minimal `clap` parser with `scan` subcommand.
4. Implement `main()` that parses CLI and prints placeholder for `scan`.
5. Run `cargo test` and `cargo run -- scan .`.

**Expected verification:**

```text
cargo run -- scan .
# prints a placeholder like: scan not implemented yet: .
```

---

### Task 2: Define CLI arguments for `scan`

**Objective:** Make CLI shape final for MVP1.

**Files:**
- Modify: `src/cli.rs`
- Modify: `src/main.rs`
- Test: `tests/scan_cli.rs`

**Desired CLI structs:**

```rust
#[derive(Parser)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    Scan(ScanArgs),
}

#[derive(Args, Debug, Clone)]
pub struct ScanArgs {
    #[arg(default_value = ".")]
    pub path: Utf8PathBuf,

    #[arg(long = "exclude")]
    pub excludes: Vec<String>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    pub format: OutputFormat,

    #[arg(long)]
    pub output: Option<Utf8PathBuf>,
}
```

**Tests:**
- `code-engine scan` uses `.`.
- `code-engine scan ./fixtures --exclude examples/** --format json` parses correctly.
- invalid format fails.

---

### Task 3: Create fixture Rust project

**Objective:** Add a deterministic tiny Rust project used by unit/integration tests.

**Files:**
- Create: `tests/fixtures/simple-rust-project/Cargo.toml`
- Create: `tests/fixtures/simple-rust-project/src/main.rs`
- Create: `tests/fixtures/simple-rust-project/src/user.rs`

**Fixture source:**

```rust
// src/main.rs
mod user;

fn main() {
    run();
}

fn run() {
    user::create_user();
}
```

```rust
// src/user.rs
pub struct User {
    pub id: u64,
    pub name: String,
}

impl User {
    pub fn new(id: u64, name: String) -> Self {
        Self { id, name }
    }
}

pub fn create_user() -> User {
    User::new(1, "Ada".to_string())
}
```

**Expected eventual facts:**
- files: `src/main.rs`, `src/user.rs`
- functions: `main`, `run`, `create_user`
- struct: `User`
- method: `User::new`
- calls: `main -> run`, `run -> user::create_user`, `create_user -> User::new`

---

### Task 4: Implement scanner

**Objective:** Recursively find Rust source files safely.

**Files:**
- Create: `src/scanner.rs`
- Create: `src/errors.rs`
- Test: unit tests in `src/scanner.rs`

**API:**

```rust
pub struct ScanConfig {
    pub root: Utf8PathBuf,
    pub excludes: Vec<String>,
}

pub struct SourceFile {
    pub relative_path: Utf8PathBuf,
    pub absolute_path: Utf8PathBuf,
    pub bytes: u64,
}

pub fn scan_files(config: &ScanConfig) -> anyhow::Result<Vec<SourceFile>>;
```

**Behavior:**
- canonicalize root.
- reject root if it does not exist or is not a directory.
- scan only `.rs` files.
- exclude `.git`, `target`, `node_modules`, `dist`, `build`, `out`, `.codegraph` by default.
- do not follow symlinks in MVP1.
- return sorted files by relative path for deterministic output.

**Tests:**
- fixture returns exactly two `.rs` files.
- `target/foo.rs` is ignored.
- symlink is ignored or recorded as warning, but does not escape root.

---

### Task 5: Define graph and symbol model

**Objective:** Add serializable CodeGraph types.

**Files:**
- Create: `src/graph.rs`
- Create: `src/symbol.rs`
- Test: unit tests for serialization

**Requirements:**
- `CodeGraph` serializes to readable JSON.
- Node/edge kinds are stable strings via serde rename if desired.
- `SourceLocation` stores `relative_path`, `line`, `column`.
- `ScanSummary` counts files/nodes/edges/warnings.

**Verification:**
- Unit test builds a tiny graph and round-trips through `serde_json`.

---

### Task 6: Implement Rust parser item extraction

**Objective:** Parse Rust file with `syn` and extract top-level items.

**Files:**
- Create: `src/rust_parser.rs`
- Test: unit tests with inline Rust strings and fixture files

**API:**

```rust
pub struct ParsedFile {
    pub relative_path: Utf8PathBuf,
    pub items: Vec<ParsedItem>,
    pub warnings: Vec<GraphWarning>,
}

pub enum ParsedItem {
    Module { name: String, location: SourceLocation },
    Use { path: String, alias: Option<String>, location: SourceLocation },
    Struct { name: String, fields: Vec<ParsedField>, location: SourceLocation },
    Enum { name: String, location: SourceLocation },
    Trait { name: String, methods: Vec<ParsedFunction>, location: SourceLocation },
    Impl { target: String, trait_name: Option<String>, methods: Vec<ParsedFunction>, location: SourceLocation },
    Function(ParsedFunction),
}
```

**MVP extraction:**
- `Item::Mod`
- `Item::Use`
- `Item::Struct`
- `Item::Enum`
- `Item::Trait`
- `Item::Impl`
- `Item::Fn`

**Tests:**
- parses `struct User` with fields.
- parses `impl User { fn new(...) }`.
- parses top-level `fn run()`.
- invalid Rust returns warning/error without panicking.

---

### Task 7: Extract function calls inside functions/methods

**Objective:** Collect call expressions from function bodies.

**Files:**
- Modify: `src/rust_parser.rs`
- Test: parser unit tests

**Approach:**
Use `syn::visit::Visit` over each function body.

Handle:

```rust
foo();              // ExprCall with ExprPath
module::foo();      // ExprCall with ExprPath
obj.method();       // ExprMethodCall
Type::new();        // ExprCall with ExprPath
```

Represent unresolved call targets as strings first:

```rust
pub struct ParsedCall {
    pub raw: String,
    pub location: SourceLocation,
}
```

MVP does not need perfect target resolution. Parser only records syntactic call names.

**Tests:**
- `main() { run(); }` records `run`.
- `run() { user::create_user(); }` records `user::create_user`.
- `User::new(...)` records `User::new`.
- method call `client.send()` records `send` or `client.send` with `unresolved` status.

---

### Task 8: Build CodeGraph from parsed files

**Objective:** Convert scanned/parsed facts into nodes and edges.

**Files:**
- Modify: `src/graph.rs`
- Create: `src/resolver.rs`
- Test: graph builder tests

**Graph building phases:**
1. Create Project node.
2. Create File nodes for each source file.
3. Add `Contains(Project, File)`.
4. Create symbol nodes for functions, structs, enums, traits, impls, methods, fields.
5. Add `Defines(File, Symbol)`.
6. Add structural edges: `Contains(Struct, Field)`, `Contains(Impl, Method)`.
7. Build simple name index: `name -> NodeId`, `qualified_name -> NodeId`.
8. Resolve parsed calls into `Calls` edges if possible.
9. Add unresolved warnings when target cannot be resolved.

**MVP resolution rules:**
- same-file top-level function name.
- `module::function` based on file/module name.
- `Type::method` if an impl target matches `Type`.
- unresolved otherwise.

**Tests:**
- fixture graph contains nodes for `main`, `run`, `User`, `User::new`, `create_user`.
- graph contains `Calls(main, run)`.
- graph contains `Calls(run, create_user)`.
- graph contains `Calls(create_user, User::new)` if rule implemented; otherwise warning accepted for early task and resolved in next task.

---

### Task 9: Implement graph storage

**Objective:** Save graph to `.codegraph/graph.json` atomically.

**Files:**
- Create: `src/storage.rs`
- Test: unit tests with `tempfile`

**API:**

```rust
pub fn default_graph_path(project_root: &Utf8Path) -> Utf8PathBuf;
pub fn write_graph(path: &Utf8Path, graph: &CodeGraph) -> anyhow::Result<()>;
pub fn read_graph(path: &Utf8Path) -> anyhow::Result<CodeGraph>;
```

**Behavior:**
- default output path: `<root>/.codegraph/graph.json`.
- create parent dir.
- write to temp file and rename for atomic-ish write.
- pretty JSON for human inspection.

**Tests:**
- write creates `.codegraph/graph.json`.
- read returns same graph.
- malformed JSON returns clear error.

---

### Task 10: Implement scan orchestration

**Objective:** Wire CLI → scanner → parser → graph builder → storage → summary.

**Files:**
- Modify: `src/main.rs`
- Create/modify: `src/summary.rs`
- Test: `tests/scan_cli.rs`

**Flow:**

```rust
fn run_scan(args: ScanArgs) -> anyhow::Result<()> {
    let files = scan_files(&config)?;
    let parsed = parse_files(&files)?;
    let graph = build_graph(root, files, parsed)?;
    write_graph(output_path, &graph)?;
    print_summary(&graph.summary, args.format);
    Ok(())
}
```

**Text summary should include:**
- project path
- Rust file count
- skipped file count if available
- node counts by kind
- edge counts by kind
- warning counts
- output path

**JSON summary:**
- stable machine-readable fields.

---

### Task 11: Add integration test for `code-engine scan`

**Objective:** Prove the command works end-to-end.

**Files:**
- Create/modify: `tests/scan_cli.rs`

**Test:**
Run binary against fixture:

```rust
Command::cargo_bin("code-engine")?
    .args(["scan", "tests/fixtures/simple-rust-project"])
    .assert()
    .success()
    .stdout(predicate::str::contains("Graph built"));
```

Then assert:

```text
tests/fixtures/simple-rust-project/.codegraph/graph.json exists
JSON contains nodes and edges
```

To avoid dirtying fixture permanently, either copy fixture into `tempfile` or pass `--output <tempdir>/graph.json`.

---

### Task 12: Add unresolved warning handling

**Objective:** Make incomplete analysis explicit and non-fatal.

**Files:**
- Modify: `src/graph.rs`
- Modify: `src/resolver.rs`
- Modify: `src/summary.rs`
- Test: resolver tests

**Warning model:**

```rust
pub enum WarningKind {
    UnresolvedCall,
    UnsupportedMacro,
    ParseError,
    SkippedFile,
}

pub struct GraphWarning {
    pub kind: WarningKind,
    pub message: String,
    pub location: Option<SourceLocation>,
}
```

**Behavior:**
- unsupported macro or unresolved call does not fail scan.
- parse error in one file records warning and continues if possible.
- fatal errors are only root path invalid, no read permissions for root, output write failure.

---

### Task 13: Add `--format json`

**Objective:** Make scan summary consumable by future UI/agents.

**Files:**
- Modify: `src/summary.rs`
- Test: CLI integration

**Behavior:**

```bash
code-engine scan . --format json
```

prints only JSON summary to stdout, not prose logs.

**Test:**
- stdout parses as JSON.
- contains `files.rust`, `nodes.Function`, `edges.Calls`, `warnings.total`, `output`.

---

### Task 14: Add `--exclude` support

**Objective:** Allow user to skip additional paths.

**Files:**
- Modify: `src/scanner.rs`
- Test: scanner unit tests

**Behavior:**
- repeatable `--exclude`.
- accept glob-like patterns.
- apply after default excludes.
- output summary should mention skipped count if tracked.

**Test:**
- create fixture with `examples/ignored.rs`.
- `scan --exclude examples/**` does not include it.

---

### Task 15: Final MVP1 `scan` verification pass

**Objective:** Validate that scan is ready before building tree.

**Commands:**

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo run -- scan tests/fixtures/simple-rust-project --output /tmp/codegraph.json
```

**Expected:**
- formatting passes.
- clippy passes.
- tests pass.
- `/tmp/codegraph.json` exists.
- JSON contains nodes for `main`, `run`, `User`, `User::new`, `create_user`.
- text summary shows file/node/edge counts.

---

## Implementation Notes: Syntax Analysis with `syn`

### Parser boundary

`syn` gives syntax, not full compiler semantics. That means:

```text
syn can tell:
  there is a function named foo
  there is a call expression foo()
  there is an impl User block
  there is a method new

syn cannot fully tell by itself:
  which imported crate a symbol resolves to
  macro-expanded code
  trait dynamic dispatch target
  generic monomorphized target
```

So MVP1 design must separate:

```text
Parser = syntactic facts
Resolver = best-effort semantic links
Graph = explicit resolved + unresolved facts
```

### Call extraction examples

Rust input:

```rust
fn run() {
    load_config();
    server::start();
    User::new(1);
    client.send();
}
```

Parser facts:

```text
Call raw=load_config
Call raw=server::start
Call raw=User::new
Call raw=send or client.send
```

Resolver output:

```text
load_config     -> resolved if known local function
server::start   -> resolved if module path known
User::new       -> resolved if impl User method known
client.send     -> unresolved in MVP1 unless receiver type known
```

Do not hide unresolved calls. Record warning and continue.

---

## When to Start `tree`

Start `tree` only after `scan` can produce a stable `.codegraph/graph.json` with:

```text
Project/File nodes
Function/Struct/Impl/Method nodes
Contains/Defines edges
some Calls edges
stable JSON schema
summary counts
unresolved warnings
```

Then `tree` becomes simple:

```text
read graph.json
query Contains/Defines edges
render directory + symbol hierarchy
```

This confirms the architecture principle:

```text
scan builds once; tree queries only.
```

---

## Risks / Tradeoffs

| Risk | Mitigation |
| --- | --- |
| Resolver becomes too ambitious | MVP1 only handles local/simple path cases; unresolved is acceptable |
| Macros hide important code | Record unsupported macro warning; do not expand macros in MVP1 |
| Graph schema changes often | Add `schema_version`; keep first schema small |
| Tests dirty fixture directories | Use `--output` to temp path or copy fixture to tempdir |
| Too many CLI flags | Keep only `[path]`, `--exclude`, `--format`, `--output` |
| tree starts reparsing source | Enforce tests later: tree reads graph only |

---

## Acceptance Criteria

`scan` MVP1 is done when:

```text
□ `code-engine scan .` runs on a small Rust project
□ `.codegraph/graph.json` is written
□ JSON has deterministic nodes/edges/warnings/summary
□ file scanner excludes `.git`, `target`, `node_modules`, `.codegraph`
□ parser recognizes mod/use/struct/enum/trait/impl/fn/method/field/call
□ resolver creates basic local Calls edges
□ unresolved/unsupported cases are warnings, not crashes
□ text summary is useful
□ `--format json` produces parseable summary JSON
□ `--output` writes to custom path
□ tests cover scanner, parser, graph serialization, resolver, CLI scan
□ `cargo fmt`, `cargo clippy`, `cargo test` pass
```
