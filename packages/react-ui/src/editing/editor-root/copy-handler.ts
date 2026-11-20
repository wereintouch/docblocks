/** The editor root's copy handler: the selection's payload (the cross-block
 *  range / the blocks selection — `cross-copy`), the mention's `@label`
 *  stand for a same-block range, and the published stand's off. */
import type { ClipboardEvent } from "react";
import type { RefObject } from "react";

import type { Doc } from "docblocks-core";

import type { EditorMode, SelectionRef } from "../../editor-provider";
import { clipboardContentOf, segmentOf } from "../cross-copy";
import { mapDomSelection } from "../selection-mapping";

interface CopyHandlerDeps {
  doc: Doc;
  mode: EditorMode;
  viewMode: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  selectionRef: SelectionRef;
}

/**
 * The root's copy handler. The browser cannot copy a selection across a
 * contenteditable boundary, so a cross-block range is serialized from the
 * doc; a same-block range that includes a mention is serialized too (the
 * mention copies as `@label`, not the chip's bare label); everything else
 * keeps the default (native) copy. The edit's mode reads the live
 * selection view (the mapping owns it); the view's mode maps the DOM
 * selection at copy time — the read-only stand keeps no live view (the
 * browser's native range is the only selection there). The published
 * stand never intercepts (no selection, no copy).
 */
function createCopyHandler(deps: CopyHandlerDeps): (event: ClipboardEvent<HTMLDivElement>) => void {
  const { doc, mode, viewMode, rootRef, selectionRef } = deps;
  return (event) => {
    if (mode === "published") return;
    // A copy from a nested editor (a sync-embed) bubbles up to this root;
    // that editor's own copy handler owns its payload.
    const root = rootRef.current;
    const view = selectionRef.view;
    if (root === null || view === null) return;
    const target = event.target instanceof Element ? event.target : null;
    const nearest = target?.closest('[data-slot="docblocks/editor"]') ?? null;
    if (nearest !== null && nearest !== root) return;
    const selection = viewMode ? mapDomSelection(root, window.getSelection(), doc, { readOnly: true }) : view.get();
    // A same-block text range that includes a mention: serialize the
    // segment. A segment without a mention keeps the default copy (the
    // native fidelity).
    if (
      selection.kind === "text" &&
      selection.to !== null &&
      selection.to.blockId === selection.from.blockId &&
      selection.from.offset < selection.to.offset
    ) {
      const block = doc.getBlock(selection.from.blockId);
      const content = block !== null && "content" in block ? block.content : undefined;
      if (content !== undefined) {
        let runStart = 0;
        let hasMention = false;
        for (const run of content) {
          const runEnd = runStart + run.text.length;
          if (run.marks.mention !== undefined && runStart < selection.to.offset && runEnd > selection.from.offset) {
            hasMention = true;
            break;
          }
          runStart = runEnd;
        }
        if (hasMention) {
          const segment = segmentOf(content, selection.from.offset, selection.to.offset);
          event.preventDefault();
          event.clipboardData.setData("text/plain", segment.text);
          event.clipboardData.setData("text/html", segment.html);
          return;
        }
      }
    }
    const payload = clipboardContentOf(doc, selection);
    if (payload === null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.text);
    event.clipboardData.setData("text/html", payload.html);
  };
}

export { createCopyHandler };
