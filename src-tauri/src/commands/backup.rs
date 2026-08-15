use crate::error_log::{logged, logged_async};
use crate::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub files: usize,
    pub bytes: u64,
    pub verified: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupProgress {
    completed: usize,
    total: usize,
    path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format_version: u32,
    app_version: String,
    workspace_id: String,
    created_at: String,
    files: Vec<ManifestFile>,
    exclusions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    path: String,
    size: u64,
    sha256: String,
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

fn included_files(root: &Path, include_cache: bool) -> Vec<PathBuf> {
    let mut roots = vec![root.join("Data"), root.join("Apps")];
    if include_cache {
        roots.push(root.join("DB"));
    }
    let mut files = roots
        .into_iter()
        .filter(|path| path.exists())
        .flat_map(|path| {
            WalkDir::new(path)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
        })
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            let value = entry.path().to_string_lossy();
            !value.contains(".recallstack-trash") && !value.contains(".recallstack-backups")
        })
        .map(|entry| entry.into_path())
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn stream_file(input: &Path, archive: &mut zip::ZipWriter<File>) -> Result<(u64, String), String> {
    let mut source = File::open(input).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut bytes = 0_u64;
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        archive
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        hasher.update(&buffer[..count]);
        bytes += count as u64;
    }
    Ok((bytes, format!("{:x}", hasher.finalize())))
}

