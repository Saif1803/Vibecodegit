import type { ImgHTMLAttributes } from "react";
import { FILE_EXTENSIONS, FILE_NAMES, LANGUAGE_EXTENSIONS, LANGUAGE_NAMES, LIGHT_ICONS } from "./fileIconMap";

/**
 * File-type icons from vscode-icons (MIT), imported by scripts/file-icons.mjs into public/file-icons.
 * The lookup follows VS Code's: whole file name, then the longest extension ("d.ts" before "ts"),
 * each checked against the icon's own list before its language's, then the default file.
 */

/** Every extension of a file name, longest first: "a.d.ts" -> "d.ts", "ts"; ".gitignore" -> "gitignore". */
function extensionsOf(name: string): string[] {
  const out: string[] = [];
  for (let i = name.indexOf("."); i >= 0; i = name.indexOf(".", i + 1)) out.push(name.slice(i + 1));
  return out;
}

/** The icon name for a repo path (`/`-separated, as git prints it), or "file" for the default. */
export function fileType(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const byName = FILE_NAMES[name] ?? LANGUAGE_NAMES[name];
  if (byName) return byName;
  // VS Code's dotenv language covers `.env.*` (`.env.local`, `.env.production`).
  if (name.startsWith(".env.")) return "dotenv";
  const exts = extensionsOf(name);
  return exts.map((e) => FILE_EXTENSIONS[e]).find(Boolean) ?? exts.map((e) => LANGUAGE_EXTENSIONS[e]).find(Boolean) ?? "file";
}

const src = (icon: string, light = false) =>
  icon === "file" ? "/file-icons/default_file.svg" : `/file-icons/file_type_${light ? "light_" : ""}${icon}.svg`;

/** The VS Code-style icon for a file, picked by its name. Follows the OS theme like the app does. */
export function FileTypeIcon({ path, className = "", ...props }: { path: string } & ImgHTMLAttributes<HTMLImageElement>) {
  const icon = fileType(path);
  const img = (
    <img
      src={src(icon)}
      width={16}
      height={16}
      alt=""
      aria-hidden
      draggable={false}
      className={`size-4 shrink-0 ${className}`}
      {...props}
    />
  );
  if (!LIGHT_ICONS.has(icon)) return img;
  return (
    <picture className="flex shrink-0">
      <source srcSet={src(icon, true)} media="(prefers-color-scheme: light)" />
      {img}
    </picture>
  );
}
