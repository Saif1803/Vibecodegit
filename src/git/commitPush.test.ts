import { describe, expect, it } from "vitest";
import { commitPush, MAX_PATHSPEC_CHARS, pathspecFor, type Step, type StepState } from "./commitPush";
import type { GitResult, GitRunner } from "./runGit";
import type { FileChange } from "./types";

const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });
const err = (stderr: string, code = 1): GitResult => ({ code, stdout: "", stderr });

/**
 * Fake git: the first rule whose prefix matches the args answers; unmatched calls succeed
 * with empty output. Records every call so tests can assert the exact sequence.
 */
function fakeGit(rules: [string, GitResult][]) {
  const calls: string[] = [];
  const run: GitRunner = async (_repo, args) => {
    const line = args.join(" ");
    calls.push(line);
    return rules.find(([prefix]) => line.startsWith(prefix))?.[1] ?? ok();
  };
  return { run, calls };
}

const HAS_UPSTREAM: [string, GitResult] = ["rev-parse --abbrev-ref --symbolic-full-name @{u}", ok("origin/main\n")];
const NO_UPSTREAM: [string, GitResult] = ["rev-parse --abbrev-ref --symbolic-full-name @{u}", err("fatal: no upstream", 128)];
const HASH: [string, GitResult] = ["rev-parse --short HEAD", ok("abc1234\n")];
const NO_REBASE: [string, GitResult] = ["rev-parse -q --verify", err("", 1)];
const BEHIND: [string, GitResult] = ["rev-list --count HEAD..@{u}", ok("2\n")];
const DIRTY: [string, GitResult] = ["status --porcelain --untracked-files=no", ok(" M other.ts\n")];

function track() {
  const steps: [Step, StepState][] = [];
  return { steps, onStep: (s: Step, st: StepState) => steps.push([s, st]) };
}

describe("pathspecFor", () => {
  it("adds only untracked files and commits both sides of renames", () => {
    const files: FileChange[] = [
      { path: "a.ts", kind: "modified", staged: false },
      { path: "new.ts", origPath: "old.ts", kind: "renamed", staged: true },
      { path: "gone.ts", kind: "deleted", staged: true },
      { path: "fresh.ts", kind: "untracked", staged: false },
      { path: "skip.ts", kind: "untracked", staged: false },
    ];
    expect(pathspecFor(files, new Set(["a.ts", "new.ts", "gone.ts", "fresh.ts"]))).toEqual({
      add: ["fresh.ts"],
      commit: ["a.ts", "old.ts", "new.ts", "gone.ts", "fresh.ts"],
    });
  });
});

const spec = (...commit: string[]) => ({ add: [], commit });

