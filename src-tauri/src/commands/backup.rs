use crate::AppState;
use chrono::Utc;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub files: usize,
}

fn workspace(state: &State<'_, Arc<AppState>>) -> Result<PathBuf, String> {
    state
        .workspace
        .lock()
        .clone()
        .ok_or_else(|| "No workspace is open".to_string())
}

#[tauri::command]
pub fn backup_workspace(state: State<'_, Arc<AppState>>) -> Result<BackupResult, String> {
    let root = workspace(&state)?;
    let directory = root.join(".recallstack-backups");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let destination = directory.join(format!(
        "recallstack-{}.zip",
        Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let file = File::create(&destination).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut files = 0;
    for item in WalkDir::new(root.join("Data"))
        .into_iter()
        .filter_map(Result::ok)
    {
        if !item.file_type().is_file() {
            continue;
        }
        let relative = item
            .path()
            .strip_prefix(&root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        archive
            .start_file(relative, options)
            .map_err(|e| e.to_string())?;
        let mut input = File::open(item.path()).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        input.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        archive.write_all(&bytes).map_err(|e| e.to_string())?;
        files += 1;
    }
    archive.finish().map_err(|e| e.to_string())?;
    Ok(BackupResult {
        path: destination.to_string_lossy().to_string(),
        files,
    })
}
