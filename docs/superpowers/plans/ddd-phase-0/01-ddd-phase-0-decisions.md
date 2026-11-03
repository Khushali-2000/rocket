# DDD Phase 0 Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the five open decisions D-01 to D-05 of the DDD roadmap and record each as a ruling, so Phases 2 to 8 can start without guessing.

**Architecture:** Each decision gets a short evidence block (counts from grep, taken now) and a ruling that the user confirms. Rulings live in one file, `docs/engineering/ddd-decisions.md`, and the roadmap statuses point to it. No code changes.

**Tech Stack:** Markdown, `grep`, `wc`, `cargo metadata` (read-only).

**Spec:** `docs/roadmaps/ddd-roadmap.md` (Phase 0, Decisions log).

## Global Constraints

- Cargo commands pass `-j4`; never `--workspace` or `--all`.
- Docs go under `docs/` or `.claude/`; code comments and doc sentences are short, full sentences ending in a punctuation mark.
- Roadmap IDs are stable. Never renumber. Set the status to `done` and note the ruling date.
- A ruling is only written after the user confirms it. The recommendations in the roadmap are the default proposal, not the answer.
- No commit during the plan. The user reviews all three tasks, then one commit (use the `dev-workflow-skills:1-git-commit` skill).

## Review Focus

- A ruling that contradicts an existing `CLAUDE.md` claim (for example "accept `rocket-http` as mixed" while `crates/rocket-http/CLAUDE.md` says no I/O) must list the doc fix as a follow-up item (D-20 to D-24).
- D-05 renames touch the event wire format. The ruling must say that event tags stay byte-identical until D-74, or name the frontend change.
- D-02 must not promise a crate split that Phase 8 has no item for (D-80 to D-82 are the only ones).
- Counts in the evidence blocks are approximate (a hit is a call site). Say so once at the top of the file.

---

### Task 1: Census for D-01 and D-05 (evidence only)

**Files:**
- Create: `docs/engineering/ddd-decisions.md` (header and the D-01 and D-05 evidence blocks)

**Interfaces:**
- Produces: sections `## D-01` and `## D-05` in `docs/engineering/ddd-decisions.md`, each with `Evidence`, `Options`, `Proposal`, and an empty `Ruling:` line that Task 3 fills.

- [ ] **Step 1: Create the file header**

Title `# DDD Decisions`, one sentence on its source (`docs/roadmaps/ddd-roadmap.md` Phase 0), and one sentence that counts are approximate call sites.

- [ ] **Step 2: Count I/O sites for D-01**

Run from the repo root, one line per crate (production code only, tests excluded):
`grep -rnE 'std::fs|tokio::fs|fs::|reqwest|std::process' crates/rocket-import/src crates/rocket-http/src crates/rocket-git/src | grep -v '#\[cfg(test)\]'`
Group the output by crate and by file. Record, per crate: number of sites, the three files with the most sites, and whether a port trait already exists for that I/O (`CollectionFileSource` exists in `rocket-collection`; check for others with `grep -rn "pub trait" crates/rocket-import/src crates/rocket-http/src`).
Expected: `rocket-import` and `rocket-git` show many sites; `rocket-http` shows `reqwest` use only (the `acquire_token` POST).

- [ ] **Step 3: Write the D-01 block**

Options: (a) accept as mixed and document (D-20 to D-22), (b) move the I/O behind ports (D-50, D-51). Proposal from the roadmap: `rocket-git` mixed, `rocket-import` and `rocket-http` get ports. Add the cost line: D-51 is about 28 sites in `importer.rs` and `zip_extractor.rs`.

- [ ] **Step 4: Census the assistant naming for D-05**

Run:
`grep -rniE 'acp' --include=*.rs --include=*.ts --include=*.tsx -l crates src src-tauri | wc -l` and the same for `assistant`.
Also list the `DomainEvent` variants by prefix: `grep -oE '\b(Acp|Assistant)[A-Za-z]*' crates/rocket-shared/src/events.rs | sort | uniq -c | sort -rn`.
Record: file counts for each name, the `Acp*` versus `Assistant*` event variants (the survey so far shows `Acp*` dominates, with `Assistant*` only on conversation events), crate name `rocket-acp`, and the docs that mention each (`docs/features/acp-multi-agent-support.md`, `docs/features/assistant-*.md`).

- [ ] **Step 5: Write the D-05 block**

Options: (a) keep `rocket-acp` for the protocol client and `assistant` for the product features, with a written glossary (no rename), (b) rename the crate to `rocket-assistant`, (c) rename everything to `acp`. Proposal: (a), because ACP is the protocol and "assistant" is the feature, and a rename costs the event wire format (see Review Focus). State the cost of (b) as the file counts from Step 4.

- [ ] **Step 6: Verify**

Run: `grep -c '^## D-0' docs/engineering/ddd-decisions.md`
Expected: `2`.

---

### Task 2: Evidence for D-02, D-03 and D-04

**Files:**
- Modify: `docs/engineering/ddd-decisions.md` (append `## D-02`, `## D-03`, `## D-04`)

