use crate::error_log::logged;
use crate::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

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

fn app_safety_root(app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("safety")
        .join(workspace_id(root)))
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

#[tauri::command(async)]
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

#[tauri::command(async)]
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

#[tauri::command(async)]
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
    use super::atomic_write;
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
}
