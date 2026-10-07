//! The git surface the webview can call. Each command does one named thing; there is no
//! way to pass arbitrary git arguments from the UI. Work runs off the main thread.

use std::path::PathBuf;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::claude;
use crate::codex;
use crate::gemini;
use crate::git::commit::{self, CommitOptions, CommitResult, Step, StepState};
use crate::git::diff::{self, FileDiff, Hunk, Side};
use crate::git::history::{self, Blame, CommitDetail, History, ResetMode, TimelineEntry};
use crate::git::repo::{self, AgentRepos, Resolved};
use crate::git::status::{self, FileChange, RepoStatus};
use crate::git::branches::{self, Branch};
use crate::git::stash::{self, StashEntry, StashMode};
use crate::git::sync::{self, SyncKind, SyncResult};
use crate::git::tags::{self, Remote, Tag};
use crate::git::patch::{self, HunkAction};
use crate::git::repo::RepoRef;
use crate::git::secrets::{self, SecretFinding};
use crate::git::worktrees::{self, Worktree};
use crate::git::{ops, Outcome, Result};

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn resolve_repo(folder: String) -> Result<Resolved> {
    blocking(move || Ok(repo::resolve_repo(&folder))).await
}

/// Recent local agent sessions, grouped by the repo they're in (newest first).
#[tauri::command]
pub async fn agent_repos(app: AppHandle) -> Result<AgentRepos> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    blocking(move || {
        let now = std::time::SystemTime::now();
        let mut sessions = claude::scan(&claude::projects_dir(&home), now, claude::MAX_AGE);
        let codex_home = codex::codex_home(&home);
        sessions.extend(codex::scan(&codex_home.join("sessions"), now, codex::MAX_AGE));
        sessions.extend(gemini::scan(&home.join(".gemini"), now, gemini::MAX_AGE));
        sessions.sort_by_key(|s| std::cmp::Reverse(s.last_active_ms));
        Ok(repo::group_sessions(sessions, repo::resolve_cached))
    })
    .await
}

#[tauri::command]
pub async fn git_status(repo: PathBuf) -> Result<RepoStatus> {
    blocking(move || status::get_status(&repo)).await
}

#[tauri::command]
pub async fn stage(repo: PathBuf, files: Vec<FileChange>) -> Result<()> {
    blocking(move || ops::stage(&repo, &files)).await
}

#[tauri::command]
pub async fn stage_all(repo: PathBuf) -> Result<()> {
    blocking(move || ops::stage_all(&repo)).await
}

#[tauri::command]
pub async fn unstage(repo: PathBuf, files: Vec<FileChange>) -> Result<()> {
    blocking(move || ops::unstage(&repo, &files)).await
}

#[tauri::command]
pub async fn unstage_all(repo: PathBuf) -> Result<()> {
    blocking(move || ops::unstage_all(&repo)).await
}

#[tauri::command]
pub async fn discard(repo: PathBuf, files: Vec<FileChange>) -> Result<()> {
    blocking(move || ops::discard(&repo, &files)).await
}

#[tauri::command]
pub async fn file_diff(repo: PathBuf, file: FileChange, side: Side) -> Result<FileDiff> {
    blocking(move || diff::get_diff(&repo, &file, side)).await
}

#[tauri::command]
pub async fn is_head_published(repo: PathBuf) -> Result<bool> {
    blocking(move || sync::is_head_published(&repo)).await
}

#[derive(Clone, Serialize)]
pub struct StepEvent {
    step: Step,
    state: StepState,
}

/// Commit (and optionally pull + push), streaming each step's state to `on_step`.
#[tauri::command]
pub async fn commit_push(repo: PathBuf, opts: CommitOptions, on_step: Channel<StepEvent>) -> Result<CommitResult> {
    blocking(move || {
        Ok(commit::commit_push(&repo, &opts, &mut |step, state| {
            let _ = on_step.send(StepEvent { step, state });
        }))
    })
    .await
}

#[tauri::command]
pub async fn sync(repo: PathBuf, kind: SyncKind) -> Result<SyncResult> {
    blocking(move || Ok(sync::run_sync(&repo, kind))).await
}

// ---- Branches ----

#[tauri::command]
pub async fn list_branches(repo: PathBuf) -> Result<Vec<Branch>> {
    blocking(move || branches::list_branches(&repo)).await
}

#[tauri::command]
pub async fn create_branch(repo: PathBuf, name: String, start: Option<String>, switch_to: bool) -> Result<()> {
    blocking(move || branches::create_branch(&repo, &name, start.as_deref(), switch_to)).await
}

#[tauri::command]
pub async fn switch_branch(repo: PathBuf, name: String) -> Result<()> {
    blocking(move || branches::switch_branch(&repo, &name)).await
}

#[tauri::command]
pub async fn checkout_remote_branch(repo: PathBuf, name: String) -> Result<String> {
    blocking(move || branches::checkout_remote(&repo, &name)).await
}

