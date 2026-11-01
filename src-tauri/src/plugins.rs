//! Plugins: folders in ~/Documents/MatrixLab/Plugins, each with a
//! `plugin.json` (its name and what it adds — languages for code cells,
//! cell kinds, commands) and, if it scripts anything, a `main.js` the app
//! loads. Plain files, so a plugin is made in any editor and kept wherever
//! the user keeps their dotfiles (the folder can be a link). See
//! docs/PLUGINS.md.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The third-party notices: in a built app, Contents/Resources; in
/// development, what `npm run build:notices` made.
#[tauri::command]
pub fn notices_read(app: AppHandle) -> Result<String, String> {
    let bundled = app.path().resource_dir().ok().map(|d| d.join("THIRD_PARTY_NOTICES.txt"));
    let dev = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/THIRD_PARTY_NOTICES.txt"));
    for path in bundled.into_iter().chain([dev]) {
        if let Ok(text) = fs::read_to_string(&path) {
            return Ok(text);
        }
    }
    Err("the notices aren't made yet (npm run build:notices)".into())
}

/// ~/Documents/MatrixLab/init.js: the user's own config, run like a plugin (Neovim's init.lua)
fn init_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("MatrixLab");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("init.js"))
}

/// init.js, when there is one.
#[tauri::command]
pub fn init_read(app: AppHandle) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(init_path(&app)?).ok())
}

/// init.js opened in Neovim (made from `template` first, when there isn't one).
#[tauri::command]
pub fn init_edit(app: AppHandle, template: String) -> Result<String, String> {
    let path = init_path(&app)?;
    if !path.exists() {
        fs::write(&path, template).map_err(|e| e.to_string())?;
    }
    let shown = path.to_string_lossy().into_owned();
    crate::notebook::nvim_in_terminal(&shown)?;
    Ok(shown)
}

/// A plugin's folder opened in Neovim.
#[tauri::command]
pub fn plugin_edit(app: AppHandle, folder: String) -> Result<(), String> {
    let name: String = folder.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    crate::notebook::nvim_in_terminal(&plugins_dir(&app)?.join(name).to_string_lossy())
}

/// When the plugins (or init.js) last changed — the newest file's time — so
/// the app can reload them as soon as one is saved.
#[tauri::command]
pub fn plugins_stamp(app: AppHandle) -> Result<u64, String> {
    fn newest(path: &std::path::Path, depth: u8) -> u64 {
        let own = fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        if depth == 0 || !path.is_dir() {
            return own;
        }
        fs::read_dir(path).map(|it| it.flatten().map(|e| newest(&e.path(), depth - 1)).fold(own, u64::max)).unwrap_or(own)
    }
    Ok(newest(&plugins_dir(&app)?, 3).max(newest(&init_path(&app)?, 0)))
}

fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("MatrixLab").join("Plugins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[derive(Serialize)]
pub struct Found {
    /// its folder's name
    folder: String,
    /// plugin.json, as written (read on the other side — a bad one is reported there)
    manifest: String,
    /// main.js, when it has one
    main: Option<String>,
}

/// The plugins folder (made if it isn't there yet).
#[tauri::command]
pub fn plugins_folder(app: AppHandle) -> Result<String, String> {
    Ok(plugins_dir(&app)?.to_string_lossy().into_owned())
}

/// Every plugin in the folder: its manifest and script.
#[tauri::command]
pub fn plugins_list(app: AppHandle) -> Result<Vec<Found>, String> {
    let mut out = Vec::new();
    let mut folders: Vec<PathBuf> = fs::read_dir(plugins_dir(&app)?).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    folders.sort();
    for folder in folders {
        let Ok(manifest) = fs::read_to_string(folder.join("plugin.json")) else { continue };
        out.push(Found {
            folder: folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            manifest,
            main: fs::read_to_string(folder.join("main.js")).ok(),
        });
    }
    Ok(out)
}

/// Start a plugin from a sample: its folder with the files given (not over one that's there).
#[tauri::command]
pub fn plugins_create(app: AppHandle, folder: String, files: Vec<(String, String)>) -> Result<String, String> {
    let name: String = folder.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    if name.is_empty() {
        return Err("give the plugin a name".into());
    }
    let dir = plugins_dir(&app)?.join(&name);
    if dir.exists() {
        return Err(format!("there's already a plugin called {name}"));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (file, text) in files {
        let file: String = file.chars().filter(|c| *c != '/' && *c != '\\').collect();
        fs::write(dir.join(file), text).map_err(|e| e.to_string())?;
    }
    Ok(dir.to_string_lossy().into_owned())
}
