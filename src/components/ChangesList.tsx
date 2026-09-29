import { useState, type ReactNode } from "react";
import type { ChangeKind, ChangeSide, FileChange } from "../git/types";
import { ChevronDownIcon, MinusIcon, PlusIcon, UndoIcon } from "./icons";

const BADGE: Record<ChangeKind, { letter: string; className: string; label: string }> = {
  modified: { letter: "M", className: "text-st-modified", label: "Modified" },
  added: { letter: "A", className: "text-st-added", label: "Added" },
  deleted: { letter: "D", className: "text-st-deleted", label: "Deleted" },
  renamed: { letter: "R", className: "text-st-renamed", label: "Renamed" },
  untracked: { letter: "U", className: "text-st-untracked", label: "Untracked" },
  conflicted: { letter: "!", className: "text-st-conflict", label: "Conflicted" },
};

export interface ChangeActions {
  open: (file: FileChange, side: ChangeSide) => void;
  stage: (files: FileChange[]) => void;
  unstage: (files: FileChange[]) => void;
  discard: (files: FileChange[]) => void;
}

interface Props extends ChangeActions {
  staged: FileChange[];
  unstaged: FileChange[];
  conflicted: FileChange[];
  /** The row whose diff is open. */
  active: { path: string; side: ChangeSide } | null;
  /** While an operation runs, row actions are disabled. */
  disabled: boolean;
  /** Replaces the list (loading, no repo, errors, clean tree). */
  empty?: ReactNode;
}

function split(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

/** VS Code's Source Control list: Merge Changes, Staged Changes, Changes. */
export function ChangesList({ staged, unstaged, conflicted, active, disabled, empty, ...act }: Props) {
  const total = staged.length + unstaged.length + conflicted.length;
  return (
    <section className="mx-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      {empty !== undefined ? (
        empty
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-1" aria-label={`${total} changed files`}>
          {conflicted.length > 0 && (
            <Section
              title="Merge Changes"
              files={conflicted}
              side="conflicted"
              active={active}
              disabled={disabled}
              onOpen={act.open}
              bulk={[{ label: "Mark all resolved", icon: <PlusIcon />, run: () => act.stage(conflicted) }]}
              rowActions={(f) => [{ label: "Mark resolved (stage)", icon: <PlusIcon />, run: () => act.stage([f]) }]}
            />
          )}
          {staged.length > 0 && (
            <Section
              title="Staged Changes"
              files={staged}
              side="staged"
              active={active}
              disabled={disabled}
              onOpen={act.open}
              bulk={[{ label: "Unstage all", icon: <MinusIcon />, run: () => act.unstage(staged) }]}
              rowActions={(f) => [{ label: "Unstage", icon: <MinusIcon />, run: () => act.unstage([f]) }]}
            />
          )}
          {unstaged.length > 0 && (
            <Section
              title="Changes"
              files={unstaged}
              side="unstaged"
              active={active}
              disabled={disabled}
              onOpen={act.open}
              bulk={[
                { label: "Discard all changes", icon: <UndoIcon />, run: () => act.discard(unstaged) },
                { label: "Stage all", icon: <PlusIcon />, run: () => act.stage(unstaged) },
              ]}
              rowActions={(f) => [
                { label: "Discard changes", icon: <UndoIcon />, run: () => act.discard([f]) },
                { label: "Stage", icon: <PlusIcon />, run: () => act.stage([f]) },
              ]}
            />
          )}
        </div>
      )}
    </section>
  );
}

interface Action {
  label: string;
  icon: ReactNode;
  run: () => void;
}

function Section({
  title,
  files,
  side,
  active,
  disabled,
  onOpen,
  bulk,
  rowActions,
}: {
  title: string;
  files: FileChange[];
  side: ChangeSide;
  active: Props["active"];
  disabled: boolean;
  onOpen: ChangeActions["open"];
  bulk: Action[];
  rowActions: (f: FileChange) => Action[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div role="group" aria-label={title}>
      <header className="group sticky top-0 z-10 flex h-8 items-center gap-1 bg-surface pr-1.5 pl-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-[12px] font-medium text-fg-2 hover:text-fg"
        >
          <ChevronDownIcon width={12} height={12} className={`shrink-0 text-fg-3 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          <span className="truncate">{title}</span>
        </button>
        <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          {bulk.map((a) => (
            <IconButton key={a.label} action={a} disabled={disabled} />
          ))}
        </span>
        <span className="rounded-md bg-chip px-1.5 text-[11px] leading-[18px] text-fg-2 tabular-nums">{files.length}</span>
      </header>
      {!collapsed && (
        <ul>
          {files.map((f) => {
            const badge = BADGE[f.kind];
            const { dir, name } = split(f.path);
            const isActive = active?.path === f.path && active.side === side;
            return (
              <li key={f.path}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-current={isActive || undefined}
                  onClick={() => onOpen(f, side)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.ctrlKey) onOpen(f, side);
                  }}
                  title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                  className={`group mx-1 flex h-7 cursor-default items-center gap-2 rounded-lg pr-1 pl-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
                    isActive ? "bg-hover" : "hover:bg-hover"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className={`min-w-0 truncate ${f.kind === "deleted" ? "text-fg-3 line-through" : "text-fg"}`}>{name}</span>
                    <span className="min-w-0 shrink-[4] truncate text-[12px] text-fg-3">
                      {f.origPath ? `← ${split(f.origPath).name}` : dir}
                    </span>
                  </span>
                  <span className="hidden shrink-0 group-focus-within:flex group-hover:flex">
                    {rowActions(f).map((a) => (
                      <IconButton key={a.label} action={a} disabled={disabled} />
                    ))}
                  </span>
                  <span
                    aria-label={badge.label}
                    title={badge.label}
                    className={`w-4 shrink-0 text-center font-mono text-[11px] font-semibold ${badge.className}`}
                  >
                    {badge.letter}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function IconButton({ action, disabled }: { action: Action; disabled: boolean }) {
  return (
    <button
      type="button"
      title={action.label}
      aria-label={action.label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        action.run();
      }}
      className="flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-chip hover:text-fg disabled:opacity-40"
    >
      {action.icon}
    </button>
  );
}

/** Centered icon + title + detail, for the list area when there's nothing to list. */
export function EmptyState({
  icon,
  title,
  detail,
  tone = "muted",
  action,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  tone?: "muted" | "error";
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-8 text-center">
      <span className={tone === "error" ? "text-st-deleted" : "text-fg-3"}>{icon}</span>
      <p className="font-medium text-fg-2">{title}</p>
      {detail && <p className="text-[12px] break-words text-fg-3 select-text">{detail}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
