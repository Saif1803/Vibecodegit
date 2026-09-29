import { useEffect, type ReactNode } from "react";
import { AlertIcon } from "./icons";

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  /** Paths (or other items) that will be affected; the first few are listed. */
  items?: string[];
  confirmLabel: string;
  /** Destructive actions get a red button instead of the accent. */
  danger?: boolean;
  onConfirm: () => void;
}

const SHOWN = 5;

/**
 * In-window modal for anything that loses work. Esc and the backdrop cancel;
 * Enter isn't bound, so a confirmation always takes a deliberate click.
 */
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const items = request.items ?? [];
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/70 p-4" onMouseDown={onClose}>
      <div
        role="alertdialog"
        aria-modal
        aria-label={request.title}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[340px] rounded-2xl border border-line bg-raised p-4 shadow-pop"
      >
        <div className="flex items-start gap-2.5">
          {request.danger && <AlertIcon className="mt-0.5 shrink-0 text-st-deleted" />}
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-fg">{request.title}</h2>
            <div className="mt-1 text-[12px] leading-[18px] text-fg-2">{request.body}</div>
          </div>
        </div>
        {items.length > 0 && (
          <ul className="mt-3 max-h-[120px] overflow-y-auto rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[11px] leading-[18px] text-fg-2">
            {items.slice(0, SHOWN).map((p) => (
              <li key={p} className="truncate" title={p}>
                {p}
              </li>
            ))}
            {items.length > SHOWN && <li className="text-fg-3">and {items.length - SHOWN} more</li>}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-lg px-3 text-fg-2 hover:bg-hover hover:text-fg">
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              onClose();
              request.onConfirm();
            }}
            className={`h-8 rounded-lg px-3 font-medium text-on-accent ${
              request.danger ? "bg-st-deleted hover:bg-st-deleted/85" : "bg-accent hover:bg-accent-hover"
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
