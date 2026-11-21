/** The link's doc commands over the target (one transaction — one undo
 * step, one wire update): the apply (the same href's re-apply stands the
 * no-op; the caret's stand inserts the label's text as the link's run),
 * the removal (the per-segment's `unsetMark` over the cross's stand). */
import type { Doc } from "docblocks-core";

import { clearMarkRange } from "../format-range";
import type { ToolbarRange } from "../format-range";
import { uniformLinkHrefOf } from "./range";

/** Apply the link's href over the target (one undo step). Over a caret
 * (the no-selection's stand) the `label`'s text (the input's stand, the
 * href's stand over its absence) is inserted as the linked's run. */
function applyLinkHref(doc: Doc, target: ToolbarRange, href: string, label?: string): void {
  if (uniformLinkHrefOf(doc, target) === href) return; // the no-op's stand (the undo's chain's stand)
  if (target.kind === "cross") {
    doc.setMarkRange(target.cross.from, target.cross.to, { type: "link", href });
    return;
  }
  if (target.from === target.to) {
    const text = label ?? href;
    doc.transact(() => {
      doc.insertText(target.blockId, target.from, text);
      doc.setMark(target.blockId, target.from, target.from + text.length, { type: "link", href });
    });
    return;
  }
  doc.transact(() => {
    doc.setMark(target.blockId, target.from, target.to, { type: "link", href });
  });
}

/** Remove the link over the target (one undo step). */
function removeLink(doc: Doc, target: ToolbarRange): void {
  if (target.kind === "cross") {
    clearMarkRange(doc, target.cross, "link");
    return;
  }
  doc.transact(() => {
    doc.unsetMark(target.blockId, target.from, target.to, "link");
  });
}

export { applyLinkHref, removeLink };
