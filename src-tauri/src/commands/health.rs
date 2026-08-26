use crate::error_log::logged;
use crate::AppState;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
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

fn is_hidden_workspace_entry(entry: &walkdir::DirEntry) -> bool {
    entry.depth() > 0
        && entry.file_type().is_dir()
        && entry.file_name().to_string_lossy().starts_with('.')
}

fn normalized_link_target(data: &Path, note: &Path, raw_link: &str) -> Option<String> {
    let mut link = raw_link.trim().replace('\\', "/");
    if link.starts_with('<') && link.ends_with('>') {
        link = link[1..link.len() - 1].to_string();
    } else if let Some((destination, _title)) = link.split_once(char::is_whitespace) {
        link = destination.to_string();
    }
    link = link
        .split(['#', '?'])
        .next()
        .unwrap_or_default()
        .to_string();
    if link.is_empty()
        || link.starts_with('#')
        || link.starts_with('/')
        || link.contains("://")
        || link.starts_with("mailto:")
        || link.starts_with("data:")
    {
        return None;
    }

    let parent = note.parent()?.strip_prefix(data).ok()?;
    let mut parts = parent
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_os_string()),
            _ => None,
        })
        .collect::<Vec<_>>();
    for component in Path::new(&link).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            Component::Normal(value) => parts.push(value.to_os_string()),
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    let relative = parts.into_iter().collect::<PathBuf>();
    Some(relative.to_string_lossy().replace('\\', "/"))
}

type WorkspaceLinkScan = (HashSet<String>, HashSet<String>, HashSet<String>);

fn scan_workspace_links(data: &Path) -> Result<WorkspaceLinkScan, String> {
    let mut notes = HashSet::new();
    let mut assets = HashSet::new();
    let mut references = HashSet::new();
    let walker = WalkDir::new(data)
        .into_iter()
        .filter_entry(|entry| !is_hidden_workspace_entry(entry));
    for item in walker.filter_map(Result::ok) {
        if !item.file_type().is_file() {
            continue;
        }
        let relative = item
            .path()
            .strip_prefix(data)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if item
            .path()
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            notes.insert(relative);
            let text = fs::read_to_string(item.path()).map_err(|e| e.to_string())?;
            for link in markdown_links(&text) {
                if let Some(target) = normalized_link_target(data, item.path(), link) {
                    references.insert(target);
                }
            }
        } else {
            assets.insert(relative);
        }
    }
    Ok((notes, assets, references))
}

#[tauri::command(async)]
pub fn check_workspace(state: State<'_, Arc<AppState>>) -> Result<HealthReport, String> {
    logged("check_workspace", || {
        let root = state
            .workspace
            .lock()
            .clone()
            .ok_or_else(|| "No workspace is open".to_string())?;
        let data = root.join("Data");
        let (notes, assets, references) = scan_workspace_links(&data)?;
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn workspace_links_resolve_from_each_note_and_ignore_internal_hidden_data() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "recallstack-health-{}-{unique}",
            std::process::id()
        ));
        let data = root.join("Data");
        let tasks = data.join("notes/mynotes/tasks");
        fs::create_dir_all(tasks.join("assets")).unwrap();
        fs::create_dir_all(data.join(".recallstack-trash/record/payload")).unwrap();
        fs::write(
            tasks.join("QA.md"),
            "![local](assets/pixel.png)\n[missing](missing.md)",
        )
        .unwrap();
        fs::write(tasks.join("assets/pixel.png"), b"png").unwrap();
        fs::write(
            data.join(".recallstack-trash/record/payload/deleted.png"),
            b"trash",
        )
        .unwrap();

        let (notes, assets, references) = scan_workspace_links(&data).unwrap();
        assert!(notes.contains("notes/mynotes/tasks/QA.md"));
        assert!(assets.contains("notes/mynotes/tasks/assets/pixel.png"));
        assert!(!assets
            .iter()
            .any(|path| path.contains(".recallstack-trash")));
        assert!(references.contains("notes/mynotes/tasks/assets/pixel.png"));
        assert!(references.contains("notes/mynotes/tasks/missing.md"));
        assert!(data.join("notes/mynotes/tasks/assets/pixel.png").exists());
        assert!(!data.join("notes/mynotes/tasks/missing.md").exists());

        fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command(async)]
pub fn git_status(state: State<'_, Arc<AppState>>) -> Result<GitStatus, String> {
    logged("git_status", || {
        let root = state
            .workspace
            .lock()
            .clone()
            .ok_or_else(|| "No workspace is open".to_string())?;
        Ok(git_status_for(&root))
    })
}
