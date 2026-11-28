// The canvas-selection's split set's shared stand: the seeded doc (the
// surface's two shapes + the connector), the canvas view's render (the
// wrapper's stand + the doc's json's read), the selection's ids, and the
// press's gestures (the plain click + the shift-click over the block's zone).
import { render } from "@testing-library/react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { pressBlock } from "./canvas-press";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Seeded {
  doc: TestDoc;
  a: string;
  b: string;
  connector: string;
}

function seededDoc(): Seeded {
  const doc = createDoc({ id: "canvas-selection-doc", createdAt: CREATED_AT });
  const surface: string = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: -50, w: 100, h: 60 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: 100, y: 50, w: 80, h: 60 });
  const connector = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
  return { doc, a, b, connector };
}

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  a: string;
  b: string;
  connector: string;
  wrapperOf: (id: string) => HTMLElement;
  json: () => ReturnType<TestDoc["toJSON"]>;
}

function renderCanvas(): Rendered {
  const { doc, a, b, connector } = seededDoc();
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return {
    doc,
    a,
    b,
    connector,
    view,
    wrapperOf: (id: string) => {
      const el = container.querySelector<HTMLElement>(
        `[data-slot="docblocks/canvas-item"][data-block-id="${id}"]:not([data-slot="docblocks/row"])`
      );
      if (el === null) throw new Error(`the canvas item ${id} is missing`);
      return el;
    },
    json: () => doc.toJSON(),
  };
}

/** The selected ids (the data-selected wrappers). */
function selectedIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]")).map(
    (el) => el.dataset.blockId as string
  );
}

/** A plain click over the block's own hit zone (the press starts a no-op move). */
function click(r: Rendered, id: string): void {
  pressBlock(r.view, r.doc, id);
}

/** A shift-click over the block's own hit zone. */
function shiftClick(r: Rendered, id: string): void {
  pressBlock(r.view, r.doc, id, { shiftKey: true });
}

export { click, renderCanvas, selectedIds, shiftClick };
