/** The editor provider's constants: the safe embed sandbox + its default
 *  policy, and the selection's awareness publish debounce. */
import type { EmbedSandboxPolicy } from "./models";

/**
 * The embed sandbox (the default when no `embedSandbox` policy is supplied):
 * the embedded content runs with its own origin's grants (`allow-same-origin`
 * — the real-app requirement: a dashboard's own storage / cookies stand,
 * so the app boots like in a plain tab) + scripts, forms, and popups.
 * The frame's document stands a separate document either way: a
 * cross-origin embed cannot reach the parent's DOM or state. The one
 * posture consequence: a same-origin URL (the page's own origin) reaches
 * the parent over `window.parent` — the document author's own choice to
 * embed it. The `embedSandbox` policy stands the restriction (the
 * opaque-origin stand — no `allow-same-origin` — for the untrusted embeds).
 */
const DEFAULT_EMBED_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups";

const defaultEmbedSandbox: EmbedSandboxPolicy = () => DEFAULT_EMBED_SANDBOX;

/** Debounce between a selection change and its awareness publish. */
const AWARENESS_DEBOUNCE_MS = 50;

export { AWARENESS_DEBOUNCE_MS, DEFAULT_EMBED_SANDBOX, defaultEmbedSandbox };
