//! Port for the watcher that reports changes under a workspace's collections folder.

use std::path::PathBuf;
use std::sync::Arc;

use rocket_shared::events::EventPublisher;

pub trait FileWatcher: Send + Sync {
    /// Starts watching `collections_dir` (created if it is missing) and publishes file
    /// changes through `publisher`. A running watch is replaced. The error text says
    /// why it could not start.
    fn start(
        &self,
        collections_dir: PathBuf,
        publisher: Arc<dyn EventPublisher>,
    ) -> Result<(), String>;

    /// Stops watching. Nothing happens when no watch is running.
    fn stop(&self);
}
