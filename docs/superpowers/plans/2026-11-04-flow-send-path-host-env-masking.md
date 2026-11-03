# Send-path host env masking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Request's own History URL, `RequestExecuted` event URL and executor error text hide the host `process.env` values the send used, and the logged follow-ups are closed.

**Architecture:** A shared `mask_forms` helper in `redaction.rs` builds the mask set for a host value. `begin_phases` adds the send's own used host values and a new skip-serialized `extra_mask_values` set (upstream Flow values) to `var_ctx.secret_values`, which the History URL, event URL, executor error and script console already read. The plan-time Flow scope becomes lazy.

**Tech Stack:** Rust, `rocket-app` crate.

**Spec:** `docs/superpowers/specs/2026-11-04-flow-send-path-host-env-masking-design.md`

## Global Constraints

- 📖 Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md` (variable resolution scope).
- Masks only grow. `MIN_REDACTION_LEN` (6) stays the floor: a value under it produces no mask and no escaped form.
- `extra_mask_values` is `#[serde(skip)]`, defaults empty, and is set only by backend code.
- Used host values are not added to the vault write guard (`vault_forms`) and are not held back from saves.
- `plain_placeholder_hash` and `fingerprints` keep their `Option` shape.
- No panicking calls in production code. Comments are short full sentences ending with a period.
- Run cargo with `-j4`, never `--workspace`. Each OS-env test sets its own uniquely named variable (`ROCKET_TEST_HOST_<name>`) and removes it at the end.

## Review Focus

- A host value used only by a Request's own URL must not appear in its History URL, event URL or executor error (Task 1).
- A multi-line host value (PEM) logged line by line must be masked (Task 1 and 2).
- A host value used by an upstream Flow node must not appear in a later Request's History URL (Task 2).
- A short host value (under 6 chars) must not blank ordinary text (Task 1).
- A run with no `{{` text must not read variable scopes or the keychain at plan time (Task 3).

---

### Task 1: `mask_forms` helper and send-path masking

**Files:**
- Modify: `crates/rocket-app/src/redaction.rs` (add helper and tests)
- Modify: `crates/rocket-app/src/execution_service.rs` (`ExecuteRequestInput` field, `begin_phases` ~2625, the nine struct literals that list `backend_process_env:`, tests)
- Modify: `crates/rocket-app/src/flow_execution_service.rs` (remove `add_escaped_forms` ~2356, use `mask_forms` at its four callers: ~845, ~1545, ~1762, ~2000, ~2471)

**Interfaces:**
- Produces: `pub(crate) fn mask_forms(values: impl IntoIterator<Item = String>) -> HashSet<String>` in `redaction.rs`. For each value of `MIN_REDACTION_LEN` or more bytes it returns `redaction_forms(v)` plus, for each of those forms, `crate::flow_script_literals::escape_value(form)` and `json_escaped_form(form)` (when `Some`). Values below the floor produce nothing.
- Produces: `ExecuteRequestInput.extra_mask_values: std::collections::HashSet<String>` with `#[serde(skip)]` and a doc comment: "Host values an earlier Flow node used. Masked like the send's own used values. Never read from or written to the wire."

- [ ] **Step 1: Write failing tests** in `redaction.rs` `mod tests`:
  - `mask_forms_adds_escaped_and_json_forms`: `mask_forms(["pa\"ss\\word1".into()])` contains the raw value, its `escape_value` form and its `json_escaped_form`.
  - `mask_forms_splits_multi_line_values`: input `"-----BEGIN KEY-----\nabcdefghij\n-----END KEY-----"`; the result contains `"abcdefghij"` and `"-----BEGIN KEY-----"`.
  - `mask_forms_skips_short_values`: `mask_forms(["abc12".into()])` is empty.

  In `execution_service.rs` `mod tests`, using the existing helpers near `used_os_value_is_reported_in_run_process_env_values` (~13910) and a unique env var `ROCKET_TEST_HOST_SEND` set to `host-secret-value-77`:
  - `history_url_hides_a_used_host_value`: request URL `http://127.0.0.1:<port>/{{process.env.ROCKET_TEST_HOST_SEND}}` with `backend_process_env = true` and the trust gate open. Assert the saved History entry URL and the published `RequestExecuted` URL (use the test event recorder already in this file; if none exists for events, assert through the same `NullEventPublisher` replacement the neighbouring tests use) do not contain `host-secret-value-77`.
  - `executor_error_hides_a_used_host_value`: same URL with an executor that fails and echoes the URL in its error. Assert the returned error text lacks the value.
  - `extra_mask_values_hide_an_upstream_value_in_the_history_url`: a plain URL that contains the literal text `upstream-host-value-9` and `input.extra_mask_values = {"upstream-host-value-9"}`. Assert the History URL lacks it.
  - `extra_mask_values_never_cross_the_wire`: serialize an `ExecuteRequestInput` with a non-empty set and assert the JSON has no `extra_mask_values` key and none of its values.

