// The cover's frame tint: the stored cover's average color stood as a CSS
// variable over the editor's card (the border's mix's input — the theme's
// stand stands over the CSS's mix over the theme's border token). The
// consumer's own chrome (the glow's stand over the editor's surroundings)
// reads the same color over the public hook — the package's DOM ends at
// the card, so the surroundings' visual stays the consumer's.
import { useStore } from "zustand";

import { useEffect, useState } from "react";

import { useEditorContext } from "../editor-provider";
import { COVER_TINT_VARIABLE, averageColorOfUrl } from "./cover";
import { useCoverImage } from "./use-cover-image";

/**
 * The stored cover's average color (the frame's tint's / the consumer's
 * glow's data's source): the cover's resolved url drawn into the sample's
 * canvas — the `rgb(...)`'s string or `null` over the absent's id / the
 * unresolved's / the undecodable's stand. The resolved url is the store's
 * direct URL when it supplies one; a cross-origin URL without CORS taints
 * the canvas, so that read falls back to the fetched bytes' same-origin
 * object URL (the library's own read).
 */
function useCoverAverageColor(): string | null {
  const { store, blobStore } = useEditorContext();
  const attributes = useStore(store, (state) => state.meta.attributes);
  const coverId = typeof attributes?.cover === "string" ? attributes.cover : undefined;
  const { url, source } = useCoverImage(coverId ?? "", { eager: true });
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    if (url === null) {
      setColor(null);
      return;
    }
    let alive = true;
    const settle = (next: string | null): void => {
      if (alive) setColor(next);
    };
    /**
     * The bytes' read: the same-origin object URL (a `blob:` url never
     * taints the canvas) — the fallback over a store URL the canvas cannot
     * read, and the legacy resolution's own stand.
     */
    const readBytes = async (): Promise<void> => {
      if (coverId === undefined) {
        settle(null);
        return;
      }
      let blobUrl: string | null = null;
      try {
        const ref = await blobStore.get(coverId);
        blobUrl = URL.createObjectURL(ref.blob);
        settle(await averageColorOfUrl(blobUrl));
      } catch {
        // A failed read / decode stands the untinted frame (the border's
        // plain default), not a thrown render.
        settle(null);
      } finally {
        // The draw's source is the decoded image, not the url.
        if (blobUrl !== null) URL.revokeObjectURL(blobUrl);
      }
    };
    const load = async (): Promise<void> => {
      const direct = await averageColorOfUrl(url);
      if (direct !== null || source !== "url") {
        settle(direct);
        return;
      }
      await readBytes();
    };
    const unsubscribe = blobStore.subscribe(coverId ?? "", () => {
      void load();
    });
    void load();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [blobStore, coverId, url, source]);

  return color;
}

/**
 * The tint's variable's controller (the package's internal's stand): the
 * average's color stood over the card's element (the border's element) as
 * the tint's CSS variable — the variable's removal stands over the
 * absent's color (the plain border's stand). The read-only's parity: the
 * tint is the derived's visual (the data's read stands over every mode).
 */
function CoverTintController({ cardRef }: { cardRef: React.RefObject<HTMLDivElement | null> }) {
  const color = useCoverAverageColor();

  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    if (color === null) {
      el.style.removeProperty(COVER_TINT_VARIABLE);
      return;
    }
    el.style.setProperty(COVER_TINT_VARIABLE, color);
  }, [cardRef, color]);

  return null;
}

export { CoverTintController, useCoverAverageColor };
