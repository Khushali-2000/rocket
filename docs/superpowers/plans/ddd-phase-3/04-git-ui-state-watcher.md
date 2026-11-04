# Git Identity, UI State And File Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four commands stop doing infrastructure work themselves: the git identity and SSH key commands (D-38), `load_ui_state` and `save_ui_state` (D-39), and the workspace file-watcher restart (D-39).

**Architecture:** (1) `GitService` gains `identity`, `set_identity`, `ssh_key_paths` and `default_ssh_key_path`; `Git2Service` implements them; `GitAppService` passes them through; the commands call it. (2) A `UiStateRepository` port in `rocket-workspace` with `FsUiStateRepo` in `rocket-infra`; the persisted file keeps its current key names. (3) A `FileWatcher` port in `rocket-workspace` implemented by `NotifyFileWatcher`, and a `WorkspaceWatcher` service in `rocket-app` that restarts the watcher and publishes the failure event.

**Findings (2026-11-04):**
- D-3A is dropped. `HttpExecutor` is implemented in `src-tauri/src/mcp/tool_server.rs` only by `FakeHttpExecutor` at line 1363, inside `#[cfg(test)] mod tests` (starts at line 1271). The same is true of every `rocket_infra` use in that file (first hit at line 1353). Production code there builds no HTTP client and uses no infra type.
- `UiState` is one struct that serves as the IPC payload and as the persisted YAML (camelCase keys). The rule "camelCase on IPC DTOs only" is broken. The on-disk file already uses camelCase, so the persisted struct keeps those key names for compatibility (ruling below).
- `git_get_identity` and `git_set_identity` are plain functions behind the `_v2` commands, with their own tests in `commands/git.rs`.
- The startup code in `lib.rs` repeats the watcher start and failure-event logic of `restart_watcher`.

**Rulings (2026-11-04):**
- The persisted UI-state struct in `rocket-infra` keeps camelCase keys because existing `ui-state.yml` files use them; the domain `UiState` has no serde derives. Cost if wrong: a one-time migration of the file.
- Creating the collections folder moves into `NotifyFileWatcher::start`, so the service does not need a directory port. A failed create is an `Err` from `start`, which the service reports with the same `FileWatcherFailed` event as before.

**Tech Stack:** Rust, `git2`, `notify`, `serde_yaml`, `tempfile`.

**Spec:** `docs/roadmaps/ddd-roadmap.md` (D-38, D-39, D-3A); `.claude/rules/tauri-ipc-boundaries.md`.

## Global Constraints

- Before each task: read `docs/superpowers/specs/opencollection-spec-reference.md`.
- Cargo commands pass `-j4` and `-p <crate>`; the Tauri crate is `-p rocket`. No `--workspace`.
- No panicking unwrap of `Option` or `Result` in production paths; tests use `.expect("...")`.
- Never shell out to the `git` CLI. Command names and IPC DTOs do not change.
- Do not write to the user's `~/.gitconfig`: `set_identity` writes the repository-local config only.
- No commit inside the plan; one `refactor:` commit at the end, explicit paths, `dev-workflow-skills:1-git-commit`.

## Review Focus

- `identity` returns empty strings, not an error, when `user.name` or `user.email` is unset; `set_identity` never touches the global config (test with a throwaway `HOME`-independent repo and read back the local config).
- `ssh_key_paths` returns standard key names first in the order `id_ed25519`, `id_rsa`, `id_ecdsa`, `id_dsa`, then custom names alphabetically; a file counts as a key only when its `.pub` file exists; `known_hosts`, `config`, dot files and `.pub` files are skipped; a missing `~/.ssh` gives an empty list.
- An old `ui-state.yml` (current key names, with and without the optional fields) still loads, and a saved file still has the same keys.
- A failed watcher start publishes exactly one `FileWatcherFailed` event whose message is `<collections dir>: <error>`.

---

