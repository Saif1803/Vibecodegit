import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Native folder picker. Hide-on-blur is paused while it's open, since it takes focus. */
export async function pickFolder(): Promise<string | null> {
  await invoke("set_blur_hide", { enabled: false });
  try {
    const picked = await open({ directory: true, multiple: false, title: "Choose a git repository" });
    return typeof picked === "string" ? picked : null;
  } finally {
    await invoke("set_blur_hide", { enabled: true });
  }
}
