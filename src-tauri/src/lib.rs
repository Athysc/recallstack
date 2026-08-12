mod commands;

use commands::{backup, bridge, health, safety, workspace};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Manager;

fn parse_byte_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let range = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(size);
        return (suffix > 0).then_some((size - suffix, size.saturating_sub(1)));
    }
    let start = start.parse::<u64>().ok()?;
    if start >= size {
        return None;
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().ok()?.min(size - 1)
    };
    (start <= end).then_some((start, end))
}

fn read_asset_range(path: &std::path::Path, range: Option<(u64, u64)>) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    if let Some((start, end)) = range {
        file.seek(SeekFrom::Start(start))
            .map_err(|error| error.to_string())?;
        let mut body = vec![0; (end - start + 1) as usize];
        file.read_exact(&mut body)
            .map_err(|error| error.to_string())?;
        Ok(body)
    } else {
        let mut body = Vec::new();
        file.read_to_end(&mut body)
            .map_err(|error| error.to_string())?;
        Ok(body)
    }
}

fn asset_content_type(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn asset_request_path(uri_path: &str) -> Result<String, String> {
    percent_encoding::percent_decode_str(uri_path.trim_start_matches('/'))
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| "Asset URL is not valid UTF-8".to_string())
}

pub struct AppState {
    pub workspace: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<workspace::WorkspaceWatcher>>,
    pub watcher_health: Mutex<String>,
    internal_writes: Mutex<HashMap<String, Instant>>,
    watcher_sequences: Mutex<HashMap<String, u64>>,
    watcher_generation: Mutex<u64>,
    pub backup_cancel: AtomicBool,
    pub index_cancel: AtomicBool,
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
            backup_cancel: AtomicBool::new(false),
            index_cancel: AtomicBool::new(false),
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .register_uri_scheme_protocol("recallstack-asset", |context, request| {
            let response = (|| {
                let relative = asset_request_path(request.uri().path())?;
                let state = context.app_handle().state::<Arc<AppState>>();
                let path = bridge::safe_path(&state, &relative)?;
                if !path.is_file() {
                    return Err("Asset does not exist".to_string());
                }
                let size = std::fs::metadata(&path)
                    .map_err(|error| error.to_string())?
                    .len();
                let range = request
                    .headers()
                    .get("Range")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| parse_byte_range(value, size));
                let content_type = asset_content_type(&path);
                let body = read_asset_range(&path, range)?;
                let mut response = tauri::http::Response::builder()
                    .status(if range.is_some() { 206 } else { 200 })
                    .header("Content-Type", content_type)
                    .header("Cache-Control", "no-store")
                    .header("X-Content-Type-Options", "nosniff")
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Accept-Ranges", "bytes");
                if let Some((start, end)) = range {
                    response =
                        response.header("Content-Range", format!("bytes {start}-{end}/{size}"));
                }
                response.body(body).map_err(|error| error.to_string())
            })();
            response.unwrap_or_else(|message| {
                tauri::http::Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain; charset=utf-8")
                    .header("X-Content-Type-Options", "nosniff")
                    .body(message.into_bytes())
                    .expect("static asset error response")
            })
        });
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    builder
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
            workspace::remove_recent_workspace,
            workspace::list_entries,
            workspace::read_note,
            workspace::write_note,
            workspace::create_note,
            workspace::move_to_trash,
            workspace::reconcile_workspace,
            workspace::index_health,
            workspace::rebuild_index,
            workspace::cancel_index,
            workspace::search_notes,
            workspace::search_knowledge,
            workspace::indexed_note_catalog,
            workspace::backlinks,
            workspace::list_saved_searches,
            workspace::save_search,
            workspace::delete_saved_search,
            workspace::task_files,
            workspace::reveal_path,
            workspace::open_workspace_folder,
            bridge::fs_list,
            bridge::fs_list_recursive,
            bridge::fs_referenced_assets,
            bridge::fs_rename,
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
            bridge::external_fs_stat,
            bridge::external_fs_read_text,
            bridge::external_fs_write_text,
            bridge::close_app,
            safety::trash_path,
            safety::list_trash,
            safety::restore_trash,
            safety::empty_trash,
            safety::list_versions,
            safety::restore_version,
            safety::save_draft,
            safety::load_draft,
            safety::clear_draft,
            backup::backup_workspace,
            backup::cancel_backup,
            backup::verify_backup,
            backup::restore_backup_dry_run,
            health::check_workspace,
            health::git_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running RecallStack");
}

#[cfg(test)]
mod asset_protocol_tests {
    use super::*;

    #[test]
    fn asset_request_paths_decode_spaces_without_normalizing_traversal() {
        assert_eq!(
            asset_request_path("/Data/notes/assets/My%20Image.png").unwrap(),
            "Data/notes/assets/My Image.png"
        );
        assert_eq!(
            asset_request_path("/%2e%2e/secret.txt").unwrap(),
            "../secret.txt"
        );
    }

    #[test]
    fn asset_content_types_are_bounded() {
        assert_eq!(
            asset_content_type(std::path::Path::new("image.svg")),
            "image/svg+xml"
        );
        assert_eq!(
            asset_content_type(std::path::Path::new("payload.html")),
            "application/octet-stream"
        );
    }

    #[test]
    fn byte_ranges_are_bounded_to_the_asset() {
        assert_eq!(parse_byte_range("bytes=2-5", 10), Some((2, 5)));
        assert_eq!(parse_byte_range("bytes=7-", 10), Some((7, 9)));
        assert_eq!(parse_byte_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(parse_byte_range("bytes=20-30", 10), None);
    }
}
