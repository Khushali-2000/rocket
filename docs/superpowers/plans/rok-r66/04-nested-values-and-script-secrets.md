# R-66 Plan 04: nested values and script secrets in the Console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Runs after Plan 03 and before Plan 02. Recommended model: Sonnet implementer per task, Opus reviewer.

**Goal:** The backend fills placeholders inside stored variable values (up to 3 levels, never a vault or `process.env` name), and the Console row masks secret values a script wrote.

**Architecture:** `rocket-environment` gets a pure `expand_nested` over a `VariableContext`: it expands only names whose winning layer is a stored scope, looking up names in the flattened scopes without RocketVault keys and `process.env.*`. `resolve_request_parts` uses the expanded map for every field template, and the second pass compares expanded values, expanding a name only while its raw value is unchanged since the first pass. `SentRequest` gains `secret_values`, which `sendRequest` adds to the Console masks.

**Tech Stack:** Rust (`rocket-environment`, `rocket-app`, `src-tauri`), React/TypeScript, Vitest, Bun.

**Spec:** `docs/superpowers/specs/2026-11-01-rok-script-writes-reach-request-design.md`, Design section 7 (tests 15 to 19). Read `00-plan-index.md` first.

## Global Constraints

- 📖 Before starting each task, read `docs/superpowers/specs/opencollection-spec-reference.md`.
- `cargo` commands take `-j4`; never `--workspace` or `--all`. Bun only for the frontend.
- No unwrap calls in production Rust code. Domain crates hold no I/O.
- Nested expansion never fills a RocketVault name (a key of `VariableContext::external_secrets`) or a `process.env.*` name. Runtime values, Flow variables and script-written values are never expanded.
- Depth limit `MAX_NESTED_DEPTH = 3`. A `{{$dynamic}}` name inside values is generated once per send for each name.
- Implementers do not commit.

## Review Focus

1. **Response data pulls a vault value in.** A stored env value `x = {{rv.secret}}` (written earlier from a response) used in a header must send `{{rv.secret}}` as written. Task 1 test `a_vault_name_inside_a_value_stays`, Task 2 test `nested_e2e_a_vault_name_inside_an_env_value_is_sent_as_written`.
2. **The second pass must not see every nested name as changed** (a fresh `$dynamic` or a re-expansion would make `Overrides` non-empty and re-render). Task 2 test `nested_e2e_with_no_script_writes_sends_the_first_pass`.
3. **A secret value with a nested reference** (`token = Bearer {{raw}}`, secret) must be masked in its expanded form. Task 2 test `nested_e2e_an_expanded_secret_value_is_masked`.
4. **A cycle or a self-reference** must stop without a stack overflow or a hang. Task 1 tests `a_cycle_leaves_the_inner_placeholder` and `a_self_reference_stays`.
5. **A script-written value holding `{{host}}`** is sent as written. Task 2 test `nested_e2e_a_runtime_value_is_not_expanded`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `crates/rocket-environment/src/nested.rs` | Create | `MAX_NESTED_DEPTH`, `expand_nested`, unit tests |
| `crates/rocket-environment/src/lib.rs` | Modify | `pub mod nested; pub use nested::{expand_nested, MAX_NESTED_DEPTH};` |
| `crates/rocket-app/src/execution_service.rs` | Modify | Expanded map in `resolve_request_parts`; `first_raw` and expanded `first_values` in `begin_phases`; expanded comparison in `resolve_runtime_placeholders`; secret forms of expanded secret values |
| `crates/rocket-app/src/execution_service/runtime_fill.rs` | Modify | `RequestTemplates::first_raw`, `RequestTemplates::nested_dynamic` |
| `crates/rocket-app/src/execution_service/sent_request.rs` | Modify | `SentRequest::secret_values` |
| `crates/rocket-app/src/execution_service/script_host_tests.rs` | Modify | End-to-end tests |
| `src/lib/tauri-api.ts`, `src/lib/execute-request.ts`, `src/lib/__tests__/execute-request.sent.test.ts` | Modify | `secretValues` in the masks |
| `crates/rocket-app/CLAUDE.md`, `docs/features/console-masking.md` | Modify | Docs |

---

### Task 1: `expand_nested` in `rocket-environment`

**Files:**
- Create: `crates/rocket-environment/src/nested.rs`
- Modify: `crates/rocket-environment/src/lib.rs`

