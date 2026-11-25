/**
 * The persistent bridge's restore (harness-only): the full state's
 * re-read (the snapshot's source, the keyset cursor's continuation) and
 * the snapshot's seed over a fresh memory bridge — the tables stand under
 * the slug the saved id implies (renamed to the saved name), the columns
 * / rows re-created in the saved order over the generated id's counter
 * padding (a throwaway create + delete pair advances the allocation by
 * one, so a deleted column / row stands no shift of the surviving ids),
 * and a cell over a since-deleted column is dropped. The un-restorable
 * table stands the page's survival (the console's stand).
 */
import { newMutationContext } from "docblocks-react-ui";
import type { BatchOp, CellMap, DatabaseBridge, TableRef } from "docblocks-react-ui";

import { columnSpecOf, generatedSeq, restoreOrder } from "./bridge-snapshot";
import type { Snapshot, SnapshotTable } from "./bridge-snapshot";

/** The system tables' ids (the `listTables` stands them out — the
 * snapshot names them over this set; the seed restores the flag, the
 * create records the fresh id). */
const systemTableIds = new Set<string>();

/** The full state re-read over the public API (the snapshot's source; the
 * system tables stand over the `systemTableIds`' set — the `listTables`
 * stands them out, so the snapshot names them explicitly). */
async function snapshotOf(bridge: DatabaseBridge): Promise<Snapshot> {
  const limit = (await bridge.describeProtocol()).limits.maxPageSize;
  const refs: TableRef[] = [
    ...(await bridge.listTables()),
    ...[...systemTableIds].map((id) => ({ id, name: id, revision: "" })),
  ];
  const tables: SnapshotTable[] = [];
  for (const ref of refs) {
    let snapshot = await bridge.snapshotTable(ref.id, { limit });
    // The keyset cursor's continuation (a commit during the save stands the
    // cursor's expiry — the failure rejects the save's pass, the next
    // mutation re-saves).
    while (snapshot.page.nextCursor !== null) {
      const cursor = snapshot.page.nextCursor;
      const page = await bridge.queryNextPage(ref.id, {
        cursor,
        asOfSeq: snapshot.page.asOfSeq,
        queryFingerprint: snapshot.page.queryFingerprint,
      });
      snapshot = {
        ...snapshot,
        page: {
          ...snapshot.page,
          rows: [...snapshot.page.rows, ...page.rows],
          nextCursor: page.nextCursor,
        },
      };
    }
    tables.push({
      id: snapshot.table.id,
      name: snapshot.table.name,
      ...(snapshot.table.system === true ? { system: true } : {}),
      columns: snapshot.columns,
      rows: snapshot.page.rows,
    });
  }
  return { tables };
}

/** The column / row restore over the bridge's generated id's counter: a
 * throwaway create + delete pair advances the allocation by one (the
 * throwaway stands soft-deleted — invisible over the live schema / page,
 * the stream is not captured). The caller passes the bridge's allocated
 * counter (the last allocated sequence, 0 over a fresh table) and the
 * target's sequence minus one. */
async function padColumns(bridge: DatabaseBridge, tableId: string, current: number, target: number): Promise<void> {
  for (let pad = current; pad < target; pad += 1) {
    const dummy = await bridge.createColumn(
      tableId,
      { column: { name: "tmp", type: "text", position: 0, nullable: true } },
      newMutationContext()
    );
    await bridge.deleteColumn(tableId, dummy.result.id, newMutationContext());
  }
}

async function padRows(bridge: DatabaseBridge, tableId: string, current: number, target: number): Promise<void> {
  const dummies = target - current;
  if (dummies <= 0) return;
  const ops: BatchOp[] = [];
  for (let i = 0; i < dummies; i += 1) ops.push({ op: "create", row: {}, beforeRowId: null });
  const dummyReceipt = await bridge.batchRows(tableId, { ops }, newMutationContext());
  const dummyIds = dummyReceipt.result.rows.map((row) => row.id);
  const deletes: BatchOp[] = dummyIds.map((rowId) => ({ op: "delete", rowId }));
  await bridge.batchRows(tableId, { ops: deletes }, newMutationContext());
}

