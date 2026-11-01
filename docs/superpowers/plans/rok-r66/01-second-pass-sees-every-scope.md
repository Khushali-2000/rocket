# R-66 Plan 01: the second pass sees every scope

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Plan 1 of 2. Previous: none. Next: `02-nested-run-sees-pending-writes.md`. Recommended model: Sonnet implementer per task, Opus reviewer.

**Goal:** After the pre-request scripts, a placeholder whose resolved value changed in any scope (runtime, request, folder, environment, collection, global) gets the new value, including after a nested `rok.runRequest` saved it.

**Architecture:** `runtime_fill.rs` gets an `Overrides` value (changed names plus removed names) that `FieldTemplate::render` and `fill_pairs` read instead of the runtime map. `begin_phases` stores each name's resolved value in `RequestTemplates::first_values`; `resolve_runtime_placeholders` builds `Overrides::between(first_values, var_ctx.flatten(), runtime)`. A shared `nested_ran` flag on `PhaseState` and `ExecutionScriptHost` makes the pre-request loop reload env, global and collection from storage after a script started a nested run.

**Tech Stack:** Rust, `rocket-app` (`execution_service.rs`, `execution_service/runtime_fill.rs`, `execution_service/script_host.rs`), the real `DenoScriptEngine` in tests.

**Spec:** `docs/superpowers/specs/2026-11-01-rok-script-writes-reach-request-design.md`, Design sections 1, 2, 4 and 5. Read `00-plan-index.md` first (deviations 1, 5 and 6 apply here).

## Global Constraints

- 📖 Before starting each task, read `docs/superpowers/specs/opencollection-spec-reference.md`.
- `cargo` commands take `-j4`; never `--workspace` or `--all`.
- No unwrap calls in production code. `$dynamic` values are made once per send. `process.env.*` names never enter `Overrides`.
- Scope order is the one in `VariableContext::layers()`: global, collection, RocketVault, env, folder, request, runtime (lowest first).
- Implementers do not commit. The plan's change is committed after the user's review (see the index).

## Review Focus

1. **A request or runtime variable hides a changed env value.** The hidden name must not enter `Overrides`. Task 1 test `a_higher_scope_hides_a_changed_env_value`.
2. **A secret env value written by a pre-request script, or by a nested run, reaches a header.** It must be masked in the Console. Task 2 test `second_pass_masks_a_new_secret_env_value`, Task 3 test `run_request_e2e_a_secret_the_nested_run_wrote_is_masked`.
3. **The same `{{$guid}}` in a header must keep the value the script read.** Task 2 test `second_pass_keeps_a_dynamic_value_the_script_saw`.
4. **A send with no script writes must send exactly what the first pass made**, Flow variables and collection variables included. Task 2 test `with_no_script_writes_only_runtime_names_are_overrides`.
5. **A nested run that fails after it saved a write** still triggers the reload, because the flag is set before `execute_nested` runs. Covered by placement; the reviewer checks the flag is stored before the `Box::pin(self.svc.execute_nested(..))` call, not after it.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `crates/rocket-app/src/execution_service/runtime_fill.rs` | Modify | `Overrides`, `render(overrides)`, `fill_pairs(.., overrides, ..)`, `RequestTemplates::first_values`, unit tests |
| `crates/rocket-app/src/execution_service.rs` | Modify | `first_values` in `begin_phases`; `Overrides::between` and secret masking in `resolve_runtime_placeholders`; `PhaseState::nested_ran`; `reload_stored_scopes`; the reload in `run_before_request_phase` |
| `crates/rocket-app/src/execution_service/script_host.rs` | Modify | `ExecutionScriptHost::nested_ran`, set before a nested run |
| `crates/rocket-app/src/execution_service/script_host_tests.rs` | Modify | Shared test helpers and the end-to-end tests |
| `crates/rocket-app/src/collection_runner_service.rs` | Modify (tests only) | Runner test |

---

### Task 1: `Overrides` and `render(overrides)`

**Files:**
- Modify: `crates/rocket-app/src/execution_service/runtime_fill.rs` (struct after `RequestTemplates`, about line 275; `render` about line 100; `fill_pairs` about line 278; tests about line 308)
- Modify: `crates/rocket-app/src/execution_service.rs` (`resolve_runtime_placeholders`, about line 2710)

**Interfaces:**

```rust
// runtime_fill.rs
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Overrides {
    pub values: HashMap<String, String>,
    pub removed: HashSet<String>,
}
impl Overrides {
    pub(crate) fn between(
        first: &HashMap<String, String>,
        now: &HashMap<String, String>,
        runtime: &HashMap<String, String>,
    ) -> Self;
    pub(crate) fn is_empty(&self) -> bool;
}
impl FieldTemplate {
    pub(crate) fn render(&self, overrides: &Overrides) -> String; // was (&HashMap<String, String>)
}
pub(crate) fn fill_pairs(
    pairs: &mut [(&mut String, &mut String)],
    templates: &[(FieldTemplate, FieldTemplate)],
    overrides: &Overrides, // was runtime: &HashMap<String, String>
    script_vars: &HashMap<String, String>,
    literal_keys: &HashSet<String>,
);
```

