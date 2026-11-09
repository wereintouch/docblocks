// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The rendered block wrappers (the inner editables are not wrappers). */
function wrappersOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]")).filter(
    (el) => el.getAttribute("data-slot") !== "docblocks/block-content"
  );
}

describe("the Editor's motion page view", () => {
  afterEach(cleanup);

  it("renders the flat page rows (the Reorder's rows + the rendered list marker)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    doc.insertText(doc.insertBlock("paragraph"), 0, "first");
    doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(doc.insertBlock("paragraph"), 0, "second");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    expect(container.querySelector('[data-slot="docblocks/editor"]')).not.toBeNull();

    const wrappers = wrappersOf(container);
    expect(wrappers).toHaveLength(3);

    // The flat rows: every block is its own row (no list element — the
    // list item's marker stands as a rendered row marker per row).
    const rows = container.querySelectorAll('[data-slot="docblocks/row"]');
    expect(rows.length).toBe(3);
    const marker = container.querySelector('[data-slot="docblocks/row-marker"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-kind")).toBe("bullet");
    expect(marker?.getAttribute("data-cycle")).toBe("1");
  });

  it("a row mounted before the first input stands up instantly (the gate is closed); after an input the enter animation runs", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    doc.insertText(doc.insertBlock("paragraph"), 0, "first");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    expect(wrappersOf(container)).toHaveLength(1);

    // The row's entry element: the block wrapper's nearest ancestor that
    // is a direct child of the rows group (the lift's content div sits in
    // between; the rows group stands inside the page's content column —
    // the centered max-width's stand).
    const entryOf = (index: number) => {
      const wrappers = wrappersOf(container);
      const group = container.querySelector("[data-slot='docblocks/rows']");
      let entry: HTMLElement | null = wrappers[index]?.parentElement ?? null;
      while (entry !== null && entry.parentElement !== group) entry = entry.parentElement;
      return entry;
    };

    // Gate closed (no input yet): the row mounts its animate values at
    // once (initial={false}) — no height-growth animation, no opacity
    // dip: the inline opacity is 1 from the mount tick on.
    act(() => {
      doc.insertBlock("paragraph");
    });
    expect(wrappersOf(container)).toHaveLength(2);
    expect(entryOf(1)?.style.opacity).toBe("1");

    // Gate opens on the first text input in the editor (a printable
    // keydown in the editor's contenteditable) — a row inserted after it
    // runs the enter animation (the opacity stands below 1 in flight and
    // settles at 1).
    const inner = container.querySelector('[data-slot="docblocks/block-content"]')!;
    act(() => {
      inner.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    });
    act(() => {
      doc.insertBlock("paragraph");
    });
    expect(wrappersOf(container)).toHaveLength(3);
    expect(parseFloat(entryOf(2)?.style.opacity ?? "1")).toBeLessThan(1);
    await waitFor(() => expect(entryOf(2)?.style.opacity).toBe("1"), { timeout: 5000 });
  });

  it("removes a block from the list once its exit animation completes", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const keep = doc.insertBlock("paragraph");
    doc.insertText(keep, 0, "keep");
    const drop = doc.insertBlock("paragraph");
    doc.insertText(drop, 0, "drop");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    expect(wrappersOf(container)).toHaveLength(2);

    act(() => {
      doc.removeBlock(drop);
    });

    // During the exit the element is still in the DOM; it is removed
    // once the exit animation completes.
    await waitFor(() => expect(wrappersOf(container)).toHaveLength(1), { timeout: 5000 });
    expect(screen.queryByText("drop")).toBeNull();
    expect(screen.getByText("keep")).toBeDefined();
  });

  it("stands the typing flag on a text keypress and drops it on a pointer move", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    doc.insertText(doc.insertBlock("paragraph"), 0, "text");
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const root = container.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
    const inner = container.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(root).not.toBeNull();
    expect(inner).not.toBeNull();
    expect(root!.hasAttribute("data-docblocks-typing")).toBe(false);

    // A text keypress in this editor's own content stands the flag.
    inner!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(root!.hasAttribute("data-docblocks-typing")).toBe(true);

    // A control key (the gesture) does not stand it.
    root!.removeAttribute("data-docblocks-typing");
    inner!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(root!.hasAttribute("data-docblocks-typing")).toBe(false);

    // The first pointer move ends the typing session.
    inner!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(root!.hasAttribute("data-docblocks-typing")).toBe(true);
    window.dispatchEvent(new Event("pointermove"));
    expect(root!.hasAttribute("data-docblocks-typing")).toBe(false);

    // The focus leaving the editor ends it as well.
    inner!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(root!.hasAttribute("data-docblocks-typing")).toBe(true);
    act(() => {
      inner!.focus();
      inner!.blur();
    });
    expect(root!.hasAttribute("data-docblocks-typing")).toBe(false);
  });
});
