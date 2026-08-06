use crate::AppState;
use chrono::Utc;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

const RECENTS_FILE: &str = "recent-workspaces.json";
const DATA_DIR: &str = "Data";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub path: String,
    pub name: String,
    pub has_data_directory: bool,
    pub note_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub modified_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub path: String,
    pub name: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub snippet: String,
}

#[derive(Deserialize, Serialize)]
struct RecentWorkspace {
    path: String,
    pinned: bool,
    opened_at: i64,
}

/// Keeps the native watcher alive for the selected workspace.
pub struct WorkspaceWatcher {
    _watcher: RecommendedWatcher,
}

fn err(message: impl Into<String>) -> String {
    message.into()
}

fn is_safe_relative(path: &str) -> bool {
    let value = Path::new(path);
    !value.is_absolute()
        && value
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn active_workspace(state: &State<'_, Arc<AppState>>) -> Result<PathBuf, String> {
    state
        .workspace
        .lock()
        .clone()
        .ok_or_else(|| err("No workspace is open"))
}

fn data_path(root: &Path) -> PathBuf {
    root.join(DATA_DIR)
}

fn note_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    if !is_safe_relative(relative_path) || !relative_path.ends_with(".md") {
        return Err(err("Only safe relative Markdown paths are allowed"));
    }
    Ok(data_path(root).join(relative_path))
}

fn relative_from_data(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(data_path(root))
        .map_err(|_| err("Path is outside the workspace Data directory"))?
        .to_string_lossy()
        .replace('\\', "/")
        .pipe(Ok)
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}
impl<T> Pipe for T {}

fn db_path(root: &Path) -> PathBuf {
    root.join("DB").join("index.db")
}

fn open_db(root: &Path) -> Result<Connection, String> {
    let path = db_path(root);
    fs::create_dir_all(path.parent().expect("DB has parent")).map_err(|e| e.to_string())?;
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS rs_notes (
           path TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', modified_at INTEGER NOT NULL
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS rs_notes_fts USING fts5(path UNINDEXED, title, body, tags);"
    ).map_err(|e| e.to_string())?;
    Ok(db)
}

fn tags_from_markdown(content: &str) -> String {
    content
        .split_whitespace()
        .filter_map(|word| word.strip_prefix('#'))
        .filter(|tag| {
            !tag.is_empty()
                && tag
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        })
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(" ")
}

fn index_note(root: &Path, relative_path: &str, content: &str) -> Result<(), String> {
    let title = content
        .lines()
        .find_map(|line| line.strip_prefix("# "))
        .unwrap_or_else(|| {
            Path::new(relative_path)
                .file_stem()
                .and_then(|x| x.to_str())
                .unwrap_or(relative_path)
        });
    let tags = tags_from_markdown(content);
    let modified_at = Utc::now().timestamp();
    let db = open_db(root)?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM rs_notes_fts WHERE path = ?1", [relative_path])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO rs_notes_fts(path, title, body, tags) VALUES (?1, ?2, ?3, ?4)",
        params![relative_path, title, content, tags],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT OR REPLACE INTO rs_notes(path, title, body, tags, modified_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![relative_path, title, content, tags, modified_at]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn count_notes(root: &Path) -> usize {
    WalkDir::new(data_path(root))
        .into_iter()
        .filter_map(Result::ok)
        .filter(|item| {
            item.file_type().is_file()
                && item
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        })
        .count()
}

fn recents_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(RECENTS_FILE))
}

