/**
 * `MotionEditor` — the animated editor view, a drop-in replacement for the
 * base `Editor` under the same `EditorProvider`: the same root element
 * (the focus/keyboard scope), the same block rendering and editing
 * wiring, and the same presence overlay. The page view renders the FLAT
 * page sequence (every page block is its own `Reorder.Item` row), the
 * top-level rows render through `AnimatePresence` (`sync`), and the
 * drag-reorder is pure framer `Reorder` (one drag = one range move of the
 * dragged block's derived subtree).
 */
import { useStore } from "zustand";

import { useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { EditorView } from "../Editor";
import {
  BlockContext,
  CanvasView,
  FormatPaletteContext,
  deriveFlat,
  entrySequenceParent,
  visibleRows,
} from "../blocks";
import type { FlatNode } from "../blocks";
import { EnumOptionsMotionSlot } from "../database";
import { FORMAT_PALETTE, useFormatToolbar } from "../editing/format-toolbar";
import { MentionMenuContext, useMentionMenu } from "../editing/mention";
import { SlashMenuContext, useSlashMenu } from "../editing/slash";
import { useEditing } from "../editing/useEditing";
import { useEditorContext } from "../editor-provider";
import { PresenceCaretOverlay } from "../presence";
import { Card } from "../shared/ui/Card";
import { cn } from "../shared/ui/cn";
import { MotionEnumOptionsEditor } from "./MotionEnumOptionsEditor";
import { RowList } from "./RowList";
import { HANDLE_GRAB_STYLE } from "./constants";
import { useEnterAnimationGate, useTypingFlag } from "./hooks";
import { useMotionDrag } from "./use-motion-drag";

function MotionEditor({
  view = "page",
  formatPalette = FORMAT_PALETTE,
}: {
  view?: EditorView;
  formatPalette?: readonly string[];
}) {
  const { doc, store, rootBlockId } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  // The sequence-structure stamp (the derivation's key): a text-only edit
  // stands nothing here — the edited row re-renders through its own
  // subscription, the row list and the rows' framer fibers stand.
  const seqStamp = useStore(store, (state) => state.seqStamp);
  const collapsedIds = useStore(store, (state) => state.collapsedIds);
  // The gestures' command parent: the entry root's sequence container (a
  // subtree entry root is a page block — structurally childless, so its
  // commands target the container of its sequence, not itself).
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
  // flat map projection). The stamp's rule: every derivation-affecting
  // change bumps it (a text/mark change stands nothing — the interned rows
  // keep their identity and the block's own subscription re-renders it).
  // The interning cache: the previous derivation's byId stands while the
  // sequence's data is unchanged (the row memo is keyed on the node
  // identity). The blocks map is read from the store's live state (the
  // stamp and the map advance in the same atomic write — the map stands
  // fresh whenever the stamp does).
  const prevRef = useRef<Map<string, FlatNode> | null>(null);
  const derivation = useMemo(() => {
    const result = deriveFlat(rootChildren, store.getState().blocks, prevRef.current ?? undefined);
    prevRef.current = result.byId;
    return result;
  }, [rootChildren, seqStamp, store]);
  // The visible rows: the sequence with every collapsed block's derived
  // segment unmounted (a view-state skip — the rows stand in the
  // data; the local drag order and the commit run over the visible rows).
  const rowKeys = useMemo(
    () => visibleRows(rootChildren, derivation.byId, collapsedIds),
    [rootChildren, derivation, collapsedIds]
  );
  const nodesById = derivation.byId;

  const { order, draggingKey, previewIndent, layoutSlide, onRowDragStart, onRowDragMove, onRowDragEnd, onRowReorder } =
    useMotionDrag({ doc, rootBlockId, store, rootRef, rowKeys, nodesById });

  // The cross-drag selection session owns the root's pointerdown (the
  // rows' drag start is the gutter handle's pointerdown — a text inner
  // press and a gutter press are mutually exclusive targets).
  const onRootPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onCrossDragPointerDown(event);
  };

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
          tabIndex={-1}
          className={cn(
            "relative min-h-0 flex-1 selection:bg-(--docblocks-selection-background)",
            "font-(family-name:--docblocks-font-family) text-(length:--docblocks-font-size)",
            "leading-(--docblocks-line-height) text-(--docblocks-text-color)"
          )}
          onKeyDown={onKeyDown}
          onCopy={onCopy}
          onPointerDown={onRootPointerDown}
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
                      className="mx-auto w-full max-w-(--docblocks-page-column-max-width) px-(--docblocks-page-padding-x)"
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
                  <PresenceCaretOverlay rootRef={rootRef} />
                </BlockContext.Provider>
              </FormatPaletteContext.Provider>
            </SlashMenuContext.Provider>
          </MentionMenuContext.Provider>
          {slash.menuNode}
          {mention.menuNode}
          {format.toolbarNode}
        </div>
      </EnumOptionsMotionSlot.Provider>
    </Card>
  );
}

export { MotionEditor };
