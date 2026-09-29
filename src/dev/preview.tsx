// Dev-only design preview: renders the real App in a plain browser with the Rust commands mocked
// by an in-memory fake repo. Open /preview.html?s=<scenario> on the Vite dev server.
// Scenarios: normal | claude | blocked | conflict | pushfail | clean | norepo | unborn | ahead
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import type { ChangeSide, CommitOptions, FileChange, FileDiff, RepoStatus, Step, StepState, SyncKind } from "../git/types";
import { initTheme } from "../theme";
import "../index.css";

const scenario = new URLSearchParams(location.search).get("s") ?? "normal";
const ROOT = "C:\\Users\\Saif\\Desktop\\currently_working\\ClaudeGit";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let staged: FileChange[] = [
  { path: "src/git/commitPush.ts", kind: "added" },
  { path: "src/components/StepProgress.tsx", origPath: "src/components/Steps.tsx", kind: "renamed" },
];
let unstaged: FileChange[] = [
  { path: "src/App.tsx", kind: "modified" },
  { path: "src/components/CommitBox.tsx", kind: "modified" },
  { path: "src/old/legacy.ts", kind: "deleted" },
  { path: "notes/todo.md", kind: "untracked" },
];
let conflicted: FileChange[] = [];
if (scenario === "clean") (staged = []), (unstaged = []);
if (scenario === "blocked") conflicted = [{ path: "src/App.tsx", kind: "conflicted" }];
let ahead = scenario === "ahead" ? 2 : 0;
const behind = scenario === "ahead" ? 1 : 0;

function status(): RepoStatus {
  const branch = {
    head: current,
    hasCommits: scenario !== "unborn",
    upstream: scenario === "unborn" ? null : `origin/${current}`,
    ahead,
    behind,
  };
  const operation = scenario === "blocked" && conflicted.length > 0 ? ("merge" as const) : null;
  const blocker = operation ? "Merge in progress with conflicts. Finish or abort it in your editor first." : null;
  return { branch, staged, unstaged, conflicted, operation, blocker };
}

const without = (list: FileChange[], files: FileChange[]) => list.filter((f) => !files.some((x) => x.path === f.path));
const addTo = (list: FileChange[], files: FileChange[]) => [...without(list, files), ...files];

function sampleDiff(file: FileChange, side: ChangeSide): FileDiff {
  if (file.kind === "untracked" || file.kind === "added") {
    const lines = ["# Todo", "", "- Stage hunks from the diff pane", "- Branch picker", "- Stash list"];
    return {
      binary: false,
      truncated: false,
      hunks: [
        {
          header: `@@ -0,0 +1,${lines.length} @@`,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: lines.length,
          lines: lines.map((text, i) => ({ kind: "add", text, old: null, new: i + 1 })),
        },
      ],
    };
  }
  if (file.kind === "renamed" && side === "staged") return { binary: false, truncated: false, hunks: [] };
  return {
    binary: false,
    truncated: false,
    hunks: [
      {
        header: "@@ -12,7 +12,8 @@ export default function App() {",
        oldStart: 12,
        oldLines: 7,
        newStart: 12,
        newLines: 8,
        lines: [
          { kind: "context", text: "  const visible = useWindowBehavior();", old: 12, new: 12 },
          { kind: "context", text: "  const { pref, cycle } = useTheme();", old: 13, new: 13 },
          { kind: "del", text: "  const [busy, setBusy] = useState(false);", old: 14, new: null },
          { kind: "add", text: "  const [busy, setBusy] = useState(false);", old: null, new: 14 },
          { kind: "add", text: "  const [committing, setCommitting] = useState(false);", old: null, new: 15 },
          { kind: "context", text: "  const s = useRepoState(visible, busy);", old: 15, new: 16 },
          { kind: "del", text: '  const [message, setMessage] = useState("");', old: 16, new: null },
          { kind: "add", text: '  const [message, setMessage] = useState<string>("");', old: null, new: 17 },
          { kind: "context", text: "  const [confirming, setConfirming] = useState(false);", old: 17, new: 18 },
        ],
      },
    ],
  };
}

