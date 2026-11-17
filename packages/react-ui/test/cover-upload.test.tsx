// @vitest-environment jsdom
// The cover's upload gate: the intrinsic height's check over
// `createImageBitmap` (the short image's rejection — the no-upload's
// no commit, the inline hint's stand; the undecodable payload's
// fail-open — the upload stands). The control's own contract (the
// panel's doc write and the sync stand over the e2e's spec).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { CoverEditor } from "../src/attributes/CoverEditor";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The fake store: the uploads' log + the resolved image's get (the
 *  thumbnail's path over the accepted id). */
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

/** The undecodable payload's stand: the probe's rejection settles over the
 *  resolve (inside the `act` — the fail-open's flush's stand). */
function stubUndecodable(): { resolve: () => void } {
  let settle: (() => void) | null = null;
  const probe = new Promise<never>((_, reject) => {
    settle = () => {
      reject(new Error("not supported"));
    };
  });
  vi.stubGlobal("createImageBitmap", vi.fn(() => probe));
  return {
    resolve: () => {
      expect(settle, "the probe should be the pending one").not.toBeNull();
      settle!();
    },
  };
}

/** Renders the control over the doc + the store (the panel's contract
 *  stand: the `onSet`'s log is the commit's pin). */
function renderCover(store: BlobStore): { doc: Doc; setIds: string[] } {
  const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  const setIds: string[] = [];
  render(
    <EditorProvider doc={doc} blobStore={store}>
      <CoverEditor fileId={undefined} readOnly={false} onSet={(id) => setIds.push(id)} onClear={() => {}} />
    </EditorProvider>
  );
  return { doc, setIds };
}

const input = () => {
  const el = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-cover-upload"]');
  expect(el, "the upload input should stand").not.toBeNull();
  return el!;
};

const hint = () => document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-cover-error"]');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the cover's upload height gate", () => {
  it("rejects the short image (no upload, no commit, the hint's stand)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { setIds } = renderCover(storeWith(uploads));

    fireEvent.change(input(), { target: { files: [new File([new Uint8Array(4)], "short.png", { type: "image/png" })] } });
    await act(async () => {
      probe.resolve(800, 100);
    });

    expect(uploads, "the rejection stands the no upload").toHaveLength(0);
    expect(setIds).toHaveLength(0);
    expect(hint()).not.toBeNull();
    expect(hint()!.textContent).toContain("150");
  });

  it("accepts the tall image (the upload + the one commit, the hint's absence)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { setIds } = renderCover(storeWith(uploads));

    fireEvent.change(input(), { target: { files: [new File([new Uint8Array(4)], "tall.png", { type: "image/png" })] } });
    await act(async () => {
      probe.resolve(800, 300);
    });

    expect(uploads).toHaveLength(1);
    expect(setIds).toEqual(["id-1"]);
    expect(hint()).toBeNull();
  });

  it("fails open over the undecodable payload (the upload stands)", async () => {
    const probe = stubUndecodable();
    const uploads: File[] = [];
    const { setIds } = renderCover(storeWith(uploads));

    fireEvent.change(input(), { target: { files: [new File([new Uint8Array(4)], "opaque.heic", { type: "image/heic" })] } });
    await act(async () => {
      probe.resolve();
    });

    expect(uploads).toHaveLength(1);
    expect(setIds).toEqual(["id-1"]);
    expect(hint()).toBeNull();
  });

  it("clears the hint over the next accepted attempt", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { setIds } = renderCover(storeWith(uploads));

    fireEvent.change(input(), { target: { files: [new File([new Uint8Array(4)], "short.png", { type: "image/png" })] } });
    await act(async () => {
      probe.resolve(800, 100);
    });
    expect(hint()).not.toBeNull();

    const second = stubDecodable();
    fireEvent.change(input(), { target: { files: [new File([new Uint8Array(4)], "tall.png", { type: "image/png" })] } });
    await act(async () => {
      second.resolve(800, 300);
    });

    expect(uploads).toHaveLength(1);
    expect(setIds).toEqual(["id-1"]);
    expect(hint()).toBeNull();
  });
});
