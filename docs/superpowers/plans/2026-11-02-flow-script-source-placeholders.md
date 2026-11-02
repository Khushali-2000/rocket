# Flow script source placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `{{name}}` written inside a string literal of a Flow wire or Transform script resolves before the script runs, while text from a response stays literal.

**Architecture:** A pure resolver (`flow_script_literals.rs`) rewrites the script source, escaping each value for the quote type it lands in. `flow_execution_service.rs` calls it before the three script call sites (Output wire, Request wire, Transform), using the Input node's scope. Wired output stays literal (`LiteralFields` is untouched), so #129 stays closed.

**Tech Stack:** Rust, `rocket-app` crate. The resolver does its own scan and does not use `rocket_environment::resolve`.

**Spec:** `docs/superpowers/specs/2026-11-02-flow-script-source-placeholders-design.md`

## Global Constraints

- Scope: global < collection < environment, RocketVault via `external_secrets`. No folder or request variables, no `{{callback.*}}`.
- `process.env` follows the per-run gate (`ctx.process_env`). A withheld name adds `process_env_withheld_entry()`.
- Values are escaped for every string kind: `\`, `'`, `"`, `` ` ``, `$`, `\n`, `\r`, U+2028, U+2029. A `{{` is a placeholder only when its name has no quote, backtick, backslash or newline.
- Unresolved names stay as written. A replaced value is never scanned again.
- `apply_wired_overrides`, `LiteralFields` and the send-time passes do not change.
- Production code uses explicit error mapping, no panicking calls. Run cargo with `-j4`, never `--workspace`.
- 📖 Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md` (variable resolution scope).

## Review Focus

- A value containing a quote, backslash or newline must leave the script valid and unchanged in meaning: covered in Task 1.
- `{{x}}` in a comment or bare code must not be replaced: Task 1.
- A value that itself contains `{{y}}` must not resolve again: Task 1.
- `response.body` holding `{{apiKey}}` must still go out literal (#129): Task 2.
- A secret resolved into a script and logged must be masked: Task 2.

---

### Task 1: Script literal resolver

**Files:**
- Create: `crates/rocket-app/src/flow_script_literals.rs`
- Modify: `crates/rocket-app/src/lib.rs` (add `mod flow_script_literals;` next to the other flow modules)

**Interfaces:**
- Produces: `pub(crate) fn resolve_script_literals(source: &str, vars: &HashMap<String, String>) -> String`
- Produces: `pub(crate) fn script_names_process_env(source: &str) -> bool` (true when a `{{process.env.…}}` name sits inside a string literal, so the caller copies the host map only then)

- [ ] **Step 1: Write the failing tests** in a `#[cfg(test)] mod tests` of the new file. Each test calls `resolve_script_literals` with `vars = {username: "ann", pw: "p\"w\\\n", nested: "{{username}}"}`:
  - `single_quote_string_is_replaced`: `return '{{username}}';` gives `return 'ann';`.
  - `double_quote_string_is_replaced`: same with `"…"`.
  - `template_string_is_replaced`: `` `u={{username}}` `` gives `` `u=ann` ``.
  - `value_is_escaped_for_the_quote`: `'{{pw}}'` gives a string whose backslash and newline are escaped (`\\` and `\n`). In a `"` string the quote is also escaped as `\"`.
  - `template_value_escapes_backtick_and_dollar_brace`: a var `a` = `` `${x} `` in a template gives `` \`\${x} ``.
  - `comment_and_bare_code_are_left_alone`: `// {{username}}\n/* {{username}} */ x({{username}})` is unchanged.
  - `template_hole_code_is_left_alone`: `` `a ${ f('{{username}}') } b` `` resolves the inner `'…'` string but no other code.
  - `unknown_name_stays`: `'{{nope}}'` is unchanged.
  - `replaced_value_is_not_scanned_again`: `'{{nested}}'` gives `'{{username}}'`.
  - `escaped_quote_does_not_end_the_string`: `'it\'s {{username}}'` gives `'it\'s ann'`.
  - `names_process_env_only_inside_strings`: `script_names_process_env("'{{process.env.A}}'")` is true, `"x({{process.env.A}})"` is false.

- [ ] **Step 2: Run** `cargo test -j4 -p rocket-app flow_script_literals` and expect FAIL (functions missing).

