/** The mermaid renderer's config stand (the v1 security + behavior stand —
 * `securityLevel: "strict"` — the user's diagram source is sanitized and
 * no click handlers or foreign scripts are bound — and
 * `suppressErrorRendering: true`, so a rejected render removes its
 * working container from the page before the parse error propagates —
 * without it mermaid leaves a visible temp element in `body` per failed
 * render; a looser mode is a consumer decision outside this package) +
 * the theme setter (Mermaid 12 reads the config synchronously at the
 * start of `render` (before its first await), so setting it in the same
 * task as the render call is race-free across the page's instances — the
 * global config is the only theme lever — `render` takes no per-render
 * config) + the module-scope stand (the light default before the first
 * mount) + the safe id (the block id with the characters that are not
 * valid in a DOM id stripped). */
import mermaid from "mermaid";

import type { BlockId } from "docblocks-core";

// The v1 security + behavior stand (see the module doc). Safe to run
// more than once: initialize only sets the config.
// `suppressErrorRendering` keeps rejected renders from leaving their
// temp container behind.
const MERMAID_CONFIG_STAND = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
} as const;

/**
 * Sets the global mermaid config for the editor's theme. Mermaid 12
 * reads the config synchronously at the start of `render` (before its
 * first await), so setting it in the same task as the render call is
 * race-free across the page's instances (the global config is the only
 * theme lever — `render` takes no per-render config).
 */
function configureMermaidTheme(theme: "light" | "dark"): void {
  mermaid.initialize({ ...MERMAID_CONFIG_STAND, theme: theme === "dark" ? "dark" : "default" });
}

// The module-scope stand: the light default before the first mount.
configureMermaidTheme("light");

/** The block id with the characters that are not valid in a DOM id stripped. */
function safeId(id: BlockId): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export { configureMermaidTheme, safeId };
