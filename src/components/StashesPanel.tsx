import { useState } from "react";
import * as api from "../git/api";
import type { StashEntry, StashMode } from "../git/types";
import { ago } from "../lib/time";
import { ArrowDownIcon, ChevronDownIcon, StashIcon, TrashIcon, UndoIcon } from "./icons";
import { ListState, Panel, Row, useList, type PanelOps } from "./ListParts";
import { Menu, MenuItem, MenuSeparator } from "./Menu";

const MODES: { mode: StashMode; label: string; hint: string }[] = [
  { mode: "tracked", label: "Stash", hint: "tracked changes" },
  { mode: "include-untracked", label: "Stash (include untracked)", hint: "+ new files" },
  { mode: "staged", label: "Stash staged", hint: "staged only" },
];

export interface StashActions {
  apply: (s: StashEntry, pop: boolean) => void;
  drop: (s: StashEntry) => void;
}

/** Save work in progress; list, open, apply, pop and drop stashes. */
export function StashesPanel({
  ops,
  open,
  openHash,
  actions,
}: {
  ops: PanelOps;
  /** Show a stash's files and diffs in the detail pane. */
  open: (s: StashEntry) => void;
  openHash: string | null;
  actions: StashActions;
}) {
  const { repo, busy, run, confirm, version } = ops;
  const stashes = useList(() => api.listStashes(repo), [repo, version]);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<StashMode>("tracked");
  const chosen = MODES.find((m) => m.mode === mode)!;

  const save = async () => {
    const err = await run((r) => api.stashPush(r, message, mode), "Stashed your changes.");
    if (!err) setMessage("");
  };

  const menu = (s: StashEntry) => (close: () => void) => {
    const item = (fn: () => void) => () => (close(), fn());
    return (
      <>
        <MenuItem icon={<ArrowDownIcon />} disabled={busy} onClick={item(() => actions.apply(s, false))} hint="keep stash">
          Apply
        </MenuItem>
        <MenuItem icon={<UndoIcon />} disabled={busy} onClick={item(() => actions.apply(s, true))} hint="apply + drop">
          Pop
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<TrashIcon />} disabled={busy} onClick={item(() => actions.drop(s))}>
          Drop…
        </MenuItem>
      </>
    );
  };

  const items = stashes.items ?? [];
  return (
    <Panel
      toolbar={
        <form
          className="flex min-w-0 flex-1 gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Stash message (optional)"
            aria-label="Stash message"
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-fg outline-none select-text placeholder:text-fg-3 focus:border-line-strong focus-visible:outline-none"
          />
          <div className="flex shrink-0">
            <button
              type="submit"
              disabled={busy}
              title={`${chosen.label}: ${chosen.hint}`}
              className="flex h-8 items-center gap-1.5 rounded-l-lg border border-line px-2.5 text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              <StashIcon />
              {mode === "tracked" ? "Stash" : mode === "staged" ? "Stash staged" : "Stash all"}
            </button>
            <Menu
              label="Stash options"
              trigger={<ChevronDownIcon width={14} height={14} />}
              disabled={busy}
              className="flex h-8 w-7 items-center justify-center rounded-r-lg border border-l-0 border-line text-fg-3 hover:bg-hover hover:text-fg"
            >
              {(close) => (
                <>
                  {MODES.map((m) => (
                    <MenuItem key={m.mode} checked={m.mode === mode} hint={m.hint} onClick={() => (setMode(m.mode), close())}>
                      {m.label}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem
                    icon={<TrashIcon />}
                    disabled={items.length === 0}
                    onClick={() => (
                      close(),
                      confirm({
                        title: `Drop all ${items.length} stashes?`,
                        body: "Every stash is deleted. This is very hard to undo.",
                        items: items.map((s) => s.message),
                        confirmLabel: "Drop all",
                        danger: true,
                        onConfirm: () => void run((r) => api.stashClear(r), "Dropped all stashes."),
                      })
                    )}
                  >
                    Drop all…
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </form>
      }
    >
      <ListState items={stashes.items} error={stashes.error} empty="No stashes. Stash to set work aside without committing it." />
      {items.map((s) => (
        <Row
          key={s.hash}
          icon={<StashIcon />}
          title={s.message}
          detail={`stash@{${s.index}}${s.branch ? ` · on ${s.branch}` : ""} · ${ago(s.dateMs)}`}
          active={openHash === s.hash}
          onClick={() => open(s)}
          menu={menu(s)}
        />
      ))}
    </Panel>
  );
}
