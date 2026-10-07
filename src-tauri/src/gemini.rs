//! Read-only detection of recent Gemini CLI sessions.
//!
//! Gemini stores chats under a short project ID, with the ID-to-working-directory mapping
//! in `.gemini/runtime/projects.json`.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::claude::AgentSession;

pub const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Recent chat files mapped back to their project directories, newest first.
pub fn scan(gemini_dir: &Path, now: SystemTime, max_age: Duration) -> Vec<AgentSession> {
    let registry_path = gemini_dir.join("runtime").join("projects.json");
    let Ok(contents) = fs::read_to_string(registry_path) else { return Vec::new() };
    let Ok(registry) = serde_json::from_str::<serde_json::Value>(&contents) else { return Vec::new() };
    let Some(projects) = registry.get("projects").and_then(|v| v.as_object()) else { return Vec::new() };

    let mut sessions = Vec::new();
    let mut seen = HashSet::new();
    for (cwd, project_id) in projects {
        let Some(project_id) = project_id.as_str() else { continue };
        let chats = gemini_dir.join("tmp").join(project_id).join("chats");
        let Ok(files) = fs::read_dir(chats) else { continue };
        let mut project_sessions = Vec::new();
        for file in files.flatten() {
            let path = file.path();
            if !file.file_type().is_ok_and(|t| t.is_file()) || !is_chat_file(&path) { continue; }
            let Ok(modified) = file.metadata().and_then(|m| m.modified()) else { continue };
            if now.duration_since(modified).unwrap_or_default() > max_age { continue; }
            project_sessions.push((path, modified));
        }
        project_sessions.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));

        for (path, modified) in project_sessions {
            if !seen.insert(cwd.clone()) { break; }
            sessions.push(AgentSession {
                agent: "Gemini CLI".to_owned(),
                cwd: cwd.clone(),
                session_id: session_id(&path),
                last_active_ms: modified.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
            });
            break;
        }
    }
    sessions.sort_by_key(|s| std::cmp::Reverse(s.last_active_ms));
    sessions
}

fn is_chat_file(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "json" || ext == "jsonl")
}

fn session_id(path: &PathBuf) -> String {
    path.file_stem().unwrap_or_default().to_string_lossy().into_owned()
}
