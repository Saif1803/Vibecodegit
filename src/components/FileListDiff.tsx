import { useEffect, useState } from "react";
import { errorText } from "../git/api";
import type { FileChange, FileDiff } from "../git/types";
import { DiffBody } from "./DiffView";
import { FileTypeIcon } from "./fileIcons";

const LETTER: Record<string, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "!" };
const TONE: Record<string, string> = {
  modified: "text-st-modified",
  added: "text-st-added",
  deleted: "text-st-deleted",
  renamed: "text-st-renamed",
  untracked: "text-st-untracked",
  conflicted: "text-st-conflict",
};

/**
 * A change set in the detail pane (a stash, a commit, a comparison): its files on top,
 * the selected file's diff below. `files` null means still loading.
 */
export function FileListDiff({
  files,
  loadDiff,
  error,
  emptyText,
}: {
  files: FileChange[] | null;
  loadDiff: (file: FileChange) => Promise<FileDiff>;
  error?: string | null;
  emptyText: string;
}) {
  const [selected, setSelected] = useState<FileChange | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  // A refetched change set keeps the selected file (and reloads its diff); otherwise the first.
  useEffect(
    () => setSelected((prev) => files?.find((f) => prev && f.path === prev.path && f.kind === prev.kind) ?? files?.[0] ?? null),
    [files],
  );

  useEffect(() => {
    if (!selected) return;
    let stale = false;
    setDiff(null);
    setDiffError(null);
    loadDiff(selected)
      .then((d) => !stale && setDiff(d))
      .catch((e) => !stale && setDiffError(errorText(e)));
    return () => {
      stale = true;
    };
    // loadDiff is recreated every render; the selection is what matters.
  }, [selected]);

  return (
    <>
      <ul className="mx-3 mb-2 max-h-[30%] shrink-0 overflow-y-auto rounded-xl border border-line bg-surface py-1" aria-label="Files">
        {files?.map((f) => {
          const slash = f.path.lastIndexOf("/");
          return (
            <li key={`${f.kind}:${f.path}`}>
              <button
                type="button"
                onClick={() => setSelected(f)}
                aria-current={selected === f || undefined}
                title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                className={`mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-2 rounded-lg px-2.5 text-left ${
                  selected === f ? "bg-hover" : "hover:bg-hover"
                }`}
              >
                <FileTypeIcon path={f.path} className={f.kind === "deleted" ? "opacity-50" : ""} />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className={`truncate text-fg ${f.kind === "deleted" ? "line-through decoration-fg-3" : ""}`}>{f.path.slice(slash + 1)}</span>
                  <span className="min-w-0 shrink-[4] truncate text-[12px] text-fg-3">
                    {f.origPath ? `← ${f.origPath}` : f.path.slice(0, Math.max(0, slash))}
                  </span>
                </span>
                <span className={`w-4 shrink-0 text-center font-mono text-[11px] font-semibold ${TONE[f.kind] ?? "text-fg-3"}`}>
                  {LETTER[f.kind] ?? "?"}
                </span>
              </button>
            </li>
          );
        })}
        {error && <li className="px-3 py-2 text-[12px] break-words text-st-deleted select-text">{error}</li>}
        {!error && files === null && <li className="px-3 py-2 text-[12px] text-fg-3">Loading…</li>}
        {!error && files?.length === 0 && <li className="px-3 py-2 text-[12px] text-fg-3">{emptyText}</li>}
      </ul>

      {files && files.length > 0 && (
        <DiffBody
          diff={diff}
          error={diffError}
          emptyText={selected?.kind === "renamed" ? "Renamed without content changes." : "No changes to show."}
        />
      )}
    </>
  );
}
