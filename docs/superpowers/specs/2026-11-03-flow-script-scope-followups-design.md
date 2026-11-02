# Flow script scope follow-ups

Date: 2026-11-03. Status: draft, waiting for review.
Builds on: `2026-11-02-flow-script-source-placeholders-design.md` (branch `feat/flow-script-source-placeholders`).

## Problem

The first change let `{{name}}` in a wire or Transform script's string literals resolve. Review left five gaps:

1. A secret with `"` or `\` that goes through `JSON.stringify` and `console.log` shows in its JSON-escaped form, which is not masked.
2. OS `process.env` values a script uses are not masked (only `.env` values are). The Input node has the same gap.
3. `{{callback.*}}`, `{{$dynamic}}` and nested variables (`username = {{base_user}}`) do not resolve in scripts, unlike the Input node and the send path.
4. The partial-run cache fingerprints the unresolved script source, so a changed variable value does not invalidate a cached script or Input node.
5. The scope is rebuilt for every wire, so a node with several wires repeats the work and the withheld `process.env` warning.

The RocketVault trust gate is out of scope. It has its own spec.

## Decisions (from the user)

- Cache fingerprint uses plain scope values only (global, collection, environment). RocketVault and `process.env` are not included. A changed vault secret does not invalidate the cache. This is a documented limit.
- `{{$dynamic}}` names work in scripts and match the Input node. Each occurrence gets a fresh value.

## Design

### ScriptScope (item 5)

A struct built lazily once per node in `execute_node`:

- `vars: Option<HashMap<String, String>>`, built on the first source that contains `{{`.
- Extra mask values and forms collected while resolving.
- `warned: bool` for the withheld `process.env` warning.

`resolve_script_source` takes `&mut ScriptScope` and returns the resolved source. The host `process.env` map is copied into the scope whenever the gate allows it (one copy per node). The warning is emitted once, when a source first names a withheld `process.env` name.

### Scope contents (item 3)

- Global < collection < environment < RocketVault, as today.
- `callbacks.vars()` is added, like the Input node.
- Nested variables are expanded in the variable map first, with the same function the send path uses (`expand_nested_recording`). The expansion works on variable values only. The script source is never expanded, and a resolved value is never scanned again. The secret forms it records join the masks.
- Dynamic names: the resolver takes a lookup closure instead of a `HashMap`. A `$`-prefixed name calls `rocket_environment::dynamic_vars::generate`. Generated values are escaped like any value and are not masked.

### Masking (items 1 and 2)

- `json_escaped_form(&str) -> Option<String>` is extracted from `sent_request.rs` into `redaction.rs`. It returns the JSON string content without the outer quotes, when it differs from the input.
- Wherever the escaped JS form of a secret is added to the masks, the JSON form is added too. This covers script console logs, step errors, traces and outputs.
- The same escaped and JSON forms are added to the Request arm's `sent_secret` rebuild and to the run-level masking set, which miss them today.
- The resolver reports the `process.env` names it used. The scope adds their values (6 or more characters) and escaped forms to that node's masks before the script runs and before `record_wire`.
- The Input arm gets the same used-value masking.

### Run cache (item 4)

In `flow_run_cache.rs`, `fingerprints` takes a closure that returns a one-way hash of the resolved text for a script or Input node whose source contains `{{`. The hash covers plain scope values only. The resolved text is never stored. Request nodes are unchanged (decision D5). Docs say a changed RocketVault or `process.env` value does not invalidate a cached run.

## Security reasoning

- The first change's boundary holds: only the flow file's own source is resolved, never response data.
- Nested expansion and dynamic names add no new input to the source. They only change which value a name maps to.
- Masking additions only add masks. They cannot reveal anything.
- The cache hash is one-way and stays in process memory.

## Tests

- `json_escaped_form`: quotes, backslashes, control characters, a value that needs no escape returns `None`.
- A password with `"` and `\` through `JSON.stringify` and `console.log` is masked in logs, trace and the step error.
- An OS `process.env` value used in a script, and in an Input node, is masked. A value not used stays visible.
- `{{callback.x}}`, `{{$guid}}` and a nested variable resolve in a script literal. A nested secret is masked.
- A value that contains `{{other}}` is inserted as text and not resolved again.
- A node with several wires builds the scope once and logs one withheld warning.
- A partial run re-runs a script node after a plain variable it uses changes, and reuses it when nothing changed. A Request node still reuses its output (D5).

## Docs

`docs/features/collection-trust.md` and the Flow run-cache doc: scope contents, the used-`process.env` masking, and the cache limit for vault and `process.env`.
