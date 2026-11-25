// The cover's shared logic (the pure reads and the upload's validation —
// no JSX, no context): the accepted MIME's gate, the per-mode dimension's
// gates, the intrinsic dimensions' probe, and the mode's read. The
// validation stands pre-upload: the rejected file's bytes never reach the
// consumer's blob store.
import type { CSSProperties } from "react";

import type { DocAttributeValue } from "docblocks-core";

/** The cover's accepted upload's MIME's types (the strict's stand). */
const COVER_ACCEPTED_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];

/** The tile mode's rendered strip's height (CSS px) — the fixed's stand
 *  (the upload's gate's parity: the image's height stands at least this,
 *  the strip stands scaled down to it). */
const COVER_TILE_STRIP_HEIGHT_PX = 150;

/** The centering mode's maximum rendered height (CSS px). The stand stands
 *  equal to the tile's minimum (the 150 px's shared threshold). */
const COVER_MAX_CENTER_HEIGHT_PX = 150;

/** The banner's bottom fade-out's depth (CSS px) — the last pixels stand
 *  the smooth stand into the page's content. */
const COVER_FADE_BOTTOM_PX = 16;

/** The banner's bottom fade-out's curve's modes: the linear's ramp over the
 *  fade's region, or the smooth's (ease-out's) stand — the quarter's stops'
 *  approximation of the (1 - t)^2's curve (the bottom's edge stands the
 *  gradual's stand). */
type CoverFadeMode = "linear" | "smooth";

/** The cover's renderable-MIME's predicate (both the bytes' path and the
 *  store's direct URL render an image the same way). A module-level const
 *  keeps the predicate's identity stable (the resolution's effect's dep —
 *  an inline arrow re-runs the effect on every render). The lenient's
 *  `image/*`'s stand: the legacy's covers may stand a format outside the
 *  upload's strict's gate. */
const COVER_RENDERS_IMAGE = (mimeType: string): boolean => mimeType.startsWith("image/");

/** The cover's placement mode: the tile's stand (the image's strip repeats
 *  over the row's width) or the centering's stand (the image stands the
 *  centered's max height's stand). */
type CoverMode = "tile" | "center";

/** The cover mode's ordered options (the tile's stand stands first — the
 *  selector's default's stand). */
const COVER_MODE_ORDER: readonly CoverMode[] = ["tile", "center"];

/** The image's intrinsic pixel dimensions. */
interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * The intrinsic dimensions over a decodable image blob (the
 * `createImageBitmap` decode probe — the bytes are never rendered). The
 * picked file's upload validation reads them before a store exists.
 * `null` over an undecodable payload (the fail-open: the consumer's
 * renderer may accept a format the browser cannot probe).
 */
async function readImageDimensions(file: Blob): Promise<ImageDimensions | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  } catch {
    // The probe stands "unknown" over an undecodable file (the caller
    // keeps the renderer's own stand — the SVG / the exotic formats).
    return null;
  }
}

/**
 * The browser's decode over an image url: the store's direct URL or the
 * library's own object URL. The element carries the intrinsic dimensions,
 * and the tint draws it into the sample's canvas — a `blob:` url stays
 * same-origin, so that read never taints. `null` over an undecodable
 * payload.
 */
async function decodeImageUrl(url: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return img;
  } catch {
    // The decode stands null over an unreadable payload (the caller's
    // fail-open).
    return null;
  }
}

/**
 * The intrinsic dimensions over a resolved image url (the display path's
 * probe — the browser decodes the very image the cover renders, so its own
 * cache serves the payload). `null` over an undecodable payload or a
 * zero-sized element (the fail-open stands the caller's own rendering).
 */