/** The snapshot's seed (the reload's restore): the tables / columns / rows
 * stand over the memory bridge before any consumer read. The reference
 * bridge derives the table id from the name's slug, so the table is
 * created under the slug the saved id implies and then renamed to the
 * saved name (the rename's stand over the create's id). The generated
 * column / row ids are restored over the counter's padding (see
 * `padColumns` / `padRows`); the rows are re-created in the saved visible
 * order (the append's stand keeps it), and a cell over a since-deleted
 * column is dropped (the column's soft-delete posture stands no capture). */
function seed(bridge: DatabaseBridge, snapshot: Snapshot): Promise<void> {
  return (async () => {
    for (const table of restoreOrder(snapshot.tables)) {
      try {
        // The slug name the saved id implies (the `table-` prefix's stand);
        // a malformed id stands the saved name (the fresh derivation's
        // best-effort stand).
        const slug = table.id.startsWith("table-") ? table.id.slice("table-".length) : table.name;
        const receipt = await bridge.createTable(
          { name: slug, ...(table.system === true ? { system: true } : {}) },
          newMutationContext()
        );
        if (table.system === true) systemTableIds.add(receipt.result.id);
        if (receipt.result.name !== table.name) {
          await bridge.renameTable(receipt.result.id, { name: table.name }, newMutationContext());
        }
        // The columns stand the ascending generated-id sequence (the
        // counter's allocation stand — the padding advances the bridge's
        // allocation over the deleted columns' gaps), placed over the
        // `afterColumnId` anchor (the nearest standing visible
        // predecessor), so the visible order stands the snapshot's schema
        // order.
        let columnSeq = 0;
        const createdColumnIndexes = new Set<number>();
        const createOrder = table.columns
          .map((column, index) => ({ column, index, seq: generatedSeq(receipt.result.id, "c", column.id) }))
          .sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
        for (const entry of createOrder) {
          if (entry.seq !== null) await padColumns(bridge, receipt.result.id, columnSeq, entry.seq - 1);
          let anchorId: string | undefined;
          for (let index = entry.index - 1; index >= 0; index -= 1) {
            if (createdColumnIndexes.has(index)) {
              anchorId = table.columns[index]!.id;
              break;
            }
          }
          await bridge.createColumn(
            receipt.result.id,
            {
              column: columnSpecOf(entry.column),
              ...(anchorId !== undefined ? { afterColumnId: anchorId } : {}),
            },
            newMutationContext()
          );
          columnSeq = entry.seq !== null ? entry.seq : columnSeq + 1;
          createdColumnIndexes.add(entry.index);
        }
        const liveColumnIds = new Set(table.columns.map((column) => column.id));
        let rowSeq = 0;
        for (const row of table.rows) {
          const seq = generatedSeq(receipt.result.id, "r", row.id);
          if (seq !== null) await padRows(bridge, receipt.result.id, rowSeq, seq - 1);
          const cells: CellMap = {};
          for (const [key, value] of Object.entries(row.cells)) {
            if (liveColumnIds.has(key)) cells[key] = value;
          }
          await bridge.batchRows(
            receipt.result.id,
            { ops: [{ op: "create", row: cells, beforeRowId: null }] },
            newMutationContext()
          );
          rowSeq = seq !== null ? seq : rowSeq + 1;
        }
      } catch (error) {
        // The un-restorable table (the malformed snapshot / the foreign
        // reference) stands the page's survival: the demo tables re-seed
        // over insert-blocks, the user's table stands the console's stand.
        console.error("the persistent bridge's restore failed for the table", table.id, error);
      }
    }
  })();
}

export { seed, snapshotOf, systemTableIds };