fn load_recents(app: &AppHandle) -> Result<Vec<RecentWorkspace>, String> {
    let path = recents_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn save_recent(app: &AppHandle, workspace: &Path) -> Result<(), String> {
    let path = recents_path(app)?;
    let value = workspace.to_string_lossy().to_string();
    let mut entries = load_recents(app)?;
    let pinned = entries
        .iter()
        .find(|x| x.path == value)
        .is_some_and(|x| x.pinned);
    entries.retain(|x| x.path != value);
    entries.push(RecentWorkspace {
        path: value,
        pinned,
        opened_at: Utc::now().timestamp(),
    });
    entries.sort_by_key(|x| (!x.pinned, -x.opened_at));
    entries.truncate(12);
    fs::write(
        path,
        serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn watch_workspace(app: &AppHandle, state: &Arc<AppState>, root: PathBuf) -> Result<(), String> {
    let app_handle = app.clone();
    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            let paths = event
                .paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect::<Vec<_>>();
            let _ = app_handle.emit("workspace://changed", paths);
        }
    })
    .map_err(|e| e.to_string())?;
    let mut watcher = watcher;
    watcher
        .watch(&root.join(DATA_DIR), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *state.watcher.lock() = Some(WorkspaceWatcher { _watcher: watcher });
    Ok(())
}

#[tauri::command]
pub fn workspace_summary(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<WorkspaceSummary>, String> {
    let Some(path) = state.workspace.lock().clone() else {
        return Ok(None);
    };
    Ok(Some(summary(&path)))
}

#[tauri::command]
pub async fn pick_workspace(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Open RecallStack workspace")
            .blocking_pick_folder()
            .map(|path| {
                path.into_path()
                    .map(|path| path.to_string_lossy().to_string())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

fn summary(path: &Path) -> WorkspaceSummary {
    WorkspaceSummary {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("Workspace")
            .to_string(),
        has_data_directory: data_path(path).is_dir(),
        note_count: count_notes(path),
    }
}

#[tauri::command]
pub fn set_workspace(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<WorkspaceSummary, String> {
    let root = fs::canonicalize(&path).map_err(|e| format!("Cannot open workspace: {e}"))?;
    if !root.is_dir() {
        return Err(err("The selected workspace is not a directory"));
    }
    if !data_path(&root).is_dir() {
        return Err(err("RecallStack workspaces must contain a Data/ directory"));
    }
    *state.workspace.lock() = Some(root.clone());
    save_recent(&app, &root)?;
    watch_workspace(&app, state.inner(), root.clone())?;
    Ok(summary(&root))
}

#[tauri::command]
pub fn recent_workspaces(app: AppHandle) -> Result<Vec<WorkspaceSummary>, String> {
    Ok(load_recents(&app)?
        .into_iter()
        .filter_map(|item| {
            let path = PathBuf::from(item.path);
            path.is_dir().then(|| summary(&path))
        })
        .collect())
}

#[tauri::command]
pub fn list_entries(
    state: State<'_, Arc<AppState>>,
    path: Option<String>,
    recursive: Option<bool>,
) -> Result<Vec<Entry>, String> {
    let root = active_workspace(&state)?;
    let relative = path.unwrap_or_default();
    if !relative.is_empty() && !is_safe_relative(&relative) {
        return Err(err("Invalid folder path"));
    }
    let directory = data_path(&root).join(relative);
    if recursive.unwrap_or(false) {
        let mut entries = WalkDir::new(&directory)
            .into_iter()
            .filter_map(Result::ok)
            .filter_map(|entry| {
                if !entry.file_type().is_file()
                    || !entry
                        .path()
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
                    || entry
                        .path()
                        .to_string_lossy()
                        .contains(".recallstack-trash")
                {
                    return None;
                }
                let path = entry
                    .path()
                    .strip_prefix(data_path(&root))
                    .ok()?
                    .to_string_lossy()
                    .replace('\\', "/");
                let name = entry.file_name().to_string_lossy().to_string();
                let modified_at = entry
                    .metadata()
                    .ok()?
                    .modified()
                    .ok()?
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|x| x.as_secs() as i64);
                Some(Entry {
                    path,
                    name,
                    is_dir: false,
                    modified_at,
                })
            })
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.path.to_lowercase());
        return Ok(entries);
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let is_dir = file_type.is_dir();
            if !is_dir
                && !entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name == ".recallstack-trash" {
                return None;
            }
            let rel = entry
                .path()
                .strip_prefix(data_path(&root))
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            let modified_at = entry
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|x| x.as_secs() as i64);
            Some(Entry {
                path: rel,
                name,
                is_dir,
                modified_at,
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
pub fn read_note(state: State<'_, Arc<AppState>>, path: String) -> Result<Note, String> {
    let root = active_workspace(&state)?;
    let note = note_path(&root, &path)?;
    Ok(Note {
        name: note
            .file_stem()
            .and_then(|x| x.to_str())
            .unwrap_or("Untitled")
            .to_string(),
        path,
        content: fs::read_to_string(note).map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
pub fn write_note(
    state: State<'_, Arc<AppState>>,
    path: String,
    content: String,
) -> Result<(), String> {
    let root = active_workspace(&state)?;
    let note = note_path(&root, &path)?;
    if !note.exists() {
        return Err(err("Note does not exist; use create_note"));
    }
    fs::write(note, &content).map_err(|e| e.to_string())?;
    index_note(&root, &path, &content)
}

#[tauri::command]
pub fn create_note(
    state: State<'_, Arc<AppState>>,
    path: String,
    content: String,
) -> Result<Note, String> {
    let root = active_workspace(&state)?;
    let note = note_path(&root, &path)?;
    if note.exists() {
        return Err(err("A note with that name already exists"));
    }
    fs::create_dir_all(note.parent().expect("note has parent")).map_err(|e| e.to_string())?;
    fs::write(&note, &content).map_err(|e| e.to_string())?;
    index_note(&root, &path, &content)?;
    Ok(Note {
        name: note
            .file_stem()
            .and_then(|x| x.to_str())
            .unwrap_or("Untitled")
            .to_string(),
        path,
        content,
    })
}

#[tauri::command]
pub fn move_to_trash(state: State<'_, Arc<AppState>>, path: String) -> Result<String, String> {
    let root = active_workspace(&state)?;
    let source = note_path(&root, &path)?;
    if !source.exists() {
        return Err(err("Note no longer exists"));
    }
    let destination = data_path(&root).join(".recallstack-trash").join(format!(
        "{}-{}",
        Utc::now().format("%Y%m%d-%H%M%S"),
        path
    ));
    fs::create_dir_all(destination.parent().expect("trash destination has parent"))
        .map_err(|e| e.to_string())?;
    fs::rename(source, &destination).map_err(|e| e.to_string())?;
    let db = open_db(&root)?;
    db.execute("DELETE FROM rs_notes WHERE path = ?1", [&path])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_notes_fts WHERE path = ?1", [&path])
        .map_err(|e| e.to_string())?;
    Ok(destination.to_string_lossy().to_string())
}

fn rebuild_index_inner(root: &Path) -> Result<usize, String> {
    let db = open_db(root)?;
    db.execute("DELETE FROM rs_notes", [])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_notes_fts", [])
        .map_err(|e| e.to_string())?;
    drop(db);
    let mut count = 0;
    for item in WalkDir::new(data_path(root))
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = item.path();
        if !item.file_type().is_file()
            || !path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            || path.to_string_lossy().contains(".recallstack-trash")
        {
            continue;
        }
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let relative = relative_from_data(root, path)?;
        index_note(root, &relative, &content)?;
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
pub fn rebuild_index(state: State<'_, Arc<AppState>>) -> Result<usize, String> {
    rebuild_index_inner(&active_workspace(&state)?)
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    let root = active_workspace(&state)?;
    let db = open_db(&root)?;
    let terms = query
        .split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" AND ");
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let mut statement = db.prepare("SELECT path, title, snippet(rs_notes_fts, 2, '<mark>', '</mark>', '…', 16) FROM rs_notes_fts WHERE rs_notes_fts MATCH ?1 ORDER BY rank LIMIT 80").map_err(|e| e.to_string())?;
    let results = statement
        .query_map([terms], |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                name: row.get(1)?,
                snippet: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(results)
}

#[tauri::command]
pub fn reveal_path(state: State<'_, Arc<AppState>>, path: Option<String>) -> Result<(), String> {
    let root = active_workspace(&state)?;
    let target = match path {
        Some(path) => note_path(&root, &path)?,
        None => root,
    };
    tauri_plugin_opener::reveal_item_in_dir(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_workspace_folder(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    reveal_path(state, None)
}
