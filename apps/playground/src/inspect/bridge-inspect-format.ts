/**
 * The bridge inspector's display format (harness-only): the add-column's
 * type catalog, the event / row log's caps, the shared field styles, and
 * the pure line formatters (the envelope's summary, the cell value's text,
 * the column's schema line).
 */
import type { Column, TableEvent } from "docblocks-react-ui";

/** The PostgreSQL type catalog the add-column form offers (the package's
 *  default annotation resolves each to its operator catalog + input). */
const COLUMN_TYPES = [
  "text",
  "integer",
  "smallint",
  "bigint",
  "double precision",
  "numeric",
  "boolean",
  "date",
  "timestamptz",
  "time",
  "interval",
];

/** The event / row log caps (the harness keeps a bounded tail). */
const LOG_CAP = 50;
const LABEL = "text-[11px] text-(--muted-foreground)";
const BOX = "mt-2 rounded border border-border p-2";
const BTN = "h-auto gap-0 rounded px-2 py-0.5 text-[11px] font-normal shadow-none";
const FIELD = "h-auto text-[11px] shadow-none";

/** A stamped bridge envelope (the relative ms + the local log sequence —
 * the envelope's own `seq` stands the stream's, the at-least-once
 * delivery stands the local key). */
type StampedEvent = TableEvent & { at: number; logSeq: number };

/** The envelope's log line: the kind + the nested domain events' types (the
 * row frames carry the row's id, the delete the row id, the option's rename
 * the option's id). */
function eventSummary(event: TableEvent): string {
  if (event.kind === "invalidate") return "invalidate (rebaseline)";
  return event.events
    .map((domain) => {
      switch (domain.type) {
        case "row.deleted":
          return `${domain.type} ${domain.payload.rowId}`;
        case "row.created":
        case "row.updated":
        case "row.moved":
        case "row.restored":
          return `${domain.type} ${domain.payload.row.id}`;
        case "enum.option.renamed":
          return `${domain.type} ${domain.payload.option.id}`;
        default:
          return domain.type;
      }
    })
    .join(", ");
}

/** The cell value as display text (null / undefined = empty). */
function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** The column's schema line (the type + the position / the nullability /
 * the revision + the reference relation + the number display). */
function columnLine(column: Column): string {
  let line = `${column.id}: ${column.type} · pos ${column.position} · ${column.nullable ? "nullable" : "not null"} · rev ${column.revision}`;
  if (column.reference !== undefined) {
    line += ` [${column.reference.kind}${column.reference.many ? ":many" : ""} → ${column.reference.tableId}]`;
  }
  if (column.numberDisplay !== undefined) {
    const display = column.numberDisplay;
    line += ` {dec=${display.decimals ?? 0}${display.prefix !== undefined ? `, prefix="${display.prefix}"` : ""}${display.suffix !== undefined ? `, suffix="${display.suffix}"` : ""}}`;
  }
  return line;
}

export { BTN, BOX, COLUMN_TYPES, FIELD, LABEL, LOG_CAP, cellText, columnLine, eventSummary };
export type { StampedEvent };
