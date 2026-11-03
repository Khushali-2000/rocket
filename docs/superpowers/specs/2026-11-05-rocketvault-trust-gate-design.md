# RocketVault trust gate

Date: 2026-11-05. Status: draft, waiting for review.
Builds on: `2026-10-11-collection-trust-gate-design.md` (the trust gate) and `docs/features/collection-trust.md`.

## Problem

A collection pulled or cloned from elsewhere can reference `{{alias.secret}}` and read live RocketVault values through the user's environment bindings, and can select vault client certificates. Only `{{process.env.*}}` goes through the collection trust gate. The 2026-10-11 spec lists this as an accepted risk ("requests send what they reference"). RocketVault bindings need their own gate.

## Decisions (from the review)

- A withheld `{{alias.secret}}` stays unresolved text, nothing is fetched, and the Console warns. The send is never blocked (same as `process.env`).
- Two grant-only switches per collection, next to Host environment: **RocketVault values** and **RocketVault certificates**. A collection file never requests them.
- Only a collection with a trust record has both on: created in Rocket, grandfathered at the 2026-10-11 migration, or otherwise granted. A collection imported, cloned or opened from disk since that migration has no record and starts with both off until allowed. An old `trust.yml` record without the vault keys reads as allowed. Upgrade note: users with imported or cloned collections that use RocketVault must allow it once in the collection's trust settings (under review). Scratch requests (no collection) are always allowed.
- No migration notice entry, because collections with a record keep access.
- Out of scope: per-alias permissions.

## Design

### Capability model

- `crates/rocket-collection/src/trust.rs`: add `vault_values: bool` and `vault_certificates: bool` to `CollectionGrant` and `EffectiveCapabilities`. `untrusted()` sets both false. `resolve_effective` copies the grant values (grant-only, no file request).
- `crates/rocket-app/src/collection_trust.rs`: add `Capability::VaultValues` and `Capability::VaultCertificates`. `set_capability` writes the flag (no file write). `grant_requested` does not touch them. `migrate_legacy` is unchanged (it runs once).
- `crates/rocket-app/src/collection_service.rs` (~275): a collection created in Rocket gets both flags true (`GrantSource::Created`). Clones and imports get none.
- `crates/rocket-infra/src/fs_trust_store.rs`: `CollectionRecord` gets two fields with `#[serde(default = "default_true")]`, so an old record without the keys reads as allowed. New records write the keys explicitly. `FILE_VERSION` stays 1. A test loads an old record and expects both on.
- `crates/rocket-app/src/test_doubles.rs`: `InMemoryTrustStore::allow_all()` sets both flags. Services built with `DenyAllTrustStore` deny both.
- Wrapper `RequestExecutionService::vault_values_allowed(collection: Option<&str>)` and `vault_certificates_allowed(...)`, twins of `process_env_allowed` (`None` collection returns true, errors deny).

### Where the gate sits

- **Values:** inside `resolve_external_secrets_partial` (`execution_service.rs` ~875). When the collection is denied it returns an empty map and no failures, before `resolve_vault_secret_value` is called, plus a "withheld" signal for the Console. It returns `Ok`, so a Flow or runner run does not fail at its start. This one place covers the single send, the assistant, Flow, the runner, OAuth2, gRPC, WebSocket and GraphQL subscriptions. `rok.runRequest` reuses the outer map and `rok.getSecretVar` reads it, so both inherit the result.
- **Masking-only fetch:** `external_secret_values_for_environments` skips the fetch for a denied collection (nothing can use those values).
- **Flow:** Auth tokens, callback secrets and previous-run mask keys share the run's `external_secrets` map. Only the vault fetch is gated, never the whole map.
- **Certificates:** `with_vault_certificates` (`execution_service.rs` ~3135) passes no vault access to `materialize_selected` when the collection is denied. The result is the existing "no access" behaviour (the one the load test already uses), with a Console line naming the cause. Planning confirms the exact current outcome of `materialize_selected(.., None)` and the spec follows it; if it blocks the send rather than sending without the certificate, the warning wording says so.
- **Not gated:** the app-global agent credential (`AgentConfigService`, `resolve_secret_value`), which has no collection, and `fetch_external_secret_names` (names only).
- `{{alias.x}}` text is already left unresolved when a secret was deleted (`Ok(None)`), so unresolved vault placeholders are an existing, handled state. Environments `extends` only inside the collection's own repo, so no global bindings arrive under a collection's gate.

### Reporting

