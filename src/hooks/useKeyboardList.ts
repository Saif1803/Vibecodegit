import { useCallback } from "react";

/**
 * Returns an `onKeyDown` handler that navigates focusable rows inside a scrollable
 * container with Arrow Up/Down, Home/End. Attach it to the Panel's scroll wrapper.
 *
 * This is a generic keyboard list helper — it doesn't know about the items,
 * just queries for focusable children within the container.
 */
export function useKeyboardList() {
  return useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;

    const container = e.currentTarget;
    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[role="button"][tabindex], [role="option"][tabindex], button[tabindex]'),
    ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);

    if (items.length === 0) return;
    e.preventDefault();

    const cur = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = cur < items.length - 1 ? cur + 1 : 0;
    else next = cur > 0 ? cur - 1 : items.length - 1;

    items[next].focus();
    items[next].scrollIntoView({ block: "nearest" });
  }, []);
}
