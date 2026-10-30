// docblocks-react-ui/mermaid — the diagram renderer for code blocks.
//
// mermaid is an optional peer dependency and is imported only from this
// subpath: the base entry (`docblocks-react-ui`) never imports it, so a
// consumer without the package ships zero extra weight.
//
// A diagram is not a block type — it is the existing `code` block with
// `language: "mermaid"` (zero schema change). Wire the renderer per
// instance: `blockRenderers={{ code: MermaidCodeRenderer }}`. The
// renderer dispatches on the language: a mermaid code block renders per
// its code/preview mode (the exclusive rendering — see below), every
// other code block falls through to the built-in plain code rendering
// (the same TextBlock the built-in switch uses, so a consumer override
// keeps full editing for non-mermaid code blocks).
//
// Security posture (v1): `mermaid.initialize` runs with
// `securityLevel: "strict"` — the user's diagram source is sanitized and
// no click handlers or foreign scripts are bound — and with
// `suppressErrorRendering: true`, so a rejected render removes its
// working container from the page before the parse error propagates
// (without it mermaid leaves a visible temp element in `body` per failed
// render). A looser mode is a consumer decision outside this package.
// The preview follows the editor's theme: the `dark` class on the editor
// root or any ancestor (the v1 theme contract) sets the mermaid theme in
// the same task as the `render` call (the global config is read
// synchronously at the render's start), and a theme flip re-renders the
// diagram (an ancestor class watch).
//
// The code/preview mode (the `mermaidMode` attr, default `"code"` — it
// persists and syncs) — the modes are exclusive: `code` renders the
// editable code only (the diagram stands hidden), `preview` renders the
// diagram only (the code body is hidden — the editable stays mounted for
// the text sync). The mode segment (the CodeXml / Eye toggle buttons with
// the sliding highlight) stands in the header's left group, right of the
// language button, and is visible only while the block is hovered (the
// header controls' reveal).
//
// The side-effect (the `configureMermaidTheme("light")` module-scope
// stand) is triggered through the import chain: this barrel imports the
// MermaidCodeRenderer, which imports the MermaidDiagram, which imports
// the mermaid-config (where the side-effect stands).
export { MermaidCodeRenderer } from "./MermaidCodeRenderer";