- Backend: a `vault_withheld` flag on `SendProcessEnv`-style state, one Console line (Warn, fixed text, only when the request was actually sent), and `ExecuteRequestOutput.vault_withheld` for nested runs, mirroring `process_env_withheld`. All `ExecuteRequestOutput` literals get the new field (`flow_run_cache.rs`, `flow_debug.rs`, `flow_wait.rs`, `flow_execution_service.rs`, `src-tauri/src/commands/execution.rs`). Flow Input nodes and the runner add the same entry as for host env.
- Detection of "referenced but withheld": when the gate denies, the send checks its templates for `{{alias.name}}` names that match an environment binding and adds the line only then, so a request with no vault placeholders stays quiet.
- Frontend: a `warnIfVaultWithheld` helper next to `src/lib/process-env-gate.ts` adds a console line and a toast for a single send. It reads the new `vaultValues` state from `getCollectionTrust`. It never blocks.

### UI and IPC

- `src-tauri/src/commands/collection_trust.rs`: `CapabilityDto` gets `VaultValues` and `VaultCertificates`; `CollectionTrustDto` gets `vault_values: {granted}` and `vault_certificates: {granted}`. No new command, so `app-commands.txt` is unchanged.
- `src/lib/tauri-api.ts`: extend `CollectionCapability` and `CollectionTrust`.
- `src/components/collections/CollectionTrustSection.tsx`: two rows like the Host environment row, with the same confirm dialog on enable. "Forget all permissions" text mentions them.
- `src/lib/queries/collection-trust-queries.ts`: invalidate the trust key on change (and the vault name queries if any cache values).

## Security reasoning

- The gate stops the fetch, not just the display: a denied collection never causes a keychain read or a network call to the vault.
- Defaults match today's behaviour for every existing collection, so nothing breaks on upgrade, and only newly cloned or imported collections start closed.
- A withheld placeholder is sent as written text; this reveals no value. The user sees the Console warning and decides.
- `Trusted means trusted` still holds: a collection allowed vault access can send vault values to any host its requests name (accepted risk, unchanged).

## Tests

- Trust model: `resolve_effective` for both flags; `untrusted()` false; `set_capability` writes and a revoke clears.
- Store: an old `trust.yml` record without the keys loads both true; a new record round-trips.
- Backend per path, with a counting fake `VaultSecretFetcher`: a denied collection never calls the fetcher for the single send, Flow run, runner, nested `rok.runRequest` and `external_secret_values_for_environments`; an allowed one still resolves; a scratch request (no collection) still resolves; the placeholder stays as written text and one Console line appears.
- Flow: a denied collection's run starts, Auth tokens and callback secrets still work, a `{{alias.x}}` Input value stays unresolved.
- Certificates: a denied collection does not call the fetcher for a vault certificate and the warning is added.
- Existing vault tests (`execution_service.rs` 5002-5520, `collection_runner_service.rs`, `flow_execution_service.rs`, `script_chain.rs`, `vault_certificates.rs`, `mcp_tool_service.rs`) get `with_trust_store(InMemoryTrustStore::allow_all())` where they need vault values.
- Frontend: Vitest for the new rows and `warnIfVaultWithheld`.

## Docs

`docs/features/collection-trust.md`: capability table rows (RocketVault values, RocketVault certificates, implicit/grant-only), a RocketVault section (gate position, who has it, reporting, not gated: agent credential and names), removal of the "RocketVault not trust-gated" limit wherever it appears, and a manual check (clone a collection, confirm the placeholder is withheld with a warning, allow it, confirm it resolves).

## Addendum (after the code check, same day)

These facts from the code replace the matching sentences above.

- **Certificates fail the send.** `materialize_selected(.., None)` marks a selected vault certificate `Unavailable`, and `ReqwestExecutor::load_identity` turns that into an `InvalidInput` error. So a denied collection's selected vault certificate makes that send fail. It is not sent without the certificate. The error text must say that RocketVault certificates are not allowed for this collection (no extra Console line is needed). The fetcher is never called.
- **OAuth2 token requests have a second certificate path.** `OAuth2Service::certificates_for` (token and refresh) has its own vault access and no trust store. It is gated too: a denied collection passes no vault access, so a selected vault certificate fails with the same text.
- **`migrate_legacy` changes.** The new fields force its grant literal to set both vault flags true, so collections grandfathered at the 2026-10-11 migration keep access.
- **Gate order.** In `resolve_external_secrets_partial` the gate sits after the environment is read and flattened (an `extends` cycle error still shows) and before the fetch loop.
- **Reporting.** The backend owns the Console line for every send, the manual single send included, because the backend resolves vault values for it. A separate flag `vault_withheld` (not `nested_withheld`) carries a nested run's warning. The frontend `warnIfVaultWithheld` toast is dropped, so a manual send does not warn twice. Flow and runner steps compute "referenced but withheld" per step in `resolve_request_parts`, because they never call `resolve_external_secrets_partial` per step. A name counts as a vault reference when it starts with `<alias>.` for an alias bound in the active environment (`flatten_scope(...).external_secrets`).
- **Frontend.** `makeTrust()` in `src/test/trust-fixtures.tsx` and every typed `CollectionTrust` mock gain both fields.
