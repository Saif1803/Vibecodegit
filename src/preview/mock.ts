// Design-preview data. Replaced by real git/Claude state in Phases 3–4.
import type { BranchInfo, ClaudeSessionRepo, FileChange, RepoRef } from "../git/types";

const now = Date.now();

export const mockActive: ClaudeSessionRepo[] = [
  { name: "ClaudeGit", path: "C:\\Users\\Saif\\Desktop\\currently_working\\ClaudeGit", lastActiveMs: now - 20_000 },
  { name: "influpitch", path: "C:\\Users\\Saif\\Desktop\\currently_working\\influpitch", lastActiveMs: now - 55 * 60_000 },
];

export const mockRecent: RepoRef[] = [
  { name: "ClaudeGit", path: "C:\\Users\\Saif\\Desktop\\currently_working\\ClaudeGit" },
  { name: "dotfiles", path: "C:\\Users\\Saif\\dotfiles" },
];

export const mockBranch: BranchInfo = { head: "main", upstream: "origin/main", ahead: 1, behind: 0 };

export const mockFiles: FileChange[] = [
  { path: "src/App.tsx", kind: "modified", staged: true },
  { path: "src/components/FileList.tsx", kind: "added", staged: true },
  { path: "src/components/CommitBox.tsx", kind: "added", staged: false },
  { path: "src/theme.ts", kind: "untracked", staged: false },
  { path: "src/App.css", kind: "deleted", staged: false },
  { path: "src/git/types.ts", origPath: "src/types.ts", kind: "renamed", staged: true },
  { path: "src-tauri/src/lib.rs", kind: "modified", staged: false },
];
