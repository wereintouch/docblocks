/** The canvas viewport's browser persistence : the per-document zoom / pan in localStorage — the map
 *  docId -> { zoom, pan }. A non-browser / unavailable / corrupted
 *  storage stands the read's null (the fit's fallback) and the write's
 *  no-op. Pure view state — the doc's own data stands untouched. */
import { MAX_ZOOM, MIN_ZOOM } from "../viewport";
import type { ScreenPoint } from "../viewport";

// The storage's key (the versioned map's name).
const STORAGE_KEY = "docblocks.canvas-viewport.v1";

// The debounce's window: the zoom / pan's commit moment (the wheel's / the
// pan's / the fit's last stand) coalesces over the trailing edge.
const WRITE_DEBOUNCE_MS = 300;

/** The viewport's persisted shape (the storage's value per document). */
interface PersistedViewport {
  zoom: number;
  pan: ScreenPoint;
}

/** The storage's guard (the non-browser / the missing API stands none). */
function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The storage's map (the missing / the corrupted entry stands empty). */
function readMap(): Record<string, PersistedViewport> {
  const store = storage();
  if (store === null) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, PersistedViewport>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, PersistedViewport>): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // A full / a locked storage: the persistence stands (the read is
    // unaffected).
  }
}

function isPersistedViewport(value: unknown): value is PersistedViewport {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.zoom !== "number" || !Number.isFinite(candidate.zoom)) return false;
  const pan = candidate.pan;
  if (pan === null || typeof pan !== "object") return false;
  const panRecord = pan as Record<string, unknown>;
  return (
    typeof panRecord.x === "number" &&
    Number.isFinite(panRecord.x) &&
    typeof panRecord.y === "number" &&
    Number.isFinite(panRecord.y)
  );
}

// The zoom's clamp (the 25%–400% bounds): a corrupted / an out-of-bounds
// stored zoom stands the bound, not the raw value.
function clampZoom(zoom: number): number {
  return Number(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)).toFixed(4));
}

/**
 * The document's stored viewport (the zoom clamped to the bounds) or null
 * (the missing / the corrupted entry — the fit's fallback).
 */
function readCanvasViewport(docId: string): PersistedViewport | null {
  const stored = readMap()[docId];
  if (stored === undefined || !isPersistedViewport(stored)) return null;
  return { zoom: clampZoom(stored.zoom), pan: { x: stored.pan.x, y: stored.pan.y } };
}

/** The document's stored viewport's write (the map's one entry). */
function writeCanvasViewport(docId: string, viewport: PersistedViewport): void {
  const map = readMap();
  map[docId] = { zoom: clampZoom(viewport.zoom), pan: { x: viewport.pan.x, y: viewport.pan.y } };
  writeMap(map);
}

export type { PersistedViewport };
export { readCanvasViewport, writeCanvasViewport, WRITE_DEBOUNCE_MS };
