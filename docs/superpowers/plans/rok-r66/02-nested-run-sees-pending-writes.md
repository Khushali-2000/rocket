# R-66 Plan 02: the nested run sees the caller's pending writes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Plan 2 of 2. Previous: `01-second-pass-sees-every-scope.md` (must be done). Next: none. Recommended model: Sonnet implementer per task, Opus reviewer.

**Goal:** A `rok.runRequest` call sees the environment, global and collection writes its caller made earlier in the same script, without saving them early.

**Architecture:** `rocket_scripting::HostRunRequest` gains `pending: PendingWrites`, which `op_rok_run_request` fills from `ScriptOutputState` (the writes stay in the output, so the caller still saves them). `RequestExecutionService::execute_nested` takes the pending writes and `overlay_pending_writes` puts them into the nested `state.var_ctx` right after `begin_phases`, through the existing vault hold-back. Because `first_values` came from storage, the Plan 01 second pass sees them as changed and fills the nested request.

**Tech Stack:** Rust, `rocket-scripting` (`host.rs`, `lib.rs`), `rocket-infra` (`scripting/ops/host.rs`, engine tests in `scripting/engine.rs`), `rocket-app` (`execution_service.rs`, `execution_service/script_host.rs`, `execution_service/script_host_tests.rs`).

**Spec:** `docs/superpowers/specs/2026-11-01-rok-script-writes-reach-request-design.md`, Design section 3, Testing 8 and 9, Docs. Read `00-plan-index.md` first (deviations 2, 3, 4 and 7 apply here). Prerequisite from Plan 01: `RequestTemplates::first_values`, `Overrides::between` in `resolve_runtime_placeholders`, and the test helpers `dev_env`, `run_service_over`, `main_and_login_with`, `sent_header`.


> Note (2026-11-01, after Plans 03 and 04): `RequestTemplates` now has `first_raw` (unexpanded) and `first_values` (expanded). Pending writes are script-written values: they must count as changed against `first_raw` and go in as written (the Plan 04 `second_pass_values` helper passes changed names as `extra` to `expand_nested`). Do not compare them against `first_values`. Plan 04 also made `reload_stored_scopes` strict (Plan 03 Task 1).

## Global Constraints

- 📖 Before starting each task, read `docs/superpowers/specs/opencollection-spec-reference.md`.
- `cargo` commands take `-j4`; never `--workspace` or `--all`.
- No unwrap calls in production code.
- `HostRunRequest` keeps `#[derive(Debug, Clone, PartialEq, Eq)]`.
- Pending writes are never saved by the nested run's pipeline: `overlay_pending_writes` only writes `state.var_ctx`.
- Implementers do not commit (see the index).

## Review Focus

1. **A pending delete** must hide the stored value in the nested run, and a pending write after a delete of the same key must win (writes are applied in order). Task 2 test `run_request_e2e_a_pending_delete_hides_the_stored_value`; order is kept by `Vec`, checked in Task 1 test `run_request_passes_the_scripts_unsaved_writes`.
2. **A pending value holding a RocketVault secret** must go to runtime with the Console warning, never into `env`. Task 2 test `a_pending_value_holding_a_vault_secret_stays_in_runtime`.
3. **No active environment:** a pending env write must not reach the nested run, as the caller drops it too. Task 2 test `pending_writes_skip_a_scope_with_nothing_selected`.
4. **The caller's own pending write must still be saved** after the nested run when the nested run did not change that key (`merge_run_outcome` keeps it). Task 2 test `run_request_e2e_the_nested_run_sees_the_callers_unsaved_env_write` checks the stored value after the send.
5. **A non-string pending value** (number, object) reaches the nested run as JSON text, the same text the caller would save. Task 1 test uses `setCollectionVar('C', 7)` and expects `"7"`.
6. **A nested request whose own pre-request script calls `rok.runRequest`** reloads its scopes from storage (Plan 01 `reload_stored_scopes`), which would wipe the caller's pending writes. The overlay must be applied again after that reload. Task 2 test `run_request_e2e_the_pending_writes_survive_the_nested_runs_own_reload`. (Added after the Plan 01 final review.)

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `crates/rocket-scripting/src/host.rs` | Modify | `PendingWrites`; `HostRunRequest::pending` |
| `crates/rocket-scripting/src/lib.rs` | Modify | Re-export `PendingWrites` |
| `crates/rocket-infra/src/scripting/ops/host.rs` | Modify | `write_text`, `pending_writes`; `op_rok_run_request` fills `pending` |
| `crates/rocket-infra/src/scripting/engine.rs` | Modify (tests) | Engine test with `RunHost` |
| `crates/rocket-app/src/execution_service.rs` | Modify | `overlay_pending_writes`; `execute_nested` takes `pending`; test call site about line 12893 |
| `crates/rocket-app/src/execution_service/script_host.rs` | Modify | Pass `&request.pending` |
| `crates/rocket-app/src/execution_service/script_host_tests.rs` | Modify | End-to-end and unit tests |
| `docs/superpowers/specs/2026-10-07-rok-js-api-parity-b-async-design.md` | Modify | Known limits point to R-66 |
| `docs/superpowers/plans/rok-parity-b/00-plan-index.md` | Modify | Ruling 11 points to R-66 |
| `docs/features/rok-api-parity-notes.md` | Modify | Series status line, new behaviour |
| `docs/roadmaps/roadmap.md` | Modify | R-66 done |

