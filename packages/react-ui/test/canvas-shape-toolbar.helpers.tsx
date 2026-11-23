// The shape's color toolbar tests' shared stand: the doc's fixture (a
// seeded surface with a shape + a canvas-text over the test palette), the
// canvas's render, the toolbar's query, the block's select, and the
// per-test's cleanup.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { pressBlock } from "./canvas-press";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

// A hex palette for the applies (jsdom cannot resolve the default palette's
// theme tokens — the commit would stand no write); the hex entries pass
// through, so the applies are deterministic.
const TEST_PALETTE = ["#3b82f6", "#e11d48", "#10b981"];

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "shape-color-doc", createdAt: CREATED_AT });
}

function shapeAttr(doc: TestDoc, id: string, name: "fill" | "stroke"): unknown {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "shape") return null;
  return block.attrs?.[name] ?? null;
}

function seededDoc(): { doc: TestDoc; surface: string; shape: string; text: string } {
  const doc = newDoc();
  const surface = doc.insertBlock("surface");
  const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(shape, { x: 0, y: 0, w: 200, h: 100 });
  const text = doc.insertBlock("canvas-text", { fontSize: 16 }, { parent: surface });
  return { doc, surface, shape, text };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function renderCanvas(doc: TestDoc, palette: readonly string[] = TEST_PALETTE) {
  const utils = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" formatPalette={palette} />
    </EditorProvider>
  );
  const view = utils.container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view };
}

const toolbar = () => screen.queryByRole("toolbar", { name: "Shape options" });

/** Click-select the block (the press over the block's own zone — the
 * resolver's answer over the geometry). */
function selectBlock(view: HTMLElement, doc: TestDoc, id: string): void {
  pressBlock(view, doc, id);
}

export { newDoc, renderCanvas, seededDoc, shapeAttr, selectBlock, toolbar };
export type { TestDoc };
