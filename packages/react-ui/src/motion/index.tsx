/**
 * docblocks-react-ui/motion — the animated editor view.
 *
 * framer-motion is an optional peer dependency and is imported only from
 * this subpath: the base entry (`docblocks-react-ui`) never imports it,
 * so a consumer without the package ships zero extra weight.
 *
 * `MotionEditor` is a drop-in replacement for the base `Editor` under the
 * same `EditorProvider` — the same root element (the focus/keyboard
 * scope), the same block rendering and editing wiring, and the same
 * presence overlay. The top-level block list renders through
 * `AnimatePresence` (`popLayout`): an inserted entry fades in as its
 * height grows, a removed one fades out as it collapses. The siblings'
 * position slides on a reorder (a drag or a remote move) and while a
 * leaving entry pops out of the layout. The slide is position-only — a
 * size projection would scale an entry while its content height settles
 * and distort the text. The layout projection is armed on every entry at
 * all times — an entry whose layout feature toggles with the slide state
 * (unmounting between renders) does not slide reliably when a live
 * reorder commits — and the slide is gated by the per-value layout
 * transition duration instead: the 0.18 s slide runs only while a drag
 * or a structural settle is in flight, 0 otherwise, so an in-place
 * height change (typing, a line break, a remote edit) reflows instantly.
 * The entry being dragged renders its height as a gap in the flow (its
 * content lifts out and floats at the pointer on its own transform), so
 * the gap — not the floating content — is what the projection slides.
 *
 * v1 scope: the root list only — nested list items and table-cell
 * children animate plain. A list group is keyed by its first id, so a
 * group whose head is unchanged reflows without an item-level exit
 * animation; removing the head re-animates the whole group.
 *
 * Drag-reorder: framer-motion's `Reorder` reorders the root entries — a
 * single non-list block is dragged by its gutter handle (the handle is
 * the only drag trigger; a press without movement stays the plain block
 * selection, and root blocks without a handle — image, divider, table —
 * are reorder targets but not drag sources). A list run is an atomic
 * entry (a dragged block lands before or after the whole run), and the
 * non-root blocks — a list item of every level and a child of a text
 * container (the Tab-nested content) — drag through the custom
 * block-drag session (block-drag): the block lifts and follows the
 * pointer, and the hovered row's vertical half names the side, and its
 * horizontal band the level — a pointer in a row's right band drops the
 * block into a hovered list item or text container (as its first child,
 * when the registry's child types allow it), anywhere else the block
 * drops at the hovered row's own level (its parent's children, accepted
 * when the registry allows the dragged type there), which may re-parent
 * it across levels or back to the root; a pointer over the block's own
 * subtree or past every row's band names no slot and snaps back.
 *
 * The gutter drag is a pointer session, not a framer `drag`: the virtual
 * order is decided from the pointer against the siblings' layout centers
 * (`offsetTop`, unaffected by the projection transforms) — a crossing is
 * decided where the pointer is, not where the dragged entry's projected
 * position is. Framer's own reorder detection would decide off the
 * entry's layout slot plus its drag offset, and the offset re-baselines
 * a frame late after every live reorder, so a downward drag cascades the
 * virtual index through every remaining slot (the entry commits to the
 * bottom regardless of the drop point). Framer's `Reorder` is still what
 * the entries render as: the session's live reorder commits a DOM reorder
 * and each crossed entry settles into its slot with the 0.18 s projection
 * slide.
 *
 * One drag issues one `moveBlock` (one undo step, one wire update): the
 * pre-move target index is computed from the old vs. new order on release;
 * a drag that ends at the same position issues no command. While a drag
 * runs the entry being dragged is lifted: a transparent gap of the
 * entry's height slides with the live reorder (a plain in-flow div — the
 * entry's height is a framer-managed value, so the gap is not the
 * Reorder.Item itself), while its content floats above the list at the
 * pointer on its own transform — the pointer offset, never re-baselined,
 * so the block tracks the pointer 1:1 at any drag speed (a projection on
 * it would make the block jump). On release the content slides into the
 * in-flow slot (0.18 s) and the lift is dropped. A press that never moves
 * past the lift threshold is a plain click (the block selection).
 *
 * Known v1 edge (accepted, no protection): a remote doc update mid-drag
 * re-derives the entry list and re-lays the group out; the in-flight
 * drag may visually restart, and a reorder order stale against the store
 * is dropped on release (no commit).
 *
 * The exit animation pops the leaving entry out of layout (popLayout)
 * against the editor root's `position: relative` — import the package
 * stylesheet (or an equivalent positioned editor root) for the exit to
 * anchor inside the editor.
 */
