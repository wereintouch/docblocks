// @vitest-environment jsdom
// The cover's component's contracts: the upload's modal (the mode's
// selector, the drop zone's stands, the gate's hint, the commit over the
// upload, the Escape's close) and the banner's stands (the tile's fixed
// strip over the background's layer, the centering's centered slice +
// the undecodable's fallback image). The pure's validation's matrix stands
// over the `cover`'s spec; the panel's doc write and the sync stand over
// the e2e's spec.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { DocAttributeValue } from "docblocks-core";

import { CoverBanner } from "../src/attributes/CoverBanner";
import { CoverEditor } from "../src/attributes/CoverEditor";
import type { CoverMode } from "../src/attributes/cover";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";
import type { CoverPresetSets } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The fake store: the uploads' log + the resolved image's get (the
 *  thumbnail's / the banner's path over the accepted id). The `get`'s
 *  id's log stands the passthrough's pin (the doc's stored id reaches
 *  the consumer's store unchanged). */
function storeWith(uploads: File[], gets: string[] = []): BlobStore {
  let seq = 0;
  return {
    get: async (id) => {
      gets.push(id);
      return {
        blob: new Blob(["px"], { type: "image/png" }),
        meta: { name: `${id}.png`, mimeType: "image/png" },
      };
    },
    upload: async (file: File) => {
      uploads.push(file);
      return `id-${++seq}`;
    },
    rename: async () => ({ name: "cover.png", mimeType: "image/png" }),
    subscribe: () => () => {},
  };
}

/** The decodable probe's stand: the `createImageBitmap`'s Promise settles
 *  over the resolve (inside the `act` — the gate's flush's stand). */
function stubDecodable(): { resolve: (width: number, height: number) => void } {
  let settle: ((dimensions: { width: number; height: number; close: () => void }) => void) | null = null;
  const probe = new Promise<{ width: number; height: number; close: () => void }>((resolve) => {
    settle = resolve;
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => probe)
  );
  return {
    resolve: (width: number, height: number) => {
      expect(settle, "the probe should be the pending one").not.toBeNull();
      settle!({ width, height, close: () => {} });
    },
  };
}

const png = (name: string): File => new File([new Uint8Array(4)], name, { type: "image/png" });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the control over the doc + the store (the commit's log is the
 *  write's pin); the optional preset's gallery's stand. */
function renderCover(store: BlobStore, presets?: CoverPresetSets): { commits: Array<[string, CoverMode]> } {
  const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  const commits: Array<[string, CoverMode]> = [];
  render(
    <EditorProvider doc={doc} blobStore={store} coverPresets={presets}>
      <CoverEditor
        fileId={undefined}
        mode="tile"
        readOnly={false}
        onCommit={(id, mode) => commits.push([id, mode])}
        onClear={() => {}}
      />
    </EditorProvider>
  );
  return { commits };
}

const uploadButton = () =>
  document.querySelector<HTMLButtonElement>('[data-slot="docblocks/attributes-cover-upload-button"]');
const modalDialog = () => document.querySelector<HTMLElement>('[data-slot="docblocks/cover-upload-dialog"]');
const modalInput = () => document.querySelector<HTMLInputElement>('[data-slot="docblocks/cover-upload-input"]');
const modalHint = () => document.querySelector<HTMLElement>('[data-slot="docblocks/cover-upload-error"]');
const modalModeButton = (mode: CoverMode) =>
  document.querySelector<HTMLButtonElement>(`[data-slot="docblocks/cover-upload-mode"] [data-mode="${mode}"]`);

describe("the cover upload's modal", () => {
  it("opens over the upload's press (the tile's default's stand)", () => {
    renderCover(storeWith([]));
    expect(modalDialog()).toBeNull();
    fireEvent.click(uploadButton()!);
    expect(modalDialog(), "the modal stands over the press").not.toBeNull();
    expect(modalModeButton("tile")?.getAttribute("aria-pressed")).toBe("true");
    // The strict's accept's stand (the webp's parity).
    expect(modalInput()!.getAttribute("accept")).toContain("image/webp");
    // The preset's grid stands absent (the consumer's catalog's absence),
    // the enlarged's base's stand's size.
    expect(
      document.querySelector('[data-slot="docblocks/cover-preset-grid"]'),
      "the grid's absence's stand"
    ).toBeNull();
    expect(modalDialog()!.classList.contains("w-110"), "the enlarged's base's stand").toBe(true);
  });

  it("commits the tall image over the default mode (the upload + the close)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    fireEvent.change(modalInput()!, { target: { files: [png("tall.png")] } });
    await act(async () => {
      probe.resolve(800, 300);
    });

    expect(uploads).toHaveLength(1);
    expect(commits).toEqual([["id-1", "tile"]]);
    expect(modalDialog(), "the modal closes over the commit").toBeNull();
    expect(modalHint()).toBeNull();
  });

  it("rejects the short image over the tile (the hint's stand, the no upload)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    fireEvent.change(modalInput()!, { target: { files: [png("short.png")] } });
    await act(async () => {
      probe.resolve(800, 100);
    });

    expect(uploads, "the rejection stands the no upload").toHaveLength(0);
    expect(commits).toHaveLength(0);
    expect(modalHint(), "the hint stands").not.toBeNull();
    expect(modalHint()!.textContent).toContain("150");
    expect(modalDialog(), "the modal keeps open").not.toBeNull();
  });

  it("rejects the unsupported type (the MIME's gate, the hint's stand)", async () => {
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    const gif = new File([new Uint8Array(4)], "x.gif", { type: "image/gif" });
    fireEvent.change(modalInput()!, { target: { files: [gif] } });
    await act(async () => {});

    expect(uploads).toHaveLength(0);
    expect(commits).toHaveLength(0);
    expect(modalHint()!.textContent).toContain("PNG");
    expect(modalDialog()).not.toBeNull();
  });

  it("commits over the selected mode (the centering's delivery)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    fireEvent.click(modalModeButton("center")!);
    expect(modalModeButton("center")?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(modalInput()!, { target: { files: [png("wide.png")] } });
    await act(async () => {
      probe.resolve(1200, 300);
    });

    expect(commits).toEqual([["id-1", "center"]]);
    expect(modalDialog()).toBeNull();
  });

  it("closes over the Escape (the no commit's stand)", async () => {
    renderCover(storeWith([]));
    fireEvent.click(uploadButton()!);
    expect(modalDialog()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(modalDialog(), "the modal closes over the Escape").toBeNull();
  });

  it("delivers the dropped file (the drag-and-drop's stand)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    const dropzone = document.querySelector<HTMLButtonElement>('[data-slot="docblocks/cover-upload-dropzone"]');
    expect(dropzone).not.toBeNull();
    fireEvent.drop(dropzone!, { dataTransfer: { files: [png("dropped.png")] } });
    await act(async () => {
      probe.resolve(800, 300);
    });

    expect(uploads).toHaveLength(1);
    expect(commits).toEqual([["id-1", "tile"]]);
    expect(modalDialog()).toBeNull();
  });
});

