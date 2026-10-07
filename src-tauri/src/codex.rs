//! Read-only detection of recent Codex CLI sessions.
//!
//! Codex writes rollout JSONL files beneath `~/.codex/sessions`; the first record is a
//! `session_meta` object containing the original working directory.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::claude::AgentSession;

const MAX_DEPTH: usize = 6;
const MAX_METADATA_LINE: u64 = 64 * 1024;
pub const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// `$CODEX_HOME`, else `<home>/.codex`.
pub fn codex_home(home: &Path) -> PathBuf {
    match std::env::var_os("CODEX_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => home.join(".codex"),
    }
}

/// Recent rollout sessions, newest first and deduplicated by working directory.
pub fn scan(sessions_dir: &Path, now: SystemTime, max_age: Duration) -> Vec<AgentSession> {
    let mut candidates = Vec::new();
    collect_rollouts(sessions_dir, 0, &mut candidates);
    candidates.sort_by_key(|(path, modified)| {
        let _ = path;
        std::cmp::Reverse(*modified)
    });

    let mut seen = HashSet::new();
    let mut sessions = Vec::new();
    for (path, modified) in candidates {
        if now.duration_since(modified).unwrap_or_default() > max_age {
            continue;
        }
        let Ok(file) = File::open(&path) else { continue };
        let mut reader = BufReader::new(file).take(MAX_METADATA_LINE);
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if value.get("type").and_then(|v| v.as_str()) != Some("session_meta") {
            continue;
        }
        let Some(payload) = value.get("payload") else { continue };
        let Some(cwd) = payload.get("cwd").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) else { continue };
        if !seen.insert(cwd.to_owned()) {
            continue;
        }
        let session_id = payload
            .get("id")
            .or_else(|| payload.get("session_id"))
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| path.file_stem().unwrap_or_default().to_string_lossy().into_owned());
        sessions.push(AgentSession {
            agent: "Codex".to_owned(),
            cwd: cwd.to_owned(),
            session_id,
            last_active_ms: modified.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
        });
    }
    sessions
}

fn collect_rollouts(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, SystemTime)>) {
    if depth > MAX_DEPTH { return; }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            collect_rollouts(&path, depth + 1, out);
        } else if kind.is_file()
            && path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("rollout-") && n.to_string_lossy().ends_with(".jsonl"))
        {
            if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                out.push((path, modified));
            }
        }
    }
}
