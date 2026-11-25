import { createMemoryBlobStore } from "docblocks-react-ui";
import type { BlobMeta, BlobRef, BlobStore } from "docblocks-react-ui";

/** The fixed image key the harness inserts; its src is a small inline SVG. */
const IMAGE_KEY = "demo-image";
/** The wide / tall fixtures the long-document seed cycles (the variable
 *  image heights — the windowing baseline's content). */
const IMAGE_WIDE_KEY = "demo-image-wide";
const IMAGE_TALL_KEY = "demo-image-tall";
/** The banner fixture: a very wide intrinsic ratio (the placeholder's box
 *  would outgrow the page column without a width clamp). */
const IMAGE_BANNER_KEY = "demo-image-banner";
/** The fixed generic attachment the catalog renders. */
const CATALOG_FILE_KEY = "demo-file";

/** Fixed file id -> the catalog image's bytes and metadata. */
const BLOB_REFS: Record<string, BlobRef> = {
  [IMAGE_KEY]: {
    blob: new Blob(
      [
        "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'><rect width='120' height='80' fill='#0969da'/></svg>",
      ],
      { type: "image/svg+xml" }
    ),
    meta: { name: "catalog.svg", mimeType: "image/svg+xml", width: 120, height: 80 },
  },
  [CATALOG_FILE_KEY]: {
    blob: new Blob(["Catalog attachment"], { type: "text/plain" }),
    meta: { name: "catalog.txt", mimeType: "text/plain" },
  },
  // The long-document seed's variable-height fixtures: the wide strip and
  // the tall poster (the placeholder's aspect reservation follows the same
  // metadata).
  [IMAGE_WIDE_KEY]: {
    blob: new Blob(
      [
        "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='120'><rect width='480' height='120' fill='#1a7f37'/></svg>",
      ],
      { type: "image/svg+xml" }
    ),
    meta: { name: "wide.svg", mimeType: "image/svg+xml", width: 480, height: 120 },
  },
  [IMAGE_TALL_KEY]: {
    blob: new Blob(
      [
        "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='240'><rect width='320' height='240' fill='#bc4c00'/></svg>",
      ],
      { type: "image/svg+xml" }
    ),
    meta: { name: "tall.svg", mimeType: "image/svg+xml", width: 320, height: 240 },
  },
  // The banner's intrinsic ratio is far wider than the page column (the
  // width clamp's fixture).
  [IMAGE_BANNER_KEY]: {
    blob: new Blob(
      [
        "<svg xmlns='http://www.w3.org/2000/svg' width='1132' height='43'><rect width='1132' height='43' fill='#8250df'/></svg>",
      ],
      { type: "image/svg+xml" }
    ),
    meta: { name: "banner.svg", mimeType: "image/svg+xml", width: 1132, height: 43 },
  },
};

/** The image keys the long-document seed cycles (the variable heights). */
const DEMO_IMAGE_KEYS = [IMAGE_KEY, IMAGE_WIDE_KEY, IMAGE_TALL_KEY] as const;

/** The cover preset's monochrome swatch (a solid SVG fill — the layout's
 *  evaluation's fixture; the preset's id stands over the BLOB_REFS's map so
 *  both panes resolve it). */
function coverPresetRef(id: string, color: string, width: number, height: number): BlobRef {
  return {
    blob: new Blob(
      [
        `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'><rect width='100%' height='100%' fill='${color}'/></svg>`,
      ],
      { type: "image/svg+xml" }
    ),
    meta: { name: `${id}.svg`, mimeType: "image/svg+xml" },
  };
}

/** The cover preset's catalog (the harness's ready-made covers over the
 *  consumer's `coverPresets`'s prop): the tile's set stands 14 monochrome
 *  swatches (the 12's visible's cap's overflow scroll's stand) + the alpha
 *  swatch (the PNG's alpha channel's stand — the under-cap's stand over
 *  the 15), and the centering's set stands 8 swatches + the alpha (the
 *  under-cap's stand over the 9). */
const COVER_PRESET_IDS = {
  tile: Array.from({ length: 14 }, (_, i) => `cover-tile-${i + 1}`),
  center: Array.from({ length: 8 }, (_, i) => `cover-center-${i + 1}`),
} as const;

