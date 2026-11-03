# RocketVault trust gate, plan 1: model and backend gates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collection that is not allowed RocketVault never causes a vault fetch for values or client certificates.

**Architecture:** Two grant-only flags (`vault_values`, `vault_certificates`) join the trust model, the file store and the IPC DTO. `RequestExecutionService` gets `vault_values_allowed` and `vault_certificates_allowed` twins of `process_env_allowed`. The value gate sits inside `resolve_external_secrets_partial` (after the environment is flattened, before the fetch loop) and at the masking fetch. The certificate gate sits in `with_vault_certificates` and in the OAuth2 certificate path.

**Tech Stack:** Rust (`rocket-collection`, `rocket-app`, `rocket-infra`, `src-tauri`).

**Spec:** `docs/superpowers/specs/2026-11-05-rocketvault-trust-gate-design.md` (read the Addendum at the end, it overrides earlier text). Index: `2026-11-05-rocketvault-trust-gate-index.md`. This is plan 1 of 2. Plan 2 (reporting, UI, docs) follows.

## Global Constraints

- 📖 Before starting each task, read `docs/superpowers/specs/opencollection-spec-reference.md`.
- Both flags are grant-only: no collection file ever requests them. `CollectionGrant::default()` has them false. A `trust.yml` record that lacks the keys reads as true (`#[serde(default = "default_true")]` in `fs_trust_store.rs`), and a record written by `CollectionRecord::new` writes both keys explicitly.
- Defaults: collections created in Rocket and grandfathered ones (`migrate_legacy`) have both true. Clones and imports have no record, so both are false. A `None` collection (scratch) is always allowed. A trust read error denies.
- The gate stops the fetch itself: a denied collection must never call `resolve_vault_secret_value` or a certificate export. Tests prove it with a counting fetcher and pair every denied test with an allowed twin that asserts the fetcher was called, so a denied test cannot pass for the wrong reason.
- Gate only the vault fetch, never the whole `external_secrets` map (Flow adds Auth tokens, callback secrets and previous-run mask keys to the same map).
- Not gated: the app-global agent credential (`AgentConfigService`, `resolve_secret_value`) and `fetch_external_secret_names` (names only).
- Existing tests that fetch vault values for a `Some(collection)` send add `.with_trust_store(crate::test_doubles::InMemoryTrustStore::allow_all())`. `allow_all()` gets both flags true.
- No panicking calls in production code. Comments are short full sentences ending with a period. Run cargo with `-j4`, never `--workspace`.

## Review Focus

- A cloned collection (no trust record) must not fetch vault values through the single send, a Flow run, the runner, the assistant, OAuth2, gRPC, WebSocket or a nested `rok.runRequest` (Task 2).
- An old `trust.yml` without the keys must keep both flags on after upgrade (Task 1).
- A denied collection's Flow run must still start, and Auth-node tokens and callback secrets must still work (Task 2).
- A denied collection's selected vault certificate must fail the send with a clear message and never call the exporter, for the executor and for OAuth2 token requests (Task 3).
- A scratch request (no collection) must keep full vault access (Tasks 2 and 3).

---

### Task 1: Trust model, store, IPC DTO

**Files:**
- Modify: `crates/rocket-collection/src/trust.rs`
- Modify: `crates/rocket-app/src/collection_trust.rs`
- Modify: `crates/rocket-app/src/collection_service.rs` (~276)
- Modify: `crates/rocket-app/src/test_doubles.rs` (`InMemoryTrustStore::grant_for`, ~82)
- Modify: `crates/rocket-infra/src/fs_trust_store.rs`
- Modify: `src-tauri/src/commands/collection_trust.rs`
- Modify: every full `CollectionGrant { .. }` literal: `execution_service.rs` (~14240 test), plus the ones in the files above.

**Interfaces:**
- Produces: `CollectionGrant.vault_values: bool`, `CollectionGrant.vault_certificates: bool`; `EffectiveCapabilities.vault_values: bool`, `EffectiveCapabilities.vault_certificates: bool`; `Capability::VaultValues`, `Capability::VaultCertificates` (`collection_trust.rs`); `CapabilityDto::{VaultValues, VaultCertificates}` and `CollectionTrustDto.vault_values: ProcessEnvStateDto`, `vault_certificates: ProcessEnvStateDto` (camelCase over IPC: `vaultValues`, `vaultCertificates`; rename the DTO to `GrantStateDto` if that reads better, keeping `granted: bool`).

