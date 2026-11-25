import { useEffect, useRef, useState } from "react";

import type { BlobMeta, BlobRef } from "../blob-store";
import { useEditorContext } from "../editor-provider";
import { useInView } from "../shared/hooks/use-in-view";
import { isSafeDownloadHref } from "../shared/utils";

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
 * The store-URL view: the authoritative metadata with the store's direct
 * URL (`downloadUrl`) — the bytes never enter the JS heap and no object URL
 * stands. The URL serves either the non-renderable payload's download card
 * (`ready-meta`) or a renderable image's `src` (`ready-url` — the browser's
 * own cacheable subrequest; a payload fetched into an object URL never
 * reuses the native cache on WebKit).
 */
interface BlobUrlView {
  meta: BlobMeta;
  /** The download's href (the `ready-meta` card) or the image's src (the
   *  `ready-url` stand) — the store's `downloadUrl`. */
  url: string;
}

/**
 * The file's resolution state over the blob store: `loading` over the
 * unresolved stand (the block's placeholder stands its spinner) with the
 * metadata the cheap head's lookup already returned (the placeholder's
 * aspect-ratio reservation reads it), `missing` over a rejected resolution
 * (the id stands no blob in this store — the cross-pane key's stand),
 * `ready` with the object URL over the resolved ref (the store change's
 * re-fetch keeps the previous view, so a rename's stand is the in-place
 * update, not the placeholder's flicker), `ready-meta` over the meta-only
 * stand (the store's `getMeta` + `downloadUrl` — no bytes, no object URL),
 * and `ready-url` over the direct-URL stand (a renderable image the store's
 * `downloadUrl` serves itself — the bytes' fetch is the browser's).
 */
type BlobFileState =
  | { status: "loading"; meta: BlobMeta | null }
  | { status: "missing" }
  | ({ status: "ready" } & BlobView)
  | ({ status: "ready-meta" } & BlobUrlView)
  | ({ status: "ready-url" } & BlobUrlView);

/** The store-URL view's resolved state (the card's href or the image's src). */
type BlobUrlState = Extract<BlobFileState, { status: "ready-meta" | "ready-url" }>;

interface BlobFileOptions {
  /** The eager stand: the bytes resolve at mount over the viewport gate's
   *  absence (the cover, the consumer's own gallery). */
  eager?: boolean;
  /** The MIME predicate for the store's direct-URL stand: a `true` over a
   *  store that supplies `downloadUrl` renders the block from that URL (the
   *  browser's own cacheable subrequest) instead of fetching the bytes into
   *  an object URL. Undeclared — every renderable MIME resolves the bytes. */
  rendersFromUrl?: (mimeType: string) => boolean;
}

interface BlobFileResult {
  /** The resolution's state. */
  state: BlobFileState;
  /** The observed element (the placeholder's box): the viewport gate's
   *  target. Unused over the eager stand. */
  ref: (node: HTMLElement | null) => void;
}

/**
 * Resolve a file id and keep the object URL synchronized with store
 * changes. The resolution stands in two phases: the metadata's lookup (the
 * store's opt-in `getMeta` — no body transfer) runs at mount, and the
 * bytes' fetch (`get` + the object URL) runs only once the placeholder's
 * box stands in the viewport's preload band (framed by the consumer's
 * `scrollContainer` when the document scrolls inside one) — the
 * viewport-gated lazy loading. The gate waits for the head's metadata over a store that offers
 * it: the reserved aspect ratio is the layout the band's decision is made
 * on (a document of images resolves its first screen only).
 *
 * With a `getMeta` member the non-renderable MIME (the predicate) stands
 * the meta-only view when the store supplies a `downloadUrl`; a renderable
 * MIME the `rendersFromUrl` predicate claims stands the direct-URL view (the
 * image's own `<img>` subrequest, no bytes in the JS heap) over the same
 * store member; the remaining renderable MIME (and the absent
 * `downloadUrl`) resolves the bytes over `get` as before. Without `getMeta`
 * the resolution stands the legacy path's phases: no metadata before the
 * bytes, the bytes over `get` once the block is in view. A store change
 * re-resolves over the current band, and a view that already resolved never
 * falls back to the placeholder outside it. An empty `fileId` stands the
 * missing stand without a store read (an absent cover's row).
 */
