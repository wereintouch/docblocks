/**
 * The viewport entry's hook (the lazy resolution's gate): tracks whether the
 * observed element stands in the viewport's preload band. The element's
 * bounding rect is measured once at mount — an element above the fold is
 * in view at once (no placeholder flash on the first screen); the rest
 * follow the `IntersectionObserver`'s first entry, which ends the tracking:
 * the caller's work stands over the in-view decision, so the box's later
 * moves (a resolved block's unmount, a scroll away) do not re-gate it.
 *
 * The band is the viewport grown by the preload margin (the
 * `--docblocks-image-preload-margin` token — 200% by default, so the
 * network runs well before the element enters the frame). The band's frame
 * is the observer's root: the window over the page scroll, or the
 * consumer's own scroll container (`root`) when the document scrolls inside
 * one — a window-rooted observer never sees an element clipped by the inner
 * scroller, so the band degenerates to the visible area. The same root
 * frames the mount's above-the-fold measure.
 * Without an
 * `IntersectionObserver` in the runtime (SSR hydration, a test
 * environment) the hook reports in view: the resolution's eager fallback.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** The preload margin's CSS token (resolved on the observed element — the
 *  editor root's token map stands in its ancestry). */
const PRELOAD_MARGIN_TOKEN = "--docblocks-image-preload-margin";

/** The fallback preload margin (two viewport heights on every side). */
const DEFAULT_PRELOAD_MARGIN = "200%";

interface UseInViewOptions {
  /** Force the in-view stand (the eager policy — the observer never runs). */
  disabled?: boolean;
  /** The layout's hold: while false the element is out of view and no
   *  observer runs; the flip to true measures the settled layout (a
   *  placeholder that reserves its height only after the metadata's
   *  lookup). */
  ready?: boolean;
  /** The band's frame: the consumer's scroll container, or `null` for the
   *  window (the page scroll). */
  root?: Element | null;
}

interface InViewResult<T extends Element> {
  /** Attach to the observed element. */
  ref: (node: T | null) => void;
  /** True when the element stands in the preload band (or forced in). */
  inView: boolean;
}

/** The observed element's preload margin: the token's value, or the fallback
 *  over the absent token. */
function readPreloadMargin(node: Element): string {
  if (typeof getComputedStyle !== "function") return DEFAULT_PRELOAD_MARGIN;
  const value = getComputedStyle(node).getPropertyValue(PRELOAD_MARGIN_TOKEN).trim();
  return value === "" ? DEFAULT_PRELOAD_MARGIN : value;
}

/** True when the element's box touches the band's frame at the mount's
 *  stand: the window's viewport, or the scroll container's box. */
function standsAboveFold(node: Element, root: Element | null): boolean {
  const rect = node.getBoundingClientRect();
  if (root === null) return rect.bottom > 0 && rect.top < window.innerHeight;
  const frame = root.getBoundingClientRect();
  return rect.bottom > frame.top && rect.top < frame.bottom;
}

function useInView<T extends Element = HTMLElement>(options: UseInViewOptions = {}): InViewResult<T> {
  const { disabled = false, ready = true, root = null } = options;
  // The observer is the only async source; without one the resolution runs
  // eagerly from the first render (the test environment's stand).
  const [inView, setInView] = useState<boolean>(() => disabled || typeof IntersectionObserver === "undefined");
  const nodeRef = useRef<T | null>(null);
  const ref = useCallback((node: T | null): void => {
    nodeRef.current = node;
  }, []);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (disabled || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    // The caller's layout is not settled yet: stay out of view and wait for
    // the flip (the effect re-runs over `ready`).
    if (!ready || node === null) return;
    // The first screen's eager priority (the LCP's stand): the element that
    // already stands in the viewport resolves without waiting for the
    // observer's first callback.
    if (standsAboveFold(node, root)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry === undefined) return;
        // The first entry ends the tracking: the caller starts its work over
        // the in-view stand and the box's further moves do not gate it (the
        // leaver's tracked observer would outlive a resolved block's box).
        if (entry.isIntersecting) observer.disconnect();
        setInView(entry.isIntersecting);
      },
      { root, rootMargin: readPreloadMargin(node) }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [disabled, ready, root]);

  return { ref, inView };
}

export { DEFAULT_PRELOAD_MARGIN, useInView };
export type { InViewResult, UseInViewOptions };
