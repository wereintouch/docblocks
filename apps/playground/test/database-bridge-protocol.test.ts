/** The in-memory reference bridge's conformance — the protocol's negotiation. */
import { isDatabaseBridge } from "docblocks-react-ui";
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";

describe("the in-memory reference bridge — the protocol's negotiation", () => {
  it("stands the version 2 descriptor with the baseline capabilities + the limits", async () => {
    const bridge = createMemoryDatabaseBridge();
    const descriptor = await bridge.describeProtocol();
    expect(descriptor.protocolVersion).toBe(2);
    for (const capability of [
      "orderedRows",
      "snapshotReplay",
      "idempotentWrites",
      "structuredErrors",
      "viewInvalidation",
    ]) {
      expect(descriptor.capabilities).toContain(capability);
    }
    expect(descriptor.limits.maxPageSize).toBeGreaterThan(0);
    expect(descriptor.limits.maxBatchOps).toBeGreaterThan(0);
    expect(descriptor.operationRetentionSeconds).toBeGreaterThan(0);
    expect(descriptor.retryHorizonSeconds).toBeGreaterThan(0);
  });

  it("the guard accepts the reference bridge and rejects the non-conformant stand", () => {
    expect(isDatabaseBridge(createMemoryDatabaseBridge())).toBe(true);
    // The discriminators (describeProtocol / snapshotTable / batchRows) are
    // absent — the guard stands the rejection.
    expect(isDatabaseBridge({ listTables: async () => [] })).toBe(false);
    expect(isDatabaseBridge(null)).toBe(false);
  });
});
