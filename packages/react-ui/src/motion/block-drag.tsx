import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import { BLOCK_REGISTRY, type Block, type BlockId, type BlockType, type Doc } from "docblocks-core";

import type { EditorStore } from "../state/store";
import { crossParentTargetIndex, finalOrderAfterSlotDrop, moveTargetForReorder } from "./reorder";

/** Pointer movement before the lift begins: a press that does not reach it stays a plain click. */
const DRAG_THRESHOLD_PX = 4;

/** How far past a row's edges (left/right) the pointer still names that row. */
const ROW_TOLERANCE_PX = 24;

/** The fallback run indent (pixels) when the computed padding is unavailable. */
const INDENT_FALLBACK_PX = 24;

/**
 * The text container types (the five text types carry an optional
 * `children` — the full page set): the rows whose right band names a
 * nested drop (into the row, as its first child).
 */
const TEXT_CONTAINER_TYPES: readonly BlockType[] = ["paragraph", "heading", "callout", "code", "latex"];

/** A same-side drop: the dragged block lands before/after `anchor` in the anchor's parent's children (the anchor's level). `parent` is the anchor's parent id, or null for the root. */
interface SideSlot {
  kind: "side";
  anchor: BlockId;
  side: "before" | "after";
  parent: BlockId | null;
}

/**
 * A nested drop: the dragged block becomes the first child of `host`
 * (host is a list item or a text container; the pointer sits in the
 * row's right band).
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
 * The custom pointer drag for every non-root block: a list item of any
 * level, or a child of a text container (the Tab-nested content). The
 * block lifts and follows the pointer, a line marks the drop slot, and
 * the release commits one `moveBlock`.
 *
 * The hovered row's vertical half names the side (above its midpoint is
 * "before", below is "after"), and the horizontal band names the level:
 * a pointer in a row's right band (past 1.5 run-indents) drops the block
 * INTO a hovered list item or text container (as its first child, when
 * the registry's child types allow it); anywhere else the block drops at
 * the hovered row's own level (its parent's children — accepted when the
 * registry allows the dragged type there), which may re-parent it across
 * levels or back to the root. A pointer over the block's own subtree or
 * past every row's band names no slot, and the drop snaps back.
 *
 * The framer reorder is not involved — the root runs are not `Reorder`
 * groups for the children, which keeps the native `<ul>`/`<ol>` markup
 * (and its markers) and the `docblocks/nested` slot intact.
 */