- [ ] **Step 1: Write the failing tests**

In the `tests` module of `runtime_fill.rs`, add a helper below `vars` and these tests:

```rust
    fn ov(pairs: &[(&str, &str)]) -> Overrides {
        Overrides {
            values: vars(pairs),
            ..Overrides::default()
        }
    }

    #[test]
    fn render_puts_back_the_placeholder_of_a_removed_name() {
        let v = vars(&[("token", "old"), ("keep", "k")]);
        let mut unresolved = HashSet::new();
        let t = FieldTemplate::record("{{ token }}|{{keep}}", false, &v, &mut unresolved);
        assert_eq!(t.output, "old|k");
        let overrides = Overrides {
            removed: HashSet::from(["token".to_string()]),
            ..Overrides::default()
        };
        assert_eq!(t.render(&overrides), "{{ token }}|k");
    }

    #[test]
    fn render_in_json_text_fills_a_changed_name() {
        let v = vars(&[("token", "old")]);
        let mut unresolved = HashSet::new();
        let t = FieldTemplate::record(r#"{"t":"{{token}}"}"#, true, &v, &mut unresolved);
        assert_eq!(t.render(&ov(&[("token", "new")])), r#"{"t":"new"}"#);
    }

    #[test]
    fn overrides_list_runtime_changed_new_and_removed_names() {
        let first = vars(&[("a", "1"), ("b", "2"), ("gone", "x"), ("same", "s")]);
        let now = vars(&[
            ("a", "1"),
            ("b", "20"),
            ("fresh", "f"),
            ("same", "s"),
            ("r", "rv"),
        ]);
        let runtime = vars(&[("r", "rv")]);
        let o = Overrides::between(&first, &now, &runtime);
        assert_eq!(o.values, vars(&[("b", "20"), ("fresh", "f"), ("r", "rv")]));
        assert_eq!(o.removed, HashSet::from(["gone".to_string()]));
    }

    #[test]
    fn overrides_never_list_dynamic_or_process_env_names() {
        let first = vars(&[("process.env.HOME", "/a"), ("$odd", "1")]);
        let now = vars(&[("process.env.HOME", "/b"), ("process.env.NEW", "n")]);
        let runtime = vars(&[("$guid", "x"), ("process.env.X", "y")]);
        let o = Overrides::between(&first, &now, &runtime);
        assert!(o.is_empty(), "{o:?}");
    }

    #[test]
    fn a_higher_scope_hides_a_changed_env_value() {
        use rocket_environment::VariableContext;
        let mut ctx = VariableContext {
            env: vars(&[("E", "old"), ("R", "env-r")]),
            request: vars(&[("E", "req")]),
            runtime: vars(&[("R", "rt")]),
            ..VariableContext::default()
        };
        let first = ctx.flatten();
        ctx.env.insert("E".into(), "new".into());
        ctx.env.insert("R".into(), "env-r2".into());
        let o = Overrides::between(&first, &ctx.flatten(), &ctx.runtime);
        // Only the runtime name is listed, with its own value. E stays hidden by the request scope.
        assert_eq!(o.values, vars(&[("R", "rt")]));
        assert!(o.removed.is_empty());
    }
```

In the two existing tests that call `render`, change the argument:
- `literal_template_renders_its_text_unchanged`: `t.render(&vars(&[("apiKey", "x"), ("vault.secret", "s")]))` becomes `t.render(&ov(&[("apiKey", "x"), ("vault.secret", "s")]))`.
- `render_replaces_only_runtime_names_and_never_rescans_values`: `t.render(&vars(&[("token", "fresh"), ("vault.k", "secret")]))` becomes `t.render(&ov(&[("token", "fresh"), ("vault.k", "secret")]))`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test -j4 -p rocket-app runtime_fill`
Expected: FAIL to compile with `cannot find type 'Overrides' in this scope` (and `mismatched types` on `render`).

- [ ] **Step 3: Implement `Overrides`**

Add below `RequestTemplates` in `runtime_fill.rs`:

```rust
/// The values the pass after the pre-request scripts puts into placeholders.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Overrides {
    /// Names whose resolved value is new or changed since the first pass, every runtime name
    /// included.
    pub values: HashMap<String, String>,
    /// Names that resolved in the first pass and resolve to nothing now.
    pub removed: HashSet<String>,
}

impl Overrides {
    /// Every runtime value, each name whose value in `now` differs from `first`, and each name
    /// `first` has and `now` lacks. `first` and `now` are flattened scopes, so scope order already
    /// decided each value. `$dynamic` and `process.env.` names are never listed.
    pub(crate) fn between(
        first: &HashMap<String, String>,
        now: &HashMap<String, String>,
        runtime: &HashMap<String, String>,
    ) -> Self {
        let listed = |name: &str| !name.starts_with('$') && !name.starts_with("process.env.");
        let mut values: HashMap<String, String> = runtime
            .iter()
            .filter(|(name, _)| listed(name))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        for (name, value) in now {
            if listed(name) && first.get(name) != Some(value) {
                values.insert(name.clone(), value.clone());
            }
        }
        let removed = first
            .keys()
            .filter(|name| listed(name) && !now.contains_key(*name))
            .cloned()
            .collect();
        Self { values, removed }
    }

