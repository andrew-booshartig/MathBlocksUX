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

// ---- flattened cells: a cell kept as its picture (a graph, a circuit…), so
// a notebook of thirty doesn't redraw thirty. The pictures live beside the
// notebook, in "<name>.assets/"; the cell's fence says which (flat=…).

/// A cell's picture (a PNG or JPEG data URL) kept in "<notebook>.assets/":
/// its path, from the Notebooks folder.
#[tauri::command]
pub fn flat_save(app: AppHandle, notebook: String, data_url: String) -> Result<String, String> {
    let (ext, encoded) = if let Some(e) = data_url.strip_prefix("data:image/png;base64,") {
        ("png", e)
    } else if let Some(e) = data_url.strip_prefix("data:image/jpeg;base64,") {
        ("jpg", e)
    } else {
        return Err("expected a PNG or JPEG picture".into());
    };
    let bytes = crate::workspace::decode_base64(encoded)?;
    let folder = format!("{}.assets", safe_name(&notebook)?);
    let dir = notebooks_dir(&app)?.join(&folder);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let file = format!("flat-{stamp}.{ext}");
    fs::write(dir.join(&file), bytes).map_err(|e| e.to_string())?;
    Ok(format!("{folder}/{file}"))
}

/// Where a flattened cell's picture is — only ever inside the Notebooks folder.
fn flat_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let (folder, file) = path.split_once('/').ok_or("not a notebook's picture")?;
    if !folder.ends_with(".assets") || file.contains('/') || folder.contains("..") || file.contains("..") || !(file.ends_with(".png") || file.ends_with(".jpg")) {
        return Err("not a notebook's picture".into());
    }
    Ok(notebooks_dir(app)?.join(folder).join(file))
}

/// A flattened cell's picture, as a data URL to show.
#[tauri::command]
pub fn flat_read(app: AppHandle, path: String) -> Result<String, String> {
    let file = flat_path(&app, &path)?;
    let bytes = fs::read(&file).map_err(|_| format!("its picture is gone ({path})"))?;
    let kind = if path.ends_with(".png") { "png" } else { "jpeg" };
    Ok(format!("data:image/{kind};base64,{}", crate::langs::base64(&bytes)))
}

/// Unflattened: its picture goes to Notebooks/.trash (nothing's ever deleted).
#[tauri::command]
pub fn flat_remove(app: AppHandle, path: String) -> Result<(), String> {
    let file = flat_path(&app, &path)?;
    let trash = notebooks_dir(&app)?.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    fs::rename(&file, trash.join(name)).map_err(|e| e.to_string())
}

/// Opens the notebook in Neovim, in your own terminal (Ghostty, or
/// Terminal) with your own config — and since the app watches the file,
/// every :w shows up in the Notebook tile.
#[tauri::command]
pub fn open_in_neovim(app: AppHandle, name: String) -> Result<(), String> {
    let path = notebooks_dir(&app)?.join(format!("{}.md", safe_name(&name)?));
    nvim_in_terminal(&path.to_string_lossy())
}

/// A file (or folder) opened in Neovim, in the user's own terminal (Ghostty, or Terminal).
pub(crate) fn nvim_in_terminal(path: &str) -> Result<(), String> {
    use std::process::Command;
    let nvim = ["/opt/homebrew/bin/nvim", "/usr/local/bin/nvim", "/usr/bin/nvim"]
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
        .ok_or("Neovim isn't installed (brew install neovim)")?;
    if std::path::Path::new("/Applications/Ghostty.app").exists() {
        Command::new("open").args(["-na", "Ghostty.app", "--args", "-e", nvim, path]).spawn().map_err(|e| e.to_string())?;
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
