import type { Ref } from "react";
import type { Step, StepState } from "../git/types";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, PencilIcon, SpinnerIcon } from "./icons";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { StepProgress } from "./StepProgress";

export type CommitAction = "commit-push" | "commit";

interface Props {
  message: string;
  onMessage: (m: string) => void;
  canCommit: boolean;
  busy: boolean;
  /** Live step states while busy, in run order. */
  stepOrder: Step[];
  steps: Partial<Record<Step, StepState>>;
  /** Ask before committing (Claude is still editing this repo). */
  confirming: boolean;
  action: CommitAction;
  onAction: (a: CommitAction) => void;
  amend: boolean;
  onAmend: (on: boolean) => void;
  /** Small note under the message: what the commit will include. */
  hint: string | null;
  onCommit: () => void;
  onCancel: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
}

export function commitLabel(action: CommitAction, amend: boolean) {
  if (amend) return action === "commit-push" ? "Amend & Push" : "Amend";
  return action === "commit-push" ? "Commit & Push" : "Commit";
}

/**
 * Styled after the Claude app's prompt box: message on top, action row below.
 * The primary button is split: its chevron switches the action and toggles Amend.
 * Ctrl+Enter is handled at the window level so it works from anywhere in the popup.
 */
export function CommitBox(p: Props) {
  const label = commitLabel(p.action, p.amend);
  return (
    <div
      className={`m-3 rounded-2xl border bg-raised transition-colors ${
        p.confirming ? "border-accent/60" : "border-line focus-within:border-line-strong"
      }`}
    >
      <textarea
        ref={p.inputRef}
        value={p.message}
        onChange={(e) => p.onMessage(e.target.value)}
        readOnly={p.busy}
        rows={2}
        spellCheck
        placeholder={p.amend ? "New message (leave empty to keep the last one)" : "Commit message"}
        aria-label="Commit message"
        className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-fg outline-none placeholder:text-fg-3 focus-visible:outline-none"
      />
      <div className="flex min-h-[42px] items-center gap-2 px-2.5 pb-2.5">
        {p.confirming ? (
          <>
            <span className="min-w-0 flex-1 pl-1 text-[12px] leading-4 text-accent-text">Claude is still editing here.</span>
            <button
              type="button"
              onClick={p.onCancel}
              className="flex h-8 shrink-0 items-center rounded-lg px-2.5 text-fg-2 hover:bg-hover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={p.onCommit}
              autoFocus
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 font-medium text-on-accent hover:bg-accent-hover"
            >
              {p.amend ? "Amend anyway" : "Commit anyway"}
            </button>
          </>
        ) : (
          <>
            {p.busy ? (
              <StepProgress order={p.stepOrder} steps={p.steps} />
            ) : (
              <span className="min-w-0 truncate pl-1 text-[11px] text-fg-3" title={p.hint ?? undefined}>
                {p.hint ?? (
                  <>
                    <kbd className="font-sans">Ctrl</kbd> + <kbd className="font-sans">Enter</kbd>
                  </>
                )}
              </span>
            )}
            <div className="ml-auto flex shrink-0">
              <button
                type="button"
                onClick={p.onCommit}
                disabled={!p.canCommit || p.busy}
                className="flex h-8 items-center gap-1.5 rounded-l-lg bg-accent pr-2.5 pl-3 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-chip disabled:text-fg-3"
              >
                {p.busy ? <SpinnerIcon /> : p.amend ? <PencilIcon /> : p.action === "commit" ? <CheckIcon /> : <ArrowUpIcon />}
                {label}
              </button>
              <Menu
                label="Commit options"
                placement="above"
                disabled={p.busy}
                trigger={<ChevronDownIcon width={14} height={14} />}
                className={`flex h-8 w-7 items-center justify-center rounded-r-lg border-l transition-colors ${
                  p.canCommit && !p.busy
                    ? "border-on-accent/25 bg-accent text-on-accent hover:bg-accent-hover"
                    : "border-line bg-chip text-fg-3 hover:text-fg-2"
                }`}
              >
                {(close) => (
                  <>
                    <MenuItem checked={p.action === "commit-push"} onClick={() => (p.onAction("commit-push"), close())}>
                      Commit &amp; Push
                    </MenuItem>
                    <MenuItem checked={p.action === "commit"} onClick={() => (p.onAction("commit"), close())}>
                      Commit
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem checked={p.amend} onClick={() => (p.onAmend(!p.amend), close())}>
                      Amend last commit
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
