# DDD Phase 1 Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three Phase 1 items: no orphan files on a duplicate workspace create (D-10), pin that the other workspace-registry writer is already safe (D-11), and keep the event name in an invalid contract transition error (D-12).

**Architecture:** All changes are small edits to existing functions plus tests. D-10 reorders `WorkspaceService::create`. D-11 audit found no bug, so it only adds regression tests. D-12 derives `Debug` on `StatusEvent`, fills `InvalidTransition.event` with the real event name, and puts both into the error message.

**Tech Stack:** Rust, `cargo test -j4 -p <crate>`, `tempfile`.

**Spec:** `docs/roadmaps/ddd-roadmap.md` (Phase 1, D-10 to D-12). Findings from reading the code on 2026-11-04 are in the tasks below.

## Global Constraints

- Cargo commands pass `-j4` and `-p <crate>`; never `--workspace` or `--all`.
- No panicking calls in production paths (the project rule on `Option`/`Result` unwrapping). Comments are short full sentences ending in a punctuation mark.
- Keep persistence backward compatible; no serde changes here.
- No commit during the plan. The user reviews, then one commit with the `dev-workflow-skills:1-git-commit` skill (conventional type `fix:`), explicit paths only.
- Tasks 1 and 3 touch `rocket-workspace` and `rocket-collection` models, so each starts with: "Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`."

## Review Focus

- A failing create must also leave the in-memory registry untouched and publish no `WorkspaceCreated` event.
- Names that differ only by case or whitespace: whatever `name_exists` does today stays; the test must not change that rule.
- A create at a path that already holds a workspace must not have its `workspace.yml` overwritten by a duplicate-name create (the real orphan risk).
- Contract error text is asserted in four existing tests and may be shown in the UI; the new text keeps the `invalid transition: <Status>` prefix.

---

### Task 1: D-10, check the name before touching the disk

Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`.

**Files:**
- Modify: `crates/rocket-app/src/workspace_service.rs:101-109` (`create`)
- Test: `crates/rocket-app/src/workspace_service.rs` (tests module, next to `create_rejects_duplicate_name` at line 658)

**Interfaces:**
- Produces: `WorkspaceService::create(&self, name: &str, path: PathBuf) -> DomainResult<Workspace>` with unchanged signature. New order: validate name, load registry, `name_exists` check, then `ensure_workspace_dirs`, config save, push, save, publish.

- [ ] **Step 1: Write the failing test `create_duplicate_name_leaves_disk_untouched`**

Create "My WS" at `tmp/ws1`. Call `create("My WS", tmp/ws2)` and assert: the result is `Err(DomainError::AlreadyExists(_))`, `!tmp.path().join("ws2").exists()`, and the length of `svc.list()` is unchanged (2 including the default workspace).

- [ ] **Step 2: Write the failing test `create_duplicate_name_keeps_existing_workspace_yml`**

Create "My WS" at `tmp/ws1`, read `tmp/ws1/workspace.yml` into a string. Call `create("My WS", tmp/ws1)` (same path) and assert `AlreadyExists` and that the file content is byte-equal to the string read before.

- [ ] **Step 3: Run them to verify they fail**

Run: `cargo test -j4 -p rocket-app create_duplicate_name`
Expected: FAIL on `ws2.exists()` in the first test (the directory is created before the check). The second test may pass today because the config has the same name; if it passes, keep it as a pin and note that in the ledger.

- [ ] **Step 4: Reorder `create`**

Move the `self.repo.load()` call and the `name_exists` check above `ensure_workspace_dirs`. Keep every other line in the same order.

- [ ] **Step 5: Run the workspace tests**

Run: `cargo test -j4 -p rocket-app workspace_service`
Expected: all pass, including `create_writes_workspace_yml_and_subdirs` and `create_rejects_duplicate_name`.

---

### Task 2: D-11, pin that `open_workspace` and `link_external_collection` check first

Finding (2026-11-04): the roadmap points at lines 282-289, which are `open_workspace`. It already checks the path (line 277) and the name (line 283) before `registry.workspaces.push` (289) and does no write before them. `link_external_collection` (line 324) has no `workspaces.push`; it checks `has_collection` (line 353) before `add_external_collection` and `save`. So there is no code bug. This task adds the tests that keep it that way.

**Files:**
- Test: `crates/rocket-app/src/workspace_service.rs` (tests module)

**Interfaces:**
- Consumes: the `make_service(&TempDir)` helper and `WorkspaceService::open_workspace(&self, path: PathBuf) -> DomainResult<Workspace>`.

- [ ] **Step 1: Write `open_workspace_duplicate_name_changes_nothing`**

Create "Dup" at `tmp/a` through `create`. Make `tmp/b` with a `workspace.yml` for name "Dup" (use `MockWorkspaceConfigRepo` `save` with `WorkspaceConfig::new("Dup")`). Call `open_workspace(tmp/b)`, assert `AlreadyExists` and that the length of `svc.list()` is unchanged.

- [ ] **Step 2: Write `open_workspace_same_path_twice_is_rejected`**

Open `tmp/c` (with `workspace.yml`) once (Ok), then again, assert `AlreadyExists` and that `list()` has one more entry than before the first call, not two.

- [ ] **Step 3: Run them**

Run: `cargo test -j4 -p rocket-app open_workspace_`
Expected: PASS on first run. If either fails, that is a real D-11 bug: stop and rule it in the ledger before fixing.

- [ ] **Step 4: Update the roadmap row**

In `docs/roadmaps/ddd-roadmap.md`, set D-11 to `done` with the note "audited, no bug; pinned by tests" and correct the "Where" cell to `workspace_service.rs:277-289 (open_workspace)`.

---

### Task 3: D-12, keep the event in the invalid transition error

Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`.