**Interfaces:**
- Consumes: `VariableContext` (fields `runtime`, `request`, `folder`, `env`, `external_secrets`, `collection`, `global_env`; `flatten()`), `dynamic_vars::{is_dynamic_var, generate}`.
- Produces:
  - `pub const MAX_NESTED_DEPTH: usize = 3;`
  - `pub fn expand_nested(ctx: &VariableContext, extra: &HashMap<String, String>, dynamic: &mut HashMap<String, String>) -> HashMap<String, String>`: returns `ctx.flatten()` with `extra` laid on top (Flow variables), where every name whose winning layer is `request`, `folder`, `env`, `collection` or `global_env` has the placeholders in its value filled. A name won by `runtime`, `external_secrets` or `extra` keeps its value. Lookups read the same merged map, except names that are keys of `ctx.external_secrets` and names starting with `process.env.`, which stay as written. A nested name is itself expanded recursively, at most `MAX_NESTED_DEPTH` levels below the top value; past that, or on a name already on the current path (a cycle), the placeholder stays as written. A `$name` is filled from `dynamic`, generating and storing it on first use; an unknown `$name` stays. Unknown names stay. Placeholder syntax and trimming follow `resolver::resolve` (`{{ name }}` trims).

- [ ] **Step 1: Write the failing tests** in `nested.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn m(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn expand(ctx: &VariableContext) -> HashMap<String, String> {
        expand_nested(ctx, &HashMap::new(), &mut HashMap::new())
    }

    #[test]
    fn an_env_value_fills_a_nested_name() {
        let ctx = VariableContext { env: m(&[("baseUrl", "https://{{host}}"), ("host", "api.test")]), ..Default::default() };
        assert_eq!(expand(&ctx)["baseUrl"], "https://api.test");
    }

    #[test]
    fn nested_names_follow_scope_order() {
        // host is in collection and env; env wins inside the expanded value too.
        let ctx = VariableContext {
            collection: m(&[("baseUrl", "https://{{host}}"), ("host", "col.test")]),
            env: m(&[("host", "env.test")]),
            ..Default::default()
        };
        assert_eq!(expand(&ctx)["baseUrl"], "https://env.test");
    }

    #[test]
    fn three_levels_fill_and_the_fourth_stays() {
        let ctx = VariableContext {
            env: m(&[("a", "{{b}}"), ("b", "{{c}}"), ("c", "{{d}}"), ("d", "{{e}}"), ("e", "end")]),
            ..Default::default()
        };
        let out = expand(&ctx);
        assert_eq!(out["b"], "end"); // b -> c -> d -> e: 3 levels below b.
        assert_eq!(out["a"], "{{e}}"); // a -> b -> c -> d: the 4th level stays.
    }

    #[test]
    fn a_cycle_leaves_the_inner_placeholder() {
        let ctx = VariableContext { env: m(&[("a", "x{{b}}"), ("b", "y{{a}}")]), ..Default::default() };
        let out = expand(&ctx);
        assert_eq!(out["a"], "xy{{a}}");
        assert_eq!(out["b"], "yx{{b}}");
    }

    #[test]
    fn a_self_reference_stays() {
        let ctx = VariableContext { env: m(&[("a", "{{a}}!")]), ..Default::default() };
        assert_eq!(expand(&ctx)["a"], "{{a}}!");
    }

    #[test]
    fn a_vault_name_inside_a_value_stays() {
        let ctx = VariableContext {
            env: m(&[("x", "Bearer {{rv.secret}}")]),
            external_secrets: m(&[("rv.secret", "vault-value-123")]),
            ..Default::default()
        };
        assert_eq!(expand(&ctx)["x"], "Bearer {{rv.secret}}");
    }

    #[test]
    fn a_process_env_name_inside_a_value_stays() {
        let ctx = VariableContext { env: m(&[("x", "{{process.env.HOME}}")]), process_env: m(&[("HOME", "/h")]), ..Default::default() };
        assert_eq!(expand(&ctx)["x"], "{{process.env.HOME}}");
    }

    #[test]
    fn runtime_and_extra_values_are_not_expanded() {
        let ctx = VariableContext {
            env: m(&[("host", "api.test")]),
            runtime: m(&[("r", "https://{{host}}")]),
            ..Default::default()
        };
        let out = expand_nested(&ctx, &m(&[("f", "{{host}}")]), &mut HashMap::new());
        assert_eq!(out["r"], "https://{{host}}");
        assert_eq!(out["f"], "{{host}}");
    }

    #[test]
    fn a_stored_value_can_use_a_runtime_value() {
        let ctx = VariableContext {
            env: m(&[("auth", "Bearer {{token}}")]),
            runtime: m(&[("token", "t-1")]),
            ..Default::default()
        };
        assert_eq!(expand(&ctx)["auth"], "Bearer t-1");
    }

    #[test]
    fn a_dynamic_name_is_made_once_per_cache() {
        let ctx = VariableContext { env: m(&[("a", "{{$guid}}"), ("b", "{{$guid}}")]), ..Default::default() };
        let mut dynamic = HashMap::new();
        let out = expand_nested(&ctx, &HashMap::new(), &mut dynamic);
        assert_eq!(out["a"], out["b"]);
        assert_eq!(dynamic["$guid"], out["a"]);
        let again = expand_nested(&ctx, &HashMap::new(), &mut dynamic);
        assert_eq!(again["a"], out["a"]);
    }

    #[test]
    fn unknown_names_stay() {
        let ctx = VariableContext { env: m(&[("a", "{{nope}} {{$nope}}")]), ..Default::default() };
        assert_eq!(expand(&ctx)["a"], "{{nope}} {{$nope}}");
    }
}
```