import { AnimatePresence, Reorder } from "framer-motion";
import { useStore } from "zustand";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { Block, BlockId, ListItemAttrs } from "docblocks-core";

import type { EditorView } from "../Editor";
import { useEditorContext } from "../EditorProvider";
import { BlockView, groupChildren } from "../blocks/BlockView";
import { CanvasView } from "../blocks/CanvasView";
import { BlockContext } from "../blocks/block-context";
import { FORMAT_PALETTE, useFormatToolbar } from "../editing/format-toolbar";
import { SlashMenuContext, useSlashMenu } from "../editing/slash";
import { useEditing } from "../editing/useEditing";
import { PresenceCaretOverlay } from "../presence/presence-caret";
import { cn } from "../shared/ui/cn";
import { useBlockDrag } from "./block-drag";
import { moveTargetForReorder } from "./reorder";

/**
 * The enter/exit geometry of a top-level entry. The spacing margin
 * collapses on exit so a leaving entry does not keep its gap.
 */
const ENTER = { opacity: 0, height: 0 } as const;
const ANIMATE = { opacity: 1, height: "auto" } as const;
const EXIT = { opacity: 0, height: 0, marginBottom: 0 } as const;

/**
 * The enter/exit and layout-slide transition (one snappy ease). The
 * between-slots reflow while a drag runs (the lifted entry's gap and the
 * entries slide into each crossed slot) runs the layout arm of this
 * transition (gated per-value: 0 while the slide is disarmed); the
 * dragged entry's content settles into its slot on its own transform
 * transition (the same ease, written inline on release), not the
 * projection.
 */
const TRANSITION = { duration: 0.18, ease: "easeOut" } as const;

/** How long the layout slide stays armed after a structural render (the slide itself runs 0.18s). */
const SLIDE_SETTLE_MS = 400;

/** The pointer travel (from the press) that engages the lift; a press that stays inside it is a plain click (the block selection). */
const LIFT_THRESHOLD_PX = 4;

/**
 * The drag affordance: the handle shows the grab cursor in this view
 * only — the rule is scoped to the root attribute below, so the base
 * editor keeps the stylesheet's plain pointer cursor.
 */
const HANDLE_GRAB_STYLE = '[data-docblocks-motion] [data-slot="docblocks/gutter"] { cursor: grab; }';

/** One reorder entry: a single root block, or a whole list group. */
type Entry =
  | { kind: "single"; key: BlockId; id: BlockId }
  | { kind: "list"; key: string; tag: "ul" | "ol"; list: ListItemAttrs["list"]; ids: BlockId[] };

/** Shallow array equality (order matters). */
function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/** The entry keys for a store snapshot (the drag-free resync source). */
function keysOf(rootChildren: BlockId[], blocks: Record<BlockId, Block>): string[] {
  return groupChildren(rootChildren, blocks).map((group) =>
    group.kind === "single" ? group.id : `list-${group.ids[0]}`
  );
}

interface EntryItemProps {
  entry: Entry;
  /** Register the entry's wrapper and content elements (the drag lift pins the lifted content to the pointer through them). */
  registerEls: (key: string, wrapper: HTMLElement | null, content: HTMLElement | null) => void;
  /** The position-only layout slide armed (a drag in flight, a structural settle): selects the entries' layout transition. */
  layoutSlide: boolean;
  /** This entry is the one being dragged: its wrapper keeps the entry's height as a gap (the content is lifted out of the flow and pinned to the pointer), so the live reorder slides the gap, not the floating content. */
  isDragged: boolean;
  /** The lifted entry's wrapper height (the gap), the natural height measured at drag start. */
  dragHeight: number;
}

