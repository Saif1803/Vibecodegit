import { useEffect, useRef, useState } from "react";
import { Banner } from "./components/Banner";
import { BranchesPanel } from "./components/BranchesPanel";
import { ChangesList, EmptyState } from "./components/ChangesList";
import { useCommitActions, type CommitRef } from "./components/commitActions";
import { CommitBox, type CommitAction } from "./components/CommitBox";
import { CommitView, CompareView } from "./components/CommitView";
import { ConfirmDialog, type ConfirmRequest } from "./components/ConfirmDialog";
import { DiffView } from "./components/DiffView";
import { BlameView, TimelineView } from "./components/FileHistoryViews";
import { Header } from "./components/Header";
import { HistoryPanel } from "./components/HistoryPanel";
import { AlertIcon, CheckCircleIcon, FolderPlusIcon, SpinnerIcon } from "./components/icons";
import type { PanelOps } from "./components/ListParts";
import { PromptDialog, type PromptRequest } from "./components/PromptDialog";
import { StashesPanel, type StashActions } from "./components/StashesPanel";
import { StashView } from "./components/StashView";
import { StatusBar } from "./components/StatusBar";
import { Tabs, type TabId } from "./components/Tabs";
import { TagsPanel } from "./components/TagsPanel";
import * as api from "./git/api";
import type {
  ChangeSide,
  ClaudePrompt,
  CommitResult,
  FileChange,
  FileDiff,
  Hunk,
  HunkAction,
  Outcome,
  StashEntry,
  Step,
  StepState,
  SyncKind,
} from "./git/types";
import { setExpanded, useWindowBehavior } from "./hooks/useWindowBehavior";
import { samePath } from "./git/repo";
import { isClaudeActive } from "./state/claudeSessions";
import { useRepoState } from "./state/useRepoState";
import { useTheme } from "./theme";

type Notice = { tone: "info" | "warning" | "success"; text: string };
/** What the expanded pane shows. `back` is where Esc (or the back arrow) returns to. */
type Detail = (
  | { kind: "file"; file: FileChange; side: ChangeSide }
  | { kind: "stash"; stash: StashEntry }
  | { kind: "commit"; commit: CommitRef }
  | { kind: "compare"; base: CommitRef; target: CommitRef | null }
  | { kind: "timeline"; path: string }
  | { kind: "blame"; path: string }
) & { back?: Detail };

