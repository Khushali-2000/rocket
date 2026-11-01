# Script variable writes reach the outer request (R-66)

Date: 2026-11-01

Roadmap: R-66 in `docs/roadmaps/roadmap.md`. Series: `docs/features/rok-api-parity-notes.md`. Builds on Part B (`2026-10-07-rok-js-api-parity-b-async-design.md`, ruling 11 of `plans/rok-parity-b/00-plan-index.md`).

📖 Variable resolution scope: read `docs/superpowers/specs/opencollection-spec-reference.md` before planning or building.

## Goal

A pre-request script can log in and the outer request uses the result through a plain placeholder:

```js
await rok.runRequest('auth/login'); // login saves `token` in any scope
```

with a `Authorization: Bearer {{token}}` header on the outer request. This works whatever scope login writes to (runtime, environment, global environment, collection), and for every send path that runs the request phases: single send, Collection Runner, Flow request nodes and nested runs.

A second known limit closes too: a nested run sees the environment, global and collection writes its caller made before the call.

## Current state

- `begin_phases` resolves the request before any script runs and records each field as a `FieldTemplate` (`execution_service/runtime_fill.rs`).
- After the pre-request scripts, `resolve_runtime_placeholders` renders each untouched field again, but `FieldTemplate::render(runtime)` only reads **runtime** variables. A runtime write already reaches `{{token}}`. An environment, global or collection write does not, even though `apply_script_side_effects` mirrors it into `PhaseState.var_ctx`.
- A nested `rok.runRequest` saves its writes. `merge_run_outcome` (`rocket-infra/src/scripting/ops/host.rs`) refreshes the calling script's own snapshot, but `ScriptResult` carries nothing back, so `PhaseState.var_ctx` keeps the old environment, global and collection values.
- The caller's environment, global and collection writes are only saved when its script ends, and `execute_nested` builds its scopes from storage, so the nested run does not see them.

## Decisions

- Approach 1a: compare each name's resolved value before and after the pre-request scripts. The alternatives, a full second resolution (1b) and a changed-name set built from write lists (1c), were rejected: 1b makes `{{$dynamic}}` values twice and repeats the `process.env` gate and vault alias checks; 1c breaks scope precedence.
- Approach 3a: pending caller writes reach the nested run in memory. They are not saved early (3b rejected), so the rule "a script's writes are applied when the script ends" stays.
- Scope precedence decides every value, as in the first resolution.
- Out of scope: later phases (after-response, tests) seeing refreshed values beyond what they see today; R-67 items; object runtime values reaching nested runs as JSON strings.

## Design

### 1. Resolved values before and after the scripts

- `RequestTemplates` gains `first_values: HashMap<String, String>`, set at the end of `begin_phases` from `state.var_ctx.flatten()`, before any script runs. The before and after maps are built from the same `VariableContext` the same way, so only real changes differ. `flatten()` applies scope order (global, collection, RocketVault, env, folder, request, runtime), and `begin_phases` already puts Flow variables in `runtime`, the same top layer the first resolution gives them. Runtime values a Collection Runner step carries in (`seed_runtime`, after `begin_phases`) are runtime values and enter `overrides` as today.
- `FieldTemplate::render(runtime)` is renamed `render(overrides)`. The body is unchanged: a name in the map gets that value, every other placeholder keeps its first-pass value, names starting with `$` are skipped.
- `resolve_runtime_placeholders` builds `overrides` from `state.var_ctx.flatten()` after the scripts:
  - every runtime variable, as today;
  - every name whose new resolved value differs from `first_values`, including a name that did not resolve before and does now;
  - never a name starting with `$` or `process.env.`.