/**
 * One root entry as a `Reorder.Item`: a single block (draggable from the
 * gutter handle) or a list group (no drag — the stable value keeps the
 * group atomic, so a dragged block lands before or after the whole
 * group). The drag itself is the session's pointer state (see the module
 * docs), not a framer `drag` — the Reorder.Item provides the layout
 * projection (the slide into a crossed slot) only.
 */
function EntryItem({ entry, registerEls, layoutSlide, isDragged, dragHeight }: EntryItemProps) {
  const single = entry.kind === "single";
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    registerEls(entry.key, wrapperRef.current, contentRef.current);
    return () => registerEls(entry.key, null, null);
  }, [entry.key, registerEls]);

  return (
    <Reorder.Item
      as="div"
      ref={wrapperRef}
      value={entry.key}
      initial={ENTER}
      animate={ANIMATE}
      exit={EXIT}
      // Per-value: the enter/exit geometry keeps the snappy slide; the
      // layout animation runs the 0.18 s slide only while the slide is
      // armed (a drag in flight, a structural settle) and 0 otherwise —
      // an in-place content change reflows instantly (a zero-duration
      // projection, not a visible slide).
      transition={{
        opacity: TRANSITION,
        height: TRANSITION,
        marginBottom: TRANSITION,
        layout: layoutSlide ? TRANSITION : { duration: 0 },
      }}
      // Position-only, always armed: a size projection would scale an
      // entry while its content height settles (the text squashes or
      // stretches). The lifted entry's wrapper keeps the projection too:
      // it renders the gap (its height is fixed for the drag) and the gap
      // slides with the live reorder; the floating content is pinned to
      // the pointer by its own transform, not the projection (see the
      // module docs).
      layout="position"
      style={isDragged ? { position: "relative", zIndex: 10 } : undefined}
      // Framer's own drag is disarmed on every entry: the session owns the
      // pointer (the root singles through the lift, the list items and the
      // text-container children through the block-drag session). Without
      // this a press on a list item's gutter would start a framer drag of
      // the whole list-run entry, distorting the session's row geometry.
      dragListener={false}
    >
      {/* The gap: a plain in-flow placeholder of the entry's height (the
          content is lifted out of the flow), so the live reorder slides a
          visible gap. A plain div on purpose — the entry's height is a
          framer-managed value (the enter/exit animation), so the height
          must not be set on the Reorder.Item element itself. */}
      {isDragged ? <div style={{ height: dragHeight }} aria-hidden /> : null}
      <div
        ref={contentRef}
        style={
          isDragged ? { position: "absolute", left: 0, top: 0, width: "100%", willChange: "transform" } : undefined
        }
      >
        {single ? (
          <BlockView id={entry.id} />
        ) : (
          <entry.tag
            data-slot="docblocks/list"
            data-list={entry.list}
            data-depth={1}
            className={cn(
              "my-(--docblocks-block-spacing) pl-(--docblocks-list-padding-left)",
              entry.list === "task" ? "list-none" : entry.list === "bullet" ? "list-disc" : "list-decimal"
            )}
          >
            {entry.ids.map((childId) => (
              <BlockView key={childId} id={childId} />
            ))}
          </entry.tag>
        )}
      </div>
    </Reorder.Item>
  );
}

