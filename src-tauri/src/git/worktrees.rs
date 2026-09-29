//! Worktrees: extra checkouts of the same repo (Claude Code runs sessions in them).

use std::path::Path;

use serde::Serialize;

use super::branches::check_branch_name;
use super::repo::{normalize_path, resolve_repo, same_path, RepoRef};
use super::{git, run, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// Absolute, native separators.
    pub path: String,
    /// None when detached.
    pub branch: Option<String>,
    pub head: String,
    /// The repo's original checkout; it can't be removed.
    pub main: bool,
    /// The selected repo is this worktree.
    pub current: bool,
    pub locked: bool,
    /// Its folder is gone; `git worktree prune` would drop it.
    pub prunable: bool,
}

/// `git worktree list --porcelain`: blank-line-separated records of "key value" lines.
pub fn parse_worktrees(out: &str, current: &Path) -> Vec<Worktree> {
    let current = current.to_string_lossy();
    out.split("\n\n")
        .filter_map(|rec| {
            let mut wt: Option<Worktree> = None;
            for line in rec.lines() {
                let (key, value) = line.split_once(' ').unwrap_or((line, ""));
                match (key, wt.as_mut()) {
                    ("worktree", _) => {
                        let path = normalize_path(value);
                        wt = Some(Worktree {
                            current: same_path(&path, &current),
                            path,
                            branch: None,
                            head: String::new(),
                            main: false,
                            locked: false,
                            prunable: false,
                        })
                    }
                    ("HEAD", Some(w)) => w.head = value.chars().take(7).collect(),
                    ("branch", Some(w)) => w.branch = Some(value.strip_prefix("refs/heads/").unwrap_or(value).to_owned()),
                    ("locked", Some(w)) => w.locked = true,
                    ("prunable", Some(w)) => w.prunable = true,
                    _ => {}
                }
            }
            wt
        })
        .enumerate()
        .map(|(i, mut w)| {
            w.main = i == 0; // git always lists the main worktree first
            w
        })
        .collect()
}

pub fn list_worktrees(repo: &Path) -> Result<Vec<Worktree>> {
    Ok(parse_worktrees(&git(repo, &["worktree", "list", "--porcelain"])?, repo))
}

/// A new worktree at `path` (relative to the repo root, or absolute) on `branch`, which is
/// created from HEAD when `new_branch`. Returns the new checkout so the UI can open it.
pub fn add_worktree(repo: &Path, path: &str, branch: &str, new_branch: bool) -> Result<RepoRef> {
    if path.trim().is_empty() || path.starts_with('-') {
        return Err("Pick a folder for the worktree.".into());
    }
    if new_branch {
        check_branch_name(repo, branch)?;
        git(repo, &["worktree", "add", "-b", branch, "--", path])?;
    } else {
        if !run(repo, &["rev-parse", "-q", "--verify", &format!("refs/heads/{branch}")])?.ok() {
            return Err(format!("There's no local branch named \"{branch}\"."));
        }
        git(repo, &["worktree", "add", "--", path, branch])?;
    }
    let full = if Path::new(path).is_absolute() { Path::new(path).to_path_buf() } else { repo.join(path) };
    let resolved = resolve_repo(&full.to_string_lossy());
    resolved.repo.ok_or_else(|| resolved.message.unwrap_or_else(|| "The worktree was created but couldn't be opened.".into()))
}

/// Removes a linked worktree's folder. `force` also drops its uncommitted changes (the UI
/// asks a second time for that). The main worktree and the selected one can't be removed.
pub fn remove_worktree(repo: &Path, path: &str, force: bool) -> Result<()> {
    let list = list_worktrees(repo)?;
    let wt = list.iter().find(|w| same_path(&w.path, path)).ok_or("That worktree no longer exists.")?;
    if wt.main {
        return Err("The main worktree can't be removed.".into());
    }
    if wt.current {
        return Err("This worktree is the selected repo. Switch to another one first.".into());
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.extend(["--", &wt.path]);
    git(repo, &args).map(drop)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;

    #[test]
    fn parses_porcelain() {
        let out = "worktree C:/src/app\nHEAD 1234567890abcdef\nbranch refs/heads/main\n\nworktree C:/src/app-feat\nHEAD abcdef1234567890\ndetached\nlocked\n\nworktree C:/gone\nHEAD 00000000\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n\n";
        let w = parse_worktrees(out, Path::new("C:\\src\\app-feat"));
        assert_eq!(w.len(), 3);
        assert_eq!((w[0].path.as_str(), w[0].branch.as_deref(), w[0].main, w[0].current), ("C:\\src\\app", Some("main"), true, false));
        assert_eq!((w[1].branch.as_deref(), w[1].head.as_str(), w[1].locked, w[1].current), (None, "abcdef1", true, true));
        assert!(w[2].prunable && !w[2].main);
    }

    #[test]
    fn add_open_and_remove() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        let sibling = repo.parent().unwrap().join(format!("{}-feat", repo.file_name().unwrap().to_string_lossy()));
        let rel = format!("../{}", sibling.file_name().unwrap().to_string_lossy());
        assert!(add_worktree(&repo, &rel, "bad name", true).is_err());

        let opened = add_worktree(&repo, &rel, "feat", true).unwrap();
        assert!(same_path(&opened.path, &sibling.to_string_lossy()));
        let list = list_worktrees(&repo).unwrap();
        assert_eq!(list.iter().map(|w| (w.branch.as_deref(), w.main, w.current)).collect::<Vec<_>>(), [(Some("main"), true, true), (Some("feat"), false, false)]);

        // Seen from inside the new worktree, it's the current one.
        let inside = list_worktrees(Path::new(&opened.path)).unwrap();
        assert!(inside[1].current && !inside[0].current);
        assert!(remove_worktree(Path::new(&opened.path), &opened.path, false).is_err(), "can't remove the selected one");
        assert!(remove_worktree(&repo, &list[0].path, false).is_err(), "can't remove main");

        // A dirty worktree needs force.
        write(Path::new(&opened.path), "a.ts", "dirty\n");
        let err = remove_worktree(&repo, &opened.path, false).unwrap_err();
        assert!(err.contains("--force"), "{err}");
        remove_worktree(&repo, &opened.path, true).unwrap();
        assert_eq!(list_worktrees(&repo).unwrap().len(), 1);
        assert!(!sibling.exists());
    }

    #[test]
    fn add_for_an_existing_branch() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        sh(&repo, &["branch", "side"]);
        let dir = temp_dir().join("wt");
        assert!(add_worktree(&repo, &dir.to_string_lossy(), "nope", false).is_err());
        let opened = add_worktree(&repo, &dir.to_string_lossy(), "side", false).unwrap();
        assert_eq!(sh(Path::new(&opened.path), &["branch", "--show-current"]).trim(), "side");
    }
}
