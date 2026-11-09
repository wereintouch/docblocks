import { type Doc, fromJSON } from "docblocks-core";

/**
 * The harness publish stand: the consumer's snapshot persistence demo.
 * The published snapshot is stored per room in localStorage (shared
 * between the two pane tabs — the A/B demo: the editor pane publishes,
 * the viewer pane renders the published state from the same room).
 * The package itself stores nothing; the consumer owns the persistence.
 */
const PUBLISH_KEY_PREFIX = "docblocks-playground-published:";

/** Storage key for the room's published snapshot. */
function publishKey(room: string): string {
  return `${PUBLISH_KEY_PREFIX}${room}`;
}

/** Stores the doc's JSON state as the room's published snapshot (the consumer's publish action). */
export function publishSnapshot(room: string, doc: Doc): void {
  window.localStorage.setItem(publishKey(room), JSON.stringify(doc.toJSON()));
}

/** Reads the room's published snapshot as a fresh hydrated `Doc`; null when the snapshot is not stored. */
export function loadPublishedSnapshot(room: string): Doc | null {
  const raw = window.localStorage.getItem(publishKey(room));
  if (raw === null) return null;
  try {
    return fromJSON(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Removes the room's published snapshot (the harness reset). */
export function clearPublishedSnapshot(room: string): void {
  window.localStorage.removeItem(publishKey(room));
}
