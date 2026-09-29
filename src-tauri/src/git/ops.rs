//! Staging-area operations: stage, unstage, discard. The index *is* the next commit.

use std::path::Path;

use super::status::{ChangeKind, FileChange};
use super::{git, run, with_paths, Result};

/// Both sides of a rename: unstaging only the new path would leave the old one staged as deleted.
fn with_origins(files: &[FileChange]) -> Vec<String> {
    files
        .iter()
        .flat_map(|f| f.orig_path.iter().cloned().chain(std::iter::once(f.path.clone())))
        .collect()
}

/// Stage working-tree changes: edits, deletions, untracked files, resolved conflicts.
pub fn stage(repo: &Path, files: &[FileChange]) -> Result<()> {
    let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    if !paths.is_empty() {
        with_paths(repo, &["add"], &paths)?;
    }
    Ok(())
}

pub fn stage_all(repo: &Path) -> Result<()> {
    git(repo, &["add", "-A"]).map(drop)
}

fn has_commits(repo: &Path) -> Result<bool> {
    Ok(run(repo, &["rev-parse", "-q", "--verify", "HEAD"])?.ok())
}

/// Move staged changes back to the working tree. The edits themselves are kept.
pub fn unstage(repo: &Path, files: &[FileChange]) -> Result<()> {
    let paths = with_origins(files);
    if paths.is_empty() {
        return Ok(());
    }
    // `restore --staged` needs a HEAD to restore from; before the first commit, drop the entries instead.
    if has_commits(repo)? {
        with_paths(repo, &["restore", "--staged"], &paths)?;
    } else {
        with_paths(repo, &["rm", "--cached", "-r", "-q"], &paths)?;
    }
    Ok(())
}

pub fn unstage_all(repo: &Path) -> Result<()> {
    if has_commits(repo)? {
        git(repo, &["reset", "-q"])?;
    } else {
        git(repo, &["rm", "--cached", "-r", "-q", "--ignore-unmatch", "."])?;
    }
    Ok(())
}

/// Windows caps a command line at 32,767 chars; `git clean` has no --pathspec-from-file.
const MAX_ARGS_CHARS: usize = 30_000;

/// Throw away unstaged changes: tracked files go back to their staged (or committed) version,
/// untracked files are deleted. Irreversible; the UI confirms first.
pub fn discard(repo: &Path, files: &[FileChange]) -> Result<()> {
    let (untracked, tracked): (Vec<&FileChange>, Vec<&FileChange>) =
        files.iter().partition(|f| f.kind == ChangeKind::Untracked);
    if !tracked.is_empty() {
        let paths: Vec<String> = tracked.iter().map(|f| f.path.clone()).collect();
        with_paths(repo, &["restore", "--worktree"], &paths)?;
    }
    let mut chunk: Vec<&str> = Vec::new();
    let mut len = 0;
    for (i, f) in untracked.iter().enumerate() {
        chunk.push(&f.path);
        len += f.path.len() + 1;
        if len > MAX_ARGS_CHARS || i == untracked.len() - 1 {
            let mut args = vec!["--literal-pathspecs", "clean", "-f", "-q", "--"];
            args.extend(chunk.drain(..));
            git(repo, &args)?;
            len = 0;
        }
    }
    Ok(())
}

/// Ignore one untracked file: append it to the repo's root `.gitignore`, anchored (`/path`)
/// with glob characters escaped so it matches only that file.
pub fn add_to_gitignore(repo: &Path, path: &str) -> Result<()> {
    let bad = path.is_empty() || path.starts_with('/') || path.contains(['\\', ':', '\n']) || path.split('/').any(|s| s == ".." || s.is_empty());
    if bad {
        return Err(format!("Can't ignore \"{path}\"."));
    }
    let mut pattern = String::from("/");
    for c in path.chars() {
        if matches!(c, '*' | '?' | '[' | '\\') {
            pattern.push('\\');
        }
        pattern.push(c);
    }
    if pattern.ends_with(' ') {
        pattern.pop();
        pattern.push_str("\\ ");
    }
    let file = repo.join(".gitignore");
    let existing = std::fs::read_to_string(&file).unwrap_or_default();
    if existing.lines().any(|l| l.trim_end_matches('\r') == pattern) {
        return Ok(());
    }
    let crlf = existing.contains("\r\n");
    let nl = if crlf { "\r\n" } else { "\n" };
    let mut text = existing;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push_str(nl);
    }
    text.push_str(&pattern);
    text.push_str(nl);
    std::fs::write(&file, text).map_err(|e| format!("Couldn't write .gitignore: {e}"))
}

#[cfg(test)]
mod tests {
    use super::super::status::get_status;
    use super::super::testutil::*;
    use super::*;
    use ChangeKind::*;

