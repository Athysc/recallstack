use crate::AppState;
use chrono::Utc;
use notify::event::{MetadataKind, ModifyKind};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, UNIX_EPOCH};
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
    pub note_count: Option<usize>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFileResult {
    pub path: String,
    pub folder: String,
    pub name: String,
    pub content: String,
    pub modified_at: i64,
    pub in_working: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IndexStatus {
    state: String,
    indexed: usize,
    duration_ms: u128,
    error: Option<String>,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceChange {
    kind: String,
    path: String,
    entity: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceChangeBatch {
    sequence: u64,
    changes: Vec<WorkspaceChange>,
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
    db.busy_timeout(Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS rs_notes (
           path TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', modified_at INTEGER NOT NULL,
           size INTEGER NOT NULL DEFAULT 0, modified_ns TEXT NOT NULL DEFAULT ''
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS rs_notes_fts USING fts5(path UNINDEXED, title, body, tags);"
    ).map_err(|e| e.to_string())?;
    let columns = db
        .prepare("PRAGMA table_info(rs_notes)")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<HashSet<_>, _>>()
        })
        .map_err(|e| e.to_string())?;
    if !columns.contains("size") {
        db.execute(
            "ALTER TABLE rs_notes ADD COLUMN size INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    if !columns.contains("modified_ns") {
        db.execute(
            "ALTER TABLE rs_notes ADD COLUMN modified_ns TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(db)
}

fn file_metadata(path: &Path) -> Result<(u64, String, i64), String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok((
        metadata.len(),
        duration.as_nanos().to_string(),
        duration.as_secs() as i64,
    ))
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
    let (size, modified_ns, modified_at) = file_metadata(&note_path(root, relative_path)?)?;
    let db = open_db(root)?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM rs_notes_fts WHERE path = ?1", [relative_path])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO rs_notes_fts(path, title, body, tags) VALUES (?1, ?2, ?3, ?4)",
        params![relative_path, title, content, tags],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT OR REPLACE INTO rs_notes(path, title, body, tags, modified_at, size, modified_ns) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![relative_path, title, content, tags, modified_at, size, modified_ns]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
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

fn normalized_event_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Remove(_) => Some("remove"),
        EventKind::Modify(ModifyKind::Name(_)) => Some("rename"),
        EventKind::Modify(ModifyKind::Any | ModifyKind::Data(_)) => Some("modify"),
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any | MetadataKind::WriteTime)) => {
            Some("modify")
        }
        // Reads and handle opens are explicitly non-mutating. Passing them to
        // the indexer makes its own read generate another watcher event.
        EventKind::Access(_) | EventKind::Any | EventKind::Other => None,
        EventKind::Modify(_) => None,
    }
}

fn entity_kind(path: &Path) -> &'static str {
    if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    {
        "markdown"
    } else if path.extension().is_some() {
        "asset"
    } else {
        "directory"
    }
}