describe("the cover's preset's grid", () => {
  const TILE_PRESETS = ["tile-1", "tile-2", "tile-3", "tile-4", "tile-5"];
  const CENTER_PRESETS = ["center-1", "center-2"];

  it("stands the 4-column's grid over the passed ids (the scrollable's stand, the enlarged's size)", () => {
    renderCover(storeWith([]), { tile: TILE_PRESETS, center: CENTER_PRESETS });
    fireEvent.click(uploadButton()!);
    const grid = document.querySelector('[data-slot="docblocks/cover-preset-grid"]');
    expect(grid, "the grid stands over the passed's stand").not.toBeNull();
    // The enlarged's stand (the preset's stand's size).
    expect(modalDialog()!.classList.contains("w-140")).toBe(true);
    // The 4-column's stand over the thin-scrollbar's ScrollArea (the
    // visible's 3-row's cap's class over the scroll container's stand).
    const cells = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-preset-cells"]');
    expect(cells).not.toBeNull();
    expect(cells!.classList.contains("grid-cols-4")).toBe(true);
    const scroll = cells!.closest("[data-slot='scroll-area']");
    expect(scroll, "the scroll area's stand").not.toBeNull();
    expect((scroll as HTMLElement).classList.contains("max-h-58"), "the 3-row's cap over the scroll's stand").toBe(
      true
    );
    const thumbs = Array.from(document.querySelectorAll('[data-slot="docblocks/cover-preset"]'));
    expect(thumbs, "the cell's stand over every passed id").toHaveLength(TILE_PRESETS.length);
    expect(thumbs[0]!.getAttribute("data-cover-preset-id")).toBe("tile-1");
  });

  it("the mode's switch stands the set's switch (the grid's stand stands)", () => {
    renderCover(storeWith([]), { tile: TILE_PRESETS, center: CENTER_PRESETS });
    fireEvent.click(uploadButton()!);
    expect(document.querySelectorAll('[data-slot="docblocks/cover-preset"]')).toHaveLength(TILE_PRESETS.length);
    fireEvent.click(modalModeButton("center")!);
    // The same grid's stand over the other set (the set's switch's stand).
    const thumbs = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/cover-preset"]'));
    expect(thumbs).toHaveLength(CENTER_PRESETS.length);
    expect(thumbs[0]!.getAttribute("data-cover-preset-id")).toBe("center-1");
  });

  it("a pick commits the id over the mode (the upload's no stand, the close's stand)", () => {
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads), { tile: TILE_PRESETS });
    fireEvent.click(uploadButton()!);
    const thumb = document.querySelector('[data-slot="docblocks/cover-preset"][data-cover-preset-id="tile-2"]');
    expect(thumb).not.toBeNull();
    fireEvent.click(thumb!);
    expect(commits).toEqual([["tile-2", "tile"]]);
    expect(uploads, "the pick stands the upload's no write").toHaveLength(0);
    expect(modalDialog(), "the modal closes over the pick").toBeNull();
  });

  it("stands absent over the mode's empty set (the other set's grid's absence)", () => {
    renderCover(storeWith([]), { center: CENTER_PRESETS });
    fireEvent.click(uploadButton()!);
    // The tile's set's absence stands no grid (the modal's size stands the
    // passed set's enlarged's stand over the other set's presence).
    expect(
      document.querySelector('[data-slot="docblocks/cover-preset-grid"]'),
      "the grid's absence's stand"
    ).toBeNull();
    expect(modalDialog()!.classList.contains("w-140")).toBe(true);
    fireEvent.click(modalModeButton("center")!);
    expect(document.querySelectorAll('[data-slot="docblocks/cover-preset"]')).toHaveLength(CENTER_PRESETS.length);
  });
});

