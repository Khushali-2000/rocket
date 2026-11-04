# Contract Assembly, Save Hook And Directory Scans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three commands stop carrying domain or filesystem logic: `attach_contract` and `update_contract` (D-35), `save_request` (D-36), and `scan_collections_in_path` with `detect_cloned_structure` (D-37).

**Architecture:** (1) `ContractService` gets input types that assemble a `Contract` (status choice, defaults, preserving fields on edit) and two methods that use them. (2) `ContractService::audit_saved_request` owns the audit hook and the snapshot-path rebuild; the command only computes the collection root without a panicking lock. (3) A new `DirectoryProbe` port in `rocket-app` with a `rocket-infra` adapter, and a `collection_discovery` module in `rocket-app` that holds the detection rules.

**Findings (2026-11-04):**
- `attach_contract` already replaces `contract.id` with a new `Ulid` (`contract_service.rs:180`), so the `Ulid::new()` in the command is dead. The service also sets timestamps and `endpoint_count`.
- `save_request` takes the workspace lock with a panicking unwrap of the lock result. That is a panic on a poisoned lock inside a hook that must never fail the save. The new code skips the audit with a warning instead.
- `scan_collections_in_path` and `scan_opencollection_dirs` are the same loop written twice.

**Ruling (2026-11-04, during execution):** the `DirectoryProbe` port and the detection rules live in `rocket-collection` (`discovery.rs`, type `CollectionDiscovery`), not in `rocket-app`. `rocket-infra` does not depend on `rocket-app` (the dependency runs the other way in tests), so an adapter there cannot implement a port defined in `rocket-app`. Ports belong in domain crates. Task 3 below was written before this and names `rocket-app`; read it as `rocket-collection`. Cost if wrong: one move of a pure file.

**Tech Stack:** Rust, `tempfile`, `chrono::NaiveDate`.

**Spec:** `docs/roadmaps/ddd-roadmap.md` (D-35 to D-37); `docs/superpowers/specs/opencollection-spec-reference.md`; `.claude/rules/tauri-ipc-boundaries.md`.

## Global Constraints

- Before each task: read `docs/superpowers/specs/opencollection-spec-reference.md`.
- Cargo commands pass `-j4` and `-p <crate>`; the Tauri crate is `-p rocket`. No `--workspace`.
- No panicking unwrap of `Option` or `Result` in production paths; tests use `.expect("...")`.
- Command names and IPC DTOs do not change (so `app-commands.txt` is untouched). Error strings the UI may show keep their text: `invalid effectiveDate: ...`, `invalid expiryDate: ...`.
- Contract YAML stays backward compatible: no serde changes.
- No commit inside the plan; one `refactor:` commit at the end, explicit paths, `dev-workflow-skills:1-git-commit`.

## Review Focus

- `update` must keep scope, enforcement mode, status, counters, `created_by`, `created_at` and `project` of the stored contract, and take only the editable fields from the input.
- A draft contract (`publish_immediately = false`) must ignore any `initial_snapshots` the UI sent.
- The save audit must never fail or panic the save: a poisoned workspace lock, a missing contract folder and a repository error each end in a warning only.
- After a `.json` to `.yml` migration on save, the snapshot key uses the file name on disk, with the folder prefix of the requested path.
- Directory detection order stays: `workspace.yml`, then `opencollection.yml` at the root, then `collections/`, then direct children. Dot folders and plain files are skipped, results are sorted by lowercase name, and an unreadable folder is an error, not an empty list.

---

