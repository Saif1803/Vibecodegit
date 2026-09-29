//! stage → commit → pull (rebase) → push. Commits exactly what is staged.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::sync::{pull_rebase, push, upstream_of, PullOutcome};
use super::{git, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Stage,
    Commit,
    Pull,
    Push,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepState {
    Running,
    Done,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommitOptions {
    pub message: String,
    /// Rewrite the last commit instead of adding one. An empty message keeps the old one.
    pub amend: bool,
    /// Nothing is staged: stage every change first (VS Code's "smart commit").
    pub stage_all: bool,
    /// Pull (rebase) and push after committing.
    pub push: bool,
    /// The amended commit was already pushed: skip the pull and `push --force-with-lease`.
    pub force_push: bool,
}

/// `{ ok: true, hash, pushedTo, warning? }` or `{ ok: false, step, message, hash }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub ok: bool,
    /// The commit exists locally (even when a later step failed).
    pub hash: Option<String>,
    /// Where it was pushed ("origin/main"), or None when not pushed.
    pub pushed_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<Step>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub fn commit_args(message: &str, amend: bool) -> Vec<&str> {
    match (amend, message.trim().is_empty()) {
        (false, _) => vec!["commit", "-m", message],
        (true, false) => vec!["commit", "--amend", "-m", message],
        (true, true) => vec!["commit", "--amend", "--no-edit"],
    }
}

/// - Pull is fetch + rebase onto upstream with other local changes stashed around it and
///   restored with `--index` (see sync.rs). A conflicting rebase is aborted; the commit stays local.
/// - No upstream: push `-u origin HEAD` if there's an origin, else stop after committing.
/// - Amending a pushed commit skips the pull (it would replay onto the old version) and
///   pushes with `--force-with-lease`.
pub fn commit_push(repo: &Path, opts: &CommitOptions, on_step: &mut dyn FnMut(Step, StepState)) -> CommitResult {
    let mut current = Step::Commit;
    let mut hash: Option<String> = None;
    let outcome = run_steps(repo, opts, &mut current, &mut hash, on_step);
    match outcome {
        Ok((pushed_to, warning)) => CommitResult { ok: true, hash, pushed_to, warning, step: None, message: None },
        Err(message) => {
            on_step(current, StepState::Failed);
            let message = match &hash {
                Some(h) if current != Step::Commit => format!("{message}\nYour commit ({h}) is saved locally."),
                _ => message,
            };
            CommitResult { ok: false, hash, pushed_to: None, warning: None, step: Some(current), message: Some(message) }
        }
    }
}

type Pushed = (Option<String>, Option<String>);

fn run_steps(
    repo: &Path,
    opts: &CommitOptions,
    current: &mut Step,
    hash: &mut Option<String>,
    on_step: &mut dyn FnMut(Step, StepState),
) -> Result<Pushed> {
    if !opts.amend && opts.message.trim().is_empty() {
        return Err("Commit message is empty.".into());
    }
    fn begin(s: Step, current: &mut Step, on_step: &mut dyn FnMut(Step, StepState)) {
        *current = s;
        on_step(s, StepState::Running);
    }

    if opts.stage_all {
        begin(Step::Stage, current, on_step);
        git(repo, &["add", "-A"])?;
        on_step(Step::Stage, StepState::Done);
    }

    begin(Step::Commit, current, on_step);
    git(repo, &commit_args(&opts.message, opts.amend))?;
    *hash = Some(git(repo, &["rev-parse", "--short", "HEAD"])?.trim().to_owned());
    on_step(Step::Commit, StepState::Done);
    if !opts.push {
        return Ok((None, None));
    }

    let mut warning = None;
    if opts.force_push || upstream_of(repo)?.is_none() {
        // Nothing to pull: a fresh branch, or a rewritten commit that must replace the pushed one.
        on_step(Step::Pull, StepState::Skipped);
    } else {
        begin(Step::Pull, current, on_step);
        match pull_rebase(repo)? {
            PullOutcome::Failed(m) => return Err(m),
            PullOutcome::Ok { warning: w, .. } => warning = w,
        }
        on_step(Step::Pull, StepState::Done);
    }

    begin(Step::Push, current, on_step);
    let to = push(repo, opts.force_push)?;
    on_step(Step::Push, if to.is_some() { StepState::Done } else { StepState::Skipped });
    Ok((to, warning))
}

#[cfg(test)]
mod tests {
    use super::super::ops::stage;
    use super::super::status::{get_status, FileChange};
    use super::super::testutil::*;
    use super::*;

    fn opts(message: &str) -> CommitOptions {
        CommitOptions { message: message.into(), push: true, ..Default::default() }
    }
    fn go(repo: &Path, o: &CommitOptions) -> (CommitResult, Vec<(Step, StepState)>) {
        let mut steps = Vec::new();
        let r = commit_push(repo, o, &mut |s, st| steps.push((s, st)));
        (r, steps)
    }
    fn stage_paths(repo: &Path, paths: &[&str]) {
        let files: Vec<FileChange> = get_status(repo).unwrap().parsed.unstaged.into_iter().filter(|f| paths.contains(&f.path.as_str())).collect();
        stage(repo, &files).unwrap();
    }
    fn paths(v: &[FileChange]) -> Vec<&str> {
        v.iter().map(|f| f.path.as_str()).collect()
    }

    #[test]
    fn builds_commit_and_amend_args() {
        assert_eq!(commit_args("-m looks like a flag", false), ["commit", "-m", "-m looks like a flag"]);
        assert_eq!(commit_args("m", true), ["commit", "--amend", "-m", "m"]);
        assert_eq!(commit_args("  ", true), ["commit", "--amend", "--no-edit"]);
    }

    #[test]
    fn round_trips_exactly_what_is_staged() {
        let r = with_remote(&[("a.ts", "a\n"), ("b.ts", "b\n")]);
        write(&r.me, "a.ts", "a2\n");
        write(&r.me, "b.ts", "b2\n");
        write(&r.me, "new.md", "n\n");
        stage_paths(&r.me, &["a.ts"]);

        let (res, steps) = go(&r.me, &opts("update a; rm -rf / \"quoted\""));
        assert!(res.ok, "{res:?}");
        assert_eq!(res.pushed_to.as_deref(), Some("origin/main"));
        assert_eq!(steps.iter().filter(|(_, s)| *s == StepState::Done).map(|(s, _)| *s).collect::<Vec<_>>(), [Step::Commit, Step::Pull, Step::Push]);
        assert_eq!(log(&r.remote, "main"), ["update a; rm -rf / \"quoted\"", "init"]);
        assert_eq!(sh(&r.remote, &["show", "--name-only", "--format=", "main"]).trim(), "a.ts");
        let st = get_status(&r.me).unwrap().parsed;
        assert_eq!(paths(&st.unstaged), ["b.ts", "new.md"]);
        assert_eq!((st.branch.ahead, st.branch.behind), (0, 0));
    }

    #[test]
    fn smart_commit_stages_everything_and_commits_locally() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        write(&repo, "a.ts", "a2\n");
        write(&repo, "dir with space/new ü.ts", "n\n");
        let (res, steps) = go(&repo, &CommitOptions { message: "all".into(), stage_all: true, ..Default::default() });
        assert!(res.ok && res.pushed_to.is_none());
        assert_eq!(steps.first(), Some(&(Step::Stage, StepState::Running)));
        let st = get_status(&repo).unwrap().parsed;
        assert!(st.staged.is_empty() && st.unstaged.is_empty());
    }

    #[test]
    fn amend_keeps_the_message_when_empty_and_force_pushes_a_published_commit() {
        let r = with_remote(&[("a.ts", "a\n")]);
        write(&r.me, "a.ts", "a2\n");
        stage_paths(&r.me, &["a.ts"]);
        assert!(go(&r.me, &opts("first try")).0.ok);

        write(&r.me, "b.ts", "forgot\n");
        stage_paths(&r.me, &["b.ts"]);
        assert!(super::super::sync::is_head_published(&r.me).unwrap());
        let (res, steps) = go(&r.me, &CommitOptions { message: String::new(), amend: true, push: true, force_push: true, stage_all: false });
        assert!(res.ok, "{res:?}");
        assert!(steps.contains(&(Step::Pull, StepState::Skipped)));
        assert_eq!(log(&r.remote, "main"), ["first try", "init"]);
        assert_eq!(sh(&r.remote, &["show", "--name-only", "--format=", "main"]).trim().lines().count(), 2);
    }

    #[test]
    fn rebases_onto_a_teammate_keeping_unstaged_work() {
        let r = with_remote(&[("mine.ts", "m\n"), ("theirs.ts", "t\n"), ("wip.ts", "w\n")]);
        write(&r.teammate, "theirs.ts", "t2\n");
        sh(&r.teammate, &["commit", "-qam", "teammate change"]);
        sh(&r.teammate, &["push", "-q"]);

        write(&r.me, "mine.ts", "m2\n");
        write(&r.me, "wip.ts", "w-local\n"); // unstaged; would block a plain pull --rebase
        stage_paths(&r.me, &["mine.ts"]);
        let (res, _) = go(&r.me, &opts("my change"));

        assert!(res.ok, "{res:?}");
        assert_eq!(log(&r.remote, "main"), ["my change", "teammate change", "init"]);
        assert_eq!(read(&r.me, "theirs.ts"), "t2\n");
        assert_eq!(read(&r.me, "wip.ts"), "w-local\n");
    }

    #[test]
    fn overlapping_local_edits_are_kept_in_the_stash() {
        let r = with_remote(&[("mine.ts", "m\n"), ("shared.ts", "base\n")]);
        write(&r.teammate, "shared.ts", "theirs\n");
        sh(&r.teammate, &["commit", "-qam", "teammate edit"]);
        sh(&r.teammate, &["push", "-q"]);

        write(&r.me, "mine.ts", "m2\n");
        write(&r.me, "shared.ts", "my unfinished edit\n");
        stage_paths(&r.me, &["mine.ts"]);
        let (res, _) = go(&r.me, &opts("my change"));

        assert!(res.ok && res.warning.as_deref().unwrap_or("").contains("conflict"), "{res:?}");
        assert_eq!(log(&r.remote, "main"), ["my change", "teammate edit", "init"]);
        assert!(sh(&r.me, &["stash", "list"]).contains("claudegit: other changes during pull"));
        assert_eq!(sh(&r.me, &["show", "stash@{0}:shared.ts"]), "my unfinished edit\n");
    }

    #[test]
    fn a_conflicting_pull_is_undone_and_the_commit_stays_local() {
        let r = with_remote(&[("shared.ts", "base\n"), ("wip.ts", "w\n")]);
        write(&r.teammate, "shared.ts", "theirs\n");
        sh(&r.teammate, &["commit", "-qam", "teammate edit"]);
        sh(&r.teammate, &["push", "-q"]);

        write(&r.me, "shared.ts", "mine\n");
        write(&r.me, "wip.ts", "w-local\n");
        stage_paths(&r.me, &["shared.ts"]);
        let (res, steps) = go(&r.me, &opts("my edit"));

        assert!(!res.ok);
        assert_eq!(res.step, Some(Step::Pull));
        assert!(res.message.as_deref().unwrap().contains("is saved locally"));
        assert_eq!(steps.last(), Some(&(Step::Pull, StepState::Failed)));
        let st = get_status(&r.me).unwrap();
        assert_eq!(st.operation, None);
        assert_eq!(log(&r.me, "HEAD")[0], "my edit");
        assert_eq!(read(&r.me, "wip.ts"), "w-local\n");
        assert_eq!(log(&r.remote, "main"), ["teammate edit", "init"]);
    }

    #[test]
    fn publishes_a_new_branch_and_handles_no_remote_and_first_commits() {
        let r = with_remote(&[("a.ts", "a\n")]);
        sh(&r.me, &["checkout", "-q", "-b", "feat/tray"]);
        write(&r.me, "a.ts", "a2\n");
        stage_paths(&r.me, &["a.ts"]);
        assert_eq!(go(&r.me, &opts("on a branch")).0.pushed_to.as_deref(), Some("origin/feat/tray"));
        assert_eq!(get_status(&r.me).unwrap().parsed.branch.upstream.as_deref(), Some("origin/feat/tray"));

        let local = make_repo(&[("a.ts", "a\n")]);
        write(&local, "a.ts", "a2\n");
        let (res, steps) = go(&local, &CommitOptions { stage_all: true, ..opts("local only") });
        assert!(res.ok && res.pushed_to.is_none());
        assert_eq!(steps.last(), Some(&(Step::Push, StepState::Skipped)));

        let remote = temp_dir().join("empty.git");
        sh(&temp_dir(), &["init", "-q", "--bare", "-b", "main", &remote.to_string_lossy()]);
        let me = empty_repo();
        sh(&me, &["remote", "add", "origin", &remote.to_string_lossy()]);
        write(&me, "README.md", "hello\n");
        write(&me, "later.md", "not yet\n");
        stage_paths(&me, &["README.md"]);
        assert_eq!(go(&me, &opts("first")).0.pushed_to.as_deref(), Some("origin/main"));
        assert_eq!(log(&remote, "main"), ["first"]);
    }

    #[test]
    fn reports_hook_failures_and_empty_messages_without_a_hash() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        let (res, _) = go(&repo, &opts("   "));
        assert_eq!((res.ok, res.step, res.hash), (false, Some(Step::Commit), None));

        write(&repo, "a.ts", "a2\n");
        write(&repo, ".git/hooks/pre-commit", "#!/bin/sh\necho hook said no >&2\nexit 1\n");
        let (res, _) = go(&repo, &CommitOptions { stage_all: true, ..opts("msg") });
        assert_eq!((res.ok, res.step, res.hash), (false, Some(Step::Commit), None));
        assert!(res.message.unwrap().contains("hook said no"));
    }
}