/** Renders the banner over the doc's attributes + the store (the
 *  resolution's id's log's stand — the passthrough's pin's input). */
function renderBanner(attributes: Record<string, unknown>): { gets: string[] } {
  const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  for (const [key, value] of Object.entries(attributes)) {
    doc.setAttribute(key, value as DocAttributeValue);
  }
  const gets: string[] = [];
  render(
    <EditorProvider doc={doc} blobStore={storeWith([], gets)}>
      <CoverBanner />
    </EditorProvider>
  );
  return { gets };
}

describe("the cover's banner", () => {
  it("stands absent over no cover", () => {
    renderBanner({});
    expect(document.querySelector('[data-slot="docblocks/cover-banner"]')).toBeNull();
  });

  it("stands absent over the unknown id (the consumer's store's rejection's stand)", async () => {
    const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
    doc.setAttribute("cover", "missing-id");
    render(
      <EditorProvider
        doc={doc}
        blobStore={{
          get: async () => {
            throw new Error("Blob not found: missing-id");
          },
          upload: async () => "id-1",
          rename: async () => ({ name: "cover.png", mimeType: "image/png" }),
          subscribe: () => () => {},
        }}
      >
        <CoverBanner />
      </EditorProvider>
    );
    await act(async () => {});
    expect(document.querySelector('[data-slot="docblocks/cover-banner"]')).toBeNull();
  });

  it("stands the frame's edge's stand (the top radius + the bottom fade's mask)", async () => {
    const { gets } = renderBanner({ cover: "id-1" });
    await act(async () => {});
    const banner = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-banner"]');
    expect(banner, "the banner stands").not.toBeNull();
    // The card's rounded-xl's corner's clip over the frame's top edge.
    expect(banner!.classList.contains("rounded-t-xl")).toBe(true);
    expect(banner!.classList.contains("-mt-6")).toBe(true);
    // The bottom fade's mask (the 16px's depth's stand over both modes).
    expect(banner!.getAttribute("style")).toContain("16px");
    // The id's passthrough: the doc's stored id stands the consumer's
    // store's resolution's argument (the consumer's storage's stand).
    expect(gets, "the stored id's passthrough").toContain("id-1");
  });

  it("stands the centering over the mode (the centered slice's stand)", async () => {
    const probe = stubDecodable();
    await act(async () => {
      renderBanner({ cover: "id-1", coverMode: "center" });
    });
    await act(async () => {
      probe.resolve(1200, 300);
    });
    const banner = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-banner"]');
    expect(banner, "the banner stands").not.toBeNull();
    expect(banner!.getAttribute("data-cover-mode")).toBe("center");
    const layer = banner!.firstElementChild as HTMLElement | null;
    expect(layer, "the background's layer stands").not.toBeNull();
    // The no-layout's container keeps the maximum's height's fail-open. The
    // size's `auto`'s second value stands the default — the CSSOM's
    // serialization omits it.
    expect(layer!.style.height).toBe("150px");
    expect(layer!.style.backgroundSize).toBe("100%");
    expect(layer!.style.backgroundRepeat).toBe("no-repeat");
  });

  it("stands the undecodable cover's fallback image (the centering's mode)", async () => {
    await act(async () => {
      renderBanner({ cover: "id-1", coverMode: "center" });
    });
    const banner = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-banner"]');
    expect(banner, "the banner stands").not.toBeNull();
    const img = banner!.querySelector("img");
    expect(img, "the fallback's image stands").not.toBeNull();
    expect(img!.style.maxHeight).toBe("150px");
  });

  it("stands the tile over the mode (the fixed strip's stand)", async () => {
    await act(async () => {
      renderBanner({ cover: "id-1" });
    });
    const banner = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute("data-cover-mode")).toBe("tile");
    const layer = banner!.firstElementChild as HTMLElement | null;
    expect(layer, "the background's layer stands").not.toBeNull();
    expect(layer!.style.height).toBe("150px");
    expect(layer!.style.backgroundSize).toBe("auto 150px");
    expect(layer!.style.backgroundRepeat).toBe("repeat-x");
  });
});
