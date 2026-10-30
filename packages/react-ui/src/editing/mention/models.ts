/** The mention trigger's models: the open-picker state, the live query
 *  derivation, and the picker api (the editor-level hook exposes it; the
 *  block input reads it through a ref, so query changes do not re-render
 *  the block tree). */
import type { KeyboardEvent, RefObject } from "react";

import type { BlockId, MentionKind } from "docblocks-core";

import type { MentionProvider } from "../../editor-provider";

/** The open mention picker's derivation: the live query over the `@` phrase. */
interface MentionDerivation {
  /** True when the phrase is gone (deleted) or the caret left the window. */
  closed: boolean;
  /** The query text between the `@` and the caret / boundary. */
  query: string;
  /** The end offset of the `@` phrase (the `@` + the query). */
  queryEnd: number;
}

/** The open mention picker's state. */
interface MentionMenuState {
  blockId: BlockId;
  parentId: BlockId;
  /** The offset of the `@` character in the block text. */
  atOffset: number;
  /** The keyboard-navigated active index over the flattened items. */
  active: number;
}

/** A picked mention: the target kind + the stable id + the label snapshot. */
interface MentionPick {
  kind: MentionKind;
  id: string;
  label: string;
}

/** The mention picker api for the nearest editor root (null = no provider). */
interface MentionMenuApi {
  /** The open-picker key handling; true = the key is the picker's (consumed). */
  onKeyDown: (event: KeyboardEvent, blockId: BlockId) => boolean;
  /** The `@` trigger (a plain `@` at a boundary with a provider); true = consumed. */
  onMentionKey: (event: KeyboardEvent, blockId: BlockId, parentId: BlockId, caretOffset: number) => boolean;
}

/** The picker's props (the provider the picker fetches over + the navigation
 *  + the pick). The picker owns the live query derivation and the fetch. */
interface MentionMenuProps {
  rootRef: RefObject<HTMLElement | null>;
  state: MentionMenuState;
  /** The consumer's mention provider (null = the picker is a no-op). */
  provider: MentionProvider | null;
  /** The keyboard-navigated active index (over the flattened items). */
  active: number;
  /** Report the flattened items to the owner (the arrow nav + the Enter pick). */
  onItemsChange: (items: MentionPick[]) => void;
  onHover: (index: number) => void;
  onPick: (pick: MentionPick) => void;
  onClose: () => void;
}

export type { MentionDerivation, MentionMenuApi, MentionMenuProps, MentionMenuState, MentionPick };
