// @vitest-environment jsdom
// The blob placeholder's box (both blocks' cards): the width clamp that keeps
// the loading / missing card inside the row (the inline aspect ratio alone
// lets a wide figure's box outgrow the page column) and the content's
// centering inside the reserved height. jsdom computes no layout, so the pins
// are the structural classes; the painted geometry stands in the browser
// end-to-end suite.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockType } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-25T00:00:00.000Z";

/** The store's get never settles: the block keeps its loading placeholder. */
const PENDING_STORE: BlobStore = {
  get: () => new Promise(() => {}),
  upload: async () => "up-1",
  rename: async () => ({ name: "a.txt", mimeType: "text/plain" }),
  subscribe: () => () => {},
};

async function renderPlaceholder(type: BlockType, attrs: Record<string, string>): Promise<HTMLElement> {
  const doc = createDoc({ id: "doc-placeholder", createdAt: CREATED_AT });
  if (type === "image") doc.insertBlock("image", { src: attrs.src ?? "pending-1" });
  else doc.insertBlock("file", { fileId: attrs.fileId ?? "pending-1" });
  render(
    <EditorProvider doc={doc} blobStore={PENDING_STORE}>
      <Editor />
    </EditorProvider>
  );
  await act(async () => {});
  const slot = type === "image" ? "docblocks/image-placeholder" : "docblocks/file-placeholder";
  const placeholder = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  expect(placeholder, "the placeholder card should render").not.toBeNull();
  return placeholder!;
}

afterEach(() => {
  cleanup();
});

describe("the blob placeholder's box", () => {
  it("clamps the image card to the row width", async () => {
    const placeholder = await renderPlaceholder("image", { src: "pending-1" });
    expect(placeholder.className).toContain("max-w-full");
  });

  it("clamps the file card to the row width", async () => {
    const placeholder = await renderPlaceholder("file", { fileId: "pending-1" });
    expect(placeholder.className).toContain("max-w-full");
  });

  it("centers the image card's content in the reserved box", async () => {
    const placeholder = await renderPlaceholder("image", { src: "pending-1" });
    const content = placeholder.querySelector<HTMLElement>('[data-slot="card-content"]');
    expect(content).not.toBeNull();
    expect(content!.className).toContain("m-auto");
  });

  it("centers the file card's content in the reserved box", async () => {
    const placeholder = await renderPlaceholder("file", { fileId: "pending-1" });
    const content = placeholder.querySelector<HTMLElement>('[data-slot="card-content"]');
    expect(content).not.toBeNull();
    expect(content!.className).toContain("m-auto");
  });
});
