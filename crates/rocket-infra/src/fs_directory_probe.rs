//! Filesystem implementation of the folder queries used to find collections.

use std::path::Path;

use rocket_collection::discovery::{DirChild, DirectoryProbe};
use rocket_shared::error::{DomainError, DomainResult};

pub struct FsDirectoryProbe;

impl DirectoryProbe for FsDirectoryProbe {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn has_file(&self, dir: &Path, file_name: &str) -> bool {
        dir.join(file_name).exists()
    }

    fn child_dirs(&self, dir: &Path) -> DomainResult<Vec<DirChild>> {
        let entries = std::fs::read_dir(dir).map_err(|e| DomainError::Internal(e.to_string()))?;
        let mut children = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| DomainError::Internal(e.to_string()))?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            children.push(DirChild {
                name: entry.file_name().to_string_lossy().to_string(),
                path,
            });
        }
        Ok(children)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn is_dir_and_has_file() {
        let tmp = TempDir::new().expect("tempdir");
        std::fs::write(tmp.path().join("workspace.yml"), "name: x\n").expect("write");

        assert!(FsDirectoryProbe.is_dir(tmp.path()));
        assert!(!FsDirectoryProbe.is_dir(&tmp.path().join("workspace.yml")));
        assert!(FsDirectoryProbe.has_file(tmp.path(), "workspace.yml"));
        assert!(!FsDirectoryProbe.has_file(tmp.path(), "opencollection.yml"));
    }

    #[test]
    fn child_dirs_lists_only_directories() {
        let tmp = TempDir::new().expect("tempdir");
        std::fs::create_dir(tmp.path().join("one")).expect("mkdir");
        std::fs::create_dir(tmp.path().join(".git")).expect("mkdir");
        std::fs::write(tmp.path().join("file.txt"), "x").expect("write");

        let mut names: Vec<String> = FsDirectoryProbe
            .child_dirs(tmp.path())
            .expect("children")
            .into_iter()
            .map(|c| c.name)
            .collect();
        names.sort();

        assert_eq!(names, vec![".git".to_string(), "one".to_string()]);
    }

    #[test]
    fn child_dirs_of_a_missing_directory_is_an_error() {
        let tmp = TempDir::new().expect("tempdir");

        let result = FsDirectoryProbe.child_dirs(&tmp.path().join("missing"));

        assert!(matches!(result, Err(DomainError::Internal(_))));
    }
}
