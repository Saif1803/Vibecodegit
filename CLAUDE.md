# ClaudeGit: tray commit utility

A tiny Windows-first system-tray app for quick "stage → commit → pull --rebase → push" without opening an IDE or terminal.

## Stack

- **Tauri 2** (Rust), **React 19 + TypeScript** (Vite 8), **Tailwind CSS v4** (`@tailwindcss/vite`), **Vitest**, `cargo test`, **Inter** (`@fontsource-variable/inter`, bundled)
- **Rust owns all git work** (`src-tauri/src/git/`). It runs the **system `git`** with `std::process::Command`: no shell, one argv item per argument, and no console window (`CREATE_NO_WINDOW`). Git is the only external program. The UI is React on the Claude design system and reaches git only through named Tauri commands (`src-tauri/src/commands.rs`, wrapped in `src/git/api.ts`).
- Tauri plugins:
  - `tauri-plugin-global-shortcut` registers the Ctrl+Shift+G toggle.
  - `tauri-plugin-dialog` provides the native folder picker.
  - `tauri-plugin-store` persists recent repos.
  - `tauri-plugin-single-instance` stops a second launch from creating a second tray icon.
- Tray icon: Tauri core `tray-icon` feature (`TrayIconBuilder`)

## Spec

### Tray and window
- The app lives only in the system tray. It has no taskbar entry (`skipTaskbar: true`) and the window starts hidden.
- Tray **left-click** toggles the window. The tray **menu** has Show, Reset window position and size, and Quit.
- **Ctrl+Shift+G** (global) toggles the window: show and focus it if hidden, hide it if visible.
- The window is borderless (`decorations: false`), always on top, **380×500** by default when compact, and sits near the tray until you move it.
  - **Resizable** from its edges (min 340×420 compact, 720×480 expanded). **Draggable** from empty space in the header, the status line, and a detail pane's header (`src/hooks/dragWindow.ts` → `startDragging`, the webview's only window permission).
  - **Remembered:** on hide (and before switching modes) Rust compares the window with where it last put it (`placement::differs`). A drag saves the position; a resize saves that mode's size. They're kept in the store file `window.json` across launches. A saved position is pulled back on-screen if its monitor is gone (`placement::keep_inside`); sizes shrink to fit a smaller screen. The tray menu's Reset forgets them.
  - **Expanded mode:** opening a detail pane (a diff, a commit, the graph) switches the window to the expanded size (default about **960×640**, clamped to the work area) via the Rust command `set_expanded(expanded)`. The compact column stays 380 px on the left and the detail pane sits on the right. Closing the pane, Esc, or hiding collapses it back.
  - Placement is custom (`src-tauri/src/placement.rs`, pure and unit-tested). It uses `TrayIcon::rect()`, which works without a prior click, and the monitor work area. The taskbar edge is inferred from where the tray icon sits, and the result is clamped on-screen.
  - With no tray rect, the window falls back to the bottom-right of the work area.
  - With an **auto-hide taskbar**, Windows reports the full monitor as the work area. The taskbar rect (`SHAppBarMessage`, `src-tauri/src/taskbar.rs`) is subtracted, so the window never sits under the taskbar when it slides up.
- **Hide on blur** and **hide on Esc**.
  - Blur-hide is suppressed while the native folder dialog is open, because the dialog steals focus. The frontend calls the Rust command `set_blur_hide(enabled)`.
  - Dragging or resizing the window blurs the webview too, but the window stays the foreground window. So a blur is acted on 120 ms later, and only if the window is no longer in front (`GetForegroundWindow`).
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
- **Detection (Rust command `claude_repos`, `src-tauri/src/claude.rs`):**
  1. Find the `*.jsonl` files modified in the last 24 h, newest first.
  2. For each, read **backward from the end in chunks** until a line with a `cwd` is found. Lines can be huge, and some types (for example `file-history-snapshot`) have no `cwd`.
  3. Return `{ cwd, sessionId, lastActiveMs }`, deduplicated by `cwd` and keeping the newest.
  - Read-only. No `fs` plugin permission is needed, because the command runs in Rust.
- **Normalization (Rust, `git/repo.rs`):** each `cwd` goes through `git rev-parse --show-toplevel` (successes cached), and sessions in the same repo are merged. The command returns `{ repos, nonRepos, newestSessionId }`.
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
   - Clicking the ahead/behind text runs **Sync** (pull, then push), or **Publish branch** when there's no upstream. The header's ⋯ menu has Fetch, Pull, Push and Sync.
