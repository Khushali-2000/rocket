//! The request as sent, for the frontend Console row.

use crate::execution_service::map_auth_fields;
use crate::redaction::{
    json_escaped_form, redact_secrets, redact_url_secrets, secret_forms, MIN_REDACTION_LEN,
};
use rocket_http::HttpRequest;
use rocket_shared::types::{Auth, Body, Header, QueryParam};
use serde::Serialize;
use std::collections::HashSet;

/// The request a send used, as the frontend Console shows it.
///
/// RocketVault values are masked. Other values are kept as they were sent.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentRequest {
    pub url: String,
    pub headers: Vec<Header>,
    pub query_params: Vec<QueryParam>,
    pub body: Option<Body>,
    pub auth: Auth,
    /// Non-vault secret values that occur in this copy, sorted. The frontend masks them in the
    /// Console row, so a secret a script wrote is masked too.
    pub secret_values: Vec<String>,
}

impl std::fmt::Debug for SentRequest {
    // Counts only, so a debug print never shows a secret.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SentRequest")
            .field("headers", &self.headers.len())
            .field("query_params", &self.query_params.len())
            .field("secret_values", &self.secret_values.len())
            .finish_non_exhaustive()
    }
}

/// Copies `request` into a `SentRequest` with every vault value masked.
///
/// Header, query and form-data keys are masked too, because the backend fills placeholders in
/// them. The body mode and file paths are copied as they are. Vault values shorter than
/// `MIN_REDACTION_LEN` are not masked, like in every other redaction path.
///
/// `secret_values` are the run's secret values. Those that are long enough, are not a vault form
/// and occur in the masked copy are listed in `SentRequest::secret_values`.
pub(crate) fn sent_request_masked(
    request: &HttpRequest,
    vault_values: &HashSet<String>,
    secret_values: &HashSet<String>,
) -> SentRequest {
    let mut sent = SentRequest {
        url: request.url.clone(),
        headers: request.headers.clone(),
        query_params: request.query_params.clone(),
        body: request.body.clone(),
        auth: request.auth.clone(),
        secret_values: Vec::new(),
    };
    if vault_values.is_empty() {
        sent.secret_values = held_secret_values(&sent, secret_values, &HashSet::new());
        return sent;
    }
    // The forms include the percent-encoded whole value, like the vault write guard.
    let mut forms: HashSet<String> = secret_forms(vault_values).into_iter().collect();
    // A JSON body can carry a value in its escaped form.
    for v in vault_values.iter().filter(|v| v.len() >= MIN_REDACTION_LEN) {
        if let Some(escaped) = json_escaped_form(v) {
            forms.insert(escaped);
        }
    }
    let mask = |text: &str| redact_secrets(text, &forms);
    sent.url = redact_url_secrets(&sent.url, &forms);
    for h in sent.headers.iter_mut().chain(sent.query_params.iter_mut()) {
        h.key = mask(&h.key);
        h.value = mask(&h.value);
    }
    if let Some(body) = sent.body.as_mut() {
        body.content = body.content.take().map(|c| mask(&c));
        if let Some(entries) = body.form_data.as_mut() {
            for entry in entries {
                entry.key = mask(&entry.key);
                entry.value = mask(&entry.value);
            }
        }
    }
    sent.auth = map_auth_fields(sent.auth, |s| mask(&s));
    sent.secret_values = held_secret_values(&sent, secret_values, &forms);
    sent
}

/// The `secret_values` that occur in the (already masked) copy, sorted and without duplicates.
///
/// Short values and values equal to a vault mask form are left out.
fn held_secret_values(
    sent: &SentRequest,
    secret_values: &HashSet<String>,
    vault_forms: &HashSet<String>,
) -> Vec<String> {
    let mut text = String::new();
    let mut add = |s: &str| {
        text.push_str(s);
        text.push('\n');
    };
    add(&sent.url);
    for h in sent.headers.iter().chain(sent.query_params.iter()) {
        add(&h.key);
        add(&h.value);
    }
    if let Some(body) = &sent.body {
        if let Some(content) = &body.content {
            add(content);
        }
        for entry in body.form_data.iter().flatten() {
            add(&entry.key);
            add(&entry.value);
        }
    }
    // The closure writes through a `RefCell`, so it fits the `Fn` bound of `map_auth_fields`.
    let auth_text = std::cell::RefCell::new(String::new());
    map_auth_fields(sent.auth.clone(), |s| {
        auth_text.borrow_mut().push_str(&s);
        auth_text.borrow_mut().push('\n');
        s
    });
    text.push_str(&auth_text.borrow());
    let mut held: Vec<String> = secret_values
        .iter()
        .filter(|v| {
            v.len() >= MIN_REDACTION_LEN
                && !vault_forms.iter().any(|f| v.contains(f.as_str()))
                && text.contains(v.as_str())
        })
        .cloned()
        .collect();
    held.sort();
    held
}

