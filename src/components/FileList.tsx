import type { ChangeKind, FileChange } from "../git/types";
import { Checkbox } from "./Checkbox";

const BADGE: Record<ChangeKind, { letter: string; className: string; label: string }> = {
  modified: { letter: "M", className: "text-st-modified", label: "Modified" },
  added: { letter: "A", className: "text-st-added", label: "Added" },
  deleted: { letter: "D", className: "text-st-deleted", label: "Deleted" },
  renamed: { letter: "R", className: "text-st-renamed", label: "Renamed" },
  untracked: { letter: "U", className: "text-st-untracked", label: "Untracked" },
  conflicted: { letter: "!", className: "text-st-conflict", label: "Conflicted" },
};

interface Props {
  files: FileChange[];
  selected: Set<string>;
  onToggle: (path: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
}

function split(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

export function FileList({ files, selected, onToggle, onToggleAll }: Props) {
  const count = files.filter((f) => selected.has(f.path)).length;
  const all = files.length > 0 && count === files.length;

  return (
    <section className="mx-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex h-9 shrink-0 items-center gap-2.5 border-b border-line px-3">
        <Checkbox
          label="Select all files"
          checked={all}
          indeterminate={count > 0 && !all}
          disabled={files.length === 0}
          onChange={() => onToggleAll(!all)}
        />
        <span className="font-medium text-fg-2">Changes</span>
        <span className="rounded-md bg-chip px-1.5 text-[11px] leading-[18px] text-fg-2 tabular-nums">
          {files.length}
        </span>
        {files.length > 0 && (
          <span className="ml-auto text-[12px] text-fg-3 tabular-nums">{count} selected</span>
        )}
      </header>

      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-fg-3">Working tree clean</div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {files.map((f) => {
            const badge = BADGE[f.kind];
            const { dir, name } = split(f.path);
            const checked = selected.has(f.path);
            return (
              <li key={f.path}>
                <div
                  onClick={() => onToggle(f.path, !checked)}
                  title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                  className="mx-1 flex h-7 cursor-default items-center gap-2.5 rounded-lg px-2 hover:bg-hover"
                >
                  <Checkbox label={`Include ${f.path}`} checked={checked} onChange={(c) => onToggle(f.path, c)} />
                  <span
                    aria-label={badge.label}
                    className={`w-3 shrink-0 text-center font-mono text-[11px] font-semibold ${badge.className}`}
                  >
                    {badge.letter}
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className={`min-w-0 truncate ${f.kind === "deleted" ? "text-fg-3 line-through" : "text-fg"}`}>
                      {name}
                    </span>
                    <span className="min-w-0 shrink-[4] truncate text-[12px] text-fg-3">
                      {f.origPath ? `← ${split(f.origPath).name}` : dir}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
