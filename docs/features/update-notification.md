# Update notification

Rocket looks for a new release in the background and shows a toast when a newer one exists. The design is in `docs/superpowers/specs/2026-11-05-update-notification-design.md` (the Addendum overrides the earlier text).

## What it does

- A checker in `src-tauri/src/commands/updates.rs` asks the Tauri updater plugin for `latest.json` and emits `update-available` when the version is newer and not skipped.
- The webview hook `useUpdateNotice` (`src/hooks/useUpdateNotice.tsx`) shows one toast with a fixed id. The toast appears once per version per launch.
- The toast has Update (or View release on a dev build), Later and Skip this version. Later only dismisses the toast. It comes back at the next launch, not at the next 6-hour check, because the toast shows once per version per launch. Skip saves the version and it is not announced again.
- A notes dialog (`src/components/updates/UpdateDialog.tsx`) shows the release notes with Update (or View release on a dev build), Skip this version and Close.
- Settings, About block (`src/components/settings/sections/UpdatesBlock.tsx`): the auto check switch, Check now, the current version, and the same Update or Restart or View release actions.
- State lives in `src/stores/update-store.ts` and is not saved. A newer `update-available` event during a download or after it finished is ignored until the status is idle or error. Clearing the update while the status is `error` resets the status to idle.

## Schedule

- First check 30 seconds after launch, then every 6 hours (`wait_before_check`).
- The settings are read again each cycle, so a change to the `auto_check` switch takes effect at the next 6-hour check, with no restart. With `auto_check` off the loop skips the check.
- Check now (in the Settings About block) ignores the skip rule and the `auto_check` switch. It shows the update even for a skipped version.

## Install kinds

- `manual` only for a debug build (`install_kind_for(cfg!(debug_assertions))`). There the toast and dialog offer View release, which opens the GitHub release page, and no Update button.
- `selfUpdatable` for every release build. The updater plugin decides what really works on that install through `latest.json`.

## Commands and events

Commands (all listed in `src-tauri/app-commands.txt`):

| Command | Returns | Notes |
|---|---|---|
| `check_for_update` | `{ version, notes, date } \| null` | `notes` and `date` may be null; `date` is RFC 3339. Ignores the skip rule. |
| `install_update(version)` | nothing | Checks again and fails with "The update changed. Check again." if the version differs (a leading `v` is ignored). Downloads, verifies and installs. |
| `restart_app` | nothing | Restarts after an install. |
| `get_install_kind` | `"selfUpdatable" \| "manual"` | |
| `get_update_settings` | `{ autoCheck, skippedVersion }` | |
| `set_update_auto_check(enabled)` | nothing | |
| `skip_update_version(version)` | nothing | |

Events (plain `emit`, not through `TauriEventBus`):

- `update-available`: `{ version, notes, date }`.
- `update-progress`: `{ downloaded, total }` where `total` may be null.

## Settings

`~/.rocket-api/update.yml` holds `auto_check` (default on) and `skipped_version`. The version is stored without a leading `v`, and a `v` is ignored when it is compared. A missing, empty or corrupt file counts as the defaults (a corrupt one logs a warning with the path only), so the commands keep working and the user can fix it from the Settings page. The logic is in `crates/rocket-app/src/update_service.rs`, the file in `crates/rocket-infra/src/fs_update_settings_repo.rs`.

## Security

- The plugin verifies the signature against the public key in `tauri.conf.json` before it installs.
- The endpoint is fixed in `src-tauri/tauri.conf.json` (`releases/latest/download/latest.json`). The webview cannot change it.
- Release notes are rendered in a restricted way.
- The `main` capability has no `updater:default` permission. The webview reaches the updater only through the app commands above, which the ACL limits to the main window (see `docs/features/ipc-command-acl.md`).
- The update store imports `toast` from `sonner` only to show a "Could not save your choice" error when Skip cannot be saved.

## Known limits

- Updater requests use the system proxy, not Rocket's own proxy settings.
- Releases are drafts, so nothing is announced until a release is published.
- On Windows the installer may close the app during the install. The toast, dialog and About block show a note ("Rocket will close to finish the update.").
- deb and rpm installs update only if `latest.json` carries entries for them.
- Errors reach the webview as the `DomainError` text (`Invalid input: ...`). The update store drops the `Invalid input: ` and `Internal error: ` prefixes before it shows them.
- Before an install the updater runs Rocket's exit cleanup (`shutdown_services` in `src-tauri/src/lib.rs`, the same as `RunEvent::Exit`), because on Windows the plugin ends the process itself. `release_url` in `rocket-app` is covered by tests and mirrored by the frontend `openRelease`.
- A failed background check is logged at warn level and shows nothing.

## Manual checks

Not yet run. These need the desktop app and a real release.

- [ ] Publish a draft release with a higher version, then start an older build. After about 30 seconds the toast appears.
- [ ] Open the notes dialog from the toast. The notes show and the buttons work.
- [ ] Skip this version: the toast goes away and no second toast appears on the next check (restart and wait, or wait 6 hours).
- [ ] Later: the toast goes away and returns on the next launch.
- [ ] Settings, About, Check now: it finds the update, including a skipped one.
- [ ] Install and restart on Windows, macOS or an AppImage. Progress shows, Restart relaunches into the new version. On Windows the close note shows.
- [ ] On Windows, an install closes Rocket after the exit cleanup: ACP agents stop. Check that no agent process stays in Task Manager.
- [ ] View release on a dev build opens the release page.
- [ ] Start offline: no toast and no error shown.
