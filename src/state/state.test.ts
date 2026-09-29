import { describe, expect, it } from "vitest";
import type { GitRunner } from "../git/runGit";
import type { FileChange } from "../git/types";
import { autoSelect, claudeRepos, isClaudeActive, type RawSession } from "./claudeSessions";
import { pushMru } from "./recentRepos";
import { reconcileSelection } from "./selection";

const A = "C:\\work\\a";
const B = "C:\\work\\b";
const C = "C:\\work\\c";

describe("pushMru", () => {
  const r = (path: string) => ({ path, name: path.slice(-1) });

  it("puts the repo first and dedupes case-insensitively", () => {
    expect(pushMru([r(A), r(B)], r("c:/WORK/b")).map((x) => x.path)).toEqual(["c:/WORK/b", A]);
  });

  it("caps the list", () => {
    const list = Array.from({ length: 8 }, (_, i) => r(`C:\\r${i}`));
    const next = pushMru(list, r(A));
    expect(next).toHaveLength(8);
    expect(next[0].path).toBe(A);
    expect(next.at(-1)!.path).toBe("C:\\r6");
  });
});

describe("autoSelect", () => {
  it("first open selects the repo Claude is newest in", () => {
    expect(autoSelect(null, A, null, B)).toEqual({ select: A, lastAuto: A });
  });

  it("a manual pick sticks while Claude stays in the same repo", () => {
    expect(autoSelect(B, A, A, C)).toEqual({ select: B, lastAuto: A });
  });

  it("switches again once Claude moves to a different repo", () => {
    expect(autoSelect(B, C, A, null)).toEqual({ select: C, lastAuto: C });
  });

  it("treats path spelling differences as the same repo", () => {
    expect(autoSelect(B, "c:/work/A", A, null)).toEqual({ select: B, lastAuto: A });
  });

  it("without Claude, keeps the current repo, else falls back to recent", () => {
    expect(autoSelect(B, null, A, C)).toEqual({ select: B, lastAuto: A });
    expect(autoSelect(null, null, null, C)).toEqual({ select: C, lastAuto: null });
    expect(autoSelect(null, null, null, null)).toEqual({ select: null, lastAuto: null });
  });
});

describe("claudeRepos", () => {
  // Fake git: folders under a/ and b/ are repos rooted there; anything else isn't.
  const run: GitRunner = async (cwd) => {
    const m = /^C:\\work\\([ab])(\\|$)/.exec(cwd);
    return m
      ? { code: 0, stdout: `C:/work/${m[1]}\n`, stderr: "" }
      : { code: 128, stdout: "", stderr: "fatal: not a git repository" };
  };
  const s = (cwd: string, lastActiveMs: number): RawSession => ({ cwd, sessionId: cwd, lastActiveMs });

  it("maps cwds to repo roots, merges sessions per repo, newest first", async () => {
    const out = await claudeRepos(run, [s(`${A}\\src`, 100), s(B, 300), s(A, 200), s("C:\\notes", 400)]);
    expect(out.repos).toEqual([
      { path: B, name: "b", lastActiveMs: 300 },
      { path: A, name: "a", lastActiveMs: 200 },
    ]);
    expect(out.nonRepos.map((x) => x.cwd)).toEqual(["C:\\notes"]);
  });

  it("flags Claude as active only within the window", () => {
    const repos = [{ path: A, name: "a", lastActiveMs: 1_000_000 }];
    expect(isClaudeActive(A, repos, 1_000_000 + 30_000)).toBe(true);
    expect(isClaudeActive(A, repos, 1_000_000 + 120_000)).toBe(false);
    expect(isClaudeActive(B, repos, 1_000_000)).toBe(false);
    expect(isClaudeActive(null, repos)).toBe(false);
  });
});

describe("reconcileSelection", () => {
  const f = (path: string, staged = false): FileChange => ({ path, kind: "modified", staged });

  it("a fresh repo starts from what's staged", () => {
    expect([...reconcileSelection(null, null, [f("a", true), f("b")])]).toEqual(["a"]);
  });

  it("keeps the user's choices for files still present and drops vanished ones", () => {
    const prevFiles = [f("a", true), f("b"), f("gone")];
    const prev = new Set(["b", "gone"]); // user unchecked a, checked b
    expect([...reconcileSelection(prev, prevFiles, [f("a", true), f("b")])]).toEqual(["b"]);
  });

  it("checks new files only if staged, and files that became staged since", () => {
    const prevFiles = [f("a"), f("b")];
    const next = reconcileSelection(new Set<string>(), prevFiles, [f("a", true), f("b"), f("new1", true), f("new2")]);
    expect([...next].sort()).toEqual(["a", "new1"]);
  });
});