fn create_backup(
    root: &Path,
    destination: &Path,
    include_cache: bool,
    mut cancelled: impl FnMut() -> bool,
    mut progress: impl FnMut(usize, usize, &str),
) -> Result<BackupResult, String> {
    if destination.starts_with(root) {
        return Err("Backup destination must be outside the workspace".to_string());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = destination.with_extension("zip.partial");
    let _ = fs::remove_file(&temp);
    let file = File::create(&temp).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let files = included_files(root, include_cache);
    let total = files.len();
    let mut manifest_files = Vec::with_capacity(total);
    let mut total_bytes = 0_u64;
    for (index, path) in files.iter().enumerate() {
        if cancelled() {
            drop(archive);
            let _ = fs::remove_file(&temp);
            return Err("Backup cancelled".to_string());
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        archive
            .start_file(&relative, options)
            .map_err(|error| error.to_string())?;
        let (size, checksum) = stream_file(path, &mut archive)?;
        total_bytes += size;
        manifest_files.push(ManifestFile {
            path: relative.clone(),
            size,
            sha256: checksum,
        });
        progress(index + 1, total, &relative);
    }
    let manifest = BackupManifest {
        format_version: 1,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        workspace_id: workspace_id(root),
        created_at: Utc::now().to_rfc3339(),
        files: manifest_files,
        exclusions: if include_cache {
            vec![
                "Data/.recallstack-trash".into(),
                ".recallstack-backups".into(),
            ]
        } else {
            vec![
                "Data/.recallstack-trash".into(),
                ".recallstack-backups".into(),
                "DB".into(),
            ]
        },
    };
    archive
        .start_file("recallstack-manifest.json", options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(&serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let completed = archive.finish().map_err(|error| error.to_string())?;
    completed.sync_all().map_err(|error| error.to_string())?;
    fs::rename(&temp, destination).map_err(|error| error.to_string())?;
    Ok(BackupResult {
        path: destination.to_string_lossy().to_string(),
        files: total,
        bytes: total_bytes,
        verified: false,
    })
}

#[tauri::command]
pub async fn backup_workspace(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    destination: Option<String>,
    include_cache: Option<bool>,
) -> Result<BackupResult, String> {
    logged_async("backup_workspace", async {
        let root = workspace(&state)?;
        let app_state = Arc::clone(state.inner());
        app_state.backup_cancel.store(false, Ordering::SeqCst);
        let destination = if let Some(value) = destination {
            PathBuf::from(value)
        } else {
            app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("backups")
                .join(format!(
                    "recallstack-{}.zip",
                    Utc::now().format("%Y%m%d-%H%M%S")
                ))
        };
        tauri::async_runtime::spawn_blocking(move || {
            let result = create_backup(
                &root,
                &destination,
                include_cache.unwrap_or(false),
                || app_state.backup_cancel.load(Ordering::SeqCst),
                |completed, total, path| {
                    let _ = app.emit(
                        "backup://progress",
                        BackupProgress {
                            completed,
                            total,
                            path: path.to_string(),
                        },
                    );
                },
            )?;
            Ok(BackupResult {
                verified: verify_backup_file(&destination)?.verified,
                ..result
            })
        })
        .await
        .map_err(|error| error.to_string())?
    })
    .await
}

#[tauri::command]
pub fn cancel_backup(state: State<'_, Arc<AppState>>) {
    state.backup_cancel.store(true, Ordering::SeqCst);
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVerification {
    pub verified: bool,
    pub files: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDryRun {
    pub files: usize,
    pub conflicts: Vec<String>,
    pub warnings: Vec<String>,
}

fn verify_backup_file(path: &Path) -> Result<BackupVerification, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    let manifest: BackupManifest = {
        let mut entry = archive
            .by_name("recallstack-manifest.json")
            .map_err(|_| "Backup manifest is missing".to_string())?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?
    };
    let mut errors = Vec::new();
    for expected in &manifest.files {
        match archive.by_name(&expected.path) {
            Ok(mut entry) => {
                let mut hasher = Sha256::new();
                let mut buffer = [0_u8; 64 * 1024];
                let mut size = 0_u64;
                loop {
                    let count = entry.read(&mut buffer).map_err(|error| error.to_string())?;
                    if count == 0 {
                        break;
                    }
                    hasher.update(&buffer[..count]);
                    size += count as u64;
                }
                let checksum = format!("{:x}", hasher.finalize());
                if size != expected.size || checksum != expected.sha256 {
                    errors.push(format!("Checksum mismatch: {}", expected.path));
                }
            }
            Err(_) => errors.push(format!("Missing file: {}", expected.path)),
        }
    }
    Ok(BackupVerification {
        verified: errors.is_empty(),
        files: manifest.files.len(),
        errors,
    })
}

#[tauri::command]
pub fn verify_backup(path: String) -> Result<BackupVerification, String> {
    logged("verify_backup", || verify_backup_file(Path::new(&path)))
}

#[tauri::command]
pub fn restore_backup_dry_run(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<RestoreDryRun, String> {
    logged("restore_backup_dry_run", || {
        let root = workspace(&state)?;
        let verification = verify_backup_file(Path::new(&path))?;
        if !verification.verified {
            return Err(format!(
                "Backup verification failed: {}",
                verification.errors.join("; ")
            ));
        }
        let file = File::open(&path).map_err(|error| error.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
        let manifest: BackupManifest = {
            let mut entry = archive
                .by_name("recallstack-manifest.json")
                .map_err(|_| "Backup manifest is missing".to_string())?;
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())?
        };
        let mut conflicts = Vec::new();
        for entry in &manifest.files {
            let relative = Path::new(&entry.path);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|part| !matches!(part, std::path::Component::Normal(_)))
            {
                return Err(format!("Unsafe path in backup manifest: {}", entry.path));
            }
            if root.join(relative).exists() {
                conflicts.push(entry.path.clone());
            }
        }
        let mut warnings = Vec::new();
        if manifest.workspace_id != workspace_id(&root) {
            warnings.push("Backup was created from a different workspace".into());
        }
        Ok(RestoreDryRun {
            files: manifest.files.len(),
            conflicts,
            warnings,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::{create_backup, verify_backup_file};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "recallstack-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    #[test]
    fn streamed_backup_has_verified_manifest() {
        let base = fixture("backup");
        let _ = fs::remove_dir_all(&base);
        let root = base.join("workspace");
        fs::create_dir_all(root.join("Data/notes")).expect("fixture data");
        fs::write(root.join("Data/notes/a.md"), "# A").expect("fixture note");
        let destination = base.join("outside/backup.zip");
        let result =
            create_backup(&root, &destination, false, || false, |_, _, _| {}).expect("backup");
        assert_eq!(result.files, 1);
        assert!(
            verify_backup_file(&destination)
                .expect("verification")
                .verified
        );
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn cancelled_backup_removes_partial_archive() {
        let base = fixture("backup-cancel");
        let root = base.join("workspace");
        fs::create_dir_all(root.join("Data/notes")).expect("fixture data");
        fs::write(root.join("Data/notes/a.md"), "# A").expect("fixture note");
        let destination = base.join("outside/backup.zip");
        let error = create_backup(&root, &destination, false, || true, |_, _, _| {})
            .expect_err("backup should cancel");
        assert_eq!(error, "Backup cancelled");
        assert!(!destination.exists());
        assert!(!destination.with_extension("zip.partial").exists());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn damaged_backup_does_not_verify() {
        let base = fixture("backup-damaged");
        let root = base.join("workspace");
        fs::create_dir_all(root.join("Data/notes")).expect("fixture data");
        fs::write(
            root.join("Data/notes/a.md"),
            "# A with enough content to archive",
        )
        .expect("fixture note");
        let destination = base.join("outside/backup.zip");
        create_backup(&root, &destination, false, || false, |_, _, _| {}).expect("backup");
        let length = fs::metadata(&destination).expect("archive metadata").len();
        let file = fs::OpenOptions::new()
            .write(true)
            .open(&destination)
            .expect("archive");
        file.set_len(length / 2).expect("truncate archive");
        assert!(verify_backup_file(&destination).is_err());
        fs::remove_dir_all(base).expect("cleanup");
    }
}
