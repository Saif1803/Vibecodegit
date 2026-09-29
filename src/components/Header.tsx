import type { ClaudeSessionRepo, RepoRef, SyncKind } from "../git/types";
import { dragWindow } from "../hooks/dragWindow";
import { ArrowDownIcon, ArrowUpIcon, BranchIcon, CloudDownIcon, MoreIcon, RefreshIcon, SyncIcon } from "./icons";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { RepoPicker } from "./RepoPicker";

interface Props {
  repo: RepoRef | null;
  branch: string | null;
  active: ClaudeSessionRepo[];
  recent: RepoRef[];
  onSelectRepo: (repo: RepoRef) => void;
  onBrowse: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** Remote actions; disabled while another operation runs. */
  onSync: (kind: SyncKind) => void;
  canSync: boolean;
  /** The branch chip opens the Branches tab. */
  onBranchClick: () => void;
}

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent";

export function Header(p: Props) {
  return (
    <header onMouseDown={dragWindow} className="flex h-12 shrink-0 items-center gap-1.5 px-2.5">
      <RepoPicker current={p.repo} active={p.active} recent={p.recent} onSelect={p.onSelectRepo} onBrowse={p.onBrowse} />
      {p.repo && p.branch !== null && (
        <button
          type="button"
          onClick={p.onBranchClick}
          title="Branches"
          className="flex h-[22px] max-w-[120px] min-w-0 shrink-0 items-center gap-1 rounded-md bg-chip px-1.5 text-[12px] text-fg-2 hover:text-fg"
        >
          <BranchIcon width={12} height={12} className="shrink-0" />
          <span className="truncate">{p.branch}</span>
        </button>
      )}
      <button type="button" onClick={p.onRefresh} disabled={!p.repo} title="Refresh" aria-label="Refresh" className={`ml-auto ${ICON_BUTTON}`}>
        <RefreshIcon className={p.refreshing ? "animate-spin" : undefined} />
      </button>
      <Menu label="More actions" trigger={<MoreIcon />} disabled={!p.repo} className={ICON_BUTTON}>
        {(close) => {
          const item = (kind: SyncKind) => () => {
            close();
            p.onSync(kind);
          };
          return (
            <>
              <MenuItem icon={<SyncIcon />} disabled={!p.canSync} onClick={item("sync")} hint="pull + push">
                Sync
              </MenuItem>
              <MenuItem icon={<ArrowDownIcon />} disabled={!p.canSync} onClick={item("pull")} hint="rebase">
                Pull
              </MenuItem>
              <MenuItem icon={<ArrowUpIcon />} disabled={!p.canSync} onClick={item("push")}>
                Push
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<CloudDownIcon />} disabled={!p.canSync} onClick={item("fetch")} hint="all remotes">
                Fetch
              </MenuItem>
            </>
          );
        }}
      </Menu>
    </header>
  );
}
