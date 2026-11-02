# Flow script scope follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five gaps left by the script-source placeholder change: one scope per node, callback/dynamic/nested variables in scripts, JSON-escaped and used-`process.env` masking, and run-cache invalidation for script and Input nodes.

**Architecture:** A `ScriptScope` struct (in `flow_execution_service.rs`) holds the lazily built variable map and the extra masks for one node. The resolver takes a lookup closure so dynamic names work. Masking additions flow from the scope into `secret_values` and `trace_masks` before the script runs. The run cache gets a one-way hash of resolved plain-scope text.

**Tech Stack:** Rust, `rocket-app`, `rocket-environment` (nested expansion, dynamic vars).

**Spec:** `docs/superpowers/specs/2026-11-03-flow-script-scope-followups-design.md` (builds on `2026-11-02-flow-script-source-placeholders-design.md`). Work continues on branch `feat/flow-script-source-placeholders`.

## Global Constraints

- A resolved value is never scanned again. Nested expansion works on variable values only, never on the script source.
- Response data never reaches the resolver as source. `apply_wired_overrides` and `LiteralFields` do not change.
- Dynamic names (`{{$guid}}`) use `rocket_environment::dynamic_vars::generate`. Generated values are not masked.
- Used `process.env` values of 6 or more characters (`MIN_REDACTION_LEN`) are masked per node, before the script runs and before `record_wire`.
- The run-cache hash covers plain scope values only (global, collection, environment). RocketVault and `process.env` are not included. Request nodes stay unchanged (decision D5). The resolved text is never stored.
- No panicking calls in production code. Cargo with `-j4`, never `--workspace`. Comments are short full sentences with end punctuation.
- 📖 Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md` (variable resolution scope).

## Review Focus

- A value containing `{{other}}` must be inserted as text, not resolved again: Task 1.
- A node with several wires must warn about a withheld `process.env` once: Task 1.
- A password with `"` and `\` through `JSON.stringify` and `console.log` must be masked in logs, trace and step error: Task 2.
- An OS `process.env` value used in a script or Input node is masked, and one not used stays visible: Task 2.
- A changed plain variable invalidates a cached script node, and an unchanged one does not: Task 3.

---

### Task 1: ScriptScope, callbacks, dynamic and nested variables

**Files:**
- Modify: `crates/rocket-app/src/flow_script_literals.rs`
- Modify: `crates/rocket-app/src/flow_execution_service.rs` (`resolve_script_source` ~2255, its three call sites, tests)

**Interfaces:**
- Produces: `pub(crate) fn resolve_script_literals_with(source: &str, lookup: &mut dyn FnMut(&str) -> Option<String>) -> String` in `flow_script_literals.rs`. The existing `resolve_script_literals(source, &HashMap)` stays and calls it.
- Produces: `struct ScriptScope` in `flow_execution_service.rs` with `fn resolve(&mut self, exec: &RequestExecutionService, input: &RunFlowInput, ctx: &NodeRunContext, external_secrets: &HashMap<String, String>, callbacks: &HashMap<String, String>, logs: &mut Vec<FlowLogEntry>, source: &str) -> String`, and `fn extra_masks(&self) -> &HashSet<String>` (used by Task 2).
- Replaces: the free function `resolve_script_source`. Its three call sites (Output wire, Request wire loop, Transform) take one `ScriptScope` created at the top of `execute_node`.

- [ ] **Step 1: Write the failing tests.** In `flow_script_literals.rs`: `lookup_closure_resolves_names` (a closure returns `Some("x")` for `a`, and the result escapes it), `dynamic_name_comes_from_the_closure`. In `flow_execution_service.rs` `mod tests` (reuse `secret_var_exec`, `request_flow_node`, `wire`, `run_input`, `RecordingExecutor`):
  - `a_script_resolves_a_callback_variable`: a script `return '{{callback.hook}}';` sees the registered callback URL.
  - `a_script_resolves_a_dynamic_name`: `return '{{$guid}}';` returns a UUID-shaped value (36 chars), and two occurrences differ.
  - `a_script_resolves_a_nested_variable`: variable `base=ann`, `user={{base}}`, script `'{{user}}'` returns `ann`.
  - `a_resolved_value_is_not_scanned_again`: a variable whose value is the text `{{apiKey}}` is inserted as that text.
  - `a_node_with_several_wires_warns_once_about_withheld_process_env`: two wire scripts naming `{{process.env.HOME}}` with the gate closed add exactly one withheld log.
