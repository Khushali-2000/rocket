use std::sync::Arc;

use rocket_shared::error::{DomainError, DomainResult};
use rocket_workspace::{
    UiState as DomainUiState, UiStateCollectionTab as DomainCollectionTab, UiStateRepository,
    UiStateWorkspaceTabs as DomainWorkspaceTabs,
};
use tauri::State;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiState {
    pub active_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_tabs: Option<UiStateWorkspaceTabs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout_direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_collection: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collection_tabs: Vec<UiStateCollectionTab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assistant_panel_width: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiStateWorkspaceTabs {
    pub workspace_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiStateCollectionTab {
    pub id: String,
    pub title: String,
    pub collection_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_section: Option<String>,
}

impl From<DomainUiState> for UiState {
    fn from(s: DomainUiState) -> Self {
        Self {
            active_mode: s.active_mode,
            workspace_tabs: s.workspace_tabs.map(|t| UiStateWorkspaceTabs {
                workspace_id: t.workspace_id,
            }),
            layout_direction: s.layout_direction,
            active_collection: s.active_collection,
            collection_tabs: s
                .collection_tabs
                .into_iter()
                .map(|t| UiStateCollectionTab {
                    id: t.id,
                    title: t.title,
                    collection_name: t.collection_name,
                    active_section: t.active_section,
                })
                .collect(),
            assistant_panel_width: s.assistant_panel_width,
        }
    }
}

impl From<UiState> for DomainUiState {
    fn from(s: UiState) -> Self {
        Self {
            active_mode: s.active_mode,
            workspace_tabs: s.workspace_tabs.map(|t| DomainWorkspaceTabs {
                workspace_id: t.workspace_id,
            }),
            layout_direction: s.layout_direction,
            active_collection: s.active_collection,
            collection_tabs: s
                .collection_tabs
                .into_iter()
                .map(|t| DomainCollectionTab {
                    id: t.id,
                    title: t.title,
                    collection_name: t.collection_name,
                    active_section: t.active_section,
                })
                .collect(),
            assistant_panel_width: s.assistant_panel_width,
        }
    }
}

/// Stands in when the app config folder is unknown, so each call reports why it cannot work.
pub(crate) struct UnavailableUiState(pub String);

impl UiStateRepository for UnavailableUiState {
    fn load(&self) -> DomainResult<Option<DomainUiState>> {
        Err(DomainError::Internal(self.0.clone()))
    }

    fn save(&self, _state: &DomainUiState) -> DomainResult<()> {
        Err(DomainError::Internal(self.0.clone()))
    }
}

#[tauri::command]
pub fn load_ui_state(
    repo: State<'_, Arc<dyn UiStateRepository>>,
) -> Result<Option<UiState>, String> {
    repo.load()
        .map(|state| state.map(UiState::from))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_ui_state(
    repo: State<'_, Arc<dyn UiStateRepository>>,
    state: UiState,
) -> Result<(), String> {
    repo.save(&state.into()).map_err(|e| e.to_string())
}