async function readUrlDimensions(url: string): Promise<ImageDimensions | null> {
  const img = await decodeImageUrl(url);
  if (img === null || img.naturalWidth === 0 || img.naturalHeight === 0) return null;
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/** The frame's tint's CSS variable (the cover's average color's stand
 *  over the card's element — the border's mix's input). */
const COVER_TINT_VARIABLE = "--docblocks-cover-tint-color";

/** The tint's average's sample's size (the pixel's count per side — the
 *  grid's area's mean over the image's downscale). */
const TINT_SAMPLE_PX = 8;

/**
 * The alpha-weighted average color over a resolved image url (the frame's
 * tint's / the consumer's glow's data's source): the image stands
 * downscaled to the sample's grid over a canvas, and the mean stands the
 * premultiplied's accumulation (the alpha's share per pixel) — the
 * transparent's stand no gray's pull (the alpha fade's cover stands its
 * solid's hue, not the fade's average). The `rgb(...)`'s string over the
 * computed's stand; `null` over an undecodable payload, the canvas's
 * absence, or a tainted read (a cross-origin url without CORS — the caller
 * stands the bytes' same-origin object URL as the fallback).
 */
async function averageColorOfUrl(url: string): Promise<string | null> {
  const img = await decodeImageUrl(url);
  if (img === null) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = TINT_SAMPLE_PX;
    canvas.height = TINT_SAMPLE_PX;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    ctx.drawImage(img, 0, 0, TINT_SAMPLE_PX, TINT_SAMPLE_PX);
    const data = ctx.getImageData(0, 0, TINT_SAMPLE_PX, TINT_SAMPLE_PX).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let alphaSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = (data[i + 3] ?? 0) / 255;
      r += (data[i] ?? 0) * alpha;
      g += (data[i + 1] ?? 0) * alpha;
      b += (data[i + 2] ?? 0) * alpha;
      alphaSum += alpha;
    }
    if (alphaSum === 0) return null;
    const mean = (sum: number): number => Math.round(sum / alphaSum);
    return `rgb(${mean(r)}, ${mean(g)}, ${mean(b)})`;
  } catch {
    // The canvas's read stands null over an unreadable image or a tainted
    // context (the tint stands none — the caller's fallback or the plain
    // border).
    return null;
  }
}

/**
 * The banner's bottom fade-out's mask (the last pixels' smooth stand into
 *  the page's content) — the mask's stand over both modes (the layer's /
 *  the image's stand share the wrapper's stand). The smooth's stand is the
 *  default's (the soft's bottom's edge).
 */
function coverFadeMask(mode: CoverFadeMode = "smooth"): string {
  const depth = COVER_FADE_BOTTOM_PX;
  if (mode === "linear") {
    return `linear-gradient(to bottom, #000 calc(100% - ${depth}px), transparent 100%)`;
  }
  const stop = (t: number): string => `rgba(0, 0, 0, ${(1 - t) ** 2}) calc(100% - ${depth * (1 - t)}px)`;
  return `linear-gradient(to bottom, #000 calc(100% - ${depth}px), ${stop(0.25)}, ${stop(0.5)}, ${stop(0.75)}, transparent 100%)`;
}

/** The mode's switch's gate over the stored cover's dimensions (the
 *  toggle's disabled's stand): a mode's option stands disabled only when
 *  its gate is known unmet over the image — the centering's minimum width
 *  over the editor width, the tile's minimum height. The unknown's
 *  dimensions' / the no-layout's width's stand keep the option's enabled
 *  stand (the fail-open's parity over the upload's gate). */
function coverModeGating(
  dimensions: ImageDimensions | null,
  editorWidthPx: number
): { tileDisabled: boolean; centerDisabled: boolean } {
  if (dimensions === null) return { tileDisabled: false, centerDisabled: false };
  return {
    tileDisabled: dimensions.height < COVER_TILE_STRIP_HEIGHT_PX,
    centerDisabled: editorWidthPx > 0 && dimensions.width < editorWidthPx,
  };
}

