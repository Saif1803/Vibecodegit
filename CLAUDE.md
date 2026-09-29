# ClaudeGit: tray commit utility

A tiny Windows-first system-tray app for quick "stage → commit → pull --rebase → push" without opening an IDE or terminal.

## Stack

- **Tauri 2** (Rust shell), **React 19 + TypeScript** (Vite 8), **Tailwind CSS v4** (`@tailwindcss/vite`), **Vitest**
- Tauri plugins:
  - `tauri-plugin-shell` runs the **system `git`**. It is the only external program allowed.
  - `tauri-plugin-global-shortcut` registers the Ctrl+Shift+G toggle.
  - `tauri-plugin-dialog` provides the native folder picker.
  - `tauri-plugin-store` persists recent repos.
  - `tauri-plugin-single-instance` stops a second launch from creating a second tray icon.
- Tray icon: Tauri core `tray-icon` feature (`TrayIconBuilder`)

## Spec

### Tray and window
- The app lives only in the system tray. It has no taskbar entry (`skipTaskbar: true`) and the window starts hidden.
- Tray **left-click** toggles the window. The tray **menu** has Show and Quit.
- **Ctrl+Shift+G** (global) toggles the window: show and focus it if hidden, hide it if visible.
- The window is borderless (`decorations: false`), about **380×500**, not resizable, always on top, and sits near the tray.
  - Placement is custom (`src-tauri/src/placement.rs`, pure and unit-tested). It uses `TrayIcon::rect()`, which works without a prior click, and the monitor work area. The taskbar edge is inferred from where the tray icon sits, and the result is clamped on-screen.
  - With no tray rect, the window falls back to the bottom-right of the work area.
  - With an **auto-hide taskbar**, Windows reports the full monitor as the work area. The taskbar rect (`SHAppBarMessage`, `src-tauri/src/taskbar.rs`) is subtracted, so the window never sits under the taskbar when it slides up.
- **Hide on blur** and **hide on Esc**.
  - Blur-hide is suppressed while the native folder dialog is open, because the dialog steals focus. The frontend calls the Rust command `set_blur_hide(enabled)`.
  - **Tray-click focus quirks (Windows):**
    - Explorer re-activates the taskbar right after a tray click. A blur within 500 ms of showing therefore re-focuses the window once, instead of hiding it.
    - A tray click within 400 ms of a blur-hide is the click that caused that blur, so it leaves the window hidden.
  - Alt+F4 hides the window instead of closing it. Only the tray menu's Quit exits the app.
  - On every show, Rust emits a `window-shown` event to the webview (used for refresh-on-show).
- Status is refreshed every time the window is shown.

