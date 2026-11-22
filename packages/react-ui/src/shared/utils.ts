import { UnhandledValueError } from "./errors";

/** Clamps a value into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The DOM event's default-cancelling handler (the chrome's press stand). */
function preventDefault(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/** The DOM event's propagation-stopping handler (the inner chrome's press
 * stands over the outer gesture). */
function stopPropagation(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

/** The executable schemes a download href must not carry (a `javascript:` / `vbscript:` href runs on the click — the `download` attribute does not neutralize it). */
// eslint-disable-next-line no-control-regex -- the C0 prefix is the scheme-detection bypass subject.
const UNSAFE_DOWNLOAD_SCHEME = /^[\u0000-\u0020]*(javascript|vbscript)\s*:/i;
// The browser's WHATWG URL normalization (the link href's parity — the core's
// `linkHrefKindOf` stand): the parser removes U+0009/U+000A/U+000D from ANY
// position and trims the leading / trailing C0 controls and spaces before the
// scheme detection — an unnormalized test stands the `"java\nscript:…"` bypass
// (the raw string passes a leading-only strip, the browser's resolved scheme
// is `javascript:`).
// eslint-disable-next-line no-control-regex -- the C0 range is the check's subject.
const DOWNLOAD_CONTROL_TRIM = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;
// eslint-disable-next-line no-control-regex -- the mid-string strip is the check's subject.
const DOWNLOAD_MID_STRING_CONTROLS = /[\u0009\u000A\u000D]/g;

/**
 * The download href gate (the defense in depth over the consumer's BlobStore
 * url): the executable schemes stand no anchor; the `data:` / the `blob:` / the
 * http(s) urls stand (the default store's data urls, the consumer's CDN).
 * The browser's normalization (the mid-string strip + the leading / trailing
 * C0 / space trim) is undone before the scheme check (the link href's stand).
 */
function isSafeDownloadHref(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const normalized = url.replace(DOWNLOAD_MID_STRING_CONTROLS, "").replace(DOWNLOAD_CONTROL_TRIM, "");
  return !UNSAFE_DOWNLOAD_SCHEME.test(normalized);
}

/**
 * The exhaustiveness check for a `switch` over a closed union: `value` is
 * typed `never`, so once every member has a `case` the compiler narrows it
 * to `never` in the `default` and the call type-checks; a member without a
 * `case` fails the build. The throw is the runtime backstop for a value that
 * slipped past the types.
 */
function assertNever(value: never): never {
  throw new UnhandledValueError(`Unhandled value: ${String(value)}`);
}

export { assertNever, clamp, isSafeDownloadHref, preventDefault, stopPropagation };
