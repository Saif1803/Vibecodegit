import { ArrowUpIcon, SpinnerIcon } from "./icons";

interface Props {
  message: string;
  onMessage: (m: string) => void;
  canCommit: boolean;
  busy: boolean;
  onCommit: () => void;
}

/** Styled after the Claude app's prompt box: message on top, action row below. */
export function CommitBox({ message, onMessage, canCommit, busy, onCommit }: Props) {
  return (
    <div className="m-3 rounded-2xl border border-line bg-raised transition-colors focus-within:border-line-strong">
      <textarea
        value={message}
        onChange={(e) => onMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            if (canCommit && !busy) onCommit();
          }
        }}
        rows={2}
        spellCheck
        placeholder="Commit message"
        aria-label="Commit message"
        className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-fg outline-none placeholder:text-fg-3 focus-visible:outline-none"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        <span className="pl-1 text-[11px] text-fg-3">
          <kbd className="font-sans">Ctrl</kbd> + <kbd className="font-sans">Enter</kbd>
        </span>
        <button
          type="button"
          onClick={onCommit}
          disabled={!canCommit || busy}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-chip disabled:text-fg-3"
        >
          {busy ? <SpinnerIcon /> : <ArrowUpIcon />}
          Commit &amp; Push
        </button>
      </div>
    </div>
  );
}
