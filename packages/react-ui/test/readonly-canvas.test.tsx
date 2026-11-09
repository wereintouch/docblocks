// @vitest-environment jsdom
// The canvas's read-only stand (the view / published's modes): the dock's
// placement's tools stand off, the pointer's sessions (the selection / the
// move / the marquee) stand off, the ghost's text's entry stands off, the
// hotkeys stand off — the view's gestures keep (the zoom's controls'
// fit / step / reset stand).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** A doc with a surface + a shape (the canvas's content) + a page paragraph. */
function makeDoc(id: string) {
  const doc = createDoc({ id, createdAt: CREATED_AT });
  doc.insertText(doc.insertBlock("paragraph"), 0, "page");
  const surface = doc.insertBlock("surface");
  doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  return doc;
}

describe("the canvas's read-only stand (the view / published's modes)", () => {
  afterEach(cleanup);

  it("stands the dock off and the zoom's controls over (the view's mode)", () => {
    const doc = makeDoc("doc-rc-1");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor view="canvas" />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/canvas-dock"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/zoom-controls"]')).not.toBeNull();
  });

  it("stands the dock over the edit's mode (the default's parity)", () => {
    const doc = makeDoc("doc-rc-2");
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/canvas-dock"]')).not.toBeNull();
  });

  it("the press over the empty canvas stands no selection (the view's mode)", () => {
    const doc = makeDoc("doc-rc-3");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor view="canvas" />
      </EditorProvider>
    );
    const canvas = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
    expect(canvas, "the canvas should render").not.toBeNull();
    fireEvent.pointerDown(canvas as HTMLElement, { button: 0, bubbles: true });
    fireEvent.pointerUp(canvas as HTMLElement, { button: 0, bubbles: true });
    // The press stands no marquee and no selection (the session's path is
    // off over the read-only's stand).
    expect(container.querySelector('[data-slot="docblocks/canvas-marquee"]')).toBeNull();
  });

  it("the double press over the empty canvas stands no ghost (the view's mode)", () => {
    const doc = makeDoc("doc-rc-4");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor view="canvas" />
      </EditorProvider>
    );
    const canvas = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
    expect(canvas).not.toBeNull();
    fireEvent.doubleClick(canvas as HTMLElement, { button: 0, bubbles: true });
    expect(container.querySelector('[data-slot="docblocks/canvas-text-ghost"]')).toBeNull();
  });

  it("the M's hotkey stands no mode switch (the view's mode)", () => {
    const doc = makeDoc("doc-rc-5");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor view="canvas" />
      </EditorProvider>
    );
    const canvas = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
    expect(canvas, "the canvas should render").not.toBeNull();
    fireEvent.keyDown(canvas as HTMLElement, { key: "m", bubbles: true });
    // The mode's stand is the select's (the dock is off — the switch's
    // target stands no stand); the key stands swallowed.
    expect((canvas as HTMLElement).querySelector('[data-slot="docblocks/canvas-dock"]')).toBeNull();
  });
});
