# VibecodeGit

A tiny Windows tray app for quick commits: pick files, write a message, **Commit & Push**.
It detects recent Claude Code, Codex CLI, and Gemini CLI sessions and selects the repo the newest agent session is working in.

Built with Tauri 2, React, TypeScript, and Tailwind. It uses your system `git`, and git is the only program it's allowed to run.

## Use

- **Ctrl+Shift+G** or a left-click on the tray icon toggles the popup. Esc, clicking elsewhere, or Alt+F4 hides it. Quit is in the tray menu.
- **Repo menu:** "Active in coding agents" (recent Claude Code, Codex CLI, and Gemini CLI sessions), "Recent", and "Open folder…".
- **Checkboxes** choose exactly what goes into this commit. Anything already staged starts checked. Other staged files stay staged.
- **Ctrl+Enter** or **Commit & Push** runs these steps, showing live progress:
  1. add
  2. commit
  3. pull (fetch, then rebase onto upstream)
  4. push
- **If an agent is still editing the repo,** you're asked to confirm first.
- **If the pull conflicts,** the rebase is undone and your commit stays local.
- **If there's no upstream,** the branch is published to `origin`. If there's no remote, the commit stays local.
- **Theme:** follows Windows light/dark. The header button cycles System, Light, and Dark.

## Privacy

Agent detection reads recent session files on your computer (modified in the last 24 hours) to find their working folders. For the selected repository, Claude Code session files are also read to suggest up to eight commit messages from what you asked Claude since your last commit. The app does not upload session files or prompts. If you use a suggestion in a commit and push, Git sends that commit message to your configured remote along with the commit.

## Develop

```bash
npm install
```

```bash
npm run tauri dev
```

- **Tests:** `npm test` covers the parser, the state rules, and the Commit & Push flow. End-to-end tests run real git against a local bare remote.
- **Typecheck:** `npm run typecheck`
- **UI states in a browser:** with `npm run dev` running, open `http://localhost:1420/preview.html?s=claude`. Other states: `normal`, `blocked`, `conflict`, `pushfail`, `clean`, `norepo`.
- **Installers:** `npm run tauri build` puts MSI and NSIS installers in `src-tauri/target/release/bundle/`.
  - If the build fails with `timeout: global` while downloading NSIS (slow connection), run `powershell -ExecutionPolicy Bypass -File scripts/fetch-nsis.ps1` once, then `npm run tauri build -- --bundles nsis`.

See [CLAUDE.md](CLAUDE.md) for the architecture, design details, and Git workflow.

Third-party notices for bundled assets are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
