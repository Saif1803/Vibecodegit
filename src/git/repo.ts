// Path helpers for comparing repos in the UI. Resolving folders to repos happens in Rust.

/** `C:/a/b/` → `C:\a\b` on Windows-style paths; other paths just lose a trailing slash. */
export function normalizePath(path: string): string {
  const p = /^[A-Za-z]:[\\/]/.test(path) ? path.replace(/\//g, "\\") : path;
  return p.length > 3 ? p.replace(/[\\/]+$/, "") : p;
}

/** Case-insensitive on Windows paths, which is how the filesystem compares them. */
export function samePath(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return /^[A-Za-z]:\\/.test(na) ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

export function repoName(path: string): string {
  const parts = normalizePath(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
