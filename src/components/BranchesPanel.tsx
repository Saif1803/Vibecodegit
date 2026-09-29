import { useState } from "react";
import * as api from "../git/api";
import type { Branch, RepoRef } from "../git/types";
import { ago } from "../lib/time";
import { ArrowUpIcon, BranchIcon, CheckIcon, CloudDownIcon, MergeIcon, MoreIcon, PencilIcon, PlusIcon, SyncIcon, TrashIcon } from "./icons";
import { Badge, GroupHeader, ListState, Panel, Row, SearchInput, ToolbarButton, useList, type PanelOps } from "./ListParts";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { promptAddWorktree, WorktreesSection } from "./Worktrees";

/** Worktrees, local branches, then each remote's branches, with VS Code's branch actions. */
export function BranchesPanel({ ops, onOpenRepo }: { ops: PanelOps; onOpenRepo: (r: RepoRef) => void }) {
  const { repo, busy, run, confirm, prompt, version } = ops;
  const branches = useList(() => api.listBranches(repo), [repo, version]);
  const remotes = useList(() => api.listRemotes(repo), [repo, version]);
  const [filter, setFilter] = useState("");

  const all = branches.items ?? [];
  const current = all.find((b) => b.current) ?? null;
  const match = (b: Branch) => b.name.toLowerCase().includes(filter.trim().toLowerCase());
  const local = all.filter((b) => !b.remote && match(b));

  const newBranch = (start: string | null) =>
    prompt({
      title: start ? `New branch from ${start}` : "New branch",
      body: start ? undefined : `Starts from the current commit${current ? ` on ${current.name}` : ""}.`,
      fields: [{ key: "name", label: "Branch name", placeholder: "feature/my-change", mono: true }],
      checkbox: { label: "Switch to it", initial: true },
      confirmLabel: "Create branch",
      onSubmit: ({ name }, switchTo) =>
        void run((r) => api.createBranch(r, name, start, switchTo), switchTo ? `Created and switched to ${name}.` : `Created ${name}.`),
    });

  const switchTo = (b: Branch) =>
    b.remote
      ? void run(async (r) => `Switched to ${await api.checkoutRemoteBranch(r, b.name)}.`)
      : void run((r) => api.switchBranch(r, b.name), `Switched to ${b.name}.`);

  const merge = (b: Branch) => void run((r) => api.mergeBranch(r, b.name));

  const rebase = (b: Branch) =>
    confirm({
      title: `Rebase ${current?.name} onto ${b.name}?`,
      body: `Your commits on ${current?.name} are replayed on top of ${b.name}, which rewrites them.${
        current?.upstream ? " If you've already pushed them, the next push will need to force." : ""
      } If it conflicts, the rebase is undone and nothing changes.`,
      confirmLabel: "Rebase",
      onConfirm: () => void run((r) => api.rebaseOnto(r, b.name)),
    });

  const rename = (b: Branch) =>
    prompt({
      title: `Rename ${b.name}`,
      fields: [{ key: "name", label: "New name", initial: b.name, mono: true }],
      confirmLabel: "Rename",
      onSubmit: ({ name }) => void run((r) => api.renameBranch(r, b.name, name), `Renamed ${b.name} to ${name}.`),
    });

  const remove = (b: Branch) =>
    confirm({
      title: `Delete branch ${b.name}?`,
      body: "Removes the local branch. Git refuses if it has commits that aren't merged anywhere.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        const err = await run((r) => api.deleteBranch(r, b.name, false), `Deleted ${b.name}.`);
        if (err?.includes("not fully merged")) {
          confirm({
            title: `Force delete ${b.name}?`,
            body: `${b.name} has commits that aren't merged into any other branch. Deleting it now can lose them.`,
            confirmLabel: "Force delete",
            danger: true,
            onConfirm: () => void run((r) => api.deleteBranch(r, b.name, true), `Deleted ${b.name}.`),
          });
        }
      },
    });

  const removeRemote = (b: Branch) => {
    const branch = b.name.slice(b.remote!.length + 1);
    confirm({
      title: `Delete ${branch} from ${b.remote}?`,
      body: `Deletes the branch on the remote for everyone. Local branches are not touched.`,
      items: [b.name],
      confirmLabel: "Delete from remote",
      danger: true,
      onConfirm: () => void run((r) => api.deleteRemoteBranch(r, b.remote!, branch), `Deleted ${b.name}.`),
    });
  };

  const addRemote = () =>
    prompt({
      title: "Add remote",
      fields: [
        { key: "name", label: "Name", initial: (remotes.items ?? []).length === 0 ? "origin" : "", placeholder: "upstream", mono: true },
        { key: "url", label: "URL", placeholder: "https://github.com/owner/repo.git", mono: true },
      ],
      confirmLabel: "Add remote",
      onSubmit: ({ name, url }) => void run((r) => api.addRemote(r, name, url), `Added remote ${name}.`),
    });

  const branchMenu = (b: Branch) => (close: () => void) => {
    const item = (fn: () => void) => () => (close(), fn());
    const tracking = b.remote ? null : b;
    return (
      <>
        {!b.current && (
          <MenuItem icon={<CheckIcon />} onClick={item(() => switchTo(b))} disabled={busy}>
            {b.remote ? "Check out" : "Switch to"}
          </MenuItem>
        )}
        <MenuItem icon={<PlusIcon />} onClick={item(() => newBranch(b.name))} disabled={busy}>
          New branch from here…
        </MenuItem>
        {tracking?.current && !tracking.upstream && (
          <MenuItem icon={<ArrowUpIcon />} onClick={item(() => void run((r) => api.sync(r, "push")))} disabled={busy}>
            Publish branch
          </MenuItem>
        )}
        {!b.current && current && (
          <>
            <MenuSeparator />
            <MenuItem icon={<MergeIcon />} onClick={item(() => merge(b))} disabled={busy}>
              Merge into {current.name}
            </MenuItem>
            <MenuItem icon={<SyncIcon />} onClick={item(() => rebase(b))} disabled={busy}>
              Rebase {current.name} onto this
            </MenuItem>
          </>
        )}
        <MenuSeparator />
        {!b.remote && (
          <MenuItem icon={<PencilIcon />} onClick={item(() => rename(b))} disabled={busy}>
            Rename…
          </MenuItem>
        )}
        {!b.current && (
          <MenuItem icon={<TrashIcon />} onClick={item(() => (b.remote ? removeRemote(b) : remove(b)))} disabled={busy}>
            {b.remote ? `Delete from ${b.remote}…` : "Delete…"}
          </MenuItem>
        )}
      </>
    );
  };

  const row = (b: Branch) => (
    <Row
      key={b.name}
      icon={b.current ? <CheckIcon className="text-accent-text" /> : <BranchIcon />}
      title={b.remote ? b.name.slice(b.remote.length + 1) : b.name}
      tooltip={b.name}
      badges={
        <>
          {b.behind > 0 && <Badge>↓{b.behind}</Badge>}
          {b.ahead > 0 && <Badge>↑{b.ahead}</Badge>}
          {b.gone && <Badge tone="warning">gone</Badge>}
          {!b.remote && !b.upstream && <Badge>local only</Badge>}
        </>
      }
      detail={`${b.subject} · ${ago(b.dateMs)}`}
      active={b.current}
      onClick={b.current || busy ? undefined : () => switchTo(b)}
      menu={branchMenu(b)}
    />
  );

  return (
    <Panel
      toolbar={
        <>
          <SearchInput value={filter} onChange={setFilter} placeholder="Filter branches" />
          <ToolbarButton icon={<PlusIcon />} onClick={() => newBranch(null)} disabled={busy}>
            New branch
          </ToolbarButton>
        </>
      }
    >
      <ListState items={branches.items} error={branches.error} empty="No branches yet. Make a first commit." />
      <WorktreesSection ops={ops} onOpenRepo={onOpenRepo} />
      {local.length > 0 && <GroupHeader>Local</GroupHeader>}
      {local.map(row)}
      {(remotes.items ?? []).map((rem) => {
        const list = all.filter((b) => b.remote === rem.name && match(b));
        return (
          <div key={rem.name}>
            <GroupHeader
              actions={
                <Menu label={`${rem.name} actions`} trigger={<MoreIcon />} className="flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-chip hover:text-fg">
                  {(close) => (
                    <>
                      <MenuItem
                        icon={<CloudDownIcon />}
                        disabled={busy}
                        onClick={() => (close(), void run((r) => api.fetchRemote(r, rem.name), `Fetched ${rem.name}.`))}
                      >
                        Fetch {rem.name}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        icon={<TrashIcon />}
                        disabled={busy}
                        onClick={() => (
                          close(),
                          confirm({
                            title: `Remove remote ${rem.name}?`,
                            body: "Removes the remote and its remote-tracking branches from this repo. Nothing on the server changes.",
                            items: [rem.fetchUrl],
                            confirmLabel: "Remove remote",
                            danger: true,
                            onConfirm: () => void run((r) => api.removeRemote(r, rem.name), `Removed remote ${rem.name}.`),
                          })
                        )}
                      >
                        Remove remote…
                      </MenuItem>
                    </>
                  )}
                </Menu>
              }
            >
              <span title={rem.fetchUrl}>{rem.name}</span>
              <span className="ml-1.5 font-normal text-fg-3">{rem.fetchUrl}</span>
            </GroupHeader>
            {list.map(row)}
            {list.length === 0 && <p className="px-3 pb-2 text-[12px] text-fg-3">{filter ? "No matches." : "No branches fetched yet."}</p>}
          </div>
        );
      })}
      {remotes.items && (
        <button
          type="button"
          onClick={addRemote}
          disabled={busy}
          className="mx-1 mt-1 flex h-8 w-[calc(100%-8px)] items-center gap-2 rounded-lg px-2.5 text-fg-3 hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <PlusIcon />
          Add remote…
        </button>
      )}
      {branches.items && branches.items.length > 0 && (
        <button
          type="button"
          onClick={() => promptAddWorktree(ops)}
          disabled={busy}
          className="mx-1 flex h-8 w-[calc(100%-8px)] items-center gap-2 rounded-lg px-2.5 text-fg-3 hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <PlusIcon />
          Add worktree…
        </button>
      )}
    </Panel>
  );
}

