import type { ReactNode } from "react";
import type { ChangeSide, DiffLine, FileChange, FileDiff } from "../git/types";
import { FileIcon, MinusIcon, PlusIcon, SpinnerIcon, UndoIcon, XIcon } from "./icons";

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
export function DiffView({ file, side, diff, error, disabled, onClose, onStage, onUnstage, onDiscard }: Props) {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash < 0 ? "" : file.path.slice(0, slash);

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
          <Notice>{file.kind === "renamed" ? "Renamed without content changes." : "No changes to show."}</Notice>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[19px] select-text">
            <table className="min-w-full border-collapse">
              <tbody>
                {diff.hunks.map((h, i) => (
                  <HunkRows key={i} header={h.header} lines={h.lines} />
                ))}
              </tbody>
            </table>
            {diff.truncated && <p className="px-3 py-2 font-sans text-[12px] text-fg-3">Diff truncated at 5,000 lines.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function HunkRows({ header, lines }: { header: string; lines: DiffLine[] }) {
  return (
    <>
      <tr className="bg-chip/60 text-fg-3">
        <td colSpan={3} className="sticky left-0 px-3 py-0.5 whitespace-pre">
          {header}
        </td>
      </tr>
      {lines.map((l, i) => (
        <tr key={i} className={LINE_STYLE[l.kind]}>
          <td className="w-[1%] border-r border-line px-2 text-right text-fg-3 tabular-nums select-none">{l.old ?? ""}</td>
          <td className="w-[1%] border-r border-line px-2 text-right text-fg-3 tabular-nums select-none">{l.new ?? ""}</td>
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
      ))}
    </>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-fg-3">{children}</div>;
}

function HeaderButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
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