function useBlockDrag(rootRef: RefObject<HTMLElement | null>, store: EditorStore, doc: Doc, rootBlockId: BlockId) {
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
    const { rootRef, store } = options;
    const draggedType = store.getState().blocks[draggedId]?.type;
    this.draggedType = draggedType;
    this.root = rootRef.current;
    this.wrapper = this.root?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(draggedId)}"]`) ?? null;
    this.line = this.createLine();
    if (this.wrapper === null || this.line === null || draggedType === undefined) {
      // No resolvable block (or type) or no editor root to anchor the line: nothing to drag.
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
  /** The dragged block's type (the registry's child-type rules apply to it). */
  private readonly draggedType: BlockType | undefined;

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
      // Keep the lifted block out of the row tests below: it follows the
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
    // Dispose unconditionally: a commit that throws (a remote update that
    // slips between the live re-validation and the command) must not pin
    // the session — the double-session guard would kill every later drag.
    try {
      if (lifted && slot !== null) this.move(slot);
    } finally {
      this.dispose();
    }
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
    const { rootRef } = this.options;
    const root = rootRef.current;
    if (root === null) return null;
    const line = document.createElement("div");
    line.setAttribute("data-slot", "docblocks/drag-line");
    line.style.display = "none";
    root.appendChild(line);
    return line;
  }

  /** The registry's child-type rule for one parent type (root included). */
  private parentAccepts(parentType: BlockType, childType: BlockType): boolean {
    const spec = BLOCK_REGISTRY[parentType];
    return spec?.children === true && spec.childrenTypes?.includes(childType) === true;
  }

  /**
   * The block's children ids (the registry's `children` flag guarantees
   * the field on that type; the cast is scoped to this one read, since
   * the `Block` union only carries `children` on its container members).
   * Null when the block is gone or is not a container.
   */
  private childrenOf(block: Block | undefined): BlockId[] | null {
    if (block === undefined || BLOCK_REGISTRY[block.type]?.children !== true) return null;
    return (block as { children?: BlockId[] }).children ?? [];
  }

  /** An into-slot host: a list item or a text container that accepts the dragged type. */
  private isIntoHost(hoveredType: BlockType | undefined): boolean {
    if (hoveredType === undefined || this.draggedType === undefined) return false;
    return this.acceptsInto(hoveredType, this.draggedType);
  }

  /** The into-host rule against explicit types (the commit's live re-validation). */
  private acceptsInto(hoveredType: BlockType | undefined, childType: BlockType): boolean {
    if (hoveredType === undefined) return false;
    if (hoveredType !== "list-item" && !TEXT_CONTAINER_TYPES.includes(hoveredType)) return false;
    return this.parentAccepts(hoveredType, childType);
  }

  private move(slot: Slot) {
    const { store } = this.options;
    const state = store.getState();
    const dragged = state.blocks[this.draggedId];
    // The dragged block was removed by a remote update mid-drag: there is
    // nothing left to move (moving it would throw UnknownBlockError and
    // skip the dispose below).
    if (dragged === undefined) return;
    // The slot's registry validation ran against the types at the start
    // of the drag; a remote changeBlockType before the release can
    // invalidate the move, so the commit re-validates with the live types
    // and drops a stale drop.
    const liveType = dragged.type;
    if (slot.kind === "into") {
      const host = state.blocks[slot.host];
      if (host === undefined || !this.acceptsInto(host.type, liveType)) return;
      const hostChildren = this.childrenOf(host);
      if (hostChildren === null) return;
      this.commit(slot.host, [...hostChildren], null, "before");
      return;
    }
    const { rootBlockId } = this.options;
    const parentId = slot.parent ?? rootBlockId;
    const parentType = parentId === rootBlockId ? "root" : state.blocks[parentId]?.type;
    if (parentType === undefined || !this.parentAccepts(parentType, liveType)) return;
    const oldIds = parentId === rootBlockId ? [...state.rootChildren] : (this.childrenOf(state.blocks[parentId]) ?? []);
    this.commit(parentId, oldIds, slot.anchor, slot.side);
  }

  /**
   * One moveBlock for the slot (pre-move index), dropped when the order
   * is stale or a no-op. Within a parent the drop reorders the children
   * (the final-order chain); across parents the block is not among the
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
   * The slot the pointer names, or null (no row, the row is the block's
   * own subtree, or the side target's parent does not accept the dragged
   * type). The innermost row whose band contains the pointer is the
   * hovered row; the pointer's vertical half names the side, and the
   * right band (past 1.5 run-indents) names a nested drop into a hovered
   * list item or text container (the registry's child types decide).
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
    if (event.clientX > rect.left + 1.5 * indent && this.isIntoHost(hoveredType)) {
      return { kind: "into", host: hoveredId };
    }
    // The parent is the nearest block ancestor (the row itself carries the
    // id; null is the root).
    const parentEl = hovered.parentElement?.closest<HTMLElement>("[data-block-id]");
    const parentId = parentEl?.dataset.blockId ?? null;
    const parentType = parentId === null ? "root" : store.getState().blocks[parentId]?.type;
    if (
      parentType === undefined ||
      this.draggedType === undefined ||
      !this.parentAccepts(parentType, this.draggedType)
    ) {
      return null;
    }
    const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    return { kind: "side", anchor: hoveredId, side, parent: parentId };
  }

  /** The run indent (the hovered row's list padding-left, or the row's own nested-slot padding for a text container) in pixels. */
  private indentOf(row: HTMLElement): number {
    const list = row.closest<HTMLElement>('[data-slot="docblocks/list"]');
    if (list !== null) {
      const padding = parseFloat(getComputedStyle(list).paddingLeft);
      if (Number.isFinite(padding) && padding > 0) return padding;
    }
    const nested = row.querySelector<HTMLElement>(':scope > [data-slot="docblocks/nested"]');
    if (nested !== null) {
      const padding = parseFloat(getComputedStyle(nested).paddingLeft);
      if (Number.isFinite(padding) && padding > 0) return padding;
    }
    return INDENT_FALLBACK_PX;
  }

  /** Places the drop line at the slot (or hides it); coordinates are editor-root relative. */
  private positionLine(slot: Slot | null) {
    const line = this.line;
    if (line === null || this.root === null) return;
    if (slot === null) {
      line.style.display = "none";
      return;
    }
    const hovered = this.root.querySelector<HTMLElement>(
      `[data-block-id="${CSS.escape(slot.kind === "into" ? slot.host : slot.anchor)}"]`
    );
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
      // The line spans the host's child run (its nested list for a list
      // item, its nested slot for a text container), or the host row
      // itself when it has no children yet.
      const indent = this.indentOf(hovered);
      const firstChild =
        hovered.querySelector<HTMLElement>(`:scope > [data-slot="docblocks/list"] > [data-block-id]`) ??
        hovered.querySelector<HTMLElement>(`:scope > [data-slot="docblocks/nested"] > [data-block-id]`);
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

export { useBlockDrag };
