export type TabId = "changes" | "history" | "branches" | "tags" | "stashes";

const TABS: { id: TabId; label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "branches", label: "Branches" },
  { id: "tags", label: "Tags" },
  { id: "stashes", label: "Stashes" },
];

/** Segmented control in the Claude style: chip track, raised active pill. */
export function Tabs({ tab, onTab, changes }: { tab: TabId; onTab: (t: TabId) => void; changes: number }) {
  return (
    <div role="tablist" aria-label="Views" className="mx-3 mb-2 flex shrink-0 rounded-lg bg-chip p-0.5">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTab(t.id)}
            className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-md text-[12px] transition-colors ${
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
