/** The playground's demo mention provider: a small in-memory user / document
 *  catalog with a case-insensitive substring search (the `mentionProvider`
 *  consumer contract). A demo for the `@` trigger — the real catalog is the
 *  consumer's. */
import type { MentionEntry, MentionProvider } from "docblocks-react-ui";

const USERS: MentionEntry[] = [
  { id: "u1", label: "Ada Lovelace" },
  { id: "u2", label: "Grace Hopper" },
  { id: "u3", label: "Alan Turing" },
  { id: "u4", label: "Katherine Johnson" },
  { id: "u5", label: "Linus Torvalds" },
];

const DOCS: MentionEntry[] = [
  { id: "d1", label: "Architecture Overview" },
  { id: "d2", label: "API Reference" },
  { id: "d3", label: "Deployment Runbook" },
  { id: "d4", label: "Sprint Notes" },
];

function match(entries: MentionEntry[], query: string): MentionEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return entries;
  return entries.filter((entry) => entry.label.toLowerCase().includes(q));
}

const mentionProvider: MentionProvider = {
  // A small latency so the loading state is visible (the demo).
  searchUsers: (query) => new Promise((resolve) => setTimeout(() => resolve(match(USERS, query)), 120)),
  searchDocs: (query) => new Promise((resolve) => setTimeout(() => resolve(match(DOCS, query)), 120)),
};

export { mentionProvider };
