# Update notification, plan 1: settings, commands and checker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Rust side can check GitHub for a newer Rocket release, announce it with an event, download and install it, and remember the user's auto-check and skip choices.

**Architecture:** `rocket-app` holds `UpdateSettings`, a repository trait and the pure logic (version compare, skip rule, release URL). `rocket-infra` stores the settings in `~/.rocket-api/update.yml`. `src-tauri/src/commands/updates.rs` is a thin layer over `tauri-plugin-updater` (already registered) with commands and the `update-available` and `update-progress` events. A background task checks 30 seconds after launch and every 6 hours.

**Tech Stack:** Rust (`rocket-app`, `rocket-infra`, `src-tauri`), `tauri-plugin-updater` 2.10, `semver`.

**Spec:** `docs/superpowers/specs/2026-11-05-update-notification-design.md` (read the Addendum at the end, it overrides earlier text). Index: `2026-11-05-update-notice-index.md`. This is plan 1 of 2.

## Global Constraints

- Settings file `~/.rocket-api/update.yml` (`data_dir.join("update.yml")`). `UpdateSettings { auto_check: bool (default true), skipped_version: Option<String> (default None, skipped when None) }`. Write `impl Default` by hand: a derived `Default` would give `auto_check: false`. Missing file means the default. No camelCase on the persistence struct; camelCase only on the IPC DTOs.
- Events are plain `app.emit(...)`, not `DomainEvent` variants. Payloads are camelCase `#[derive(Serialize)]` structs. Names: `update-available` (`{ version, notes, date }`), `update-progress` (`{ downloaded, total }`).
- A failed or offline check is silent apart from one log line. Command errors map to stable messages (`"Could not check for updates"`, `"Could not install the update"`); the plugin error goes to the log only. A skipped version is not announced by the background checker; a manual `check_for_update` ignores the skip rule.
- `app.package_info().version` is the running version (do not use `CARGO_PKG_VERSION`, it is 0.1.0). Never take a URL from the network: the endpoint stays in `tauri.conf.json`. `src-tauri/capabilities/default.json` does not change (no `updater:default`).
- New commands go in `src-tauri/app-commands.txt` (sorted, unique) and in `generate_handler!`; the test `app_commands_file_matches_generate_handler` guards both.
- No panicking calls in production code. Comments are short full sentences ending with a period. Run cargo with `-j4`, never `--workspace`.

## Review Focus

- `2.1.4` vs `v2.2.0`, `2.1.4` vs `2.1.4`, and a pre-release or unparsable candidate must give the right answer and never panic (Task 1).
- A skipped version is not announced again, a newer one is (Task 1).
- A check that fails (404, offline) returns without an event and without a panic (Tasks 2 and 3).
- `install_update` must refuse a version that differs from the one the user saw (Task 2).
- An old or missing `update.yml` loads with auto-check on (Task 1).

---

### Task 1: Settings, repository and pure logic

**Files:**
- Create: `crates/rocket-app/src/update_service.rs`
- Modify: `crates/rocket-app/src/lib.rs` (mod and `pub use`, alphabetical like its neighbours), `crates/rocket-app/Cargo.toml` (`semver = "1"`)
- Create: `crates/rocket-infra/src/fs_update_settings_repo.rs`
- Modify: `crates/rocket-infra/src/lib.rs` (`pub mod` and `pub use`, next to `fs_proxy_settings_repo`)

**Interfaces:**
- Produces: `UpdateSettings`; `trait UpdateSettingsRepository: Send + Sync { fn load(&self) -> DomainResult<UpdateSettings>; fn save(&self, settings: &UpdateSettings) -> DomainResult<()>; }`; `UpdateService::new(repo: Box<dyn UpdateSettingsRepository>)` with `settings(&self) -> DomainResult<UpdateSettings>`, `set_auto_check(&self, enabled: bool) -> DomainResult<()>`, `skip_version(&self, version: &str) -> DomainResult<()>`; pure `pub fn is_newer(current: &str, candidate: &str) -> bool` (leading `v` stripped, `semver::Version` parse, either side unparsable gives false, a pre-release candidate counts as newer only when semver says so); `pub fn should_announce(settings: &UpdateSettings, current: &str, candidate: &str) -> bool` (newer and not equal to `skipped_version`, ignoring a leading `v` on both; `auto_check` is not looked at here); `pub fn release_url(version: &str) -> String` giving `https://github.com/Snehal1112/rocket/releases/tag/v<version>` with any leading `v` stripped first; `FsUpdateSettingsRepo::new(path: PathBuf)`.

