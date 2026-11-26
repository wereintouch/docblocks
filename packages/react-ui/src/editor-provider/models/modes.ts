/** The access stand: the consumer's user access level and the document
 *  mode (consumer session state, never document data). */
/** The consumer's user access level: the available document modes. "viewer" is locked to the published's view (the current state is never rendered); "editor" (the default) may edit and view. Session state — not document data, never on the wire. */
type AccessLevel = "viewer" | "editor";

/** The document's mode (consumer-controlled view state, like the page/canvas `view`): "edit" (the default) is the live document editable; "view" is the live document read-only (the current state, still syncing) with its text selectable and copyable; "published" is the `publishedDoc`'s snapshot read-only (static) with no selection and no copy by default — the `publishedCopyable` provider prop lifts the block per reader (the `view` mode's payload). */
type EditorMode = "edit" | "view" | "published";

export type { AccessLevel, EditorMode };
