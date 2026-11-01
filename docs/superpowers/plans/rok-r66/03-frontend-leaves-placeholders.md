# R-66 Plan 03: the frontend leaves placeholders to the backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Runs after Plan 01 and before Plan 02. It carries the Plan 01 final-review fix wave (Task 1) and spec section 6 (Tasks 2 and 3). Plan 01 and Plan 03 are shown to the user and committed together. Recommended model: Sonnet implementer per task, Opus reviewer.

**Goal:** In the app's own single send and UI runner, a script's write reaches the request: the frontend fills only `{{process.env.*}}` and `{{$dynamic}}` and the backend fills the rest, and the Console row shows what the backend actually sent.

**Architecture:** `resolveRequestFieldsForPath(.., forSend = true)` resolves its fields with a context that holds only the `process.env.*` keys. The backend returns `ExecuteRequestOutput::sent_request`, a copy of the request `send_request` dispatched with every RocketVault value already replaced by `••••••`. `sendRequest` builds the Console row and its masks from that copy. Task 1 hardens the scope reload of Plan 01: a failed storage read keeps the current scopes and writes a Console warning.

**Tech Stack:** Rust (`rocket-app`, `src-tauri`), React/TypeScript, Vitest, Bun.

**Spec:** `docs/superpowers/specs/2026-11-01-rok-script-writes-reach-request-design.md`, Design section 6 (tests 12 to 14) and section 2 for Task 1. The ledger `.superpowers/sdd/01-second-pass-sees-every-scope/progress.md` holds the final-review findings Task 1 fixes.

## Global Constraints

- 📖 Before starting each task, read `docs/superpowers/specs/opencollection-spec-reference.md`.
- `cargo` commands take `-j4`; never `--workspace` or `--all`.
- No unwrap calls in production Rust code.
- Frontend commands use Bun only: `bun run tsc --noEmit`, `bun run check`, `bun run test <pattern>`. Never yarn or npm.
- `#[serde(rename_all = "camelCase")]` only on IPC DTOs. `SentRequest` is an IPC DTO.
- The frontend never receives a raw RocketVault value (`docs/features/console-masking.md`). The mask marker is `redaction::REDACTED` (`••••••`).
- Code comments are short full sentences ending with a period.
- Implementers do not commit.

## Review Focus

1. **A RocketVault value inside a longer text** (`Bearer <vault>` in a header, `?k=<vault>` in the URL, inside a JSON body) is masked in place, and its percent-encoded form in the URL too. Task 2 test `sent_request_masks_vault_values_everywhere`.
2. **A secret env value (not a vault value) stays raw in `sentRequest`**, so the Console reveal toggle still works; the frontend masks it. Task 2 test `sent_request_keeps_non_vault_values`, Task 3 test `the_console_row_masks_the_sent_bearer_token`.
3. **The bearer token mask follows the sent auth, not the input auth.** The input auth now holds `{{token}}`, so masking from it would leave the real token visible. Task 3 test `the_console_row_masks_the_sent_bearer_token`.
4. **A placeholder in a GraphQL variables JSON** still sends valid JSON after the backend fills a value with a quote. Already covered by `a_runtime_value_in_a_graphql_body_is_json_escaped` and the first pass's `field(content, true, ..)`; Task 3 test `a_graphql_send_keeps_env_placeholders` pins that the frontend passes the placeholder through.
5. **A storage read that fails during the reload** must not send `{{name}}` for every stored name. Task 1 test `run_request_e2e_a_failed_reload_keeps_the_scopes_and_warns`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `crates/rocket-app/src/execution_service.rs` | Modify | Strict `reload_stored_scopes`; `ExecuteRequestOutput::sent_request`, set in `finish_phases` |
| `crates/rocket-app/src/execution_service/sent_request.rs` | Create | `SentRequest` and `sent_request_masked`, with unit tests |
| `crates/rocket-app/src/execution_service/script_host_tests.rs` | Modify | Reload failure test, `script_error` assert, `sent_request` end-to-end assert |
| `crates/rocket-app/src/flow_wait.rs`, `flow_debug.rs`, `flow_run_cache.rs`, `flow_execution_service.rs`, `src-tauri/src/commands/execution.rs` | Modify | `sent_request: None` in the other `ExecuteRequestOutput` literals |
| `src-tauri/src/commands/execution.rs` | Modify | `ExecuteRequestResponse::sent_request` |
| `crates/rocket-app/CLAUDE.md` | Modify | Colon fix, reload failure, `sent_request` |
| `src/lib/tauri-api.ts` | Modify | `SentRequest`, `ExecuteRequestResponse.sentRequest` |
| `src/lib/variable-context.ts` | Modify | `processEnvOnly`; remove `withoutScriptRuntimeVars` and `scriptRuntimeVarNames` |
| `src/lib/execute-request.ts` | Modify | The send context; the Console row from `sentRequest` |
| `src/lib/__tests__/execute-request.folder.test.ts`, `variable-context.test.ts`, `execute-request.sent.test.ts` (new) | Modify / Create | Frontend tests |
| `docs/features/console-masking.md` | Modify | The row source and the vault rule |

