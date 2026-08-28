use crate::error_log::{logged, logged_async};
use crate::{commands::safety, AppState};
use chrono::Utc;
use notify::event::{MetadataKind, ModifyKind};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::types::Value;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

const RECENTS_FILE: &str = "recent-workspaces.json";
const MAX_RECENT_WORKSPACES: usize = 6;
const DATA_DIR: &str = "Data";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
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
pub struct KnowledgeSearchResult {
    pub path: String,
    pub name: String,
    pub title: String,
    pub snippet: String,
    pub tags: Vec<String>,
    pub kind: String,
    pub folder: String,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub modified_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchPage {
    pub results: Vec<KnowledgeSearchResult>,
    pub total: usize,
    pub offset: usize,
    pub has_more: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedNoteSummary {
    pub path: String,
    pub name: String,
    pub title: String,
    pub tags: Vec<String>,
    pub kind: String,
    pub modified_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkResult {
    pub source_path: String,
    pub source_title: String,
    pub anchor: Option<String>,
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearch {
    pub id: i64,
    pub name: String,
    pub query: String,
    pub sort_order: i64,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexHealth {
    pub schema_version: i64,
    pub files: usize,
    pub tags: usize,
    pub links: usize,
    pub last_reconciled: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_path: Option<String>,
    entity: String,
    internal: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceChangeBatch {
    workspace_id: String,
    sequence: u64,
    occurred_at: i64,
    overflowed: bool,
    changes: Vec<WorkspaceChange>,
}

enum WatcherMessage {
    Event(notify::Event),
    Error(String),
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

fn workspace_id(root: &Path) -> String {
    // Deterministic FNV-1a avoids using process-random hash state, so the same
    // canonical workspace path has the same identity across launches.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in root.to_string_lossy().replace('\\', "/").as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("ws-{hash:016x}")
}

fn relative_from_workspace(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map_err(|_| err("Path is outside the workspace"))?
        .to_string_lossy()
        .replace('\\', "/")
        .pipe(Ok)
}

fn note_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    if !is_safe_relative(relative_path) || !relative_path.ends_with(".md") {
        return Err(err("Only safe relative Markdown paths are allowed"));
    }
    let mut candidate = data_path(root);
    if candidate.exists()
        && fs::symlink_metadata(&candidate)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err(err("Symbolic links are not allowed in native note paths"));
    }
    for component in Path::new(relative_path).components() {
        if let Component::Normal(part) = component {
            candidate.push(part);
            if candidate.exists()
                && fs::symlink_metadata(&candidate)
                    .map_err(|error| error.to_string())?
                    .file_type()
                    .is_symlink()
            {
                return Err(err("Symbolic links are not allowed in native note paths"));
            }
        }
    }
    Ok(candidate)
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
    let previous_version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS rs_notes (
           path TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', modified_at INTEGER NOT NULL,
           size INTEGER NOT NULL DEFAULT 0, modified_ns TEXT NOT NULL DEFAULT '',
           content_hash TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'note', folder TEXT NOT NULL DEFAULT '',
           status TEXT, priority TEXT, start_date TEXT, due_date TEXT, completed_date TEXT, created_date TEXT
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS rs_notes_fts USING fts5(path UNINDEXED, title, body, tags, tokenize='trigram case_sensitive 0');
         CREATE TABLE IF NOT EXISTS rs_tags(path TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(path, tag));
         CREATE INDEX IF NOT EXISTS rs_tags_tag ON rs_tags(tag);
         CREATE TABLE IF NOT EXISTS rs_links(source_path TEXT NOT NULL, target_path TEXT NOT NULL, anchor TEXT, kind TEXT NOT NULL, PRIMARY KEY(source_path, target_path, anchor, kind));
         CREATE INDEX IF NOT EXISTS rs_links_target ON rs_links(target_path);
         CREATE TABLE IF NOT EXISTS rs_saved_searches(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, query TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE IF NOT EXISTS rs_index_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
         PRAGMA user_version=3;"
    ).map_err(|e| e.to_string())?;
    // Pre-existing rs_notes_fts tables were created with the default (word-token)
    // tokenizer. Rebuild the FTS shadow table with the trigram tokenizer so search
    // matches substrings case-insensitively (e.g. "geico" inside "GEICOClaim"),
    // repopulating it from rs_notes' plain columns rather than rescanning disk.
    if previous_version < 3 {
        db.execute_batch(
            "DROP TABLE IF EXISTS rs_notes_fts;
             CREATE VIRTUAL TABLE rs_notes_fts USING fts5(path UNINDEXED, title, body, tags, tokenize='trigram case_sensitive 0');
             INSERT INTO rs_notes_fts(path, title, body, tags) SELECT path, title, body, tags FROM rs_notes;",
        )
        .map_err(|e| e.to_string())?;
    }
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
    for (name, definition) in [
        ("content_hash", "TEXT NOT NULL DEFAULT ''"),
        ("kind", "TEXT NOT NULL DEFAULT 'note'"),
        ("folder", "TEXT NOT NULL DEFAULT ''"),
        ("status", "TEXT"),
        ("priority", "TEXT"),
        ("start_date", "TEXT"),
        ("due_date", "TEXT"),
        ("completed_date", "TEXT"),
        ("created_date", "TEXT"),
    ] {
        if !columns.contains(name) {
            db.execute(
                &format!("ALTER TABLE rs_notes ADD COLUMN {name} {definition}"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
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

#[derive(Default)]
struct StructuredNote {
    kind: String,
    folder: String,
    status: Option<String>,
    priority: Option<String>,
    start_date: Option<String>,
    due_date: Option<String>,
    completed_date: Option<String>,
    created_date: Option<String>,
    tags: Vec<String>,
    links: Vec<(String, Option<String>, String)>,
    hash: String,
}

fn compact_date(value: &str) -> Option<String> {
    (value.len() == 8 && value.chars().all(|character| character.is_ascii_digit()))
        .then(|| format!("{}-{}-{}", &value[..4], &value[4..6], &value[6..8]))
}

fn task_filename_metadata(
    path: &str,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let stem = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let Some((_, encoded)) = stem.rsplit_once(" -- s") else {
        return (None, None, None, None);
    };
    let Some((start, remainder)) = encoded.split_once("_c") else {
        return (None, None, None, None);
    };
    let Some((completed, remainder)) = remainder.split_once("_due") else {
        return (None, None, None, None);
    };
    let Some((due, priority)) = remainder.rsplit_once('_') else {
        return (None, None, None, None);
    };
    (
        compact_date(start),
        compact_date(completed),
        compact_date(due),
        Some(priority.to_lowercase()),
    )
}

fn status_from_filename(path: &str) -> Option<String> {
    if path.contains(" - (Marked for Deployment)") {
        Some("deployment".into())
    } else if path.contains(" - (In QA Review)") {
        Some("qa".into())
    } else if path.contains(" - (Deployed ") {
        Some("deployed".into())
    } else if path.contains(" - (Backlog)") {
        Some("backlog".into())
    } else {
        None
    }
}

fn markdown_links(content: &str) -> Vec<(String, Option<String>, String)> {
    let mut links = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find("](") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find(')') else { break };
        let raw = rest[..end].split_whitespace().next().unwrap_or_default();
        rest = &rest[end + 1..];
        if raw.is_empty()
            || raw.starts_with('#')
            || raw.contains("://")
            || raw.starts_with("mailto:")
        {
            continue;
        }
        let (target, anchor) = raw.split_once('#').map_or((raw, None), |(target, anchor)| {
            (target, Some(anchor.to_string()))
        });
        links.push((target.replace('\\', "/"), anchor, "markdown".into()));
    }
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else { break };
        let raw = rest[..end].split('|').next().unwrap_or_default().trim();
        rest = &rest[end + 2..];
        if raw.is_empty() {
            continue;
        }
        let (target, anchor) = raw.split_once('#').map_or((raw, None), |(target, anchor)| {
            (target, Some(anchor.to_string()))
        });
        let target = if target.to_lowercase().ends_with(".md") {
            target.to_string()
        } else {
            format!("{target}.md")
        };
        links.push((target.replace('\\', "/"), anchor, "wiki".into()));
    }
    links
}

fn resolve_link_target(source_path: &str, target: &str, kind: &str) -> String {
    if kind == "wiki" || target.starts_with('/') {
        return target.trim_start_matches('/').to_string();
    }
    let mut parts = Path::new(source_path)
        .parent()
        .into_iter()
        .flat_map(Path::components)
        .filter_map(|part| match part {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>();
    for part in Path::new(target).components() {
        match part {
            Component::Normal(value) => parts.push(value.to_string_lossy().to_string()),
            Component::ParentDir => {
                parts.pop();
            }
            Component::CurDir => {}
            _ => return target.to_string(),
        }
    }
    parts.join("/")
}

fn structured_note(path: &str, content: &str) -> StructuredNote {
    let normalized = path.replace('\\', "/").to_lowercase();
    let parts = normalized.split('/').collect::<Vec<_>>();
    let working = parts.windows(2).any(|window| window == ["tasks", "working"]);
    let task = parts.windows(2).any(|window| window[0] == "tasks" && window[1].ends_with(".md")) || working;
    let kind = if working {
        "working"
    } else if task {
        "task"
    } else {
        "note"
    };
    let folder = Path::new(path)
        .parent()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let (start_date, completed_date, due_date, priority) = task_filename_metadata(path);
    let tags = tags_from_markdown(content)
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let created_date = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .and_then(|stem| {
            let prefix = stem.get(..10)?;
            (prefix.as_bytes().get(4) == Some(&b'-') && prefix.as_bytes().get(7) == Some(&b'-'))
                .then(|| prefix.to_string())
        });
    let links = markdown_links(content)
        .into_iter()
        .map(|(target, anchor, kind)| (resolve_link_target(path, &target, &kind), anchor, kind))
        .collect();
    StructuredNote {
        kind: kind.into(),
        folder,
        status: status_from_filename(path),
        priority,
        start_date,
        due_date,
        completed_date,
        created_date,
        tags,
        links,
        hash: format!("{:x}", Sha256::digest(content.as_bytes())),
    }
}

fn replace_structured(
    db: &Connection,
    path: &str,
    metadata: &StructuredNote,
) -> Result<(), String> {
    db.execute("DELETE FROM rs_tags WHERE path=?1", [path])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_links WHERE source_path=?1", [path])
        .map_err(|e| e.to_string())?;
    for tag in &metadata.tags {
        db.execute(
            "INSERT OR IGNORE INTO rs_tags(path, tag) VALUES (?1, ?2)",
            params![path, tag],
        )
        .map_err(|e| e.to_string())?;
    }
    for (target, anchor, kind) in &metadata.links {
        db.execute("INSERT OR IGNORE INTO rs_links(source_path, target_path, anchor, kind) VALUES (?1, ?2, ?3, ?4)", params![path, target, anchor, kind]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn remove_indexed_note(db: &Connection, path: &str) -> Result<(), String> {
    db.execute("DELETE FROM rs_notes_fts WHERE path=?1", [path])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_tags WHERE path=?1", [path])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_links WHERE source_path=?1", [path])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_notes WHERE path=?1", [path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn record_index_success(db: &Connection) -> Result<(), String> {
    db.execute("INSERT INTO rs_index_meta(key,value) VALUES('last_reconciled',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;
    Ok(())
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
    let structured = structured_note(relative_path, content);
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
    tx.execute("INSERT OR REPLACE INTO rs_notes(path, title, body, tags, modified_at, size, modified_ns, content_hash, kind, folder, status, priority, start_date, due_date, completed_date, created_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)", params![relative_path, title, content, tags, modified_at, size, modified_ns, structured.hash, structured.kind, structured.folder, structured.status, structured.priority, structured.start_date, structured.due_date, structured.completed_date, structured.created_date]).map_err(|e| e.to_string())?;
    replace_structured(&tx, relative_path, &structured)?;
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
    entries.truncate(MAX_RECENT_WORKSPACES);
    fs::write(
        path,
        serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn prepare_workspace(root: &Path) -> Result<(), String> {
    let create_starter_tree = !data_path(root).exists();
    fs::create_dir_all(data_path(root))
        .map_err(|e| format!("Could not prepare the workspace Data directory: {e}"))?;
    if create_starter_tree {
        fs::create_dir_all(data_path(root).join("notes/mynotes/notes"))
            .map_err(|e| format!("Could not prepare the starter notes directory: {e}"))?;
        fs::create_dir_all(data_path(root).join("notes/tasks"))
            .map_err(|e| format!("Could not prepare the starter tasks directory: {e}"))?;
        fs::create_dir_all(data_path(root).join("notes/dailylogs"))
            .map_err(|e| format!("Could not prepare the starter dailylogs directory: {e}"))?;
    }
    fs::create_dir_all(root.join("Apps"))
        .map_err(|e| format!("Could not prepare the workspace Apps directory: {e}"))?;
    drop(open_db(root)?);
    Ok(())
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
        remove_indexed_note(&db, &relative)
    }
}

fn watch_workspace(app: &AppHandle, state: &Arc<AppState>, root: PathBuf) -> Result<(), String> {
    let (sender, receiver) = std::sync::mpsc::channel::<WatcherMessage>();
    let watcher =
        notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
            Ok(event) if normalized_event_kind(&event.kind).is_some() => {
                let _ = sender.send(WatcherMessage::Event(event));
            }
            Ok(_) => {}
            Err(error) => {
                let _ = sender.send(WatcherMessage::Error(error.to_string()));
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
    for system_root in ["openbrain/outputs", "openbrain-shared/outputs"] {
        let path = root.join(system_root);
        if path.is_dir() {
            let _ = watcher.watch(&path, RecursiveMode::Recursive);
        }
    }
    let app_handle = app.clone();
    let watcher_state = Arc::clone(state);
    let active_workspace_id = workspace_id(&root);
    let watcher_generation = state.start_watcher_generation();
    state.reset_watcher_activity();
    *state.watcher_health.lock() = "running".to_string();
    std::thread::spawn(move || {
        while let Ok(first) = receiver.recv() {
            let mut events = vec![first];
            while let Ok(event) = receiver.recv_timeout(Duration::from_millis(200)) {
                events.push(event);
            }
            // While the window is hidden, keep draining the OS event channel so
            // it can't back up, but defer all indexing and emit nothing — just
            // remember that a catch-up reconcile is due when the app returns
            // (see set_foreground). This is the "pause while idle" path.
            let foreground = watcher_state.is_watcher_foreground();
            let mut changes = HashMap::<String, WorkspaceChange>::new();
            let mut overflowed = false;
            for message in events {
                let event = match message {
                    WatcherMessage::Event(event) => event,
                    WatcherMessage::Error(error) => {
                        overflowed = true;
                        if watcher_state.is_current_watcher_generation(watcher_generation) {
                            *watcher_state.watcher_health.lock() = format!("degraded: {error}");
                        }
                        continue;
                    }
                };
                let Some(kind) = normalized_event_kind(&event.kind) else {
                    continue;
                };
                if kind == "rename" && event.paths.len() >= 2 {
                    let source = &event.paths[0];
                    let destination = event.paths.last().expect("rename destination");
                    let (Ok(previous_path), Ok(path)) = (
                        relative_from_workspace(&root, source),
                        relative_from_workspace(&root, destination),
                    ) else {
                        continue;
                    };
                    let internal = watcher_state.is_recent_internal_write(&previous_path)
                        || watcher_state.is_recent_internal_write(&path);
                    changes.insert(
                        path.clone(),
                        WorkspaceChange {
                            kind: "rename".to_string(),
                            path,
                            previous_path: Some(previous_path),
                            entity: entity_kind(destination).to_string(),
                            internal,
                        },
                    );
                    if foreground {
                        let _ = update_index_path(&root, source);
                        let _ = update_index_path(&root, destination);
                    }
                    continue;
                }
                for path in event.paths {
                    let Ok(relative) = relative_from_workspace(&root, &path) else {
                        continue;
                    };
                    let change = WorkspaceChange {
                        kind: kind.to_string(),
                        path: relative.clone(),
                        previous_path: None,
                        entity: entity_kind(&path).to_string(),
                        internal: watcher_state.is_recent_internal_write(&relative),
                    };
                    coalesce_change(&mut changes, change);
                    if foreground && path.starts_with(data_path(&root)) {
                        let _ = update_index_path(&root, &path);
                    }
                }
            }
            if (!changes.is_empty() || overflowed) && !foreground {
                // Backgrounded: don't emit or advance the sequence — just note
                // that the frontend must reconcile on its next foreground.
                watcher_state.mark_watcher_missed_changes();
                continue;
            }
            if !changes.is_empty() || overflowed {
                let sequence = watcher_state.next_watcher_sequence(&active_workspace_id);
                let _ = app_handle.emit(
                    "workspace://changed",
                    WorkspaceChangeBatch {
                        workspace_id: active_workspace_id.clone(),
                        sequence,
                        occurred_at: Utc::now().timestamp_millis(),
                        overflowed,
                        changes: sorted_changes(changes),
                    },
                );
                // The native watcher is the first component to know that the
                // OS event stream overflowed. Recover here on a worker instead
                // of waiting for a possibly-suspended WebView to notice and
                // invoke a synchronous full-workspace scan on the UI thread.
                if overflowed {
                    schedule_reconcile(
                        app_handle.clone(),
                        Arc::clone(&watcher_state),
                        root.clone(),
                    );
                }
            }
        }
        if watcher_state.is_current_watcher_generation(watcher_generation) {
            *watcher_state.watcher_health.lock() = "stopped".to_string();
        }
    });
    *state.watcher.lock() = Some(WorkspaceWatcher { _watcher: watcher });
    Ok(())
}

#[tauri::command(async)]
pub fn workspace_summary(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<WorkspaceSummary>, String> {
    logged("workspace_summary", || {
        let Some(path) = state.workspace.lock().clone() else {
            return Ok(None);
        };
        Ok(Some(summary(&path)))
    })
}

#[tauri::command]
pub async fn pick_workspace(app: AppHandle) -> Result<Option<String>, String> {
    logged_async("pick_workspace", async {
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
    })
    .await
}

// `fs::canonicalize` returns Windows' verbatim `\\?\C:\...` extended-length form.
// That's fine for internal filesystem calls, but it's not the path a user expects
// when it's copied to the clipboard, so strip it for display purposes only.
fn display_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        raw.to_string()
    }
}

fn summary(path: &Path) -> WorkspaceSummary {
    WorkspaceSummary {
        id: workspace_id(path),
        path: display_path(path),
        name: path
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("Workspace")
            .to_string(),
        has_data_directory: data_path(path).is_dir(),
        note_count: None,
    }
}

#[tauri::command(async)]
pub fn set_workspace(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<WorkspaceSummary, String> {
    logged("set_workspace", || {
        let root = fs::canonicalize(&path).map_err(|e| format!("Cannot open workspace: {e}"))?;
        if !root.is_dir() {
            return Err(err("The selected workspace is not a directory"));
        }
        prepare_workspace(&root)?;
        *state.workspace.lock() = Some(root.clone());
        save_recent(&app, &root)?;
        watch_workspace(&app, state.inner(), root.clone())?;
        let result = summary(&root);
        schedule_reconcile(app.clone(), Arc::clone(state.inner()), root);
        Ok(result)
    })
}

#[tauri::command(async)]
pub fn recent_workspaces(app: AppHandle) -> Result<Vec<WorkspaceSummary>, String> {
    logged("recent_workspaces", || {
        Ok(load_recents(&app)?
            .into_iter()
            .filter_map(|item| {
                let path = PathBuf::from(item.path);
                path.is_dir().then(|| summary(&path))
            })
            .collect())
    })
}

#[tauri::command(async)]
pub fn remove_recent_workspace(app: AppHandle, path: String) -> Result<(), String> {
    logged("remove_recent_workspace", || {
        let recents_path = recents_path(&app)?;
        let mut entries = load_recents(&app)?;
        entries.retain(|item| item.path != path);
        fs::write(
            recents_path,
            serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn list_entries(
    state: State<'_, Arc<AppState>>,
    path: Option<String>,
    recursive: Option<bool>,
) -> Result<Vec<Entry>, String> {
    logged("list_entries", || {
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
    })
}

#[tauri::command(async)]
pub fn read_note(state: State<'_, Arc<AppState>>, path: String) -> Result<Note, String> {
    logged("read_note", || {
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
    })
}

#[tauri::command(async)]
pub fn write_note(
    _app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    content: String,
) -> Result<(), String> {
    logged("write_note", || {
        let root = active_workspace(&state)?;
        let note = note_path(&root, &path)?;
        if !note.exists() {
            return Err(err("Note does not exist; use create_note"));
        }
        state.record_internal_write(&format!("Data/{path}"));
        let started = std::time::Instant::now();
        safety::atomic_write(&note, content.as_bytes())?;
        index_note(&root, &path, &content)?;
        state.record_internal_write_timed(&format!("Data/{path}"), started.elapsed());
        Ok(())
    })
}

#[tauri::command(async)]
pub fn create_note(
    _app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    content: String,
) -> Result<Note, String> {
    logged("create_note", || {
        let root = active_workspace(&state)?;
        let note = note_path(&root, &path)?;
        if note.exists() {
            return Err(err("A note with that name already exists"));
        }
        fs::create_dir_all(note.parent().expect("note has parent")).map_err(|e| e.to_string())?;
        state.record_internal_write(&format!("Data/{path}"));
        let started = std::time::Instant::now();
        safety::atomic_write(&note, content.as_bytes())?;
        index_note(&root, &path, &content)?;
        state.record_internal_write_timed(&format!("Data/{path}"), started.elapsed());
        Ok(Note {
            name: note
                .file_stem()
                .and_then(|x| x.to_str())
                .unwrap_or("Untitled")
                .to_string(),
            path,
            content,
        })
    })
}

fn coalesce_change(changes: &mut HashMap<String, WorkspaceChange>, change: WorkspaceChange) {
    let key = change.path.clone();
    match changes.get(&key).map(|existing| existing.kind.as_str()) {
        Some("create") if change.kind == "modify" => {}
        Some("create") if change.kind == "remove" => {
            changes.remove(&key);
        }
        Some("remove") if change.kind == "create" => {
            changes.insert(
                key,
                WorkspaceChange {
                    kind: "modify".to_string(),
                    ..change
                },
            );
        }
        _ => {
            changes.insert(key, change);
        }
    }
}

fn sorted_changes(changes: HashMap<String, WorkspaceChange>) -> Vec<WorkspaceChange> {
    let mut values = changes.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| left.path.cmp(&right.path));
    values
}

fn reconcile_index_with(
    root: &Path,
    mut cancelled: impl FnMut() -> bool,
    mut progress: impl FnMut(usize, usize, &str),
) -> Result<usize, String> {
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
    let files = WalkDir::new(data_path(root))
        .into_iter()
        .filter_map(Result::ok)
        .filter(|item| item.file_type().is_file())
        .filter(|item| {
            item.path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        })
        .filter(|item| !item.path().to_string_lossy().contains(".recallstack-trash"))
        .map(|item| item.into_path())
        .collect::<Vec<_>>();
    let total = files.len();
    let mut changed = Vec::new();
    let mut seen = HashSet::new();
    for (index, path) in files.iter().enumerate() {
        if cancelled() {
            return Err("Index rebuild cancelled".into());
        }
        let relative = relative_from_data(root, path)?;
        progress(index + 1, total, &relative);
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
        record_index_success(&db)?;
        return Ok(0);
    }
    let changed_count = changed.len();
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    for path in removed {
        remove_indexed_note(&transaction, &path)?;
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
        let structured = structured_note(&path, &content);
        transaction
            .execute("INSERT OR REPLACE INTO rs_notes(path, title, body, tags, modified_at, size, modified_ns, content_hash, kind, folder, status, priority, start_date, due_date, completed_date, created_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)", params![path, title, content, tags, modified_at, size, modified_ns, structured.hash, structured.kind, structured.folder, structured.status, structured.priority, structured.start_date, structured.due_date, structured.completed_date, structured.created_date])
            .map_err(|e| e.to_string())?;
        replace_structured(&transaction, &path, &structured)?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    record_index_success(&db)?;
    Ok(changed_count)
}

fn reconcile_index(root: &Path) -> Result<usize, String> {
    reconcile_index_with(root, || false, |_, _, _| {})
}

struct ReconcileRunGuard {
    state: Arc<AppState>,
    workspace_id: String,
}

impl ReconcileRunGuard {
    fn try_start(state: Arc<AppState>, root: &Path) -> Option<Self> {
        let workspace_id = workspace_id(root);
        let inserted = state
            .index_reconcile_workspaces
            .lock()
            .insert(workspace_id.clone());
        inserted.then_some(Self {
            state,
            workspace_id,
        })
    }
}

impl Drop for ReconcileRunGuard {
    fn drop(&mut self) {
        self.state
            .index_reconcile_workspaces
            .lock()
            .remove(&self.workspace_id);
    }
}

async fn reconcile_once(
    app: AppHandle,
    state: Arc<AppState>,
    root: PathBuf,
) -> Result<usize, String> {
    let Some(_guard) = ReconcileRunGuard::try_start(state, &root) else {
        // A startup, watcher-overflow, or frontend gap recovery is already
        // scanning this same workspace. One scan is sufficient; callers
        // observe its eventual index://status event instead of starting
        // another. A different workspace can still reconcile concurrently.
        return Ok(0);
    };
    let started = Instant::now();
    let _ = app.emit(
        "index://status",
        IndexStatus {
            state: "indexing".into(),
            indexed: 0,
            duration_ms: 0,
            error: None,
        },
    );
    let result = tauri::async_runtime::spawn_blocking(move || reconcile_index(&root))
        .await
        .map_err(|error| error.to_string())?;
    match &result {
        Ok(indexed) => {
            let _ = app.emit(
                "index://status",
                IndexStatus {
                    state: "ready".into(),
                    indexed: *indexed,
                    duration_ms: started.elapsed().as_millis(),
                    error: None,
                },
            );
        }
        Err(error) => {
            let _ = app.emit(
                "index://status",
                IndexStatus {
                    state: "error".into(),
                    indexed: 0,
                    duration_ms: started.elapsed().as_millis(),
                    error: Some(error.clone()),
                },
            );
        }
    }
    result
}

fn schedule_reconcile(app: AppHandle, state: Arc<AppState>, root: PathBuf) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = reconcile_once(app, state, root).await {
            crate::error_log::log_command_error("background_reconcile", &error);
        }
    });
}

fn rebuild_index_inner_with(
    root: &Path,
    cancelled: impl FnMut() -> bool,
    progress: impl FnMut(usize, usize, &str),
) -> Result<usize, String> {
    let db = open_db(root)?;
    db.execute("DELETE FROM rs_notes", [])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_notes_fts", [])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_tags", [])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM rs_links", [])
        .map_err(|e| e.to_string())?;
    drop(db);
    reconcile_index_with(root, cancelled, progress)
}

#[cfg(test)]
fn rebuild_index_inner(root: &Path) -> Result<usize, String> {
    rebuild_index_inner_with(root, || false, |_, _, _| {})
}

#[tauri::command]
pub async fn rebuild_index(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<usize, String> {
    logged_async("rebuild_index", async {
        let root = active_workspace(&state)?;
        let app_state = Arc::clone(state.inner());
        let Some(_reconcile_guard) =
            ReconcileRunGuard::try_start(Arc::clone(&app_state), &root)
        else {
            return Ok(0);
        };
        app_state
            .index_cancel
            .store(false, std::sync::atomic::Ordering::SeqCst);
        tauri::async_runtime::spawn_blocking(move || {
            rebuild_index_inner_with(
                &root,
                || {
                    app_state
                        .index_cancel
                        .load(std::sync::atomic::Ordering::SeqCst)
                },
                |completed, total, path| {
                    let _ = app.emit(
                        "index://progress",
                        serde_json::json!({"completed":completed,"total":total,"path":path}),
                    );
                },
            )
        })
        .await
        .map_err(|error| error.to_string())?
    })
    .await
}

#[tauri::command(async)]
pub fn cancel_index(state: State<'_, Arc<AppState>>) {
    state
        .index_cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub async fn reconcile_workspace(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<usize, String> {
    logged_async("reconcile_workspace", async {
        let root = active_workspace(&state)?;
        reconcile_once(app, Arc::clone(state.inner()), root).await
    })
    .await
}

/// Called by the frontend when the window is hidden/minimized (`false`) or
/// returns to view (`true`). While `false`, the watcher defers per-file
/// indexing and emits no change events. The return to `true` fires one
/// incremental catch-up reconcile and one "refresh everything" batch if
/// anything changed in the meantime — nothing "builds up" to replay.
#[tauri::command(async)]
pub fn set_foreground(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    foreground: bool,
) -> Result<(), String> {
    logged("set_foreground", || {
        let needs_catch_up = state.set_watcher_foreground(foreground);
        if !needs_catch_up {
            return Ok(());
        }
        let Ok(root) = active_workspace(&state) else {
            return Ok(());
        };
        let sequence = state.next_watcher_sequence(&workspace_id(&root));
        let _ = app.emit(
            "workspace://changed",
            WorkspaceChangeBatch {
                workspace_id: workspace_id(&root),
                sequence,
                occurred_at: Utc::now().timestamp_millis(),
                overflowed: true,
                changes: Vec::new(),
            },
        );
        schedule_reconcile(app.clone(), Arc::clone(state.inner()), root);
        Ok(())
    })
}

#[tauri::command(async)]
pub fn index_health(state: State<'_, Arc<AppState>>) -> Result<IndexHealth, String> {
    logged("index_health", || {
        let db = open_db(&active_workspace(&state)?)?;
        let count = |table: &str| {
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get::<_, i64>(0)
            })
            .map(|value| value as usize)
            .map_err(|e| e.to_string())
        };
        Ok(IndexHealth {
            schema_version: db
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(|e| e.to_string())?,
            files: count("rs_notes")?,
            tags: count("rs_tags")?,
            links: count("rs_links")?,
            last_reconciled: db
                .query_row(
                    "SELECT value FROM rs_index_meta WHERE key='last_reconciled'",
                    [],
                    |row| row.get(0),
                )
                .ok(),
        })
    })
}

#[derive(Debug, PartialEq)]
struct ParsedKnowledgeQuery {
    text: Vec<String>,
    filters: Vec<(String, String)>,
}

fn query_tokens(query: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut escaped = false;
    for character in query.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character == '"' {
            quoted = !quoted;
            continue;
        }
        if character.is_whitespace() && !quoted {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if escaped || quoted {
        return Err("Search query has an unfinished escape or quote".into());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

fn parse_knowledge_query(query: &str) -> Result<ParsedKnowledgeQuery, String> {
    let fields = [
        "tag",
        "folder",
        "is",
        "status",
        "priority",
        "due",
        "created",
        "modified",
        "linksto",
        "linkedfrom",
    ];
    let mut parsed = ParsedKnowledgeQuery {
        text: Vec::new(),
        filters: Vec::new(),
    };
    for token in query_tokens(query)? {
        if let Some((field, value)) = token.split_once(':') {
            let field = field.to_lowercase();
            if !fields.contains(&field.as_str()) {
                return Err(format!("Unknown search filter: {field}"));
            }
            if value.is_empty() {
                return Err(format!("Search filter {field}: needs a value"));
            }
            if field == "is"
                && !["task", "note", "working"].contains(&value.to_lowercase().as_str())
            {
                return Err("is: must be note, task, or working".into());
            }
            parsed.filters.push((field, value.to_string()));
        } else {
            parsed.text.push(token);
        }
    }
    Ok(parsed)
}

fn escaped_fts_terms(terms: &[String]) -> String {
    terms
        .iter()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn search_knowledge_inner(
    root: &Path,
    query: &str,
    prefix: &str,
    limit: usize,
    offset: usize,
) -> Result<KnowledgeSearchPage, String> {
    let parsed = parse_knowledge_query(query)?;
    if parsed.text.is_empty() && parsed.filters.is_empty() {
        return Ok(KnowledgeSearchPage {
            results: Vec::new(),
            total: 0,
            offset,
            has_more: false,
        });
    }
    let db = open_db(root)?;
    let has_text = !parsed.text.is_empty();
    let snippet = if has_text {
        "snippet(rs_notes_fts, 2, '', '', '…', 16)"
    } else {
        "substr(replace(n.body, char(10), ' '), 1, 180)"
    };
    let mut sql = format!("SELECT n.path,n.title,{snippet},n.tags,n.kind,n.folder,n.status,n.priority,n.due_date,n.modified_at FROM rs_notes n {} WHERE n.path LIKE ?", if has_text { "JOIN rs_notes_fts ON rs_notes_fts.path=n.path" } else { "" });
    let normalized_prefix = prefix.trim_start_matches('/');
    let mut values = vec![Value::Text(format!("{normalized_prefix}%"))];
    if has_text {
        sql.push_str(" AND rs_notes_fts MATCH ?");
        values.push(Value::Text(escaped_fts_terms(&parsed.text)));
    }
    for (field, raw) in parsed.filters {
        let value = raw.to_lowercase();
        match field.as_str() {
            "tag" => {
                sql.push_str(
                    " AND EXISTS(SELECT 1 FROM rs_tags t WHERE t.path=n.path AND lower(t.tag)=?)",
                );
                values.push(Value::Text(value.trim_start_matches('#').into()));
            }
            "folder" => {
                sql.push_str(" AND lower(n.folder) LIKE ?");
                values.push(Value::Text(format!("{}%", value.trim_matches('/'))));
            }
            "is" => {
                sql.push_str(" AND n.kind=?");
                values.push(Value::Text(value));
            }
            "status" => {
                sql.push_str(" AND lower(coalesce(n.status,''))=?");
                values.push(Value::Text(value));
            }
            "priority" => {
                sql.push_str(" AND lower(coalesce(n.priority,''))=?");
                values.push(Value::Text(value.replace(['-', '_', ' '], "")));
            }
            "due" if value == "today" => {
                sql.push_str(" AND n.due_date=?");
                values.push(Value::Text(Utc::now().date_naive().to_string()));
            }
            "due" if value == "overdue" => {
                sql.push_str(
                    " AND n.due_date IS NOT NULL AND n.due_date<? AND n.completed_date IS NULL",
                );
                values.push(Value::Text(Utc::now().date_naive().to_string()));
            }
            "due" => {
                sql.push_str(" AND n.due_date LIKE ?");
                values.push(Value::Text(format!("{value}%")));
            }
            "created" => {
                sql.push_str(" AND coalesce(n.created_date,'') LIKE ?");
                values.push(Value::Text(format!("{}%", value.trim_start_matches('='))));
            }
            "modified" => {
                let (operator, date) = if let Some(date) = value.strip_prefix(">=") {
                    (">=", date)
                } else if let Some(date) = value.strip_prefix("<=") {
                    ("<=", date)
                } else {
                    ("=", value.as_str())
                };
                let parsed_date =
                    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
                        "modified: expects YYYY-MM-DD, >=YYYY-MM-DD, or <=YYYY-MM-DD".to_string()
                    })?;
                let timestamp = parsed_date
                    .and_hms_opt(0, 0, 0)
                    .expect("midnight")
                    .and_utc()
                    .timestamp();
                sql.push_str(&format!(" AND n.modified_at {operator} ?"));
                values.push(Value::Integer(timestamp));
            }
            "linksto" => {
                sql.push_str(" AND EXISTS(SELECT 1 FROM rs_links l WHERE l.source_path=n.path AND lower(l.target_path) LIKE ?)");
                values.push(Value::Text(format!("%{}%", value.trim_matches('"'))));
            }
            "linkedfrom" => {
                sql.push_str(" AND EXISTS(SELECT 1 FROM rs_links l WHERE lower(l.source_path) LIKE ? AND lower(l.target_path) LIKE '%' || lower(n.path) || '%')");
                values.push(Value::Text(format!("%{}%", value.trim_matches('"'))));
            }
            _ => return Err(format!("Invalid value for {field}: {raw}")),
        }
    }
    let from = sql.find(" FROM ").expect("search query has FROM");
    let count_sql = format!("SELECT count(*){}", &sql[from..]);
    let total = db
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(values.iter()),
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as usize;
    sql.push_str(if has_text {
        " ORDER BY bm25(rs_notes_fts), n.modified_at DESC"
    } else {
        " ORDER BY n.modified_at DESC"
    });
    sql.push_str(" LIMIT ? OFFSET ?");
    let limit = limit.clamp(1, 100);
    let offset = offset.min(100_000);
    values.push(Value::Integer(limit as i64));
    values.push(Value::Integer(offset as i64));
    let mut statement = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values.iter()), |row| {
            let path: String = row.get(0)?;
            Ok(KnowledgeSearchResult {
                name: Path::new(&path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&path)
                    .to_string(),
                path,
                title: row.get(1)?,
                snippet: row.get(2)?,
                tags: row
                    .get::<_, String>(3)?
                    .split_whitespace()
                    .map(str::to_string)
                    .collect(),
                kind: row.get(4)?,
                folder: row.get(5)?,
                status: row.get(6)?,
                priority: row.get(7)?,
                due_date: row.get(8)?,
                modified_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(KnowledgeSearchPage {
        has_more: offset + results.len() < total,
        results,
        total,
        offset,
    })
}

#[tauri::command(async)]
pub fn search_knowledge(
    state: State<'_, Arc<AppState>>,
    query: String,
    prefix: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<KnowledgeSearchPage, String> {
    logged("search_knowledge", || {
        search_knowledge_inner(
            &active_workspace(&state)?,
            &query,
            &prefix.unwrap_or_default(),
            limit.unwrap_or(80),
            offset.unwrap_or(0),
        )
    })
}

#[tauri::command(async)]
pub fn search_notes(
    state: State<'_, Arc<AppState>>,
    query: String,
    prefix: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    logged("search_notes", || {
        let prefix = prefix
            .unwrap_or_default()
            .trim_start_matches('/')
            .to_string();
        Ok(
            search_knowledge_inner(&active_workspace(&state)?, &query, &prefix, 80, 0)?
                .results
                .into_iter()
                .map(|result| {
                    let path = result
                        .path
                        .strip_prefix(&prefix)
                        .unwrap_or(&result.path)
                        .trim_start_matches('/')
                        .to_string();
                    SearchResult {
                        name: Path::new(&path)
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or(&path)
                            .to_string(),
                        path,
                        snippet: result.snippet,
                    }
                })
                .collect(),
        )
    })
}

#[tauri::command(async)]
pub fn indexed_note_catalog(
    state: State<'_, Arc<AppState>>,
    prefix: Option<String>,
) -> Result<Vec<IndexedNoteSummary>, String> {
    logged("indexed_note_catalog", || {
        let root = active_workspace(&state)?;
        let db = open_db(&root)?;
        let prefix = prefix
            .unwrap_or_default()
            .trim_start_matches('/')
            .to_string();
        let mut statement = db.prepare("SELECT path,title,tags,kind,modified_at FROM rs_notes WHERE path LIKE ?1 ORDER BY path LIMIT 10000").map_err(|e| e.to_string())?;
        let results = statement
            .query_map([format!("{prefix}%")], |row| {
                let path: String = row.get(0)?;
                Ok(IndexedNoteSummary {
                    name: Path::new(&path)
                        .file_name()
                        .and_then(|v| v.to_str())
                        .unwrap_or(&path)
                        .to_string(),
                    path,
                    title: row.get(1)?,
                    tags: row
                        .get::<_, String>(2)?
                        .split_whitespace()
                        .map(str::to_string)
                        .collect(),
                    kind: row.get(3)?,
                    modified_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(results)
    })
}

#[tauri::command(async)]
pub fn backlinks(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<BacklinkResult>, String> {
    logged("backlinks", || {
        if !is_safe_relative(&path) {
            return Err("Invalid note path".into());
        }
        let root = active_workspace(&state)?;
        let db = open_db(&root)?;
        let stem = path.trim_end_matches(".md");
        let mut statement=db.prepare("SELECT l.source_path,n.title,l.anchor,l.kind FROM rs_links l JOIN rs_notes n ON n.path=l.source_path WHERE lower(l.target_path)=lower(?1) OR lower(l.target_path)=lower(?2) OR lower(?1) LIKE '%/' || lower(l.target_path) ORDER BY n.title").map_err(|e|e.to_string())?;
        let results = statement
            .query_map(params![path, stem], |row| {
                Ok(BacklinkResult {
                    source_path: row.get(0)?,
                    source_title: row.get(1)?,
                    anchor: row.get(2)?,
                    kind: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(results)
    })
}

#[tauri::command(async)]
pub fn list_saved_searches(state: State<'_, Arc<AppState>>) -> Result<Vec<SavedSearch>, String> {
    logged("list_saved_searches", || {
        let db = open_db(&active_workspace(&state)?)?;
        let mut statement = db
            .prepare("SELECT id,name,query,sort_order FROM rs_saved_searches ORDER BY sort_order,name")
            .map_err(|e| e.to_string())?;
        let results = statement
            .query_map([], |row| {
                Ok(SavedSearch {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    query: row.get(2)?,
                    sort_order: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(results)
    })
}

#[tauri::command(async)]
pub fn save_search(
    state: State<'_, Arc<AppState>>,
    name: String,
    query: String,
) -> Result<SavedSearch, String> {
    logged("save_search", || {
        let name = name.trim();
        if name.is_empty() || query.trim().is_empty() {
            return Err("Saved searches require a name and query".into());
        }
        parse_knowledge_query(&query)?;
        let db = open_db(&active_workspace(&state)?)?;
        db.execute("INSERT INTO rs_saved_searches(name,query,sort_order) VALUES(?1,?2,(SELECT coalesce(max(sort_order),-1)+1 FROM rs_saved_searches)) ON CONFLICT(name) DO UPDATE SET query=excluded.query",params![name,query]).map_err(|e|e.to_string())?;
        db.query_row(
            "SELECT id,name,query,sort_order FROM rs_saved_searches WHERE name=?1",
            [name],
            |row| {
                Ok(SavedSearch {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    query: row.get(2)?,
                    sort_order: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn delete_saved_search(state: State<'_, Arc<AppState>>, id: i64) -> Result<bool, String> {
    logged("delete_saved_search", || {
        Ok(open_db(&active_workspace(&state)?)?
            .execute("DELETE FROM rs_saved_searches WHERE id=?1", [id])
            .map_err(|e| e.to_string())?
            > 0)
    })
}

#[tauri::command(async)]
pub fn task_files(
    state: State<'_, Arc<AppState>>,
    prefix: Option<String>,
) -> Result<Vec<TaskFileResult>, String> {
    logged("task_files", || {
        let root = active_workspace(&state)?;
        let db = open_db(&root)?;
        let prefix = prefix
            .unwrap_or_default()
            .trim_start_matches('/')
            .to_string();
        let like_prefix = format!("{prefix}tasks/%");
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
                ["tasks", name] if name.ends_with(".md") => ("tasks", *name, false),
                ["tasks", "working", name] if name.ends_with(".md") => ("tasks", *name, true),
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
    })
}

#[tauri::command(async)]
pub fn reveal_path(state: State<'_, Arc<AppState>>, path: Option<String>) -> Result<(), String> {
    logged("reveal_path", || {
        let root = active_workspace(&state)?;
        let target = match path {
            Some(path) => note_path(&root, &path)?,
            None => root,
        };
        tauri_plugin_opener::reveal_item_in_dir(target).map_err(|e| e.to_string())
    })
}

// Not separately wrapped with logged() — it's a pure pass-through to
// reveal_path() above, which already logs under its own name; wrapping here
// too would just double-log the same single failure under two context
// labels for one user action.
#[tauri::command(async)]
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

    #[cfg(unix)]
    #[test]
    fn note_paths_reject_symlinks_that_leave_the_workspace() {
        use std::os::unix::fs::symlink;

        let root = temporary_workspace("note-symlink");
        let data = data_path(&root);
        fs::create_dir_all(&data).expect("fixture Data directory");
        let outside = root.with_extension("outside.md");
        fs::write(&outside, "outside").expect("fixture outside note");
        symlink(&outside, data.join("linked.md")).expect("fixture symlink");
        assert!(note_path(&root, "linked.md").is_err());
        fs::remove_dir_all(&root).expect("remove fixture workspace");
        fs::remove_file(outside).expect("remove fixture outside note");
    }

    #[test]
    fn preparing_an_empty_workspace_creates_required_structure() {
        let root = temporary_workspace("empty-setup");
        fs::remove_dir_all(root.join("Data")).expect("remove fixture Data directory");

        prepare_workspace(&root).expect("prepare empty workspace");

        assert!(root.join("Data").is_dir());
        assert!(root.join("Data/notes/mynotes/notes").is_dir());
        assert!(root.join("Data/notes/tasks").is_dir());
        assert!(root.join("Data/notes/dailylogs").is_dir());
        assert!(root.join("DB").is_dir());
        assert!(root.join("DB/index.db").is_file());
        let db = Connection::open(root.join("DB/index.db")).expect("open prepared index");
        let table_count: usize = db
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='rs_notes'",
                [],
                |row| row.get(0),
            )
            .expect("query prepared schema");
        assert_eq!(table_count, 1);
        drop(db);

        fs::remove_dir_all(&root).expect("remove fixture");
    }

    #[test]
    fn preparing_an_existing_workspace_does_not_add_starter_folders() {
        let root = temporary_workspace("existing-setup");

        prepare_workspace(&root).expect("prepare existing workspace");

        assert!(root.join("Data/notes").is_dir());
        assert!(!root.join("Data/notes/mynotes").exists());
        assert!(root.join("DB/index.db").is_file());

        fs::remove_dir_all(&root).expect("remove fixture");
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
    fn workspace_identity_is_stable_and_path_specific() {
        let first = Path::new("/tmp/recallstack-one");
        assert_eq!(workspace_id(first), workspace_id(first));
        assert_ne!(
            workspace_id(first),
            workspace_id(Path::new("/tmp/recallstack-two"))
        );
    }

    #[test]
    fn reconciliation_is_single_flight_per_workspace() {
        let state = Arc::new(AppState::default());
        let first_root = Path::new("/tmp/recallstack-one");
        let second_root = Path::new("/tmp/recallstack-two");

        let first = ReconcileRunGuard::try_start(Arc::clone(&state), first_root)
            .expect("first reconciliation starts");
        assert!(ReconcileRunGuard::try_start(Arc::clone(&state), first_root).is_none());
        let second = ReconcileRunGuard::try_start(Arc::clone(&state), second_root)
            .expect("another workspace can reconcile");

        drop(first);
        assert!(ReconcileRunGuard::try_start(Arc::clone(&state), first_root).is_some());
        drop(second);
    }

    #[test]
    fn watcher_sequences_continue_across_restarts() {
        let state = AppState::default();
        assert_eq!(state.next_watcher_sequence("ws-test"), 1);
        assert_eq!(state.next_watcher_sequence("ws-test"), 2);
        assert_eq!(state.next_watcher_sequence("ws-other"), 1);
    }

    #[test]
    fn stale_watcher_generation_cannot_own_health() {
        let state = AppState::default();
        let first = state.start_watcher_generation();
        let second = state.start_watcher_generation();
        assert!(!state.is_current_watcher_generation(first));
        assert!(state.is_current_watcher_generation(second));
    }

    #[test]
    fn foreground_transition_reports_catch_up_only_when_changes_were_missed() {
        let state = AppState::default();
        assert!(state.is_watcher_foreground());

        // Backgrounded with nothing changing: no catch-up needed on return.
        assert!(!state.set_watcher_foreground(false));
        assert!(!state.is_watcher_foreground());
        assert!(!state.set_watcher_foreground(true));

        // Backgrounded, then the watcher saw changes: return triggers catch-up once.
        state.set_watcher_foreground(false);
        state.mark_watcher_missed_changes();
        assert!(state.set_watcher_foreground(true));
        assert!(!state.set_watcher_foreground(true)); // flag consumed

        // Staying foreground never asks for a catch-up.
        assert!(!state.set_watcher_foreground(true));
    }

    #[test]
    fn internal_write_journal_matches_normalized_paths() {
        let state = AppState::default();
        state.record_internal_write("Data\\notes\\example.md");
        assert!(state.is_recent_internal_write("Data/notes/example.md"));
        assert!(!state.is_recent_internal_write("Data/notes/other.md"));
    }

    #[test]
    fn watcher_coalesces_common_event_bursts() {
        let change = |kind: &str| WorkspaceChange {
            kind: kind.to_string(),
            path: "Data/notes/example.md".to_string(),
            previous_path: None,
            entity: "markdown".to_string(),
            internal: false,
        };
        let mut changes = HashMap::new();
        coalesce_change(&mut changes, change("create"));
        coalesce_change(&mut changes, change("modify"));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes.values().next().expect("change").kind, "create");
        coalesce_change(&mut changes, change("remove"));
        assert!(changes.is_empty());

        coalesce_change(&mut changes, change("remove"));
        coalesce_change(&mut changes, change("create"));
        assert_eq!(changes.values().next().expect("change").kind, "modify");
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
        drop(db);

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
        let search_started = Instant::now();
        let page = search_knowledge_inner(&root, "benchmark tag:benchmark", "", 80, 0)
            .expect("benchmark search");
        let search_ms = search_started.elapsed().as_millis();
        eprintln!(
            "PERF native_search notes=1000 search_ms={search_ms} results={} total={}",
            page.results.len(),
            page.total
        );
        assert_eq!(page.total, 1_000);
        assert!(
            search_ms < 500,
            "debug-build search exceeded 500 ms: {search_ms}"
        );
        fs::remove_dir_all(&root).expect("remove benchmark fixture");
    }

    #[test]
    fn old_index_schema_migrates_without_losing_notes() {
        let root = temporary_workspace("schema-migration");
        fs::create_dir_all(root.join("DB")).expect("db folder");
        let db = Connection::open(db_path(&root)).expect("legacy db");
        db.execute_batch("CREATE TABLE rs_notes(path TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '',modified_at INTEGER NOT NULL); CREATE VIRTUAL TABLE rs_notes_fts USING fts5(path UNINDEXED,title,body,tags); INSERT INTO rs_notes VALUES('notes/old.md','Old','body','legacy',1);").expect("legacy schema");
        drop(db);
        let migrated = open_db(&root).expect("migration");
        assert_eq!(
            migrated
                .query_row(
                    "SELECT title FROM rs_notes WHERE path='notes/old.md'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .expect("preserved row"),
            "Old"
        );
        let columns = migrated
            .prepare("PRAGMA table_info(rs_notes)")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<HashSet<_>, _>>()
            })
            .expect("columns");
        assert!(columns.contains("content_hash"));
        assert!(columns.contains("due_date"));
        drop(migrated);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn knowledge_query_parser_handles_phrases_filters_and_errors() {
        let parsed =
            parse_knowledge_query("\"exact phrase\" tag:ai due:overdue is:task").expect("query");
        assert_eq!(parsed.text, vec!["exact phrase"]);
        assert_eq!(
            parsed.filters,
            vec![
                ("tag".into(), "ai".into()),
                ("due".into(), "overdue".into()),
                ("is".into(), "task".into())
            ]
        );
        assert!(parse_knowledge_query("unknown:value").is_err());
        assert!(parse_knowledge_query("\"unfinished").is_err());
        assert!(parse_knowledge_query("is:document").is_err());
    }

    #[test]
    fn markdown_metadata_extracts_tasks_tags_links_and_hash() {
        let metadata = structured_note(
            "notes/tasks/working/Ship - (Backlog) -- s20260801_c00000000_due20260810_high.md",
            "# Ship\n\n#release [Plan](../notes/Plan.md#scope) and [[Reference]]",
        );
        assert_eq!(metadata.kind, "working");
        assert_eq!(metadata.status.as_deref(), Some("backlog"));
        assert_eq!(metadata.priority.as_deref(), Some("high"));
        assert_eq!(metadata.start_date.as_deref(), Some("2026-08-01"));
        assert_eq!(metadata.due_date.as_deref(), Some("2026-08-10"));
        assert_eq!(metadata.tags, vec!["release"]);
        assert_eq!(metadata.links.len(), 2);
        assert_eq!(metadata.hash.len(), 64);
    }

    #[test]
    fn structured_search_is_filtered_bounded_and_parameterized() {
        let root = temporary_workspace("knowledge-search");
        fs::create_dir_all(root.join("Data/notes/tasks/working")).expect("task folder");
        fs::write(
            root.join("Data/notes/reference.md"),
            "# Reference\n\nsearchable #docs",
        )
        .expect("note");
        fs::write(
            root.join(
                "Data/notes/tasks/working/Ship -- s20260801_c00000000_due20260810_high.md",
            ),
            "# Ship\n\nsearchable #release [Reference](../../../notes/reference.md)",
        )
        .expect("task");
        assert_eq!(rebuild_index_inner(&root).expect("index"), 2);
        let page = search_knowledge_inner(
            &root,
            "searchable tag:release is:working priority:high",
            "",
            20,
            0,
        )
        .expect("search");
        assert_eq!(page.total, 1);
        assert_eq!(page.results[0].kind, "working");
        assert_eq!(page.results[0].tags, vec!["release"]);
        assert!(search_knowledge_inner(&root, "tag:' OR 1=1 --", "", 20, 0).is_ok());
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn search_matches_substrings_case_insensitively_across_note_kinds() {
        let root = temporary_workspace("case-insensitive-substring-search");
        fs::create_dir_all(root.join("Data/notes/tasks/working")).expect("task folders");
        fs::write(
            root.join("Data/notes/insurance.md"),
            "# Insurance\n\nMy GEICO policy renews soon.",
        )
        .expect("note");
        fs::write(
            root.join("Data/notes/tasks/Call insurer -- s20260801_c00000000_due20260810_high.md"),
            "# Call insurer\n\nFollow up with geico about the claim.",
        )
        .expect("task");
        fs::write(
            root.join(
                "Data/notes/tasks/working/Renew policy -- s20260801_c00000000_due20260810_normal.md",
            ),
            "# Renew policy\n\nMentions AGEICOBRAND, a substring hit only, not a standalone word.",
        )
        .expect("working task");
        assert_eq!(rebuild_index_inner(&root).expect("index"), 3);

        for query in ["geico", "GEICO", "Geico"] {
            let page = search_knowledge_inner(&root, query, "", 20, 0)
                .unwrap_or_else(|e| panic!("search for {query:?} failed: {e}"));
            let mut kinds: Vec<&str> = page.results.iter().map(|r| r.kind.as_str()).collect();
            kinds.sort_unstable();
            assert_eq!(
                page.total, 3,
                "query {query:?} should match the note, task, and working task (substring, case-insensitive)"
            );
            assert_eq!(kinds, vec!["note", "task", "working"]);
        }
        fs::remove_dir_all(&root).expect("cleanup");
    }
}
