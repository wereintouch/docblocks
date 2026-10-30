/** The mention picker's `useMentionMenu` owner hook (the state, the
 *  `@` trigger, the live-query pick over the consumer's mention
 *  provider, and the open-menu keys). The context stands in
 *  `context.ts` (the provider's seat is the editor's root). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

import type { BlockId } from "docblocks-core";
import { InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { focusCaretIn } from "../block-commands";
import { blockInnerOf, blockTextOf, isQueryBoundary, liveCaretOf } from "../phrase";
import { MentionPicker } from "./MentionPicker";
import type { MentionDerivation, MentionMenuApi, MentionMenuState, MentionPick } from "./models";
import { deriveMention } from "./utils";

/**
 * The editor-level mention picker state. The root owns the state and renders
 * the picker; the blocks get the stable api (the key handling reads the
 * state through a ref, so query changes do not re-render the block tree).
 */
function useMentionMenu(rootRef: RefObject<HTMLElement | null>): { api: MentionMenuApi; menuNode: ReactNode } {
  const { doc, store, mentionProvider: provider } = useEditorContext();
  const [state, setState] = useState<MentionMenuState | null>(null);
  const stateRef = useRef<MentionMenuState | null>(null);
  stateRef.current = state;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  // The flattened items the picker reports (users, then docs): the arrow
  // nav and the Enter pick read them through this ref (no re-render loop).
  const itemsRef = useRef<MentionPick[]>([]);

  const open = useCallback((blockId: BlockId, parentId: BlockId, atOffset: number) => {
    setState({ blockId, parentId, atOffset, active: 0 });
  }, []);

  const close = useCallback(() => {
    setState(null);
    itemsRef.current = [];
  }, []);

  const openDerivation = useCallback(
    (blockId: BlockId, atOffset: number): MentionDerivation => {
      const block = store.getState().blocks[blockId];
      return deriveMention(blockTextOf(block), atOffset, liveCaretOf(rootRef, blockId, atOffset + 1));
    },
    [rootRef, store]
  );

  const move = useCallback((delta: 1 | -1) => {
    setState((s) => {
      if (s === null) return s;
      const count = itemsRef.current.length;
      if (count === 0) return s;
      return { ...s, active: (s.active + delta + count) % count };
    });
  }, []);

  /**
   * The pick: one transact — the `@query` phrase strip + the mention insert
   * (the label run) + the mention mark over it (one undo step), and the
   * caret seats after the mention. A stale phrase (the `@` gone) is a no-op
   * close.
   */
  const pick = useCallback(
    (pick: MentionPick) => {
      const s = stateRef.current;
      if (s === null) return;
      // A degenerate provider entry (an empty id or label) would stand a
      // no-op mark or a phrase strip with nothing to commit: ignore it.
      if (pick.id === "" || pick.label === "") return;
      const block = doc.getBlock(s.blockId);
      if (block === null) {
        close();
        return;
      }
      const derivation = openDerivation(s.blockId, s.atOffset);
      if (derivation.closed) {
        close();
        return;
      }
      const scope = rootRef.current ?? document;
      const labelLen = pick.label.length;
      try {
        doc.transact(() => {
          doc.deleteText(s.blockId, s.atOffset, derivation.queryEnd);
          doc.insertText(s.blockId, s.atOffset, pick.label);
          doc.setMark(s.blockId, s.atOffset, s.atOffset + labelLen, {
            type: "mention",
            kind: pick.kind,
            id: pick.id,
            label: pick.label,
          });
        });
        focusCaretIn(s.blockId, s.atOffset + labelLen, scope);
      } catch (error) {
        if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return;
        throw error;
      }
      close();
    },
    [close, doc, openDerivation, rootRef]
  );

  const handleOpenMenuKey = useCallback(
    (key: { key: string; isComposing: boolean }, blockId: BlockId): boolean => {
      const s = stateRef.current;
      if (s === null || s.blockId !== blockId) return false;
      const derivation = openDerivation(blockId, s.atOffset);
      if (derivation.closed) {
        close();
        return false;
      }
      const items = itemsRef.current;
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
        case "Enter": {
          if (key.isComposing || items.length === 0) return false;
          const item = items[Math.min(s.active, items.length - 1)];
          if (item === undefined) return false;
          pick(item);
          return true;
        }
        default:
          return false;
      }
    },
    [close, move, openDerivation, pick]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent, blockId: BlockId): boolean => {
      const consumed = handleOpenMenuKey({ key: event.key, isComposing: event.nativeEvent.isComposing }, blockId);
      if (consumed) event.preventDefault();
      return consumed;
    },
    [handleOpenMenuKey]
  );

  /**
   * The `@` trigger: a plain `@` keystroke at a boundary (the start or after
   * whitespace) with a provider present. The default is prevented — the
   * browser's insertion stands suppressed; the caller commits the character
   * (one undo step) and the picker tracks it by offset. Without a provider,
   * or at a non-boundary (an email `a@b`), the `@` is plain text.
   */
  const onMentionKey = useCallback(
    (event: KeyboardEvent, blockId: BlockId, parentId: BlockId, caretOffset: number): boolean => {
      if (event.key !== "@" || event.nativeEvent.isComposing) return false;
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (providerRef.current === null) return false;
      const block = store.getState().blocks[blockId];
      if (block === undefined) return false;
      const text = blockTextOf(block);
      const atBoundary = caretOffset === 0 || isQueryBoundary(text.charAt(caretOffset - 1));
      if (!atBoundary) return false;
      event.preventDefault();
      open(blockId, parentId, caretOffset);
      return true;
    },
    [open, store]
  );

  // Auto-close: the selection left the triggering block, became a range, or
  // the block vanished. A caret move inside the block re-derives (the live
  // read stands).
  const openFlag = state !== null;
  useEffect(() => {
    if (!openFlag) return;
    const onSelectionChange = () => {
      const s = stateRef.current;
      if (s === null) return;
      const el = blockInnerOf(rootRef, s.blockId);
      if (el === null) {
        setState(null);
        return;
      }
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
        setState(null);
        return;
      }
      const anchor = selection.anchorNode;
      if (anchor === null || !el.contains(anchor)) {
        setState(null);
        return;
      }
      setState((cur) => (cur === null ? cur : { ...cur }));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [openFlag, rootRef]);

  const api = useMemo(() => ({ onKeyDown, onMentionKey }), [onKeyDown, onMentionKey]);
  const menuNode =
    state !== null ? (
      <MentionPicker
        rootRef={rootRef}
        state={state}
        provider={provider}
        active={state.active}
        onItemsChange={(items) => {
          itemsRef.current = items;
        }}
        onHover={(index) => setState((s) => (s === null ? s : { ...s, active: index }))}
        onPick={pick}
        onClose={close}
      />
    ) : null;

  return { api, menuNode };
}

export { useMentionMenu };
