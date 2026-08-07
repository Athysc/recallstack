use crate::AppState;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::sync::Arc;
use tauri::State;
use walkdir::WalkDir;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub notes: usize,
    pub broken_links: Vec<String>,
    pub orphan_assets: Vec<String>,
    pub watcher: String,
}

fn markdown_links(markdown: &str) -> impl Iterator<Item = &str> {
    markdown
        .match_indices("](")
        .filter_map(move |(start, _)| markdown[start + 2..].split_once(')').map(|(url, _)| url))
}

#[tauri::command]
pub fn check_workspace(state: State<'_, Arc<AppState>>) -> Result<HealthReport, String> {
    let root = state
        .workspace
        .lock()
        .clone()
        .ok_or_else(|| "No workspace is open".to_string())?;
    let data = root.join("Data");
    let mut notes = HashSet::new();
    let mut assets = HashSet::new();
    let mut references = HashSet::new();
    for item in WalkDir::new(&data).into_iter().filter_map(Result::ok) {
        if !item.file_type().is_file() {
            continue;
        }
        let relative = item
            .path()
            .strip_prefix(&data)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if item
            .path()
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            notes.insert(relative.clone());
            let text = fs::read_to_string(item.path()).map_err(|e| e.to_string())?;
            for link in markdown_links(&text) {
                if !link.starts_with('#') && !link.contains("://") && !link.starts_with("mailto:") {
                    references.insert(
                        link.split('#')
                            .next()
                            .unwrap_or_default()
                            .replace('\\', "/"),
                    );
                }
            }
        } else {
            assets.insert(relative);
        }
    }
    let broken_links = references
        .iter()
        .filter(|link| !link.is_empty() && !data.join(link).exists())
        .cloned()
        .collect();
    let orphan_assets = assets
        .iter()
        .filter(|asset| !references.contains(*asset))
        .cloned()
        .collect();
    Ok(HealthReport {
        notes: notes.len(),
        broken_links,
        orphan_assets,
        watcher: state.watcher_health.lock().clone(),
    })
}
