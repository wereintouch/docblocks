// The blocks unit's cross-unit surface (C6): the editor entry points (Editor,
// MotionEditor), the motion layer, the mermaid subpath, the editing layer, the
// state store, and the public entry import the blocks unit through this barrel.
// The canvas boundary stays deep in both directions: this barrel re-exports
// CanvasView from the canvas-view sub-barrel (not the canvas barrel), and the
// canvas unit imports the blocks files (BlockView, TextBlock) by file path.
// Both units' renderers are mutually dependent (CanvasView renders blocks,
// block-dispatch renders the canvas containers), so routing the boundary
// through the barrels would loop the barrel graph (CanvasView itself imports
// the canvas barrel for the viewport).

export { BlockGroups, BlockNodeView, BlockView, childrenSlot, FlatBlockView } from "./BlockView";
export { BlockContext, useBlockContext } from "../shared/providers/block-context";
export type { BlockContextValue } from "../shared/providers/block-context";
export { CanvasView } from "../canvas/canvas-view";
export { deriveFlat, entrySequenceParent, indentOf, sequenceContainerOf, subtreeSegmentOf, visibleRows } from "./flat";
export type { FlatNode } from "./flat";
export { FormatPaletteContext, useFormatPalette } from "../shared/providers/format-palette-context";
export { insertParagraphAfter } from "../editing/gutter-plus";
export { CALLOUT_ICON_COMPONENTS, CALLOUT_PRESET_ICONS, calloutIconName } from "./callout-icon";
export type { BlockRenderer, BlockRendererMap, BlockRendererProps } from "./renderers";
export { CodeHeader } from "./code/CodeHeader";
export { TextBlock, textOf } from "./TextBlock";
