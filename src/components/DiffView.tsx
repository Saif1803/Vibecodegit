import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { ChangeSide, DiffLine, FileChange, FileDiff, Hunk, HunkAction } from "../git/types";
import { BlameIcon, FileIcon, HistoryIcon, IgnoreIcon, MinusIcon, PlusIcon, SpinnerIcon, UndoIcon, XIcon } from "./icons";

interface Props {
  file: FileChange;
  side: ChangeSide;
  diff: FileDiff | null;
  error: string | null;
  disabled: boolean;
  onClose: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onTimeline: () => void;
  onBlame: () => void;
  onIgnore: () => void;
  /** Stage / unstage / discard one hunk, or picked lines of it. */
  onHunk: (hunk: Hunk, lines: number[] | null, action: HunkAction) => void;
}

const SIDE_LABEL: Record<ChangeSide, string> = {
  staged: "Staged",
  unstaged: "Working tree",
  conflicted: "Conflicted",
};

const LINE_STYLE: Record<DiffLine["kind"], string> = {
  context: "text-fg-2",
  add: "bg-st-added/10 text-fg",
  del: "bg-st-deleted/10 text-fg",
  note: "text-fg-3 italic",
};
const SIGN: Record<DiffLine["kind"], string> = { context: " ", add: "+", del: "-", note: "" };

/** The expanded detail pane: one file's diff, VS Code inline style, with its stage actions. */
export function DiffView({ file, side, diff, error, disabled, onClose, onStage, onUnstage, onDiscard, onTimeline, onBlame, onIgnore, onHunk }: Props) {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash < 0 ? "" : file.path.slice(0, slash);
  // New files have no history; blame reads the file on disk, so it needs a committed, present file.
  const committed = file.kind !== "untracked" && file.kind !== "added";
  // git can patch a modified file piece by piece; anything else stages whole.
  const partial = file.kind === "modified" && side !== "conflicted";

  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg" aria-label={`Diff of ${file.path}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <FileIcon className="shrink-0 text-fg-3" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate font-medium text-fg">{name}</span>
          <span className="min-w-0 shrink-[4] truncate text-[12px] text-fg-3">
            {file.origPath ? `${file.origPath} →` : dir}
          </span>
        </div>
        <span className="shrink-0 rounded-md bg-chip px-1.5 text-[11px] leading-[18px] text-fg-2">{SIDE_LABEL[side]}</span>
        {committed && (
          <HeaderButton label="File timeline" onClick={onTimeline}>
            <HistoryIcon />
          </HeaderButton>
        )}
        {committed && file.kind !== "deleted" && (
          <HeaderButton label="Blame" onClick={onBlame}>
            <BlameIcon />
          </HeaderButton>
        )}
        {file.kind === "untracked" && (
          <HeaderButton label="Add to .gitignore" onClick={onIgnore} disabled={disabled}>
            <IgnoreIcon />
          </HeaderButton>
        )}
        {side === "unstaged" && (
          <HeaderButton label="Discard changes" onClick={onDiscard} disabled={disabled}>
            <UndoIcon />
          </HeaderButton>
        )}
        {side === "staged" ? (
          <HeaderButton label="Unstage file" onClick={onUnstage} disabled={disabled}>
            <MinusIcon />
          </HeaderButton>
        ) : (
          <HeaderButton label={side === "conflicted" ? "Mark resolved (stage)" : "Stage file"} onClick={onStage} disabled={disabled}>
            <PlusIcon />
          </HeaderButton>
        )}
        <HeaderButton label="Close diff (Esc)" onClick={onClose}>
          <XIcon />
        </HeaderButton>
      </header>

      <DiffBody
        diff={diff}
        error={error}
        emptyText={file.kind === "renamed" ? "Renamed without content changes." : "No changes to show."}
        hunkActions={partial ? { side: side as "staged" | "unstaged", disabled, run: onHunk } : undefined}
      />
    </section>
  );
}

interface HunkActions {
  side: "staged" | "unstaged";
  disabled: boolean;
  run: (hunk: Hunk, lines: number[] | null, action: HunkAction) => void;
}

/** Picked lines: one hunk at a time, with the last click as the Shift+click anchor. */
type Picked = { hunk: number; lines: number[]; anchor: number } | null;

