# RocketVault trust gate, plan 2: reporting, UI and docs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A withheld `{{alias.secret}}` warns once in the Console, the collection trust settings show and toggle both RocketVault switches, and the docs describe the gate.

**Architecture:** Backend: a `vault_withheld` path parallel to `process_env_withheld` (own Console entry, own nested flag, own output field), computed per send in `resolve_request_parts` from the active environment's binding aliases. Frontend: two rows in `CollectionTrustSection` and the typed `CollectionTrust` fields. No frontend warning helper (the backend owns the Console line for every send, manual sends included).

**Tech Stack:** Rust (`rocket-app`), React + TypeScript (Bun, Vitest, Biome).

**Spec:** `docs/superpowers/specs/2026-11-05-rocketvault-trust-gate-design.md` (read the Addendum). Index: `2026-11-05-rocketvault-trust-gate-index.md`. This is plan 2 of 2. It needs plan 1 (commits on this branch): `vault_values_allowed`, the two flags and `CapabilityDto::{VaultValues, VaultCertificates}`.

## Global Constraints

- 📖 Before Task 4, read `docs/superpowers/specs/opencollection-spec-reference.md`.
- The Console entry is a Warn with fixed text: "RocketVault values are not allowed for this collection, so {{alias.NAME}} was sent unresolved." It is added once per send, only when the request was actually sent, and only when the request references a bound alias. A request with no vault placeholder stays quiet. It does not reuse `process_env_withheld_entry` or `nested_withheld`.
- "Referenced" means a template name that starts with `<alias>.` for an alias bound in the active environment (`flatten_scope(&env, repo)?.external_secrets[].binding.alias`). There is no typed way to tell a vault name from a dotted variable, so the alias set is the discriminator.
- Frontend: shadcn/ui primitives only, `lucide-react` icons only, no full destructuring of Zustand state. After changes run `bun run tsc --noEmit` and `bun run check`.
- Run cargo with `-j4`, never `--workspace`. No panicking calls in production code. Comments are short full sentences ending with a period.

## Review Focus

- A denied send that references `{{vault.key}}` gets exactly one Console line, also for a manual single send and for each Flow or runner step that references one (Task 4).
- A denied nested `rok.runRequest` that references a vault alias warns once in its caller, not twice (Task 4).
- A request with no vault placeholder, or an allowed collection, gets no line (Task 4).
- Both switches show, enable (with the confirm dialog) and revoke in the UI, and `tsc` passes with the new `CollectionTrust` fields (Task 5).

---

### Task 4: Backend withheld reporting

**Files:**
- Modify: `crates/rocket-app/src/execution_service.rs` (`ExecuteRequestOutput` ~223 and its Debug ~252, `SendProcessEnv`-style state, `PhaseState` ~532 and its literal ~2712, `resolve_request_parts` ~1689, `finish_phases` ~3359, a `vault_withheld_entry()` next to `process_env_withheld_entry` ~485)
- Modify: `crates/rocket-app/src/runtime_fill.rs` (`FieldTemplate::vault_names`)
- Modify: `crates/rocket-app/src/execution_service/script_host.rs` (~62, ~259 nested flag)
- Modify: `crates/rocket-app/src/collection_runner_service.rs` (~436), `flow_execution_service.rs` (Input arm ~1808 and Request logs), and every `ExecuteRequestOutput { .. }` literal: `flow_debug.rs:307`, `flow_run_cache.rs:1182`, `flow_wait.rs:43`, `flow_execution_service.rs:3064`, `src-tauri/src/commands/execution.rs:138,163,191`, `execution_service.rs:3426`.

