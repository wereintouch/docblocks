/** The canvas clipboard's data shapes: the copied item's deep data (the
 * container's membership / the connector's endpoints stand the original ids;
 * the paste remaps them) and the clipboard's entries (the top-level ids'
 * order stands the paste's selection). Types only — no logic. */
import type { BlockContent, BlockId, CanvasTextAttrs, ConnectorAttrs, Geometry, ShapeAttrs } from "docblocks-core";

/** The one copied canvas item (the deep data; the ids stand the originals). */
type ClipboardItem =
  | { type: "shape"; attrs?: ShapeAttrs; geometry?: Geometry }
  | { type: "connector"; attrs: ConnectorAttrs; geometry?: Geometry }
  | { type: "canvas-text"; attrs?: CanvasTextAttrs; content?: BlockContent; geometry?: Geometry }
  // The group's attrs stand the inline shape (the core's GroupAttrs is not
  // exported) — the members are the surface's sibling refs, the title the
  // container's label.
  | { type: "group"; attrs: { members: BlockId[]; title?: string }; geometry?: Geometry };

/** The deep copy of the copied canvas items (the ids stand the originals). */
interface CanvasClipboard {
  /** The copied items with the original ids (top-level + the containers' transitive members). */
  entries: { id: BlockId; item: ClipboardItem }[];
  /** The top-level ids (the selection order) — the paste's selection stand. */
  ids: BlockId[];
}

/** The default item box (the copy's union stand over the absent geometry — the shared default size). */

export type { CanvasClipboard, ClipboardItem };
