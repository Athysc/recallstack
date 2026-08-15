use crate::error_log::logged;
use crate::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

const TRASH_DIRECTORY: &str = ".recallstack-trash";
const VERSION_RETENTION_BYTES: u64 = 250 * 1024 * 1024;
const VERSION_RETENTION_DAYS: i64 = 90;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReference {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub operation_id: String,
    pub changed: Vec<String>,
    pub recovery: Option<RecoveryReference>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashRecord {
    pub id: String,
    pub original_path: String,
    pub deleted_at: String,
    pub entity: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRecord {
    pub id: String,
    pub path: String,
    pub created_at: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftRecord {
    path: String,
    text: String,
    saved_at: String,
}

fn workspace(state: &State<'_, Arc<AppState>>) -> Result<PathBuf, String> {
    state
        .workspace
        .lock()
        .clone()
        .ok_or_else(|| "No workspace is open".to_string())
}

fn workspace_id(root: &Path) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in root.to_string_lossy().replace('\\', "/").as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("ws-{hash:016x}")
}

fn operation_id(prefix: &str) -> String {
    format!("{prefix}-{}", Utc::now().format("%Y%m%dT%H%M%S%.9fZ"))
}

fn validate_relative(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Invalid workspace-relative path".to_string());
    }
    Ok(())
}

fn workspace_target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative(relative)?;
    let mut target = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(part) = component else {
            continue;
        };
        target.push(part);
        if target.exists()
            && fs::symlink_metadata(&target)
                .map_err(|error| error.to_string())?
                .file_type()
                .is_symlink()
        {
            return Err("Symbolic links are not allowed in safety operations".to_string());
        }
    }
    Ok(target)
}

fn app_safety_root(app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("safety")
        .join(workspace_id(root)))
}

fn audit(app: &AppHandle, root: &Path, result: &MutationResult) -> Result<(), String> {
    let directory = app_safety_root(app, root)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("mutations.jsonl"))
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, result).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

// audit() is a best-effort diagnostic trail (appends to mutations.jsonl), not
// part of the mutation it's called after — trash_workspace_path()/
// restore_trash()/restore_version() all call it as their very last step,
// once the real filesystem move/write has already completed successfully.
// Propagating an audit-log I/O failure with `?` at that point (the previous
// behavior) turns an already-successful trash/restore into a reported
// failure for the caller — see task_20260815_0001, where this was the most
// concrete match found for RecallStack reporting a delete as failed with a
// filesystem-ish error even though the file really had already been moved to
// Trash. Log and continue instead: the operation's own success/failure must
// be judged by the real mutation, not by whether we could also log it.
fn audit_best_effort(app: &AppHandle, root: &Path, result: &MutationResult) {
    if let Err(error) = audit(app, root, result) {
        eprintln!("Warning: could not append audit log entry for {}: {error}", result.operation_id);
    }
}

fn directory_size(path: &Path) -> u64 {
    if path.is_file() {
        return fs::metadata(path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
    }
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok().map(|metadata| metadata.len()))
        .sum()
}