Check the key the dynamic cache uses against `dynamic_vars::generate`'s argument (with or without `$`) and keep the test's `dynamic["$guid"]` consistent with the choice; say which in the report.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cargo test -j4 -p rocket-environment nested`
Expected: FAIL to compile (`expand_nested` not defined).

- [ ] **Step 3: Implement `nested.rs`** with a recursive helper that carries the current path (a `Vec<&str>` or `HashSet`) and the depth. Doc comment on `expand_nested` states the rules above in short sentences.

- [ ] **Step 4: Run the tests**

Run: `cargo test -j4 -p rocket-environment`
Expected: PASS.

---

### Task 2: The send fills nested values

**Files:**
- Modify: `crates/rocket-app/src/execution_service.rs` (`resolve_request_parts` ~1467-1500, `begin_phases` ~2454, `resolve_runtime_placeholders` ~2748)
- Modify: `crates/rocket-app/src/execution_service/runtime_fill.rs` (`RequestTemplates`)
- Modify: `crates/rocket-app/src/execution_service/script_host_tests.rs`, `crates/rocket-app/src/collection_runner_service.rs` (tests)
- Modify: `crates/rocket-app/CLAUDE.md`

**Interfaces:**
- Consumes: Task 1 `expand_nested(ctx, extra, dynamic)`.
- Produces:
  - `RequestTemplates::first_raw: HashMap<String, String>` (the unexpanded `var_ctx.flatten()` at `begin_phases`, what `first_values` held before this task).
  - `RequestTemplates::first_values` now holds the expanded values.
  - `RequestTemplates::nested_dynamic: HashMap<String, String>` (the `$dynamic` cache of the first pass, reused by the second).

- [ ] **Step 1: Write the failing end-to-end tests** in `script_host_tests.rs`, using `dev_env`, `run_service_over`/`run_service`, `sent_header` and the URL the executor saw:

1. `nested_e2e_an_env_value_fills_a_nested_name`: env `baseUrl = https://{{host}}`, `host = api.test`; a request with URL `{{baseUrl}}/x` and header `X-B: {{baseUrl}}` sends URL `https://api.test/x` and header `https://api.test`.
2. `nested_e2e_a_script_change_reaches_the_nested_name`: same env; pre-request `rok.setEnvVar('host', 'new.test')`; the URL is `https://new.test/x`.
3. `nested_e2e_a_runtime_value_is_not_expanded`: pre-request `rok.setVar('r', 'https://{{host}}')`; header `X-R: {{r}}` sends `https://{{host}}`.
4. `nested_e2e_a_vault_name_inside_an_env_value_is_sent_as_written`: env `x = Bearer {{rv.secret}}`, the vault binding as the existing vault tests build it; header `X-V: {{x}}` sends `Bearer {{rv.secret}}`. If the file has no vault fixture, put this test next to the existing vault tests in `execution_service.rs` and say so.
5. `nested_e2e_with_no_script_writes_sends_the_first_pass`: env `a = {{$guid}}-{{host}}`, `host = h`; a pre-request script that only logs; header `X-A: {{a}}`; assert the header matches `^[0-9a-f-]{36}-h$` and, through a unit-level check in the same style as `with_no_script_writes_only_runtime_names_are_overrides`, that `Overrides::between` over the stored values is empty.
6. `nested_e2e_an_expanded_secret_value_is_masked`: env secret `token = Bearer {{raw}}`, env `raw = raw-value-123456`; header `Authorization: {{token}}`; the History entry and the Console output do not contain `Bearer raw-value-123456`.

In `collection_runner_service.rs`, add `runner_fills_a_nested_env_value` with the case of test 1.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cargo test -j4 -p rocket-app nested_e2e` and `cargo test -j4 -p rocket-app runner_fills_a_nested_env_value`
Expected: tests 1, 2, 5 (header shape), 6 and the runner test FAIL (`https://{{host}}` sent); tests 3 and 4 may already pass.

