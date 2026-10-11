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
      el.removeAttribute("data-testid");
      el.removeAttribute("data-current");
      if (id !== null && ids.has(id)) {
        el.setAttribute("data-testid", `block-${client}-${id}`);
        if (id === currentId) el.setAttribute("data-current", "true");
      }
    }
  }, [blocks, currentId, client, docAreaRef]);
}

export { useBlockLabels };
