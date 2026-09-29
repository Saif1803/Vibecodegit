import { listen } from "@tauri-apps/api/event";
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

export function useRepoState(run: GitRunner = tauriGit) {
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

  const patch = useCallback((p: Partial<RepoState>) => setState((s) => ({ ...s, ...p })), []);

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

  const dismissNotice = useCallback(() => patch({ notice: null }), [patch]);

  useEffect(() => {
    let disposed = false;
    const unlisten = listen("window-shown", () => void refresh());
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
      void unlisten.then((f) => f());
    };
  }, [run, refresh, patch]);

  return { ...state, refresh, selectRepo, browse, toggle, toggleAll, dismissNotice };
}