### Auto-detect the Claude Code working folder
- **Source:** every Claude Code session (CLI, desktop app, IDE) appends to `~/.claude/projects/<encoded>/<session-id>.jsonl`. Use `$CLAUDE_CONFIG_DIR/projects` if that env var is set.
  - Most entries carry a `cwd` field with the exact working directory.
  - Never decode the `<encoded>` folder name. It is lossy (`\`, `:`, `_` all become `-`).
- **Detection (Rust command `detect_claude_sessions`):**
  1. Find the `*.jsonl` files modified in the last 24 h, newest first.
  2. For each, read **backward from the end in chunks** until a line with a `cwd` is found. Lines can be huge, and some types (for example `file-history-snapshot`) have no `cwd`.
  3. Return `{ cwd, sessionId, lastActiveMs }`, deduplicated by `cwd` and keeping the newest.
  - Read-only. No `fs` plugin permission is needed, because the command runs in Rust.
- **Normalization (TS):** each `cwd` goes through `git rev-parse --show-toplevel`.
  - A subfolder resolves to its repo root. Worktrees resolve to the worktree, which is correct.
  - A `cwd` that isn't a git repo shows as "Claude is in <folder>, not a git repo" and is not selectable.
- **On every window show:**
  - Re-run detection and auto-select the repo of the **most recently active** session.
  - Exception: if that repo is the same one auto-selected last time, keep whatever the user has chosen since. A manual pick sticks until Claude moves to a different folder.
- **"Claude is working" indicator:** if the selected repo's session log was written in the last **90 s**, show a pulsing badge next to the branch ("Claude is building here").
  - Commit & Push then asks for a one-click confirmation ("Claude is still editing. Commit anyway?"), so a half-finished edit isn't pushed by accident.
  - The badge updates while the window is open by polling detection every 5 s, only while visible.

### Window contents (top → bottom)
1. **Repo selector**: a dropdown with two groups.
   - **Active in Claude Code:** detected sessions from the last 24 h, newest first, with a relative time such as "2 min ago".
   - **Recent:** repos you picked or committed to, most recent first, max 8, persisted.
   - A "Browse…" folder-picker button sits next to the dropdown.
   - A picked folder is validated with `git rev-parse --show-toplevel` and normalized to the repo root.
   - Invalid folders show an inline error and are not saved.
   - Repos that no longer exist are dropped from the list, with a notice.
2. **Current branch** with ahead/behind counts against upstream (or "no upstream"). Detached HEAD is shown as such.
3. **Changed files list**: a checkbox per file, a status badge (M/A/D/R/?/U), and the path.
   - A select-all checkbox sits in the header.
   - Scrolls if long. Shows an empty state ("Working tree clean").
4. **Commit message** textarea. **Ctrl+Enter** triggers Commit & Push.
5. **"Commit & Push"** button.
   - Disabled when no files are checked, the message is empty, or an operation is running.
   - Shows step progress: `add → commit → pull → push`.
   - On success: clear the message and refresh. On failure: show which step failed with git's stderr, and keep the message.

### Design: match the Claude desktop app
- **Look:** the Claude desktop app's visual language.
  - Warm neutral surfaces, hairline borders, 8–16 px radii, and the Claude clay accent `#D97757`.
  - Line icons at 1.4 px stroke, inline SVG in `src/components/icons.tsx`. No icon library and no Anthropic logos.
- **Themes:** light and dark are both first-class.
  - The default follows the OS (`prefers-color-scheme`, live). A header button cycles System → Light → Dark, persisted in `localStorage`.
  - `src/theme.ts` sets `<html data-theme>`.
- **Tokens:** CSS variables in `src/index.css`, exposed to Tailwind via `@theme inline`.
  - Classes: `bg-bg`, `bg-surface`, `bg-raised`, `bg-chip`, `bg-hover`, `border-line`, `border-line-strong`, `text-fg`, `text-fg-2`, `text-fg-3`, `bg-accent`, `text-accent-text`, `text-st-*`.
  - Never hard-code hex values in components.
  - Dark values were sampled from the app: bg `#151515`, surface `#1A1A19`, raised `#20201F`, chip `#2D2D2D`, line `#2A2A2A`, fg `#F0EFEC` / `#C3C2B7` / `#898781`.
  - Light values use Claude's ivory palette: bg `#FAF9F5`, fg `#141413`.
- **Type:** Segoe UI Variable. Claude's own fonts are proprietary and aren't bundled. 13 px body, 11–12 px secondary, Cascadia Mono for status letters.
- **Patterns:**
  - Commit box: styled like Claude's prompt box. Rounded-2xl raised surface, with the textarea above an action row.
  - Primary button: accent fill. When disabled, it becomes a neutral chip, not a faded accent.
  - Menus: raised surface, border, shadow, rounded-xl, rounded-lg hover rows.
  - Checkboxes: custom, accent when checked.
- **Global CSS:** base rules go in `@layer base`. Unlayered rules would override Tailwind utilities.

### Git execution rules
- All git calls go through one TS wrapper, `runGit(repo, args)`, which calls `Command.create('git', args, { cwd: repo, env })`.
  - It never goes through a shell and never uses string concatenation, so the commit message and paths are passed as discrete argv items.
- Env on every call: `GIT_TERMINAL_PROMPT=0`, so a missing credential fails fast instead of hanging. Git Credential Manager's GUI prompt still works.
- Also on every call: `-c core.quotepath=off`, `-c color.ui=false`.
- Status: `git status --porcelain=v2 --branch -z --untracked-files=all`, parsed in TS. This covers branch, upstream, ahead/behind, and entries, including renames and unmerged files.
- **Checkbox semantics:** the checkboxes choose what goes into *this* commit. On first load, a file is pre-checked if it is already staged.
- **Commit & Push sequence:**
  1. `git add -A -- <checked paths>`. `-A` makes deletions stage too. Renames include both old and new paths.
  2. `git commit -m <msg> -- <checked paths>`. The pathspec limits the commit to exactly the checked files; anything else already staged stays staged.
  3. `git pull --rebase --autostash`. `--autostash` is needed because unchecked changes would otherwise block the rebase.
  4. `git push`
- **No upstream:** skip the pull and run `git push -u origin HEAD` if an `origin` remote exists. Otherwise stop after the commit and say "committed locally, no remote".
- **Rebase conflict:** run `git rebase --abort` so the repo is never left mid-rebase. Report "pulled changes conflict; your commit is saved locally, resolve in your editor".
- **Unmerged files / rebase or merge in progress:** show a banner and disable the commit.

### Security / capabilities
- `src-tauri/capabilities/default.json` grants only what's needed:
  - `shell:allow-execute` scoped to `{ "name": "git", "cmd": "git", "args": true }`. No `shell:allow-open`, no spawn of anything else, no sidecars.
  - `dialog:allow-open`
  - `store:default`
  - `core:default`, plus `core:window:allow-show`/`allow-hide`/`allow-set-focus`
- The global shortcut, window placement, tray, and single-instance are driven **from Rust only**. They have no JS packages and grant no webview permissions.
- The CSP is explicit in `tauri.conf.json`.
  - `style-src` includes `'unsafe-inline'`, and `dangerousDisableAssetCspModification: ["style-src"]` is set because Vite/Tailwind inject `<style>` tags and a Tauri nonce would disable `'unsafe-inline'`.
  - Everything else is `'self'` plus IPC.

## Project layout (target)
```
src/
  main.tsx, App.tsx
  index.css                              # design tokens (light/dark) + Tailwind entry
  theme.ts                               # system/light/dark preference -> <html data-theme>
  git/types.ts                           # FileChange, BranchInfo, RepoRef shared types
  components/icons.tsx, Checkbox.tsx, Header.tsx, StatusBar.tsx
  preview/mock.ts                        # design-preview data (deleted in Phase 4)
  git/runGit.ts                          # Command wrapper (only place that touches plugin-shell)
  git/status.ts                          # porcelain v2 parser (pure, unit-tested)
  git/commitPush.ts                      # sequence orchestration (pure over an injected runner, unit-tested)
  state/recentRepos.ts                   # plugin-store MRU
  state/claudeSessions.ts                # invoke detect_claude_sessions, normalize to repo roots, auto-select rule
  components/RepoPicker.tsx, FileList.tsx, CommitBox.tsx
  hooks/useWindowBehavior.ts             # Esc, blur-hide, refresh-on-show
src-tauri/
  src/lib.rs                             # tray, shortcut, show/hide/blur logic, plugin registration
  src/placement.rs                       # pure placement math (unit-tested)
  src/taskbar.rs                         # Windows taskbar rect via SHAppBarMessage
  src/claude.rs                          # detect_claude_sessions (read-only scan of ~/.claude/projects)
  capabilities/default.json
  tauri.conf.json
```

## Commands
- `npm run tauri dev`: run the app in dev mode
- `npm test`: Vitest (parser + orchestration)
- `npm run typecheck`: `tsc --noEmit`
- `npm run tauri build`: release bundle (MSI/NSIS)

## Conventions
- Keep git logic in `src/git/*` as pure functions over an injected `runGit`, so it can be tested without Tauri.
- Keep the Rust side thin: tray, shortcut, window positioning, plugin setup, and the read-only Claude session scan. No git in Rust.
- No new dependencies beyond the stack above without asking.

## Plan (5 phases; stop for review after each)

### Phase 1: Scaffold and lockdown
- `create-tauri-app` (React + TS + Vite), Tailwind v4 wired in, Vitest set up.
- Register all plugins. Write a minimal capability file (git-only shell scope).
- Configure the window as borderless, 380×500, hidden, skipTaskbar, alwaysOnTop.
- **Done when:** `npm run tauri dev` builds, no window appears, `npm run typecheck` and `npm test` (placeholder) pass.

### Phase 2: Tray, hotkey, and window behavior
- Tray icon with Show/Quit menu. Left-click toggles.
- Ctrl+Shift+G global toggle. Window placed near the tray, including with an auto-hide taskbar.
- Hide on blur and on Esc. Single-instance.
- **Done when:** the hotkey and tray both toggle reliably, the window appears near the tray, clicking elsewhere or pressing Esc hides it, and Quit exits.

### Phase 3: Git layer, Claude detection, and repo management
- `runGit` wrapper, porcelain v2 parser, repo validation, recent-repos store (MRU, max 8, prune missing).
- `detect_claude_sessions` Rust command with the backward chunked tail read, plus the TS normalization and auto-select rule.
- Folder picker with blur-hide suppression while it's open.
- Unit tests:
  - Parser: modified, added, deleted, renamed, untracked, unmerged, detached HEAD, no upstream, ahead/behind.
  - Rust tail-reader: last line has no `cwd`, a single line bigger than one chunk, an empty file.
  - Auto-select rule: a manual pick sticks until Claude changes folder.
- **Done when:** tests pass, and opening the window with Claude Code running in a repo auto-selects that repo and shows its real branch and files.

### Phase 4: UI
- The presentational components already exist from the design pass: Header/RepoPicker, StatusBar, FileList, CommitBox, and theme switching. They are currently fed by `src/preview/mock.ts`.
- Wire them to real state, then delete `src/preview/`.
- Loading, error, and banner states. Refresh on show. Ctrl+Enter wired up.
- Everything fits 380×500 with no page scroll; only the file list scrolls.
- **Done when:** every state renders correctly against a real repo, and the button's enabled/disabled logic is correct.

### Phase 5: Commit & Push and hardening
- `commitPush` orchestration with step progress, no-upstream path, rebase-conflict abort, and credential-fail-fast.
- Unit tests over a fake runner for success, a failure at each step, the conflict case, and no remote.
- Manual end-to-end run against a scratch repo with a local bare remote.
- `npm run tauri build` produces an installer.
- **Done when:** tests pass, the scratch-repo E2E round-trips a commit to the bare remote, and the release build installs and runs from the tray.
