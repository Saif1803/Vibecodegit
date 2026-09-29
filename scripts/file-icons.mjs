// Imports the file-type icons from a vscode-icons checkout (https://github.com/vscode-icons/vscode-icons, MIT).
//
//   git clone --depth 1 https://github.com/vscode-icons/vscode-icons.git <dir>
//   node scripts/file-icons.mjs <dir>
//
// Reads its manifest (src/iconsManifest/supportedExtensions.ts + languages.ts) the way its own
// manifestBuilder does, then writes:
//   public/file-icons/*.svg          every enabled file icon (and its light variant), copied as-is
//   public/file-icons/LICENSE        vscode-icons' MIT license
//   src/components/fileIconMap.ts    file name / extension -> icon name, used by fileIcons.tsx
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/file-icons.mjs <vscode-icons checkout>");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, "..");
const ts = createRequire(import.meta.url)("typescript");

/** Evaluates one of the manifest's TypeScript modules. Only its data is needed. */
function load(file, deps) {
  const code = ts.transpileModule(fs.readFileSync(path.join(src, "src/iconsManifest", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", code)(module.exports, (id) => deps[id] ?? {}, module);
  return module.exports;
}

// FileFormat is an enum; every file icon is an SVG.
const models = { FileFormat: new Proxy({}, { get: () => "svg" }) };
const { languages } = load("languages.ts", { "../models": models });
const { extensions } = load("supportedExtensions.ts", { "../models": models, "./languages": { languages } });

const iconsDir = path.join(src, "icons");
const fileOf = (icon, light) => `file_type_${light ? "light_" : ""}${icon}.svg`;

// Same order as manifestBuilder: sorted by icon name, and a later icon wins a shared key.
const enabled = extensions.supported
  .filter((f) => f.icon && !f.disabled && fs.existsSync(path.join(iconsDir, fileOf(f.icon, false))))
  .sort((a, b) => (a.icon < b.icon ? -1 : a.icon > b.icon ? 1 : 0));

const names = {};
const exts = {};
const light = new Set();
// Language keys can be claimed by several icons' languages (css: CSS and Tailwind). VS Code settles
// that by the file's actual language; here the best claim wins (see `score`).
const langNames = {};
const langExts = {};
const langNameScore = {};
const langExtScore = {};
const ids = (lang) => (Array.isArray(lang.ids) ? lang.ids : [lang.ids]);
/** The language named after the key beats one named after its icon; then the narrower language. */
const score = (key, icon, lang) =>
  (ids(lang).includes(key) ? 2000 : 0) + (ids(lang).includes(icon) ? 1000 : 0) - (lang.knownExtensions?.length ?? 0);
const claim = (map, scores, key, icon, lang) => {
  const s = score(key, icon, lang);
  if (!(key in scores) || s >= scores[key]) (map[key] = icon), (scores[key] = s);
};
for (const f of enabled) {
  if (f.light && fs.existsSync(path.join(iconsDir, fileOf(f.icon, true)))) light.add(f.icon);
  const add = (e) => {
    if (f.filename) names[e.toLowerCase()] = f.icon;
    else exts[e.replace(/^\./, "").toLowerCase()] = f.icon;
  };
  f.extensions.forEach(add);
  if (f.filenamesGlob?.length && f.extensionsGlob?.length)
    for (const n of f.filenamesGlob) for (const e of f.extensionsGlob) add(`${n}.${e}`);
  for (const lang of f.languages ?? []) {
    for (const e of lang.knownExtensions ?? []) claim(langExts, langExtScore, e.toLowerCase(), f.icon, lang);
    for (const n of lang.knownFilenames ?? []) claim(langNames, langNameScore, n.toLowerCase(), f.icon, lang);
  }
}
// File names VS Code's built-in languages own, which the manifest leaves to their language id.
const BUILTIN_NAMES = { makefile: "gnu", gnumakefile: "gnu" };
for (const [n, icon] of Object.entries(BUILTIN_NAMES))
  if (enabled.some((f) => f.icon === icon) && !(n in langNames)) langNames[n] = icon;

// Only icons some key points at are shipped.
const used = new Set([...Object.values(names), ...Object.values(exts), ...Object.values(langNames), ...Object.values(langExts)]);
const out = path.join(root, "public/file-icons");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let bytes = 0;
const copy = (file) => {
  fs.copyFileSync(path.join(iconsDir, file), path.join(out, file));
  bytes += fs.statSync(path.join(out, file)).size;
};
copy("default_file.svg");
for (const icon of used) {
  copy(fileOf(icon, false));
  if (light.has(icon)) copy(fileOf(icon, true));
}
fs.copyFileSync(path.join(src, "LICENSE"), path.join(out, "LICENSE"));

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const version = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).version;
const json = (v) => JSON.stringify(v);
fs.writeFileSync(
  path.join(root, "src/components/fileIconMap.ts"),
  `// Generated by scripts/file-icons.mjs from vscode-icons ${version} (MIT). Do not edit.
// Keys are lowercase. Icons are public/file-icons/file_type_<icon>.svg (and file_type_light_<icon>.svg).

/** Whole file names. */
export const FILE_NAMES: Record<string, string> = ${json(sorted(names))};

/** Extensions without the leading dot, possibly multi-part ("d.ts"). */
export const FILE_EXTENSIONS: Record<string, string> = ${json(sorted(exts))};

/** File names and extensions from each icon's language: the fallback, like VS Code's languageIds. */
export const LANGUAGE_NAMES: Record<string, string> = ${json(sorted(langNames))};
export const LANGUAGE_EXTENSIONS: Record<string, string> = ${json(sorted(langExts))};

/** Icons with a separate light-theme SVG. */
export const LIGHT_ICONS: ReadonlySet<string> = new Set(${json([...light].filter((i) => used.has(i)).sort())});
`,
);

console.log(
  `${used.size} icons (${light.size} with light variants), ${(bytes / 1024).toFixed(0)} KB of SVG; ` +
    `${Object.keys(names).length} names, ${Object.keys(exts).length} extensions`,
);
