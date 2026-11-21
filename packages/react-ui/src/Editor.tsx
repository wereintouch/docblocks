import { useStore } from "zustand";

import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useRef } from "react";

import { EditorErrorBoundary } from "./EditorErrorBoundary";
import { AttributesPanel, CoverBanner } from "./attributes";
import { CoverTintController } from "./attributes/cover-tint";
import { BlockContext, CanvasView, FormatPaletteContext, entrySequenceParent, usePageSequence } from "./blocks";
import { EnumOptionsMotionSlot } from "./database";
import { useEditing } from "./editing/editor-root";
import { FORMAT_PALETTE, useFormatToolbar } from "./editing/format-toolbar";
import { LinkPopoverContext, useLinkPopover } from "./editing/link";
import { MentionMenuContext, useMentionCard, useMentionMenu } from "./editing/mention";
import { PageSurfaceProvider, usePageSurfaceDispatch } from "./editing/page-surface";
import type { PageSurfaceHandlersMap } from "./editing/page-surface";
import { SlashMenuContext, useSlashMenu } from "./editing/slash";
import { useLinkOpen } from "./editing/use-link-open";
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
  const { doc, store, rootBlockId, viewMode, mode, mentionInteractions } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  // The frame's tint's read (the cover's presence + the off's stand — the
  // absent's / the `true`'s stand is the on's default): the data attribute
  // gates the CSS's border's mix (the variable's stand is the controller's
  // job over the card's element).
  const attributes = useStore(store, (state) => state.meta.attributes);
  const coverId = typeof attributes?.cover === "string" ? attributes.cover : undefined;
  const coverTintEnabled = coverId !== undefined && attributes?.coverTint !== false;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  // The page surface's handlers map (the container dispatch's source +
  // the per-block registration's target — one map per editor instance,
  // identity-stable; the dispatch binding and the provider read the same
  // map, the dispatch hook running outside the provider's subtree).
  const surfaceMapRef = useRef<PageSurfaceHandlersMap | null>(null);
  if (surfaceMapRef.current === null) surfaceMapRef.current = new Map();
  // The page surface's container-level dispatch (the single page
  // editable's keys/inputs target the container, not the blocks' inners).
  const surface = usePageSurfaceDispatch(pageRef, doc, surfaceMapRef.current);
  // The page view's rows: the root's page children (a canvas surface is a
  // canvas layer, not a page block — a stray one would otherwise delete its
  // entire content through the page's Delete path), the flat derivation,
  // the collapsed segments' skip, and the read-only empty chains' collapse.
  const { nodesById, collapsedRowKeys } = usePageSequence({ store, rootChildren, viewMode });
  // The gestures' command parent: the entry root's sequence container.
  const rootContext = useMemo(
    () => ({ parentId: entrySequenceParent(doc, rootBlockId), siblings: rootChildren }),
    [doc, rootBlockId, rootChildren]
  );
  const { rootRef, onKeyDown, onCopy, onPointerDown: onCrossDragPointerDown } = useEditing();
  const linkPopover = useLinkPopover(rootRef);
  // The mod+k's interception stands before the editor root's own keys (the
  // handled's keydown's no-pass-through's stand).
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (linkPopover.handleKeyDown(event)) return;
    onKeyDown(event);
  };
  const linkOpen = useLinkOpen();
  const slash = useSlashMenu(rootRef);
  const mention = useMentionMenu(rootRef);
  const mentionCard = useMentionCard(rootRef);
  const format = useFormatToolbar(rootRef, formatPalette);
  useTypingFlag(rootRef);
  const enterGate = useEnterAnimationGate(rootRef);

  const { order, draggingKey, previewIndent, layoutSlide, onRowDragStart, onRowDragMove, onRowDragEnd, onRowReorder } =
    useMotionDrag({ doc, rootBlockId, store, rootRef, rowKeys: collapsedRowKeys, nodesById });

  return (
    // The shared Card carries the editor's frame chrome (border, radius,
    // the card surface). In the canvas view it takes the flex column's
    // slack: the 100% height chain below the root needs a definite height.
    // The inner div is the editor root: the focus and keyboard scope and
    // the token-mapping scope. The `data-cover-tint`'s stand gates the
    // frame's tint's border's mix (the cover's average color's variable's
    // stand stands over this element — the border's element).
    <Card
      ref={cardRef}
      data-cover-tint={coverTintEnabled ? "" : undefined}
      className={cn(view === "canvas" && "min-h-0 flex-1")}
    >
      <CoverTintController cardRef={cardRef} />
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
          data-mode={mode}
          data-readonly={viewMode ? "true" : undefined}
          // The mention chip's interactive stand (the consumer's mention
          // interactions): the hover's cursor + the neutral's background
          // key on the root (the chip's own markup stays the run's).
          data-mention-interactive={mentionInteractions !== null ? "true" : undefined}
          tabIndex={-1}
          className={cn(
            "relative min-h-0 flex-1 selection:bg-(--docblocks-selection-background)",
            "font-(family-name:--docblocks-font-family) text-(length:--docblocks-font-size)",
            "leading-(--docblocks-line-height) text-(--docblocks-text-color)"
          )}
          onKeyDown={handleKeyDown}
          onCopy={onCopy}
          onContextMenu={linkPopover.onContextMenu}
          onMouseDown={linkOpen.onMouseDown}
          onClick={linkOpen.onClick}
          onPointerDown={onCrossDragPointerDown}
        >
          <style>{HANDLE_GRAB_STYLE}</style>
          {/* The editor's content stands the top-level render boundary: a
              throw of the chrome outside a block's renderer (the panel,
              the canvas chrome, the row list) is contained to the content
              area — the root's focus scope and the consumer's application
              stay mounted. */}
          <EditorErrorBoundary>
            {/* The cover's banner (the frame's top edge's stand): a
              non-interactive decoration over the page view only (the
              canvas's view stands no banner). */}
            {view === "canvas" ? null : <CoverBanner />}
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
                      // is unpadded. The container is the page's single
                      // editable (the edit's mode): the native selection
                      // crosses the blocks' boundaries natively over every
                      // engine (the WebKit family's cross-editable's clamp
                      // stands between sibling editables only) — the
                      // per-block handlers stand dispatched over the surface
                      // registry (the container's target's stand).
                      <PageSurfaceProvider map={surfaceMapRef.current}>
                        <div
                          ref={pageRef}
                          data-slot="docblocks/page"
                          contentEditable={!viewMode}
                          suppressContentEditableWarning
                          onKeyDown={surface.onKeyDown}
                          onInput={surface.onInput}
                          onPaste={surface.onPaste}
                          className="
                          mx-auto w-full max-w-(--docblocks-page-column-max-width) px-(--docblocks-page-padding-x)
                        "
                        >
                          {/* The document-attributes panel (the above-the-first-block's
                            stand): a non-editable island over the page's shared
                            editable (the cross-drag's mousedown guard + the surface's
                            container-targeted dispatch keep their stands over its
                            controls). The canvas view stands no panel (the page-column
                            placement). */}
                          <AttributesPanel />
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
                      </PageSurfaceProvider>
                    )}
                    {viewMode ? null : <PresenceCaretOverlay rootRef={rootRef} />}
                  </BlockContext.Provider>
                </FormatPaletteContext.Provider>
              </SlashMenuContext.Provider>
            </MentionMenuContext.Provider>
            {slash.menuNode}
            {mention.menuNode}
            {mentionCard}
            <LinkPopoverContext.Provider value={linkPopover.api}>
              {viewMode ? null : format.toolbarNode}
            </LinkPopoverContext.Provider>
            {linkPopover.node}
          </EditorErrorBoundary>
        </div>
      </EnumOptionsMotionSlot.Provider>
    </Card>
  );
}

export { Editor };
export type { EditorView };
