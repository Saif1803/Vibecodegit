import { describe, expect, it } from "vitest";
import { parseStatus } from "./status";

const z = (...records: string[]) => records.join("\0") + "\0";
const H = "4bcfe98e640c8284511312660fb8709b0afa888e";

// Captured from a real repo (git 2.51) mid-merge with every kind of change.
const REAL = z(
  "# branch.oid ca29e51f4568727cffbf60d179dabfebe8a2582f",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +1 -0",
  `1 .M N... 100644 100644 100644 ${H} ${H} dir with space/café ü.txt`,
  `1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 ${H} src/added.ts`,
  `1 .D N... 100644 100644 000000 ${H} ${H} src/del.ts`,
  `1 .M N... 100644 100644 100644 ${H} ${H} src/mod.ts`,
  `2 R. N... 100644 100644 100644 ${H} ${H} R100 src/new.ts`,
  "src/old.ts",
  `1 MM N... 100644 100644 100644 ${H} ${H} staged_mod.ts`,
  `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} both.txt`,
  "? untracked.md",
);

describe("parseStatus", () => {
  it("parses branch, upstream, and ahead/behind", () => {
    expect(parseStatus(REAL).branch).toEqual({ head: "main", upstream: "origin/main", ahead: 1, behind: 0 });
  });

  it("parses every change kind, staged state, and paths with spaces/unicode", () => {
    expect(parseStatus(REAL).files).toEqual([
      { path: "dir with space/café ü.txt", kind: "modified", staged: false },
      { path: "src/added.ts", kind: "added", staged: true },
      { path: "src/del.ts", kind: "deleted", staged: false },
      { path: "src/mod.ts", kind: "modified", staged: false },
      { path: "src/new.ts", origPath: "src/old.ts", kind: "renamed", staged: true },
      { path: "staged_mod.ts", kind: "modified", staged: true },
      { path: "both.txt", kind: "conflicted", staged: false },
      { path: "untracked.md", kind: "untracked", staged: false },
    ]);
  });

  it("handles detached HEAD with no upstream", () => {
    const s = parseStatus(z("# branch.oid ca29e51f4568727cffbf60d179dabfebe8a2582f", "# branch.head (detached)"));
    expect(s.branch).toEqual({ head: null, upstream: null, ahead: 0, behind: 0 });
    expect(s.files).toEqual([]);
  });

  it("handles a fresh repo with no commits and no upstream", () => {
    const s = parseStatus(z("# branch.oid (initial)", "# branch.head main", "? README.md"));
    expect(s.branch).toEqual({ head: "main", upstream: null, ahead: 0, behind: 0 });
    expect(s.files).toEqual([{ path: "README.md", kind: "untracked", staged: false }]);
  });

  it("parses behind counts and branch names with slashes", () => {
    const s = parseStatus(z("# branch.head feat/x", "# branch.upstream origin/feat/x", "# branch.ab +0 -12"));
    expect(s.branch).toEqual({ head: "feat/x", upstream: "origin/feat/x", ahead: 0, behind: 12 });
  });

  it("treats staged deletions and intent-to-add as deleted/added", () => {
    const s = parseStatus(
      z(`1 D. N... 100644 000000 000000 ${H} ${H} gone.ts`, `1 .A N... 000000 000000 100644 ${H} ${H} ita.ts`),
    );
    expect(s.files.map((f) => [f.kind, f.staged])).toEqual([
      ["deleted", true],
      ["added", false],
    ]);
  });

  it("returns an empty status for empty output", () => {
    expect(parseStatus("")).toEqual({ branch: { head: null, upstream: null, ahead: 0, behind: 0 }, files: [] });
  });
});
