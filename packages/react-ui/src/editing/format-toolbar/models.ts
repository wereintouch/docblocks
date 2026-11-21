/** The format toolbar's types: the 24px-stroke icon component (the
 * package icon set), the palette target (which mark the picked color is
 * applied to — the text `color` mark vs the background `highlight` mark),
 * the toolbar's props (the editor root's ref + the overridable color
 * palette). The toolbar's target range shape stands in the shared
 * `format-range`'s unit (the link editor's target shares it). */
import type { ComponentType, RefObject, SVGProps } from "react";

/** A 24px-stroke icon component (the package icon set). */
type ToolbarIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The palette target: which mark the picked color is applied to. */
type PaletteTarget = "color" | "highlight";

interface FormatToolbarProps {
  rootRef: RefObject<HTMLElement | null>;
  palette: readonly string[];
}

export type { FormatToolbarProps, PaletteTarget, ToolbarIcon };
export type { ToolbarRange } from "../format-range";
