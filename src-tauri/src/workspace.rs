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

/// Saves a picture (a `data:image/png;base64,…` URL, e.g. a graph) to
/// ~/Downloads as `<name>.png`. Never overwrites: adds " (2)", " (3)", …
#[tauri::command]
pub fn save_image(app: AppHandle, name: String, data_url: String) -> Result<String, String> {
    let name = safe_filename(&name)?;
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("expected a PNG data URL")?;
    let bytes = decode_base64(encoded)?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let mut path = dir.join(format!("{name}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{name} ({n}).png"));
        n += 1;
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Saves a vector picture (SVG text — e.g. a graph, sharp at any size) to
/// ~/Downloads as `<name>.svg`. Never overwrites: adds " (2)", " (3)", …
#[tauri::command]
pub fn save_svg(app: AppHandle, name: String, svg: String) -> Result<String, String> {
    let name = safe_filename(&name)?;
    let head = svg.trim_start();
    if !(head.starts_with("<svg") || head.starts_with("<?xml")) {
        return Err("expected an SVG picture".into());
    }
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let mut path = dir.join(format!("{name}.svg"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{name} ({n}).svg"));
        n += 1;
    }
    fs::write(&path, svg).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Saves a document (a web page — e.g. a Show-your-work history) to
/// ~/Downloads as `<name>.html`. Never overwrites: adds " (2)", " (3)", …
#[tauri::command]
pub fn save_document(app: AppHandle, name: String, html: String) -> Result<String, String> {
    let name = safe_filename(&name)?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let mut path = dir.join(format!("{name}.html"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{name} ({n}).html"));
        n += 1;
    }
    fs::write(&path, html).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Saves a document like `save_document`, then opens it in the default
/// browser — for printing, or ⌘P → Save as PDF (an assignment to hand in).
#[tauri::command]
pub fn print_document(app: AppHandle, name: String, html: String) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let path = save_document(app.clone(), name, html)?;
    app.opener().open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Standard base64 (no crate needed for one PNG now and then).
fn decode_base64(text: &str) -> Result<Vec<u8>, String> {
    fn value(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for &c in text.as_bytes() {
        if c == b'=' {
            break;
        }
        if c.is_ascii_whitespace() {
            continue;
        }
        let v = value(c).ok_or("not valid base64")?;
        buffer = (buffer << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

// ---- themes: .toml files in the app's own themes folder, made in the app
// or edited in any editor (the calculator app reads them all)

fn themes_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("themes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The themes folder (made if it isn't there yet), for showing in Finder.
#[tauri::command]
pub fn theme_folder(app: AppHandle) -> Result<String, String> {
    Ok(themes_dir(&app)?.to_string_lossy().into_owned())
}

/// Every theme file in the folder: (file name, its TOML).
#[tauri::command]
pub fn list_themes(app: AppHandle) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(themes_dir(&app)?).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            out.push((path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), text));
        }
    }
    out.sort();
    Ok(out)
}

/// Writes a theme to the folder as <file>.toml (a new one, or over the same
/// file when it's being edited); returns the file name.
#[tauri::command]
pub fn save_theme(app: AppHandle, file: String, text: String) -> Result<String, String> {
    let stem = file.trim_end_matches(".toml");
    let clean: String = stem.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' }).collect();
    let name = safe_filename(clean.trim())?;
    let file_name = format!("{name}.toml");
    fs::write(themes_dir(&app)?.join(&file_name), text).map_err(|e| e.to_string())?;
    Ok(file_name)
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_base64() {
        assert_eq!(super::decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(super::decode_base64("TWFu").unwrap(), b"Man");
    }
}
