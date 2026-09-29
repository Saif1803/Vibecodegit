import { STEPS, type Step, type StepState } from "../git/commitPush";
import { CheckIcon, SpinnerIcon, XIcon } from "./icons";

/** "add · commit · pull · push" with each step's live state. */
export function StepProgress({ steps }: { steps: Partial<Record<Step, StepState>> }) {
  return (
    <ol className="flex min-w-0 items-center gap-1 pl-1 text-[11px]" aria-label="Commit progress">
      {STEPS.map((name, i) => {
        const state = steps[name];
        return (
          <li key={name} className="flex items-center gap-1">
            {i > 0 && <span className="text-line-strong">·</span>}
            <span
              className={`flex items-center gap-0.5 ${
                state === "running"
                  ? "text-accent-text"
                  : state === "done"
                    ? "text-fg-2"
                    : state === "failed"
                      ? "text-st-deleted"
                      : state === "skipped"
                        ? "text-fg-3 line-through"
                        : "text-fg-3"
              }`}
            >
              {state === "running" && <SpinnerIcon width={10} height={10} />}
              {state === "done" && <CheckIcon width={10} height={10} strokeWidth={2} />}
              {state === "failed" && <XIcon width={10} height={10} strokeWidth={2} />}
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
