use std::fs;
use std::path::PathBuf;

use rocket_shared::error::{DomainError, DomainResult};
use rocket_shared::update_settings::{UpdateSettings, UpdateSettingsRepository};

use crate::atomic_write;

/// Stores the update settings in one YAML file.
pub struct FsUpdateSettingsRepo {
    path: PathBuf,
}

impl FsUpdateSettingsRepo {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl UpdateSettingsRepository for FsUpdateSettingsRepo {
    fn load(&self) -> DomainResult<UpdateSettings> {
        if !self.path.exists() {
            return Ok(UpdateSettings::default());
        }
        let text = fs::read_to_string(&self.path)?;
        serde_yaml::from_str(&text)
            .map_err(|e| DomainError::Internal(format!("Failed to parse the update settings: {e}")))
    }

    fn save(&self, settings: &UpdateSettings) -> DomainResult<()> {
        let yaml = serde_yaml::to_string(settings).map_err(|e| {
            DomainError::Internal(format!("Failed to serialize the update settings: {e}"))
        })?;
        atomic_write(&self.path, yaml.as_bytes())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_file_is_the_default_setting() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FsUpdateSettingsRepo::new(dir.path().join("update.yml"));
        let loaded = repo.load().expect("load");
        assert!(loaded.auto_check);
        assert_eq!(loaded, UpdateSettings::default());
    }

    #[test]
    fn settings_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FsUpdateSettingsRepo::new(dir.path().join("update.yml"));
        let settings = UpdateSettings {
            auto_check: false,
            skipped_version: Some("2.2.0".into()),
        };
        repo.save(&settings).expect("save");
        assert_eq!(repo.load().expect("load"), settings);
    }

    #[test]
    fn a_file_with_only_a_skipped_version_keeps_auto_check_on() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("update.yml");
        fs::write(&path, "skipped_version: \"2.2.0\"\n").expect("write");
        let loaded = FsUpdateSettingsRepo::new(path).load().expect("load");
        assert!(loaded.auto_check);
        assert_eq!(loaded.skipped_version.as_deref(), Some("2.2.0"));
    }

    #[test]
    fn a_corrupt_file_is_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("update.yml");
        fs::write(&path, "auto_check: [not, a, bool\n").expect("write");
        assert!(FsUpdateSettingsRepo::new(path).load().is_err());
    }

    #[test]
    fn no_skipped_version_is_not_written() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("update.yml");
        let repo = FsUpdateSettingsRepo::new(path.clone());
        repo.save(&UpdateSettings::default()).expect("save");
        let text = fs::read_to_string(&path).expect("read");
        assert!(!text.contains("skipped_version"));
    }
}