const ACTION_KEY = "claudegit.commitAction";
function readAction(): CommitAction {
  try {
    return localStorage.getItem(ACTION_KEY) === "commit" ? "commit" : "commit-push";
  } catch {
    return "commit-push";
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export default function App() {
  const visible = useWindowBehavior();
  const { pref, cycle } = useTheme();
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const s = useRepoState(visible, busy);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [stepOrder, setStepOrder] = useState<Step[]>([]);
  const [steps, setSteps] = useState<Partial<Record<Step, StepState>>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setActionState] = useState<CommitAction>(readAction);
  const [amend, setAmend] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [promptReq, setPromptReq] = useState<PromptRequest | null>(null);
  const [tab, setTab] = useState<TabId>("changes");
  const [prompts, setPrompts] = useState<ClaudePrompt[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);

  const repo = s.repo?.path ?? null;
  const st = s.status;
  const staged = st?.staged ?? [];
  const unstaged = st?.unstaged ?? [];
  const conflicted = st?.conflicted ?? [];
  const blocker = st?.blocker ?? null;
  const claudeActive = isClaudeActive(repo, s.claude.repos);
  const hasCommits = st?.branch.hasCommits ?? false;
  // VS Code's smart commit: with nothing staged, commit every change.
  const stageAll = !amend && staged.length === 0 && unstaged.length > 0;
  const hasContent = staged.length > 0 || unstaged.length > 0 || (amend && hasCommits);
  const canCommit = !busy && !!st && !blocker && hasContent && (message.trim().length > 0 || amend);
  const hint = amend
    ? hasCommits
      ? staged.length > 0
        ? `Adds ${plural(staged.length, "staged change")} to the last commit`
        : "Rewrites the last commit"
      : "No commit to amend yet"
    : stageAll
      ? `Nothing staged: commits all ${plural(unstaged.length, "change")}`
      : null;

  const setAction = (a: CommitAction) => {
    setActionState(a);
    try {
      localStorage.setItem(ACTION_KEY, a);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
  };

  /** Stage/unstage/discard: run, reload, and surface git's error if any. */
  const op = async (fn: (repo: string) => Promise<unknown>) => {
    setBusy(true);
    const failure = await s.mutate(fn);
    setBusy(false);
    if (failure) setNotice({ tone: "warning", text: failure });
  };

  /**
   * Branch / tag / stash / remote actions: busy state, a result banner, and a status refresh.
   * An Outcome result becomes the banner; a string result is the success text.
   */
  const run = async (fn: (repo: string) => Promise<unknown>, success?: string): Promise<string | null> => {
    setBusy(true);
    setNotice(null);
    let next: Notice | null = success ? { tone: "success", text: success } : null;
    const failure = await s.mutate(async (r) => {
      const out = await fn(r);
      if (typeof out === "string") next = { tone: "success", text: out };
      else if (out && typeof out === "object" && "ok" in out) {
        const o = out as Outcome;
        next = { tone: !o.ok ? "warning" : o.warning ? "info" : "success", text: `${o.message}${o.warning ? `\n${o.warning}` : ""}` };
      }
    });
    setBusy(false);
    setNotice(failure ? { tone: "warning", text: failure } : next);
    return failure;
  };

  const stashActions: StashActions = {
    apply: (stash, pop) => {
      void run((r) => api.stashApply(r, stash, pop)).then(() => {
        if (pop) setDetail((d) => (d?.kind === "stash" && d.stash.hash === stash.hash ? null : d));
      });
    },
    drop: (stash) =>
      setConfirmReq({
        title: `Drop ${stash.message}?`,
        body: "The stash is deleted. Its changes are gone unless they were applied somewhere.",
        confirmLabel: "Drop stash",
        danger: true,
        onConfirm: () => {
          setDetail((d) => (d?.kind === "stash" && d.stash.hash === stash.hash ? null : d));
          void run((r) => api.stashDrop(r, stash), `Dropped stash@{${stash.index}}.`);
        },
      }),
  };

  const panelOps: PanelOps | null = repo
    ? { repo, busy, run, confirm: setConfirmReq, prompt: setPromptReq, notify: (text) => setNotice({ tone: "success", text }), version: st }
    : null;

  /** Open a pane on top of the current one; its back arrow (and Esc) returns here. */
  const pushDetail = (next: Detail) => setDetail((d) => ({ ...next, back: d ?? undefined }));
  const openCommit = (commit: CommitRef) => setDetail({ kind: "commit", commit });
  const commitActions = useCommitActions(panelOps, st, openCommit, (base, target) =>
    setDetail((d) => ({ kind: "compare", base, target, back: d?.kind === "commit" ? d : undefined })),
  );

  const abortOperation = () => {
    const op = st?.operation;
    if (!op) return;
    setConfirmReq({
      title: `Abort the ${op}?`,
      body: `Puts the repo back to how it was before the ${op} started. Any conflict resolution you've done for it is lost.`,
      confirmLabel: `Abort ${op}`,
      danger: true,
      onConfirm: () => void run((r) => api.abortOperation(r), `Aborted the ${op}.`),
    });
  };

  const stage = (files: FileChange[]) => void op((r) => api.stage(r, files));
  const unstage = (files: FileChange[]) =>
    void op((r) => (files.length === staged.length ? api.unstageAll(r) : api.unstage(r, files)));
  const discard = (files: FileChange[]) => {
    const untracked = files.filter((f) => f.kind === "untracked").length;
    setConfirmReq({
      title: files.length === 1 ? `Discard changes in ${baseName(files[0].path)}?` : `Discard ${plural(files.length, "change")}?`,
      body: (
        <>
          This can't be undone.
          {untracked > 0 && ` ${plural(untracked, "untracked file")} will be deleted.`}
          {files.some((f) => f.kind !== "untracked") && " Tracked files go back to their staged or committed version."}
        </>
      ),
      items: files.map((f) => f.path),
      confirmLabel: "Discard",
      danger: true,
      onConfirm: () => void op((r) => api.discard(r, files)),
    });
  };

  /** What one commit run does. A checkpoint keeps whatever message you were writing. */
  type CommitPlan = { message: string; amend: boolean; stageAll: boolean; push: boolean; forcePush: boolean; checkpoint?: boolean };

  const runCommit = async (plan: CommitPlan) => {
    if (!repo) return;
    const { push } = plan;
    setBusy(true);
    setCommitting(true);
    setNotice(null);
    setSteps({});
    setStepOrder((["stage", "commit", "pull", "push"] as Step[]).filter((x) => (x === "stage" ? plan.stageAll : x === "commit" || push)));
    const r: CommitResult = await api
      .commitPush(repo, plan, (step, state) => setSteps((prev) => ({ ...prev, [step]: state })))
      .catch((e) => ({ ok: false as const, step: "commit" as const, message: api.errorText(e), hash: null }));

    if (r.ok && plan.checkpoint) {
      setNotice({ tone: "success", text: `Checkpoint ${r.hash} saved locally. Discard back to it if Claude's next change goes wrong; Undo last commit turns it back into changes.` });
    } else if (r.ok) {
      const verb = plan.amend ? "Amended" : "Committed";
      const where = !push ? "" : r.pushedTo ? ` and pushed to ${r.pushedTo}` : " locally (no remote to push to)";
      setNotice({ tone: r.warning ? "info" : "success", text: `${verb} ${r.hash}${where}.${r.warning ? `\n${r.warning}` : ""}` });
    } else {
      setNotice({ tone: "warning", text: `${r.step[0].toUpperCase()}${r.step.slice(1)} failed: ${r.message}` });
    }
    // Keep the message only if nothing was committed; otherwise a retry would commit twice.
    if ((r.ok || r.hash) && !plan.checkpoint) {
      setMessage("");
      setAmend(false);
    }
    setBusy(false);
    setCommitting(false);
    // Even a failed pull or push leaves a local commit, so always re-read.
    if (r.ok || r.hash) await s.afterCommit();
  };

  /** Look for keys, tokens and .env files in what's about to be committed; warn, never block. */
  const withSecretsCheck = async (everything: boolean, next: () => void) => {
    if (!repo) return;
    const found = await api.checkSecrets(repo, everything).catch(() => []);
    if (found.length === 0) return next();
    setConfirmReq({
      title: found.length === 1 ? "This commit may contain a secret" : `This commit may contain ${found.length} secrets`,
      body: "Once pushed, a secret should be treated as leaked (rotate it; deleting it later isn't enough). Unstage or ignore these, or commit anyway if they're safe.",
      items: found.map((f) => `${f.what} · ${f.path}${f.line ? `:${f.line}` : ""}`),
      confirmLabel: "Commit anyway",
      danger: true,
      onConfirm: next,
    });
  };

  const commit = async () => {
    setConfirming(false);
    if (!repo) return;
    const push = action === "commit-push";
    const plan: CommitPlan = { message, amend, stageAll, push, forcePush: false };
    // Rewriting a commit that's already on the remote needs a force push; say so first.
    const published = amend && (await api.isHeadPublished(repo).catch(() => false));
    if (!published) return void withSecretsCheck(stageAll, () => void runCommit(plan));
    setConfirmReq({
      title: "Amend a pushed commit?",
      body: push
        ? `The last commit is already on ${st?.branch.upstream}. Amending rewrites it and force-pushes (with lease), which rewrites history for anyone who pulled it.`
        : `The last commit is already on ${st?.branch.upstream}. After amending, your next push will need to force (rewriting shared history).`,
      confirmLabel: push ? "Amend & force push" : "Amend",
      danger: true,
      onConfirm: () => void withSecretsCheck(false, () => void runCommit({ ...plan, forcePush: push })),
    });
  };

  /** A local restore point of everything, before letting Claude try something risky. */
  const checkpoint = () => {
    const time = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const plan: CommitPlan = { message: `Checkpoint ${time}`, amend: false, stageAll: true, push: false, forcePush: false, checkpoint: true };
    void withSecretsCheck(true, () => void runCommit(plan));
  };

  /** Undo the last commit: its changes go back to staged, its message back into the box. */
  const undoLastCommit = async () => {
    if (!repo) return;
    const undo = async () => {
      let undone = "";
      setBusy(true);
      setNotice(null);
      const failure = await s.mutate(async (r) => {
        undone = await api.undoLastCommit(r);
      });
      setBusy(false);
      if (failure) return setNotice({ tone: "warning", text: failure });
      const subject = undone.split("\n")[0];
      // A checkpoint's name isn't a message worth keeping.
      if (!message.trim() && !subject.startsWith("Checkpoint ")) setMessage(undone);
      setNotice({ tone: "success", text: `Undid “${subject}”. Its changes are staged.` });
    };
    if (!(await api.isHeadPublished(repo).catch(() => false))) return void undo();
    setConfirmReq({
      title: "Undo a pushed commit?",
      body: `The last commit is already on ${st?.branch.upstream}. Undoing it locally means your next push has to force, rewriting history for anyone who pulled it.`,
      confirmLabel: "Undo commit",
      danger: true,
      onConfirm: () => void undo(),
    });
  };

  /** Hunk / line staging from the diff pane. Discarding asks first. */
  const applyHunk = (file: FileChange, hunk: Hunk, lines: number[] | null, action: HunkAction) => {
    const go = () => void op((r) => api.applyHunk(r, file, hunk, lines, action));
    if (action !== "discard") return go();
    setConfirmReq({
      title: lines ? `Discard ${plural(lines.length, "line")} in ${baseName(file.path)}?` : `Discard this change in ${baseName(file.path)}?`,
      body: "This can't be undone. The lines go back to their staged or committed version.",
      confirmLabel: "Discard",
      danger: true,
      onConfirm: go,
    });
  };

  const ignore = (file: FileChange) => void run((r) => api.addToGitignore(r, file.path), `Added /${file.path} to .gitignore.`);

  /** Button and Ctrl+Enter: ask first while Claude is editing this repo. */
  const requestCommit = () => {
    if (confirming) return void commit();
    if (!canCommit) return;
    if (claudeActive) setConfirming(true);
    else void commit();
  };

  const runSync = async (kind: SyncKind) => {
    if (!repo) return;
    setBusy(true);
    setNotice(null);
    const r = await api.sync(repo, kind).catch((e) => ({ ok: false, message: api.errorText(e), warning: undefined }));
    setNotice({
      tone: !r.ok ? "warning" : r.warning ? "info" : "success",
      text: `${r.ok ? "" : `${kind[0].toUpperCase()}${kind.slice(1)} failed: `}${r.message}${r.warning ? `\n${r.warning}` : ""}`,
    });
    setBusy(false);
    await s.reload();
  };

  const openDiff = (file: FileChange, side: ChangeSide) => {
    setDiff(null);
    setDiffError(null);
    setDetail({ kind: "file", file, side });
  };

  // Keep the open diff in step with the repo: follow a file that moved lists, close it if it's gone.
  useEffect(() => {
    if (detail?.kind !== "file" || !st || !repo) return;
    const lists: Record<ChangeSide, FileChange[]> = { staged: st.staged, unstaged: st.unstaged, conflicted: st.conflicted };
    const here = lists[detail.side].find((f) => f.path === detail.file.path);
    if (!here) {
      const side = (["unstaged", "staged", "conflicted"] as ChangeSide[]).find((x) => lists[x].some((f) => f.path === detail.file.path));
      setDetail(side ? { kind: "file", file: lists[side].find((f) => f.path === detail.file.path)!, side } : null);
      return;
    }
    let stale = false;
    api
      .fileDiff(repo, here, detail.side)
      .then((d) => !stale && (setDiff(d), setDiffError(null)))
      .catch((e) => !stale && setDiffError(api.errorText(e)));
    return () => {
      stale = true;
    };
  }, [detail, st, repo]);

  const expanded = detail !== null;
  useEffect(() => setExpanded(expanded), [expanded]);

  // Ctrl+Enter from anywhere in the popup.
  const keys = useRef({ requestCommit, confirming, detail, dialog: !!(confirmReq || promptReq), tab });
  keys.current = { requestCommit, confirming, detail, dialog: !!(confirmReq || promptReq), tab };
  useEffect(() => {
    const onCtrlEnter = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.ctrlKey && !keys.current.dialog && keys.current.tab === "changes") {
        e.preventDefault();
        keys.current.requestCommit();
      }
    };
    // Esc backs out one level (confirmation, then the diff) before the window-level Esc hides.
    // Bubble phase on document: open menus and dialogs handle Esc first (window capture).
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (keys.current.confirming) setConfirming(false);
      else if (keys.current.detail) setDetail(keys.current.detail.back ?? null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onCtrlEnter, true);
    document.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onCtrlEnter, true);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  // Ready to type on show; confirmations and the detail pane never survive a hide or repo switch.
  useEffect(() => {
    if (visible) input.current?.focus();
    else {
      setConfirming(false);
      setConfirmReq(null);
      setPromptReq(null);
      setDetail(null);
    }
  }, [visible]);
  useEffect(() => {
    setConfirming(false);
    setNotice(null);
    setDetail(null);
    setAmend(false);
  }, [repo]);

  // Your Claude prompts since the last commit: re-read after each status load (a commit moves
  // "since") and whenever Claude's session log for this repo is written.
  const claudeWrote = s.claude.repos.find((r) => repo && samePath(r.path, repo))?.lastActiveMs ?? 0;
  useEffect(() => {
    if (!repo || !visible) return;
    let stale = false;
    api
      .claudePrompts(repo)
      .then((p) => !stale && setPrompts(p))
      .catch(() => !stale && setPrompts([]));
    return () => {
      stale = true;
    };
  }, [repo, st, claudeWrote, visible]);

  const total = staged.length + unstaged.length + conflicted.length;
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
  ) : !st ? (
    <EmptyState icon={<SpinnerIcon width={18} height={18} />} title="Loading changes…" />
  ) : total === 0 ? (
    <EmptyState icon={<CheckCircleIcon width={20} height={20} />} title="Working tree clean" detail="Nothing to commit." />
  ) : undefined;

  return (
    <main className="relative flex h-full border border-line bg-bg">
      <div className={`flex min-w-0 flex-col ${expanded ? "w-[380px] shrink-0" : "flex-1"}`}>
        <Header
          repo={s.repo}
          branch={st ? (st.branch.head ?? "detached") : null}
          active={s.claude.repos}
          recent={s.recent}
          onSelectRepo={(r) => void s.selectRepo(r)}
          onBrowse={() => void s.browse()}
          theme={pref}
          onCycleTheme={cycle}
          onRefresh={() => void s.reload()}
          refreshing={s.loading && !!st}
          onSync={(k) => void runSync(k)}
          canSync={!busy && !!st && st.branch.head !== null}
          onBranchClick={() => setTab("branches")}
        />
        <StatusBar branch={st?.branch ?? null} claudeActive={claudeActive} busy={busy} onSync={() => void runSync("sync")} />
        <div className="h-1.5 shrink-0" />
        {s.repo && st && <Tabs tab={tab} onTab={setTab} changes={total} />}
        {notice && (
          <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Banner>
        )}
        {blocker && !notice && (
          <Banner
            tone="warning"
            action={
              st?.operation && (
                <button
                  type="button"
                  onClick={abortOperation}
                  disabled={busy}
                  className="-my-0.5 shrink-0 rounded-md border border-line bg-raised px-2 text-[12px] leading-5 text-fg-2 hover:text-fg disabled:opacity-40"
                >
                  Abort {st.operation}
                </button>
              )
            }
          >
            {blocker}
          </Banner>
        )}
        {s.notice && (
          <Banner tone="info" onDismiss={s.dismissNotice}>
            {s.notice}
          </Banner>
        )}
        {tab === "changes" || !panelOps ? (
          <>
            <ChangesList
              staged={staged}
              unstaged={unstaged}
              conflicted={conflicted}
              active={detail?.kind === "file" ? { path: detail.file.path, side: detail.side } : null}
              disabled={busy}
              empty={empty}
              open={openDiff}
              stage={stage}
              unstage={unstage}
              discard={discard}
              ignore={ignore}
            />
            <CommitBox
              prompts={prompts}
              onCheckpoint={checkpoint}
              canCheckpoint={!busy && !!st && !blocker && total > 0}
              onUndo={() => void undoLastCommit()}
              canUndo={!busy && hasCommits && !st?.operation}
              inputRef={input}
              message={message}
              onMessage={setMessage}
              canCommit={canCommit}
              busy={committing}
              stepOrder={stepOrder}
              steps={steps}
              confirming={confirming}
              action={action}
              onAction={setAction}
              amend={amend}
              onAmend={setAmend}
              hint={hint}
              onCommit={requestCommit}
              onCancel={() => setConfirming(false)}
            />
          </>
        ) : tab === "history" ? (
          <HistoryPanel ops={panelOps} actions={commitActions} openHash={detail?.kind === "commit" ? detail.commit.hash : null} />
        ) : tab === "branches" ? (
          <BranchesPanel ops={panelOps} onOpenRepo={(r) => void s.selectRepo(r)} />
        ) : tab === "tags" ? (
          <TagsPanel ops={panelOps} />
        ) : (
          <StashesPanel
            ops={panelOps}
            open={(stash) => setDetail({ kind: "stash", stash })}
            openHash={detail?.kind === "stash" ? detail.stash.hash : null}
            actions={stashActions}
          />
        )}
      </div>
      {detail?.kind === "file" && (
        <DiffView
          file={detail.file}
          side={detail.side}
          diff={diff}
          error={diffError}
          disabled={busy}
          onClose={() => setDetail(null)}
          onStage={() => stage([detail.file])}
          onUnstage={() => unstage([detail.file])}
          onDiscard={() => discard([detail.file])}
          onTimeline={() => pushDetail({ kind: "timeline", path: detail.file.path })}
          onBlame={() => pushDetail({ kind: "blame", path: detail.file.path })}
          onIgnore={() => ignore(detail.file)}
          onHunk={(hunk, lines, action) => applyHunk(detail.file, hunk, lines, action)}
        />
      )}
      {detail?.kind === "stash" && repo && (
        <StashView repo={repo} stash={detail.stash} busy={busy} actions={stashActions} onClose={() => setDetail(null)} />
      )}
      {detail?.kind === "commit" && repo && (
        <CommitView
          repo={repo}
          commit={detail.commit}
          actions={commitActions}
          onOpenCommit={(commit) => pushDetail({ kind: "commit", commit })}
          onBack={detail.back && (() => setDetail(detail.back!))}
          onClose={() => setDetail(null)}
        />
      )}
      {detail?.kind === "compare" && repo && (
        <CompareView
          repo={repo}
          base={detail.base}
          target={detail.target}
          version={st}
          onSwap={() => detail.target && setDetail({ ...detail, base: detail.target, target: detail.base })}
          onBack={detail.back && (() => setDetail(detail.back!))}
          onClose={() => setDetail(null)}
        />
      )}
      {(detail?.kind === "timeline" || detail?.kind === "blame") && repo && (
        <FileHistoryPane
          kind={detail.kind}
          repo={repo}
          path={detail.path}
          version={st}
          onOpenCommit={(commit) => pushDetail({ kind: "commit", commit })}
          onBack={detail.back && (() => setDetail(detail.back!))}
          onClose={() => setDetail(null)}
        />
      )}
      {promptReq && <PromptDialog request={promptReq} onClose={() => setPromptReq(null)} />}
      {confirmReq && <ConfirmDialog request={confirmReq} onClose={() => setConfirmReq(null)} />}
    </main>
  );
}

const FileHistoryPane = ({ kind, ...props }: { kind: "timeline" | "blame" } & Parameters<typeof TimelineView>[0]) =>
  kind === "timeline" ? <TimelineView {...props} /> : <BlameView {...props} />;
