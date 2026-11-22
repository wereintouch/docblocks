// @vitest-environment jsdom
// The unsafe download href's component's stand (the gate's mount shape):
// a hostile consumer `downloadUrl` (the `javascript:` scheme) stands the
// disabled download control — the anchor is never mounted (the pure gate's
// stand over `shared-utils.test.ts`).
import { cleanup, render } from "@testing-library/react";
import type { BlobStore } from "docblocks-react-ui";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
const UNSAFE_URL = "java\nscript:alert(1)";
const SAFE_URL = "https://cdn.example.com/notes.txt";

/** The file blob store stub (the meta-only stand over the passed download url). */
function fileBlobStore(downloadUrl: () => string): BlobStore {
  return {
    get: async () => {
      throw new Error("unreachable (the meta-only stand's no-bytes)");
    },
    upload: async () => "up-1",
    rename: async () => ({ name: "notes.txt", mimeType: "text/plain" }),
    subscribe: () => () => {},
    getMeta: async () => ({ name: "notes.txt", mimeType: "text/plain" }),
    downloadUrl,
  };
}

/** Flush the async blob resolve (the promise settles on a microtask). */
async function flushResolve(): Promise<void> {
  await act(async () => {});
}

/** Renders a doc with a single `file` block over the passed store. */
async function renderFileDoc(doc: Doc, store: BlobStore) {
  const view = render(
    <EditorProvider doc={doc} blobStore={store}>
      <Editor />
    </EditorProvider>
  );
  await flushResolve();
  return view;
}

describe("the unsafe download href's component's stand (the anchor's no-mount)", () => {
  afterEach(cleanup);

  it("the hostile store's download url stands the disabled control (the anchor's no-mount)", async () => {
    const doc = createDoc({ id: "download-gate-unsafe", createdAt: CREATED_AT });
    doc.insertBlock("file", { fileId: "file-1" });
    const { container } = await renderFileDoc(
      doc,
      fileBlobStore(() => UNSAFE_URL)
    );
    const control = container.querySelector('[data-slot="docblocks/file-download"]');
    expect(control).not.toBeNull();
    expect(control!.tagName).toBe("BUTTON");
    expect((control as HTMLButtonElement).disabled).toBe(true);
    // The anchor's no-mount stand: no <a> stands the hostile href.
    expect(container.querySelector("a[href]")).toBeNull();
  });

  it("the safe store's download url stands the anchor (the gate's stand)", async () => {
    const doc = createDoc({ id: "download-gate-safe", createdAt: CREATED_AT });
    doc.insertBlock("file", { fileId: "file-1" });
    const { container } = await renderFileDoc(
      doc,
      fileBlobStore(() => SAFE_URL)
    );
    const control = container.querySelector('[data-slot="docblocks/file-download"]');
    expect(control).not.toBeNull();
    expect(control!.tagName).toBe("A");
    expect((control as HTMLAnchorElement).getAttribute("href")).toBe(SAFE_URL);
    expect((control as HTMLAnchorElement).getAttribute("download")).toBe("notes.txt");
  });
});
