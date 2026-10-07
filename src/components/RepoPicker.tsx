import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentSessionRepo, RepoRef } from "../git/types";
import { ago } from "../lib/time";
import { CheckIcon, ChevronDownIcon, FolderIcon, FolderPlusIcon } from "./icons";

interface Props {
  current: RepoRef | null;
  active: AgentSessionRepo[];
  recent: RepoRef[];
  onSelect: (repo: RepoRef) => void;
  onBrowse: () => void;
}

export function RepoPicker({ current, active, recent, onSelect, onBrowse }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so Esc closes the menu before the window-level Esc hides the popup.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const activePaths = new Set(active.map((r) => r.path));
  const recentOnly = recent.filter((r) => !activePaths.has(r.path));
  const pick = (repo: RepoRef) => {
    setOpen(false);
    onSelect(repo);
  };

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 font-medium text-fg hover:bg-hover"
      >
        <FolderIcon className="shrink-0 text-fg-2" />
        <span className="truncate">{current?.name ?? "Choose a repository"}</span>
        <ChevronDownIcon className="shrink-0 text-fg-3" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-20 mt-1 w-[300px] rounded-xl border border-line bg-raised p-1 shadow-pop"
        >
          {active.length > 0 && (
            <Group label="Active in coding agents">
              {active.map((r) => (
                <Item key={r.path} repo={r} selected={r.path === current?.path} onPick={pick}>
                  <span className="text-[11px] text-fg-3 tabular-nums">{r.agents.map((agent) => agent.name).join(", ")} · {ago(r.lastActiveMs)}</span>
                </Item>
              ))}
            </Group>
          )}
          {recentOnly.length > 0 && (
            <Group label="Recent">
              {recentOnly.map((r) => (
                <Item key={r.path} repo={r} selected={r.path === current?.path} onPick={pick} />
              ))}
            </Group>
          )}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onBrowse();
            }}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-fg-2 hover:bg-hover hover:text-fg"
          >
            <FolderPlusIcon />
            Open folder…
          </button>
        </div>
      )}
    </div>
  );
}

/** `C:\Users\me\x` → `~\x`, so the informative end of the path fits. */
function tildify(path: string) {
  return path.replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pb-1">
      <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-fg-3">{label}</div>
      {children}
    </div>
  );
}

function Item({
  repo,
  selected,
  onPick,
  children,
}: {
  repo: RepoRef;
  selected: boolean;
  onPick: (r: RepoRef) => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={() => onPick(repo)}
      title={repo.path}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-accent-text">
        {selected && <CheckIcon width={14} height={14} strokeWidth={1.8} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-fg">{repo.name}</span>
        <span className="block truncate text-[11px] leading-4 text-fg-3">{tildify(repo.path)}</span>
      </span>
      {children}
    </button>
  );
}
