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
 * height grows, a removed one fades out as it collapses, and `layout`
 * reflows the siblings while an entry enters, exits, or the order
 * changes.
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
 * entry (a dragged block lands before or after the whole run), and its
 * items drag through the custom list-drag session (list-drag): a list
 * item lifts and follows the pointer at every nesting level. The
 * hovered row's vertical half names the side, and its horizontal band
 * the level — a pointer in the row's right band drops the item into a
 * hovered list item (as its first child), anywhere else the item drops
 * at the hovered row's level (its parent's children), which may
 * re-parent it across levels; a pointer over the item's own subtree or
 * past every row's band names no slot and snaps back.
 *
 * One drag issues one `moveBlock` (one undo step, one wire update): for
 * the framer drag the pre-move target index is computed from the old vs.
 * new order on release; a drag that ends at the same position issues no
 * command.
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
import { AnimatePresence, type DragControls, Reorder, useDragControls } from "framer-motion";
import { useStore } from "zustand";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useListDrag } from "./list-drag";
import { moveTargetForReorder } from "./reorder";

/**
 * The enter/exit geometry of a top-level entry. The spacing margin
 * collapses on exit so a leaving entry does not keep its gap.
 */
const ENTER = { opacity: 0, height: 0 } as const;
const ANIMATE = { opacity: 1, height: "auto" } as const;
const EXIT = { opacity: 0, height: 0, marginBottom: 0 } as const;

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
  register: (key: string, controls: DragControls | null) => void;
  onDragStart: (key: string) => void;
  onDragEnd: () => void;
}

/**
 * One root entry as a `Reorder.Item`: a single block (draggable from the
 * gutter handle) or a list group (no drag — the stable value keeps the
 * group atomic, so a dragged block lands before or after the whole
 * group).
 */
function EntryItem({ entry, register, onDragStart, onDragEnd }: EntryItemProps) {
  const controls = useDragControls();
  const single = entry.kind === "single";

  useEffect(() => {
    if (!single) return;
    register(entry.key, controls);
    return () => register(entry.key, null);
  }, [entry, controls, register, single]);

  return (
    <Reorder.Item
      as="div"
      value={entry.key}
      initial={ENTER}
      animate={ANIMATE}
      exit={EXIT}
      dragListener={false}
      dragControls={single ? controls : undefined}
      onDragStart={single ? () => onDragStart(entry.key) : undefined}
      onDragEnd={single ? onDragEnd : undefined}
    >
      {single ? (
        <BlockView id={entry.id} />
      ) : (
        <entry.tag data-slot="docblocks/list" data-list={entry.list} data-depth={1}>
          {entry.ids.map((childId) => (
            <BlockView key={childId} id={childId} />
          ))}
        </entry.tag>
      )}
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
  const { rootRef, onKeyDown } = useEditing();
  const slash = useSlashMenu(rootRef);
  const format = useFormatToolbar(rootRef, formatPalette);
  const listDragStart = useListDrag(rootRef, store, doc, rootBlockId);
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

  /** The drag's local order: live during a drag, locked to the store otherwise. */
  const [order, setOrder] = useState<string[]>(entryKeys);
  const controlsRef = useRef<Map<string, DragControls>>(new Map());
  const draggingRef = useRef<string | null>(null);
  const pendingRef = useRef<string[] | null>(null);

  // A store change (remote or local, drag-free) resyncs the local order.
  // The render-phase setState (not an effect) keeps the committed DOM in
  // the store order within the same commit, so new entries mount
  // immediately; mid-drag changes are resynced on release instead.
  if (draggingRef.current === null && !sameKeys(order, entryKeys)) {
    setOrder(entryKeys);
  }

  const registerControls = useCallback((key: string, controls: DragControls | null) => {
    if (controls === null) controlsRef.current.delete(key);
    else controlsRef.current.set(key, controls);
  }, []);

  /** The gutter handle starts the drag for that block: the custom list-drag session for list items (every level), the framer drag for the rest. A plain press without movement stays the block selection. */
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
        listDragStart(event, blockId);
        return;
      }
      controlsRef.current.get(blockId)?.start(event);
    },
    [listDragStart, store]
  );

  const onEntryDragStart = useCallback((key: string) => {
    draggingRef.current = key;
    pendingRef.current = null;
  }, []);

  const onReorder = useCallback((newOrder: string[]) => {
    pendingRef.current = newOrder;
    setOrder(newOrder);
  }, []);

  /** Release: commit one moveBlock for the drag (pre-move index), then resync the local order to the store. */
  const finishDrag = useCallback(() => {
    const pending = pendingRef.current;
    const key = draggingRef.current;
    pendingRef.current = null;
    draggingRef.current = null;
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
    // Resync to the store's order: after a committed drag the render-phase
    // guard suffices, but when the commit was dropped (a remote update
    // changed the order mid-drag) nothing else re-triggers it, so this is
    // what snaps the local order back.
    const state = store.getState();
    const keys = keysOf(state.rootChildren, state.blocks);
    setOrder((prev) => (sameKeys(prev, keys) ? prev : keys));
  }, [doc, entriesByKey, rootBlockId, store]);

  return (
    <div
      ref={rootRef}
      data-slot="docblocks/editor"
      data-docblocks-motion=""
      data-view={view}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={onHandlePointerDown}
    >
      <style>{HANDLE_GRAB_STYLE}</style>
      <SlashMenuContext.Provider value={slash.api}>
        <BlockContext.Provider value={rootContext}>
          {view === "canvas" ? (
            <CanvasView />
          ) : (
            <Reorder.Group as="div" axis="y" values={order} onReorder={onReorder}>
              <AnimatePresence initial={false} mode="popLayout">
                {order.map((key) => {
                  const entry = entriesByKey.get(key);
                  if (entry === undefined) return null;
                  return (
                    <EntryItem
                      key={key}
                      entry={entry}
                      register={registerControls}
                      onDragStart={onEntryDragStart}
                      onDragEnd={finishDrag}
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
