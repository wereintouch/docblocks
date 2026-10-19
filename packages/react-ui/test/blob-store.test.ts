// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { blobSubtypeOf, createMemoryBlobStore } from "../src/blob-store";

/** A File with the given name/mime (jsdom's File is adequate for the read). */
function makeFile(name: string, type: string, content = "x"): File {
  return new File([content], name, { type });
}

describe("blobSubtypeOf", () => {
  it("maps the mime to the subtype", () => {
    expect(blobSubtypeOf(makeFile("a.png", "image/png"))).toBe("image");
    expect(blobSubtypeOf(makeFile("a.jpg", "image/jpeg"))).toBe("image");
    expect(blobSubtypeOf(makeFile("a.pdf", "application/pdf"))).toBe("pdf");
    expect(blobSubtypeOf(makeFile("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toBe(
      "file"
    );
    expect(blobSubtypeOf(new Blob(["x"]))).toBe("file");
  });
});

describe("createMemoryBlobStore", () => {
  it("upload → key → resolve: the data url + the file-derived meta", async () => {
    const store = createMemoryBlobStore();
    const key = await store.upload(makeFile("pic.png", "image/png", "hello"));
    expect(key).toBe("blob-1");

    const ref = await store.resolve(key);
    expect(ref.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(ref.meta).toEqual({ subtype: "image", name: "pic.png", type: "image/png", size: 5 });
  });

  it("the caller's meta overrides the derived values (it decides the subtype)", async () => {
    const store = createMemoryBlobStore();
    const key = await store.upload(makeFile("a.bin", "application/octet-stream"), { subtype: "pdf", name: "doc.pdf" });

    const ref = await store.resolve(key);
    expect(ref.meta).toEqual({ subtype: "pdf", name: "doc.pdf", type: "application/octet-stream", size: 1 });
  });

  it("rejects the unknown key", async () => {
    const store = createMemoryBlobStore();
    await expect(store.resolve("nope")).rejects.toThrow(/Blob not found/);
  });

  it("remove drops the key (a later resolve rejects)", async () => {
    const store = createMemoryBlobStore();
    const key = await store.upload(makeFile("a.png", "image/png"));
    await expect(store.resolve(key)).resolves.toBeDefined();
    await store.remove?.(key);
    await expect(store.resolve(key)).rejects.toThrow(/Blob not found/);
  });

  it("issues a fresh key per upload", async () => {
    const store = createMemoryBlobStore();
    expect(await store.upload(makeFile("a.png", "image/png"))).toBe("blob-1");
    expect(await store.upload(makeFile("b.png", "image/png"))).toBe("blob-2");
  });
});
