import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../git/api";
import { samePath } from "../git/repo";
import type { AgentRepos, RepoRef, RepoStatus } from "../git/types";
import { autoSelect } from "./agentSessions";
import { pickFolder } from "./pickFolder";
import { loadRecent, pruneRecent, rememberRepo } from "./recentRepos";

export interface RepoState {
  repo: RepoRef | null;
  status: RepoStatus | null;
  recent: RepoRef[];
  agents: AgentRepos;
  loading: boolean;
  /** Blocking problem with the current repo (status failed). */
  error: string | null;
  /** Dismissible information (pruned repos, invalid folder picked, agent outside a repo). */
  notice: string | null;
}

const EMPTY_AGENTS: AgentRepos = { repos: [], nonRepos: [], newestSessionId: null };
/** How often agent activity is re-checked while the popup is visible. */
export const AGENT_POLL_MS = 5_000;

/** All repo/agent state for the popup. Refreshes on each show; polls while `visible`. */
export function useRepoState(visible: boolean, busy = false) {
  const [state, setState] = useState<RepoState>({
    repo: null,
    status: null,
    recent: [],
    agents: EMPTY_AGENTS,
    loading: true,
    error: null,
    notice: null,
  });
  // Latest state for async flows, plus a token so a slow status for an old repo is dropped.
  const latest = useRef(state);
  latest.current = state;
  const lastAuto = useRef<string | null>(null);
  const request = useRef(0);

  // Notices the user closed stay closed (e.g. an agent outside a repo).
  const dismissed = useRef(new Set<string>());

  const patch = useCallback((p: Partial<RepoState>) => {
    if (p.notice && dismissed.current.has(p.notice)) {
      const { notice: _, ...rest } = p;
      p = rest;
    }
    setState((s) => ({ ...s, ...p }));
  }, []);

  const loadStatus = useCallback(
    async (repo: RepoRef) => {
      const token = ++request.current;
      const prev = latest.current;
      const sameRepo = prev.repo && prev.status && samePath(prev.repo.path, repo.path);
      patch({ repo, loading: true, ...(sameRepo ? {} : { status: null, error: null }) });
      try {
        const status = await api.getStatus(repo.path);
        if (token !== request.current) return;
        patch({ status, loading: false, error: null });
      } catch (e) {
        if (token !== request.current) return;
        const check = await api.resolveRepo(repo.path).catch(() => null);
        patch({ status: null, loading: false, error: check && !check.ok ? check.message : api.errorText(e) });
      }
    },
    [patch],
  );

  /** Re-detect agent sessions, apply the auto-select rule, and reload status. */
  const refresh = useCallback(async () => {
    const [agents, recent] = await Promise.all([api.agentRepos().catch(() => EMPTY_AGENTS), loadRecent().catch(() => [])]);
    const current = latest.current.repo;
    const decision = autoSelect(current?.path ?? null, agents.repos[0]?.path ?? null, lastAuto.current, recent[0]?.path ?? null);
    lastAuto.current = decision.lastAuto;

    const pool: RepoRef[] = [...agents.repos, ...recent, ...(current ? [current] : [])];
    const target = decision.select ? pool.find((r) => samePath(r.path, decision.select!)) ?? null : null;

    const outside = agents.nonRepos.find((s) => s.sessionId === agents.newestSessionId);
    patch({
      agents,
      recent,
      ...(outside ? { notice: `${outside.agent} is working in ${outside.cwd}, which isn't a git repository.` } : {}),
    });

    if (target) await loadStatus(target);
    else patch({ loading: false });
  }, [patch, loadStatus]);

  const selectRepo = useCallback(
    async (repo: RepoRef) => {
      patch({ notice: null });
      const recent = await rememberRepo(repo).catch(() => latest.current.recent);
      patch({ recent });
      await loadStatus(repo);
    },
    [patch, loadStatus],
  );

  const browse = useCallback(async () => {
    const folder = await pickFolder();
    if (!folder) return;
    const r = await api.resolveRepo(folder);
    if (r.ok) await selectRepo(r.repo);
    else patch({ notice: r.message });
  }, [selectRepo, patch]);

  const dismissNotice = useCallback(() => {
    if (latest.current.notice) dismissed.current.add(latest.current.notice);
    patch({ notice: null });
  }, [patch]);

  // Agent activity only; the repo selection is left alone between shows.
  const pollAgents = useCallback(async () => {
    const agents = await api.agentRepos().catch(() => null);
    if (agents) patch({ agents });
  }, [patch]);

  /** Refresh button: re-read the current repo and agent activity, without auto-switching. */
  const reload = useCallback(async () => {
    const repo = latest.current.repo;
    await Promise.all([pollAgents(), repo ? loadStatus(repo) : Promise.resolve()]);
  }, [pollAgents, loadStatus]);

  /**
   * Run a git operation on the current repo, then re-read status whatever happened.
   * Returns git's error message on failure, or null.
   */
  const mutate = useCallback(
    async (op: (repo: string) => Promise<unknown>): Promise<string | null> => {
      const repo = latest.current.repo;
      if (!repo) return null;
      let failure: string | null = null;
      try {
        await op(repo.path);
      } catch (e) {
        failure = api.errorText(e);
      }
      await loadStatus(repo);
      return failure;
    },
    [loadStatus],
  );

  /** After a commit: the repo counts as recent, and its status changed. */
  const afterCommit = useCallback(async () => {
    const repo = latest.current.repo;
    if (!repo) return;
    const recent = await rememberRepo(repo).catch(() => latest.current.recent);
    patch({ recent });
    await loadStatus(repo);
  }, [patch, loadStatus]);

  // Refresh on each show, then poll agent activity until hidden.
  const wasVisible = useRef(false);
  useEffect(() => {
    const shownNow = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!visible) return;
    // Don't re-select or re-read the repo under a running operation.
    if (shownNow && !busy) void refresh();
    const timer = window.setInterval(() => void pollAgents(), AGENT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [visible, busy, refresh, pollAgents]);

  // Preload at launch so the first show is instant.
  useEffect(() => {
    let disposed = false;
    (async () => {
      // Once per launch: drop recent repos that were deleted or moved.
      const recent = await loadRecent().catch(() => []);
      const { removed } = await pruneRecent(recent).catch(() => ({ removed: [] as RepoRef[] }));
      if (!disposed && removed.length > 0) {
        patch({ notice: `Removed ${removed.map((r) => r.name).join(", ")} from recent repos (no longer found).` });
      }
      if (!disposed) await refresh();
    })();
    return () => {
      disposed = true;
    };
  }, [refresh, patch]);

  return { ...state, refresh, reload, mutate, afterCommit, selectRepo, browse, dismissNotice };
}
