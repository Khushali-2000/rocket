use rocket_app::oauth2_service::{OAuth2GetTokenRequest, OAuth2RefreshRequest, OAuth2Service};
use rocket_app::RequestExecutionService;
use rocket_http::{decode_jwt, JwtClaims, OAuthToken};
use rocket_shared::error::DomainError;
use tauri::{AppHandle, State};

use crate::auth_browser::TauriAuthBrowser;

/// Decodes a JWT token without signature verification.
/// Used for displaying ID token metadata in the UI.
#[tauri::command]
pub fn oauth2_decode_jwt(token: String) -> Result<JwtClaims, DomainError> {
    decode_jwt(&token)
}

/// Refreshes an OAuth2 token using a refresh token.
#[tauri::command]
pub async fn oauth2_refresh_token(
    svc: State<'_, OAuth2Service>,
    exec: State<'_, RequestExecutionService>,
    request: OAuth2RefreshRequest,
) -> Result<OAuthToken, DomainError> {
    // RocketVault values for the environment's bindings, so `{{alias.secretName}}` resolves.
    // An environment without bindings needs no vault access.
    let secrets = exec
        .resolve_external_secrets(
            request.collection.as_deref(),
            request.environment_name.as_deref(),
        )
        .await?;
    // The trust store and `.env` files are read from disk, so keep it off the async workers.
    let host_env = tokio::task::block_in_place(|| {
        exec.process_env_for_scope(
            request.collection.as_deref(),
            request.environment_name.as_deref(),
            None,
            &request.process_env,
        )
    });
    let allow_vault_certificates = tokio::task::block_in_place(|| {
        exec.vault_certificates_allowed(request.collection.as_deref())
    });
    svc.refresh_token_with_host_env(&request, &secrets, &host_env, allow_vault_certificates)
        .await
}

/// Unified OAuth2 token acquisition for all grant types.
///
/// - client_credentials / password: delegates directly to OAuth2Service.
/// - authorization_code: opens webview or system browser, gets code, exchanges via service.
/// - implicit: unsupported by design (removed in OAuth 2.1); use authorization code with PKCE.
#[tauri::command]
pub async fn oauth2_get_token(
    app: AppHandle,
    svc: State<'_, OAuth2Service>,
    exec: State<'_, RequestExecutionService>,
    mut request: OAuth2GetTokenRequest,
) -> Result<OAuthToken, DomainError> {
    // Apply the OS-specific default only when the user has not explicitly chosen.
    // On macOS/Windows the embedded WKWebView/WebView2 has Tauri IPC scripts
    // injected that can break OIDC providers (e.g. Keycloak nonce handling),
    // so we default to the system browser on those platforms.
    // An explicit `false` from the UI always wins and opens the in-app webview.
    if request.use_system_browser.is_none() {
        request.use_system_browser = Some(cfg!(any(target_os = "macos", target_os = "windows")));
    }
    // RocketVault values for the environment's bindings, so `{{alias.secretName}}` resolves.
    // An environment without bindings needs no vault access.
    let secrets = exec
        .resolve_external_secrets(
            request.collection.as_deref(),
            request.environment_name.as_deref(),
        )
        .await?;
    // The trust store and `.env` files are read from disk, so keep it off the async workers.
    let host_env = tokio::task::block_in_place(|| {
        exec.process_env_for_scope(
            request.collection.as_deref(),
            request.environment_name.as_deref(),
            None,
            &request.process_env,
        )
    });
    let mut config = svc.resolve_get_token_request_with_host_env(&request, &secrets, &host_env);
    config.allow_vault_certificates = tokio::task::block_in_place(|| {
        exec.vault_certificates_allowed(request.collection.as_deref())
    });

    match config.grant_type.as_str() {
        "client_credentials" | "password" => svc.get_token_with_host_env(&config, &host_env).await,
        "authorization_code" => {
            svc.authorize_with_code(&config, &TauriAuthBrowser::new(app), &host_env)
                .await
        }
        "implicit" => Err(DomainError::InvalidInput(
            "Implicit grant flow is not yet implemented. Use Authorization Code with PKCE instead."
                .into(),
        )),
        other => Err(DomainError::InvalidInput(format!(
            "Unsupported grant type: {other}"
        ))),
    }
}
