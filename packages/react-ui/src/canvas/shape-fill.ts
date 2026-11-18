/**
 * The figure's fill stand over the themes (the render-time's transform —
 * the data stands the source hex, no CRDT's write, no wire, no
 * persistence): the light theme stands the fixed hex's fill verbatim (the
 * fidelity's stand), the dark theme stands the LIGHT fixed fill darkened
 * (the dark corridor — the hue's stand, the lightness over the dark's
 * stand, the saturation's drop — the `#dae8fc`'s muted dark blue, the
 * `#FFFFFF`'s dark neutral); the already-dark's fills stand pass-through
 * (the white's text over the dark is the correct's stand). The non-hex's
 * stands (the `var()`'s token, the theme's default, the absence) stand
 * pass-through (the adaptive's theme's stand stands on its own).
 *
 * The text's resolution: the explicit `textColor` stands (the data's
 * stand); otherwise the contrast over the EFFECTIVE fill (the fill's
 * dark-computed's stand) — the black / white over the better WCAG's
 * contrast; the non-hex's effective fill stands `null` (the theme's
 * foreground's inheritance's stand). The stroke stands pass-through over
 * every stand (the v1's documented's stand — the darkened fill's + the
 * existing's stroke's stand stays readable; the token's stroke is the
 * adaptive's stand on its own).
 */

/** The relative luminance's threshold: over it the fill stands the light
 * (the dark's corridor's target); the dark's fills (under it) stand
 * pass-through. */
const LUMINANCE_THRESHOLD = 0.2;

/** The dark corridor's HSL stand: the lightness over the dark's (the
 * 20–30% band's middle), the saturation's drop (the pastel's stand — the
 * muted's, not the neon's). */
const DARK_LIGHTNESS = 0.24;
const DARK_SATURATION_SCALE = 0.55;

interface HexParts {
  r: number;
  g: number;
  b: number;
  a: number | null;
}

const HEX_FILL_RE = /^#([0-9a-f]{3,8})$/i;

/** The fixed hex's fill parse (`#rgb` / `#rrggbb` / `#rrggbbaa`, the
 * `#rgba`'s 8-digit's stand) — `null` over the non-hex (the `var()`'s
 * token's stand, the named's, the absence). */
function parseHexFill(value: string): HexParts | null {
  const match = value.trim().match(HEX_FILL_RE);
  if (match === null) return null;
  const raw = match[1]!.toLowerCase();
  const is8 = raw.length === 8 || raw.length === 4;
  const hex =
    raw.length === 3 || raw.length === 4
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const alpha = is8 ? Number.parseInt(hex.slice(6, 8), 16) : null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: alpha === null ? null : alpha,
  };
}

function toHexPair(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

/** The WCAG's relative luminance (the 0..1's stand). */
function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The sRGB → HSL (the hue over the 0..360's, the lightness / saturation
 * over the 0..1's). */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

/** The HSL → sRGB (the 0..255's channels). */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = (((h % 360) + 360) % 360) / 360;
  return { r: hue2rgb(p, q, hn + 1 / 3) * 255, g: hue2rgb(p, q, hn) * 255, b: hue2rgb(p, q, hn - 1 / 3) * 255 };
}

/** The dark corridor's value over the light's hex (the hue's stand, the
 * lightness / saturation's stand); the hue-less's (the gray's) stands the
 * gray's dark (the `#FFFFFF`'s dark neutral's stand). The alpha's stand
 * (the present's 8-digit's stand over the computed's RGB). */
function darkenHexHex(parts: HexParts): string {
  const { h, s } = rgbToHsl(parts.r, parts.g, parts.b);
  const rgb = hslToRgb(h, s * DARK_SATURATION_SCALE, DARK_LIGHTNESS);
  const hex = `#${toHexPair(rgb.r)}${toHexPair(rgb.g)}${toHexPair(rgb.b)}`;
  return parts.a === null ? hex : `${hex}${toHexPair(parts.a)}`;
}

/**
 * The effective fill (the render's stand): the dark theme's light fixed
 * fill stands the dark corridor's value; every other stand (the light's
 * theme, the dark's fill, the non-hex) stands verbatim (`undefined` stands
 * the no-fill's stand — the caller's `none`'s stand).
 */
export function effectiveFillOf(fill: string | undefined, isDark: boolean): string | undefined {
  if (fill === undefined) return undefined;
  if (isDark) {
    const parts = parseHexFill(fill);
    if (parts !== null && relativeLuminance(parts.r, parts.g, parts.b) > LUMINANCE_THRESHOLD) {
      return darkenHexHex(parts);
    }
  }
  return fill;
}

/**
 * The text's contrast over the effective fill (the WCAG's ratio's stand —
 * the black / white over the better). The explicit `textColor` stands
 * (the data's stand) — the caller's resolution. `null` over the
 * non-hex's effective fill (the theme's foreground's inheritance's stand)
 * and the absent's fill.
 */
export function contrastTextOf(fill: string | undefined, isDark: boolean): string | null {
  const effective = effectiveFillOf(fill, isDark);
  if (effective === undefined) return null;
  const parts = parseHexFill(effective);
  if (parts === null) return null;
  const luminance = relativeLuminance(parts.r, parts.g, parts.b);
  const ratioOverBlack = (luminance + 0.05) / 0.05;
  const ratioOverWhite = 1.05 / (luminance + 0.05);
  return ratioOverWhite >= ratioOverBlack ? "#ffffff" : "#000000";
}

export { parseHexFill, relativeLuminance, LUMINANCE_THRESHOLD, DARK_LIGHTNESS, DARK_SATURATION_SCALE };
