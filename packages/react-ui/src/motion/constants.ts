/** The motion editor's constants: the enter/exit geometry (the spacing
 * margin collapses on exit so a leaving row does not keep its gap), the
 * enter/exit and layout-slide transition (one snappy ease — the
 * between-rows reflow while a drag runs runs the layout arm of this
 * transition, gated per-value: 0 while the slide is disarmed), the slide
 * settle window (how long the layout slide stays armed after a structural
 * render — the slide itself runs 0.18s), the drag affordance style (the
 * handle shows the grab cursor in this view only — the rule is scoped to
 * the root attribute, so the base editor keeps the stylesheet's plain
 * pointer cursor), the text-row gutter types (the text types whose
 * built-in renderer renders the row's gutter handle — the row-level one
 * stands for every other type). */
/**
 * The enter/exit geometry of a row. The spacing margin collapses on exit
 * so a leaving row does not keep its gap.
 */
const ENTER = { opacity: 0, height: 0 } as const;
const ANIMATE = { opacity: 1, height: "auto" } as const;
const EXIT = { opacity: 0, height: 0, marginBottom: 0 } as const;

/**
 * The enter/exit and layout-slide transition (one snappy ease). The
 * between-rows reflow while a drag runs (the rows slide into each crossed
 * slot) runs the layout arm of this transition (gated per-value: 0 while
 * the slide is disarmed).
 */
const TRANSITION = { duration: 0.18, ease: "easeOut" } as const;

/** How long the layout slide stays armed after a structural render (the slide itself runs 0.18s). */
const SLIDE_SETTLE_MS = 400;

/**
 * The drag affordance: the handle shows the grab cursor in this view
 * only — the rule is scoped to the root attribute below, so the base
 * editor keeps the stylesheet's plain pointer cursor.
 */
const HANDLE_GRAB_STYLE = '[data-docblocks-motion] [data-slot="docblocks/gutter"] { cursor: grab; }';

/** The text types whose built-in renderer renders the row's gutter handle (the row-level one stands for every other type). */
const TEXT_ROW_TYPES = new Set(["paragraph", "quote", "heading", "callout", "list-item", "code"]);

export { ANIMATE, ENTER, EXIT, HANDLE_GRAB_STYLE, SLIDE_SETTLE_MS, TEXT_ROW_TYPES, TRANSITION };
