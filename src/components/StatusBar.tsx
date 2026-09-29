import type { BranchInfo } from "../git/types";
import { dragWindow } from "../hooks/dragWindow";
import { ArrowUpIcon, SyncIcon } from "./icons";

interface Props {
  branch: BranchInfo | null;
  claudeActive: boolean;
  busy: boolean;
  /** Sync with the upstream, or publish when there is none (VS Code's status-bar button). */
  onSync: () => void;
}

/** Sync state vs upstream on the left (clickable), Claude activity on the right. */
export function StatusBar({ branch, claudeActive, busy, onSync }: Props) {
  const canSync = !!branch && branch.head !== null && branch.hasCommits;
  const content =
    branch === null ? null : branch.head === null ? (
      "Detached HEAD"
    ) : branch.upstream === null ? (
      <>
        <ArrowUpIcon width={12} height={12} /> Publish branch
      </>
    ) : branch.ahead === 0 && branch.behind === 0 ? (
      <>
        <SyncIcon width={12} height={12} /> Up to date with {branch.upstream}
      </>
    ) : (
      <>
        <SyncIcon width={12} height={12} />
        <span className="tabular-nums">
          {branch.behind > 0 && <span className="text-fg-2">↓{branch.behind}</span>}
          {branch.ahead > 0 && branch.behind > 0 && " "}
          {branch.ahead > 0 && <span className="text-fg-2">↑{branch.ahead}</span>}
        </span>
        vs {branch.upstream}
      </>
    );

  return (
    <div onMouseDown={dragWindow} className="flex h-6 items-center gap-2 px-2.5 text-[12px] text-fg-3">
      {canSync ? (
        <button
          type="button"
          onClick={onSync}
          disabled={busy}
          title={branch!.upstream ? "Sync: pull, then push" : "Publish this branch to origin"}
          className="flex h-6 min-w-0 items-center gap-1 truncate rounded-md px-1.5 hover:bg-hover hover:text-fg-2 disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {content}
        </button>
      ) : (
        <span className="min-w-0 truncate px-1.5">{content}</span>
      )}
      {claudeActive && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pr-1.5 text-accent-text">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
          </span>
          Claude is working here
        </span>
      )}
    </div>
  );
}
