// The cover tests' shared stand: the fake blob store (the uploads' log
// + the resolved image's get), the decodable probe's stub, the editor's
// render (the commit's log + the preset's gallery), the modal's DOM
// reads, and the per-test's cleanup.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";

import { createDoc } from "docblocks-core";

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

export {
  CREATED_AT,
  modalDialog,
  modalHint,
  modalInput,
  modalModeButton,
  png,
  renderCover,
  storeWith,
  stubDecodable,
  uploadButton,
};
