use serde::{Deserialize, Serialize};

use crate::error::DomainResult;

fn default_true() -> bool {
    true
}

/// The update notice setting. It lives here so rocket-app and rocket-infra can share it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateSettings {
    /// Whether the app checks for a new release on its own.
    #[serde(default = "default_true")]
    pub auto_check: bool,
    /// The release version the user chose to skip, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped_version: Option<String>,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            auto_check: true,
            skipped_version: None,
        }
    }
}

/// Loads and saves the update settings.
pub trait UpdateSettingsRepository: Send + Sync {
    fn load(&self) -> DomainResult<UpdateSettings>;
    fn save(&self, settings: &UpdateSettings) -> DomainResult<()>;
}
