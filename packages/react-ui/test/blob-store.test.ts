// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createMemoryBlobStore } from "../src/blob-store";

/** A File with the given name/mime (jsdom's File is adequate for the read). */
function makeFile(name: string, type: string, content = "x"): File {
  return new File([content], name, { type });
}

describe("createMemoryBlobStore", () => {
  it("upload → id → get returns the original bytes and authoritative metadata", async () => {
    const store = createMemoryBlobStore();
    const fileId = await store.upload(makeFile("pic.png", "image/png", "hello"));
    expect(fileId).toBe("blob-1");

    const ref = await store.get(fileId);
    expect(await ref.blob.text()).toBe("hello");
    expect(ref.meta).toEqual({ name: "pic.png", mimeType: "image/png" });
  });

  it("uses the binary fallback for an unknown mime type", async () => {
    const store = createMemoryBlobStore();
    const fileId = await store.upload(makeFile("data.bin", ""));
    expect((await store.get(fileId)).meta.mimeType).toBe("application/octet-stream");
  });

  it("rename returns the new metadata and notifies the file's subscribers", async () => {
    const store = createMemoryBlobStore();
    const fileId = await store.upload(makeFile("a.txt", "text/plain"));
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(fileId, onChange);

    const meta = await store.rename(fileId, "renamed.txt");
    expect(meta).toEqual({ name: "renamed.txt", mimeType: "text/plain" });
    expect((await store.get(fileId)).meta).toEqual(meta);
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    await store.rename(fileId, "again.txt");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown ids for get and rename", async () => {
    const store = createMemoryBlobStore();
    await expect(store.get("nope")).rejects.toThrow(/Blob not found/);
    await expect(store.rename("nope", "name.txt")).rejects.toThrow(/Blob not found/);
  });

  it("remove drops the id and notifies its subscribers", async () => {
    const store = createMemoryBlobStore();
    const fileId = await store.upload(makeFile("a.png", "image/png"));
    const onChange = vi.fn();
    store.subscribe(fileId, onChange);
    await store.remove?.(fileId);
    await expect(store.get(fileId)).rejects.toThrow(/Blob not found/);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("issues a fresh id per upload", async () => {
    const store = createMemoryBlobStore();
    expect(await store.upload(makeFile("a.png", "image/png"))).toBe("blob-1");
    expect(await store.upload(makeFile("b.png", "image/png"))).toBe("blob-2");
  });
});
