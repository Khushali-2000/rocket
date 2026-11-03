# Update notification

Date: 2026-11-05. Status: draft, waiting for review.

## Problem

When a new Rocket release is published on GitHub, users do not hear about it. The Tauri updater plugin is already registered (`tauri_plugin_updater` in `src-tauri/src/lib.rs`), `tauri.conf.json` holds its public key and endpoint (`https://github.com/Snehal1112/rocket/releases/latest/download/latest.json`), and the release workflow builds signed updater artifacts. Nothing in the app calls it, and `src-tauri/capabilities/default.json` has no updater permission.

## Decisions (from the review)

- Notify and install in the app, using the updater plugin.
- Check about 30 seconds after launch, then every 6 hours while the app is open. A setting turns the automatic checks off, and Settings has a Check now button.
- The toast has Update, Later and Skip this version. Clicking the toast text or "What's new" opens a dialog with the version and the release notes, with the same Update and Skip buttons.
- Out of scope: release channels (beta), Linux arm64 and Intel macOS builds, a changelog history view.

## Facts that shape the design

- The repo is public, so the endpoint needs no authentication.
- Releases are created as drafts (`releaseDraft: true`) and published by hand. `latest.json` is reachable only after publishing, so a notice fires exactly when a release is done.
- Release targets are Linux x86_64, Windows and macOS Apple Silicon. The Linux bundle is `all` (deb, rpm, AppImage). The updater can replace only an AppImage on Linux.

## Design

### Install kind

`get_install_kind` returns `selfUpdatable` on Windows, macOS and a Linux AppImage (the `APPIMAGE` env var is set), and `manual` on a deb or rpm install and on a dev build (`cfg!(debug_assertions)`). A `manual` install shows "View release" instead of Update, which opens the release page (`https://github.com/Snehal1112/rocket/releases/tag/v<version>`) in the browser.

### Backend (`src-tauri` and `rocket-app`)

- A small `UpdateService` in `rocket-app` holds the pure logic: version comparison (semver, ignoring a leading `v`), the skip rule (a skipped version is not announced again, a newer one is), and the poll schedule decision. It is trait-first and has no I/O.
- `src-tauri/src/commands/updates.rs` (thin): `check_for_update` (calls the plugin's `check()`, returns `{available, version, notes, date}` or `none`), `install_update` (downloads with progress events, verifies the signature through the plugin, installs, never restarts by itself), `restart_app`, `get_install_kind`.
- A background task started at app init waits about 30 seconds, then checks every 6 hours when the setting is on. A found update that is newer than the skipped version emits the `update-available` event (`{version, notes}`). A failed or offline check is silent apart from one log line. Progress is emitted as `update-progress` (`{downloaded, total}`).
- New commands are added to `src-tauri/app-commands.txt`. `src-tauri/capabilities/default.json` gets `updater:default`. Events follow the existing event conventions (see `.claude/rules/tauri-ipc-boundaries.md`).
- Settings (auto check on/off, skipped version) are stored with the other app settings. Planning confirms which store `ProxySettings` and similar use and follows it, with `#[serde(default)]` so old files load (auto check on, nothing skipped).

### Frontend

- A Zustand store `update-store` (narrow selectors) holds `{available, version, notes, status: idle|downloading|ready|error, progress, installKind}`.
- A hook mounted once in the app shell listens for `update-available` and `update-progress` and shows the toast (shadcn/sonner as elsewhere), once per version per launch.
- The toast actions: Update (installs, shows progress in the toast, then Restart), Later (dismiss, comes back at the next launch or check), Skip this version (persists the version and dismisses). Clicking the text or "What's new" opens `UpdateDialog` (version, release notes rendered as plain text or the existing markdown renderer, Update and Skip). `manual` installs replace Update with View release.
- Settings > About gets an "Updates" block: current version, latest version if known, Check now, the auto-check switch, and an Update or View release button when one is available. Checking from here ignores the skip rule.
- Errors: a failed install or bad signature shows an error toast and leaves the app untouched.

## Security reasoning

- The plugin verifies the update's signature against the configured public key before installing, so a tampered download fails. The endpoint is fixed in `tauri.conf.json` and the app never takes a URL from the network.
- Release notes are untrusted text: they render as plain text or through the existing sanitising markdown renderer, never as raw HTML.
- No telemetry: the check sends only what the plugin sends (version, target) to GitHub.

## Tests

- `rocket-app`: version comparison (`2.1.4` vs `2.2.0`, `v` prefix, pre-release suffix ignored or lower), skip rule, schedule decision.
- `src-tauri`: install kind detection from env and build mode as a pure function.
- Vitest: the store, the toast states (available, downloading, ready, error, manual), the dialog actions, the Settings About block (Check now, switch, skip), and that Skip persists.
- Manual (release day): publish a draft release with a higher version, start an older build, confirm the toast, notes dialog, install and restart on Windows or macOS or AppImage, and View release on a deb install.

## Docs

`docs/features/update-notification.md` (behaviour, install kinds, settings, manual check) and a line in `CLAUDE.md` under the feature docs list.

## Addendum (after the code check, same day)

These facts from the code replace the matching sentences above.

- **Install kind.** `tauri-plugin-updater` 2.10.0 can also install a deb or rpm (it runs `pkexec` or `sudo`), as long as `latest.json` has an entry for that bundle. So the plugin decides: `check()` finds an update only when `latest.json` has an entry for this build. `get_install_kind` returns `manual` for a dev build only (`cfg!(debug_assertions)`), and `selfUpdatable` everywhere else. If an install fails, the user sees an error toast with a View release action.
- **No `updater:default`.** The Rust commands call the plugin directly, so the webview needs no plugin permission. Granting it would let the page call the plugin's own JS commands with caller-supplied headers and proxy. The capability file does not change.
- **No `tauri-plugin-process`.** `restart_app` calls `AppHandle::restart()`.
- **Windows.** The NSIS installer may close Rocket by itself when the install starts. The UI says "Rocket will close to finish the update" before the install on Windows, and the Restart button appears only if the app is still running after the install returns.
- **Events** are plain `app.emit("update-available", payload)` and `app.emit("update-progress", payload)` with camelCase payloads, like `backend-log`. They are not `DomainEvent` variants.
- **Version compare** uses the `semver` crate (add `semver = "1"` to `rocket-app`; it is already in the lock file).
- **Settings** live in `~/.rocket-api/update.yml`, one small YAML file per setting, like `proxy.yml`.
- **Known limit.** The updater requests use the system proxy, not Rocket's own proxy setting. A user whose only route is Rocket's proxy gets a silent failed check.
- **Toast.** Sonner's `action` allows one button, so the toast is `toast.custom` with shadcn Buttons and a fixed id, updated in place for progress.
