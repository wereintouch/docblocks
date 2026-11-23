// The image figure's split set's shared stand: the blob store's fixture,
// the image doc's seed + render, the async resolve's flush, and the figure /
// the img / the attrs' reads + the rects' stand (jsdom measures nothing).
import { render } from "@testing-library/react";
import { expect } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

const IMAGE_STORE: BlobStore = {
  get: async () => ({
    blob: new Blob(["pic"], { type: "image/png" }),
    meta: { name: "pic.png", mimeType: "image/png" },
  }),
  upload: async () => "up-1",
  rename: async () => ({ name: "pic.png", mimeType: "image/png" }),
  subscribe: () => () => {},
};

/** Seed the image (optionally with the view attrs), render, return the ids. */
function renderImageDoc(prepare?: (attrs: Record<string, unknown>) => void) {
  const doc = createDoc({ id: "doc-img", createdAt: CREATED_AT });
  const attrs: Record<string, unknown> = {};
  prepare?.(attrs);
  const imageId = doc.insertBlock("image", { src: "key-1", ...attrs });
  render(
    <EditorProvider doc={doc} blobStore={IMAGE_STORE}>
      <Editor />
    </EditorProvider>
  );
  return { doc, imageId };
}

/** Flush the async blob resolve. */
async function flushResolve(): Promise<void> {
  await act(async () => {});
}

/** The figure wrapper. */
function figureOf(): HTMLElement {
  const figure = document.querySelector<HTMLElement>('[data-slot="docblocks/image-figure"]');
  expect(figure, "the figure should render").not.toBeNull();
  return figure!;
}

/** The image block's attrs (the typed reader over the block union). */
function imageAttrs(doc: ReturnType<typeof createDoc>, id: string): Record<string, unknown> | null {
  const block = doc.getBlock(id);
  return block !== null && block.type === "image" ? (block.attrs as unknown as Record<string, unknown>) : null;
}

/** The img element. */
function imgOf(): HTMLImageElement {
  const img = document.querySelector<HTMLImageElement>("img[data-slot='docblocks/image']");
  expect(img, "the img should render").not.toBeNull();
  return img!;
}

/** Stand the figure's and the editor root's rects (jsdom measures nothing). */
function standRects(figure: HTMLElement, width: number, editorWidth: number): void {
  const left = 10;
  const rect = (l: number, w: number) =>
    ({ left: l, right: l + w, top: 0, bottom: 400, width: w, height: 400, x: l, y: 0, toJSON: () => ({}) }) as DOMRect;
  figure.getBoundingClientRect = () => rect(left, width);
  // The resize's clamp scope: the figure's row (the motion page view — the
  // row's content box over the indent) or the editor root (the no-row's
  // stand — the table cell's mini-doc).
  const scope =
    figure.closest<HTMLElement>("[data-slot='docblocks/row']") ??
    document.querySelector<HTMLElement>("[data-slot='docblocks/editor']");
  expect(scope, "the figure's row (or the editor root) should render").not.toBeNull();
  scope!.getBoundingClientRect = () => rect(0, editorWidth);
}

export { CREATED_AT, IMAGE_STORE, figureOf, flushResolve, imageAttrs, imgOf, renderImageDoc, standRects };
