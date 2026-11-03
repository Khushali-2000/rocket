use rocket_app::{UpdateService, UpdateSettings};
use rocket_shared::error::DomainError;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

/// IPC shape of a found update.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfoDto {
    pub version: String,
    pub notes: Option<String>,
    /// RFC 3339 publish date.
    pub date: Option<String>,
}

/// IPC shape of the update settings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsDto {
    pub auto_check: bool,
    pub skipped_version: Option<String>,
}

impl From<UpdateSettings> for UpdateSettingsDto {
    fn from(s: UpdateSettings) -> Self {
        Self {
            auto_check: s.auto_check,
            skipped_version: s.skipped_version,
        }
    }
}

/// Whether this build can install an update by itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallKind {
    SelfUpdatable,
    Manual,
}

/// Download progress sent to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressDto {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// A dev build has nothing to install, so it is manual.
pub fn install_kind_for(debug_build: bool) -> InstallKind {
    if debug_build {
        InstallKind::Manual
    } else {
        InstallKind::SelfUpdatable
    }
}

/// Adds a downloaded chunk to the running total.
pub fn progress_after(downloaded: u64, chunk: usize, total: Option<u64>) -> UpdateProgressDto {
    UpdateProgressDto {
        downloaded: downloaded.saturating_add(chunk as u64),
        total,
    }
}

/// Formats date parts as an RFC 3339 string.
fn rfc3339(parts: (i32, u8, u8, u8, u8, u8), offset_secs: i32) -> String {
    let (y, mo, d, h, mi, s) = parts;
    let sign = if offset_secs < 0 { '-' } else { '+' };
    let abs = offset_secs.unsigned_abs();
    format!(
        "{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}{sign}{:02}:{:02}",
        abs / 3600,
        (abs % 3600) / 60
    )
}

fn strip_v(version: &str) -> &str {
    version.strip_prefix('v').unwrap_or(version)
}

fn info_from(update: &tauri_plugin_updater::Update) -> UpdateInfoDto {
    let date = update.date.map(|d| {
        rfc3339(
            (
                d.year(),
                u8::from(d.month()),
                d.day(),
                d.hour(),
                d.minute(),
                d.second(),
            ),
            d.offset().whole_seconds(),
        )
    });
    UpdateInfoDto {
        version: update.version.clone(),
        notes: update.body.clone(),
        date,
    }
}

/// Tells the webview that a newer release exists.
// The background check in the next task is the first caller.
#[allow(dead_code)]
pub(crate) fn emit_update_available(app: &AppHandle, info: &UpdateInfoDto) {
    if let Err(e) = app.emit("update-available", info) {
        tracing::warn!("Could not emit update-available: {e}");
    }
}

async fn find_update(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, DomainError> {
    let fail = |e: &dyn std::fmt::Display| {
        tracing::warn!("Update check failed: {e}");
        DomainError::Internal("Could not check for updates".into())
    };
    let updater = app.updater().map_err(|e| fail(&e))?;
    updater.check().await.map_err(|e| fail(&e))
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<UpdateInfoDto>, DomainError> {
    Ok(find_update(&app).await?.map(|u| info_from(&u)))
}

#[tauri::command]
pub async fn install_update(app: AppHandle, version: String) -> Result<(), DomainError> {
    let update = find_update(&app).await?;
    let Some(update) = update.filter(|u| strip_v(&u.version) == strip_v(&version)) else {
        return Err(DomainError::InvalidInput(
            "The update changed. Check again.".into(),
        ));
    };
    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                let dto = progress_after(downloaded, chunk, total);
                downloaded = dto.downloaded;
                let _ = progress_app.emit("update-progress", dto);
            },
            || {},
        )
        .await
        .map_err(|e| {
            tracing::warn!("Update install failed: {e}");
            DomainError::Internal("Could not install the update".into())
        })
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn get_install_kind() -> InstallKind {
    install_kind_for(cfg!(debug_assertions))
}

#[tauri::command]
pub fn get_update_settings(
    svc: State<'_, UpdateService>,
) -> Result<UpdateSettingsDto, DomainError> {
    svc.settings().map(Into::into)
}

#[tauri::command]
pub fn set_update_auto_check(
    svc: State<'_, UpdateService>,
    enabled: bool,
) -> Result<(), DomainError> {
    svc.set_auto_check(enabled)
}

#[tauri::command]
pub fn skip_update_version(
    svc: State<'_, UpdateService>,
    version: String,
) -> Result<(), DomainError> {
    svc.skip_version(&version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_kind_is_manual_for_debug_builds() {
        assert_eq!(install_kind_for(true), InstallKind::Manual);
        assert_eq!(install_kind_for(false), InstallKind::SelfUpdatable);
    }

    #[test]
    fn install_kind_serializes_camel_case() {
        assert_eq!(
            serde_json::to_string(&InstallKind::SelfUpdatable).unwrap(),
            "\"selfUpdatable\""
        );
        assert_eq!(
            serde_json::to_string(&InstallKind::Manual).unwrap(),
            "\"manual\""
        );
    }

    #[test]
    fn progress_adds_the_chunk() {
        let p = progress_after(100, 50, Some(1000));
        assert_eq!(p.downloaded, 150);
        assert_eq!(p.total, Some(1000));
    }

    #[test]
    fn info_dto_uses_camel_case_and_null_notes() {
        let dto = UpdateInfoDto {
            version: "1.2.3".into(),
            notes: None,
            date: Some("2026-11-05T10:00:00+00:00".into()),
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["version"], "1.2.3");
        assert!(v["notes"].is_null());
        assert_eq!(v["date"], "2026-11-05T10:00:00+00:00");
    }

    #[test]
    fn settings_dto_uses_camel_case() {
        let dto = UpdateSettingsDto {
            auto_check: true,
            skipped_version: Some("1.0.0".into()),
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["autoCheck"], true);
        assert_eq!(v["skippedVersion"], "1.0.0");
    }

    #[test]
    fn rfc3339_formats_offsets() {
        assert_eq!(
            rfc3339((2026, 11, 5, 9, 8, 7), 0),
            "2026-11-05T09:08:07+00:00"
        );
        assert_eq!(
            rfc3339((2026, 11, 5, 9, 8, 7), -19800),
            "2026-11-05T09:08:07-05:30"
        );
    }

    #[test]
    fn strip_v_removes_one_leading_v() {
        assert_eq!(strip_v("v1.2.3"), "1.2.3");
        assert_eq!(strip_v("1.2.3"), "1.2.3");
    }
}
