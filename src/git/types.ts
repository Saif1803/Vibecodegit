export type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface FileChange {
  path: string;
  /** Previous path, for renames. */
  origPath?: string;
  kind: ChangeKind;
  /** Already in the index; used to pre-check the file. */
  staged: boolean;
}

export interface BranchInfo {
  /** null when HEAD is detached. */
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface RepoRef {
  /** Absolute repo root. */
  path: string;
  name: string;
}

export interface ClaudeSessionRepo extends RepoRef {
  lastActiveMs: number;
}
