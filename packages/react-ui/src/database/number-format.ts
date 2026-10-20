/**
 * The number cell's display format (the deterministic, locale-free form).
 *
 * The format stands from the column's own display attributes: the digit
 * count after the point (`decimals`, default 0 = the integer stand — the
 * explicit `null` is the RAW stand: the float types without the explicit
 * digits stand the value as-is, never rounded), and the thousands'
 * separator (`thousands` — the space grouping: `1 000 000`). The
 * `prefix` / `suffix` stand frame the formatted number (the space join:
 * `AAA 555 222 BBB` — the frame is never glued to the digits). The value
 * itself is never rewritten — the cell commits the raw number, only the
 * stand is formatted.
 */

/** The display attributes the formatter reads (the `BridgeColumn`'s number fields). */
type NumberFormatAttrs = {
  /** The digit count after the point; the explicit `null` stands the raw value. */
  decimals?: number | null;
  thousands?: boolean;
  prefix?: string;
  suffix?: string;
};

/** The digit count after the point (the explicit `null` = the raw stand; the absent / invalid stand is 0; the cap is 10). */
function decimalsOf(attrs: NumberFormatAttrs): number | null {
  if (attrs.decimals === null) return null;
  const parsed = Math.trunc(Number(attrs.decimals));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(10, parsed));
}

/** The integer part's thousands grouping (the regular space every 3 digits). */
function groupThousands(part: string): string {
  return part.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Formats the number's display value. The rounding stands on
 * `toFixed` (the fixed digit count) — the raw stand (the explicit
 * `null` decimals) stands the value's own string. The negative stand
 * keeps the sign on the integer part, the numerically-zero negative
 * (`-0.4` at 0 decimals) stands the bare zero.
 */
function formatNumberValue(value: number, attrs: NumberFormatAttrs): string {
  const decimals = decimalsOf(attrs);
  const fixed = decimals === null ? String(Math.abs(value)) : Math.abs(value).toFixed(decimals);
  const [integer = "", fraction] = fixed.split(".");
  let formatted = attrs.thousands ? groupThousands(integer) : integer;
  if (fraction !== undefined) formatted += `.${fraction}`;
  // The rounding's negative zero: the sign is dropped (the value stands 0).
  if (formatted === "0" && value < 0) return `${frame(attrs.prefix)}0${frame(attrs.suffix, true)}`;
  const sign = value < 0 ? "-" : "";
  return `${frame(attrs.prefix)}${sign}${formatted}${frame(attrs.suffix, true)}`;
}

/** The frame's space join (the absent / empty frame stands bare). */
function frame(frameText: string | undefined, trailing = false): string {
  if (frameText === undefined || frameText === "") return "";
  return trailing ? ` ${frameText}` : `${frameText} `;
}

export { formatNumberValue };
export type { NumberFormatAttrs };
