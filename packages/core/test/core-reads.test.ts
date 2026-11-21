import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { fromJSON } from "../src/core";
import { normalizeRuns } from "../src/core/normalize";
import type { DocJSON, MarkSet, TextRun } from "../src/schema";
import { fixture } from "./fixtures";

/**
 * The read path's plain snapshots (over the core's entry spec): the
 * getBlock / getRuns / getText plainness, the lazy run normalization, and
 * the normalizeRuns contract.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeDocJSON = (blocks: DocJSON["blocks"]): DocJSON => ({
  v: 1,
  id: "r",
  title: "",
  createdAt: CREATED_AT,
  blocks,
});

describe("reads return plain snapshots", () => {
  const doc = fromJSON(fixture);

  it("getBlock is a plain object: JSON round-trip, no Yjs instances", () => {
    const block = doc.getBlock("b02");
    expect(block).not.toBeNull();
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
    expect(block).not.toBeInstanceOf(Y.Map);
    expect(block).not.toBeInstanceOf(Y.Array);
    expect(doc.getBlock("missing")).toBeNull();
  });

  it("getRuns is a plain array of plain runs (no Y.Map instances)", () => {
    const runs = doc.getRuns("b02");
    expect(Array.isArray(runs)).toBe(true);
    expect(JSON.parse(JSON.stringify(runs))).toEqual(runs);
    for (const run of runs) expect(run).not.toBeInstanceOf(Y.Map);
    expect(runs).toEqual([
      { text: "Sync goes over ", marks: {} },
      { text: "Yjs", marks: { bold: true } },
      { text: " via WebSocket.", marks: {} },
    ]);
  });

  it("getText / getChildren are plain values", () => {
    expect(typeof doc.getText("b02")).toBe("string");
    expect(doc.getChildren("d_8f3a2c")).toEqual(["b01", "b02", "b03", "b03a", "b04", "b06", "b07", "b08"]); // root id === doc id
    expect(doc.getChildren("b03")).toEqual([]); // flat page: the nesting is the indent attr, not children
    expect(doc.getChildren("b01")).toEqual([]); // paragraph: no children
    expect(doc.getChildren("missing")).toEqual([]);
  });

  it("getText flattens runs; empty for non-text types and missing blocks", () => {
    expect(doc.getText("b02")).toBe("Sync goes over Yjs via WebSocket.");
    expect(doc.getTextLength("b02")).toBe(doc.getText("b02").length);
    expect(doc.getText("b06")).toBe(""); // table: non-text
    expect(doc.getRuns("b06")).toEqual([]);
    expect(doc.getTextLength("b06")).toBe(0);
    expect(doc.getText("missing")).toBe("");
    expect(doc.getRuns("missing")).toEqual([]);
    expect(doc.getTextLength("missing")).toBe(0);
  });
});

describe("run normalization (lazy, at read/export)", () => {
  it("merges adjacent equal-marks runs and drops empty runs", () => {
    const doc = fromJSON(
      makeDocJSON({
        r: { type: "root", children: ["p"] },
        p: {
          type: "paragraph",
          content: [
            { text: "a", marks: { bold: true } },
            { text: "", marks: {} },
            { text: "b", marks: { bold: true } },
            { text: "c", marks: {} },
            { text: "", marks: { bold: true } },
          ],
        },
      })
    );
    expect(doc.getRuns("p")).toEqual([
      { text: "ab", marks: { bold: true } },
      { text: "c", marks: {} },
    ]);
    expect(doc.getText("p")).toBe("abc");
    expect(doc.toJSON().blocks.p).toEqual({
      type: "paragraph",
      content: [
        { text: "ab", marks: { bold: true } },
        { text: "c", marks: {} },
      ],
    });
  });

  it("keeps a mark-application split (distinct mark sets stay separate runs)", () => {
    // A range marked bold + color + highlight splits one run into three.
    const marked: TextRun[] = [
      { text: "Help us ", marks: {} },
      { text: "sync", marks: { bold: true, color: { value: "#0066CC" }, highlight: { value: "#FFF3B0" } } },
      { text: " faster!", marks: {} },
    ];
    const doc = fromJSON(
      makeDocJSON({ r: { type: "root", children: ["p"] }, p: { type: "paragraph", content: marked } })
    );
    expect(doc.getRuns("p")).toEqual(marked);
    expect(doc.getText("p")).toBe("Help us sync faster!");
    expect(doc.toJSON().blocks.p).toEqual({ type: "paragraph", content: marked });
  });
});

describe("normalizeRuns", () => {
  const run = (text: string, marks: MarkSet = {}): TextRun => ({ text, marks });

  it("drops empty runs and merges adjacent equal-marks runs", () => {
    expect(
      normalizeRuns([
        run("a", { bold: true }),
        run("", {}),
        run("b", { bold: true }),
        run("c"),
        run("d"),
        run("", { bold: true }),
      ])
    ).toEqual([run("ab", { bold: true }), run("cd")]);
  });

  it("does not merge across different mark sets (incl. attribute values)", () => {
    expect(
      normalizeRuns([
        run("a", { color: { value: "#111111" } }),
        run("b", { color: { value: "#222222" } }),
        run("c", { link: { href: "/a" } }),
        run("d", { link: { href: "/a" } }),
      ])
    ).toEqual([
      run("a", { color: { value: "#111111" } }),
      run("b", { color: { value: "#222222" } }),
      run("cd", { link: { href: "/a" } }),
    ]);
  });

  it("returns copied runs (no shared mark references with the input)", () => {
    const bold = { bold: true } as MarkSet;
    const result = normalizeRuns([run("a", bold), run("b", bold)]);
    expect(result).toEqual([run("ab", { bold: true })]);
    expect(result[0]?.marks).not.toBe(bold);
  });

  it("returns an empty array for empty input", () => {
    expect(normalizeRuns([])).toEqual([]);
  });
});
