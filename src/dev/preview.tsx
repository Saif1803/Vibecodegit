// Dev-only design preview: renders the real App in a plain browser with the Rust commands mocked
// by an in-memory fake repo. Open /preview.html?s=<scenario> on the Vite dev server.
// Scenarios: normal | history | branches | tags | stashes | clean | blocked | conflict | pushfail | norepo | unborn | ahead | secrets | icons | empty_history | empty_branches | empty_tags | empty_stashes
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import type { ChangeSide, CommitOptions, FileChange, FileDiff, GraphRow, RefLabel, RepoStatus, Step, StepState, SyncKind } from "../git/types";
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
if (scenario === "secrets") unstaged = [...unstaged, { path: ".env", kind: "untracked" }];
// A spread of vscode-icons file-type icons (src/components/fileIcons.tsx), some with light-theme variants.
if (scenario === "icons")
  unstaged = [
    "a.ts", "a.tsx", "a.d.ts", "a.test.ts", "a.js", "a.jsx", "a.json", "a.css", "a.scss", "a.html", "a.md",
    "CLAUDE.md", "a.rs", "a.py", "a.go", "a.rb", "a.java", "a.kt", "a.c", "a.cpp", "a.cs", "a.php", "a.vue",
    "a.svelte", "a.sh", "a.ps1", "a.yml", "a.toml", "a.png", "a.svg", "a.txt", "a.pdf", "a.zip", "a.sql",
    "a.woff2", "a.csv", "a.log", "package.json", "yarn.lock", "Cargo.toml", "tsconfig.json", "vite.config.ts",
    "tauri.conf.json", "Dockerfile", ".gitignore", ".env", "Makefile", "LICENSE", "README",
  ].map((path) => ({ path, kind: "modified" }));
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
if (scenario === "empty_branches") branches = [];
if (scenario === "empty_tags") tags = [];
if (scenario === "empty_stashes") stashes = [];
const reindex = () => (stashes = stashes.map((s, index) => ({ ...s, index })));
let mockShortcut = "Ctrl+Shift+G";

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

// ---- History (the lane layout is a dev-only port of git/history.rs `layout`) ----
type MockCommit = {
  hash: string;
  subject: string;
  parents: string[];
  author: string;
  hoursAgo: number;
  refs?: RefLabel[];
  incoming?: boolean;
  outgoing?: boolean;
};
const h = (n: string) => n.padEnd(40, "0");
const OLDER = ["Commit & Push flow with step progress", "UI states and banners", "Claude session detection", "Tray placement math", "Scaffold Tauri app"];
const MOCK_COMMITS: MockCommit[] = [
  { hash: h("0a1b2c3"), subject: "History tab with lane graph", parents: [h("9f8e7d6")], author: "Saif", hoursAgo: 0.3, refs: [{ name: "main", kind: "head" }], outgoing: true },
  { hash: h("1c2d3e4"), subject: "Teammate: fix tray flicker on wake", parents: [h("9f8e7d6")], author: "Dana", hoursAgo: 1, refs: [{ name: "origin/main", kind: "remote" }], incoming: true },
  { hash: h("9f8e7d6"), subject: "Merge branch 'feature/branch-picker'", parents: [h("8e7d6c5"), h("7d6c5b4")], author: "Saif", hoursAgo: 3 },
  { hash: h("7d6c5b4"), subject: "Branch list with tracking badges", parents: [h("6c5b4a3")], author: "Saif", hoursAgo: 5, refs: [{ name: "feature/branch-picker", kind: "branch" }] },
  { hash: h("8e7d6c5"), subject: "Stash list and detail pane", parents: [h("5b4a392")], author: "Saif", hoursAgo: 6 },
  { hash: h("6c5b4a3"), subject: "Branch picker skeleton", parents: [h("5b4a392")], author: "Dana", hoursAgo: 8 },
  { hash: h("5b4a392"), subject: "Phase 6: Rust git layer", parents: [h("4a39200")], author: "Saif", hoursAgo: 30, refs: [{ name: "v0.2.0", kind: "tag" }] },
  ...Array.from({ length: 14 }, (_, i) => ({
    hash: h(`4a392${i.toString(16).padStart(2, "0")}`),
    subject: OLDER[i % 5] + (i >= 5 ? ` (${i})` : ""),
    parents: i === 13 ? [] : [h(`4a392${(i + 1).toString(16).padStart(2, "0")}`)],
    author: i % 3 ? "Saif" : "Dana",
    hoursAgo: 48 + i * 20,
    refs: i === 13 ? [{ name: "v0.1.0", kind: "tag" as const }] : undefined,
  })),
];

