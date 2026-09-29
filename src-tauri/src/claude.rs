//! Read-only detection of recent Claude Code sessions and their working directories.
//!
//! Every session (CLI, desktop app, IDE) appends JSON lines to
//! `<config>/projects/<encoded-cwd>/<session-id>.jsonl`, and most lines carry the exact
//! `cwd`. The encoded folder name is lossy (`\`, `:`, `_` all become `-`), so we read the
//! `cwd` from the newest line that has one instead of decoding the name.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

const CHUNK: usize = 64 * 1024;
/// Stop reading a single file after this much without finding a `cwd` line.
const MAX_SCAN: u64 = 16 * 1024 * 1024;
pub const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSession {
    pub cwd: String,
    pub session_id: String,
    pub last_active_ms: u64,
}

/// `$CLAUDE_CONFIG_DIR/projects`, else `<home>/.claude/projects`.
pub fn projects_dir(home: &Path) -> PathBuf {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir).join("projects"),
        _ => home.join(".claude").join("projects"),
    }
}

/// Sessions modified within `max_age` of `now`, newest first, one per distinct `cwd`.
pub fn scan(projects: &Path, now: SystemTime, max_age: Duration) -> Vec<ClaudeSession> {
    let mut logs: Vec<(PathBuf, SystemTime)> = Vec::new();
    let Ok(project_dirs) = fs::read_dir(projects) else {
        return Vec::new();
    };
    for project in project_dirs.flatten() {
        let Ok(entries) = fs::read_dir(project.path()) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "jsonl") {
                continue;
            }
            let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else { continue };
            if now.duration_since(modified).unwrap_or_default() <= max_age {
                logs.push((path, modified));
            }
        }
    }
    logs.sort_by_key(|l| std::cmp::Reverse(l.1));

    let mut seen = HashSet::new();
    let mut sessions = Vec::new();
    for (path, modified) in logs {
        let Ok(Some(cwd)) = last_cwd(&path) else { continue };
        if !seen.insert(cwd.clone()) {
            continue;
        }
        sessions.push(ClaudeSession {
            cwd,
            session_id: path.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
            last_active_ms: modified.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
        });
    }
    sessions
}

/// The top-level `cwd` of the last line that has one, reading backward in chunks so
/// multi-megabyte logs cost only their tail.
pub fn last_cwd(path: &Path) -> std::io::Result<Option<String>> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let mut pos = len;
    // Bytes after the last newline seen so far; always the (possibly partial) line at `pos`.
    let mut carry: Vec<u8> = Vec::new();

    while pos > 0 && len - pos < MAX_SCAN {
        let n = CHUNK.min(pos as usize);
        pos -= n as u64;
        file.seek(SeekFrom::Start(pos))?;
        let mut buf = vec![0u8; n];
        file.read_exact(&mut buf)?;
        buf.extend_from_slice(&carry);

        // Everything after the first newline in `buf` is complete lines; check them newest first.
        let first_nl = buf.iter().position(|&b| b == b'\n');
        let complete_from = match first_nl {
            Some(i) if pos > 0 => i + 1,
            _ if pos == 0 => 0,
            _ => {
                carry = buf;
                continue;
            }
        };
        for line in buf[complete_from..].rsplit(|&b| b == b'\n') {
            if let Some(cwd) = cwd_of(line) {
                return Ok(Some(cwd));
            }
        }
        buf.truncate(complete_from);
        carry = buf;
    }
    Ok(None)
}

fn cwd_of(line: &[u8]) -> Option<String> {
    // Cheap pre-filter before parsing potentially huge lines.
    if !line.windows(5).any(|w| w == b"\"cwd\"") {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(line).ok()?;
    let cwd = value.get("cwd")?.as_str()?;
    (!cwd.is_empty()).then(|| cwd.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn temp_dir() -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "claudegit-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        File::create(path).unwrap().write_all(content.as_bytes()).unwrap();
    }

    fn line(cwd: &str) -> String {
        format!("{{\"type\":\"assistant\",\"cwd\":{}}}\n", serde_json::to_string(cwd).unwrap())
    }

    #[test]
    fn last_line_without_cwd_is_skipped() {
        let dir = temp_dir();
        let f = dir.join("s.jsonl");
        write(&f, &format!("{}{}{{\"type\":\"file-history-snapshot\"}}\n", line("C:\\a"), line("C:\\b")));
        assert_eq!(last_cwd(&f).unwrap().as_deref(), Some("C:\\b"));
    }

    #[test]
    fn line_larger_than_a_chunk_is_read_whole() {
        let dir = temp_dir();
        let f = dir.join("s.jsonl");
        let big = "x".repeat(CHUNK * 3 + 17);
        let content = format!(
            "{}{{\"type\":\"user\",\"cwd\":\"C:\\\\big\",\"blob\":\"{big}\"}}\n{{\"type\":\"summary\"}}",
            line("C:\\old")
        );
        write(&f, &content);
        assert_eq!(last_cwd(&f).unwrap().as_deref(), Some("C:\\big"));
    }

    #[test]
    fn nested_cwd_text_does_not_count() {
        let dir = temp_dir();
        let f = dir.join("s.jsonl");
        write(&f, &format!("{}{{\"type\":\"tool\",\"output\":{{\"cwd\":\"C:\\\\nested\"}}}}\n", line("C:\\top")));
        assert_eq!(last_cwd(&f).unwrap().as_deref(), Some("C:\\top"));
    }

    #[test]
    fn crlf_and_missing_trailing_newline_are_fine() {
        let dir = temp_dir();
        let f = dir.join("s.jsonl");
        write(&f, "{\"cwd\":\"C:\\\\a\"}\r\n{\"cwd\":\"C:\\\\b\"}");
        assert_eq!(last_cwd(&f).unwrap().as_deref(), Some("C:\\b"));
    }

    #[test]
    fn empty_or_cwdless_file_gives_none() {
        let dir = temp_dir();
        let empty = dir.join("e.jsonl");
        write(&empty, "");
        assert_eq!(last_cwd(&empty).unwrap(), None);
        let none = dir.join("n.jsonl");
        write(&none, "{\"type\":\"summary\"}\nnot json\n");
        assert_eq!(last_cwd(&none).unwrap(), None);
    }

    #[test]
    fn scan_orders_newest_first_dedupes_and_ignores_old_and_non_jsonl() {
        let projects = temp_dir();
        write(&projects.join("p1").join("old.jsonl"), &line("C:\\one"));
        write(&projects.join("p1").join("notes.txt"), &line("C:\\ignored"));
        std::thread::sleep(Duration::from_millis(20));
        write(&projects.join("p2").join("mid.jsonl"), &line("C:\\two"));
        std::thread::sleep(Duration::from_millis(20));
        write(&projects.join("p1").join("new.jsonl"), &line("C:\\one"));

        let now = SystemTime::now();
        let sessions = scan(&projects, now, MAX_AGE);
        let cwds: Vec<_> = sessions.iter().map(|s| s.cwd.as_str()).collect();
        assert_eq!(cwds, ["C:\\one", "C:\\two"]);
        assert_eq!(sessions[0].session_id, "new");

        // Everything is "old" if the window is in the future.
        let later = now + Duration::from_secs(3600);
        assert!(scan(&projects, later, Duration::from_secs(60)).is_empty());
    }

    #[test]
    fn missing_projects_dir_is_empty() {
        assert!(scan(Path::new("Z:\\definitely\\not\\here"), SystemTime::now(), MAX_AGE).is_empty());
    }
}
