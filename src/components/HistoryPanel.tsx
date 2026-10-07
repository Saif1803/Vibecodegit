import { useEffect, useState, type ReactNode } from "react";
import * as api from "../git/api";
import type { Commit, History, RefKind } from "../git/types";
import { ago } from "../lib/time";
import { commitRef, type CommitActions } from "./commitActions";
import { GraphCell, graphLanes } from "./CommitGraph";
import { BranchIcon, MoreIcon, SpinnerIcon, TagIcon } from "./icons";
import { Badge, ListState, Panel, SearchInput, type PanelOps } from "./ListParts";
import { Menu } from "./Menu";
import { VirtualList } from "./VirtualList";

const PAGE = 200;
const ROW_H = 40;
const ALL_KEY = "claudegit.historyAll";
const REF_ORDER: Record<RefKind, number> = { head: 0, branch: 1, remote: 2, tag: 3 };

function readAll(): boolean {
  try {
    return localStorage.getItem(ALL_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The History tab: a `git log --graph`-style list of HEAD and its upstream (or every branch),
 * 200 commits at a time. Click opens a commit; Ctrl+click compares it with the open one.
 */
export function HistoryPanel({ ops, actions, openHash }: { ops: PanelOps; actions: CommitActions; openHash: string | null }) {
  const { repo, version } = ops;
  const [limit, setLimit] = useState(PAGE);
  const [all, setAllState] = useState(readAll);
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setLimit(PAGE), [repo, all]);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    api
      .history(repo, limit, all)
      .then((h) => !stale && (setData(h), setError(null)))
      .catch((e) => !stale && setError(api.errorText(e)))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [repo, version, limit, all]);

  const setAll = (v: boolean) => {
    setAllState(v);
    try {
      localStorage.setItem(ALL_KEY, v ? "1" : "0");
    } catch {
      // Not persisted.
    }
  };

  const commits = data?.commits ?? [];
  const q = filter.trim().toLowerCase();
  const shown = q
    ? commits.filter(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.hash.startsWith(q) ||
          c.refs.some((r) => r.name.toLowerCase().includes(q)),
      )
    : commits;
  // A filtered list has gaps, so its graph would lie; show it only for the full list.
  const lanes = q ? 0 : graphLanes(commits.map((c) => c.graph));

  const click = (c: Commit, ctrl: boolean) => {
    const open = openHash && openHash !== c.hash ? commits.find((x) => x.hash === openHash) : undefined;
    if (!ctrl || !open) return actions.open(commitRef(c));
    // Older on the left: further down the list is older.
    const [base, target] = commits.indexOf(open) > commits.indexOf(c) ? [open, c] : [c, open];
    actions.compare(commitRef(base), commitRef(target));
  };

  return (
    <Panel
      toolbar={
        <>
          <SearchInput value={filter} onChange={setFilter} placeholder="Filter by message, author, hash" />
          <button
            type="button"
            onClick={() => setAll(!all)}
            aria-pressed={all}
            title={all ? "Showing every branch, remote and tag" : `Showing ${data?.upstream ? `HEAD and ${data.upstream}` : "HEAD"}`}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 hover:text-fg ${
              all ? "border-line-strong bg-hover text-fg" : "border-line text-fg-2 hover:bg-hover"
            }`}
          >
            <BranchIcon />
            All branches
          </button>
        </>
      }
    >
      <ListState items={data ? commits : null} error={error} empty="No commits yet." />
      <VirtualList
        items={shown}
        itemHeight={ROW_H}
        keyExtractor={(c) => c.hash}
        renderItem={(c) => (
          <HistoryRow
            commit={c}
            lanes={lanes}
            active={c.hash === openHash}
            selected={actions.selected?.hash === c.hash}
            onClick={(ctrl) => click(c, ctrl)}
            menu={(close) => actions.menu(commitRef(c), close)}
          />
        )}
      />
      {q && shown.length === 0 && commits.length > 0 && <p className="px-4 py-6 text-center text-[12px] text-fg-3">No loaded commit matches.</p>}
      {data?.more && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          disabled={loading}
          className="mx-1 mt-1 flex h-8 w-[calc(100%-8px)] items-center justify-center gap-2 rounded-lg text-[12px] text-fg-3 hover:bg-hover hover:text-fg disabled:opacity-60"
        >
          {loading ? <SpinnerIcon /> : `Load ${PAGE} more${q ? " (the filter only searches loaded commits)" : ""}`}
        </button>
      )}
    </Panel>
  );
}

function HistoryRow({
  commit: c,
  lanes,
  active,
  selected,
  onClick,
  menu,
}: {
  commit: Commit;
  lanes: number;
  active: boolean;
  selected: boolean;
  onClick: (ctrl: boolean) => void;
  menu: (close: () => void) => ReactNode;
}) {
  const refs = [...c.refs].sort((a, b) => REF_ORDER[a.kind] - REF_ORDER[b.kind]);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active || undefined}
      title={`${c.subject}\n${c.short} · ${c.author} · ${new Date(c.dateMs).toLocaleString()}${selected ? "\nSelected for compare" : ""}`}
      onClick={(e) => onClick(e.ctrlKey || e.metaKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onClick(e.ctrlKey);
      }}
      style={{ height: ROW_H }}
      className={`group mx-1 flex cursor-default items-stretch gap-1.5 rounded-lg pr-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
        active ? "bg-hover" : "hover:bg-hover"
      } ${selected ? "ring-1 ring-accent/50" : ""} ${lanes === 0 ? "pl-2.5" : ""}`}
    >
      {lanes > 0 && <GraphCell commit={c} lanes={lanes} height={ROW_H} />}
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex min-w-0 items-center gap-1">
          <span className={`min-w-0 truncate ${c.incoming ? "text-fg-2" : "text-fg"}`}>{c.subject}</span>
          {refs.slice(0, 3).map((r) => (
            <Badge key={`${r.kind}:${r.name}`} tone={r.kind === "head" ? "accent" : "muted"}>
              <span className="flex max-w-[110px] items-center gap-0.5 truncate">
                {r.kind === "tag" && <TagIcon width={10} height={10} className="shrink-0" />}
                <span className="truncate">{r.name}</span>
              </span>
            </Badge>
          ))}
          {refs.length > 3 && <Badge>+{refs.length - 3}</Badge>}
        </span>
        <span className="truncate text-[11px] leading-4 text-fg-3">
          <span className="font-mono">{c.short}</span> · {c.author} · {ago(c.dateMs)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {c.incoming && (
          <span title="Incoming: on the upstream, not pulled yet">
            <Badge>↓</Badge>
          </span>
        )}
        {c.outgoing && (
          <span title="Outgoing: not pushed yet">
            <Badge tone="accent">↑</Badge>
          </span>
        )}
        <span
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Menu label="Commit actions" trigger={<MoreIcon />} className="flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-chip hover:text-fg">
            {menu}
          </Menu>
        </span>
      </span>
    </div>
  );
}
