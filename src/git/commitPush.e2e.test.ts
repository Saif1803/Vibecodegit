/// <reference types="node" />
// End-to-end: real git against a local bare "remote", with a second clone as a teammate.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo, nodeGit, sh, tempDir, write } from "../test/nodeGit";
import { commitPush, pathspecFor } from "./commitPush";
import { getStatus } from "./status";

async function configure(dir: string) {
  await sh(dir, "config", "user.email", "test@example.com");
  await sh(dir, "config", "user.name", "Test");
  await sh(dir, "config", "core.autocrlf", "false");
  await sh(dir, "config", "commit.gpgsign", "false");
}

/** A bare remote seeded from a fresh repo, plus `me` and `teammate` clones tracking origin/main. */
async function setup(files: Record<string, string>) {
  const seed = await makeRepo(files);
  const remote = join(tempDir(), "remote.git");
  await sh(seed, "clone", "-q", "--bare", seed, remote);
  const clone = async () => {
    const dir = join(tempDir(), "clone");
    // Set before checkout: a global core.autocrlf=true would otherwise make every file look modified.
    await sh(tempDir(), "clone", "-q", "-c", "core.autocrlf=false", remote, dir);
    await configure(dir);
    return dir;
  };
  return { remote, me: await clone(), teammate: await clone() };
}

const remoteLog = async (remote: string, ref = "main") => (await sh(remote, "log", "--format=%s", ref)).trim().split("\n");
const read = (dir: string, rel: string) => readFileSync(join(dir, rel), "utf8");

/** Select files the way the UI does: by path, from a fresh status. */
async function commitSelected(repo: string, selected: string[], message: string) {
  const status = await getStatus(nodeGit, repo);
  return commitPush(nodeGit, repo, pathspecFor(status.files, new Set(selected)), message);
}

