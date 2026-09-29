import { useState } from "react";
import { CommitBox } from "./components/CommitBox";
import { FileList } from "./components/FileList";
import { Header } from "./components/Header";
import { StatusBar } from "./components/StatusBar";
import type { RepoRef } from "./git/types";
import { useWindowBehavior } from "./hooks/useWindowBehavior";
import { mockActive, mockBranch, mockFiles, mockRecent } from "./preview/mock";
import { useTheme } from "./theme";

export default function App() {
  useWindowBehavior();
  const { pref, cycle } = useTheme();

  // Design preview wiring; real data arrives in Phases 3–4.
  const [repo, setRepo] = useState<RepoRef | null>(mockRecent[0]);
  const [selected, setSelected] = useState(() => new Set(mockFiles.filter((f) => f.staged).map((f) => f.path)));
  const [message, setMessage] = useState("");

  const toggle = (path: string, checked: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });

  return (
    <main className="flex h-full flex-col border border-line bg-bg">
      <Header
        repo={repo}
        branch={mockBranch.head}
        active={mockActive}
        recent={mockRecent}
        onSelectRepo={setRepo}
        onBrowse={() => {}}
        theme={pref}
        onCycleTheme={cycle}
      />
      <StatusBar branch={mockBranch} claudeActive={repo?.path === mockActive[0].path} />
      <div className="h-2 shrink-0" />
      <FileList
        files={mockFiles}
        selected={selected}
        onToggle={toggle}
        onToggleAll={(all) => setSelected(new Set(all ? mockFiles.map((f) => f.path) : []))}
      />
      <CommitBox
        message={message}
        onMessage={setMessage}
        canCommit={selected.size > 0 && message.trim().length > 0}
        busy={false}
        onCommit={() => {}}
      />
    </main>
  );
}