- [ ] **Step 2: Run** `cargo test -j4 -p rocket-app flow_script_literals` and `cargo test -j4 -p rocket-app flow_execution_service::tests::a_script_resolves` and expect FAIL.
- [ ] **Step 3: Implement `resolve_script_literals_with`** by moving the lookup into the closure form (`scan` already takes a `&mut dyn FnMut`). The `HashMap` version wraps it. Escape every returned value with `escape_value`.
- [ ] **Step 4: Implement `ScriptScope`.** It keeps `vars: Option<HashMap<String, String>>`, `masks: HashSet<String>` and `warned: bool`. On the first source with `{{`, build `vars` once: `exec.variable_context_with_process_env(...)` with the host `process.env` map whenever `ctx.process_env.allowed`, then extend with `callbacks`, then expand nested values using `execution_service::expanded_send` (a `VariableContext` is needed: use the same builder `variable_context_with_process_env` uses; if it is not reachable, add a small `pub(crate)` accessor in `execution_service.rs`). Add the recorded `secret_forms` to `masks`. The lookup closure answers `$`-prefixed names with `rocket_environment::dynamic_vars::generate` and every other name from `vars`. The withheld warning is pushed once, the first time a source names `process.env` while the gate is closed.
- [ ] **Step 5: Replace the three call sites** (Output wire, Request wire loop, Transform) with one `ScriptScope::default()` created near `secret_values` in `execute_node`. Delete `resolve_script_source`.
- [ ] **Step 6: Run** `cargo test -j4 -p rocket-app flow_` and expect all PASS, then `cargo clippy -j4 -p rocket-app` with no warnings. Existing #129 tests must still pass.
- [ ] **Step 7: Commit** with an explicit-path pathspec commit, message `feat(flow): one scope per node with callback, dynamic and nested variables in scripts`.

### Task 2: JSON-escaped and used-process.env masking

**Files:**
- Modify: `crates/rocket-app/src/redaction.rs`
- Modify: `crates/rocket-app/src/execution_service/sent_request.rs` (use the shared helper)
- Modify: `crates/rocket-app/src/flow_execution_service.rs` (mask building ~1673-1691, the Request `sent_secret` rebuild ~1902, run-level `masking_secrets` ~1456, the Input arm ~1696, tests)

**Interfaces:**
- Consumes: `ScriptScope::extra_masks` from Task 1.
- Produces: `pub(crate) fn json_escaped_form(value: &str) -> Option<String>` in `redaction.rs` (the JSON string content without the outer quotes, `None` when equal to the input).
- Produces: `ScriptScope` reports the `process.env` values its lookup used (6 or more characters), and `execute_node` adds them with their escaped and JSON forms to `secret_values` and `trace_masks` before the script runs.

- [ ] **Step 1: Write the failing tests.** `json_escaped_form_covers_quotes_backslashes_and_controls` and `json_escaped_form_is_none_for_plain_text` in `redaction.rs`. In `flow_execution_service.rs` tests:
  - `a_json_stringified_secret_with_quotes_is_masked_in_logs`: secret `pa"ss\word1`, script `const d = JSON.stringify({p: '{{apiKey}}'}); console.log(d); return d;`. No log, trace value or step contains the raw, JS-escaped or JSON-escaped form.
  - `a_used_os_process_env_value_is_masked`: with the gate open and an OS-sourced `process.env` value of 6 or more characters, a script that logs `'{{process.env.NAME}}'` shows only the redaction marker.
  - `an_unused_os_process_env_value_is_not_masked`: another OS value that the script does not name stays visible if it appears in a log.
  - `an_input_node_masks_a_used_os_process_env_value`: an Input node value `{{process.env.NAME}}` is masked in its trace step.
