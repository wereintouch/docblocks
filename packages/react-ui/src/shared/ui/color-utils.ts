/** Color helpers for the shared palette primitive. The palette entries are
 * theme tokens (`var(--…)`) or hex; the document data (a mark value, a block
 * attr) must hold a concrete hex, so a selection resolves the entry to a hex
 * through the computed style. Hex entries pass through; a var / CSS color is
 * read off the element that carries it (the swatch) or a detached probe, then
 * converted to a hex. The conversion is canvas-based (the computed style may
 * serialize a modern color — `oklch(…)`, `lab(…)`, `color(srgb …)` — as
 * itself, which a plain `rgb()` parse would drop).
 */

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\s*\)$/;

/** Normalize a hex color to a lowercase `#rrggbb(aa)` form (null if it is not a hex). */
function normalizeHex(raw: string): string | null {
  const match = raw.trim().match(HEX_RE);
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

/** Convert a computed `rgb()` / `rgba()` color to a hex (null if unparseable). */
function rgbToHex(value: string): string | null {
  const match = value.trim().match(RGB_RE);
  if (match === null) return null;
  const toPair = (n: string) => Number(n).toString(16).padStart(2, "0");
  const hex = `#${toPair(match[1]!)}${toPair(match[2]!)}${toPair(match[3]!)}`;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha >= 1) return hex;
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/**
 * Convert any CSS color the browser can resolve (a hex, `rgb(…)`, `hsl(…)`,
 * `oklch(…)`, `lab(…)`, `color(srgb …)`, a named color) to a hex. A
 * `rgb()` / `rgba()` string converts directly; anything else round-trips
 * through a canvas's 2D context (its `fillStyle` + a 1px read give the exact
 * sRGB the browser uses to paint). Null when the value is not a resolvable
 * color or the canvas 2D context is unavailable (a non-DOM test environment).
 */
function colorToHex(value: string): string | null {
  const fromRgb = rgbToHex(value);
  if (fromRgb !== null) return fromRgb;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  const toPair = (n: number) => Number(n).toString(16).padStart(2, "0");
  const hex = `#${toPair(data[0]!)}${toPair(data[1]!)}${toPair(data[2]!)}`;
  const alpha = Number(data[3]);
  if (alpha >= 255) return hex;
  return `${hex}${toPair(alpha)}`;
}

/**
 * Resolve a palette entry (a hex or a CSS color / `var(…)` ) to a hex, for
 * the commit. A hex passes through (normalized); anything else is read off
 * the element's computed background — the element that carries the entry
 * (the swatch) when given, else a detached probe appended to the body (so the
 * `:root` / `.dark` tokens resolve against the active theme) — then converted
 * through {@link colorToHex}.
 */
function resolveColorToHex(entry: string, refEl?: HTMLElement | null): string | null {
  const normalized = normalizeHex(entry);
  if (normalized !== null) return normalized;
  const owned = refEl === undefined;
  const el = refEl ?? probeFor(entry);
  if (owned) document.body.appendChild(el);
  try {
    return colorToHex(getComputedStyle(el).backgroundColor);
  } finally {
    if (owned) el.remove();
  }
}

/** A detached probe that carries the entry as its background. */
function probeFor(entry: string): HTMLElement {
  const el = document.createElement("span");
  el.style.background = entry;
  el.setAttribute("aria-hidden", "true");
  return el;
}

export { colorToHex, normalizeHex, resolveColorToHex, rgbToHex };
