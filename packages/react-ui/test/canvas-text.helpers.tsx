// The shared fixtures over the canvas-text's split set (the doc's seed
// over the surface's canvas-text, the canvas view's render, the text /
// caret / children's reads).
import { render } from "@testing-library/react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  surface: string;
  text: string;
  item: () => HTMLElement;
  inner: () => HTMLElement;
}

function seedCanvasText(doc: TestDoc, text?: string): { surface: string; text: string } {
  const surface = doc.insertBlock("surface");
  const id = doc.insertBlock("canvas-text", undefined, { parent: surface });
  if (text !== undefined) doc.insertText(id, 0, text);
  doc.setGeometry(id, { x: 0, y: 0, w: 100, h: 40 });
  return { surface, text: id };
}

function renderCanvas(seedText?: string): Rendered {
  const doc = createDoc({ id: "canvas-text-doc", createdAt: CREATED_AT });
  const { surface, text } = seedCanvasText(doc, seedText);
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return {
    doc,
    view,
    surface,
    text,
    item: () => {
      const el = view.querySelector<HTMLElement>(
        `[data-slot="docblocks/canvas-item"][data-block-id="${text}"]:not([data-slot="docblocks/row"])`
      );
      if (el === null) throw new Error("the canvas-text item is missing");
      return el;
    },
    inner: () => {
      const el = view.querySelector<HTMLElement>(
        `[data-slot="docblocks/block-content"][data-block-id="${text}"]:not([data-slot="docblocks/row"])`
      );
      if (el === null) throw new Error("the canvas-text's inner is missing");
      return el;
    },
  };
}

/** The block's text (the single run's content). */
function textOf(doc: TestDoc, id: string): string {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "canvas-text") return "";
  return (block.content ?? []).map((run) => run.text).join("");
}

/** Place the DOM caret at the flat offset in the inner. */
function caretAtFlat(inner: HTMLElement, offset: number): void {
  const nodes: { node: Text; start: number; end: number }[] = [];
  let pos = 0;
  for (const child of Array.from(inner.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const length = child.nodeValue?.length ?? 0;
      nodes.push({ node: child as Text, start: pos, end: pos + length });
      pos += length;
    }
  }
  const at = nodes.find((n) => offset >= n.start && offset <= n.end);
  if (at === undefined) throw new Error(`no text node covers offset ${offset}`);
  const range = document.createRange();
  range.setStart(at.node, offset - at.start);
  range.collapse(true);
  const selection = window.getSelection();
  if (selection === null) throw new Error("the selection is missing");
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The surface's canvas-text children (the split's negative stand). */
function canvasTextChildren(doc: TestDoc, surface: string): string[] {
  return doc.getChildren(surface).filter((id) => doc.getBlock(id)?.type === "canvas-text");
}

export { CREATED_AT, canvasTextChildren, caretAtFlat, renderCanvas, seedCanvasText, textOf };
export type { TestDoc };
