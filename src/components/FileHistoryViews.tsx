import { Fragment, useEffect, useState } from "react";
import * as api from "../git/api";
import type { Blame, FileDiff, TimelineEntry } from "../git/types";
import { ago } from "../lib/time";
import type { CommitRef } from "./commitActions";
import { PaneHeader } from "./CommitView";
import { DiffBody, HeaderButton } from "./DiffView";
import { BlameIcon, CommitIcon, HistoryIcon, SpinnerIcon } from "./icons";

interface FileViewProps {
  repo: string;
  path: string;
  /** Refetch when the repo changes. */
  version: unknown;
  onOpenCommit: (c: CommitRef) => void;
  onBack?: () => void;
  onClose: () => void;
}

function FileTitle({ path, label }: { path: string; label: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <>
      <span className="truncate">{path.slice(slash + 1)}</span>
      <span className="min-w-0 shrink-[4] truncate text-[12px] font-normal text-fg-3">{path.slice(0, Math.max(0, slash))}</span>
      <span className="ml-auto shrink-0 self-center rounded-md bg-chip px-1.5 text-[11px] leading-[18px] font-normal text-fg-2">{label}</span>
    </>
  );
}

/** The commits that changed one file (following renames), each with that commit's diff of it. */
export function TimelineView({ repo, path, version, onOpenCommit, onBack, onClose }: FileViewProps) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .fileTimeline(repo, path)
      .then((t) => !stale && (setEntries(t), setError(null), setSelected((s) => (t.some((e) => e.hash === s) ? s : (t[0]?.hash ?? null)))))
      .catch((e) => !stale && setError(api.errorText(e)));
    return () => {
      stale = true;
    };
  }, [repo, path, version]);

  const entry = entries?.find((e) => e.hash === selected) ?? null;
  useEffect(() => {
    if (!entry) return;
    let stale = false;
    setDiff(null);
    setDiffError(null);
    api
      .compareFileDiff(repo, entry.base, entry.hash, entry.file)
      .then((d) => !stale && setDiff(d))
      .catch((e) => !stale && setDiffError(api.errorText(e)));
    return () => {
      stale = true;
    };
    // The entry object changes on every refetch; its hash is what matters.
  }, [repo, entry?.hash]);

  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg" aria-label={`History of ${path}`}>
      <PaneHeader icon={<HistoryIcon />} title={<FileTitle path={path} label="Timeline" />} tooltip={path} onBack={onBack} onClose={onClose} />
      <ul className="mx-3 mb-2 max-h-[40%] shrink-0 overflow-y-auto rounded-xl border border-line bg-surface py-1" aria-label="Commits">
        {entries?.map((e) => (
          <li key={e.hash} className="group mx-1 flex items-center rounded-lg hover:bg-hover">
            <button
              type="button"
              onClick={() => setSelected(e.hash)}
              aria-current={e.hash === selected || undefined}
              className={`flex min-w-0 flex-1 flex-col rounded-lg py-1 pl-2.5 text-left ${e.hash === selected ? "bg-hover" : ""}`}
            >
              <span className="truncate text-fg">{e.subject}</span>
              <span className="truncate text-[11px] leading-4 text-fg-3">
                <span className="font-mono">{e.short}</span> · {e.author} · {ago(e.dateMs)}
                {e.file.kind === "renamed" && e.file.origPath && ` · renamed from ${e.file.origPath}`}
                {e.file.kind === "added" && " · added"}
                {e.file.path !== path && e.file.kind !== "renamed" && ` · as ${e.file.path}`}
              </span>
            </button>
            <span className="shrink-0 px-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <HeaderButton label="Open commit" onClick={() => onOpenCommit({ hash: e.hash, short: e.short, subject: e.subject })}>
                <CommitIcon />
              </HeaderButton>
            </span>
          </li>
        ))}
        {error && <li className="px-3 py-2 text-[12px] break-words text-st-deleted select-text">{error}</li>}
        {!error && !entries && (
          <li className="flex justify-center py-3 text-fg-3">
            <SpinnerIcon />
          </li>
        )}
        {entries?.length === 0 && <li className="px-3 py-2 text-[12px] text-fg-3">No commits have touched this file yet.</li>}
      </ul>
      {entry && <DiffBody diff={diff} error={diffError} emptyText="No content changes in this commit." />}
    </section>
  );
}

/** Who last changed each line of the working-tree file; click a commit to open it. */
export function BlameView({ repo, path, version, onOpenCommit, onBack, onClose }: FileViewProps) {
  const [blame, setBlame] = useState<Blame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .blameFile(repo, path)
      .then((b) => !stale && (setBlame(b), setError(null)))
      .catch((e) => !stale && setError(api.errorText(e)));
    return () => {
      stale = true;
    };
  }, [repo, path, version]);

  let group = -1;
  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg" aria-label={`Blame of ${path}`}>
      <PaneHeader icon={<BlameIcon />} title={<FileTitle path={path} label="Blame" />} tooltip={path} onBack={onBack} onClose={onClose} />
      <div className="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        {error ? (
          <p className="flex flex-1 items-center justify-center px-6 text-center text-[12px] break-words text-fg-3 select-text">{error}</p>
        ) : !blame ? (
          <p className="flex flex-1 items-center justify-center text-fg-3">
            <SpinnerIcon />
          </p>
        ) : blame.lines.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-[12px] text-fg-3">The file is empty.</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[19px]">
            <table className="min-w-full border-collapse">
              <tbody>
                {blame.lines.map((l, i) => {
                  const c = blame.commits[l.commit];
                  const start = i === 0 || blame.lines[i - 1].commit !== l.commit;
                  if (start) group++;
                  return (
                    <tr key={i} className={`${group % 2 ? "bg-chip/30" : ""} ${start && i > 0 ? "border-t border-line" : ""}`}>
                      <td className="w-[1%] max-w-[170px] border-r border-line px-2 align-top font-sans text-[11px] whitespace-nowrap text-fg-3">
                        {start && (
                          <Fragment>
                            {c.uncommitted ? (
                              <span className="block w-[150px] truncate italic">Not committed yet</span>
                            ) : (
                              <button
                                type="button"
                                title={`${c.summary}\n${c.short} · ${c.author} · ${new Date(c.dateMs).toLocaleString()}`}
                                onClick={() => onOpenCommit({ hash: c.hash, short: c.short, subject: c.summary })}
                                className="block w-[150px] truncate text-left hover:text-fg"
                              >
                                <span className="font-mono text-accent-text">{c.short}</span> {c.author} · {ago(c.dateMs)}
                              </button>
                            )}
                          </Fragment>
                        )}
                      </td>
                      <td className="w-[1%] border-r border-line px-2 text-right text-fg-3 tabular-nums select-none">{l.line}</td>
                      <td className="pr-4 pl-2 whitespace-pre text-fg-2 select-text">{l.text.replace(/\r$/, "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {blame.truncated && <p className="px-3 py-2 font-sans text-[12px] text-fg-3">Blame truncated at 5,000 lines.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
