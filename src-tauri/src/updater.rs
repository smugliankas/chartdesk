//! Updates: the app looks for a newer release on GitHub (the `latest.json` that each release
//! carries), and on the person's go-ahead downloads it, checks its signature against the public
//! key in tauri.conf.json, installs it and starts again. Only releases signed with ChartDesk's
//! own private key are accepted.

use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by the last check, kept until it is installed.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

/// Looks for a newer version. None when this one is the newest.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Could not check for updates: {e}"))?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
    });
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// Downloads and installs the update found by `update_check`, telling the page how far the
/// download got (0–100), then starts the new version. On Windows the installer closes the app
/// itself.
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>, progress: Channel<u8>) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("No update to install. Check for updates first.")?;
    let mut done: u64 = 0;
    update
        .download_and_install(
            |chunk, total| {
                done += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let _ = progress.send(((done * 100) / total).min(100) as u8);
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("The update could not be installed: {e}"))?;
    app.restart();
}
