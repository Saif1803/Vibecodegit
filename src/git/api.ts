import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  Blame,
  Branch,
  ChangeSide,
  ClaudePrompt,
  ClaudeRepos,
  CommitDetail,
  CommitOptions,
  CommitResult,
  FileChange,
  FileDiff,
  History,
  Hunk,
  HunkAction,
  Outcome,
  Remote,
  RepoRef,
  RepoStatus,
  ResetMode,
  SecretFinding,
  Resolved,
  StashEntry,
  StashMode,
  Step,
  StepState,
  SyncKind,
  SyncResult,
  Tag,
  TimelineEntry,
  Worktree,
} from "./types";

// The only way the UI touches git: named Rust commands (src-tauri/src/commands.rs).
// Failing commands reject with git's message as a string.

export const resolveRepo = (folder: string) => invoke<Resolved>("resolve_repo", { folder });
export const claudeRepos = () => invoke<ClaudeRepos>("claude_repos");
export const getStatus = (repo: string) => invoke<RepoStatus>("git_status", { repo });

export const stage = (repo: string, files: FileChange[]) => invoke<void>("stage", { repo, files });
export const stageAll = (repo: string) => invoke<void>("stage_all", { repo });
export const unstage = (repo: string, files: FileChange[]) => invoke<void>("unstage", { repo, files });
export const unstageAll = (repo: string) => invoke<void>("unstage_all", { repo });
/** Irreversible: confirm first. */
export const discard = (repo: string, files: FileChange[]) => invoke<void>("discard", { repo, files });

export const fileDiff = (repo: string, file: FileChange, side: ChangeSide) => invoke<FileDiff>("file_diff", { repo, file, side });

export const isHeadPublished = (repo: string) => invoke<boolean>("is_head_published", { repo });

export function commitPush(repo: string, opts: CommitOptions, onStep: (step: Step, state: StepState) => void) {
  const channel = new Channel<{ step: Step; state: StepState }>();
  channel.onmessage = (e) => onStep(e.step, e.state);
  return invoke<CommitResult>("commit_push", { repo, opts, onStep: channel });
}

export const sync = (repo: string, kind: SyncKind) => invoke<SyncResult>("sync", { repo, kind });

/** A rejected invoke carries git's message as a plain string. */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

// ---- Branches ----
export const listBranches = (repo: string) => invoke<Branch[]>("list_branches", { repo });
export const createBranch = (repo: string, name: string, start: string | null, switchTo: boolean) =>
  invoke<void>("create_branch", { repo, name, start, switchTo });
export const switchBranch = (repo: string, name: string) => invoke<void>("switch_branch", { repo, name });
/** Returns the local branch it switched to. */
export const checkoutRemoteBranch = (repo: string, name: string) => invoke<string>("checkout_remote_branch", { repo, name });
export const renameBranch = (repo: string, old: string, name: string) => invoke<void>("rename_branch", { repo, old, new: name });
export const deleteBranch = (repo: string, name: string, force: boolean) => invoke<void>("delete_branch", { repo, name, force });
export const deleteRemoteBranch = (repo: string, remote: string, branch: string) =>
  invoke<void>("delete_remote_branch", { repo, remote, branch });
export const mergeBranch = (repo: string, name: string) => invoke<Outcome>("merge_branch", { repo, name });
export const rebaseOnto = (repo: string, onto: string) => invoke<Outcome>("rebase_onto", { repo, onto });
/** Abort the merge / rebase / cherry-pick / revert in progress. */
export const abortOperation = (repo: string) => invoke<void>("abort_operation", { repo });

// ---- Stashes ----
export const listStashes = (repo: string) => invoke<StashEntry[]>("list_stashes", { repo });
export const stashPush = (repo: string, message: string, mode: StashMode) => invoke<void>("stash_push", { repo, message, mode });
export const stashApply = (repo: string, s: StashEntry, pop: boolean) =>
  invoke<Outcome>("stash_apply", { repo, index: s.index, hash: s.hash, pop });
