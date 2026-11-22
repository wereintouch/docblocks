/** The mention chip's kind icons: the lucide's `user` (the `user` kind) and
 *  `square-arrow-out-up-right` (the `doc` kind) over the imperative chip
 *  path (the set's `User` / `SquareArrowOutUpRight` components stand the
 *  same geometry over the React surfaces). The 24x24 viewBox + the stroke's
 *  currentColor stand; the chip's CSS sizes them to the text's line. */
import type { MentionKind } from "docblocks-core";

type IconShape = { tag: "path"; d: string } | { tag: "circle"; cx: number; cy: number; r: number };

const ICON_SHAPES: Record<MentionKind, IconShape[]> = {
  user: [
    { tag: "path", d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" },
    { tag: "circle", cx: 12, cy: 7, r: 4 },
  ],
  doc: [
    { tag: "path", d: "M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" },
    { tag: "path", d: "m21 3-9 9" },
    { tag: "path", d: "M15 3h6v6" },
  ],
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** The kind's inline icon (the shapes stand the lucide's geometry; the
 *  label travels as a separate text node). */
function createMentionKindIcon(kind: MentionKind): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // An out-of-enum kind (the lenient reader keeps the wire's data as-is)
  // falls back to the `doc`'s icon over the throw (the React's path's
  // parity — the chip stands, the block does not placeholder).
  for (const shape of ICON_SHAPES[kind] ?? ICON_SHAPES.doc) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    if (shape.tag === "path") el.setAttribute("d", shape.d);
    else {
      el.setAttribute("cx", String(shape.cx));
      el.setAttribute("cy", String(shape.cy));
      el.setAttribute("r", String(shape.r));
    }
    svg.appendChild(el);
  }
  return svg;
}

export { createMentionKindIcon };
