import { useCallback, useEffect, useRef, useState } from "react";
import { resolveRepo, samePath } from "../git/repo";
import { tauriGit, type GitRunner } from "../git/runGit";
import { getStatus, type RepoStatus } from "../git/status";
import type { RepoRef } from "../git/types";
import { autoSelect, claudeRepos, fetchSessions, type ClaudeRepos } from "./claudeSessions";
import { pickFolder } from "./pickFolder";
import { loadRecent, pruneRecent, rememberRepo } from "./recentRepos";
import { reconcileSelection } from "./selection";

export interface RepoState {
  repo: RepoRef | null;
  status: RepoStatus | null;
  selected: Set<string>;
  recent: RepoRef[];
  claude: ClaudeRepos;
  loading: boolean;
  /** Blocking problem with the current repo (status failed). */
  error: string | null;
  /** Dismissible information (pruned repos, invalid folder picked, Claude outside a repo). */
  notice: string | null;
}

const EMPTY_CLAUDE: ClaudeRepos = { repos: [], nonRepos: [] };
/** How often Claude activity is re-checked while the popup is visible. */
export const CLAUDE_POLL_MS = 5_000;

/** All repo/Claude state for the popup. Refreshes on each show; polls Claude only while `visible`. */
export function useRepoState(visible: boolean, busy = false, run: GitRunner = tauriGit) {
  const [state, setState] = useState<RepoState>({
    repo: null,
    status: null,
    selected: new Set(),
    recent: [],
    claude: EMPTY_CLAUDE,
    loading: true,
    error: null,
    notice: null,
  });
  // Latest state for async flows, plus a token so a slow status for an old repo is dropped.
  const latest = useRef(state);
  latest.current = state;
  const lastAuto = useRef<string | null>(null);
  const request = useRef(0);

  // Notices the user closed stay closed (e.g. "Claude is in a non-repo folder" on every show).
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
        const status = await getStatus(run, repo.path);
        if (token !== request.current) return;
        const cur = latest.current;
        const selected = sameRepo ? reconcileSelection(cur.selected, cur.status?.files ?? null, status.files) : reconcileSelection(null, null, status.files);
        patch({ status, selected, loading: false, error: null });
      } catch (e) {
        if (token !== request.current) return;
        const check = await resolveRepo(run, repo.path);
        patch({ status: null, selected: new Set(), loading: false, error: check.ok ? String((e as Error).message ?? e) : check.message });
      }
    },
    [run, patch],
  );

  /** Re-detect Claude sessions, apply the auto-select rule, and reload status. */
  const refresh = useCallback(async () => {
    const [sessions, recent] = await Promise.all([fetchSessions().catch(() => []), loadRecent().catch(() => [])]);
    const claude = await claudeRepos(run, sessions);
    const current = latest.current.repo;
    const decision = autoSelect(current?.path ?? null, claude.repos[0]?.path ?? null, lastAuto.current, recent[0]?.path ?? null);
    lastAuto.current = decision.lastAuto;

    const pool: RepoRef[] = [...claude.repos, ...recent, ...(current ? [current] : [])];
    const target = decision.select ? pool.find((r) => samePath(r.path, decision.select!)) ?? null : null;

    const newest = sessions[0];
    const claudeOutsideRepo = newest && claude.nonRepos.some((s) => s.sessionId === newest.sessionId);
    patch({
      claude,
      recent,
      ...(claudeOutsideRepo ? { notice: `Claude is working in ${newest.cwd}, which isn't a git repository.` } : {}),
    });

    if (target) await loadStatus(target);
    else patch({ loading: false });
  }, [run, patch, loadStatus]);

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
    const r = await resolveRepo(run, folder);
    if (r.ok) await selectRepo(r.repo);
    else patch({ notice: r.message });
  }, [run, selectRepo, patch]);

  const toggle = useCallback(
    (path: string, checked: boolean) =>
      setState((s) => {
        const selected = new Set(s.selected);
        if (checked) selected.add(path);
        else selected.delete(path);
        return { ...s, selected };
      }),
    [],
  );

  const toggleAll = useCallback(
    (checked: boolean) =>
      setState((s) => ({ ...s, selected: new Set(checked ? (s.status?.files ?? []).map((f) => f.path) : []) })),
    [],
  );

  const dismissNotice = useCallback(() => {
    if (latest.current.notice) dismissed.current.add(latest.current.notice);
    patch({ notice: null });
  }, [patch]);

  // Claude activity only; the repo selection is left alone between shows.
  const pollClaude = useCallback(async () => {
    const sessions = await fetchSessions().catch(() => null);
    if (sessions) patch({ claude: await claudeRepos(run, sessions) });
  }, [run, patch]);

  /** Refresh button: re-read the current repo and Claude activity, without auto-switching. */
  const reload = useCallback(async () => {
    const repo = latest.current.repo;
    await Promise.all([pollClaude(), repo ? loadStatus(repo) : Promise.resolve()]);
  }, [pollClaude, loadStatus]);

  /** After Commit & Push: the repo counts as recent, and its status changed. */
  const afterCommit = useCallback(async () => {
    const repo = latest.current.repo;
    if (!repo) return;
    const recent = await rememberRepo(repo).catch(() => latest.current.recent);
    patch({ recent });
    await loadStatus(repo);
  }, [patch, loadStatus]);

  // Refresh on each show, then poll Claude activity until hidden.
  const wasVisible = useRef(false);
  useEffect(() => {
    const shownNow = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!visible) return;
    // Don't re-select or re-read the repo under a running Commit & Push.
    if (shownNow && !busy) void refresh();
    const timer = window.setInterval(() => void pollClaude(), CLAUDE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [visible, busy, refresh, pollClaude]);

  // Preload at launch so the first show is instant.
  useEffect(() => {
    let disposed = false;
    (async () => {
      // Once per launch: drop recent repos that were deleted or moved.
      const recent = await loadRecent().catch(() => []);
      const { removed } = await pruneRecent(run, recent).catch(() => ({ removed: [] }));
      if (!disposed && removed.length > 0) {
        patch({ notice: `Removed ${removed.map((r) => r.name).join(", ")} from recent repos (no longer found).` });
      }
      if (!disposed) await refresh();
    })();
    return () => {
      disposed = true;
    };
  }, [run, refresh, patch]);

  return { ...state, refresh, reload, afterCommit, selectRepo, browse, toggle, toggleAll, dismissNotice };
}
