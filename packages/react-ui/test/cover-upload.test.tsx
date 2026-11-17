// @vitest-environment jsdom
// The cover's component's contracts: the upload's modal (the mode's
// selector, the drop zone's stands, the gate's hint, the commit over the
// upload, the Escape's close) and the banner's stands (the tile's
// natural height's stand over the background's layer, the centering's
// max height's cap). The pure's validation's matrix stands over the
// `cover`'s spec; the panel's doc write and the sync stand over the
// e2e's spec.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { DocAttributeValue } from "docblocks-core";

import { CoverBanner } from "../src/attributes/CoverBanner";
import { CoverEditor } from "../src/attributes/CoverEditor";
import type { CoverMode } from "../src/attributes/cover";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The fake store: the uploads' log + the resolved image's get (the
 *  thumbnail's / the banner's path over the accepted id). */
function storeWith(uploads: File[]): BlobStore {
  let seq = 0;
  return {
    get: async (id) => ({
      blob: new Blob(["px"], { type: "image/png" }),
      meta: { name: `${id}.png`, mimeType: "image/png" },
    }),
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
  vi.stubGlobal("createImageBitmap", vi.fn(() => probe));
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
 *  write's pin). */
function renderCover(store: BlobStore): { commits: Array<[string, CoverMode]> } {
  const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  const commits: Array<[string, CoverMode]> = [];
  render(
    <EditorProvider doc={doc} blobStore={store}>
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
const modalInput = () =>
  document.querySelector<HTMLInputElement>('[data-slot="docblocks/cover-upload-input"]');
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

/** Renders the banner over the doc's attributes + the store. */
function renderBanner(attributes: Record<string, unknown>): void {
  const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  for (const [key, value] of Object.entries(attributes)) {
    doc.setAttribute(key, value as DocAttributeValue);
  }
  const uploads: File[] = [];
  render(
    <EditorProvider doc={doc} blobStore={storeWith(uploads)}>
      <CoverBanner />
    </EditorProvider>
  );
}

describe("the cover's banner", () => {
  it("stands absent over no cover", () => {
    renderBanner({});
    expect(document.querySelector('[data-slot="docblocks/cover-banner"]')).toBeNull();
  });

  it("stands the centering over the mode (the max height's cap)", async () => {
    await act(async () => {
      renderBanner({ cover: "id-1", coverMode: "center" });
    });
    const banner = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-banner"]');
    expect(banner, "the banner stands").not.toBeNull();
    expect(banner!.getAttribute("data-cover-mode")).toBe("center");
    const img = banner!.querySelector("img");
    expect(img, "the image stands").not.toBeNull();
    expect(img!.style.maxHeight).toBe("150px");
  });

  it("stands the tile over the mode (the natural height's stand)", async () => {
    const probe = stubDecodable();
    await act(async () => {
      renderBanner({ cover: "id-1" });
    });
    await act(async () => {
      probe.resolve(1200, 200);
    });
    const banner = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute("data-cover-mode")).toBe("tile");
    const layer = banner!.firstElementChild as HTMLElement | null;
    expect(layer, "the background's layer stands").not.toBeNull();
    expect(layer!.style.height).toBe("200px");
    expect(layer!.style.backgroundSize).toBe("auto 100%");
    expect(layer!.style.backgroundRepeat).toBe("no-repeat");
  });
});
