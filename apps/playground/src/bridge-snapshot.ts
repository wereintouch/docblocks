/**
 * The persistent bridge's snapshot (harness-only): the localStorage's
 * shape (the table's stable id + name, the live column schema, the live
 * rows in the visible order) and the snapshot's pure helpers — the
 * malformed raw's stand, the generated id's sequence read, the column's
 * create spec, and the restore's table order (a referenced table stands
 * before its referencer).
 */
import type { Column, RowWire } from "docblocks-react-ui";

/** The snapshot's storage key (the v2's stand over the former v1's
 *  shape). */
const STORAGE_KEY = "docblocks-playground-bridge-v2";

interface SnapshotTable {
  /** The table's stable id (the restore's identity — the doc's `tableId`
   *  references depend on it surviving a rename + reload). */
  id: string;
  name: string;
  /** The system (hidden) table's stand (the enum's options — the
   *  `listTables` stands it out, so the snapshot names it explicitly). */
  system?: boolean;
  columns: Column[];
  rows: RowWire[];
}

interface Snapshot {
  tables: SnapshotTable[];
}

function loadSnapshot(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    return parsed !== null && typeof parsed === "object" && Array.isArray(parsed.tables) ? parsed : null;
  } catch {
    return null;
  }
}

/** The generated id's sequence over the `c-<tableId>-N` / `r-<tableId>-N`
 * allocation (null = an id outside the reference bridge's pattern). */
function generatedSeq(tableId: string, kind: "c" | "r", id: string): number | null {
  const prefix = `${kind}-${tableId}-`;
  if (!id.startsWith(prefix)) return null;
  const seq = Number(id.slice(prefix.length));
  return Number.isInteger(seq) && seq > 0 ? seq : null;
}

/** The column's create spec (the wire `Column` minus the bridge-owned
 * `id` / `revision`). */
function columnSpecOf(column: Column): Omit<Column, "id" | "revision"> {
  return {
    name: column.name,
    type: column.type,
    position: column.position,
    nullable: column.nullable,
    ...(column.operators !== undefined ? { operators: [...column.operators] } : {}),
    ...(column.reference !== undefined ? { reference: { ...column.reference } } : {}),
    ...(column.numberDisplay !== undefined ? { numberDisplay: { ...column.numberDisplay } } : {}),
  };
}

/** The restore's table order: a referenced table stands before its
 * referencer (the column's reference validation requires the linked
 * table's presence); a cycle keeps the snapshot's order. */
function restoreOrder(tables: SnapshotTable[]): SnapshotTable[] {
  const byId = new Map(tables.map((table) => [table.id, table]));
  const placed = new Set<string>();
  const out: SnapshotTable[] = [];
  const visit = (table: SnapshotTable, chain: Set<string>): void => {
    if (placed.has(table.id) || chain.has(table.id)) return;
    chain.add(table.id);
    for (const column of table.columns) {
      const refTableId = column.reference?.tableId;
      if (refTableId !== undefined) {
        const linked = byId.get(refTableId);
        if (linked !== undefined) visit(linked, chain);
      }
    }
    chain.delete(table.id);
    placed.add(table.id);
    out.push(table);
  };
  for (const table of tables) visit(table, new Set());
  return out;
}

export { STORAGE_KEY, columnSpecOf, generatedSeq, loadSnapshot, restoreOrder };
export type { Snapshot, SnapshotTable };
