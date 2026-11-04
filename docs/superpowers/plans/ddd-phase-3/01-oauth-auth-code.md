# OAuth Auth-Code Flow Out Of The Command Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src-tauri/src/commands/oauth2.rs` only validates, calls a service and maps the result (D-30, D-31). The state check, URL building, PKCE and token exchange live in `OAuth2Service`. The localhost callback server lives in `rocket-infra`. The deprecated `oauth2_auth_code_flow` command is removed.

**Architecture:** `rocket-app` gets a port `AuthCodeBrowser` (open the authorization URL, return the code and the redirect URI used) and `OAuth2Service::authorize_with_code` that owns PKCE, state, URL building, the callback checks and the token exchange. `rocket-infra` gets `LoopbackCallbackServer` (bind `127.0.0.1:0`, serve one callback, HTML reply). `src-tauri` gets `TauriAuthBrowser` (webview, system browser through the opener, Linux cookie clearing) that implements the port and uses the infra server. The command builds the browser and calls the service.

**Ruling (2026-11-04, user):** a new loopback port, separate from the Flow `CallbackListener`. The existing `CallbackListener` serves `/cb/<token>` with JSON replies, so it does not fit the OAuth redirect (see the finding on D-30 in the roadmap).

**Tech Stack:** Rust, tokio, `async-trait`, `wiremock` (existing in `rocket-app` tests), `tauri` and `tauri-plugin-opener` (only in `src-tauri`).

**Spec:** `docs/roadmaps/ddd-roadmap.md` (D-30, D-31); `docs/superpowers/specs/opencollection-spec-reference.md`; `.claude/rules/tauri-ipc-boundaries.md`.

## Global Constraints

- Before each task: read `docs/superpowers/specs/opencollection-spec-reference.md` (auth configuration is in scope).
- Cargo commands pass `-j4` and `-p <crate>`; never `--workspace`. The Tauri crate is `-p rocket`.
- No panicking `Option`/`Result` unwrap in production paths; tests use `.expect("...")` (the project hook blocks the unwrap call text in edits).
- Commands stay thin. The IPC DTOs and command names do not change, except the removal of `oauth2_auth_code_flow` (also from `src-tauri/app-commands.txt`).
- `rocket-app` holds `Box<dyn Trait>` / `Arc<dyn Trait>` only; no `tokio::net` in `rocket-app`.
- No commit inside the plan; one `refactor:` commit at the end, explicit paths, `dev-workflow-skills:1-git-commit`.

## Review Focus

- State mismatch, an `error` parameter and a missing `code` must each fail without exchanging a token (tested with a fake browser and a mock token server that records zero calls).
- An `error_description` from the provider is shown to the user in the error text; it must not contain the authorization URL, the code or the PKCE verifier.
- The callback server must answer a malformed first request without panicking, and must free the port after the first accepted callback or the 120 s timeout.
- The loopback server binds `127.0.0.1` only, never `0.0.0.0`.
- Webview mode keeps using the configured `callback_url`; system-browser mode uses the `http://localhost:{port}/callback` URI it bound, and the token exchange must send that same redirect URI.

---

### Task 1: `AuthCodeBrowser` port and `OAuth2Service::authorize_with_code` (D-31)

**Files:**
- Create: `crates/rocket-app/src/auth_code.rs` (port, request type, pure helpers)
- Modify: `crates/rocket-app/src/oauth2_service.rs` (new method), `crates/rocket-app/src/lib.rs` (export), `crates/rocket-app/src/test_doubles.rs` (fake browser)
- Test: in `auth_code.rs` (pure helpers) and in `oauth2_service.rs` tests (with `wiremock`)

**Interfaces:**
- Produces, in `auth_code.rs`:
  - `pub struct AuthCodeRequest { pub auth_url: String, pub callback_url: String, pub state: String, pub verify_ssl: bool, pub use_system_browser: bool, pub force_reauth: bool }`
  - `pub struct AuthCodeGrant { pub code: String, pub redirect_uri: String }`
  - `#[async_trait] pub trait AuthCodeBrowser: Send + Sync { async fn authorize(&self, request: AuthCodeRequest) -> DomainResult<AuthCodeGrant>; }`
  - `pub fn build_auth_url(authorization_url: &str, client_id: &str, redirect_uri: &str, pkce: Option<&PkcePair>, state: &str, scope: Option<&str>, auth_params: &[AdditionalParam]) -> String` (moved from `build_auth_url_v2` plus `apply_params_to_url`)
  - `pub fn check_callback(params: &[(String, String)], expected_state: &str) -> DomainResult<String>` returns the code. Order: `error` (message `Authorization denied: <error_description or error>`), then state mismatch (`State mismatch — possible CSRF attack.`), then missing code (`No authorization code in callback.`). Error variant: `DomainError::Internal`, as today.
  - `pub fn choose_state(configured: Option<&str>) -> String` (non-empty configured value, else a new UUID v4)
