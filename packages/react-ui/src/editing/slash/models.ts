/** The slash menu's types: the command shape, the derivation / plan shapes,
 *  the menu state and the editor-level api. */
import type { ComponentType, KeyboardEvent, RefObject, SVGProps } from "react";

import type { BlockId } from "docblocks-core";

/** A 24px-stroke icon component (the package icon set). */
type SlashIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The embed's kind (a renderer hint — all kinds render as an iframe in v1). */
type EmbedKind = "iframe" | "github" | "figma" | "loom" | "html";

/** One slash command: the block type, its default attrs, and the menu glyph. */
type SlashCommand =
  | { label: string; icon: SlashIcon; type: "paragraph" }
  | { label: string; icon: SlashIcon; type: "heading"; attrs: { level: 1 | 2 | 3 } }
  | { label: string; icon: SlashIcon; type: "list-item"; attrs: { list: "bullet" | "number" | "task" } }
  | { label: string; icon: SlashIcon; type: "quote" }
  | { label: string; icon: SlashIcon; type: "callout" }
  | { label: string; icon: SlashIcon; type: "code"; attrs?: { language?: string } }
  | { label: string; icon: SlashIcon; type: "divider" }
  | { label: string; icon: SlashIcon; type: "image" }
  | { label: string; icon: SlashIcon; type: "embed" }
  | { label: string; icon: SlashIcon; type: "database" }
  | { label: string; icon: SlashIcon; type: "table" };

/** The live derivation of the menu state from the block text (the doc is the source of truth). */
interface SlashDerivation {
  /** The anchor is gone (the "/" deleted or edited away) or the caret left the query window. */
  closed: boolean;
  /** The filter query: the block text between the "/" and its query boundary. */
  query: string;
  /** The end of the query (the boundary index, or the text length). */
  queryEnd: number;
}

/** The apply decision (pure): what a picked command does to the trigger block. */
type SlashApplyPlan =
  | { kind: "noop" }
  | { kind: "replace" }
  | { kind: "update"; deleteFrom: number; deleteTo: number }
  | { kind: "convert"; deleteFrom: number; deleteTo: number };

interface SlashMenuState {
  /** The block the menu is attached to (the conversion target). */
  blockId: BlockId;
  parentId: BlockId;
  /** The text offset of the triggering "/" (the anchor; the query is derived after it). */
  slashOffset: number;
  /** The keyboard-active item index. */
  active: number;
}

/** The editor-level slash menu api, consumed by the block input guards. */
interface SlashMenuApi {
  /** Handle a key while the menu is open on `blockId`; true = consumed. */
  onKeyDown: (event: KeyboardEvent, blockId: BlockId) => boolean;
  /**
   * The "/" trigger open. `caretOffset` is the caret's text offset before
   * the "/" lands (the anchor); the default is prevented here (the browser
   * insertion stands suppressed — the caller commits the character
   * through the command API). true = opened.
   */
  onSlashKey: (event: KeyboardEvent, blockId: BlockId, parentId: BlockId, caretOffset: number) => boolean;
}

/** The key facts the open-menu key handling reads (react and native alike). */
interface OpenMenuKey {
  key: string;
  isComposing: boolean;
}

interface SlashMenuProps {
  rootRef: RefObject<HTMLElement | null>;
  state: SlashMenuState;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
  onClose: () => void;
  onImageFile: (file: File | null) => void;
  imageClickRef: RefObject<{ open: () => void } | null>;
  databasePick: boolean;
  onDatabasePickCancel: () => void;
  onDatabaseCommit: (tableId: string) => void;
  embedForm: boolean;
  onEmbedCancel: () => void;
  onEmbedCommit: (input: { kind: EmbedKind; src: string }) => void;
}

export type {
  EmbedKind,
  OpenMenuKey,
  SlashApplyPlan,
  SlashCommand,
  SlashDerivation,
  SlashIcon,
  SlashMenuApi,
  SlashMenuProps,
  SlashMenuState,
};
