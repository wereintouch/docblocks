// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

function renderDoc(prepare: (doc: TestDoc) => void): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** The wrapper element of the block. */
function wrapperOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  expect(el, `the block ${id} should be rendered`).not.toBeNull();
  return el!;
}

/** The inner editable of the block's wrapper. */
function innerOf(id: BlockId): HTMLElement {
  const inner = wrapperOf(id).querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner!;
}

/**
 * Dispatch a keydown on the wrapper; false when the handler suppressed the
 * event (dispatchEvent returns false after preventDefault).
 */
function key(wrapper: HTMLElement, name: string, init: KeyboardEventInit = {}): boolean {
  let result = true;
  act(() => {
    result = wrapper.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })
    );
  });
  return result;
}

/**
 * Place the DOM caret at the flat character offset in the block's inner
 * editable (walking the text nodes across the run inlines).
 */
function caretAtFlat(id: BlockId, offset: number): void {
  const inner = innerOf(id);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let pos = 0;
  for (const child of Array.from(inner.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const length = child.nodeValue?.length ?? 0;
      nodes.push({ node: child as Text, start: pos, end: pos + length });
      pos += length;
    }
  }
  const at = nodes.find((n) => offset >= n.start && offset <= n.end);
  expect(at, `a text node should cover offset ${offset}`).toBeDefined();
  const range = document.createRange();
  range.setStart(at!.node, offset - at!.start);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("nested content of a text container (render)", () => {
  it("a paragraph with a nested paragraph and a nested list renders them in the nested slot", () => {
    let p: BlockId = "";
    let child: BlockId = "";
    let li: BlockId = "";
    renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "container");
      child = d.insertBlock("paragraph", undefined, { parent: p });
      d.insertText(child, 0, "nested paragraph");
      li = d.insertBlock("list-item", { list: "bullet" }, { parent: p });
      d.insertText(li, 0, "nested list");
    });

    const wrapper = wrapperOf(p);
    const nested = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/nested"]');
    expect(nested, "the nested slot should render inside the parent wrapper").not.toBeNull();
    // The children render inside the slot, after the inner editable.
    expect(nested!.contains(wrapperOf(child))).toBe(true);
    expect(nested!.contains(wrapperOf(li))).toBe(true);
    // The nested list starts a fresh depth-1 list context (no list-marker
    // depth of its own: the container is not a list).
    const list = nested!.querySelector<HTMLElement>('ul[data-slot="docblocks/list"]');
    expect(list).not.toBeNull();
    expect(list!.getAttribute("data-depth")).toBe("1");
    expect(wrapperOf(child).querySelector('[data-slot="docblocks/block-content"]')!.textContent).toBe(
      "nested paragraph"
    );
  });

  it("a code block with children renders them too", () => {
    let code: BlockId = "";
    let child: BlockId = "";
    renderDoc((d) => {
      code = d.insertBlock("code", { language: "ts" });
      d.insertText(code, 0, "const a = 1;");
      child = d.insertBlock("paragraph", undefined, { parent: code });
      d.insertText(child, 0, "nested under code");
    });

    const wrapper = wrapperOf(code);
    const nested = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/nested"]');
    expect(nested).not.toBeNull();
    expect(nested!.contains(wrapperOf(child))).toBe(true);
  });

  it("a paragraph without children renders no nested slot", () => {
    const doc = renderDoc((d) => {
      const p = d.insertBlock("paragraph");
      d.insertText(p, 0, "standalone");
    });
    const root = doc.meta.id;
    const [p] = doc.getChildren(root);
    expect(p).toBeDefined();
    expect(wrapperOf(p!).querySelector('[data-slot="docblocks/nested"]')).toBeNull();
  });
});

describe("Tab: nesting of any text block (the gesture generalization)", () => {
  it("nests the second paragraph under the first; Shift+Tab brings it back after the parent", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    caretAtFlat(p2, 0);
    const prevented = key(wrapperOf(p2), "Tab");
    expect(prevented).toBe(false); // suppressed: the structural move ran

    const json = doc.toJSON();
    const p1Json = json.blocks[p1]!;
    expect("children" in p1Json ? p1Json.children : null).toEqual([p2]);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1]);
    // The nested content renders inside the parent's nested slot.
    expect(wrapperOf(p1).querySelector('[data-slot="docblocks/nested"]')).not.toBeNull();

    // Shift+Tab: right after the parent, back at the top level.
    caretAtFlat(p2, 0);
    expect(key(wrapperOf(p2), "Tab", { shiftKey: true })).toBe(false);

    const flat = doc.toJSON();
    expect("children" in flat.blocks[p1]!).toBe(false); // omitted when empty
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2]);
  });

  it("does nothing when the previous sibling is a non-container (divider)", () => {
    let divider: BlockId = "";
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      divider = d.insertBlock("divider");
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "x");
    });

    caretAtFlat(p, 0);
    const prevented = key(wrapperOf(p), "Tab");

    expect(prevented).toBe(true); // not suppressed: the browser default stands
    expect(doc.getChildren(doc.meta.id)).toEqual([divider, p]);
    expect(wrapperOf(p).querySelector('[data-slot="docblocks/nested"]')).toBeNull();
  });

  it("Shift+Tab at the top level is a no-op", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "x");
    });

    caretAtFlat(p, 0);
    const prevented = key(wrapperOf(p), "Tab", { shiftKey: true });

    expect(prevented).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p]);
  });

  it("a code block keeps the typewriter Tab: a tab character in the text, no move", () => {
    let code: BlockId = "";
    const doc = renderDoc((d) => {
      code = d.insertBlock("code", { language: "ts" });
      d.insertText(code, 0, "abc");
    });

    caretAtFlat(code, 3);
    const prevented = key(wrapperOf(code), "Tab");

    expect(prevented).toBe(false); // the tab character was inserted
    expect(doc.getText(code)).toBe("abc\t");
    // No structural change: the code block stays top-level, no nested slot.
    expect(doc.getChildren(doc.meta.id)).toEqual([code]);
    expect(wrapperOf(code).querySelector('[data-slot="docblocks/nested"]')).toBeNull();
    // The caret lands after the inserted tab (offset 4 of "abc\t").
    const selection = window.getSelection()!;
    expect(selection.rangeCount).toBe(1);
    expect(selection.anchorOffset).toBe(4);
  });

  it("does not merge a text container with children on a Backspace at the start", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph", undefined, { parent: p1 });
      d.insertText(p2, 0, "two");
    });

    // A Backspace at the container's own offset 0 would merge it into the
    // previous sibling — the guard rejects it: a container with children
    // is a structural merge, not a v1 gesture.
    caretAtFlat(p1, 0);
    const prevented = key(wrapperOf(p1), "Backspace");

    expect(prevented).toBe(true); // no-op: the browser default stands
    const json = doc.toJSON();
    const p1Json = json.blocks[p1]!;
    expect("children" in p1Json ? p1Json.children : null).toEqual([p2]);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1]);
    expect(doc.getText(p1)).toBe("one");
    expect(doc.getText(p2)).toBe("two");
  });
});
