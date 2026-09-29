import type { ReactNode, SVGProps } from "react";

/**
 * File-type icons in the spirit of VS Code's default (Seti) theme: a small glyph per language,
 * colored by language. Drawn as inline SVG in the app's line style; colors are the `--ft-*` tokens.
 */
export type FileType =
  | "ts"
  | "js"
  | "react"
  | "json"
  | "css"
  | "sass"
  | "markup"
  | "markdown"
  | "rust"
  | "python"
  | "go"
  | "ruby"
  | "java"
  | "kotlin"
  | "c"
  | "cpp"
  | "csharp"
  | "php"
  | "vue"
  | "svelte"
  | "shell"
  | "yaml"
  | "config"
  | "lock"
  | "image"
  | "svg"
  | "text"
  | "license"
  | "pdf"
  | "archive"
  | "database"
  | "font"
  | "table"
  | "npm"
  | "docker"
  | "git"
  | "file";

/** Whole file names (lowercase) that win over the extension. */
const BY_NAME: Record<string, FileType> = {
  "package.json": "npm",
  "package-lock.json": "npm",
  ".npmrc": "npm",
  "cargo.toml": "rust",
  "cargo.lock": "rust",
  dockerfile: "docker",
  ".dockerignore": "docker",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  ".gitkeep": "git",
  "yarn.lock": "lock",
  "pnpm-lock.yaml": "lock",
  "bun.lockb": "lock",
  license: "license",
  "license.md": "license",
  "license.txt": "license",
  licence: "license",
  ".editorconfig": "config",
  makefile: "shell",
};

const BY_EXT: Record<string, FileType> = {
  ts: "ts",
  mts: "ts",
  cts: "ts",
  tsx: "react",
  jsx: "react",
  js: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "json",
  json5: "json",
  css: "css",
  less: "css",
  scss: "sass",
  sass: "sass",
  html: "markup",
  htm: "markup",
  xml: "markup",
  xaml: "markup",
  csproj: "markup",
  plist: "markup",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  rs: "rust",
  py: "python",
  pyi: "python",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  vue: "vue",
  svelte: "svelte",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "shell",
  psm1: "shell",
  bat: "shell",
  cmd: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "config",
  ini: "config",
  cfg: "config",
  conf: "config",
  properties: "config",
  env: "config",
  lock: "lock",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  icns: "image",
  avif: "image",
  svg: "svg",
  txt: "text",
  log: "text",
  pdf: "pdf",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  "7z": "archive",
  rar: "archive",
  sql: "database",
  db: "database",
  sqlite: "database",
  ttf: "font",
  otf: "font",
  woff: "font",
  woff2: "font",
  csv: "table",
  tsv: "table",
};

/** The icon for a repo path (`/`-separated, as git prints it). */
export function fileType(path: string): FileType {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  if (name === ".env" || name.startsWith(".env.")) return "config";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "file";
  return BY_EXT[name.slice(dot + 1)] ?? "file";
}

/** A text label drawn as the glyph, like Seti's "TS" / "JS". */
const Label = ({ children, size = 9 }: { children: string; size?: number }) => (
  <text
    x="8"
    y={8 + size * 0.36}
    textAnchor="middle"
    fontSize={size}
    fontWeight={800}
    letterSpacing={-0.5}
    fill="currentColor"
    stroke="none"
  >
    {children}
  </text>
);

const DOC = (
  <>
    <path d="M4 2.5h5l3 3v8a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-10.5a.5.5 0 0 1 .5-.5z" />
    <path d="M9 2.5v3h3" />
  </>
);
const GEAR_TEETH = "M12.4 8h1.8M11.1 11.1l1.3 1.3M8 12.4v1.8M4.9 11.1l-1.3 1.3M3.6 8H1.8M4.9 4.9 3.6 3.6M8 3.6V1.8M11.1 4.9l1.3-1.3";

