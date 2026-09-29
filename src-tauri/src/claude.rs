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

/// Session logs modified within `max_age` of `now`, newest first.
pub fn recent_logs(projects: &Path, now: SystemTime, max_age: Duration) -> Vec<(PathBuf, SystemTime)> {
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
    logs
}

/// Sessions modified within `max_age` of `now`, newest first, one per distinct `cwd`.
pub fn scan(projects: &Path, now: SystemTime, max_age: Duration) -> Vec<ClaudeSession> {
    let logs = recent_logs(projects, now, max_age);
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

/// The top-level `cwd` of the last line that has one.
pub fn last_cwd(path: &Path) -> std::io::Result<Option<String>> {
    let mut found = None;
    lines_backward(path, |line| {
        found = cwd_of(line);
        found.is_some()
    })?;
    Ok(found)
}

/// Feeds complete lines to `stop`, newest first, until it returns true or MAX_SCAN bytes
/// have been read. Reads backward in chunks, so multi-megabyte logs cost only their tail.
fn lines_backward(path: &Path, mut stop: impl FnMut(&[u8]) -> bool) -> std::io::Result<()> {
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
            if stop(line) {
                return Ok(());
            }
        }
        buf.truncate(complete_from);
        carry = buf;
    }
    Ok(())
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

// ---- Your prompts, as commit message suggestions ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudePrompt {
    pub text: String,
    pub at_ms: u64,
}

/// "2026-09-29T13:23:51.859Z" → Unix ms. Only the UTC form Claude Code writes.
pub fn parse_timestamp(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[10] != b'T' || !s.ends_with('Z') {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let ms = match s.get(19..20) {
        Some(".") => s[20..s.len() - 1].get(..3).and_then(|f| f.parse::<i64>().ok()).unwrap_or(0),
        _ => 0,
    };
    // Days from 1970-01-01 (Howard Hinnant's days_from_civil).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(((days * 24 + hh) * 60 + mm) * 60 * 1000 + ss * 1000 + ms).ok()
}

enum Entry {
    Prompt(ClaudePrompt),
    /// Some other line, with its time when it has one.
    Other(Option<u64>),
}

/// A line the user typed: a top-level user message whose content is text, not a tool result,
/// a system/meta injection, a slash command's wrapper, or a subagent's.
fn entry_of(line: &[u8]) -> Entry {
    let other = |v: &serde_json::Value| Entry::Other(v.get("timestamp").and_then(|t| t.as_str()).and_then(parse_timestamp));
    if !line.windows(6).any(|w| w == b"\"user\"") {
        // Not a user entry; its time still bounds the search, but parsing every line would be slow.
        return Entry::Other(None);
    }
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(line) else { return Entry::Other(None) };
    let flag = |k: &str| v.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
    if v.get("type").and_then(|t| t.as_str()) != Some("user") || flag("isMeta") || flag("isSidechain") {
        return other(&v);
    }
    let content = v.get("message").and_then(|m| m.get("content"));
    let text = match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(blocks)) => {
            if blocks.iter().any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result")) {
                return other(&v);
            }
            blocks.iter().filter_map(|b| b.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("\n")
        }
        _ => return other(&v),
    };
    let text = text.trim();
    if text.is_empty() || text.starts_with('<') || text.starts_with("[Request interrupted") {
        return other(&v);
    }
    match v.get("timestamp").and_then(|t| t.as_str()).and_then(parse_timestamp) {
        Some(at_ms) => Entry::Prompt(ClaudePrompt { text: text.to_owned(), at_ms }),
        None => Entry::Other(None),
    }
}

/// Prompts typed at or after `since_ms` in these session logs, newest first, without repeats.
pub fn prompts_since(logs: &[PathBuf], since_ms: u64, limit: usize) -> Vec<ClaudePrompt> {
    let mut all: Vec<ClaudePrompt> = Vec::new();
    for log in logs {
        let _ = lines_backward(log, |line| match entry_of(line) {
            Entry::Prompt(p) if p.at_ms >= since_ms => {
                all.push(p);
                false
            }
            // Older than the last commit: everything before it is too.
            Entry::Prompt(_) => true,
            Entry::Other(Some(t)) => t < since_ms,
            Entry::Other(None) => false,
        });
    }
    all.sort_by_key(|p| std::cmp::Reverse(p.at_ms));
    let mut seen = HashSet::new();
    all.retain(|p| seen.insert(p.text.clone()));
    all.truncate(limit);
    all
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
    fn parses_claude_timestamps() {
        assert_eq!(parse_timestamp("2026-09-29T13:23:51.859Z"), Some(1_790_688_231_859));
        assert_eq!(parse_timestamp("2000-02-29T00:00:00Z"), Some(951_782_400_000));
        assert_eq!(parse_timestamp("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_timestamp("yesterday"), None);
    }

    #[test]
    fn reads_only_what_the_user_typed_since_the_last_commit() {
        let at = |s: u32| format!("2026-09-29T10:00:{s:02}.000Z");
        let user = |s: u32, content: serde_json::Value, extra: &str| {
            format!("{{\"type\":\"user\",\"timestamp\":\"{}\",{extra}\"message\":{{\"role\":\"user\",\"content\":{content}}}}}\n", at(s))
        };
        let s = serde_json::Value::from;
        let log = [
            user(1, s("before the commit"), ""),
            user(10, s("Add a dark mode toggle"), ""),
            format!("{{\"type\":\"assistant\",\"timestamp\":\"{}\",\"message\":{{}}}}\n", at(11)),
            user(12, serde_json::json!([{ "type": "tool_result", "content": "ok" }]), ""),
            user(13, s("Caveat: meta"), "\"isMeta\":true,"),
            user(14, s("subagent task"), "\"isSidechain\":true,"),
            user(15, s("<command-name>/clear</command-name>"), ""),
            user(16, serde_json::json!([{ "type": "text", "text": "  Fix the tray flicker\n" }, { "type": "image" }]), ""),
            user(17, s("Add a dark mode toggle"), ""),
        ]
        .concat();
        let dir = temp_dir();
        let f = dir.join("s.jsonl");
        write(&f, &log);

        let since = parse_timestamp(&at(5)).unwrap();
        let got: Vec<_> = prompts_since(std::slice::from_ref(&f), since, 8).into_iter().map(|p| p.text).collect();
        assert_eq!(got, ["Add a dark mode toggle", "Fix the tray flicker"]);
        assert_eq!(prompts_since(std::slice::from_ref(&f), 0, 1).len(), 1);
        assert!(prompts_since(&[f], u64::MAX, 8).is_empty());
    }

    #[test]
    fn missing_projects_dir_is_empty() {
        assert!(scan(Path::new("Z:\\definitely\\not\\here"), SystemTime::now(), MAX_AGE).is_empty());
    }
}
