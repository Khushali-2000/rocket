# Update notification, plan 2: toast, dialog, About block and docs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user sees a toast when a new release is out, can read the notes, install and restart, skip the version, and manage the setting in Settings > About.

**Architecture:** `tauri-api.ts` wraps the plan 1 commands and events. A Zustand `update-store` holds the update state. A once-mounted hook `useUpdateNotice` listens for `update-available` and `update-progress`, updates the store and shows one toast per version per launch (`toast.custom` with a fixed id, updated in place). `UpdateDialog` shows the notes. `UpdatesBlock` in the About section holds Check now, the auto-check switch and the install actions.

**Tech Stack:** React + TypeScript (Bun, Vitest, Biome), Zustand, sonner, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-05-update-notification-design.md` (read the Addendum). Index: `2026-11-05-update-notice-index.md`. This is plan 2 of 2 and needs plan 1's commands: `check_for_update`, `install_update`, `restart_app`, `get_install_kind`, `get_update_settings`, `set_update_auto_check`, `skip_update_version`, and the events `update-available` (`{ version, notes, date }`) and `update-progress` (`{ downloaded, total }`).

## Global Constraints

- shadcn/ui primitives only (no raw `<button>`, `<input>`, `<dialog>`), lucide-react icons only, no full destructuring of Zustand state (narrow selectors), no raw HTML from release notes: render them with `<MarkdownRenderer restricted>` (`src/components/collections/MarkdownRenderer.tsx`).
- Bun only. After each task run `bun run tsc --noEmit` and `bun run check`.
- The toast appears once per version per launch (a module-level `Set` of announced versions). Later dismisses it only. Skip persists through `skip_update_version`. An error toast offers View release (`openUrl` from `@tauri-apps/plugin-opener`, falling back to `toast.error("Could not open the browser. Go to <url>")` like `SupportSection.tsx`).
- Release URL: `https://github.com/Snehal1112/rocket/releases/tag/v<version>` (no leading `v` doubled).
- A `manual` install kind (dev builds) shows View release instead of Update.
- On Windows the install may close the app: before the install the toast/dialog says "Rocket will close to finish the update." Restart is shown only if the app is still running after install returns.

## Review Focus

- The toast shows once per version, not on every 6-hour event (Task 4).
- Skip hides the version for later checks; Later does not (Tasks 4 and 5).
- A failed install shows an error and View release and leaves the app usable (Task 4).
- Release notes cannot inject HTML or load images (Task 5).
- The existing `AboutSection` tests still pass (Task 5).

---

### Task 4: API wrappers, store, hook and toast

**Files:**
- Modify: `src/lib/tauri-api.ts` (wrappers and event listeners, template at ~:1536 and ~:4038)
- Create: `src/stores/update-store.ts`, `src/stores/__tests__/update-store.test.ts`
- Create: `src/hooks/useUpdateNotice.ts`, `src/hooks/__tests__/useUpdateNotice.test.tsx`
- Create: `src/components/updates/UpdateToast.tsx`, `src/components/updates/__tests__/UpdateToast.test.tsx`
- Modify: `src/App.tsx` (mount `useUpdateNotice()` with the other hooks ~:58-65)

**Interfaces:**
- Produces in `tauri-api.ts`: types `UpdateInfo { version: string; notes: string | null; date: string | null }`, `UpdateSettings { autoCheck: boolean; skippedVersion: string | null }`, `InstallKind = 'selfUpdatable' | 'manual'`, `UpdateProgress { downloaded: number; total: number | null }`; `checkForUpdate(): Promise<UpdateInfo | null>`, `installUpdate(version: string): Promise<void>`, `restartApp(): Promise<void>`, `getInstallKind(): Promise<InstallKind>`, `getUpdateSettings()`, `setUpdateAutoCheck(enabled: boolean)`, `skipUpdateVersion(version: string)`, `onUpdateAvailable(handler: (info: UpdateInfo) => void): Promise<UnlistenFn>`, `onUpdateProgress(handler: (p: UpdateProgress) => void): Promise<UnlistenFn>`.
- Produces `useUpdateStore` with state `{ available: UpdateInfo | null; installKind: InstallKind; status: 'idle' | 'downloading' | 'ready' | 'error'; progress: UpdateProgress | null; error: string | null; dialogOpen: boolean }` and actions `setAvailable(info | null)`, `setInstallKind`, `setProgress`, `setStatus`, `setError`, `openDialog()`, `closeDialog()`, `reset()` (template `src/stores/settings-store.ts`), plus `export async function installAvailableUpdate()` and `export async function skipAvailableUpdate()` which implement the flows below.
- Produces `UpdateToast` (props `{ info: UpdateInfo; installKind: InstallKind }`, reads the store) and `useUpdateNotice()`.

