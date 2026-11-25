// @vitest-environment jsdom
// The cover's direct-URL stand: the banner, the thumbnail and the tint draw
// the store's `downloadUrl` when it supplies one (the browser's own cacheable
// subrequest) — no bytes, no object URL; the tint falls back to the fetched
// bytes when the store's URL taints the canvas.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

import { CoverBanner } from "../src/attributes/CoverBanner";
import { CoverEditor } from "../src/attributes/CoverEditor";
import { useCoverAverageColor } from "../src/attributes/cover-tint";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-25T00:00:00.000Z";
const COVER_ID = "cover-1";
const DIRECT_URL = "/api/blobs/cover-1";

interface DirectStoreHarness {
  store: BlobStore;
  get: ReturnType<typeof vi.fn>;
  getMeta: ReturnType<typeof vi.fn>;
}

/** The store with both optional members: the metadata over `getMeta`, the
 *  URL over `downloadUrl`, the bytes over `get`. */
function makeDirectStore(): DirectStoreHarness {
  const get = vi.fn(async () => ({
    blob: new Blob(["px"], { type: "image/png" }),
    meta: { name: "cover.png", mimeType: "image/png" },
  }));
  const getMeta = vi.fn(async () => ({
    name: "cover.png",
    mimeType: "image/png",
    width: 1600,
    height: 500,
  }));
  const store: BlobStore = {
    get,
    upload: async () => "up-1",
    rename: async () => ({ name: "cover.png", mimeType: "image/png" }),
    subscribe: () => () => {},
    getMeta,
    downloadUrl: () => DIRECT_URL,
  };
  return { store, get, getMeta };
}

function renderCover(store: BlobStore, attributes: Record<string, unknown>, child: React.ReactNode): void {
  const doc = createDoc({ id: "doc-cover", createdAt: CREATED_AT });
  doc.setAttribute("cover", COVER_ID);
  for (const [key, value] of Object.entries(attributes)) doc.setAttribute(key, value as never);
  render(
    <EditorProvider doc={doc} blobStore={store}>
      {child}
    </EditorProvider>
  );
}

const nativeDecode = HTMLImageElement.prototype.decode;
const nativeNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth");
const nativeNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalHeight");

/** The image's decode's stand: the `img.decode`'s settle (the resolved's
 *  element carries the stubbed intrinsic ratio below) and the intrinsic
 *  dimensions' getters (jsdom decodes nothing, so they are always zero). */
function stubImageDecode(width = 1600, height = 500): void {
  (HTMLImageElement.prototype as { decode?: unknown }).decode = function (this: HTMLImageElement) {
    return Promise.resolve(this);
  };
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => width });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => height });
}

/** The canvas's 2d context over the sample's grid (the tint's pixels). */
function stubCanvas(pixels: Uint8ClampedArray): void {
  const ctx = { drawImage: () => {}, getImageData: () => ({ data: pixels }) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
}

/** The solid's sample: the 8×8's grid of one opaque color. */
function solidPixels(r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  return data;
}

function banner(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-banner"]');
  expect(element, "the banner should render").not.toBeNull();
  return element!;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  HTMLImageElement.prototype.decode = nativeDecode;
  if (nativeNaturalWidth !== undefined) {
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", nativeNaturalWidth);
  }
  if (nativeNaturalHeight !== undefined) {
    Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", nativeNaturalHeight);
  }
});

describe("the cover's direct-URL stand", () => {
  it("draws the store's URL in the banner's tile strip (get is never called)", async () => {
    const { store, get } = makeDirectStore();

    renderCover(store, {}, <CoverBanner />);
    await flush();

    const strip = banner().firstElementChild as HTMLElement;
    expect(strip.style.backgroundImage).toContain(DIRECT_URL);
    expect(strip.style.backgroundRepeat).toBe("repeat-x");
    expect(get).not.toHaveBeenCalled();
  });

  it("slices the centering over the URL's intrinsic dimensions", async () => {
    stubImageDecode();
    const { store, get } = makeDirectStore();

    renderCover(store, { coverMode: "center" }, <CoverBanner />);
    await flush();

    const strip = banner().firstElementChild as HTMLElement;
    // The measured slice needs the intrinsic dimensions: the resolved probe
    // stands the background layer, not the undecodable's plain image.
    expect(strip.style.backgroundImage).toContain(DIRECT_URL);
    expect(strip.style.backgroundSize).toContain("100%");
    expect(strip.style.height).toBe("150px");
    expect(banner().querySelector("img")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("stands the store's URL in the row's thumbnail", async () => {
    const { store, get } = makeDirectStore();

    render(
      <EditorProvider doc={createDoc({ id: "doc-cover", createdAt: CREATED_AT })} blobStore={store}>
        <CoverEditor fileId={COVER_ID} mode="tile" readOnly={false} onCommit={() => {}} onClear={() => {}} />
      </EditorProvider>
    );
    await flush();

    const thumbnail = document.querySelector<HTMLImageElement>('[data-slot="docblocks/attributes-cover"] img');
    expect(thumbnail).not.toBeNull();
    expect(thumbnail!.getAttribute("src")).toBe(DIRECT_URL);
    expect(get).not.toHaveBeenCalled();
  });

  it("tints the frame from the store's URL (the bytes are never fetched)", async () => {
    stubImageDecode();
    stubCanvas(solidPixels(200, 100, 50));
    const { store, get } = makeDirectStore();

    function TintProbe() {
      const color = useCoverAverageColor();
      return <div data-testid="tint-color">{color ?? ""}</div>;
    }
    renderCover(store, {}, <TintProbe />);
    await flush();

    expect(screen.getByTestId("tint-color").textContent).toBe("rgb(200, 100, 50)");
    expect(get).not.toHaveBeenCalled();
  });

  it("falls back to the fetched bytes when the store's URL cannot be read", async () => {
    stubCanvas(solidPixels(10, 20, 30));
    // The store's URL stands the cross-origin no-CORS read: its decode
    // rejects (the taint's stand), while the bytes' object URL decodes.
    const directProxy = new URL(DIRECT_URL, document.baseURI).href;
    const attempts: string[] = [];
    (HTMLImageElement.prototype as { decode?: unknown }).decode = function (this: HTMLImageElement) {
      attempts.push(this.src);
      return this.src === directProxy ? Promise.reject(new Error("tainted")) : Promise.resolve(this);
    };
    const { store, get } = makeDirectStore();

    function TintProbe() {
      const color = useCoverAverageColor();
      return <div data-testid="tint-color">{color ?? ""}</div>;
    }
    renderCover(store, {}, <TintProbe />);
    await flush();

    // The store's URL stands the first read (the direct stand), the bytes'
    // own object URL the second (the fallback).
    await vi.waitFor(() => expect(attempts).toHaveLength(2));
    expect(attempts[0], "the store's URL stands the first read").toBe(directProxy);
    expect(attempts[1], "the bytes' own url stands the fallback").toMatch(/^blob:/);
    expect(get, "the bytes' fallback should read the store").toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tint-color").textContent).toBe("rgb(10, 20, 30)");
  });
});
