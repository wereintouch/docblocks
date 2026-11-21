// The canvas-groups' split set's shared stand: the seeded doc (the surface +
// the three shapes + the optional group's own free box) and the canvas view's
// render (the view's stand + the doc's json's read).
import { render } from "@testing-library/react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-21T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  a: string;
  b: string;
  c: string;
  group: string;
  json: () => ReturnType<TestDoc["toJSON"]>;
}

function seededDoc(withGroup: boolean): { doc: TestDoc; a: string; b: string; c: string; group: string | null } {
  const doc = createDoc({ id: "canvas-groups-doc", createdAt: CREATED_AT });
  const surface: string = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: -50, w: 100, h: 60 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: 100, y: 50, w: 80, h: 60 });
  const c = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(c, { x: 0, y: 200, w: 60, h: 40 });
  let group: string | null = null;
  if (withGroup) {
    group = doc.insertBlock("group", { members: [a, b] }, { parent: surface });
    // The container's own free box: it
    // stands its own geometry, independent of the members' union.
    doc.setGeometry(group, { x: 0, y: 0, w: 400, h: 240 });
  }
  return { doc, a, b, c, group: group ?? "" };
}

function renderCanvas(withGroup: boolean): Rendered {
  const { doc, a, b, c, group } = seededDoc(withGroup);
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { doc, a, b, c, group: group ?? "", view, json: () => doc.toJSON() };
}

export { renderCanvas, seededDoc };
