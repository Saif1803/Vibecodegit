import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChangeSide,
  ClaudeRepos,
  CommitOptions,
  CommitResult,
  FileChange,
  FileDiff,
  RepoStatus,
  Resolved,
  Step,
  StepState,
  SyncKind,
  SyncResult,
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