const ICONS: Record<FileType, { color: string; glyph: ReactNode }> = {
  ts: { color: "text-ft-blue", glyph: <Label>TS</Label> },
  js: { color: "text-ft-yellow", glyph: <Label>JS</Label> },
  react: {
    color: "text-ft-cyan",
    glyph: (
      <g strokeWidth={1.1}>
        <ellipse cx="8" cy="8" rx="6.5" ry="2.5" />
        <ellipse cx="8" cy="8" rx="6.5" ry="2.5" transform="rotate(60 8 8)" />
        <ellipse cx="8" cy="8" rx="6.5" ry="2.5" transform="rotate(120 8 8)" />
        <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      </g>
    ),
  },
  json: {
    color: "text-ft-yellow",
    glyph: (
      <path d="M6 2.5c-1.5 0-2 .5-2 2v1.25C4 6.75 3.5 8 2.5 8 3.5 8 4 9.25 4 10.25v1.25c0 1.5.5 2 2 2M10 2.5c1.5 0 2 .5 2 2v1.25C12 6.75 12.5 8 13.5 8c-1 0-1.5 1.25-1.5 2.25v1.25c0 1.5-.5 2-2 2" />
    ),
  },
  css: { color: "text-ft-blue", glyph: <path d="M6.5 2.5 5 13.5M11 2.5 9.5 13.5M3 6h10.5M2.5 10h10.5" /> },
  sass: { color: "text-ft-pink", glyph: <path d="M6.5 2.5 5 13.5M11 2.5 9.5 13.5M3 6h10.5M2.5 10h10.5" /> },
  markup: { color: "text-ft-orange", glyph: <path d="M5 4.5 1.75 8 5 11.5M11 4.5 14.25 8 11 11.5M9.25 3.5l-2.5 9" /> },
  markdown: {
    color: "text-ft-blue",
    glyph: (
      <>
        <rect x="1.25" y="3.5" width="13.5" height="9" rx="1.5" />
        <path d="M3.75 10.5v-5l2 2.5 2-2.5v5M11.25 5.5v5M9.75 9l1.5 1.5 1.5-1.5" />
      </>
    ),
  },
  rust: {
    color: "text-ft-orange",
    glyph: (
      <>
        <circle cx="8" cy="8" r="4.4" />
        <path d={GEAR_TEETH} />
        <Label size={6}>R</Label>
      </>
    ),
  },
  python: { color: "text-ft-blue", glyph: <Label>PY</Label> },
  go: { color: "text-ft-cyan", glyph: <Label>GO</Label> },
  ruby: { color: "text-ft-red", glyph: <path d="M4.5 3h7L14 6l-6 7.5L2 6zM2 6h12M6.25 6 8 13.5 9.75 6M6.25 6 7 3M9.75 6 9 3" /> },
  java: {
    color: "text-ft-red",
    glyph: <path d="M3.5 7h7.5v3a3 3 0 0 1-3 3H6.5a3 3 0 0 1-3-3zM11 8h1a1.5 1.5 0 0 1 0 3h-1.25M6 2.5c-.5.75.5 1.25 0 2M8.5 2.5c-.5.75.5 1.25 0 2" />,
  },
  kotlin: { color: "text-ft-purple", glyph: <Label size={10}>K</Label> },
  c: { color: "text-ft-blue", glyph: <Label size={10}>C</Label> },
  cpp: { color: "text-ft-blue", glyph: <Label size={6}>C++</Label> },
  csharp: { color: "text-ft-purple", glyph: <Label size={7}>C#</Label> },
  php: { color: "text-ft-purple", glyph: <Label size={5.5}>php</Label> },
  vue: { color: "text-ft-green", glyph: <path d="M1.5 3 8 13.5 14.5 3M5 3l3 5 3-5" /> },
  svelte: { color: "text-ft-orange", glyph: <Label size={10}>S</Label> },
  shell: { color: "text-ft-green", glyph: <path d="M3 4.5 6.5 8 3 11.5M8 11.5h5" /> },
  yaml: { color: "text-ft-purple", glyph: <path d="M2.5 4h6M5 8h8.5M5 12h6M2.5 8h.01M2.5 12h.01" /> },
  config: {
    color: "text-ft-grey",
    glyph: (
      <>
        <circle cx="8" cy="8" r="4.4" />
        <circle cx="8" cy="8" r="1.6" />
        <path d={GEAR_TEETH} />
      </>
    ),
  },
  lock: {
    color: "text-ft-grey",
    glyph: (
      <>
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.25" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      </>
    ),
  },
  image: {
    color: "text-ft-purple",
    glyph: (
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <circle cx="5.75" cy="6.5" r="1.1" />
        <path d="m2.5 12 4-4 3 3 1.5-1.5 2.5 2.5" />
      </>
    ),
  },
  svg: {
    color: "text-ft-yellow",
    glyph: (
      <>
        <path d="M3.5 12.5C4.5 6 11.5 10 12.5 3.5" />
        <rect x="2" y="11" width="3" height="3" rx=".5" />
        <rect x="11" y="2" width="3" height="3" rx=".5" />
      </>
    ),
  },
  text: { color: "text-ft-grey", glyph: <path d="M3 4h10M3 8h10M3 12h6" /> },
  license: { color: "text-ft-yellow", glyph: <path d="M3 4h10M3 8h10M3 12h6" /> },
  pdf: { color: "text-ft-red", glyph: DOC },
  archive: {
    color: "text-ft-grey",
    glyph: (
      <>
        {DOC}
        <path d="M7 4h.01M7 6h.01M7 8h.01" strokeWidth={1.6} />
        <rect x="6" y="9.5" width="2" height="2.5" rx=".5" />
      </>
    ),
  },
  database: {
    color: "text-ft-pink",
    glyph: (
      <>
        <ellipse cx="8" cy="4" rx="5" ry="1.75" />
        <path d="M3 4v8c0 1 2.25 1.75 5 1.75S13 13 13 12V4M3 8c0 1 2.25 1.75 5 1.75S13 9 13 8" />
      </>
    ),
  },
  font: { color: "text-ft-red", glyph: <Label size={8}>Aa</Label> },
  table: {
    color: "text-ft-green",
    glyph: (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
        <path d="M2.5 6.5h11M2.5 10h11M6.5 3v10" />
      </>
    ),
  },
  npm: {
    color: "text-ft-red",
    glyph: <path fill="currentColor" stroke="none" fillRule="evenodd" d="M2.5 2.5h11v11h-11zM5 5h6v6.5H9.25V6.75H8v4.75H5z" />,
  },
  docker: {
    color: "text-ft-blue",
    glyph: (
      <g strokeWidth={1.1}>
        <path d="M1.5 9.5h12c.25 2-1.5 4-4.5 4H5.5c-2.25 0-4-1.5-4-4z" />
        <path d="M3 7h2.25v2.5H3zM5.25 7H7.5v2.5H5.25zM7.5 7h2.25v2.5H7.5zM5.25 4.5H7.5V7H5.25zM7.5 4.5h2.25V7H7.5z" />
      </g>
    ),
  },
  git: {
    color: "text-ft-orange",
    glyph: (
      <>
        <path d="M8 1.75 14.25 8 8 14.25 1.75 8z" />
        <path d="M6 4.5 8 6.5v3M8 6.5l1.5 1.5" strokeWidth={1.1} />
        <circle cx="8" cy="10.5" r=".9" fill="currentColor" stroke="none" />
        <circle cx="10" cy="8.5" r=".9" fill="currentColor" stroke="none" />
      </>
    ),
  },
  file: { color: "text-fg-3", glyph: DOC },
};

/** The VS Code-style icon for a file, picked by its name. */
export function FileTypeIcon({ path, className = "", ...props }: { path: string } & SVGProps<SVGSVGElement>) {
  const { color, glyph } = ICONS[fileType(path)];
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
      className={`shrink-0 ${color} ${className}`}
      {...props}
    >
      {glyph}
    </svg>
  );
}
