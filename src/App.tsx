import { useState } from "react";
import { CommitBox } from "./components/CommitBox";
import { FileList } from "./components/FileList";
import { Header } from "./components/Header";
import { StatusBar } from "./components/StatusBar";
import { useWindowBehavior } from "./hooks/useWindowBehavior";
import { isClaudeActive } from "./state/claudeSessions";
import { useRepoState } from "./state/useRepoState";
import { useTheme } from "./theme";

export default function App() {
  useWindowBehavior();
  const { pref, cycle } = useTheme();
  const s = useRepoState();
  const [message, setMessage] = useState("");

  const files = s.status?.files ?? [];
  const placeholder = s.error
    ? s.error
    : !s.repo
      ? "Choose a repository to get started"
      : !s.status
        ? "Loading…"
        : undefined;

  return (
    <main className="flex h-full flex-col border border-line bg-bg">
      <Header
        repo={s.repo}
        branch={s.status ? (s.status.branch.head ?? "detached") : null}
        active={s.claude.repos}
        recent={s.recent}
        onSelectRepo={(r) => void s.selectRepo(r)}
        onBrowse={() => void s.browse()}
        theme={pref}
        onCycleTheme={cycle}
      />
      <StatusBar branch={s.status?.branch ?? null} claudeActive={isClaudeActive(s.repo?.path ?? null, s.claude.repos)} />
      {s.notice && (
        <div className="mx-3 mb-1 flex items-start gap-2 rounded-lg bg-chip px-3 py-1.5 text-[12px] text-fg-2">
          <span className="min-w-0 flex-1 break-words">{s.notice}</span>
          <button type="button" onClick={s.dismissNotice} className="shrink-0 text-fg-3 hover:text-fg" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <div className="h-1 shrink-0" />
      <FileList
        files={files}
        selected={s.selected}
        onToggle={s.toggle}
        onToggleAll={s.toggleAll}
        placeholder={placeholder}
        tone={s.error ? "error" : "muted"}
      />
      <CommitBox
        message={message}
        onMessage={setMessage}
        canCommit={!!s.status && s.selected.size > 0 && message.trim().length > 0}
        busy={false}
        onCommit={() => {
          // Commit & Push lands in Phase 5.
        }}
      />
    </main>
  );
}