---

### Task 1: Plan 01 final-review fixes

**Files:**
- Modify: `crates/rocket-app/src/execution_service.rs` (`reload_stored_scopes`, about line 2051)
- Modify: `crates/rocket-app/src/execution_service/script_host_tests.rs`
- Modify: `crates/rocket-app/CLAUDE.md` (the Phase-callable bullet, about line 77)

**Interfaces:**
- Consumes: `RequestExecutionService::scopes_inner(strict: bool, global, collection, env, request_path, external_secrets) -> DomainResult<VariableContext>` (exists); `PhaseState::console: Vec<ConsoleEntry>`; `redaction::redact_secrets`.
- Produces: no new names. `reload_stored_scopes` keeps its signature.

- [ ] **Step 1: Write the failing test** in `script_host_tests.rs`

Add a test-only repo next to `MemoryEnvRepo`: `BreakingEnvRepo(Arc<Mutex<Environment>>)`. Its `get` returns `Err(DomainError::Io("disk gone".into()))` once the stored environment has a variable named `break_reads`, and the stored environment otherwise; `list`, `save` and `delete` behave like `MemoryEnvRepo`. Give `run_service_full` a sibling `run_service_breaking(repo, env)` that builds the same service over `BreakingEnvRepo`.

```rust
#[tokio::test]
async fn run_request_e2e_a_failed_reload_keeps_the_scopes_and_warns() {
    // The nested login saves a new token, then makes every later env read fail.
    let collection = main_and_login_with(
        "await rok.runRequest('login.yml');",
        "",
        "rok.setEnvVar('token', 'new'); rok.setEnvVar('break_reads', '1');",
        &[("Authorization", "Bearer {{token}}")],
        &[],
    );
    let repo = Arc::new(InMemoryCollectionRepo::new(collection));
    let env = dev_env(vec![Variable::new("token", "old")]);
    let (svc, executor) = run_service_breaking(repo, env);

    let out = svc.execute(main_input()).await.expect("execute");

    // The reload failed, so the begin-time value stays; no name is sent as `{{token}}`.
    assert_eq!(sent_header(&executor, 1, "Authorization").as_deref(), Some("Bearer old"));
    let warn = out
        .console_entries
        .iter()
        .find(|e| e.level == ConsoleLevel::Warn && e.message.starts_with("Could not reload"))
        .expect("a reload warning");
    assert!(warn.message.contains("disk gone"));
}
```