---

### Task 1: `PendingWrites` on `HostRunRequest`

**Files:**
- Modify: `crates/rocket-scripting/src/host.rs` (after `HostRunRequest`, about line 51)
- Modify: `crates/rocket-scripting/src/lib.rs` (the `pub use host::{..}` list, line 11)
- Modify: `crates/rocket-infra/src/scripting/ops/host.rs` (imports line 9; helpers near `current_runtime_vars`, about line 140; `op_rok_run_request` about line 255)
- Test: `crates/rocket-infra/src/scripting/engine.rs` (tests module, after `run_request_keeps_a_pending_write_the_nested_run_did_not_change`, about line 1420)

**Interfaces:**

```rust
// rocket-scripting/src/host.rs
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PendingWrites {
    pub env: Vec<(String, Option<String>)>,
    pub global_env: Vec<(String, Option<String>)>,
    pub collection: Vec<(String, Option<String>)>,
}
pub struct HostRunRequest {
    pub path: String,
    pub runtime_vars: HashMap<String, String>,
    pub pending: PendingWrites, // new
}
// rocket-infra/src/scripting/ops/host.rs (private)
fn write_text(value: &serde_json::Value) -> Option<String>;
fn pending_writes(state: &OpState) -> PendingWrites;
```

- [ ] **Step 1: Write the failing test**

In the tests module of `engine.rs`, add `PendingWrites` to the `rocket_scripting` import used by the run-request tests (next to `HostRunOutcome`, `HostScopes`), then add:

```rust
    #[tokio::test]
    async fn run_request_passes_the_scripts_unsaved_writes() {
        let host = RunHost::answering(Ok(ran(200, "{}")));
        let ctx = minimal_ctx(
            "rok.setEnvVar('U', 'alice'); rok.deleteEnvVar('E'); rok.setEnvVar('E', 'back'); \
             rok.setGlobalEnvVar('G', 'g'); rok.setCollectionVar('C', 7); \
             await rok.runRequest('ping');",
        );
        let result = DenoScriptEngine::new()
            .execute_with_host(ctx, &host)
            .await
            .expect("execute");
        assert!(result.error.is_none(), "{:?}", result.error);
        let seen = host.seen();
        assert_eq!(seen.len(), 1);
        assert_eq!(
            seen[0].pending,
            PendingWrites {
                env: vec![
                    ("U".to_string(), Some("alice".to_string())),
                    ("E".to_string(), None),
                    ("E".to_string(), Some("back".to_string())),
                ],
                global_env: vec![("G".to_string(), Some("g".to_string()))],
                collection: vec![("C".to_string(), Some("7".to_string()))],
            }
        );
        // The writes stay in the output, so the caller still saves them.
        assert_eq!(result.env_var_writes.len(), 3);
        assert_eq!(result.collection_var_writes.len(), 1);
    }
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cargo test -j4 -p rocket-infra run_request_passes_the_scripts_unsaved_writes`
Expected: FAIL to compile with `unresolved import ... PendingWrites` / `no field 'pending' on type 'HostRunRequest'`.

- [ ] **Step 3: Add `PendingWrites`**

