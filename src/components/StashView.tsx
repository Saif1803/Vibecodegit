import { useEffect, useState } from "react";
import * as api from "../git/api";
import type { FileChange, StashEntry } from "../git/types";
import { dragWindow } from "../hooks/dragWindow";
import { HeaderButton } from "./DiffView";
import { FileListDiff } from "./FileListDiff";
import { ArrowDownIcon, StashIcon, TrashIcon, UndoIcon, XIcon } from "./icons";
import type { StashActions } from "./StashesPanel";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setFiles(null);
    setError(null);
    api
      .stashFiles(repo, stash.hash)
      .then((f) => !stale && setFiles(f))
      .catch((e) => !stale && setError(api.errorText(e)));
    return () => {
      stale = true;
    };
  }, [repo, stash.hash]);

  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg" aria-label={`Stash ${stash.message}`}>
      <header onMouseDown={dragWindow} className="flex h-12 shrink-0 items-center gap-2 px-3">
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

      <FileListDiff
        files={error ? [] : files}
        error={error}
        loadDiff={(f) => api.stashFileDiff(repo, stash.hash, f)}
        emptyText="This stash has no file changes."
      />
    </section>
  );
}