Use the same input builder and request names the existing `run_request_e2e_*` tests use (`main_input()` and `login.yml` above stand for them). Index 1 is the outer send, index 0 the nested login.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cargo test -j4 -p rocket-app run_request_e2e_a_failed_reload_keeps_the_scopes_and_warns`
Expected: FAIL. The header is `Bearer {{token}}` (the lenient read emptied the env scope) and there is no warning.

- [ ] **Step 3: Make `reload_stored_scopes` strict**

Call `self.scopes_inner(true, ..)` with the same arguments. On `Ok`, replace the three scopes and extend the secret sets as today. On `Err(e)`, leave `state.var_ctx` unchanged and push one `ConsoleEntry { level: ConsoleLevel::Warn, message }` onto `state.console`, where `message` is exactly:

`Could not reload the stored variables after rok.runRequest: {error}. The request keeps the values it had before the nested run.`

`{error}` is `e.to_string()` passed through `redaction::redact_secrets(.., &state.var_ctx.secret_values)`. Update the doc comment of `reload_stored_scopes` to say a failed read keeps the current scopes and warns, and that a value whose save failed in the nested run is not reloaded.

- [ ] **Step 4: Add the missing assert**

In `run_request_e2e_a_name_the_nested_run_created_fills_the_outer_header`, assert `out.script_error.is_none()` before the header assert (bind the `execute` result to `out` if it is not bound yet).

- [ ] **Step 5: Fix the CLAUDE.md wording**

In the Phase-callable bullet of `crates/rocket-app/CLAUDE.md`, the sentence about `first_values` follows a colon that does not introduce a list. Make it its own sentence. Add one sentence to the Script host bullet: a failed storage read during the reload keeps the current scopes and adds a Console warning.

- [ ] **Step 6: Run the tests**

Run: `cargo test -j4 -p rocket-app run_request_e2e`
Expected: PASS, every `run_request_e2e_*` test included.

---

### Task 2: The backend returns the request it sent

**Files:**
- Create: `crates/rocket-app/src/execution_service/sent_request.rs` (declare `mod sent_request;` in `execution_service.rs` next to `mod runtime_fill;`, and `pub use sent_request::SentRequest;`)
- Modify: `crates/rocket-app/src/execution_service.rs` (`ExecuteRequestOutput`, its `Debug` impl, `finish_phases`)
- Modify: every other `ExecuteRequestOutput { .. }` literal: `flow_wait.rs:43`, `flow_debug.rs:307`, `flow_run_cache.rs:946`, `flow_execution_service.rs:2788`, `src-tauri/src/commands/execution.rs:133` and `:157`
- Modify: `src-tauri/src/commands/execution.rs` (`ExecuteRequestResponse` and its `From`)
- Test: unit tests in `sent_request.rs`; one end-to-end assert in `script_host_tests.rs`

**Interfaces:**
- Consumes: `rocket_http::HttpRequest` (`url`, `headers`, `query_params`, `body`, `auth`); `PhaseState::external_secrets: Arc<HashMap<String, String>>` (name to vault value); `redaction::{redaction_forms, redact_secrets, redact_url_secrets, REDACTED}`; `map_auth_fields(auth: Auth, r: impl Fn(String) -> String) -> Auth` (in `execution_service.rs`; make it `pub(crate)` if the new module cannot reach it).
- Produces:
  - `#[derive(Debug, Clone, Serialize)] #[serde(rename_all = "camelCase")] pub struct SentRequest { pub url: String, pub headers: Vec<Header>, pub query_params: Vec<QueryParam>, pub body: Option<Body>, pub auth: Auth }`. The field types are the ones `ExecuteRequestInput` uses, so the frontend reads them with its existing types.
  - `pub(crate) fn sent_request_masked(request: &HttpRequest, vault_values: &HashSet<String>) -> SentRequest`
  - `ExecuteRequestOutput::sent_request: Option<SentRequest>`
  - `ExecuteRequestResponse::sent_request: Option<SentRequest>` with `#[serde(skip_serializing_if = "Option::is_none")]`, serialized as `sentRequest`.

