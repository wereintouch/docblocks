// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { MotionEditor } from "../src/motion/index";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The rendered block wrappers (the inner editables are not wrappers). */
function wrappersOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]")).filter(
    (el) => el.getAttribute("data-slot") !== "docblocks/block-content"
  );
}

describe("MotionEditor", () => {
  afterEach(cleanup);

  it("renders the same block content as the base Editor", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    doc.insertText(doc.insertBlock("paragraph"), 0, "first");
    doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(doc.insertBlock("paragraph"), 0, "second");

    const base = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const motion = render(
      <EditorProvider doc={doc}>
        <MotionEditor />
      </EditorProvider>
    );

    expect(motion.container.querySelector('[data-slot="docblocks/editor"]')).not.toBeNull();

    // Parity: the same ids in the same order, the same wrapper text.
    const baseWrappers = wrappersOf(base.container);
    const motionWrappers = wrappersOf(motion.container);
    expect(baseWrappers).toHaveLength(3);
    expect(motionWrappers.map((el) => el.getAttribute("data-block-id"))).toEqual(
      baseWrappers.map((el) => el.getAttribute("data-block-id"))
    );
    expect(motionWrappers.map((el) => el.textContent)).toEqual(baseWrappers.map((el) => el.textContent));

    // The list group keeps its structure and data attributes.
    const list = motion.container.querySelector('[data-slot="docblocks/list"]');
    expect(list).not.toBeNull();
    expect(list?.tagName).toBe("UL");
    expect(list?.getAttribute("data-list")).toBe("bullet");
    expect(list?.querySelector('[data-slot="docblocks/list-item"]')).not.toBeNull();
  });

  it("adds a block after mount and the enter animation settles", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    doc.insertText(doc.insertBlock("paragraph"), 0, "first");

    const { container } = render(
      <EditorProvider doc={doc}>
        <MotionEditor />
      </EditorProvider>
    );
    expect(wrappersOf(container)).toHaveLength(1);

    act(() => {
      doc.insertBlock("paragraph");
    });

    // The new entry mounts immediately and its enter animation settles
    // (framer leaves the final state in the inline style).
    await waitFor(
      () => {
        const wrappers = wrappersOf(container);
        expect(wrappers).toHaveLength(2);
        expect(wrappers[1]?.parentElement?.style.opacity).toBe("1");
      },
      { timeout: 5000 }
    );
  });

  it("removes a block from the list once its exit animation completes", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const keep = doc.insertBlock("paragraph");
    doc.insertText(keep, 0, "keep");
    const drop = doc.insertBlock("paragraph");
    doc.insertText(drop, 0, "drop");

    const { container } = render(
      <EditorProvider doc={doc}>
        <MotionEditor />
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
});