- [ ] **Step 3: Implement** both functions with a single-pass char scanner. States: code, line comment, block comment, string with quote `'`, `"` or `` ` ``. A `\` in a string skips the next char. In a template string, `${` pushes a code state with a brace depth counter and `}` at depth 0 returns to the template string. Inside a string, on `{{`, read to the first `}}`, trim the name, and when `vars` has it, append the escaped value, else append the original `{{…}}` text. Never re-scan appended text. Name lookup is a plain `HashMap::get` on the trimmed name (the same keys the Input node uses).

- [ ] **Step 4: Run** `cargo test -j4 -p rocket-app flow_script_literals` and expect all PASS. Run `cargo clippy -j4 -p rocket-app` and expect no new warnings.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, `git add` only the two files, message `feat(flow): resolve placeholders in script string literals`.

### Task 2: Wire it into Flow scripts, test, document

**Files:**
- Modify: `crates/rocket-app/src/flow_execution_service.rs` (helper near `execute_node`, three call sites at the Output wire arm ~1740, the Request wire arm ~1815 and the Transform arm ~2030, and tests in `mod tests`)
- Modify: `docs/features/collection-trust.md` (wired-values bullet), `docs/roadmaps/flow-roadmap.md` if an item covers wire scripts

**Interfaces:**
- Consumes: `resolve_script_literals`, `script_names_process_env` from Task 1.
- Produces: `fn resolve_script_source(exec: &RequestExecutionService, input: &RunFlowInput, ctx: &NodeRunContext, external_secrets: &HashMap<String, String>, logs: &mut Vec<FlowLogEntry>, source: &str) -> String`. It returns `source` unchanged, without building a scope, when it has no `{{`.

- [ ] **Step 1: Write the failing tests** next to `wired_values_never_resolve_collection_variables` (reuse `secret_var_exec`, `request_flow_node`, `wire`, `run_input`, `RecordingExecutor`):
  - `a_wire_script_resolves_placeholders_in_its_own_source`: edge expression `return JSON.stringify({u: '{{apiKey}}'});` from request `a` into the body of `b`. Assert the sent body of `b` contains `k-123`.
  - `a_transform_script_resolves_placeholders_in_its_own_source`: Transform `return '{{apiKey}}';` wired into a header. Assert the sent header value is `k-123`.
  - `response_text_through_a_script_stays_literal` (the #129 guard): `a` returns body `{{apiKey}}`, edge expression `response.body`, target the body of `b`. Assert the sent body is exactly `{{apiKey}}`.
  - `a_script_cannot_pull_a_placeholder_out_of_response_data`: edge expression `return '{{' + 'apiKey' + '}}';`. Assert the sent body is `{{apiKey}}` (built at run time, not written in the source).
  - `a_logged_resolved_secret_is_masked`: wire script `console.log('{{apiKey}}'); return 'x';` with `apiKey` marked secret. Assert no step log or trace value contains `k-123`.
  - `a_withheld_process_env_name_adds_one_warning`: source `'{{process.env.HOME}}'` with the gate closed. Assert one `process_env_withheld_entry` log and the text unresolved.

- [ ] **Step 2: Run** `cargo test -j4 -p rocket-app flow_execution_service` with each new test name and expect FAIL.

- [ ] **Step 3: Implement `resolve_script_source`** with the signature above. Build the scope as the Input arm does: `exec.variable_context_with_process_env(input.global_env_name.as_deref(), Some(&input.collection), input.environment_name.as_deref(), None, external_secrets, host_map)`, where `host_map` is `&ctx.process_env.vars` only when `script_names_process_env(source)` and the gate allows, else an empty map. A withheld name pushes `to_flow_logs(vec![process_env_withheld_entry()])` into `logs`. Return `resolve_script_literals(source, &vars)`.

- [ ] **Step 4: Call it** at the three sites: pass the result instead of `&edge.expression` to `resolve_flow_wire_expression`, and instead of `script` to `evaluate_flow_transform_value`. Keep the original `edge.expression` for error messages and traces. `resolve_flow_wire_expression` and `evaluate_flow_transform_value` themselves do not change.

- [ ] **Step 5: Run** `cargo test -j4 -p rocket-app flow_execution_service` and expect all PASS, including the existing `wired_values_never_resolve_collection_variables`, `a_script_variable_never_fills_a_wired_value` and `a_script_that_edits_a_wired_value_never_fills_it`. Then `cargo check -j4` and `cargo clippy -j4 -p rocket-app` with no new warnings.

- [ ] **Step 6: Update docs.** In `docs/features/collection-trust.md` add one sentence to the wired-values bullet: placeholders written inside a string literal of a wire or Transform script resolve first, with the Input node's scope, and the script's output stays literal. Add a manual check (open `app-api-4`, run it, confirm the body, confirm the Console masks the password). Add a roadmap line only if an existing item matches.

- [ ] **Step 7: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths only (the code and doc files), message `fix(flow): resolve placeholders in wire and Transform script sources`.