- [ ] **Step 2: Run** `cargo test -j4 -p rocket-app mask_forms` and the four new test names. Expect FAIL (missing function or field).

- [ ] **Step 3: Implement** `mask_forms` in `redaction.rs` as described above. Replace `add_escaped_forms(&mut set)` callers in `flow_execution_service.rs` with `set.extend(mask_forms(...))` over the values that were in the set (a value already present stays), then delete `add_escaped_forms`. Keep behaviour: the raw value stays in the set when it is at least `MIN_REDACTION_LEN` long.

- [ ] **Step 4: Add the field** `extra_mask_values` to `ExecuteRequestInput` and set `extra_mask_values: Default::default()` in the nine struct literals (find them with `grep -rn "backend_process_env:" crates src-tauri/src`).

- [ ] **Step 5: In `begin_phases`**, right after the `dot_env_values` extend (~2627), add `var_ctx.secret_values.extend(crate::redaction::mask_forms(process_env.used_values.iter().cloned()))` and the same for `input.extra_mask_values.iter().cloned()`. Add a short comment that `used_values` is fixed at the first resolution pass.

- [ ] **Step 6: Run** `cargo test -j4 -p rocket-app mask_forms`, the four new tests, then `cargo test -j4 -p rocket-app execution_service` and `cargo test -j4 -p rocket-app flow_execution_service`. Expect all PASS. Run `cargo clippy -j4 -p rocket-app` (no new warnings).

- [ ] **Step 7: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths only, message `fix(flow): mask a send's own used host process.env values in history, event and error`.

### Task 2: Flow carries upstream host values into each send

**Files:**
- Modify: `crates/rocket-app/src/flow_execution_service.rs` (Request arm ~1950-2040, `record_used_host_values` ~840, tests)

**Interfaces:**
- Consumes: `mask_forms`, `ExecuteRequestInput.extra_mask_values` from Task 1.

- [ ] **Step 1: Write failing tests** next to the existing host-value masking tests in `flow_execution_service.rs` (unique env vars `ROCKET_TEST_HOST_UP` = `upstream-host-value-9`, `ROCKET_TEST_HOST_PEM` = a three-line PEM-like value):
  - `a_later_request_hides_an_upstream_host_value_in_its_history_url`: Input node reads `{{process.env.ROCKET_TEST_HOST_UP}}`, wired into the URL path of a Request that runs against the mock executor. Assert the step's History record / debug record URL and the run's published events lack the value.
  - `a_request_records_its_own_host_values_for_later_nodes`: Request `a` uses `{{process.env.ROCKET_TEST_HOST_UP}}` in its URL, a later Transform script logs the same value from a response body. Assert the Transform log is masked.
  - `a_multi_line_host_value_logged_line_by_line_is_masked`: Input reads `ROCKET_TEST_HOST_PEM`, a wire script logs one line of it. Assert the log lacks that line.
  - `a_short_host_value_gets_no_escaped_forms`: record a 5-char value with `record_used_host_values` and assert `used_host_values()` is empty.

- [ ] **Step 2: Run** the four tests. Expect FAIL.

- [ ] **Step 3: Implement.** In the Request arm, before `execute_capturing`, set `request_input.extra_mask_values = ctx.used_host_values()`. After the send (both `Ok` and `Err` paths where an output exists), call `ctx.record_used_host_values(output.run_process_env_values.iter().cloned())`. Make `record_used_host_values` call `mask_forms` (already done in Task 1; confirm).

