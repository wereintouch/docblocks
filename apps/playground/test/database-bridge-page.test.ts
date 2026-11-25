/** The in-memory reference bridge's conformance — the page — the keyset cursor + the query's validation. */
import type { FilterInput } from "docblocks-react-ui";
import { describe, expect, it } from "vitest";

import { createMemoryDatabaseBridge } from "../src/memory-bridge";
import { codeOf, ctx, hmacSha256Base64Url, seedTable, signatureHex, signedTokenParts } from "./database-bridge-helpers";

describe("the page — the keyset cursor + the query's validation", () => {
  it("the cursor paginates over the ordered rows and expires on a commit after R", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, rowIds, nameColumnId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, { limit: 2 });
    expect(snapshot.page.rows.length).toBe(2);
    expect(snapshot.page.rows.map((row) => row.id)).toEqual(rowIds.slice(0, 2));
    expect(snapshot.page.nextCursor).not.toBeNull();
    const page2 = await bridge.queryNextPage(tableId, {
      cursor: snapshot.page.nextCursor!,
      asOfSeq: snapshot.page.asOfSeq,
      queryFingerprint: snapshot.page.queryFingerprint,
    });
    expect(page2.rows.map((row) => row.id)).toEqual(rowIds.slice(2, 4));
    expect(page2.asOfSeq).toBe(snapshot.page.asOfSeq);
    // A commit that advanced the head after R expires the cursor.
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [nameColumnId]: "F" }, beforeRowId: null }] },
      ctx()
    );
    const expired = await bridge
      .queryNextPage(tableId, {
        cursor: snapshot.page.nextCursor!,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(expired)).toBe("cursor_expired");
  });

  it("the foreign fingerprint / the foreign asOfSeq reject with the cursor_expired", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, { limit: 2 });
    const wrongFingerprint = await bridge
      .queryNextPage(tableId, {
        cursor: snapshot.page.nextCursor!,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: "fp-other",
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(wrongFingerprint)).toBe("cursor_expired");
    const wrongR = await bridge
      .queryNextPage(tableId, {
        cursor: snapshot.page.nextCursor!,
        asOfSeq: snapshot.page.asOfSeq + 1,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(wrongR)).toBe("cursor_expired");
  });

  it("the tampered payload / the forged signature reject with the cursor_expired", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, { limit: 2 });
    const token = snapshot.page.nextCursor!;
    const { body, signature } = signedTokenParts(token);
    // The forged signature (the public scheme's recomputed stand is the
    // empty signature — without the key the real one is uncomputable).
    const forged = await bridge
      .queryNextPage(tableId, {
        cursor: `v3:${body}.`,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(forged)).toBe("cursor_expired");
    // The tampered payload keeps its original signature (the signature
    // covers the body — the rewrite breaks it).
    const tamperedBody = JSON.stringify({ ...JSON.parse(body), limit: 5 });
    const tampered = await bridge
      .queryNextPage(tableId, {
        cursor: `v3:${tamperedBody}.${signature}`,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(tampered)).toBe("cursor_expired");
    // The payload's fp stands rewritten against the request (the
    // coordinated rewrite the keyless scheme let through).
    const coordinatedBody = JSON.stringify({ ...JSON.parse(body), fp: "fp-other" });
    const coordinated = await bridge
      .queryNextPage(tableId, {
        cursor: `v3:${coordinatedBody}.${signature}`,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: "fp-other",
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(coordinated)).toBe("cursor_expired");
    // The signature's tamper stand: the first decoded byte flipped (the
    // last base64url char's low bits stand padding — a flip there decodes
    // to the same digest and would still verify).
    const signatureBytes = atob(signature.replace(/-/g, "+").replace(/_/g, "/"));
    const flippedFirstByte = (signatureBytes.charCodeAt(0) ^ 1).toString() + signatureBytes.slice(1);
    const flippedSignature = btoa(flippedFirstByte).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const flipped = await bridge
      .queryNextPage(tableId, {
        cursor: `v3:${body}.${flippedSignature}`,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(flipped)).toBe("cursor_expired");
    // The foreign key's token (a different instance's signature).
    const foreign = createMemoryDatabaseBridge({ cursorKey: "the-foreign-key" });
    await seedTable(foreign);
    const foreignSnapshot = await foreign.snapshotTable(tableId, { limit: 2 });
    const foreignToken = await bridge
      .queryNextPage(tableId, {
        cursor: foreignSnapshot.page.nextCursor!,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(foreignToken)).toBe("cursor_expired");
    // The legacy unsigned token (the pre-signing scheme's format).
    const legacyPayload = {
      v: 2,
      tableId,
      R: snapshot.page.asOfSeq,
      fp: snapshot.page.queryFingerprint,
      filter: null,
      sort: null,
      limit: 2,
      afterOrderKey: 1,
      afterRowId: snapshot.page.rows[0]!.id,
    };
    const legacyToken = await bridge
      .queryNextPage(tableId, {
        cursor: `v2:${encodeURIComponent(JSON.stringify(legacyPayload))}`,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(legacyToken)).toBe("cursor_expired");
  });

  it("the fixed key stands the deterministic signature + the cross-instance agreement", async () => {
    const key = "the-deterministic-test-key";
    const bridgeA = createMemoryDatabaseBridge({ cursorKey: key });
    const { tableId: tableIdA } = await seedTable(bridgeA);
    const snapshotA = await bridgeA.snapshotTable(tableIdA, { limit: 2 });
    // The token's shape (the opaque stand — the client stores the string
    // as is).
    expect(snapshotA.page.nextCursor!).toMatch(/^v3:.*\..+$/);
    // The signature stands a genuine HMAC-SHA256 over the token's body
    // under the declared key (the oracle's recomputation).
    const { body: tokenBody, signature: tokenSignature } = signedTokenParts(snapshotA.page.nextCursor!);
    expect(tokenSignature).toBe(hmacSha256Base64Url(key, tokenBody));
    // The fingerprint stands the same scheme over the query's canonical
    // body (the oracle's recomputation over the declared fields).
    const canonicalQuery = {
      R: snapshotA.page.asOfSeq,
      collation: snapshotA.page.semantics.collation,
      filter: null,
      limit: 2,
      nullOrdering: snapshotA.page.semantics.nullOrdering,
      schemaRevision: snapshotA.schemaRevision,
      semanticsVersion: snapshotA.page.semantics.semanticsVersion,
      sort: null,
      tableId: tableIdA,
    };
    expect(snapshotA.page.queryFingerprint).toBe(`fp-${hmacSha256Base64Url(key, JSON.stringify(canonicalQuery))}`);
    // The fixed key's signature stand deterministic (the golden).
    expect(signatureHex(snapshotA.page.nextCursor!)).toMatch(/^[0-9a-f]{64}$/);
    const snapshotB = await bridgeA.snapshotTable(tableIdA, { limit: 2 });
    expect(snapshotB.page.nextCursor).toBe(snapshotA.page.nextCursor);
    // The same key + the same query stand the same fingerprint across the
    // instances (the shared-secret's mirror); the foreign key stands a
    // foreign one.
    const bridgeB = createMemoryDatabaseBridge({ cursorKey: key });
    const { tableId: tableIdB } = await seedTable(bridgeB);
    expect(tableIdB).toBe(tableIdA);
    const snapshotB2 = await bridgeB.snapshotTable(tableIdB, { limit: 2 });
    expect(snapshotB2.page.queryFingerprint).toBe(snapshotA.page.queryFingerprint);
    const foreign = createMemoryDatabaseBridge({ cursorKey: "the-other-key" });
    await seedTable(foreign);
    const foreignSnapshot = await foreign.snapshotTable(tableIdA, { limit: 2 });
    expect(foreignSnapshot.page.queryFingerprint).not.toBe(snapshotA.page.queryFingerprint);
  });

  it("the sort stands the server-side ordering (the nulls over the declared stand)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, ageColumnId } = await seedTable(bridge);
    const snapshot = await bridge.snapshotTable(tableId, { sort: [{ fieldId: ageColumnId, direction: "desc" }] });
    // The ages stand the descending order; the null (Bob) stands the last
    // stand (the declared nullOrdering).
    expect(snapshot.page.rows.map((row) => row.cells[ageColumnId])).toEqual([45, 35, 30, 25, null]);
  });

  it("the filter: the validation rejects the unknown operator / the depth / the valueless value", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, ageColumnId, nameColumnId } = await seedTable(bridge);
    // The unknown operator for the number type.
    const badOperator = await bridge
      .snapshotTable(tableId, {
        filter: { logic: "and", conditions: [{ columnId: ageColumnId, op: "contains", value: "x" }] },
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badOperator)).toBe("invalid_operator");
    // The valueless operator with the value (the text column's "empty").
    const badValue = await bridge
      .snapshotTable(tableId, {
        filter: { logic: "and", conditions: [{ columnId: nameColumnId, op: "empty", value: null }] },
      })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badValue)).toBe("invalid_filter");
    // The depth over the limit.
    let deep: FilterInput = { logic: "and", conditions: [] };
    for (let i = 0; i < 12; i++) deep = { logic: "and", conditions: [], groups: [deep] };
    const badDepth = await bridge
      .snapshotTable(tableId, { filter: deep })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badDepth)).toBe("limit_exceeded");
    // The unknown column.
    const badColumn = await bridge
      .snapshotTable(tableId, { filter: { logic: "and", conditions: [{ columnId: "nope", op: "is", value: 1 }] } })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badColumn)).toBe("invalid_column");
    // The page limit over the negotiated one.
    const badLimit = await bridge
      .snapshotTable(tableId, { limit: 1_000_000 })
      .catch((operationError: unknown) => operationError);
    expect(codeOf(badLimit)).toBe("limit_exceeded");
  });

  it("the filter: the and / or pool stands the evaluation (the pool's semantics)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, ageColumnId, nameColumnId } = await seedTable(bridge);
    // The logic stands the POOL of the conditions + the groups: the or pool
    // passes the row over any branch.
    const snapshot = await bridge.snapshotTable(tableId, {
      filter: {
        logic: "or",
        conditions: [{ columnId: ageColumnId, op: ">", value: 28 }],
        groups: [{ logic: "and", conditions: [{ columnId: nameColumnId, op: "is", value: "Bob" }], groups: null }],
      },
    });
    // Alice (30), Carol (45), Eve (35) pass the age branch; Bob (the null
    // age) stands the group's pass; Dan fails both.
    const names = snapshot.page.rows.map((row) => row.cells[nameColumnId]);
    expect(names).toContain("Alice");
    expect(names).toContain("Carol");
    expect(names).toContain("Eve");
    expect(names).toContain("Bob");
    expect(names).not.toContain("Dan");
    // The and pool stands the conjunctive stand (no row passes both
    // branches: Bob's age is null, the named rows fail the age).
    const none = await bridge.snapshotTable(tableId, {
      filter: {
        logic: "and",
        conditions: [{ columnId: ageColumnId, op: ">", value: 28 }],
        groups: [{ logic: "and", conditions: [{ columnId: nameColumnId, op: "is", value: "Bob" }], groups: null }],
      },
    });
    expect(none.page.rows).toEqual([]);
  });
});
