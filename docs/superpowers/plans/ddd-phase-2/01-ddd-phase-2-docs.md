# DDD Phase 2 Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `CLAUDE.md` claims of five crates true: say what the code does today and mark the exceptions that Phases 4 and 5 will remove.

**Architecture:** Markdown edits only. Each claim is re-checked with a grep before it is rewritten, and each rewrite names the roadmap item that restores the old claim. No Rust or TypeScript changes.

**Tech Stack:** Markdown, `grep`.

**Spec:** `docs/roadmaps/ddd-roadmap.md` (Phase 2, D-20 to D-24); rulings in `docs/engineering/ddd-decisions.md` (D-01: `rocket-git` mixed, `rocket-import` and `rocket-http` get ports).

## Global Constraints

- Doc sentences are short, full sentences ending in a punctuation mark. No emojis.
- Do not rewrite the rest of a crate file. Change only the false claim and add the exception.
- Every exception names the roadmap ID that removes it, so the text can be restored later.
- No commit during the plan; the user's "continue with phases" request covers one commit per phase with the `dev-workflow-skills:1-git-commit` skill and explicit paths.

## Review Focus

- A rewritten claim must not promise more than the grep shows (counts are call sites, not operations).
- D-24 waits on D-52: if `canonicalize` is still in `openapi_consent.rs`, the doc names it as an exception instead of dropping the claim.

---

### Task 1: D-20, D-21, D-22 (http, git, import)

**Files:**
- Modify: `crates/rocket-http/CLAUDE.md:7`, `crates/rocket-git/CLAUDE.md:23`, `crates/rocket-import/CLAUDE.md:7`

- [ ] **Step 1: Re-check the claims**

Run: `grep -n "reqwest::Client\|\.post(" crates/rocket-http/src/oauth2.rs crates/rocket-http/src/token_client.rs` and `grep -rlE "std::fs|fs::" crates/rocket-import/src crates/rocket-git/src` and `grep -n "rocket-infra" crates/rocket-import/Cargo.toml`.
Expected: the token POST in `oauth2.rs`, `reqwest::Client` in the `token_client.rs` trait, `std::fs` in importer and git service files, and `rocket-infra` only under `[dev-dependencies]` for `rocket-import`.

- [ ] **Step 2: Edit the three files**

`rocket-http`: replace "contains **no I/O implementations**" with a sentence that the crate holds types, auth helpers, the load-test harness and two I/O leaks (`acquire_token` makes a live HTTP POST, and `TokenClientProvider` exposes `reqwest::Client`), removed by D-50.
`rocket-git`: replace "pure domain crate — no I/O wiring" with "the `GitService` port plus the libgit2 adapter (`Git2Service`); the adapter does filesystem, process and network work, and the crate is mixed on purpose (ruling D-01)".
`rocket-import`: replace the "delegates all disk writes to `FsCollectionRepo`" claim with "reads and writes files itself with `std::fs` (importer copy and merge helpers, zip extraction); `rocket-infra` is a dev-dependency only; D-51 moves this behind a file port (ruling D-01)". Keep the "No raw YAML is written by this crate" sentence only if a grep for `serde_yaml::to_string` in non-test code of the crate shows it is true; otherwise drop it.

- [ ] **Step 3: Verify**

Run: `grep -n "no I/O implementations\|pure domain crate\|delegates all disk writes" crates/rocket-http/CLAUDE.md crates/rocket-git/CLAUDE.md crates/rocket-import/CLAUDE.md`
Expected: no output.

---

### Task 2: D-23 (rocket-app)

**Files:**
- Modify: `crates/rocket-app/CLAUDE.md:3-6` (intro) and the Key Patterns "Trait-object injection" bullet

- [ ] **Step 1: List the production I/O sites**

Run (non-test files only): `grep -nE "std::fs|tokio::fs|reqwest|std::env|current_exe" crates/rocket-app/src/{contract_service,workspace_service,collection_lock,grpc_service,oauth2_service,execution_service,acp_session_service}.rs | grep -v "^.*://"` and read the hits that lie before each file's `#[cfg(test)]`.
Expected: the sites named in D-40 to D-45.

- [ ] **Step 2: Edit**

Replace "never touches the filesystem or any I/O directly" with: the crate holds use-case services and should not do I/O; known exceptions until Phase 4: contract attachments (D-40), workspace directory checks and delete (D-41), the collection lock key `canonicalize` (D-42), the proto file `metadata` (D-43), the `reqwest` client and token POST in `OAuth2Service` (D-44), process env and user name reads (D-45). Add one sentence that the crate is large (about 33k non-test lines) and that D-80 to D-82 plan the context splits. Fix the "No concrete types appear in this crate" bullet with "except the exceptions above".

- [ ] **Step 3: Verify**

Run: `grep -n "never$\|never touches" crates/rocket-app/CLAUDE.md`
Expected: no output for the old claim.

---

### Task 3: D-24 (rocket-collection) and roadmap

**Files:**
- Modify: `crates/rocket-collection/CLAUDE.md:7`, `docs/roadmaps/ddd-roadmap.md` (D-20 to D-24 status)

- [ ] **Step 1: Re-check**

Run: `grep -n "canonicalize" crates/rocket-collection/src/openapi_consent.rs`
Expected: line 49 still calls `std::fs::canonicalize`.

- [ ] **Step 2: Edit and mark done**

Change "no I/O, no filesystem access" to "no I/O except one filesystem call in `openapi_consent.rs` (`canonicalize` of the collection root, removed by D-52)". Set D-20 to D-24 to `done` in the roadmap with a note that each text is to be restored when D-50, D-51, D-52 and D-40 to D-45 ship.

- [ ] **Step 3: Verify**

Run: `grep -nE '^\| D-2[0-4] ' docs/roadmaps/ddd-roadmap.md | grep -c "| open |"`
Expected: `0`.
