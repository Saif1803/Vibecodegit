import type { ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, InfoIcon, XIcon } from "./icons";

interface Props {
  tone: "info" | "warning" | "success";
  children: ReactNode;
  onDismiss?: () => void;
}

/** Inline notice styled like the Claude app's callouts: tinted surface, icon, hairline border. */
export function Banner({ tone, children, onDismiss }: Props) {
  const Icon = tone === "warning" ? AlertIcon : tone === "success" ? CheckCircleIcon : InfoIcon;
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      className={`mx-3 mb-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[12px] leading-[18px] ${
        tone === "warning"
          ? "border-st-deleted/25 bg-st-deleted/8 text-fg"
          : tone === "success"
            ? "border-st-added/25 bg-st-added/8 text-fg"
            : "border-line bg-surface text-fg-2"
      }`}
    >
      <Icon
        width={14}
        height={14}
        className={`mt-0.5 shrink-0 ${tone === "warning" ? "text-st-deleted" : tone === "success" ? "text-st-added" : "text-fg-3"}`}
      />
      <div className="min-w-0 flex-1 break-words whitespace-pre-line select-text">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-0.5 -mr-1 flex size-5 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
        >
          <XIcon width={12} height={12} />
        </button>
      )}
    </div>
  );
}
