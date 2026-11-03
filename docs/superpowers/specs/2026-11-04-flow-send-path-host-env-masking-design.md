# Send-path host env masking and follow-ups

Date: 2026-11-04. Status: draft, waiting for review.
Builds on: `2026-11-02-flow-script-source-placeholders-design.md` and `2026-11-03-flow-script-scope-followups-design.md` (branch `feat/flow-script-scope-followups`).

## Problem

A host `process.env` value (an OS value, not a `.env` value) still shows raw in three places of a Request send:

- A. the History entry URL (`finish_phases`, `execution_service.rs` ~3364-3366),
- B. the `RequestExecuted` event URL (~3384-3389, the same string as A),
- C. executor error text (`send_request`, ~3094-3099).

Two causes:

1. The send's own used host values (`SendProcessEnv.used_values`) are returned to callers but never added to `var_ctx.secret_values` (only `.env` values are, via `dot_env_values`, ~2625-2627).
2. Host values that an earlier Flow node used are not known to the send at all.

This affects every backend caller (Flow, runner, MCP `run_request`, assistant), not only Flow.

Smaller items from earlier reviews are in the same area:

- Used host values get only the JS-escaped and JSON-escaped forms, not `redaction_forms` (per-line, trimmed), so a multi-line value (a PEM) logged line by line is not masked.
- The plan-time scope (`plain_vars`, keychain read) is built on every run even when no text has `{{`.
- `add_escaped_forms` also runs on values under `MIN_REDACTION_LEN`.
- Test gaps: a vacuous dynamic-name test, an untested depth cap, tests that read real `PATH`/`HOME`, and U+2028/U+2029 line-comment ends untested.

## Decisions

- Upstream Flow values reach the send through a new `#[serde(skip)] pub extra_mask_values: HashSet<String>` on `ExecuteRequestInput`. It defaults to empty, so every other caller is unchanged. `}}flow-host.<n>` external-secret keys are not used, because they would join the vault write guard and hold back saves of common values.
- The Request's own used host values are masked for all backend callers.
- Used host values are not held back by the script or vault write guard.
- `plain_placeholder_hash` and `fingerprints` keep their `Option` shape.
- OS-env tests set a unique variable per test.

## Design

### Masking helper

Move `add_escaped_forms` from `flow_execution_service.rs` into `redaction.rs` as `pub(crate) fn mask_forms(values: impl IntoIterator<Item = String>) -> HashSet<String>`. For each value of `MIN_REDACTION_LEN` or more characters it returns `redaction_forms(v)` plus, for each form, `escape_value` and `json_escaped_form`. Values under the floor produce nothing. Flow code and the send path both call it.

### Send path

- In `begin_phases`, next to the `dot_env_values` line (~2626), extend `var_ctx.secret_values` with `mask_forms(process_env.used_values)` and with `mask_forms(input.extra_mask_values)`.
- This covers A, B and C and the script console, because they all read `var_ctx.secret_values`. The value is masked by the existing `redact_secrets` and `redact_error`.
- The vault guard (`vault_forms`) and `sent_request_masked` are unchanged.
- `used_values` is fixed at the first resolution pass. A host value that only appears after a pre-request script is a known limit, noted in the docs.

### Flow

- `build_execute_request_input` (or the Request arm just before `execute_capturing`) sets `extra_mask_values` to the node's `secret_values` host portion: the run-level used host values and their forms from `NodeRunContext.used_host_values`.
- After the send, the flow records `output.run_process_env_values` into `ctx.record_used_host_values`, so later nodes mask the Request's own used values too.
- `record_used_host_values` and `ScriptScope::add_masks` call `mask_forms`, so multi-line values get per-line forms.
- The Request console masking added earlier stays.

### Lazy plan-time scope

`plain_vars` is held in a `std::cell::OnceCell` and built on the first `resolved(text)` call from `fingerprints`, which already only calls it for text that contains `{{`. A run with no such text never reads the scopes or the keychain. The comment above the planning step is updated.

### Tests and cleanup

- Replace the vacuous dynamic-name unit test: two values for `{{A}}` that differ only in a `$` name hash equal, and a change to `A`'s static text changes the hash.
- Depth cap: a chain `V0 -> ... -> V9`. A change at level 8 changes the hash, a change at level 10 does not.
- OS-env tests: each sets a unique variable (`ROCKET_TEST_HOST_<n>`) and uses it. `PATH`/`HOME` stay only where a test checks "not a `.env` key" (`execution_service.rs` ~8829, ~8990).
- `flow_script_literals.rs`: tests for `// x` ended by U+2028, U+2029 and `\n`.
- New tests: History URL, `RequestExecuted` URL and executor error text hide a used host value for a plain send (not Flow); a Flow Request hides an upstream host value in its History URL; a multi-line host value logged line by line is masked; a short value gets no escaped forms.

## Security reasoning

- Masks only grow, so nothing new is revealed.
- The new field is `serde(skip)`: it can never arrive over IPC, so a frontend cannot clear or set it.
- A host value under 6 characters is not masked (the existing floor), so a short common value cannot blank out ordinary text.

## Docs

`docs/features/collection-trust.md`: sinks A, B, C now mask the send's own used host values for all backend callers; a value introduced only after a pre-request script is not covered. `crates/rocket-app/CLAUDE.md` is updated if it mentions the old limit.
