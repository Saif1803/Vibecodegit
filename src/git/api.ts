import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  Branch,
  ChangeSide,
  ClaudeRepos,
  CommitOptions,
  CommitResult,
  FileChange,
  FileDiff,
  Outcome,
  Remote,
  RepoStatus,
  Resolved,
  StashEntry,
  StashMode,
  Step,
  StepState,
  SyncKind,
  SyncResult,
  Tag,
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
