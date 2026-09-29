import type { GitRunner } from "./runGit";
import type { RepoRef } from "./types";

export type ResolveResult =
  | { ok: true; repo: RepoRef }
  | { ok: false; reason: "missing" | "not-a-repo"; message: string };

/** `C:/a/b/` → `C:\a\b` on Windows-style paths; other paths just lose a trailing slash. */
export function normalizePath(path: string): string {
  const p = /^[A-Za-z]:[\\/]/.test(path) ? path.replace(/\//g, "\\") : path;
  return p.length > 3 ? p.replace(/[\\/]+$/, "") : p;
}

/** Case-insensitive on Windows paths, which is how the filesystem compares them. */
export function samePath(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return /^[A-Za-z]:\\/.test(na) ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

export function repoName(path: string): string {
  const parts = normalizePath(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Resolves any folder inside a work tree to its root (worktrees resolve to themselves). */
export async function resolveRepo(run: GitRunner, folder: string): Promise<ResolveResult> {
  let result;
  try {
    result = await run(folder, ["rev-parse", "--show-toplevel"]);
  } catch {
    // Spawning with a nonexistent cwd fails before git runs.
    return { ok: false, reason: "missing", message: `Folder not found: ${folder}` };
  }
  const top = result.stdout.trim();
  if (result.code !== 0 || !top) {
    return { ok: false, reason: "not-a-repo", message: `Not a git repository: ${folder}` };
  }
  const path = normalizePath(top);
  return { ok: true, repo: { path, name: repoName(path) } };
}
