//! One-shot localhost server for the OAuth2 authorization code redirect in
//! system-browser mode. It binds `127.0.0.1` on a free port, accepts a single
//! request, answers with a small HTML page and hands the query pairs back.
//!
//! This is not the Flow callback server (`callback_server.rs`): that one serves
//! `/cb/<token>` with JSON replies on a LAN address, while an OAuth2 redirect needs
//! the path `/callback` on localhost and a page for the person at the browser.

use std::time::Duration;

use rocket_shared::error::{DomainError, DomainResult};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const BROWSER_CALLBACK_HTML: &str = "<!DOCTYPE html><html><body><h2>Authorization successful</h2><p>You can close this tab.</p></body></html>";
const BROWSER_ERROR_HTML: &str = "<!DOCTYPE html><html><body><h2>Authorization failed</h2><p>Please return to the app.</p></body></html>";

/// Bytes read from the first request. The callback line is short.
const MAX_REQUEST_BYTES: usize = 4096;

/// A bound, not yet served, redirect endpoint.
pub struct LoopbackCallbackServer {
    listener: TcpListener,
    port: u16,
}

impl LoopbackCallbackServer {
    /// Binds `127.0.0.1` on a free port.
    pub async fn bind() -> DomainResult<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| DomainError::Internal(format!("Failed to bind callback server: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| DomainError::Internal(format!("Failed to get port: {e}")))?
            .port();
        Ok(Self { listener, port })
    }

    /// The redirect URI to give the provider.
    pub fn redirect_uri(&self) -> String {
        format!("http://localhost:{}/callback", self.port)
    }

    /// Accepts one request and returns its query pairs.
    ///
    /// `verdict` sees the pairs and decides which page the browser gets: `true` for the
    /// success page, `false` for the failure page. The listener is closed on return, so
    /// the port is free again after the first request or the timeout.
    pub async fn wait_for_callback(
        self,
        timeout: Duration,
        verdict: impl FnOnce(&[(String, String)]) -> bool,
    ) -> DomainResult<Vec<(String, String)>> {
        let listener = self.listener;
        let served = tokio::time::timeout(timeout, async move {
            let (mut stream, _) = listener
                .accept()
                .await
                .map_err(|e| DomainError::Internal(format!("Callback accept failed: {e}")))?;

            let mut buf = vec![0u8; MAX_REQUEST_BYTES];
            let n = stream
                .read(&mut buf)
                .await
                .map_err(|e| DomainError::Internal(format!("Callback read failed: {e}")))?;
            let pairs = query_pairs(&String::from_utf8_lossy(&buf[..n]));

            let page = if verdict(&pairs) {
                BROWSER_CALLBACK_HTML
            } else {
                BROWSER_ERROR_HTML
            };
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n{page}");
            // The browser may already have closed the tab; the pairs are what matters.
            let _ = stream.write_all(reply.as_bytes()).await;

            Ok(pairs)
        })
        .await;

        match served {
            Ok(result) => result,
            Err(_) => Err(DomainError::Internal(format!(
                "Authorization timed out ({}s). Please try again.",
                timeout.as_secs()
            ))),
        }
    }
}

/// Query pairs of a request such as `GET /callback?code=x&state=y HTTP/1.1`.
/// A request with no target or no query gives no pairs.
fn query_pairs(request: &str) -> Vec<(String, String)> {
    let target = request
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .nth(1)
        .unwrap_or("");
    let query = target.split_once('?').map_or("", |(_, query)| query);
    url::form_urlencoded::parse(query.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpStream;

    /// Sends `raw` to the server and returns everything it answers.
    async fn send(port: u16, raw: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect");
        stream.write_all(raw.as_bytes()).await.expect("write");
        let mut reply = String::new();
        stream.read_to_string(&mut reply).await.expect("read");
        reply
    }

    #[tokio::test]
    async fn redirect_uri_uses_bound_port() {
        let server = LoopbackCallbackServer::bind().await.expect("bind");
        let port = server.port;
        assert!(port > 0);
        assert_eq!(
            server.redirect_uri(),
            format!("http://localhost:{port}/callback")
        );
    }

    #[tokio::test]
    async fn binds_loopback_only() {
        let server = LoopbackCallbackServer::bind().await.expect("bind");
        let addr = server.listener.local_addr().expect("addr");
        assert!(addr.ip().is_loopback(), "{addr}");
    }

    #[tokio::test]
    async fn returns_query_pairs_and_replies_success_html() {
        let server = LoopbackCallbackServer::bind().await.expect("bind");
        let port = server.port;
        let task = tokio::spawn(server.wait_for_callback(Duration::from_secs(5), |_| true));

        let reply = send(port, "GET /callback?code=c1&state=s1 HTTP/1.1\r\n\r\n").await;

        assert!(reply.starts_with("HTTP/1.1 200 OK"), "{reply}");
        assert!(reply.contains("Authorization successful"), "{reply}");
        let pairs = task.await.expect("join").expect("pairs");
        assert_eq!(
            pairs,
            vec![
                ("code".to_string(), "c1".to_string()),
                ("state".to_string(), "s1".to_string())
            ]
        );
    }

    #[tokio::test]
    async fn decodes_percent_encoded_values() {
        let server = LoopbackCallbackServer::bind().await.expect("bind");
        let port = server.port;
        let task = tokio::spawn(server.wait_for_callback(Duration::from_secs(5), |_| true));

        send(
            port,
            "GET /callback?error_description=User%20said%20no HTTP/1.1\r\n\r\n",
        )
        .await;

        let pairs = task.await.expect("join").expect("pairs");
        assert_eq!(
            pairs,
            vec![("error_description".to_string(), "User said no".to_string())]
        );
    }

    #[tokio::test]
    async fn replies_failure_html_when_verdict_false() {
        let server = LoopbackCallbackServer::bind().await.expect("bind");
        let port = server.port;
        let task = tokio::spawn(server.wait_for_callback(Duration::from_secs(5), |_| false));

        let reply = send(port, "GET /callback?code=c1 HTTP/1.1\r\n\r\n").await;

        assert!(reply.contains("Authorization failed"), "{reply}");
        assert!(!reply.contains("Authorization successful"), "{reply}");
        task.await.expect("join").expect("pairs");
    }

    #[tokio::test]
    async fn malformed_request_does_not_panic() {
        let server = LoopbackCallbackServer::bind().await.expect("bind");
        let port = server.port;
        let task = tokio::spawn(
            server.wait_for_callback(Duration::from_secs(5), |pairs| pairs.is_empty()),
        );

        let reply = send(port, "garbage\r\n\r\n").await;

        assert!(reply.contains("Authorization successful"), "{reply}");
        let pairs = task.await.expect("join").expect("pairs");
        assert!(pairs.is_empty());
    }

    #[tokio::test]
    async fn times_out_when_no_client_connects() {
        let server = LoopbackCallbackServer::bind().await.expect("bind");

        let err = server
            .wait_for_callback(Duration::from_millis(50), |_| true)
            .await
            .expect_err("timeout");

        assert!(
            err.to_string().contains("Authorization timed out (0s)"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn port_is_free_after_the_callback() {
        let server = LoopbackCallbackServer::bind().await.expect("bind");
        let port = server.port;
        let task = tokio::spawn(server.wait_for_callback(Duration::from_secs(5), |_| true));
        send(port, "GET /callback?code=c1 HTTP/1.1\r\n\r\n").await;
        task.await.expect("join").expect("pairs");

        let rebound = TcpListener::bind(("127.0.0.1", port)).await;

        assert!(rebound.is_ok(), "{:?}", rebound.err());
    }
}
