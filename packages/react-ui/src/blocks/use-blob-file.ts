import { useEffect, useState } from "react";

import type { BlobMeta, BlobRef } from "../blob-store";
import { useEditorContext } from "../editor-provider";

interface BlobView {
  blob: Blob;
  meta: BlobMeta;
  url: string;
}

/** Resolve a file id and keep an object URL synchronized with store changes. */
function useBlobFile(fileId: string): BlobView | null {
  const { blobStore } = useEditorContext();
  const [ref, setRef] = useState<BlobRef | null>(null);
  const [view, setView] = useState<BlobView | null>(null);

  useEffect(() => {
    let alive = true;
    let sequence = 0;
    setRef(null);

    const load = async (): Promise<void> => {
      const request = ++sequence;
      try {
        const next = await blobStore.get(fileId);
        if (alive && request === sequence) setRef(next);
      } catch {
        if (alive && request === sequence) setRef(null);
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

  return view;
}

export { useBlobFile };
