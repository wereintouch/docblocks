/** The pdfjs-dist worker wiring (the side-effect): the worker file is
 * copied next to this entry at build time (dist/pdf/), so the relative
 * reference resolves in the consumer's browser with no bundler asset
 * handling (the dist is served as static ESM). The path is composed at
 * runtime so the bundler leaves the new URL untouched.
 *
 * The JBIG2 decoder (the wasm module + the no-wasm js fallback) is copied
 * next to the worker at build time and loaded by the worker from this
 * base url — pdfjs resolves `${wasmUrl}jbig2.wasm`, so the worker's
 * directory is the base. Derived from the worker URL object (not
 * import.meta.url) so a bundler's `new URL(_, import.meta.url)` asset
 * rewrite cannot mangle the directory form. Scanned PDFs encode their
 * text layers as JBIG2; without a resolvable wasmUrl the worker fails to
 * initialize those layers and the page renders as a bare background image
 * (the text is dropped). */
import { GlobalWorkerOptions } from "pdfjs-dist";

const WORKER_FILE = "pdf.worker.min.mjs";
const WORKER_URL = new URL(`./${WORKER_FILE}`, import.meta.url);
GlobalWorkerOptions.workerSrc = WORKER_URL.toString();

const WASM_URL = new URL("./", WORKER_URL).toString();

export { WASM_URL };
