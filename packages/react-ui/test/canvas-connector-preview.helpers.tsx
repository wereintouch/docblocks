// The connector preview tests' shared stand: the canvas's seed (the
// surface + the two shapes at ±100), the canvas's render + the preview's
// line's read, the connectors' count, and the per-test's cleanup.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { createDoc } from "docblocks-core";
import type { Block } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  a: string;
  b: string;
  previewLine: () => SVGLineElement | null;
}

function renderCanvas(): Rendered {
  const doc = createDoc({ id: "connector-preview-doc", createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
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
    a,
    b,
    previewLine: () => view.querySelector<SVGLineElement>('[data-slot="docblocks/canvas-connector-preview"] line'),
  };
}

const connectorsOf = (doc: TestDoc) =>
  Object.values(doc.toJSON().blocks).filter(
    (block): block is Extract<Block, { type: "connector" }> => block.type === "connector"
  );

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

export { CREATED_AT, connectorsOf, renderCanvas };
export type { Rendered };
