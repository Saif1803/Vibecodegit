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
