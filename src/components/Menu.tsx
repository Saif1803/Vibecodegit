import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

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
        button.current?.focus();
        return;
      }
      // Arrow navigation within menu items
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const items = Array.from(
          menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]') ?? [],
        ).filter((el) => !el.hasAttribute("disabled"));
        if (items.length === 0) return;
        const cur = items.indexOf(document.activeElement as HTMLElement);
        let next: number;
        if (e.key === "Home") next = 0;
        else if (e.key === "End") next = items.length - 1;
        else if (e.key === "ArrowDown") next = cur < items.length - 1 ? cur + 1 : 0;
        else next = cur > 0 ? cur - 1 : items.length - 1;
        items[next].focus();
      }
    };
    // Fixed-position menus don't follow their trigger when a list scrolls, so close instead.
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    // Focus first item on open
    requestAnimationFrame(() => {
      const first = menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), [role="menuitemradio"]:not([disabled])');
      first?.focus();
    });
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Fixed positioning escapes the scrolling lists that would clip the menu. Measure after the
  // first render, then place it next to the trigger, flipping to the other side if it won't fit.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const t = button.current!.getBoundingClientRect();
    const m = menu.current!.getBoundingClientRect();
    const below = t.bottom + 4;
    const above = t.top - 4 - m.height;
    const fitsBelow = below + m.height <= window.innerHeight - 8;
    const fitsAbove = above >= 8;
    const top = placement === "above" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
    const left = align === "right" ? t.right - m.width : t.left;
    setPos({ top: Math.max(8, top), left: Math.min(Math.max(8, left), window.innerWidth - m.width - 8) });
  }, [open, align, placement]);

  return (
    <div ref={root} className="flex">
      <button
        ref={button}
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
          ref={menu}
          role="menu"
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
          className="fixed z-30 min-w-[190px] rounded-xl border border-line bg-raised p-1 shadow-pop"
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
