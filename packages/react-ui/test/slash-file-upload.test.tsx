// @vitest-environment jsdom
// The slash File command's upload stand: the File's pick closes the
// popover and the phrase block's row stands the skeleton (the spinner's
// rotation over the picker's open and the in-flight upload); a refused
// upload commits nothing (the failed stand's error line stands over the
// skeleton — the stand's click dismisses it); a cancelled picker stands
// no event of its own (the dialog's close's page-focus clears the stand).
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

/** The phrase block's upload skeleton stand. */
function skeleton(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="docblocks/file-upload-skeleton"]');
}

function typesOf(doc: TestDoc): string[] {
  return Object.values(doc.toJSON().blocks).map((block) => String(block.type));
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the upload's stands", () => {
  it("the File's pick closes the popover, the phrase's row stands the skeleton, and the commit lands on the file's pick", async () => {
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
    await act(async () => {});

    // The popover stands closed; the phrase block's row stands the
    // skeleton (the spinner's rotation) over its content.
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).toBeNull();
    const stand = skeleton();
    expect(stand, "the skeleton's stand should stand over the phrase block").not.toBeNull();
    expect(stand!.getAttribute("data-block-id")).toBe(para);
    expect(stand!.getAttribute("data-state")).toBe("picker");
    expect(stand!.querySelector(".animate-spin")).not.toBeNull();
    // The doc stands untouched while the stand stands.
    expect(doc.toJSON()).toEqual(before);

    deliverFile(new File(["png"], "pic.png", { type: "image/png" }));
    await act(async () => {});
    expect(skeleton()!.getAttribute("data-state")).toBe("uploading");
    expect(doc.toJSON()).toEqual(before);

    // The file's landing commits the image over the anchor's slot and the
    // stand clears (the phrase stands stripped).
    await act(async () => {
      resolveUpload!("file-1");
    });
    await act(async () => {});
    expect(typesOf(doc)).toContain("image");
    expect(skeleton()).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).toBeNull();
  });

  it("a refused upload stands the failed stand's error line, commits nothing, and the stand's click dismisses it", async () => {
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

    // The popover stands closed; the failed stand stands over the phrase
    // block's skeleton (the error line names the failure).
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).toBeNull();
    const stand = skeleton();
    expect(stand, "the failed stand should stand over the phrase block").not.toBeNull();
    expect(stand!.getAttribute("data-state")).toBe("failed");
    const error = stand!.querySelector<HTMLElement>('[data-slot="docblocks/slash-file-error"]');
    expect(error, "the failed stand's error line should stand").not.toBeNull();
    expect(error!.getAttribute("role")).toBe("alert");
    expect(error!.textContent).toBe("Upload failed");
    expect(stand!.querySelector(".animate-spin")).toBeNull();

    // The doc stands untouched (no image, the phrase intact).
    expect(doc.toJSON()).toEqual(before);

    // The stand's click dismisses it: the phrase's row returns.
    fireEvent.click(stand!);
    await act(async () => {});
    expect(skeleton()).toBeNull();
    expect(
      document.querySelector<HTMLElement>(`[data-block-id="${para}"] [data-slot="docblocks/block-content"]`)
    ).not.toBeNull();
    expect(doc.toJSON()).toEqual(before);
  });

  it("a delivered file lands over the stand's focus-clear (the input's listener stands mounted)", async () => {
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

    fireEvent.click(menuItem("File"));
    await act(async () => {});

    // The real browser's ordering: the dialog's close returns the page's
    // focus before the input's change — the stand clears over it, and the
    // delivery still lands (the input's listener stands mounted, so the
    // change reaches the handler and the stand re-stands on the upload).
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});
    expect(skeleton()).toBeNull();

    deliverFile(new File(["png"], "pic.png", { type: "image/png" }));
    await act(async () => {});
    expect(skeleton()!.getAttribute("data-state"), "the stand should re-stand on the upload").toBe("uploading");

    await act(async () => {
      resolveUpload!("file-1");
    });
    await act(async () => {});
    expect(typesOf(doc)).toContain("image");
    expect(skeleton()).toBeNull();
  });

  it("a cancelled picker stands no event of its own — the page's focus clears the stand", async () => {
    const store: BlobStore = {
      ...createMemoryBlobStore(),
      upload: () => new Promise<string>(() => {}),
    };
    const { doc, para } = renderScene(store);
    pressSlash(para);
    const before = doc.toJSON();

    fireEvent.click(menuItem("File"));
    await act(async () => {});
    expect(skeleton()!.getAttribute("data-state")).toBe("picker");

    // The OS dialog's cancel stands no input's event — its close returns
    // the page's focus, and the `picker` phase's stand clears over it.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});
    expect(skeleton(), "the stand should clear over the page's focus").toBeNull();
    expect(doc.toJSON()).toEqual(before);
  });
});