In `host.rs`, before `HostRunRequest`:

```rust
/// Environment, global and collection writes the calling script made and has not saved yet,
/// in the order it made them. `None` deletes the key.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PendingWrites {
    pub env: Vec<(String, Option<String>)>,
    pub global_env: Vec<(String, Option<String>)>,
    pub collection: Vec<(String, Option<String>)>,
}
```

Add the last field of `HostRunRequest`:

```rust
    /// The calling script's unsaved environment, global and collection writes. The nested run
    /// sees them in memory only; the caller still saves them when its script ends.
    pub pending: PendingWrites,
```

In `lib.rs`, add `PendingWrites` to the `pub use host::{..}` list (keep it sorted).

- [ ] **Step 4: Fill it in the op**

In `ops/host.rs`, add `CollectionVarWrite`, `EnvVarWrite` and `PendingWrites` to the `use rocket_scripting::{..}` list. Below `current_runtime_vars`:

```rust
/// A write value as the text a scope holds, as the caller would save it. `null` deletes.
fn write_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

/// The calling script's unsaved environment, global and collection writes, in order.
fn pending_writes(state: &OpState) -> PendingWrites {
    let out = state.borrow::<ScriptOutputState>();
    let env_list = |writes: &[EnvVarWrite]| -> Vec<(String, Option<String>)> {
        writes
            .iter()
            .map(|w| (w.key.clone(), write_text(&w.value)))
            .collect()
    };
    let collection_list = |writes: &[CollectionVarWrite]| -> Vec<(String, Option<String>)> {
        writes
            .iter()
            .map(|w| (w.key.clone(), write_text(&w.value)))
            .collect()
    };
    PendingWrites {
        env: env_list(&out.env_var_writes),
        global_env: env_list(&out.global_env_var_writes),
        collection: collection_list(&out.collection_var_writes),
    }
}
```

In `op_rok_run_request`, replace:

```rust
    let runtime_vars = current_runtime_vars(&state.borrow());
    let request = HostRunRequest {
        path: path.clone(),
        runtime_vars,
    };
```

with:

```rust
    let runtime_vars = current_runtime_vars(&state.borrow());
    let pending = pending_writes(&state.borrow());
    let request = HostRunRequest {
        path: path.clone(),
        runtime_vars,
        pending,
    };
```

If the compiler reports another `HostRunRequest { .. }` literal (none exist on `main` at `15534bf9` outside this op), add `pending: PendingWrites::default()` there.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cargo test -j4 -p rocket-infra run_request`
Expected: PASS, the new test and every existing `run_request*` engine test.
Run: `cargo check -j4 -p rocket-app`
Expected: PASS (`rocket-app` only reads `HostRunRequest` fields).

---

### Task 2: The nested run applies the pending writes, plus docs

**Files:**
- Modify: `crates/rocket-app/src/execution_service.rs` (new free fn next to `mirror_env_writes`, about line 3475; `execute_nested` about line 3269; test call about line 12893)
- Modify: `crates/rocket-app/src/execution_service/script_host.rs` (`run_request`, the `execute_nested` call about line 207)
- Modify: `crates/rocket-app/src/execution_service/script_host_tests.rs`
- Modify: the four docs files in the File Structure table

**Interfaces:**

```rust
// Consumes (Task 1): rocket_scripting::PendingWrites, HostRunRequest::pending.
// Consumes (Plan 01): first_values and Overrides::between (the second pass fills the nested request).
// Produces:
fn overlay_pending_writes(
    input: &ExecuteRequestInput,
    state: &mut PhaseState,
    pending: &rocket_scripting::PendingWrites,
);
pub(crate) async fn execute_nested(
    &self,
    input: ExecuteRequestInput,
    external_secrets: &std::collections::HashMap<String, String>,
    chain: Vec<String>,
    runtime: &std::collections::HashMap<String, String>,
    pending: &rocket_scripting::PendingWrites, // new
    unresolved: &Arc<Vec<UnresolvedAlias>>,
    active_runs: &Arc<std::sync::atomic::AtomicUsize>,
) -> DomainResult<(ExecuteRequestOutput, std::collections::HashMap<String, String>)>;
```

- [ ] **Step 1: Write the failing tests**

Add to `script_host_tests.rs` (new section comment `// ---- Nested runs see the caller's pending writes ----`):

