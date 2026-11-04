//! Finds collections and workspaces inside a folder, for the "open a folder" and
//! "after a git clone" flows. The rules live here; the folder reads sit behind
//! `DirectoryProbe` so they can be tested without a disk.

use std::path::{Path, PathBuf};

use rocket_shared::error::DomainResult;

/// The file that marks a folder as a collection.
const COLLECTION_FILE: &str = "opencollection.yml";
/// The file that marks a folder as a workspace.
const WORKSPACE_FILE: &str = "workspace.yml";

/// A direct subfolder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirChild {
    pub name: String,
    pub path: PathBuf,
}

/// Read-only folder queries.
pub trait DirectoryProbe: Send + Sync {
    fn is_dir(&self, path: &Path) -> bool;
    /// Whether `dir` holds a file named `file_name`.
    fn has_file(&self, dir: &Path, file_name: &str) -> bool;
    /// The direct subfolders of `dir`. An unreadable folder is an error.
    fn child_dirs(&self, dir: &Path) -> DomainResult<Vec<DirChild>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundCollection {
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClonedKind {
    Workspace,
    Collection,
    MultiCollection,
    Unknown,
}

impl ClonedKind {
    /// The name the frontend expects.
    pub fn as_str(&self) -> &'static str {
        match self {
            ClonedKind::Workspace => "workspace",
            ClonedKind::Collection => "collection",
            ClonedKind::MultiCollection => "multi_collection",
            ClonedKind::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClonedStructure {
    pub kind: ClonedKind,
    /// The folder to open as a workspace, for `Workspace`.
    pub workspace_path: Option<PathBuf>,
    pub collections: Vec<FoundCollection>,
}

pub struct CollectionDiscovery {
    probe: Box<dyn DirectoryProbe>,
}

impl CollectionDiscovery {
    pub fn new(probe: Box<dyn DirectoryProbe>) -> Self {
        Self { probe }
    }

    /// Direct subfolders of `dir` that hold `opencollection.yml`, sorted by lowercase
    /// name. Dot folders are skipped. A path that is not a folder gives an empty list.
    pub fn scan(&self, dir: &Path) -> DomainResult<Vec<FoundCollection>> {
        if !self.probe.is_dir(dir) {
            return Ok(vec![]);
        }
        let mut found: Vec<FoundCollection> = self
            .probe
            .child_dirs(dir)?
            .into_iter()
            .filter(|child| !child.name.starts_with('.'))
            .filter(|child| self.probe.has_file(&child.path, COLLECTION_FILE))
            .map(|child| FoundCollection {
                name: child.name,
                path: child.path,
            })
            .collect();
        found.sort_by_key(|c| c.name.to_lowercase());
        Ok(found)
    }

    /// Works out what a cloned folder holds. Order: `workspace.yml`, then
    /// `opencollection.yml` at the root, then a `collections/` folder, then direct
    /// children.
    pub fn detect(&self, dir: &Path) -> DomainResult<ClonedStructure> {
        let unknown = ClonedStructure {
            kind: ClonedKind::Unknown,
            workspace_path: None,
            collections: vec![],
        };
        if !self.probe.is_dir(dir) {
            return Ok(unknown);
        }

        // A workspace root, with the collections inside it.
        if self.probe.has_file(dir, WORKSPACE_FILE) {
            return Ok(ClonedStructure {
                kind: ClonedKind::Workspace,
                workspace_path: Some(dir.to_path_buf()),
                collections: self.scan(dir)?,
            });
        }

        // A single collection at the root.
        if self.probe.has_file(dir, COLLECTION_FILE) {
            let name = dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "collection".into());
            return Ok(ClonedStructure {
                kind: ClonedKind::Collection,
                workspace_path: None,
                collections: vec![FoundCollection {
                    name,
                    path: dir.to_path_buf(),
                }],
            });
        }

        // A `collections/` folder, then the direct children.
        let inside = self.scan(&dir.join("collections"))?;
        let collections = if inside.is_empty() {
            self.scan(dir)?
        } else {
            inside
        };
        if collections.is_empty() {
            return Ok(unknown);
        }
        Ok(ClonedStructure {
            kind: ClonedKind::MultiCollection,
            workspace_path: None,
            collections,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rocket_shared::error::DomainError;
    use std::collections::BTreeSet;

    /// An in-memory folder tree.
    #[derive(Default)]
    struct FakeProbe {
        dirs: BTreeSet<PathBuf>,
        files: BTreeSet<PathBuf>,
        unreadable: Option<PathBuf>,
    }

    impl FakeProbe {
        fn dir(mut self, path: &str) -> Self {
            self.dirs.insert(PathBuf::from(path));
            self
        }
        fn file(mut self, path: &str) -> Self {
            self.files.insert(PathBuf::from(path));
            self
        }
        fn collection(self, dir: &str) -> Self {
            self.dir(dir).file(&format!("{dir}/opencollection.yml"))
        }
        fn unreadable(mut self, path: &str) -> Self {
            self.unreadable = Some(PathBuf::from(path));
            self
        }
        fn service(self) -> CollectionDiscovery {
            CollectionDiscovery::new(Box::new(self))
        }
    }

    impl DirectoryProbe for FakeProbe {
        fn is_dir(&self, path: &Path) -> bool {
            self.dirs.contains(path)
        }
        fn has_file(&self, dir: &Path, file_name: &str) -> bool {
            self.files.contains(&dir.join(file_name))
        }
        fn child_dirs(&self, dir: &Path) -> DomainResult<Vec<DirChild>> {
            if self.unreadable.as_deref() == Some(dir) {
                return Err(DomainError::Internal("permission denied".into()));
            }
            Ok(self
                .dirs
                .iter()
                .filter(|d| d.parent() == Some(dir))
                .filter_map(|d| {
                    Some(DirChild {
                        name: d.file_name()?.to_string_lossy().to_string(),
                        path: d.clone(),
                    })
                })
                .collect())
        }
    }

    fn names(found: &[FoundCollection]) -> Vec<&str> {
        found.iter().map(|c| c.name.as_str()).collect()
    }

    #[test]
    fn scan_returns_only_dirs_with_opencollection_yml_sorted_case_insensitively() {
        let svc = FakeProbe::default()
            .dir("/r")
            .collection("/r/beta")
            .collection("/r/Alpha")
            .dir("/r/empty")
            .file("/r/notes.txt")
            .service();

        let found = svc.scan(Path::new("/r")).expect("scan");

        assert_eq!(names(&found), vec!["Alpha", "beta"]);
        assert_eq!(found[0].path, PathBuf::from("/r/Alpha"));
    }

    #[test]
    fn scan_skips_dot_folders() {
        let svc = FakeProbe::default()
            .dir("/r")
            .collection("/r/.hidden")
            .collection("/r/shown")
            .service();

        assert_eq!(
            names(&svc.scan(Path::new("/r")).expect("scan")),
            vec!["shown"]
        );
    }

    #[test]
    fn scan_of_a_missing_directory_is_empty() {
        let svc = FakeProbe::default().service();

        assert!(svc.scan(Path::new("/nope")).expect("scan").is_empty());
    }

    #[test]
    fn detect_workspace_when_workspace_yml_exists() {
        let svc = FakeProbe::default()
            .dir("/w")
            .file("/w/workspace.yml")
            .collection("/w/api")
            .service();

        let found = svc.detect(Path::new("/w")).expect("detect");

        assert_eq!(found.kind, ClonedKind::Workspace);
        assert_eq!(found.workspace_path, Some(PathBuf::from("/w")));
        assert_eq!(names(&found.collections), vec!["api"]);
    }

    #[test]
    fn detect_prefers_workspace_over_collection_at_the_same_root() {
        let svc = FakeProbe::default()
            .dir("/w")
            .file("/w/workspace.yml")
            .file("/w/opencollection.yml")
            .service();

        assert_eq!(
            svc.detect(Path::new("/w")).expect("detect").kind,
            ClonedKind::Workspace
        );
    }

    #[test]
    fn detect_single_collection_at_root() {
        let svc = FakeProbe::default().collection("/clones/shop").service();

        let found = svc.detect(Path::new("/clones/shop")).expect("detect");

        assert_eq!(found.kind, ClonedKind::Collection);
        assert_eq!(found.workspace_path, None);
        assert_eq!(names(&found.collections), vec!["shop"]);
        assert_eq!(found.collections[0].path, PathBuf::from("/clones/shop"));
    }

    #[test]
    fn detect_collections_subdirectory() {
        let svc = FakeProbe::default()
            .dir("/c")
            .dir("/c/collections")
            .collection("/c/collections/one")
            .collection("/c/two")
            .service();

        let found = svc.detect(Path::new("/c")).expect("detect");

        assert_eq!(found.kind, ClonedKind::MultiCollection);
        assert_eq!(names(&found.collections), vec!["one"]);
    }

    #[test]
    fn detect_falls_back_to_direct_children_when_collections_folder_is_empty() {
        let svc = FakeProbe::default()
            .dir("/c")
            .dir("/c/collections")
            .collection("/c/two")
            .service();

        let found = svc.detect(Path::new("/c")).expect("detect");

        assert_eq!(found.kind, ClonedKind::MultiCollection);
        assert_eq!(names(&found.collections), vec!["two"]);
    }

    #[test]
    fn detect_unknown_for_an_empty_directory() {
        let svc = FakeProbe::default().dir("/e").service();

        let found = svc.detect(Path::new("/e")).expect("detect");

        assert_eq!(found.kind, ClonedKind::Unknown);
        assert!(found.collections.is_empty());
        assert_eq!(found.workspace_path, None);
    }

    #[test]
    fn detect_unknown_for_a_missing_directory() {
        let svc = FakeProbe::default().service();

        assert_eq!(
            svc.detect(Path::new("/nope")).expect("detect").kind,
            ClonedKind::Unknown
        );
    }

    #[test]
    fn read_error_is_an_error_not_empty() {
        let svc = FakeProbe::default().dir("/c").unreadable("/c").service();

        assert!(svc.detect(Path::new("/c")).is_err());
        assert!(svc.scan(Path::new("/c")).is_err());
    }

    #[test]
    fn kind_names_match_what_the_frontend_expects() {
        assert_eq!(ClonedKind::Workspace.as_str(), "workspace");
        assert_eq!(ClonedKind::Collection.as_str(), "collection");
        assert_eq!(ClonedKind::MultiCollection.as_str(), "multi_collection");
        assert_eq!(ClonedKind::Unknown.as_str(), "unknown");
    }
}
