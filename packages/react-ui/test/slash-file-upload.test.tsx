// @vitest-environment jsdom
// The slash File command's upload state: the in-flight upload stands the
// item's spinner over the open menu (the menu stands not pickable — the
// commit lands on the file's pick), and a refused upload commits nothing
// (the menu stays open on the phrase, the failed stand's error line names
// the failure).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobStore } from "../src/blob-store";
import { createMemoryBlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-13T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Scene {
  doc: TestDoc;
  para: BlockId;
}

function renderScene(store: BlobStore): Scene {
  const doc = createDoc({ id: "slash-file-doc", createdAt: CREATED_AT });
  const para = doc.insertBlock("paragraph");
  render(
    <EditorProvider doc={doc} blobStore={store}>
      <Editor />
    </EditorProvider>
  );
  return { doc, para };
}

/** Seat a collapsed caret at the paragraph's start and press "/". */
function pressSlash(para: BlockId): void {
  const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${para}"]`);
  expect(wrapper, "the trigger should be rendered").not.toBeNull();
  const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the trigger should carry the inner editable").not.toBeNull();
  const range = document.createRange();
  range.setStart(inner!, 0);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    wrapper!.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
  });
  expect(document.querySelector('[data-slot="docblocks/slash-menu"]'), "the menu should stand open").not.toBeNull();
}

/** The menu's command item by its visible label. */
function menuItem(label: string): HTMLElement {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/slash-item"]'));
  const item = items.find((el) => el.textContent?.trim() === label);
  expect(item, `the ${label}'s command should stand in the menu's list`).toBeDefined();
  return item!;
}

/** The hidden file input's change with a picked file (the jsdom's stand for
 *  the native picker's commit). */
function deliverFile(file: File): void {
  const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/slash-file-input"]');
  expect(input, "the hidden file input should stand").not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
}

function typesOf(doc: TestDoc): string[] {
  return Object.values(doc.toJSON().blocks).map((block) => String(block.type));
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the upload's stands", () => {
  it("the in-flight upload stands the item's spinner, and the menu's not-pickable stand over it", async () => {
    let resolveUpload: ((id: string) => void) | null = null;
    const store: BlobStore = {
      ...createMemoryBlobStore(),
      upload: () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    };
    const { doc, para } = renderScene(store);
    pressSlash(para);
    const before = doc.toJSON();

    fireEvent.click(menuItem("File"));
    deliverFile(new File(["png"], "pic.png", { type: "image/png" }));
    await act(async () => {});

    // The spinner stands over the File's item (the upload's in flight).
    expect(menuItem("File").querySelector(".animate-spin")).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/slash-file-error"]')).toBeNull();

    // The menu stands not pickable: the competing command commits nothing.
    fireEvent.click(menuItem("Text"));
    expect(doc.toJSON()).toEqual(before);

    // The file's landing commits the image over the anchor's slot and closes
    // the menu (the phrase stands stripped).
    await act(async () => {
      resolveUpload!("file-1");
    });
    await act(async () => {});
    expect(typesOf(doc)).toContain("image");
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/slash-file-error"]')).toBeNull();
  });

  it("a refused upload stands the error line, commits nothing, and keeps the menu open on the phrase", async () => {
    const store: BlobStore = {
      ...createMemoryBlobStore(),
      upload: async () => {
        throw new Error("storage unavailable");
      },
    };
    const { doc, para } = renderScene(store);
    pressSlash(para);
    const before = doc.toJSON();

    fireEvent.click(menuItem("File"));
    deliverFile(new File(["png"], "pic.png", { type: "image/png" }));
    await act(async () => {});

    const error = document.querySelector<HTMLElement>('[data-slot="docblocks/slash-file-error"]');
    expect(error, "the failed stand's error line should stand").not.toBeNull();
    expect(error!.getAttribute("role")).toBe("alert");
    expect(error!.textContent).toBe("Upload failed");
    expect(menuItem("File").querySelector(".animate-spin")).toBeNull();

    // The doc stands untouched (no image, the phrase intact), and the menu
    // stays open on the phrase.
    expect(doc.toJSON()).toEqual(before);
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).not.toBeNull();
  });
});
