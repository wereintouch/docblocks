// The cover's shared logic (the pure reads and the upload's validation —
// no JSX, no context): the accepted MIME's gate, the per-mode dimension's
// gates, the intrinsic dimensions' probe, and the mode's read. The
// validation stands pre-upload: the rejected file's bytes never reach the
// consumer's blob store.
import type { CSSProperties } from "react";

import type { DocAttributeValue } from "docblocks-core";

/** The cover's accepted upload's MIME's types (the strict's stand). */
const COVER_ACCEPTED_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg"];

/** The tile mode's minimum intrinsic height (CSS px). */
const COVER_MIN_TILE_HEIGHT_PX = 150;

/** The centering mode's maximum rendered height (CSS px). The stand stands
 *  equal to the tile's minimum (the 150 px's shared threshold). */
const COVER_MAX_CENTER_HEIGHT_PX = 150;

/** The banner's bottom fade-out's depth (CSS px) — the last pixels stand
 *  the smooth stand into the page's content. */
const COVER_FADE_BOTTOM_PX = 30;

/** The cover's renderable-MIME's predicate. A module-level const keeps the
 *  predicate's identity stable (the resolution's effect's dep — an inline
 *  arrow re-runs the effect on every render). The lenient's `image/*`'s
 *  stand: the legacy's covers may stand a format outside the upload's
 *  strict's gate. */
const COVER_RENDERS_BYTES = (mimeType: string): boolean => mimeType.startsWith("image/");

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
 * `createImageBitmap` decode probe — the bytes are never rendered).
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
    return null;
  }
}

/**
 * The banner's bottom fade-out's mask (the last pixels' smooth stand into
 *  the page's content) — the mask's stand over both modes (the layer's /
 *  the image's stand share the wrapper's stand).
 */
function coverFadeMask(): string {
  return `linear-gradient(to bottom, #000 calc(100% - ${COVER_FADE_BOTTOM_PX}px), transparent 100%)`;
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
    tileDisabled: dimensions.height < COVER_MIN_TILE_HEIGHT_PX,
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
 * (the strict's png/jpeg's stand), then the intrinsic dimension's gate —
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
  if (mode === "tile" && dimensions.height < COVER_MIN_TILE_HEIGHT_PX) {
    return { ok: false, reason: "tooShort" };
  }
  if (mode === "center" && editorWidthPx > 0 && dimensions.width < editorWidthPx) {
    return { ok: false, reason: "tooNarrow" };
  }
  return { ok: true };
}

/**
 * The tile mode's background stand over the intrinsic width: the image's
 * strip stands its natural height (the `auto 100%`'s size — the width's
 * overflow stands the centered's crop), and a strip narrower than the
 * container stands the `repeat-x`'s stand (the same strip glues left and
 * right to the container's edge).
 */
function tileBackgroundStyle(dimensions: ImageDimensions, containerWidthPx: number, url: string): CSSProperties {
  return {
    height: dimensions.height,
    backgroundImage: `url("${url}")`,
    backgroundSize: "auto 100%",
    backgroundPosition: "center",
    backgroundRepeat: dimensions.width >= containerWidthPx ? "no-repeat" : "repeat-x",
  };
}

export {
  COVER_ACCEPTED_MIME_TYPES,
  COVER_FADE_BOTTOM_PX,
  COVER_MAX_CENTER_HEIGHT_PX,
  COVER_MIN_TILE_HEIGHT_PX,
  COVER_MODE_ORDER,
  COVER_RENDERS_BYTES,
  coverFadeMask,
  coverModeGating,
  coverModeOf,
  readImageDimensions,
  tileBackgroundStyle,
  validateCoverUpload,
};
export type { CoverMode, CoverRejectionReason, CoverValidation, ImageDimensions };
