import type { ClaudeSessionRepo, RepoRef } from "../git/types";
import type { ThemePref } from "../theme";
import { BranchIcon, MonitorIcon, MoonIcon, SunIcon } from "./icons";
import { RepoPicker } from "./RepoPicker";

interface Props {
  repo: RepoRef | null;
  branch: string | null;
  active: ClaudeSessionRepo[];
  recent: RepoRef[];
  onSelectRepo: (repo: RepoRef) => void;
  onBrowse: () => void;
  theme: ThemePref;
  onCycleTheme: () => void;
}

const THEME_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

export function Header({ repo, branch, active, recent, onSelectRepo, onBrowse, theme, onCycleTheme }: Props) {
  const ThemeIcon = THEME_ICON[theme];
  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 px-2.5">
      <RepoPicker current={repo} active={active} recent={recent} onSelect={onSelectRepo} onBrowse={onBrowse} />
      {repo && branch !== null && (
        <span className="flex h-[22px] max-w-[120px] min-w-0 shrink-0 items-center gap-1 rounded-md bg-chip px-1.5 text-[12px] text-fg-2">
          <BranchIcon width={12} height={12} className="shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      )}
      <button
        type="button"
        onClick={onCycleTheme}
        title={`Theme: ${theme}`}
        aria-label={`Theme: ${theme}. Click to change.`}
        className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg"
      >
        <ThemeIcon />
      </button>
    </header>
  );
}
