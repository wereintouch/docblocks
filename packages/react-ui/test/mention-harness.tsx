import { render } from "@testing-library/react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import type { MentionInteractions } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

const CARD_HOST = '[data-slot="docblocks/mention-card"]';
const CHIP_SELECTOR = '[data-slot="docblocks/mention"]';
const EDITOR_ROOT = '[data-slot="docblocks/editor"]';

interface Harness {
  doc: TestDoc;
  blockId: string;
}

interface RenderOptions {
  /** The consumer's mention interactions (the hover's card + the click's
   *  delivery); absent stands the inert chip. */
  interactions?: MentionInteractions;
  mode?: "edit" | "view";
  /** The doc's seed over the render (the mark's write, the text's stand). */
  prepare?: (doc: TestDoc, blockId: string) => void;
}

/**
 * The mention's chip's doc: one paragraph over "Hello Jane" with the `u1`'s
 * user's mention mark over "Jane", rendered in the base editor. The
 * interactions stand the consumer's stands (the card's + the click's
 * delivery), the mode stands the read-only's stand.
 */
function renderMentionChip(options: RenderOptions = {}): Harness {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const blockId = doc.insertBlock("paragraph");
  doc.insertText(blockId, 0, "Hello Jane");
  doc.setMark(blockId, 6, 10, { type: "mention", kind: "user", id: "u1" });
  if (options.prepare !== undefined) options.prepare(doc, blockId);
  render(
    <EditorProvider doc={doc} mentionInteractions={options.interactions} mode={options.mode}>
      <Editor />
    </EditorProvider>
  );
  return { doc, blockId };
}

export { CARD_HOST, CHIP_SELECTOR, EDITOR_ROOT, renderMentionChip };
export type { Harness };
