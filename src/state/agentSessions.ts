import { samePath } from "../git/repo";
import type { AgentSessionRepo } from "../git/types";

/** A session log written this recently means an agent is actively working in that repo. */
export const AGENT_ACTIVE_MS = 90_000;

export function activeAgents(repoPath: string | null, repos: AgentSessionRepo[], now = Date.now()): string[] {
  if (!repoPath) return [];
  const repo = repos.find((x) => samePath(x.path, repoPath));
  return repo?.agents.filter((agent) => now - agent.lastActiveMs < AGENT_ACTIVE_MS).map((agent) => agent.name) ?? [];
}

export interface AutoSelect {
  /** Repo path to select (unchanged when equal to `current`). */
  select: string | null;
  /** The agent repo that was last auto-selected; feed back in next time. */
  lastAuto: string | null;
}

/**
 * On each window show: jump to the repo with the newest agent session, unless that's the same repo
 * we already jumped to last time — then the user's own pick (if any) wins. With no
 * agent repo, keep the current repo, else fall back to the most recent one.
 */
export function autoSelect(
  current: string | null,
  newestAgent: string | null,
  lastAuto: string | null,
  fallback: string | null,
): AutoSelect {
  if (newestAgent && !(lastAuto && samePath(newestAgent, lastAuto))) {
    return { select: newestAgent, lastAuto: newestAgent };
  }
  return { select: current ?? newestAgent ?? fallback, lastAuto };
}
