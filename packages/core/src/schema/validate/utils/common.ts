/** The validator's shared value-shape checks (plain objects, the display
 *  form, the ISO 8601 / hex color / link href rules). */
import { isPlainObject } from "../../utils";
import { HEX_COLOR, ISO_8601, SCHEME_PREFIX, WEB_URL } from "../constants";

const show = (value: unknown): string => {
  if (value === undefined) return "missing";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular structures and BigInt are not JSON-stringifiable.
    return String(value);
  }
};

const isIso8601 = (value: unknown): boolean =>
  typeof value === "string" && ISO_8601.test(value) && !Number.isNaN(Date.parse(value));

const isHexColor = (value: unknown): boolean => typeof value === "string" && HEX_COLOR.test(value);

/** `http://` / `https://` URLs and relative paths; other schemes are rejected. */
const isLinkHref = (value: string): boolean => value.length > 0 && (WEB_URL.test(value) || !SCHEME_PREFIX.test(value));

export { isHexColor, isIso8601, isLinkHref, isPlainObject, show };