#[tauri::command]
pub async fn rename_branch(repo: PathBuf, old: String, new: String) -> Result<()> {
    blocking(move || branches::rename_branch(&repo, &old, &new)).await
}

#[tauri::command]
pub async fn delete_branch(repo: PathBuf, name: String, force: bool) -> Result<()> {
    blocking(move || branches::delete_branch(&repo, &name, force)).await
}

#[tauri::command]
pub async fn delete_remote_branch(repo: PathBuf, remote: String, branch: String) -> Result<()> {
    blocking(move || branches::delete_remote_branch(&repo, &remote, &branch)).await
}

#[tauri::command]
pub async fn merge_branch(repo: PathBuf, name: String) -> Result<Outcome> {
    blocking(move || branches::merge_branch(&repo, &name)).await
}

#[tauri::command]
pub async fn rebase_onto(repo: PathBuf, onto: String) -> Result<Outcome> {
    blocking(move || branches::rebase_onto(&repo, &onto)).await
}

#[tauri::command]
pub async fn abort_operation(repo: PathBuf) -> Result<()> {
    blocking(move || branches::abort_operation(&repo)).await
}

// ---- Stashes ----

#[tauri::command]
pub async fn list_stashes(repo: PathBuf) -> Result<Vec<StashEntry>> {
    blocking(move || stash::list_stashes(&repo)).await
}

#[tauri::command]
pub async fn stash_push(repo: PathBuf, message: String, mode: StashMode) -> Result<()> {
    blocking(move || stash::stash_push(&repo, &message, mode)).await
}

#[tauri::command]
pub async fn stash_apply(repo: PathBuf, index: u32, hash: String, pop: bool) -> Result<Outcome> {
    blocking(move || stash::stash_apply(&repo, index, &hash, pop)).await
}

#[tauri::command]
pub async fn stash_drop(repo: PathBuf, index: u32, hash: String) -> Result<()> {
    blocking(move || stash::stash_drop(&repo, index, &hash)).await
}

#[tauri::command]
pub async fn stash_clear(repo: PathBuf) -> Result<()> {
    blocking(move || stash::stash_clear(&repo)).await
}

#[tauri::command]
pub async fn stash_files(repo: PathBuf, hash: String) -> Result<Vec<FileChange>> {
    blocking(move || stash::stash_files(&repo, &hash)).await
}

#[tauri::command]
pub async fn stash_file_diff(repo: PathBuf, hash: String, file: FileChange) -> Result<FileDiff> {
    blocking(move || stash::stash_file_diff(&repo, &hash, &file)).await
}

// ---- Tags and remotes ----

#[tauri::command]
pub async fn list_tags(repo: PathBuf) -> Result<Vec<Tag>> {
    blocking(move || tags::list_tags(&repo)).await
}

#[tauri::command]
pub async fn create_tag(repo: PathBuf, name: String, message: String, target: Option<String>) -> Result<()> {
    blocking(move || tags::create_tag(&repo, &name, &message, target.as_deref())).await
}

#[tauri::command]
pub async fn delete_tag(repo: PathBuf, name: String) -> Result<()> {
    blocking(move || tags::delete_tag(&repo, &name)).await
}

#[tauri::command]
pub async fn push_tag(repo: PathBuf, remote: String, name: String) -> Result<()> {
    blocking(move || tags::push_tag(&repo, &remote, &name)).await
}

#[tauri::command]
pub async fn delete_remote_tag(repo: PathBuf, remote: String, name: String) -> Result<()> {
    blocking(move || tags::delete_remote_tag(&repo, &remote, &name)).await
}

#[tauri::command]
pub async fn list_remotes(repo: PathBuf) -> Result<Vec<Remote>> {
    blocking(move || tags::list_remotes(&repo)).await
}

#[tauri::command]
pub async fn add_remote(repo: PathBuf, name: String, url: String) -> Result<()> {
    blocking(move || tags::add_remote(&repo, &name, &url)).await
}

#[tauri::command]
pub async fn remove_remote(repo: PathBuf, name: String) -> Result<()> {
    blocking(move || tags::remove_remote(&repo, &name)).await
}

#[tauri::command]
pub async fn fetch_remote(repo: PathBuf, name: String) -> Result<()> {
    blocking(move || tags::fetch_remote(&repo, &name)).await
}

// ---- History ----

/// The newest `limit` commits (HEAD and its upstream, or everything when `all`), with the graph.
#[tauri::command]
pub async fn history(repo: PathBuf, limit: usize, all: bool) -> Result<History> {
    blocking(move || history::history(&repo, limit.clamp(1, 20_000), all)).await
}

#[tauri::command]
pub async fn commit_detail(repo: PathBuf, hash: String) -> Result<CommitDetail> {
    blocking(move || history::commit_detail(&repo, &hash)).await
}

