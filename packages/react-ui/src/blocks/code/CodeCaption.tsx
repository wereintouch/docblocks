import { useTranslation } from "react-i18next";

import type { BlockId, CodeBlock } from "docblocks-core";

import { BlockCaption, requestBlockCaption } from "../BlockCaption";

/**
 * The code block's caption line: the shared block caption
 * (`BlockCaption`) with the code-kind slot / wording.
 */
function CodeCaption({ id, block }: { id: BlockId; block: CodeBlock }) {
  const { t } = useTranslation("blocks");
  return (
    <BlockCaption
      id={id}
      caption={block.attrs?.caption ?? ""}
      slot="docblocks/code-caption"
      ariaLabel={t("caption.aria")}
      placeholder={t("caption.placeholder")}
    />
  );
}

/** Show the code caption line (the shared block-caption request). */
function requestCodeCaption(scope: object, id: BlockId): void {
  requestBlockCaption(scope, id);
}

export { CodeCaption, requestCodeCaption };
