import { useEffect, useState } from "react";
import * as api from "../git/api";
import type { FileChange, FileDiff, StashEntry } from "../git/types";
import { DiffBody, HeaderButton } from "./DiffView";
import { ArrowDownIcon, StashIcon, TrashIcon, UndoIcon, XIcon } from "./icons";
import type { StashActions } from "./StashesPanel";

const LETTER: Record<string, string> = { modified: "M", added: "A", deleted: "D", untracked: "U" };
const TONE: Record<string, string> = {
  modified: "text-st-modified",
  added: "text-st-added",
  deleted: "text-st-deleted",
  untracked: "text-st-untracked",
};

/** Detail pane for one stash: its files on top, the selected file's diff below. */
export function StashView({
  repo,
  stash,
  busy,
  actions,
  onClose,
}: {
  repo: string;
  stash: StashEntry;
  busy: boolean;
  actions: StashActions;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [selected, setSelected] = useState<FileChange | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setFiles(null);
    setSelected(null);
    api
      .stashFiles(repo, stash.hash)
      .then((f) => !stale && (setFiles(f), setSelected(f[0] ?? null)))
      .catch((e) => !stale && setError(api.errorText(e)));
    return () => {
      stale = true;
    };
  }, [repo, stash.hash]);

  useEffect(() => {
    if (!selected) return;
    let stale = false;
    setDiff(null);
    api
      .stashFileDiff(repo, stash.hash, selected)
      .then((d) => !stale && (setDiff(d), setError(null)))
      .catch((e) => !stale && setError(api.errorText(e)));
    return () => {
      stale = true;
    };
  }, [repo, stash.hash, selected]);

  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg" aria-label={`Stash ${stash.message}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <StashIcon className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate font-medium text-fg" title={stash.message}>
          {stash.message}
        </span>
        <span className="shrink-0 rounded-md bg-chip px-1.5 text-[11px] leading-[18px] text-fg-2">stash@{`{${stash.index}}`}</span>
        <HeaderButton label="Apply (keep stash)" onClick={() => actions.apply(stash, false)} disabled={busy}>
          <ArrowDownIcon />
        </HeaderButton>
        <HeaderButton label="Pop (apply and drop)" onClick={() => actions.apply(stash, true)} disabled={busy}>
          <UndoIcon />
        </HeaderButton>
        <HeaderButton label="Drop stash" onClick={() => actions.drop(stash)} disabled={busy}>
          <TrashIcon />
        </HeaderButton>
        <HeaderButton label="Close (Esc)" onClick={onClose}>
          <XIcon />
        </HeaderButton>
      </header>

      <ul className="mx-3 mb-2 max-h-[30%] shrink-0 overflow-y-auto rounded-xl border border-line bg-surface py-1" aria-label="Files in stash">
        {files?.map((f) => (
          <li key={`${f.kind}:${f.path}`}>
            <button
              type="button"
              onClick={() => setSelected(f)}
              aria-current={selected === f || undefined}
              className={`mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-2 rounded-lg px-2.5 text-left ${
                selected === f ? "bg-hover" : "hover:bg-hover"
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-fg">{f.path}</span>
              <span className={`w-4 shrink-0 text-center font-mono text-[11px] font-semibold ${TONE[f.kind] ?? "text-fg-3"}`}>
                {LETTER[f.kind] ?? "?"}
              </span>
            </button>
          </li>
        ))}
        {files?.length === 0 && <li className="px-3 py-2 text-[12px] text-fg-3">This stash has no file changes.</li>}
      </ul>

      {!(files && files.length === 0) && <DiffBody diff={diff} error={error} emptyText="No changes to show." />}
    </section>
  );
}
