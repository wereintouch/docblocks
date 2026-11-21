/** The PDF viewer iframe's safety contract: the strict sandbox + the
 * embeddable-url gate. A compromised or misconfigured blob store that
 * returns a document in place of a PDF must not reach the parent's origin
 * (the hostile-store posture) — the frame stands an opaque origin and no
 * scripts, and the non-embeddable schemes stand the download-only
 * fallback. */

/** The PDF viewer's strict sandbox: no `allow-same-origin` (the frame
 * stands an opaque origin — it cannot read the parent's DOM, cookies, or
 * state) and no `allow-scripts` (a hostile HTML document standing in place
 * of the PDF executes nothing). The native PDF viewer renders the document
 * without web scripts (Chromium's PDFium plugin); a script-based viewer
 * stands no stand over the frame — the download card stands the fallback. */
const PDF_VIEWER_SANDBOX = "";

/** The fullscreen zoom's bounds + the per-click step: the scale's units
 * are the css px per pdf point (the device pixel ratio stands the backing
 * store's scale, not this factor). */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

/** The iframe's embeddable-url gate: http(s) and the library-owned blob URL
 * may stand the viewer's iframe. Data / javascript schemes and unparseable
 * URLs stand the download-only fallback. */
function isEmbeddablePdfUrl(url: string): boolean {
  try {
    const scheme = new URL(url).protocol;
    return scheme === "http:" || scheme === "https:" || scheme === "blob:";
  } catch {
    return false;
  }
}

export { isEmbeddablePdfUrl, PDF_VIEWER_SANDBOX, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP };
