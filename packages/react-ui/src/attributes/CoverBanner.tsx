/** The cover's banner over the editor frame's top edge (the above-the-
 *  page column's stand, the full frame width's bleed): the stored cover's
 *  image rendered over the placement mode — the tile's stand (the strip
 *  scaled to the fixed's 150 px's height, the width's proportional, the
 *  `repeat-x`'s horizontal glue) or the centering's stand (the width
 *  scaled to the frame's width, the centered's 150 px's vertical slice
 *  over the scaled height). The banner is decoration only: the pointer's
 *  transparent stand keeps the page's selection and the cross-drag's
 *  stands untouched. The bottom's last pixels stand the fade-out's smooth
 *  stand into the page's content. The image stands the store's direct URL
 *  when it supplies one (the browser's cacheable subrequest), the bytes'
 *  object URL otherwise. */
import { useStore } from "zustand";

import { useLayoutEffect, useRef, useState } from "react";

import { useEditorContext } from "../editor-provider";
import {
  COVER_MAX_CENTER_HEIGHT_PX,
  centerBackgroundStyle,
  coverFadeMask,
  coverModeOf,
  tileBackgroundStyle,
} from "./cover";
import type { CoverMode } from "./cover";
import { useCoverImage } from "./use-cover-image";

function CoverBanner() {
  const { store } = useEditorContext();
  const meta = useStore(store, (state) => state.meta);
  const attributes = meta.attributes;
  const coverId = typeof attributes?.cover === "string" ? attributes.cover : undefined;
  if (coverId === undefined) return null;
  return <CoverBannerBody coverId={coverId} mode={coverModeOf(attributes?.coverMode)} />;
}

/** The banner's body (the hooks' stand — the mount only over the cover's
 *  presence, so the resolution's hook never sees the empty's id). The
 *  dimensions' probe runs over the centering only (the tile's fixed strip
 *  needs no intrinsic size) — the store's direct URL serves the probe as it
 *  serves the render. */
function CoverBannerBody({ coverId, mode }: { coverId: string; mode: CoverMode }) {
  const { url, dimensions } = useCoverImage(coverId, { eager: true, measure: mode === "center" });

  /** The frame's live width (the centering's slice's height's input): the
   *  wrapper's own box (the full frame's width's stand) over the mount's
   *  measure + the resize's watch (the jsdom's no-layout's stand keeps the
   *  zero's value — the maximum's height's fail-open). The effect re-runs
   *  over the ready's stand: the wrapper commits only over the
   *  resolution, so the mount's measure stands over its presence. */
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
  }, [url !== null]);

  if (url === null) return null;

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
        // The tile's stand: the fixed's strip (the height's constant — no
        // probe over the render's path).
        <div className="w-full" style={tileBackgroundStyle(url)} />
      ) : dimensions === null ? (
        // The undecodable's legacy's cover's stand: the plain centered
        // image (the slice's decision needs the intrinsic dimensions).
        <div className="flex w-full justify-center">
          <img src={url} alt="" className="max-w-full" style={{ maxHeight: COVER_MAX_CENTER_HEIGHT_PX }} />
        </div>
      ) : (
        <div className="w-full" style={centerBackgroundStyle(dimensions, width, url)} />
      )}
    </div>
  );
}

export { CoverBanner };
