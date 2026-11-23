/** The slash menu's picker and form states (the database / frame pickers
 *  and the embed form): the open flags (the live mirror refs), the
 *  pending pick contexts, and the cancels. */
import { useRef, useState } from "react";

import type { BlockId } from "docblocks-core";

/** The pending pick context (the caret block, its parent, the slash anchor),
 *  committed by the pick's commit path. */
interface PendingPick {
  blockId: BlockId;
  parentId: BlockId;
  slashOffset: number;
}

function useSlashPickers() {
  // The slash Database picker: the open flag (the menu panel stands the
  // picker over the phrase) + the pending pick context, committed on the
  // table pick.
  const [databasePick, setDatabasePick] = useState(false);
  const databasePickRef = useRef(false);
  databasePickRef.current = databasePick;
  const pendingDatabaseRef = useRef<{ blockId: BlockId; parentId: BlockId; slashOffset: number } | null>(null);
  // The slash Frame picker: the open flag (the menu panel stands the
  // picker over the phrase) + the pending pick context, committed on the
  // frame pick (the page-frame block's weak reference — no gate: the
  // frames are the doc's own canvas data, no bridge is required).
  const [framePick, setFramePick] = useState(false);
  const framePickRef = useRef(false);
  framePickRef.current = framePick;
  const pendingFrameRef = useRef<{ blockId: BlockId; parentId: BlockId; slashOffset: number } | null>(null);
  // The slash Embed form: the open flag (the menu panel stands the form over
  // the phrase) + the pending form context, committed on the form's commit.
  const [embedForm, setEmbedForm] = useState(false);
  const embedFormRef = useRef(false);
  embedFormRef.current = embedForm;
  const pendingEmbedRef = useRef<{ blockId: BlockId; parentId: BlockId; slashOffset: number } | null>(null);

  // The pick's cancels (the database's picker, the embed's form): the
  // stand closes, the pending stand cleared (the phrase strip's removal
  // is the close's own press).
  const cancelDatabasePick = () => {
    setDatabasePick(false);
    pendingDatabaseRef.current = null;
  };
  const cancelFramePick = () => {
    setFramePick(false);
    pendingFrameRef.current = null;
  };
  const cancelEmbedForm = () => {
    setEmbedForm(false);
    pendingEmbedRef.current = null;
  };

  return {
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
  };
}

export { useSlashPickers };
export type { PendingPick };
