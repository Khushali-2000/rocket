# Build Services Once (Export, Import, Environments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The export, import and environment commands stop building infra repositories and services on every call (D-32, D-33, D-34). The composition root (`src-tauri/src/lib.rs`) builds them once and the commands read them from managed state.

**Architecture:** Three small changes, one per task. (1) One managed `Arc<CollectionExportService>` with all its ports. (2) One managed `ImportServiceFactory` that holds the shared active-workspace path and the moved `FsEnvFactory`. (3) One managed `EnvironmentServices` in `rocket-app` that hands out a collection-scoped or the global `EnvironmentService` and owns the collection-name check. Each repository is still scoped per collection or workspace at call time, so "once" means the wiring is built once, not that one repository serves every collection.

**Findings (2026-11-04) that change the roadmap text:**
- D-33 says to remove a second `SpecFetcher` implementation in `commands/import.rs`. The only one is `NoFetch` inside a `#[cfg(test)]` module (line 520). There is nothing to remove; that part of D-33 is dropped.
- `rocket-import` has its own `EnvironmentRepositoryFactory { make }`; `rocket-environment` has the real one `{ for_collection }`. Unifying them is D-54, not this plan. `FsEnvFactory` moves out of the command file but keeps implementing the import trait.
- The environment commands use `NullEventPublisher` for reads and `TauriEventBus` for writes. `EnvironmentService::list` and `get` publish nothing, so one managed service with the real bus changes no behavior.

**Tech Stack:** Rust, Tauri managed state, `tempfile`.

**Spec:** `docs/roadmaps/ddd-roadmap.md` (D-32 to D-34); `.claude/rules/tauri-ipc-boundaries.md`.

## Global Constraints

- Before each task: read `docs/superpowers/specs/opencollection-spec-reference.md` (collection and environment models are in scope).
- Cargo commands pass `-j4` and `-p <crate>`; the Tauri crate is `-p rocket`. No `--workspace`.
- No panicking unwrap of `Option` or `Result` in production paths; tests use `.expect("...")`. (The project hook blocks the literal call text in edits.)
- Command names and IPC DTOs do not change, so `src-tauri/app-commands.txt` is untouched.
- No commit inside the plan; one `refactor:` commit at the end, explicit paths, `dev-workflow-skills:1-git-commit`.

## Review Focus

- A workspace switch between two calls must still send the next call to the new workspace (the managed pieces hold the shared `Arc<Mutex<PathBuf>>`, never a copied path).
- A collection name with `..`, a leading `/` or `\`, or a NUL byte is still rejected with `InvalidInput("invalid collection name")` for every environment command, global ones excepted.
- Secret values in environments must still go through the same `env_secret_store()` as before (a repository built without it silently drops secrets).
- Events and audit records for save and delete keep the same publishers and actor (`AuditActor::User`).
- A poisoned workspace-path lock still maps to an error and not a panic.

---

### Task 1: One managed export service (D-34)

**Files:**
- Modify: `src-tauri/src/lib.rs` (build and manage `Arc<CollectionExportService>`), `src-tauri/src/commands/export.rs` (take the service from state)

**Interfaces:**
- Produces: managed state `Arc<rocket_app::collection_export_service::CollectionExportService>` built with `FsCollectionFileSource::new(active_workspace_path)`, `.with_collections(SharedPathCollectionRepo::new(..))` and `.with_environments(SharedCollectionEnvironmentRepo::with_secret_store(.., env_secret_store()))`.
- Consumes: the existing `export_bruno(&self, &str, bool)` and `export_postman(&self, &str, &PostmanExportOptions)`. Bruno export reads only the file source, so the extra ports change nothing for it.

- [ ] **Step 1: Build and manage the service in `lib.rs`**

Next to the other `app.manage(..)` calls, using the existing `active_workspace_path` Arc.

- [ ] **Step 2: Rewrite the two commands**

`export_collection_bruno` and `export_collection_postman` take `service: State<'_, Arc<CollectionExportService>>`, clone the Arc into the `run_export` closure and call the method. Drop the `FsCollectionFileSource`, `SharedCollectionEnvironmentRepo` and `SharedPathCollectionRepo` imports from the command file.

- [ ] **Step 3: Verify**

Run: `cargo check -j4 -p rocket`, `cargo test -j4 -p rocket export`, `cargo test -j4 -p rocket-app collection_export`.
Expected: pass, and `grep -n "rocket_infra" src-tauri/src/commands/export.rs` has no hits.

---

### Task 2: One managed import factory (D-33)

**Files:**
- Create: `src-tauri/src/import_wiring.rs` (`ImportServiceFactory`, `FsEnvFactory`)
- Modify: `src-tauri/src/lib.rs` (module, manage), `src-tauri/src/commands/import.rs` (use the factory, remove `FsEnvFactory` and `make_import_service`)

