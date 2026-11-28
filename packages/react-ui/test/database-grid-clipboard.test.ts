import { describe, expect, it, vi } from "vitest";

import type { BridgeColumn } from "../src/database/bridge";
import {
  DATABASE_GRID_MIME,
  buildDatabaseGridClipboard,
  parseDatabaseGridPayload,
  resolveStructuredGridCell,
  resolveTextGridCell,
  writeDatabaseGridClipboard,
} from "../src/database/grid/grid-cell-clipboard";
import { refEntryKey } from "../src/database/grid/use-ref-tables";
import type { RefTableDataMap } from "../src/database/grid/use-ref-tables";

const columns: BridgeColumn[] = [
  { id: "text", name: "Text", type: "text" },
  { id: "number", name: "Number", type: "integer" },
  { id: "done", name: "Done", type: "boolean" },
  { id: "status", name: "Status", type: "text", refKind: "enum", refTableId: "refs" },
  { id: "owner", name: "Owner", type: "text", refKind: "row", refTableId: "refs" },
  { id: "tags", name: "Tags", type: "text", refKind: "enum", refTableId: "refs", refMany: true },
];
const refTableData: RefTableDataMap = {
  [refEntryKey({ tableId: "refs" })]: {
    rowIds: ["opt-a", "opt-b", "row-a", "row-b", "row-c"],
    displays: {
      "opt-a": "Alpha",
      "opt-b": "Beta",
      "row-a": "Same",
      "row-b": "Same",
      "row-c": "Unique",
    },
    colors: {},
  },
};
const refData = refTableData[refEntryKey({ tableId: "refs" })];
const frame = { anchorR: 0, anchorC: 0, cursorR: 0, cursorC: 5 };

describe("the database grid clipboard payload", () => {
  it("writes display TSV beside raw structured values", () => {
    const clipboard = buildDatabaseGridClipboard({
      tableId: "table",
      rows: [
        {
          rowId: "row",
          cells: {
            text: "hello",
            number: 4,
            done: true,
            status: "opt-a",
            owner: "row-c",
            tags: ["opt-a", "opt-b"],
          },
        },
      ],
      columns,
      selectionFrame: frame,
      refTableData,
    });
    expect(clipboard).not.toBeNull();
    expect(clipboard?.text).toBe("hello\t4\ttrue\tAlpha\tUnique\tAlpha,Beta");
    const payload = JSON.parse(clipboard?.payload ?? "{}") as {
      v: number;
      tableId: string;
      cells: unknown[][];
    };
    expect(payload).toEqual({
      v: 1,
      tableId: "table",
      cells: [["hello", 4, true, "opt-a", "row-c", ["opt-a", "opt-b"]]],
    });
    expect(clipboard?.mime).toBe(DATABASE_GRID_MIME);
  });

  it("writes the custom JSON and plain-text flavors together", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    class TestClipboardItem {
      constructor(readonly data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", TestClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    try {
      await writeDatabaseGridClipboard({ mime: DATABASE_GRID_MIME, text: "a", payload: "{}" });
      expect(write).toHaveBeenCalledOnce();
      const item = write.mock.calls[0]?.[0][0] as TestClipboardItem;
      expect(Object.keys(item.data)).toEqual(["text/plain", DATABASE_GRID_MIME]);
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts only the versioned payload from the same table", () => {
    const raw = JSON.stringify({ v: 1, tableId: "table", cells: [["a", 1]] });
    expect(parseDatabaseGridPayload(raw, "table")).toEqual([["a", 1]]);
    expect(parseDatabaseGridPayload(raw, "other")).toBeNull();
    expect(parseDatabaseGridPayload("not-json", "table")).toBeNull();
    expect(parseDatabaseGridPayload(JSON.stringify({ v: 2, tableId: "table", cells: [] }), "table")).toBeNull();
    expect(parseDatabaseGridPayload(JSON.stringify({ v: 1, tableId: "table", cells: [{}] }), "table")).toBeNull();
  });
});

describe("the database grid text paste resolution", () => {
  it("resolves an enum by its trimmed exact label and skips an absent label", () => {
    expect(resolveTextGridCell(columns[3]!, " Alpha ", refData)).toEqual({ ok: true, value: "opt-a" });
    expect(resolveTextGridCell(columns[3]!, "alp", refData).ok).toBe(false);
    expect(resolveTextGridCell(columns[3]!, "", refData)).toEqual({ ok: true, value: null });
  });

  it("resolves only a unique row-link display and supports the copied multi-value form", () => {
    expect(resolveTextGridCell(columns[4]!, "Unique", refData)).toEqual({ ok: true, value: "row-c" });
    expect(resolveTextGridCell(columns[4]!, "Same", refData).ok).toBe(false);
    expect(resolveTextGridCell(columns[4]!, "Missing", refData).ok).toBe(false);
    expect(resolveTextGridCell(columns[5]!, " Alpha, Beta ", refData)).toEqual({
      ok: true,
      value: ["opt-a", "opt-b"],
    });
    expect(resolveTextGridCell(columns[5]!, "Alpha,Missing", refData).ok).toBe(false);
  });

  it("keeps the existing scalar parsers", () => {
    expect(resolveTextGridCell(columns[1]!, "7", undefined)).toEqual({ ok: true, value: 7 });
    expect(resolveTextGridCell(columns[1]!, "bad", undefined).ok).toBe(false);
  });
});

describe("the database grid structured value validation", () => {
  it("preserves valid raw scalar and reference values", () => {
    expect(resolveStructuredGridCell(columns[0]!, "text")).toEqual({ ok: true, value: "text" });
    expect(resolveStructuredGridCell(columns[1]!, 3)).toEqual({ ok: true, value: 3 });
    expect(resolveStructuredGridCell(columns[2]!, false)).toEqual({ ok: true, value: false });
    expect(resolveStructuredGridCell(columns[3]!, "opt-a")).toEqual({ ok: true, value: "opt-a" });
    expect(resolveStructuredGridCell(columns[5]!, ["opt-a", "opt-b"])).toEqual({
      ok: true,
      value: ["opt-a", "opt-b"],
    });
    expect(resolveStructuredGridCell(columns[3]!, null)).toEqual({ ok: true, value: null });
  });

  it("rejects malformed values instead of writing clipboard data blindly", () => {
    expect(resolveStructuredGridCell(columns[1]!, "3").ok).toBe(false);
    expect(resolveStructuredGridCell(columns[1]!, Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(resolveStructuredGridCell(columns[2]!, "true").ok).toBe(false);
    expect(resolveStructuredGridCell(columns[3]!, ["opt-a"]).ok).toBe(false);
    expect(resolveStructuredGridCell(columns[5]!, "opt-a").ok).toBe(false);
  });
});