- [ ] **Step 1: Write the failing unit tests** in `sent_request.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const VAULT: &str = "vault-secret-123";

    fn vault() -> HashSet<String> {
        HashSet::from([VAULT.to_string()])
    }

    /// `HttpRequest::new(HttpMethod::Post, "https://api.test/v1?k=vault-secret-123")` with
    /// headers `Authorization: Bearer vault-secret-123` and `X-Env: env-secret-999`, query
    /// param `q = vault-secret-123`, a JSON body `{"p":"vault-secret-123","e":"env-secret-999"}`
    /// and `Auth::Bearer` with token `vault-secret-123`.
    fn request() -> HttpRequest { /* build as described */ }

    #[test]
    fn sent_request_masks_vault_values_everywhere() {
        let sent = sent_request_masked(&request(), &vault());
        assert_eq!(sent.url, "https://api.test/v1?k=••••••");
        assert_eq!(header(&sent, "Authorization"), "Bearer ••••••");
        assert_eq!(sent.query_params[0].value, "••••••");
        assert!(!body_text(&sent).contains(VAULT));
        assert!(!format!("{:?}", sent.auth).contains(VAULT));
    }

    #[test]
    fn sent_request_masks_a_percent_encoded_vault_value_in_the_url() {
        // A vault value "a b+c/secret" appears as "a%20b%2Bc%2Fsecret" in the URL.
        // The URL comes back with the marker and without either form.
    }

    #[test]
    fn sent_request_masks_vault_values_in_form_data() {
        // A multipart entry whose value contains the vault value comes back masked; its key stays.
    }

    #[test]
    fn sent_request_keeps_non_vault_values() {
        let sent = sent_request_masked(&request(), &vault());
        assert_eq!(header(&sent, "X-Env"), "env-secret-999");
        assert!(body_text(&sent).contains("env-secret-999"));
    }

    #[test]
    fn with_no_vault_values_the_copy_equals_the_request() {
        let req = request();
        let sent = sent_request_masked(&req, &HashSet::new());
        assert_eq!(sent.url, req.url);
        assert_eq!(sent.headers, req.headers);
    }
}
```