**Interfaces:**
- Produces: `pub struct ImportServiceFactory { active_workspace_path: Arc<Mutex<PathBuf>> }` with `pub fn new(Arc<Mutex<PathBuf>>) -> Self`, `pub fn workspace_path(&self) -> Result<PathBuf, String>` (the poisoned-lock message stays `workspace path lock poisoned`) and `pub fn service(&self) -> Result<ImportService, String>`. `FsEnvFactory(PathBuf)` moves here unchanged.
- Consumes: `ImportService::new(base, Box<dyn CollectionRepository>, Box<dyn rocket_import::EnvironmentRepositoryFactory>)`.

- [ ] **Step 1: Write the failing test `service_follows_the_shared_workspace_path`**

In `import_wiring.rs` tests: build the factory over `Arc<Mutex<PathBuf>>` pointing at a `TempDir` A, call `workspace_path()` and assert A, change the shared path to B, assert `workspace_path()` returns B. Add `poisoned_lock_is_an_error_not_a_panic` (poison the mutex in a thread, expect `Err("workspace path lock poisoned")`).

- [ ] **Step 2: Implement the factory and move `FsEnvFactory`**

Then replace the repeated `workspace_path.lock().map_err(..).clone()` plus `make_import_service(base)` blocks in `commands/import.rs` with `factory.service()?` (and `factory.workspace_path()?` where `base` is still needed for the sync service).

- [ ] **Step 3: Verify**

Run: `cargo test -j4 -p rocket import_wiring`, `cargo check -j4 -p rocket`, `cargo test -j4 -p rocket import`.
Expected: pass; `grep -n "FsEnvFactory\|make_import_service" src-tauri/src/commands/import.rs` has no hits.

---

### Task 3: One managed `EnvironmentServices` with the name check in rocket-app (D-32)

**Files:**
- Create: `crates/rocket-app/src/environment_services.rs`
- Modify: `crates/rocket-app/src/lib.rs` (export), `src-tauri/src/lib.rs` (build and manage), `src-tauri/src/commands/environments.rs` (use it)
- Test: in `environment_services.rs`

**Interfaces:**
- Produces:
  - `pub struct EnvironmentServices` built with `EnvironmentServices::new(collections: Arc<dyn EnvironmentRepositoryFactory>, global: Arc<dyn EnvironmentRepositoryFactory>-like, events: Arc<dyn EventPublisher>, audit: Arc<dyn SecurityAuditPublisher>)`. The global repo comes from a closure or small trait object `Arc<dyn Fn() -> Box<dyn EnvironmentRepository> + Send + Sync>` (pick the simpler one when writing the code; the existing `SharedPathEnvironmentRepo` in `rocket-infra` is already workspace-aware).
  - `pub fn for_collection(&self, collection: &str) -> DomainResult<EnvironmentService>` that rejects an invalid name with `DomainError::InvalidInput("invalid collection name")`.
  - `pub fn global(&self) -> EnvironmentService`.
  - `pub fn is_valid_collection_name(name: &str) -> bool` (NUL byte, leading `/` or `\`, or a `..` path component make it invalid), moved from `env_service_for`.
- Both services use `AuditActor::User` as today.
- Needs: an `EventPublisher` implementation for `Arc<dyn EventPublisher>` or a small adapter, because `EnvironmentService` owns a `Box<dyn EventPublisher>`.

- [ ] **Step 1: Write the failing tests**

`for_collection_rejects_traversal_names` (`..`, `a/../b`, `/abs`, `\\win`, a NUL byte), `for_collection_accepts_plain_and_nested_looking_names` (`My API`, `a.b`), `for_collection_uses_the_collection_repo` (a fake factory records the collection it was asked for), `save_publishes_through_the_shared_publisher` (a recording publisher sees one event after `save`), `global_does_not_ask_the_collection_factory`.

- [ ] **Step 2: Implement, export, run**

Run: `cargo test -j4 -p rocket-app environment_services`
Expected: FAIL first (missing type), then PASS.

- [ ] **Step 3: Wire it and thin the commands**

In `lib.rs` build it once with `SharedCollectionEnvironmentRepo::with_secret_store(active_workspace_path, env_secret_store())`, the workspace-level shared env repo, the `TauriEventBus` and the audit publisher already created for the old per-call path. In `environments.rs` delete `env_service_for` and `global_env_service`; each command becomes `services.for_collection(&collection)?.list()` and so on, and `FsEnvironmentRepo` leaves the file's imports.

- [ ] **Step 4: Verify**

Run: `cargo check -j4 -p rocket`, `cargo clippy -j4 -p rocket -p rocket-app`, `cargo test -j4 -p rocket environments`, `cargo test -j4 -p rocket-app environment`.
Expected: pass with no new warnings; `grep -n "FsEnvironmentRepo" src-tauri/src/commands/environments.rs` has no hits.

- [ ] **Step 5: Manual checks (record, cannot run headless)**

1. Create, edit and delete a collection environment and a global environment; the sidebar updates (events still arrive).
2. A secret variable keeps its value after saving the environment.
3. Switch workspace and open environments: the new workspace's environments show, not the old one's.
