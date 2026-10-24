/**
 * The "/" slash command menu — the block-conversion affordance.
 *
 * The doc is the query's source of truth: the "/" is regular doc text — the
 * keypress commits it through the command API (the browser's insertion
 * stands suppressed), and Backspace deletes it like any other character;
 * the characters typed after it are plain text too. The menu tracks the
 * triggering "/" by its text offset: the filter query is the block text
 * between that "/" and the first whitespace (or the block end), re-derived
 * on every change. Deleting the "/" (or moving the caret out of the query
 * window) closes the menu; a "/" already in the text never re-triggers —
 * only a "/" keypress does.
 *
 * The derivation reads the caret live from the DOM selection (the browser
 * settles the DOM before the store commit that re-renders the menu, so the
 * read stands at the current text): a stale caret reading would stand past
 * the shrunken query's end after a Backspace and close the menu wrongly.
 *
 * Trigger: a "/" keypress with a collapsed caret in a page text block
 * (paragraph, heading, list-item, callout — code is excluded:
 * a "/" there is plain text) at any position and any indent of the root
 * page sequence (or the provider's entry root itself).
 *
 * The menu stands a plain absolutely-positioned div inside the editor root
 * (no focus machinery): it never takes the focus — the caret stays in the
 * block while it is open — and anchors at the left edge of the "/"
 * character: below the line, or above it when the below placement would
 * overrun the viewport bottom (the list is bounded and scrolls, so the
 * flip stays close to the caret). Zero filter matches hide the list
 * (the state stays open, so deleting the query back to a match brings it
 * back); the keys are Escape (close), ArrowUp/ArrowDown (move the active
 * item while a list stands), and Enter (apply). Printable keys, Backspace,
 * and space flow to the doc's normal input path — they grow, shrink, or
 * end the query.
 *
 * Applying a command converts the triggering block: the trigger phrase
 * ("/" + the query) is stripped from its text, and the rest survives the
 * type change (a same-type command is an attrs update; a different type
 * is changeBlockType — one transaction: one undo step, one wire update).
 * A block that holds only the trigger phrase converts by the replace path
 * (remove + insert, the caret seated in the new block) unless it owns a
 * derived segment (deeper followers) — a removal would cascade them, so
 * such a block converts in place. A no-op close (the command equals the
 * block's current shape, or a contentless target like the divider over
 * surviving text) issues no command.
 *
 * The command list (v1): the page block types creatable from default
 * attrs — text, headings 1-3, the three list kinds, callout, code (plain
 * and mermaid), divider, and table. The table is the only insert
 * command: it lands after the caret block (2×2, the default widths), the
 * caret block stands, and the caret seats in the table's first cell (the
 * empty-cell activation). The image is an upload insert (the blob bridge,
 * decision 2026-10-19): the caret block stands (the trigger phrase
 * stripped), the file picker opens over the open menu, and the image
 * lands after the caret block in one transact once the upload resolved —
 * the doc holds only the committed key; a refused or cancelled pick
 * commits nothing. The database is a picker insert (the bridge, decision
 * 2026-10-19): the caret block stands (the trigger phrase stripped), the
 * table picker stands over the open menu (the existing tables + the
 * create-new form), and the block lands after the caret block in one
 * transact once a table is picked — the doc holds only the `tableId`
 * reference; a cancelled pick commits nothing. Externally referenced types
 * (embed, sync-embed, the canvas types) are not offered; they stay
 * command-API inserts.
 *
 * The implementation stands in `./slash/`.
 */
export * from "./slash/index";
