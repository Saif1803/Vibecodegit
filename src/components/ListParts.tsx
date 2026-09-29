import { useCallback, useEffect, useState, type ReactNode } from "react";
import { errorText } from "../git/api";
import type { ConfirmRequest } from "./ConfirmDialog";
import { MoreIcon, SpinnerIcon } from "./icons";
import { Menu } from "./Menu";
import type { PromptRequest } from "./PromptDialog";

/** What the Branches / Tags / Stashes panels need from the app. */
export interface PanelOps {
  repo: string;
  busy: boolean;
  /**
   * Run a git operation with the busy state, a result banner, and a status refresh.
   * An Outcome return value becomes the banner, a string return value is the success text,
   * otherwise `success` is.
   * Resolves to git's error message, or null.
   */
  run: (fn: (repo: string) => Promise<unknown>, success?: string) => Promise<string | null>;
  confirm: (r: ConfirmRequest) => void;
  prompt: (r: PromptRequest) => void;
  /** A success banner for something that didn't touch the repo (e.g. copied a hash). */
  notify: (text: string) => void;
  /** Changes whenever the repo may have changed; panels refetch on it. */
  version: unknown;
}

/** Fetch a list for the panel; refetches when `deps` change. */
export function useList<T>(fetch: () => Promise<T[]>, deps: unknown[]) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(fetch, deps);
  useEffect(() => {
    let stale = false;
    load()
      .then((v) => !stale && (setItems(v), setError(null)))
      .catch((e) => !stale && setError(errorText(e)));
    return () => {
      stale = true;
    };
  }, [load]);
  return { items, error };
}

/** The rounded surface the lists sit in, same as the Changes list. */
export function Panel({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  return (
    <div className="mx-3 mb-3 flex min-h-0 flex-1 flex-col gap-2">
      {toolbar && <div className="flex shrink-0 items-center gap-1.5">{toolbar}</div>}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-y-auto py-1">{children}</div>
      </section>
    </div>
  );
}

export function ListState({ items, error, empty }: { items: unknown[] | null; error: string | null; empty: string }) {
  if (error) return <p className="px-4 py-6 text-center text-[12px] break-words text-st-deleted select-text">{error}</p>;
  if (!items)
    return (
      <p className="flex justify-center py-6 text-fg-3">
        <SpinnerIcon />
      </p>
    );
  if (items.length === 0) return <p className="px-4 py-6 text-center text-[12px] text-fg-3">{empty}</p>;
  return null;
}

export function GroupHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-1 pr-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-2">{children}</span>
      {actions}
    </div>
  );
}

/**
 * One list row: icon, title (+ badges), a dim second line, and a ⋯ menu shown on hover.
 * Clicking the row runs `onClick` (e.g. switch branch, open stash).
 */
export function Row({
  icon,
  title,
  badges,
  detail,
  active,
  onClick,
  menu,
  tooltip,
}: {
  icon: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  detail?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  menu?: (close: () => void) => ReactNode;
  tooltip?: string;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={tooltip}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && e.key === "Enter" && !e.ctrlKey && e.target === e.currentTarget) onClick();
      }}
      className={`group mx-1 flex cursor-default items-center gap-2.5 rounded-lg py-1.5 pr-1 pl-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
        active ? "bg-hover" : onClick ? "hover:bg-hover" : ""
      }`}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-3">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-fg">{title}</span>
          {badges}
        </span>
        {detail && <span className="block truncate text-[11px] leading-4 text-fg-3">{detail}</span>}
      </span>
      {menu && (
        <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100" onClick={(e) => e.stopPropagation()}>
          <Menu
            label="Actions"
            trigger={<MoreIcon />}
            className="flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-chip hover:text-fg"
          >
            {menu}
          </Menu>
        </span>
      )}
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "warning" }) {
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 text-[11px] leading-[18px] tabular-nums ${
        tone === "accent" ? "bg-accent/15 text-accent-text" : tone === "warning" ? "bg-st-deleted/12 text-st-deleted" : "bg-chip text-fg-2"
      }`}
    >
      {children}
    </span>
  );
}

export function ToolbarButton({ icon, children, onClick, disabled }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      spellCheck={false}
      className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-fg outline-none select-text placeholder:text-fg-3 focus:border-line-strong focus-visible:outline-none"
    />
  );
}
