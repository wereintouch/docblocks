import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import type { SyncProvider } from "../src/sync";
import { attach } from "../src/sync";

/**
 * The no-throw's contract over `SyncProvider.sendUpdate`: the local-origin
 * update event fires inside the originating transaction, so a provider's
 * throw stands the transaction's failure — the committed batch rolls back
 * (no partial commit, the caller stands the reject). The standard providers
 * buffer instead of throwing (the WsSyncProvider's pending buffer).
 */
describe("the sendUpdate's no-throw's contract", () => {
  it("a throw over a local update stands the transact's rejection (the batch's rollback)", () => {
    const doc = createDoc({ id: "doc-spc", title: "t" });
    let sent = 0;
    const provider: SyncProvider = {
      connect: async () => {},
      disconnect: () => {},
      sendUpdate: () => {
        sent += 1;
        // The bootstrap's send stands; the transaction's send throws.
        if (sent > 1) throw new Error("the send's failure");
      },
      onUpdate: () => () => {},
      getLocalStateVector: () => new Uint8Array(0),
      setAwareness: () => {},
      onAwareness: () => () => {},
    };
    attach(doc, provider);
    expect(sent).toBe(1); // the bootstrap only

    expect(() => {
      doc.transact(() => {
        const a = doc.insertBlock("paragraph");
        doc.insertText(a, 0, "a");
        const b = doc.insertBlock("paragraph");
        doc.insertText(b, 0, "b");
      });
    }).toThrow();

    // The committed batch stands rolled back: no partial commit over the
    // throw (the caller re-runs the commands over a healthy provider).
    const blocks = Object.keys(doc.toJSON().blocks).filter((id) => id !== "doc-spc");
    expect(blocks).toHaveLength(0);
  });
});
