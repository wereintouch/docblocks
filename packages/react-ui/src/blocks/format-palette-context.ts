import { createContext, useContext } from "react";

import { FORMAT_PALETTE } from "../editing/format-toolbar";

/**
 * The editor's format color palette (the default six colors, overridable
 * through the editor's `formatPalette` prop). The provider stands in the
 * Editor / MotionEditor above the block tree, so a block (the table's
 * row/column color menus) reads the same palette the floating format
 * toolbar uses.
 */
const FormatPaletteContext = createContext<readonly string[]>(FORMAT_PALETTE);

/** The editor's format color palette (the default when no provider stands). */
function useFormatPalette(): readonly string[] {
  return useContext(FormatPaletteContext);
}

export { FormatPaletteContext, useFormatPalette };
