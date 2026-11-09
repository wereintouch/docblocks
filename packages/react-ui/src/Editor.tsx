import { useStore } from "zustand";

import { useMemo, useRef } from "react";

import {
  BlockContext,
  CanvasView,
  FormatPaletteContext,
  collapseEmptyTextChains,
  deriveFlat,
  entrySequenceParent,
  isEmptyChainText,
  visibleRows,
} from "./blocks";
import type { FlatNode } from "./blocks";
import { EnumOptionsMotionSlot } from "./database";
import { FORMAT_PALETTE, useFormatToolbar } from "./editing/format-toolbar";
import { MentionMenuContext, useMentionMenu } from "./editing/mention";
import { SlashMenuContext, useSlashMenu } from "./editing/slash";
import { useEditing } from "./editing/use-editing";
import { useEditorContext } from "./editor-provider";
import { MotionEnumOptionsEditor } from "./motion/MotionEnumOptionsEditor";
import { RowList } from "./motion/RowList";
import { HANDLE_GRAB_STYLE } from "./motion/constants";
import { useEnterAnimationGate, useTypingFlag } from "./motion/hooks";
import { useMotionDrag } from "./motion/use-motion-drag";
import { PresenceCaretOverlay } from "./presence";
import { Card } from "./shared/ui/Card";
import { cn } from "./shared/ui/cn";

/**
 * The document's view mode: the page flow (the root's children in reading
 * order) or the canvas (the page as a miniature rectangle plus the surface
 * elements on one canvas). View state — switching writes nothing to the
 * data (like the selection).
 */
type EditorView = "page" | "canvas";

interface EditorProps {
  view?: EditorView;
  /** The format toolbar's color palette (the default six colors). */
  formatPalette?: readonly string[];
}

/**
 * The document's editor: the root is the editor's focus/keyboard scope
 * (the undo/redo hotkeys only fire for keys targeted inside it), and the
 * root block context is provided for every entry (the entry list's
 * siblings, and the entry root's sequence container as the gestures'
 * command parent — a subtree entry root is a page block, structurally
 * childless, so its commands target the container of its sequence, not
 * itself).
 *
 * The `view` prop selects the rendering: "page" (default) is the flat page
 * sequence — every page block is its own `Reorder.Item` row (the nesting is
 * the block's `indent` attr; a list item's marker is a rendered label per
 * row), the top-level rows render through `AnimatePresence` (`sync`), and
 * the drag-reorder is pure framer `Reorder` (one drag = one range move of
 * the dragged block's derived subtree — see the `motion` segment);
 * "canvas" renders the document's page as a page miniature and the
 * root-level surfaces' elements on one canvas (see CanvasView). The
 * `formatPalette` prop overrides the floating format toolbar's color
 * palette.
 */
