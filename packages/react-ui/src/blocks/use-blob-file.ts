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
 * The file's resolution state over the blob store: `loading` over the
 * in-flight get (the block's placeholder stands its spinner), `missing`
 * over a rejected get (the id stands no blob in this store — the
 * cross-pane key's stand), and `ready` with the object URL over the
 * resolved ref (the store change's re-fetch keeps the previous view, so a
 * rename's stand is the in-place update, not the placeholder's flicker).
 */
type BlobFileState = { status: "loading" } | { status: "missing" } | ({ status: "ready" } & BlobView);

/** Resolve a file id and keep an object URL synchronized with store changes. */
function useBlobFile(fileId: string): BlobFileState {
  const { blobStore } = useEditorContext();
  const [ref, setRef] = useState<BlobRef | null>(null);
  /** The get's rejection (the missing stand) — a resolve clears it. */
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<BlobView | null>(null);

  useEffect(() => {
    let alive = true;
    let sequence = 0;
    setRef(null);
    setFailed(false);

    const load = async (): Promise<void> => {
      const request = ++sequence;
      try {
        const next = await blobStore.get(fileId);
        if (alive && request === sequence) {
          setRef(next);
          setFailed(false);
        }
      } catch {
        if (alive && request === sequence) {
          setRef(null);
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
  }, [blobStore, fileId]);

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
  if (failed) return { status: "missing" };
  return { status: "loading" };
}

export { useBlobFile };
export type { BlobFileState, BlobView };
