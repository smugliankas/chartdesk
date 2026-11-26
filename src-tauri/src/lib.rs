//! ChartDesk desktop app: the same web app in a native window, plus what a browser page
//! can't do on its own: saving files through a real "Save as" dialog, opening links in the
//! person's own browser, and signing in to cTrader (see ctrader.rs).

mod ctrader;

use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

/// Asks where to save, then writes the bytes there. The bytes come as the raw request body
/// (no JSON round trip), the suggested file name in the `x-file-name` header.
/// Returns false when the person cancels.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_file expects raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("chartdesk");
    let mut dialog = app.dialog().file().set_file_name(name);
    if let Some((_, ext)) = name.rsplit_once('.') {
        let label = match ext {
            "png" => "PNG image",
            "json" => "ChartDesk backup",
            _ => "File",
        };
        dialog = dialog.add_filter(label, &[ext]);
    }
    // An async command runs off the main thread, so waiting for the dialog here is fine.
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_file, ctrader::ctrader_app, ctrader::ctrader_login])
        .run(tauri::generate_context!())
        .expect("error while running ChartDesk");
}
