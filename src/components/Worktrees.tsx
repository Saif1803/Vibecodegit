import * as api from "../git/api";
import type { RepoRef, Worktree } from "../git/types";
import { CheckIcon, FolderIcon, MoreIcon, PlusIcon, TrashIcon, WorktreeIcon } from "./icons";
import { Badge, GroupHeader, Row, useList, type PanelOps } from "./ListParts";
import { Menu, MenuItem, MenuSeparator } from "./Menu";

const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** "Add worktree…": a branch (new from HEAD, or an existing one) in a sibling folder by default. */
export function promptAddWorktree(ops: PanelOps) {
  const repoName = lastSegment(ops.repo);
  ops.prompt({
    title: "Add worktree",
    body: "A second checkout of this repo in its own folder, so Claude can work on another branch without touching this one.",
    fields: [
      { key: "branch", label: "Branch", placeholder: "feature/my-change", mono: true },
      { key: "path", label: "Folder", placeholder: `../${repoName}-<branch>`, optional: true, mono: true },
    ],
    checkbox: { label: "Create the branch from HEAD", initial: true },
    confirmLabel: "Add worktree",
    onSubmit: ({ branch, path }, isNew) => {
      const folder = path.trim() || `../${repoName}-${branch.trim().replace(/[\\/:*?"<>|\s]+/g, "-")}`;
      void ops.run(async (r) => {
        const made = await api.addWorktree(r, folder, branch.trim(), isNew);
        return `Created worktree ${made.name} on ${branch.trim()}. Open it from Worktrees.`;
      });
    },
  });
}

/** Worktrees of this repo (shown when there's more than the main one). Click one to open it. */
export function WorktreesSection({ ops, onOpenRepo }: { ops: PanelOps; onOpenRepo: (r: RepoRef) => void }) {
  const { repo, busy, run, confirm, version } = ops;
  const list = useList(() => api.listWorktrees(repo), [repo, version]);
  const items = list.items ?? [];
  if (items.length <= 1) return null;

  const open = (w: Worktree) => onOpenRepo({ path: w.path, name: lastSegment(w.path) });

  const remove = (w: Worktree) =>
    confirm({
      title: `Remove worktree ${lastSegment(w.path)}?`,
      body: `Deletes its folder.${w.branch ? ` The branch ${w.branch} is kept.` : ""} Git refuses if it has uncommitted changes.`,
      items: [w.path],
      confirmLabel: "Remove worktree",
      danger: true,
      onConfirm: async () => {
        const err = await run((r) => api.removeWorktree(r, w.path, false), `Removed worktree ${lastSegment(w.path)}.`);
        if (err?.includes("--force")) {
          confirm({
            title: `Force remove ${lastSegment(w.path)}?`,
            body: "It has uncommitted or untracked changes. Removing it now deletes them for good.",
            items: [w.path],
            confirmLabel: "Force remove",
            danger: true,
            onConfirm: () => void run((r) => api.removeWorktree(r, w.path, true), `Removed worktree ${lastSegment(w.path)}.`),
          });
        }
      },
    });

  return (
    <>
      <GroupHeader
        actions={
          <Menu label="Worktree actions" trigger={<MoreIcon />} className="flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-chip hover:text-fg">
            {(close) => (
              <MenuItem icon={<PlusIcon />} disabled={busy} onClick={() => (close(), promptAddWorktree(ops))}>
                Add worktree…
              </MenuItem>
            )}
          </Menu>
        }
      >
        Worktrees
      </GroupHeader>
      {items.map((w) => (
        <Row
          key={w.path}
          icon={w.current ? <CheckIcon className="text-accent-text" /> : <WorktreeIcon />}
          title={lastSegment(w.path)}
          tooltip={w.path}
          badges={
            <>
              {w.current && <Badge tone="accent">open</Badge>}
              {w.main && <Badge>main</Badge>}
              {w.locked && <Badge>locked</Badge>}
              {w.prunable && <Badge tone="warning">missing</Badge>}
            </>
          }
          detail={`${w.branch ?? `detached at ${w.head}`} · ${w.path}`}
          active={w.current}
          onClick={w.current || w.prunable ? undefined : () => open(w)}
          menu={(close) => (
            <>
              {!w.current && !w.prunable && (
                <MenuItem icon={<FolderIcon />} onClick={() => (close(), open(w))}>
                  Open as the selected repo
                </MenuItem>
              )}
              {!w.main && !w.current && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<TrashIcon />} disabled={busy} onClick={() => (close(), remove(w))}>
                    Remove…
                  </MenuItem>
                </>
              )}
              {(w.main || w.current) && <p className="px-2 py-1.5 text-[11px] text-fg-3">{w.current ? "This is the open repo." : "The main checkout."}</p>}
            </>
          )}
        />
      ))}
    </>
  );
}
