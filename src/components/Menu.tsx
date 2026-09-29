import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon } from "./icons";

/**
 * A button that opens a Claude-style menu (raised surface, border, shadow, rounded-xl).
 * Closes on outside click, on Esc (before the window-level Esc hides the popup), and on pick.
 */
export function Menu({
  trigger,
  label,
  children,
  align = "right",
  placement = "below",
  disabled,
  className,
}: {
  trigger: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  placement?: "below" | "above";
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
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

  return (
    <div ref={root} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={className}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-30 min-w-[190px] rounded-xl border border-line bg-raised p-1 shadow-pop ${
            align === "right" ? "right-0" : "left-0"
          } ${placement === "below" ? "top-full mt-1" : "bottom-full mb-1"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  hint,
  checked,
  disabled,
  onClick,
}: {
  icon?: ReactNode;
  children: ReactNode;
  hint?: string;
  /** Renders as a checkable row (radio or toggle). */
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-fg-2 hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-3">
        {checked !== undefined ? checked && <CheckIcon width={14} height={14} strokeWidth={1.8} className="text-accent-text" /> : icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-fg-3">{hint}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div className="my-1 h-px bg-line" />;
