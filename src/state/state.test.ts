import { describe, expect, it } from "vitest";
import { autoSelect, isClaudeActive } from "./claudeSessions";
import { pushMru } from "./recentRepos";

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

describe("isClaudeActive", () => {
  it("flags Claude as active only within the window", () => {
    const repos = [{ path: A, name: "a", lastActiveMs: 1_000_000 }];
    expect(isClaudeActive(A, repos, 1_000_000 + 30_000)).toBe(true);
    expect(isClaudeActive(A, repos, 1_000_000 + 120_000)).toBe(false);
    expect(isClaudeActive(B, repos, 1_000_000)).toBe(false);
    expect(isClaudeActive(null, repos)).toBe(false);
  });
});
