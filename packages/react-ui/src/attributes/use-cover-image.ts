/**
 * The cover's resolved image over the editor's blob store: the renderable
 * url, where it came from, and — on demand — the intrinsic dimensions. The
 * cover renders the store's own `downloadUrl` when it supplies one (the
 * browser's cacheable subrequest, as the image block does), the fetched
 * bytes' object URL otherwise.
 */
import { useEffect, useState } from "react";

import { useBlobFile } from "../blocks/use-blob-file";
import type { BlobFileState } from "../blocks/use-blob-file";
import { COVER_RENDERS_IMAGE, readImageDimensions, readUrlDimensions } from "./cover";
import type { ImageDimensions } from "./cover";

/** The url's origin: the store's own `downloadUrl` (natively cacheable) or
 *  the library's object URL over the fetched bytes. */
type CoverImageSource = "bytes" | "url";

/** The cover's resolved stand. */
interface CoverImage {
  /** `ready` over a renderable image, `unrenderable` over a resolved
   *  non-image payload (the store served what the cover cannot show),
   *  `loading` / `missing` over the pending / rejected resolution. */
  status: "loading" | "missing" | "unrenderable" | "ready";
  /** The renderable url — `null` over every non-`ready` stand. */
  url: string | null;
  source: CoverImageSource | null;
  /** The intrinsic dimensions: `null` until the probe settles, over an
   *  undecodable payload, and over every unmeasured stand. */
  dimensions: ImageDimensions | null;
}

interface CoverImageOptions {
  /** The eager resolution: the cover is the above-the-fold decoration, so
   *  the measure's band gate stands off. */
  eager?: boolean;
  /** The intrinsic dimensions' probe: off by default — the probe decodes
   *  the whole image, and only the centering slice and the mode switch's
   *  gate read it. */
  measure?: boolean;
}

/** The status over the blob file's resolution state. */
function coverStatusOf(state: BlobFileState): CoverImage["status"] {
  switch (state.status) {
    case "loading":
    case "missing":
      return state.status;
    case "ready":
    case "ready-url":
      return "ready";
    case "ready-meta":
      return "unrenderable";
  }
}

/**
 * The intrinsic dimensions over the resolved stand: the bytes' own decode
 * probe over the blob, or the browser's decode of the rendered url (the
 * store's direct URL — its own cache serves the payload).
 */
function useImageDimensions(blob: Blob | null, url: string | null, measure: boolean): ImageDimensions | null {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);

  useEffect(() => {
    if (!measure || url === null) {
      setDimensions(null);
      return;
    }
    let alive = true;
    const probe = blob === null ? readUrlDimensions(url) : readImageDimensions(blob);
    void probe.then((next) => {
      if (alive) setDimensions(next);
    });
    return () => {
      alive = false;
    };
  }, [blob, url, measure]);

  return dimensions;
}

/**
 * The stored cover's image: the blob store's resolution (the metadata's head
 * lookup decides the renderable MIME and the store's direct URL's stand), and
 * the intrinsic dimensions over the requested measure.
 */
function useCoverImage(fileId: string, options: CoverImageOptions = {}): CoverImage {
  const { state } = useBlobFile(fileId, COVER_RENDERS_IMAGE, {
    eager: options.eager,
    rendersFromUrl: COVER_RENDERS_IMAGE,
  });
  const blob = state.status === "ready" ? state.blob : null;
  const url = state.status === "ready" || state.status === "ready-url" ? state.url : null;
  const source: CoverImageSource | null =
    state.status === "ready" ? "bytes" : state.status === "ready-url" ? "url" : null;
  const dimensions = useImageDimensions(blob, url, options.measure === true);
  return { status: coverStatusOf(state), url, source, dimensions };
}

export { useCoverImage };
export type { CoverImage, CoverImageOptions, CoverImageSource };
