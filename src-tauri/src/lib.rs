mod commands;

use commands::{backup, bridge, health, workspace};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

#[derive(Default)]
pub struct AppState {
    pub workspace: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<workspace::WorkspaceWatcher>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(AppState::default()))
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(app_data)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::workspace_summary,
            workspace::pick_workspace,
            workspace::set_workspace,
            workspace::recent_workspaces,
            workspace::list_entries,
            workspace::read_note,
            workspace::write_note,
            workspace::create_note,
            workspace::move_to_trash,
            workspace::rebuild_index,
            workspace::search_notes,
            workspace::reveal_path,
            workspace::open_workspace_folder,
            bridge::fs_list,
            bridge::fs_read,
            bridge::fs_write,
            bridge::fs_create_dir,
            bridge::fs_remove,
            bridge::fs_exists,
            bridge::close_app,
            backup::backup_workspace,
            health::check_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running RecallStack");
}
