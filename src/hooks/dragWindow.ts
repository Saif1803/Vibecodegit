import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";

/** Anything clickable keeps its click; only empty space (and plain text) starts a drag. */
const CONTROLS = "button, a, input, textarea, select, [role=button], [role=tab], [role=menu], [role=menuitem], [role=dialog]";

/**
 * onMouseDown for title-bar-like strips (the header, the status line, a detail pane's
 * header): dragging them moves the borderless window. Rust notices the new spot on hide
 * and opens there next time.
 */
export function dragWindow(e: MouseEvent) {
  if (e.button !== 0 || e.detail > 1) return;
  if ((e.target as HTMLElement).closest(CONTROLS)) return;
  e.preventDefault();
  void getCurrentWindow()
    .startDragging()
    .catch(() => {});
}
