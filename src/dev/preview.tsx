// Dev-only design preview: renders the real App in a plain browser with Tauri's IPC mocked
// by a scripted fake git. Open /preview.html?s=<scenario> on the Vite dev server.
// Scenarios: normal | claude | blocked | conflict | pushfail | clean | norepo
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import { initTheme } from "../theme";
import "../index.css";

const scenario = new URLSearchParams(location.search).get("s") ?? "normal";
const ROOT = "C:\\Users\\Saif\\Desktop\\currently_working\\ClaudeGit";
const H = "4bcfe98e640c8284511312660fb8709b0afa888e";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (stdout = "") => ({ code: 0, signal: null, stdout, stderr: "" });
const fail = (stderr: string, code = 1) => ({ code, signal: null, stdout: "", stderr });

let files = [
  `1 .M N... 100644 100644 100644 ${H} ${H} src/App.tsx`,
  `1 A. N... 000000 100644 100644 ${H} ${H} src/git/commitPush.ts`,
  `1 .M N... 100644 100644 100644 ${H} ${H} src/components/CommitBox.tsx`,
  `2 R. N... 100644 100644 100644 ${H} ${H} R100 src/components/StepProgress.tsx\0src/components/Steps.tsx`,
  `1 .D N... 100644 100644 000000 ${H} ${H} src/old/legacy.ts`,
  "? notes/todo.md",
];
if (scenario === "clean") files = [];
if (scenario === "blocked") files = [`u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} src/App.tsx`, ...files.slice(1)];
let rebasing = false;

async function fakeGit(args: string[]) {
  const cmd = args.join(" ");
  if (cmd.startsWith("rev-parse --show-toplevel")) return scenario === "norepo" ? fail("fatal: not a git repository", 128) : ok(ROOT.replace(/\\/g, "/") + "\n");
  if (cmd.startsWith("--no-optional-locks status")) {
    const head = ["# branch.oid " + H, "# branch.head main", "# branch.upstream origin/main", "# branch.ab +0 -0"];
    return ok([...head, ...files].join("\0") + "\0");
  }
  if (cmd === "rev-parse -q --verify MERGE_HEAD") return scenario === "blocked" ? ok(H) : fail("");
  if (cmd === "rev-parse -q --verify REBASE_HEAD") return rebasing ? ok(H) : fail("");
  if (cmd.startsWith("rev-parse -q --verify")) return fail("");
  if (cmd.startsWith("add") || cmd.startsWith("commit")) return sleep(500).then(() => ok());
  if (cmd === "rev-parse --short HEAD") return ok("3f9c2ab\n");
  if (cmd.startsWith("rev-parse --abbrev-ref --symbolic-full-name")) return ok("origin/main\n");
  if (cmd.startsWith("fetch")) return sleep(900).then(() => ok());
  if (cmd.startsWith("rev-list --count")) return ok(scenario === "conflict" ? "2\n" : "0\n");
  if (cmd.startsWith("status --porcelain")) return ok("");
  if (cmd.startsWith("rebase --no-autostash")) {
    await sleep(500);
    rebasing = scenario === "conflict";
    return rebasing ? fail("CONFLICT (content): Merge conflict in src/App.tsx") : ok();
  }
  if (cmd === "rebase --abort") return (rebasing = false), ok();
  if (cmd === "push") {
    await sleep(1200);
    if (scenario === "pushfail") return fail("To github.com:saif/claudegit.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs");
    files = files.filter((f) => !f.includes("src/App.tsx"));
    return ok();
  }
  return ok();
}

mockWindows("main");
mockIPC(
  async (cmd, payload) => {
    const p = payload as Record<string, unknown> | undefined;
    switch (cmd) {
      case "detect_claude_sessions":
        return scenario === "norepo"
          ? []
          : [{ cwd: ROOT, sessionId: "s1", lastActiveMs: Date.now() - (scenario === "claude" ? 15_000 : 20 * 60_000) }];
      case "plugin:shell|execute":
        return fakeGit((p!.args as string[]).slice(4)); // drop the -c global args
      case "plugin:store|load":
        return 1;
      case "plugin:store|get":
        return [scenario === "norepo" ? [] : [{ path: ROOT, name: "ClaudeGit" }], true];
      default:
        return null; // set_blur_hide, hide_window, store set/save, dialog…
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