describe("commitPush", () => {
  it("adds untracked, commits, fetches, and pushes when not behind", async () => {
    const { run, calls } = fakeGit([HAS_UPSTREAM, HASH, ["rev-list --count", ok("0\n")]]);
    const t = track();
    const r = await commitPush(run, "R", { add: ["-weird name.ts"], commit: ["a.ts", "-weird name.ts"] }, "-m looks like a flag", t.onStep);

    expect(r).toEqual({ ok: true, hash: "abc1234", pushedTo: "origin/main" });
    expect(calls).toEqual([
      "add -- -weird name.ts",
      "commit -m -m looks like a flag -- a.ts -weird name.ts",
      "rev-parse --short HEAD",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}",
      "fetch --quiet",
      "rev-list --count HEAD..@{u}",
      "push",
    ]);
    expect(t.steps).toEqual([
      ["add", "running"], ["add", "done"],
      ["commit", "running"], ["commit", "done"],
      ["pull", "running"], ["pull", "done"],
      ["push", "running"], ["push", "done"],
    ]);
  });

  it("passes the message and paths as discrete argv items, skipping add when nothing is untracked", async () => {
    const seen: string[][] = [];
    const run: GitRunner = async (_r, args) => (seen.push(args), args[0] === "rev-parse" && args[1] === "--short" ? ok("h\n") : ok());
    await commitPush(run, "R", spec("a b.ts"), 'fix "quotes" & $HOME; rm -rf /');
    expect(seen[0]).toEqual(["commit", "-m", 'fix "quotes" & $HOME; rm -rf /', "--", "a b.ts"]);
  });

  it("when behind with other local changes: stash, rebase, pop --index", async () => {
    const { run, calls } = fakeGit([HAS_UPSTREAM, HASH, BEHIND, DIRTY]);
    const r = await commitPush(run, "R", spec("a.ts"), "msg");
    expect(r).toEqual({ ok: true, hash: "abc1234", pushedTo: "origin/main" });
    expect(calls.slice(calls.indexOf("fetch --quiet"))).toEqual([
      "fetch --quiet",
      "rev-list --count HEAD..@{u}",
      "status --porcelain --untracked-files=no",
      "stash push --quiet -m claudegit: other changes during pull",
      "rebase --no-autostash @{u}",
      "stash pop --index --quiet",
      "push",
    ]);
  });

  it("when behind with a clean tree: rebases without stashing", async () => {
    const { run, calls } = fakeGit([HAS_UPSTREAM, HASH, BEHIND, ["status --porcelain", ok("")]]);
    expect((await commitPush(run, "R", spec("a.ts"), "msg")).ok).toBe(true);
    expect(calls.some((c) => c.startsWith("stash"))).toBe(false);
    expect(calls).toContain("rebase --no-autostash @{u}");
  });

  it("falls back to a plain pop (with a warning) when staged state can't be rebuilt", async () => {
    let statusCalls = 0;
    const base = fakeGit([HAS_UPSTREAM, HASH, BEHIND, ["stash pop --index", err("Conflicts in index. Try without --index.")]]);
    const run: GitRunner = async (repo, args) => {
      if (args.join(" ").startsWith("status --porcelain")) return ok(statusCalls++ === 0 ? " M other.ts\n" : "");
      return base.run(repo, args);
    };
    const r = await commitPush(run, "R", spec("a.ts"), "msg");
    expect(r).toMatchObject({ ok: true, warning: expect.stringMatching(/no longer staged/) });
    expect(base.calls).toContain("stash pop --quiet");
  });

  it("without an upstream, skips pull and publishes to origin", async () => {
    const { run, calls } = fakeGit([NO_UPSTREAM, HASH, ["remote", ok("origin\nupstream\n")], ["rev-parse --abbrev-ref HEAD", ok("feat/x\n")]]);
    const t = track();
    const r = await commitPush(run, "R", spec("a.ts"), "msg", t.onStep);
    expect(r).toEqual({ ok: true, hash: "abc1234", pushedTo: "origin/feat/x" });
    expect(calls).toContain("push -u origin HEAD");
    expect(calls.some((c) => c.startsWith("pull"))).toBe(false);
    expect(t.steps).toContainEqual(["pull", "skipped"]);
  });

  it("without any origin remote, stops after committing", async () => {
    const { run, calls } = fakeGit([NO_UPSTREAM, HASH, ["remote", ok("")]]);
    const t = track();
    expect(await commitPush(run, "R", spec("a.ts"), "msg", t.onStep)).toEqual({ ok: true, hash: "abc1234", pushedTo: null });
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    expect(t.steps.slice(-2)).toEqual([["pull", "skipped"], ["push", "skipped"]]);
  });

  it("reports an add failure and never commits", async () => {
    const { run, calls } = fakeGit([["add", err("fatal: pathspec 'x' did not match any files", 128)]]);
    const t = track();
    const r = await commitPush(run, "R", { add: ["x"], commit: ["x"] }, "msg", t.onStep);
    expect(r).toEqual({ ok: false, step: "add", message: "fatal: pathspec 'x' did not match any files", hash: null });
    expect(calls).toEqual(["add -- x"]);
    expect(t.steps.at(-1)).toEqual(["add", "failed"]);
  });

  it("reports a commit failure (e.g. a hook) with no hash", async () => {
    const { run } = fakeGit([["commit", err("pre-commit hook failed")]]);
    expect(await commitPush(run, "R", spec("a"), "msg")).toEqual({ ok: false, step: "commit", message: "pre-commit hook failed", hash: null });
  });

  it("aborts a conflicting rebase and keeps the commit local", async () => {
    const { run, calls } = fakeGit([
      HAS_UPSTREAM,
      HASH,
      BEHIND,
      DIRTY,
      ["rebase --no-autostash", err("CONFLICT (content): Merge conflict in a.ts")],
      ["rev-parse -q --verify REBASE_HEAD", ok("deadbeef\n")],
    ]);
    const t = track();
    const r = await commitPush(run, "R", spec("a.ts"), "msg", t.onStep);
    expect(r).toMatchObject({ ok: false, step: "pull", hash: "abc1234" });
    expect(!r.ok && r.message).toMatch(/conflict.*rebase was undone[\s\S]*abc1234\) is saved locally/i);
    expect(calls).toContain("rebase --abort");
    // The other changes come back after the abort.
    expect(calls.indexOf("stash pop --index --quiet")).toBeGreaterThan(calls.indexOf("rebase --abort"));
    expect(calls.some((c) => c === "push")).toBe(false);
    expect(t.steps.at(-1)).toEqual(["pull", "failed"]);
  });

  it("reports a fetch failure (e.g. auth) without touching the working tree", async () => {
    const { run, calls } = fakeGit([HAS_UPSTREAM, HASH, NO_REBASE, ["fetch", err("fatal: could not read Username: terminal prompts disabled", 128)]]);
    const r = await commitPush(run, "R", spec("a.ts"), "msg");
    expect(r).toMatchObject({ ok: false, step: "pull", hash: "abc1234" });
    expect(!r.ok && r.message).toMatch(/terminal prompts disabled[\s\S]*abc1234\) is saved locally/);
    expect(calls.some((c) => c.startsWith("stash") || c.startsWith("rebase"))).toBe(false);
  });

  it("reports a rejected push with the commit saved locally", async () => {
    const { run } = fakeGit([HAS_UPSTREAM, HASH, ["push", err("! [rejected] main -> main (fetch first)")]]);
    const r = await commitPush(run, "R", spec("a.ts"), "msg");
    expect(r).toMatchObject({ ok: false, step: "push", hash: "abc1234" });
    expect(!r.ok && r.message).toMatch(/rejected[\s\S]*saved locally/);
  });

  it("refuses empty selections, empty messages, and oversized pathspecs up front", async () => {
    const { run, calls } = fakeGit([]);
    expect(await commitPush(run, "R", spec(), "msg")).toMatchObject({ ok: false, step: "add" });
    expect(await commitPush(run, "R", spec("a"), "   ")).toMatchObject({ ok: false, step: "add" });
    const many = Array.from({ length: 2000 }, (_, i) => `some/fairly/long/directory/file-${i}.ts`);
    expect(many.join(" ").length).toBeGreaterThan(MAX_PATHSPEC_CHARS);
    expect(await commitPush(run, "R", spec(...many), "msg")).toMatchObject({ ok: false, step: "add" });
    expect(calls).toEqual([]);
  });
});
