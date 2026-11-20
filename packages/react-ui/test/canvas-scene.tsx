// The canvas scene's shared kit: the seeded scene, the render harness, and
// the id/point readers the scene's tests stand on (each test file stands its
// own jsdom pragma and the cleanup).
import { render } from "@testing-library/react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** Deterministic canvas ids: c0001 surface, then the elements in z-order. */
function canvasIdGenerator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `c${String(next).padStart(4, "0")}`;
  };
}

const IDS = {
  surface: "c0001",
  rect: "c0002",
  ellipse: "c0003",
  text: "c0004",
  connector: "c0005",
  brokenConnector: "c0006",
  frame: "c0007",
  docIdConnector: "c0008",
  pointsConnector: "c0009",
} as const;

/**
 * The canvas scene (the ids follow the insertion order — the children
 * order IS the z-order): a rect, a dashed ellipse, a sized canvas-text,
 * a connector between the two shapes, a connector with an unresolvable
 * start, a childless frame (the viewport window — the content stands on
 * the surface, not on the frame), a connector with a docId ref
 * (skipped: cross-doc resolution is the consumer's level), and a
 * points connector (the polyline path).
 */
function seedCanvasScene(doc: TestDoc): void {
  doc.transact(() => {
    const surface = doc.insertBlock("surface");
    doc.setGeometry(surface, { x: 0, y: 0, w: 800, h: 400 });
    const rect = doc.insertBlock("shape", { variant: "rect", fill: "rgba(9, 105, 218, 0.2)" }, { parent: surface });
    doc.setGeometry(rect, { x: -100, y: -40, w: 120, h: 80 });
    const ellipse = doc.insertBlock("shape", { variant: "ellipse", strokeStyle: "dash" }, { parent: surface });
    doc.setGeometry(ellipse, { x: 120, y: 0, w: 60, h: 60 });
    const text = doc.insertBlock("canvas-text", { fontSize: 20, textAlign: "center" }, { parent: surface });
    doc.insertText(text, 0, "Canvas text");
    doc.setGeometry(text, { x: 0, y: 100, w: 140, h: 40 });
    doc.insertBlock(
      "connector",
      { start: { blockId: rect }, end: { blockId: ellipse }, label: "link" },
      { parent: surface }
    );
    doc.insertBlock(
      "connector",
      { start: { blockId: "absent-block" }, end: { blockId: ellipse } },
      { parent: surface }
    );
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    doc.setGeometry(frame, { x: 300, y: -120, w: 260, h: 200 });
    doc.insertBlock(
      "connector",
      { start: { docId: "other-doc", blockId: rect }, end: { blockId: ellipse } },
      { parent: surface }
    );
    doc.insertBlock(
      "connector",
      {
        start: { blockId: rect },
        end: { blockId: ellipse },
        points: [
          [10, 10],
          [40, 20],
        ],
      },
      { parent: surface }
    );
  });
}

interface RenderOptions {
  blockRenderers?: BlockRendererMap;
  /** The doc seed (the canvas scene by default). */
  seed?: (doc: TestDoc) => void;
  /** The editor's view (page by default). */
  view?: "page" | "canvas";
}

function renderScene(options?: RenderOptions) {
  const doc = createDoc({ id: "outer", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
  (options?.seed ?? seedCanvasScene)(doc);
  render(
    <EditorProvider doc={doc} blockRenderers={options?.blockRenderers}>
      <Editor view={options?.view} />
    </EditorProvider>
  );
  return doc;
}

/** The canvas-item wrappers over the world's DIRECT children (the z-order
 * pin — the frame's window's copies stand inside the frame's wrapper and
 * stand out of the list). */
function canvasItemIds(): string[] {
  const world = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]');
  if (world === null) return [];
  return Array.from(world.children)
    .filter((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.slot === "docblocks/canvas-item")
    .map((el) => el.dataset.blockId as string);
}

/** A Y.Map-shaped instance (the borrowed-constructor seed below). */
interface YMapLike {
  set(key: string, value: unknown): void;
}

/**
 * A canvas element at the page root (the lenient-data case the registry
 * forbids — a foreign peer or a raw CRDT write). react-ui must not import
 * yjs, so the Y.Map constructor is borrowed from the doc's registered
 * meta map instance.
 */
function seedStrayShape(doc: TestDoc): void {
  const metaMap = doc.raw.getMap("meta") as unknown as { constructor: new () => YMapLike };
  const YMap = metaMap.constructor;
  const id = "stray-shape";
  const entry = new YMap();
  entry.set("type", "shape");
  const attrs = new YMap();
  attrs.set("variant", "rect");
  entry.set("attrs", attrs);
  doc.raw.transact(() => {
    doc.raw.getMap("blocks").set(id, entry);
    doc.raw.getArray("rootOrder").push([id]);
  });
}

/** Parses the path's numeric coordinate pairs (the M/L/C sequence). */
function parsePathPoints(d: string): { x: number; y: number }[] {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const x = numbers[i];
    const y = numbers[i + 1];
    if (x === undefined || y === undefined) break;
    points.push({ x, y });
  }
  return points;
}

export { canvasItemIds, CREATED_AT, IDS, parsePathPoints, renderScene, seedStrayShape };
export type { TestDoc };
