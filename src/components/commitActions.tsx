import { useState, type ReactNode } from "react";
import * as api from "../git/api";
import type { RepoStatus, ResetMode } from "../git/types";
import { BranchIcon, CherryIcon, CompareIcon, CopyIcon, ResetIcon, TagIcon, UndoIcon } from "./icons";
import type { PanelOps } from "./ListParts";
import { MenuItem, MenuSeparator } from "./Menu";

/** Enough of a commit to act on it and to name it in messages. */
export interface CommitRef {
  hash: string;
  short: string;
  subject: string;
}

export const commitRef = (c: CommitRef): CommitRef => ({ hash: c.hash, short: c.short, subject: c.subject });

export interface CommitActions {
  open: (c: CommitRef) => void;
  /** `target` null = the working tree. */
  compare: (base: CommitRef, target: CommitRef | null) => void;
  /** Marked with "Select for compare"; the next "Compare with selected" uses it. */
  selected: CommitRef | null;
  /** The ⋯ menu items for a commit (history rows and the commit pane share them). */
  menu: (c: CommitRef, close: () => void) => ReactNode;
}

const RESET_HINT: Record<ResetMode, string> = { soft: "keep staged", mixed: "keep changes", hard: "discard" };

export function useCommitActions(
  ops: PanelOps | null,
  status: RepoStatus | null,
  open: (c: CommitRef) => void,
  compare: (base: CommitRef, target: CommitRef | null) => void,
): CommitActions {
  const [selected, setSelected] = useState<CommitRef | null>(null);
  const branch = status?.branch.head ?? "HEAD";
  // Anything that moves HEAD waits until a merge/rebase/… in progress is finished or aborted.
  const blocked = !status || !!status.operation || !status.branch.hasCommits;

  const menu = (c: CommitRef, close: () => void) => {
    if (!ops) return null;
    const { busy, run, confirm, prompt, notify } = ops;
    const item = (fn: () => void) => () => (close(), fn());

    const newBranch = () =>
      prompt({
        title: `New branch at ${c.short}`,
        body: c.subject,
        fields: [{ key: "name", label: "Branch name", placeholder: "fix/from-here", mono: true }],
        checkbox: { label: "Switch to it", initial: true },
        confirmLabel: "Create branch",
        onSubmit: ({ name }, switchTo) =>
          void run((r) => api.createBranch(r, name, c.hash, switchTo), switchTo ? `Created and switched to ${name}.` : `Created ${name}.`),
      });

    const newTag = () =>
      prompt({
        title: `New tag at ${c.short}`,
        body: c.subject,
        fields: [
          { key: "name", label: "Tag name", placeholder: "v1.0.0", mono: true },
          { key: "message", label: "Message", placeholder: "Optional: makes it an annotated tag", optional: true },
        ],
        confirmLabel: "Create tag",
        onSubmit: ({ name, message }) => void run((r) => api.createTag(r, name, message, c.hash), `Created tag ${name}.`),
      });

    const reset = async (mode: ResetMode) => {
      if (mode !== "hard") return void run((r) => api.resetTo(r, c.hash, mode));
      const leaving = await api.resetImpact(ops.repo, c.hash).catch(() => 0);
      const lost = [...(status?.staged ?? []), ...(status?.unstaged ?? []).filter((f) => f.kind !== "untracked")];
      const paths = [...new Set(lost.map((f) => f.path))];
      confirm({
        title: `Hard reset ${branch} to ${c.short}?`,
        body: (
          <>
            {branch} moves to “{c.subject}” and your files are made to match it.
            {leaving > 0 && ` ${leaving} commit${leaving === 1 ? "" : "s"} leave${leaving === 1 ? "s" : ""} the branch (git's reflog keeps them for a while).`}
            {" Untracked files are kept."}
            {paths.length > 0 ? " These uncommitted changes are lost for good:" : " You have no uncommitted changes to lose."}
          </>
        ),
        items: paths.length > 0 ? paths : undefined,
        confirmLabel: "Hard reset",
        danger: true,
        onConfirm: () => void run((r) => api.resetTo(r, c.hash, "hard")),
      });
    };

    const copy = () =>
      navigator.clipboard.writeText(c.hash).then(
        () => notify(`Copied ${c.short} to the clipboard.`),
        () => notify("Couldn't reach the clipboard."),
      );

    return (
      <>
        <MenuItem icon={<CompareIcon />} onClick={item(() => compare(c, null))}>
          Compare with working tree
        </MenuItem>
        {selected && selected.hash !== c.hash ? (
          <MenuItem icon={<CompareIcon />} onClick={item(() => compare(selected, c))} hint={selected.short}>
            Compare with selected
          </MenuItem>
        ) : (
          <MenuItem icon={<CompareIcon />} onClick={item(() => setSelected(selected?.hash === c.hash ? null : c))}>
            {selected?.hash === c.hash ? "Clear compare selection" : "Select for compare"}
          </MenuItem>
        )}
        <MenuItem icon={<CopyIcon />} onClick={item(() => void copy())} hint={c.short}>
          Copy hash
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<BranchIcon />} onClick={item(newBranch)} disabled={busy}>
          New branch here…
        </MenuItem>
        <MenuItem icon={<TagIcon />} onClick={item(newTag)} disabled={busy}>
          New tag here…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<CherryIcon />} onClick={item(() => void run((r) => api.cherryPick(r, c.hash)))} disabled={busy || blocked}>
          Cherry-pick onto {branch}
        </MenuItem>
        <MenuItem icon={<UndoIcon />} onClick={item(() => void run((r) => api.revertCommit(r, c.hash)))} disabled={busy || blocked}>
          Revert (new commit)
        </MenuItem>
        <MenuSeparator />
        {(["soft", "mixed", "hard"] as ResetMode[]).map((mode) => (
          <MenuItem
            key={mode}
            icon={mode === "soft" ? <ResetIcon /> : <span />}
            onClick={item(() => void reset(mode))}
            disabled={busy || blocked}
            hint={RESET_HINT[mode]}
          >
            Reset to here: {mode}
            {mode === "hard" && "…"}
          </MenuItem>
        ))}
      </>
    );
  };

  return { open, compare, selected, menu };
}