- [ ] **Step 2: Run** the new tests and expect FAIL.
- [ ] **Step 3: Implement `json_escaped_form`** in `redaction.rs` from the inline block in `sent_request.rs` (lines ~64-75), and make `sent_request.rs` call it.
- [ ] **Step 4: Add the JSON form** next to every place that adds `escape_value(v)` to the masks (the `escaped_forms` loop ~1681-1686), and add both forms to the Request `sent_secret` rebuild and the run-level `masking_secrets`.
- [ ] **Step 5: Mask used `process.env` values.** `ScriptScope` records the values of the `process.env.*` names its lookup answered. Add them, with their escaped and JSON forms, to the node's `secret_values` and `trace_masks` before the script runs. Do the same in the Input arm for the names it resolves.
- [ ] **Step 6: Run** `cargo test -j4 -p rocket-app flow_`, `cargo test -j4 -p rocket-app redaction` and `cargo clippy -j4 -p rocket-app` and expect PASS and no warnings.
- [ ] **Step 7: Commit** with an explicit-path pathspec commit, message `fix(flow): mask JSON-escaped secrets and used process env values in script logs`.

### Task 3: Run-cache invalidation and docs

**Files:**
- Modify: `crates/rocket-app/src/flow_run_cache.rs` (`fingerprints` ~455, its tests)
- Modify: the production callers of `fingerprints` (find them with `grep -rn "fingerprints(" crates`), `crates/rocket-app/src/flow_execution_service.rs` if the closure is built there
- Modify: `docs/features/collection-trust.md` and the Flow run-cache doc (find it with `grep -rln "run cache\|partial run" docs/features`)

**Interfaces:**
- Produces: `fingerprints(flow, order, saved_request, resolved: &dyn Fn(&str) -> Option<u64>) -> HashMap<String, u64>`. The new closure returns a one-way hash of the resolved text of a source that contains `{{`, or `None`.
- Consumes: the plain-scope variable map (global, collection, environment). It must not include RocketVault or `process.env` values.

- [ ] **Step 1: Write the failing tests** in `flow_run_cache.rs`:
  - `a_script_with_a_placeholder_changes_its_fingerprint_when_the_value_changes`: the closure returns `Some(1)` then `Some(2)` for the same Transform script containing `{{x}}`, and the fingerprints differ.
  - `a_script_without_a_placeholder_ignores_the_resolved_closure`: a script with no `{{` has the same fingerprint for any closure answer.
  - `an_input_node_with_a_placeholder_follows_the_resolved_hash`.
  - `a_request_node_does_not_follow_the_resolved_hash` (D5): a Request node's fingerprint is unchanged by the closure.
  Update the existing tests to pass `&|_| None` for the new argument.
- [ ] **Step 2: Run** `cargo test -j4 -p rocket-app flow_run_cache` and expect FAIL (arity).
- [ ] **Step 3: Implement** the new argument. For a Transform script, an Input value and each incoming edge expression that contains `{{`, hash `resolved(text)` into the node's hasher in addition to the unresolved text. Hash with the existing `DefaultHasher`. Never store the resolved text.
- [ ] **Step 4: Wire the production caller.** Build the closure from the plain-scope map (`variable_context_with_process_env` with empty `external_secrets` and an empty `process.env` map), run the literal resolver (strings only for scripts, the full `rocket_environment::resolve` for Input values), and hash the result. Add a flow-level test: a partial run re-runs a script node after a plain variable it uses changes and reuses it when nothing changed.
- [ ] **Step 5: Run** `cargo test -j4 -p rocket-app flow_` and `cargo clippy -j4 -p rocket-app` and expect PASS and no warnings.
- [ ] **Step 6: Docs.** In `collection-trust.md` update the wired-values bullet: the script scope now includes callback, dynamic and nested variables, one scope per node, and used `process.env` values are masked. In the run-cache doc add: script and Input nodes with `{{` follow plain-scope values, a changed RocketVault or `process.env` value does not invalidate a cached run, Request nodes follow decision D5.
- [ ] **Step 7: Commit** with an explicit-path pathspec commit, message `feat(flow): invalidate cached script and Input nodes when plain variables change`.