fn copy_recursively(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_file() {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(source, destination).map_err(|error| error.to_string())?;
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for item in walkdir::WalkDir::new(source).min_depth(1) {
        let item = item.map_err(|error| error.to_string())?;
        if item.file_type().is_symlink() {
            continue;
        }
        let relative = item
            .path()
            .strip_prefix(source)
            .map_err(|error| error.to_string())?;
        let target = destination.join(relative);
        if item.file_type().is_dir() {
            fs::create_dir_all(target).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(item.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub fn trash_workspace_path(
    app: &AppHandle,
    state: &State<'_, Arc<AppState>>,
    relative: &str,
) -> Result<MutationResult, String> {
    let root = workspace(state)?;
    let source = workspace_target(&root, relative)?;
    if !source.exists() {
        return Err("The item no longer exists".to_string());
    }
    if source.starts_with(root.join("Data").join(TRASH_DIRECTORY)) {
        return Err("Items already in RecallStack Trash cannot be trashed again".to_string());
    }
    let id = operation_id("trash");
    let entry = root.join("Data").join(TRASH_DIRECTORY).join(&id);
    let payload = entry.join("payload");
    fs::create_dir_all(&entry).map_err(|error| error.to_string())?;
    let record = TrashRecord {
        id: id.clone(),
        original_path: relative.replace('\\', "/"),
        deleted_at: Utc::now().to_rfc3339(),
        entity: if source.is_dir() { "directory" } else { "file" }.to_string(),
        size: directory_size(&source),
    };
    fs::write(
        entry.join("metadata.json"),
        serde_json::to_vec_pretty(&record).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if fs::rename(&source, &payload).is_err() {
        copy_recursively(&source, &payload)?;
        if source.is_dir() {
            fs::remove_dir_all(&source)
        } else {
            fs::remove_file(&source)
        }
        .map_err(|error| error.to_string())?;
    }
    state.record_internal_write(relative);
    state.record_internal_write(&format!("Data/{TRASH_DIRECTORY}/{id}"));
    let result = MutationResult {
        operation_id: id.clone(),
        changed: vec![relative.replace('\\', "/")],
        recovery: Some(RecoveryReference {
            kind: "trash".into(),
            id,
        }),
        warnings: Vec::new(),
    };
    audit_best_effort(app, &root, &result);
    Ok(result)
}

#[tauri::command]
pub fn trash_path(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<MutationResult, String> {
    logged("trash_path", || trash_workspace_path(&app, &state, &path))
}

fn read_trash_record(entry: &Path) -> Result<TrashRecord, String> {
    serde_json::from_slice(
        &fs::read(entry.join("metadata.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_trash(state: State<'_, Arc<AppState>>) -> Result<Vec<TrashRecord>, String> {
    logged("list_trash", || {
        let directory = workspace(&state)?.join("Data").join(TRASH_DIRECTORY);
        if !directory.is_dir() {
            return Ok(Vec::new());
        }
        let mut records = fs::read_dir(directory)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter_map(|entry| read_trash_record(&entry.path()).ok())
            .collect::<Vec<_>>();
        records.sort_by(|left, right| right.deleted_at.cmp(&left.deleted_at));
        Ok(records)
    })
}

#[tauri::command]
pub fn restore_trash(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    restore_as: Option<String>,
) -> Result<MutationResult, String> {
    logged("restore_trash", || {
        validate_relative(&id)?;
        let root = workspace(&state)?;
        let entry = root.join("Data").join(TRASH_DIRECTORY).join(&id);
        let record = read_trash_record(&entry)?;
        let relative = restore_as.unwrap_or_else(|| record.original_path.clone());
        let destination = workspace_target(&root, &relative)?;
        if destination.exists() {
            return Err("The restore destination already exists; choose Restore As".to_string());
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(entry.join("payload"), &destination).map_err(|error| error.to_string())?;
        fs::remove_dir_all(&entry).map_err(|error| error.to_string())?;
        state.record_internal_write(&relative);
        let operation_id = operation_id("restore");
        let result = MutationResult {
            operation_id,
            changed: vec![relative],
            recovery: None,
            warnings: Vec::new(),
        };
        audit_best_effort(&app, &root, &result);
        Ok(result)
    })
}

#[tauri::command]
pub fn empty_trash(state: State<'_, Arc<AppState>>) -> Result<usize, String> {
    logged("empty_trash", || {
        let directory = workspace(&state)?.join("Data").join(TRASH_DIRECTORY);
        if !directory.is_dir() {
            return Ok(0);
        }
        let count = fs::read_dir(&directory)
            .map_err(|error| error.to_string())?
            .count();
        fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
        Ok(count)
    })
}

fn version_directory(app: &AppHandle, root: &Path, id: &str) -> Result<PathBuf, String> {
    Ok(app_safety_root(app, root)?.join("versions").join(id))
}

fn prune_versions(directory: &Path, now: chrono::DateTime<Utc>) -> Result<(), String> {
    if !directory.is_dir() {
        return Ok(());
    }
    let mut versions = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let record = fs::read(path.join("metadata.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<VersionRecord>(&bytes).ok())?;
            let created = chrono::DateTime::parse_from_rfc3339(&record.created_at)
                .ok()?
                .with_timezone(&Utc);
            Some((path, record.size, created))
        })
        .collect::<Vec<_>>();
    versions.sort_by_key(|(_, _, created)| *created);
    let cutoff = now - chrono::Duration::days(VERSION_RETENTION_DAYS);
    let mut total = versions.iter().map(|(_, size, _)| *size).sum::<u64>();
    for (path, size, created) in versions {
        if created < cutoff || total > VERSION_RETENTION_BYTES {
            fs::remove_dir_all(path).map_err(|error| error.to_string())?;
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}

pub fn preserve_version(
    app: &AppHandle,
    root: &Path,
    target: &Path,
    relative: &str,
) -> Result<Option<VersionRecord>, String> {
    if !target.is_file() {
        return Ok(None);
    }
    let id = operation_id("version");
    let directory = version_directory(app, root, &id)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let record = VersionRecord {
        id: id.clone(),
        path: relative.replace('\\', "/"),
        created_at: Utc::now().to_rfc3339(),
        size: fs::metadata(target)
            .map_err(|error| error.to_string())?
            .len(),
    };
    fs::copy(target, directory.join("payload")).map_err(|error| error.to_string())?;
    fs::write(
        directory.join("metadata.json"),
        serde_json::to_vec_pretty(&record).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    prune_versions(&app_safety_root(app, root)?.join("versions"), Utc::now())?;
    Ok(Some(record))
}

pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "File has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("recallstack"),
        operation_id("write")
    ));
    let mut file = File::create(&temp).map_err(|error| error.to_string())?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temp);
        return Err(error.to_string());
    }
    drop(file);
    #[cfg(windows)]
    if target.exists() {
        let old = parent.join(format!(
            ".{}.replace-old",
            target
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("recallstack")
        ));
        let _ = fs::remove_file(&old);
        fs::rename(target, &old).map_err(|error| error.to_string())?;
        if let Err(error) = fs::rename(&temp, target) {
            let _ = fs::rename(&old, target);
            return Err(error.to_string());
        }
        let _ = fs::remove_file(old);
        return Ok(());
    }
    fs::rename(&temp, target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        error.to_string()
    })
}

#[tauri::command]
pub fn list_versions(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: Option<String>,
) -> Result<Vec<VersionRecord>, String> {
    logged("list_versions", || {
        let root = workspace(&state)?;
        let directory = app_safety_root(&app, &root)?.join("versions");
        if !directory.is_dir() {
            return Ok(Vec::new());
        }
        let mut records = fs::read_dir(directory)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter_map(|entry| fs::read(entry.path().join("metadata.json")).ok())
            .filter_map(|bytes| serde_json::from_slice::<VersionRecord>(&bytes).ok())
            .filter(|record| path.as_ref().is_none_or(|path| &record.path == path))
            .collect::<Vec<_>>();
        records.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(records)
    })
}

#[tauri::command]
pub fn restore_version(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<MutationResult, String> {
    logged("restore_version", || {
        validate_relative(&id)?;
        let root = workspace(&state)?;
        let directory = version_directory(&app, &root, &id)?;
        let record: VersionRecord = serde_json::from_slice(
            &fs::read(directory.join("metadata.json")).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let target = workspace_target(&root, &record.path)?;
        let _ = preserve_version(&app, &root, &target, &record.path)?;
        atomic_write(
            &target,
            &fs::read(directory.join("payload")).map_err(|error| error.to_string())?,
        )?;
        state.record_internal_write(&record.path);
        let result = MutationResult {
            operation_id: operation_id("version-restore"),
            changed: vec![record.path],
            recovery: Some(RecoveryReference {
                kind: "version".into(),
                id,
            }),
            warnings: Vec::new(),
        };
        audit_best_effort(&app, &root, &result);
        Ok(result)
    })
}

fn draft_path(app: &AppHandle, root: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative(relative)?;
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in relative.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(app_safety_root(app, root)?
        .join("drafts")
        .join(format!("{hash:016x}.json")))
}

#[tauri::command]
pub fn save_draft(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    text: String,
) -> Result<(), String> {
    logged("save_draft", || {
        let root = workspace(&state)?;
        let destination = draft_path(&app, &root, &path)?;
        fs::create_dir_all(destination.parent().expect("draft has parent"))
            .map_err(|error| error.to_string())?;
        atomic_write(
            &destination,
            &serde_json::to_vec(&DraftRecord {
                path,
                text,
                saved_at: Utc::now().to_rfc3339(),
            })
            .map_err(|error| error.to_string())?,
        )
    })
}

#[tauri::command]
pub fn load_draft(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Option<String>, String> {
    logged("load_draft", || {
        let root = workspace(&state)?;
        let source = draft_path(&app, &root, &path)?;
        if !source.is_file() {
            return Ok(None);
        }
        let record: DraftRecord =
            serde_json::from_slice(&fs::read(source).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        Ok((record.path == path).then_some(record.text))
    })
}

#[tauri::command]
pub fn clear_draft(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), String> {
    logged("clear_draft", || {
        let root = workspace(&state)?;
        let source = draft_path(&app, &root, &path)?;
        if source.exists() {
            fs::remove_file(source).map_err(|error| error.to_string())?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::{atomic_write, copy_recursively, prune_versions, VersionRecord};
    use chrono::{Duration, Utc};
    use std::fs;

    #[test]
    fn atomic_write_replaces_complete_content() {
        let root = std::env::temp_dir().join(format!("recallstack-atomic-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("fixture directory");
        let target = root.join("note.md");
        fs::write(&target, "before").expect("fixture file");
        atomic_write(&target, b"after").expect("atomic replacement");
        assert_eq!(fs::read_to_string(&target).expect("read result"), "after");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn recursive_copy_preserves_nested_files() {
        let root = std::env::temp_dir().join(format!("recallstack-copy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("source/nested")).expect("fixture directory");
        fs::write(root.join("source/nested/file.md"), "content").expect("fixture file");
        copy_recursively(&root.join("source"), &root.join("destination")).expect("recursive copy");
        assert_eq!(
            fs::read_to_string(root.join("destination/nested/file.md")).expect("copied file"),
            "content"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn version_retention_removes_expired_snapshots() {
        let root =
            std::env::temp_dir().join(format!("recallstack-retention-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (name, age_days) in [("old", 91), ("current", 1)] {
            let directory = root.join(name);
            fs::create_dir_all(&directory).expect("fixture directory");
            let record = VersionRecord {
                id: name.into(),
                path: "Data/notes/a.md".into(),
                created_at: (Utc::now() - Duration::days(age_days)).to_rfc3339(),
                size: 7,
            };
            fs::write(
                directory.join("metadata.json"),
                serde_json::to_vec(&record).expect("metadata"),
            )
            .expect("fixture metadata");
            fs::write(directory.join("payload"), "content").expect("fixture payload");
        }
        prune_versions(&root, Utc::now()).expect("retention");
        assert!(!root.join("old").exists());
        assert!(root.join("current").exists());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
