use rocket_shared::error::DomainResult;
pub use rocket_shared::update_settings::{UpdateSettings, UpdateSettingsRepository};
use semver::Version;

const RELEASE_BASE: &str = "https://github.com/Snehal1112/rocket/releases/tag/v";

fn strip_v(version: &str) -> &str {
    let version = version.trim();
    version.strip_prefix('v').unwrap_or(version)
}

fn parse(version: &str) -> Option<Version> {
    Version::parse(strip_v(version)).ok()
}

/// True when the candidate is a newer release than the current version.
pub fn is_newer(current: &str, candidate: &str) -> bool {
    match (parse(current), parse(candidate)) {
        (Some(current), Some(candidate)) => candidate > current,
        _ => false,
    }
}

/// True when the candidate is newer and the user did not skip it.
pub fn should_announce(settings: &UpdateSettings, current: &str, candidate: &str) -> bool {
    if !is_newer(current, candidate) {
        return false;
    }
    match &settings.skipped_version {
        Some(skipped) => strip_v(skipped) != strip_v(candidate),
        None => true,
    }
}

/// The GitHub release page of a version.
///
/// Covered by tests here and mirrored by the frontend `openRelease`, which builds the same URL.
pub fn release_url(version: &str) -> String {
    format!("{RELEASE_BASE}{}", strip_v(version))
}

/// Reads and changes the update settings.
pub struct UpdateService {
    repo: Box<dyn UpdateSettingsRepository>,
}

impl UpdateService {
    pub fn new(repo: Box<dyn UpdateSettingsRepository>) -> Self {
        Self { repo }
    }

    pub fn settings(&self) -> DomainResult<UpdateSettings> {
        self.repo.load()
    }

    pub fn set_auto_check(&self, enabled: bool) -> DomainResult<()> {
        let mut settings = self.repo.load()?;
        settings.auto_check = enabled;
        self.repo.save(&settings)
    }

    pub fn skip_version(&self, version: &str) -> DomainResult<()> {
        let mut settings = self.repo.load()?;
        settings.skipped_version = Some(strip_v(version).to_string());
        self.repo.save(&settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MemRepo(Mutex<UpdateSettings>);

    impl UpdateSettingsRepository for MemRepo {
        fn load(&self) -> DomainResult<UpdateSettings> {
            Ok(self.0.lock().expect("lock").clone())
        }
        fn save(&self, settings: &UpdateSettings) -> DomainResult<()> {
            *self.0.lock().expect("lock") = settings.clone();
            Ok(())
        }
    }

    fn service() -> UpdateService {
        UpdateService::new(Box::new(MemRepo(Mutex::new(UpdateSettings::default()))))
    }

    #[test]
    fn is_newer_table() {
        assert!(is_newer("2.1.4", "2.2.0"));
        assert!(is_newer("2.1.4", "v2.2.0"));
        assert!(!is_newer("2.1.4", "2.1.4"));
        assert!(!is_newer("2.2.0", "2.1.9"));
        assert!(is_newer("2.1.4", "2.1.5-beta.1"));
        assert!(!is_newer("2.1.5", "2.1.5-beta.1"));
        assert!(!is_newer("2.1.4", "garbage"));
        assert!(!is_newer("", "2.0.0"));
    }

    #[test]
    fn should_announce_respects_the_skipped_version() {
        let settings = UpdateSettings {
            auto_check: true,
            skipped_version: Some("2.2.0".into()),
        };
        assert!(!should_announce(&settings, "2.1.4", "2.2.0"));
        assert!(!should_announce(&settings, "2.1.4", "v2.2.0"));
        assert!(should_announce(&settings, "2.1.4", "2.3.0"));
    }

    #[test]
    fn should_announce_ignores_auto_check() {
        let off = UpdateSettings {
            auto_check: false,
            skipped_version: None,
        };
        assert!(should_announce(&off, "2.1.4", "2.2.0"));
        assert!(!should_announce(&off, "2.2.0", "2.2.0"));
    }

    #[test]
    fn release_url_strips_a_leading_v() {
        let url = "https://github.com/Snehal1112/rocket/releases/tag/v2.2.0";
        assert_eq!(release_url("2.2.0"), url);
        assert_eq!(release_url("v2.2.0"), url);
    }

    #[test]
    fn default_checks_automatically_and_skips_nothing() {
        let settings = UpdateSettings::default();
        assert!(settings.auto_check);
        assert_eq!(settings.skipped_version, None);
    }

    #[test]
    fn set_auto_check_is_stored() {
        let svc = service();
        svc.set_auto_check(false).expect("set");
        assert!(!svc.settings().expect("settings").auto_check);
    }

    #[test]
    fn skip_version_is_stored_and_replaced() {
        let svc = service();
        svc.skip_version("2.2.0").expect("skip");
        assert_eq!(
            svc.settings().expect("settings").skipped_version.as_deref(),
            Some("2.2.0")
        );
        svc.skip_version("2.3.0").expect("skip");
        assert_eq!(
            svc.settings().expect("settings").skipped_version.as_deref(),
            Some("2.3.0")
        );
    }
}