- Produces, in `oauth2_service.rs`: `pub async fn authorize_with_code(&self, config: &ResolvedOAuth2Config, browser: &dyn AuthCodeBrowser, host_env: &ProcessEnv) -> DomainResult<OAuthToken>`.
- Consumes: `rocket_http::{generate_pkce, PkcePair, apply_params_to_url, OAuthToken, AdditionalParam}` and the existing `exchange_code_for_token_with_host_env`.

- [ ] **Step 1: Write the failing tests for the pure helpers**

In `auth_code.rs` tests: `check_callback_returns_code`, `check_callback_error_param_wins_over_state` (error present and state wrong gives `Authorization denied: ...`), `check_callback_rejects_state_mismatch`, `check_callback_rejects_missing_code`, `build_auth_url_adds_pkce_and_scope` (assert `code_challenge_method=S256` and `scope=` are present, and absent without PKCE and scope), `build_auth_url_applies_auth_params`, `choose_state_keeps_configured_and_generates_otherwise` (empty string counts as not configured; generated value parses as a UUID).

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -j4 -p rocket-app auth_code`
Expected: compile error (module missing), then FAIL after stubs.

- [ ] **Step 3: Implement the module and export it**

Move `build_auth_url_v2` and `urlencoding_encode` from the command file into `auth_code.rs` (keep the exact output format so the URL stays byte-identical for the same inputs). Add `pub mod auth_code;` and re-exports of `AuthCodeBrowser`, `AuthCodeRequest`, `AuthCodeGrant` in `lib.rs`.

- [ ] **Step 4: Write the failing service tests**

In `oauth2_service.rs` tests, with a `FakeAuthCodeBrowser` in `test_doubles.rs` (records the `AuthCodeRequest`, returns a preset `AuthCodeGrant` or error) and a `wiremock` token server:
`authorize_with_code_exchanges_code_with_pkce_verifier` (browser returns code `abc`; the token request body contains `code=abc`, a `code_verifier`, and `redirect_uri` equal to the grant's `redirect_uri`),
`authorize_with_code_uses_browser_redirect_uri_not_config` (grant redirect `http://localhost:5555/callback`, config callback differs, the body has the grant's),
`authorize_with_code_passes_state_and_url_to_browser` (the recorded request's `auth_url` contains the same `state` the request carries),
`authorize_with_code_browser_error_makes_no_token_request` (the mock server expects 0 calls).

- [ ] **Step 5: Implement `authorize_with_code` and run**

PKCE only when `config.use_pkce`; state from `choose_state(config.state.as_deref())`; URL from `build_auth_url`; call the browser with `use_system_browser`, `verify_ssl`, `force_reauth` and `callback_url` from the config; then `exchange_code_for_token_with_host_env(config, &grant.code, &grant.redirect_uri, verifier, host_env)`.
Run: `cargo test -j4 -p rocket-app auth_code` and `cargo test -j4 -p rocket-app oauth2_service`
Expected: all pass.

---

### Task 2: `LoopbackCallbackServer` in `rocket-infra` (D-30)

**Files:**
- Create: `crates/rocket-infra/src/loopback_callback.rs`
- Modify: `crates/rocket-infra/src/lib.rs` (export)
- Test: in the new file, using a real `tokio::net::TcpStream` client

**Interfaces:**
- Consumes: nothing from earlier tasks (the infra crate does not depend on `rocket-app`; the adapter in Task 3 maps to `check_callback`).
- Produces:
  - `pub struct LoopbackCallbackServer { listener: tokio::net::TcpListener, port: u16 }`
  - `pub async fn LoopbackCallbackServer::bind() -> DomainResult<LoopbackCallbackServer>` (binds `127.0.0.1:0`)
  - `pub fn redirect_uri(&self) -> String` (`http://localhost:{port}/callback`)
  - `pub async fn wait_for_callback(self, timeout: std::time::Duration, verdict: impl FnOnce(&[(String, String)]) -> bool) -> DomainResult<Vec<(String, String)>>` accepts one connection, parses the request line and query, calls `verdict` to choose the success or the failure HTML page, writes the reply, returns the query pairs. Timeout error text: `Authorization timed out (<n>s). Please try again.` with the seconds taken from the duration.
  - The two HTML constants move here from the command file, unchanged.

- [ ] **Step 1: Write the failing tests**

`redirect_uri_uses_bound_port`, `returns_query_pairs_and_replies_success_html` (client sends `GET /callback?code=c1&state=s1 HTTP/1.1`, verdict true, reply contains `Authorization successful`), `replies_failure_html_when_verdict_false`, `malformed_request_does_not_panic` (client sends `garbage\r\n\r\n`, result is an empty pair list, verdict still called), `times_out_when_no_client` (50 ms timeout, error text starts with `Authorization timed out`), `binds_loopback_only` (the local address is `127.0.0.1`).

- [ ] **Step 2: Run to verify they fail, implement, run again**

Run: `cargo test -j4 -p rocket-infra loopback_callback`
Expected: FAIL first, then PASS. Read at most 4096 bytes of the first request as today; parse the target with `url::form_urlencoded`.

- [ ] **Step 3: Check the crate**

Run: `cargo check -j4 -p rocket-infra` and `cargo clippy -j4 -p rocket-infra`
Expected: no new warnings.

---

### Task 3: `TauriAuthBrowser`, thin command, remove the deprecated command (D-30, D-31)

**Files:**
- Create: `src-tauri/src/auth_browser.rs` (implements `AuthCodeBrowser`; webview, opener, Linux clearing, system browser through `LoopbackCallbackServer`)
- Modify: `src-tauri/src/commands/oauth2.rs` (shrinks to the three thin commands), `src-tauri/src/lib.rs` (module and command list), `src-tauri/app-commands.txt` (remove `oauth2_auth_code_flow`), `src/lib/tauri-api.ts` (remove `oauth2AuthCodeFlow`, 0 callers)
- Test: `src-tauri` unit tests for the pure parts; manual checks below

**Interfaces:**
- Consumes: `AuthCodeBrowser`, `AuthCodeRequest`, `AuthCodeGrant`, `check_callback`, `OAuth2Service::authorize_with_code` (Task 1); `LoopbackCallbackServer` (Task 2).
- Produces: `pub struct TauriAuthBrowser { app: tauri::AppHandle }` with `impl AuthCodeBrowser`. In system-browser mode it binds the server, replaces `redirect_uri` in the URL (`replace_redirect_uri_in_url` moves here), opens the URL, waits 120 s, runs `check_callback` on the returned pairs and returns `AuthCodeGrant { code, redirect_uri }`. In webview mode it keeps today's `auth_code_via_webview` and returns the configured `callback_url` as `redirect_uri`.

- [ ] **Step 1: Write the failing tests for the moved pure helpers**

`replace_redirect_uri_in_url` tests (existing behavior: replaces only the `redirect_uri` value, keeps other params, leaves an unparsable URL as is). Move the existing tests if the command file has any (`grep -n "mod tests" src-tauri/src/commands/oauth2.rs`).

- [ ] **Step 2: Move the code**

Move `auth_code_via_webview`, `auth_code_via_system_browser` (now using `LoopbackCallbackServer` and `check_callback`), `replace_redirect_uri_in_url`, the Linux clearing block and the `extract_code_or_error`, `has_auth_params` and `redirect_uri_prefix` helpers (used by the webview path) into `auth_browser.rs`. Delete `oauth2_auth_code_flow`, `build_auth_url`, `urlencoding_encode`, `AuthCodeResult` and the unused imports from `commands/oauth2.rs`.

- [ ] **Step 3: Thin the command**

`oauth2_get_token` keeps its resolve steps, then for `authorization_code` calls `svc.authorize_with_code(&config, &TauriAuthBrowser::new(app), &host_env)`. Remove `auth_code_flow` from the command file.

- [ ] **Step 4: Remove the deprecated command everywhere**

Remove it from `lib.rs`, `app-commands.txt` and `tauri-api.ts`. Run: `grep -rn "oauth2_auth_code_flow\|oauth2AuthCodeFlow" src src-tauri` (expect no hits), then `bun run tsc --noEmit` and `bun run check`.

- [ ] **Step 5: Verify**

Run: `cargo check -j4 -p rocket`, `cargo clippy -j4 -p rocket`, `cargo test -j4 -p rocket oauth2`, `cargo test -j4 -p rocket-app oauth2_service`, `cargo test -j4 -p rocket-infra loopback_callback`.
Expected: all pass; `wc -l src-tauri/src/commands/oauth2.rs` is well under half of the 706 lines.

- [ ] **Step 6: Manual checks (record in the ledger, cannot run headless)**

1. System browser flow against a real provider: the browser opens, the tab shows "Authorization successful", the token arrives.
2. Webview flow (Linux default): the window opens, the redirect is intercepted, the token arrives.
3. Force re-authentication on Linux still clears cookies.
4. Closing the browser tab without finishing ends with the 120 s timeout message and frees the port.
