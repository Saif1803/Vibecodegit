import { LazyStore } from "@tauri-apps/plugin-store";
import { resolveRepo } from "../git/api";
import { samePath } from "../git/repo";
import type { RepoRef } from "../git/types";

export const MAX_RECENT = 8;
const KEY = "repos";
const store = new LazyStore("recent-repos.json", { defaults: { [KEY]: [] }, autoSave: 100 });

/** Most-recent-first, deduplicated by path, capped at `max`. */
export function pushMru(list: RepoRef[], repo: RepoRef, max = MAX_RECENT): RepoRef[] {
  return [repo, ...list.filter((r) => !samePath(r.path, repo.path))].slice(0, max);
}

function isRepoRef(v: unknown): v is RepoRef {
  return typeof v === "object" && v !== null && typeof (v as RepoRef).path === "string" && typeof (v as RepoRef).name === "string";
}

export async function loadRecent(): Promise<RepoRef[]> {
  const raw = await store.get<unknown>(KEY);
  return Array.isArray(raw) ? raw.filter(isRepoRef).slice(0, MAX_RECENT) : [];
}

async function saveRecent(list: RepoRef[]) {
  await store.set(KEY, list);
}

export async function rememberRepo(repo: RepoRef): Promise<RepoRef[]> {
  const next = pushMru(await loadRecent(), repo);
  await saveRecent(next);
  return next;
}

/** Drops repos that no longer exist or are no longer repos; returns what was removed. */
export async function pruneRecent(list: RepoRef[]): Promise<{ kept: RepoRef[]; removed: RepoRef[] }> {
  const checks = await Promise.all(list.map((r) => resolveRepo(r.path)));
  const kept = list.filter((_, i) => checks[i].ok);
  const removed = list.filter((_, i) => !checks[i].ok);
  if (removed.length > 0) await saveRecent(kept);
  return { kept, removed };
}
