// The cover's frame tint: the stored cover's average color stood as a CSS
// variable over the editor's card (the border's mix's input — the theme's
// stand stands over the CSS's mix over the theme's border token). The
// consumer's own chrome (the glow's stand over the editor's surroundings)
// reads the same color over the public hook — the package's DOM ends at
// the card, so the surroundings' visual stays the consumer's.
import { useStore } from "zustand";

import { useEffect, useState } from "react";

import { useEditorContext } from "../editor-provider";
import { COVER_TINT_VARIABLE, averageColorOfBlob } from "./cover";

/**
 * The stored cover's average color (the frame's tint's / the consumer's
 * glow's data's source): the cover's blob resolved over the editor's blob
 * store, and the alpha-weighted average read from it — the `rgb(...)`'s
 * string or `null` over the absent's id / the unresolved's / the
 * undecodable's stand. The blob's identity's cache stands the
 * re-resolution's no re-compute (the store's change's new blob stands the
 * fresh entry).
 */
function useCoverAverageColor(): string | null {
  const { store, blobStore } = useEditorContext();
  const attributes = useStore(store, (state) => state.meta.attributes);
  const coverId = typeof attributes?.cover === "string" ? attributes.cover : undefined;
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    if (coverId === undefined) {
      setColor(null);
      return;
    }
    let alive = true;
    const settle = (next: string | null): void => {
      if (alive) setColor(next);
    };
    const load = async (): Promise<void> => {
      try {
        const ref = await blobStore.get(coverId);
        settle(await averageColorOfBlob(ref.blob));
      } catch {
        settle(null);
      }
    };
    const unsubscribe = blobStore.subscribe(coverId, () => {
      void load();
    });
    void load();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [blobStore, coverId]);

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
