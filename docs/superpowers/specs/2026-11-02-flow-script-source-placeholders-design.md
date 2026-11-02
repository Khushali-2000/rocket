# Flow script source placeholders

Date: 2026-11-02. Status: draft, waiting for review.

## Problem

Before 30 Oct, a Flow wire script could return text with `{{username}}` or `{{alias.secret}}` and the request filled it in. Commits `0d0b1f49` and `e18fd8d8` (#129) made every wired URL, header and body value literal, because wired text may come from a response. The script source is never templated either, so `'{{username}}'` typed by the flow author now reaches the request as plain text. Flow `app-api-4` broke this way.

The code cannot tell text the author wrote from text a response supplied once the script has built its output string.

## Goal

- Placeholders the author wrote inside a script's source resolve again.
- Text that comes from a response never resolves. #129 stays closed.
- Resolved values are masked in the Console and in Flow traces.

## Non-goals

- No change to `apply_wired_overrides`, `LiteralFields` or the send-time passes. Wired output stays literal.
- No new script API (`rok.vars.get`).
- No resolution of folder or request variables (an Input node does not have them either).

## Design

### Resolver

A pure function `resolve_script_literals(source: &str, vars: &HashMap<String, String>) -> String`. The escaped form of each value it inserts is added to the secret masks, so a script error never quotes a raw or escaped secret.

- A small tokenizer walks the source. It knows `'…'`, `"…"` and `` `…` `` strings, `//` and `/* */` comments, and `${…}` holes in template literals.
- Inside a string literal, `{{name}}` is replaced with the value escaped for every string kind: `\`, `/`, `'`, `"`, `` ` ``, `$`, `\n`, `\r`, U+2028 and U+2029. Escaping for all kinds keeps a value inert even if the scanner misjudges the context (it does not lex regex literals). A `{{` counts as a placeholder only when the text before the next `}}` has no quote, backtick, backslash or newline.
- Code, comments and `${…}` holes are left as written.
- A name that does not resolve stays as written, like the Input node.
- A replaced value is never scanned again.
- `resolve_script_literals` returns the new source as a `String`. `script_names_process_env` is a separate check that tells the caller whether to copy the host `process.env` map. `escape_value` is shared with the caller so masks can include escaped forms.

### Wiring

In `flow_execution_service.rs`, wire scripts (the two `resolve_flow_wire_expression` calls in the Request and Output arms) and Transform scripts resolve their source before `flow_script` embeds it.

- Scope is the Input node's: `variable_context_with_process_env` (global < collection < environment, RocketVault through `external_secrets`). `process.env` follows the per-run gate. A withheld gate adds the same console line the Input node adds.
- The scope is built per edge (and once per Transform node), only when the source contains `{{`. `{{callback.*}}`, `{{$dynamic}}` names and nested variable expansion do not apply in scripts.
- If/Switch conditions and `accept_when` scripts are out of scope: they do not feed request fields.

### Masking

The scope is the same one `exec.secret_values(...)` already reads, so every secret variable and vault value that can be inserted is already in the `secret_values` passed to the script run and in `trace_masks`. `console.log` output and trace steps are therefore masked. A resolved value also appears escaped inside the resolved source, so `execute_node` adds the escaped form of every secret to the masks that redact script errors and traces. Non-secret values (a plain username) stay visible, as they do elsewhere. A test pins this.

### Unchanged

The saved flow file and the edit dialog keep the original source with its `{{}}`. Resolution happens only at run time.

## Security reasoning

The source is author-written text. A response reaches the script only through `response`, at run time, after resolution. So a response can never name a variable to look up, which is the #129 attack. The #130 origin check still guards a wired URL.

A shared collection's wire script can now read vault values into its output. That is the same exposure a request body in the collection has, and only `process.env` is gated by the collection trust gate. RocketVault and environment values are not, which matches the Input node.

## Tests

- Resolver unit tests: the three quote types, escaping (quote, backslash, newline, `${`), comments, template holes, unresolved names, no re-scan, names in bare code ignored.
- Flow test: a wire script with `'{{username}}'` and a vault alias sends the real values.
- #129 regression test: `{{x}}` inside `response.body` returned through a script still goes out literal.
- Transform test: a Transform with `{{username}}` in a string reaches the wire resolved.
- Masking test: a logged resolved secret is masked.

## Docs to update

`docs/features/collection-trust.md` (wired-values paragraph), the Flow wire docs, and `docs/roadmaps/flow-roadmap.md` if an item exists.

## Manual check

1. Open `app-api-4`. Run it. The request body holds the real username and password.
2. The Console shows the wire data with `••••••` for the password.
3. Change the script to return `response.body` where the body holds `{{pass.x}}`. The text is sent as typed.
