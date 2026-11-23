/** The slash menu's owner hook: the editor-level state + the auto-close +
 *  the pick / image / database commit paths. */
import { useTranslation } from "react-i18next";

import type { ReactNode, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { segmentRange } from "../block-commands";
import { selectionInside } from "../dom-offset";
import { blockInnerOf, blockTextOf, liveCaretOf } from "../phrase";
import type { SlashDerivation, SlashMenuApi, SlashMenuState } from "./models";
import { SlashMenuNode } from "./slash-menu-node";
import { useSlashCommitPaths } from "./use-slash-commit-paths";
import { useSlashMenuKeys } from "./use-slash-menu-keys";
import { useSlashPickers } from "./use-slash-pickers";
import { applySlashPlan, deriveSlash, filterCommands, indentOf, planSlashApply } from "./utils";

/**
 * The editor-level slash menu state and UI. The root owns the state and
 * renders the menu; the blocks get the stable api (the key handling reads
 * the state through a ref, so query changes do not re-render the block
 * tree).
 */
function useSlashMenu(rootRef: RefObject<HTMLElement | null>): { api: SlashMenuApi; menuNode: ReactNode } {
  const { t } = useTranslation("slash");
  const { doc, store, blobStore, databaseBridge } = useEditorContext();
  // The `database` slash command stands only while a bridge is available —
  // without one the external-form blocks render the disconnected placeholder,
  // so the command (the table's create / pick over the bridge) is hidden.
  const databaseAvailable = databaseBridge !== undefined;
  const [state, setState] = useState<SlashMenuState | null>(null);
  const stateRef = useRef<SlashMenuState | null>(null);
  stateRef.current = state;
  // The hidden file input's click stand: the File command's pick opens the
  // OS picker programmatically (no pointer events reach the editor).
  const fileClickRef = useRef<{ open: () => void } | null>(null);
  const {
    databasePick,
    setDatabasePick,
    databasePickRef,
    pendingDatabaseRef,
    framePick,
    setFramePick,
    framePickRef,
    pendingFrameRef,
    embedForm,
    setEmbedForm,
    embedFormRef,
    pendingEmbedRef,
    cancelDatabasePick,
    cancelFramePick,
    cancelEmbedForm,
  } = useSlashPickers();

  const open = useCallback((blockId: BlockId, parentId: BlockId, slashOffset: number) => {
    setDatabasePick(false);
    pendingDatabaseRef.current = null;
    setFramePick(false);
    pendingFrameRef.current = null;
    setEmbedForm(false);
    pendingEmbedRef.current = null;
    setState({ blockId, parentId, slashOffset, active: 0 });
  }, []);

  const close = useCallback(() => {
    setDatabasePick(false);
    pendingDatabaseRef.current = null;
    setFramePick(false);
    pendingFrameRef.current = null;
    setEmbedForm(false);
    pendingEmbedRef.current = null;
    setState(null);
  }, []);

  const { handleFile, commitDatabase, commitFrame, commitEmbed, pendingFileRef } = useSlashCommitPaths({
    doc,
    store,
    blobStore,
    rootRef,
    close,
    setDatabasePick,
    pendingDatabaseRef,
    setFramePick,
    pendingFrameRef,
    setEmbedForm,
    pendingEmbedRef,
  });

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
        const items = filterCommands(openDerivation(s.blockId, s.slashOffset).query, databaseAvailable, t);
        if (items.length === 0) return s;
        const next = (s.active + delta + items.length) % items.length;
        return { ...s, active: next };
      });
    },
    [openDerivation, t]
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
      const items = filterCommands(derivation.query, databaseAvailable, t);
      // The clamped highlight index (the menu renders the clamped value):
      // a filtered-down list keeps the last item active.
      const command = items.length === 0 ? undefined : items[Math.min(index, items.length - 1)];
      if (command === undefined) return;
      // The file command is an upload insert: the popover stands closed
      // and the phrase block's row stands the skeleton (the spinner's
      // stand) while the picker and the upload stand; the commit (phrase
      // strip + the insert) lands on the file's pick.
      if (command.type === "file") {
        pendingFileRef.current = { blockId: s.blockId, parentId: s.parentId, slashOffset: s.slashOffset };
        store.getState().setFileUpload({ blockId: s.blockId, phase: "picker" });
        close();
        fileClickRef.current?.open();
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
      // The frame is a picker insert (no gate — unlike the database's
      // bridge gate, the frames are the doc's own canvas data): the menu
      // stands open (the phrase stays intact, the derivation stays live)
      // while the picker stands; the commit (phrase strip + the insert of
      // the page-frame block's weak reference) lands on the frame pick.
      if (command.type === "frame") {
        pendingFrameRef.current = { blockId: s.blockId, parentId: s.parentId, slashOffset: s.slashOffset };
        setFramePick(true);
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
    [close, doc, openDerivation, rootRef, store, t]
  );

  const { onKeyDown, onSlashKey } = useSlashMenuKeys({
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
  });

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
      if (databasePickRef.current || framePickRef.current || embedFormRef.current) return;
      const el = blockInnerOf(rootRef, s.blockId);
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

  // The file stand's cancel: the OS dialog stands no cancel event of its
  // own — its close returns the page's focus. The `picker` phase's stand
  // clears over it (a delivered file re-stands the stand on the input's
  // change); the `uploading` phase stands the commit's in flight — a
  // focus event never clears it.
  useEffect(() => {
    const onFocus = () => {
      const stand = store.getState().fileUpload;
      if (stand !== null && stand.phase === "picker") store.getState().setFileUpload(null);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [store]);

  const api = useMemo(() => ({ onKeyDown, onSlashKey }), [onKeyDown, onSlashKey]);
  const menuNode = (
    <SlashMenuNode
      rootRef={rootRef}
      state={state}
      fileClickRef={fileClickRef}
      handleFile={handleFile}
      hover={hover}
      pick={pick}
      close={close}
      databasePick={databasePick}
      databaseAvailable={databaseAvailable}
      cancelDatabasePick={cancelDatabasePick}
      commitDatabase={commitDatabase}
      framePick={framePick}
      cancelFramePick={cancelFramePick}
      commitFrame={commitFrame}
      embedForm={embedForm}
      cancelEmbedForm={cancelEmbedForm}
      commitEmbed={commitEmbed}
    />
  );

  return { api, menuNode };
}

export { useSlashMenu };
