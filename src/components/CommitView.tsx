import { useEffect, useState, type ReactNode } from "react";
import * as api from "../git/api";
import type { CommitDetail, FileChange } from "../git/types";
import { dragWindow } from "../hooks/dragWindow";
import { ago } from "../lib/time";
import type { CommitActions, CommitRef } from "./commitActions";
import { HeaderButton } from "./DiffView";
import { FileListDiff } from "./FileListDiff";
import { ArrowLeftIcon, CommitIcon, CompareIcon, MoreIcon, XIcon } from "./icons";
import { Badge } from "./ListParts";
import { Menu } from "./Menu";

/** The pane's header row: optional back arrow, icon, title, extras, close. */
export function PaneHeader({
  icon,
  title,
  tooltip,
  onBack,
  onClose,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  tooltip?: string;
  onBack?: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <header onMouseDown={dragWindow} className="flex h-12 shrink-0 items-center gap-2 px-3">
      {onBack && (
        <HeaderButton label="Back (Esc)" onClick={onBack}>
          <ArrowLeftIcon />
        </HeaderButton>
      )}
      <span className="shrink-0 text-fg-3">{icon}</span>
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 font-medium text-fg" title={tooltip}>
        {title}
      </div>
      {children}
      <HeaderButton label={onBack ? "Close" : "Close (Esc)"} onClick={onClose}>
        <XIcon />
      </HeaderButton>
    </header>
  );
}

const Chip = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span title={title} className="shrink-0 rounded-md bg-chip px-1.5 font-mono text-[11px] leading-[18px] text-fg-2">
    {children}
  </span>
);

/** One commit: message, author, parents, and its files with per-file diffs. */
export function CommitView({
  repo,
  commit,
  actions,
  onOpenCommit,
  onBack,
  onClose,
}: {
  repo: string;
  commit: CommitRef;
  actions: CommitActions;
  onOpenCommit: (c: CommitRef) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setDetail(null);
    setError(null);
    api
      .commitDetail(repo, commit.hash)
      .then((d) => !stale && setDetail(d))
      .catch((e) => !stale && setError(api.errorText(e)));
    return () => {
      stale = true;
    };
  }, [repo, commit.hash]);

  const body = detail?.message.split("\n").slice(1).join("\n").trim();
  const subject = detail?.message.split("\n")[0] ?? commit.subject;

  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg" aria-label={`Commit ${commit.short}`}>
      <PaneHeader icon={<CommitIcon />} title={<span className="truncate">{subject}</span>} tooltip={subject} onBack={onBack} onClose={onClose}>
        <Chip title={commit.hash}>{commit.short}</Chip>
        <Menu label="Commit actions" trigger={<MoreIcon />} className="flex size-7 items-center justify-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg">
          {(close) => actions.menu(commit, close)}
        </Menu>
      </PaneHeader>

      {detail && (
        <div className="mx-3 mb-2 shrink-0 rounded-xl border border-line bg-surface px-3 py-2 text-[12px] text-fg-2">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-fg" title={detail.email}>
              {detail.author}
            </span>
            <span className="text-fg-3" title={new Date(detail.dateMs).toLocaleString()}>
              · {new Date(detail.dateMs).toLocaleDateString(undefined, { dateStyle: "medium" })} ({ago(detail.dateMs)})
            </span>
            {detail.committer !== detail.author && <span className="text-fg-3">· committed by {detail.committer}</span>}
            {detail.refs.map((r) => (
              <Badge key={`${r.kind}:${r.name}`} tone={r.kind === "head" ? "accent" : "muted"}>
                {r.name}
              </Badge>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-fg-3">
            {detail.parents.length === 0 ? "Root commit" : detail.parents.length > 1 ? "Merge of" : "Parent"}
            {detail.parents.map((p) => (
              <button
                key={p}
                type="button"
                title={`Open ${p}`}
                onClick={() => onOpenCommit({ hash: p, short: p.slice(0, 7), subject: "" })}
                className="rounded-md px-1 font-mono text-[11px] text-accent-text hover:bg-hover"
              >
                {p.slice(0, 7)}
              </button>
            ))}
            {detail.parents.length > 1 && <span>· files are compared with the first parent</span>}
          </div>
          {body && <p className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap text-fg-2 select-text">{body}</p>}
        </div>
      )}

      <FileListDiff
        files={error ? [] : (detail?.files ?? null)}
        error={error}
        loadDiff={(f) => api.compareFileDiff(repo, detail!.base, detail!.hash, f)}
        emptyText="This commit changes no files."
      />
    </section>
  );
}

/** Two commits side by side, or a commit against the working tree (`target` null). */
export function CompareView({
  repo,
  base,
  target,
  version,
  onSwap,
  onBack,
  onClose,
}: {
  repo: string;
  base: CommitRef;
  target: CommitRef | null;
  /** Refetch on repo changes, which matter when comparing with the working tree. */
  version: unknown;
  onSwap: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targetHash = target?.hash ?? null;

  useEffect(() => {
    let stale = false;
    setError(null);
    api
      .compareFiles(repo, base.hash, targetHash)
      .then((f) => !stale && setFiles(f))
      .catch((e) => !stale && setError(api.errorText(e)));
    return () => {
      stale = true;
    };
  }, [repo, base.hash, targetHash, targetHash ? null : version]);
  useEffect(() => setFiles(null), [base.hash, targetHash]);

  const name = (c: CommitRef | null) => (c ? c.short : "working tree");
  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg" aria-label={`Compare ${name(base)} with ${name(target)}`}>
      <PaneHeader
        icon={<CompareIcon />}
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            <Chip title={`${base.hash}\n${base.subject}`}>{base.short}</Chip>
            <span className="text-fg-3">→</span>
            {target ? <Chip title={`${target.hash}\n${target.subject}`}>{target.short}</Chip> : <span className="truncate">Working tree</span>}
          </span>
        }
        onBack={onBack}
        onClose={onClose}
      >
        {target && (
          <HeaderButton label="Swap sides" onClick={onSwap}>
            <CompareIcon />
          </HeaderButton>
        )}
      </PaneHeader>
      <FileListDiff
        files={error ? [] : files}
        error={error}
        loadDiff={(f) => api.compareFileDiff(repo, base.hash, targetHash, f)}
        emptyText={target ? "No differences between these commits." : "The working tree matches this commit (untracked files aren't compared)."}
      />
    </section>
  );
}
