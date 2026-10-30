/** The shape toolbar's pure helpers (the border width's dot index, the
 *  variant's icon, the hex input's normalization). */
import { Circle, Cloud, Cylinder, Diamond, Square, SquareRounded } from "../../shared/ui/icons";
import { BORDER_WIDTH_POINTS, HEX_RE } from "./constants";
import type { ShapeVariantId } from "./models";

// The width's dot index (the absent / the out-of-stand fall to the
// default 2 px = the index 1; the in-stand map to their own dot).
function borderWidthIndex(strokeWidth: number | undefined): number {
  const index = BORDER_WIDTH_POINTS.indexOf(Math.round(strokeWidth ?? 2));
  return index === -1 ? 1 : index;
}

/** The current variant's icon (the type picker's trigger face). */
function variantIcon(variant: ShapeVariantId | undefined) {
  switch (variant) {
    case "ellipse":
      return Circle;
    case "diamond":
      return Diamond;
    case "cylinder":
      return Cylinder;
    case "cloud":
      return Cloud;
    case "rounded":
      return SquareRounded;
    default:
      return Square;
  }
}

/** Normalizes the hex input to `#rrggbb`-form digits; null when invalid. */
function normalizeHex(raw: string): string | null {
  const match = raw.trim().match(HEX_RE);
  const digits = match?.[1];
  return digits === undefined ? null : `#${digits.toLowerCase()}`;
}

export { borderWidthIndex, normalizeHex, variantIcon };