/** The alpha swatch's cover (the PNG's alpha channel's demo — a vertical
 *  fade over the solid's fill: the opaque top stands the fill's stand,
 *  the transparent bottom stands the card's surface through (the theme's
 *  stand over the cover's alpha band)). The PNG is generated over the
 *  canvas (the real alpha channel's encode — no flattening) and cached as
 *  a promise (the first `get`'s resolution's stand). */
const ALPHA_COVER_ID = "cover-alpha-1";
let alphaPngRef: Promise<BlobRef> | null = null;
function alphaPng(): Promise<BlobRef> {
  if (alphaPngRef === null) {
    alphaPngRef = (async (): Promise<BlobRef> => {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("the canvas's 2d context is absent");
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "rgba(37, 99, 235, 1)");
      gradient.addColorStop(0.55, "rgba(37, 99, 235, 0.5)");
      gradient.addColorStop(0.85, "rgba(37, 99, 235, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob === null) throw new Error("the canvas's png's encode failed");
      return { blob, meta: { name: `${ALPHA_COVER_ID}.png`, mimeType: "image/png" } };
    })();
  }
  return alphaPngRef;
}
const COVER_PRESET_COLORS = [
  "#0ea5e9",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
];
for (const mode of ["tile", "center"] as const) {
  COVER_PRESET_IDS[mode].forEach((id, i) => {
    BLOB_REFS[id] = coverPresetRef(
      id,
      COVER_PRESET_COLORS[(i + (mode === "center" ? 3 : 0)) % COVER_PRESET_COLORS.length]!,
      1600,
      500
    );
  });
}

/** The consumer's cover preset gallery (the `coverPresets` prop's demo
 *  stand over the harness's fixed ids — a stable reference per module).
 *  The alpha's swatch stands the set's tail over both modes (the alpha's
 *  band's evaluation over the tile's strip's repeat + the centering's
 *  slice's stand). */
const coverPresets = {
  tile: [...COVER_PRESET_IDS.tile, ALPHA_COVER_ID],
  center: [...COVER_PRESET_IDS.center, ALPHA_COVER_ID],
};

/** The in-memory half of the harness's blob store (the slash Image uploads). */
const memoryBlobs = createMemoryBlobStore();

/** The harness's blob `get` calls, in order (the lazy loading's e2e probe:
 *  which file ids resolved). */
const blobGets: string[] = [];
if (typeof window !== "undefined") window.__blobGets = blobGets;

/** The fixed key's ref (the harness store's own-key read). */
function fixedRef(fileId: string): BlobRef | undefined {
  return Object.hasOwn(BLOB_REFS, fileId) ? BLOB_REFS[fileId] : undefined;
}

/**
 * The harness's blob store: the fixed keys above (the catalog image),
 * then the in-memory uploads (one per page — the A/B panes share it). The
 * metadata's lookup (`getMeta`) is wired so the blocks stand the
 * placeholder's reserved aspect ratio; the `get` calls land in
 * `window.__blobGets` for the lazy loading's e2e probes.
 */
const blobStore: BlobStore = {
  get: async (fileId): Promise<BlobRef> => {
    blobGets.push(fileId);
    if (fileId === ALPHA_COVER_ID) return alphaPng();
    return fixedRef(fileId) ?? memoryBlobs.get(fileId);
  },
  getMeta: async (fileId): Promise<BlobMeta> => {
    if (fileId === ALPHA_COVER_ID) return (await alphaPng()).meta;
    const fixed = fixedRef(fileId);
    if (fixed !== undefined) return fixed.meta;
    return (await memoryBlobs.get(fileId)).meta;
  },
  upload: (file) => memoryBlobs.upload(file),
  rename: (fileId, name) => memoryBlobs.rename(fileId, name),
  subscribe: (fileId, onChange) => memoryBlobs.subscribe(fileId, onChange),
  remove: (fileId) => memoryBlobs.remove?.(fileId) ?? Promise.resolve(),
};

export { blobStore, CATALOG_FILE_KEY, DEMO_IMAGE_KEYS, IMAGE_BANNER_KEY, IMAGE_KEY, coverPresets };
