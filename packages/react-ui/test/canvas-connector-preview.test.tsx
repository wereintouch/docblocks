// @vitest-environment jsdom
// The connector's pending preview + the press-drag draw: after the first
// endpoint pick a solid cyan line stands from the pending block's edge
// anchor to the cursor (the hover update runs before the buttons guard —
// the button-less hover follows too), the press-drag's release over the
// second item stands the pick (the creation), and the completion / cancel
// drop the preview. The previews' svgs stand 1x1 (a 0x0 svg rasterizes no
// content in Chromium).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type Block, createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { useEditorContext } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  a: string;
  b: string;
  item: (id: string) => HTMLElement;
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
    item: (id) => {
      const el = view.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      if (el === null) throw new Error("the canvas item is missing");
      return el;
    },
    previewLine: () => view.querySelector<SVGLineElement>('[data-slot="docblocks/canvas-connector-preview"] line'),
  };
}

const connectorsOf = (doc: TestDoc) =>
  Object.values(doc.toJSON().blocks).filter(
    (block): block is Extract<Block, { type: "connector" }> => block.type === "connector"
  );

afterEach(cleanup);

describe("the connector's pending preview", () => {
  it("the first pick stands the preview (the solid line on the cyan token, the 1x1 svg)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);

    fireEvent.pointerDown(r.item(r.a), { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });

    const line = r.previewLine();
    expect(line).not.toBeNull();
    const svg = line!.ownerSVGElement!;
    expect(svg.getAttribute("width")).toBe("1");
    expect(svg.getAttribute("height")).toBe("1");
    expect(line!.getAttribute("stroke")).toBe("var(--docblocks-canvas-selection-border-color)");
    // The pending new line has no stroke style: it stands the solid default
    // (per the data) — no dash pattern, the cyan color is the preview's stand.
    expect(line!.getAttribute("stroke-dasharray")).toBeNull();
    // The anchor stands on the pending block's edge (the box's border),
    // the far end is the cursor point (the jsdom bbox is 0 — the canvas
    // point is the client point as-is).
    const x1 = Number(line!.getAttribute("x1"));
    const y1 = Number(line!.getAttribute("y1"));
    expect(Math.abs(Math.abs(x1) - 50) <= 0.01 || Math.abs(Math.abs(y1) - 30) <= 0.01).toBe(true);
    expect(line!.getAttribute("x2")).toBe("-50");
    expect(line!.getAttribute("y2")).toBe("0");
  });

  it("the preview follows the button-less hover (the two-click path)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);
    fireEvent.pointerDown(r.item(r.a), { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.item(r.a), { clientX: -50, clientY: 0, pointerId: 1 });

    // The hover move (no button) re-feeds the preview point.
    fireEvent.pointerMove(r.view, { clientX: 40, clientY: -90, pointerId: 1 });
    const line = r.previewLine();
    expect(line).not.toBeNull();
    expect(line!.getAttribute("x2")).toBe("40");
    expect(line!.getAttribute("y2")).toBe("-90");

    // The second click completes: the connector lands, the preview drops.
    fireEvent.pointerDown(r.item(r.b), { clientX: 50, clientY: 0, button: 0, buttons: 1, pointerId: 2 });
    expect(connectorsOf(r.doc)).toHaveLength(1);
    expect(r.previewLine()).toBeNull();
  });

  it("the press-drag draw: the release over the second item stands the pick (the edge snaps at the press / release points)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);

    // The press stands on a's east edge (the jsdom bbox is 0 — the canvas
    // point is the client point as-is; the surface stands at the origin),
    // the release on b's west edge: both snap to the edge's point at the
    // cursor's projection (the t = 0.5 midpoint stand — the continuous
    // anchor).
    fireEvent.pointerDown(r.item(r.a), { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 0, clientY: -40, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 50, clientY: 0, buttons: 1, pointerId: 1 });
    expect(r.previewLine()).not.toBeNull();

    fireEvent.pointerUp(r.item(r.b), { clientX: 50, clientY: 0, pointerId: 1 });
    const connectors = connectorsOf(r.doc);
    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.attrs).toEqual({
      start: { blockId: r.a, port: "east", portT: 0.5 },
      end: { blockId: r.b, port: "west", portT: 0.5 },
      zIndex: 3,
    });
    expect(r.previewLine()).toBeNull();
  });

  it("the press-drag draw: the release on the empty canvas commits the free end (the free point ref)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);

    // A real drag from a to the empty canvas (well past the threshold):
    // the end commits as a free point at the release (surface-local —
    // the surface stands at the origin, the jsdom points stand as-is).
    fireEvent.pointerDown(r.item(r.a), { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 0, clientY: -40, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 300, clientY: 80, pointerId: 1 });
    const connectors = connectorsOf(r.doc);
    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.attrs).toEqual({
      start: { blockId: r.a, port: "east", portT: 0.5 },
      end: { x: 300, y: 80 },
      zIndex: 3,
    });
  });

  it("the empty-canvas press stands the free stand (the press point is the first endpoint)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);

    // The press off the items stands the free stand (the preview line
    // stands from the press point — not a block's edge anchor).
    fireEvent.pointerDown(r.view, { clientX: -200, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    const line = r.previewLine();
    expect(line).not.toBeNull();
    expect(line!.getAttribute("x1")).toBe("-200");
    expect(line!.getAttribute("y1")).toBe("100");

    // The release over b commits: the free start + the block end (the
    // release point (50, 0) snaps b's west edge at the midpoint's t).
    fireEvent.pointerMove(r.view, { clientX: 0, clientY: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.item(r.b), { clientX: 50, clientY: 0, pointerId: 1 });
    const connectors = connectorsOf(r.doc);
    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.attrs).toEqual({
      start: { x: -200, y: 100 },
      end: { blockId: r.b, port: "west", portT: 0.5 },
      zIndex: 3,
    });
  });

  it("the Escape cancel drops the preview (the doc stands)", () => {
    const r = renderCanvas();
    const before = r.doc.toJSON();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);
    fireEvent.pointerDown(r.item(r.a), { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    expect(r.previewLine()).not.toBeNull();

    fireEvent.keyDown(r.view, { key: "Escape" });
    expect(r.previewLine()).toBeNull();
    expect(connectorsOf(r.doc)).toHaveLength(0);
    expect(r.doc.toJSON()).toEqual(before);
  });
});