async function commitPush(opts: CommitOptions, onStep: (step: Step, state: StepState) => void) {
  const step = async (s: Step, ms: number) => (onStep(s, "running"), await sleep(ms), onStep(s, "done"));
  if (opts.stageAll) await step("stage", 300), (staged = [...unstaged]), (unstaged = []);
  await step("commit", 500);
  staged = [];
  const hash = "3f9c2ab";
  if (!opts.push) return (ahead += 1), { ok: true, hash, pushedTo: null };
  if (opts.forcePush) onStep("pull", "skipped");
  else if (scenario === "conflict") {
    onStep("pull", "running");
    await sleep(900);
    onStep("pull", "failed");
    return {
      ok: false,
      step: "pull",
      hash,
      message: "Pulled changes conflict with your commits. The rebase was undone; pull and resolve in your editor.\nYour commit (3f9c2ab) is saved locally.",
    };
  } else await step("pull", 900);
  onStep("push", "running");
  await sleep(1200);
  if (scenario === "pushfail") {
    onStep("push", "failed");
    return {
      ok: false,
      step: "push",
      hash,
      message: "To github.com:saif/claudegit.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs\nYour commit (3f9c2ab) is saved locally.",
    };
  }
  onStep("push", "done");
  return { ok: true, hash, pushedTo: "origin/main" };
}

async function sync(kind: SyncKind) {
  await sleep(800);
  if (kind === "fetch") return { ok: true, message: "Fetched from all remotes." };
  if (kind === "pull") return { ok: true, message: behind ? "Pulled 1 commit." : "Already up to date." };
  ahead = 0;
  return { ok: true, message: kind === "sync" ? "Already up to date. Pushed to origin/main." : "Pushed to origin/main." };
}

const HOUR = 3_600_000;
let current = "main";
let branches = [
  { name: "main", remote: null, commit: "3f9c2ab", upstream: "origin/main", ahead: 0, behind: 0, gone: false, dateMs: Date.now() - HOUR, subject: "Commit & Push flow with step progress" },
  { name: "feature/branch-picker", remote: null, commit: "91be0c4", upstream: "origin/feature/branch-picker", ahead: 2, behind: 1, gone: false, dateMs: Date.now() - 3 * HOUR, subject: "Branch list with tracking badges" },
  { name: "spike/blame", remote: null, commit: "c01d2e3", upstream: null, ahead: 0, behind: 0, gone: false, dateMs: Date.now() - 50 * HOUR, subject: "Try git blame --porcelain" },
  { name: "fix/old-tray", remote: null, commit: "77aa001", upstream: "origin/fix/old-tray", ahead: 0, behind: 0, gone: true, dateMs: Date.now() - 200 * HOUR, subject: "Tray icon fix" },
  { name: "origin/main", remote: "origin", commit: "3f9c2ab", upstream: null, ahead: 0, behind: 0, gone: false, dateMs: Date.now() - HOUR, subject: "Commit & Push flow with step progress" },
  { name: "origin/feature/branch-picker", remote: "origin", commit: "5d4c3b2", upstream: null, ahead: 0, behind: 0, gone: false, dateMs: Date.now() - 2 * HOUR, subject: "Teammate: tweak spacing" },
];
let tags = [
  { name: "v0.2.0", commit: "3f9c2ab", annotated: true, subject: "Phase 6: Rust git layer", dateMs: Date.now() - 2 * HOUR },
  { name: "v0.1.0", commit: "b60d4de", annotated: false, subject: "Claude desktop app design system", dateMs: Date.now() - 400 * HOUR },
];
let stashes = [
  { index: 0, hash: "aaaa1111", dateMs: Date.now() - 20 * 60_000, message: "before trying the new placement math", branch: "main" },
  { index: 1, hash: "bbbb2222", dateMs: Date.now() - 30 * HOUR, message: "WIP on feature/branch-picker: 91be0c4 Branch list", branch: "feature/branch-picker" },
];
const reindex = () => (stashes = stashes.map((s, index) => ({ ...s, index })));

