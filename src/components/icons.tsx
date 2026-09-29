import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: P) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const FolderIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </Icon>
);

export const FolderPlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
    <path d="M8 7v4M6 9h4" />
  </Icon>
);

export const ChevronDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
  </Icon>
);

export const BranchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5" r="1.5" />
    <path d="M4.5 5v6M11.5 6.5c0 2.5-2 3.5-5 4.3" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);

export const ArrowUpIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
);

export const SunIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </Icon>
);

export const MoonIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
  </Icon>
);

export const MonitorIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
    <path d="M6 14h4M8 11v3" />
  </Icon>
);

export const SpinnerIcon = (p: P) => (
  <Icon {...p} className={`animate-spin ${p.className ?? ""}`}>
    <path d="M8 2a6 6 0 1 1-6 6" />
  </Icon>
);

export const XIcon = (p: P) => (
  <Icon {...p}>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </Icon>
);

export const InfoIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.25V11M8 5h.01" />
  </Icon>
);

export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.3 9.5a1 1 0 0 1-.87 1.5H2.7a1 1 0 0 1-.87-1.5z" />
    <path d="M8 6.5v3M8 11.5h.01" />
  </Icon>
);

export const RefreshIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2.5v3h-3" />
  </Icon>
);

export const CheckCircleIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="m5.5 8.25 1.75 1.75 3.25-3.5" />
  </Icon>
);

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

export const MinusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 8h9" />
  </Icon>
);

/** Discard: an arrow curling back. */
export const UndoIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 6.5h5.25a3 3 0 0 1 0 6H7" />
    <path d="M6.5 4 4 6.5 6.5 9" />
  </Icon>
);

export const MoreIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth={2.2} />
  </Icon>
);

export const ArrowDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
);

export const SyncIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11" />
    <path d="M13.25 3v3.5h-3.5M2.75 13V9.5h3.5" />
  </Icon>
);

export const CloudDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 11.5a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.9 5.5a2.75 2.75 0 0 1 .6 5.44" />
    <path d="M8 8v5.5M6 11.5l2 2 2-2" />
  </Icon>
);

export const FileIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 2.5h5l3 3v8a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-10.5a.5.5 0 0 1 .5-.5z" />
    <path d="M9 2.5v3h3" />
  </Icon>
);

export const PencilIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10.5 3 13 5.5l-7 7H3.5V10z" />
  </Icon>
);

export const TagIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 3.5v4l6 6 5-5-6-6h-4a1 1 0 0 0-1 1z" />
    <circle cx="5.5" cy="5.5" r="1" />
  </Icon>
);

export const StashIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 9.5v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" />
    <path d="M2.5 9.5h3l1 1.5h3l1-1.5h3M4.5 7h7M5.5 4.5h5" />
  </Icon>
);

export const CloudIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 12.5a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.9 6.5a3 3 0 0 1 .1 6z" />
  </Icon>
);

export const MergeIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="9" r="1.5" />
    <path d="M4.5 5v6M4.5 5c0 2.5 2.5 4 5.5 4" />
  </Icon>
);

export const TrashIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
);