fn update_index_path(root: &Path, path: &Path) -> Result<(), String> {
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        || path.to_string_lossy().contains(".recallstack-trash")
    {
        return Ok(());
    }
    let relative = relative_from_data(root, path)?;
    if path.exists() {
        index_note(
            root,
            &relative,
            &fs::read_to_string(path).map_err(|e| e.to_string())?,
        )
    } else {
        let db = open_db(root)?;
        db.execute("DELETE FROM rs_notes_fts WHERE path = ?1", [&relative])
            .map_err(|e| e.to_string())?;
        db.execute("DELETE FROM rs_notes WHERE path = ?1", [&relative])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn watch_workspace(app: &AppHandle, state: &Arc<AppState>, root: PathBuf) -> Result<(), String> {
    let (sender, receiver) = std::sync::mpsc::channel::<notify::Event>();
    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if normalized_event_kind(&event.kind).is_some() {
                let _ = sender.send(event);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    let mut watcher = watcher;
    watcher
        .watch(&root.join(DATA_DIR), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    let apps_path = root.join("Apps");
    if apps_path.is_dir() {
        let _ = watcher.watch(&apps_path, RecursiveMode::NonRecursive);
    }
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut sequence = 0_u64;
        while let Ok(first) = receiver.recv() {
            let mut events = vec![first];
            while let Ok(event) = receiver.recv_timeout(Duration::from_millis(200)) {
                events.push(event);
            }
            let mut changes = HashMap::<String, WorkspaceChange>::new();
            for event in events {
                let Some(kind) = normalized_event_kind(&event.kind) else {
                    continue;
                };
                for path in event.paths {
                    let Ok(relative) = path.strip_prefix(&root) else {
                        continue;
                    };
                    let relative = relative.to_string_lossy().replace('\\', "/");
                    changes.insert(
                        relative.clone(),
                        WorkspaceChange {
                            kind: kind.to_string(),
                            path: relative,
                            entity: entity_kind(&path).to_string(),
                        },
                    );
                    let _ = update_index_path(&root, &path);
                }
            }
            if !changes.is_empty() {
                sequence += 1;
                let _ = app_handle.emit(
                    "workspace://changed",
                    WorkspaceChangeBatch {
                        sequence,
                        changes: changes.into_values().collect(),
                    },
                );
            }
        }
    });
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
        note_count: None,
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
    fs::create_dir_all(root.join("Apps"))
        .map_err(|e| format!("Could not prepare the workspace Apps directory: {e}"))?;
    *state.workspace.lock() = Some(root.clone());
    save_recent(&app, &root)?;
    drop(open_db(&root)?);
    watch_workspace(&app, state.inner(), root.clone())?;
    let result = summary(&root);
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let _ = app_handle.emit(
            "index://status",
            IndexStatus {
                state: "indexing".into(),
                indexed: 0,
                duration_ms: 0,
                error: None,
            },
        );
        match reconcile_index(&root) {
            Ok(indexed) => {
                let _ = app_handle.emit(
                    "index://status",
                    IndexStatus {
                        state: "ready".into(),
                        indexed,
                        duration_ms: started.elapsed().as_millis(),
                        error: None,
                    },
                );
            }
            Err(error) => {
                let _ = app_handle.emit(
                    "index://status",
                    IndexStatus {
                        state: "error".into(),
                        indexed: 0,
                        duration_ms: started.elapsed().as_millis(),
                        error: Some(error),
                    },
                );
            }
        }
    });
    Ok(result)
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

fn reconcile_index(root: &Path) -> Result<usize, String> {
    let mut db = open_db(root)?;
    let existing = {
        let mut statement = db
            .prepare("SELECT path, size, modified_ns FROM rs_notes")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    (row.get::<_, u64>(1)?, row.get::<_, String>(2)?),
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let mut changed = Vec::new();
    let mut seen = HashSet::new();
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
        let relative = relative_from_data(root, path)?;
        let (size, modified_ns, modified_at) = file_metadata(path)?;
        seen.insert(relative.clone());
        if existing.get(&relative) != Some(&(size, modified_ns.clone())) {
            changed.push((
                relative,
                fs::read_to_string(path).map_err(|e| e.to_string())?,
                size,
                modified_ns,
                modified_at,
            ));
        }
    }
    let removed = existing
        .keys()
        .filter(|path| !seen.contains(*path))
        .cloned()
        .collect::<Vec<_>>();
    if changed.is_empty() && removed.is_empty() {
        return Ok(0);
    }
    let changed_count = changed.len();
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    for path in removed {
        transaction
            .execute("DELETE FROM rs_notes_fts WHERE path = ?1", [&path])
            .map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM rs_notes WHERE path = ?1", [&path])
            .map_err(|e| e.to_string())?;
    }
    for (path, content, size, modified_ns, modified_at) in changed {
        let title = content
            .lines()
            .find_map(|line| line.strip_prefix("# "))
            .unwrap_or_else(|| {
                Path::new(&path)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&path)
            });
        let tags = tags_from_markdown(&content);
        transaction
            .execute("DELETE FROM rs_notes_fts WHERE path = ?1", [&path])
            .map_err(|e| e.to_string())?;
        transaction
            .execute(
                "INSERT INTO rs_notes_fts(path, title, body, tags) VALUES (?1, ?2, ?3, ?4)",
                params![path, title, content, tags],
            )
            .map_err(|e| e.to_string())?;
        transaction
            .execute("INSERT OR REPLACE INTO rs_notes(path, title, body, tags, modified_at, size, modified_ns) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![path, title, content, tags, modified_at, size, modified_ns])
            .map_err(|e| e.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(changed_count)
}

fn rebuild_index_inner(root: &Path) -> Result<usize, String> {
    let db = open_db(root)?;
    db.execute("DELETE FROM rs_notes", [])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_notes_fts", [])
        .map_err(|e| e.to_string())?;
    drop(db);
    reconcile_index(root)
}

#[tauri::command]
pub fn rebuild_index(state: State<'_, Arc<AppState>>) -> Result<usize, String> {
    rebuild_index_inner(&active_workspace(&state)?)
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, Arc<AppState>>,
    query: String,
    prefix: Option<String>,
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
    let prefix = prefix
        .unwrap_or_default()
        .trim_start_matches('/')
        .to_string();
    let like_prefix = format!("{prefix}%");
    let mut statement = db.prepare("SELECT path, snippet(rs_notes_fts, 2, '', '', '…', 16) FROM rs_notes_fts WHERE rs_notes_fts MATCH ?1 AND path LIKE ?2 ORDER BY rank LIMIT 80").map_err(|e| e.to_string())?;
    let results = statement
        .query_map(params![terms, like_prefix], |row| {
            let indexed_path: String = row.get(0)?;
            let path = indexed_path
                .strip_prefix(&prefix)
                .unwrap_or(&indexed_path)
                .trim_start_matches('/')
                .to_string();
            let name = Path::new(&path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&path)
                .to_string();
            Ok(SearchResult {
                path,
                name,
                snippet: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(results)
}

#[tauri::command]
pub fn task_files(
    state: State<'_, Arc<AppState>>,
    prefix: Option<String>,
) -> Result<Vec<TaskFileResult>, String> {
    let root = active_workspace(&state)?;
    let db = open_db(&root)?;
    let prefix = prefix
        .unwrap_or_default()
        .trim_start_matches('/')
        .to_string();
    let like_prefix = format!("{prefix}%/tasks/%");
    let mut statement = db
        .prepare("SELECT path, body, modified_at FROM rs_notes WHERE path LIKE ?1 ORDER BY path")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([like_prefix], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        let (indexed_path, content, modified_at) = row.map_err(|e| e.to_string())?;
        let relative = indexed_path
            .strip_prefix(&prefix)
            .unwrap_or(&indexed_path)
            .trim_start_matches('/');
        let parts = relative.split('/').collect::<Vec<_>>();
        let (folder, name, in_working) = match parts.as_slice() {
            [folder, "tasks", name] if name.ends_with(".md") => (*folder, *name, false),
            [folder, "tasks", "working", name] if name.ends_with(".md") => (*folder, *name, true),
            _ => continue,
        };
        results.push(TaskFileResult {
            path: relative.to_string(),
            folder: folder.to_string(),
            name: name.to_string(),
            content,
            modified_at: modified_at.saturating_mul(1000),
            in_working,
        });
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, AccessMode, DataChange, ModifyKind};

    fn temporary_workspace(name: &str) -> PathBuf {
        let unique = format!(
            "recallstack-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        fs::create_dir_all(root.join("Data/notes")).expect("fixture directories");
        root
    }

    #[test]
    fn watcher_filters_non_mutating_access_events() {
        assert_eq!(
            normalized_event_kind(&EventKind::Access(AccessKind::Read)),
            None
        );
        assert_eq!(
            normalized_event_kind(&EventKind::Access(AccessKind::Open(AccessMode::Read))),
            None
        );
        assert_eq!(
            normalized_event_kind(&EventKind::Modify(ModifyKind::Data(DataChange::Content))),
            Some("modify")
        );
        assert_eq!(
            normalized_event_kind(&EventKind::Create(notify::event::CreateKind::File)),
            Some("create")
        );
        assert_eq!(
            normalized_event_kind(&EventKind::Remove(notify::event::RemoveKind::File)),
            Some("remove")
        );
    }

    #[test]
    fn native_index_reconciles_only_changed_markdown() {
        let root = temporary_workspace("incremental-index");
        let first = root.join("Data/notes/first.md");
        let second = root.join("Data/notes/second.md");
        fs::write(&first, "# First\n\n#alpha").expect("first note");
        fs::write(&second, "# Second\n\nBody").expect("second note");

        assert_eq!(reconcile_index(&root).expect("initial index"), 2);
        assert_eq!(reconcile_index(&root).expect("warm index"), 0);

        fs::write(&first, "# First changed\n\n#beta").expect("changed note");
        assert_eq!(reconcile_index(&root).expect("incremental index"), 1);

        fs::remove_file(&second).expect("remove second note");
        assert_eq!(reconcile_index(&root).expect("remove stale row"), 0);
        let db = open_db(&root).expect("open index");
        let remaining: usize = db
            .query_row("SELECT count(*) FROM rs_notes", [], |row| row.get(0))
            .expect("remaining count");
        assert_eq!(remaining, 1);

        fs::remove_dir_all(&root).expect("remove fixture");
    }

    #[test]
    fn benchmark_native_index_cold_and_warm() {
        let root = temporary_workspace("index-benchmark");
        for index in 0..1_000 {
            let folder = root.join(format!("Data/notes/folder-{}", index % 20));
            fs::create_dir_all(&folder).expect("benchmark folder");
            fs::write(
                folder.join(format!("note-{index:04}.md")),
                format!(
                    "# Synthetic Note {index}\n\n#benchmark\n\n{}",
                    "body ".repeat(40)
                ),
            )
            .expect("benchmark note");
        }

        let cold_started = Instant::now();
        let cold_changed = reconcile_index(&root).expect("cold index");
        let cold_ms = cold_started.elapsed().as_millis();
        let warm_started = Instant::now();
        let warm_changed = reconcile_index(&root).expect("warm index");
        let warm_ms = warm_started.elapsed().as_millis();

        eprintln!(
            "PERF native_index notes=1000 cold_ms={cold_ms} warm_ms={warm_ms} cold_changed={cold_changed} warm_changed={warm_changed}"
        );
        assert_eq!(cold_changed, 1_000);
        assert_eq!(warm_changed, 0);
        fs::remove_dir_all(&root).expect("remove benchmark fixture");
    }
}
