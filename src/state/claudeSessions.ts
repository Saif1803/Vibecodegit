import { samePath } from "../git/repo";
import type { ClaudeSessionRepo } from "../git/types";

/** A session log written this recently means Claude is actively working in that repo. */
export const CLAUDE_ACTIVE_MS = 90_000;

export function isClaudeActive(repoPath: string | null, repos: ClaudeSessionRepo[], now = Date.now()): boolean {
  if (!repoPath) return false;
  const r = repos.find((x) => samePath(x.path, repoPath));
  return !!r && now - r.lastActiveMs < CLAUDE_ACTIVE_MS;
}

export interface AutoSelect {
  /** Repo path to select (unchanged when equal to `current`). */
  select: string | null;
  /** The Claude repo that was last auto-selected; feed back in next time. */
  lastAuto: string | null;
}

/**
 * On each window show: jump to the repo Claude is newest in, unless that's the same repo
 * we already jumped to last time — then the user's own pick (if any) wins. With no
 * Claude repo, keep the current repo, else fall back to the most recent one.
 */
export function autoSelect(
  current: string | null,
  newestClaude: string | null,
  lastAuto: string | null,
  fallback: string | null,
): AutoSelect {
  if (newestClaude && !(lastAuto && samePath(newestClaude, lastAuto))) {
    return { select: newestClaude, lastAuto: newestClaude };
  }
  return { select: current ?? newestClaude ?? fallback, lastAuto };
}
