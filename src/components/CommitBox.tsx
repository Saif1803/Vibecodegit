import type { Ref } from "react";
import type { Step, StepState } from "../git/commitPush";
import { ArrowUpIcon, SpinnerIcon } from "./icons";
import { StepProgress } from "./StepProgress";

interface Props {
  message: string;
  onMessage: (m: string) => void;
  canCommit: boolean;
  busy: boolean;
  /** Live step states while busy. */
  steps: Partial<Record<Step, StepState>>;
  /** Ask before committing (Claude is still editing this repo). */
  confirming: boolean;
  onCommit: () => void;
  onCancel: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
}

/**
 * Styled after the Claude app's prompt box: message on top, action row below.
 * Ctrl+Enter is handled at the window level so it works from anywhere in the popup.
 */
export function CommitBox({ message, onMessage, canCommit, busy, steps, confirming, onCommit, onCancel, inputRef }: Props) {
  return (
    <div
      className={`m-3 rounded-2xl border bg-raised transition-colors ${
        confirming ? "border-accent/60" : "border-line focus-within:border-line-strong"
      }`}
    >
      <textarea
        ref={inputRef}
        value={message}
        onChange={(e) => onMessage(e.target.value)}
        readOnly={busy}
        rows={2}
        spellCheck
        placeholder="Commit message"
        aria-label="Commit message"
        className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-fg outline-none placeholder:text-fg-3 focus-visible:outline-none"
      />
      <div className="flex min-h-[42px] items-center gap-2 px-2.5 pb-2.5">
        {confirming ? (
          <>
            <span className="min-w-0 flex-1 pl-1 text-[12px] leading-4 text-accent-text">Claude is still editing here.</span>
            <button
              type="button"
              onClick={onCancel}
              className="flex h-8 shrink-0 items-center rounded-lg px-2.5 text-fg-2 hover:bg-hover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onCommit}
              autoFocus
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 font-medium text-on-accent hover:bg-accent-hover"
            >
              Commit anyway
            </button>
          </>
        ) : (
          <>
            {busy ? (
              <StepProgress steps={steps} />
            ) : (
              <span className="pl-1 text-[11px] text-fg-3">
                <kbd className="font-sans">Ctrl</kbd> + <kbd className="font-sans">Enter</kbd>
              </span>
            )}
            <button
              type="button"
              onClick={onCommit}
              disabled={!canCommit || busy}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-chip disabled:text-fg-3"
            >
              {busy ? <SpinnerIcon /> : <ArrowUpIcon />}
              Commit &amp; Push
            </button>
          </>
        )}
      </div>
    </div>
  );
}
