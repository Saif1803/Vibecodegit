//! Stashes: save (tracked / with untracked / staged only), list, inspect, apply, pop, drop.
//!
//! Stashes are addressed as `stash@{n}`, but indexes shift whenever anyone (Claude, a terminal)
//! stashes or drops. Every apply/pop/drop checks that `stash@{n}` is still the hash the UI saw.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::diff::{parse_diff, FileDiff, MAX_LINES};
use super::status::{ChangeKind, FileChange};
use super::{git, run, Outcome, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: u32,
    pub hash: String,
    pub date_ms: u64,
    /// The stash message (or git's "WIP on …" subject).
    pub message: String,
    /// Branch it was made on, when git recorded one.
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StashMode {
    /// Tracked changes, staged and unstaged (`git stash`).
    Tracked,
    /// Also untracked files (`--include-untracked`).
    IncludeUntracked,
    /// Only what is staged (`--staged`, git ≥ 2.35).
    Staged,
}

pub fn list_stashes(repo: &Path) -> Result<Vec<StashEntry>> {
    let out = git(repo, &["stash", "list", "--format=%gd%x00%H%x00%ct%x00%gs"])?;
    Ok(out.lines().filter_map(parse_entry).collect())
}

fn parse_entry(line: &str) -> Option<StashEntry> {
    let mut f = line.splitn(4, '\0');
    let (selector, hash, time, subject) = (f.next()?, f.next()?, f.next()?, f.next()?);
    let index = selector.strip_prefix("stash@{")?.strip_suffix('}')?.parse().ok()?;
    // "On main: message" for `stash push -m`, "WIP on main: abc123 subject" otherwise.
    let (branch, message) = match subject.split_once(": ") {
        Some((head, rest)) if head.starts_with("On ") => (Some(head[3..].to_owned()), rest.to_owned()),
        Some((head, _)) if head.starts_with("WIP on ") => (Some(head[7..].to_owned()), subject.to_owned()),
        _ => (None, subject.to_owned()),
    };
    Some(StashEntry { index, hash: hash.to_owned(), date_ms: time.parse::<u64>().unwrap_or(0) * 1000, message, branch })
}

pub fn stash_push(repo: &Path, message: &str, mode: StashMode) -> Result<()> {
    let mut args = vec!["stash", "push"];
    match mode {
        StashMode::Tracked => {}
        StashMode::IncludeUntracked => args.push("--include-untracked"),
        StashMode::Staged => args.push("--staged"),
    }
    if !message.trim().is_empty() {
        args.extend(["-m", message]);
    }
    let out = git(repo, &args)?;
    // git exits 0 when there's nothing to stash.
    if out.contains("No local changes to save") {
        return Err("No local changes to stash.".into());
    }
    Ok(())
}

/// `stash@{index}`, after checking it still names `hash`.
fn selector(repo: &Path, index: u32, hash: &str) -> Result<String> {
    let sel = format!("stash@{{{index}}}");
    let actual = run(repo, &["rev-parse", "-q", "--verify", &sel])?;
    if !actual.ok() || actual.stdout.trim() != hash {
        return Err("The stash list changed since it was shown. Refresh and try again.".into());
    }
    Ok(sel)
}

/// Apply (or pop) a stash, restoring what was staged as staged when possible.
/// A stash is only ever dropped after it applied cleanly.
pub fn stash_apply(repo: &Path, index: u32, hash: &str, pop: bool) -> Result<Outcome> {
    let sel = selector(repo, index, hash)?;
    let verb = if pop { "pop" } else { "apply" };
    let done = if pop { "Popped" } else { "Applied" };
    let with_index = run(repo, &["stash", verb, "--index", "--quiet", &sel])?;
    if with_index.ok() {
        return Ok(Outcome::ok(format!("{done} {sel}."), None));
    }
    // `--index` refuses up front when the staged state can't be rebuilt; retry without it.
    if with_index.stderr.contains("--index") {
        let plain = run(repo, &["stash", verb, "--quiet", &sel])?;
        if plain.ok() {
            return Ok(Outcome::ok(format!("{done} {sel}."), Some("Its changes were restored, but not as staged.".into())));
        }
        return conflict_or_error(repo, plain.message(), pop);
    }
    conflict_or_error(repo, with_index.message(), pop)
}

/// `--quiet` hides git's CONFLICT lines, so look for unmerged paths instead of parsing text.
fn conflict_or_error(repo: &Path, message: String, pop: bool) -> Result<Outcome> {
    let unmerged = git(repo, &["diff", "--name-only", "--diff-filter=U"])?;
    if !unmerged.trim().is_empty() {
        let kept = if pop { " The stash was kept." } else { "" };
        return Ok(Outcome::fail(format!("The stash conflicts with your files. Resolve the conflicts in your editor.{kept}")));
    }
    Ok(Outcome::fail(message))
}

pub fn stash_drop(repo: &Path, index: u32, hash: &str) -> Result<()> {
    let sel = selector(repo, index, hash)?;
    git(repo, &["stash", "drop", "--quiet", &sel]).map(drop)
}

pub fn stash_clear(repo: &Path) -> Result<()> {
    git(repo, &["stash", "clear"]).map(drop)
}

/// Files in a stash: tracked changes (vs. the commit it was made on) plus any untracked files.
pub fn stash_files(repo: &Path, hash: &str) -> Result<Vec<FileChange>> {
    let base = format!("{hash}^1");
    let out = git(repo, &["diff", "--name-status", "-z", "--no-renames", &base, hash])?;
    let mut files = Vec::new();
    let mut fields = out.split('\0');
    while let (Some(status), Some(path)) = (fields.next(), fields.next()) {
        let kind = match status.chars().next() {
            Some('A') => ChangeKind::Added,
            Some('D') => ChangeKind::Deleted,
            _ => ChangeKind::Modified,
        };
        files.push(FileChange { path: path.to_owned(), orig_path: None, kind });
    }
    // The third parent, when present, holds the untracked files.
    let untracked = format!("{hash}^3");
    if run(repo, &["rev-parse", "-q", "--verify", &untracked])?.ok() {
        let out = git(repo, &["ls-tree", "-r", "-z", "--name-only", &untracked])?;
        files.extend(out.split('\0').filter(|p| !p.is_empty()).map(|p| FileChange { path: p.to_owned(), orig_path: None, kind: ChangeKind::Untracked }));
    }
    Ok(files)
}

pub fn stash_file_diff(repo: &Path, hash: &str, file: &FileChange) -> Result<FileDiff> {
    let out = if file.kind == ChangeKind::Untracked {
        // The untracked commit has no parent, so `show` diffs it against nothing.
        git(repo, &["show", "--format=", "--no-ext-diff", "--no-textconv", &format!("{hash}^3"), "--", &file.path])?
    } else {
        git(repo, &["diff", "--no-ext-diff", "--no-textconv", &format!("{hash}^1"), hash, "--", &file.path])?
    };
    Ok(parse_diff(&out, MAX_LINES))
}

#[cfg(test)]
mod tests {
    use super::super::status::get_status;
    use super::super::testutil::*;
    use super::*;

    fn clean(repo: &Path) -> bool {
        let s = get_status(repo).unwrap().parsed;
        s.staged.is_empty() && s.unstaged.is_empty()
    }

    #[test]
    fn parses_subjects() {
        let e = parse_entry("stash@{2}\0abc\01700000000\0On feat/x: before lunch").unwrap();
        assert_eq!((e.index, e.branch.as_deref(), e.message.as_str()), (2, Some("feat/x"), "before lunch"));
        let w = parse_entry("stash@{0}\0abc\01\0WIP on main: 1234567 subject").unwrap();
        assert_eq!((w.branch.as_deref(), w.message.as_str()), (Some("main"), "WIP on main: 1234567 subject"));
    }

    #[test]
    fn each_mode_stashes_the_right_things() {
        let repo = make_repo(&[("a.ts", "a\n"), ("b.ts", "b\n")]);
        assert_eq!(stash_push(&repo, "", StashMode::Tracked).unwrap_err(), "No local changes to stash.");

        write(&repo, "a.ts", "a2\n");
        write(&repo, "new.txt", "n\n");
        stash_push(&repo, "tracked only", StashMode::Tracked).unwrap();
        assert!(repo.join("new.txt").exists());
        assert_eq!(read(&repo, "a.ts"), "a\n");

        stash_push(&repo, "with untracked", StashMode::IncludeUntracked).unwrap();
        assert!(!repo.join("new.txt").exists());

        write(&repo, "a.ts", "staged\n");
        sh(&repo, &["add", "a.ts"]);
        write(&repo, "b.ts", "unstaged\n");
        stash_push(&repo, "staged only", StashMode::Staged).unwrap();
        assert_eq!(read(&repo, "a.ts"), "a\n");
        assert_eq!(read(&repo, "b.ts"), "unstaged\n");

        let list = list_stashes(&repo).unwrap();
        assert_eq!(list.iter().map(|s| s.message.as_str()).collect::<Vec<_>>(), ["staged only", "with untracked", "tracked only"]);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
    }

    #[test]
    fn lists_files_and_diffs_including_untracked() {
        let repo = make_repo(&[("a.ts", "a\n"), ("gone.ts", "g\n")]);
        write(&repo, "a.ts", "a2\n");
        std::fs::remove_file(repo.join("gone.ts")).unwrap();
        write(&repo, "dir/new.txt", "fresh\n");
        stash_push(&repo, "m", StashMode::IncludeUntracked).unwrap();
        let s = &list_stashes(&repo).unwrap()[0];

        let files = stash_files(&repo, &s.hash).unwrap();
        let kinds: Vec<_> = files.iter().map(|f| (f.path.as_str(), f.kind)).collect();
        assert_eq!(kinds, [("a.ts", ChangeKind::Modified), ("gone.ts", ChangeKind::Deleted), ("dir/new.txt", ChangeKind::Untracked)]);
        let d = stash_file_diff(&repo, &s.hash, &files[0]).unwrap();
        assert_eq!(d.hunks[0].lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), ["a", "a2"]);
        let u = stash_file_diff(&repo, &s.hash, &files[2]).unwrap();
        assert_eq!(u.hunks[0].lines[0].text, "fresh");
    }

    #[test]
    fn apply_keeps_pop_drops_and_staged_state_comes_back() {
        let repo = make_repo(&[("a.ts", "a\n"), ("b.ts", "b\n")]);
        write(&repo, "a.ts", "staged\n");
        sh(&repo, &["add", "a.ts"]);
        write(&repo, "b.ts", "unstaged\n");
        stash_push(&repo, "m", StashMode::Tracked).unwrap();
        assert!(clean(&repo));
        let s = list_stashes(&repo).unwrap().remove(0);

        assert!(stash_apply(&repo, 0, &s.hash, false).unwrap().ok);
        let st = get_status(&repo).unwrap().parsed;
        assert_eq!((st.staged[0].path.as_str(), st.unstaged[0].path.as_str()), ("a.ts", "b.ts"));
        assert_eq!(list_stashes(&repo).unwrap().len(), 1);

        sh(&repo, &["reset", "-q", "--hard"]);
        assert!(stash_apply(&repo, 0, &s.hash, true).unwrap().ok);
        assert!(list_stashes(&repo).unwrap().is_empty());
    }

    #[test]
    fn falls_back_to_a_plain_apply_when_the_index_cant_be_rebuilt() {
        let repo = make_repo(&[("a.ts", "a\n"), ("b.ts", "b\n")]);
        write(&repo, "a.ts", "staged\n");
        sh(&repo, &["add", "a.ts"]);
        write(&repo, "a.ts", "final\n");
        write(&repo, "b.ts", "unstaged\n");
        stash_push(&repo, "m", StashMode::Tracked).unwrap();
        let s = list_stashes(&repo).unwrap().remove(0);
        // HEAD now has the working-tree version of a.ts: the tree merges cleanly, the staged patch doesn't.
        write(&repo, "a.ts", "final\n");
        sh(&repo, &["commit", "-qam", "same edit"]);

        let r = stash_apply(&repo, 0, &s.hash, true).unwrap();
        assert!(r.ok && r.warning.as_deref() == Some("Its changes were restored, but not as staged."), "{r:?}");
        assert_eq!(read(&repo, "b.ts"), "unstaged\n");
        assert!(list_stashes(&repo).unwrap().is_empty());
    }

    #[test]
    fn refuses_a_stale_index_and_keeps_a_conflicting_pop() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        write(&repo, "a.ts", "first\n");
        stash_push(&repo, "one", StashMode::Tracked).unwrap();
        let one = list_stashes(&repo).unwrap().remove(0);
        write(&repo, "a.ts", "second\n");
        stash_push(&repo, "two", StashMode::Tracked).unwrap();
        // "one" moved to stash@{1}; the old index now names "two".
        assert!(stash_drop(&repo, 0, &one.hash).unwrap_err().contains("changed"));

        write(&repo, "a.ts", "conflicting\n");
        sh(&repo, &["commit", "-qam", "moved on"]);
        let r = stash_apply(&repo, 1, &one.hash, true).unwrap();
        assert!(!r.ok && r.message.contains("stash was kept"), "{r:?}");
        assert_eq!(list_stashes(&repo).unwrap().len(), 2);

        sh(&repo, &["reset", "-q", "--hard"]);
        stash_drop(&repo, 1, &one.hash).unwrap();
        assert_eq!(list_stashes(&repo).unwrap()[0].message, "two");
        stash_clear(&repo).unwrap();
        assert!(list_stashes(&repo).unwrap().is_empty());
    }
}
