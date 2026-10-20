import type { BlockId, CodeBlock } from "docblocks-core";

import { BlockCaption, requestBlockCaption } from "./BlockCaption";

/**
 * The code block's caption line: the shared block caption
 * (`BlockCaption`) with the code-kind slot / wording.
 */
function CodeCaption({ id, block }: { id: BlockId; block: CodeBlock }) {
  return (
    <BlockCaption
      id={id}
      caption={block.attrs?.caption ?? ""}
      slot="docblocks/code-caption"
      ariaLabel="Caption"
      placeholder="Write a caption…"
    />
  );
}

/** Show the code caption line (the shared block-caption request). */
function requestCodeCaption(scope: object, id: BlockId): void {
  requestBlockCaption(scope, id);
}

export { CodeCaption, requestCodeCaption };
