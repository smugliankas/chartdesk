//! Signing in to cTrader (Spotware's Open API) from the desktop app.
//!
//! The person signs in on cTrader's own page in their browser and allows ChartDesk to read
//! their accounts; cTrader then sends the browser back to a small server this app runs on
//! 127.0.0.1 for a moment, with a one-time code. The code is exchanged for an access token
//! here, so the app secret never travels through a web page.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};
use tauri_plugin_opener::OpenerExt;

/// Where cTrader sends the browser back to. It must be listed among the app's redirect URLs
/// on openapi.ctrader.com.
const REDIRECT_PORT: u16 = 5174;
const REDIRECT_PATH: &str = "/callback";
const AUTH_URL: &str = "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
const TOKEN_URL: &str = "https://openapi.ctrader.com/apps/token";
/// How long to wait for the person to finish signing in.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

fn client_id() -> Option<&'static str> {
    option_env!("CTRADER_CLIENT_ID").filter(|s| !s.is_empty())
}

fn client_secret() -> Option<&'static str> {
    option_env!("CTRADER_CLIENT_SECRET").filter(|s| !s.is_empty())
}

fn redirect_uri() -> String {
    format!("http://localhost:{REDIRECT_PORT}{REDIRECT_PATH}")
}

/// The app credentials, for the WebSocket connection's application sign-in.
/// None when this build has no cTrader app set up.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCredentials {
    client_id: &'static str,
    client_secret: &'static str,
}

#[tauri::command]
pub fn ctrader_app() -> Option<AppCredentials> {
    Some(AppCredentials { client_id: client_id()?, client_secret: client_secret()? })
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    access_token: String,
    refresh_token: String,
    /// Seconds until the access token expires.
    expires_in: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    error_code: Option<String>,
    description: Option<String>,
}

/// Opens cTrader's sign-in page in the browser and waits until the person allows access.
#[tauri::command]
pub async fn ctrader_login(app: tauri::AppHandle) -> Result<Token, String> {
    let (id, secret) = match (client_id(), client_secret()) {
        (Some(id), Some(secret)) => (id, secret),
        _ => return Err("cTrader isn't set up in this build of ChartDesk.".into()),
    };
    // Listen before opening the page, so the answer can't arrive before we're ready.
    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .map_err(|e| format!("Couldn't open port {REDIRECT_PORT} for the cTrader sign-in: {e}"))?;
    let mut auth = url::Url::parse(AUTH_URL).expect("valid URL");
    auth.query_pairs_mut()
        .append_pair("client_id", id)
        .append_pair("redirect_uri", &redirect_uri())
        .append_pair("scope", "accounts")
        .append_pair("product", "web");
    app.opener().open_url(auth.as_str(), None::<&str>).map_err(|e| e.to_string())?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener))
        .await
        .map_err(|e| e.to_string())??;
    tauri::async_runtime::spawn_blocking(move || exchange_code(&code, id, secret))
        .await
        .map_err(|e| e.to_string())?
}

/// Serves the redirect: answers the browser and returns the code from the query string.
fn wait_for_code(listener: TcpListener) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err("The cTrader sign-in timed out. Try again.".into());
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(result) = handle_redirect(stream) {
                    return result;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// One request to the local server. None when it isn't the redirect (e.g. a favicon request).
fn handle_redirect(mut stream: TcpStream) -> Option<Result<String, String>> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).ok()?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let target = request.lines().next()?.split_whitespace().nth(1)?.to_string();
    let parsed = url::Url::parse(&format!("http://localhost{target}")).ok()?;
    if parsed.path() != REDIRECT_PATH {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return None;
    }
    let get = |name: &str| parsed.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    let result = match (get("code"), get("error")) {
        (Some(code), _) if !code.is_empty() => Ok(code),
        (_, Some(error)) => Err(format!("cTrader sign-in was not completed ({error}).")),
        _ => Err("cTrader sign-in returned no code.".into()),
    };
    let (title, text) = match &result {
        Ok(_) => ("Connected", "ChartDesk is connected to cTrader. You can close this tab and go back to the app."),
        Err(_) => ("Not connected", "The cTrader sign-in was not completed. Go back to ChartDesk and try again."),
    };
    let body = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>ChartDesk: {title}</title></head>\
         <body style=\"font:16px system-ui,sans-serif;background:#0c0c0c;color:#d6d6d6;display:grid;place-items:center;height:100vh;margin:0\">\
         <div style=\"text-align:center\"><h2 style=\"margin:0 0 8px\">{title}</h2><p style=\"color:#8a8a8a\">{text}</p></div></body></html>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    Some(result)
}

fn exchange_code(code: &str, id: &str, secret: &str) -> Result<Token, String> {
    let response: TokenResponse = ureq::get(TOKEN_URL)
        .query("grant_type", "authorization_code")
        .query("code", code)
        .query("redirect_uri", &redirect_uri())
        .query("client_id", id)
        .query("client_secret", secret)
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("Couldn't reach cTrader to finish signing in: {e}"))?
        .into_json()
        .map_err(|e| format!("Unexpected answer from cTrader: {e}"))?;
    if let Some(code) = response.error_code.filter(|c| !c.is_empty()) {
        return Err(format!("cTrader: {} {}", code, response.description.unwrap_or_default()).trim().to_string());
    }
    match (response.access_token, response.refresh_token) {
        (Some(access_token), Some(refresh_token)) => Ok(Token { access_token, refresh_token, expires_in: response.expires_in.unwrap_or(0) }),
        _ => Err("cTrader sent no access token.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn send(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn takes_the_code_from_the_redirect_and_ignores_other_requests() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = std::thread::spawn(move || {
            let favicon = send(port, "/favicon.ico");
            let page = send(port, "/callback?code=abc%2F123&state=x");
            (favicon, page)
        });
        assert_eq!(wait_for_code(listener).unwrap(), "abc/123");
        let (favicon, page) = client.join().unwrap();
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(page.contains("ChartDesk is connected to cTrader"));
    }

    #[test]
    fn reports_a_refused_sign_in() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = std::thread::spawn(move || send(port, "/callback?error=access_denied"));
        let err = wait_for_code(listener).unwrap_err();
        assert!(err.contains("access_denied"));
        assert!(client.join().unwrap().contains("not completed"));
    }
}
