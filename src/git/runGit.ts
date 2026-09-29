import { Command } from "@tauri-apps/plugin-shell";

export interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `git <args>` in `repo`. Injected everywhere so git logic is testable without Tauri. */
export type GitRunner = (repo: string, args: string[]) => Promise<GitResult>;

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly result: GitResult,
  ) {
    super(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed (exit ${result.code})`);
    this.name = "GitError";
  }
}

/** Like the runner, but throws GitError on a non-zero exit. */
export async function git(run: GitRunner, repo: string, args: string[]): Promise<string> {
  const result = await run(repo, args);
  if (result.code !== 0) throw new GitError(args, result);
  return result.stdout;
}

export const GLOBAL_ARGS = ["-c", "core.quotepath=off", "-c", "color.ui=false"];
/** Fail fast instead of hanging on a credential prompt nobody can see. */
export const GIT_ENV = { GIT_TERMINAL_PROMPT: "0" };

/**
 * The real runner: the system `git`, via the shell plugin's scoped "git" command.
 * No shell is involved; every argument is passed as a discrete argv item.
 * Rejects (does not resolve) if git can't be spawned, e.g. `repo` doesn't exist.
 */
export const tauriGit: GitRunner = async (repo, args) => {
  const out = await Command.create("git", [...GLOBAL_ARGS, ...args], {
    cwd: repo,
    env: GIT_ENV,
  }).execute();
  return { code: out.code, stdout: out.stdout, stderr: out.stderr };
};