```rust
#[tokio::test]
async fn run_request_e2e_the_nested_run_sees_the_callers_unsaved_env_write() {
    let collection = main_and_login_with(
        "rok.setEnvVar('U', 'alice'); await rok.runRequest('auth/login');",
        "console.log('U=' + rok.getEnvVar('U'));",
        "",
        &[],
        &[("X-U", "{{U}}")],
    );
    let input = send_input(&collection, "main.yml");
    let env = dev_env(vec![Variable::new("E", "old")]);
    let (svc, executor) =
        run_service_over(InMemoryCollectionRepo::new(collection), Arc::clone(&env));
    let out = svc.execute(input).await.expect("execute");
    assert!(out.script_error.is_none(), "{:?}", out.script_error);
    assert_eq!(sent_header(&executor, 0, "X-U").as_deref(), Some("alice"));
    assert!(
        console(&out).contains(&"U=alice".to_string()),
        "{:?}",
        console(&out)
    );
    // The caller still saves its own write when its script ends.
    assert_eq!(env.lock().expect("lock").get_value("U"), Some("alice"));
}

#[tokio::test]
async fn run_request_e2e_a_pending_delete_hides_the_stored_value() {
    let collection = main_and_login_with(
        "rok.deleteEnvVar('E'); await rok.runRequest('auth/login');",
        "",
        "",
        &[],
        &[("X-E", "{{E}}")],
    );
    let input = send_input(&collection, "main.yml");
    let (svc, executor) = run_service(collection);
    svc.execute(input).await.expect("execute");
    assert_eq!(sent_header(&executor, 0, "X-E").as_deref(), Some("{{E}}"));
}

#[tokio::test]
async fn a_pending_value_holding_a_vault_secret_stays_in_runtime() {
    let collection = main_and_login("", "", "");
    let input = send_input(&collection, "main.yml");
    let (svc, _executor) = run_service(collection);
    let secret = "vault-secret-value-1234";
    let mut state = svc
        .begin_phases(
            &input,
            &std::collections::HashMap::from([("v.k".to_string(), secret.to_string())]),
        )
        .expect("begin");
    let pending = rocket_scripting::PendingWrites {
        env: vec![("T".to_string(), Some(format!("Bearer {secret}")))],
        ..Default::default()
    };
    super::overlay_pending_writes(&input, &mut state, &pending);
    assert!(!state.var_ctx.env.contains_key("T"));
    assert_eq!(
        state.var_ctx.runtime.get("T").map(String::as_str),
        Some(format!("Bearer {secret}").as_str())
    );
    assert!(state
        .console
        .iter()
        .any(|e| e.message.contains("was not saved because it contains a vault secret")));
}

#[tokio::test]
async fn pending_writes_skip_a_scope_with_nothing_selected() {
    let collection = main_and_login("", "", "");
    let mut input = send_input(&collection, "main.yml");
    input.environment_name = None;
    let (svc, _executor) = run_service(collection);
    let mut state = svc
        .begin_phases(&input, &std::collections::HashMap::new())
        .expect("begin");
    let pending = rocket_scripting::PendingWrites {
        env: vec![("U".to_string(), Some("alice".to_string()))],
        global_env: vec![("G".to_string(), Some("g".to_string()))],
        collection: vec![("C".to_string(), Some("c".to_string()))],
    };
    super::overlay_pending_writes(&input, &mut state, &pending);
    assert!(!state.var_ctx.env.contains_key("U"));
    assert!(!state.var_ctx.global_env.contains_key("G"), "no global env selected");
    assert_eq!(state.var_ctx.collection.get("C").map(String::as_str), Some("c"));
}
```

