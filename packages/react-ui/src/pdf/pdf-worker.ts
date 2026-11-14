/** The pdfjs worker and decoder assets use static package references so
 * consumer bundlers can emit them. The decoder factory fetches the concrete
 * emitted asset URL because a bundler may hash its filename. */
import { GlobalWorkerOptions } from "pdfjs-dist";

const WORKER_URL = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
const JBIG2_URL = new URL("pdfjs-dist/wasm/jbig2.wasm", import.meta.url);
const WASM_URL = new URL("./", JBIG2_URL).toString();

GlobalWorkerOptions.workerSrc = WORKER_URL.toString();

type BinaryDataKind = "cMapUrl" | "standardFontDataUrl" | "wasmUrl";

interface BinaryDataOptions {
  cMapUrl?: string | null;
  standardFontDataUrl?: string | null;
  wasmUrl?: string | null;
}

interface BinaryDataRequest {
  kind: BinaryDataKind;
  filename: string;
}

async function fetchBytes(url: URL | string): Promise<Uint8Array> {
  const response = await globalThis.fetch(url);
  if (!response.ok) throw new URIError(`Unable to load PDF asset: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Main-thread asset loader with an exact URL for the emitted JBIG2 module. */
class PdfBinaryDataFactory {
  private readonly bases: Record<BinaryDataKind, string | null>;

  constructor(options: BinaryDataOptions) {
    this.bases = {
      cMapUrl: options.cMapUrl ?? null,
      standardFontDataUrl: options.standardFontDataUrl ?? null,
      wasmUrl: options.wasmUrl ?? null,
    };
  }

  async fetch({ kind, filename }: BinaryDataRequest): Promise<Uint8Array> {
    if (kind === "wasmUrl" && filename === "jbig2.wasm") return fetchBytes(JBIG2_URL);
    const base = this.bases[kind];
    if (base === null) throw new URIError(`The ${kind} API parameter is required for ${filename}`);
    return fetchBytes(`${base}${filename}`);
  }
}

// The degradation's stand: the worker file must be emitted with the consumer
// bundle. An unreachable asset degrades the preview to the native viewer.
if (typeof window !== "undefined") {
  fetch(WORKER_URL, { method: "HEAD" }).catch(() => {
    console.warn("docblocks: the pdf worker asset is unreachable; the preview will use the native viewer fallback.");
  });
}

export { PdfBinaryDataFactory, WASM_URL };