/** The cover mode's read over the stored value: the absent's / the
 *  non-center's stand stands the tile (the stored value's vocabulary is
 *  the "center"'s single entry — the tile's stand is the key's absence). */
function coverModeOf(value: DocAttributeValue | undefined): CoverMode {
  return value === "center" ? "center" : "tile";
}

/** The upload's rejection's reasons (the hint's key's stand). */
type CoverRejectionReason = "unsupported" | "tooShort" | "tooNarrow";

type CoverValidation = { ok: true } | { ok: false; reason: CoverRejectionReason };

/**
 * The cover upload's validation over the mode: the accepted MIME's gate
 * (the strict's png/jpeg/webp's stand), then the intrinsic dimension's gate —
 * the tile's minimum height, the centering's minimum width over the
 * editor's live width (the measured column's box). `editorWidthPx` of
 * zero or less stands the width check's fail-open (the no-layout's stand).
 * An undecodable payload stands the fail-open over the dimension's gates.
 */
async function validateCoverUpload(file: Blob, mode: CoverMode, editorWidthPx: number): Promise<CoverValidation> {
  if (!COVER_ACCEPTED_MIME_TYPES.includes(file.type)) {
    return { ok: false, reason: "unsupported" };
  }
  const dimensions = await readImageDimensions(file);
  if (dimensions === null) return { ok: true };
  if (mode === "tile" && dimensions.height < COVER_TILE_STRIP_HEIGHT_PX) {
    return { ok: false, reason: "tooShort" };
  }
  if (mode === "center" && editorWidthPx > 0 && dimensions.width < editorWidthPx) {
    return { ok: false, reason: "tooNarrow" };
  }
  return { ok: true };
}

/**
 * The tile mode's background stand: the image's strip stands scaled to the
 * fixed's strip's height (the width's proportional), centered, and repeated
 * horizontally (the narrow's strip's copies glue left and right to the
 * container's edge; the wide's single copy stands the centered's crop).
 */
function tileBackgroundStyle(url: string): CSSProperties {
  return {
    height: COVER_TILE_STRIP_HEIGHT_PX,
    backgroundImage: `url("${url}")`,
    backgroundSize: `auto ${COVER_TILE_STRIP_HEIGHT_PX}px`,
    backgroundPosition: "center",
    backgroundRepeat: "repeat-x",
  };
}

/**
 * The centering mode's background stand: the image's width stands scaled to
 * the container's width (the height's proportional), and the wrapper's
 * height stands the centered's slice over that scaled height (capped at the
 * maximum's stand — the narrower's scaled height stands its own). The
 * vertical centering crops the excess top and bottom evenly. The
 * zero-container's stand (the no-layout's jsdom) stands the maximum's
 * height's fail-open.
 */
function centerBackgroundStyle(dimensions: ImageDimensions, containerWidthPx: number, url: string): CSSProperties {
  const scaledHeight =
    containerWidthPx > 0 ? dimensions.height * (containerWidthPx / dimensions.width) : COVER_MAX_CENTER_HEIGHT_PX;
  return {
    height: Math.min(COVER_MAX_CENTER_HEIGHT_PX, scaledHeight),
    backgroundImage: `url("${url}")`,
    backgroundSize: "100% auto",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

export {
  COVER_ACCEPTED_MIME_TYPES,
  COVER_FADE_BOTTOM_PX,
  COVER_MAX_CENTER_HEIGHT_PX,
  COVER_MODE_ORDER,
  COVER_RENDERS_IMAGE,
  COVER_TILE_STRIP_HEIGHT_PX,
  COVER_TINT_VARIABLE,
  averageColorOfUrl,
  centerBackgroundStyle,
  coverFadeMask,
  coverModeGating,
  coverModeOf,
  readImageDimensions,
  readUrlDimensions,
  tileBackgroundStyle,
  validateCoverUpload,
};
export type { CoverFadeMode, CoverMode, CoverRejectionReason, CoverValidation, ImageDimensions };