describe("commitPush against a real remote", () => {
  it("round-trips exactly the selected files and leaves everything else untouched", async () => {
    const { remote, me } = await setup({ "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n" });
    write(me, "a.ts", "a2\n"); // selected
    write(me, "b.ts", "b2\n"); // modified, not selected
    write(me, "c.ts", "c2\n");
    await sh(me, "add", "c.ts"); // staged, not selected
    write(me, "new.md", "n\n"); // untracked, not selected

    const r = await commitSelected(me, ["a.ts"], "update a");
    expect(r).toMatchObject({ ok: true, pushedTo: "origin/main" });

    expect(await remoteLog(remote)).toEqual(["update a", "init"]);
    expect((await sh(remote, "show", "--name-only", "--format=", "main")).trim()).toBe("a.ts");

    const after = await getStatus(nodeGit, me);
    expect(after.branch).toMatchObject({ ahead: 0, behind: 0 });
    expect(after.files).toEqual([
      { path: "b.ts", kind: "modified", staged: false },
      { path: "c.ts", kind: "modified", staged: true },
      { path: "new.md", kind: "untracked", staged: false },
    ]);
  });

  it("commits renames, deletions, and new files", async () => {
    const { remote, me } = await setup({ "old.ts": "o\n", "gone.ts": "g\n" });
    await sh(me, "mv", "old.ts", "moved.ts");
    rmSync(join(me, "gone.ts"));
    write(me, "dir with space/new ü.ts", "n\n");

    const r = await commitSelected(me, ["moved.ts", "gone.ts", "dir with space/new ü.ts"], "reshape");
    expect(r.ok).toBe(true);
    const tree = (await sh(remote, "ls-tree", "-r", "--name-only", "main")).trim().split("\n");
    expect(tree.sort()).toEqual(["dir with space/new ü.ts", "moved.ts"].sort());
    expect((await getStatus(nodeGit, me)).files).toEqual([]);
  });

  it("rebases onto a teammate's push, keeping unselected local edits (autostash)", async () => {
    const { remote, me, teammate } = await setup({ "mine.ts": "m\n", "theirs.ts": "t\n", "wip.ts": "w\n" });
    write(teammate, "theirs.ts", "t2\n");
    await sh(teammate, "commit", "-qam", "teammate change");
    await sh(teammate, "push", "-q");

    write(me, "mine.ts", "m2\n");
    write(me, "wip.ts", "w-local\n"); // unselected; would block a plain pull --rebase
    const r = await commitSelected(me, ["mine.ts"], "my change");

    expect(r).toMatchObject({ ok: true, pushedTo: "origin/main" });
    expect(await remoteLog(remote)).toEqual(["my change", "teammate change", "init"]);
    expect(read(me, "theirs.ts")).toBe("t2\n");
    expect(read(me, "wip.ts")).toBe("w-local\n");
  });

  it("keeps other staged files staged through a real rebase", async () => {
    const { remote, me, teammate } = await setup({ "mine.ts": "m\n", "theirs.ts": "t\n", "staged.ts": "s\n" });
    write(teammate, "theirs.ts", "t2\n");
    await sh(teammate, "commit", "-qam", "teammate change");
    await sh(teammate, "push", "-q");

    write(me, "mine.ts", "m2\n");
    write(me, "staged.ts", "s-staged\n");
    await sh(me, "add", "staged.ts");
    write(me, "staged.ts", "s-staged-then-edited\n"); // partially staged: index and worktree differ

    expect(await commitSelected(me, ["mine.ts"], "my change")).toMatchObject({ ok: true });
    expect(await remoteLog(remote)).toEqual(["my change", "teammate change", "init"]);
    expect((await getStatus(nodeGit, me)).files).toEqual([{ path: "staged.ts", kind: "modified", staged: true }]);
    expect((await sh(me, "show", ":staged.ts"))).toBe("s-staged\n");
    expect(read(me, "staged.ts")).toBe("s-staged-then-edited\n");
  });

  it("when unselected edits overlap what was pulled, pushes anyway and keeps a copy in the stash", async () => {
    const { remote, me, teammate } = await setup({ "mine.ts": "m\n", "shared.ts": "base\n" });
    write(teammate, "shared.ts", "theirs\n");
    await sh(teammate, "commit", "-qam", "teammate edit");
    await sh(teammate, "push", "-q");

    write(me, "mine.ts", "m2\n");
    write(me, "shared.ts", "my unfinished edit\n"); // not selected
    const r = await commitSelected(me, ["mine.ts"], "my change");

    expect(r).toMatchObject({ ok: true, pushedTo: "origin/main", warning: expect.stringMatching(/conflict/i) });
    expect(await remoteLog(remote)).toEqual(["my change", "teammate edit", "init"]);
    // Nothing lost: the unfinished edit is still in the stash.
    expect(await sh(me, "stash", "list")).toMatch(/claudegit: other changes during pull/);
    expect(await sh(me, "show", "stash@{0}:shared.ts")).toBe("my unfinished edit\n");
  });

  it("on a conflicting pull, undoes the rebase, keeps the commit local, restores unselected edits", async () => {
    const { remote, me, teammate } = await setup({ "shared.ts": "base\n", "wip.ts": "w\n" });
    write(teammate, "shared.ts", "theirs\n");
    await sh(teammate, "commit", "-qam", "teammate edit");
    await sh(teammate, "push", "-q");

    write(me, "shared.ts", "mine\n");
    write(me, "wip.ts", "w-local\n");
    const r = await commitSelected(me, ["shared.ts"], "my edit");

    expect(r).toMatchObject({ ok: false, step: "pull" });
    expect(!r.ok && r.hash).toMatch(/^[0-9a-f]{7,}$/);

    const s = await getStatus(nodeGit, me);
    expect(s.operation).toBeNull(); // not left mid-rebase
    expect(s.branch).toMatchObject({ head: "main" });
    expect((await sh(me, "log", "-1", "--format=%s")).trim()).toBe("my edit");
    expect(read(me, "shared.ts")).toBe("mine\n");
    expect(read(me, "wip.ts")).toBe("w-local\n");
    expect(await remoteLog(remote)).toEqual(["teammate edit", "init"]);
  });

  it("publishes a new branch with no upstream to origin", async () => {
    const { remote, me } = await setup({ "a.ts": "a\n" });
    await sh(me, "checkout", "-q", "-b", "feat/tray");
    write(me, "a.ts", "a2\n");

    const r = await commitSelected(me, ["a.ts"], "on a branch");
    expect(r).toMatchObject({ ok: true, pushedTo: "origin/feat/tray" });
    expect(await remoteLog(remote, "feat/tray")).toEqual(["on a branch", "init"]);
    expect((await getStatus(nodeGit, me)).branch.upstream).toBe("origin/feat/tray");
  });

  it("commits locally when there is no remote at all", async () => {
    const repo = await makeRepo({ "a.ts": "a\n" });
    write(repo, "a.ts", "a2\n");
    expect(await commitSelected(repo, ["a.ts"], "local only")).toMatchObject({ ok: true, pushedTo: null });
    expect((await sh(repo, "log", "-1", "--format=%s")).trim()).toBe("local only");
  });

  it("makes the very first commit of an empty repo and pushes it", async () => {
    const remote = join(tempDir(), "empty.git");
    await sh(tempDir(), "init", "-q", "--bare", "-b", "main", remote);
    const me = tempDir();
    await sh(me, "init", "-q", "-b", "main");
    await configure(me);
    await sh(me, "remote", "add", "origin", remote);
    write(me, "README.md", "hello\n");
    write(me, "later.md", "not yet\n");

    const r = await commitSelected(me, ["README.md"], "first");
    expect(r).toMatchObject({ ok: true, pushedTo: "origin/main" });
    expect(await remoteLog(remote)).toEqual(["first"]);
    expect((await getStatus(nodeGit, me)).files).toEqual([{ path: "later.md", kind: "untracked", staged: false }]);
  });
});
