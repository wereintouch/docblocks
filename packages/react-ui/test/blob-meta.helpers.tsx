// @vitest-environment jsdom
// The blob store's meta-stand harness: the store fixture over the metadata's
// head lookup (the mutable meta + the optional `downloadUrl`), the block's doc
// seed + render, and the DOM reads.
import { render } from "@testing-library/react";
import { expect, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobMeta, BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-15T00:00:00.000Z";
const FILE_ID = "f-1";

interface MetaStoreHarness {
  store: BlobStore;
  get: ReturnType<typeof vi.fn>;
  getMeta: ReturnType<typeof vi.fn>;
}

/** A store with the meta's stand: the mutable meta over `getMeta` (the
 *  rename's stand) + the optional `downloadUrl`; `get` resolves the bytes. */
function makeMetaStore(options: {
  meta: BlobMeta;
  downloadUrl?: (fileId: string) => string;
  getMetaFails?: boolean;
}): MetaStoreHarness {
  const metaState = { ...options.meta };
  const listeners = new Map<string, Set<() => void>>();
  const get = vi.fn(async (): Promise<{ blob: Blob; meta: BlobMeta }> => ({
    blob: new Blob(["bytes"]),
    meta: { ...metaState },
  }));
  const getMeta = vi.fn(async (): Promise<BlobMeta> => {
    if (options.getMetaFails) throw new Error(`Blob not found: ${FILE_ID}`);
    return { ...metaState };
  });
  const store: BlobStore = {
    get,
    upload: async () => "up-1",
    rename: async (_fileId, name) => {
      metaState.name = name;
      for (const listener of listeners.get(_fileId) ?? []) listener();
      return { ...metaState };
    },
    subscribe: (fileId, onChange) => {
      let entries = listeners.get(fileId);
      if (entries === undefined) {
        entries = new Set();
        listeners.set(fileId, entries);
      }
      entries.add(onChange);
      return () => {
        entries.delete(onChange);
      };
    },
    getMeta,
  };
  if (options.downloadUrl !== undefined) store.downloadUrl = options.downloadUrl;
  return { store, get, getMeta };
}

async function renderBlock(store: BlobStore, block: "file" | "image", fileId = FILE_ID) {
  const doc = createDoc({ id: "doc-meta", createdAt: CREATED_AT });
  if (block === "file") doc.insertBlock("file", { fileId });
  else doc.insertBlock("image", { src: fileId });
  const utils = render(
    <EditorProvider doc={doc} blobStore={store}>
      <Editor />
    </EditorProvider>
  );
  await act(async () => {});
  await act(async () => {});
  return { doc, ...utils };
}

function fileCard(): HTMLElement {
  const card = document.querySelector<HTMLElement>('[data-slot="docblocks/file-card"]');
  expect(card, "the file card should render").not.toBeNull();
  return card!;
}

/** The image figure's `<img>`. */
function imageOf(): HTMLImageElement {
  const img = document.querySelector<HTMLImageElement>('[data-slot="docblocks/image"]');
  expect(img, "the image should render").not.toBeNull();
  return img!;
}

export { CREATED_AT, FILE_ID, fileCard, imageOf, makeMetaStore, renderBlock };
export type { MetaStoreHarness };
