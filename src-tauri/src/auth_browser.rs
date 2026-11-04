//! Tauri side of the OAuth2 authorization code flow. Implements the
//! `rocket_app::AuthCodeBrowser` port: an in-app webview that intercepts the
//! redirect, or the system browser with a localhost callback server from
//! `rocket-infra`. PKCE, the state value, the URL and the token exchange are in
//! `OAuth2Service::authorize_with_code`.

use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use rocket_app::auth_code::check_callback;
use rocket_app::{AuthCodeBrowser, AuthCodeGrant, AuthCodeRequest};
use rocket_infra::LoopbackCallbackServer;
use rocket_shared::error::{DomainError, DomainResult};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// How long the person has to sign in.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(120);

/// Label of the sign-in webview window.
const AUTH_WINDOW: &str = "oauth2-auth";

pub struct TauriAuthBrowser {
    app: AppHandle,
}

impl TauriAuthBrowser {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    /// Opens the system browser and waits for the redirect on a localhost port.
    async fn via_system_browser(&self, request: &AuthCodeRequest) -> DomainResult<AuthCodeGrant> {
        let server = LoopbackCallbackServer::bind().await?;
        let redirect_uri = server.redirect_uri();

        // Send the provider's redirect to our local listener instead of the configured callback.
        let final_auth_url = replace_redirect_uri_in_url(&request.auth_url, &redirect_uri);
        self.app
            .opener()
            .open_url(&final_auth_url, None::<&str>)
            .map_err(|e| DomainError::Internal(format!("Failed to open browser: {e}")))?;

        let state = request.state.clone();
        let pairs = server
            .wait_for_callback(CALLBACK_TIMEOUT, |pairs| {
                check_callback(pairs, &state).is_ok()
            })
            .await?;
        let code = check_callback(&pairs, &request.state)?;
        Ok(AuthCodeGrant { code, redirect_uri })
    }

