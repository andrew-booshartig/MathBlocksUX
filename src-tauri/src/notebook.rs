//! Notebooks: plain Markdown files in ~/Documents/MatrixLab/Notebooks, so
//! any editor (Neovim, Obsidian…) opens the same files the app does — and
//! the app notices when one of them saves. Templates are Markdown files too,
//! in ~/Documents/MatrixLab/Templates. Nothing is ever deleted: "delete"
//! moves a notebook into Notebooks/.trash.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

fn matrixlab_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(|e| e.to_string())?.join("MatrixLab"))
}

fn notebooks_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = matrixlab_dir(app)?.join("Notebooks");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = matrixlab_dir(app)?.join("Templates");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A notebook's name as a file name: no folders, nothing hidden.
fn safe_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 120 || name.starts_with('.') || name.contains(['/', '\\', '\0', ':']) {
        return Err(format!("“{name}” can't be a notebook's name"));
    }
    Ok(name.to_string())
}

fn modified(path: &PathBuf) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Written whole or not at all: to a temporary file, then moved into place.
fn write_atomic(path: &PathBuf, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("md.saving");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct NotebookInfo {
    name: String,
    modified: u64,
}

#[derive(Serialize)]
pub struct NotebookFile {
    text: String,
    modified: u64,
}

#[tauri::command]
pub fn notebook_folder(app: AppHandle) -> Result<String, String> {
    Ok(notebooks_dir(&app)?.to_string_lossy().into_owned())
}

/// Every notebook, most recently changed first.
#[tauri::command]
pub fn list_notebooks(app: AppHandle) -> Result<Vec<NotebookInfo>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(notebooks_dir(&app)?).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name.starts_with('.') || path.extension().and_then(|e| e.to_str()) != Some("md") || !path.is_file() {
            continue;
        }
        out.push(NotebookInfo { name: name.trim_end_matches(".md").to_string(), modified: modified(&path) });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[tauri::command]
pub fn read_notebook(app: AppHandle, name: String) -> Result<NotebookFile, String> {
    let path = notebooks_dir(&app)?.join(format!("{}.md", safe_name(&name)?));
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(NotebookFile { text, modified: modified(&path) })
}

/// Saves it; gives back the file's new time (so a save of our own isn't
/// mistaken for another editor's).
#[tauri::command]
pub fn write_notebook(app: AppHandle, name: String, text: String) -> Result<u64, String> {
    let path = notebooks_dir(&app)?.join(format!("{}.md", safe_name(&name)?));
    write_atomic(&path, &text)?;
    Ok(modified(&path))
}

/// When it last changed on disk (0: it's gone) — checked every so often,
/// so a save from Neovim shows up here.
#[tauri::command]
pub fn notebook_modified(app: AppHandle, name: String) -> Result<u64, String> {
    Ok(modified(&notebooks_dir(&app)?.join(format!("{}.md", safe_name(&name)?))))
}

#[tauri::command]
pub fn rename_notebook(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let dir = notebooks_dir(&app)?;
    let target = dir.join(format!("{}.md", safe_name(&to)?));
    if target.exists() {
        return Err(format!("there's already a notebook called “{}”", to.trim()));
    }
    fs::rename(dir.join(format!("{}.md", safe_name(&from)?)), target).map_err(|e| e.to_string())
}

/// Into Notebooks/.trash (named with the time), never gone for good.
#[tauri::command]
pub fn trash_notebook(app: AppHandle, name: String) -> Result<(), String> {
    let dir = notebooks_dir(&app)?;
    let trash = dir.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let name = safe_name(&name)?;
    fs::rename(dir.join(format!("{name}.md")), trash.join(format!("{name} ({stamp}).md"))).map_err(|e| e.to_string())
}

/// Opens the notebook in Neovim, in your own terminal (Ghostty, or
/// Terminal) with your own config — and since the app watches the file,
/// every :w shows up in the Notebook tile.
#[tauri::command]
pub fn open_in_neovim(app: AppHandle, name: String) -> Result<(), String> {
    use std::process::Command;
    let path = notebooks_dir(&app)?.join(format!("{}.md", safe_name(&name)?));
    let nvim = ["/opt/homebrew/bin/nvim", "/usr/local/bin/nvim", "/usr/bin/nvim"]
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
        .ok_or("Neovim isn't installed (brew install neovim)")?;
    let path = path.to_string_lossy().into_owned();
    if std::path::Path::new("/Applications/Ghostty.app").exists() {
        Command::new("open").args(["-na", "Ghostty.app", "--args", "-e", nvim, &path]).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    // Terminal: the path quoted for the shell, then for AppleScript
    let shell = format!("{nvim} '{}'", path.replace('\'', "'\\''"));
    let script = format!("tell application \"Terminal\"\n  activate\n  do script \"{}\"\nend tell", shell.replace('\\', "\\\\").replace('"', "\\\""));
    Command::new("osascript").args(["-e", &script]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Your templates: every .md in the Templates folder, as (name, text).
#[tauri::command]
pub fn list_templates(app: AppHandle) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(templates_dir(&app)?).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let name = path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            out.push((name, text));
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn save_template(app: AppHandle, name: String, text: String) -> Result<(), String> {
    write_atomic(&templates_dir(&app)?.join(format!("{}.md", safe_name(&name)?)), &text)
}