function mockLayout(list: MockCommit[]): GraphRow[] {
  const lanes: ([string, number] | null)[] = [];
  let next = 0;
  const free = () => {
    const i = lanes.indexOf(null);
    return i >= 0 ? i : lanes.push(null) - 1;
  };
  return list.map((c) => {
    const waiting = lanes.flatMap((l, i) => (l?.[0] === c.hash ? [i] : []));
    const [col, color] = waiting.length ? [waiting[0], lanes[waiting[0]]![1]] : [free(), next++];
    const up = waiting.map((i) => ({ col: i, color: lanes[i]![1] }));
    const through = lanes.flatMap((l, i) => (l && !waiting.includes(i) ? [{ col: i, color: l[1] }] : []));
    waiting.forEach((i) => (lanes[i] = null));
    const down = c.parents.map((p, n) => {
      const k = lanes.findIndex((l) => l?.[0] === p);
      if (k >= 0) return { col: k, color: lanes[k]![1] };
      const [slot, co] = n === 0 ? [col, color] : [free(), next++];
      lanes[slot] = [p, co];
      return { col: slot, color: co };
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    return { col, color, through, up, down };
  });
}

function mockHistory(limit: number) {
  const all = scenario === "empty_history" ? [] : MOCK_COMMITS;
  const list = all.slice(0, limit);
  const rows = mockLayout(list);
  return {
    commits: list.map((c, i) => ({
      hash: c.hash,
      short: c.hash.slice(0, 7),
      parents: c.parents,
      author: c.author,
      dateMs: Date.now() - c.hoursAgo * HOUR,
      subject: c.subject,
      refs: c.refs ?? [],
      isHead: i === 0,
      incoming: !!c.incoming,
      outgoing: !!c.outgoing,
      graph: rows[i],
    })),
    more: all.length > limit,
    upstream: "origin/main",
  };
}

const COMMIT_FILES: FileChange[] = [
  { path: "src/components/HistoryPanel.tsx", kind: "added" },
  { path: "src/components/CommitGraph.tsx", kind: "added" },
  { path: "src/App.tsx", kind: "modified" },
  { path: "src/components/Tabs.tsx", kind: "modified" },
  { path: "src/components/StashView.tsx", origPath: "src/components/StashPane.tsx", kind: "renamed" },
];

const BLAME_TEXT = [
  'import { useState } from "react";',
  "",
  "export default function App() {",
  "  const visible = useWindowBehavior();",
  "  const { pref, cycle } = useTheme();",
  "  const [busy, setBusy] = useState(false);",
  "  const [committing, setCommitting] = useState(false);",
  "  const s = useRepoState(visible, busy);",
  '  const [tab, setTab] = useState<TabId>("history");',
  "  return <main />;",
  "}",
];

function historyCmd(cmd: string, p: Record<string, unknown>) {
  const find = (hash: unknown) => MOCK_COMMITS.find((c) => c.hash === hash) ?? MOCK_COMMITS[0];
  const short = (hash: unknown) => (hash as string).slice(0, 7);
  switch (cmd) {
    case "history":
      return mockHistory(p.limit as number);
    case "commit_detail": {
      const c = find(p.hash);
      return {
        hash: c.hash,
        short: short(c.hash),
        parents: c.parents,
        author: c.author,
        email: `${c.author.toLowerCase()}@example.com`,
        dateMs: Date.now() - c.hoursAgo * HOUR,
        committer: c.author,
        commitDateMs: Date.now() - c.hoursAgo * HOUR,
        message: `${c.subject}\n\nLanes are laid out in Rust from --date-order, so the UI only draws them.\nPaged 200 at a time.`,
        refs: c.refs ?? [],
        base: c.parents[0] ?? h("4b825dc"),
        files: COMMIT_FILES,
      };
    }
    case "compare_files":
      return p.target ? COMMIT_FILES : COMMIT_FILES.slice(2);
    case "compare_file_diff":
      return sampleDiff(p.file as FileChange, "staged");
    case "revert_commit":
      return { ok: true, message: `Reverted ${short(p.hash)} with a new commit.` };
    case "cherry_pick":
      return {
        ok: false,
        message: `Cherry-picking ${short(p.hash)} stopped on conflicts. Resolve them in your editor and stage the files, or abort the cherry-pick.`,
      };
    case "reset_impact":
      return 2;
    case "reset_to":
      return { ok: true, message: `Reset ${current} to ${short(p.hash)}.${p.mode === "soft" ? " Changes from the undone commits are staged." : ""}` };
    case "file_timeline":
      return MOCK_COMMITS.slice(0, 8)
        .filter((c) => !c.incoming && c.parents.length < 2)
        .map((c, i, arr) => ({
          hash: c.hash,
          short: short(c.hash),
          author: c.author,
          dateMs: Date.now() - c.hoursAgo * HOUR,
          subject: c.subject,
          base: c.parents[0] ?? h("4b825dc"),
          file: { path: p.path as string, kind: i === arr.length - 1 ? "added" : "modified" },
        }));
    case "blame_file": {
      const owner = [2, 2, 2, 1, 1, 0, 0, 1, 3, 2, 2];
      const commits = [0, 4, 6].map((i) => MOCK_COMMITS[i]);
      return {
        commits: [
          ...commits.map((c) => ({ hash: c.hash, short: short(c.hash), author: c.author, dateMs: Date.now() - c.hoursAgo * HOUR, summary: c.subject, uncommitted: false })),
          { hash: "0".repeat(40), short: "0000000", author: "Not Committed Yet", dateMs: Date.now(), summary: "", uncommitted: true },
        ],
        lines: BLAME_TEXT.map((text, i) => ({ commit: owner[i], line: i + 1, text })),
        truncated: false,
      };
    }
    default:
      return undefined;
  }
}

// ---- The Claude Code loop ----
const MINUTE = 60_000;
function loopCmd(cmd: string, p: Record<string, unknown>) {
  switch (cmd) {
    case "apply_hunk": {
      const file = p.file as FileChange;
      if (p.action === "stage") staged = addTo(staged, [file]);
      if (p.action === "unstage") unstaged = addTo(unstaged, [file]);
      return null;
    }
    case "check_secrets": {
      const everything = p.stageAll ? [...staged, ...unstaged] : staged;
      const findings = [];
      if (everything.some((f) => f.path === ".env")) findings.push({ path: ".env", line: null, what: "Environment file", preview: "" });
      if (scenario === "secrets")
        findings.push({ path: "src/App.tsx", line: 42, what: "Anthropic API key", preview: "sk-ant… (108 chars)" });
      return findings;
    }
    case "undo_last_commit":
      staged = addTo(staged, [{ path: "src/components/HistoryPanel.tsx", kind: "added" }]);
      return "Add the history tab\n\nLanes are laid out in Rust.";
    case "add_to_gitignore":
      unstaged = unstaged.filter((f) => f.path !== p.path);
      return null;
    case "claude_prompts":
      return scenario === "norepo" || scenario === "clean"
        ? []
        : [
            { text: "can you make the tray icon stop flickering when the laptop wakes up?", atMs: Date.now() - 4 * MINUTE },
            { text: "add a dark mode toggle to the header\nit should follow the OS by default", atMs: Date.now() - 25 * MINUTE },
            { text: "please split App.tsx into smaller components", atMs: Date.now() - 70 * MINUTE },
          ];
    case "list_worktrees":
      return [
        { path: ROOT, branch: current, head: "3f9c2ab", main: true, current: true, locked: false, prunable: false },
        { path: `${ROOT}-dark-mode`, branch: "feature/dark-mode", head: "91be0c4", main: false, current: false, locked: false, prunable: false },
      ];
    case "add_worktree":
      return { path: `${ROOT}-${String(p.branch).replace(/\//g, "-")}`, name: `ClaudeGit-${String(p.branch).replace(/\//g, "-")}` };
    case "remove_worktree":
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
    const other = branchCmd(cmd, p) ?? historyCmd(cmd, p) ?? loopCmd(cmd, p);
    if (other !== undefined) return other;
    switch (cmd) {
      case "agent_repos":
        return scenario === "norepo"
          ? { repos: [], nonRepos: [], newestSessionId: null }
          : {
              repos: [{ path: ROOT, name: "ClaudeGit", agents: [{ name: scenario === "claude" ? "Claude Code" : "Codex", lastActiveMs: Date.now() - (scenario === "claude" ? 15_000 : 20 * 60_000) }], lastActiveMs: Date.now() - (scenario === "claude" ? 15_000 : 20 * 60_000) }],
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
      case "get_shortcut":
        return mockShortcut;
      case "set_shortcut":
        mockShortcut = p.shortcut as string;
        return null;
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

const TAB_SCENARIOS: Record<string, "changes" | "history" | "branches" | "tags" | "stashes"> = {
  history: "history",
  empty_history: "history",
  branches: "branches",
  empty_branches: "branches",
  tags: "tags",
  empty_tags: "tags",
  stashes: "stashes",
  empty_stashes: "stashes",
};
const initialTab = TAB_SCENARIOS[scenario] ?? "changes";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App initialTab={initialTab} />
  </React.StrictMode>,
);
// The popup only loads and focuses once it's "shown".
setTimeout(() => void emit("window-shown"), 100);