/** The bordered, scrollable diff itself (or a loading / binary / empty notice). */
export function DiffBody({ diff, error, emptyText, hunkActions }: { diff: FileDiff | null; error: string | null; emptyText: string; hunkActions?: HunkActions }) {
  const [picked, setPicked] = useState<Picked>(null);
  useEffect(() => setPicked(null), [diff]);

  const pick = (hunk: number, line: number, range: boolean) =>
    setPicked((p) => {
      const lines = diff!.hunks[hunk].lines;
      const changed = (i: number) => lines[i].kind === "add" || lines[i].kind === "del";
      if (p?.hunk !== hunk) return { hunk, lines: [line], anchor: line };
      if (range) {
        const [a, b] = [Math.min(p.anchor, line), Math.max(p.anchor, line)];
        const span = Array.from({ length: b - a + 1 }, (_, k) => a + k).filter(changed);
        return { ...p, lines: [...new Set([...p.lines, ...span])] };
      }
      const on = p.lines.includes(line);
      const next = on ? p.lines.filter((x) => x !== line) : [...p.lines, line];
      return next.length ? { hunk, lines: next, anchor: line } : null;
    });

  return (
    <div className="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      {error ? (
        <Notice>{error}</Notice>
      ) : !diff ? (
        <Notice>
          <SpinnerIcon />
        </Notice>
      ) : diff.binary ? (
        <Notice>Binary file. No text diff to show.</Notice>
      ) : diff.hunks.length === 0 ? (
        <Notice>{emptyText}</Notice>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[19px] select-text">
          <table className="min-w-full border-collapse">
            <tbody>
              {diff.hunks.map((h, i) => (
                <HunkRows
                  key={i}
                  hunk={h}
                  actions={hunkActions}
                  picked={picked?.hunk === i ? picked.lines : []}
                  onPick={hunkActions ? (line, range) => pick(i, line, range) : undefined}
                  onRun={(lines, action) => {
                    setPicked(null);
                    hunkActions?.run(h, lines, action);
                  }}
                />
              ))}
            </tbody>
          </table>
          {diff.truncated && <p className="px-3 py-2 font-sans text-[12px] text-fg-3">Diff truncated at 5,000 lines.</p>}
        </div>
      )}
    </div>
  );
}

function HunkButton({ children, onClick, disabled, danger }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-md border border-line bg-raised px-1.5 font-sans text-[11px] leading-[18px] select-none disabled:opacity-40 ${
        danger ? "text-fg-3 hover:text-st-deleted" : "text-fg-2 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function HunkRows({
  hunk,
  actions,
  picked,
  onPick,
  onRun,
}: {
  hunk: Hunk;
  actions?: HunkActions;
  picked: number[];
  onPick?: (line: number, range: boolean) => void;
  onRun: (lines: number[] | null, action: HunkAction) => void;
}) {
  const what = picked.length ? `${picked.length} line${picked.length === 1 ? "" : "s"}` : "hunk";
  const lines = picked.length ? picked : null;
  return (
    <>
      <tr className="bg-chip/60 text-fg-3">
        <td colSpan={3} className="sticky left-0 px-3 py-0.5">
          <span className="flex items-center gap-1.5" title={actions ? "Click line numbers to pick lines (Shift+click for a range)" : undefined}>
            {actions?.side === "unstaged" && (
              <>
                <HunkButton onClick={() => onRun(lines, "stage")} disabled={actions.disabled}>
                  Stage {what}
                </HunkButton>
                <HunkButton onClick={() => onRun(lines, "discard")} disabled={actions.disabled} danger>
                  Discard {what}
                </HunkButton>
              </>
            )}
            {actions?.side === "staged" && (
              <HunkButton onClick={() => onRun(lines, "unstage")} disabled={actions.disabled}>
                Unstage {what}
              </HunkButton>
            )}
            <span className="whitespace-pre">{hunk.header}</span>
          </span>
        </td>
      </tr>
      {hunk.lines.map((l, i) => {
        const changed = l.kind === "add" || l.kind === "del";
        const isPicked = picked.includes(i);
        const gutter = `w-[1%] border-r border-line px-2 text-right tabular-nums select-none ${
          isPicked ? "text-accent-text" : "text-fg-3"
        } ${onPick && changed ? "cursor-pointer hover:text-fg" : ""}`;
        const click = onPick && changed ? (e: MouseEvent) => onPick(i, e.shiftKey) : undefined;
        return (
          <tr key={i} className={isPicked ? "bg-accent/20 text-fg" : LINE_STYLE[l.kind]} aria-selected={isPicked || undefined}>
            <td className={`${gutter} ${isPicked ? "shadow-[inset_3px_0_0_var(--accent)]" : ""}`} onClick={click}>
              {l.old ?? ""}
            </td>
            <td className={gutter} onClick={click}>
              {l.new ?? ""}
            </td>
            <td className="pr-4 whitespace-pre">
              <span
                className={`inline-block w-5 text-center select-none ${
                  l.kind === "add" ? "text-st-added" : l.kind === "del" ? "text-st-deleted" : "text-fg-3"
                }`}
              >
                {SIGN[l.kind]}
              </span>
              {l.text.replace(/\r$/, "")}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-fg-3">{children}</div>;
}

export function HeaderButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}
