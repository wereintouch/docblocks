import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BlockId, Doc } from "docblocks-core";

import type { EditorStore } from "../state/store";
import { crossParentTargetIndex, finalOrderAfterSlotDrop, moveTargetForReorder } from "./reorder";

/** Pointer movement before the lift begins: a press that does not reach it stays a plain click. */
const DRAG_THRESHOLD_PX = 4;

/** How far past a row's edges (left/right) the pointer still names that row. */
const ROW_TOLERANCE_PX = 24;

/** The fallback run indent (pixels) when the computed padding is unavailable. */
const INDENT_FALLBACK_PX = 24;

/**
 * A same-side drop: the dragged item lands before/after `anchor` in the
 * anchor's parent's children (the anchor's level). `parent` is the
 * anchor's parent id, or null for the root.
 */
interface SideSlot {
  kind: "side";
  anchor: BlockId;
  side: "before" | "after";
  parent: BlockId | null;
}

/**
 * A nested drop: the dragged item becomes the first child of `host`
 * (host is a list item; the pointer sits in the row's right band).
 */
interface IntoSlot {
  kind: "into";
  host: BlockId;
}

type Slot = SideSlot | IntoSlot;

interface DragSessionOptions {
  rootRef: RefObject<HTMLElement | null>;
  store: EditorStore;
  doc: Doc;
  rootBlockId: BlockId;
}