### Task 1: Contract assembly in `ContractService` (D-35)

Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`.

**Files:**
- Modify: `crates/rocket-app/src/contract_service.rs` (new types and two methods), `crates/rocket-app/src/lib.rs` (export), `src-tauri/src/commands/contract.rs` (use them)
- Test: `crates/rocket-app/src/contract_service.rs` tests module

**Interfaces:**
- Produces, in `contract_service.rs`:
  - `pub struct NewContract { pub title: String, pub provider: ContractParty, pub consumers: Vec<ContractParty>, pub version: String, pub effective_date: NaiveDate, pub expiry_date: Option<NaiveDate>, pub scope: ContractScope, pub policy: ContractPolicy, pub publish_immediately: bool }`
  - `impl NewContract { pub fn into_contract(self) -> Contract }`: status `Active` when `publish_immediately`, else `Draft`; `project` empty; `document_paths` empty; `enforcement_mode` `Informational`; all counters 0; `created_by`, `created_at`, `updated_at` `None`; a fresh `Ulid` (the service overwrites it).
  - `pub struct ContractEdit { pub title: String, pub provider: ContractParty, pub consumers: Vec<ContractParty>, pub version: String, pub effective_date: NaiveDate, pub expiry_date: Option<NaiveDate>, pub policy: ContractPolicy }`
  - `impl ContractEdit { pub fn apply_to(self, existing: Contract) -> Contract }` keeps everything of `existing` except the edit's fields.
  - `ContractService::attach_new(&self, collection_root: &Path, input: NewContract, initial_snapshots: Vec<RequestSignatureSnapshot>, document_paths: Vec<PathBuf>) -> ContractResult<Contract>` (drops `initial_snapshots` unless `input.publish_immediately`).
  - `ContractService::edit_contract(&self, collection_root: &Path, id: Ulid, edit: ContractEdit, new_document_paths: Vec<PathBuf>, kept_document_paths: Vec<PathBuf>) -> ContractResult<Contract>`.
- Consumes: the existing `attach_contract` and `update_contract`.

- [ ] **Step 1: Write the failing tests**

`into_contract_publish_immediately_is_active`, `into_contract_otherwise_is_draft`, `into_contract_starts_with_zero_counters_and_informational_mode`, `apply_to_keeps_scope_status_counters_and_creation_fields` (existing has non-default scope, `Paused` status, `drift_count` 3, `created_by` set; only the edit fields change), `attach_new_drops_snapshots_for_a_draft` (draft with two snapshots: the stored tracking snapshot has none and `endpoint_count` is 0), `attach_new_keeps_snapshots_when_published`, `edit_contract_unknown_id_is_not_found`. Use the existing `make_service()` and `make_contract_with_status` helpers.

- [ ] **Step 2: Run to verify they fail, implement, run again**

Run: `cargo test -j4 -p rocket-app contract_service`
Expected: compile error first, then PASS for the new tests and no failures in the existing ones.

- [ ] **Step 3: Thin the two commands**

`attach_contract` and `update_contract` parse the two date strings (same error texts), map the DTOs and call `attach_new` / `edit_contract`. Remove the `Contract { .. }` literals and the unused imports.

- [ ] **Step 4: Verify**

Run: `cargo check -j4 -p rocket`, `cargo test -j4 -p rocket contract`, `cargo clippy -j4 -p rocket -p rocket-app`.
Expected: pass, no new warnings.

---

### Task 2: Save audit hook in `ContractService` (D-36)

Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`.

**Files:**
- Modify: `crates/rocket-app/src/contract_service.rs`, `src-tauri/src/commands/collections.rs` (`save_request`)
- Test: `crates/rocket-app/src/contract_service.rs` tests module

**Interfaces:**
- Produces:
  - `pub fn snapshot_path(requested_path: &str, saved_file_name: Option<&str>) -> String`: the file name on disk replaces the last segment of `requested_path`; no file name gives `requested_path` back.
  - `ContractService::audit_saved_request(&self, collection_root: &Path, requested_path: &str, saved: &Request)`: builds the snapshot with `RequestSignatureSnapshot::from_request(&snapshot_path(..), saved)`, calls `on_request_saved`, and logs a `tracing::warn!` with the collection and request path on error. Returns nothing.
- Consumes: `on_request_saved` (existing).

- [ ] **Step 1: Write the failing tests**

`snapshot_path_replaces_file_name_keeping_folders` (`"Users/get.json"` and `Some("get.yml")` give `"Users/get.yml"`), `snapshot_path_without_folder` (`"get.json"`, `Some("get.yml")` gives `"get.yml"`), `snapshot_path_falls_back_to_requested_path`, `audit_saved_request_records_a_changelog_entry_for_a_covered_request` (reuse the fixtures of the existing `on_request_saved` tests: a published contract whose scope covers the request, a changed saved request, then one changelog entry), `audit_saved_request_swallows_repository_errors` (the repository fails on `list_contracts`; the call returns normally).

- [ ] **Step 2: Run to verify they fail, implement, run again**

Run: `cargo test -j4 -p rocket-app contract_service`
Expected: FAIL first, then PASS.

- [ ] **Step 3: Thin `save_request`**

After `svc.save_request(..)`, compute the collection root from the shared workspace path with the lock result mapped to a warning and an early `Ok(saved)` on a poisoned lock (no panicking unwrap), then call `contract_svc.audit_saved_request(&root, &path, &saved)`. Remove the inline snapshot-path code and the `RequestSignatureSnapshot` import from the command file.

- [ ] **Step 4: Verify**