`header` and `body_text` are small local helpers. Every test body above must hold real asserts when done.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cargo test -j4 -p rocket-app sent_request`
Expected: FAIL to compile (`sent_request_masked` not defined).

- [ ] **Step 3: Implement `SentRequest` and `sent_request_masked`**

Build the mask set once: the union of `redaction_forms(v)` for every vault value. Apply `redact_url_secrets` to the URL and `redact_secrets` to header values, query values, the body `content`, each form-data `value`, and every auth field through `map_auth_fields`. Header and query keys, the body mode and file paths are copied as they are. With an empty vault set, return a plain copy.

- [ ] **Step 4: Run the unit tests**

Run: `cargo test -j4 -p rocket-app sent_request`
Expected: PASS.

- [ ] **Step 5: Wire `sent_request` into the output**

- Add `pub sent_request: Option<SentRequest>` to `ExecuteRequestOutput`, with the doc comment: "The request as sent, after every pre-request phase, with RocketVault values masked. `None` when no request was sent." In the hand-written `Debug` impl, print `self.sent_request.is_some()`, never the content.
- In `finish_phases`, set it from the `http_request` clone taken at its start (the request as sent, before after-response actions): `Some(sent_request_masked(&http_request, &vault_values))`, where `vault_values` is `state.external_secrets.values().cloned().collect()`.
- Set `sent_request: None` in every other literal listed under Files.
- In `src-tauri/src/commands/execution.rs`, add the field to `ExecuteRequestResponse` with `skip_serializing_if` and copy it in `From`.

- [ ] **Step 6: Add the end-to-end assert**

In `run_request_e2e_a_nested_env_write_fills_the_outer_header` (script_host_tests.rs), bind the output and assert that `out.sent_request` is `Some` and its `Authorization` header equals the same value the executor saw for the outer send. This pins that the copy carries the second-pass value. Add one test in `src-tauri/src/commands/execution.rs` tests: serializing an `ExecuteRequestResponse` built from an output with a `SentRequest` gives a JSON object with the key `sentRequest` and `sentRequest.queryParams`.

- [ ] **Step 7: Run the checks**

Run: `cargo test -j4 -p rocket-app sent_request`, then `cargo test -j4 -p rocket-app run_request_e2e`, then `cargo test -j4 -p rocket-app`, then `cargo check -j4 -p rocket` (the src-tauri package), then `cargo test -j4 -p rocket execution`.
Expected: PASS, no warnings.

- [ ] **Step 8: Docs**

`crates/rocket-app/CLAUDE.md`: one bullet sentence that `ExecuteRequestOutput::sent_request` is the request as sent, vault values masked, for the frontend Console row.

---

### Task 3: The frontend leaves placeholders and shows the sent request

**Files:**
- Modify: `src/lib/variable-context.ts`
- Modify: `src/lib/execute-request.ts` (`resolveRequestFieldsForPath` about line 394; `sendRequest` Console block about lines 843-888)
- Modify: `src/lib/tauri-api.ts` (`ExecuteRequestResponse`, about line 568)
- Modify: `src/lib/__tests__/execute-request.folder.test.ts` (the `rok.setVar` describe, lines 78-123), `src/lib/__tests__/variable-context.test.ts`
- Create: `src/lib/__tests__/execute-request.sent.test.ts`
- Modify: `docs/features/console-masking.md`

**Interfaces:**
- Consumes: Task 2's `sentRequest` JSON: `{ url: string, headers: Header[], queryParams: QueryParam[], body?: Body | null, auth: Auth }`.
- Produces:
  - `export interface SentRequest { url: string; headers: Header[]; queryParams: QueryParam[]; body?: Body | null; auth: Auth }` and `sentRequest?: SentRequest` on `ExecuteRequestResponse`, in `tauri-api.ts`.
  - `export function processEnvOnly(ctx: Record<string, string>): Record<string, string>` in `variable-context.ts`: the entries whose key starts with `process.env.`.

- [ ] **Step 1: Write the failing resolution tests**

Replace the `resolveRequestFieldsForPath with a pre-request rok.setVar` describe in `execute-request.folder.test.ts` with `describe('resolveRequestFieldsForPath for a send', ..)`. The fixture env holds `token = tok-123`; add a process env value `HOST_NAME = h1` through the file's `getProcessEnvVars` mock.

```ts
it('a_send_keeps_env_placeholders_for_the_backend', async () => {
  const resolved = await resolveRequestFieldsForPath(
    'api',
    PATH,
    request({
      url: 'https://api.example.com/{{token}}',
      headers: [{ id: '1', key: 'X-T', value: 'Bearer {{token}}', enabled: true }],
      body: { mode: 'json', content: '{"t":"{{token}}"}', formData: [] },
    }),
    true,
  );
  expect(resolved.url).toBe('https://api.example.com/{{token}}');
  expect(values(resolved.headers, 'X-T')).toEqual(['Bearer {{token}}']);
  expect(resolved.body?.content).toBe('{"t":"{{token}}"}');
});

it('a_send_fills_process_env_names', async () => {
  const resolved = await resolveRequestFieldsForPath(
    'api',
    PATH,
    request({ url: 'https://{{process.env.HOST_NAME}}/{{token}}' }),
    true,
  );
  expect(resolved.url).toBe('https://h1/{{token}}');
});

it('a_graphql_send_keeps_env_placeholders', async () => {
  // A graphql request whose query and variables use {{token}}: resolved.graphql keeps both.
});

it('a_path_that_runs_no_script_fills_every_name', async () => {
  const resolved = await resolveRequestFieldsForPath(
    'api',
    PATH,
    request({ url: 'https://api.example.com/{{token}}' }),
  );
  expect(resolved.url).toBe('https://api.example.com/tok-123');
});

it('a_send_still_collects_the_secret_values', async () => {
  // With a secret env variable, resolved.secretValues holds its value although no field was filled.
});

