import { git, GitError, type GitResult, type GitRunner } from "./runGit";
import { inProgressOperation } from "./status";
import type { FileChange } from "./types";

export type Step = "add" | "commit" | "pull" | "push";
export const STEPS: Step[] = ["add", "commit", "pull", "push"];
export type StepState = "running" | "done" | "skipped" | "failed";

export type CommitPushResult =
  | {
      ok: true;
      hash: string;
      /** Where it was pushed ("origin/main"), or null when there's no remote. */
      pushedTo: string | null;
      /** Something the user should know even though everything succeeded. */
      warning?: string;
    }
  | {
      ok: false;
      step: Step;
      message: string;
      /** The commit exists locally even though a later step failed. */
      hash: string | null;
    };

/** Windows caps a command line at 32,767 chars; stay well under it with the global args. */
export const MAX_PATHSPEC_CHARS = 30_000;
export const STASH_MESSAGE = "claudegit: other changes during pull";

export interface Pathspec {
  /** Untracked files to add first; tracked paths are picked up by `commit -- <paths>` itself. */
  add: string[];
  /** Everything the commit should contain. Renames need both sides so the old path is removed. */
  commit: string[];
}

export function pathspecFor(files: FileChange[], selected: Set<string>): Pathspec {
  const spec: Pathspec = { add: [], commit: [] };
  for (const f of files) {
    if (!selected.has(f.path)) continue;
    if (f.kind === "untracked") spec.add.push(f.path);
    if (f.origPath) spec.commit.push(f.origPath);
    spec.commit.push(f.path);
  }
  return spec;
}

/**
 * add → commit → pull (rebase) → push, for exactly the selected files.
 *
 * - `commit -- <paths>` commits the working-tree state of just those paths (modifications,
 *   deletions, renames); anything else already staged stays staged.
 * - Pull is fetch + rebase onto upstream. Other local changes are stashed around the rebase
 *   and restored with `--index`, so staged files stay staged (`pull --autostash` loses that).
 * - A conflicting rebase is aborted so the repo is never left mid-rebase; the commit stays local.
 * - No upstream: push `-u origin HEAD` if there's an origin, else stop after committing.
 */
export async function commitPush(
  run: GitRunner,
  repo: string,
  spec: Pathspec,
  message: string,
  onStep: (step: Step, state: StepState) => void = () => {},
): Promise<CommitPushResult> {
  let hash: string | null = null;
  let warning: string | undefined;
  // Widened on purpose: `step()` reassigns it inside a closure, which narrowing can't see.
  let current = "add" as Step;

  const step = async <T>(name: Step, body: () => Promise<T>): Promise<T> => {
    current = name;
    onStep(name, "running");
    const out = await body();
    onStep(name, "done");
    return out;
  };
  const fail = (message: string): CommitPushResult => {
    onStep(current, "failed");
    return { ok: false, step: current, message, hash };
  };
  const savedLocally = () => `Your commit (${hash}) is saved locally.`;
  const success = (pushedTo: string | null): CommitPushResult => ({ ok: true, hash: hash!, pushedTo, ...(warning ? { warning } : {}) });

  if (spec.commit.length === 0) return fail("No files selected.");
  if (!message.trim()) return fail("Commit message is empty.");
  if (spec.commit.join(" ").length > MAX_PATHSPEC_CHARS) {
    return fail(`Too many files selected for one command line (${spec.commit.length}). Commit from a terminal instead.`);
  }

  try {
    await step("add", async () => {
      if (spec.add.length > 0) await git(run, repo, ["add", "--", ...spec.add]);
    });
    await step("commit", async () => {
      await git(run, repo, ["commit", "-m", message, "--", ...spec.commit]);
      hash = (await git(run, repo, ["rev-parse", "--short", "HEAD"])).trim();
    });

    const upstream = await run(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    if (upstream.code === 0) {
      const pulled = await step("pull", () => rebaseOntoUpstream(run, repo));
      if (!pulled.ok) {
        current = "pull";
        return fail(`${pulled.message}\n${savedLocally()}`);
      }
      warning = pulled.warning;
      await step("push", () => git(run, repo, ["push"]));
      return success(upstream.stdout.trim());
    }

    // No upstream: nothing to pull; publish the branch to origin if there is one.
    onStep("pull", "skipped");
    const remotes = (await git(run, repo, ["remote"])).split(/\r?\n/).filter(Boolean);
    if (!remotes.includes("origin")) {
      onStep("push", "skipped");
      return success(null);
    }
    await step("push", () => git(run, repo, ["push", "-u", "origin", "HEAD"]));
    const branch = (await git(run, repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    return success(`origin/${branch}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(hash && current !== "commit" ? `${msg}\n${savedLocally()}` : msg);
  }
}

type PullOutcome = { ok: true; warning?: string } | { ok: false; message: string };

const failed = (r: GitResult) => new GitError([], r).message;

/** fetch; if behind, stash other changes, rebase onto upstream, restore the stash. */
async function rebaseOntoUpstream(run: GitRunner, repo: string): Promise<PullOutcome> {
  const fetch = await run(repo, ["fetch", "--quiet"]);
  if (fetch.code !== 0) return { ok: false, message: failed(fetch) };

  const behind = Number((await git(run, repo, ["rev-list", "--count", "HEAD..@{u}"])).trim());
  if (!(behind > 0)) return { ok: true };

  // Tracked changes block a rebase; untracked files only matter if upstream adds the same path.
  const dirty = (await git(run, repo, ["status", "--porcelain", "--untracked-files=no"])).trim() !== "";
  if (dirty) await git(run, repo, ["stash", "push", "--quiet", "-m", STASH_MESSAGE]);

  const rebase = await run(repo, ["rebase", "--no-autostash", "@{u}"]);
  let outcome: PullOutcome = { ok: true };
  if (rebase.code !== 0) {
    const conflicted = (await inProgressOperation(run, repo)) === "rebase";
    if (conflicted) await run(repo, ["rebase", "--abort"]);
    outcome = {
      ok: false,
      message: conflicted
        ? "Pulled changes conflict with your commit. The rebase was undone; pull and resolve in your editor."
        : failed(rebase),
    };
  }

  if (dirty) {
    const restored = await restoreStash(run, repo);
    if (restored) {
      if (outcome.ok) outcome = { ok: true, warning: restored };
      else outcome = { ok: false, message: `${outcome.message}\n${restored}` };
    }
  }
  return outcome;
}

/**
 * Pops our stash keeping staged state; returns a note if that wasn't fully possible.
 * Never discards anything: on a real conflict the stash is left in place (git keeps it).
 */
async function restoreStash(run: GitRunner, repo: string): Promise<string | undefined> {
  if ((await run(repo, ["stash", "pop", "--index", "--quiet"])).code === 0) return undefined;
  const conflictNote = `Your other changes conflict with what was pulled. Resolve the conflicts in your editor; a copy is kept in \`git stash\` ("${STASH_MESSAGE}").`;

  // `--index` refuses up front when the staged state can't be rebuilt; the tree is untouched then.
  const clean = (await git(run, repo, ["status", "--porcelain", "--untracked-files=no"])).trim() === "";
  if (!clean) return conflictNote;
  if ((await run(repo, ["stash", "pop", "--quiet"])).code === 0) {
    return "Your other changes were restored, but some are no longer staged.";
  }
  return conflictNote;
}
