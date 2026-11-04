//! Port and pure helpers for the OAuth2 authorization code flow.
//!
//! `OAuth2Service::authorize_with_code` owns PKCE, the state value, the
//! authorization URL and the token exchange. The part that needs a window or a
//! browser (a Tauri webview, the system browser and its localhost callback
//! server) sits behind `AuthCodeBrowser`, implemented in `src-tauri`.

use async_trait::async_trait;
use rocket_http::{apply_params_to_url, AdditionalParam, PkcePair};
use rocket_shared::error::{DomainError, DomainResult};

/// What the browser side needs to run one authorization.
#[derive(Debug, Clone)]
pub struct AuthCodeRequest {
    /// The full authorization URL, with `state`, PKCE challenge and extra params.
    pub auth_url: String,
    /// The configured redirect URI. Webview mode intercepts it.
    pub callback_url: String,
    /// The `state` value the callback must return.
    pub state: String,
    pub verify_ssl: bool,
    pub use_system_browser: bool,
    pub force_reauth: bool,
}

/// The authorization code and the redirect URI the provider was given.
///
/// System-browser mode binds a localhost port, so its redirect URI differs from the
/// configured one. The token exchange must send the same value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthCodeGrant {
    pub code: String,
    pub redirect_uri: String,
}

/// Opens the authorization URL and returns the code once the user has signed in.
#[async_trait]
pub trait AuthCodeBrowser: Send + Sync {
    async fn authorize(&self, request: AuthCodeRequest) -> DomainResult<AuthCodeGrant>;
}

/// Percent-encodes a string for use as a URL query parameter value.
fn urlencoding_encode(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    result
}

/// Builds the authorization URL. PKCE params are only added when a `PkcePair` is given.
pub fn build_auth_url(
    authorization_url: &str,
    client_id: &str,
    redirect_uri: &str,
    pkce: Option<&PkcePair>,
    state: &str,
    scope: Option<&str>,
    auth_params: &[AdditionalParam],
) -> String {
    let sep = if authorization_url.contains('?') {
        "&"
    } else {
        "?"
    };
    let mut url = format!(
        "{}{sep}response_type=code&client_id={}&redirect_uri={}&state={}",
        authorization_url,
        urlencoding_encode(client_id),
        urlencoding_encode(redirect_uri),
        urlencoding_encode(state),
    );
    if let Some(pkce) = pkce {
        url.push_str(&format!(
            "&code_challenge={}&code_challenge_method=S256",
            urlencoding_encode(&pkce.code_challenge),
        ));
    }
    if let Some(scope) = scope {
        url.push_str(&format!("&scope={}", urlencoding_encode(scope)));
    }
    apply_params_to_url(&url, auth_params)
}

/// Checks the query pairs of the redirect and returns the authorization code.
///
/// Order: a provider `error`, then a `state` mismatch, then a missing `code`.
pub fn check_callback(params: &[(String, String)], expected_state: &str) -> DomainResult<String> {
    let find = |key: &str| {
        params
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    };

    if let Some(error) = find("error") {
        let description = find("error_description").unwrap_or(error);
        return Err(DomainError::Internal(format!(
            "Authorization denied: {description}"
        )));
    }
    if find("state").unwrap_or("") != expected_state {
        return Err(DomainError::Internal(
            "State mismatch — possible CSRF attack.".into(),
        ));
    }
    find("code")
        .map(str::to_owned)
        .ok_or_else(|| DomainError::Internal("No authorization code in callback.".into()))
}