function MotionEditor({
  view = "page",
  formatPalette = FORMAT_PALETTE,
}: {
  view?: EditorView;
  formatPalette?: readonly string[];
}) {
  const { doc, store, rootBlockId } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const blocks = useStore(store, (state) => state.blocks);
  const rootContext = useMemo(() => ({ parentId: rootBlockId, siblings: rootChildren }), [rootBlockId, rootChildren]);
  const { rootRef, onKeyDown, onCopy, onPointerDown: onCrossDragPointerDown } = useEditing();
  const slash = useSlashMenu(rootRef);
  const format = useFormatToolbar(rootRef, formatPalette);
  const blockDragStart = useBlockDrag(rootRef, store, doc, rootBlockId);
  const groups = useMemo(() => groupChildren(rootChildren, blocks), [rootChildren, blocks]);
  const entries = useMemo<Entry[]>(
    () =>
      groups.map((group): Entry =>
        group.kind === "single"
          ? { kind: "single", key: group.id, id: group.id }
          : { kind: "list", key: `list-${group.ids[0]}`, tag: group.tag, list: group.list, ids: group.ids }
      ),
    [groups]
  );
  const entriesByKey = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const entry of entries) map.set(entry.key, entry);
    return map;
  }, [entries]);
  const entryKeys = useMemo(() => entries.map((entry) => entry.key), [entries]);

  /** The local entry order: live during a drag (the virtual order the session's cross detection and the release commit run against), locked to the store otherwise. */
  const [order, setOrder] = useState<string[]>(entryKeys);
  /** The committed order (the session's cross detection reads it; it mirrors the state, refreshed after each render's DOM commit). */
  const orderRef = useRef(order);
  /** The pointer position at the press (the lift threshold is measured from it). */
  const pressRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef<string | null>(null);
  const pendingRef = useRef<string[] | null>(null);
  /** The framer drag key (a state mirror of `draggingRef`: it drives the entries' layout transition and the lift). */
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  /** The lifted entry's wrapper height (the gap), measured at drag start. */
  const [liftHeight, setLiftHeight] = useState<number | null>(null);
  /** The entry wrapper/content elements (the drag lift pins the lifted content to the pointer through them). */
  const entryElsRef = useRef<Map<string, { wrapper: HTMLElement; content: HTMLElement }>>(new Map());
  /** The lift's geometry: the gap height and the pointer's offset from the lifted content's top-left at drag start. */
  const liftRef = useRef<{ height: number; grabX: number; grabY: number } | null>(null);
  /** The latest pointer position (the lift loop runs it into the content's transform). */
  const pointerRef = useRef({ x: 0, y: 0 });
  /** The release settle is in flight (the content slides into the slot on its own transform; the lift loop must not overwrite it). */
  const settleRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  /** True while the lift is live (the content is absolute and pin-transformable): set at drag start, cleared when the lift drops. The pointer-driven pin write is gated on it — a transform on the still-in-flow content would nudge the resting block. */
  const liftActiveRef = useRef(false);
  /** The layout slide armed: a drag in flight or the settle window after a structural change. */
  const [layoutSlide, setLayoutSlide] = useState(false);
  const slideTimerRef = useRef<number | null>(null);
  const prevKeysRef = useRef<string[]>(entryKeys);

  /**
   * Keep the layout slide armed for the settle window after a drag or a
   * structural change, then release it so in-place content changes
   * reflow instantly again (the zero-duration layout transition).
   */
  const armSlide = useCallback(() => {
    if (slideTimerRef.current !== null) window.clearTimeout(slideTimerRef.current);
    slideTimerRef.current = window.setTimeout(() => {
      slideTimerRef.current = null;
      setLayoutSlide(false);
    }, SLIDE_SETTLE_MS);
    setLayoutSlide(true);
  }, []);

  useEffect(
    () => () => {
      if (slideTimerRef.current !== null) window.clearTimeout(slideTimerRef.current);
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    },
    []
  );

  // A store change (remote or local, drag-free) resyncs the local order.
  // The render-phase setState (not an effect) keeps the committed DOM in
  // the store order within the same commit, so new entries mount
  // immediately; mid-drag changes are resynced on release instead.
  if (draggingRef.current === null && !sameKeys(order, entryKeys)) {
    setOrder(entryKeys);
  }

  // Arm the slide for the renders an enter/exit height animation does
  // not drive: a reorder of the surviving entries (a pure reorder, or an
  // insert that also reorders the rest) and any change that removes an
  // entry (its pop leaves the survivors a position delta to slide). A
  // pure insert needs no slide — the entering entry's height growth IS
  // the reflow — and an in-place content change (same keys, same order)
  // reflows instantly with no projection: a size projection would scale
  // the entry while its text settles and distort the content.
  if (prevKeysRef.current !== entryKeys) {
    const prev = prevKeysRef.current;
    const removed = prev.some((key) => !entryKeys.includes(key));
    const prevCommon = prev.filter((key) => entryKeys.includes(key));
    const reordered = !sameKeys(
      prevCommon,
      entryKeys.filter((key) => prev.includes(key))
    );
    if (removed || reordered) armSlide();
    prevKeysRef.current = entryKeys;
  }

  const registerEls = useCallback((key: string, wrapper: HTMLElement | null, content: HTMLElement | null) => {
    if (wrapper === null || content === null) entryElsRef.current.delete(key);
    else entryElsRef.current.set(key, { wrapper, content });
  }, []);

  /** Write the lift pin: the lifted content's transform is the pointer's offset from the (possibly reordered or projected) wrapper's visual box, so the content stays pointer-locked while the wrapper slides with the live reorder. Written from the press's pointermove listener (the pin lands in the same frame as the pointer) and from the rAF loop (the wrapper's box also changes without a pointer event). */
  const writeLiftPin = useCallback(() => {
    const key = draggingRef.current;
    if (key === null || settleRef.current || !liftActiveRef.current) return;
    const els = entryElsRef.current.get(key);
    const lift = liftRef.current;
    if (els === undefined || lift === null) return;
    const box = els.wrapper.getBoundingClientRect();
    els.content.style.transform = `translate(${pointerRef.current.x - lift.grabX - box.left}px, ${pointerRef.current.y - lift.grabY - box.top}px)`;
  }, []);

  /** Engage the lift: the entry's content leaves the flow (absolute, pointer-pinned) and its wrapper keeps the entry's height as the gap. */
  const engageLift = useCallback((key: string) => {
    draggingRef.current = key;
    liftActiveRef.current = true;
    setDraggingKey(key);
    pendingRef.current = null;
    if (liftRef.current !== null) setLiftHeight(liftRef.current.height);
    // A previous release's settle transition may still sit on the content
    // (it was written imperatively — React drops only the styles it set):
    // clear it so this lift's pin writes land untransitioned and the
    // content tracks the pointer 1:1.
    const els = entryElsRef.current.get(key);
    if (els !== undefined) {
      els.content.style.transition = "";
      els.content.style.transform = "";
    }
  }, []);

  /** Re-decide the virtual order at the pointer (the midpoint rule against the siblings' layout centers) and commit it to the local order — the DOM reorder that the projection slides. */
  const updateVirtualOrder = useCallback(() => {
    const key = draggingRef.current;
    const lift = liftRef.current;
    const root = rootRef.current;
    if (key === null || lift === null || root === null) return;
    const rootBox = root.getBoundingClientRect();
    // The dragged entry's center in root coordinates: its top follows the
    // pointer minus the grab offset; its height is the gap's (fixed for
    // the drag). offsetTop is layout-relative — the siblings' projections
    // are transforms, not layout — so a crossing is decided against where
    // the siblings settle, not where they are mid-slide.
    const itemCenter = pointerRef.current.y - rootBox.top - lift.grabY + lift.height / 2;
    const current = orderRef.current;
    const siblings = current.filter((candidate) => candidate !== key);
    let k = 0;
    for (const siblingKey of siblings) {
      const sibling = entryElsRef.current.get(siblingKey);
      if (sibling === undefined) continue;
      if (sibling.wrapper.offsetTop + sibling.wrapper.offsetHeight / 2 < itemCenter) k++;
    }
    const virtual = [...siblings.slice(0, k), key, ...siblings.slice(k)];
    if (!sameKeys(virtual, current)) {
      orderRef.current = virtual;
      pendingRef.current = virtual;
      setOrder(virtual);
    }
  }, []);

  /** Release: commit one moveBlock for the drag (pre-move index), resync the local order to the store (read after the commit), then settle the lifted content into the slot. */
  const finishDrag = useCallback(() => {
    const pending = pendingRef.current;
    const key = draggingRef.current;
    pendingRef.current = null;
    draggingRef.current = null;
    // Keep the slide armed through the release settle: the snap-back and
    // any in-flight reorder slide run out under the layout projection.
    armSlide();
    if (pending !== null && key !== null) {
      const newIds: BlockId[] = [];
      for (const pendingKey of pending) {
        const entry = entriesByKey.get(pendingKey);
        if (entry === undefined) continue;
        if (entry.kind === "single") newIds.push(entry.id);
        else newIds.push(...entry.ids);
      }
      const target = moveTargetForReorder(store.getState().rootChildren, newIds, key);
      if (target !== null) {
        doc.transact(() => {
          doc.moveBlock(key, rootBlockId, target);
        });
      }
    }
    // Resync to the store's order: after a committed drag the store
    // already matches the virtual order (the resync is a no-op), and
    // when the commit was dropped (a remote update changed the order
    // mid-drag) this is what snaps the local order back.
    const state = store.getState();
    const keys = keysOf(state.rootChildren, state.blocks);
    setOrder((prev) => (sameKeys(prev, keys) ? prev : keys));
    // Settle: the lifted content slides from the pointer into the
    // in-flow slot on its own transform transition (the wrapper's
    // reorder already happened live during the drag), and the lift is
    // dropped after the slide finishes so the content re-enters the
    // flow at rest.
    if (key !== null) {
      settleRef.current = true;
      const els = entryElsRef.current.get(key);
      if (els !== undefined) {
        els.content.style.transition = "transform 0.18s ease-out";
        els.content.style.transform = "translate(0px, 0px)";
      }
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        settleRef.current = false;
        liftActiveRef.current = false;
        setDraggingKey(null);
        setLiftHeight(null);
        // The settle's inline transition/transform were written imperatively,
        // not by React — drop them when the lift drops (a leftover
        // `transition: transform` would animate the next drag's pin writes
        // and make the content chase the pointer).
        const settled = entryElsRef.current.get(key);
        if (settled !== undefined) {
          settled.content.style.transition = "";
          settled.content.style.transform = "";
        }
      }, 220);
    }
  }, [armSlide, doc, entriesByKey, rootBlockId, store]);

  /** The gutter handle starts the drag for that block: the pointer session for a root single entry, the custom block-drag session for the rest (a list item of every level, a child of a text container). A plain press without movement stays the block selection. */
  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target === null) return;
      const handle = target.closest('[data-slot="docblocks/gutter"]');
      if (handle === null) return;
      const wrapper = handle.closest("[data-block-id]");
      const blockId = wrapper?.getAttribute("data-block-id") ?? null;
      if (blockId === null) return;
      if (store.getState().blocks[blockId]?.type === "list-item") {
        blockDragStart(event, blockId);
        return;
      }
      if (entriesByKey.get(blockId)?.kind === "single") {
        const els = entryElsRef.current.get(blockId);
        if (els !== undefined) {
          // The lift's geometry, measured now (the content is still in-flow,
          // pre-lift): the gap's height is the entry's natural height, the
          // grab is the pointer's offset from the content's top-left. The
          // lift itself engages on the first move past the threshold —
          // engaging it here, on pointerdown, would re-render the entry
          // (the content lifts out of the flow, the gap appears) under an
          // in-progress press and break a plain gutter click (the
          // selection).
          const contentRect = els.content.getBoundingClientRect();
          liftRef.current = {
            height: els.wrapper.getBoundingClientRect().height,
            grabX: event.clientX - contentRect.left,
            grabY: event.clientY - contentRect.top,
          };
          pointerRef.current = { x: event.clientX, y: event.clientY };
          pressRef.current = { x: event.clientX, y: event.clientY };
          draggingRef.current = blockId;
        }
        // A previous drag's settle is still in flight: drop its lift so
        // this drag owns the drag state.
        if (settleTimerRef.current !== null) {
          window.clearTimeout(settleTimerRef.current);
          settleTimerRef.current = null;
          settleRef.current = false;
          liftActiveRef.current = false;
          setDraggingKey(null);
          setLiftHeight(null);
        }
        // Keep the pointer ref current from the very press: the lift engages
        // only at drag start, and moves in between would otherwise be missed
        // (the first pin would trail the pointer). The write is a no-op until
        // the lift is live (gated in writeLiftPin).
        const onMove = (moveEvent: PointerEvent) => {
          pointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
          // Past the threshold the lift engages for good; from then on
          // every move re-decides the virtual order at the pointer.
          if (!liftActiveRef.current) {
            const dx = moveEvent.clientX - pressRef.current.x;
            const dy = moveEvent.clientY - pressRef.current.y;
            if (Math.hypot(dx, dy) >= LIFT_THRESHOLD_PX) engageLift(blockId);
          }
          writeLiftPin();
          if (liftActiveRef.current) updateVirtualOrder();
        };
        // Release: a live lift commits (one moveBlock + the settle);
        // a plain press (no lift) drops the press state — the click
        // stays the selection.
        const dropPressLift = () => {
          window.removeEventListener("pointermove", onMove);
          if (draggingRef.current !== blockId) return;
          if (liftActiveRef.current) {
            finishDrag();
            return;
          }
          draggingRef.current = null;
          setDraggingKey(null);
          setLiftHeight(null);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", dropPressLift, { once: true });
        return;
      }
      blockDragStart(event, blockId);
    },
    [blockDragStart, engageLift, entriesByKey, finishDrag, store, updateVirtualOrder, writeLiftPin]
  );

  /** The lift loop: while a drag runs, re-write the pin every frame — the wrapper's visual box changes without a pointer event (the live DOM reorder, framer's projection slide while the pointer pauses), and the pin must follow so the content stays at the pointer. The press's pointermove listener covers the moving-pointer case in the same frame. */
  useEffect(() => {
    if (draggingKey === null) return;
    let raf = 0;
    const loop = () => {
      writeLiftPin();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draggingKey, writeLiftPin]);

  /** Re-pin the instant a live reorder commits (the dragged entry's in-flow gap jumps to its new slot, moving the wrapper's box), and mirror the committed order for the session's cross detection. useLayoutEffect runs after the DOM commit and before paint, so the content is re-anchored to the pointer with no visible one-frame snap. */
  useLayoutEffect(() => {
    orderRef.current = order;
    writeLiftPin();
  }, [order, writeLiftPin]);

  // The block-drag handle session and the cross-drag selection session both
  // own the root's pointerdown; the target decides (a gutter handle vs a
  // text inner) and the two are mutually exclusive.
  const onRootPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onCrossDragPointerDown(event);
    onHandlePointerDown(event);
  };

  return (
    <div
      ref={rootRef}
      data-slot="docblocks/editor"
      data-docblocks-motion=""
      data-view={view}
      tabIndex={-1}
      className={cn(
        "relative selection:bg-(--docblocks-selection-background)",
        "font-(family-name:--docblocks-font-family) text-(length:--docblocks-font-size)",
        "leading-(--docblocks-line-height) text-(--docblocks-text-color)",
        // The canvas view grows to fill the flex column container: the 100%
        // height chain below the root needs a definite root height.
        view === "canvas" && "min-h-0 flex-1"
      )}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPointerDown={onRootPointerDown}
    >
      <style>{HANDLE_GRAB_STYLE}</style>
      <SlashMenuContext.Provider value={slash.api}>
        <BlockContext.Provider value={rootContext}>
          {/* The session owns the order (the virtual order is decided at the pointer); the no-op keeps the required prop — framer's own reorder detection no longer runs (there is no framer drag). */}
          {view === "canvas" ? (
            <CanvasView />
          ) : (
            <Reorder.Group as="div" axis="y" values={order} onReorder={() => undefined}>
              <AnimatePresence initial={false} mode="popLayout">
                {order.map((key) => {
                  const entry = entriesByKey.get(key);
                  if (entry === undefined) return null;
                  return (
                    <EntryItem
                      key={key}
                      entry={entry}
                      registerEls={registerEls}
                      layoutSlide={layoutSlide || draggingKey !== null}
                      isDragged={draggingKey === key}
                      dragHeight={liftHeight ?? 0}
                    />
                  );
                })}
              </AnimatePresence>
            </Reorder.Group>
          )}
          <PresenceCaretOverlay rootRef={rootRef} />
        </BlockContext.Provider>
      </SlashMenuContext.Provider>
      {slash.menuNode}
      {format.toolbarNode}
    </div>
  );
}

export { MotionEditor };
