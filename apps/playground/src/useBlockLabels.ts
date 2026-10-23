import { useEffect } from "react";
import type { RefObject } from "react";

import type { PaneBlock } from "./pane-blocks";

/**
 * Label the pane's rendered blocks for the e2e specs: a testid per block
 * and `data-current` on the pane's current block (the editor renders the
 * real blocks; the pane adds these harness attributes). Text-editable
 * blocks carry the id on the wrapper and the inner editable — only the
 * wrapper is labeled.
 */
function useBlockLabels(
  docAreaRef: RefObject<HTMLDivElement | null>,
  blocks: PaneBlock[],
  currentId: string | null,
  client: "a" | "b"
): void {
  useEffect(() => {
    const container = docAreaRef.current;
    if (container === null) return;
    const ids = new Set(blocks.map((block) => block.id));
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]"))) {
      if (el.getAttribute("data-slot") === "docblocks/block-content") continue;
      const id = el.getAttribute("data-block-id");
      // Write only on a value change: a text edit re-runs the effect over
      // the whole sequence, and the no-op re-stamp (remove + set) is a
      // per-block DOM mutation on every keystroke.
      const wantTestid = id !== null && ids.has(id) ? `block-${client}-${id}` : null;
      if (el.getAttribute("data-testid") !== wantTestid) {
        if (wantTestid === null) el.removeAttribute("data-testid");
        else el.setAttribute("data-testid", wantTestid);
      }
      const wantCurrent = id !== null && id === currentId;
      if (el.hasAttribute("data-current") !== wantCurrent) {
        if (wantCurrent) el.setAttribute("data-current", "true");
        else el.removeAttribute("data-current");
      }
    }
  }, [blocks, currentId, client, docAreaRef]);
}

export { useBlockLabels };