/// Returns the configured state when it is not empty, else a new random one.
pub fn choose_state(configured: Option<&str>) -> String {
    configured
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn message(result: DomainResult<String>) -> String {
        match result {
            Err(e) => e.to_string(),
            Ok(code) => panic!("expected an error, got code {code}"),
        }
    }

    #[test]
    fn check_callback_returns_code() {
        let code = check_callback(&pairs(&[("code", "abc"), ("state", "s1")]), "s1")
            .expect("valid callback");
        assert_eq!(code, "abc");
    }

    #[test]
    fn check_callback_error_param_wins_over_state() {
        let m = message(check_callback(
            &pairs(&[
                ("error", "access_denied"),
                ("error_description", "User said no"),
                ("state", "wrong"),
            ]),
            "s1",
        ));
        assert!(m.contains("Authorization denied: User said no"), "{m}");
    }

    #[test]
    fn check_callback_error_without_description_uses_error() {
        let m = message(check_callback(&pairs(&[("error", "access_denied")]), "s1"));
        assert!(m.contains("Authorization denied: access_denied"), "{m}");
    }

    #[test]
    fn check_callback_rejects_state_mismatch() {
        let m = message(check_callback(
            &pairs(&[("code", "abc"), ("state", "other")]),
            "s1",
        ));
        assert!(m.contains("State mismatch"), "{m}");
    }

    #[test]
    fn check_callback_rejects_missing_state() {
        let m = message(check_callback(&pairs(&[("code", "abc")]), "s1"));
        assert!(m.contains("State mismatch"), "{m}");
    }

    #[test]
    fn check_callback_rejects_missing_code() {
        let m = message(check_callback(&pairs(&[("state", "s1")]), "s1"));
        assert!(m.contains("No authorization code in callback."), "{m}");
    }

    #[test]
    fn build_auth_url_adds_pkce_and_scope() {
        let pkce = PkcePair {
            code_verifier: "ver".into(),
            code_challenge: "chal".into(),
        };
        let url = build_auth_url(
            "https://auth.example.com/authorize",
            "my client",
            "http://localhost:1/callback",
            Some(&pkce),
            "st",
            Some("openid email"),
            &[],
        );
        assert_eq!(
            url,
            "https://auth.example.com/authorize?response_type=code&client_id=my%20client\
             &redirect_uri=http%3A%2F%2Flocalhost%3A1%2Fcallback&state=st\
             &code_challenge=chal&code_challenge_method=S256&scope=openid%20email"
        );
    }

    #[test]
    fn build_auth_url_omits_pkce_and_scope_when_absent() {
        let url = build_auth_url(
            "https://a.example/authorize",
            "id",
            "cb",
            None,
            "st",
            None,
            &[],
        );
        assert!(!url.contains("code_challenge"), "{url}");
        assert!(!url.contains("scope="), "{url}");
    }

    #[test]
    fn build_auth_url_uses_ampersand_when_url_has_query() {
        let url = build_auth_url(
            "https://a.example/authorize?x=1",
            "id",
            "cb",
            None,
            "st",
            None,
            &[],
        );
        assert!(
            url.starts_with("https://a.example/authorize?x=1&response_type=code"),
            "{url}"
        );
    }

    #[test]
    fn build_auth_url_applies_auth_params() {
        let params = vec![
            AdditionalParam {
                key: "prompt".into(),
                value: "login".into(),
                send_in: "queryparams".into(),
                enabled: true,
            },
            AdditionalParam {
                key: "skipped".into(),
                value: "x".into(),
                send_in: "queryparams".into(),
                enabled: false,
            },
        ];
        let url = build_auth_url(
            "https://a.example/authorize",
            "id",
            "cb",
            None,
            "st",
            None,
            &params,
        );
        assert!(url.ends_with("&prompt=login"), "{url}");
        assert!(!url.contains("skipped"), "{url}");
    }

    #[test]
    fn choose_state_keeps_configured_value() {
        assert_eq!(choose_state(Some("fixed")), "fixed");
    }

    #[test]
    fn choose_state_generates_when_missing_or_empty() {
        for configured in [None, Some("")] {
            let state = choose_state(configured);
            assert!(uuid::Uuid::parse_str(&state).is_ok(), "{state}");
        }
        assert_ne!(choose_state(None), choose_state(None));
    }
}
