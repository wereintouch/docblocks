// @vitest-environment jsdom
// The renderer's registry over sync-embed: the consumer's renderer's
// replacement (the built-in's stand) and the malformed's ref's literal's
// runtime's throw.
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { CREATED_AT, renderOuter } from "./sync-embed.helpers";

describe("renderer registry: sync-embed", () => {
  it("a consumer renderer for sync-embed replaces the built-in", () => {
    renderOuter(
      { docId: "master-1" },
      {
        blockRenderers: {
          "sync-embed": ({ id, block }) => (
            <div
              data-testid="custom-sync-embed"
              data-custom-id={id}
              data-custom-doc-id={block.type === "sync-embed" ? block.attrs.ref.docId : ""}
            />
          ),
        },
      }
    );

    const custom = document.querySelector("[data-testid='custom-sync-embed']");
    expect(custom).not.toBeNull();
    expect(custom?.getAttribute("data-custom-doc-id")).toBe("master-1");
    expect(document.querySelector('[data-slot="docblocks/sync-embed-body"]')).toBeNull();
  });

  it("a malformed ref literal is a type error and throws at runtime", () => {
    const doc = createDoc({ id: "scratch", createdAt: CREATED_AT });
    expect(() => {
      // @ts-expect-error — the ref is an object, not a string
      doc.insertBlock("sync-embed", { ref: "master-1" });
    }).toThrow();
  });
});
