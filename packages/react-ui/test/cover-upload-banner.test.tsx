// @vitest-environment jsdom
// The cover's banner's stands: the absent's stands (the no cover / the
// unknown's id's rejection), the frame's edge's stand (the top's radius
// + the bottom's fade's mask, the id's passthrough), the centering's /
// the tile's mode's stands, and the undecodable's fallback's image.
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { DocAttributeValue } from "docblocks-core";

import { CoverBanner } from "../src/attributes/CoverBanner";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT, storeWith, stubDecodable } from "./cover-upload.helpers";

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
