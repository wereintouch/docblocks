/** The link editor's unit (the link's mark's editing surface): the
 * popover's open's api + the popover / the context menu's components, the
 * input's resolution (the smart scheme's inference), the range's reads
 * (the uniform link's prefill, the caret's expansion), and the doc's
 * commands (the apply / the removal). The format toolbar's button, the
 * mod+k's shortcut, and the anchor's right-click menu open over the
 * shared api. */
export { LinkPopoverContext, useLinkPopoverApi } from "./link-popover-context";
export { LinkMenu } from "./LinkMenu";
export { LinkPopover } from "./LinkPopover";
export { applyLinkHref, removeLink } from "./actions";
export { resolveLinkHref } from "./resolve";
export { linkRangeOf, linkTargetOfCaret, uniformLinkHrefOf } from "./range";
export { useLinkPopover } from "./use-link-popover";
export type { LinkMenuState, LinkPopoverApi, LinkPopoverHandle, LinkPopoverOpen, LinkPopoverState } from "./models";
