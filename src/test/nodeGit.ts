/// <reference types="node" />
// Test-only helpers: a GitRunner backed by Node's child_process, and throwaway repos.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GIT_ENV, GLOBAL_ARGS, type GitRunner } from "../git/runGit";

/** Mirrors tauriGit: resolves with the exit code, rejects only if git can't be spawned. */
export const nodeGit: GitRunner = (repo, args) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      [...GLOBAL_ARGS, ...args],
      { cwd: repo, env: { ...process.env, ...GIT_ENV }, maxBuffer: 64 << 20 },
      (err, stdout, stderr) => {
        if (err && typeof err.code !== "number") return reject(err);
        resolve({ code: err ? (err.code as number) : 0, stdout, stderr });
      },
    );
  });

export function tempDir(prefix = "claudegit-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function write(root: string, rel: string, content: string) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** Runs git in `cwd` and throws with stderr on failure. */
export async function sh(cwd: string, ...args: string[]): Promise<string> {
  const r = await nodeGit(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** A repo with one commit, deterministic identity, and LF endings. */
export async function makeRepo(files: Record<string, string> = { "README.md": "hi\n" }): Promise<string> {
  const dir = tempDir();
  await sh(dir, "init", "-q", "-b", "main");
  await sh(dir, "config", "user.email", "test@example.com");
  await sh(dir, "config", "user.name", "Test");
  await sh(dir, "config", "core.autocrlf", "false");
  await sh(dir, "config", "commit.gpgsign", "false");
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-q", "-m", "init");
  return dir;
}