Run: `cargo check -j4 -p rocket`, `cargo test -j4 -p rocket collections`, `cargo clippy -j4 -p rocket -p rocket-app`.
Expected: pass; `grep -n "lock()" src-tauri/src/commands/collections.rs` shows the lock handled without a panic.

---

### Task 3: Directory discovery behind a port (D-37)

**Files:**
- Create: `crates/rocket-app/src/collection_discovery.rs` (port, rules), `crates/rocket-infra/src/fs_directory_probe.rs` (adapter)
- Modify: `crates/rocket-app/src/lib.rs`, `crates/rocket-infra/src/lib.rs`, `src-tauri/src/commands/collections.rs`, `src-tauri/src/lib.rs` (manage the service)
- Test: both new files

**Interfaces:**
- Produces, in `collection_discovery.rs`:
  - `pub trait DirectoryProbe: Send + Sync { fn is_dir(&self, path: &Path) -> bool; fn has_file(&self, dir: &Path, file_name: &str) -> bool; fn child_dirs(&self, dir: &Path) -> DomainResult<Vec<DirChild>>; }` and `pub struct DirChild { pub name: String, pub path: PathBuf }`.
  - `pub struct FoundCollection { pub name: String, pub path: PathBuf }`.
  - `pub enum ClonedKind { Workspace, Collection, MultiCollection, Unknown }` with `pub fn as_str(&self) -> &'static str` giving `workspace`, `collection`, `multi_collection`, `unknown`.
  - `pub struct ClonedStructure { pub kind: ClonedKind, pub workspace_path: Option<PathBuf>, pub collections: Vec<FoundCollection> }`.
  - `pub struct CollectionDiscoveryService { probe: Box<dyn DirectoryProbe> }` with `new(Box<dyn DirectoryProbe>)`, `scan(&self, dir: &Path) -> DomainResult<Vec<FoundCollection>>` (not a directory gives an empty list) and `detect(&self, dir: &Path) -> DomainResult<ClonedStructure>` with the order from Review Focus.
- Produces, in `fs_directory_probe.rs`: `pub struct FsDirectoryProbe;` implementing `DirectoryProbe` with `std::fs`.

- [ ] **Step 1: Write the failing tests for the rules (fake probe)**

`scan_returns_only_dirs_with_opencollection_yml_sorted_case_insensitively`, `scan_skips_dot_folders`, `scan_of_a_missing_directory_is_empty`, `detect_workspace_when_workspace_yml_exists` (kind `Workspace`, `workspace_path` set, collections scanned), `detect_single_collection_at_root` (name from the folder name), `detect_collections_subdirectory`, `detect_direct_children`, `detect_unknown_for_an_empty_directory`, `detect_unknown_for_a_missing_directory`, `detect_prefers_workspace_over_collection_at_the_same_root`, `read_error_is_an_error_not_empty`.

- [ ] **Step 2: Write the failing adapter tests**

`FsDirectoryProbe` over a `TempDir`: `is_dir`, `has_file`, `child_dirs` lists only directories, and a missing directory is a `DomainError::Internal`.

- [ ] **Step 3: Run to verify they fail, implement, run again**

Run: `cargo test -j4 -p rocket-app collection_discovery` and `cargo test -j4 -p rocket-infra fs_directory_probe`
Expected: FAIL first, then PASS.

- [ ] **Step 4: Wire and thin the commands**

Build `CollectionDiscoveryService::new(Box::new(FsDirectoryProbe))` once in `lib.rs` and manage it. `scan_collections_in_path` and `detect_cloned_structure` take it from `State` and map to the existing `CollectionScanResult` / `ClonedRepoStructure` DTOs (the `kind` string and the path strings do not change). Delete `scan_opencollection_dirs` and the `std::fs` use from the command file.

- [ ] **Step 5: Verify**

Run: `cargo check -j4 -p rocket`, `cargo clippy -j4 -p rocket -p rocket-app -p rocket-infra`, `cargo test -j4 -p rocket-app`, `cargo test -j4 -p rocket`.
Expected: pass; `grep -n "std::fs\|fs::" src-tauri/src/commands/collections.rs` has no hits.

- [ ] **Step 6: Manual checks (record, cannot run headless)**

1. Open a folder that holds several collections through the workspace import dialog: the list shows them sorted.
2. Clone a repository with a `workspace.yml`, one with a single collection at the root, and one with a `collections/` folder: each is recognized as before.
3. Save a request in a collection with an attached contract after changing its URL: the contract changelog gets an entry.
4. Create a draft contract and a published one from the dialog; edit each and confirm scope and status are unchanged.