    /// Nothing changed since the first pass.
    pub(crate) fn is_empty(&self) -> bool {
        self.values.is_empty() && self.removed.is_empty()
    }
}
```

- [ ] **Step 4: Change `render` and `fill_pairs`**

Replace the doc comment and the `pick` closure head of `render`:

```rust
    /// The text again: a placeholder whose name is in `overrides.values` gets that value, one
    /// whose name was removed gets its placeholder text back, and every other placeholder keeps
    /// its first value. A `$dynamic` name is never replaced.
    pub(crate) fn render(&self, overrides: &Overrides) -> String {
        let pick = |index: usize, placeholder: &str| -> String {
            let name = self
                .names
                .get(index)
                .map(String::as_str)
                .unwrap_or_default();
            if !name.starts_with('$') {
                if let Some(value) = overrides.values.get(name) {
                    return value.clone();
                }
                if overrides.removed.contains(name) {
                    return placeholder.to_string();
                }
            }
            self.values
                .get(index)
                .cloned()
                .unwrap_or_else(|| placeholder.to_string())
        };
```

The rest of `render` (the `json` branch and `substitute`) is unchanged. In `fill_pairs`, rename the parameter `runtime: &HashMap<String, String>` to `overrides: &Overrides` and its two uses `k.render(runtime)` and `v.render(runtime)` to `k.render(overrides)` and `v.render(overrides)`.

- [ ] **Step 5: Keep the caller's behaviour**

In `execution_service.rs`, `resolve_runtime_placeholders`, add `Overrides` to the `runtime_fill` import list at the top of the file (the `use` that already brings `FieldTemplate`, `fill_pairs`, `fill_names`), then replace:

```rust
        let runtime = &state.var_ctx.runtime;
```

with:

```rust
        let overrides = Overrides {
            values: state.var_ctx.runtime.clone(),
            ..Overrides::default()
        };
        let runtime = &overrides;
```

Every `render(runtime)` and `fill_pairs(.., runtime, ..)` in the function now compiles unchanged. Task 2 replaces this with `Overrides::between`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `cargo test -j4 -p rocket-app runtime_fill`
Expected: PASS, all `runtime_fill` tests including the 5 new ones.

Run: `cargo test -j4 -p rocket-app execution_service`
Expected: PASS (no behaviour change yet).

---

### Task 2: `first_values` and the wiring, with single-send and Runner tests

**Files:**
- Modify: `crates/rocket-app/src/execution_service/runtime_fill.rs` (`RequestTemplates`, about line 251)
- Modify: `crates/rocket-app/src/execution_service.rs` (`begin_phases` about line 2355; `resolve_runtime_placeholders` about line 2710)
- Modify: `crates/rocket-app/src/execution_service/script_host_tests.rs` (helpers about lines 340-420; new tests at the end of the run-request section)
- Modify: `crates/rocket-app/src/collection_runner_service.rs` (tests, after `a_carried_runtime_variable_fills_a_later_steps_placeholder`, about line 1040)

**Interfaces:**

```rust
// Consumes (Task 1): Overrides, Overrides::between, render(&Overrides), fill_pairs(.., &Overrides, ..)
// Produces:
pub(crate) struct RequestTemplates { /* existing fields */ pub first_values: HashMap<String, String> }

// script_host_tests.rs helpers (Task 3 and Plan 02 use them):
fn dev_env(vars: Vec<Variable>) -> Arc<Mutex<Environment>>;
fn run_service_over(
    repo: Arc<InMemoryCollectionRepo>,
    env: Arc<Mutex<Environment>>,
) -> (RequestExecutionService, Arc<KeepingExecutor>);
fn main_and_login_with(
    main_script: &str,
    login_pre: &str,
    login_post: &str,
    main_headers: &[(&str, &str)],
    login_headers: &[(&str, &str)],
) -> Collection;
fn sent_header(executor: &KeepingExecutor, index: usize, name: &str) -> Option<String>;
```

- [ ] **Step 1: Add the test helpers**

In `script_host_tests.rs` (`InMemoryCollectionRepo` is already imported at the top), add `use rocket_shared::types::Header;` next to the other `rocket_shared` imports. Replace `run_service_with_engine` and add the helpers:

```rust
/// Environment `dev` holding `vars`, shared so a test can read what was saved.
fn dev_env(vars: Vec<Variable>) -> Arc<Mutex<Environment>> {
    let mut env = Environment::new("dev");
    for var in vars {
        env.set_variable(var);
    }
    Arc::new(Mutex::new(env))
}

/// Like `run_service`, with an engine that has the given limits.
fn run_service_with_engine(
    collection: Collection,
    engine: rocket_infra::scripting::DenoScriptEngine,
) -> (RequestExecutionService, Arc<KeepingExecutor>) {
    run_service_full(
        InMemoryCollectionRepo::new(collection),
        dev_env(vec![Variable::new("E", "old")]),
        engine,
    )
}

/// A service over `repo` and `env` with the real engine.
fn run_service_over(
    repo: Arc<InMemoryCollectionRepo>,
    env: Arc<Mutex<Environment>>,
) -> (RequestExecutionService, Arc<KeepingExecutor>) {
    run_service_full(repo, env, rocket_infra::scripting::DenoScriptEngine::new())
}

fn run_service_full(
    repo: Arc<InMemoryCollectionRepo>,
    env: Arc<Mutex<Environment>>,
    engine: rocket_infra::scripting::DenoScriptEngine,
) -> (RequestExecutionService, Arc<KeepingExecutor>) {
    let executor = Arc::new(KeepingExecutor::default());
    let svc = RequestExecutionService::new(
        Box::new(MemoryEnvRepo(env)),
        Arc::new(SharedKeeping(Arc::clone(&executor))),
        Box::new(SharedHistoryRepo(InMemoryHistoryRepo::new())),
        Box::new(SharedCollectionRepo(repo)),
        Box::new(NullCookieRepo),
        Box::new(NullEventPublisher),
        Box::new(EmptySecretManagerRepo),
        Arc::new(rocket_environment::NullSecretStore),
        Arc::new(rocket_environment::NullVaultSecretFetcher),
    )
    .with_script_engine(Box::new(engine));
    (svc, executor)
}

/// `main_and_login`, with headers on the main and login requests.
fn main_and_login_with(
    main_script: &str,
    login_pre: &str,
    login_post: &str,
    main_headers: &[(&str, &str)],
    login_headers: &[(&str, &str)],
) -> Collection {
    let headers = |list: &[(&str, &str)]| -> Vec<Header> {
        list.iter().map(|(k, v)| Header::new(*k, *v)).collect()
    };
    let mut collection = Collection::new("api");
    let mut main = saved("Main", "main.yml", main_script);
    main.headers = headers(main_headers);
    collection.root.add_request(main);
    let mut login = saved("Login", "login.yml", login_pre);
    login.headers = headers(login_headers);
    if !login_post.is_empty() {
        login.post_response_script = Some(login_post.to_string());
    }
    let mut auth = Folder::new("auth");
    auth.add_request(login);
    collection.root.add_subfolder(auth);
    collection
}

/// The value of header `name` on the request sent at `index`.
fn sent_header(executor: &KeepingExecutor, index: usize, name: &str) -> Option<String> {
    executor
        .seen()
        .get(index)?
        .headers
        .iter()
        .find(|h| h.key.eq_ignore_ascii_case(name))
        .map(|h| h.value.clone())
}
```

Make `main_and_login` call `main_and_login_with(main_script, login_pre, login_post, &[], &[])`. Remove the old body of `run_service_with_engine` (it is now the wrapper above). `run_service` stays as it is.

- [ ] **Step 2: Write the failing tests**

Add to `script_host_tests.rs` (new section comment `// ---- Second pass sees every scope ----`):

```rust
#[tokio::test]
async fn second_pass_fills_an_env_value_the_pre_request_script_wrote() {
    let collection = main_and_login_with(
        "rok.setEnvVar('E', 'new');",
        "",
        "",
        &[("X-E", "{{E}}")],
        &[],
    );
    let input = send_input(&collection, "main.yml");
    let (svc, executor) = run_service(collection);
    let out = svc.execute(input).await.expect("execute");
    assert!(out.script_error.is_none(), "{:?}", out.script_error);
    assert_eq!(sent_header(&executor, 0, "X-E").as_deref(), Some("new"));
}

#[tokio::test]
async fn second_pass_fills_a_global_value_that_did_not_exist_before() {
    // The test repository serves one environment for every name, so `dev` is the global too.
    let collection = main_and_login_with(
        "rok.setGlobalEnvVar('G', 'g1');",
        "",
        "",
        &[("X-G", "{{G}}")],
        &[],
    );
    let mut input = send_input(&collection, "main.yml");
    input.global_env_name = Some("dev".into());
    let (svc, executor) = run_service(collection);
    let out = svc.execute(input).await.expect("execute");
    assert!(out.script_error.is_none(), "{:?}", out.script_error);
    assert_eq!(sent_header(&executor, 0, "X-G").as_deref(), Some("g1"));
}

#[tokio::test]
async fn second_pass_fills_a_collection_value_the_pre_request_script_wrote() {
    let collection = main_and_login_with(
        "rok.setCollectionVar('C', 'c1');",
        "",
        "",
        &[("X-C", "{{C}}")],
        &[],
    );
    let input = send_input(&collection, "main.yml");
    let (svc, executor) = run_service(collection);
    let out = svc.execute(input).await.expect("execute");
    assert!(out.script_error.is_none(), "{:?}", out.script_error);
    assert_eq!(sent_header(&executor, 0, "X-C").as_deref(), Some("c1"));
}

#[tokio::test]
async fn second_pass_sends_a_deleted_name_as_written() {
    let collection = main_and_login_with(
        "rok.deleteEnvVar('E');",
        "",
        "",
        &[("X-E", "{{E}}")],
        &[],
    );
    let input = send_input(&collection, "main.yml");
    let (svc, executor) = run_service(collection);
    svc.execute(input).await.expect("execute");
    assert_eq!(sent_header(&executor, 0, "X-E").as_deref(), Some("{{E}}"));
}

#[tokio::test]
async fn second_pass_keeps_a_dynamic_value_the_script_saw() {
    let collection = main_and_login_with(
        "console.log('id=' + req.getHeader('X-Id')); rok.setEnvVar('E', 'new');",
        "",
        "",
        &[("X-Id", "{{$guid}}"), ("X-E", "{{E}}")],
        &[],
    );
    let input = send_input(&collection, "main.yml");
    let (svc, executor) = run_service(collection);
    let out = svc.execute(input).await.expect("execute");
    let sent = sent_header(&executor, 0, "X-Id").expect("X-Id sent");
    assert!(
        console(&out).contains(&format!("id={sent}")),
        "{:?}",
        console(&out)
    );
    assert_eq!(sent_header(&executor, 0, "X-E").as_deref(), Some("new"));
}

#[tokio::test]
async fn second_pass_masks_a_new_secret_env_value() {
    let collection = main_and_login_with(
        "rok.setEnvVar('S', 'new-secret-value-2');",
        "",
        "",
        &[("X-S", "{{S}}")],
        &[],
    );
    let mut collection = collection;
    if let Some(CollectionItem::Request(main)) = collection.root.items.first_mut() {
        main.post_response_script = Some("console.log('S=' + req.getHeader('X-S'));".into());
    }
    let input = send_input(&collection, "main.yml");
    let env = dev_env(vec![Variable::secret("S", "old-secret-value-1")]);
    let (svc, executor) = run_service_over(InMemoryCollectionRepo::new(collection), env);
    let out = svc.execute(input).await.expect("execute");
    assert_eq!(
        sent_header(&executor, 0, "X-S").as_deref(),
        Some("new-secret-value-2")
    );
    let lines = console(&out);
    assert!(lines.iter().any(|l| l.starts_with("S=")), "{lines:?}");
    assert!(
        lines.iter().all(|l| !l.contains("new-secret-value-2")),
        "{lines:?}"
    );
}

#[tokio::test]
async fn with_no_script_writes_only_runtime_names_are_overrides() {
    let mut collection = main_and_login("", "", "");
    collection
        .settings
        .variables
        .push(rocket_collection::CollectionVariable {
            key: "C".into(),
            value: "c1".into(),
            initial_value: String::new(),
            enabled: true,
            secret: false,
        });
    let mut input = send_input(&collection, "main.yml");
    input.flow_vars.insert("F".into(), "f1".into());
    let (svc, _executor) = run_service(collection);
    let state = svc
        .begin_phases(&input, &std::collections::HashMap::new())
        .expect("begin");
    assert_eq!(state.templates.first_values.get("C").map(String::as_str), Some("c1"));
    let overrides = super::runtime_fill::Overrides::between(
        &state.templates.first_values,
        &state.var_ctx.flatten(),
        &state.var_ctx.runtime,
    );
    assert_eq!(
        overrides.values,
        std::collections::HashMap::from([("F".to_string(), "f1".to_string())])
    );
    assert!(overrides.removed.is_empty());
}
```

Add to the `tests` module of `collection_runner_service.rs`, after `a_carried_runtime_variable_fills_a_later_steps_placeholder`:

```rust
    #[tokio::test]
    async fn a_collection_var_the_pre_request_script_wrote_fills_the_same_step() {
        let mut collection = Collection::new("my-api");
        let mut first = req("First", "first.yml");
        first.url = "https://api.test/first/{{C}}".into();
        collection.root.add_request(first);

        let engine = ProgrammableEngine::new();
        engine.on(
            "First",
            "before-request",
            ScriptResult {
                collection_var_writes: vec![rocket_scripting::CollectionVarWrite {
                    key: "C".to_string(),
                    value: serde_json::json!("c1"),
                }],
                ..Default::default()
            },
        );
        let h = harness(collection, engine, RecordingExecutor::new());
        h.runner
            .run(&h.exec, sample_run_input())
            .await
            .expect("run");

        assert_eq!(
            h.executor.sent_urls(),
            vec!["https://api.test/first/c1".to_string()]
        );
    }
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cargo test -j4 -p rocket-app second_pass_ with_no_script_writes a_collection_var_the_pre_request`
(`cargo test` takes one filter; run `cargo test -j4 -p rocket-app second_pass_`, then `cargo test -j4 -p rocket-app with_no_script_writes`, then `cargo test -j4 -p rocket-app a_collection_var_the_pre_request`.)
Expected: `with_no_script_writes_only_runtime_names_are_overrides` fails to compile with `no field 'first_values' on type 'RequestTemplates'`. Once Step 4's field exists, the `second_pass_*` env, global, collection, deleted and secret tests and the Runner test FAIL with the old value (for example `left: Some("old")`, `right: Some("new")`; the Runner URL keeps `{{C}}`). `second_pass_keeps_a_dynamic_value_the_script_saw` fails only on its `X-E` assertion.

- [ ] **Step 4: Add `first_values` and set it in `begin_phases`**

In `RequestTemplates` (`runtime_fill.rs`), add the last field:

```rust
    /// Each variable's resolved value before any script ran, all scopes flattened. The second
    /// pass compares against it to find what the scripts changed.
    pub first_values: HashMap<String, String>,
```

In `begin_phases` (`execution_service.rs`), make the destructured binding mutable (`templates,` becomes `mut templates,` in `let ResolvedParts { request: http_request, mut templates, process_env } = ...`). After the `var_ctx.secret_values.extend(process_env.dot_env_values ...)` statement, add:

```rust
        // The second pass compares against these values to find what the scripts changed.
        templates.first_values = var_ctx.flatten();
```

- [ ] **Step 5: Build `Overrides::between` in `resolve_runtime_placeholders`**

Replace the start of the function body, from `mask_runtime_values_of_secret_keys(&mut state.var_ctx);` up to and including the Task 1 lines `let runtime = &overrides;`, with:

```rust
        mask_runtime_values_of_secret_keys(&mut state.var_ctx);
        let overrides = Overrides::between(
            &state.templates.first_values,
            &state.var_ctx.flatten(),
            &state.var_ctx.runtime,
        );
        if overrides.is_empty() && !has_placeholder(&state.http_request) {
            return Ok(());
        }
        // A new value under a secret name is masked like the name's first value.
        let forms: Vec<String> = overrides
            .values
            .iter()
            .filter(|(name, _)| state.var_ctx.secret_keys.contains(*name))
            .flat_map(|(_, value)| crate::redaction::redaction_forms(value))
            .collect();
        state.var_ctx.secret_values.extend(forms);
        let runtime = &overrides;
```

Then rename the binding: replace each `runtime` use in the rest of the function with `&overrides` and delete the `let runtime = &overrides;` line. The uses are: the `path_param_values(.., |t| t.render(runtime))` closure, `templates.url.render(runtime)`, the two `fill_pairs(..)` calls, the body `t.render(runtime)`, the form `t.render(runtime)` and the auth `t.render(runtime)`.

Update the doc comment of `resolve_runtime_placeholders`: replace its first two paragraphs with:

```rust
    /// Puts the values the pre-request scripts and actions changed into the request: the URL,
    /// path parameters, query, headers, body and auth.
    ///
    /// The first resolution in `begin_phases` runs before any script. Its values are kept in
    /// `templates.first_values`. Here every scope is flattened again and `Overrides::between`
    /// lists each name whose value changed, every runtime name and each name that no longer
    /// resolves. A field the scripts did not rewrite is rendered again from its template
    /// (`runtime_fill`): a changed name gets its new value, a removed name gets its placeholder
    /// text back, and every other placeholder keeps its first value (a `{{$dynamic}}` value is
    /// never made twice). Values are put in as they are and never read for placeholders again.
```

Keep the paragraph that starts "Text a script wrote is filled only for names ..." as it is.

- [ ] **Step 6: Run the tests to see them pass**

Run: `cargo test -j4 -p rocket-app second_pass_`
Expected: PASS (6 tests).
Run: `cargo test -j4 -p rocket-app with_no_script_writes`
Expected: PASS.
Run: `cargo test -j4 -p rocket-app a_collection_var_the_pre_request`
Expected: PASS.
Run: `cargo test -j4 -p rocket-app`
Expected: PASS. If an existing test now sees a changed value it did not before, read it: the change is right when a script wrote a non-runtime scope that a placeholder uses. Log a `Ruling:` line in the ledger for each test you change, with the reason.

---

### Task 3: Reload the scopes after a nested run (the R-66 case)

**Files:**
- Modify: `crates/rocket-app/src/execution_service.rs` (`PhaseState` about line 430; `begin_phases` struct literal about line 2459; `script_host` about line 2022; `run_before_request_phase` loop after `apply_script_side_effects`, about line 2640)
- Modify: `crates/rocket-app/src/execution_service/script_host.rs` (`ExecutionScriptHost` about line 40; `run_request` about line 200)
- Modify: `crates/rocket-app/src/execution_service/script_host_tests.rs`

**Interfaces:**

```rust
// Consumes (Task 2): first_values, Overrides::between in resolve_runtime_placeholders, the test helpers.
// Produces:
pub(crate) struct PhaseState { /* existing */ pub nested_ran: Arc<std::sync::atomic::AtomicBool> }
pub(crate) struct ExecutionScriptHost<'a> { /* existing */ pub(crate) nested_ran: Arc<std::sync::atomic::AtomicBool> }
impl RequestExecutionService {
    fn reload_stored_scopes(&self, input: &ExecuteRequestInput, state: &mut PhaseState);
}
```

- [ ] **Step 1: Write the failing tests**

Add to `script_host_tests.rs` (after the Task 2 section):

```rust
#[tokio::test]
async fn run_request_e2e_a_nested_env_write_fills_the_outer_header() {
    let collection = main_and_login_with(
        "await rok.runRequest('auth/login');",
        "rok.setEnvVar('E', 'tok-1');",
        "",
        &[("Authorization", "Bearer {{E}}")],
        &[],
    );
    let input = send_input(&collection, "main.yml");
    let (svc, executor) = run_service(collection);
    let out = svc.execute(input).await.expect("execute");
    assert!(out.script_error.is_none(), "{:?}", out.script_error);
    assert_eq!(
        urls(&executor),
        vec![
            "https://api.test/login.yml".to_string(),
            "https://api.test/main.yml".to_string()
        ]
    );
    assert_eq!(
        sent_header(&executor, 1, "Authorization").as_deref(),
        Some("Bearer tok-1")
    );
}

#[tokio::test]
async fn run_request_e2e_a_name_the_nested_run_created_fills_the_outer_header() {
    let collection = main_and_login_with(
        "await rok.runRequest('auth/login');",
        "rok.setEnvVar('T', 'tok-2');",
        "",
        &[("X-T", "{{T}}")],
        &[],
    );
    let input = send_input(&collection, "main.yml");
    let (svc, executor) = run_service(collection);
    svc.execute(input).await.expect("execute");
    assert_eq!(sent_header(&executor, 1, "X-T").as_deref(), Some("tok-2"));
}

#[tokio::test]
async fn run_request_e2e_a_secret_the_nested_run_wrote_is_masked() {
    let mut collection = main_and_login_with(
        "await rok.runRequest('auth/login');",
        "rok.setEnvVar('S', 'new-secret-value-2');",
        "",
        &[("X-S", "{{S}}")],
        &[],
    );
    if let Some(CollectionItem::Request(main)) = collection.root.items.first_mut() {
        main.post_response_script = Some("console.log('S=' + req.getHeader('X-S'));".into());
    }
    let input = send_input(&collection, "main.yml");
    let env = dev_env(vec![Variable::secret("S", "old-secret-value-1")]);
    let (svc, executor) = run_service_over(InMemoryCollectionRepo::new(collection), env);
    let out = svc.execute(input).await.expect("execute");
    assert_eq!(
        sent_header(&executor, 1, "X-S").as_deref(),
        Some("new-secret-value-2")
    );
    let lines = console(&out);
    assert!(lines.iter().any(|l| l.starts_with("S=")), "{lines:?}");
    assert!(
        lines.iter().all(|l| !l.contains("new-secret-value-2")),
        "{lines:?}"
    );
}

#[tokio::test]
async fn run_request_e2e_the_next_script_in_the_chain_reads_the_reloaded_value() {
    // The folder chain is served for every request, the nested one too, so the folder script
    // only calls `runRequest` once: the nested run is seeded with the caller's runtime `done`.
    let collection = main_and_login(
        "console.log('E=' + rok.getEnvVar('E'));",
        "rok.setEnvVar('E', 'tok-3');",
        "",
    );
    let folder = rocket_collection::FolderSettings {
        pre_request_script: Some(
            "if (rok.getVar('done') !== 'y') { rok.setVar('done', 'y'); \
             await rok.runRequest('auth/login'); }"
                .into(),
        ),
        ..Default::default()
    };
    let input = send_input(&collection, "main.yml");
    let repo = InMemoryCollectionRepo::with_folder_chain(collection, vec![folder], None);
    let (svc, _executor) = run_service_over(repo, dev_env(vec![Variable::new("E", "old")]));
    let out = svc.execute(input).await.expect("execute");
    assert!(
        console(&out).contains(&"E=tok-3".to_string()),
        "{:?}",
        console(&out)
    );
}
```

If `FolderSettings` is not re-exported at `rocket_collection::FolderSettings`, use the path `crate::folder_settings` already uses (search `use rocket_collection::` in `test_doubles.rs` for the name `FolderSettings`).

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test -j4 -p rocket-app run_request_e2e_a_`
Expected: FAIL. `..._fills_the_outer_header`: `left: Some("Bearer old")`, `right: Some("Bearer tok-1")`. `..._created_fills_...`: `left: Some("{{T}}")`. `..._secret_...`: the header keeps `old-secret-value-1`.
Run: `cargo test -j4 -p rocket-app run_request_e2e_the_next_script`
Expected: FAIL, console holds `E=old`, not `E=tok-3`.

- [ ] **Step 3: Add the flag**

In `PhaseState`, after `nested_withheld`:

```rust
    /// Set when a script of this send started a `rok.runRequest`. The nested run saved its
    /// writes, so the pre-request loop reads the scopes back from storage. Shared with the
    /// script host.
    pub nested_ran: Arc<std::sync::atomic::AtomicBool>,
```

In the `PhaseState { .. }` literal of `begin_phases`, after `nested_withheld: ...`:

```rust
            nested_ran: Arc::new(std::sync::atomic::AtomicBool::new(false)),
```

In `ExecutionScriptHost` (`script_host.rs`), after `nested_withheld`:

```rust
    /// Set just before a nested run starts, so the calling phase reloads the scopes it saved.
    pub(crate) nested_ran: Arc<std::sync::atomic::AtomicBool>,
```

In `script_host()` (`execution_service.rs`), after `nested_withheld: Arc::clone(&state.nested_withheld),`:

```rust
            nested_ran: Arc::clone(&state.nested_ran),
```

In `ExecutionScriptHost::run_request`, right after `let before = self.stored_scopes(collection);`:

```rust
        // Set before the run, so a run that fails after saving a write still triggers a reload.
        self.nested_ran.store(true, Ordering::SeqCst);
```

- [ ] **Step 4: Add `reload_stored_scopes` and call it**

In `impl RequestExecutionService`, after `script_host()`:

```rust
    /// Reads the environment, global and collection scopes back from storage into `state`, after
    /// a nested run saved its writes there. Secret names and values found are added, so they
    /// stay masked. Runtime values come back through the script result instead.
    fn reload_stored_scopes(&self, input: &ExecuteRequestInput, state: &mut PhaseState) {
        let stored = self.build_variable_scopes(
            input.global_env_name.as_deref(),
            input.collection.as_deref(),
            input.environment_name.as_deref(),
            None,
            &state.external_secrets,
        );
        state.var_ctx.env = stored.env;
        state.var_ctx.global_env = stored.global_env;
        state.var_ctx.collection = stored.collection;
        state.var_ctx.secret_values.extend(stored.secret_values);
        state.var_ctx.secret_keys.extend(stored.secret_keys);
    }
```

In `run_before_request_phase`, right after the `self.apply_script_side_effects(..);` call inside the `for script in &scripts` loop:

```rust
            // A nested run saved its writes, so the next script and the second pass read the
            // scopes from storage again.
            if state
                .nested_ran
                .swap(false, std::sync::atomic::Ordering::SeqCst)
            {
                self.reload_stored_scopes(input, state);
            }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cargo test -j4 -p rocket-app run_request_e2e`
Expected: PASS, the 4 new tests and every existing `run_request_e2e_*` test.
Run: `cargo test -j4 -p rocket-app`
Expected: PASS.
Run: `cargo check -j4 -p rocket-app --tests` and `cargo fmt -p rocket-app`
Expected: no errors; fmt leaves no diff to fix by hand.

---

## End of Plan 01. Verify

- `cargo test -j4 -p rocket-app` passes.
- `cargo clippy -j4 -p rocket-app --tests` shows no new warning in the changed files.
- Stop and show the user the whole plan's change (do not commit). After the user's OK, commit through `dev-workflow-skills:1-git-commit` with explicit paths, for example two commits:
  - `crates/rocket-app/src/execution_service/runtime_fill.rs`, `crates/rocket-app/src/execution_service.rs` (Task 1 and 2 parts), the Task 2 tests: `feat(app): fill placeholders whose value a pre-request script changed`
  - the Task 3 parts of `execution_service.rs`, `script_host.rs` and its tests: `feat(app): reload variable scopes after a nested runRequest`

## Next plan to execute

`02-nested-run-sees-pending-writes.md`.

## Self-Review

- Spec Design 1 → Tasks 1 and 2. Design 2 → Task 3. Design 4: `process.env` (Task 1 test), vault (unchanged values; Plan 02 holds back pending ones), masking (Task 2 Step 5 and the two secret tests), request guard (unchanged code after the fill). Design 5: the reload only runs when the flag is set.
- Spec tests 1 → Task 2 (env, global, collection); 2 → Task 3; 3 → Task 1 `a_higher_scope_hides_a_changed_env_value`; 4 → Task 2 dynamic test; 5 → Task 2 deleted test; 6 → Task 3 secret test; 7 → Task 3 chain test; 10 → Task 2 Runner test (Flow: index deviation 5); 11 → Task 2 `with_no_script_writes_only_runtime_names_are_overrides`. Tests 8 and 9 are Plan 02.
- Names used across tasks: `Overrides`, `Overrides::between`, `Overrides::is_empty`, `render(&Overrides)`, `fill_pairs(.., &Overrides, ..)`, `RequestTemplates::first_values`, `PhaseState::nested_ran`, `ExecutionScriptHost::nested_ran`, `reload_stored_scopes`, helpers `dev_env`, `run_service_over`, `run_service_full`, `main_and_login_with`, `sent_header`.
- Not covered: request and folder variables in end-to-end tests (the in-memory repository returns none; the precedence is covered at unit level in Task 1).
