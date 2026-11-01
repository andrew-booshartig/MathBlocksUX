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
