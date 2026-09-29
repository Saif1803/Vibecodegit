import { CheckIcon } from "./icons";

interface Props {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled }: Props) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:opacity-40 ${
        on ? "border-accent bg-accent text-on-accent" : "border-line-strong hover:border-fg-3"
      }`}
    >
      {indeterminate ? (
        <span className="h-[1.5px] w-2 rounded-full bg-current" />
      ) : checked ? (
        <CheckIcon width={11} height={11} strokeWidth={2.2} />
      ) : null}
    </button>
  );
}
