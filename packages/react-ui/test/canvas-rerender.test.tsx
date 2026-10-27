// @vitest-environment jsdom
// The canvas view's re-render contract (the performance ticket's
// C2/C4): a move session's pointermoves re-render only the moved item —
// the sibling items' bodies stand (the memo + the stable previews) and
// the page miniature stands. A doc change re-renders only the changed
// block's view (the items' point reads stand over the blocks-map change).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import type { BlockRendererProps } from "../src/blocks/renderers";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

function setup() {
  const doc = createDoc({ id: "canvas-rerender", createdAt: CREATED_AT });
  const page = doc.insertBlock("paragraph");
  doc.insertText(page, 0, "page text");
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: -50, w: 200, h: 100 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: 100, y: -50, w: 120, h: 120 });
  const c = doc.insertBlock("shape", { variant: "rounded" }, { parent: surface });
  doc.setGeometry(c, { x: 0, y: 100, w: 80, h: 80 });

  const seen: Record<string, number> = {};
  const shapeRenderer = (props: BlockRendererProps) => {
    seen[`shape:${props.id}`] = (seen[`shape:${props.id}`] ?? 0) + 1;
    return <div data-testid={`spy-shape-${props.id}`} />;
  };
  const paragraphRenderer = (props: BlockRendererProps) => {
    seen[`page:${props.id}`] = (seen[`page:${props.id}`] ?? 0) + 1;
    return <div data-testid="spy-paragraph" />;
  };

  const utils = render(
    <EditorProvider doc={doc} blockRenderers={{ shape: shapeRenderer, paragraph: paragraphRenderer }}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = utils.container.querySelector('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  const wrapperA = utils.container.querySelector<HTMLElement>(
    `[data-slot="docblocks/canvas-item"][data-block-id="${a}"]`
  );
  if (wrapperA === null) throw new Error("the canvas item is missing");
  return { doc, page, a, b, c, seen, view, utils, wrapperA };
}

describe("the canvas re-render contract", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it("stands the sibling items and the miniature on the move session's moves", () => {
    const { page, a, b, c, seen, view, wrapperA } = setup();
    const beforeA = seen[`shape:${a}`] ?? 0;
    const beforeB = seen[`shape:${b}`] ?? 0;
    const beforeC = seen[`shape:${c}`] ?? 0;
    const beforePage = seen[`page:${page}`] ?? 0;

    act(() => {
      fireEvent.pointerDown(wrapperA, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(view, { clientX: 130, clientY: 120, buttons: 1 });
      fireEvent.pointerMove(view, { clientX: 160, clientY: 140, buttons: 1 });
    });

    // The moved item's preview stands (a re-render per move).
    expect(seen[`shape:${a}`]).toBeGreaterThan(beforeA);
    // The sibling items stand (the stable previews + the memo).
    expect(seen[`shape:${b}`]).toBe(beforeB);
    expect(seen[`shape:${c}`]).toBe(beforeC);
    // The page miniature stands (no doc change, the stable context).
    expect(seen[`page:${page}`]).toBe(beforePage);

    act(() => {
      fireEvent.pointerUp(view);
    });
    // The release commit stands the moved item only (the geometry write).
    expect(seen[`shape:${b}`]).toBe(beforeB);
    expect(seen[`shape:${c}`]).toBe(beforeC);
    expect(seen[`page:${page}`]).toBe(beforePage);
  });

  it("stands the items over a page text edit (the miniature's row stands only)", () => {
    const { doc, page, a, b, c, seen } = setup();
    const beforePage = seen[`page:${page}`] ?? 0;
    const beforeA = seen[`shape:${a}`] ?? 0;
    const beforeB = seen[`shape:${b}`] ?? 0;
    const beforeC = seen[`shape:${c}`] ?? 0;

    act(() => {
      doc.insertText(page, 9, "x");
    });

    expect(seen[`page:${page}`]).toBe(beforePage + 1);
    expect(seen[`shape:${a}`]).toBe(beforeA);
    expect(seen[`shape:${b}`]).toBe(beforeB);
    expect(seen[`shape:${c}`]).toBe(beforeC);
  });

  it("stands the other items over a shape's own attr change", () => {
    const { doc, page, a, b, c, seen } = setup();
    const beforePage = seen[`page:${page}`] ?? 0;
    const beforeA = seen[`shape:${a}`] ?? 0;
    const beforeB = seen[`shape:${b}`] ?? 0;
    const beforeC = seen[`shape:${c}`] ?? 0;

    act(() => {
      doc.updateBlock(b, { fill: "#ff0000" });
    });

    expect(seen[`shape:${b}`]).toBe(beforeB + 1);
    expect(seen[`shape:${a}`]).toBe(beforeA);
    expect(seen[`shape:${c}`]).toBe(beforeC);
    expect(seen[`page:${page}`]).toBe(beforePage);
  });

  it("stands the unselected items on a click-select (the tint stands the two items only)", () => {
    const { page, a, b, c, seen, utils, wrapperA } = setup();
    const wrapperB = utils.container.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${b}"]`
    );
    if (wrapperB === null) throw new Error("the canvas item is missing");
    const beforeA = seen[`shape:${a}`] ?? 0;
    const beforeB = seen[`shape:${b}`] ?? 0;
    const beforeC = seen[`shape:${c}`] ?? 0;
    const beforePage = seen[`page:${page}`] ?? 0;

    act(() => {
      fireEvent.pointerDown(wrapperA, { clientX: 100, clientY: 100 });
      fireEvent.pointerUp(wrapperA);
    });

    // The selected item stands its tint (a re-render); the rest stand.
    expect(seen[`shape:${a}`]).toBe(beforeA + 1);
    expect(seen[`shape:${b}`]).toBe(beforeB);
    expect(seen[`shape:${c}`]).toBe(beforeC);
    expect(seen[`page:${page}`]).toBe(beforePage);

    act(() => {
      fireEvent.pointerDown(wrapperB, { clientX: 50, clientY: 50 });
      fireEvent.pointerUp(wrapperB);
    });

    // The new selection stands; the old one drops its tint; the rest stand.
    expect(seen[`shape:${b}`]).toBe(beforeB + 1);
    expect(seen[`shape:${a}`]).toBe(beforeA + 2);
    expect(seen[`shape:${c}`]).toBe(beforeC);
    expect(seen[`page:${page}`]).toBe(beforePage);
  });
});
