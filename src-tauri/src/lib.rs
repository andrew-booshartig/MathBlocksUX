mod kernel;
mod notebook;
mod sidecar;
mod workspace;

use sidecar::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // each window opens where it was, the size it was
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .manage(SidecarState::spawn())
        .manage(kernel::Kernels::default())
        .invoke_handler(tauri::generate_handler![
            sidecar::math_eval,
            workspace::save_workspace,
            workspace::load_workspace,
            workspace::list_workspaces,
            workspace::delete_workspace,
            workspace::export_workspace,
            workspace::save_image,
            workspace::save_svg,
            workspace::save_text,
            kernel::kernel_run,
            kernel::kernel_vars,
            kernel::kernel_names,
            kernel::kernel_interrupt,
            kernel::kernel_restart,
            workspace::save_document,
            workspace::print_document,
            workspace::theme_folder,
            workspace::list_themes,
            workspace::save_theme,
            notebook::notebook_folder,
            notebook::list_notebooks,
            notebook::read_notebook,
            notebook::write_notebook,
            notebook::notebook_modified,
            notebook::rename_notebook,
            notebook::trash_notebook,
            notebook::list_templates,
            notebook::save_template,
            notebook::open_in_neovim,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