it('assertion_values_are_still_filled_for_a_send', async () => {
  // An assertion value '{{token}}' resolves to 'tok-123' with forSend = true.
});
```

The commented tests must be written with real asserts in the same style.

- [ ] **Step 2: Run them and confirm the first one fails**

Run: `bun run test execute-request.folder`
Expected: `a_send_keeps_env_placeholders_for_the_backend` FAILS (the URL holds `tok-123`).

- [ ] **Step 3: Change the send context**

In `variable-context.ts`, add `processEnvOnly` and delete `withoutScriptRuntimeVars`, `scriptRuntimeVarNames` and `SET_VAR_REGEX` (nothing else uses them). Delete their tests in `variable-context.test.ts` and add one test for `processEnvOnly`. In `resolveRequestFieldsForPath`, `fieldCtx` becomes `runsScript ? processEnvOnly(ctx) : ctx`. Replace the comment above it and the `forSend` doc comment with: for a send that runs scripts, only `process.env` names (owned by the frontend) are filled; every other name reaches the backend as written, which fills it after the scripts ran. Assertions keep `ctx`. The folder auth pick does not change.

- [ ] **Step 4: Run the resolution tests**

Run: `bun run test execute-request.folder variable-context`
Expected: PASS.

- [ ] **Step 5: Write the failing Console-row tests** in `execute-request.sent.test.ts`

Copy the mock scaffold of `execute-request.oauth.test.ts` (`tauri-api` with `executeRequest: vi.fn()`, the query client, `openTab`), with an env `dev` holding a secret `token = tok-old-123456` and a request whose header is `X-T: {{token}}` and whose auth is bearer `{{token}}`.

```ts
it('the_console_row_shows_the_sent_request', async () => {
  vi.mocked(executeRequest).mockResolvedValueOnce({
    ...execResult,
    sentRequest: {
      url: 'https://api.test/ping',
      headers: [{ key: 'X-T', value: 'sent-value', enabled: true }],
      queryParams: [],
      body: null,
      auth: { authType: 'none' },
    },
  });
  await sendRequest(TAB_ID, openTab(req));
  const row = useConsoleStore.getState().entries.find((e) => e.kind === 'http');
  expect(row?.requestHeaders).toContainEqual({ key: 'X-T', value: 'sent-value' });
});

it('the_console_row_masks_the_sent_bearer_token', async () => {
  // sentRequest.auth is bearer 'tok-new-7654321' (not in any env): the row's masked
  // Authorization value does not contain 'tok-new-7654321', and the raw row does.
});

it('without_a_sent_request_the_row_uses_the_input_fields', async () => {
  // executeRequest resolves execResult with no sentRequest: the row's X-T header is '{{token}}'.
});

it('the_ipc_input_keeps_the_token_placeholder', async () => {
  // After sendRequest, the ExecuteRequestInput passed to executeRequest has header X-T '{{token}}'.
});
```

Write the commented tests with real asserts. Read the exact masked-row field names from `HttpConsoleEntry` in `src/stores/console-store.ts`.

- [ ] **Step 6: Run them and confirm they fail**

Run: `bun run test execute-request.sent`
Expected: `the_console_row_shows_the_sent_request` and `the_console_row_masks_the_sent_bearer_token` FAIL.

- [ ] **Step 7: Build the Console row from `sentRequest`**

Add `SentRequest` and `sentRequest?` to `tauri-api.ts`. In `sendRequest`, after the response, take `const sent = result.sentRequest;` and when it is present use `sent.auth` for `authToConsoleHeaders` and for `buildMaskOptions`, `sent.headers` for the explicit headers, `sent.url` as the Console URL (it already has the path parameters), and `sent.body?.content` as the request body; for a GraphQL request with no sent body content, keep today's JSON of the query and variables. Without `sent`, keep today's code. `maskOptions` is built after the response for this reason. The error row (no response) stays as it is: it shows the input fields with their placeholders.

- [ ] **Step 8: Run the frontend checks**

Run: `bun run test execute-request runner-execute variable-context console`, then `bun run tsc --noEmit`, then `bun run check`.
Expected: PASS, no type or lint errors. Fix any existing test that passed `forSend = true` and expected a filled env value: it now expects the placeholder.

- [ ] **Step 9: Docs**

In `docs/features/console-masking.md`, "What is masked": the row of a single send is built from the request the backend sent (`sentRequest`), which arrives with RocketVault values already masked by the backend; other secrets are masked by the frontend as before. Add a manual check: a pre-request script that changes `{{token}}` shows the new token (masked, revealable) in the Console row.