function branchCmd(cmd: string, p: Record<string, unknown>) {
  switch (cmd) {
    case "list_branches":
      return branches.map((b) => ({ ...b, current: b.name === current }));
    case "list_remotes":
      return [{ name: "origin", fetchUrl: "https://github.com/saif/claudegit.git", pushUrl: "https://github.com/saif/claudegit.git" }];
    case "create_branch":
      branches = [{ ...branches[0], name: p.name as string, upstream: null, dateMs: Date.now() }, ...branches];
      if (p.switchTo) current = p.name as string;
      return null;
    case "switch_branch":
      current = p.name as string;
      return null;
    case "checkout_remote_branch":
      current = (p.name as string).split("/").slice(1).join("/");
      return current;
    case "rename_branch":
      branches = branches.map((b) => (b.name === p.old ? { ...b, name: p.new as string } : b));
      if (current === p.old) current = p.new as string;
      return null;
    case "delete_branch":
      if (!p.force && p.name === "spike/blame") throw "error: the branch 'spike/blame' is not fully merged.";
      branches = branches.filter((b) => b.name !== p.name);
      return null;
    case "merge_branch":
      return { ok: true, message: `Merged ${p.name}.` };
    case "rebase_onto":
      return { ok: false, message: `Rebasing onto ${p.onto} conflicts with your commits. The rebase was undone.` };
    case "list_tags":
      return tags;
    case "create_tag":
      tags = [{ name: p.name as string, commit: "3f9c2ab", annotated: !!p.message, subject: (p.message as string) || "Commit & Push flow", dateMs: Date.now() }, ...tags];
      return null;
    case "delete_tag":
      tags = tags.filter((t) => t.name !== p.name);
      return null;
    case "list_stashes":
      return stashes;
    case "stash_push":
      if (staged.length + unstaged.length === 0) throw "No local changes to stash.";
      stashes = [{ index: 0, hash: `s${Date.now()}`, dateMs: Date.now(), message: (p.message as string) || "WIP on main: 3f9c2ab Commit & Push flow", branch: "main" }, ...stashes];
      reindex();
      if (p.mode === "staged") staged = [];
      else (staged = []), (unstaged = p.mode === "tracked" ? unstaged.filter((f) => f.kind === "untracked") : []);
      return null;
    case "stash_apply":
      if (p.pop) (stashes = stashes.filter((s) => s.hash !== p.hash)), reindex();
      return { ok: true, message: `${p.pop ? "Popped" : "Applied"} stash@{${p.index}}.` };
    case "stash_drop":
      stashes = stashes.filter((s) => s.hash !== p.hash);
      reindex();
      return null;
    case "stash_clear":
      stashes = [];
      return null;
    case "stash_files":
      return [
        { path: "src-tauri/src/placement.rs", kind: "modified" },
        { path: "notes/placement-ideas.md", kind: "untracked" },
      ];
    case "stash_file_diff":
      return sampleDiff(p.file as FileChange, "unstaged");
    case "abort_operation":
      conflicted = [];
      return null;
    default:
      return undefined;
  }
}

mockWindows("main");
mockIPC(
  async (cmd, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const files = (p.files ?? []) as FileChange[];
    const other = branchCmd(cmd, p);
    if (other !== undefined) return other;
    switch (cmd) {
      case "claude_repos":
        return scenario === "norepo"
          ? { repos: [], nonRepos: [], newestSessionId: null }
          : {
              repos: [{ path: ROOT, name: "ClaudeGit", lastActiveMs: Date.now() - (scenario === "claude" ? 15_000 : 20 * 60_000) }],
              nonRepos: [],
              newestSessionId: "s1",
            };
      case "resolve_repo":
        return scenario === "norepo"
          ? { ok: false, reason: "not-a-repo", message: `Not a git repository: ${p.folder}` }
          : { ok: true, repo: { path: ROOT, name: "ClaudeGit" } };
      case "git_status":
        return status();
      case "stage":
        staged = addTo(staged, files.map((f) => (f.kind === "untracked" ? { ...f, kind: "added" } : f)));
        unstaged = without(unstaged, files);
        conflicted = without(conflicted, files);
        return null;
      case "stage_all":
        staged = addTo(staged, unstaged);
        unstaged = [];
        return null;
      case "unstage":
      case "unstage_all": {
        const moving = cmd === "unstage_all" ? staged : files;
        staged = without(staged, moving);
        unstaged = addTo(unstaged, moving.map((f) => (f.kind === "added" ? { path: f.path, kind: "untracked" } : { path: f.path, kind: f.kind })));
        return null;
      }
      case "discard":
        unstaged = without(unstaged, files);
        return null;
      case "file_diff":
        await sleep(150);
        return sampleDiff(p.file as FileChange, p.side as ChangeSide);
      case "is_head_published":
        return ahead === 0;
      case "commit_push": {
        const ch = p.onStep as { onmessage: (m: { step: Step; state: StepState }) => void };
        return commitPush(p.opts as CommitOptions, (step, state) => ch.onmessage({ step, state }));
      }
      case "sync":
        return sync(p.kind as SyncKind);
      case "plugin:store|load":
        return 1;
      case "plugin:store|get":
        return [scenario === "norepo" ? [] : [{ path: ROOT, name: "ClaudeGit" }], true];
      default:
        return null; // set_blur_hide, set_expanded, hide_window, store set/save, dialog…
    }
  },
  { shouldMockEvents: true },
);

initTheme();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
// The popup only loads and focuses once it's "shown".
setTimeout(() => void emit("window-shown"), 100);
