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
 *  rejected. The check runs over the browser's normalization of the input:
 *  the WHATWG URL parser removes ASCII tab / LF / CR (U+0009–U+000D) from
 *  ANY position and trims the leading / trailing C0 controls and spaces
 *  (U+0000–U+0020) before the scheme detection — so an unnormalized check
 *  stands the `"java\tscript:…"` bypass (the raw string carries no scheme
 *  per the `^[a-z][a-z0-9+.-]*:` test, the browser's does). */
// eslint-disable-next-line no-control-regex -- the C0 range is the check's subject.
const CONTROL_TRIM = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;
// eslint-disable-next-line no-control-regex -- the mid-string strip is the check's subject.
const MID_STRING_CONTROLS = /[\u0009\u000A\u000D]/g;

/** The public link-href contract (the validator's and the consumer
 *  renderer's gate): the normalized form is an http/https URL or a
 *  scheme-less (relative) path; any other scheme is rejected. */
const isSafeLinkHref = (value: string): boolean => {
  const trimmed = value.replace(MID_STRING_CONTROLS, "").replace(CONTROL_TRIM, "");
  return trimmed.length > 0 && (WEB_URL.test(trimmed) || !SCHEME_PREFIX.test(trimmed));
};

const isLinkHref = (value: string): boolean => isSafeLinkHref(value);

/** The embed's URL kinds stand the absolute http/https paths only. */
const EMBED_URL_SCHEME = /^https?:\/\/.+$/i;
/** The `html` kind's own data URL (the HTML snippet — the kind's purpose). */
const EMBED_HTML_DATA_URL = /^data:text\/html(;base64)?,.+$/i;

/**
 * The embed's `src` against the kind (the write posture): the URL kinds
 * (iframe / github / figma / loom) stand the absolute http/https paths only;
 * the `html` kind stands the `data:text/html` snippet additionally (its
 * purpose). The `javascript:` / the foreign `data:` URLs are rejected — the
 * consumer's `allow-same-origin` + `allow-scripts` grant (the trusted-origin
 * policy) would run a `javascript:` src in the parent's origin, and the
 * crafted page stands the phishing surface inside the editor's frame. The
 * browser's leading-control trim is undone before the scheme check (the same
 * stand as the link href). The lenient reader keeps the unsafe value as data
 * (the persistence DoS stand); the renderer gates it (the placeholder).
 */
const isSafeEmbedSrc = (kind: unknown, src: unknown): boolean => {
  if (typeof src !== "string" || src.length === 0) return false;
  const trimmed = src.replace(CONTROL_TRIM, "");
  if (EMBED_URL_SCHEME.test(trimmed)) return true;
  return kind === "html" && EMBED_HTML_DATA_URL.test(trimmed);
};

export { isHexColor, isIso8601, isLinkHref, isSafeEmbedSrc, isSafeLinkHref, isPlainObject, show };
