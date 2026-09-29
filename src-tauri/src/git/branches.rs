//! Branches: list (local + remote), create, switch, rename, delete, merge, rebase onto.

use std::path::Path;

use serde::Serialize;

use super::status::{in_progress_operation, Operation};
use super::sync::rebase_keeping_changes;
use super::{git, run, Outcome, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// Short name: "main", or "origin/main" for a remote branch.
    pub name: String,
    /// The remote a remote-tracking branch belongs to; None for local branches.
    pub remote: Option<String>,
    pub current: bool,
    /// Abbreviated commit hash.
    pub commit: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// The upstream was deleted on the remote.
    pub gone: bool,
    pub date_ms: u64,
    pub subject: String,
}

const FORMAT: &str = "%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)%00%(committerdate:unix)%00%(contents:subject)";

/// Local branches first, then remote-tracking ones; each newest first.
pub fn list_branches(repo: &Path) -> Result<Vec<Branch>> {
    let fmt = format!("--format={FORMAT}");
    let out = git(repo, &["for-each-ref", "--sort=-committerdate", &fmt, "refs/heads", "refs/remotes"])?;
    let mut branches: Vec<Branch> = out.lines().filter_map(parse_branch).collect();
    branches.sort_by_key(|b| b.remote.is_some());
    Ok(branches)
}

fn parse_branch(line: &str) -> Option<Branch> {
    let f: Vec<&str> = line.split('\0').collect();
    if f.len() < 8 {
        return None;
    }
    let full = f[0];
    // `refs/remotes/origin/HEAD` is a pointer to the default branch, not a branch.
    if full.starts_with("refs/remotes/") && full.ends_with("/HEAD") {
        return None;
    }
    let remote = full.strip_prefix("refs/remotes/").and_then(|r| r.split_once('/')).map(|(remote, _)| remote.to_owned());
    let (mut ahead, mut behind) = (0, 0);
    for part in f[4].split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    Some(Branch {
        name: f[1].to_owned(),
        remote,
        current: f[5] == "*",
        commit: f[2].to_owned(),
        upstream: (!f[3].is_empty()).then(|| f[3].to_owned()),
        ahead,
        behind,
        gone: f[4] == "gone",
        date_ms: f[6].parse::<u64>().unwrap_or(0) * 1000,
        subject: f[7..].join("\0"),
    })
}

/// Rejects names git wouldn't accept (spaces, `..`, a leading `-`, …) before running anything.
pub fn check_branch_name(repo: &Path, name: &str) -> Result<()> {
    if name.trim().is_empty() || name.starts_with('-') || !run(repo, &["check-ref-format", "--branch", name])?.ok() {
        return Err(format!("\"{name}\" isn't a valid branch name."));
    }
    Ok(())
}

/// New branch at `start` (default HEAD); switches to it when `switch_to` is set.
/// Starting from a remote branch sets it as the upstream (git's default).
pub fn create_branch(repo: &Path, name: &str, start: Option<&str>, switch_to: bool) -> Result<()> {
    check_branch_name(repo, name)?;
    let mut args = if switch_to { vec!["switch", "-c", name] } else { vec!["branch", name] };
    if let Some(s) = start {
        args.push(s);
    }
    git(repo, &args).map(drop)
}

/// Uncommitted changes come along when they don't conflict; otherwise git refuses and says why.
pub fn switch_branch(repo: &Path, name: &str) -> Result<()> {
    git(repo, &["switch", name]).map(drop)
}

/// Check out a remote branch: switch to its local counterpart, creating a tracking branch if needed.
pub fn checkout_remote(repo: &Path, remote_branch: &str) -> Result<String> {
    let (_, local) = remote_branch.split_once('/').ok_or("Not a remote branch.")?;
    let exists = run(repo, &["rev-parse", "-q", "--verify", &format!("refs/heads/{local}")])?.ok();
    if exists {
        git(repo, &["switch", local])?;
    } else {
        git(repo, &["switch", "--track", remote_branch])?;
    }
    Ok(local.to_owned())
}

pub fn rename_branch(repo: &Path, old: &str, new: &str) -> Result<()> {
    check_branch_name(repo, new)?;
    git(repo, &["branch", "-m", old, new]).map(drop)
}

/// `-d` refuses unmerged work; the UI only offers `force` after a second confirmation.
pub fn delete_branch(repo: &Path, name: &str, force: bool) -> Result<()> {
    git(repo, &["branch", if force { "-D" } else { "-d" }, name]).map(drop)
}

