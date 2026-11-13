// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobStore } from "../src/blob-store";
import { createMemoryBlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-13T00:00:00.000Z";

async function renderFileDoc(options?: { mode?: "edit" | "view"; renameFails?: boolean }) {
  const memory = createMemoryBlobStore();
  const fileId = await memory.upload(new File(["spreadsheet"], "original.xlsx", { type: "application/vnd.ms-excel" }));
  const rename = vi.fn(async (id: string, name: string) => {
    if (options?.renameFails) throw new Error("storage unavailable");
    return memory.rename(id, name);
  });
  const store: BlobStore = { ...memory, rename };
  const doc = createDoc({ id: "doc-file", createdAt: CREATED_AT });
  const blockId = doc.insertBlock("file", { fileId });
  render(
    <EditorProvider doc={doc} blobStore={store} mode={options?.mode ?? "edit"}>
      <Editor />
    </EditorProvider>
  );
  await act(async () => {});
  await act(async () => {});
  return { doc, blockId, fileId, rename };
}

function cardOf(): HTMLElement {
  const card = document.querySelector<HTMLElement>('[data-slot="docblocks/file-card"]');
  expect(card, "the file card should render").not.toBeNull();
  return card!;
}

afterEach(cleanup);

describe("the file block", () => {
  it("uses only the store metadata for the file icon, name, and download", async () => {
    const { doc, blockId, fileId } = await renderFileDoc();
    expect(doc.getBlock(blockId)).toEqual({ type: "file", attrs: { fileId } });
    expect(cardOf().querySelector('[data-slot="docblocks/file-icon"]')).not.toBeNull();
    expect(cardOf().querySelector('[data-slot="docblocks/file-name"]')?.textContent).toBe("original.xlsx");
    const download = cardOf().querySelector<HTMLAnchorElement>('[data-slot="docblocks/file-download"]');
    expect(download?.getAttribute("href")).toMatch(/^blob:/);
    expect(download?.getAttribute("download")).toBe("original.xlsx");
  });

  it("renames through the store and leaves the document JSON unchanged", async () => {
    const { doc, fileId, rename } = await renderFileDoc();
    const before = doc.toJSON();

    fireEvent.click(cardOf().querySelector<HTMLElement>('[data-slot="docblocks/file-rename"]')!);
    const input = screen.getByLabelText("File name");
    fireEvent.change(input, { target: { value: "renamed.xlsx" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {});

    expect(rename).toHaveBeenCalledWith(fileId, "renamed.xlsx");
    expect(doc.toJSON()).toEqual(before);
    expect(cardOf().querySelector('[data-slot="docblocks/file-name"]')?.textContent).toBe("renamed.xlsx");
    expect(cardOf().querySelector('[data-slot="docblocks/file-download"]')?.getAttribute("download")).toBe(
      "renamed.xlsx"
    );
  });

  it("keeps the previous name and shows an error when storage rename rejects", async () => {
    const { doc } = await renderFileDoc({ renameFails: true });
    const before = doc.toJSON();

    fireEvent.click(cardOf().querySelector<HTMLElement>('[data-slot="docblocks/file-rename"]')!);
    const input = screen.getByLabelText("File name");
    fireEvent.change(input, { target: { value: "renamed.xlsx" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(doc.toJSON()).toEqual(before);
    expect(cardOf().querySelector('[data-slot="docblocks/file-name"]')?.textContent).toBe("original.xlsx");
    expect(screen.getByRole("alert").textContent).toContain("storage rename failed");
  });

  it("keeps download available to readers and hides rename", async () => {
    await renderFileDoc({ mode: "view" });
    expect(cardOf().querySelector('[data-slot="docblocks/file-rename"]')).toBeNull();
    expect(cardOf().querySelector('[data-slot="docblocks/file-download"]')).not.toBeNull();
  });
});
