/** The editor provider's constants: the safe embed sandbox + its default
 *  policy, and the selection's awareness publish debounce. */
import type { EmbedSandboxPolicy } from "./models";

/**
 * The safe embed sandbox (the default when no `embedSandbox` policy is
 * supplied): the embedded content stands an opaque origin (no
 * `allow-same-origin`), so it cannot read the parent's DOM, cookies, or state;
 * scripts, forms, and popups still run, so interactive embeds keep working.
 * Grant `allow-same-origin` — and `allow-scripts` together with it — only for
 * trusted origins via the `embedSandbox` policy: that combination lets the
 * frame lift its own sandbox.
 */
const DEFAULT_EMBED_SANDBOX = "allow-scripts allow-forms allow-popups";

const defaultEmbedSandbox: EmbedSandboxPolicy = () => DEFAULT_EMBED_SANDBOX;

/** Debounce between a selection change and its awareness publish. */
const AWARENESS_DEBOUNCE_MS = 50;

export { AWARENESS_DEBOUNCE_MS, DEFAULT_EMBED_SANDBOX, defaultEmbedSandbox };
