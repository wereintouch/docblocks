/** The slash menu's pick commit paths (the file upload, the database /
 *  frame pickers, the embed form): each one is one transact — the
 *  trigger phrase strip (when it still stands at its anchor) + the block's
 *  insert after the caret block, a trailing empty paragraph when the
 *  block takes the sequence's end (the caret seats there), and the caret
 *  re-seat. A cancelled pick commits nothing. */
import { useCallback, useRef } from "react";
import type { RefObject } from "react";

import type { Doc } from "docblocks-core";
import { BLOCK_REGISTRY, InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import type { BlobStore } from "../../blob-store";
import type { EditorStore } from "../../state";
import { focusCaretIn, segmentRange } from "../block-commands";
import { blockTextOf, isQueryBoundary } from "../phrase";
import { indentOf } from "./helpers";
import type { PendingPick } from "./use-slash-pickers";

interface UseSlashCommitPaths {
  doc: Doc;
  store: EditorStore;
  blobStore: BlobStore;
  rootRef: RefObject<HTMLElement | null>;
  close: () => void;
  setDatabasePick: (open: boolean) => void;
  pendingDatabaseRef: RefObject<PendingPick | null>;
  setFramePick: (open: boolean) => void;
  pendingFrameRef: RefObject<PendingPick | null>;
  setEmbedForm: (open: boolean) => void;
  pendingEmbedRef: RefObject<PendingPick | null>;
}

function useSlashCommitPaths({
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
}: UseSlashCommitPaths): {
  handleFile: (file: File | null) => void;
  commitDatabase: (tableId: string) => void;
  commitFrame: (frameId: string) => void;
  commitEmbed: (src: string) => void;
  pendingFileRef: RefObject<PendingPick | null>;
} {
  // The slash File upload: the pending pick context (the caret block and
  // the slash anchor), committed on the file pick. The stand (the phrase
  // block's row stands the skeleton over the popover's closed state) is
  // the store's `fileUpload` slice — the row stands it, the popover stands
  // closed.
  const pendingFileRef = useRef<PendingPick | null>(null);

  /**
   * The file pick of the slash File command: the upload runs first (the
   * doc holds only a committed key), then one transact — the trigger
   * phrase strip (when it still stands at its anchor) + the image / file
   * insert. A phrase-only block without a derived segment is replaced at
   * its slot; otherwise the attachment lands after the caret block. A
   * trailing empty paragraph stands when the attachment takes the
   * sequence's end (the caret seats there). A cancelled pick stands no
   * event of its own (the dialog's close's page-focus clears the stand,
   * the phrase's row returns); a refused upload commits nothing (the
   * failed stand's error line stands over the skeleton — the stand's
   * click dismisses it).
   */
  const handleFile = useCallback(
    (file: File | null) => {
      const pending = pendingFileRef.current;
      pendingFileRef.current = null;
      if (pending === null) return;
      const { blockId, parentId, slashOffset } = pending;
      if (file === null) {
        // A cleared input (no delivery): the stand clears, the phrase's
        // row returns.
        store.getState().setFileUpload(null);
        return;
      }
      if (doc.getBlock(blockId) === null) {
        store.getState().setFileUpload(null);
        return;
      }
      store.getState().setFileUpload({ blockId, phase: "uploading" });
      void (async () => {
        try {
          const fileId = await blobStore.upload(file);
          const scope = rootRef.current ?? document;
          try {
            doc.transact(() => {
              const current = doc.getBlock(blockId);
              if (current === null) return;
              const indent = indentOf(current);
              const ind = indent !== 0 ? { indent } : {};
              const text = blockTextOf(current);
              const hasPhrase = text.charAt(slashOffset) === "/";
              let queryEnd = slashOffset + 1;
              if (hasPhrase) {
                while (queryEnd < text.length && !isQueryBoundary(text.charAt(queryEnd))) queryEnd += 1;
              }
              const stripped = hasPhrase ? text.slice(0, slashOffset) + text.slice(queryEnd) : text;
              const segment = segmentRange(doc, parentId, blockId);
              const replace = stripped === "" && segment !== null && segment.end === segment.start + 1;
              if (!replace && hasPhrase) doc.deleteText(blockId, slashOffset, queryEnd);
              const position = { parent: parentId, after: blockId };
              const attachmentId = file.type.startsWith("image/")
                ? doc.insertBlock("image", { src: fileId, ...ind }, position)
                : doc.insertBlock("file", { fileId, ...ind }, position);
              // Inserting after the phrase-only block and then removing it
              // keeps the attachment at the same sequence slot.
              if (replace) {
                doc.removeBlock(blockId);
                rootRef.current?.focus();
              }
              const sequence = doc.getChildren(parentId);
              if (sequence[sequence.length - 1] === attachmentId) {
                const trailingId = doc.insertBlock("paragraph", ind, { parent: parentId, after: attachmentId });
                focusCaretIn(trailingId, 0, scope);
              } else if (replace) {
                const attachmentIndex = sequence.indexOf(attachmentId);
                const nextId = sequence.slice(attachmentIndex + 1).find((id) => {
                  const next = doc.getBlock(id);
                  return next !== null && BLOCK_REGISTRY[next.type].content;
                });
                if (nextId !== undefined) focusCaretIn(nextId, 0, scope);
              } else {
                focusCaretIn(blockId, slashOffset, scope);
              }
            });
          } catch (error) {
            if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) {
              store.getState().setFileUpload(null);
              return;
            }
            throw error;
          }
          close();
          store.getState().setFileUpload(null);
        } catch {
          // The upload was refused: nothing commits; the failed stand's
          // error line stands over the phrase block's skeleton (the
          // stand's click dismisses it — the phrase's row returns).
          store.getState().setFileUpload({ blockId, phase: "failed" });
        }
      })();
    },
    [blobStore, close, doc, rootRef, store]
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

  /**
   * The frame pick of the slash Frame command: one transact — the
   * trigger phrase strip (when it still stands at its anchor) + the
   * page-frame block's insert (the `frameId` weak reference) after the
   * caret block, a trailing empty paragraph when the block takes the
   * sequence's end (the caret seats there), and the caret re-seat. A
   * cancelled pick commits nothing (the menu stands open on the phrase).
   */
  const commitFrame = useCallback(
    (frameId: string) => {
      const pending = pendingFrameRef.current;
      pendingFrameRef.current = null;
      setFramePick(false);
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
          const frameBlockId = doc.insertBlock("frame", { frameId, ...ind }, { parent: parentId, after: blockId });
          const sequence = doc.getChildren(parentId);
          if (sequence[sequence.length - 1] === frameBlockId) {
            const trailingId = doc.insertBlock("paragraph", ind, { parent: parentId, after: frameBlockId });
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
    (src: string) => {
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
            { kind: "iframe", src, ...ind },
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

  return { handleFile, commitDatabase, commitFrame, commitEmbed, pendingFileRef };
}

export { useSlashCommitPaths };
