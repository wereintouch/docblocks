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

/** `http://` / `https://` URLs and relative paths; other schemes are
 *  rejected. The check runs over the trimmed form — the browser trims the
 *  leading / trailing C0 controls and spaces (U+0000–U+0020) before the
 *  scheme detection, so an untrimmed check stands the `"\tjavascript:…"`
 *  bypass (the raw string carries no scheme, the browser's does). */
const CONTROL_TRIM = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;

/** The public link-href contract (the validator's and the consumer
 *  renderer's gate): the trimmed form is an http/https URL or a
 *  scheme-less (relative) path; any other scheme is rejected. */
const isSafeLinkHref = (value: string): boolean => {
  const trimmed = value.replace(CONTROL_TRIM, "");
  return trimmed.length > 0 && (WEB_URL.test(trimmed) || !SCHEME_PREFIX.test(trimmed));
};

const isLinkHref = (value: string): boolean => isSafeLinkHref(value);

export { isHexColor, isIso8601, isLinkHref, isSafeLinkHref, isPlainObject, show };
