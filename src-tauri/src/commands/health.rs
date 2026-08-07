use crate::AppState;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::process::Command;
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
    pub findings: Vec<HealthFinding>,
    pub git: GitStatus,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthFinding {
    pub severity: String,
    pub code: String,
    pub path: Option<String>,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub detected: bool,
    pub repository: Option<String>,
    pub changed: Vec<String>,
    pub error: Option<String>,
}

fn git_status_for(root: &std::path::Path) -> GitStatus {
    let repository = Command::new("git")
        .current_dir(root)
        .args(["rev-parse", "--show-toplevel"])
        .output();
    let Ok(repository) = repository else {
        return GitStatus {
            detected: false,
            repository: None,
            changed: Vec::new(),
            error: Some("Git is not installed".into()),
        };
    };
    if !repository.status.success() {
        return GitStatus {
            detected: false,
            repository: None,
            changed: Vec::new(),
            error: None,
        };
    }
    let repository_path = String::from_utf8_lossy(&repository.stdout)
        .trim()
        .to_string();
    match Command::new("git")
        .current_dir(root)
        .args(["status", "--porcelain=v1", "--untracked-files=normal"])
        .output()
    {
        Ok(output) if output.status.success() => GitStatus {
            detected: true,
            repository: Some(repository_path),
            changed: String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::to_string)
                .collect(),
            error: None,
        },
        Ok(output) => GitStatus {
            detected: true,
            repository: Some(repository_path),
            changed: Vec::new(),
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        },
        Err(error) => GitStatus {
            detected: true,
            repository: Some(repository_path),
            changed: Vec::new(),
            error: Some(error.to_string()),
        },
    }
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
    let broken_links: Vec<String> = references
        .iter()
        .filter(|link| !link.is_empty() && !data.join(link).exists())
        .cloned()
        .collect();
    let orphan_assets: Vec<String> = assets
        .iter()
        .filter(|asset| !references.contains(*asset))
        .cloned()
        .collect();
    let mut findings = broken_links
        .iter()
        .map(|path| HealthFinding {
            severity: "error".into(),
            code: "broken-link".into(),
            path: Some(path.clone()),
            message: "Link target does not exist".into(),
        })
        .collect::<Vec<_>>();
    findings.extend(orphan_assets.iter().map(|path| HealthFinding {
        severity: "warning".into(),
        code: "orphan-asset".into(),
        path: Some(path.clone()),
        message: "Asset is not referenced by a Markdown file".into(),
    }));
    let watcher = state.watcher_health.lock().clone();
    if watcher != "running" {
        findings.push(HealthFinding {
            severity: "warning".into(),
            code: "watcher".into(),
            path: None,
            message: format!("Filesystem watcher: {watcher}"),
        });
    }
    let git = git_status_for(&root);
    Ok(HealthReport {
        notes: notes.len(),
        broken_links,
        orphan_assets,
        watcher,
        findings,
        git,
    })
}

#[tauri::command]
pub fn git_status(state: State<'_, Arc<AppState>>) -> Result<GitStatus, String> {
    let root = state
        .workspace
        .lock()
        .clone()
        .ok_or_else(|| "No workspace is open".to_string())?;
    Ok(git_status_for(&root))
}
