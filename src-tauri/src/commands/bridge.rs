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
    version: String,
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
    let workspace = root(state)?;
    let mut candidate = workspace.clone();
    for component in path.components() {
        if let Component::Normal(part) = component {
            candidate.push(part);
            if candidate.exists()
                && fs::symlink_metadata(&candidate)
                    .map_err(|e| e.to_string())?
                    .file_type()
                    .is_symlink()
            {
                return Err("Symbolic links are not allowed in native workspace paths".to_string());
            }
        }
    }
    Ok(candidate)
}

fn relative_string(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|_| "Path escaped the workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn native_entry(workspace: &Path, path: &Path) -> Result<NativeEntry, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let modified_at = modified.as_millis() as u64;
    Ok(NativeEntry {
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string(),
        path: relative_string(workspace, path)?,
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified_at,
        version: format!("{}:{}", metadata.len(), modified.as_nanos()),
    })
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
            if entry.file_type().ok()?.is_symlink() {
                return None;
            }
            native_entry(&workspace, &entry.path()).ok()
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
pub fn fs_stat(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Option<NativeEntry>, String> {
    let workspace = root(&state)?;
    let target = safe_path(&state, &path)?;
    if !target.exists() {
        return Ok(None);
    }
    native_entry(&workspace, &target).map(Some)
}

#[tauri::command]
pub fn fs_read(state: State<'_, Arc<AppState>>, path: String) -> Result<Vec<u8>, String> {
    fs::read(safe_path(&state, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_text(state: State<'_, Arc<AppState>>, path: String) -> Result<String, String> {
    fs::read_to_string(safe_path(&state, &path)?).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionedText {
    text: String,
    version: String,
}

#[tauri::command]
pub fn fs_read_text_versioned(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<VersionedText, String> {
    let workspace = root(&state)?;
    let target = safe_path(&state, &path)?;
    for _ in 0..2 {
        let before = native_entry(&workspace, &target)?.version;
        let text = fs::read_to_string(&target).map_err(|e| e.to_string())?;
        let after = native_entry(&workspace, &target)?.version;
        if before == after {
            return Ok(VersionedText {
                text,
                version: after,
            });
        }
    }
    Err("The file changed while it was being read; try opening it again".to_string())
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
pub fn fs_write_text(
    state: State<'_, Arc<AppState>>,
    path: String,
    text: String,
) -> Result<(), String> {
    let target = safe_path(&state, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_text_versioned(
    state: State<'_, Arc<AppState>>,
    path: String,
    text: String,
    expected_version: Option<String>,
) -> Result<String, String> {
    let workspace = root(&state)?;
    let target = safe_path(&state, &path)?;
    if let Some(expected) = expected_version {
        if target.exists() {
            let current = native_entry(&workspace, &target)?.version;
            if current != expected {
                return Err("The file changed on disk after it was opened".to_string());
            }
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, text).map_err(|e| e.to_string())?;
    Ok(native_entry(&workspace, &target)?.version)
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
