fn main() {
    ctrader_credentials();
    tauri_build::build()
}

/// The cTrader Open API app's id and secret are built into the app, but never kept in the
/// repository: they come from the environment (GitHub secrets in CI) or from the file
/// src-tauri/.ctrader.env on a developer's computer (git ignores it), with two lines:
///
///     CTRADER_CLIENT_ID=...
///     CTRADER_CLIENT_SECRET=...
///
/// Without them the app still builds; cTrader just says it isn't set up in this build.
fn ctrader_credentials() {
    println!("cargo:rerun-if-changed=.ctrader.env");
    for key in ["CTRADER_CLIENT_ID", "CTRADER_CLIENT_SECRET"] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let Ok(text) = std::fs::read_to_string(".ctrader.env") else {
        return;
    };
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let (key, value) = (key.trim(), value.trim().trim_matches('"'));
        if (key == "CTRADER_CLIENT_ID" || key == "CTRADER_CLIENT_SECRET") && std::env::var(key).is_err() {
            println!("cargo:rustc-env={key}={value}");
        }
    }
}
