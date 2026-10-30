// The blocks unit's cross-unit surface (C6): the editor entry points (Editor,
// MotionEditor), the motion layer, the mermaid subpath, the editing layer, the
// state store, and the public entry import the blocks unit through this barrel.
// The canvas unit's canvas-geometry / format-palette / canvas-text-edit imports
// stay on the sub-unit barrels (deep): re-routing them onto this barrel would
// close a cycle, since the canvas-view renderer here imports the canvas barrel
// and the canvas viewport imports canvas-geometry.

export { BlockGroups, BlockNodeView, BlockView, childrenSlot, FlatBlockView } from "./BlockView";
export { BlockContext, useBlockContext } from "./block-context";
export type { BlockContextValue } from "./block-context";
export { CanvasView } from "./canvas-view";
export { deriveFlat, entrySequenceParent, indentOf, sequenceContainerOf, subtreeSegmentOf, visibleRows } from "./flat";
export type { FlatNode } from "./flat";
export { FormatPaletteContext, useFormatPalette } from "./format-palette-context";
export { insertParagraphAfter } from "./gutter-plus";
export { CALLOUT_ICON_COMPONENTS, CALLOUT_PRESET_ICONS, calloutIconName } from "./callout-icon";
export type { BlockRenderer, BlockRendererMap, BlockRendererProps } from "./renderers";
export { CodeHeader } from "./CodeHeader";
export { TextBlock, textOf } from "./TextBlock";
