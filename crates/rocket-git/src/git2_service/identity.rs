use git2::Repository;
use rocket_shared::error::{DomainError, DomainResult};

use crate::identity::GitIdentity;

/// Reads `user.name` and `user.email` from the repository config (local, then global,
/// then system). An unset value is an empty string, never an error.
pub(super) fn identity(path: &str) -> DomainResult<GitIdentity> {
    let repo = Repository::open(path).map_err(|e| DomainError::Internal(e.to_string()))?;
    let cfg = repo
        .config()
        .map_err(|e| DomainError::Internal(e.to_string()))?;
    Ok(GitIdentity {
        name: cfg.get_string("user.name").unwrap_or_default(),
        email: cfg.get_string("user.email").unwrap_or_default(),
    })
}

/// Writes `user.name` and `user.email` to the repository-local config only, so the
/// user's global Git config is never changed.
pub(super) fn set_identity(path: &str, name: &str, email: &str) -> DomainResult<()> {
    let repo = Repository::open(path).map_err(|e| DomainError::Internal(e.to_string()))?;
    let cfg = repo
        .config()
        .map_err(|e| DomainError::Internal(e.to_string()))?;
    let mut local = cfg
        .open_level(git2::ConfigLevel::Local)
        .map_err(|e| DomainError::Internal(e.to_string()))?;
    local
        .set_str("user.name", name)
        .map_err(|e| DomainError::Internal(e.to_string()))?;
    local
        .set_str("user.email", email)
        .map_err(|e| DomainError::Internal(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn init_repo(dir: &TempDir) -> String {
        let path = dir.path().to_string_lossy().to_string();
        Repository::init(&path).expect("init");
        path
    }

    #[test]
    fn identity_is_empty_when_unset() {
        let dir = TempDir::new().expect("tempdir");
        let path = init_repo(&dir);

        let found = identity(&path).expect("identity");

        assert_eq!(found.name, "");
        assert_eq!(found.email, "");
    }

    #[test]
    fn set_then_read_round_trips() {
        let dir = TempDir::new().expect("tempdir");
        let path = init_repo(&dir);

        set_identity(&path, "Bob", "bob@example.com").expect("set");

        let found = identity(&path).expect("identity");
        assert_eq!(found.name, "Bob");
        assert_eq!(found.email, "bob@example.com");
    }

    #[test]
    fn set_identity_writes_local_config_only() {
        let dir = TempDir::new().expect("tempdir");
        let path = init_repo(&dir);

        set_identity(&path, "Local", "local@test.com").expect("set");

        let repo = Repository::open(&path).expect("open");
        let cfg = repo.config().expect("config");
        let local = cfg.open_level(git2::ConfigLevel::Local).expect("local");
        assert_eq!(local.get_string("user.name").expect("name"), "Local");
        assert_eq!(
            local.get_string("user.email").expect("email"),
            "local@test.com"
        );
    }

    #[test]
    fn identity_of_a_non_repo_is_an_error() {
        let dir = TempDir::new().expect("tempdir");

        let result = identity(&dir.path().to_string_lossy());

        assert!(matches!(result, Err(DomainError::Internal(_))));
    }
}