    fn fc(path: &str, kind: ChangeKind) -> FileChange {
        FileChange { path: path.into(), orig_path: None, kind }
    }
    fn lists(repo: &Path) -> (Vec<String>, Vec<String>) {
        let s = get_status(repo).unwrap().parsed;
        let names = |v: Vec<FileChange>| v.into_iter().map(|f| f.path).collect();
        (names(s.staged), names(s.unstaged))
    }

    #[test]
    fn stage_and_unstage_edits_deletions_new_files_and_odd_names() {
        let repo = make_repo(&[("a.ts", "a\n"), ("gone.ts", "g\n")]);
        write(&repo, "a.ts", "a2\n");
        std::fs::remove_file(repo.join("gone.ts")).unwrap();
        write(&repo, "dir with space/new ü.ts", "n\n");
        write(&repo, "[ab].ts", "glob-looking name\n");
        write(&repo, "-flag.ts", "dash\n");

        let unstaged = get_status(&repo).unwrap().parsed.unstaged;
        stage(&repo, &unstaged).unwrap();
        let (staged, rest) = lists(&repo);
        assert_eq!(staged.len(), 5);
        assert!(rest.is_empty());

        // As a glob, `[ab].ts` would also match a.ts; as a literal it's just that one file.
        unstage(&repo, &[fc("[ab].ts", Added), fc("gone.ts", Deleted)]).unwrap();
        let (staged, rest) = lists(&repo);
        assert_eq!(staged, vec!["-flag.ts", "a.ts", "dir with space/new ü.ts"]);
        assert_eq!(rest, vec!["gone.ts", "[ab].ts"]);
    }

    #[test]
    fn unstaging_a_rename_restores_both_sides() {
        let repo = make_repo(&[("old.ts", "o\n")]);
        sh(&repo, &["mv", "old.ts", "new.ts"]);
        let staged = get_status(&repo).unwrap().parsed.staged;
        assert_eq!(staged[0].orig_path.as_deref(), Some("old.ts"));
        unstage(&repo, &staged).unwrap();
        let s = get_status(&repo).unwrap().parsed;
        assert!(s.staged.is_empty());
        assert_eq!(s.unstaged, vec![fc("old.ts", Deleted), fc("new.ts", Untracked)]);
    }

    #[test]
    fn unstage_works_before_the_first_commit() {
        let repo = empty_repo();
        write(&repo, "a.ts", "a\n");
        write(&repo, "b.ts", "b\n");
        stage_all(&repo).unwrap();
        unstage(&repo, &[fc("a.ts", Added)]).unwrap();
        assert_eq!(lists(&repo), (vec!["b.ts".into()], vec!["a.ts".into()]));
        unstage_all(&repo).unwrap();
        assert_eq!(lists(&repo).0, Vec::<String>::new());
    }

    #[test]
    fn unstage_all_keeps_the_edits() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        write(&repo, "a.ts", "a2\n");
        stage_all(&repo).unwrap();
        unstage_all(&repo).unwrap();
        assert_eq!(lists(&repo), (vec![], vec!["a.ts".into()]));
        assert_eq!(read(&repo, "a.ts"), "a2\n");
    }

    #[test]
    fn ignores_exactly_one_file() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        write(&repo, ".gitignore", "node_modules");
        write(&repo, "[ab].ts", "x\n");
        write(&repo, "b.ts", "b\n");
        write(&repo, "logs/debug.log", "x\n");
        add_to_gitignore(&repo, "[ab].ts").unwrap();
        add_to_gitignore(&repo, "logs/debug.log").unwrap();
        add_to_gitignore(&repo, "logs/debug.log").unwrap();
        assert_eq!(read(&repo, ".gitignore"), "node_modules\n/\\[ab].ts\n/logs/debug.log\n");
        // `[ab].ts` as a glob would also hide b.ts; escaped, only the literal file goes.
        assert_eq!(lists(&repo).1, vec![".gitignore", "b.ts"]);
        for bad in ["../x", "/abs", "C:/x", "a//b", ""] {
            assert!(add_to_gitignore(&repo, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn discard_restores_tracked_to_the_staged_version_and_deletes_untracked() {
        let repo = make_repo(&[("a.ts", "a\n"), ("b.ts", "b\n")]);
        write(&repo, "a.ts", "staged\n");
        sh(&repo, &["add", "a.ts"]);
        write(&repo, "a.ts", "staged then edited\n");
        std::fs::remove_file(repo.join("b.ts")).unwrap();
        write(&repo, "junk/new.txt", "x\n");
        write(&repo, "keep.txt", "k\n");

        discard(&repo, &[fc("a.ts", Modified), fc("b.ts", Deleted), fc("junk/new.txt", Untracked)]).unwrap();
        assert_eq!(read(&repo, "a.ts"), "staged\n");
        assert_eq!(read(&repo, "b.ts"), "b\n");
        assert!(!repo.join("junk/new.txt").exists());
        assert_eq!(lists(&repo), (vec!["a.ts".into()], vec!["keep.txt".into()]));
    }
}
