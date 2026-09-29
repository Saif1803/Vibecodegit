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
    head: "main",
    hasCommits: scenario !== "unborn",
    upstream: scenario === "unborn" ? null : "origin/main",
    ahead,
    behind,
  };
  const operation = scenario === "blocked" ? ("merge" as const) : null;
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

mockWindows("main");
mockIPC(
  async (cmd, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const files = (p.files ?? []) as FileChange[];
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