export const stashDrop = (repo: string, s: StashEntry) => invoke<void>("stash_drop", { repo, index: s.index, hash: s.hash });
export const stashClear = (repo: string) => invoke<void>("stash_clear", { repo });
export const stashFiles = (repo: string, hash: string) => invoke<FileChange[]>("stash_files", { repo, hash });
export const stashFileDiff = (repo: string, hash: string, file: FileChange) => invoke<FileDiff>("stash_file_diff", { repo, hash, file });

// ---- Tags and remotes ----
export const listTags = (repo: string) => invoke<Tag[]>("list_tags", { repo });
/** Annotated when `message` is non-empty. */
export const createTag = (repo: string, name: string, message: string, target: string | null) =>
  invoke<void>("create_tag", { repo, name, message, target });
export const deleteTag = (repo: string, name: string) => invoke<void>("delete_tag", { repo, name });
export const pushTag = (repo: string, remote: string, name: string) => invoke<void>("push_tag", { repo, remote, name });
export const deleteRemoteTag = (repo: string, remote: string, name: string) => invoke<void>("delete_remote_tag", { repo, remote, name });
export const listRemotes = (repo: string) => invoke<Remote[]>("list_remotes", { repo });
export const addRemote = (repo: string, name: string, url: string) => invoke<void>("add_remote", { repo, name, url });
export const removeRemote = (repo: string, name: string) => invoke<void>("remove_remote", { repo, name });
export const fetchRemote = (repo: string, name: string) => invoke<void>("fetch_remote", { repo, name });

// ---- History ----
export const history = (repo: string, limit: number, all: boolean) => invoke<History>("history", { repo, limit, all });
export const commitDetail = (repo: string, hash: string) => invoke<CommitDetail>("commit_detail", { repo, hash });
/** `target` null = the working tree. */
export const compareFiles = (repo: string, base: string, target: string | null) => invoke<FileChange[]>("compare_files", { repo, base, target });
export const compareFileDiff = (repo: string, base: string, target: string | null, file: FileChange) =>
  invoke<FileDiff>("compare_file_diff", { repo, base, target, file });
export const revertCommit = (repo: string, hash: string) => invoke<Outcome>("revert_commit", { repo, hash });
export const cherryPick = (repo: string, hash: string) => invoke<Outcome>("cherry_pick", { repo, hash });
/** Commits a reset to `hash` would take off the current branch. */
export const resetImpact = (repo: string, hash: string) => invoke<number>("reset_impact", { repo, hash });
/** `hard` discards uncommitted changes: confirm first. */
export const resetTo = (repo: string, hash: string, mode: ResetMode) => invoke<Outcome>("reset_to", { repo, hash, mode });
export const fileTimeline = (repo: string, path: string) => invoke<TimelineEntry[]>("file_timeline", { repo, path });
export const blameFile = (repo: string, path: string) => invoke<Blame>("blame_file", { repo, path });

// ---- The Claude Code loop ----
/** `lines`: indices into `hunk.lines` to act on (null = the whole hunk). Discard is irreversible: confirm first. */
export const applyHunk = (repo: string, file: FileChange, hunk: Hunk, lines: number[] | null, action: HunkAction) =>
  invoke<void>("apply_hunk", { repo, file, hunk, lines, action });
/** Likely secrets in the next commit: staged changes, or everything when `stageAll`. */
export const checkSecrets = (repo: string, stageAll: boolean) => invoke<SecretFinding[]>("check_secrets", { repo, stageAll });
/** Returns the undone commit's message. */
export const undoLastCommit = (repo: string) => invoke<string>("undo_last_commit", { repo });
export const addToGitignore = (repo: string, path: string) => invoke<void>("add_to_gitignore", { repo, path });
export const claudePrompts = (repo: string) => invoke<ClaudePrompt[]>("claude_prompts", { repo });
export const listWorktrees = (repo: string) => invoke<Worktree[]>("list_worktrees", { repo });
export const addWorktree = (repo: string, path: string, branch: string, newBranch: boolean) =>
  invoke<RepoRef>("add_worktree", { repo, path, branch, newBranch });
export const removeWorktree = (repo: string, path: string, force: boolean) => invoke<void>("remove_worktree", { repo, path, force });
