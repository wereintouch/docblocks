/**
 * docblocks-react-ui/motion — the animated editor view.
 *
 * framer-motion is an optional peer dependency and is imported only from
 * this subpath: the base entry (`docblocks-react-ui`) never imports it,
 * so a consumer without the package ships zero extra weight.
 *
 * `MotionEditor` is a drop-in replacement for the base `Editor` under the
 * same `EditorProvider` — the same root element (the focus/keyboard
 * scope), the same block rendering and editing wiring, and the same
 * presence overlay. The page view renders the FLAT page sequence: every
 * page block is its own row (a framer `Reorder.Item`), the
 * nesting is the block's `indent` attr (the row's left padding steps per
 * level; a list item's marker is a rendered label per row — the row is
 * not in a list element, so the native `ol`/`ul` marker is absent). The
 * top-level rows render through `AnimatePresence` (`sync` — the rows
 * stay in the layout flow while they enter/exit): an inserted block
 * fades in as its height grows, a removed one fades out as it collapses
 * (the mirror). Rows that mount while the editor is still loading (the
 * mount and the sync load — before the first text input in the editor)
 * stand up instantly (`initial={false}`): the load is not an insert.
 * The siblings' position slides on a reorder (a drag or a
 * remote move). The slide is position-only — a size projection would
 * scale an entry while its content height settles and distort the text. The layout projection is
 * armed on every row at all times — a row whose layout feature toggles
 * with the slide state (unmounting between renders) does not slide
 * reliably when a live reorder commits — and the slide is gated by the
 * per-value layout transition duration instead: the 0.18 s slide runs
 * only while a drag or a structural settle is in flight, 0 otherwise, so
 * an in-place height change (typing, a line break, a remote edit)
 * reflows instantly.
 *
 * Drag-reorder: pure framer `Reorder` (the standard
 * `Reorder.Group`/`Reorder.Item` pattern — the local order state, the
 * live reorder, the commit on release). Every page block is a reorder
 * target; a block whose row renders the gutter handle (the text types) is
 * a drag source — the handle is the only drag trigger (framer's own
 * `drag` is disarmed on the row and started from the handle's pointerdown
 * through the row's `dragControls`; a press without movement stays the
 * plain block selection). One drag issues one range move of the dragged
 * block's derived subtree (the block and its deeper followers — a range
 * operation on the sequence: one transact, one undo step, one
 * wire update); the commit index is the pre-move index (a drop that ends at
 * the same position issues no command, a move-to-end target is the
 * sequence's length). A vertical drop is a reorder only — the level
 * change is the Tab/Shift+Tab gesture (one `updateBlock({ indent })`).
 *
 * Known accepted edges: a remote doc update mid-drag re-derives the row
 * list; the in-flight drag may visually restart, and a release whose
 * derived final order is stale against the store is dropped (no commit —
 * the local order resyncs to the store). A peer that deletes the dragged
 * row mid-drag unmounts it: the session state is released in the render
 * phase — the release does not depend on framer delivering onDragEnd for
 * the unmounted row — and the local order resyncs to the store. Framer's
 * own reorder detection
 * on a long downward drag can cascade the virtual index toward the
 * bottom (accepted as the experimental base — if it proves unacceptable
 * in e2e, the commit's stale-drop guard is the backstop: the release
 * commits the order framer actually produced).
 *
 * The implementation stands in the segment files (`MotionEditor`,
 * `RowItem`, `hooks`, `models`, `utils`; the seam/commit math in
 * `reorder.ts`).
 */
export { MotionEditor } from "./MotionEditor";
