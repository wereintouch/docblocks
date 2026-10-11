/**
 * docblocks-react-ui — public entry.
 *
 * React rendering layer for docblocks: the per-instance provider and store
 * projection, hooks, and block renderers. Builds strictly on the public
 * API of docblocks-core — direct yjs imports are forbidden (ESLint gate).
 */
export type { BlockRenderer, BlockRendererMap, BlockRendererProps } from "./blocks/renderers";
export { Editor } from "./Editor";
export { EditorProvider, useEditorContext } from "./EditorProvider";
export type { EditorContextValue, EditorProviderProps } from "./EditorProvider";
export { useBlock, useDoc, useMeta, usePresence, useSelection, useSelectionView, useText } from "./hooks";
export { renderRuns } from "./text/runs";
