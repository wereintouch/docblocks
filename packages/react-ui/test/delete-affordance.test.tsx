// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { MotionEditor } from "../src/motion/index";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The rendered block wrappers (the inner editables are not wrappers). */
function wrapperOf(container: HTMLElement, blockId: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]"))
    .filter((el) => el.getAttribute("data-slot") !== "docblocks/block-content")
    .find((el) => el.getAttribute("data-block-id") === blockId);
}

/** The delete button of the row owning the block (its right-edge trash icon).
 *  The text row's button stands inside the block's own wrapper (the Tag is
 *  the row); the motion non-text row's button stands in the row that hosts
 *  the block's renderer. */
function deleteButtonOf(container: HTMLElement, blockId: string): HTMLElement | undefined {
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="docblocks/gutter-delete"]'));
  return (
    buttons.find((button) => {
      const host = button.closest('[data-slot="docblocks/row"]') ?? button.closest<HTMLElement>("[data-block-id]");
      if (host === null) return false;
      const ownId = host instanceof HTMLElement ? host.dataset.blockId : undefined;
      return ownId === blockId || host.querySelector(`[data-block-id="${blockId}"]`) !== null;
    }) ?? undefined
  );
}

describe("the page row's delete affordance (the hover's trash icon)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
  });

  it("deletes the text row on the click (the gesture's one transact, the caret's re-seat)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const a: BlockId = doc.insertBlock("paragraph");
    const b: BlockId = doc.insertBlock("paragraph");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const button = deleteButtonOf(container, a);
    expect(button, "the delete button stands on the text row").toBeDefined();

    fireEvent.click(button as HTMLElement);

    // The block is gone from the data; the survivor stands.
    expect(doc.getBlock(a)).toBeNull();
    expect(doc.getBlock(b)?.type).toBe("paragraph");
    expect(doc.getChildren(doc.meta.id)).toEqual([b]);
  });

  it("is a true deletion over an image (the Delete key's in-place conversion stands for the key only)", () => {
    const doc = createDoc({ id: "doc-2", createdAt: CREATED_AT });
    const image: BlockId = doc.insertBlock("image", { src: "blob-key" });

    const { container } = render(
      <EditorProvider doc={doc}>
        <MotionEditor />
      </EditorProvider>
    );
    const button = deleteButtonOf(container, image);
    expect(button, "the delete button stands on the image row").toBeDefined();

    fireEvent.click(button as HTMLElement);

    // The block is removed (no in-place conversion), and the document root's
    // tail guarantee stands the empty paragraph the user can type into.
    expect(doc.getBlock(image)).toBeNull();
    const children = doc.getChildren(doc.meta.id);
    expect(children).toHaveLength(1);
    expect(doc.getBlock(children[0] as BlockId)?.type).toBe("paragraph");
  });

  it("deletes the whole blocks selection when the row is part of it", () => {
    const doc = createDoc({ id: "doc-3", createdAt: CREATED_AT });
    const a: BlockId = doc.insertBlock("paragraph");
    const b: BlockId = doc.insertBlock("paragraph");
    doc.insertBlock("paragraph");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    // The blocks selection: the first row's gutter, then the second's with
    // Shift (the extension from the anchor).
    const gutterOf = (blockId: string) =>
      wrapperOf(container, blockId)?.querySelector<HTMLElement>('[data-slot="docblocks/gutter"]');
    fireEvent.click(gutterOf(a) as HTMLElement);
    fireEvent.click(gutterOf(b) as HTMLElement, { shiftKey: true });

    const button = deleteButtonOf(container, a);
    expect(button).toBeDefined();
    fireEvent.click(button as HTMLElement);

    expect(doc.getBlock(a)).toBeNull();
    expect(doc.getBlock(b)).toBeNull();
    // The survivor stands alone (its text tail already stands the guarantee
    // — no extra paragraph).
    const children = doc.getChildren(doc.meta.id);
    expect(children).toHaveLength(1);
    expect(children[0]).not.toBe(a);
    expect(children[0]).not.toBe(b);
  });

  it("stands on the non-text row of the motion view (the row-level affordance)", () => {
    const doc = createDoc({ id: "doc-4", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    const divider: BlockId = doc.insertBlock("divider");

    const { container } = render(
      <EditorProvider doc={doc}>
        <MotionEditor />
      </EditorProvider>
    );
    const button = deleteButtonOf(container, divider);
    expect(button, "the delete button stands on the non-text row").toBeDefined();

    fireEvent.click(button as HTMLElement);

    expect(doc.getBlock(divider)).toBeNull();
    expect(doc.getChildren(doc.meta.id).length).toBeGreaterThanOrEqual(1);
  });

  it("stands absent over the read-only stand (the editing surfaces' gate)", () => {
    const doc = createDoc({ id: "doc-5", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");

    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/gutter-delete"]')).toBeNull();
  });
});