/// Deletes `branch` on `remote` (e.g. "origin", "feat/x").
pub fn delete_remote_branch(repo: &Path, remote: &str, branch: &str) -> Result<()> {
    git(repo, &["push", remote, "--delete", branch]).map(drop)
}

/// Merge `name` into the current branch. On conflicts the merge stays in progress so the
/// user can resolve (or abort) it; that is reported as not ok.
pub fn merge_branch(repo: &Path, name: &str) -> Result<Outcome> {
    let out = run(repo, &["merge", "--no-edit", name])?;
    if out.ok() {
        let up_to_date = out.stdout.contains("Already up to date");
        return Ok(Outcome::ok(if up_to_date { format!("Already up to date with {name}.") } else { format!("Merged {name}.") }, None));
    }
    if in_progress_operation(repo)? == Some(Operation::Merge) {
        return Ok(Outcome::fail(format!(
            "Merging {name} stopped on conflicts. Resolve them in your editor and stage the files, or abort the merge."
        )));
    }
    Ok(Outcome::fail(out.message()))
}

/// Rebase the current branch onto `onto`, keeping other local changes; conflicts undo it.
pub fn rebase_onto(repo: &Path, onto: &str) -> Result<Outcome> {
    let conflict = format!("Rebasing onto {onto} conflicts with your commits. The rebase was undone.");
    Ok(match rebase_keeping_changes(repo, onto, "claudegit: other changes during rebase", &conflict)? {
        Ok(warning) => Outcome::ok(format!("Rebased onto {onto}."), warning),
        Err(m) => Outcome::fail(m),
    })
}

/// Abort whatever merge / rebase / cherry-pick / revert is in progress.
pub fn abort_operation(repo: &Path) -> Result<()> {
    let op = in_progress_operation(repo)?.ok_or("Nothing to abort.")?;
    let cmd = match op {
        Operation::Merge => "merge",
        Operation::Rebase => "rebase",
        Operation::CherryPick => "cherry-pick",
        Operation::Revert => "revert",
    };
    git(repo, &[cmd, "--abort"]).map(drop)
}

#[cfg(test)]
mod tests {
    use super::super::status::get_status;
    use super::super::testutil::*;
    use super::*;

    fn names(b: &[Branch]) -> Vec<&str> {
        b.iter().map(|b| b.name.as_str()).collect()
    }

    #[test]
    fn parses_tracking_info_and_skips_remote_head() {
        let b = parse_branch("refs/heads/main\0main\0abc1234\0origin/main\0ahead 2, behind 1\0*\01700000000\0fix: a\0b").unwrap();
        assert_eq!((b.current, b.ahead, b.behind, b.gone, b.remote.as_deref()), (true, 2, 1, false, None));
        assert_eq!(b.subject, "fix: a\0b");
        assert_eq!(b.date_ms, 1_700_000_000_000);
        let gone = parse_branch("refs/heads/x\0x\0abc\0origin/x\0gone\0 \00\0s").unwrap();
        assert!(gone.gone);
        let remote = parse_branch("refs/remotes/origin/feat/y\0origin/feat/y\0abc\0\0\0 \00\0s").unwrap();
        assert_eq!(remote.remote.as_deref(), Some("origin"));
        assert!(parse_branch("refs/remotes/origin/HEAD\0origin\0abc\0\0\0 \00\0s").is_none());
    }

    #[test]
    fn lists_local_then_remote_with_tracking() {
        let r = with_remote(&[("a.ts", "a\n")]);
        sh(&r.me, &["branch", "side"]);
        write(&r.me, "a.ts", "a2\n");
        sh(&r.me, &["commit", "-qam", "local"]);
        let all = list_branches(&r.me).unwrap();
        let main = all.iter().find(|b| b.name == "main").unwrap();
        assert!(main.current);
        assert_eq!((main.upstream.as_deref(), main.ahead), (Some("origin/main"), 1));
        assert_eq!(names(&all), ["main", "side", "origin/main"]);
    }

