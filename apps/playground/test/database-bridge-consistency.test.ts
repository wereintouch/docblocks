/** The in-memory reference bridge's conformance — the snapshot's consistency — the schema + the page over one R. */
import type { TableSnapshot } from "docblocks-react-ui";
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { ctx, recordingObserver, seedTable } from "./database-bridge-helpers";

describe("the snapshot's consistency — the schema + the page over one R", () => {
  it("the schema and the page stand the same snapshot boundary (the R's stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);
    const snapshot: TableSnapshot = await bridge.snapshotTable(tableId, {});
    // The schema and the page come from one consistent read: the page's
    // `schemaRevision` stands the snapshot's (the same `R`).
    expect(snapshot.page.schemaRevision).toBe(snapshot.schemaRevision);
    const R = snapshot.page.asOfSeq;
    const observer = recordingObserver();
    const handle = bridge.subscribeTable(tableId, { afterSeq: R }, observer);
    // A schema mutation + a row mutation race over the R: both stand the
    // envelopes after R (the replay's coverage).
    await bridge.createColumn(tableId, { column: { name: "Late", type: "text", position: 2, nullable: true } }, ctx());
    expect(observer.envelopes.length).toBe(1);
    expect(observer.envelopes[0]?.kind).toBe("commit");
    handle.unsubscribe();
  });
});