**Interfaces:**
- Consumes: `vault_values_allowed`.
- Produces: `pub vault_withheld: bool` on `ExecuteRequestOutput` (not serialized, like `process_env_withheld`); `pub(crate) fn vault_withheld_entry(alias_example: &str) -> ConsoleEntry` (Warn, text in Global Constraints with `NAME` replaced by the first withheld name, e.g. `vault.key`); `FieldTemplate::vault_names<'a>(&'a self, aliases: &'a HashSet<String>) -> impl Iterator<Item = &'a str>`; `SendProcessEnv.withheld_vault_names: Vec<String>`; `PhaseState.nested_vault_withheld: Arc<AtomicBool>`.

- [ ] **Step 1: Write failing tests** (copy the withheld tests nearest to `withheld_entry_is_a_warning_with_the_frontend_text` ~:14134, `withheld_input` ~:14114 and `withheld_count` ~:14126 for the harness; denied store `InMemoryTrustStore::new()`):
  - `a_denied_send_that_uses_a_vault_alias_adds_one_console_line`: env binding alias `vault`, URL `https://x/{{vault.key}}`, collection denied: exactly one entry equal to `vault_withheld_entry("vault.key")`, URL still holds the text, `output.vault_withheld` is true.
  - `a_denied_send_without_a_vault_name_adds_no_line`: same env, URL uses only `{{host}}`; no vault entry.
  - `an_allowed_send_adds_no_vault_line`: `allow_all()`; no entry, fetcher called.
  - `a_dotted_variable_that_is_not_a_bound_alias_adds_no_line`: URL `{{a.b}}` with `a` not a binding alias.
  - `a_denied_nested_run_request_warns_once_in_its_caller` in `script_host_tests.rs` (copy `a_nested_withheld_run_warns_once_across_output_and_events`, ~:1786): the nested request references the alias; the caller's Console has one vault entry, the nested run's own console none.
  - Flow: `a_flow_request_step_with_a_withheld_vault_alias_warns_in_its_logs` (copy `a_flow_step_with_a_withheld_value_warns_in_its_logs`, ~:12822) and `a_flow_input_node_warns_only_for_a_vault_placeholder_when_withheld` (copy ~:11011).
  - Runner: one line per step that references the alias (copy the runner `withheld_lines` test ~:1989).
  - `FieldTemplate::vault_names` unit test in `runtime_fill.rs`: yields only names that start with `<alias>.` for a given alias set.

- [ ] **Step 2: Run** the new tests and expect FAIL (compile errors first).

- [ ] **Step 3: Implement.**
  - `FieldTemplate::vault_names` mirrors `process_env_names` (`runtime_fill.rs:42`).
  - In `resolve_request_parts` (~:1689-1695 `rec` closure and the auth part ~:1731-1741), when `!self.vault_values_allowed(input.collection.as_deref())` and an environment is set, read the active environment's binding aliases (a private helper `vault_binding_aliases(collection, environment_name) -> HashSet<String>` using `regular_env_repo` + `flatten_scope`; an error or a missing environment gives an empty set) and collect `vault_names` into `withheld_vault_names` (dedupe, keep the first for the message).
  - `PhaseState` gets `nested_vault_withheld`; `warn_if_vault_withheld(sent)` mirrors `warn_if_process_env_withheld` (:608) and is called next to it in `finish_phases` (~3359) and in the runner (~436). `ExecuteRequestOutput.vault_withheld` is set from `state.vault_withheld(true)`; `script_host.rs` stores into `nested_vault_withheld` after a nested run (like :259-263).
  - Flow: the Input arm (~1808) and Request logs add `vault_withheld_entry` the same way as the host entry, only when the text has a bound-alias name and the gate is denied (decide the gate once per run like `ctx.process_env.allowed`, or call `vault_values_allowed` per node).
  - Add the new field to every `ExecuteRequestOutput` literal (list in Files) and to its `Debug` impl.