**Files:**
- Modify: `crates/rocket-collection/src/contract/state_machine.rs:3` (derive on `StatusEvent`), `:84-88` (`event` field value)
- Modify: `crates/rocket-app/src/contract_service.rs:942-948` (`apply_transition`), and the four expected strings at lines 1699, 1710, 1721, 1732
- Test: `crates/rocket-collection/src/contract/state_machine.rs` (tests module)

**Interfaces:**
- Produces: `StatusEvent` derives `Debug`. `InvalidTransition { from: ContractStatus, event: String }` with `event` set to `format!("{event:?}")` (for example `"Renew"`; today it is a `Discriminant(n)` string). The `apply_transition` message becomes `invalid transition: {from:?} on {event}`, for example `invalid transition: Draft on Renew`.

- [ ] **Step 1: Write the failing test `invalid_transition_reports_event_name`**

In `state_machine.rs` tests: `transition(&ContractStatus::Draft, &StatusEvent::Renew)` returns `Err(e)` with `e.from == ContractStatus::Draft` and `e.event == "Renew"`.

- [ ] **Step 2: Update the four expected strings in `contract_service.rs`**

In the tests `invalid_transition_message_*` (lines 1692-1735 region) change each expectation to include the event: `format!("invalid transition: {:?} on {}", ContractStatus::Draft, "Renew")` for the renew test, and the matching event names for the publish test (`Publish`), the accept-drift test (read `accept_drift` to get the event it raises), and the first one at line 1692 (read its event from the call above it).

- [ ] **Step 3: Run to verify they fail**

Run: `cargo test -j4 -p rocket-collection invalid_transition_reports_event_name` then `cargo test -j4 -p rocket-app invalid_transition_message`
Expected: the first test FAILs with `"Discriminant(..)"` versus `"Renew"` (it needs `Debug` on `StatusEvent` only for the comparison string, so add the derive first if the test does not compile), and the four app tests FAIL on the old message.

- [ ] **Step 4: Implement**

Add `#[derive(Debug)]` to `StatusEvent`. In `transition`, set `event: format!("{event:?}")`. In `apply_transition`, format the message as `invalid transition: {:?} on {}` using `e.from` and `e.event`.

- [ ] **Step 5: Run the crates' contract tests**

Run: `cargo test -j4 -p rocket-collection contract` and `cargo test -j4 -p rocket-app contract_service`
Expected: all pass.

- [ ] **Step 6: Check callers of the message and finish**

Run: `grep -rn "invalid transition" crates src-tauri src`
Expected: only `contract_service.rs` and its tests; if the frontend matches the text, update it and run `bun run tsc --noEmit`. Then run `cargo check -j4 -p rocket-app -p rocket-collection` and `cargo clippy -j4 -p rocket-app -p rocket-collection`, expected: no new warnings. Set D-10 and D-12 to `done` in the roadmap.