- [ ] **Step 3: Expand in the first pass.** In `resolve_request_parts`, build both `vars` and `plain_vars` from `expand_nested(&scopes, &input.flow_vars, &mut dynamic)`, then lay the `process.env.` keys under `vars` as `flatten_with_process_env` does today (lowest layer, never overriding). Return the `dynamic` cache in `ResolvedParts` so `begin_phases` stores it in `templates.nested_dynamic`. For every name in `scopes.secret_keys` whose expanded value differs from its raw value, add `redaction::redaction_forms(expanded)` to the send's `secret_values`.

- [ ] **Step 4: Compare expanded values in the second pass.** In `begin_phases`, set `templates.first_raw = var_ctx.flatten()` and `templates.first_values = expand_nested(&var_ctx, &HashMap::new(), &mut templates.nested_dynamic)`. In `resolve_runtime_placeholders`, build `now` as: `expand_nested(&state.var_ctx, &HashMap::new(), &mut templates.nested_dynamic.clone())`, then for every name whose raw value (`state.var_ctx.flatten()`) differs from `first_raw` (or is new), put the raw value back. Pass `first_values` and this `now` to `Overrides::between`. New values under `secret_keys` get their forms added as today.

- [ ] **Step 5: Run the tests**

Run: `cargo test -j4 -p rocket-app nested_e2e`, then `cargo test -j4 -p rocket-app runner_fills_a_nested_env_value`, then `cargo test -j4 -p rocket-app`.
Expected: PASS, no warnings. Any existing test that expected a nested value to stay unfilled is a spec change: update it and list it in the report.

- [ ] **Step 6: Docs.** `crates/rocket-app/CLAUDE.md`, Phase-callable bullet: one sentence on nested expansion (stored scopes only, no vault or `process.env`, depth 3, second pass compares expanded values).

---

### Task 3: Script secrets reach the Console masks

**Files:**
- Modify: `crates/rocket-app/src/execution_service/sent_request.rs`, `crates/rocket-app/src/execution_service.rs` (`finish_phases`)
- Modify: `src/lib/tauri-api.ts`, `src/lib/execute-request.ts`, `src/lib/__tests__/execute-request.sent.test.ts`
- Modify: `docs/features/console-masking.md`

**Interfaces:**
- Consumes: `sent_request_masked(request, vault_values)` and `SentRequest` from Plan 03.
- Produces: `sent_request_masked(request: &HttpRequest, vault_values: &HashSet<String>, secret_values: &HashSet<String>) -> SentRequest`; `SentRequest::secret_values: Vec<String>` (`secretValues`, sorted, no duplicates); TS `SentRequest.secretValues?: string[]`.

- [ ] **Step 1: Write the failing tests**

Rust, in `sent_request.rs`: `sent_request_lists_the_secret_values_it_holds` (a secret `env-secret-999` in a header and `other-secret-777` nowhere: the list is `["env-secret-999"]`), `sent_request_never_lists_a_vault_value` (a value both in the vault set and the secret set is not listed and stays masked), `sent_request_skips_short_secret_values` (`abc` is not listed).
Rust, in `script_host_tests.rs`: `sent_request_e2e_lists_a_secret_the_script_wrote`: env secret `token = old-token-123456`, pre-request `rok.setEnvVar('token', 'new-token-654321')`, header `X-T: {{token}}`; `out.sent_request` lists `new-token-654321`.
Vitest, in `execute-request.sent.test.ts`: `a_sent_secret_value_is_masked_in_the_row`: `sentRequest` with header `X-T: script-secret-123` and `secretValues: ['script-secret-123']`; the row's masked view does not contain it, the raw row does.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cargo test -j4 -p rocket-app sent_request` and `bun run test execute-request.sent`
Expected: FAIL (compile error in Rust; the Vitest masked view contains the value).

- [ ] **Step 3: Implement.** In `sent_request_masked`, list each secret value of at least `MIN_REDACTION_LEN` characters that is not one of the vault mask forms and occurs in the masked copy's URL, header keys or values, query keys or values, body content, form values or auth fields. In `finish_phases`, pass `&state.var_ctx.secret_values`. In `execute-request.ts`, add `sent?.secretValues ?? []` to the secret list given to `buildMaskOptions` for the row.

- [ ] **Step 4: Run the checks**

Run: `cargo test -j4 -p rocket-app sent_request`, `cargo test -j4 -p rocket execution`, `bun run test execute-request`, `bun run tsc --noEmit`, `bunx biome check src/lib/execute-request.ts src/lib/tauri-api.ts`.
Expected: PASS.

- [ ] **Step 5: Docs.** `docs/features/console-masking.md`: the backend lists the non-vault secret values in the sent request (`sentRequest.secretValues`), so a secret a script wrote is masked too.
