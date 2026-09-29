import { useWindowBehavior } from "./hooks/useWindowBehavior";

export default function App() {
  useWindowBehavior();

  return (
    <main className="flex h-full flex-col border border-zinc-300 dark:border-zinc-700">
      <header className="border-b border-zinc-200 px-3 py-2 text-sm font-semibold dark:border-zinc-800">
        ClaudeGit
      </header>
      <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
        Nothing here yet.
      </div>
    </main>
  );
}
