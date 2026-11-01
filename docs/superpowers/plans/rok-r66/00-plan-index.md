# R-66: script variable writes reach the outer request — plan index

**Spec:** `docs/superpowers/specs/2026-11-01-rok-script-writes-reach-request-design.md`
**Series notes:** `docs/features/rok-api-parity-notes.md`
**Roadmap:** R-66 in `docs/roadmaps/roadmap.md`
**Ledger:** one per plan, `.superpowers/sdd/rok-r66-<plan file name without .md>/progress.md` (create it on the plan's first task; log `Ruling:` lines there).

Run the plans in order. Each plan has at most 3 tasks and leaves the app working and tested.

| Plan | File | Tasks |
|---|---|---|
| 01 | `01-second-pass-sees-every-scope.md` | `Overrides` and `render(overrides)` in `runtime_fill.rs`; `first_values` and the wiring in `resolve_runtime_placeholders` with single-send and Runner tests; the `nested_ran` flag and the scope reload after a nested run (the R-66 case) |
| 02 | `02-nested-run-sees-pending-writes.md` (runs after 03) | `PendingWrites` on `HostRunRequest`, filled by `op_rok_run_request`; the nested run applies them in memory, plus the docs and roadmap |
| 03 | `03-frontend-leaves-placeholders.md` | Runs after 01, before 02. Plan 01 final-review fixes (strict reload with a Console warning); `ExecuteRequestOutput::sent_request` with RocketVault values masked; the frontend fills only `process.env.*` for a send and builds the Console row from `sentRequest` (spec section 6) |
| 04 | `04-nested-values-and-script-secrets.md` | Runs after 03, before 02. `rocket_environment::expand_nested` (stored scopes only, no vault or `process.env`, depth 3); the first and second pass use expanded values; `SentRequest::secret_values` for the Console masks (spec section 7) |

## Execution (decided with the user, 2026-11-01)

- One Sonnet implementer per task, one at a time. A separate Opus reviewer reviews each task's diff (snapshot trees, not the live tree). An Opus whole-change review runs at the end of each plan.
- Implementers do **not** commit. At the end of each plan the user reviews the whole plan's change, then it is committed through the `dev-workflow-skills:1-git-commit` skill, split by logical group where that fits.
- The main session keeps the todo list current, one task `in_progress` at a time.

## Cross-plan facts

- 📖 Every task touches variable resolution. Before starting a task, read `docs/superpowers/specs/opencollection-spec-reference.md`.
- `cargo test` and `cargo check` always take `-j4`. Never `--workspace` or `--all`. Use `cargo test -j4 -p rocket-app <filter>` and `cargo test -j4 -p rocket-infra <filter>`.
- No unwrap calls in production paths. Tests use `expect("...")`.
- Code comments are short, plain, full sentences ending with a period.
- `rocket-app` holds traits only; no new I/O type in it. The reload reuses `build_variable_scopes`.
- Line numbers below are from `main` at `15534bf9` and are approximate. Match on the quoted code, not the number.

## Names shared across plans

| Name | Kind | Defined in | Used by |
|---|---|---|---|
| `Overrides { values: HashMap<String, String>, removed: HashSet<String> }` | `pub(crate)` struct | 01 Task 1, `execution_service/runtime_fill.rs` | 01 Task 2 |
| `Overrides::between(first, now, runtime) -> Overrides` | fn | 01 Task 1 | 01 Task 2 |
| `FieldTemplate::render(&self, overrides: &Overrides) -> String` | fn (signature change) | 01 Task 1 | 01 Task 2 |
| `fill_pairs(.., overrides: &Overrides, ..)` | fn (signature change) | 01 Task 1 | 01 Task 2 |
| `RequestTemplates::first_values: HashMap<String, String>` | field | 01 Task 2 | 01 Task 2, 02 Task 2 (through the second pass) |
| `PhaseState::nested_ran: Arc<AtomicBool>` | field | 01 Task 3 | 01 Task 3 |
| `ExecutionScriptHost::nested_ran: Arc<AtomicBool>` | field | 01 Task 3 | 01 Task 3 |
| `RequestExecutionService::reload_stored_scopes(&self, input, state)` | fn | 01 Task 3 | 01 Task 3 |
| `rocket_scripting::PendingWrites { env, global_env, collection: Vec<(String, Option<String>)> }` | pub struct | 02 Task 1 | 02 Task 2 |
| `HostRunRequest::pending: PendingWrites` | field | 02 Task 1 | 02 Task 2 |
| `overlay_pending_writes(input, state, pending)` | fn in `execution_service.rs` | 02 Task 2 | 02 Task 2 |
| `execute_nested(.., runtime, pending: &PendingWrites, ..)` | fn (signature change) | 02 Task 2 | 02 Task 2 |
| `SentRequest { url, headers, query_params, body, auth }` | pub struct, IPC DTO | 03 Task 2, `execution_service/sent_request.rs` | 03 Task 3 (`sentRequest` in TS) |
| `ExecuteRequestOutput::sent_request: Option<SentRequest>` | field | 03 Task 2 | 03 Task 3 |
| `PhaseState::pending: PendingWrites` | field | 02 Task 2 | 02 Task 2 (`reload_stored_scopes` re-applies it) |
| `expand_nested(ctx, extra, dynamic) -> HashMap`, `MAX_NESTED_DEPTH` | pub fn/const, `rocket-environment/src/nested.rs` | 04 Task 1 | 04 Task 2 |
| `RequestTemplates::first_raw`, `RequestTemplates::nested_dynamic` | fields | 04 Task 2 | 04 Task 2 |
| `SentRequest::secret_values: Vec<String>` | field | 04 Task 3 | 04 Task 3 (`secretValues` in TS) |
| `processEnvOnly(ctx)` | TS fn, `variable-context.ts` | 03 Task 3 | 03 Task 3 |

## Deviations from the spec (decided while planning)

1. **Removed names are a set, not a map value.** The spec says a removed name "maps to its placeholder text". `render` already gets each placeholder's original text, so `Overrides` keeps `removed: HashSet<String>` and `render` writes the original placeholder back (`{{ token }}` keeps its spaces). Same behaviour, no guessed text.
2. **Pending writes are applied after `begin_phases`, not inside it.** The spec says `begin_phases` applies them before the first resolution. `resolve_request_parts` builds its own scopes, so that would thread a new parameter through `resolve_request_parts`, `resolve_request` and their other callers. Instead `execute_nested` puts them into `state.var_ctx` right after `begin_phases`. `first_values` was taken from the stored scopes, so the second pass (Plan 01) sees the pending values as changed and fills the nested request with them. The nested scripts see them because they read `state.var_ctx`. No caller of `begin_phases` changes.
3. **Pending writes to a scope with nothing selected are skipped.** An env write with no active environment is dropped by the caller (`apply_script_side_effects` warns and drops it), so the nested run must not see it either. Same for global (no global environment) and collection (no collection).
4. **`PendingWrites` holds text, not JSON.** `HostRunRequest` derives `Eq`, and `serde_json::Value` is not `Eq`. Values become text the way `mirror_env_writes` does it (a string as is, anything else as JSON text, `null` as `None`).
5. **No separate Flow test.** Flow request nodes send through `RequestExecutionService::execute_capturing` (`execution_service.rs` about line 3225), which calls `begin_phases` and `run_before_request_phase` like a single send. The single-send tests cover it. The Collection Runner calls the phase methods itself (`collection_runner_service.rs` about line 402), so it gets its own test.
6. **Request and folder variables are not in the end-to-end tests.** `InMemoryCollectionRepo` returns no request or folder variables. Scope precedence is pinned at unit level instead (Plan 01 Task 1, `a_higher_scope_hides_a_changed_env_value`). Spec test 7 uses `InMemoryCollectionRepo::with_folder_chain` for the folder script.
7. **"Nothing is saved early" (spec test 8) is not asserted directly.** No test double records the order of saves. `overlay_pending_writes` only writes `state.var_ctx`, and the test checks that the value is stored after the send.
