import type { Ref } from "react";
import type { ClaudePrompt, Step, StepState } from "../git/types";
import { ago } from "../lib/time";
import { promptToMessage } from "../state/prompts";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, FlagIcon, PencilIcon, PromptIcon, SpinnerIcon, UndoIcon } from "./icons";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { StepProgress } from "./StepProgress";

export type CommitAction = "commit-push" | "commit";

/** The commit button's icons, a step down from the 16 px default. */
const ICON = { width: 14, height: 14 };

interface Props {
  message: string;
  onMessage: (m: string) => void;
  canCommit: boolean;
  busy: boolean;
  /** Live step states while busy, in run order. */
  stepOrder: Step[];
  steps: Partial<Record<Step, StepState>>;
  /** Ask before committing when a coding agent was recently active in this repo. */
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
  /** What you asked Claude here since the last commit, newest first: message suggestions. */
  prompts: ClaudePrompt[];
  /** Commit everything locally as a restore point (no push). */
  onCheckpoint: () => void;
  canCheckpoint: boolean;
  /** Undo the last commit, keeping its changes staged. */
  onUndo: () => void;
  canUndo: boolean;
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
  const suggestion = p.prompts.length > 0 ? promptToMessage(p.prompts[0].text) : "";
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
        onKeyDown={(e) => {
          // Tab takes the newest suggestion while the box is empty, like accepting ghost text.
          if (e.key === "Tab" && !e.shiftKey && !p.message && suggestion && !p.amend) {
            e.preventDefault();
            p.onMessage(suggestion);
          }
        }}
        placeholder={
          p.amend ? "New message (leave empty to keep the last one)" : suggestion ? `Commit message (Tab: “${suggestion}”)` : "Commit message"
        }
        aria-label="Commit message"
        className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-fg outline-none placeholder:text-fg-3 focus-visible:outline-none"
      />
      <div className="flex min-h-[42px] items-center gap-2 px-2.5 pb-2.5">
        {p.confirming ? (
          <>
            <span className="min-w-0 flex-1 pl-1 text-[12px] leading-4 text-accent-text">An agent is still editing here.</span>
            <button
              type="button"
              onClick={p.onCancel}
              className="flex h-7 shrink-0 items-center rounded-lg px-2 text-[12px] text-fg-2 hover:bg-hover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={p.onCommit}
              autoFocus
              className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 text-[12px] font-medium text-on-accent hover:bg-accent-hover"
            >
              {p.amend ? "Amend anyway" : "Commit anyway"}
            </button>
          </>
        ) : (
          <>
            {!p.busy && p.prompts.length > 0 && (
              <Menu
                label="Use one of your Claude prompts"
                placement="above"
                align="left"
                trigger={<PromptIcon />}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg"
              >
                {(close) => (
                  <>
                    <p className="px-2 pt-1 pb-1.5 text-[11px] text-fg-3">Your prompts since the last commit</p>
                    {p.prompts.map((pr) => (
                      <MenuItem key={pr.atMs} hint={ago(pr.atMs)} onClick={() => (p.onMessage(promptToMessage(pr.text)), close())}>
                        <span className="block max-w-[260px] truncate" title={pr.text}>
                          {promptToMessage(pr.text)}
                        </span>
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>
            )}
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
                className="flex h-7 items-center gap-1 rounded-l-lg bg-accent pr-2 pl-2.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-chip disabled:text-fg-3"
              >
                {p.busy ? <SpinnerIcon {...ICON} /> : p.amend ? <PencilIcon {...ICON} /> : p.action === "commit" ? <CheckIcon {...ICON} /> : <ArrowUpIcon {...ICON} />}
                {label}
              </button>
              <Menu
                label="Commit options"
                placement="above"
                disabled={p.busy}
                trigger={<ChevronDownIcon width={12} height={12} />}
                className={`flex h-7 w-6 items-center justify-center rounded-r-lg border-l transition-colors ${
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
                    <MenuSeparator />
                    <MenuItem icon={<FlagIcon />} hint="local" disabled={!p.canCheckpoint} onClick={() => (close(), p.onCheckpoint())}>
                      Checkpoint everything
                    </MenuItem>
                    <MenuItem icon={<UndoIcon />} disabled={!p.canUndo} onClick={() => (close(), p.onUndo())}>
                      Undo last commit
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