#[cfg(test)]
mod tests {
    use super::*;
    use rocket_shared::types::{BodyMode, FormDataEntry, FormDataType, HttpMethod};

    const VAULT: &str = "vault-secret-123";

    fn vault() -> HashSet<String> {
        HashSet::from([VAULT.to_string()])
    }

    fn request() -> HttpRequest {
        let mut req = HttpRequest::new(HttpMethod::Post, "https://api.test/v1?k=vault-secret-123");
        req.headers = vec![
            Header::new("Authorization", "Bearer vault-secret-123"),
            Header::new("X-Env", "env-secret-999"),
        ];
        req.query_params = vec![QueryParam::new("q", VAULT)];
        req.body = Some(Body {
            mode: BodyMode::Json,
            content: Some(r#"{"p":"vault-secret-123","e":"env-secret-999"}"#.into()),
            form_data: None,
            file_path: None,
        });
        req.auth = Auth::Bearer {
            token: VAULT.to_string(),
        };
        req
    }

    fn header(sent: &SentRequest, name: &str) -> String {
        sent.headers
            .iter()
            .find(|h| h.key == name)
            .map(|h| h.value.clone())
            .expect("header present")
    }

    fn body_text(sent: &SentRequest) -> String {
        sent.body
            .as_ref()
            .and_then(|b| b.content.clone())
            .expect("body content")
    }

    #[test]
    fn sent_request_masks_vault_values_everywhere() {
        let sent = sent_request_masked(&request(), &vault(), &HashSet::new());
        assert_eq!(sent.url, "https://api.test/v1?k=••••••");
        assert_eq!(header(&sent, "Authorization"), "Bearer ••••••");
        assert_eq!(sent.query_params[0].value, "••••••");
        assert!(!body_text(&sent).contains(VAULT));
        assert!(!format!("{:?}", sent.auth).contains(VAULT));
    }

    #[test]
    fn sent_request_masks_a_percent_encoded_vault_value_in_the_url() {
        let secret = "a b+c/secret";
        let req = HttpRequest::new(
            HttpMethod::Get,
            "https://api.test/v1?k=a%20b%2Bc%2Fsecret&z=1",
        );
        let sent = sent_request_masked(&req, &HashSet::from([secret.to_string()]), &HashSet::new());
        assert!(sent.url.contains("••••••"), "{}", sent.url);
        assert!(!sent.url.contains("a%20b%2Bc%2Fsecret"), "{}", sent.url);
        assert!(!sent.url.contains(secret), "{}", sent.url);
        assert!(sent.url.ends_with("&z=1"), "{}", sent.url);
    }

    #[test]
    fn sent_request_masks_a_percent_encoded_vault_value_in_a_header_and_body() {
        let secret = "a b+c/secret";
        let encoded = "a%20b%2Bc%2Fsecret";
        let mut req = HttpRequest::new(HttpMethod::Post, "https://api.test/v1");
        req.headers = vec![Header::new("X-Enc", encoded)];
        req.body = Some(Body {
            mode: BodyMode::Json,
            content: Some(format!("k={encoded}&z=1")),
            form_data: None,
            file_path: None,
        });
        let sent = sent_request_masked(&req, &HashSet::from([secret.to_string()]), &HashSet::new());
        assert_eq!(header(&sent, "X-Enc"), "••••••");
        assert_eq!(body_text(&sent), "k=••••••&z=1");
    }

    #[test]
    fn sent_request_masks_vault_values_in_form_data() {
        let mut req = request();
        req.body = Some(Body {
            mode: BodyMode::FormData,
            content: None,
            form_data: Some(vec![FormDataEntry {
                key: "field".into(),
                value: "pre-vault-secret-123-post".into(),
                entry_type: FormDataType::Text,
                enabled: true,
                content_type: None,
                description: None,
            }]),
            file_path: None,
        });
        let sent = sent_request_masked(&req, &vault(), &HashSet::new());
        let entries = sent
            .body
            .and_then(|b| b.form_data)
            .expect("form data entries");
        assert_eq!(entries[0].key, "field");
        assert_eq!(entries[0].value, "pre-••••••-post");
    }

    #[test]
    fn sent_request_masks_vault_values_in_header_and_query_keys() {
        let mut req = request();
        req.headers = vec![Header::new("X-vault-secret-123", "v")];
        req.query_params = vec![QueryParam::new("k-vault-secret-123", "v")];
        let sent = sent_request_masked(&req, &vault(), &HashSet::new());
        assert_eq!(sent.headers[0].key, "X-••••••");
        assert_eq!(sent.query_params[0].key, "k-••••••");
    }

    #[test]
    fn sent_request_masks_a_json_escaped_vault_value_in_the_body() {
        let secret = "pa\"ss-word-99";
        let mut req = request();
        req.body = Some(Body {
            mode: BodyMode::Json,
            content: Some(r#"{"p":"pa\"ss-word-99"}"#.into()),
            form_data: None,
            file_path: None,
        });
        let sent = sent_request_masked(&req, &HashSet::from([secret.to_string()]), &HashSet::new());
        assert_eq!(body_text(&sent), r#"{"p":"••••••"}"#);
    }

    #[test]
    fn sent_request_keeps_non_vault_values() {
        let sent = sent_request_masked(&request(), &vault(), &HashSet::new());
        assert_eq!(header(&sent, "X-Env"), "env-secret-999");
        assert!(body_text(&sent).contains("env-secret-999"));
    }

    #[test]
    fn with_no_vault_values_the_copy_equals_the_request() {
        let req = request();
        let sent = sent_request_masked(&req, &HashSet::new(), &HashSet::new());
        assert_eq!(sent.url, req.url);
        assert_eq!(sent.headers, req.headers);
        assert_eq!(sent.query_params, req.query_params);
        assert_eq!(sent.body, req.body);
        assert_eq!(sent.auth, req.auth);
    }

    fn secrets(values: &[&str]) -> HashSet<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn sent_request_lists_the_secret_values_it_holds() {
        let held = secrets(&["env-secret-999", "other-secret-777"]);
        let sent = sent_request_masked(&request(), &vault(), &held);
        assert_eq!(sent.secret_values, vec!["env-secret-999".to_string()]);
    }

    #[test]
    fn sent_request_never_lists_a_vault_value() {
        let both = secrets(&[VAULT, "env-secret-999"]);
        let sent = sent_request_masked(&request(), &vault(), &both);
        assert_eq!(sent.secret_values, vec!["env-secret-999".to_string()]);
        assert_eq!(header(&sent, "Authorization"), "Bearer ••••••");
    }

    #[test]
    fn sent_request_never_lists_a_value_that_contains_a_vault_form() {
        let mut req = request();
        req.headers
            .push(Header::new("X-Mixed", "pre-vault-secret-123-post"));
        let held = secrets(&["pre-vault-secret-123-post", "env-secret-999"]);
        let sent = sent_request_masked(&req, &vault(), &held);
        assert_eq!(sent.secret_values, vec!["env-secret-999".to_string()]);
    }

    #[test]
    fn sent_request_debug_hides_secret_values() {
        let held = secrets(&["env-secret-999"]);
        let sent = sent_request_masked(&request(), &HashSet::new(), &held);
        assert_eq!(sent.secret_values.len(), 1);
        let text = format!("{sent:?}");
        assert!(!text.contains("env-secret-999"), "{text}");
        assert!(!text.contains(VAULT), "{text}");
    }

    #[test]
    fn sent_request_skips_short_secret_values() {
        let mut req = request();
        req.headers.push(Header::new("X-Short", "abc"));
        let sent = sent_request_masked(&req, &vault(), &secrets(&["abc"]));
        assert!(sent.secret_values.is_empty());
    }

    #[test]
    fn sent_request_lists_a_secret_held_in_auth_or_a_query_key() {
        let mut req = request();
        req.query_params = vec![QueryParam::new("k-query-secret-1", "v")];
        req.auth = Auth::Bearer {
            token: "auth-secret-123".into(),
        };
        let held = secrets(&["query-secret-1", "auth-secret-123"]);
        let sent = sent_request_masked(&req, &HashSet::new(), &held);
        assert_eq!(
            sent.secret_values,
            vec!["auth-secret-123".to_string(), "query-secret-1".to_string()]
        );
    }
}
