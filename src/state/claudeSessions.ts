import { invoke } from "@tauri-apps/api/core";
import { resolveRepo, samePath } from "../git/repo";
import type { GitRunner } from "../git/runGit";
import type { ClaudeSessionRepo, RepoRef } from "../git/types";

/** A session log written this recently means Claude is actively working in that repo. */
export const CLAUDE_ACTIVE_MS = 90_000;

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
}

export const fetchSessions = () => invoke<RawSession[]>("detect_claude_sessions");

// cwd → repo root. Only successes are cached: a folder can become a repo later.
const rootCache = new Map<string, RepoRef>();

/** Maps session cwds to repo roots and merges sessions that share a repo. */
export async function claudeRepos(run: GitRunner, sessions: RawSession[]): Promise<ClaudeRepos> {
  const resolved = await Promise.all(
    sessions.map(async (s) => {
      const cached = rootCache.get(s.cwd);
      if (cached) return cached;
      const r = await resolveRepo(run, s.cwd);
      if (!r.ok) return null;
      rootCache.set(s.cwd, r.repo);
      return r.repo;
    }),
  );

  const repos: ClaudeSessionRepo[] = [];
  const nonRepos: RawSession[] = [];
  sessions.forEach((s, i) => {
    const repo = resolved[i];
    if (!repo) return void nonRepos.push(s);
    const existing = repos.find((r) => samePath(r.path, repo.path));
    if (!existing) repos.push({ ...repo, lastActiveMs: s.lastActiveMs });
    else existing.lastActiveMs = Math.max(existing.lastActiveMs, s.lastActiveMs);
  });
  repos.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
  return { repos, nonRepos };
}

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
