/** The link editor's types: the popover's open's options (the anchor's
 * point over the editor root's coords + the captured target range + the
 * prefilled href), the popover's open state, the context menu's state, and
 * the popover's api (the toolbar's button / the mod+k's shortcut / the
 * context menu's edit's item open over it). The target's shape stands in
 * the shared `format-range`'s unit (the format toolbar's target shares
 * it). */
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import type { Selection } from "docblocks-core";

import type { ToolbarRange } from "../format-range";

/** The popover's open's options. */
interface LinkPopoverOpen {
  /** The target's range (the explicit stand — the selection's resolution's stand over its absence). */
  target?: ToolbarRange;
  /** The input's prefill (the explicit stand — the range's uniform link's stand over its absence). */
  prefilledHref?: string | null;
}

/** The popover's open state (the captured target + the prefill + the
 * anchor's point, the root's coords). */
interface LinkPopoverState {
  anchor: { x: number; y: number };
  target: ToolbarRange;
  prefilledHref: string | null;
}

/** The context menu's state (the anchor's point, the root's coords, the
 * href + the link's own range — the in-block segment's stand). */
interface LinkMenuState {
  x: number;
  y: number;
  href: string;
  blockId: string;
  from: number;
  to: number;
}

/** The popover's api (the editor-level's opener over the selection and
 * the explicit anchor). */
interface LinkPopoverApi {
  /** Open at the anchor (the root's coords) over the target (the explicit
   * stand, the selection's resolution over its absence). */
  open: (anchor: { x: number; y: number }, opts?: LinkPopoverOpen) => void;
  /** Open over the current view's selection (the mod+k's stand): a range
   * over the eligible's target, the caret's link's expansion over a caret
   * inside a link, the caret's insertion's target otherwise. */
  openFromSelection: (selection: Selection | null) => void;
}

/** The popover's hook's return (the api + the root's contextmenu's
 * handler + the root's mod+k's keydown's interception + the popover / the
 * menu's nodes). */
interface LinkPopoverHandle {
  api: LinkPopoverApi;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  /** The mod+k's interception (`true` over the handled's keydown — the
   * root's own handler's stand is off). */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => boolean;
  node: ReactNode;
}

export type { LinkMenuState, LinkPopoverApi, LinkPopoverHandle, LinkPopoverOpen, LinkPopoverState };
