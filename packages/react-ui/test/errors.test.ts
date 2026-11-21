import { describe, expect, it } from "vitest";

import { createMemoryBlobStore } from "../src/blob-store";
import {
  BlobNotFoundError,
  CanvasPasteError,
  DocBlocksUiError,
  EditorProviderError,
  PdfFetchError,
  UnhandledValueError,
  UnknownSlashCommandError,
} from "../src/shared/errors";
import { assertNever } from "../src/shared/utils";

/** Every condition class of the typed family (the closed set). */
const CONDITION_CLASSES = [
  BlobNotFoundError,
  CanvasPasteError,
  EditorProviderError,
  PdfFetchError,
  UnhandledValueError,
  UnknownSlashCommandError,
] as const;

describe("the typed error family", () => {
  it("stands every condition class over the DocBlocksUiError base", () => {
    for (const Cls of CONDITION_CLASSES) {
      const error = new Cls("message");
      expect(error).toBeInstanceOf(DocBlocksUiError);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("message");
      expect(error.name).toBe(Cls.name);
    }
  });

  it("carries the base name over the base class itself", () => {
    const error = new DocBlocksUiError("message");
    expect(error.name).toBe("DocBlocksUiError");
  });
});

describe("the typed throws", () => {
  it("the memory blob store rejects a missing id with BlobNotFoundError", async () => {
    const store = createMemoryBlobStore();
    await expect(store.get("nope")).rejects.toThrow(BlobNotFoundError);
    await expect(store.get("nope")).rejects.toThrow(/Blob not found/);
    await expect(store.rename("nope", "name.txt")).rejects.toThrow(BlobNotFoundError);
  });

  it("the exhaustiveness backstop throws UnhandledValueError", () => {
    expect(() => assertNever("stray" as unknown as never)).toThrow(UnhandledValueError);
    expect(() => assertNever("stray" as unknown as never)).toThrow(/Unhandled value/);
  });
});