    #[test]
    fn create_switch_rename_delete() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        assert!(create_branch(&repo, "bad name", None, false).is_err());
        assert!(create_branch(&repo, "-x", None, false).is_err());
        create_branch(&repo, "feat/one", None, true).unwrap();
        assert_eq!(get_status(&repo).unwrap().parsed.branch.head.as_deref(), Some("feat/one"));
        write(&repo, "a.ts", "wip\n"); // uncommitted edits travel with the switch
        switch_branch(&repo, "main").unwrap();
        assert_eq!(read(&repo, "a.ts"), "wip\n");
        rename_branch(&repo, "feat/one", "feat/two").unwrap();
        delete_branch(&repo, "feat/two", false).unwrap();
        assert_eq!(names(&list_branches(&repo).unwrap()), ["main"]);
    }

    #[test]
    fn delete_refuses_unmerged_work_unless_forced() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        create_branch(&repo, "wip", None, true).unwrap();
        write(&repo, "a.ts", "only here\n");
        sh(&repo, &["commit", "-qam", "unmerged"]);
        switch_branch(&repo, "main").unwrap();
        assert!(delete_branch(&repo, "wip", false).unwrap_err().contains("not fully merged"));
        delete_branch(&repo, "wip", true).unwrap();
    }

    #[test]
    fn checks_out_a_remote_branch_as_a_tracking_branch_and_deletes_it_remotely() {
        let r = with_remote(&[("a.ts", "a\n")]);
        sh(&r.teammate, &["switch", "-q", "-c", "feat/x"]);
        sh(&r.teammate, &["push", "-q", "-u", "origin", "feat/x"]);
        sh(&r.me, &["fetch", "-q"]);
        assert_eq!(checkout_remote(&r.me, "origin/feat/x").unwrap(), "feat/x");
        assert_eq!(get_status(&r.me).unwrap().parsed.branch.upstream.as_deref(), Some("origin/feat/x"));
        switch_branch(&r.me, "main").unwrap();
        assert_eq!(checkout_remote(&r.me, "origin/feat/x").unwrap(), "feat/x"); // existing local: just switch
        switch_branch(&r.me, "main").unwrap();
        delete_remote_branch(&r.me, "origin", "feat/x").unwrap();
        assert!(!sh(&r.remote, &["branch"]).contains("feat/x"));
    }

    #[test]
    fn merge_clean_and_conflicting_then_abort() {
        let repo = make_repo(&[("a.ts", "a\n"), ("b.ts", "b\n")]);
        create_branch(&repo, "clean", None, true).unwrap();
        write(&repo, "b.ts", "b2\n");
        sh(&repo, &["commit", "-qam", "b change"]);
        switch_branch(&repo, "main").unwrap();
        assert_eq!(merge_branch(&repo, "clean").unwrap(), Outcome::ok("Merged clean.", None));
        assert!(merge_branch(&repo, "clean").unwrap().message.contains("Already up to date"));

        create_branch(&repo, "clash", None, true).unwrap();
        write(&repo, "a.ts", "theirs\n");
        sh(&repo, &["commit", "-qam", "theirs"]);
        switch_branch(&repo, "main").unwrap();
        write(&repo, "a.ts", "ours\n");
        sh(&repo, &["commit", "-qam", "ours"]);
        let r = merge_branch(&repo, "clash").unwrap();
        assert!(!r.ok && r.message.contains("stopped on conflicts"));
        assert_eq!(get_status(&repo).unwrap().operation, Some(Operation::Merge));
        abort_operation(&repo).unwrap();
        assert_eq!(get_status(&repo).unwrap().operation, None);
        assert_eq!(read(&repo, "a.ts"), "ours\n");
        assert!(abort_operation(&repo).is_err());
    }

    #[test]
    fn rebase_onto_keeps_local_changes_and_undoes_conflicts() {
        let repo = make_repo(&[("a.ts", "a\n"), ("b.ts", "b\n"), ("w.ts", "w\n")]);
        create_branch(&repo, "feat", None, true).unwrap();
        write(&repo, "b.ts", "feat\n");
        sh(&repo, &["commit", "-qam", "feat"]);
        switch_branch(&repo, "main").unwrap();
        write(&repo, "a.ts", "main\n");
        sh(&repo, &["commit", "-qam", "main moved"]);
        switch_branch(&repo, "feat").unwrap();
        write(&repo, "w.ts", "wip\n");

        let r = rebase_onto(&repo, "main").unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!(log(&repo, "HEAD"), ["feat", "main moved", "init"]);
        assert_eq!(read(&repo, "w.ts"), "wip\n");

        switch_branch(&repo, "main").unwrap();
        write(&repo, "b.ts", "main's b\n");
        sh(&repo, &["commit", "-q", "-m", "clash", "--", "b.ts"]); // w.ts's wip travels along uncommitted
        switch_branch(&repo, "feat").unwrap();
        let r = rebase_onto(&repo, "main").unwrap();
        assert!(!r.ok && r.message.contains("was undone"));
        assert_eq!(get_status(&repo).unwrap().operation, None);
        assert_eq!(read(&repo, "w.ts"), "wip\n");
    }
}