/**
 * The custom pointer drag for list items (every level): the item lifts
 * and follows the pointer, a line marks the drop slot, and the release
 * commits one `moveBlock`.
 *
 * The hovered row's vertical half names the side (above its midpoint is
 * "before", below is "after"), and the horizontal band names the level:
 * a pointer in the row's right band (past 1.5 run-indents) drops the
 * item INTO a hovered list item (as its first child); anywhere else the
 * item drops at the hovered row's own level (its parent's children) —
 * which may re-parent it across levels (the target parent is the
 * hovered row's parent, not the dragged item's). A pointer over the
 * item's own subtree or past every row's band names no slot, and the
 * drop snaps back.
 *
 * The framer reorder is not involved — the list runs are not `Reorder`
 * groups, which keeps the native `<ul>`/`<ol>` markup (and its markers)
 * intact.
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
  private slot: Slot | null = null;

  constructor(
    private readonly event: ReactPointerEvent,
    private readonly draggedId: BlockId,
    private readonly options: DragSessionOptions,
    private readonly finish: () => void
  ) {
    const { rootRef } = options;
    this.root = rootRef.current;
    this.wrapper = this.root?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(draggedId)}"]`) ?? null;
    this.line = this.createLine();
    if (this.wrapper === null || this.line === null) {
      // No resolvable item or no editor root to anchor the line: nothing to drag.
      this.line?.remove();
      this.finish();
      return;
    }
    this.originY = event.clientY;
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private readonly root: HTMLElement | null;
  private readonly wrapper: HTMLElement | null;
  private readonly line: HTMLElement | null;
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
      // Keep the lifted item out of the row tests below: it follows the
      // pointer and would otherwise shadow every slot.
      this.wrapper.style.pointerEvents = "none";
    }
    this.wrapper.style.transform = `translateY(${delta}px)`;
    const slot = this.slotForPointer(event);
    this.slot = slot;
    this.positionLine(slot);
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
  private releaseState(): { slot: Slot | null; lifted: boolean } {
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
    this.line?.remove();
  }

  /** The positioned drop-line element (anchored in the editor root). */
  private createLine(): HTMLElement | null {
    if (this.root === null) return null;
    const line = document.createElement("div");
    line.setAttribute("data-slot", "docblocks/drag-line");
    line.style.display = "none";
    this.root.appendChild(line);
    return line;
  }

  private move(slot: Slot) {
    const { store } = this.options;
    const state = store.getState();
    // The dragged block was removed by a remote update mid-drag: there is
    // nothing left to move (moving it would throw UnknownBlockError and
    // skip the dispose below).
    if (state.blocks[this.draggedId] === undefined) return;
    if (slot.kind === "into") {
      const host = state.blocks[slot.host];
      if (host?.type !== "list-item") return;
      this.commit(slot.host, [...(host.children ?? [])], null, "before");
      return;
    }
    const { rootBlockId } = this.options;
    const parentId = slot.parent ?? rootBlockId;
    const parentBlock = state.blocks[parentId];
    const oldIds =
      parentId === rootBlockId
        ? [...state.rootChildren]
        : parentBlock?.type === "list-item"
          ? [...(parentBlock.children ?? [])]
          : [];
    this.commit(parentId, oldIds, slot.anchor, slot.side);
  }

  /**
   * One moveBlock for the slot (pre-move index), dropped when the order
   * is stale or a no-op. Within a parent the drop reorders the children
   * (the final-order chain); across parents the item is not among the
   * target's children and lands at the anchor's index instead.
   */
  private commit(parentId: BlockId, oldIds: BlockId[], anchor: BlockId | null, side: "before" | "after") {
    const { doc } = this.options;
    let toIndex: number | null;
    if (oldIds.includes(this.draggedId)) {
      const finalIds = finalOrderAfterSlotDrop(oldIds, this.draggedId, anchor, side);
      toIndex = finalIds === null ? null : moveTargetForReorder(oldIds, finalIds, this.draggedId);
    } else {
      toIndex = anchor === null ? 0 : crossParentTargetIndex(oldIds, this.draggedId, anchor, side);
    }
    if (toIndex === null) return;
    doc.transact(() => doc.moveBlock(this.draggedId, parentId, toIndex));
  }

  /**
   * The slot the pointer names, or null (no row, the row is the item's
   * own subtree, or the side target's parent does not accept list
   * items). The innermost row whose band contains the pointer is the
   * hovered row; the pointer's vertical half names the side, and the
   * right band (past 1.5 run-indents) names a nested drop into a
   * hovered list item.
   */
  private slotForPointer(event: PointerEvent): Slot | null {
    const { store } = this.options;
    if (this.root === null || this.wrapper === null) return null;
    const rows = [...this.root.querySelectorAll<HTMLElement>("[data-block-id]")].filter(
      (el) => el !== this.wrapper && !this.wrapper!.contains(el) && el.dataset.slot !== "docblocks/block-content"
    );
    const matches = rows.filter((el) => {
      const rect = el.getBoundingClientRect();
      return (
        event.clientX >= rect.left - ROW_TOLERANCE_PX &&
        event.clientX <= rect.right + ROW_TOLERANCE_PX &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    });
    const hovered = matches.find((el) => !matches.some((other) => other !== el && el.contains(other)));
    if (hovered === undefined) return null;
    const hoveredId = hovered.dataset.blockId ?? null;
    if (hoveredId === null) return null;
    const rect = hovered.getBoundingClientRect();
    const indent = this.indentOf(hovered);
    const hoveredType = store.getState().blocks[hoveredId]?.type;
    if (event.clientX > rect.left + 1.5 * indent && hoveredType === "list-item") {
      return { kind: "into", host: hoveredId };
    }
    // The parent is the nearest block ancestor (the row itself carries the
    // id; null is the root).
    const parentEl = hovered.parentElement?.closest<HTMLElement>("[data-block-id]");
    const parentId = parentEl?.dataset.blockId ?? null;
    const parentType = parentId === null ? "root" : store.getState().blocks[parentId]?.type;
    if (parentId !== null && parentType !== "list-item") return null;
    const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    return { kind: "side", anchor: hoveredId, side, parent: parentId };
  }

  /** The run indent (the hovered row's list padding-left) in pixels. */
  private indentOf(row: HTMLElement): number {
    const list = row.closest<HTMLElement>("[data-slot='docblocks/list']");
    if (list === null) return INDENT_FALLBACK_PX;
    const padding = parseFloat(getComputedStyle(list).paddingLeft);
    return Number.isFinite(padding) && padding > 0 ? padding : INDENT_FALLBACK_PX;
  }

  /** Places the drop line at the slot (or hides it); coordinates are editor-root relative. */
  private positionLine(slot: Slot | null) {
    const line = this.line;
    if (line === null) return;
    if (slot === null || this.root === null) {
      line.style.display = "none";
      return;
    }
    const hovered =
      slot.kind === "into"
        ? this.root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(slot.host)}"]`)
        : this.root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(slot.anchor)}"]`);
    if (hovered === null) {
      line.style.display = "none";
      return;
    }
    const hoveredRect = hovered.getBoundingClientRect();
    const rootRect = this.root.getBoundingClientRect();
    let top: number;
    let left: number;
    let width: number;
    if (slot.kind === "into") {
      const indent = this.indentOf(hovered);
      // The host's children live in its nested list (direct li rows).
      const firstChild = hovered.querySelector<HTMLElement>(':scope > [data-slot="docblocks/list"] > [data-block-id]');
      const childRect = firstChild !== null ? firstChild.getBoundingClientRect() : null;
      left = (childRect !== null ? childRect.left : hoveredRect.left + indent) - rootRect.left;
      width = childRect !== null ? childRect.width : Math.max(0, hoveredRect.width - indent);
      top = (childRect !== null ? childRect.top : hoveredRect.bottom) - 1 - rootRect.top;
    } else {
      top = (slot.side === "before" ? hoveredRect.top : hoveredRect.bottom) - 1 - rootRect.top;
      left = hoveredRect.left - rootRect.left;
      width = hoveredRect.width;
    }
    line.style.left = `${left}px`;
    line.style.top = `${top}px`;
    line.style.width = `${width}px`;
    line.style.display = "block";
  }
}

export { useListDrag };
