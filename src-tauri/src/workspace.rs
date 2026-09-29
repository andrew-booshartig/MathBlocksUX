//! Named canvas snapshots (blocks/order/edges), saved as plain JSON files
//! under the app's own data directory — so a workspace like "slope
//! intercept" can be rebuilt once and reloaded instantly instead of
//! re-added by hand after every restart. `__autosave__` is a reserved
//! name the frontend writes to on every change and loads on startup, so
//! ordinary work also survives a restart without an explicit save.

use std::fs;
use tauri::{AppHandle, Manager};

fn workspaces_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("workspaces");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_filename(name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains(['/', '\\', '\0']) || name == "." || name == ".." {
        return Err(format!("invalid workspace name: {name:?}"));
    }
    Ok(name.to_string())
}

#[tauri::command]
pub fn save_workspace(app: AppHandle, name: String, data: serde_json::Value) -> Result<(), String> {
    let name = safe_filename(&name)?;
    let path = workspaces_dir(&app)?.join(format!("{name}.json"));
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_workspace(app: AppHandle, name: String) -> Result<serde_json::Value, String> {
    let name = safe_filename(&name)?;
    let path = workspaces_dir(&app)?.join(format!("{name}.json"));
    let contents = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_workspaces(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = workspaces_dir(&app)?;
    let mut names: Vec<String> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.path().file_stem().map(|s| s.to_string_lossy().into_owned()))
        .filter(|name| name != "__autosave__")
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn delete_workspace(app: AppHandle, name: String) -> Result<(), String> {
    let name = safe_filename(&name)?;
    let path = workspaces_dir(&app)?.join(format!("{name}.json"));
    fs::remove_file(path).map_err(|e| e.to_string())
}

/// Writes a canvas (with its tour) to ~/Downloads as `<name>.matrixlab.json`
/// — a single file a teacher can hand to students or post anywhere; the
/// app's Import reads it back. Never overwrites: adds " (2)", " (3)", …
#[tauri::command]
pub fn export_workspace(app: AppHandle, name: String, data: serde_json::Value) -> Result<String, String> {
    let name = safe_filename(&name)?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let mut path = dir.join(format!("{name}.matrixlab.json"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{name} ({n}).matrixlab.json"));
        n += 1;
    }
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
