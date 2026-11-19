/** The canvas clipboard unit: the copy (the deep snapshot of the selected
 * items) and the paste (the id remap, the geometry offset, the membership's
 * auto-join — one transaction). Pure functions over the plain `Doc` reader.
 */
export { copyCanvasItems } from "./copy";
export { pasteCanvasItems } from "./paste";
export type { CanvasClipboard, ClipboardItem } from "./models";
