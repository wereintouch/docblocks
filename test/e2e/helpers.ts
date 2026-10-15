import type { Page } from "@playwright/test";

declare global {
  interface Window {
    /** The playground pane's insert hook (harness attrs; see apps/playground/src/insert-blocks.ts). */
    __insertBlock?: (client: "a" | "b", type: string) => string | null;
    /** The playground panes' live docs (per letter; null until the pane is mounted) — the command API the e2e suite reads/drives. */
    __paneDocs?: { a: PaneDoc | null; b: PaneDoc | null };
    /** The playground panes' master docs (the sync-embed targets, per letter; null until the pane is mounted) — the master's command API the e2e suite reads/drives. */
    __masterDocs?: { a: MasterDoc | null; b: MasterDoc | null };
  }
}

/**
 * The structural surface of the panes' live docs a spec may read (the
 * mounted global is the full core `Doc` — this is a partial typing for
 * the specs that declare it locally; the e2e project has no typecheck).
 */
interface PaneDoc {
  toJSON(): {
    id: string;
    blocks: Record<string, { type: string; attrs?: Record<string, unknown>; children?: string[] }>;
  };
  getChildren(id: string): string[];
  getBlock(id: string): {
    type: string;
    attrs?: Record<string, unknown>;
    content?: { text: string; marks: Record<string, unknown> }[];
  } | null;
  insertBlock(type: string, attrs?: Record<string, unknown>, position?: { parent?: string }): string;
}

/** The pane's master doc (the sync-embed target) — the structural surface the specs may read/drive (the mounted global is the full core `Doc`). */
interface MasterDoc extends PaneDoc {
  meta: { id: string };
}

/**
 * Insert one v1 block of `type` into the pane's doc with the harness attrs
 * (the playground pane's `window.__insertBlock` hook — the command API in
 * place of the removed insert controls) and return the inserted block's id.
 */
async function insertBlockType(page: Page, client: "a" | "b", type: string): Promise<string> {
  const id = await page.evaluate(({ client, type }) => window.__insertBlock?.(client, type) ?? null, {
    client,
    type,
  });
  if (id === null) throw new Error(`the ${client} pane's insert hook is not mounted (type: ${type})`);
  return id;
}

export { insertBlockType };
