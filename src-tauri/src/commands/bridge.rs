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
pub fn portable_read_text(name: String) -> Result<Option<String>, String> {
    portable_read_text_from(&std::env::current_exe().map_err(|e| e.to_string())?, &name)
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

fn visible_entry(entry: &DirEntry) -> bool {
    entry.depth() == 0
        || entry
            .file_name()
            .to_str()
            .is_some_and(|name| !name.starts_with('.'))
}

#[tauri::command]
pub fn fs_list_recursive(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<NativeEntry>, String> {
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

#[tauri::command]
pub fn fs_referenced_assets(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<String>, String> {
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
}

#[tauri::command]
pub fn fs_rename(
    state: State<'_, Arc<AppState>>,
    from: String,
    to: String,
) -> Result<NativeEntry, String> {
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
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    validate_portable_target(&path)?;
    let target = safe_path(&state, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let workspace = root(&state)?;
    let _ = safety::preserve_version(&app, &workspace, &target, &path)?;
    record_internal_write(&state, &target)?;
    safety::atomic_write(&target, &bytes)
}

#[tauri::command]
pub fn fs_write_text(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    text: String,
) -> Result<(), String> {
    validate_portable_target(&path)?;
    let target = safe_path(&state, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let workspace = root(&state)?;
    let _ = safety::preserve_version(&app, &workspace, &target, &path)?;
    record_internal_write(&state, &target)?;
    safety::atomic_write(&target, text.as_bytes())
}

#[tauri::command]
pub fn fs_write_text_versioned(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    text: String,
    expected_version: Option<String>,
) -> Result<String, String> {
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
    safety::atomic_write(&target, text.as_bytes())?;
    Ok(native_entry(&workspace, &target)?.version)
}

#[tauri::command]
pub fn fs_create_dir(state: State<'_, Arc<AppState>>, path: String) -> Result<(), String> {
    validate_portable_target(&path)?;
    let target = safe_path(&state, &path)?;
    record_internal_write(&state, &target)?;
    fs::create_dir_all(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_remove(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    recursive: bool,
) -> Result<safety::MutationResult, String> {
    let _ = recursive;
    safety::trash_workspace_path(&app, &state, &path)
}

#[tauri::command]
pub fn fs_exists(state: State<'_, Arc<AppState>>, path: String) -> Result<bool, String> {
    Ok(safe_path(&state, &path)?.exists())
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileInfo {
    name: String,
    size: u64,
    modified_at: u64,
}

#[tauri::command]
pub fn external_fs_stat(path: String) -> Result<ExternalFileInfo, String> {
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
}

#[tauri::command]
pub fn external_fs_read_text(path: String) -> Result<String, String> {
    let candidate = validate_external_file(&path)?;
    fs::read_to_string(candidate).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn external_fs_write_text(path: String, text: String) -> Result<(), String> {
    let candidate = validate_external_file(&path)?;
    safety::atomic_write(&candidate, text.as_bytes())
}

#[tauri::command]
pub fn close_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::{
        markdown_asset_references, portable_read_text_from, rename_directory,
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
}