**Interfaces:**
- Consumes: the file and block layout from Task 1.
- Produces: three more blocks with the same four parts.

- [ ] **Step 1: Measure `rocket-app` for D-02**

Run: `wc -l crates/rocket-app/src/*.rs | sort -rn | head -15` and `ls crates/rocket-app/src | wc -l`.
Group the files by context by name prefix (`flow_*`, `openapi_*`, `contract_*`, `acp_*`, `execution_*`). Record total lines (about 99k including tests; the roadmap says about 33k non-test lines, so re-count non-test lines and correct whichever number is wrong in the roadmap).

- [ ] **Step 2: Write the D-02 block**

Options: (a) keep one `rocket-app`, (b) split by context over time (D-80 flow runtime, D-81 OpenAPI sync, D-82 contract and conversation). Proposal from the roadmap: (b), and only after Phases 3 and 4 are done for the same area. Add a line: no split starts without its own spec.

- [ ] **Step 3: Read the events spec for D-03**

Read `docs/engineering/events-and-ipc-rework.md` and the R-55 row in `docs/roadmaps/roadmap.md` (line 128). Write the D-03 block: options are (a) one global `DomainEvent`, (b) per-context enums behind the same wire format with the contract tests in `crates/rocket-shared/src/events.rs` as the guard. State that R-55 is parked (2026-10-11) and that D-74 depends on this ruling. Proposal: (b) as the direction, but no work until R-55 is unparked; Phases 3 to 6 do not need it.

- [ ] **Step 4: Find the bypass sites for D-04**

Run:
`grep -n "workspaces.push\|\.name = " crates/rocket-app/src/workspace_service.rs`
`grep -n "validate" crates/rocket-app/src/flow_service.rs`
Expected: 3 direct mutations in the workspace service and a `validate` call that the service makes before saving a flow. These two are the evidence that callers bypass rules.

- [ ] **Step 5: Write the D-04 block**

Options: (a) private fields and validating constructors everywhere, (b) keep public fields plus validators, (c) narrow: aggregate methods only where callers already bypass rules (`WorkspaceRegistry`, `Flow`), newtypes later via D-67. Proposal: (c). Say it is the gate for Phase 6 (D-60 to D-67).

- [ ] **Step 6: Verify**

Run: `grep -c '^## D-0' docs/engineering/ddd-decisions.md`
Expected: `5`.

---

### Task 3: User rulings and close-out

**Files:**
- Modify: `docs/engineering/ddd-decisions.md` (fill each `Ruling:` line)
- Modify: `docs/roadmaps/ddd-roadmap.md` (Phase 0 table statuses, Decisions log)
- Modify: `CLAUDE.md` (one pointer line to `docs/engineering/ddd-decisions.md`)

**Interfaces:**
- Consumes: the five blocks from Tasks 1 and 2.
- Produces: five `Ruling (2026-11-04):` lines and Phase 0 rows set to `done`.

- [ ] **Step 1: Ask the user for the five rulings**

Use one AskUserQuestion call with four questions (D-01, D-02, D-04, D-05) and the proposals as the first options marked `(Recommended)`. Ask D-03 in a second call or as a plain note: the recommendation is "per-context direction, parked until R-55 is unparked". Do not write a ruling the user did not give.

- [ ] **Step 2: Record the rulings**

In `docs/engineering/ddd-decisions.md`, replace each empty `Ruling:` line with `Ruling (2026-11-04): <choice>. <one sentence why>. Follow-ups: <roadmap IDs>.` For D-01 list D-20 to D-22 and D-50 or D-51 as the follow-ups that the choice keeps or drops. For D-05 name the wire-format consequence.

- [ ] **Step 3: Update the roadmap**

In `docs/roadmaps/ddd-roadmap.md`: set Status to `done` for each ruled row in the Phase 0 table and append a pointer to `docs/engineering/ddd-decisions.md`. Add one `Ruling (2026-11-04):` line per decision to the Decisions log. If a ruling drops an item (for example D-51 when `rocket-import` stays mixed), set that item to `dropped` and say why. If the Step 1 count in Task 2 corrected the "about 33k non-test lines" figure, fix it in the Verdict text and in D-02.

- [ ] **Step 4: Add the pointer**

In `CLAUDE.md`, after the existing `ddd-roadmap` or roadmap lines, add one line: "See `docs/engineering/ddd-decisions.md` for the DDD rulings (mixed crates, `rocket-app` size, events direction, domain model depth, assistant naming)."

- [ ] **Step 5: Verify**

Run: `grep -c 'Ruling (2026-11-04)' docs/engineering/ddd-decisions.md`
Expected: `5`.
Run: `grep -n 'D-0[1-5].*open' docs/roadmaps/ddd-roadmap.md`
Expected: no output.

- [ ] **Step 6: Stop for review**

Show the user the diff of the three files. After they approve, commit with the `dev-workflow-skills:1-git-commit` skill, path-scoped to the three files plus `docs/superpowers/plans/ddd-phase-0/`. Suggested message type: `docs:`.
