// @vitest-environment jsdom
// The focusability's contract (the anti-pattern's pin — the interactive's
// stand over the non-focusable's element): every rendered element with an
// interactive's stand (the role's button, the aria-pressed's) stands
// focusable (the native's focusable's tag, the tabIndex >= 0, or the
// contenteditable's true). The doc's stand: the text's blocks + the code
// header's controls + the table's handles (the page's view) and the
// canvas's items (the canvas's view).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { DocHeader } from "../src/DocHeader";
import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

const FOCUSABLE_TAGS = new Set(["button", "input", "select", "textarea", "a"]);

/** The element's focusable stand (the native's focusable's tag, the
 * tabIndex >= 0, or the contenteditable's true). */
function isFocusable(el: Element): boolean {
  if (FOCUSABLE_TAGS.has(el.tagName.toLowerCase())) return true;
  if (el.getAttribute("contenteditable") === "true") return true;
  const tabIndex = el.getAttribute("tabindex");
  if (tabIndex === null) return false;
  const value = Number(tabIndex);
  return Number.isNaN(value) === false && value >= 0;
}

interface Rendered {
  pageRoot: HTMLElement;
  canvasRoot: HTMLElement;
}

function renderBothViews(): Rendered {
  const doc = createDoc({ id: "kbd-focus-doc", createdAt: CREATED_AT });
  doc.setTitle("Focus doc");
  const page = doc.insertBlock("paragraph");
  doc.insertText(page, 0, "a text block");
  const code = doc.insertBlock("code", { language: "ts" });
  doc.insertText(code, 0, "const a = 1;");
  const table = doc.insertBlock("table", { cols: 2 });
  for (let r = 0; r < 2; r++) doc.insertBlock("table-row", undefined, { parent: table });

  const doc2 = createDoc({ id: "kbd-focus-canvas-doc", createdAt: CREATED_AT });
  const surface = doc2.insertBlock("surface");
  const shape = doc2.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc2.setGeometry(shape, { x: 0, y: 0, w: 120, h: 80 });

  const pageResult = render(
    <div>
      <EditorProvider doc={doc}>
        <DocHeader doc={doc} view="page" onViewChange={() => undefined} />
        <Editor view="page" />
      </EditorProvider>
    </div>
  );
  const canvasResult = render(
    <EditorProvider doc={doc2}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  return { pageRoot: pageResult.container, canvasRoot: canvasResult.container };
}

afterEach(() => {
  cleanup();
});

describe("the focusability's contract (the interactive's stand over the non-focusable's)", () => {
  it("every interactive's stand stands focusable (the role's button, the aria-pressed's)", () => {
    const { pageRoot, canvasRoot } = renderBothViews();
    for (const root of [pageRoot, canvasRoot]) {
      const interactive = root.querySelectorAll<HTMLElement>('[role="button"], [aria-pressed]');
      expect(
        interactive.length,
        "the interactive's stands stand (the header's controls, the handles, the dock's buttons)"
      ).toBeGreaterThan(0);
      for (const el of Array.from(interactive)) {
        expect(
          isFocusable(el),
          `the interactive's "${el.getAttribute("aria-label") ?? el.dataset.slot ?? el.tagName.toLowerCase()}" should stand focusable`
        ).toBe(true);
      }
    }
  });

  it("the table's handles stand the button's tag (the tab's path's stand)", () => {
    const { pageRoot } = renderBothViews();
    const row = pageRoot.querySelector<HTMLElement>('[data-slot="docblocks/table-row-handle"]');
    const col = pageRoot.querySelector<HTMLElement>('[data-slot="docblocks/table-col-handle"]');
    expect(row?.tagName).toBe("BUTTON");
    expect(col?.tagName).toBe("BUTTON");
  });

  it("the canvas's container stands a tab stop (the items' kb focus's stand)", () => {
    const { canvasRoot } = renderBothViews();
    const view = canvasRoot.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
    expect(view?.tabIndex).toBe(0);
    expect(view?.getAttribute("role")).toBe("application");
    const items = canvasRoot.querySelectorAll<HTMLElement>('[data-slot="docblocks/canvas-item"]');
    expect(items.length).toBeGreaterThan(0);
    for (const item of Array.from(items)) {
      expect(item.getAttribute("role")).toBe("img");
      expect(item.getAttribute("aria-label"), "the item's label's stand").not.toBeNull();
    }
  });
});
