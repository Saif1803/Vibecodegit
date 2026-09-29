import { useEffect, useState, type ReactNode } from "react";

export interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
  initial?: string;
  /** Empty is allowed (e.g. a tag message: empty means lightweight). */
  optional?: boolean;
  /** Monospace, for URLs and ref names. */
  mono?: boolean;
}

export interface PromptRequest {
  title: string;
  body?: ReactNode;
  fields: PromptField[];
  /** An optional checkbox under the fields ("Switch to it"). */
  checkbox?: { label: string; initial: boolean };
  confirmLabel: string;
  onSubmit: (values: Record<string, string>, checked: boolean) => void;
}

const INPUT =
  "h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-fg outline-none placeholder:text-fg-3 focus:border-line-strong focus-visible:outline-none";

/** In-window form dialog (new branch, rename, new tag, add remote). Enter submits, Esc cancels. */
export function PromptDialog({ request, onClose }: { request: PromptRequest; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(request.fields.map((f) => [f.key, f.initial ?? ""])),
  );
  const [checked, setChecked] = useState(request.checkbox?.initial ?? false);
  const ready = request.fields.every((f) => f.optional || values[f.key].trim().length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submit = () => {
    if (!ready) return;
    onClose();
    request.onSubmit(
      Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])),
      checked,
    );
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/70 p-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal
        aria-label={request.title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="w-full max-w-[340px] rounded-2xl border border-line bg-raised p-4 shadow-pop"
      >
        <h2 className="font-medium text-fg">{request.title}</h2>
        {request.body && <div className="mt-1 text-[12px] leading-[18px] text-fg-2">{request.body}</div>}
        <div className="mt-3 flex flex-col gap-2.5">
          {request.fields.map((f, i) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[12px] text-fg-2">
                {f.label}
                {f.optional && <span className="text-fg-3"> (optional)</span>}
              </span>
              <input
                autoFocus={i === 0}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                spellCheck={false}
                className={`${INPUT} ${f.mono ? "font-mono text-[12px]" : ""} select-text`}
              />
            </label>
          ))}
          {request.checkbox && (
            <label className="flex cursor-default items-center gap-2 text-[12px] text-fg-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="size-3.5 accent-[var(--accent)]"
              />
              {request.checkbox.label}
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-lg px-3 text-fg-2 hover:bg-hover hover:text-fg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="h-8 rounded-lg bg-accent px-3 font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-chip disabled:text-fg-3"
          >
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
