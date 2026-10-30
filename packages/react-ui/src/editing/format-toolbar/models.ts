/** The format toolbar's types: the 24px-stroke icon component (the
 * package icon set), the palette target (which mark the picked color is
 * applied to — the text `color` mark vs the background `highlight` mark),
 * the toolbar's target range (a same-block range or a cross-block range
 * over the engine's chain), the toolbar's props (the editor root's ref +
 * the overridable color palette). */
import type { ComponentType, RefObject, SVGProps } from "react";

import type { BlockId } from "docblocks-core";

import type { CrossRange } from "../format-range";

/** A 24px-stroke icon component (the package icon set). */
type ToolbarIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The palette target: which mark the picked color is applied to. */
type PaletteTarget = "color" | "highlight";

/** The toolbar's target range: a same-block range or a cross-block range over the engine's chain. */
type ToolbarRange =
  { kind: "single"; blockId: BlockId; from: number; to: number } | { kind: "cross"; cross: CrossRange };

interface FormatToolbarProps {
  rootRef: RefObject<HTMLElement | null>;
  palette: readonly string[];
}

export type { FormatToolbarProps, PaletteTarget, ToolbarIcon, ToolbarRange };