- [ ] **Step 1: Write failing tests.**
  - `update_service.rs` `mod tests`: `is_newer` table: `("2.1.4","2.2.0")` true, `("2.1.4","v2.2.0")` true, `("2.1.4","2.1.4")` false, `("2.2.0","2.1.9")` false, `("2.1.4","2.1.5-beta.1")` true per semver and `("2.1.5","2.1.5-beta.1")` false, `("2.1.4","garbage")` false, `("","2.0.0")` false. `should_announce`: skipped `"2.2.0"` hides `2.2.0` and `v2.2.0`, shows `2.3.0`; `auto_check: false` does not change the answer. `release_url("2.2.0")` and `release_url("v2.2.0")` both equal the same URL. Service tests with an inline `MemRepo(Mutex<UpdateSettings>)`: `Default` has `auto_check == true` and no skipped version; `set_auto_check(false)` then `settings()` shows false; `skip_version("2.2.0")` is stored; skipping a second version replaces the first.
  - `fs_update_settings_repo.rs` tests (tempfile, copy `fs_proxy_settings_repo.rs` tests): missing file gives the default with `auto_check` true; round trip; a file with only `skipped_version: "2.2.0"` loads with `auto_check` true; a corrupt file is an error; the saved yaml has no `skipped_version` key when it is `None`.

- [ ] **Step 2: Run** `cargo test -j4 -p rocket-app update_service` and `cargo test -j4 -p rocket-infra fs_update_settings_repo`. Expect FAIL (missing items).

- [ ] **Step 3: Implement** the items in Interfaces. The repo copies `FsProxySettingsRepo`: load returns the default when the path does not exist, otherwise `serde_yaml::from_str` mapped to `DomainError::Internal`; save uses `serde_yaml::to_string` then `crate::atomic_write`. Use `#[serde(default = "default_true")]` on `auto_check` and `#[serde(default, skip_serializing_if = "Option::is_none")]` on `skipped_version`.

- [ ] **Step 4: Run** the two commands of Step 2 and `cargo check -j4`. Expect PASS. `cargo clippy -j4 -p rocket-app -p rocket-infra` clean.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(update): add update settings and version logic`.

### Task 2: Commands and events

**Files:**
- Create: `src-tauri/src/commands/updates.rs`
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod updates;`, alphabetical), `src-tauri/src/lib.rs` (build `UpdateService`, `app.manage(...)` next to `proxy_svc` ~:902, add to `generate_handler!`), `src-tauri/app-commands.txt`

**Interfaces:**
- Consumes: `UpdateService`, `UpdateSettings`, `release_url`, `should_announce`, `is_newer` from Task 1.
- Produces (all `#[tauri::command]`, registered as `commands::updates::<name>`): `check_for_update(app: AppHandle) -> Result<Option<UpdateInfoDto>, DomainError>` (calls `app.updater()?.check().await`; `None` when up to date; ignores the skip rule); `install_update(app: AppHandle, version: String) -> Result<(), DomainError>` (re-runs `check()`, refuses with `InvalidInput("The update changed. Check again.")` when the found version differs from `version`, then `download_and_install` while emitting `update-progress`; never restarts); `restart_app(app: AppHandle)` (calls `app.restart()`); `get_install_kind() -> InstallKind`; `get_update_settings(svc: State<UpdateService>) -> Result<UpdateSettingsDto, DomainError>`; `set_update_auto_check(svc, enabled: bool)`; `skip_update_version(svc, version: String)`. DTOs camelCase: `UpdateInfoDto { version, notes: Option<String>, date: Option<String> }` (date RFC 3339), `UpdateSettingsDto { auto_check, skipped_version }`, `InstallKind` as `"selfUpdatable" | "manual"`, `UpdateProgressDto { downloaded: u64, total: Option<u64> }`. Pure, testable fns: `install_kind_for(debug_build: bool) -> InstallKind` (`manual` when true), `progress_after(downloaded: u64, chunk: usize, total: Option<u64>) -> UpdateProgressDto`, and `pub(crate) fn emit_update_available(app: &AppHandle, info: &UpdateInfoDto)` (Task 3 uses it).