### Task 1: Git identity and SSH keys behind `GitService` (D-38)

Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`.

**Files:**
- Create: `crates/rocket-git/src/identity.rs` (type `GitIdentity`), `crates/rocket-git/src/git2_service/identity.rs`, `crates/rocket-git/src/git2_service/ssh_keys.rs`
- Modify: `crates/rocket-git/src/lib.rs`, `crates/rocket-git/src/service.rs`, `crates/rocket-git/src/git2_service/mod.rs`, `crates/rocket-app/src/git_service.rs` (passthroughs and the `FakeGit` test double), `src-tauri/src/commands/git.rs`
- Test: the two new adapter files

**Interfaces:**
- Produces:
  - `pub struct GitIdentity { pub name: String, pub email: String }` in `rocket-git`.
  - On `GitService`: `fn identity(&self, path: &str) -> DomainResult<GitIdentity>`, `fn set_identity(&self, path: &str, name: &str, email: &str) -> DomainResult<()>`, `fn ssh_key_paths(&self) -> Vec<String>`, `fn default_ssh_key_path(&self) -> Option<String>`.
  - In `ssh_keys.rs`: `pub(super) fn key_paths_in(ssh_dir: &Path) -> Vec<String>` and `pub(super) fn default_key_in(ssh_dir: &Path) -> Option<String>` (the existing rules, with the directory passed in so they can be tested).
  - The same four methods on `GitAppService`.

- [ ] **Step 1: Write the failing tests**

`git2_service/identity.rs`: `identity_reads_local_config`, `identity_is_empty_when_unset` (a fresh repo with the test's config isolated; assert both fields are strings and no error), `set_identity_writes_local_config_only` (afterwards the repo's `.git/config` contains the name and email), `identity_of_a_non_repo_is_an_error`. Move the equivalent tests out of `commands/git.rs` (they call `git_get_identity` and `git_set_identity` there).
`git2_service/ssh_keys.rs` over a `TempDir`: `standard_names_come_first_in_preferred_order`, `custom_keys_sorted_after_standard`, `key_needs_a_pub_file`, `skips_known_hosts_config_dot_files_and_pub_files`, `missing_directory_is_empty`, `default_key_prefers_ed25519_then_rsa`, `default_key_none_when_no_standard_key`.

- [ ] **Step 2: Run to verify they fail, implement, run again**

Run: `cargo test -j4 -p rocket-git identity` and `cargo test -j4 -p rocket-git ssh_keys`
Expected: FAIL first, then PASS. Move the logic from `commands/git.rs` (`list_ssh_key_paths`, `get_default_ssh_key_path`, `git_get_identity`, `git_set_identity`) unchanged apart from the directory parameter; `Git2Service::ssh_key_paths` joins `~/.ssh` from `rocket_shared::paths::home_dir()`.

- [ ] **Step 3: Pass-throughs and the command layer**

Add the four methods to `GitAppService` and to `FakeGit` in `git_service.rs` tests (`unimplemented!()` bodies like its neighbors). In `commands/git.rs` the two `_v2` identity commands and `list_ssh_key_paths` and `get_default_ssh_key_path` take `State<'_, GitAppService>` (the same way the other git commands do) and map `GitIdentity` to the existing camelCase IPC struct. Delete the moved functions and tests from the command file.

- [ ] **Step 4: Verify**

Run: `cargo check -j4 -p rocket`, `cargo clippy -j4 -p rocket -p rocket-git -p rocket-app`, `cargo test -j4 -p rocket-git`, `cargo test -j4 -p rocket git`, `cargo test -j4 -p rocket-app git_service`.
Expected: pass; `grep -n "git2::\|std::fs" src-tauri/src/commands/git.rs` shows none for identity or SSH keys.

---

### Task 2: UI state behind a repository (D-39)

Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`.

**Files:**
- Create: `crates/rocket-workspace/src/ui_state.rs` (domain types and the port), `crates/rocket-infra/src/fs_ui_state_repo.rs`
- Modify: the two `lib.rs` files, `src-tauri/src/commands/ui_state.rs`, `src-tauri/src/lib.rs` (build and manage the repo)
- Test: both new files

**Interfaces:**
- Produces, in `rocket-workspace::ui_state`: `UiState`, `UiStateWorkspaceTabs`, `UiStateCollectionTab` (same fields as today, no serde), and `pub trait UiStateRepository: Send + Sync { fn load(&self) -> DomainResult<Option<UiState>>; fn save(&self, state: &UiState) -> DomainResult<()>; }`.
- Produces, in `rocket-infra`: `FsUiStateRepo::new(dir: PathBuf)` implementing the port over `<dir>/ui-state.yml` with persisted structs that keep today's camelCase keys, `atomic_write` for saving, and `create_dir_all` of `dir`.

- [ ] **Step 1: Write the failing tests**

`FsUiStateRepo` over a `TempDir`: `load_missing_file_is_none`, `save_then_load_round_trips_every_field`, `loads_a_file_written_by_the_old_command` (a YAML literal with today's key names, with optional fields absent), `saved_file_keeps_the_old_key_names` (assert `activeMode`, `workspaceTabs`, `collectionTabs`, `assistantPanelWidth` appear and `active_mode` does not), `save_creates_the_directory`, `corrupt_file_is_an_error`.

- [ ] **Step 2: Run to verify they fail, implement, run again**

Run: `cargo test -j4 -p rocket-infra fs_ui_state_repo`
Expected: FAIL first, then PASS.

- [ ] **Step 3: Thin the commands**

`load_ui_state` and `save_ui_state` take `State<'_, Arc<dyn UiStateRepository>>`. They keep the camelCase IPC `UiState` struct as a DTO with `From` conversions to and from the domain type. `lib.rs` builds `FsUiStateRepo::new(app.path().app_config_dir()?)` once; a missing config dir at startup falls back to the same error text as before on use, never a panic.

