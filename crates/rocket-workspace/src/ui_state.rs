//! The window layout the app restores at start: active mode, open collection tabs,
//! panel width. It belongs to the person, not to a workspace, so one file serves the
//! whole app.

use rocket_shared::error::DomainResult;

#[derive(Debug, Clone, PartialEq)]
pub struct UiState {
    pub active_mode: String,
    pub workspace_tabs: Option<UiStateWorkspaceTabs>,
    pub layout_direction: Option<String>,
    pub active_collection: Option<String>,
    pub collection_tabs: Vec<UiStateCollectionTab>,
    pub assistant_panel_width: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UiStateWorkspaceTabs {
    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UiStateCollectionTab {
    pub id: String,
    pub title: String,
    pub collection_name: String,
    pub active_section: Option<String>,
}

/// Where the UI state is kept.
pub trait UiStateRepository: Send + Sync {
    /// `None` when nothing has been saved yet. A file that cannot be read or parsed is
    /// an error.
    fn load(&self) -> DomainResult<Option<UiState>>;
    fn save(&self, state: &UiState) -> DomainResult<()>;
}