`send_input` sets no global environment, so `G` is skipped too; the collection is `api`, so `C` is applied.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test -j4 -p rocket-app pending`
Expected: FAIL to compile with `cannot find function 'overlay_pending_writes' in module 'super'`. After Step 3 adds the function but before Step 4 wires it, `run_request_e2e_the_nested_run_sees_the_callers_unsaved_env_write` FAILS with `left: Some("{{U}}")`, `right: Some("alice")`.

- [ ] **Step 3: Add `overlay_pending_writes`**

In `execution_service.rs`, after `mirror_env_writes`:

```rust
/// Puts the calling script's unsaved writes into a nested run's scopes, in memory only. A scope
/// with nothing selected is skipped, because the caller drops those writes too. A value that
/// holds a RocketVault secret goes to runtime with the usual Console warning.
fn overlay_pending_writes(
    input: &ExecuteRequestInput,
    state: &mut PhaseState,
    pending: &rocket_scripting::PendingWrites,
) {
    let as_writes = |list: &[(String, Option<String>)]| -> Vec<rocket_scripting::EnvVarWrite> {
        list.iter()
            .map(|(key, value)| rocket_scripting::EnvVarWrite {
                key: key.clone(),
                value: value
                    .clone()
                    .map_or(serde_json::Value::Null, serde_json::Value::String),
                persist: false,
            })
            .collect()
    };
    let PhaseState {
        var_ctx,
        vault_forms,
        console,
        ..
    } = state;
    if input.environment_name.is_some() {
        let kept = hold_back_vault_writes(
            &as_writes(&pending.env),
            "environment",
            vault_forms,
            var_ctx,
            console,
        );
        mirror_env_writes(&mut var_ctx.env, &kept);
    }
    if input.global_env_name.is_some() {
        let kept = hold_back_vault_writes(
            &as_writes(&pending.global_env),
            "global environment",
            vault_forms,
            var_ctx,
            console,
        );
        mirror_env_writes(&mut var_ctx.global_env, &kept);
    }
    if input.collection.is_some() {
        let kept = hold_back_vault_writes(
            &as_writes(&pending.collection),
            "collection variable",
            vault_forms,
            var_ctx,
            console,
        );
        mirror_env_writes(&mut var_ctx.collection, &kept);
    }
}
```

- [ ] **Step 4: Wire it into `execute_nested`**

Add the parameter `pending: &rocket_scripting::PendingWrites,` after `runtime` in `execute_nested`, update its doc comment (`` `pending` holds the caller's unsaved environment, global and collection writes, which the run sees in memory only. ``), and after `state.seed_runtime(runtime);` add:

```rust
        // The second pass sees these as changed values and fills the request with them.
        overlay_pending_writes(&input, &mut state, pending);
