import { useEffect, useState } from "react";
import * as api from "../git/api";
import { PencilIcon, SpinnerIcon, UndoIcon, XIcon } from "./icons";

const DEFAULT_SHORTCUT = "Ctrl+Shift+G";

/** Modifier + key names that map to display labels. */
const MOD_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);
const KEY_LABEL: Record<string, string> = {
  " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Backspace: "Backspace", Delete: "Del", Insert: "Ins", Home: "Home", End: "End",
  PageUp: "PageUp", PageDown: "PageDown", Escape: "Esc", Enter: "Enter", Tab: "Tab",
};

function keyToLabel(e: KeyboardEvent): string | null {
  if (MOD_KEYS.has(e.key)) return null; // modifier alone
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Win");
  // Need at least one modifier
  if (parts.length === 0) return null;
  const key = KEY_LABEL[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(key);
  return parts.join("+");
}

/**
 * Inline shortcut editor in the header menu. Shows the current shortcut with a button
 * to record a new one; validates and saves it via Rust.
 */
export function ShortcutEditor() {
  const [current, setCurrent] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getShortcut().then(setCurrent).catch(() => setCurrent(DEFAULT_SHORTCUT));
  }, []);

  const save = async (shortcut: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.setShortcut(shortcut);
      setCurrent(shortcut);
      setDraft(null);
      setRecording(false);
    } catch (e) {
      setError(api.errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => void save(DEFAULT_SHORTCUT);

  // While recording, capture the next key combo
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const label = keyToLabel(e);
      if (label) {
        setDraft(label);
        setRecording(false);
        void save(label);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  if (current === null) return null;

  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 text-[11px] text-fg-3">Global shortcut</div>
      <div className="flex items-center gap-1.5">
        {recording ? (
          <span className="flex h-7 flex-1 items-center rounded-lg border border-accent/60 bg-surface px-2 text-[12px] text-accent-text animate-pulse">
            Press a key combo…
          </span>
        ) : (
          <span className="flex h-7 flex-1 items-center rounded-lg border border-line bg-surface px-2 font-mono text-[12px] text-fg">
            {draft ?? current}
          </span>
        )}
        {saving ? (
          <span className="flex size-7 items-center justify-center text-fg-3">
            <SpinnerIcon width={14} height={14} />
          </span>
        ) : recording ? (
          <button
            type="button"
            title="Cancel"
            onClick={() => setRecording(false)}
            className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-chip hover:text-fg"
          >
            <XIcon width={14} height={14} />
          </button>
        ) : (
          <>
            <button
              type="button"
              title="Record new shortcut"
              onClick={() => { setRecording(true); setError(null); setDraft(null); }}
              className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-chip hover:text-fg"
            >
              <PencilIcon width={14} height={14} />
            </button>
            {current !== DEFAULT_SHORTCUT && (
              <button
                type="button"
                title={`Reset to ${DEFAULT_SHORTCUT}`}
                onClick={reset}
                className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-chip hover:text-fg"
              >
                <UndoIcon width={14} height={14} />
              </button>
            )}
          </>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-st-deleted">{error}</p>}
    </div>
  );
}
