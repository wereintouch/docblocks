/** The validator's shared value-shape checks (plain objects, the display
 *  form, the ISO 8601 / hex color / link href rules). */
import { ATTRIBUTE_TYPES } from "../../constants";
import type { AttributeType, DocAttributeValue, MentionRef, TypedAttributeValue } from "../../types";
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

/** A mention reference (the preset user attribute's id-only form): a plain
 *  object with the non-empty `id` string field; the legacy `label` snapshot
 *  (the pre-id-only's data) stands tolerated (any string). */
const isMentionRef = (value: unknown): value is MentionRef => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id === "") return false;
  if (Object.keys(record).length === 1) return true;
  return Object.keys(record).length === 2 && typeof record.label === "string";
};

/** A typed attribute value (the custom attribute's storage form): exactly
 *  the `type` (a known `AttributeType`) + the `value` over that type's
 *  form. */
const isTypedAttributeValue = (value: unknown): value is TypedAttributeValue => {
  if (!isPlainObject(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) return false;
  const type = record.type;
  if (typeof type !== "string" || !(ATTRIBUTE_TYPES as readonly string[]).includes(type)) return false;
  const v = record.value;
  switch (type as AttributeType) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "list":
      return Array.isArray(v) && v.every((element) => typeof element === "string");
    case "mention":
      return isMentionRef(v);
  }
  return false;
};

/** A document attribute's value (the `DocMeta.attributes` contract):
 *  a string, a finite number, a boolean, an array of strings, a mention
 *  reference (the id-only stand; the legacy label is tolerated), or the
 *  typed value (the custom attribute's storage form). */
const isDocAttributeValue = (value: unknown): value is DocAttributeValue => {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => typeof element === "string");
  if (isTypedAttributeValue(value)) return true;
  return isMentionRef(value);
};

/** `http://` / `https://` URLs, the `mailto:` / `tel:` links, and relative
 *  paths; other schemes are rejected. The check runs over the browser's
 *  normalization of the input: the WHATWG URL parser removes ASCII tab / LF
 *  / CR (U+0009–U+000D) from ANY position and trims the leading / trailing C0
 *  controls and spaces (U+0000–U+0020) before the scheme detection — so an
 *  unnormalized check stands the `"java\tscript:…"` bypass (the raw string
 *  carries no scheme per the `^[a-z][a-z0-9+.-]*:` test, the browser's does). */
// eslint-disable-next-line no-control-regex -- the C0 range is the check's subject.
const CONTROL_TRIM = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;
// eslint-disable-next-line no-control-regex -- the mid-string strip is the check's subject.
const MID_STRING_CONTROLS = /[\u0009\u000A\u000D]/g;

/** The `mailto:` payload (the email's stand): the `local@domain` form — a
 *  non-empty local part without whitespace / `@`, a domain carrying a dot.
 *  The gate is the shape's check (the safety's stand), not the registry's
 *  validation — a degenerate TLD is a dead mailto, not a risk. */
const MAILTO_RE = /^mailto:[^\s@]+@[^\s@]*\.[^\s@]+$/i;
/** The `tel:` payload (the phone number's stand): 5–30 characters of digits
 *  and the phone separators (`+`, `()`, `-`, `'`, `.`, `,`, the space),
 *  starting with a digit or `+`. */
const TEL_RE = /^tel:[0-9+][0-9()'. ,+-]{4,29}$/i;
/** The minimum digit count of the `tel:` payload (the phone number's stand —
 *  the separators alone are not a number). */
const TEL_MIN_DIGITS = 5;

/** The link-href's class over the public contract: the web's URL, the
 *  `mailto:`'s email, the `tel:`'s phone, the scheme-less (relative) path.
 *  The classifier `linkHrefKindOf` is the single stand; `null` over any
 *  other scheme (the rejection's stand). */
type LinkHrefKind = "web" | "mailto" | "tel" | "relative";

/** The link-href's class over the public contract (the normalized form —
 *  the browser's C0 / space normalization: the mid-string strip + the
 *  leading / trailing trim over the WHATWG URL parser's pipeline): the
 *  web's URL, the `mailto:`'s email, the `tel:`'s phone, the scheme-less
 *  (relative) path — or `null` over any other scheme (the rejection's
 *  stand). */
const linkHrefKindOf = (value: string): LinkHrefKind | null => {
  const trimmed = value.replace(MID_STRING_CONTROLS, "").replace(CONTROL_TRIM, "");
  if (trimmed.length === 0) return null;
  if (WEB_URL.test(trimmed)) return "web";
  if (MAILTO_RE.test(trimmed)) return "mailto";
  if (TEL_RE.test(trimmed) && (trimmed.match(/\d/g) ?? []).length >= TEL_MIN_DIGITS) return "tel";
  if (!SCHEME_PREFIX.test(trimmed)) return "relative";
  return null;
};

/** The public link-href contract (the validator's and the consumer
 *  renderer's gate): the normalized form is an http/https URL, a `mailto:`
 *  email, a `tel:` phone number, or a scheme-less (relative) path; any
 *  other scheme is rejected. */
const isSafeLinkHref = (value: string): boolean => linkHrefKindOf(value) !== null;

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

export {
  isDocAttributeValue,
  isHexColor,
  isIso8601,
  isLinkHref,
  isSafeEmbedSrc,
  isSafeLinkHref,
  isPlainObject,
  linkHrefKindOf,
  show,
};
export type { LinkHrefKind };
