import { type Page } from "@playwright/test";

import { switchPaneView } from "./harness";

/** Switch the pane to the canvas view. */
async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await switchPaneView(page, client, "canvas");
}

/** The pane's canvas view element. */
const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

/** The canvas view's center point (the 100% zoom / no pan anchor). */
async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A canvas point at 100% zoom / no pan stands at the center + the offset. */
function screenAt(center: { x: number; y: number }, x: number, y: number): { x: number; y: number } {
  return { x: center.x + x, y: center.y + y };
}

/** A canvas point at an arbitrary zoom / no pan stands at the center + the scaled offset. */
function screenAtZoom(center: { x: number; y: number }, x: number, y: number, zoom: number): { x: number; y: number } {
  return { x: center.x + x * zoom, y: center.y + y * zoom };
}

/** A canvas block's read stand (the specs' local shape of `docBlocks`). */
interface HitBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
}

/**
 * The block's press point in the canvas (world) coordinates — the hit
 * resolver's zone: the box's inset corner over a figure / a canvas-text (clear
 * of a connector's center-to-center route), the outline's vertex over an
 * explicitly transparent figure (`fill: "none"` — its interior passes the
 * press through), the top
 * edge's midpoint over a container / a frame (the border's band), the line's
 * midpoint over a connector.
 */
function hitPointOf(blocks: Record<string, HitBlock>, id: string): { x: number; y: number } {
  const block = blocks[id];
  if (block === undefined) throw new Error(`the canvas block ${id} is missing`);
  if (block.type === "connector") {
    const points: { x: number; y: number }[] = [];
    for (const key of ["start", "end"] as const) {
      const ref = block.attrs?.[key] as { blockId?: string; x?: number; y?: number } | undefined;
      if (ref?.x !== undefined && ref.y !== undefined) {
        points.push({ x: ref.x, y: ref.y });
        continue;
      }
      const target = ref?.blockId !== undefined ? blocks[ref.blockId] : undefined;
      points.push(pointAt(target));
    }
    const [start, end] = points;
    if (start === undefined || end === undefined) throw new Error("the connector's endpoints are missing");
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
  const box = pointAt(block);
  const geometry = block.geometry ?? { x: box.x, y: box.y, w: 100, h: 100 };
  if (block.type === "group" || block.type === "frame") return { x: geometry.x, y: geometry.y - geometry.h / 2 };
  const fill = block.attrs?.fill;
  const explicitlyTransparent = fill === "none" || fill === "transparent";
  if (block.type === "shape" && explicitlyTransparent) return { x: geometry.x - geometry.w / 2, y: geometry.y };
  // The box's zone: the bottom-left corner's inset (an interior point clear
  // of the connectors' center-to-center routes, which cross the box's middle).
  return { x: geometry.x - geometry.w / 2 + geometry.w / 8, y: geometry.y - geometry.h / 2 + (geometry.h * 7) / 8 };
}

/** The block's centre (the geometry's center anchor; the origin over the
 * absent geometry). */
function pointAt(block: HitBlock | undefined): { x: number; y: number } {
  return { x: block?.geometry?.x ?? 0, y: block?.geometry?.y ?? 0 };
}

/**
 * Seed a shape into the pane's first surface (created when the doc has
 * none) with the attrs + geometry and return its id.
 */
async function seedShape(
  page: Page,
  client: "a" | "b",
  attrs: Record<string, unknown> = { variant: "rect" },
  geometry: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 240, h: 120 }
): Promise<string> {
  return page.evaluate(
    ({ client, attrs, geometry }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const id = doc.insertBlock("shape", attrs, { parent: surface });
      doc.setGeometry(id, geometry);
      return id;
    },
    { client, attrs, geometry }
  );
}

/** The pane doc's blocks with their geometries (the specs read the seed / move / resize results). */
async function blockShapes(
  page: Page,
  client: "a" | "b"
): Promise<Record<string, { type: string; geometry: { x: number; y: number; w: number; h: number } | undefined }>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<
        string,
        { type: string; geometry: { x: number; y: number; w: number; h: number } | undefined }
      > = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const entry = block as { type: string; geometry?: { x: number; y: number; w: number; h: number } };
        out[id] = { type: entry.type, geometry: entry.geometry };
      }
      return out;
    },
    { client }
  );
}

export { blockShapes, canvasCenter, canvasView, hitPointOf, screenAt, screenAtZoom, seedShape, toCanvas };
export type { HitBlock };
