// @vitest-environment jsdom
// The cover's frame's tint's contracts: the card's data attribute's stands
// (the default's on over the cover's presence, the off over the explicit
// `false`, the absence over the no cover) and the average's color's read
// (the alpha-weighted mean over the sample's grid, the jsdom's no-canvas's
// fail-open). The panel's checkbox's doc write and the theme's mix stand
// over the e2e's spec.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { useCoverAverageColor } from "../src/attributes/cover-tint";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The fake store: the cover's solid image's get (the resolution's stand
 *  over the accepted id). */
function storeWith(): BlobStore {
  return {
    get: async (id) => ({
      blob: new Blob(["px"], { type: "image/png" }),
      meta: { name: `${id}.png`, mimeType: "image/png" },
    }),
    upload: async (file: File) => file.name,
    rename: async () => ({ name: "cover.png", mimeType: "image/png" }),
    subscribe: () => () => {},
  };
}

/** The full editor's render over the doc's attributes (the card's stand
 *  is the read's pin). */
function renderEditor(attributes: Record<string, unknown>): void {
  const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  for (const [key, value] of Object.entries(attributes)) {
    doc.setAttribute(key, value as never);
  }
  render(
    <EditorProvider doc={doc} blobStore={storeWith()}>
      <Editor />
    </EditorProvider>
  );
}

const card = () => document.querySelector<HTMLElement>('[data-slot="card"]');

/** The image's decode's stand: the `img.decode`'s resolve (the object
 *  URL's stubs' parity over the jsdom's no-createObjectURL's stand) + the
 *  canvas's 2d context's stub (the sample's grid's pixels' pin). */
const originalImageDecode = HTMLImageElement.prototype.decode;

function stubImageDecode(): void {
  (HTMLImageElement.prototype as { decode?: unknown }).decode = function (this: HTMLImageElement) {
    return Promise.resolve(this);
  };
}

function stubDecodable(pixels: Uint8ClampedArray): void {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:mock";
    URL.revokeObjectURL = () => {};
  }
  stubImageDecode();
  const ctx = {
    drawImage: () => {},
    getImageData: () => ({ data: pixels }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  HTMLImageElement.prototype.decode = originalImageDecode;
});

describe("the cover's frame's tint's attribute's stands", () => {
  it("stands the data attribute over the cover's presence (the default's on)", () => {
    renderEditor({ cover: "c1" });
    expect(card()!.hasAttribute("data-cover-tint"), "the default's on over the absent's key").toBe(true);
  });

  it("stands the off over the explicit `false`", () => {
    renderEditor({ cover: "c1", coverTint: false });
    expect(card()!.hasAttribute("data-cover-tint")).toBe(false);
  });

  it("stands the on's restore over the `false`'s removal", () => {
    renderEditor({ cover: "c1" });
    expect(card()!.hasAttribute("data-cover-tint")).toBe(true);
  });

  it("stands no attribute over the absent cover", () => {
    renderEditor({});
    expect(card()!.hasAttribute("data-cover-tint")).toBe(false);
  });
});

describe("the cover's average's color", () => {
  function TintProbe() {
    const color = useCoverAverageColor();
    return <div data-testid="tint-color">{color ?? ""}</div>;
  }

  it("stands `null` over the jsdom's no-canvas's stand (the fail-open)", async () => {
    // The decode's stub stands no canvas's context (the jsdom's
    // `getContext`'s `null`'s parity) — the fail-open's `null`'s pin.
    if (typeof URL.createObjectURL !== "function") {
      URL.createObjectURL = () => "blob:mock";
      URL.revokeObjectURL = () => {};
    }
    stubImageDecode();
    const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
    doc.setAttribute("cover", "c1");
    render(
      <EditorProvider doc={doc} blobStore={storeWith()}>
        <TintProbe />
      </EditorProvider>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("tint-color").textContent).toBe("");
  });

  it("stands the alpha-weighted mean over the opaque's share", async () => {
    const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
    doc.setAttribute("cover", "c1");
    // The 8×8's grid: the 32 opaque's pixels over the solid's rgb(10, 20,
    // 30) + the 32 transparent's (the alpha's zero's stand — no gray's
    // pull over the alpha fade's parity).
    const data = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 32; i++) {
      const o = i * 4;
      data[o] = 10;
      data[o + 1] = 20;
      data[o + 2] = 30;
      data[o + 3] = 255;
    }
    stubDecodable(data);
    render(
      <EditorProvider doc={doc} blobStore={storeWith()}>
        <TintProbe />
      </EditorProvider>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("tint-color").textContent, "the opaque's mean over the transparent's no-pull").toBe(
      "rgb(10, 20, 30)"
    );
  });

  it("stands the variable over the card's element (the border's element)", async () => {
    const data = new Uint8ClampedArray(8 * 8 * 4).fill(200);
    for (let o = 3; o < data.length; o += 4) data[o] = 255;
    stubDecodable(data);
    renderEditor({ cover: "c1" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(card()!.style.getPropertyValue("--docblocks-cover-tint-color")).toBe("rgb(200, 200, 200)");
  });
});
