import { useEffect, useState } from "react";

import type { BlobMeta, BlobRef } from "../blob-store";
import { useEditorContext } from "../editor-provider";

/**
 * The resolved file view: the blob, its authoritative metadata, and the
 * library-owned object URL.
 */
interface BlobView {
  blob: Blob;
  meta: BlobMeta;
  url: string;
}

/**
 * The meta-only view: the authoritative metadata with the store's download
 * URL as the href — the bytes were never fetched (no object URL stands).
 */
interface BlobMetaView {
  meta: BlobMeta;
  /** The download's href (the store's `downloadUrl`). */
  url: string;
}

/**
 * The file's resolution state over the blob store: `loading` over the
 * in-flight resolution (the block's placeholder stands its spinner),
 * `missing` over a rejected resolution (the id stands no blob in this
 * store — the cross-pane key's stand), `ready` with the object URL over
 * the resolved ref (the store change's re-fetch keeps the previous view,
 * so a rename's stand is the in-place update, not the placeholder's
 * flicker), and `ready-meta` over the meta-only stand (the store's
 * `getMeta` + `downloadUrl` — no bytes, no object URL).
 */
type BlobFileState =
  | { status: "loading" }
  | { status: "missing" }
  | ({ status: "ready" } & BlobView)
  | ({ status: "ready-meta" } & BlobMetaView);

/**
 * Resolve a file id and keep the object URL synchronized with store
 * changes. The meta's stand (the store's opt-in): with a `getMeta` member
 * the resolution fetches the metadata first (no body transfer) and stands
 * the meta-only view over a MIME the block does not render (the predicate)
 * when the store supplies a `downloadUrl`; the renderable MIME (and the
 * `downloadUrl`'s absent fallback) resolve the bytes over `get` as before.
 * Without `getMeta` the resolution stands exactly the legacy path (the
 * bytes over `get`).
 */
function useBlobFile(fileId: string, rendersBytes?: (mimeType: string) => boolean): BlobFileState {
  const { blobStore } = useEditorContext();
  const [ref, setRef] = useState<BlobRef | null>(null);
  const [metaView, setMetaView] = useState<BlobMetaView | null>(null);
  /** The resolution's rejection (the missing stand) — a resolve clears it. */
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<BlobView | null>(null);

  useEffect(() => {
    let alive = true;
    let sequence = 0;
    setRef(null);
    setMetaView(null);
    setFailed(false);

    const load = async (): Promise<void> => {
      const request = ++sequence;
      try {
        // The meta's stand (the store's opt-in): the lightweight metadata's
        // lookup over the body's transfer — the meta-only view stands when
        // the MIME is not the block's renderable one and the store supplies
        // the download's URL (otherwise the bytes' path stands).
        if (blobStore.getMeta !== undefined) {
          const meta = await blobStore.getMeta(fileId);
          if (alive && request === sequence) {
            const downloadUrl = blobStore.downloadUrl;
            if (downloadUrl !== undefined && rendersBytes !== undefined && !rendersBytes(meta.mimeType)) {
              setRef(null);
              setMetaView({ meta, url: downloadUrl(fileId) });
              setFailed(false);
              return;
            }
          } else {
            return;
          }
        }
        const next = await blobStore.get(fileId);
        if (alive && request === sequence) {
          setRef(next);
          setMetaView(null);
          setFailed(false);
        }
      } catch {
        // The read's failure stands the failed card (the consumer's
        // notice) over a stale load's late stand — never a thrown render.
        if (alive && request === sequence) {
          setRef(null);
          setMetaView(null);
          setFailed(true);
        }
      }
    };
    const unsubscribe = blobStore.subscribe(fileId, () => {
      void load();
    });
    void load();

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [blobStore, fileId, rendersBytes]);

  useEffect(() => {
    if (ref === null) {
      setView(null);
      return;
    }
    const url = URL.createObjectURL(ref.blob);
    setView({ ...ref, url });
    return () => URL.revokeObjectURL(url);
  }, [ref]);

  if (view !== null) return { status: "ready", ...view };
  if (metaView !== null) return { status: "ready-meta", ...metaView };
  if (failed) return { status: "missing" };
  return { status: "loading" };
}

export { useBlobFile };
export type { BlobFileState, BlobMetaView, BlobView };