```

Keep the overlay across a reload: add `pub pending: rocket_scripting::PendingWrites` to `PhaseState` (empty by default, set in `begin_phases`' initialiser), store a clone of `pending` on the nested `state` just before the `overlay_pending_writes` call above, and at the end of a successful reload in `reload_stored_scopes` (the `Ok` branch Plan 03 Task 1 added; the `Err` branch keeps the scopes, so the overlay is still there) call `let pending = state.pending.clone(); overlay_pending_writes(input, state, &pending);`. Add this test to `script_host_tests.rs`, with a collection of three saved requests (`main.yml` sets env `U` to `alice` and calls `runRequest('mid.yml')`; `mid.yml` has header `X-U: {{U}}` and a pre-request script that calls `await rok.runRequest('leaf.yml')`; `leaf.yml` is a plain GET), env `dev` with `U = stored`:

```rust
#[tokio::test]
async fn run_request_e2e_the_pending_writes_survive_the_nested_runs_own_reload() {
    // Build the three requests as described above with the file's existing helpers.
    let out = svc.execute(main_input).await.expect("execute");
    assert!(out.script_error.is_none(), "{:?}", out.script_error);
    // Executor order: leaf (0), mid (1), main (2).
    assert_eq!(sent_header(&executor, 1, "X-U").as_deref(), Some("alice"));
}
```

Before the reload re-applies the overlay, this test FAILS with `Some("stored")`.

In `script_host.rs` `run_request`, pass `&request.pending,` after `&request.runtime_vars,` in the `self.svc.execute_nested(..)` call.

In the existing test that calls `svc.execute_nested(` (`execution_service.rs`, about line 12893), add `&rocket_scripting::PendingWrites::default(),` after its runtime argument.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cargo test -j4 -p rocket-app pending`
Expected: PASS (4 tests).
Run: `cargo test -j4 -p rocket-app run_request`
Expected: PASS, every existing run-request test included.
Run: `cargo test -j4 -p rocket-app` and `cargo test -j4 -p rocket-infra run_request`
Expected: PASS.
Run: `cargo check -j4 -p rocket-app --tests` and `cargo fmt -p rocket-app -p rocket-infra -p rocket-scripting`
Expected: no errors.

- [ ] **Step 6: Update the docs**

1. `docs/superpowers/specs/2026-10-07-rok-js-api-parity-b-async-design.md`, the "Known limits" bullet (about line 90): append `Both limits are closed by R-66, see 2026-11-01-rok-script-writes-reach-request-design.md.`
2. `docs/superpowers/plans/rok-parity-b/00-plan-index.md`, ruling 11, after "**Known limits:** ...": append `(Closed by R-66: docs/superpowers/specs/2026-11-01-rok-script-writes-reach-request-design.md.)`
3. `docs/features/rok-api-parity-notes.md`, line 12 (row B): replace "Follow-ups are roadmap R-66 (re-resolve the outer request after the pre-request script) and R-67 (review minors)." with "R-66 is done: after the pre-request scripts, a placeholder whose value any scope changed gets the new value, nested runs included, and a nested run sees its caller's unsaved writes (spec `2026-11-01-rok-script-writes-reach-request-design.md`). The open follow-up is R-67 (review minors)."
4. `docs/features/rok-api-parity-notes.md`, in the same row or the behaviour section: add "A pre-request `rok.setEnvVar` (or a global or collection write) now also changes the request being sent, not only later sends. Bruno behaves the same way."
5. `docs/roadmaps/roadmap.md`, row R-66: status `done (on main)`; Where `spec specs/2026-11-01-rok-script-writes-reach-request-design.md, plans plans/rok-r66/`; What remains `Manual check in plans/rok-r66/02-nested-run-sees-pending-writes.md.` Remove the `req.setHeader` workaround text from that row.

---

## End of Plan 02. Verify

- `cargo test -j4 -p rocket-app`, `cargo test -j4 -p rocket-infra run_request` and `cargo test -j4 -p rocket-scripting` pass.
- `cargo clippy -j4 -p rocket-app -p rocket-infra -p rocket-scripting --tests` shows no new warning in the changed files.
- Stop and show the user the whole plan's change (do not commit). After the user's OK, commit through `dev-workflow-skills:1-git-commit` with explicit paths, for example:
  - `crates/rocket-scripting/src/host.rs`, `crates/rocket-scripting/src/lib.rs`, `crates/rocket-infra/src/scripting/ops/host.rs`, `crates/rocket-infra/src/scripting/engine.rs`, `crates/rocket-app/src/execution_service.rs`, `crates/rocket-app/src/execution_service/script_host.rs`, `crates/rocket-app/src/execution_service/script_host_tests.rs`: `feat(scripting): let a nested runRequest see the caller's unsaved writes`
  - the four docs files plus `docs/superpowers/specs/2026-11-01-rok-script-writes-reach-request-design.md` and `docs/superpowers/plans/rok-r66/`: `docs: record R-66 as done`

## Manual check (real app, `yarn tauri dev`)

1. Collection with `auth/login.yml` whose post-response script runs `rok.setEnvVar('token', res.body.token)` against a server that returns a token, and `main.yml` with header `Authorization: Bearer {{token}}` and pre-request `await rok.runRequest('auth/login');`. Send `main`. The Timeline shows the new token on the main request in the first send, with no `req.setHeader`.
2. Mark `token` secret in the environment and repeat. The Console and History show the header masked.
3. Collection Runner over the same collection: the `main` step sends the fresh token.
4. In `main`'s pre-request script, run `rok.setEnvVar('user', 'alice'); await rok.runRequest('auth/login');` with login's header `X-User: {{user}}`. The login request sends `alice`.

## Self-Review

- Spec Design 3 → Tasks 1 and 2. Testing 8 → Task 2 (`..._unsaved_env_write`, `..._pending_delete_...`); 9 → `a_pending_value_holding_a_vault_secret_stays_in_runtime`. Docs → Task 2 Step 6.
- Names across tasks: `PendingWrites { env, global_env, collection }`, `HostRunRequest::pending`, `write_text`, `pending_writes`, `overlay_pending_writes(input, state, pending)`, `execute_nested(.., runtime, pending, ..)`, `PhaseState::pending`.
- Not covered by tests: "nothing is saved early" (index deviation 7) and a pending global write end to end (the test repository serves one environment for every name, so it cannot tell global from env).
