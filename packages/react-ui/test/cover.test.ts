// @vitest-environment jsdom
// The cover's pure logic: the mode's read (the absent's stand is the tile),
// the upload's validation over the `createImageBitmap`'s probe (the
// strict's png/jpeg's MIME gate, the tile's minimum height, the centering's
// minimum width over the editor width — the undecodable payload's and the
// no-width's fail-open), and the tile's background stand (the crop over the
// glue's decision). The modal's and the banner's contracts stand over the
// component's spec (the panel's doc write and the sync stand over the
// e2e's spec).
import { afterEach, describe, expect, it, vi } from "vitest";

import { coverModeGating, coverModeOf, tileBackgroundStyle, validateCoverUpload } from "../src/attributes/cover";

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

  it("gates the upload's MIME (the strict's png/jpeg's stand)", async () => {
    const gif = new File([new Uint8Array(4)], "x.gif", { type: "image/gif" });
    const svg = new File([new Uint8Array(4)], "x.svg", { type: "image/svg+xml" });
    expect(await validateCoverUpload(gif, "tile", 900)).toEqual({ ok: false, reason: "unsupported" });
    expect(await validateCoverUpload(svg, "center", 900)).toEqual({ ok: false, reason: "unsupported" });
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

  it("stands the tile's background over the intrinsic width (the crop over the glue)", () => {
    const wide = tileBackgroundStyle({ width: 1200, height: 200 }, 964, "url");
    expect(wide.backgroundRepeat).toBe("no-repeat");
    expect(wide.height).toBe(200);
    expect(wide.backgroundSize).toBe("auto 100%");
    const narrow = tileBackgroundStyle({ width: 400, height: 200 }, 964, "url");
    expect(narrow.backgroundRepeat).toBe("repeat-x");
  });
});
