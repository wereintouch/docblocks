// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { restoreSelectionIn } from "../src/editing/block-commands";
import { caretOffsetIn } from "../src/editing/dom-offset";

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

/** The block's inner editable. */
function innerOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`);
  expect(el, "the block should carry the inner editable").not.toBeNull();
  return el!;
}

/** The block's text node (the test docs carry one unmarked run). */
function textNodeOf(id: BlockId): Text {
  const node = innerOf(id).firstChild;
  expect(node, "the block should carry a text node").not.toBeNull();
  return node as Text;
}

/** The frame the helper schedules its seat on. */
const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

/** Whether the DOM selection spans [from, to) (a caret when `to` is null) of the block's inner. */
function isSeated(id: BlockId, from: number, to: number | null): boolean {
  const inner = innerOf(id);
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount !== 1) return false;
  const ok = (node: Node | null): boolean => node !== null && (node === inner || inner.contains(node));
  if (!ok(sel.anchorNode) || !ok(sel.focusNode)) return false;
  const start = caretOffsetIn(inner, sel.anchorNode!, sel.anchorOffset);
  const end = caretOffsetIn(inner, sel.focusNode!, sel.focusOffset);
  if (to === null) return start === from && end === from;
  return Math.min(start, end) === from && Math.max(start, end) === to;
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

/**
 * `restoreSelectionIn` is the structural-gesture re-seat (a Tab/Shift+Tab
 * move, a list-type swap): it lands a range or a caret in a block's rebuilt
 * inner. Pinned on a stable block — the gesture->remount->re-seat chain is
 * e2e (a real browser, where the remount timing is real).
 */
describe("restoreSelectionIn (the structural re-seat helper)", () => {
  it("seats a caret at the flat offset", async () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello world");
    });

    window.getSelection()!.removeAllRanges();
    restoreSelectionIn(doc, p, 4, null);
    await flushFrames();
    expect(isSeated(p, 4, null)).toBe(true);
  });

  it("seats a range over [from, to)", async () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello world");
    });

    restoreSelectionIn(doc, p, 2, 8);
    await flushFrames();
    expect(isSeated(p, 2, 8)).toBe(true);
  });

  it("seats at the text end (offset = length)", async () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "abc");
    });

    restoreSelectionIn(doc, p, 3, null);
    await flushFrames();
    expect(isSeated(p, 3, null)).toBe(true);
  });
});

/** Select [from, to) in the block and sync the view selection. */
function selectRange(id: BlockId, from: number, to: number): void {
  const range = document.createRange();
  range.setStart(textNodeOf(id), from);
  range.setEnd(textNodeOf(id), to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  // The view update re-renders the toolbar: flush it inside act.
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** The floating toolbar (present while an eligible range is selected). */
function toolbarOf(): HTMLElement {
  const el = document.querySelector('[data-slot="docblocks/format-toolbar"]');
  expect(el, "the toolbar should be visible for the selected range").not.toBeNull();
  return el as HTMLElement;
}

/** Click an element (the house pattern: a dispatched click inside act). */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Click a list-type menu option through the menu (open, then the option). */
function pickListOption(option: string): void {
  click(toolbarOf().querySelector('button[aria-label="List type"]')!);
  const menu = document.querySelector('[data-slot="docblocks/format-list-menu"]');
  expect(menu, "the list-type menu should be open").not.toBeNull();
  click((menu as HTMLElement).querySelector(`[data-list-option="${option}"]`)!);
}

describe("the list-type menu keeps the selection seated", () => {
  it("a list-kind swap (bullet -> task, same wrapper tag) keeps the selection seated", async () => {
    let li: BlockId = "";
    const doc = renderDoc((d) => {
      li = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(li, 0, "standalone item");
    });

    selectRange(li, 2, 15);
    pickListOption("task");

    const block = doc.getBlock(li);
    expect(block).toMatchObject({ type: "list-item" });
    if (block?.type === "list-item") expect(block.attrs.list).toBe("task");
    // Same wrapper tag (ul): the inner is not remounted, so the selection
    // stands. Pinned to guard against a regression that would drop it.
    await expect.poll(() => isSeated(li, 2, 15), { timeout: 2000 }).toBe(true);
  });
});

/**
 * The type-change re-seat (paragraph -> list item, list item -> paragraph)
 * remounts the block's subtree and re-seats the gesture's range. That chain
 * is pinned e2e (a real browser, where the remount timing is real): jsdom's
 * remount/selection timing is racy and not representative.
 */
