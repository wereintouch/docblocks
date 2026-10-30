/** The slash menu's editor-level hooks: the context api and the
 *  `useSlashMenu` owner hook (the state + the auto-close + the pick /
 *  image / database commit paths). */
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { BlockId } from "docblocks-core";
import { InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { focusCaretIn, segmentRange } from "../block-commands";
import { selectionInside } from "../dom-offset";
import { SlashMenu } from "./SlashMenu";
import type { EmbedKind, OpenMenuKey, SlashDerivation, SlashMenuApi, SlashMenuState } from "./models";
import {
  applySlashPlan,
  blockTextOf,
  deriveSlash,
  filterCommands,
  indentOf,
  isQueryBoundary,
  liveCaretOf,
  planSlashApply,
  slashInnerOf,
} from "./utils";

const SlashMenuContext = createContext<SlashMenuApi | null>(null);

/** The slash menu api for the nearest editor root (null = slash disabled). */
function useSlashMenuApi(): SlashMenuApi | null {
  return useContext(SlashMenuContext);
}

/**
 * The editor-level slash menu state and UI. The root owns the state and
 * renders the menu; the blocks get the stable api (the key handling reads
 * the state through a ref, so query changes do not re-render the block
 * tree).
 */
function useSlashMenu(rootRef: RefObject<HTMLElement | null>): { api: SlashMenuApi; menuNode: ReactNode } {
  const { doc, store, blobStore } = useEditorContext();
  const [state, setState] = useState<SlashMenuState | null>(null);
  const stateRef = useRef<SlashMenuState | null>(null);
  stateRef.current = state;
  // The slash Image upload: the picker's open ref (registered by the
  // menu's hidden file input) + the pending pick context (the caret block
  // and the slash anchor), committed on the file pick.
  const imageClickRef = useRef<{ open: () => void } | null>(null);
  const pendingImageRef = useRef<{ blockId: BlockId; parentId: BlockId; slashOffset: number } | null>(null);
  // The slash Database picker: the open flag (the menu panel stands the
  // picker over the phrase) + the pending pick context, committed on the
  // table pick.
  const [databasePick, setDatabasePick] = useState(false);
  const databasePickRef = useRef(false);
  databasePickRef.current = databasePick;
  const pendingDatabaseRef = useRef<{ blockId: BlockId; parentId: BlockId; slashOffset: number } | null>(null);
  // The slash Embed form: the open flag (the menu panel stands the form over
  // the phrase) + the pending form context, committed on the form's commit.
  const [embedForm, setEmbedForm] = useState(false);
  const embedFormRef = useRef(false);
  embedFormRef.current = embedForm;
  const pendingEmbedRef = useRef<{ blockId: BlockId; parentId: BlockId; slashOffset: number } | null>(null);

  const open = useCallback((blockId: BlockId, parentId: BlockId, slashOffset: number) => {
    setDatabasePick(false);
    pendingDatabaseRef.current = null;
    setEmbedForm(false);
    pendingEmbedRef.current = null;
    setState({ blockId, parentId, slashOffset, active: 0 });
  }, []);

  const close = useCallback(() => {
    setDatabasePick(false);
    pendingDatabaseRef.current = null;
    setEmbedForm(false);
    pendingEmbedRef.current = null;
    setState(null);
  }, []);

  /** The open-menu derivation (the live doc text + the live caret). */
  const openDerivation = useCallback(
    (blockId: BlockId, slashOffset: number): SlashDerivation => {
      const block = store.getState().blocks[blockId];
      return deriveSlash(blockTextOf(block), slashOffset, liveCaretOf(rootRef, blockId, slashOffset + 1));
    },
    [rootRef, store]
  );

  const move = useCallback(
    (delta: 1 | -1) => {
      setState((s) => {
        if (s === null) return s;
        const items = filterCommands(openDerivation(s.blockId, s.slashOffset).query);
        if (items.length === 0) return s;
        const next = (s.active + delta + items.length) % items.length;
        return { ...s, active: next };
      });
    },
    [openDerivation]
  );

  const hover = useCallback((index: number) => {
    setState((s) => (s === null ? s : { ...s, active: index }));
  }, []);

  /**
   * Apply the item: the plan is re-derived from the live doc (the doc is
   * the source of truth — a change since the open can stale the state);
   * a stale anchor, a vanished block, or a zero-list pick is a no-op close.
   */
  const pick = useCallback(
    (index: number) => {
      const s = stateRef.current;
      if (s === null) return;
      const block = doc.getBlock(s.blockId);
      if (block === null) {
        close();
        return;
      }
      const text = blockTextOf(block);
      const derivation = openDerivation(s.blockId, s.slashOffset);
      if (derivation.closed) {
        close();
        return;
      }
      const items = filterCommands(derivation.query);
      // The clamped highlight index (the menu renders the clamped value):
      // a filtered-down list keeps the last item active.
      const command = items.length === 0 ? undefined : items[Math.min(index, items.length - 1)];
      if (command === undefined) return;
      // The image is an upload insert: the menu stays open (the phrase is
      // intact, the derivation stays live) while the picker stands; the
      // commit (phrase strip + the insert) lands on the file pick.
      if (command.type === "image") {
        pendingImageRef.current = { blockId: s.blockId, parentId: s.parentId, slashOffset: s.slashOffset };
        imageClickRef.current?.open();
        return;
      }
      // The database is a picker insert: the menu stands open (the phrase
      // stays intact, the derivation stays live) while the picker stands;
      // the commit (phrase strip + the insert) lands on the table pick.
      if (command.type === "database") {
        pendingDatabaseRef.current = { blockId: s.blockId, parentId: s.parentId, slashOffset: s.slashOffset };
        setDatabasePick(true);
        return;
      }
      // The embed is a form insert: the menu stands open (the phrase stays
      // intact, the derivation stays live) while the form stands; the commit
      // (phrase strip + the insert) lands on the form's commit.
      if (command.type === "embed") {
        pendingEmbedRef.current = { blockId: s.blockId, parentId: s.parentId, slashOffset: s.slashOffset };
        setEmbedForm(true);
        return;
      }
      setState(null);
      const segment = segmentRange(doc, s.parentId, s.blockId);
      const hasFollowers = segment !== null && segment.end > segment.start + 1;
      const plan = planSlashApply(command, block, text, s.slashOffset, hasFollowers);
      applySlashPlan(doc, plan, command, s.blockId, s.parentId, indentOf(block), rootRef.current ?? document);
    },
    [close, doc, openDerivation, rootRef]
  );

  /**
   * The open-menu key handling, on the key facts; true = the key is the
   * menu's (the caller preventDefaults). Everything else is the doc's:
   * printable keys, Backspace, and space flow through the normal input
   * path (they grow, shrink, or end the query).
   */
  /**
   * The file pick of the slash Image command: the upload runs first (the
   * doc holds only a committed key), then one transact — the trigger
   * phrase strip (when it still stands at its anchor) + the image insert
   * after the caret block, a trailing empty paragraph when the image
   * takes the sequence's end (the caret seats there), and the caret
   * re-seat. A refused or cancelled pick commits nothing (the menu stays
   * open on the phrase).
   */
  const handleImageFile = useCallback(
    (file: File | null) => {
      const pending = pendingImageRef.current;
      pendingImageRef.current = null;
      if (pending === null || file === null) return;
      const { blockId, parentId, slashOffset } = pending;
      if (doc.getBlock(blockId) === null) return;
      blobStore
        .upload(file, { name: file.name })
        .then((key) => {
          const scope = rootRef.current ?? document;
          try {
            doc.transact(() => {
              const current = doc.getBlock(blockId);
              if (current === null) return;
              const indent = indentOf(current);
              const ind = indent !== 0 ? { indent } : {};
              const text = blockTextOf(current);
              if (text.charAt(slashOffset) === "/") {
                let queryEnd = slashOffset + 1;
                while (queryEnd < text.length && !isQueryBoundary(text.charAt(queryEnd))) queryEnd += 1;
                doc.deleteText(blockId, slashOffset, queryEnd);
              }
              const imageId = doc.insertBlock("image", { src: key, ...ind }, { parent: parentId, after: blockId });
              const sequence = doc.getChildren(parentId);
              if (sequence[sequence.length - 1] === imageId) {
                const trailingId = doc.insertBlock("paragraph", ind, { parent: parentId, after: imageId });
                focusCaretIn(trailingId, 0, scope);
              } else {
                focusCaretIn(blockId, slashOffset, scope);
              }
            });
          } catch (error) {
            if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return;
            throw error;
          }
          close();
        })
        .catch(() => {
          // The upload was refused (or the legacy resolver holds no upload
          // path): nothing commits; the menu stands open on the phrase.
        });
    },
    [blobStore, close, doc, rootRef]
  );

  /**
   * The table pick of the slash Database command: one transact — the
   * trigger phrase strip (when it still stands at its anchor) + the
   * database insert (the `tableId` reference) after the caret block, a
   * trailing empty paragraph when the block takes the sequence's end (the
   * caret seats there), and the caret re-seat. A cancelled pick commits
   * nothing (the menu stands open on the phrase).
   */
  const commitDatabase = useCallback(
    (tableId: string) => {
      const pending = pendingDatabaseRef.current;
      pendingDatabaseRef.current = null;
      setDatabasePick(false);
      if (pending === null) return;
      const { blockId, parentId, slashOffset } = pending;
      if (doc.getBlock(blockId) === null) return;
      const scope = rootRef.current ?? document;
      try {
        doc.transact(() => {
          const current = doc.getBlock(blockId);
          if (current === null) return;
          const indent = indentOf(current);
          const ind = indent !== 0 ? { indent } : {};
          const text = blockTextOf(current);
          if (text.charAt(slashOffset) === "/") {
            let queryEnd = slashOffset + 1;
            while (queryEnd < text.length && !isQueryBoundary(text.charAt(queryEnd))) queryEnd += 1;
            doc.deleteText(blockId, slashOffset, queryEnd);
          }
          const databaseId = doc.insertBlock("database", { tableId, ...ind }, { parent: parentId, after: blockId });
          const sequence = doc.getChildren(parentId);
          if (sequence[sequence.length - 1] === databaseId) {
            const trailingId = doc.insertBlock("paragraph", ind, { parent: parentId, after: databaseId });
            focusCaretIn(trailingId, 0, scope);
          } else {
            focusCaretIn(blockId, slashOffset, scope);
          }
        });
      } catch (error) {
        if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return;
        throw error;
      }
      close();
    },
    [close, doc, rootRef]
  );

  const commitEmbed = useCallback(
    (input: { kind: EmbedKind; src: string }) => {
      const pending = pendingEmbedRef.current;
      pendingEmbedRef.current = null;
      setEmbedForm(false);
      if (pending === null) return;
      const { blockId, parentId, slashOffset } = pending;
      if (doc.getBlock(blockId) === null) return;
      const scope = rootRef.current ?? document;
      try {
        doc.transact(() => {
          const current = doc.getBlock(blockId);
          if (current === null) return;
          const indent = indentOf(current);
          const ind = indent !== 0 ? { indent } : {};
          const text = blockTextOf(current);
          if (text.charAt(slashOffset) === "/") {
            let queryEnd = slashOffset + 1;
            while (queryEnd < text.length && !isQueryBoundary(text.charAt(queryEnd))) queryEnd += 1;
            doc.deleteText(blockId, slashOffset, queryEnd);
          }
          const embedId = doc.insertBlock(
            "embed",
            { kind: input.kind, src: input.src, ...ind },
            { parent: parentId, after: blockId }
          );
          const sequence = doc.getChildren(parentId);
          if (sequence[sequence.length - 1] === embedId) {
            const trailingId = doc.insertBlock("paragraph", ind, { parent: parentId, after: embedId });
            focusCaretIn(trailingId, 0, scope);
          } else {
            focusCaretIn(blockId, slashOffset, scope);
          }
        });
      } catch (error) {
        if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return;
        throw error;
      }
      close();
    },
    [close, doc, rootRef]
  );

  const handleOpenMenuKey = useCallback(
    (key: OpenMenuKey, blockId: BlockId): boolean => {
      const s = stateRef.current;
      if (s === null || s.blockId !== blockId) return false;
      const derivation = openDerivation(blockId, s.slashOffset);
      if (derivation.closed) {
        close();
        return false;
      }
      const items = filterCommands(derivation.query);
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
    [close, move, openDerivation, pick]
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

  // Auto-close: the selection left the triggering block, became a range,
  // or the block vanished (the caret window itself is checked on the
  // derivation — live, at render and key time). A caret move inside the
  // block re-renders the menu (a fresh state object) so the derivation
  // re-runs.
  const openFlag = state !== null;
  useEffect(() => {
    if (!openFlag) return;
    const onSelectionChange = () => {
      const s = stateRef.current;
      if (s === null) return;
      // The picker / form is standing (the input's focus is expected — the
      // menu stays open over the phrase until it commits or cancels).
      if (databasePickRef.current || embedFormRef.current) return;
      const el = slashInnerOf(rootRef, s.blockId);
      if (el === null) {
        setState(null);
        return;
      }
      const selection = window.getSelection();
      if (!selectionInside(el) || selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
        setState(null);
        return;
      }
      // A caret move inside the block: re-derive (the live read stands).
      setState((cur) => (cur === null ? cur : { ...cur }));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [openFlag, rootRef]);

  const api = useMemo(() => ({ onKeyDown, onSlashKey }), [onKeyDown, onSlashKey]);
  const menuNode =
    state !== null ? (
      <SlashMenu
        rootRef={rootRef}
        state={state}
        onHover={hover}
        onPick={pick}
        onClose={close}
        onImageFile={handleImageFile}
        imageClickRef={imageClickRef}
        databasePick={databasePick}
        onDatabasePickCancel={() => {
          setDatabasePick(false);
          pendingDatabaseRef.current = null;
        }}
        onDatabaseCommit={commitDatabase}
        embedForm={embedForm}
        onEmbedCancel={() => {
          setEmbedForm(false);
          pendingEmbedRef.current = null;
        }}
        onEmbedCommit={commitEmbed}
      />
    ) : null;

  return { api, menuNode };
}

export { SlashMenuContext, useSlashMenu, useSlashMenuApi };
