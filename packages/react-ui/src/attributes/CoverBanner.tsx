/** The cover's banner over the editor frame's top edge (the above-the-
 *  page column's stand, the full frame width's bleed): the stored cover's
 *  image rendered over the placement mode — the tile's stand (the strip
 *  stands its natural height, the centered's crop over the wide's stand,
 *  the `repeat-x`'s glue over the narrow's stand) or the centering's stand
 *  (the centered image over the max height's cap). The banner is
 *  decoration only: the pointer's transparent stand keeps the page's
 *  selection and the cross-drag's stands untouched. The bottom's last
 *  pixels stand the fade-out's smooth stand into the page's content. */
import { useStore } from "zustand";

import { useLayoutEffect, useRef, useState } from "react";

import { useBlobFile } from "../blocks/use-blob-file";
import { useEditorContext } from "../editor-provider";
import {
  COVER_MAX_CENTER_HEIGHT_PX,
  COVER_RENDERS_BYTES,
  coverFadeMask,
  coverModeOf,
  readImageDimensions,
  tileBackgroundStyle,
} from "./cover";
import type { CoverMode, ImageDimensions } from "./cover";

function CoverBanner() {
  const { store } = useEditorContext();
  const meta = useStore(store, (state) => state.meta);
  const attributes = meta.attributes;
  const coverId = typeof attributes?.cover === "string" ? attributes.cover : undefined;
  if (coverId === undefined) return null;
  return <CoverBannerBody coverId={coverId} mode={coverModeOf(attributes?.coverMode)} />;
}

/** The banner's body (the hooks' stand — the mount only over the cover's
 *  presence, so the resolution's hook never sees the empty's id). */
function CoverBannerBody({ coverId, mode }: { coverId: string; mode: CoverMode }) {
  const file = useBlobFile(coverId, COVER_RENDERS_BYTES);
  const blob = file.status === "ready" ? file.blob : null;

  /** The intrinsic dimensions' probe (the tile's stand's input — the crop
   *  over the glue's decision; the undecodable's payload stands the
   *  fallback's plain image's stand). */
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  useLayoutEffect(() => {
    if (blob === null) {
      setDimensions(null);
      return;
    }
    let alive = true;
    void readImageDimensions(blob).then((next) => {
      if (alive) setDimensions(next);
    });
    return () => {
      alive = false;
    };
  }, [blob]);

  /** The column's live width (the tile's crop-over-glue's decision's
   *  input): the wrapper's own box (the full column's width's stand) over
   *  the mount's measure + the resize's watch (the jsdom's no-layout's
   *  stand keeps the zero's value — the wide's decision's fail-open). The
   *  effect re-runs over the ready's stand: the wrapper commits only over
   *  the resolution, so the mount's measure stands over its presence. */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (el === null) return;
    const measure = (): void => {
      setWidth((prev) => (prev === el.clientWidth ? prev : el.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [file.status === "ready"]);

  if (file.status !== "ready") return null;

  return (
    <div
      ref={wrapperRef}
      data-slot="docblocks/cover-banner"
      data-cover-mode={mode}
      aria-hidden
      // The frame's edge's stand: the negative top margin cancels the
      // Card's py-6's padding (the banner sticks to the frame's top
      // edge), and the top radius stands the card's rounded-xl's
      // corner's clip. The bottom fade's mask stands the last pixels'
      // smooth stand over both modes.
      className="pointer-events-none -mt-6 w-full overflow-hidden rounded-t-xl select-none"
      style={{
        maskImage: coverFadeMask(),
        WebkitMaskImage: coverFadeMask(),
      }}
    >
      {mode === "tile" ? (
        dimensions === null ? (
          // The undecodable's legacy's cover's stand: the plain centered
          // image (the tiling's decision needs the intrinsic width).
          <img src={file.url} alt="" className="mx-auto block max-w-full" />
        ) : (
          <div className="w-full" style={tileBackgroundStyle(dimensions, width, file.url)} />
        )
      ) : (
        <div className="flex w-full justify-center">
          <img src={file.url} alt="" className="max-w-full" style={{ maxHeight: COVER_MAX_CENTER_HEIGHT_PX }} />
        </div>
      )}
    </div>
  );
}

export { CoverBanner };