3. **Changes list**, VS Code-style, in up to three sections: **Merge Changes** (conflicted), **Staged Changes**, and **Changes** (unstaged + untracked).
   - A file with both staged and unstaged edits appears in both sections.
   - Each row has a status badge (M/A/D/R/U/!) and the path. Hover actions: **Stage** (+) and **Discard** on unstaged rows, **Unstage** (−) on staged rows.
   - Section headers have Stage All / Unstage All / Discard All.
   - Clicking a row opens its **diff** in the expanded pane (staged diff for staged rows, working-tree diff otherwise, whole-file for untracked).
   - Scrolls if long. Shows an empty state ("Working tree clean").
4. **Commit message** textarea. **Ctrl+Enter** runs the primary commit action.
5. **Commit split button:** the main button runs the chosen action (**Commit & Push** or **Commit**, remembered in `localStorage`); its chevron menu switches the action and toggles **Amend last commit**.
   - It commits **what is staged**. If nothing is staged but there are changes, it stages everything first and the hint says so (VS Code's "smart commit").
   - Disabled when there's nothing to commit, the message is empty (allowed when amending: keeps the old message), or an operation is running.
   - Shows step progress for the steps that apply: `stage → commit → pull → push`.
   - On success: clear the message and refresh. On failure: show which step failed with git's stderr, and keep the message.

### Design: match the Claude desktop app
- **Look:** the Claude desktop app's visual language.
  - Warm neutral surfaces, hairline borders, 8–16 px radii, and the Claude clay accent `#D97757`.
  - Line icons at 1.4 px stroke, inline SVG in `src/components/icons.tsx`. No icon library and no Anthropic logos.
  - File rows (changes list, commit/stash/compare file lists, diff header) carry a file-type icon from [vscode-icons](https://github.com/vscode-icons/vscode-icons) (MIT), via `src/components/fileIcons.tsx`. It is picked like VS Code does: whole file name, then the longest extension, then the language (`fileType`, unit-tested). Light-theme variants swap in with `prefers-color-scheme`. These are the only colored icons that are not tokens.
  - The SVGs live in `public/file-icons/` (with vscode-icons' LICENSE) and the lookup table in `src/components/fileIconMap.ts`. Both are generated: clone vscode-icons, then run `node scripts/file-icons.mjs <checkout>`. Don’t edit them by hand.
- **Themes:** light and dark are both first-class.
  - Always follows the OS (`prefers-color-scheme`, live). There's no theme switch in the app.
  - `src/theme.ts` sets `<html data-theme>`.
- **Tokens:** CSS variables in `src/index.css`, exposed to Tailwind via `@theme inline`.
  - Classes: `bg-bg`, `bg-surface`, `bg-raised`, `bg-chip`, `bg-hover`, `border-line`, `border-line-strong`, `text-fg`, `text-fg-2`, `text-fg-3`, `bg-accent`, `text-accent-text`, `text-st-*`.
  - Never hard-code hex values in components.
  - Dark values were sampled from the app: bg `#151515`, surface `#1A1A19`, raised `#20201F`, chip `#2D2D2D`, line `#2A2A2A`, fg `#F0EFEC` / `#C3C2B7` / `#898781`.
  - Light values use Claude's ivory palette: bg `#FAF9F5`, fg `#141413`.
- **Type:** Inter (variable, with the optical-size axis), bundled from `@fontsource-variable/inter` because the CSP only allows the app's own fonts; Segoe UI Variable is the fallback. Claude's own fonts are proprietary and aren't bundled. 13 px body, 11–12 px secondary. Cascadia Mono stays for code: diffs, blame, hashes, status letters.
- **Patterns:**
  - Commit box: styled like Claude's prompt box. Rounded-2xl raised surface, with the textarea above an action row.
  - Primary button: accent fill. When disabled, it becomes a neutral chip, not a faded accent.
  - Menus: raised surface, border, shadow, rounded-xl, rounded-lg hover rows.
  - Checkboxes: custom, accent when checked.
- **Global CSS:** base rules go in `@layer base`. Unlayered rules would override Tailwind utilities.

### Git execution rules
- All git runs in Rust (`src-tauri/src/git/mod.rs`): `run(repo, args)` spawns `git` directly with `current_dir = repo`.
  - Never through a shell and never string concatenation: the commit message and every path are discrete argv items.
  - The webview can't pass git arguments. It can only call the named commands in `commands.rs` (`git_status`, `stage`, `unstage`, `discard`, `file_diff`, `commit_push`, `sync`, …), each of which runs on a blocking thread.
- Env on every call: `GIT_TERMINAL_PROMPT=0`, so a missing credential fails fast instead of hanging. Git Credential Manager's GUI prompt still works.
- Also on every call: `-c core.quotepath=off`, `-c color.ui=false`.
- **Path lists** go over stdin with `--literal-pathspecs … --pathspec-from-file=- --pathspec-file-nul` (`with_paths`). There's no command-line length limit, and a file named `[ab].ts` never globs. (`git clean` lacks that flag, so it's chunked under 30k characters.)
- Status (`git/status.rs`): `git --no-optional-locks status --porcelain=v2 --branch -z --untracked-files=all`, parsed into staged / unstaged / conflicted. In-progress operations are read from marker files in `rev-parse --absolute-git-dir` (per-worktree), and the commit blocker is computed there too.
  - `--no-optional-locks` stops the background status from holding `index.lock` while a commit (ours, Claude's, or a terminal's) needs it.
- **Staging model** (`git/ops.rs`): the index *is* the next commit, as in VS Code.
  - Stage: `git add <paths>`. Stage All: `git add -A`.
  - Unstage: `git restore --staged <paths, both sides of renames>`. On an unborn branch (no HEAD yet): drop the index entries with `--cached`.
  - Discard: tracked → `git restore --worktree <paths>` (back to the staged version); untracked → `git clean -f -q -- <paths>`. Always behind a confirm dialog that names what will be lost.
- **Diffs** (`git/diff.rs`): `git diff [--cached -M] --no-ext-diff --no-textconv -- <paths>`; untracked (and, for now, conflicted) files use `git diff --no-index -- /dev/null <path>` (exit 1 means "differs", not failure). Parsed into numbered hunks; binary files are flagged and diffs are capped at 5,000 lines.
- **Destructive operations** (discard, reset --hard, drop stash, delete branch, amending a pushed commit) always go through a confirm dialog that says exactly what will be lost.
- **Commit & Push sequence** (`git/commit.rs`; steps stream to the UI over a Tauri `Channel`):
  1. **stage:** only when nothing is staged: `git add -A`.
  2. **commit:** `git commit -m <msg>`, or `git commit --amend -m <msg>` / `--amend --no-edit`.
     - If the amended commit was already on the upstream (`merge-base --is-ancestor HEAD @{u}`), the user confirms first, the pull is skipped, and the push is `git push --force-with-lease`.
  3. **pull** (`git/sync.rs`, also used by the Pull/Sync buttons): `git fetch`, then if behind:
     - stash tracked changes,
     - `git rebase --no-autostash @{u}`,
     - `git stash pop --index`.
     - **Why not `git pull --rebase --autostash`:** it restores its stash without `--index`, so it silently unstages the user's other staged files, even when there's nothing to pull (found by the end-to-end tests).
     - **If `pop --index` can't rebuild the index:** fall back to a plain pop, with a warning.
     - **On a real conflict:** keep the stash and warn. Never discard anything.
  4. **push:** `git push`.
- **No upstream:** skip the pull and run `git push -u origin HEAD` if an `origin` remote exists. Otherwise stop after the commit and say "committed locally".
- **Rebase conflict:** run `git rebase --abort` so the repo is never left mid-rebase, then restore the stash. Report that the commit is saved locally.
- **After a failed pull or push:** the commit already exists, so the message is cleared to prevent a duplicate commit. It's kept only if nothing was committed.
- **Unmerged files / rebase or merge in progress / detached HEAD:** show a banner and disable the commit.

### Testing
- **Rust (`cargo test` in `src-tauri`):** parsers as pure unit tests. Everything else runs against the real `git` in throwaway repos (`git/testutil.rs`).
  - End-to-end cases use a local bare remote plus a "teammate" clone (`with_remote`).
  - Clones must set `core.autocrlf=false` at clone time, since your global `autocrlf=true` would make every file look modified.
  - Test file names must be valid on Windows (no `*`, `?`, `:`).
- **Vitest (`npm test`):** UI-side logic only: path compare, MRU, auto-select, Claude-active window, graph width, prompt → commit message, file name → icon type.
- **UI states:** `npm run dev`, then open `http://localhost:1420/preview.html?s=normal|claude|blocked|conflict|pushfail|clean|norepo|unborn|ahead|secrets|icons` (`icons` lists a spread of file-type icons).
  - This is the real App with the Rust commands mocked by an in-memory fake repo (`src/dev/preview.tsx`). It's dev-only and not part of the build.
  - Emulate 380×500 for compact and 960×640 for the diff pane; also check the 340×420 minimum.
- Don't drive the user's real desktop with synthetic mouse or keyboard input to test the tray app. Use the preview, read-only window queries, and logs.

### Security / capabilities
- `src-tauri/capabilities/default.json` grants only `core:default`, `core:window:allow-start-dragging`, `dialog:allow-open` and `store:default`.
  - There's no shell plugin at all. Git access is only through the app's own named commands, which take typed arguments (paths, file lists, options), never raw git args.
- The global shortcut, window placement and sizing, tray, and single-instance are driven **from Rust only**. They have no JS packages and grant no webview permissions; the webview can only start a drag.
- The CSP is explicit in `tauri.conf.json`.
  - `style-src` includes `'unsafe-inline'`, and `dangerousDisableAssetCspModification: ["style-src"]` is set because Vite/Tailwind inject `<style>` tags and a Tauri nonce would disable `'unsafe-inline'`.
  - Everything else is `'self'` plus IPC.

## Project layout (target)
```
src/
  main.tsx, App.tsx
  index.css                              # design tokens (light/dark) + Tailwind entry
  theme.ts                               # OS light/dark -> <html data-theme>, live
  git/types.ts                           # TS mirrors of the Rust serde types
  git/api.ts                             # typed invoke wrappers: the UI's only way to reach git
  git/repo.ts                            # path normalize/compare for the UI
  components/icons.tsx, fileIcons.tsx, fileIconMap.ts (generated), Header.tsx, StatusBar.tsx, Banner.tsx, StepProgress.tsx
  components/RepoPicker.tsx, ChangesList.tsx, CommitBox.tsx, DiffView.tsx, ConfirmDialog.tsx, PromptDialog.tsx, Menu.tsx
  components/Tabs.tsx, ListParts.tsx, BranchesPanel.tsx, TagsPanel.tsx, StashesPanel.tsx, StashView.tsx
  components/HistoryPanel.tsx, CommitGraph.tsx, commitActions.tsx, CommitView.tsx, FileHistoryViews.tsx, FileListDiff.tsx
  components/Worktrees.tsx
  state/recentRepos.ts                   # plugin-store MRU
  state/prompts.ts                       # a Claude prompt -> commit message suggestion
  state/claudeSessions.ts                # auto-select rule, Claude-active window
  state/pickFolder.ts                    # dialog + set_blur_hide pause
  state/useRepoState.ts                  # the app's data hook; refreshes on `window-shown`
  hooks/useWindowBehavior.ts             # Esc, blur-hide, refresh-on-show, set_expanded
  dev/preview.tsx                        # browser preview with mocked commands
public/file-icons/                       # vscode-icons SVGs (generated by scripts/file-icons.mjs)
scripts/file-icons.mjs                   # imports vscode-icons: SVGs + name/extension map
src-tauri/
  src/lib.rs                             # tray, shortcut, show/hide/blur/expand, plugin + command registration
  src/commands.rs                        # the Tauri commands the webview may call
  src/git/mod.rs                         # the git runner (argv only, stdin pathspecs, no console window)
  src/git/status.rs, ops.rs, diff.rs, sync.rs, commit.rs, repo.rs, branches.rs, stash.rs, tags.rs (+ remotes), history.rs
  src/git/patch.rs                       # hunk / line patches for partial staging (git apply on stdin)
  src/git/secrets.rs                     # pre-commit secrets check (hand-written matchers)
  src/git/worktrees.rs
  src/git/testutil.rs                    # throwaway repos + bare remotes for tests
  src/placement.rs                       # pure placement math (unit-tested)
  src/taskbar.rs                         # Windows taskbar rect via SHAppBarMessage
  src/claude.rs                          # read-only scan of ~/.claude/projects (sessions, your prompts)
  capabilities/default.json
  tauri.conf.json
```

## Commands
- `npm run tauri dev`: run the app in dev mode
- `cargo test` (in `src-tauri`): git layer, parsers, placement, session scan
- `npm test`: Vitest (UI-side logic)
- `npm run typecheck`: `tsc --noEmit`
- `npm run tauri build`: release bundle (MSI/NSIS)

## Conventions
- All git logic lives in Rust under `src-tauri/src/git/`, exposed as narrow named commands. The TS side is UI and UI state only.
- Every git module gets live tests against the real `git` in throwaway repos.
- TS types in `src/git/types.ts` mirror the serde types; change both together.
- No new dependencies beyond the stack above without asking.

## Plan (10 phases; stop for review after each. Phases 1–9 are done.)

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
- Components are already wired to real state (`useRepoState`) as of Phase 3. The mock data is gone.
- Polish the states: proper notice/error banners, a Claude-active poll every 5 s while visible, and the commit confirmation when Claude is active.
- Loading, error, and banner states. Refresh on show. Ctrl+Enter wired up.
- Everything fits 380×500 with no page scroll; only the file list scrolls.
- **Done when:** every state renders correctly against a real repo, and the button's enabled/disabled logic is correct.

### Phase 5: Commit & Push and hardening
- `commitPush` orchestration with step progress, no-upstream path, rebase-conflict abort, and credential-fail-fast.
- Unit tests over a fake runner for success, a failure at each step, the conflict case, and no remote.
- Manual end-to-end run against a scratch repo with a local bare remote.
- `npm run tauri build` produces an installer.
- **Done when:** tests pass, the scratch-repo E2E round-trips a commit to the bare remote, and the release build installs and runs from the tray.

### Scope for Phases 6–10: the VS Code source-control feature set
- **Goal:** everything in VS Code's Source Control guide that is plain git, in a tray-sized UI.
- **Out of scope:**
  - GitHub pull requests and issues. These need `gh` or the GitHub API, and git stays the only external program.
  - Other version control systems (SVN, Mercurial).
  - A full 3-way merge editor. Per-conflict-block resolution in the diff pane may replace it later.

### Phase 6: Rust git layer, staging model, diffs, expanded window, sync actions
- All git logic moved from TS to Rust (`src-tauri/src/git/`) behind named commands. The shell plugin is removed.
- Status parsed into staged / unstaged / conflicted lists. Stage, unstage, discard (with a confirm dialog), and Stage/Unstage/Discard All.
- Diff pane in the expanded window (`set_expanded`).
- Commit split button (Commit & Push / Commit, and Amend). Smart commit stages everything when nothing is staged. Amending a pushed commit asks first and force-pushes with lease.
- Fetch / Pull / Push / Sync / Publish from the header menu and the ahead/behind text.
- **Done when:** tests pass (parser, ops against real git, diff parser, commit flows including amend), and the preview shows staged/unstaged sections and a diff.

### Phase 7: Tabs, branches, stashes, tags, remotes
- A segmented tab strip under the status bar: **Changes · Branches · Tags · Stashes** (History joins in Phase 8). The commit box only shows on Changes, and the header's branch chip opens Branches.
- Branches (`git/branches.rs`, `BranchesPanel`): local branches, then each remote's, newest first, with ↑↓ / "gone" / "local only" badges and a filter.
  - Clicking a row switches to it; a remote branch checks out as a tracking branch (or switches to the existing local one).
  - The row's ⋯ menu has: new branch from here, publish, merge into current, rebase current onto (confirm; conflicts are undone like pull), rename, and delete.
  - Delete is confirmed, and `-D` needs a second confirmation after git says "not fully merged". Delete-from-remote is confirmed too.
  - Names are checked with `check-ref-format` first.
  - Remotes live here as group headers: fetch one, remove (confirm), and "Add remote…" (names/URLs starting with `-` are refused).
- A merge that stops on conflicts stays in progress. The blocker banner gets an **Abort** button (`abort_operation`, confirmed); full resolution is under **Later**.
- Stashes (`git/stash.rs`, `StashesPanel`, `StashView`): message + split button (Stash / include untracked / staged only), and a list.
  - Clicking a stash opens its files and diffs in the expanded pane. Apply and pop use `--index`, falling back to a plain apply with a warning.
  - A conflicting pop keeps the stash. Drop and drop-all are confirmed.
  - Every index-based operation first checks that `stash@{n}` is still the hash the UI showed.
- Tags (`git/tags.rs`, `TagsPanel`): new tag on HEAD (annotated when it has a message), push to a remote, delete, and delete from a remote (confirmed).
- Menus use fixed positioning, so they escape scrolling lists and flip upward near the bottom.
- **Done when:** each operation has a live-git test and the tabs render in the preview.

### Phase 8: History and recovery
- History tab (`git/history.rs`, `HistoryPanel`): tabs are now **Changes · History · Branches · Tags · Stashes**.
  - `git log --date-order` of HEAD and its upstream, or every branch/remote/tag with "All branches" (remembered in `localStorage`). Paged 200 at a time ("Load 200 more" refetches the longer list).
  - The lane graph is laid out in Rust (`layout`, pure and unit-tested): each row carries its dot plus `through` / `up` / `down` lane segments, and lanes never shift sideways. `CommitGraph` only draws it, in palette tokens (accent, status colors, `--graph-violet`).
  - HEAD is a ring, incoming commits (on `@{u}`, not in HEAD) are hollow with a ↓ badge, outgoing ones get ↑. Ref badges: current branch (accent), branches, remotes, tags.
  - The filter searches loaded commits only and hides the graph while active.
- Detail panes stack: each can have a `back` pane (back arrow or Esc returns to it).
  - Commit (`CommitView`): message, author/committer, clickable parents, refs, files vs. the first parent (the empty tree for a root commit), per-file diff.
  - Compare (`CompareView`): two commits (Ctrl+click a row while a commit is open, older on the left; or "Select for compare" then "Compare with selected"), or a commit with the working tree. Swap sides.
- Commit actions (`commitActions.tsx`, the row ⋯ menu and the commit pane's menu): compare, copy hash, new branch/tag here, cherry-pick, revert (merges use `-m 1`), reset soft / mixed / hard.
  - Hard reset is confirmed with the commits leaving the branch (`reset_impact`) and every uncommitted path that will be lost.
  - Cherry-pick/revert conflicts stay in progress behind the Abort banner; an empty result is aborted and reported ("already here").
  - Anything that moves HEAD is disabled while an operation is in progress.
  - Every hash from the UI is checked to be hex (`check_hash`), so it can't be read as an option or range.
- File timeline (`log --follow`, with each commit's diff of the file at its path then) and blame (`blame --porcelain` of the working file, uncommitted lines marked) open from a file's diff pane.
- **Done when:** the graph layout and blame parser are unit-tested, and the actions have live-git tests.

### Phase 9: The Claude Code loop (review, partial commits, safety nets)
Re-scoped for committing Claude's work: keep the good parts of an edit, don't leak secrets, make mistakes cheap to undo. Conflict resolution and repo setup move to **Later**.
- **Partial staging:** stage, unstage or discard one hunk, or selected lines, from the diff pane.
  - Rust builds a patch from the parsed hunks and runs `git apply --cached [--reverse]` (discard: `git apply --reverse` on the working tree) with the patch on stdin (`run_with_input`). The patch is checked against the current diff first, so a file Claude just changed again isn't patched blind.
  - Discarding a hunk is confirmed. Untracked files stage whole.
- **Commit message from Claude:** your Claude Code prompts in this repo since the last commit (read-only, from the session logs `claude_repos` already scans), offered as picks in the commit box. Tab fills the newest when the message is empty. Prompts are conversational, so they're suggestions to edit, never auto-filled.
- **Secrets check before committing:** file names (`.env*` but not `.env.example`, `*.pem`, `*.key`, `id_rsa*`, …) and added lines (private keys, AWS/GitHub/Slack/Stripe/Google/Anthropic/OpenAI tokens, `password = "…"`) in what's about to be committed. It warns with the findings and "Commit anyway"; it never blocks. Hand-written matchers, no regex crate.
- **Undo last commit:** in the commit menu. `reset --soft HEAD~1` (a root commit drops HEAD), the changes stay staged and the message comes back into the box. Confirmed when the commit is already pushed.
- **Checkpoint:** in the commit menu. Stages everything and commits locally as "Checkpoint: <time>" with no push, so a bad Claude run can be discarded back to it. Undo last commit turns it back into changes.
- **Worktrees:** listed in the Branches tab (Claude Code runs sessions in them). Open one as the selected repo, add (new or existing branch), remove (confirmed; force only after a second confirm).
- **Add to .gitignore** from a changed file's row (for scratch files Claude leaves behind).
- **Done when:** the patch builder, the secrets matchers and the prompt reader are unit-tested, and partial staging, undo, checkpoint and worktrees have live-git tests.

### Later (not scheduled)
- Conflicts: per-block **Accept Current / Incoming / Both** in the diff pane, and **Continue** for merge/rebase/cherry-pick/revert. Until then, Abort from the banner, or ask Claude to resolve.
- Repo setup: **Init** a folder and **Clone** a URL.

### Phase 10: Polish and release
- Keyboard navigation for lists and menus, empty/loading/error states for every tab, and a preview scenario per tab.
- Performance on big repos: virtualized lists, capped diffs.
- **Done when:** `npm test`, `npm run typecheck` and `cargo test` pass, and `npm run tauri build` produces an installer that runs from the tray.
