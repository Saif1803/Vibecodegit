import type { FileChange } from "../git/types";

/**
 * Which files are checked after a status refresh. A new repo starts from what's staged.
 * On the same repo, the user's choices survive for files still present, and files that
 * are newly staged (e.g. by Claude or a terminal) get checked.
 */
export function reconcileSelection(
  prev: Set<string> | null,
  prevFiles: FileChange[] | null,
  files: FileChange[],
): Set<string> {
  const staged = files.filter((f) => f.staged).map((f) => f.path);
  if (!prev || !prevFiles) return new Set(staged);

  const known = new Set(prevFiles.map((f) => f.path));
  const wasStaged = new Set(prevFiles.filter((f) => f.staged).map((f) => f.path));
  const next = new Set<string>();
  for (const f of files) {
    if (known.has(f.path) ? prev.has(f.path) : f.staged) next.add(f.path);
    else if (f.staged && !wasStaged.has(f.path)) next.add(f.path);
  }
  return next;
}
