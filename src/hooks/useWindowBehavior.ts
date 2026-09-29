import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Esc hides the popup. Blur-hide, the hotkey, and tray toggling live in Rust. */
export function useWindowBehavior() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        void getCurrentWindow().hide();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
