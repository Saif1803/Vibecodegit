import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

/**
 * Esc hides the popup (via Rust, so every hide path emits `window-hidden`).
 * Returns whether the popup is currently shown.
 */
export function useWindowBehavior() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        void invoke("hide_window");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const unShown = listen("window-shown", () => setVisible(true));
    const unHidden = listen("window-hidden", () => setVisible(false));
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      void unShown.then((f) => f());
      void unHidden.then((f) => f());
    };
  }, []);

  return visible;
}

/** Widen the popup for the detail pane, or shrink it back (Rust keeps it next to the tray). */
export function setExpanded(expanded: boolean) {
  invoke("set_expanded", { expanded }).catch(() => {});
}
