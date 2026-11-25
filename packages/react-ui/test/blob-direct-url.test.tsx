// @vitest-environment jsdom
// The image block's direct-URL stand: an image MIME resolves from the store's
// `downloadUrl` (the browser's own cacheable subrequest) instead of the bytes
// over `get`; the pdf, an executable-scheme URL and a store without `getMeta`
// keep the bytes' path.
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import type { BlobStore } from "../src/blob-store";
import { imageOf, makeMetaStore, renderBlock } from "./blob-meta.helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the image block's direct-URL stand", () => {
  it("stands the store's download URL as the img src (get is never called)", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const { store, get, getMeta } = makeMetaStore({
      meta: { name: "pic.png", mimeType: "image/png", width: 120, height: 80 },
      downloadUrl: (fileId) => `/api/blobs/${fileId}`,
    });

    await renderBlock(store, "image", "img-1");

    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    const img = imageOf();
    expect(img.getAttribute("src")).toBe("/api/blobs/img-1");
    // The head's intrinsic dimensions still reserve the box (the attributes
    // travel from the metadata's lookup).
    expect(img.getAttribute("width")).toBe("120");
    expect(img.getAttribute("height")).toBe("80");
    // The placeholder stands only until the head resolves.
    expect(document.querySelector('[data-slot="docblocks/image-placeholder"]')).toBeNull();
    // The download card's stand belongs to the non-renderable MIME only.
    expect(document.querySelector('[data-slot="docblocks/file-card"]')).toBeNull();
  });

  it("re-resolves over the store's change (the fresh head, the image stands)", async () => {
    const { store, get, getMeta } = makeMetaStore({
      meta: { name: "pic.png", mimeType: "image/png" },
      downloadUrl: (fileId) => `/api/blobs/${fileId}`,
    });

    await renderBlock(store, "image", "img-1");
    const download = document.querySelector<HTMLAnchorElement>('[data-slot="docblocks/image-download"]');
    expect(download?.getAttribute("download")).toBe("pic.png");

    await act(async () => {
      await store.rename("img-1", "pic-2.png");
    });
    await act(async () => {});

    // The store's notify re-reads the head over the direct stand (the fresh
    // getMeta, no bytes) and the new name lands in place — no placeholder,
    // no fallback to the object URL.
    expect(getMeta).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalled();
    expect(imageOf().getAttribute("src")).toBe("/api/blobs/img-1");
    expect(download?.getAttribute("download")).toBe("pic-2.png");
  });

  it("keeps the bytes' path over an executable-scheme URL", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fallback");
    const { store, get } = makeMetaStore({
      meta: { name: "pic.png", mimeType: "image/png" },
      downloadUrl: () => "javascript:alert(1)",
    });

    await renderBlock(store, "image", "img-1");

    expect(get).toHaveBeenCalledTimes(1);
    expect(imageOf().getAttribute("src")).toBe("blob:fallback");
  });

  it("keeps the pdf's bytes' path over the image block (the viewer reads the payload)", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:pdf");
    const { store, get } = makeMetaStore({
      meta: { name: "report.pdf", mimeType: "application/pdf" },
      downloadUrl: (fileId) => `https://cdn.example/files/${fileId}`,
    });

    await renderBlock(store, "image", "pdf-1");

    expect(get).toHaveBeenCalledTimes(1);
    const iframe = document.querySelector<HTMLIFrameElement>('[data-slot="docblocks/image-pdf"]');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe("blob:pdf");
  });

  it("keeps the bytes' path over a store without getMeta (the MIME is unknown before the get)", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:no-head");
    const { store: headStore, get } = makeMetaStore({ meta: { name: "pic.png", mimeType: "image/png" } });
    const store: BlobStore = {
      get: headStore.get,
      upload: headStore.upload,
      rename: headStore.rename,
      subscribe: headStore.subscribe,
      downloadUrl: (fileId) => `/api/blobs/${fileId}`,
    };

    await renderBlock(store, "image", "img-1");

    expect(get).toHaveBeenCalledTimes(1);
    expect(imageOf().getAttribute("src")).toBe("blob:no-head");
  });
});
