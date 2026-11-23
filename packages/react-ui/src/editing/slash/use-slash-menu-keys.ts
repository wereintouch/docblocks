/** The slash menu's key handling: the open-menu keys (the navigation, the
 *  pick, the picker / form's Escape cancels) and the "/" trigger (the
 *  default is prevented — the character lands over the command API). */
import { useCallback } from "react";
import type { KeyboardEvent, RefObject } from "react";

import type { BlockId } from "docblocks-core";

import type { OpenMenuKey, SlashDerivation, SlashMenuState } from "./models";
import type { PendingPick } from "./use-slash-pickers";
import { filterCommands } from "./utils";

interface UseSlashMenuKeys {
  t: (key: string) => string;
  open: (blockId: BlockId, parentId: BlockId, caretOffset: number) => void;
  close: () => void;
  openDerivation: (blockId: BlockId, slashOffset: number) => SlashDerivation;
  move: (delta: 1 | -1) => void;
  pick: (index: number) => void;
  stateRef: RefObject<SlashMenuState | null>;
  databaseAvailable: boolean;
  databasePickRef: RefObject<boolean>;
  setDatabasePick: (open: boolean) => void;
  pendingDatabaseRef: RefObject<PendingPick | null>;
  framePickRef: RefObject<boolean>;
  setFramePick: (open: boolean) => void;
  pendingFrameRef: RefObject<PendingPick | null>;
  embedFormRef: RefObject<boolean>;
  setEmbedForm: (open: boolean) => void;
  pendingEmbedRef: RefObject<PendingPick | null>;
}

function useSlashMenuKeys({
  t,
  open,
  close,
  openDerivation,
  move,
  pick,
  stateRef,
  databaseAvailable,
  databasePickRef,
  setDatabasePick,
  pendingDatabaseRef,
  framePickRef,
  setFramePick,
  pendingFrameRef,
  embedFormRef,
  setEmbedForm,
  pendingEmbedRef,
}: UseSlashMenuKeys): {
  onKeyDown: (event: KeyboardEvent, blockId: BlockId) => boolean;
  onSlashKey: (event: KeyboardEvent, blockId: BlockId, parentId: BlockId, caretOffset: number) => boolean;
} {
  /**
   * The open-menu key handling, on the key facts; true = the key is the
   * menu's (the caller preventDefaults). Everything else is the doc's:
   * printable keys, Backspace, and space flow through the normal input
   * path (they grow, shrink, or end the query).
   */
  const handleOpenMenuKey = useCallback(
    (key: OpenMenuKey, blockId: BlockId): boolean => {
      const s = stateRef.current;
      if (s === null || s.blockId !== blockId) return false;
      const derivation = openDerivation(blockId, s.slashOffset);
      if (derivation.closed) {
        close();
        return false;
      }
      const items = filterCommands(derivation.query, databaseAvailable, t);
      // The picker state: the Escape cancels the picker (the menu stands
      // open on the phrase); the picker's input stops its own keys' propagation.
      if (databasePickRef.current) {
        if (key.key === "Escape") {
          setDatabasePick(false);
          pendingDatabaseRef.current = null;
          return true;
        }
        return false;
      }
      if (framePickRef.current) {
        if (key.key === "Escape") {
          setFramePick(false);
          pendingFrameRef.current = null;
          return true;
        }
        return false;
      }
      if (embedFormRef.current) {
        if (key.key === "Escape") {
          setEmbedForm(false);
          pendingEmbedRef.current = null;
          return true;
        }
        return false;
      }
      switch (key.key) {
        case "Escape":
          close();
          return true;
        case "ArrowDown":
          if (items.length > 0) {
            move(1);
            return true;
          }
          return false;
        case "ArrowUp":
          if (items.length > 0) {
            move(-1);
            return true;
          }
          return false;
        case "Enter":
          if (!key.isComposing && items.length > 0) {
            pick(s.active);
            return true;
          }
          return false;
        default:
          return false;
      }
    },
    [close, move, openDerivation, pick, t]
  );

  /** The open-menu key handling on the block's react event (consumes it). */
  const onKeyDown = useCallback(
    (event: KeyboardEvent, blockId: BlockId): boolean => {
      const consumed = handleOpenMenuKey(
        {
          key: event.key,
          isComposing: event.nativeEvent.isComposing,
        },
        blockId
      );
      if (consumed) event.preventDefault();
      return consumed;
    },
    [handleOpenMenuKey]
  );

  // The "/" trigger: a plain "/" keystroke with a collapsed caret. The
  // default is prevented — the browser's insertion stands suppressed; the
  // caller commits the character through the command API (one undo step)
  // and the menu tracks it by offset (the doc is the source of truth).
  const onSlashKey = useCallback(
    (event: KeyboardEvent, blockId: BlockId, parentId: BlockId, caretOffset: number): boolean => {
      if (event.key !== "/" || event.nativeEvent.isComposing) return false;
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      event.preventDefault();
      open(blockId, parentId, caretOffset);
      return true;
    },
    [open]
  );

  return { onKeyDown, onSlashKey };
}

export { useSlashMenuKeys };