describe("the endpoint handles' drag (the selected line's endpoints)", () => {
  // The selection is store view state (not doc data): a probe component
  // inside the provider stands the selection (the handles render for the
  // selected line only).
  interface DragRendered extends Rendered {
    connectorId: string;
    setSelection: (kind: "blocks" | "none", ids?: string[]) => void;
    handle: (which: "start" | "end") => SVGCircleElement | null;
  }

  function renderWithConnector(): DragRendered {
    const doc = createDoc({ id: "connector-preview-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
    const connectorId = doc.insertBlock(
      "connector",
      { start: { blockId: a }, end: { blockId: b } },
      { parent: surface }
    );
    // The probe stands the selection handle (the editor store's slice) —
    // one provider over the Editor + the probe (the same store).
    let setSelection: DragRendered["setSelection"] = () => {};
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
        <SelectionProbe onReady={(set) => (setSelection = set)} />
      </EditorProvider>
    );
    const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
    if (view === null) throw new Error("the canvas view is missing");
    const base: Rendered = {
      doc,
      view,
      a,
      b,
      item: (id) => {
        const el = view.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
        if (el === null) throw new Error("the canvas item is missing");
        return el;
      },
      previewLine: () => view.querySelector<SVGLineElement>('[data-slot="docblocks/canvas-connector-preview"] line'),
    };
    return {
      ...base,
      connectorId,
      setSelection,
      handle: (which) => view.querySelector<SVGCircleElement>(`[data-connector-endpoint="${which}"] circle`),
    };
  }

  function SelectionProbe({ onReady }: { onReady: (set: (kind: "blocks" | "none", ids?: string[]) => void) => void }) {
    const { selection } = useEditorContext();
    onReady((kind, ids = []) => {
      // The view is null before the mount effect ran (the act flush stands
      // it; the re-render retries on the next probe render are a no-op
      // once it stands). The blocks kind's anchorId is one of the ids.
      const head = ids[0];
      if (head === undefined) return;
      selection.view?.set(kind === "none" ? { kind: "none" } : { kind, ids, anchorId: head });
    });
    return null;
  }

  it("the handles stand for the selected connector and the drag commits the free point", () => {
    const r = renderWithConnector();
    // No selection: no handles.
    expect(r.handle("start")).toBeNull();
    act(() => {
      r.setSelection("blocks", [r.connectorId]);
    });
    const startHandle = r.handle("start");
    expect(startHandle).not.toBeNull();
    expect(startHandle!.getAttribute("pointer-events")).toBe("all");

    // The drag: the press on the handle's hit circle, the move (the live
    // preview), the release on the empty canvas (no port in reach — the
    // jsdom points stand as-is against the surface at the origin: the
    // release (400, 200) is far from any of a / b's ports). The free
    // point keeps the FROZEN direction (a's east anchor toward b — the
    // line stands its direction while in the air).
    fireEvent.pointerDown(startHandle!, { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 400, clientY: 200, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 400, clientY: 200, pointerId: 1 });
    const connector = r.doc.getBlock(r.connectorId);
    if (connector === null || connector.type !== "connector") throw new Error("the connector vanished");
    expect(connector.attrs.start).toEqual({ x: 400, y: 200, port: "east" });
    expect(connector.attrs.end).toEqual({ blockId: r.b });
    // The line re-draws from the free point (the start stands at the
    // release; the path's M point is the free point).
    const path = r.view.querySelector<SVGPathElement>(`[data-connector-id="${r.connectorId}"]`)!;
    expect(path.getAttribute("d")!.startsWith("M 400 200")).toBe(true);
    // The FROZEN direction stands the line's shape : the curved variant bows out along the stored east
    // normal (the c1 control point stands EAST of the start) — not along
    // the segment's perpendicular (the directionless free point).
    act(() => {
      r.doc.transact(() => {
        r.doc.updateBlock(r.connectorId, { variant: "curved" });
      });
    });
    const d = path.getAttribute("d")!;
    const controlX = Number(d.split("C ")[1]!.split(" ")[0]);
    expect(controlX).toBeGreaterThan(400);
  });

  it("the drag commits the edge snap (the release on the edge stands the side + the position along it)", () => {
    const r = renderWithConnector();
    act(() => {
      r.setSelection("blocks", [r.connectorId]);
    });
    // The end handle stands at b's west-ish edge (the sticky anchor
    // toward a — b (100, 0, 100x60): the direction (-200, 0) exits the
    // west edge at (50, 0)). The drag to a's south edge (-100, 30 — the
    // edge's midpoint, t = 0.5) — within the snap radius.
    const endHandle = r.handle("end");
    expect(endHandle).not.toBeNull();
    fireEvent.pointerDown(endHandle!, { clientX: 50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -100, clientY: 30, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: -100, clientY: 30, pointerId: 1 });
    const connector = r.doc.getBlock(r.connectorId);
    if (connector === null || connector.type !== "connector") throw new Error("the connector vanished");
    expect(connector.attrs.end).toEqual({ blockId: r.a, port: "south", portT: 0.5 });
  });

  it("the drag's live snap: the line sticks to the port, the green badge and the snapped dot stand (the release commits the snap)", () => {
    const r = renderWithConnector();
    act(() => {
      r.setSelection("blocks", [r.connectorId]);
    });
    // The end handle (the sticky anchor at (50, 0)) drags to (−100, 24) —
    // 6px from a's south port (−100, 30), inside the 12px snap radius.
    const endHandle = r.handle("end");
    expect(endHandle).not.toBeNull();
    fireEvent.pointerDown(endHandle!, { clientX: 50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -100, clientY: 24, buttons: 1, pointerId: 1 });
    // The stick: the line's end stands at the PORT (not the raw cursor
    // point) — the straight path's last point is the port.
    const path = r.view.querySelector<SVGPathElement>(`[data-connector-id="${r.connectorId}"]`)!;
    expect(path.getAttribute("d")!.endsWith("-100 30")).toBe(true);
    // The connect badge stands BESIDE the snapped port (the port point +
    // the outward normal's offset — not the line's midpoint; the owner
    // decision 2026-10-19): a.south port at (-100, 30), the south
    // normal → the badge center at (-100, 46).
    const badge = r.view.querySelector(`[data-connector-snap-badge="${r.connectorId}"]`);
    expect(badge).not.toBeNull();
    const badgeCircle = badge!.querySelector("circle")!;
    expect(badgeCircle.getAttribute("cx")).toBe("-100");
    expect(badgeCircle.getAttribute("cy")).toBe("46");
    // The snapped port dot stands the connect green (the badge's parity).
    const snappedDot = r.view.querySelector("[data-canvas-port-snapped]");
    expect(snappedDot).not.toBeNull();
    expect(snappedDot!.getAttribute("data-canvas-port")).toBe("south");
    // The release commits the same snap (the preview stood the truth):
    // the side + the fractional position along it (the t = 0.5
    // projection of the release point on a's south edge).
    fireEvent.pointerUp(r.view, { clientX: -100, clientY: 24, pointerId: 1 });
    const connector = r.doc.getBlock(r.connectorId);
    if (connector === null || connector.type !== "connector") throw new Error("the connector vanished");
    expect(connector.attrs.end).toEqual({ blockId: r.a, port: "south", portT: 0.5 });
    // The badge drops with the drag.
    expect(r.view.querySelector(`[data-connector-snap-badge="${r.connectorId}"]`)).toBeNull();
  });

  it("the drag re-anchors the endpoint to the SAME block's other side (the continuous contract — the release's projection stands the anchor)", () => {
    const r = renderWithConnector();
    act(() => {
      r.setSelection("blocks", [r.connectorId]);
    });
    // The end's anchor stands b's WEST edge (the sticky anchor toward a).
    // The drag to b's EAST edge (b (100, 0, 100x60): the east edge's
    // midpoint at (150, 0)) re-anchors to the other side in one
    // continuous drag (the edge's side takes the frozen direction over).
    const endHandle = r.handle("end");
    expect(endHandle).not.toBeNull();
    fireEvent.pointerDown(endHandle!, { clientX: 50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 100, clientY: 60, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 150, clientY: 0, buttons: 1, pointerId: 1 });
    // The live snap stands while over the other side (the badge + the
    // stuck line's end at the edge's point).
    const path = r.view.querySelector<SVGPathElement>(`[data-connector-id="${r.connectorId}"]`)!;
    expect(r.view.querySelector(`[data-connector-snap-badge="${r.connectorId}"]`)).not.toBeNull();
    expect(path.getAttribute("d")!.endsWith("150 0")).toBe(true);
    fireEvent.pointerUp(r.view, { clientX: 150, clientY: 0, pointerId: 1 });
    const connector = r.doc.getBlock(r.connectorId);
    if (connector === null || connector.type !== "connector") throw new Error("the connector vanished");
    expect(connector.attrs.end).toEqual({ blockId: r.b, port: "east", portT: 0.5 });
    // The continuous contract: the
    // release over the endpoint's OWN block re-anchors it at the
    // release's projection — the legacy "the own port stands the
    // detach" rule stands no longer. The release at (60, 20) stands 10
    // px from b's south edge (the t = 0.1 projection) — the re-anchor
    // over the free point (the south edge stands before the equidistant
    // west one — the side order breaks the tie).
    const endHandle2 = r.handle("end");
    expect(endHandle2).not.toBeNull();
    fireEvent.pointerDown(endHandle2!, { clientX: 150, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 100, clientY: 100, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 60, clientY: 20, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 60, clientY: 20, pointerId: 1 });
    const connector2 = r.doc.getBlock(r.connectorId);
    if (connector2 === null || connector2.type !== "connector") throw new Error("the connector vanished");
    expect(connector2.attrs.end).toEqual({ blockId: r.b, port: "south", portT: 0.1 });
  });
});

describe("the line follows the moved / resized items mid-drag (the live geometry)", () => {
  it("the move preview stands the line (the anchor follows the item; the release commit stands the same geometry)", () => {
    const r = renderCanvas();
    const surfaceId = Object.keys(r.doc.toJSON().blocks).find((id) => r.doc.getBlock(id)?.type === "surface");
    if (surfaceId === undefined) throw new Error("the surface is missing");
    act(() => {
      r.doc.insertBlock("connector", { start: { blockId: r.a }, end: { blockId: r.b } }, { parent: surfaceId });
    });
    const surfaceBlock = r.doc.getBlock(surfaceId);
    if (surfaceBlock === null || surfaceBlock.type !== "surface") throw new Error("the surface is missing");
    const connectorId = (surfaceBlock.children ?? []).find((id) => r.doc.getBlock(id)?.type === "connector");
    if (connectorId === undefined) throw new Error("the connector is missing");
    const lineD = () => r.view.querySelector<SVGPathElement>(`[data-connector-id="${connectorId}"]`)!.getAttribute("d");
    // The rest: a's east anchor (-50, 0), b's west anchor (50, 0).
    expect(lineD()).toBe("M -50 0 L 50 0");

    // The move session: the press on a, the drag +20px right.
    fireEvent.pointerDown(r.item(r.a), { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -30, clientY: 0, buttons: 1, pointerId: 1 });
    // The live geometry: a's anchor stands at the PREVIEW position (-30, 0)
    // (b's anchor stands — a's center is 20px further away, but the west
    // edge stands in the same point for this axis-aligned pair).
    expect(lineD()).toBe("M -30 0 L 50 0");

    // The release commits the geometry; the line stands the same (the doc
    // and the preview stand from one number).
    fireEvent.pointerUp(r.view, { clientX: -30, clientY: 0, pointerId: 1 });
    const moved = r.doc.getBlock(r.a);
    expect(moved?.geometry?.x).toBe(-80);
    expect(lineD()).toBe("M -30 0 L 50 0");
  });

  it("the resize preview stands the line (the port follows the resized edge)", () => {
    const r = renderCanvas();
    const surfaceId = Object.keys(r.doc.toJSON().blocks).find((id) => r.doc.getBlock(id)?.type === "surface");
    if (surfaceId === undefined) throw new Error("the surface is missing");
    act(() => {
      r.doc.insertBlock(
        "connector",
        { start: { blockId: r.a, port: "east" }, end: { blockId: r.b, port: "west" } },
        { parent: surfaceId }
      );
    });
    const surfaceBlock = r.doc.getBlock(surfaceId);
    if (surfaceBlock === null || surfaceBlock.type !== "surface") throw new Error("the surface is missing");
    const connectorId = (surfaceBlock.children ?? []).find((id) => r.doc.getBlock(id)?.type === "connector");
    if (connectorId === undefined) throw new Error("the connector is missing");
    const lineD = () => r.view.querySelector<SVGPathElement>(`[data-connector-id="${connectorId}"]`)!.getAttribute("d");
    // The rest: a's east port (-50, 0), b's west port (50, 0).
    expect(lineD()).toBe("M -50 0 L 50 0");

    // The resize session: the press on a selects it (the sub-threshold
    // click commits no move); the east handle stands. The drag grows a to
    // the east: the east port moves with the previewed edge.
    fireEvent.pointerDown(r.item(r.a), { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.item(r.a), { clientX: -50, clientY: 0, pointerId: 1 });
    const handle = r.view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-handle"][data-handle="e"]`);
    if (handle === null) throw new Error("the resize handle is missing");
    fireEvent.pointerDown(handle, { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -40, clientY: 0, buttons: 1, pointerId: 1 });
    // The port stands at the previewed east edge (the center -100 + 60 —
    // the w 100 → 120 grew the east edge from -50 to -40).
    expect(lineD()).toBe("M -40 0 L 50 0");
    fireEvent.pointerUp(r.view, { clientX: -40, clientY: 0, pointerId: 1 });
    // The release commits the previewed box (w 100 → 110: the east edge
    // stood at -40, the center at -100).
    const resized = r.doc.getBlock(r.a);
    expect(resized?.geometry?.w).toBe(110);
    expect(lineD()).toBe("M -40 0 L 50 0");
  });
});

describe("the previews' svgs stand 1x1 (the 0x0 rasterization)", () => {
  it("the pen preview's svg stands 1x1 (the in-flight stroke)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="pen"]')!);
    // The pen's session stands on the empty canvas' press (the items
    // cancel the tool).
    fireEvent.pointerDown(r.view, { clientX: -50, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -30, clientY: 90, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -10, clientY: 80, buttons: 1, pointerId: 1 });
    const svg = r.view.querySelector<SVGElement>('[data-slot="docblocks/canvas-pen-preview"]');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("width")).toBe("1");
    expect(svg!.getAttribute("height")).toBe("1");
  });
});