- [ ] **Step 1: Write failing tests.**
  - `update-store.test.ts`: initial state; `setAvailable` stores it; `reset()` restores the initial state. `installAvailableUpdate` with a mocked `installUpdate` that resolves: status goes `downloading` then `ready`; with a mocked rejection: status `error` and `error` set, `available` kept. `skipAvailableUpdate` calls `skipUpdateVersion(version)` and clears `available`.
  - `useUpdateNotice.test.tsx` (mock `@/lib/tauri-api` and `sonner`, template `useFileWatcherFailed.test.ts`): mounting calls `getInstallKind` once and registers both listeners; an `update-available` event for `2.2.0` sets `available` and calls `toast.custom` once with a stable id; a second event for `2.2.0` does not call `toast.custom` again; an event for `2.3.0` does; `update-progress` events update `progress` and re-render the toast with the same id; unmount calls both unlisteners.
  - `UpdateToast.test.tsx`: renders "Rocket 2.2.0 is available" with Update, Later and Skip this version and a What's new control; clicking Update calls the install flow; Later dismisses the toast id only (`toast.dismiss`) and does not call `skipUpdateVersion`; Skip calls `skipUpdateVersion('2.2.0')` and dismisses; clicking the text or What's new calls `openDialog`; with `installKind: 'manual'` the primary button reads View release and opens the release URL; with status `downloading` it shows a progress bar and no buttons; with status `ready` it shows Restart, which calls `restartApp`; with status `error` it shows the error and View release. A Windows note ("Rocket will close to finish the update.") shows when `platform()` from `@tauri-apps/plugin-os` returns `windows` (mock it).

- [ ] **Step 2: Run** `bun run test update-store useUpdateNotice UpdateToast` and expect FAIL.

