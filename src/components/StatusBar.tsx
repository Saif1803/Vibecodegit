import type { BranchInfo } from "../git/types";

interface Props {
  branch: BranchInfo;
  claudeActive: boolean;
}

/** Sync state vs upstream on the left, Claude activity on the right. */
export function StatusBar({ branch, claudeActive }: Props) {
  return (
    <div className="flex h-6 items-center gap-2 px-4 text-[12px] text-fg-3">
      <span className="min-w-0 truncate">
        {branch.head === null ? (
          "Detached HEAD"
        ) : branch.upstream === null ? (
          "No upstream"
        ) : branch.ahead === 0 && branch.behind === 0 ? (
          <>Up to date with {branch.upstream}</>
        ) : (
          <>
            <span className="tabular-nums">
              {branch.ahead > 0 && <span className="text-fg-2">↑{branch.ahead}</span>}
              {branch.ahead > 0 && branch.behind > 0 && " "}
              {branch.behind > 0 && <span className="text-fg-2">↓{branch.behind}</span>}
            </span>{" "}
            vs {branch.upstream}
          </>
        )}
      </span>
      {claudeActive && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-accent-text">
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
