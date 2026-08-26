use crate::error_log::logged;
use crate::{commands::safety, AppState};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};
use walkdir::{DirEntry, WalkDir};

const PORTABLE_TEXT_FILES: [&str; 3] = ["readme.md", "changes.md", "theme.json"];

fn validate_portable_target(relative: &str) -> Result<(), String> {
    let name = Path::new(relative)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "A file or folder name is required".to_string())?;
    let forbidden = name.chars().any(|value| {
        value.is_control() || matches!(value, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    });
    if forbidden {
        return Err(
            "Names cannot contain control characters or any of < > : \" / \\ | ? *".to_string(),
        );
    }
    if name.ends_with(['.', ' ']) {
        return Err("Names cannot end with a period or space".to_string());
    }
    let base = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let reserved = matches!(base.as_str(), "con" | "prn" | "aux" | "nul")
        || base
            .strip_prefix("com")
            .or_else(|| base.strip_prefix("lpt"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
    if reserved {
        return Err(format!("\"{name}\" is a reserved Windows name"));
    }
    Ok(())
}

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

pub(crate) fn safe_path(
    state: &State<'_, Arc<AppState>>,
    relative: &str,
) -> Result<PathBuf, String> {
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

fn record_internal_write(state: &State<'_, Arc<AppState>>, path: &Path) -> Result<(), String> {
    let workspace = root(state)?;
    state.record_internal_write(&relative_string(&workspace, path)?);
    Ok(())
}

// Re-records the same path with a window sized to how long the write actually
// took, so a slow write (waking disk, reconnecting mount) still gets enough
// grace for the watcher event to arrive and be recognized as our own —
// see AppState::record_internal_write_timed.
fn record_internal_write_timed(
    state: &State<'_, Arc<AppState>>,
    path: &Path,
    write_duration: std::time::Duration,
) -> Result<(), String> {
    let workspace = root(state)?;
    state.record_internal_write_timed(&relative_string(&workspace, path)?, write_duration);
    Ok(())
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

#[tauri::command(async)]
pub fn portable_read_text(name: String) -> Result<Option<String>, String> {
    logged("portable_read_text", || {
        portable_read_text_from(&std::env::current_exe().map_err(|e| e.to_string())?, &name)
    })
}

fn portable_read_text_from(executable: &Path, name: &str) -> Result<Option<String>, String> {
    if !PORTABLE_TEXT_FILES.contains(&name) {
        return Err("Unsupported portable text file".to_string());
    }
    let directory = executable
        .parent()
        .ok_or_else(|| "Executable has no parent directory".to_string())?;
    let path = directory.join(name);
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn fs_list(state: State<'_, Arc<AppState>>, path: String) -> Result<Vec<NativeEntry>, String> {
    logged("fs_list", || {
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
    })
}

fn visible_entry(entry: &DirEntry) -> bool {
    entry.depth() == 0
        || entry
            .file_name()
            .to_str()
            .is_some_and(|name| !name.starts_with('.'))
}

#[tauri::command(async)]
pub fn fs_list_recursive(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<NativeEntry>, String> {
    logged("fs_list_recursive", || {
        let workspace = root(&state)?;
        let directory = safe_path(&state, &path)?;
        let mut entries = Vec::new();
        for item in WalkDir::new(directory)
            .follow_links(false)
            .into_iter()
            .filter_entry(visible_entry)
        {
            let entry = item.map_err(|error| error.to_string())?;
            if entry.depth() == 0 || entry.file_type().is_dir() || entry.file_type().is_symlink() {
                continue;
            }
            entries.push(native_entry(&workspace, entry.path())?);
        }
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(entries)
    })
}

fn markdown_asset_references(text: &str, references: &mut BTreeSet<String>) {
    for marker in ["](assets/", "](../assets/"] {
        let mut remaining = text;
        while let Some(start) = remaining.find(marker) {
            let value_start = start + marker.len();
            remaining = &remaining[value_start..];
            let Some(end) = remaining.find(')') else {
                break;
            };
            let encoded = &remaining[..end];
            references.insert(
                percent_encoding::percent_decode_str(encoded)
                    .decode_utf8_lossy()
                    .into_owned(),
            );
            remaining = &remaining[end + 1..];
        }
    }
}

#[tauri::command(async)]
pub fn fs_referenced_assets(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<String>, String> {
    logged("fs_referenced_assets", || {
        let directory = safe_path(&state, &path)?;
        let mut references = BTreeSet::new();
        let walker = WalkDir::new(directory)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| visible_entry(entry) && entry.file_name() != "assets");
        for item in walker {
            let entry = item.map_err(|error| error.to_string())?;
            if entry.file_type().is_file()
                && !entry.file_type().is_symlink()
                && entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            {
                if let Ok(text) = fs::read_to_string(entry.path()) {
                    markdown_asset_references(&text, &mut references);
                }
            }
        }
        Ok(references.into_iter().collect())
    })
}

#[tauri::command(async)]
pub fn fs_rename(
    state: State<'_, Arc<AppState>>,
    from: String,
    to: String,
) -> Result<NativeEntry, String> {
    logged("fs_rename", || {
        if from.is_empty() || to.is_empty() {
            return Err("Workspace root cannot be renamed".to_string());
        }
        validate_portable_target(&to)?;
        let workspace = root(&state)?;
        let source = safe_path(&state, &from)?;
        let destination = safe_path(&state, &to)?;
        rename_directory(&source, &destination)?;
        state.record_internal_write(&from);
        state.record_internal_write(&to);
        native_entry(&workspace, &destination)
    })
}

fn rename_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err("The folder no longer exists".to_string());
    }
    if !source.is_dir() {
        return Err("Only folders can be renamed with this command".to_string());
    }
    if destination.exists() {
        return Err("A file or folder already exists at the destination".to_string());
    }
    let source_parent = source
        .parent()
        .ok_or_else(|| "Folder has no parent".to_string())?;
    if destination.parent() != Some(source_parent) {
        return Err("Folder rename must stay within its current parent".to_string());
    }
    fs::rename(source, destination).map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn fs_stat(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Option<NativeEntry>, String> {
    logged("fs_stat", || {
        let workspace = root(&state)?;
        let target = safe_path(&state, &path)?;
        if !target.exists() {
            return Ok(None);
        }
        native_entry(&workspace, &target).map(Some)
    })
}

#[tauri::command(async)]
pub fn fs_read(state: State<'_, Arc<AppState>>, path: String) -> Result<Vec<u8>, String> {
    logged("fs_read", || {
        fs::read(safe_path(&state, &path)?).map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn fs_read_text(state: State<'_, Arc<AppState>>, path: String) -> Result<String, String> {
    logged("fs_read_text", || {
        fs::read_to_string(safe_path(&state, &path)?).map_err(|e| e.to_string())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionedText {
    text: String,
    version: String,
}

#[tauri::command(async)]
pub fn fs_read_text_versioned(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<VersionedText, String> {
    logged("fs_read_text_versioned", || {
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
    })
}

#[tauri::command(async)]
pub fn fs_write(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    logged("fs_write", || {
        validate_portable_target(&path)?;
        let target = safe_path(&state, &path)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let workspace = root(&state)?;
        let _ = safety::preserve_version(&app, &workspace, &target, &path)?;
        record_internal_write(&state, &target)?;
        let started = std::time::Instant::now();
        safety::atomic_write(&target, &bytes)?;
        record_internal_write_timed(&state, &target, started.elapsed())
    })
}

#[tauri::command(async)]
pub fn fs_write_text(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    text: String,
) -> Result<(), String> {
    logged("fs_write_text", || {
        validate_portable_target(&path)?;
        let target = safe_path(&state, &path)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let workspace = root(&state)?;
        let _ = safety::preserve_version(&app, &workspace, &target, &path)?;
        record_internal_write(&state, &target)?;
        let started = std::time::Instant::now();
        safety::atomic_write(&target, text.as_bytes())?;
        record_internal_write_timed(&state, &target, started.elapsed())
    })
}

#[tauri::command(async)]
pub fn fs_write_text_versioned(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    text: String,
    expected_version: Option<String>,
) -> Result<String, String> {
    logged("fs_write_text_versioned", || {
        validate_portable_target(&path)?;
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
        let _ = safety::preserve_version(&app, &workspace, &target, &path)?;
        record_internal_write(&state, &target)?;
        let started = std::time::Instant::now();
        safety::atomic_write(&target, text.as_bytes())?;
        record_internal_write_timed(&state, &target, started.elapsed())?;
        Ok(native_entry(&workspace, &target)?.version)
    })
}

#[tauri::command(async)]
pub fn fs_create_dir(state: State<'_, Arc<AppState>>, path: String) -> Result<(), String> {
    logged("fs_create_dir", || {
        validate_portable_target(&path)?;
        let target = safe_path(&state, &path)?;
        record_internal_write(&state, &target)?;
        fs::create_dir_all(target).map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn fs_remove(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    recursive: bool,
) -> Result<safety::MutationResult, String> {
    logged("fs_remove", || {
        let _ = recursive;
        safety::trash_workspace_path(&app, &state, &path)
    })
}

#[tauri::command(async)]
pub fn fs_exists(state: State<'_, Arc<AppState>>, path: String) -> Result<bool, String> {
    logged("fs_exists", || Ok(safe_path(&state, &path)?.exists()))
}

// ── External file access (Open / Import Files) ─────────────────────────────
//
// These three commands are the only way the frontend can touch a path outside
// the open workspace. They deliberately take an absolute OS path with no
// workspace root involved at all — safe_path() above is the wrong tool here
// since it exists specifically to *reject* absolute paths. The trust boundary
// instead is: the path only ever reaches here after the user drove a native
// OS file-picker dialog (or an OS-level drag-and-drop) themselves, which is
// the standard boundary for this kind of access. We still refuse symlinks and
// non-regular files/directories as a basic sanity check.

fn validate_external_file(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute() {
        return Err("External file path must be absolute".to_string());
    }
    let metadata = fs::symlink_metadata(&candidate).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Symbolic links are not allowed for external files".to_string());
    }
    if !metadata.is_file() {
        return Err("Path is not a regular file".to_string());
    }
    Ok(candidate)
}

// Directory counterpart to validate_external_file — same trust boundary
// (absolute path, no symlinks), used by the Outputs folder feature, which
// the user points at an arbitrary directory anywhere on disk via a native
// folder-choose dialog (see chooseOutputsFolder() in desktop-bridge.ts).
fn validate_external_directory(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute() {
        return Err("External folder path must be absolute".to_string());
    }
    let metadata = fs::symlink_metadata(&candidate).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Symbolic links are not allowed for the outputs folder".to_string());
    }
    if !metadata.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    Ok(candidate)
}

// External counterpart to native_entry() above — same NativeEntry shape, but
// `path` is the entry's absolute OS path rather than a path relative to the
// workspace root, since external entries have no workspace to be relative to.
fn external_native_entry(path: &Path) -> Result<NativeEntry, String> {
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
        path: path.to_string_lossy().replace('\\', "/"),
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified_at,
        version: format!("{}:{}", metadata.len(), modified.as_nanos()),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileInfo {
    name: String,
    size: u64,
    modified_at: u64,
}

#[tauri::command(async)]
pub fn external_fs_stat(path: String) -> Result<ExternalFileInfo, String> {
    logged("external_fs_stat", || {
        let candidate = validate_external_file(&path)?;
        let metadata = fs::metadata(&candidate).map_err(|e| e.to_string())?;
        let modified_at = metadata
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        Ok(ExternalFileInfo {
            name: candidate
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            size: metadata.len(),
            modified_at,
        })
    })
}

#[tauri::command(async)]
pub fn external_fs_read_text(path: String) -> Result<String, String> {
    logged("external_fs_read_text", || {
        let candidate = validate_external_file(&path)?;
        fs::read_to_string(candidate).map_err(|e| e.to_string())
    })
}

// Binary counterpart to external_fs_read_text — used for external assets
// (e.g. an image dropped into the editor from outside the workspace via the
// Tauri webview's onDragDropEvent, which hands the frontend real absolute
// paths but no in-memory bytes). Mirrors the workspace-scoped fs_read above,
// just against validate_external_file's trust boundary instead of safe_path.
#[tauri::command(async)]
pub fn external_fs_read(path: String) -> Result<Vec<u8>, String> {
    logged("external_fs_read", || {
        let candidate = validate_external_file(&path)?;
        fs::read(candidate).map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn external_fs_write_text(path: String, text: String) -> Result<(), String> {
    logged("external_fs_write_text", || {
        let candidate = validate_external_file(&path)?;
        safety::atomic_write(&candidate, text.as_bytes())
    })
}

// ── External directory access (Outputs folder) ──────────────────────────────
//
// The Outputs folder can now be any directory on disk, not just one inside
// the open workspace — see validate_external_directory() above. These three
// commands mirror fs_list / fs_list_recursive / fs_remove but operate against
// that external trust boundary instead of safe_path()+root(), and always
// return/accept absolute paths since there's no workspace root to be
// relative to. Reads and single-file writes for files found this way still
// go through the existing external_fs_read*/external_fs_write_text commands
// above — those already work on any absolute path.

fn list_external_directory(directory: &Path) -> Result<Vec<NativeEntry>, String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            if entry.file_type().ok()?.is_symlink() {
                return None;
            }
            external_native_entry(&entry.path()).ok()
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));
    Ok(entries)
}

fn list_external_directory_recursive(directory: &Path) -> Result<Vec<NativeEntry>, String> {
    let mut entries = Vec::new();
    for item in WalkDir::new(directory)
        .follow_links(false)
        .into_iter()
        .filter_entry(visible_entry)
    {
        let entry = item.map_err(|error| error.to_string())?;
        if entry.depth() == 0 || entry.file_type().is_dir() || entry.file_type().is_symlink() {
            continue;
        }
        entries.push(external_native_entry(entry.path())?);
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

#[tauri::command(async)]
pub fn external_fs_list(path: String) -> Result<Vec<NativeEntry>, String> {
    logged("external_fs_list", || {
        list_external_directory(&validate_external_directory(&path)?)
    })
}

#[tauri::command(async)]
pub fn external_fs_list_recursive(path: String) -> Result<Vec<NativeEntry>, String> {
    logged("external_fs_list_recursive", || {
        list_external_directory_recursive(&validate_external_directory(&path)?)
    })
}

#[tauri::command(async)]
pub fn external_fs_remove(path: String) -> Result<(), String> {
    logged("external_fs_remove", || {
        let candidate = validate_external_file(&path)?;
        fs::remove_file(candidate).map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn close_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::{
        list_external_directory, list_external_directory_recursive, markdown_asset_references,
        portable_read_text_from, rename_directory, validate_external_directory,
        validate_external_file, validate_portable_target, PORTABLE_TEXT_FILES,
    };
    use std::collections::BTreeSet;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn portable_file_allowlist_is_exact() {
        assert!(PORTABLE_TEXT_FILES.contains(&"readme.md"));
        assert!(PORTABLE_TEXT_FILES.contains(&"changes.md"));
        assert!(PORTABLE_TEXT_FILES.contains(&"theme.json"));
        assert!(!PORTABLE_TEXT_FILES.contains(&"../theme.json"));
        assert!(!PORTABLE_TEXT_FILES.contains(&"themes.json"));
    }

    #[test]
    fn new_native_targets_follow_the_windows_compatible_name_policy() {
        for name in ["Data/Project notes", "Data/Résumé.md", "Data/.recallstack"] {
            assert!(validate_portable_target(name).is_ok(), "{name}");
        }
        for name in [
            "Data/CON",
            "Data/con.md",
            "Data/LPT9.txt",
            "Data/bad:name.md",
            "Data/trailing.",
            "Data/line\nbreak.md",
        ] {
            assert!(validate_portable_target(name).is_err(), "{name}");
        }
    }

    #[test]
    fn markdown_asset_reference_scan_decodes_local_asset_names() {
        let mut references = BTreeSet::new();
        markdown_asset_references(
            "![one](assets/first%20image.png)\n![two](../assets/second.svg)",
            &mut references,
        );
        assert_eq!(
            references.into_iter().collect::<Vec<_>>(),
            vec!["first image.png".to_string(), "second.svg".to_string()]
        );
    }

    #[test]
    fn native_folder_rename_moves_nested_contents_without_copying() {
        let directory = std::env::temp_dir().join(format!(
            "recallstack-native-rename-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let source = directory.join("before");
        let destination = directory.join("after");
        fs::create_dir_all(source.join("nested")).expect("fixture directory");
        fs::write(source.join("nested/note.md"), "content").expect("fixture note");
        rename_directory(&source, &destination).expect("native rename");
        assert!(!source.exists());
        assert_eq!(
            fs::read_to_string(destination.join("nested/note.md")).expect("renamed note"),
            "content"
        );
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn portable_text_is_read_beside_the_executable() {
        let directory = std::env::temp_dir().join(format!(
            "recallstack-portable-text-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("fixture directory");
        let executable = directory.join("RecallStack.exe");
        fs::write(&executable, []).expect("fixture executable");
        fs::write(directory.join("readme.md"), "portable guide").expect("fixture guide");
        assert_eq!(
            portable_read_text_from(&executable, "readme.md").expect("portable read"),
            Some("portable guide".to_string())
        );
        assert_eq!(
            portable_read_text_from(&executable, "changes.md").expect("missing sidecar"),
            None
        );
        assert!(portable_read_text_from(&executable, "../readme.md").is_err());
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn external_files_must_be_absolute_existing_non_symlink_regular_files() {
        let directory = std::env::temp_dir().join(format!(
            "recallstack-external-file-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("fixture directory");
        let file = directory.join("outside.md");
        fs::write(&file, "hello").expect("fixture file");

        assert!(validate_external_file(file.to_str().expect("utf8 path")).is_ok());
        assert!(validate_external_file("relative/outside.md").is_err());
        assert!(validate_external_file(
            directory.to_str().expect("utf8 path")
        )
        .is_err());
        assert!(validate_external_file(
            directory
                .join("does-not-exist.md")
                .to_str()
                .expect("utf8 path")
        )
        .is_err());

        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn external_directories_must_be_absolute_existing_non_symlink_directories() {
        let directory = std::env::temp_dir().join(format!(
            "recallstack-external-dir-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("fixture directory");
        let file = directory.join("not-a-dir.md");
        fs::write(&file, "hello").expect("fixture file");

        assert!(validate_external_directory(directory.to_str().expect("utf8 path")).is_ok());
        assert!(validate_external_directory("relative/outside").is_err());
        assert!(validate_external_directory(file.to_str().expect("utf8 path")).is_err());
        assert!(validate_external_directory(
            directory
                .join("does-not-exist")
                .to_str()
                .expect("utf8 path")
        )
        .is_err());

        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn external_listing_covers_one_level_and_recursive_files_outside_the_workspace() {
        let directory = std::env::temp_dir().join(format!(
            "recallstack-external-list-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(directory.join("category/nested")).expect("fixture directories");
        fs::write(directory.join("top-level.md"), "top").expect("fixture file");
        fs::write(directory.join("category/child.md"), "child").expect("fixture file");
        fs::write(directory.join("category/nested/grandchild.md"), "grandchild")
            .expect("fixture file");

        let top = list_external_directory(&directory).expect("one-level listing");
        assert_eq!(top.len(), 2, "expected the file and the category folder only");
        assert!(top.iter().any(|entry| entry.name == "top-level.md" && !entry.is_dir));
        assert!(top.iter().any(|entry| entry.name == "category" && entry.is_dir));

        let recursive = list_external_directory_recursive(&directory).expect("recursive listing");
        let mut names: Vec<&str> = recursive.iter().map(|entry| entry.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, vec!["child.md", "grandchild.md", "top-level.md"]);
        // Entries carry absolute paths — there is no workspace root to be relative to.
        assert!(recursive.iter().all(|entry| std::path::Path::new(&entry.path).is_absolute()));

        fs::remove_dir_all(directory).expect("remove fixture");
    }
}
