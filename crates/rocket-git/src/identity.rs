use serde::{Deserialize, Serialize};

/// The author name and email Git uses for commits in a repository.
/// Empty strings mean the value is not set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
}