- [ ] **Step 3: Implement.** Add the wrappers with the `invoke` and `listen` templates in `tauri-api.ts` (camelCase args convert to snake_case). `installAvailableUpdate`: set `downloading`, `await installUpdate(available.version)`, then `ready`; on error set `error` and `status: 'error'`. The hook follows `useFileWatcherFailed.ts` (disposed flag, unlisten on cleanup), keeps a module-level `announced = new Set<string>()`, and renders the toast with `toast.custom((id) => <UpdateToast .../>, { id: 'rocket-update', duration: Infinity })`, re-calling it with the same id when the store changes (subscribe to the store in the hook). Use shadcn `Button` and `Progress` (add the component through the project's existing shadcn setup if `Progress` is missing; if adding it is not trivial use a simple styled `div` bar built from existing tokens). `UpdateToast` text is clickable and opens the dialog through `openDialog`.

- [ ] **Step 4: Run** `bun run test update-store useUpdateNotice UpdateToast`, `bun run tsc --noEmit`, `bun run check`. Expect PASS.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(update): show a toast when a new release is available`.

### Task 5: Release notes dialog and About block

**Files:**
- Create: `src/components/updates/UpdateDialog.tsx`, `src/components/updates/__tests__/UpdateDialog.test.tsx`
- Create: `src/components/settings/sections/UpdatesBlock.tsx`, `src/components/settings/__tests__/UpdatesBlock.test.tsx`
- Modify: `src/components/settings/sections/AboutSection.tsx` (render `<UpdatesBlock />` after the `<dl>`), `src/components/settings/__tests__/AboutSection.test.tsx` (mock the new child or the new `tauri-api` functions)
- Modify: `src/App.tsx` (mount `<UpdateDialog />` beside `<TrustMigrationNotice />`)

**Interfaces:**
- Consumes: `useUpdateStore`, `installAvailableUpdate`, `skipAvailableUpdate`, `checkForUpdate`, `getUpdateSettings`, `setUpdateAutoCheck`, `restartApp` from Task 4.
- Produces: `UpdateDialog` (no props, driven by `dialogOpen` and `available`) and `UpdatesBlock` (no props).

- [ ] **Step 1: Write failing tests.**
  - `UpdateDialog.test.tsx`: closed when `dialogOpen` is false; open shows "Rocket 2.2.0", the date when present, and the notes through the restricted renderer (notes containing `<script>alert(1)</script>` and `![x](https://evil/x.png)` render no script element and no `img`, the image shows "[image omitted]"); buttons Update, Skip this version and Close; Update calls the install flow; Skip calls `skipAvailableUpdate` and closes; `manual` kind shows View release; `ready` shows Restart; empty notes show "No release notes."
  - `UpdatesBlock.test.tsx`: shows the current version (`getVersion` mocked) and "Up to date" or the latest version; the auto-check switch reflects `getUpdateSettings().autoCheck` and toggling calls `setUpdateAutoCheck(false)`; Check now calls `checkForUpdate`, shows "Checking..." while pending, then either "You are on the latest version" (null result) or the version with Update and View release; a rejected check shows "Could not check for updates." without a toast storm; with an available update from the store it shows the same Update action as the dialog; a skipped version still appears here because the manual check ignores the skip rule.
  - `AboutSection.test.tsx`: the two existing tests pass with the added block (mock `./UpdatesBlock` module or add the new functions to the `@/lib/tauri-api` factory mock).

- [ ] **Step 2: Run** `bun run test UpdateDialog UpdatesBlock AboutSection` and expect FAIL.

- [ ] **Step 3: Implement** with `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogBody`, `DialogFooter` (`src/components/ui/dialog.tsx`), `Switch` (`src/components/ui/switch.tsx`) and `Button`. Use `<MarkdownRenderer restricted>`. `UpdatesBlock` loads its data in a `useEffect` with a disposed flag (copy `AboutSection`).

- [ ] **Step 4: Run** the Step 2 tests, then `bun run test settings updates`, `bun run tsc --noEmit`, `bun run check`. Expect PASS.

- [ ] **Step 5: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `feat(update): release notes dialog and updates block in About`.

### Task 6: Docs

**Files:**
- Create: `docs/features/update-notification.md`
- Modify: `CLAUDE.md` (one line in the feature-docs list), `docs/roadmaps/roadmap.md` (only if an item for update notification exists; grep first)

- [ ] **Step 1: Write the doc** (copy the layout of `docs/features/ipc-command-acl.md`): spec link; what it does; the schedule (30 seconds after launch, then every 6 hours, `auto_check` switch, Check now ignores Skip); install kinds (`manual` is a dev build; the plugin decides on real installs through `latest.json`); the commands and events with payloads; where settings live (`~/.rocket-api/update.yml`); security (signature verified by the plugin before install, endpoint fixed in `tauri.conf.json`, notes rendered restricted, no `updater:default` permission); known limits (updater requests use the system proxy, not Rocket's proxy; releases are drafts so nothing is announced until published; Windows may close the app during install; deb and rpm update only if `latest.json` carries entries for them); and a manual check list: publish a draft release with a higher version, start an older build, confirm the toast, the notes dialog, Skip (no second toast on the next check), Later (returns next launch), Check now in About, install and restart on Windows or macOS or AppImage, View release on a dev build, and an offline start (no toast, no error).
- [ ] **Step 2:** Add `See \`docs/features/update-notification.md\` for the update notice (schedule, install kinds, settings, manual checks).` to the list in `CLAUDE.md`.
- [ ] **Step 3: Run** `bun run check` (docs are not linted, but confirm nothing else changed) and `git diff --stat` shows only the doc files.
- [ ] **Step 4: Commit** with the `dev-workflow-skills:1-git-commit` skill, explicit paths: `docs(update): document the update notification`.
