import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BlockId, Doc } from "docblocks-core";

import type { EditorStore } from "../state/store";
import { finalOrderAfterSlotDrop, moveTargetForReorder } from "./reorder";

/** Pointer movement before the lift begins: a press that does not reach it stays a plain click. */
const DRAG_THRESHOLD_PX = 4;

/** The horizontal band around a list run that still offers a drop slot. */
const DROP_BAND_TOLERANCE_PX = 24;

type DropSide = "before" | "after";

/**
 * One same-level drop slot, named by the sibling it borders: `anchor` is
 * the item below the slot for a "before" drop and the item above it for
 * an "after" drop; a null anchor is the slot before the run's first item
 * or after its last.
 */
interface DropSlot {
  anchor: BlockId | null;
  side: DropSide;
}

interface DragSessionOptions {
  rootRef: RefObject<HTMLElement | null>;
  store: EditorStore;
  doc: Doc;
  rootBlockId: BlockId;
}

/**
 * The custom pointer drag for list items (every level): the item lifts
 * and follows the pointer, a line marks the same-level drop slot inside
 * the item's own list run, and the release commits one `moveBlock`.
 *
 * Same level only (v1): no slot is offered outside the run (a pointer
 * over the parent, over another list kind, or over the item's own
 * subtree), so a cross-level drop snaps back. The framer reorder is not
 * involved — the list runs are not `Reorder` groups, which keeps the
 * native `<ul>`/`<ol>` markup (and its markers) intact.
 */
function useListDrag(rootRef: RefObject<HTMLElement | null>, store: EditorStore, doc: Doc, rootBlockId: BlockId) {
  const sessionRef = useRef<DragSession | null>(null);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent, blockId: BlockId) => {
      if (sessionRef.current !== null) return;
      sessionRef.current = new DragSession(event, blockId, { rootRef, store, doc, rootBlockId }, () => {
        sessionRef.current = null;
      });
    },
    [doc, rootBlockId, rootRef, store]
  );

  useEffect(() => () => sessionRef.current?.dispose(), []);

  return onHandlePointerDown;
}

class DragSession {
  private lifted = false;
  private slot: DropSlot | null = null;
  private overElement: HTMLElement | null = null;
  private overAnchor: BlockId | null = null;

  constructor(
    private readonly event: ReactPointerEvent,
    private readonly draggedId: BlockId,
    private readonly options: DragSessionOptions,
    private readonly finish: () => void
  ) {
    const { rootRef } = options;
    this.wrapper = rootRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(draggedId)}"]`) ?? null;
    this.list = this.wrapper?.closest<HTMLElement>("[data-slot='docblocks/list']") ?? null;
    if (this.wrapper === null || this.list === null) {
      // No resolvable item or no list ancestor (malformed data): nothing to reorder.
      this.finish();
      return;
    }
    this.originY = event.clientY;
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private readonly wrapper: HTMLElement | null;
  private readonly list: HTMLElement | null;
  private readonly originY: number = 0;

  dispose() {
    this.disposeListeners();
    this.clearVisuals();
    this.finish();
  }

  private disposeListeners() {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const delta = event.clientY - this.originY;
    if (this.wrapper === null) return;
    if (!this.lifted) {
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      this.lifted = true;
      this.wrapper.setAttribute("data-docblocks-dragging", "");
      // Keep the lifted item out of the hit tests: it follows the pointer
      // and would otherwise shadow every slot.
      this.wrapper.style.pointerEvents = "none";
    }
    this.wrapper.style.transform = `translateY(${delta}px)`;
    this.applySlot(this.slotForPointer(event));
  };

  private readonly onPointerUp = () => {
    const { slot, lifted } = this.releaseState();
    if (lifted && slot !== null) this.move(slot);
    this.dispose();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.dispose();
  };

  /** Clears the mutable state and returns it so the release runs on the settled values. */
  private releaseState(): { slot: DropSlot | null; lifted: boolean } {
    const released = { slot: this.slot, lifted: this.lifted };
    this.slot = null;
    this.lifted = false;
    this.disposeListeners();
    this.clearVisuals();
    return released;
  }

  private clearVisuals() {
    this.wrapper?.removeAttribute("data-docblocks-dragging");
    this.wrapper?.style.removeProperty("transform");
    this.wrapper?.style.removeProperty("pointer-events");
    this.clearOver();
  }

  private move(slot: DropSlot) {
    const { store, doc, rootBlockId } = this.options;
    const parentWrapper = this.list?.closest<HTMLElement>("[data-block-id]");
    const parentId = parentWrapper?.getAttribute("data-block-id") ?? rootBlockId;
    const state = store.getState();
    const parentBlock = state.blocks[parentId];
    const oldIds =
      parentId === rootBlockId
        ? [...state.rootChildren]
        : parentBlock?.type === "list-item"
          ? [...(parentBlock.children ?? [])]
          : [];
    const finalIds = finalOrderAfterSlotDrop(oldIds, this.draggedId, slot.anchor, slot.side);
    const toIndex = finalIds === null ? null : moveTargetForReorder(oldIds, finalIds, this.draggedId);
    if (toIndex === null) return;
    doc.transact(() => doc.moveBlock(this.draggedId, parentId, toIndex));
  }

  /**
   * The slot the pointer's row belongs to, or null when the pointer is
   * outside the run's horizontal band or the run has no other items. The
   * slot is named by the row's item: the pointer above its midpoint is
   * "before" it, below its midpoint "after" it; a pointer below the last
   * item is the slot after the run.
   */
  private slotForPointer(event: PointerEvent): DropSlot | null {
    const { wrapper, list } = this;
    if (wrapper === null || list === null) return null;
    const band = list.getBoundingClientRect();
    if (event.clientX < band.left - DROP_BAND_TOLERANCE_PX || event.clientX > band.right + DROP_BAND_TOLERANCE_PX) {
      return null;
    }
    const items = [...list.querySelectorAll<HTMLElement>(":scope > [data-block-id]")].filter((el) => el !== wrapper);
    if (items.length === 0) return null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) return { anchor: item.dataset.blockId ?? null, side: "before" };
    }
    return { anchor: items[items.length - 1]?.dataset.blockId ?? null, side: "after" };
  }

  private applySlot(slot: DropSlot | null) {
    if (slot === null) {
      this.slot = null;
      this.clearOver();
      return;
    }
    if (slot.anchor !== null) {
      if (slot.anchor !== this.overAnchor || this.overElement?.getAttribute("data-docblocks-drag-over") !== slot.side) {
        this.clearOver();
        const anchor =
          this.list === null
            ? null
            : this.list.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(slot.anchor)}"]`);
        if (anchor !== null) {
          anchor.setAttribute("data-docblocks-drag-over", slot.side);
          this.overElement = anchor;
          this.overAnchor = slot.anchor;
        }
      }
    } else {
      this.clearOver();
    }
    this.slot = slot;
  }

  private clearOver() {
    this.overElement?.removeAttribute("data-docblocks-drag-over");
    this.overElement = null;
    this.overAnchor = null;
  }
}

export { useListDrag };
