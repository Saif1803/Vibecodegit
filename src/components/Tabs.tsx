import { useRef } from "react";

export type TabId = "changes" | "history" | "branches" | "tags" | "stashes";

const TABS: { id: TabId; label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "branches", label: "Branches" },
  { id: "tags", label: "Tags" },
  { id: "stashes", label: "Stashes" },
];

/**
 * Segmented control in the Claude style: chip track, raised active pill. Each tab starts at its
 * label's width and shares what's left, so "Changes 123" never clips at the 340 px minimum.
 * Arrow Left/Right navigate between tabs per WAI-ARIA tablist pattern.
 */
export function Tabs({ tab, onTab, changes }: { tab: TabId; onTab: (t: TabId) => void; changes: number }) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ids = TABS.map((t) => t.id);
    const cur = ids.indexOf(tab);
    let next = cur;
    if (e.key === "ArrowRight") next = cur < ids.length - 1 ? cur + 1 : 0;
    else if (e.key === "ArrowLeft") next = cur > 0 ? cur - 1 : ids.length - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ids.length - 1;
    else return;
    e.preventDefault();
    onTab(ids[next]);
    // Focus the new tab button
    const buttons = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    buttons?.[next]?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label="Views" onKeyDown={onKeyDown} className="mx-3 mb-2 flex shrink-0 rounded-lg bg-chip p-0.5">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onTab(t.id)}
            className={`flex h-7 flex-auto items-center justify-center gap-1 rounded-md px-1 text-[12px] whitespace-nowrap transition-colors ${
              active ? "bg-raised font-medium text-fg shadow-xs" : "text-fg-3 hover:text-fg-2"
            }`}
          >
            {t.label}
            {t.id === "changes" && changes > 0 && <span className={`tabular-nums ${active ? "text-fg-3" : ""}`}>{changes}</span>}
          </button>
        );
      })}
    </div>
  );
}