    /// Opens a webview, intercepts the redirect and returns the authorization code.
    async fn via_webview(&self, request: &AuthCodeRequest) -> DomainResult<String> {
        let app = &self.app;
        let (tx, rx) = tokio::sync::oneshot::channel::<Vec<(String, String)>>();
        let tx = Mutex::new(Some(tx));
        let redirect_prefix = redirect_uri_prefix(&request.callback_url);

        if let Some(existing) = app.get_webview_window(AUTH_WINDOW) {
            let _ = existing.close();
        }

        let parsed_auth_url: url::Url = request.auth_url.parse().map_err(|_| {
            if request.auth_url.contains("{{") {
                DomainError::Internal(
                    "Authorization URL contains an unresolved variable. \
                     Make sure the variable is defined in the active environment."
                        .into(),
                )
            } else {
                DomainError::Internal(format!("Invalid authorization URL: {}", request.auth_url))
            }
        })?;

        let window = tauri::WebviewWindowBuilder::new(
            app,
            AUTH_WINDOW,
            tauri::WebviewUrl::External(blank_url()?),
        )
        .title("Sign In")
        .inner_size(500.0, 700.0)
        .on_navigation(move |url| {
            if url.as_str().starts_with(&redirect_prefix) && has_auth_params(url) {
                let sender = tx.lock().ok().and_then(|mut slot| slot.take());
                if let Some(sender) = sender {
                    let _ = sender.send(query_pairs(url));
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| DomainError::Internal(format!("Failed to open auth window: {e}")))?;

        // Allow self-signed / internal CA certs on Linux when verify_ssl is off.
        // Must happen before navigate() to avoid a TLS rejection race.
        #[cfg(target_os = "linux")]
        if !request.verify_ssl {
            window
                .with_webview(|webview| {
                    use webkit2gtk::{WebViewExt, WebsiteDataManagerExt};
                    let wv = webview.inner();
                    if let Some(dm) = wv.website_data_manager() {
                        dm.set_tls_errors_policy(webkit2gtk::TLSErrorsPolicy::Ignore);
                    }
                })
                .ok();
        }

        window
            .navigate(parsed_auth_url)
            .map_err(|e| DomainError::Internal(format!("Failed to navigate auth window: {e}")))?;

        let result = tokio::time::timeout(CALLBACK_TIMEOUT, rx).await;
        let _ = window.close();

        match result {
            Ok(Ok(pairs)) => check_callback(&pairs, &request.state),
            Ok(Err(_)) => Err(DomainError::Internal(
                "Authorization window was closed before completing sign-in.".into(),
            )),
            Err(_) => Err(DomainError::Internal(
                "Authorization timed out. Please try again.".into(),
            )),
        }
    }

    /// Clears the sign-in webview's cookies and storage so the provider asks for a login.
    #[cfg(target_os = "linux")]
    fn clear_webview_data(&self) {
        // Note: dm.clear() is async (GLib callback-based) — the auth window may open
        // before clearing completes. This is a best-effort UX improvement; the
        // prompt=login param is the primary mechanism.
        if let Some(existing) = self.app.get_webview_window(AUTH_WINDOW) {
            let _ = existing.close();
        }
        let Ok(blank) = blank_url() else {
            return;
        };
        if let Ok(tmp) = tauri::WebviewWindowBuilder::new(
            &self.app,
            "oauth2-auth-clear",
            tauri::WebviewUrl::External(blank),
        )
        .visible(false)
        .build()
        {
            let cleared = tmp.with_webview(|webview| {
                use webkit2gtk::{
                    gio, glib, WebViewExt, WebsiteDataManagerExtManual, WebsiteDataTypes,
                };
                let wv = webview.inner();
                if let Some(dm) = wv.website_data_manager() {
                    dm.clear(
                        WebsiteDataTypes::COOKIES
                            | WebsiteDataTypes::SESSION_STORAGE
                            | WebsiteDataTypes::LOCAL_STORAGE,
                        glib::TimeSpan::from_seconds(0),
                        None::<&gio::Cancellable>,
                        |_| {},
                    );
                }
            });
            let _ = cleared;
            let _ = tmp.close();
        }
    }
}

#[async_trait]
impl AuthCodeBrowser for TauriAuthBrowser {
    async fn authorize(&self, request: AuthCodeRequest) -> DomainResult<AuthCodeGrant> {
        // On macOS and Windows `prompt=login` in the auth params covers a forced re-login.
        #[cfg(target_os = "linux")]
        if request.force_reauth && !request.use_system_browser {
            self.clear_webview_data();
        }

        if request.use_system_browser {
            return self.via_system_browser(&request).await;
        }
        let code = self.via_webview(&request).await?;
        Ok(AuthCodeGrant {
            code,
            redirect_uri: request.callback_url,
        })
    }
}

fn blank_url() -> DomainResult<url::Url> {
    url::Url::parse("about:blank")
        .map_err(|e| DomainError::Internal(format!("Failed to build blank URL: {e}")))
}

/// Strips the fragment from a URL so starts_with matching works.
fn redirect_uri_prefix(redirect_uri: &str) -> String {
    redirect_uri
        .split('#')
        .next()
        .unwrap_or(redirect_uri)
        .to_string()
}

/// Checks that the URL has OAuth2 callback params (code or error).
fn has_auth_params(url: &url::Url) -> bool {
    url.query_pairs().any(|(k, _)| k == "code" || k == "error")
}

/// The query pairs of a callback URL.
fn query_pairs(url: &url::Url) -> Vec<(String, String)> {
    url.query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

/// Replaces the `redirect_uri` query param value in a URL.
fn replace_redirect_uri_in_url(url: &str, new_redirect_uri: &str) -> String {
    match url::Url::parse(url) {
        Ok(mut parsed) => {
            let pairs: Vec<(String, String)> = parsed
                .query_pairs()
                .map(|(k, v)| {
                    if k == "redirect_uri" {
                        (k.into_owned(), new_redirect_uri.to_string())
                    } else {
                        (k.into_owned(), v.into_owned())
                    }
                })
                .collect();
            parsed.query_pairs_mut().clear();
            for (k, v) in &pairs {
                parsed.query_pairs_mut().append_pair(k, v);
            }
            parsed.to_string()
        }
        Err(_) => url.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_redirect_uri_replaces_only_that_param() {
        let out = replace_redirect_uri_in_url(
            "https://auth.example.com/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp%2Fcb&state=s1",
            "http://localhost:5555/callback",
        );
        let parsed = url::Url::parse(&out).expect("valid url");
        let pairs: Vec<(String, String)> = query_pairs(&parsed);
        assert!(pairs.contains(&("client_id".into(), "abc".into())));
        assert!(pairs.contains(&("state".into(), "s1".into())));
        assert!(pairs.contains(&(
            "redirect_uri".into(),
            "http://localhost:5555/callback".into()
        )));
        assert_eq!(pairs.len(), 3);
    }

    #[test]
    fn replace_redirect_uri_leaves_unparsable_url_alone() {
        assert_eq!(
            replace_redirect_uri_in_url("not a url", "http://localhost:1/callback"),
            "not a url"
        );
    }

    #[test]
    fn redirect_uri_prefix_drops_fragment() {
        assert_eq!(
            redirect_uri_prefix("https://app.example.com/cb#frag"),
            "https://app.example.com/cb"
        );
        assert_eq!(
            redirect_uri_prefix("https://app.example.com/cb"),
            "https://app.example.com/cb"
        );
    }

    #[test]
    fn has_auth_params_matches_code_or_error_only() {
        let code = url::Url::parse("https://a.example/cb?code=1&state=s").expect("url");
        let error = url::Url::parse("https://a.example/cb?error=denied").expect("url");
        let other = url::Url::parse("https://a.example/cb?state=s").expect("url");
        assert!(has_auth_params(&code));
        assert!(has_auth_params(&error));
        assert!(!has_auth_params(&other));
    }

    #[test]
    fn query_pairs_decodes_values() {
        let url = url::Url::parse("https://a.example/cb?error_description=User%20said%20no")
            .expect("url");
        assert_eq!(
            query_pairs(&url),
            vec![("error_description".to_string(), "User said no".to_string())]
        );
    }
}
