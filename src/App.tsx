import { useEffect, useRef, useState } from "react";
import { Banner } from "./components/Banner";
import { CommitBox } from "./components/CommitBox";
import { EmptyState, FileList } from "./components/FileList";
import { Header } from "./components/Header";
import { AlertIcon, CheckCircleIcon, FolderPlusIcon, SpinnerIcon } from "./components/icons";
import { StatusBar } from "./components/StatusBar";
import { commitPush, pathspecFor, type CommitPushResult, type Step, type StepState } from "./git/commitPush";
import { tauriGit } from "./git/runGit";
import { commitBlocker } from "./git/status";
import { useWindowBehavior } from "./hooks/useWindowBehavior";
import { isClaudeActive } from "./state/claudeSessions";
import { useRepoState } from "./state/useRepoState";
import { useTheme } from "./theme";

export default function App() {
  const visible = useWindowBehavior();
  const { pref, cycle } = useTheme();
  const [busy, setBusy] = useState(false);
  const s = useRepoState(visible, busy);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [steps, setSteps] = useState<Partial<Record<Step, StepState>>>({});
  const [result, setResult] = useState<CommitPushResult | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const files = s.status?.files ?? [];
  const blocker = s.status ? commitBlocker(s.status) : null;
  const claudeActive = isClaudeActive(s.repo?.path ?? null, s.claude.repos);
  const canCommit = !busy && !!s.status && !blocker && s.selected.size > 0 && message.trim().length > 0;

  const commit = async () => {
    setConfirming(false);
    if (!s.repo || !s.status) return;
    setBusy(true);
    setResult(null);
    setSteps({});
    const r = await commitPush(tauriGit, s.repo.path, pathspecFor(s.status.files, s.selected), message, (step, state) =>
      setSteps((prev) => ({ ...prev, [step]: state })),
    );
    setResult(r);
    // Keep the message only if nothing was committed; otherwise a retry would commit twice.
    if (r.ok || r.hash) setMessage("");
    setBusy(false);
    // Even a failed pull or push leaves a local commit, so always re-read.
    if (r.ok || r.hash) await s.afterCommit();
  };

  /** Button and Ctrl+Enter: ask first while Claude is editing this repo. */
  const requestCommit = () => {
    if (confirming) return void commit();
    if (!canCommit) return;
    if (claudeActive) setConfirming(true);
    else void commit();
  };

  // Ctrl+Enter from anywhere in the popup; Esc backs out of a confirmation before hiding.
  const keys = useRef({ requestCommit, confirming });
  keys.current = { requestCommit, confirming };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        keys.current.requestCommit();
      } else if (e.key === "Escape" && keys.current.confirming) {
        e.preventDefault();
        setConfirming(false);
      }
    };
    // Capture phase: runs before the window-level Esc-to-hide handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Ready to type on show; a pending confirmation never survives a hide or repo switch.
  useEffect(() => {
    if (visible) input.current?.focus();
    else setConfirming(false);
  }, [visible]);
  useEffect(() => {
    setConfirming(false);
    setResult(null);
  }, [s.repo?.path]);

  const empty = s.error ? (
    <EmptyState icon={<AlertIcon width={20} height={20} />} tone="error" title="Can't read this repository" detail={s.error} />
  ) : !s.repo ? (
    s.loading ? (
      <EmptyState icon={<SpinnerIcon width={18} height={18} />} title="Looking for Claude Code…" />
    ) : (
      <EmptyState
        icon={<FolderPlusIcon width={20} height={20} />}
        title="No repository selected"
        detail="Start Claude Code in a repo, or open one here."
        action={
          <button
            type="button"
            onClick={() => void s.browse()}
            className="h-8 rounded-lg border border-line px-3 text-fg-2 hover:bg-hover hover:text-fg"
          >
            Open folder…
          </button>
        }
      />
    )
  ) : !s.status ? (
    <EmptyState icon={<SpinnerIcon width={18} height={18} />} title="Loading changes…" />
  ) : files.length === 0 ? (
    <EmptyState icon={<CheckCircleIcon width={20} height={20} />} title="Working tree clean" detail="Nothing to commit." />
  ) : undefined;

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
        onRefresh={() => void s.reload()}
        refreshing={s.loading && !!s.status}
      />
      <StatusBar branch={s.status?.branch ?? null} claudeActive={claudeActive} />
      <div className="h-1.5 shrink-0" />
      {result &&
        (result.ok ? (
          <Banner tone={result.warning ? "info" : "success"} onDismiss={() => setResult(null)}>
            {`Committed ${result.hash}${result.pushedTo ? ` and pushed to ${result.pushedTo}` : " locally (no remote to push to)"}.`}
            {result.warning ? `
${result.warning}` : ""}
          </Banner>
        ) : (
          <Banner tone="warning" onDismiss={() => setResult(null)}>
            {`${result.step[0].toUpperCase()}${result.step.slice(1)} failed: ${result.message}`}
          </Banner>
        ))}
      {blocker && !result && <Banner tone="warning">{blocker}</Banner>}
      {s.notice && (
        <Banner tone="info" onDismiss={s.dismissNotice}>
          {s.notice}
        </Banner>
      )}
      <FileList files={files} selected={s.selected} onToggle={s.toggle} onToggleAll={s.toggleAll} empty={empty} />
      <CommitBox
        inputRef={input}
        message={message}
        onMessage={setMessage}
        canCommit={canCommit}
        busy={busy}
        steps={steps}
        confirming={confirming}
        onCommit={requestCommit}
        onCancel={() => setConfirming(false)}
      />
    </main>
  );
}
