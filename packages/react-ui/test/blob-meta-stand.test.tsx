// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobMeta, BlobStore } from "../src/blob-store";
import { createMemoryBlobStore } from "../src/blob-store";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the blob store's meta-only stand", () => {
  it("stands the legacy path over a store without getMeta (the bytes over get, the object URL)", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fake-legacy");
    const memory = createMemoryBlobStore();
    const fileId = await memory.upload(new File(["bytes"], "archive.zip", { type: "application/zip" }));
    const get = vi.spyOn(memory, "get");
    const store: BlobStore = { ...memory, get };

    await renderBlock(store, "file", fileId);

    // The legacy's stand stands untouched (the regression's pin): the bytes
    // resolve over `get` and the card stands the object URL.
    expect(get).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const card = fileCard();
    expect(card.querySelector('[data-slot="docblocks/file-name"]')?.textContent).toBe("archive.zip");
    const download = card.querySelector<HTMLAnchorElement>('[data-slot="docblocks/file-download"]');
    expect(download?.getAttribute("href")).toBe("blob:fake-legacy");
    expect(download?.getAttribute("download")).toBe("archive.zip");
  });

  it("stands the meta card without the bytes over a non-renderable MIME (get is never called)", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fake-should-not-stand");
    const { store, get, getMeta } = makeMetaStore({
      meta: { name: "archive.zip", mimeType: "application/zip" },
      downloadUrl: (fileId) => `https://cdn.example/files/${fileId}`,
    });

    await renderBlock(store, "file");

    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    const card = fileCard();
    expect(card.querySelector('[data-slot="docblocks/file-name"]')?.textContent).toBe("archive.zip");
    const download = card.querySelector<HTMLAnchorElement>('[data-slot="docblocks/file-download"]');
    expect(download?.getAttribute("href")).toBe(`https://cdn.example/files/${FILE_ID}`);
    expect(download?.getAttribute("download")).toBe("archive.zip");
  });

  it("the pdf's MIME resolves the bytes (the preview's stand stands over the meta's)", async () => {
    const { store, get, getMeta } = makeMetaStore({
      meta: { name: "report.pdf", mimeType: "application/pdf" },
      downloadUrl: (fileId) => `https://cdn.example/files/${fileId}`,
    });

    await renderBlock(store, "file");

    // The renderable MIME stands the bytes' path (the iframe's src is the
    // object URL — the consumer's download URL never stands there).
    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    const iframe = document.querySelector<HTMLIFrameElement>('[data-slot="docblocks/file-pdf"]');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toMatch(/^blob:/);
  });

  it("the image block's non-image MIME stands the meta card without the bytes", async () => {
    const { store, get, getMeta } = makeMetaStore({
      meta: { name: "notes.txt", mimeType: "text/plain" },
      downloadUrl: (fileId) => `https://cdn.example/files/${fileId}`,
    });

    await renderBlock(store, "image", "img-1");

    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(document.querySelector('[data-slot="docblocks/image"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/image-placeholder"]')).toBeNull();
    const card = document.querySelector<HTMLElement>('[data-slot="docblocks/file-card"][data-block-type="image"]');
    expect(card).not.toBeNull();
    expect(card!.querySelector('[data-slot="docblocks/file-name"]')?.textContent).toBe("notes.txt");
  });

  it("a store without downloadUrl falls back to the bytes' path (the object URL)", async () => {
    const { store, get, getMeta } = makeMetaStore({ meta: { name: "archive.zip", mimeType: "application/zip" } });

    await renderBlock(store, "file");

    // The download's URL stands the legacy's path (the object URL over `get`).
    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    const download = fileCard().querySelector<HTMLAnchorElement>('[data-slot="docblocks/file-download"]');
    expect(download?.getAttribute("href")).toMatch(/^blob:/);
  });

  it("stands the missing placeholder over a rejected getMeta", async () => {
    const { store, get } = makeMetaStore({
      meta: { name: "archive.zip", mimeType: "application/zip" },
      downloadUrl: (fileId) => `https://cdn.example/files/${fileId}`,
      getMetaFails: true,
    });

    await renderBlock(store, "file");

    const placeholder = document.querySelector<HTMLElement>('[data-slot="docblocks/file-placeholder"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.getAttribute("data-state")).toBe("missing");
    expect(get).not.toHaveBeenCalled();
  });

  it("a rename re-resolves over the meta's branch (the fresh getMeta, the new name in place)", async () => {
    const { store, getMeta, get } = makeMetaStore({
      meta: { name: "old.zip", mimeType: "application/zip" },
      downloadUrl: (fileId) => `https://cdn.example/files/${fileId}`,
    });

    await renderBlock(store, "file");
    expect(fileCard().querySelector('[data-slot="docblocks/file-name"]')?.textContent).toBe("old.zip");

    // The card's rename (Enter commits) — the store's notify re-resolves
    // over the meta's branch (a fresh getMeta stands the new name in place,
    // the bytes never stand).
    fireEvent.click(fileCard().querySelector<HTMLElement>('[data-slot="docblocks/file-rename"]')!);
    const input = screen.getByLabelText("File name");
    fireEvent.change(input, { target: { value: "new.zip" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {});

    expect(getMeta).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalled();
    expect(fileCard().querySelector('[data-slot="docblocks/file-name"]')?.textContent).toBe("new.zip");
  });

  it("the object URL stands over the bytes' path only (the revoke over the swap and the unmount)", async () => {
    let sequence = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:fake-${++sequence}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const memory = createMemoryBlobStore();
    const fileId = await memory.upload(new File(["bytes"], "picture.png", { type: "image/png" }));

    const { unmount } = await renderBlock(memory, "image", fileId);

    const image = () => document.querySelector<HTMLImageElement>('[data-slot="docblocks/image"]');
    expect(image()).not.toBeNull();
    const firstUrl = image()!.getAttribute("src");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    // The store's replacement (the rename's notify) re-resolves the bytes —
    // the previous object URL revokes, the new one stands.
    await act(async () => {
      await memory.rename(fileId, "picture2.png");
    });
    await act(async () => {});
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    const secondUrl = image()!.getAttribute("src");
    expect(secondUrl).toBe("blob:fake-2");

    // The unmount revokes the live object URL (no leak).
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(secondUrl);
  });
});
