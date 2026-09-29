/// <reference types="node" />
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo, nodeGit, sh, tempDir, write } from "../test/nodeGit";
import { normalizePath, repoName, resolveRepo, samePath } from "./repo";
import { getStatus } from "./status";

describe("path helpers", () => {
  it("normalizes Windows paths from git's forward-slash form", () => {
    expect(normalizePath("C:/Users/me/proj")).toBe("C:\\Users\\me\\proj");
    expect(normalizePath("C:\\Users\\me\\proj\\")).toBe("C:\\Users\\me\\proj");
    expect(normalizePath("C:\\")).toBe("C:\\");
    expect(normalizePath("/home/me/proj/")).toBe("/home/me/proj");
  });

  it("compares Windows paths case-insensitively", () => {
    expect(samePath("C:/Users/Me/Proj", "c:\\users\\me\\proj\\")).toBe(true);
    expect(samePath("/a/B", "/a/b")).toBe(false);
  });

  it("names a repo after its last segment", () => {
    expect(repoName("C:\\Users\\me\\ClaudeGit")).toBe("ClaudeGit");
    expect(repoName("C:/x/y/")).toBe("y");
  });
});

describe("resolveRepo (live git)", () => {
  it("resolves a subfolder to the repo root", async () => {
    const repo = await makeRepo({ "src/deep/a.ts": "a\n" });
    const r = await resolveRepo(nodeGit, join(repo, "src", "deep"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(samePath(r.repo.path, repo)).toBe(true);
      expect(r.repo.path).not.toContain("/");
    }
  });

  it("reports a plain folder as not-a-repo", async () => {
    const r = await resolveRepo(nodeGit, tempDir());
    expect(r).toMatchObject({ ok: false, reason: "not-a-repo" });
  });

  it("reports a deleted folder as missing", async () => {
    const dir = tempDir();
    rmSync(dir, { recursive: true });
    const r = await resolveRepo(nodeGit, dir);
    expect(r).toMatchObject({ ok: false, reason: "missing" });
  });
});

describe("getStatus (live git)", () => {
  it("reports real changes the way the UI expects", async () => {
    const repo = await makeRepo({ "mod.ts": "a\n", "del.ts": "b\n", "old.ts": "c\n", "dir with space/ü.txt": "d\n" });
    write(repo, "mod.ts", "a2\n");
    rmSync(join(repo, "del.ts"));
    await sh(repo, "mv", "old.ts", "new.ts");
    write(repo, "added.ts", "e\n");
    await sh(repo, "add", "added.ts");
    write(repo, "dir with space/ü.txt", "d2\n");
    write(repo, "untracked/file.md", "u\n");

    const s = await getStatus(nodeGit, repo);
    expect(s.branch).toEqual({ head: "main", upstream: null, ahead: 0, behind: 0 });
    const byPath = Object.fromEntries(s.files.map((f) => [f.path, f]));
    expect(byPath["mod.ts"]).toMatchObject({ kind: "modified", staged: false });
    expect(byPath["del.ts"]).toMatchObject({ kind: "deleted", staged: false });
    expect(byPath["new.ts"]).toMatchObject({ kind: "renamed", origPath: "old.ts", staged: true });
    expect(byPath["added.ts"]).toMatchObject({ kind: "added", staged: true });
    expect(byPath["dir with space/ü.txt"]).toMatchObject({ kind: "modified" });
    expect(byPath["untracked/file.md"]).toMatchObject({ kind: "untracked" });
    expect(s.files).toHaveLength(6);
  });
});
