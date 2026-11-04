use std::path::Path;

/// Default key names, in the order Git tools try them.
const STANDARD: &[&str] = &["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"];

/// Files in `~/.ssh/` that are never private keys.
const SKIP: &[&str] = &[
    "known_hosts",
    "known_hosts.old",
    "authorized_keys",
    "config",
    "environment",
    "rc",
];

/// The first default private key in `ssh_dir`, checking `STANDARD` in order.
pub(super) fn default_key_in(ssh_dir: &Path) -> Option<String> {
    for name in STANDARD {
        let path = ssh_dir.join(name);
        if path.exists() {
            return path.to_str().map(str::to_owned);
        }
    }
    None
}

/// All private key paths in `ssh_dir`: standard names first in `STANDARD` order, then
/// custom names alphabetically. A file counts as a key only when a `.pub` file with the
/// same name sits next to it. A missing directory gives an empty list.
pub(super) fn key_paths_in(ssh_dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(ssh_dir) else {
        return Vec::new();
    };

    let mut standard: Vec<String> = Vec::new();
    let mut custom: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        if name.ends_with(".pub") || name.starts_with('.') || SKIP.contains(&name.as_str()) {
            continue;
        }
        if !ssh_dir.join(format!("{name}.pub")).exists() {
            continue;
        }
        let Some(path_str) = path.to_str().map(String::from) else {
            continue;
        };
        if STANDARD.contains(&name.as_str()) {
            standard.push(path_str);
        } else {
            custom.push(path_str);
        }
    }

    standard.sort_by_key(|p| {
        let name = Path::new(p)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        STANDARD
            .iter()
            .position(|&s| s == name)
            .unwrap_or(usize::MAX)
    });
    custom.sort();
    standard.extend(custom);
    standard
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn key(dir: &TempDir, name: &str) {
        std::fs::write(dir.path().join(name), "private").expect("write key");
        std::fs::write(dir.path().join(format!("{name}.pub")), "public").expect("write pub");
    }

    fn file_names(paths: &[String]) -> Vec<String> {
        paths
            .iter()
            .filter_map(|p| Path::new(p).file_name())
            .map(|n| n.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn standard_names_come_first_in_preferred_order() {
        let dir = TempDir::new().expect("tempdir");
        key(&dir, "id_rsa");
        key(&dir, "id_ed25519");
        key(&dir, "id_dsa");

        let found = key_paths_in(dir.path());

        assert_eq!(file_names(&found), vec!["id_ed25519", "id_rsa", "id_dsa"]);
    }

    #[test]
    fn custom_keys_sorted_after_standard() {
        let dir = TempDir::new().expect("tempdir");
        key(&dir, "work_key");
        key(&dir, "id_rsa");
        key(&dir, "alpha_key");

        let found = key_paths_in(dir.path());

        assert_eq!(file_names(&found), vec!["id_rsa", "alpha_key", "work_key"]);
    }

    #[test]
    fn key_needs_a_pub_file() {
        let dir = TempDir::new().expect("tempdir");
        std::fs::write(dir.path().join("lonely"), "private").expect("write");

        assert!(key_paths_in(dir.path()).is_empty());
    }

    #[test]
    fn skips_known_hosts_config_dot_files_and_pub_files() {
        let dir = TempDir::new().expect("tempdir");
        for name in ["known_hosts", "config", "authorized_keys", ".hidden"] {
            key(&dir, name);
        }
        key(&dir, "real_key");

        let found = key_paths_in(dir.path());

        assert_eq!(file_names(&found), vec!["real_key"]);
    }

    #[test]
    fn missing_directory_is_empty() {
        let dir = TempDir::new().expect("tempdir");

        assert!(key_paths_in(&dir.path().join("nope")).is_empty());
    }

    #[test]
    fn default_key_prefers_ed25519_then_rsa() {
        let dir = TempDir::new().expect("tempdir");
        key(&dir, "id_rsa");
        let only_rsa = default_key_in(dir.path()).expect("rsa");
        assert!(only_rsa.ends_with("id_rsa"));

        key(&dir, "id_ed25519");
        let both = default_key_in(dir.path()).expect("ed25519");
        assert!(both.ends_with("id_ed25519"));
    }

    #[test]
    fn default_key_none_when_no_standard_key() {
        let dir = TempDir::new().expect("tempdir");
        key(&dir, "custom");

        assert_eq!(default_key_in(dir.path()), None);
    }
}