function Editor({ view = "page", formatPalette = FORMAT_PALETTE }: EditorProps) {
  const { doc, store, rootBlockId, viewMode } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  // The sequence-structure stamp (the derivation's key): a text-only edit
  // stands nothing here — the edited row re-renders through its own
  // subscription, the row list and the rows' framer fibers stand.
  const seqStamp = useStore(store, (state) => state.seqStamp);
  const collapsedIds = useStore(store, (state) => state.collapsedIds);
  // The page view's sequence: the root's children minus the surfaces (a
  // surface is a canvas layer, not a page block — its whole surface renders
  // in the canvas view only; a stray one would otherwise delete its entire
  // content through the page's Delete path). The filter keys on the
  // structure inputs (the root's children + the stamp) and reads the blocks
  // map from the store's live state — the same read the derivation below
  // does, so the row list's re-render contract stands (a text-only edit
  // stands nothing here).
  const pageChildren = useMemo(
    () => rootChildren.filter((id) => store.getState().blocks[id]?.type !== "surface"),
    [rootChildren, seqStamp, store]
  );
  // The gestures' command parent: the entry root's sequence container.
  const rootContext = useMemo(
    () => ({ parentId: entrySequenceParent(doc, rootBlockId), siblings: rootChildren }),
    [doc, rootBlockId, rootChildren]
  );
  const { rootRef, onKeyDown, onCopy, onPointerDown: onCrossDragPointerDown } = useEditing();
  const slash = useSlashMenu(rootRef);
  const mention = useMentionMenu(rootRef);
  const format = useFormatToolbar(rootRef, formatPalette);
  useTypingFlag(rootRef);
  const enterGate = useEnterAnimationGate(rootRef);

  // The flat page sequence, derived per structure change (the store stays a
  // flat map projection). The interning cache: the previous derivation's
  // byId stands while the sequence's data is unchanged (the row memo is
  // keyed on the node identity). The blocks map is read from the store's
  // live state (the stamp and the map advance in the same atomic write —
  // the map stands fresh whenever the stamp does).
  const prevRef = useRef<Map<string, FlatNode> | null>(null);
  const derivation = useMemo(() => {
    const result = deriveFlat(pageChildren, store.getState().blocks, prevRef.current ?? undefined);
    prevRef.current = result.byId;
    return result;
  }, [pageChildren, seqStamp, store]);
  // The visible rows: the sequence with every collapsed block's derived
  // segment unmounted (a view-state skip — the rows stand in the
  // data; the local drag order and the commit run over the visible rows).
  const rowKeys = useMemo(
    () => visibleRows(pageChildren, derivation.byId, collapsedIds),
    [pageChildren, derivation, collapsedIds]
  );
  const nodesById = derivation.byId;
  // The read-only stand (the view / published's modes): the consecutive
  // empty text blocks' chain stands rendered as one (the chain's first
  // block) — the data stands untouched. The digest stands the remote's
  // empty's flip (the view's stand reads the live's doc — the peer's
  // write's stand is the collapse's input). The edit's mode stands no
  // digest (the collapse's stand is off).
  const emptyKey = useStore(store, (state) =>
    viewMode
      ? pageChildren
          .map((id) => {
            const block = state.blocks[id];
            return isEmptyChainText(block) ? "o" : block === undefined ? "-" : ".";
          })
          .join("")
      : ""
  );
  const collapsedRowKeys = useMemo(() => {
    if (!viewMode) return rowKeys;
    const nodes: FlatNode[] = [];
    for (const id of rowKeys) {
      const node = nodesById.get(id);
      if (node !== undefined) nodes.push(node);
    }
    return collapseEmptyTextChains(nodes, (id) => isEmptyChainText(store.getState().blocks[id])).map((node) => node.id);
  }, [rowKeys, viewMode, emptyKey, nodesById, store]);

  const { order, draggingKey, previewIndent, layoutSlide, onRowDragStart, onRowDragMove, onRowDragEnd, onRowReorder } =
    useMotionDrag({ doc, rootBlockId, store, rootRef, rowKeys: collapsedRowKeys, nodesById });

  return (
    // The shared Card carries the editor's frame chrome (border, radius,
    // the card surface). In the canvas view it takes the flex column's
    // slack: the 100% height chain below the root needs a definite height.
    // The inner div is the editor root: the focus and keyboard scope and
    // the token-mapping scope.
    <Card className={cn(view === "canvas" && "min-h-0 flex-1")}>
      {/* The database's enum's options' editor stands the motion's variant
          (the framer's Reorder's rows) over this provider — the database
          block's grid renders through the base's BlockView, so the swap
          stands the context, not the renderer's registry. */}
      <EnumOptionsMotionSlot.Provider value={MotionEnumOptionsEditor}>
        <div
          ref={rootRef}
          data-slot="docblocks/editor"
          data-docblocks-motion=""
          data-view={view}
          data-readonly={viewMode ? "true" : undefined}
          tabIndex={-1}
          className={cn(
            "relative min-h-0 flex-1 selection:bg-(--docblocks-selection-background)",
            "font-(family-name:--docblocks-font-family) text-(length:--docblocks-font-size)",
            "leading-(--docblocks-line-height) text-(--docblocks-text-color)"
          )}
          onKeyDown={onKeyDown}
          onCopy={onCopy}
          onPointerDown={onCrossDragPointerDown}
        >
          <style>{HANDLE_GRAB_STYLE}</style>
          <MentionMenuContext.Provider value={mention.api}>
            <SlashMenuContext.Provider value={slash.api}>
              <FormatPaletteContext.Provider value={formatPalette}>
                <BlockContext.Provider value={rootContext}>
                  {view === "canvas" ? (
                    <CanvasView />
                  ) : (
                    // The page's content column: the derived max width over
                    // the centered stand (the block content's width — the
                    // --docblocks-page-max-width token — + the two gutter
                    // paddings: the token stands on the blocks, the paddings
                    // stand outside it; the symmetric margins over the wide
                    // window, the full width over the narrow one) + the
                    // padding (the gutter band stands inside the column, so
                    // the grip follows the content's edge, not the
                    // viewport's). The canvas view owns its own viewport and
                    // is unpadded.
                    <div
                      data-slot="docblocks/page"
                      className="
                        mx-auto w-full max-w-(--docblocks-page-column-max-width) px-(--docblocks-page-padding-x)
                      "
                    >
                      <RowList
                        order={order}
                        nodesById={nodesById}
                        layoutSlide={layoutSlide || draggingKey !== null}
                        draggingKey={draggingKey}
                        previewIndent={previewIndent}
                        animated={enterGate.current}
                        onReorder={onRowReorder}
                        onDragStart={onRowDragStart}
                        onDragMove={onRowDragMove}
                        onDragEnd={onRowDragEnd}
                      />
                    </div>
                  )}
                  {viewMode ? null : <PresenceCaretOverlay rootRef={rootRef} />}
                </BlockContext.Provider>
              </FormatPaletteContext.Provider>
            </SlashMenuContext.Provider>
          </MentionMenuContext.Provider>
          {slash.menuNode}
          {mention.menuNode}
          {viewMode ? null : format.toolbarNode}
        </div>
      </EnumOptionsMotionSlot.Provider>
    </Card>
  );
}

export { Editor };
export type { EditorView };
