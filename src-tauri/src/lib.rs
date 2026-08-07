mod commands;

use commands::{backup, bridge, health, workspace};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Manager;

pub struct AppState {
    pub workspace: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<workspace::WorkspaceWatcher>>,
    pub watcher_health: Mutex<String>,
    internal_writes: Mutex<HashMap<String, Instant>>,
    watcher_sequences: Mutex<HashMap<String, u64>>,
    watcher_generation: Mutex<u64>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace: Mutex::new(None),
            watcher: Mutex::new(None),
            watcher_health: Mutex::new("stopped".to_string()),
            internal_writes: Mutex::new(HashMap::new()),
            watcher_sequences: Mutex::new(HashMap::new()),
            watcher_generation: Mutex::new(0),
        }
    }
}

impl AppState {
    pub fn record_internal_write(&self, relative_path: &str) {
        let now = Instant::now();
        let mut writes = self.internal_writes.lock();
        writes.retain(|_, recorded| now.duration_since(*recorded) < Duration::from_secs(2));
        writes.insert(relative_path.replace('\\', "/"), now);
    }

    pub fn is_recent_internal_write(&self, relative_path: &str) -> bool {
        let now = Instant::now();
        let mut writes = self.internal_writes.lock();
        writes.retain(|_, recorded| now.duration_since(*recorded) < Duration::from_secs(2));
        writes
            .get(&relative_path.replace('\\', "/"))
            .is_some_and(|recorded| now.duration_since(*recorded) < Duration::from_millis(900))
    }

    pub fn next_watcher_sequence(&self, workspace_id: &str) -> u64 {
        let mut sequences = self.watcher_sequences.lock();
        let sequence = sequences.entry(workspace_id.to_string()).or_default();
        *sequence = sequence.saturating_add(1);
        *sequence
    }

    pub fn start_watcher_generation(&self) -> u64 {
        let mut generation = self.watcher_generation.lock();
        *generation = generation.saturating_add(1);
        *generation
    }

    pub fn is_current_watcher_generation(&self, generation: u64) -> bool {
        *self.watcher_generation.lock() == generation
    }
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
            workspace::reconcile_workspace,
            workspace::rebuild_index,
            workspace::search_notes,
            workspace::task_files,
            workspace::reveal_path,
            workspace::open_workspace_folder,
            bridge::fs_list,
            bridge::fs_stat,
            bridge::fs_read,
            bridge::fs_read_text,
            bridge::fs_read_text_versioned,
            bridge::fs_write,
            bridge::fs_write_text,
            bridge::fs_write_text_versioned,
            bridge::fs_create_dir,
            bridge::fs_remove,
            bridge::fs_exists,
            bridge::portable_read_text,
            bridge::close_app,
            backup::backup_workspace,
            health::check_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running RecallStack");
}
