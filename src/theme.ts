const media = window.matchMedia("(prefers-color-scheme: dark)");

function apply() {
  document.documentElement.dataset.theme = media.matches ? "dark" : "light";
}

/**
 * Follow the OS light/dark setting, live. Call once before the first render so there's no
 * flash of the wrong theme.
 */
export function initTheme() {
  apply();
  media.addEventListener("change", apply);
  try {
    // Left over from when the theme could be picked by hand.
    localStorage.removeItem("claudegit.theme");
  } catch {
    // Storage unavailable; nothing to clean up.
  }
}
