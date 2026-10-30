/** The keyboard unit's types: the format-mark toggle set + the block
 *  keyboard hook's props. */
import type { RefObject } from "react";

import type { BlockId, BlockType } from "docblocks-core";

import type { BlockContextValue } from "../../blocks";

/** The marks the format shortcuts and the mark toolbar toggle. */
type FormatMark = "bold" | "italic" | "strike" | "underline" | "code";

interface BlockKeyboardProps {
  id: BlockId;
  blockType: BlockType;
  context: BlockContextValue;
  innerRef: RefObject<HTMLElement | null>;
}

export type { BlockKeyboardProps, FormatMark };
