import { useState } from "react";
import * as api from "../git/api";
import type { Tag } from "../git/types";
import { ago } from "../lib/time";
import { ArrowUpIcon, PlusIcon, TagIcon, TrashIcon } from "./icons";
import { Badge, ListState, Panel, Row, SearchInput, ToolbarButton, useList, type PanelOps } from "./ListParts";
import { MenuItem, MenuSeparator } from "./Menu";

export function TagsPanel({ ops }: { ops: PanelOps }) {
  const { repo, busy, run, confirm, prompt, version } = ops;
  const tags = useList(() => api.listTags(repo), [repo, version]);
  const remotes = useList(() => api.listRemotes(repo), [repo, version]);
  const [filter, setFilter] = useState("");
  const shown = (tags.items ?? []).filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const remoteNames = (remotes.items ?? []).map((r) => r.name);

  const newTag = () =>
    prompt({
      title: "New tag",
      body: "Tags the current commit. With a message it's an annotated tag; without one, a lightweight tag.",
      fields: [
        { key: "name", label: "Tag name", placeholder: "v1.2.0", mono: true },
        { key: "message", label: "Message", placeholder: "Release 1.2.0", optional: true },
      ],
      confirmLabel: "Create tag",
      onSubmit: ({ name, message }) => void run((r) => api.createTag(r, name, message, null), `Created tag ${name}.`),
    });

  const menu = (t: Tag) => (close: () => void) => {
    const item = (fn: () => void) => () => (close(), fn());
    return (
      <>
        {remoteNames.map((rem) => (
          <MenuItem key={rem} icon={<ArrowUpIcon />} disabled={busy} onClick={item(() => void run((r) => api.pushTag(r, rem, t.name), `Pushed ${t.name} to ${rem}.`))}>
            Push to {rem}
          </MenuItem>
        ))}
        {remoteNames.length > 0 && <MenuSeparator />}
        <MenuItem
          icon={<TrashIcon />}
          disabled={busy}
          onClick={item(() =>
            confirm({
              title: `Delete tag ${t.name}?`,
              body: "Deletes the tag locally. Copies already pushed to a remote stay there.",
              confirmLabel: "Delete tag",
              danger: true,
              onConfirm: () => void run((r) => api.deleteTag(r, t.name), `Deleted tag ${t.name}.`),
            }),
          )}
        >
          Delete…
        </MenuItem>
        {remoteNames.map((rem) => (
          <MenuItem
            key={rem}
            icon={<TrashIcon />}
            disabled={busy}
            onClick={item(() =>
              confirm({
                title: `Delete ${t.name} from ${rem}?`,
                body: "Deletes the tag on the remote for everyone. Your local tag stays.",
                confirmLabel: "Delete from remote",
                danger: true,
                onConfirm: () => void run((r) => api.deleteRemoteTag(r, rem, t.name), `Deleted ${t.name} from ${rem}.`),
              }),
            )}
          >
            Delete from {rem}…
          </MenuItem>
        ))}
      </>
    );
  };

  return (
    <Panel
      toolbar={
        <>
          <SearchInput value={filter} onChange={setFilter} placeholder="Filter tags" />
          <ToolbarButton icon={<PlusIcon />} onClick={newTag} disabled={busy}>
            New tag
          </ToolbarButton>
        </>
      }
    >
      <ListState items={tags.items} error={tags.error} empty="No tags yet. Tags mark releases and other important commits." />
      {shown.map((t) => (
        <Row
          key={t.name}
          icon={<TagIcon />}
          title={t.name}
          badges={
            <>
              <Badge>{t.commit}</Badge>
              {t.annotated && <Badge tone="accent">annotated</Badge>}
            </>
          }
          detail={`${t.subject} · ${ago(t.dateMs)}`}
          menu={menu(t)}
        />
      ))}
    </Panel>
  );
}