- [ ] **Step 4: Verify**

Run: `cargo check -j4 -p rocket`, `cargo clippy -j4 -p rocket -p rocket-infra -p rocket-workspace`, `cargo test -j4 -p rocket ui_state`, `cargo test -j4 -p rocket-workspace`.
Expected: pass; `grep -n "std::fs" src-tauri/src/commands/ui_state.rs` has no hits.

---

### Task 3: Watcher restart as a service (D-39)

Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`.

**Files:**
- Create: `crates/rocket-workspace/src/file_watcher.rs` (port), `crates/rocket-app/src/workspace_watcher.rs` (service)
- Modify: `crates/rocket-infra/src/file_watcher.rs` (implement the port; create the collections folder in `start`), the `lib.rs` files, `src-tauri/src/commands/workspaces.rs`, `src-tauri/src/lib.rs`
- Test: `workspace_watcher.rs` and the infra file

**Interfaces:**
- Produces:
  - `pub trait FileWatcher: Send + Sync { fn start(&self, collections_dir: PathBuf, publisher: Arc<dyn EventPublisher>) -> Result<(), String>; fn stop(&self); }` in `rocket-workspace`.
  - `pub struct WorkspaceWatcher` in `rocket-app` with `new(watcher: Arc<dyn FileWatcher>, publisher: Arc<dyn EventPublisher>)` and `pub fn restart(&self, workspace: &Path)`: it starts the watcher on `<workspace>/collections`; on `Err(e)` it logs and publishes `DomainEvent::FileWatcherFailed { message: format!("{}: {e}", dir.display()) }`.

- [ ] **Step 1: Write the failing tests**

`workspace_watcher.rs` with a recording fake watcher and publisher: `restart_starts_the_watcher_on_the_collections_dir`, `restart_stops_before_starting` (the fake records the call order), `failed_start_publishes_one_file_watcher_failed_event_with_dir_and_error`, `successful_start_publishes_nothing`. Infra: `start_creates_a_missing_collections_dir` and `start_fails_when_the_dir_cannot_be_created` (a file where the folder should be).

- [ ] **Step 2: Run to verify they fail, implement, run again**

Run: `cargo test -j4 -p rocket-app workspace_watcher` and `cargo test -j4 -p rocket-infra file_watcher`
Expected: FAIL first, then PASS.

- [ ] **Step 3: Wire and thin**

`lib.rs` builds one `Arc<NotifyFileWatcher>`, hands it to `WorkspaceWatcher::new(.., watcher_bus)` and manages the service (the startup block calls `restart` on the active workspace instead of repeating the start and failure code). `switch_workspace` and `remove_workspace` take `State<'_, WorkspaceWatcher>`; delete `restart_watcher` from the command file. If `lib.rs` stops the watcher on exit through the managed `NotifyFileWatcher`, keep that working through the `Arc`.

- [ ] **Step 4: Verify**

Run: `cargo check -j4 -p rocket`, `cargo clippy -j4 -p rocket -p rocket-app -p rocket-infra -p rocket-workspace`, `cargo test -j4 -p rocket`, `cargo test -j4 -p rocket-app`.
Expected: pass; `grep -n "create_dir_all\|FileWatcherFailed" src-tauri/src/commands/workspaces.rs` has no hits.

- [ ] **Step 5: Manual checks (record, cannot run headless)**

1. Switch workspace; create a request file in the new workspace from outside the app: the sidebar refreshes.
2. Close or delete the active workspace: the watcher follows the new active one.
3. Save UI state (open a collection tab, resize the assistant panel), restart: the layout comes back.
4. Edit and save a Git identity in the repository settings, and list SSH keys in the clone dialog.
