import { useRef } from "react";

import { isSafeEmbedSrc } from "docblocks-core";
import type { BlockId, EmbedBlock as EmbedBlockType } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { EmbedResizeHandle } from "./EmbedResizeHandle";
import { EmbedToolbar } from "./EmbedToolbar";
import { useEmbedHeight } from "./use-embed-height";
import { useEmbedView } from "./use-embed-view";

/**
 * An embed (v1): a plain iframe for every kind — the kind is a renderer hint
 * only (all kinds render as an iframe; per-kind card renderers come later),
 * so an unknown kind (newer data) still renders the same iframe. `src` is a
 * URL, not a blob key: the consumer's blob resolver does not apply. The
 * iframe stands a `sandbox` attribute — the default grants the same-origin
 * (the embedded app's own storage / cookies stand, so the real apps boot
 * like in a plain tab) or the consumer's `embedSandbox` policy (the
 * opaque-origin's restriction over the untrusted, `null` for the fully
 * trusted). The block is not text-editable, so the wrapper carries no gutter
 * handle.
 *
 * Height (the stretched stand): the wrapper's height stands the
 * `--docblocks-embed-height` token (the default — the minimum). The
 * bottom-edge resize handle (the hover reveal, the keyboard's arrows)
 * stretches it over the minimum; the stretched px stand the block's
 * `height` attr (the null idiom: null / absent = the token's default), so
 * the reload restores it and the panes share it over the wire (the commit
 * stands the gesture's rest — one write per drag, one per key press).
 *
 * Pan/zoom (the persisted view): the iframe stands a CSS
 * `translate(x, y) scale(s)` transform (the wrapper clips the overflow). The
 * view stands the block's `zoom` / `panX` / `panY` attrs (the null idiom:
 * null / absent = the identity) — the reload restores the view and the wire
 * carries it over the panes (the panes share the persisted view; a pane's
 * gesture writes over the doc, the others adopt it). The write is debounced
 * over the gesture's bursts (one doc write per rest). The controls:
 *
 * - the hover toolbar (zoom in / out, the percent, reset) — always stands;
 * - the toolbar's URL edit (the editing mode's stand): the panel over the
 *   toolbar changes the `src` (the safe non-empty's write — the unsafe's
 *   rejection over the slash form's rule; the iframe's navigation over the
 *   new src, the view's / the height's attrs stand untouched);
 * - the wheel — `ctrl`/`cmd` zooms at the cursor, a plain wheel pans
 *   vertically (content opposite to the delta, the canvas idiom);
 * - the modifier drag — a `space` / `alt`-held pointer drag pans (the iframe
 *   yields its pointer events to the wrapper while the modifier stands, so an
 *   unmodified drag still reaches the iframe's own interaction).
 *
 * A cross-origin iframe swallows the wheel over its own pixels (the browser
 * delivers it to the iframe's document), so the wheel stands over the
 * wrapper's exposed area and via an explicit dispatch; the hover toolbar is
 * the primary control. Zoom scales the iframe's raster — a strong zoom blurs
 * (the price of the generic cross-origin approach, documented).
 */

function EmbedBlock({ id, block }: { id: BlockId; block: EmbedBlockType }) {
  const { kind, src, title } = block.attrs;
  // The embed's sandbox: the policy (the consumer's or the default) maps
  // the src to the `sandbox` value; `null` stands no sandbox (a fully
  // trusted embed). The default grants the same-origin (the real-app's
  // own storage), so the embedded content boots like in a plain tab.
  const { embedSandbox } = useEditorContext();
  const sandbox = embedSandbox(src);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const controls = useEmbedView({ id, block, wrapperRef });
  const { view, panModifier, panSession, onPointerDown, onPointerMove, endPan } = controls;
  const {
    height,
    tokenMin,
    onPointerDown: onResizePointerDown,
    onPointerMove: onResizePointerMove,
    onPointerUp: endResize,
    onKeyDown: onResizeKeyDown,
  } = useEmbedHeight({ id, block, wrapperRef });

  return (
    <div
      ref={wrapperRef}
      data-slot="docblocks/block"
      data-block-type="embed"
      data-block-id={id}
      data-kind={kind}
      // The island's boundary: the frame's content is out of the page's
      // editable flow (the caret and the selection never stand in it).
      contentEditable={false}
      className="
        group relative my-(--docblocks-block-spacing) h-(--docblocks-embed-height) overflow-hidden
        rounded-(--docblocks-radius) border-(length:--docblocks-divider-border-width)
        border-(--docblocks-divider-border-color) outline-none
      "
      style={{
        ...(height !== null ? { height: Math.max(height, tokenMin) } : {}),
        cursor: panModifier ? (panSession.current !== null ? "grabbing" : "grab") : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {isSafeEmbedSrc(kind, src) ? (
        <iframe
          data-slot="docblocks/embed"
          src={src}
          title={title ?? kind}
          loading="lazy"
          sandbox={sandbox ?? undefined}
          className="block h-full w-full border-0"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "0 0",
            pointerEvents: panModifier ? "none" : "auto",
          }}
        />
      ) : (
        // The renderer's gate: the unsafe src (the legacy / the remote
        // crafted data — the write posture rejects it) stands the
        // placeholder, the iframe stands no mount (the `javascript:` / the
        // foreign `data:` would stand the XSS over the consumer's sandbox
        // grant / the phishing surface).
        <div
          data-slot="docblocks/embed-blocked"
          className="
            flex h-full w-full items-center justify-center p-4 text-center text-sm text-(--docblocks-muted-text-color)
          "
        >
          {title ?? kind}
        </div>
      )}
      <EmbedToolbar id={id} block={block} controls={controls} />
      <EmbedResizeHandle
        height={height}
        tokenMin={tokenMin}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onKeyDown={onResizeKeyDown}
      />
    </div>
  );
}

export { EmbedBlock };
