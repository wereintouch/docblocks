// The page-frame tests' shared stand: the row's width's
// ResizeObserver's mock (the house's measurement's stand, driven by the
// test), the scene's seed (the surface + the two shapes + the canvas's
// frame + the page-frame), the render fixture, and the window's box's
// read + the per-test's cleanup.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, expect } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-06T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

// The row's width's mock stand: the observer's callback fires with the
// row's content width (the house's measurement stand, driven by the test).
type ROCallback = (entries: { contentRect: { width: number } }[]) => void;
const roInstances: { callback: ROCallback }[] = [];
class MockResizeObserver {
  callback: ROCallback;
  constructor(callback: ROCallback) {
    this.callback = callback;
    roInstances.push(this);
  }
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
});

/** Fire the latest window's row observer with `width` (the row's remeasure). */
function standRowWidth(width: number): void {
  const instance = roInstances[roInstances.length - 1];
  expect(instance, "the window should observe its row's width").toBeDefined();
  act(() => {
    instance!.callback([{ contentRect: { width } }]);
  });
}

interface Scene {
  doc: TestDoc;
  surface: string;
  a: string;
  b: string;
  frame: string;
  pageFrame: string;
}

/** The page-frame's scene: the surface + two shapes (one in the window's
 *  region, one far outside) + the canvas frame (the page-frame's target). */
function seedScene(doc: TestDoc): Omit<Scene, "doc"> {
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: 10, y: 20, w: 50, h: 50 });
  const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(b, { x: 1000, y: 1000, w: 50, h: 50 });
  const frame = doc.insertBlock("frame", { title: "The frame" }, { parent: surface });
  doc.setGeometry(frame, { x: 100, y: 50, w: 300, h: 200 });
  const pageFrame = doc.insertBlock("frame", { frameId: frame });
  return { surface, a, b, frame, pageFrame };
}

/** Render the doc's page view; the scene's ids stand the queries. */
function renderScene(): Scene {
  const doc = createDoc({ id: "frame-page-doc", createdAt: CREATED_AT });
  const ids = seedScene(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return { doc, ...ids };
}

/** The page-frame's window's box (the query's helper — the missing's error). */
function windowOf(pageFrame: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-slot="docblocks/frame-page"][data-block-id="${pageFrame}"]:not([data-slot="docblocks/row"])`
  );
  expect(row, "the page-frame's row should stand").not.toBeNull();
  const box = row!.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-window"]');
  expect(box, "the window's box should stand").not.toBeNull();
  return box!;
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  roInstances.length = 0;
});

export { CREATED_AT, renderScene, standRowWidth, windowOf };