- [ ] **Step 4: Run** the new tests, then `cargo test -j4 -p rocket-app` and `cargo check -j4` (src-tauri literals). Expect PASS. `cargo clippy -j4 -p rocket-app` clean.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(trust): warn once when a RocketVault placeholder is withheld`.

### Task 5: Settings UI and docs

**Files:**
- Modify: `src/lib/tauri-api.ts` (`CollectionCapability` ~1039, `CollectionTrust` ~1052)
- Modify: `src/test/trust-fixtures.tsx` (`makeTrust`, ~14)
- Modify: `src/components/collections/CollectionTrustSection.tsx` (rows after the Host environment row ~186-208, "Forget all permissions" text ~215)
- Test: `src/components/collections/__tests__/CollectionTrustSection.test.tsx`
- Modify: `docs/features/collection-trust.md`, `docs/superpowers/specs/2026-10-11-collection-trust-gate-design.md` (one line in section 13)
- Modify: `docs/roadmaps/roadmap.md` if an item covers the RocketVault trust gate (grep first).

**Interfaces:**
- Consumes: IPC fields `vaultValues: { granted }`, `vaultCertificates: { granted }` and capabilities `'vaultValues' | 'vaultCertificates'` from plan 1.

- [ ] **Step 1: Write failing tests** in `CollectionTrustSection.test.tsx` (copy the host-environment cases of 'shows requested and allowed values per capability' and 'revokes an allowed capability and forgets all permissions'):
  - shows "RocketVault values" and "RocketVault certificates" rows with the allowed state from `makeTrust({ vaultValues: { granted: true }, vaultCertificates: { granted: false } })`.
  - clicking Allow on the values row opens the confirm dialog and, after confirming, calls the set-capability command with `{ capability: 'vaultValues', enabled: true }`; same for `'vaultCertificates'`.
  - clicking Revoke on a granted row calls the command with `enabled: false` directly (no dialog), like the Host row.
  - the Forget-all dialog text mentions RocketVault.

- [ ] **Step 2: Run** `bun run test CollectionTrustSection` and expect FAIL. `bun run tsc --noEmit` may fail first on the fixture; that is expected.

- [ ] **Step 3: Implement.** Extend `CollectionCapability` with `'vaultValues' | 'vaultCertificates'` and `CollectionTrust` with `vaultValues: { granted: boolean }` and `vaultCertificates: { granted: boolean }`; `makeTrust()` and any inline typed mock gets `{ granted: false }` for both. Add two `<TableRow>` entries (labels "RocketVault values ({'{{alias.secret}}'})" and "RocketVault certificates", requested-by cell "If a request uses it") mirroring the Host environment row: `yesNo(trust.vaultValues.granted)`, revoke direct, enable through `setConfirm` with titles "Allow RocketVault values on this computer?" and "Allow RocketVault certificates on this computer?". Update the Forget-all description to include RocketVault values and certificates. No query-key change is needed.

- [ ] **Step 4: Run** `bun run test CollectionTrustSection`, then `bun run test trust` (all trust-related Vitest files), `bun run tsc --noEmit` and `bun run check`. Expect PASS.

- [ ] **Step 5: Docs.** `docs/features/collection-trust.md`: two table rows (RocketVault values: none (implicit), grant-only, `{{alias.secret}}` placeholders; RocketVault certificates: none (implicit), grant-only, vault client certificates) and a "RocketVault" section covering: who has it (existing and Rocket-created collections, grandfathered; clones and imports not), the gate position (the vault fetch, so nothing reaches the keychain or the vault), what a denied collection sees (unresolved text plus one Console warning, a selected vault certificate fails the send with a clear message, OAuth2 token requests included), what is not gated (the app-global agent credential, names listing), scratch requests keep access, a manual check (clone a collection with a vault binding, send, see the warning and the unresolved text, allow the switch, confirm it resolves), and a known limit (a collection allowed vault access can still send vault values to any host its requests name). Add one line to section 13 of the 2026-10-11 spec noting the RocketVault gate shipped (`2026-11-05-rocketvault-trust-gate-design.md`). Update the roadmap line only if an item matches.

- [ ] **Step 6: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(trust): RocketVault switches in collection trust settings and docs`.
