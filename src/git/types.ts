// Shapes returned by the Rust git commands (src-tauri/src/git). Keep in sync with the serde types.

export type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

/** One side (index or working tree) of one path's change. */
export interface FileChange {
  path: string;
  /** Previous path, for staged renames/copies. */
  origPath?: string;
  kind: ChangeKind;
}

/** Which list a change came from; also picks the diff to show. */
export type ChangeSide = "staged" | "unstaged" | "conflicted";

export interface BranchInfo {
  /** null when HEAD is detached. */
  head: string | null;
  /** False on an unborn branch (a fresh repo with no commits yet). */
  hasCommits: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert";

export interface RepoStatus {
  branch: BranchInfo;
  /** In the index: what the next commit contains. */
  staged: FileChange[];
  /** Working-tree edits not yet staged, plus untracked files. */
  unstaged: FileChange[];
  /** Unmerged paths. */
  conflicted: FileChange[];
  /** A multi-step git operation stopped midway (usually on conflicts). */
  operation: Operation | null;
  /** Why committing isn't possible right now, if it isn't. */
  blocker: string | null;
}

export type LineKind = "context" | "add" | "del" | "note";

export interface DiffLine {
  kind: LineKind;
  text: string;
  old: number | null;
  new: number | null;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  binary: boolean;
  /** Stopped after 5,000 lines. */
  truncated: boolean;
  hunks: Hunk[];
}

export type Step = "stage" | "commit" | "pull" | "push";
export const STEPS: Step[] = ["stage", "commit", "pull", "push"];
export type StepState = "running" | "done" | "skipped" | "failed";

export interface CommitOptions {
  message: string;
  /** Rewrite the last commit. An empty message keeps the old one. */
  amend?: boolean;
  /** Nothing is staged: stage every change first ("smart commit"). */
  stageAll?: boolean;
  /** Pull (rebase) and push after committing. */
  push: boolean;
  /** The amended commit was already pushed: skip the pull, push --force-with-lease. */
  forcePush?: boolean;
}

export type CommitResult =
  | { ok: true; hash: string; pushedTo: string | null; warning?: string }
  | { ok: false; step: Step; message: string; hash: string | null };

export type SyncKind = "fetch" | "pull" | "push" | "sync";
export type SyncResult = Outcome;

export interface RepoRef {
  /** Absolute repo root. */
  path: string;
  name: string;
}

export type Resolved =
  | { ok: true; repo: RepoRef }
  | { ok: false; reason: "missing" | "not-a-repo"; message: string };

export interface ClaudeSessionRepo extends RepoRef {
  lastActiveMs: number;
}

export interface RawSession {
  cwd: string;
  sessionId: string;
  lastActiveMs: number;
}

export interface ClaudeRepos {
  /** Repos with a Claude session in the last 24 h, most recently active first. */
  repos: ClaudeSessionRepo[];
  /** Session folders that aren't inside a git repo. */
  nonRepos: RawSession[];
  /** The newest session overall. */
  newestSessionId: string | null;
}

/** `{ ok, message, warning? }` from multi-step operations (sync, merge, rebase, stash apply). */
export interface Outcome {
  ok: boolean;
  message: string;
  warning?: string;
}

export interface Branch {
  /** "main", or "origin/main" for a remote branch. */
  name: string;
  /** The remote of a remote-tracking branch; null for local branches. */
  remote: string | null;
  current: boolean;
  commit: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** The upstream was deleted on the remote. */
  gone: boolean;
  dateMs: number;
  subject: string;
}

export interface StashEntry {
  index: number;
  hash: string;
  dateMs: number;
  message: string;
  branch: string | null;
}

export type StashMode = "tracked" | "include-untracked" | "staged";

export interface Tag {
  name: string;
  commit: string;
  annotated: boolean;
  subject: string;
  dateMs: number;
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

// ---- History ----

export interface Lane {
  col: number;
  /** Palette index; wraps. */
  color: number;
}

/** One row of the lane graph; rows stack with no gaps so lanes join up. */
export interface GraphRow {
  col: number;
  color: number;
  /** Straight through, top to bottom. */
  through: Lane[];
  /** From the top of the lane into the dot. */
  up: Lane[];
  /** From the dot to the bottom of the lane (one per parent). */
  down: Lane[];
}

export type RefKind = "head" | "branch" | "remote" | "tag";

export interface RefLabel {
  name: string;
  kind: RefKind;
}

export interface Commit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  dateMs: number;
  subject: string;
  refs: RefLabel[];
  isHead: boolean;
  /** On the upstream, not in HEAD yet. */
  incoming: boolean;
  /** In HEAD, not on the upstream yet. */
  outgoing: boolean;
  graph: GraphRow;
}

export interface History {
  commits: Commit[];
  more: boolean;
  upstream: string | null;
}

export interface CommitDetail {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  dateMs: number;
  committer: string;
  commitDateMs: number;
  message: string;
  refs: RefLabel[];
  /** First parent, or the empty tree for a root commit. */
  base: string;
  files: FileChange[];
}

export type ResetMode = "soft" | "mixed" | "hard";

export interface TimelineEntry {
  hash: string;
  short: string;
  author: string;
  dateMs: number;
  subject: string;
  base: string;
  /** The file as it was in this commit. */
  file: FileChange;
}

export interface BlameCommit {
  hash: string;
  short: string;
  author: string;
  dateMs: number;
  summary: string;
  uncommitted: boolean;
}

export interface BlameLine {
  /** Index into `Blame.commits`. */
  commit: number;
  line: number;
  text: string;
}

export interface Blame {
  commits: BlameCommit[];
  lines: BlameLine[];
  truncated: boolean;
}
