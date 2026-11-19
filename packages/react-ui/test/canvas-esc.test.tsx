// @vitest-environment jsdom
// The canvas's Escape: the drill-up over a single selected member (the
// parent container stands selected — the top-most owner by the paint order,
// the innermost over a tie), the nested chain (one Escape per level), the
// drill-down session's cancel (the selection stands), and the fall-through
// to the editor's clear over no owner. A local view state's step: no write,
// no undo step.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { pressAt, pressBlock } from "./canvas-press";

const CREATED_AT = "2026-11-19T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  surface: string;
}

function renderDoc(doc: TestDoc, surface: string): Rendered {
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
  return { doc, view, surface };
}

/** The selected ids (the data-selected wrappers). */
function selectedIds(view: HTMLElement): string[] {
  return Array.from(view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]")).map(
    (element) => element.dataset.blockId as string
  );
}

/** Escapes (the keys land on the canvas view; the editor root stands the
 * clear's fall-through). */
function escape(view: HTMLElement): void {
  fireEvent.keyDown(view, { key: "Escape" });
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the drill-up over the Escape", () => {
  it("stands the member's container selected (no write, no undo step)", () => {
    const doc = createDoc({ id: "canvas-esc-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const group = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(group, { x: 0, y: 0, w: 400, h: 300 });
    const member = doc.insertBlock("shape", { variant: "rect", fill: "#fff" }, { parent: surface });
    doc.setGeometry(member, { x: 0, y: 0, w: 100, h: 60 });
    doc.transact(() => {
      doc.updateBlock(group, { members: [member] });
    });
    const r = renderDoc(doc, surface);
    pressBlock(r.view, doc, member);
    expect(selectedIds(r.view)).toEqual([member]);
    const before = JSON.stringify(doc.toJSON());
    escape(r.view);
    expect(selectedIds(r.view)).toEqual([group]);
    // The local view state's step: the document stands untouched (and the
    // undo stack holds nothing new — the undo of the seed transaction would
    // be the only step).
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    // A second Escape over the container's own (no owner) falls through to
    // the editor's clear.
    escape(r.view);
    expect(selectedIds(r.view)).toEqual([]);
  });

  it("walks the nested chain one level per Escape", () => {
    const doc = createDoc({ id: "canvas-esc-nested", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const outer = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(outer, { x: 0, y: 0, w: 600, h: 400 });
    const inner = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(inner, { x: 0, y: 0, w: 300, h: 200 });
    const member = doc.insertBlock("shape", { variant: "rect", fill: "#fff" }, { parent: surface });
    doc.setGeometry(member, { x: 0, y: 0, w: 80, h: 60 });
    doc.transact(() => {
      doc.updateBlock(outer, { members: [inner] });
      doc.updateBlock(inner, { members: [member] });
    });
    const r = renderDoc(doc, surface);
    pressBlock(r.view, doc, member);
    escape(r.view);
    expect(selectedIds(r.view)).toEqual([inner]);
    escape(r.view);
    expect(selectedIds(r.view)).toEqual([outer]);
  });

  it("stands the top-most owner over a multi-owned member", () => {
    const doc = createDoc({ id: "canvas-esc-multi", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const first = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(first, { x: 0, y: 0, w: 400, h: 300 });
    const second = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(second, { x: 0, y: 0, w: 200, h: 160 });
    const member = doc.insertBlock("shape", { variant: "rect", fill: "#fff" }, { parent: surface });
    doc.setGeometry(member, { x: 0, y: 0, w: 60, h: 40 });
    doc.transact(() => {
      doc.updateBlock(first, { members: [member] });
      doc.updateBlock(second, { members: [member] });
    });
    const r = renderDoc(doc, surface);
    pressBlock(r.view, doc, member);
    escape(r.view);
    // The paint order's tail (the later sibling) wins.
    expect(selectedIds(r.view)).toEqual([second]);
  });

  it("cancels the drill-down's session first (the selection stands)", () => {
    const doc = createDoc({ id: "canvas-esc-cycle", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const bottom = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe" }, { parent: surface });
    doc.setGeometry(bottom, { x: 0, y: 0, w: 200, h: 120 });
    const top = doc.insertBlock("shape", { variant: "rect", fill: "#fee2e2" }, { parent: surface });
    doc.setGeometry(top, { x: 0, y: 0, w: 120, h: 80 });
    const r = renderDoc(doc, surface);
    pressAt(r.view, { x: 0, y: 0 }, { altKey: true });
    expect(r.view.querySelector("[data-slot='docblocks/canvas-cycle-indicator']")).not.toBeNull();
    escape(r.view);
    // The session's cancel: the indicator stands off, the selection stands.
    expect(r.view.querySelector("[data-slot='docblocks/canvas-cycle-indicator']")).toBeNull();
    expect(selectedIds(r.view)).toEqual([top]);
  });

  it("stands the editor's clear over a selection with no owner", () => {
    const doc = createDoc({ id: "canvas-esc-plain", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const shape = doc.insertBlock("shape", { variant: "rect", fill: "#fff" }, { parent: surface });
    doc.setGeometry(shape, { x: 0, y: 0, w: 200, h: 120 });
    const r = renderDoc(doc, surface);
    pressBlock(r.view, doc, shape);
    escape(r.view);
    expect(selectedIds(r.view)).toEqual([]);
  });
});
