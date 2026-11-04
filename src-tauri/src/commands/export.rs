use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine};
use rocket_app::collection_export_service::{
    CollectionExportService, ExportOutput, PostmanExportOptions,
};
use rocket_export::ExportReport;
use rocket_shared::error::DomainError;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResultDto {
    pub data_base64: String,
    pub file_name: String,
    pub report: ExportReport,
}

/// Runs a blocking export on a worker thread, so reading a large collection never
/// stalls the async runtime, and maps the output to the IPC result.
async fn run_export<F>(job: F) -> Result<ExportResultDto, DomainError>
where
    F: FnOnce() -> Result<ExportOutput, DomainError> + Send + 'static,
{
    let out = tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| DomainError::Internal(format!("export task failed: {e}")))??;
    Ok(ExportResultDto {
        data_base64: STANDARD.encode(&out.bytes),
        file_name: out.file_name,
        report: out.report,
    })
}

/// Export a collection as a Bruno ZIP. Returns the bytes as base64.
#[tauri::command]
pub async fn export_collection_bruno(
    collection: String,
    include_environments: bool,
    service: State<'_, Arc<CollectionExportService>>,
) -> Result<ExportResultDto, DomainError> {
    let service = Arc::clone(&*service);
    run_export(move || service.export_bruno(&collection, include_environments)).await
}

/// Choices of a Postman export, as the dialog sends them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostmanExportOptionsDto {
    pub preserve_scripts: bool,
    pub include_environments: bool,
}

impl From<PostmanExportOptionsDto> for PostmanExportOptions {
    fn from(dto: PostmanExportOptionsDto) -> Self {
        Self {
            preserve_scripts: dto.preserve_scripts,
            include_environments: dto.include_environments,
        }
    }
}

/// Export a collection as a Postman Collection v2.1 file, or as a ZIP with its
/// environments. Returns the bytes as base64.
#[tauri::command]
pub async fn export_collection_postman(
    collection: String,
    options: PostmanExportOptionsDto,
    service: State<'_, Arc<CollectionExportService>>,
) -> Result<ExportResultDto, DomainError> {
    let service = Arc::clone(&*service);
    let options = PostmanExportOptions::from(options);
    run_export(move || service.export_postman(&collection, &options)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_dto_reads_camel_case_keys() {
        let dto: PostmanExportOptionsDto =
            serde_json::from_str(r#"{"preserveScripts":true,"includeEnvironments":false}"#)
                .expect("camelCase keys parse");
        assert!(dto.preserve_scripts);
        assert!(!dto.include_environments);
    }

    #[test]
    fn options_dto_maps_to_service_options() {
        let dto = PostmanExportOptionsDto {
            preserve_scripts: true,
            include_environments: true,
        };
        let opts = PostmanExportOptions::from(dto);
        assert!(opts.preserve_scripts);
        assert!(opts.include_environments);
    }
}