- [ ] **Step 1: Write failing tests** (inline `mod tests`, copy the style of `commands/proxy.rs` tests): `install_kind_for(true)` is `manual` and `(false)` is `selfUpdatable`; `InstallKind` serializes to `"selfUpdatable"`/`"manual"`; `progress_after(100, 50, Some(1000))` has `downloaded == 150` and `total == Some(1000)`; `UpdateInfoDto` serializes with camelCase keys and a missing note as `null`; `UpdateSettingsDto` camelCase keys. The existing `app_commands_file_matches_generate_handler` test must pass with the new command names.

- [ ] **Step 2: Run** `cargo test -j4 -p rocket updates` (the src-tauri package is `rocket`) and the ACL test. Expect FAIL.

- [ ] **Step 3: Implement.** Use `tauri_plugin_updater::UpdaterExt`. Map every plugin error to `DomainError::Internal("Could not check for updates")` or `("Could not install the update")` and log the detail with `tracing`. The chunk callback of `download_and_install(on_chunk, on_finish)` sums `chunk_len` into a counter and emits `update-progress` through `app.emit("update-progress", dto)` (ignore the emit error). Add the seven command names to `app-commands.txt` in sorted order and to `generate_handler!`. Wire the service in `lib.rs`: `UpdateService::new(Box::new(rocket_infra::FsUpdateSettingsRepo::new(data_dir.join("update.yml"))))` then `app.manage(...)`. `cargo add`-style: no new dependency in `src-tauri` (the plugin is already there).

- [ ] **Step 4: Run** the Step 2 tests, then `cargo check -j4` and `cargo test -j4 -p rocket` for the whole crate. Expect PASS. `cargo clippy -j4 -p rocket` clean.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(update): add update check, install and settings commands`.

### Task 3: Background checker

**Files:**
- Modify: `src-tauri/src/commands/updates.rs` (`start_update_checker`, pure schedule helper)
- Modify: `src-tauri/src/lib.rs` (start it in `.setup`, next to `spawn_exit_signal_listener` ~:931)

**Interfaces:**
- Consumes: `emit_update_available`, `UpdateService`, `should_announce`.
- Produces: `pub fn start_update_checker(app: &AppHandle)` (spawns on `tauri::async_runtime`); pure `pub(crate) fn wait_before_check(first: bool) -> Duration` (30 seconds for the first check, then 6 hours); pure `pub(crate) fn announcement(settings: &UpdateSettings, current: &str, found: Option<UpdateInfoDto>) -> Option<UpdateInfoDto>` (the info only when `auto_check` is on and `should_announce` is true).

- [ ] **Step 1: Write failing tests:** `wait_before_check(true) == 30s`, `(false) == 6h`; `announcement` returns `None` for `found: None`, `None` when `auto_check` is false, `None` for a skipped version, `Some` for a newer unskipped version, `None` for an equal or older version.

- [ ] **Step 2: Run** `cargo test -j4 -p rocket updates` and expect FAIL.

- [ ] **Step 3: Implement.** The task loops: sleep `wait_before_check(first)`, read settings (a read error counts as the default), skip the network call when `auto_check` is off, call `check()`, pass the result through `announcement`, emit with `emit_update_available`, log failures once at `warn`. Copy the 30-second-then-loop shape of `start_sync_scheduler` in `commands/import.rs`. Start it from `.setup` with `start_update_checker(app.handle())`. In a debug build the loop still runs (a 404 from an unpublished release is a silent log line).

- [ ] **Step 4: Run** the Step 2 tests, `cargo check -j4`, `cargo test -j4 -p rocket`. Expect PASS. `cargo clippy -j4 -p rocket` clean.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(update): check for releases at startup and every 6 hours`.
