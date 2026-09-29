//! Folder → repo root resolution, and grouping Claude Code sessions by the repo they're in.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use super::run;
use crate::claude::ClaudeSession;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoRef {
    /// Absolute repo root, with native separators.
    pub path: String,
    pub name: String,
}

/// `{ ok: true, repo }` or `{ ok: false, reason: "missing" | "not-a-repo", message }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Resolved {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<RepoRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// `C:/a/b/` → `C:\a\b` for drive paths; other paths just lose a trailing slash.
pub fn normalize_path(path: &str) -> String {
    let b = path.as_bytes();
    let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\');
    let p = if drive { path.replace('/', "\\") } else { path.to_owned() };
    if p.len() > 3 {
        p.trim_end_matches(['/', '\\']).to_owned()
    } else {
        p
    }
}

/// Case-insensitive for drive paths, which is how Windows compares them.
pub fn same_path(a: &str, b: &str) -> bool {
    let (na, nb) = (normalize_path(a), normalize_path(b));
    if na.as_bytes().get(1) == Some(&b':') {
        na.eq_ignore_ascii_case(&nb)
    } else {
        na == nb
    }
}

pub fn repo_name(path: &str) -> String {
    normalize_path(path).rsplit(['\\', '/']).find(|s| !s.is_empty()).unwrap_or(path).to_owned()
}

/// Any folder inside a work tree → its root (a worktree resolves to itself).
pub fn resolve_repo(folder: &str) -> Resolved {
    let fail = |reason, message: String| Resolved { ok: false, repo: None, reason: Some(reason), message: Some(message) };
    if !Path::new(folder).is_dir() {
        return fail("missing", format!("Folder not found: {folder}"));
    }
    match run(Path::new(folder), &["rev-parse", "--show-toplevel"]) {
        Ok(out) if out.ok() && !out.stdout.trim().is_empty() => {
            let path = normalize_path(out.stdout.trim());
            Resolved { ok: true, repo: Some(RepoRef { name: repo_name(&path), path }), reason: None, message: None }
        }
        Ok(_) => fail("not-a-repo", format!("Not a git repository: {folder}")),
        Err(e) => fail("missing", e),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRepo {
    #[serde(flatten)]
    pub repo: RepoRef,
    pub last_active_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRepos {
    /// Repos with a Claude session in the window, most recently active first.
    pub repos: Vec<ClaudeRepo>,
    /// Session folders that aren't inside a git repo.
    pub non_repos: Vec<ClaudeSession>,
    /// The newest session overall, so the UI can tell when Claude is outside any repo.
    pub newest_session_id: Option<String>,
}

/// Maps session cwds to repo roots and merges sessions that share a repo.
pub fn group_sessions(sessions: Vec<ClaudeSession>, resolve: impl Fn(&str) -> Option<RepoRef>) -> ClaudeRepos {
    let newest_session_id = sessions.first().map(|s| s.session_id.clone());
    let mut repos: Vec<ClaudeRepo> = Vec::new();
    let mut non_repos = Vec::new();
    for s in sessions {
        let Some(repo) = resolve(&s.cwd) else {
            non_repos.push(s);
            continue;
        };
        match repos.iter_mut().find(|r| same_path(&r.repo.path, &repo.path)) {
            Some(existing) => existing.last_active_ms = existing.last_active_ms.max(s.last_active_ms),
            None => repos.push(ClaudeRepo { repo, last_active_ms: s.last_active_ms }),
        }
    }
    repos.sort_by_key(|r| std::cmp::Reverse(r.last_active_ms));
    ClaudeRepos { repos, non_repos, newest_session_id }
}

/// cwd → repo root. Only successes are cached: a folder can become a repo later.
pub fn resolve_cached(cwd: &str) -> Option<RepoRef> {
    static CACHE: Mutex<Option<HashMap<String, RepoRef>>> = Mutex::new(None);
    if let Some(hit) = CACHE.lock().unwrap().get_or_insert_with(HashMap::new).get(cwd) {
        return Some(hit.clone());
    }
    let repo = resolve_repo(cwd).repo?;
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(cwd.to_owned(), repo.clone());
    Some(repo)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;

    #[test]
    fn normalizes_and_compares_paths() {
        assert_eq!(normalize_path("C:/a/b/"), "C:\\a\\b");
        assert_eq!(normalize_path("C:\\"), "C:\\");
        assert_eq!(normalize_path("/home/x/"), "/home/x");
        assert!(same_path("c:/WORK/b", "C:\\work\\b\\"));
        assert!(!same_path("/a/B", "/a/b"));
        assert_eq!(repo_name("C:\\work\\ClaudeGit\\"), "ClaudeGit");
    }

    #[test]
    fn resolves_subfolders_to_the_root_and_reports_problems() {
        let repo = make_repo(&[("src/a.ts", "a\n")]);
        let r = resolve_repo(&repo.join("src").to_string_lossy());
        assert!(r.ok);
        assert!(same_path(&r.repo.unwrap().path, &repo.to_string_lossy()));

        let plain = temp_dir();
        assert_eq!(resolve_repo(&plain.to_string_lossy()).reason, Some("not-a-repo"));
        assert_eq!(resolve_repo(&plain.join("nope").to_string_lossy()).reason, Some("missing"));
    }

    #[test]
    fn groups_sessions_by_repo_newest_first() {
        let s = |cwd: &str, id: &str, t: u64| ClaudeSession { cwd: cwd.into(), session_id: id.into(), last_active_ms: t };
        let resolve = |cwd: &str| match cwd {
            "C:\\a" | "C:\\a\\sub" => Some(RepoRef { path: "C:\\a".into(), name: "a".into() }),
            "C:\\b" => Some(RepoRef { path: "C:\\b".into(), name: "b".into() }),
            _ => None,
        };
        let g = group_sessions(vec![s("C:\\x", "s0", 50), s("C:\\a\\sub", "s1", 40), s("C:\\b", "s2", 30), s("C:\\a", "s3", 20)], resolve);
        assert_eq!(g.repos.iter().map(|r| (r.repo.name.as_str(), r.last_active_ms)).collect::<Vec<_>>(), [("a", 40), ("b", 30)]);
        assert_eq!(g.non_repos.len(), 1);
        assert_eq!(g.newest_session_id.as_deref(), Some("s0"));
    }
}
