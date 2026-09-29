import { git, type GitRunner } from "./runGit";
import type { BranchInfo, ChangeKind, FileChange } from "./types";

export interface RepoStatus {
  branch: BranchInfo;
  files: FileChange[];
}

export const STATUS_ARGS = ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"];

export async function getStatus(run: GitRunner, repo: string): Promise<RepoStatus> {
  return parseStatus(await git(run, repo, STATUS_ARGS));
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
export function parseStatus(out: string): RepoStatus {
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