- A name that resolved before and no longer resolves (deleted, nothing else defines it) maps to its placeholder text, so the field sends `{{name}}` as written and never the old value.
- The early return `runtime.is_empty() && !has_placeholder(..)` becomes `overrides.is_empty() && !has_placeholder(..)`.
- Script-written text keeps its rules (`script_vars`: only the first pass's unresolved names and the names the script added, never the RocketVault scope). It reads `state.var_ctx`, which is now fresh after a nested run.

### 2. Refresh after a nested run

- `PhaseState` gains `nested_ran: Arc<AtomicBool>`, shared with `ExecutionScriptHost` like `nested_withheld`.
- `ExecutionScriptHost::run_request` sets it just before `execute_nested` is called, so a nested run that fails after saving some writes still counts.
- After each pre-request script in the phase loop, if the flag is set: reload environment, global and collection with `build_variable_scopes` (the call `stored_scopes` uses) into `state.var_ctx.env`, `global_env` and `collection`, add the reloaded `secret_values`, then clear the flag. The next script in the folder chain then starts from the fresh values.
- Runtime values come back through `ScriptResult.runtime_vars` as today.
- The after-response and tests phases do not reload in this change.

### 3. Pending writes reach the nested run

(Plan note: `PendingWrites` carries each write as its saved text, `Vec<(String, Option<String>)>`, see plan index deviation 4.)

- `HostRunRequest` (`rocket-scripting/src/host.rs`) gains `pending: PendingWrites { env, global_env, collection }`, each a list of the existing write types (`EnvVarWrite`, `CollectionVarWrite`; a `null` value is a delete).
- `op_rok_run_request` fills it from `ScriptOutputState` next to `runtime_vars`. The output keeps the writes: the caller still saves them when its script ends, and `merge_run_outcome` still drops the ones the nested run changed.
- `execute_nested` passes the pending writes to `begin_phases`, which applies them on top of the stored scopes before the first resolution, in memory only. A value that holds a RocketVault form is held back with the existing check (`hold_back_vault_writes`, `hold_back_if_vault_secret`), so it goes to runtime with the usual console warning in the nested run's Console.
- `stored_scopes` before and after the nested run still read storage only, so the change detection in `merge_run_outcome` is unchanged.

### 4. Security and masking

- `process.env.*` names never enter `overrides`; the trust gate's first-pass decision stands.
- RocketVault values do not change during a send. New values holding a vault form are held back as above.
- Secret values from the reload join `secret_values`, and `mask_runtime_values_of_secret_keys` keeps running first, so Console, History and the timeline mask a new secret.
- A URL changed by the second pass goes through the request guard, as today.

### 5. Errors and cost

- `build_variable_scopes` logs repository errors and does not fail the send. Script errors still never block a send.
- One extra `flatten()` per send. The storage reload happens only after a nested run.

### 6. Frontend sends (addendum, 2026-11-01)

The final review found that the app's own sends never reached this design. The single send (`sendRequest`) and the UI Collection Runner (`executeRunnerEntry`) fill placeholders in the frontend (`resolveRequestFieldsForPath(..., forSend = true)`) before the IPC call. Today only names that a literal `rok.setVar('name', ...)` in the request's own script sets are left as placeholders (`withoutScriptRuntimeVars`). So an existing env `token` reaches the backend already filled with the old value, and R-66 fails in the app after the first login. Backend sends (Flow, nested runs, the backend runner, the assistant) are not affected.

Decision (user, option A): for a send that runs scripts (`forSend` with an HTTP or GraphQL request), the frontend fills only what it owns and leaves every other `{{name}}` to the backend.

- The frontend still fills `{{process.env.NAME}}`. An IPC input never sets `backend_process_env`, and the frontend owns that pass and its trust gate.
- `{{$dynamic}}` names stay with the frontend as today (`resolveWithContext` makes them without the context).
- The folder auth pick stays in the frontend, because a folder OAuth2 token only exists in the frontend store. The picked auth's fields keep their placeholders, and the backend fills them.
- Everything else (env, global, collection, folder, request variables) reaches the backend as written. The backend's first pass fills it, and the second pass of section 1 applies script writes on top. This also covers folder and collection scripts and nested runs, which the frontend could never see.
- `withoutScriptRuntimeVars` and `scriptRuntimeVarNames` are no longer needed on the send path, and are removed if nothing else uses them.
- Not changed: assertion values (resolved with the full context as today), and the callers that do not set `forSend` (cURL copy, load test, GraphQL introspection, the request panel preview).
- The frontend secret list (`secretValues`, `secretsUncertain`) is still built and used for the Console masks.

#### The Console row shows what the backend sent

The Console HTTP row is built from the frontend's own fields today, and `ExecuteRequestOutput` carries no copy of the sent request. Under option A that row would show `Bearer {{token}}`. Decision (user): the backend returns the request it sent.

- `ExecuteRequestOutput` gains `sent_request`: the URL, headers, query parameters, body and auth of `state.http_request` after every pre-request phase (the request `send_request` dispatches, without fetched vault certificates). The IPC DTO `ExecuteRequestResponse` carries it as `sentRequest`, using the same shapes as `ExecuteRequestInput` (`Header`, `QueryParam`, `Body`, `Auth`). It is `None` when no request was sent.
- Before it leaves the backend, every RocketVault value in it (the `external_secrets` values and their `redaction_forms`) is replaced with the `••••••` marker. This keeps the Console rule that the frontend never receives a raw secret-manager value. Other secret values are not masked here: the frontend already holds them and masks them with `maskHttpExchange`, with the reveal toggle.
- `sendRequest` builds the Console row (URL, explicit headers, auth headers from `authToConsoleHeaders`, body) from `sentRequest` when present. A GraphQL row uses the sent body. The masks and the reveal toggle work as today.
- When a send fails before a response, there is no output. The error row shows the fields as the frontend sent them, with placeholders. The error message carries the backend's detail. A sent copy on errors is out of scope.
- The UI runner writes no Console row, so it only needs the placeholder change.

Tests:

12. Vitest: for an HTTP and a GraphQL request with an env `token`, the `ExecuteRequestInput` passed to the IPC send keeps `{{token}}` in a header, the URL and the body, while `{{process.env.NAME}}` is filled. A non-send caller (`forSend = false`) still fills `{{token}}`.
13. Vitest: the Console row of a send uses `sentRequest` (a header value differs from the input), and falls back to the input fields without it.
14. Rust: `sent_request` holds the second-pass value of a header a pre-request script changed, and a RocketVault value in a header, the URL and the body comes back as `••••••`.

### 7. Nested values and script secrets in the Console (addendum, 2026-11-01)

The Task 3 review of Plan 03 found two gaps that section 6 opened. The user chose both fixes.

#### Nested values

Before section 6, the app's own sends filled a variable inside a variable by accident: the frontend filled `{{baseUrl}}` to `https://{{host}}`, and the backend filled `{{host}}`. The backend fills each placeholder once and never reads a value it put in, so backend sends (runner, Flow, nested runs) never did this, and after section 6 the app's sends would not either. Decision (user): the backend fills placeholders inside variable values.

- Only values from the stored scopes are expanded: global, collection, environment, folder and request variables. Runtime values, Flow variables and values a script wrote during this send are put in as they are, because their text can come from a response.
- The nested lookup uses the stored scopes and runtime values (as in the first pass). It never fills a RocketVault name or a `process.env.*` name: both stay as written inside a value. A stored value can have been written by an earlier script from response data, and filling a vault or host value into it would let response data pull a secret into a request. This keeps the rule that script-written text is never filled from the vault. A `{{$dynamic}}` name in a value is generated, once per send for each name.
- Depth: at most 3 levels below the value the field names (`{{a}}` with `a = {{b}}`, `b = {{c}}`, `c = {{d}}`, `d = end` fills to `end`). Each expanded value is capped at 64 KiB; past that the remaining placeholders stay as written. A cycle (`a = {{b}}`, `b = {{a}}`) or a deeper reference leaves the innermost placeholder as written.
- The second pass compares expanded values: a name whose stored value is unchanged is expanded with the current values, so `{{baseUrl}}` follows a script that changed `host`. A name whose value a script changed is put in as it is (section 1 rule).
- Secret masking: a value that came from a secret variable is masked wherever it lands, as today, because its text is in `secret_values`. A non-secret value that contains a secret one is masked only on the secret part.

#### Script secrets in the Console row

The frontend's secret list is built before the send, so a secret value a script wrote (a new secret env value, or a runtime value under a secret name) is not in it, and the Console's masked view shows it raw in a header, the URL or the body. Decision (user): the backend lists them.

- `SentRequest` gains `secret_values: Vec<String>` (`secretValues` on IPC): every value of the run's final `secret_values` of at least 6 characters that occurs in the sent copy, without RocketVault values and their forms (those are already `••••••`). The frontend already holds these values, so nothing new crosses to it.
- `sendRequest` adds them to the secret list of `buildMaskOptions` for the row. The reveal toggle shows them raw, as it does for other secrets.

Tests:

15. Rust: env `baseUrl = https://{{host}}`, `host = api.test`; the sent URL of `{{baseUrl}}/x` is `https://api.test/x` (single send and runner).
16. Rust: a cycle and a 4-level chain leave the innermost placeholder; a vault name and a `process.env.*` name inside a stored value stay as written; a runtime value holding `{{host}}` is sent as written.
17. Rust: a pre-request `rok.setEnvVar('host', 'new.test')` changes the sent `{{baseUrl}}` URL to `https://new.test/x`.
18. Rust: `sent_request.secret_values` holds a secret env value a pre-request script wrote, and no vault value.
19. Vitest: a `sentRequest.secretValues` entry in a non-auth header is masked in the row and raw on reveal.

## Testing

Rust tests in `rocket-app` (`tempfile`, `wiremock`), each asserting the header or URL the mock server received:

1. A pre-request `rok.setEnvVar('token', 'new')` fills an untouched `{{token}}` header. The same for `setCollectionVar` and `setGlobalEnvVar`.
2. R-66: `await rok.runRequest('auth/login')`, whose script sets env `token`, then the outer `{{token}}` header sends the new value. Also when `token` did not exist before the send.
3. A request variable `token` still wins over a new env `token`.
4. `{{$uuid}}` used in two fields keeps the value the script saw.
5. A deleted `token` with no other definition sends `{{token}}` as written.
6. A secret env value written by the nested run is masked in the Console and History output.
7. A collection-level pre-request script calls `runRequest`; the request-level script after it reads the fresh env value with `rok.getEnvVar`.
8. Pending writes: the caller sets env `username`, then `runRequest`; the nested request's `{{username}}` sends it, and storage holds the new value only after the caller's script ends. A pending delete hides the stored value in the nested run.
9. A pending value holding a vault form is held back in the nested run.
10. The R-66 case through the Collection Runner and through a Flow request node.
11. With no script writes, the sent request equals the first pass for env, folder, request and Flow variables (no name looks changed).

Existing `runtime_fill` unit tests move to `render(overrides)` without changing their expectations.

## Docs

- Part B spec, "Known limits" and ruling 11: point to this spec for both limits.
- `docs/features/rok-api-parity-notes.md`: describe the new behaviour; drop the `req.setHeader` workaround.
- `docs/roadmaps/roadmap.md`: R-66 done.

## Risks

- A field whose first-pass value came from a scope that a script changed now sends the new value. This is the intended change, but a script that relied on the old behaviour (set an env value for the *next* send only) now changes the current one too. Bruno behaves the same way.
- `resolve_request_parts` builds its own scopes with `build_variable_scopes` and adds Flow variables on top, while `begin_phases` builds `state.var_ctx` the same way with Flow variables in `runtime`. If the two ever differ for a name, the second pass would send the `state.var_ctx` value. A test pins that a send with no script writes sends exactly what the first pass produced, for env, folder, request and Flow variables.
