import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

const KEY = "claudegit.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Storage unavailable: fall through to system.
  }
  return "system";
}

function apply(pref: ThemePref) {
  const resolved = pref === "system" ? (media.matches ? "dark" : "light") : pref;
  document.documentElement.dataset.theme = resolved;
}

/** Call once before the first render so there's no flash of the wrong theme. */
export function initTheme() {
  apply(readPref());
}

/** Theme preference (persisted) that tracks the OS setting while on "system". */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);

  useEffect(() => {
    apply(pref);
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // Non-critical.
    }
    if (pref !== "system") return;
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  const cycle = () =>
    setPref((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));

  return { pref, cycle };
}
