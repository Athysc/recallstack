use crate::AppState;
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified_at: u64,
}

fn root(state: &State<'_, Arc<AppState>>) -> Result<PathBuf, String> {
    state
        .workspace
        .lock()
        .clone()
        .ok_or_else(|| "No workspace is open".to_string())
}

fn safe_path(state: &State<'_, Arc<AppState>>, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Invalid workspace-relative path".to_string());
    }
    Ok(root(state)?.join(path))
}

fn relative_string(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|_| "Path escaped the workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
pub fn fs_list(state: State<'_, Arc<AppState>>, path: String) -> Result<Vec<NativeEntry>, String> {
    let workspace = root(&state)?;
    let directory = if path.is_empty() {
        workspace.clone()
    } else {
        safe_path(&state, &path)?
    };
    let mut entries = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let modified_at = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some(NativeEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: relative_string(&workspace, &entry.path()).ok()?,
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified_at,
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
pub fn fs_read(state: State<'_, Arc<AppState>>, path: String) -> Result<Vec<u8>, String> {
    fs::read(safe_path(&state, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write(
    state: State<'_, Arc<AppState>>,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let target = safe_path(&state, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_create_dir(state: State<'_, Arc<AppState>>, path: String) -> Result<(), String> {
    fs::create_dir_all(safe_path(&state, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_remove(
    state: State<'_, Arc<AppState>>,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let target = safe_path(&state, &path)?;
    if target.is_dir() {
        if recursive {
            fs::remove_dir_all(target).map_err(|e| e.to_string())
        } else {
            fs::remove_dir(target).map_err(|e| e.to_string())
        }
    } else {
        fs::remove_file(target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_exists(state: State<'_, Arc<AppState>>, path: String) -> Result<bool, String> {
    Ok(safe_path(&state, &path)?.exists())
}

#[tauri::command]
pub fn close_app(app: AppHandle) {
    app.exit(0);
}