- [ ] **Step 4: Run** `cargo test -j4 -p rocket-app flow_execution_service`. Expect all PASS. `cargo clippy -j4 -p rocket-app` clean.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, message `fix(flow): carry used host values into later Request sends' masks`.

### Task 3: Lazy plan scope, test cleanup, docs

**Files:**
- Modify: `crates/rocket-app/src/flow_execution_service.rs` (~1203-1236 plan-time `plain_vars`, OS-env tests)
- Modify: `crates/rocket-app/src/flow_run_cache.rs` (tests)
- Modify: `crates/rocket-app/src/flow_script_literals.rs` (tests)
- Modify: `crates/rocket-app/src/execution_service.rs` (OS-env tests that use real `PATH`/`HOME` to prove a value was used)
- Modify: `docs/features/collection-trust.md`, `crates/rocket-app/CLAUDE.md`

- [ ] **Step 1: Write failing/updated tests.**
  - `flow_run_cache.rs`: replace the vacuous `a_dynamic_name_inside_a_value_keeps_the_hash_stable` with: text `{{A}}` hashed with `A = "x-{{$guid}}"` and with `A = "x-{{$timestamp}}"` yields equal hashes, and `A = "y-{{$guid}}"` yields a different hash.
  - `flow_run_cache.rs` `a_chain_deeper_than_the_cap_stops_following`: variables `V0 = "{{V1}}"` ... `V9 = "end"`; hashing `{{V0}}` changes when `V8` changes and does not change when `V10`-level text (add `V9 = "{{V10}}"`, `V10 = "x"`) changes.
  - `flow_script_literals.rs`: a line comment `// {{x}}` ended by `\u{2028}`, by `\u{2029}` and by `\n`, followed by `'{{x}}'`: the string after the comment resolves in all three, and the comment text is unchanged.
  - `flow_execution_service.rs` `a_run_without_placeholders_reads_no_variable_scopes`: a flow whose scripts and Inputs have no `{{`; use a counting `external_secrets`/scope probe if one exists, otherwise assert through a new `#[cfg(test)]` counter on the lazy cell build (documented in the test). The counter stays 0 after a run, and becomes 1 when one script has `{{`.
  - Convert OS-env tests that read real `PATH`/`HOME` as the "used" value to a unique `ROCKET_TEST_HOST_<name>` variable (set before, remove after). Leave `PATH`/`HOME` only in tests that check "not a `.env` key" (`dot_env_values_appear_when_the_gate_allows` ~8813 and `build_variable_context_with_process_env_exposes_dot_env_values_as_process_env_keys` ~9017).

- [ ] **Step 2: Run** the new tests and expect FAIL where a counter or behaviour is missing.

- [ ] **Step 3: Make `plain_vars` lazy.** Hold it in a `std::cell::OnceCell<HashMap<String, String>>` built by `exec.flow_variable_scopes(...).flatten()` on first use inside the `resolved(text)` closure passed to `fingerprints`. Update the comment above the planning step: the scopes are read only when some text has `{{`.

- [ ] **Step 4: Update docs.** `docs/features/collection-trust.md`: the History URL, `RequestExecuted` URL, executor error and script console now mask the send's own used host values and, in a Flow, those of earlier nodes, for every backend caller; a value introduced only after a pre-request script is not covered. Remove the old "can still show" limit text. `crates/rocket-app/CLAUDE.md`: same one-line update if the old limit is mentioned, and note that planning reads scopes lazily. Add a manual check: run a Flow whose Input reads a host variable, wire it into a Request URL, confirm the History URL shows the masked value.

- [ ] **Step 5: Run** `cargo test -j4 -p rocket-app` for `flow_run_cache`, `flow_script_literals`, `flow_execution_service`, `execution_service`, then `cargo check -j4` and `cargo clippy -j4 -p rocket-app`. Expect all PASS and no new warnings.

- [ ] **Step 6: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths only, message `fix(flow): read plan-time scopes lazily and close masking test gaps`.
