//! `ui-state.yml` in the app config folder. The persisted keys are camelCase because
//! files written by earlier versions use them; the domain type has no serde derives.

use std::path::PathBuf;

use rocket_shared::error::{DomainError, DomainResult};
use rocket_workspace::{UiState, UiStateCollectionTab, UiStateRepository, UiStateWorkspaceTabs};
use serde::{Deserialize, Serialize};

use crate::atomic_write::atomic_write;

const FILE_NAME: &str = "ui-state.yml";

pub struct FsUiStateRepo {
    dir: PathBuf,
}

impl FsUiStateRepo {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedUiState {
    active_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_tabs: Option<PersistedWorkspaceTabs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    layout_direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_collection: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    collection_tabs: Vec<PersistedCollectionTab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    assistant_panel_width: Option<f64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedWorkspaceTabs {
    workspace_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedCollectionTab {
    id: String,
    title: String,
    collection_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_section: Option<String>,
}

impl From<PersistedUiState> for UiState {
    fn from(p: PersistedUiState) -> Self {
        Self {
            active_mode: p.active_mode,
            workspace_tabs: p.workspace_tabs.map(|t| UiStateWorkspaceTabs {
                workspace_id: t.workspace_id,
            }),
            layout_direction: p.layout_direction,
            active_collection: p.active_collection,
            collection_tabs: p
                .collection_tabs
                .into_iter()
                .map(|t| UiStateCollectionTab {
                    id: t.id,
                    title: t.title,
                    collection_name: t.collection_name,
                    active_section: t.active_section,
                })
                .collect(),
            assistant_panel_width: p.assistant_panel_width,
        }
    }
}

impl From<&UiState> for PersistedUiState {
    fn from(s: &UiState) -> Self {
        Self {
            active_mode: s.active_mode.clone(),
            workspace_tabs: s.workspace_tabs.as_ref().map(|t| PersistedWorkspaceTabs {
                workspace_id: t.workspace_id.clone(),
            }),
            layout_direction: s.layout_direction.clone(),
            active_collection: s.active_collection.clone(),
            collection_tabs: s
                .collection_tabs
                .iter()
                .map(|t| PersistedCollectionTab {
                    id: t.id.clone(),
                    title: t.title.clone(),
                    collection_name: t.collection_name.clone(),
                    active_section: t.active_section.clone(),
                })
                .collect(),
            assistant_panel_width: s.assistant_panel_width,
        }
    }
}

impl UiStateRepository for FsUiStateRepo {
    fn load(&self) -> DomainResult<Option<UiState>> {
        let path = self.dir.join(FILE_NAME);
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path).map_err(|e| DomainError::Io(e.to_string()))?;
        let persisted: PersistedUiState =
            serde_yaml::from_str(&content).map_err(|e| DomainError::InvalidInput(e.to_string()))?;
        Ok(Some(persisted.into()))
    }

    fn save(&self, state: &UiState) -> DomainResult<()> {
        std::fs::create_dir_all(&self.dir).map_err(|e| DomainError::Io(e.to_string()))?;
        let content = serde_yaml::to_string(&PersistedUiState::from(state))
            .map_err(|e| DomainError::Internal(e.to_string()))?;
        atomic_write(&self.dir.join(FILE_NAME), content.as_bytes())
            .map_err(|e| DomainError::Io(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn full_state() -> UiState {
        UiState {
            active_mode: "collections".into(),
            workspace_tabs: Some(UiStateWorkspaceTabs {
                workspace_id: "ws-1".into(),
            }),
            layout_direction: Some("vertical".into()),
            active_collection: Some("Shop".into()),
            collection_tabs: vec![UiStateCollectionTab {
                id: "tab-1".into(),
                title: "Shop".into(),
                collection_name: "Shop".into(),
                active_section: Some("auth".into()),
            }],
            assistant_panel_width: Some(420.5),
        }
    }

    #[test]
    fn load_missing_file_is_none() {
        let dir = TempDir::new().expect("tempdir");

        assert_eq!(
            FsUiStateRepo::new(dir.path().into()).load().expect("load"),
            None
        );
    }

    #[test]
    fn save_then_load_round_trips_every_field() {
        let dir = TempDir::new().expect("tempdir");
        let repo = FsUiStateRepo::new(dir.path().into());

        repo.save(&full_state()).expect("save");

        assert_eq!(repo.load().expect("load"), Some(full_state()));
    }

    #[test]
    fn loads_a_file_written_by_the_old_command() {
        let dir = TempDir::new().expect("tempdir");
        std::fs::write(
            dir.path().join("ui-state.yml"),
            "activeMode: requests\ncollectionTabs:\n- id: t\n  title: T\n  collectionName: C\n",
        )
        .expect("write");

        let state = FsUiStateRepo::new(dir.path().into())
            .load()
            .expect("load")
            .expect("some");

        assert_eq!(state.active_mode, "requests");
        assert_eq!(state.workspace_tabs, None);
        assert_eq!(state.layout_direction, None);
        assert_eq!(state.collection_tabs.len(), 1);
        assert_eq!(state.collection_tabs[0].collection_name, "C");
        assert_eq!(state.collection_tabs[0].active_section, None);
    }

    #[test]
    fn saved_file_keeps_the_old_key_names() {
        let dir = TempDir::new().expect("tempdir");

        FsUiStateRepo::new(dir.path().into())
            .save(&full_state())
            .expect("save");

        let text = std::fs::read_to_string(dir.path().join("ui-state.yml")).expect("read");
        for key in [
            "activeMode:",
            "workspaceTabs:",
            "workspaceId:",
            "layoutDirection:",
            "activeCollection:",
            "collectionTabs:",
            "collectionName:",
            "activeSection:",
            "assistantPanelWidth:",
        ] {
            assert!(text.contains(key), "missing {key} in {text}");
        }
        assert!(!text.contains("active_mode"), "{text}");
    }

    #[test]
    fn optional_fields_are_left_out_when_empty() {
        let dir = TempDir::new().expect("tempdir");
        let state = UiState {
            active_mode: "requests".into(),
            workspace_tabs: None,
            layout_direction: None,
            active_collection: None,
            collection_tabs: vec![],
            assistant_panel_width: None,
        };

        FsUiStateRepo::new(dir.path().into())
            .save(&state)
            .expect("save");

        let text = std::fs::read_to_string(dir.path().join("ui-state.yml")).expect("read");
        assert_eq!(text.trim(), "activeMode: requests");
    }

    #[test]
    fn save_creates_the_directory() {
        let dir = TempDir::new().expect("tempdir");
        let nested = dir.path().join("a").join("b");

        FsUiStateRepo::new(nested.clone())
            .save(&full_state())
            .expect("save");

        assert!(nested.join("ui-state.yml").exists());
    }

    #[test]
    fn corrupt_file_is_an_error() {
        let dir = TempDir::new().expect("tempdir");
        std::fs::write(dir.path().join("ui-state.yml"), "activeMode: [unclosed").expect("write");

        assert!(FsUiStateRepo::new(dir.path().into()).load().is_err());
    }
}
