//! The git surface the webview can call. Each command does one named thing; there is no
//! way to pass arbitrary git arguments from the UI. Work runs off the main thread.

use std::path::PathBuf;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::claude;
use crate::git::commit::{self, CommitOptions, CommitResult, Step, StepState};
use crate::git::diff::{self, FileDiff, Side};
use crate::git::repo::{self, ClaudeRepos, Resolved};
use crate::git::status::{self, FileChange, RepoStatus};
use crate::git::sync::{self, SyncKind, SyncResult};
use crate::git::{ops, Result};

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn resolve_repo(folder: String) -> Result<Resolved> {
    blocking(move || Ok(repo::resolve_repo(&folder))).await
}

/// Recent Claude Code sessions, grouped by the repo they're in (newest first).
#[tauri::command]
pub async fn claude_repos(app: AppHandle) -> Result<ClaudeRepos> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    blocking(move || {
        let sessions = claude::scan(&claude::projects_dir(&home), std::time::SystemTime::now(), claude::MAX_AGE);
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