- [ ] **Step 1: Write failing tests.**
  - `trust.rs`: `vault_flags_follow_the_grant_only` copying `process_env_follows_the_grant_only` (~:328): a grant with both flags true gives both effective true, a default grant gives both false, and `untrusted()` has both false. Update the `grant(dev, roots, agent, env)` helper (~:243) to keep compiling with `..Default::default()`.
  - `collection_trust.rs`: `vault_capabilities_are_set_and_revoked` after `agent_run_and_process_env_capabilities` (~:361): `set_capability("c", Capability::VaultValues, true)` gives `effective("c").vault_values`, `VaultCertificates` independent of it, and disabling clears each. `grant_requested` with a requested set never changes the vault flags. `migrate_legacy` result has both flags true (extend the existing migration test).
  - `collection_service.rs`: extend `create_grants_process_env_only` (~:2529) to assert both vault flags true. Add `a_cloned_collection_has_no_vault_access`: after `clone`/import there is no record (reuse the neighbouring clone test's setup), so `effective` has both false.
  - `fs_trust_store.rs`: `an_old_record_without_vault_keys_loads_both_allowed` writes a record yaml without the keys (copy the raw `fs::write` setup of `a_record_without_a_uid_matches_on_path_alone`, ~:366) and asserts `to_grant()` has both true. Extend `a_grant_round_trips_with_snake_case_keys` (~:343) to assert the yaml contains `vault_values: true` and `vault_certificates: true`, and that a grant with both false round-trips as false.
  - `src-tauri/src/commands/collection_trust.rs`: a DTO test that `CollectionTrustDto` carries `vault_values.granted` and `vault_certificates.granted` from the grant, and that a missing grant shows false, plus a serde test that `CapabilityDto` parses `"vaultValues"` and `"vaultCertificates"`.

- [ ] **Step 2: Run** `cargo test -j4 -p rocket-collection trust`, `cargo test -j4 -p rocket-app collection_trust`, `cargo test -j4 -p rocket-infra fs_trust_store`. Expect compile failures or FAIL.

- [ ] **Step 3: Implement.**
  - `trust.rs`: add the four fields (grant derives `Default`, so they default false); `untrusted()` false; `resolve_effective` copies the grant values.
  - `collection_trust.rs`: add the two `Capability` variants. `set_capability` first `match` gets arms writing the grant flag (no file write; the second `match` already ends with `_ => {}`). `grant_requested` gets `Capability::VaultValues | Capability::VaultCertificates => {}`. `migrate_legacy` sets both flags true in its grant literal.
  - `collection_service.rs`: the `GrantSource::Created` grant sets both true, and the comment above it (:272-273) is updated.
  - `fs_trust_store.rs`: `CollectionRecord` gets `#[serde(default = "default_true")] vault_values: bool` and the same for `vault_certificates` (add a private `fn default_true() -> bool { true }`), mapped in `new` and `to_grant`.
  - `test_doubles.rs`: `InMemoryTrustStore::allow_all()` grants set both true.
  - `src-tauri`: `CapabilityDto` variants with their `From` arm (`RequestedCapabilityDto` does NOT get them), and the two DTO states filled from `grant.vault_values` and `grant.vault_certificates` in `From<TrustStatus>`.
  - Fix every other `CollectionGrant` literal the compiler reports (list in the Files block). Literals that use `..Default::default()` need no change.

- [ ] **Step 4: Run** the three commands of Step 2, then `cargo check -j4` (workspace check, not tests) and `cargo test -j4 -p rocket-app execution_service`. Expect PASS. Run `cargo clippy -j4 -p rocket-app -p rocket-collection -p rocket-infra` with no new warnings.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill (explicit paths): `feat(trust): add RocketVault values and certificates capabilities`.

### Task 2: Value gate

**Files:**
- Modify: `crates/rocket-app/src/execution_service.rs` (`vault_values_allowed`, `resolve_external_secrets_partial` ~875, `external_secret_values_for_environments` ~1236, test updates)
- Modify: test fixtures that fetch vault values for a `Some(collection)` send (list below)

**Interfaces:**
- Consumes: `EffectiveCapabilities.vault_values`, `InMemoryTrustStore::allow_all()` from Task 1.
- Produces: `pub fn vault_values_allowed(&self, collection: Option<&str>) -> bool` on `RequestExecutionService` (`None` is true, otherwise `self.effective_capabilities(name).vault_values`), placed next to `process_env_allowed` (~1334). Plan 2 calls it.

- [ ] **Step 1: Update existing tests first** so only the gate can fail them. Add `.with_trust_store(crate::test_doubles::InMemoryTrustStore::allow_all())` to:
  - `execution_service.rs`: `execute_resolves_external_secrets_through_the_collection_scoped_env_repo_not_the_global_one` (~:5287).
  - `collection_runner_service.rs`: `resolves_external_secrets_exactly_once_per_run_not_once_per_step` (~:651), `a_script_write_with_a_vault_secret_is_held_back_in_runner_mode` (~:765), `resolves_external_secrets_through_the_collection_scoped_env_repo_not_the_global_one` (~:830).
  - `flow_execution_service.rs`: `resolves_external_secrets_once_per_run_not_once_per_request_node` (~:5761), `a_wire_script_resolves_a_vault_alias_with_a_hyphen` (~:12235), `a_vault_reference_bearer_sends_the_vault_value_and_masks_it` (~:13043).
  - `execution_service/script_chain.rs`: the `service()` helper in `secret_scan_tests` (~:1003).
  - `execution_service/script_host_tests.rs`: helpers `failing_vault_service` (~:1109) and `value_vault_service` (~:1200), and the inline builder in `nested_e2e_a_vault_name_inside_an_env_value_is_sent_as_written` (~:2028-2064).
  - `mcp_tool_service.rs`: in `vault_chip_service_with_factory` (~:3637-3672) the inner `RequestExecutionService` (not only the `McpToolService`) gets the store.
  Run `cargo test -j4 -p rocket-app` for each module name and expect PASS (the gate does not exist yet).

- [ ] **Step 2: Write failing gate tests** (module-local fetcher in `execution_service.rs` tests, or `crate::test_doubles::FakeVaultSecretFetcher` with `call_count()`; give it the `FakeSecretManagerRepo` and `FakeSecretStore` setup of the existing vault tests so an allowed call really fetches). One denied/allowed pair for each path; denied uses `InMemoryTrustStore::new()` (no grant for the collection):
  - `a_denied_collection_never_fetches_vault_values_on_a_single_send`: `execute` with `collection: Some("c")`, an environment with a binding, request text `{{vault.key}}`. Assert `fetcher.call_count() == 0` and the sent URL/body still holds the text `{{vault.key}}`. Allowed twin asserts the value was sent and `call_count() >= 1`.
  - `a_scratch_request_keeps_vault_access`: `collection: None` with a global-env binding resolves (`call_count() >= 1`).
  - `a_denied_collection_runner_run_never_fetches` (`collection_runner_service.rs`) and `a_denied_collection_flow_run_starts_and_never_fetches` (`flow_execution_service.rs`): the run completes, `call_count() == 0`, the Auth-node token wired into a header still arrives (reuse the Auth test setup nearest to `a_vault_reference_bearer...`), and a callback secret still masks.
  - `a_denied_collection_nested_run_request_never_fetches` (`script_host_tests.rs`): `rok.runRequest` inside a denied send resolves nothing and `call_count() == 0`.
  - `a_denied_collection_chip_masking_does_not_fetch` (`mcp_tool_service.rs`): `external_secret_values_for_environments("c", ..)` returns an empty set and `call_count() == 0`.
  - `a_denied_collection_still_reports_an_extends_cycle`: a denied collection whose environment `extends` cycle makes `resolve_external_secrets(Some("c"), Some("a"))` return the same error as an allowed one (gate order).
  - `grpc/oauth2/websocket`: no new test; they call `resolve_external_secrets` and inherit the gate. Add one `websocket_resolution.rs` test only if an existing vault-free test helper makes it a few lines.

- [ ] **Step 3: Run** the new tests by name and expect FAIL.

- [ ] **Step 4: Implement.** Add `vault_values_allowed`. In `resolve_external_secrets_partial`, after `flatten_scope(&env, repo.as_ref())?` and before the binding loop, `if !self.vault_values_allowed(collection) { return Ok((result, failures)); }` with a short comment. In `external_secret_values_for_environments`, at the top: `if !self.vault_values_allowed(Some(collection)) { return Ok(HashSet::new()); }`. No other production change.

- [ ] **Step 5: Run** the new tests, then `cargo test -j4 -p rocket-app` (the whole crate lib tests, expect all PASS) and `cargo test -j4 -p rocket-app --lib -- vault`. `cargo clippy -j4 -p rocket-app` clean.

- [ ] **Step 6: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(trust): withhold RocketVault values from collections that are not allowed`.

### Task 3: Certificate gate (executor and OAuth2)

**Files:**
- Modify: `crates/rocket-app/src/execution_service.rs` (`with_vault_certificates` ~3136, its callers `send_request` ~3115 and `script_host.rs:145`, `vault_certificates_allowed`)
- Modify: `crates/rocket-app/src/vault_certificates.rs` (denied reason text)
- Modify: `crates/rocket-app/src/oauth2_service.rs` (`certificates_for` ~251) and its callers in `src-tauri/src/commands/oauth2.rs`
- Test: `vault_certificates.rs`, `execution_service.rs`, `oauth2_service.rs` tests

**Interfaces:**
- Consumes: `EffectiveCapabilities.vault_certificates` from Task 1.
- Produces: `pub fn vault_certificates_allowed(&self, collection: Option<&str>) -> bool` (same shape as Task 2's). `with_vault_certificates` gains a `collection: Option<&str>` parameter (or an `allowed: bool`). A new `pub(crate) const VAULT_CERTIFICATES_DENIED: &str` in `vault_certificates.rs`: the reason text used for denied entries, containing the sentence "RocketVault certificates are not allowed for this collection".

- [ ] **Step 1: Write failing tests** (counting `FakeCertificateFetcher::calls()`; copy the setup of `vault_certificates.rs` tests ~:792-931 with `input.collection = Some("c")`):
  - `a_denied_collection_fails_a_selected_vault_certificate_without_exporting`: `InMemoryTrustStore::new()`; send with a selected vault certificate. The result is the `InvalidInput` error whose text contains "RocketVault certificates are not allowed for this collection", and `fetcher.calls().is_empty()`. Allowed twin (`allow_all()`) asserts the exporter was called once. Scratch twin (`collection: None`) asserts it was called.
  - `a_denied_collection_nested_run_request_certificate_never_exports` in `script_host_tests.rs` (call path `script_host.rs:145`).
  - `a_denied_collection_oauth2_token_request_fails_a_selected_vault_certificate`: `oauth2_service(..).with_vault_access` with the denied flag; error text as above and no exporter call. Allowed twin exports (copy `a_token_request_fetches_the_certificate_selected_for_the_token_url`, ~:929).
  - `a_certificate_not_selected_for_the_url_is_never_denied`: a denied collection with a vault certificate entry that does not match the URL sends normally (`needs_fetch` is false).

- [ ] **Step 2: Run** the tests and expect FAIL.

- [ ] **Step 3: Implement.**
  - `vault_certificates_allowed` next to `process_env_allowed`.
  - `with_vault_certificates(&self, request, collection: Option<&str>)`: when `needs_fetch` is true and the collection is denied, mark each selected deferred entry `ResolvedClientCertificate::unavailable(domain, <label> + VAULT_CERTIFICATES_DENIED)` without building a `VaultCertificateAccess` (add a small `deny_selected(certificates, urls)` helper in `vault_certificates.rs` that mirrors `materialize_selected`'s selection but never touches the fetcher; reuse its selection code, do not duplicate it). Pass the collection from `send_request` (it has `input` in scope at ~3583/~3622 and in the runner at `collection_runner_service.rs:456`; add the parameter to `send_request` or read the collection from `PhaseState` by adding a `collection: Option<String>` field set in `begin_phases`, whichever touches fewer call sites) and from `script_host.rs:145` (`self.input.collection`). Update `svc.send_request(&state)` in the tests (~:14313).
  - `OAuth2Service::certificates_for`: take an `allow_vault_certificates: bool` (or the collection plus a gate closure). When false, behave as in `deny_selected`. In `src-tauri/src/commands/oauth2.rs` (~273, ~314) compute it with `vault_certificates_allowed(req.collection.as_deref())` from the execution service handle already in scope (if only the trust store is available there, add a small accessor on `RequestExecutionService`).

- [ ] **Step 4: Run** the new tests, then `cargo test -j4 -p rocket-app` and `cargo test -j4 -p rocket-app oauth2` and `cargo check -j4`. Expect PASS. `cargo clippy -j4 -p rocket-app` clean.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(trust): withhold RocketVault certificates from collections that are not allowed`.