function useBlobFile(
  fileId: string,
  rendersBytes?: (mimeType: string) => boolean,
  options: BlobFileOptions = {}
): BlobFileResult {
  const { blobStore, scrollContainer } = useEditorContext();
  // The store's optional head lookup (captured for the effect's closure —
  // its presence narrows the member type once, not per read).
  const getMeta = blobStore.getMeta;
  const rendersFromUrl = options.rendersFromUrl;
  const [ref, setRef] = useState<BlobRef | null>(null);
  const [urlView, setUrlView] = useState<BlobUrlState | null>(null);
  /** The head's metadata (the loading stand's aspect-ratio input). */
  const [headMeta, setHeadMeta] = useState<BlobMeta | null>(null);
  /** The resolution's rejection (the missing stand) — a resolve clears it. */
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<BlobView | null>(null);

  // The head's phase is in (or the store stands none): the gate's layout is
  // the one the placeholder reserves from the metadata.
  const headSettled =
    options.eager === true || blobStore.getMeta === undefined || headMeta !== null || urlView !== null || failed;
  const { ref: observeRef, inView } = useInView({
    disabled: options.eager === true,
    ready: headSettled,
    root: scrollContainer,
  });

  // The gate's live stand: the effects below read it without re-running the
  // resolution effect over every flip (the entry triggers its own load).
  const inViewRef = useRef(inView);
  /** True once the bytes resolved: a later store change re-resolves them
   *  only over the band (the previous view keeps standing outside it). */
  const loadedRef = useRef(false);
  const loadRef = useRef<(() => void) | null>(null);
  const firstInViewRun = useRef(true);

  useEffect(() => {
    let alive = true;
    let sequence = 0;
    setRef(null);
    setUrlView(null);
    setHeadMeta(null);
    setFailed(false);
    loadedRef.current = false;
    // The empty id stands no store key (an absent cover's row): the missing
    // stand without a read.
    if (fileId === "") {
      setFailed(true);
      return;
    }

    /** The head's resolved stand over this resolution's lifetime: the
     *  band's entry reuses it (the store's change re-reads it fresh). */
    let head: BlobMeta | null = null;
    /** The head's in-flight request: a non-fresh load joins it instead of
     *  issuing a second lookup while one is pending. */
    let headRequest: Promise<BlobMeta> | null = null;
    /** The head decided a store-URL stand (no bytes stand over any band). */
    let urlOnly = false;

    const load = async (freshHead: boolean): Promise<void> => {
      if (fileId === "") return;
      const request = ++sequence;
      const current = (): boolean => alive && request === sequence;
      try {
        // The meta's stand (the store's opt-in): the lightweight metadata's
        // lookup over the body's transfer — the meta-only view stands when
        // the MIME is not the block's renderable one and the store supplies
        // the download's URL (otherwise the bytes' phase stands). The band's
        // entry reuses the head the mount's phase resolved; a store change
        // re-reads it (the store's metadata is the source of truth).
        if (getMeta !== undefined) {
          if (freshHead || head === null) {
            // A non-fresh load joins a pending lookup: the head stands once
            // per resolution (a store change starts a fresh one).
            const pending = freshHead || headRequest === null ? getMeta(fileId) : headRequest;
            headRequest = pending;
            const meta = await pending;
            if (!current()) return;
            head = meta;
            setHeadMeta(meta);
            const downloadUrl = blobStore.downloadUrl;
            const url = downloadUrl === undefined ? null : downloadUrl(fileId);
            urlOnly = false;
            if (url !== null && rendersBytes !== undefined && !rendersBytes(meta.mimeType)) {
              urlOnly = true;
              setRef(null);
              setUrlView({ status: "ready-meta", meta, url });
              setFailed(false);
              return;
            }
            // The renderable image stands the store's own URL: the browser
            // fetches and caches it natively, so the block neither holds the
            // bytes nor loses the response cache on the next mount. An
            // executable scheme stands the bytes' path (the store's URL is
            // untrusted — the download href's gate).
            if (
              url !== null &&
              rendersFromUrl !== undefined &&
              rendersFromUrl(meta.mimeType) &&
              isSafeDownloadHref(url)
            ) {
              urlOnly = true;
              setRef(null);
              setUrlView({ status: "ready-url", meta, url });
              setFailed(false);
              return;
            }
          } else if (urlOnly) {
            // The head decided a store-URL stand: its bytes never resolve.
            return;
          }
        }
        // The bytes' phase waits for the box's entry into the preload band;
        // a resolved view stands over the store's change outside the band
        // (the rename's in-place update, no placeholder's return).
        if (!inViewRef.current) return;
        const next = await blobStore.get(fileId);
        if (!current()) return;
        loadedRef.current = true;
        setRef(next);
        setUrlView(null);
        setFailed(false);
      } catch {
        // The read's failure stands the failed card (the consumer's
        // notice) over a stale load's late stand — never a thrown render.
        if (!current()) return;
        setRef(null);
        setUrlView(null);
        setFailed(true);
      }
    };
    loadRef.current = () => {
      void load(false);
    };
    const unsubscribe = blobStore.subscribe(fileId, () => {
      // The store's change (a rename / a byte replacement) re-reads the
      // head: the store's metadata is the source of truth.
      void load(true);
    });
    void load(false);

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [blobStore, fileId, rendersBytes, rendersFromUrl]);

  useEffect(() => {
    inViewRef.current = inView;
    // The mount's stand is the resolution effect's own load.
    if (firstInViewRun.current) {
      firstInViewRun.current = false;
      return;
    }
    if (!inView || loadedRef.current) return;
    loadRef.current?.();
  }, [inView]);

  useEffect(() => {
    if (ref === null) {
      setView(null);
      return;
    }
    const url = URL.createObjectURL(ref.blob);
    setView({ ...ref, url });
    return () => URL.revokeObjectURL(url);
  }, [ref]);

  if (view !== null) return { state: { status: "ready", ...view }, ref: observeRef };
  if (urlView !== null) return { state: urlView, ref: observeRef };
  if (failed) return { state: { status: "missing" }, ref: observeRef };
  return { state: { status: "loading", meta: headMeta }, ref: observeRef };
}

export { useBlobFile };
export type { BlobFileOptions, BlobFileResult, BlobFileState, BlobUrlView, BlobView };
