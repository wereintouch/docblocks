/**
 * The paste entry: the rich `text/html` branch (the whitelist-mapped runs,
 * the one-transaction block apply, the plain-text read) and the multi-block
 * markdown materialization of the `text/plain` branch. The shared
 * materialization's typed insertion (`insertNative`) stands the unit's
 * public primitive for the other writing paths (the headless import).
 */
export { applyMdPaste, applyRichPaste, htmlToBlocks, insertNative, plainTextOfHtml, rawTextOfHtml } from "./utils";
export type { MaterializedBlock } from "./utils";
