/**
 * A commit subject from something you asked Claude: its first line, tidied. Prompts are
 * conversational ("can you add a dark mode toggle?"), so this is a starting point to edit.
 */
export function promptToMessage(prompt: string): string {
  const line = prompt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  const polite = /^(please|pls|can you|could you|would you|let's|lets|now|ok(ay)?,?|hey,?|so,?)\s+/i;
  let s = line;
  while (polite.test(s)) s = s.replace(polite, "");
  s = s.replace(/[?!.\s]+$/, "").replace(/\s+please$/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
