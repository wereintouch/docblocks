// The floating format toolbar's cross-unit surface (E6): the default
// format palette (the shared palette's seven pastel theme tokens + the
// theme's own background token — a consumer can pass its own through the
// editor's `formatPalette` prop — a `string[]` of hex or var) + the
// editor-level format toolbar layer (null while no eligible range is
// selected).
export { FORMAT_PALETTE } from "./constants";
export { useFormatToolbar } from "./use-format-toolbar";
