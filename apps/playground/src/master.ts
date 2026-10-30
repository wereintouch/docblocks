import { WsSyncProvider, attach, createDoc } from "docblocks-core";
import type { Doc, SyncSession } from "docblocks-core";

const MASTER_CREATED_AT = "2026-01-01T00:00:00Z";

/** The catalog pane's master id (fixed: the catalog's JSON golden is byte-stable). */
const CATALOG_MASTER_ID = "master-catalog";

/** The seeded subtree paragraph's deterministic id (the subtree insert option targets it). */
const MASTER_SUBTREE_BLOCK_ID = "m0003";

/** Deterministic master block ids (m0001, m0002, ...): heading, then paragraphs. */
function masterIdGenerator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `m${String(next).padStart(4, "0")}`;
  };
}

/**
 * The master doc seed: a heading + paragraphs (m0003 is the subtree target,
 * its id is deterministic per the generator). `cycleOuterDocId` seeds a
 * trailing sync-embed referencing the OUTER doc's id (the e2e cycle-guard
 * case: the visited-set must stop it).
 */
function seedMasterDoc(id: string, cycleOuterDocId: string | null): Doc {
  const doc = createDoc({ id, createdAt: MASTER_CREATED_AT, generateId: masterIdGenerator() });
  doc.transact(() => {
    const heading = doc.insertBlock("heading", { level: 1 });
    doc.insertText(heading, 0, "Master heading");
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "Master paragraph one");
    const p2 = doc.insertBlock("paragraph");
    doc.insertText(p2, 0, "Master subtree paragraph");
    const p3 = doc.insertBlock("paragraph");
    doc.insertText(p3, 0, "Master paragraph three");
    if (cycleOuterDocId !== null) {
      doc.insertBlock("sync-embed", { ref: { docId: cycleOuterDocId } });
    }
  });
  return doc;
}

/** The pane's master: the doc, its relay client on the shared room, and the attach session. */
interface MasterRuntime {
  doc: Doc;
  provider: WsSyncProvider;
  session: SyncSession;
}

/**
 * Create the pane's master doc and attach it to the shared `<room>-master`
 * relay room. The master is an ordinary doc both panes create with the
 * same id; only ONE pane seeds it (`seed` — seeding both would duplicate
 * the deterministic block ids in the shared rootOrder on sync), the other
 * joins it empty and receives the seed through the room. The two panes'
 * sync-embeds resolve the same master, and edits converge through the room.
 */
function createMasterRuntime(
  masterDocId: string,
  syncUrl: string,
  cycleOuterDocId: string | null,
  seed: boolean
): MasterRuntime {
  const doc = seed ? seedMasterDoc(masterDocId, cycleOuterDocId) : createDoc({ id: masterDocId });
  const provider = new WsSyncProvider(`${syncUrl}-master`);
  const session = attach(doc, provider);
  void provider.connect().catch(() => undefined);
  return { doc, provider, session };
}

/** Detach the master session and drop the client (the pane effect's cleanup). */
function destroyMasterRuntime(master: MasterRuntime): void {
  master.session.detach();
  master.provider.destroy();
}

export { CATALOG_MASTER_ID, MASTER_SUBTREE_BLOCK_ID, createMasterRuntime, destroyMasterRuntime };
export type { MasterRuntime };
