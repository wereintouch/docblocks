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
const UNSAFE_DOWNLOAD_SCHEME = /^[\u0000-\u0020]*(javascript|vbscript)\s*:/i;

/**
 * The download href gate (the defense in depth over the consumer's BlobStore
 * url): the executable schemes stand no anchor; the `data:` / the `blob:` / the
 * http(s) urls stand (the default store's data urls, the consumer's CDN).
 * The browser's leading-control trim is undone before the scheme check (the
 * link href's stand).
 */
function isSafeDownloadHref(url: unknown): boolean {
  return typeof url === "string" && !UNSAFE_DOWNLOAD_SCHEME.test(url);
}

export { clamp, isSafeDownloadHref, preventDefault, stopPropagation };
