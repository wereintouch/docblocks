import type { DocJSON } from "../src/schema";

/**
 * Golden document fixture covering the full v1 block catalog with stable
 * ids, a nested list, a 3-column table (one filled, two empty cells), and
 * a code block. Already in normalized (export) form: the round-trip
 * fromJSON(fixture) → toJSON() must equal it exactly.
 */
const fixture: DocJSON = {
  v: 1,
  id: "d_8f3a2c",
  title: "Migration to the new backend",
  createdAt: "2026-10-08T10:00:00Z",

  blocks: {
    b00: { type: "root", children: ["b01", "b02", "b03", "b04", "b05", "b06", "b07", "b08"] },

    b01: { type: "heading", attrs: { level: 1 }, content: [{ text: "Migration", marks: {} }] },

    b02: {
      type: "paragraph",
      content: [
        { text: "Sync goes over ", marks: {} },
        { text: "Yjs", marks: { bold: true } },
        { text: " via WebSocket.", marks: {} },
      ],
    },

    b03: {
      type: "list-item",
      attrs: { list: "task", checked: true },
      content: [{ text: "sketch the schema", marks: {} }],
      children: ["b03a"],
    },
    b03a: {
      type: "list-item",
      attrs: { list: "task", checked: false },
      content: [{ text: "usage-audit", marks: {} }],
    },

    b04: { type: "code", attrs: { language: "ts" }, content: [{ text: "const a = 1\nconst b = 2", marks: {} }] },

    b05: { type: "latex", attrs: { display: true }, content: [{ text: "e^{i\\pi} + 1 = 0", marks: {} }] },

    b06: { type: "table", attrs: { cols: 3 }, children: ["r1"] },
    r1: { type: "table-row", children: ["c1", "c2", "c3"] },
    c1: { type: "table-cell", content: [{ text: "cell", marks: { bold: true } }] },
    c2: { type: "table-cell", content: [] },
    c3: { type: "table-cell", content: [] },

    b07: { type: "image", attrs: { src: "blobs/ab12.png", width: null, align: "center" } },

    b08: { type: "divider" },
  },
};

export { fixture };
