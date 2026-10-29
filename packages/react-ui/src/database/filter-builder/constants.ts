/** The filter editor's control styling (the shared input / select look + the
 *  ghost add / remove affordances), over the standard tokens. */

/** The control look (the shared input / select styling). The standard
 *  tokens stand — the builder renders inside the portaled popover
 *  (the `--docblocks-*` editor-root tokens do not reach the body). */
const CONTROL_CLASS = `h-8 rounded-md border border-border bg-transparent px-2 text-sm text-foreground outline-none`;

/** The ghost button look (the add / the remove affordances). */
const GHOST_BUTTON_CLASS = `cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none hover:opacity-70`;

export { CONTROL_CLASS, GHOST_BUTTON_CLASS };
