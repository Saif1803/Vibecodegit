//! Fetch, pull (stash + rebase), push and sync, shared by the header actions and Commit & Push.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::status::{in_progress_operation, Operation};
use super::{git, run, Result};

pub const STASH_MESSAGE: &str = "claudegit: other changes during pull";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullOutcome {
    Ok { pulled: u32, warning: Option<String> },
    Failed(String),
}

/// The upstream ("origin/main"), or None when the branch doesn't track one.
pub fn upstream_of(repo: &Path) -> Result<Option<String>> {
    let out = run(repo, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?;
    Ok(out.ok().then(|| out.stdout.trim().to_owned()))
}

/// True when HEAD is already on the upstream, so rewriting it (amend) needs a force push.
pub fn is_head_published(repo: &Path) -> Result<bool> {
    if upstream_of(repo)?.is_none() {
        return Ok(false);
    }
    Ok(run(repo, &["merge-base", "--is-ancestor", "HEAD", "@{u}"])?.ok())
}

/// Tracked changes block a rebase; untracked files only matter if upstream adds the same path.
fn is_dirty(repo: &Path) -> Result<bool> {
    Ok(!git(repo, &["status", "--porcelain", "--untracked-files=no"])?.trim().is_empty())
}

/// fetch; if behind, stash other changes, rebase onto upstream, restore the stash.
///
/// `git pull --rebase --autostash` restores without `--index` and silently unstages files.
/// A conflicting rebase is aborted so the repo is never left mid-rebase.
pub fn pull_rebase(repo: &Path) -> Result<PullOutcome> {
    let fetch = run(repo, &["fetch", "--quiet"])?;
    if !fetch.ok() {
        return Ok(PullOutcome::Failed(fetch.message()));
    }
    let behind: u32 = git(repo, &["rev-list", "--count", "HEAD..@{u}"])?.trim().parse().unwrap_or(0);
    if behind == 0 {
        return Ok(PullOutcome::Ok { pulled: 0, warning: None });
    }

    let dirty = is_dirty(repo)?;
    if dirty {
        git(repo, &["stash", "push", "--quiet", "-m", STASH_MESSAGE])?;
    }

    let rebase = run(repo, &["rebase", "--no-autostash", "@{u}"])?;
    let mut outcome = PullOutcome::Ok { pulled: behind, warning: None };
    if !rebase.ok() {
        let conflicted = in_progress_operation(repo)? == Some(Operation::Rebase);
        if conflicted {
            run(repo, &["rebase", "--abort"])?;
        }
        outcome = PullOutcome::Failed(if conflicted {
            "Pulled changes conflict with your commits. The rebase was undone; pull and resolve in your editor.".into()
        } else {
            rebase.message()
        });
    }

    if dirty {
        if let Some(note) = restore_stash(repo)? {
            outcome = match outcome {
                PullOutcome::Ok { pulled, .. } => PullOutcome::Ok { pulled, warning: Some(note) },
                PullOutcome::Failed(m) => PullOutcome::Failed(format!("{m}\n{note}")),
            };
        }
    }
    Ok(outcome)
}

/// Pops our stash keeping staged state; returns a note if that wasn't fully possible.
/// Never discards anything: on a real conflict the stash is left in place (git keeps it).
fn restore_stash(repo: &Path) -> Result<Option<String>> {
    if run(repo, &["stash", "pop", "--index", "--quiet"])?.ok() {
        return Ok(None);
    }
    let conflict_note = format!(
        "Your other changes conflict with what was pulled. Resolve the conflicts in your editor; a copy is kept in `git stash` (\"{STASH_MESSAGE}\")."
    );
    // `--index` refuses up front when the staged state can't be rebuilt; the tree is untouched then.
    if is_dirty(repo)? {
        return Ok(Some(conflict_note));
    }
    if run(repo, &["stash", "pop", "--quiet"])?.ok() {
        return Ok(Some("Your other changes were restored, but some are no longer staged.".into()));
    }
    Ok(Some(conflict_note))
}

/// Push the current branch. With no upstream, publish to origin (`push -u origin HEAD`).
/// Returns where it went, or None when there's no origin to publish to.
pub fn push(repo: &Path, force: bool) -> Result<Option<String>> {
    if let Some(upstream) = upstream_of(repo)? {
        git(repo, if force { &["push", "--force-with-lease"] } else { &["push"] })?;
        return Ok(Some(upstream));
    }
    if !git(repo, &["remote"])?.lines().any(|r| r == "origin") {
        return Ok(None);
    }
    git(repo, &["push", "-u", "origin", "HEAD"])?;
    let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(Some(format!("origin/{}", branch.trim())))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncKind {
    Fetch,
    Pull,
    Push,
    Sync,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

impl SyncResult {
    fn ok(message: impl Into<String>, warning: Option<String>) -> Self {
        SyncResult { ok: true, message: message.into(), warning }
    }
    fn fail(message: impl Into<String>) -> Self {
        SyncResult { ok: false, message: message.into(), warning: None }
    }
}

/// The header menu / status-bar actions: one call, one human-readable outcome.
pub fn run_sync(repo: &Path, kind: SyncKind) -> SyncResult {
    match sync_inner(repo, kind) {
        Ok(r) => r,
        Err(e) => SyncResult::fail(e),
    }
}

fn sync_inner(repo: &Path, kind: SyncKind) -> Result<SyncResult> {
    if kind == SyncKind::Fetch {
        git(repo, &["fetch", "--all", "--prune", "--quiet"])?;
        return Ok(SyncResult::ok("Fetched from all remotes.", None));
    }
    let mut pulled_note = String::new();
    let mut warning = None;
    if matches!(kind, SyncKind::Pull | SyncKind::Sync) {
        if upstream_of(repo)?.is_none() {
            if kind == SyncKind::Pull {
                return Ok(SyncResult::fail("This branch has no upstream to pull from. Publish it first."));
            }
        } else {
            match pull_rebase(repo)? {
                PullOutcome::Failed(m) => return Ok(SyncResult::fail(m)),
                PullOutcome::Ok { pulled, warning: w } => {
                    warning = w;
                    pulled_note = match pulled {
                        0 => "Already up to date.".into(),
                        1 => "Pulled 1 commit.".into(),
                        n => format!("Pulled {n} commits."),
                    };
                }
            }
        }
        if kind == SyncKind::Pull {
            return Ok(SyncResult::ok(pulled_note, warning));
        }
    }
    match push(repo, false)? {
        None => Ok(SyncResult::fail("No origin remote to push to.")),
        Some(to) => {
            let msg = [pulled_note, format!("Pushed to {to}.")].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(" ");
            Ok(SyncResult::ok(msg, warning))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;

    #[test]
    fn sync_pulls_a_teammates_commit_and_pushes_ours() {
        let r = with_remote(&[("a.ts", "a\n"), ("b.ts", "b\n")]);
        write(&r.teammate, "b.ts", "b2\n");
        sh(&r.teammate, &["commit", "-qam", "theirs"]);
        sh(&r.teammate, &["push", "-q"]);
        write(&r.me, "a.ts", "a2\n");
        sh(&r.me, &["commit", "-qam", "mine"]);

        let res = run_sync(&r.me, SyncKind::Sync);
        assert_eq!(res, SyncResult::ok("Pulled 1 commit. Pushed to origin/main.", None));
        assert_eq!(log(&r.remote, "main"), vec!["mine", "theirs", "init"]);
    }

    #[test]
    fn pull_keeps_staged_and_unstaged_local_changes() {
        let r = with_remote(&[("a.ts", "a\n"), ("s.ts", "s\n"), ("t.ts", "t\n")]);
        write(&r.teammate, "t.ts", "t2\n");
        sh(&r.teammate, &["commit", "-qam", "theirs"]);
        sh(&r.teammate, &["push", "-q"]);
        write(&r.me, "s.ts", "staged\n");
        sh(&r.me, &["add", "s.ts"]);
        write(&r.me, "s.ts", "staged then edited\n"); // index and worktree differ
        write(&r.me, "a.ts", "wip\n");

        assert!(run_sync(&r.me, SyncKind::Pull).ok);
        assert_eq!(read(&r.me, "t.ts"), "t2\n");
        let st = super::super::status::get_status(&r.me).unwrap().parsed;
        assert_eq!(st.staged.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["s.ts"]);
        assert_eq!(st.unstaged.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["a.ts", "s.ts"]);
        assert_eq!(sh(&r.me, &["show", ":s.ts"]), "staged\n");
        assert_eq!(read(&r.me, "s.ts"), "staged then edited\n");
    }

    #[test]
    fn pull_without_upstream_says_so_and_fetch_works() {
        let r = with_remote(&[("a.ts", "a\n")]);
        sh(&r.me, &["checkout", "-q", "-b", "feat"]);
        assert!(!run_sync(&r.me, SyncKind::Pull).ok);
        assert!(run_sync(&r.me, SyncKind::Fetch).ok);
        // Sync on an unpublished branch publishes it.
        assert_eq!(run_sync(&r.me, SyncKind::Sync).message, "Pushed to origin/feat.");
    }

    #[test]
    fn detects_a_published_head() {
        let r = with_remote(&[("a.ts", "a\n")]);
        assert!(is_head_published(&r.me).unwrap());
        write(&r.me, "a.ts", "a2\n");
        sh(&r.me, &["commit", "-qam", "local"]);
        assert!(!is_head_published(&r.me).unwrap());
    }
}