/// Files that differ between two commits, or a commit and the working tree (`target` = None).
#[tauri::command]
pub async fn compare_files(repo: PathBuf, base: String, target: Option<String>) -> Result<Vec<FileChange>> {
    blocking(move || history::compare_files(&repo, &base, target.as_deref())).await
}

#[tauri::command]
pub async fn compare_file_diff(repo: PathBuf, base: String, target: Option<String>, file: FileChange) -> Result<FileDiff> {
    blocking(move || history::compare_file_diff(&repo, &base, target.as_deref(), &file)).await
}

#[tauri::command]
pub async fn revert_commit(repo: PathBuf, hash: String) -> Result<Outcome> {
    blocking(move || history::revert_commit(&repo, &hash)).await
}

#[tauri::command]
pub async fn cherry_pick(repo: PathBuf, hash: String) -> Result<Outcome> {
    blocking(move || history::cherry_pick(&repo, &hash)).await
}

/// How many commits a reset to `hash` takes off the current branch (for the confirmation).
#[tauri::command]
pub async fn reset_impact(repo: PathBuf, hash: String) -> Result<u32> {
    blocking(move || history::reset_impact(&repo, &hash)).await
}

#[tauri::command]
pub async fn reset_to(repo: PathBuf, hash: String, mode: ResetMode) -> Result<Outcome> {
    blocking(move || history::reset_to(&repo, &hash, mode)).await
}

#[tauri::command]
pub async fn file_timeline(repo: PathBuf, path: String) -> Result<Vec<TimelineEntry>> {
    blocking(move || history::file_timeline(&repo, &path, history::PAGE)).await
}

#[tauri::command]
pub async fn blame_file(repo: PathBuf, path: String) -> Result<Blame> {
    blocking(move || history::blame_file(&repo, &path)).await
}

// ---- The Claude Code loop ----

/// Stage / unstage / discard one hunk, or `lines` (indices into `hunk.lines`) of it.
#[tauri::command]
pub async fn apply_hunk(repo: PathBuf, file: FileChange, hunk: Hunk, lines: Option<Vec<usize>>, action: HunkAction) -> Result<()> {
    blocking(move || patch::apply_hunk(&repo, &file, &hunk, lines.as_deref(), action)).await
}

/// Likely secrets in the next commit (the staged changes, or everything with `stage_all`).
#[tauri::command]
pub async fn check_secrets(repo: PathBuf, stage_all: bool) -> Result<Vec<SecretFinding>> {
    blocking(move || secrets::check_secrets(&repo, stage_all)).await
}

/// Undo the last commit, keeping its changes staged; returns its message.
#[tauri::command]
pub async fn undo_last_commit(repo: PathBuf) -> Result<String> {
    blocking(move || commit::undo_last_commit(&repo)).await
}

#[tauri::command]
pub async fn add_to_gitignore(repo: PathBuf, path: String) -> Result<()> {
    blocking(move || ops::add_to_gitignore(&repo, &path)).await
}

/// What you asked Claude Code in this repo since the last commit, newest first.
#[tauri::command]
pub async fn claude_prompts(app: AppHandle, repo: PathBuf) -> Result<Vec<claude::ClaudePrompt>> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    blocking(move || {
        let last = crate::git::run(&repo, &["log", "-1", "--format=%ct", "HEAD", "--"])?;
        let since_ms = if last.ok() { last.stdout.trim().parse::<u64>().unwrap_or(0) * 1000 } else { 0 };
        let since = std::time::UNIX_EPOCH + std::time::Duration::from_millis(since_ms);
        let here = repo.to_string_lossy();
        let logs: Vec<PathBuf> = claude::recent_logs(&claude::projects_dir(&home), std::time::SystemTime::now(), claude::MAX_AGE)
            .into_iter()
            .filter(|(_, modified)| *modified >= since)
            .filter_map(|(log, _)| {
                let root = repo::resolve_cached(&claude::last_cwd(&log).ok()??)?;
                repo::same_path(&root.path, &here).then_some(log)
            })
            .collect();
        Ok(claude::prompts_since(&logs, since_ms, 8))
    })
    .await
}

#[tauri::command]
pub async fn list_worktrees(repo: PathBuf) -> Result<Vec<Worktree>> {
    blocking(move || worktrees::list_worktrees(&repo)).await
}

/// Returns the new checkout, ready to open as the selected repo.
#[tauri::command]
pub async fn add_worktree(repo: PathBuf, path: String, branch: String, new_branch: bool) -> Result<RepoRef> {
    blocking(move || worktrees::add_worktree(&repo, &path, &branch, new_branch)).await
}

#[tauri::command]
pub async fn remove_worktree(repo: PathBuf, path: String, force: bool) -> Result<()> {
    blocking(move || worktrees::remove_worktree(&repo, &path, force)).await
}
