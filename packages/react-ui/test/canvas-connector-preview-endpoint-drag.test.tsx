// @vitest-environment jsdom
// The endpoint handles' drag (the selected line's endpoints): the handles
// stand for the selected connector only; the drag commits the free point /
// the edge's snap, the live snap's stand (the line's stick, the badge, the
// snapped dot), and the re-anchor to the same block's other side.
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import { CREATED_AT } from "./canvas-connector-preview.helpers";
import type { Rendered } from "./canvas-connector-preview.helpers";

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
    // the outward normal's offset — not the line's midpoint):
    // a.south port at (-100, 30), the south
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
