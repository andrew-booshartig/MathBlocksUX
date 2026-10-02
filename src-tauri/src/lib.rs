mod sidecar;
mod workspace;

use sidecar::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState::spawn())
        .invoke_handler(tauri::generate_handler![
            sidecar::math_eval,
            workspace::save_workspace,
            workspace::load_workspace,
            workspace::list_workspaces,
            workspace::delete_workspace,
            workspace::export_workspace,
            workspace::save_image,
            workspace::save_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
