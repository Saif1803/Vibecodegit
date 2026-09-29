import { git, type GitRunner } from "./runGit";
import type { BranchInfo, ChangeKind, FileChange } from "./types";

export interface ParsedStatus {
  branch: BranchInfo;
  files: FileChange[];
}

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert";

export interface RepoStatus extends ParsedStatus {
  /** A multi-step git operation stopped midway (usually on conflicts). */
  operation: Operation | null;
}

export const STATUS_ARGS = ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"];

// Checked in this order; a stopped rebase can also leave other markers behind.
const OPERATION_REFS: [Operation, string][] = [
  ["rebase", "REBASE_HEAD"],
  ["merge", "MERGE_HEAD"],
  ["cherry-pick", "CHERRY_PICK_HEAD"],
  ["revert", "REVERT_HEAD"],
];

export async function inProgressOperation(run: GitRunner, repo: string): Promise<Operation | null> {
  const results = await Promise.all(OPERATION_REFS.map(([, ref]) => run(repo, ["rev-parse", "-q", "--verify", ref])));
  const i = results.findIndex((r) => r.code === 0);
  return i < 0 ? null : OPERATION_REFS[i][0];
}

export async function getStatus(run: GitRunner, repo: string): Promise<RepoStatus> {
  const [out, operation] = await Promise.all([git(run, repo, STATUS_ARGS), inProgressOperation(run, repo)]);
  return { ...parseStatus(out), operation };
}

/** Why Commit & Push can't run in this state, or null if it can. */
export function commitBlocker(status: RepoStatus): string | null {
  const conflicts = status.files.some((f) => f.kind === "conflicted");
  if (status.operation) {
    const op = status.operation[0].toUpperCase() + status.operation.slice(1);
    return `${op} in progress${conflicts ? " with conflicts" : ""}. Finish or abort it in your editor first.`;
  }
  if (conflicts) return "Resolve the conflicted files in your editor before committing.";
  if (status.branch.head === null) return "Detached HEAD. Check out a branch to commit and push.";
  return null;
}

/** Everything after the first `n` space-separated fields (paths may contain spaces). */
function afterFields(record: string, n: number): string {
  let i = 0;
  for (let k = 0; k < n; k++) i = record.indexOf(" ", i) + 1;
  return record.slice(i);
}

function kindOf(xy: string): ChangeKind {
  const [x, y] = xy;
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

/** Parses `git status --porcelain=v2 --branch -z` output. */
export function parseStatus(out: string): ParsedStatus {
  const branch: BranchInfo = { head: null, upstream: null, ahead: 0, behind: 0 };
  const files: FileChange[] = [];
  const records = out.split("\0");

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r === "") continue;

    if (r.startsWith("# ")) {
      const [key, ...rest] = r.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.head") branch.head = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          branch.ahead = Number(m[1]);
          branch.behind = Number(m[2]);
        }
      }
      continue;
    }

    const type = r[0];
    const xy = r.slice(2, 4);
    if (type === "1") {
      files.push({ path: afterFields(r, 8), kind: kindOf(xy), staged: xy[0] !== "." });
    } else if (type === "2") {
      // The original path is the next NUL-separated record.
      const origPath = records[++i];
      files.push({ path: afterFields(r, 9), origPath, kind: "renamed", staged: xy[0] !== "." });
    } else if (type === "u") {
      files.push({ path: afterFields(r, 10), kind: "conflicted", staged: false });
    } else if (type === "?") {
      files.push({ path: r.slice(2), kind: "untracked", staged: false });
    }
    // "!" (ignored) isn't requested; anything else is from a newer git and skipped.
  }
  return { branch, files };
}
