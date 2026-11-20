// @vitest-environment jsdom
// The cover's pure logic: the mode's read (the absent's stand is the tile),
// the upload's validation over the `createImageBitmap`'s probe (the
// strict's png/jpeg/webp's MIME gate, the tile's minimum height, the
// centering's minimum width over the editor width — the undecodable
// payload's and the no-width's fail-open), the mode's switch's gate, the
// per-mode background's stands (the tile's fixed strip, the centering's
// centered slice), and the fade mask's curves. The modal's and the
// banner's contracts stand over the component's spec (the panel's doc
// write and the sync stand over the e2e's spec).
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  centerBackgroundStyle,
  coverFadeMask,
  coverModeGating,
  coverModeOf,
  tileBackgroundStyle,
  validateCoverUpload,
} from "../src/attributes/cover";

/** The decodable probe's stand: the `createImageBitmap`'s Promise settles
 *  over the resolve (the pure's flush — no React commit's stand). */
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

/** The undecodable payload's stand: the probe's rejection settles over the
 *  resolve (the fail-open's flush's stand). */
function stubUndecodable(): { resolve: () => void } {
  let settle: (() => void) | null = null;
  const probe = new Promise<never>((_, reject) => {
    settle = () => {
      reject(new Error("not supported"));
    };
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => probe)
  );
  return {
    resolve: () => {
      expect(settle, "the probe should be the pending one").not.toBeNull();
      settle!();
    },
  };
}

const png = (name = "cover.png"): File => new File([new Uint8Array(4)], name, { type: "image/png" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the cover's pure logic", () => {
  it("reads the mode over the stored value (the absent's stand is the tile)", () => {
    expect(coverModeOf(undefined)).toBe("tile");
    expect(coverModeOf("center")).toBe("center");
    expect(coverModeOf("tile")).toBe("tile");
    expect(coverModeOf("banana")).toBe("tile");
  });

  it("gates the upload's MIME (the strict's png/jpeg/webp's stand)", async () => {
    const gif = new File([new Uint8Array(4)], "x.gif", { type: "image/gif" });
    const svg = new File([new Uint8Array(4)], "x.svg", { type: "image/svg+xml" });
    expect(await validateCoverUpload(gif, "tile", 900)).toEqual({ ok: false, reason: "unsupported" });
    expect(await validateCoverUpload(svg, "center", 900)).toEqual({ ok: false, reason: "unsupported" });

    // The webp's stand is accepted (the probe's dimensions settle the rest).
    const webp = new File([new Uint8Array(4)], "x.webp", { type: "image/webp" });
    const probe = stubDecodable();
    probe.resolve(800, 200);
    expect(await validateCoverUpload(webp, "tile", 900)).toEqual({ ok: true });
  });

  it("gates the tile's minimum height (the undecodable's fail-open)", async () => {
    let probe = stubDecodable();
    probe.resolve(800, 100);
    expect(await validateCoverUpload(png(), "tile", 900)).toEqual({ ok: false, reason: "tooShort" });

    probe = stubDecodable();
    probe.resolve(800, 150);
    expect(await validateCoverUpload(png(), "tile", 900)).toEqual({ ok: true });

    const undecodable = stubUndecodable();
    const result = validateCoverUpload(png(), "tile", 900);
    undecodable.resolve();
    expect(await result).toEqual({ ok: true });
  });

  it("gates the centering's minimum width over the editor width (the no-width's fail-open)", async () => {
    let probe = stubDecodable();
    probe.resolve(400, 300);
    expect(await validateCoverUpload(png(), "center", 964)).toEqual({ ok: false, reason: "tooNarrow" });

    probe = stubDecodable();
    probe.resolve(1200, 300);
    expect(await validateCoverUpload(png(), "center", 964)).toEqual({ ok: true });

    probe = stubDecodable();
    probe.resolve(400, 300);
    expect(await validateCoverUpload(png(), "center", 0)).toEqual({ ok: true });
  });

  it("gates the mode's switch over the stored image (the unknown's fail-open)", () => {
    expect(coverModeGating(null, 964)).toEqual({ tileDisabled: false, centerDisabled: false });
    // The narrow strip: the centering's switch stands disabled.
    expect(coverModeGating({ width: 400, height: 300 }, 964)).toEqual({
      tileDisabled: false,
      centerDisabled: true,
    });
    // The short image: the tile's switch stands disabled.
    expect(coverModeGating({ width: 1200, height: 100 }, 964)).toEqual({
      tileDisabled: true,
      centerDisabled: false,
    });
    // Both gates unmet stand both's disabled.
    expect(coverModeGating({ width: 400, height: 100 }, 964)).toEqual({
      tileDisabled: true,
      centerDisabled: true,
    });
    // The no-layout's width keeps the centering's enabled (the fail-open).
    expect(coverModeGating({ width: 400, height: 300 }, 0)).toEqual({
      tileDisabled: false,
      centerDisabled: false,
    });
  });

  it("stands the tile's background over the fixed strip (the height's constant)", () => {
    const style = tileBackgroundStyle("url");
    expect(style.height).toBe(150);
    expect(style.backgroundSize).toBe("auto 150px");
    expect(style.backgroundRepeat).toBe("repeat-x");
    expect(style.backgroundPosition).toBe("center");
    expect(style.backgroundImage).toBe('url("url")');
  });

  it("stands the centering's background over the centered slice (the width's scale)", () => {
    // The wide image: the scaled height exceeds the cap — the slice stands the maximum.
    const capped = centerBackgroundStyle({ width: 1200, height: 300 }, 964, "url");
    expect(capped.height).toBe(150);
    expect(capped.backgroundSize).toBe("100% auto");
    expect(capped.backgroundRepeat).toBe("no-repeat");
    expect(capped.backgroundPosition).toBe("center");
    // The short image: the scaled height stands under the cap — its own.
    const short = centerBackgroundStyle({ width: 1600, height: 100 }, 1000, "url");
    expect(short.height).toBe(62.5);
    // The no-layout's container keeps the maximum's fail-open.
    expect(centerBackgroundStyle({ width: 1600, height: 100 }, 0, "url").height).toBe(150);
  });

  it("stands the fade mask's curves (the smooth's default)", () => {
    expect(coverFadeMask()).toBe(coverFadeMask("smooth"));
    expect(coverFadeMask("linear")).toBe("linear-gradient(to bottom, #000 calc(100% - 16px), transparent 100%)");
    // The smooth's stand: the eased alpha's quarter's stops over the region.
    const smooth = coverFadeMask("smooth");
    expect(smooth).toContain("rgba(0, 0, 0, 0.5625) calc(100% - 12px)");
    expect(smooth).toContain("rgba(0, 0, 0, 0.25) calc(100% - 8px)");
    expect(smooth).toContain("rgba(0, 0, 0, 0.0625) calc(100% - 4px)");
    expect(smooth).toContain("transparent 100%)");
  });
});
