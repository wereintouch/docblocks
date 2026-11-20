/**
 * The table's forward-only undo history (the per-(bridge, tableId) stacks):
 * a new operation pushes the inverse and clears the redo side; the undo /
 * the redo run the inverse / the forward over the bridge. The in-flight
 * guard: a re-entrant press over the same entry in flight stands no second
 * inverse / forward (the re-entrant call is dropped, not queued). The
 * identity stand: a relink (the bridge / the tableId change) over the
 * in-flight window re-stands the history (the stacks stand cleared) — the
 * post-await commit (the pop / the re-stack) must not carry the old entry
 * into the new table's history. A failed inverse / forward leaves its
 * entry on the stack (the retry stand).
 */
import { useCallback, useRef, useState } from "react";

import type { DatabaseBridge } from "../bridge";
import type { InverseOp } from "./models";

interface TableHistoryContext {
  bridge: DatabaseBridge;
  tableId: string;
  noteError: (operationError: unknown) => void;
  /** The error display's clear (the successful inverse / forward's stand). */
  clearError: () => void;
  refresh: () => void;
  clearPendingRow: () => void;
}

interface TableHistory {
  pushUndo(op: InverseOp, opBridge: DatabaseBridge, opTableId: string): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
}

function useTableHistory({
  bridge,
  tableId,
  noteError,
  clearError,
  refresh,
  clearPendingRow,
}: TableHistoryContext): TableHistory {
  const [, setStackVersion] = useState(0); // a re-render trigger for canUndo / canRedo
  const undoStackRef = useRef<InverseOp[]>([]);
  const redoStackRef = useRef<InverseOp[]>([]);
  // The history's mutation channel: a single in-flight guard (an undo / a
  // redo over the same entry in flight stands no second inverse / forward —
  // the re-entrant call is dropped, not queued).
  const historyInFlightRef = useRef(false);
  // The history's identity: the undo/redo stacks stand PER (bridge,
  // tableId) — a relink of the block to another table / bridge drops the
  // previous one's history in the render (the per-(bridge, tableId) stack stand).
  const historyRef = useRef<{ bridge: DatabaseBridge; tableId: string }>({ bridge, tableId });
  if (historyRef.current.bridge !== bridge || historyRef.current.tableId !== tableId) {
    historyRef.current = { bridge, tableId };
    undoStackRef.current = [];
    redoStackRef.current = [];
  }

  const pushUndo = useCallback((op: InverseOp, opBridge: DatabaseBridge, opTableId: string) => {
    if (historyRef.current.bridge !== opBridge || historyRef.current.tableId !== opTableId) return;
    undoStackRef.current.push(op);
    redoStackRef.current = []; // a new operation clears the redo side (forward-only)
    setStackVersion((version) => version + 1);
  }, []);

  const undo = useCallback(async () => {
    // The in-flight stand: a re-entrant undo (the second press over the
    // first's in-flight inverse) stands no second inverse over the same
    // entry.
    if (historyInFlightRef.current) return;
    const ops = undoStackRef.current;
    const op = ops[ops.length - 1];
    if (op === undefined) return;
    clearPendingRow();
    // The identity at the call's time: a relink (the bridge / the tableId
    // change) over the in-flight inverse re-stands the history (the stacks
    // stand cleared, historyRef stands the new one) — the post-await
    // commit (the pop / the redo-push) must not carry the old entry into
    // the new table's history.
    const identity = { bridge: historyRef.current.bridge, tableId: historyRef.current.tableId };
    const sameIdentity = () =>
      historyRef.current.bridge === identity.bridge && historyRef.current.tableId === identity.tableId;
    // The window detector: the redo stack at the call's time. A forward
    // write that commits over the in-flight inverse runs the pushUndo (the
    // redo stack stands REPLACED, not grown) — the history's invariant "a
    // new operation clears the redo side" then applies to this undo too:
    // the op stands consumed (popped from the undo stack) but NOT moved to
    // the redo stack (it would stand redoable over the newer write — the
    // redo's re-commit would clobber it). The op's inverse already applied
    // over the bridge; the refresh stands the UI on the bridge's truth.
    const redoStackAtCall = redoStackRef.current;
    historyInFlightRef.current = true;
    try {
      await op.inverse();
      if (!sameIdentity()) return;
      // The identity stand over the in-flight window: the user's forward
      // write may have grown the stack since the call (the push over the
      // same array) — the removal stands by identity (the top's pop, the
      // grown stand's splice out of position), never by blind position
      // (a foreign top's pop would drop the fresh entry from the history
      // and the redo's re-commit would stand a duplicate over the bridge).
      const index = ops.lastIndexOf(op);
      if (index !== -1) {
        if (index === ops.length - 1) ops.pop();
        else ops.splice(index, 1);
        if (redoStackRef.current === redoStackAtCall) redoStackRef.current.push(op);
      }
      // The successful inverse clears the last-op's error display.
      clearError();
    } catch (operationError) {
      if (!sameIdentity()) return;
      // The failed entry STAYS on the stack (the retry stand): a failed
      // inverse never drops the operation.
      noteError(operationError);
    } finally {
      historyInFlightRef.current = false;
    }
    if (!sameIdentity()) return;
    setStackVersion((version) => version + 1);
    refresh();
  }, [noteError, refresh, clearPendingRow]);

  const redo = useCallback(async () => {
    if (historyInFlightRef.current) return;
    const ops = redoStackRef.current;
    const op = ops[ops.length - 1];
    if (op === undefined) return;
    clearPendingRow();
    const identity = { bridge: historyRef.current.bridge, tableId: historyRef.current.tableId };
    const sameIdentity = () =>
      historyRef.current.bridge === identity.bridge && historyRef.current.tableId === identity.tableId;
    // The symmetric window stand: the undo stack at the call's time. A
    // forward write that commits over the in-flight forward run PUSHes onto
    // the same array (the pushUndo does not replace the undo stack). The
    // redone op stands a live edit (its forward already applied) and must
    // re-enter the undo stack — but at the call's position, NOT on top of
    // the window's writes (the naive push would stand the undo order's
    // inversion: the first undo reverts the stale op, not the newest
    // write). The call-time insertion keeps the window's writes on top:
    // the undo walks back over the newest first, the redone op then.
    const undoStackAtCall = undoStackRef.current;
    const undoLengthAtCall = undoStackRef.current.length;
    historyInFlightRef.current = true;
    try {
      await op.forward();
      if (!sameIdentity()) return;
      // The symmetric identity stand (the redo's stack stands stable over
      // the in-flight window — the history's in-flight guard — the identity
      // check stands the stand anyway).
      const index = ops.lastIndexOf(op);
      if (index !== -1) {
        if (index === ops.length - 1) ops.pop();
        else ops.splice(index, 1);
        if (undoStackRef.current === undoStackAtCall) {
          // The call-time position's insertion: no window — the top's push
          // (the length is the call's); the window's stand — below the
          // window's writes (the splice at the call's length).
          undoStackRef.current.splice(undoLengthAtCall, 0, op);
        }
      }
      clearError();
    } catch (operationError) {
      if (!sameIdentity()) return;
      // The failed entry STAYS on the stack (the retry stand).
      noteError(operationError);
    } finally {
      historyInFlightRef.current = false;
    }
    if (!sameIdentity()) return;
    setStackVersion((version) => version + 1);
    refresh();
  }, [noteError, clearError, refresh, clearPendingRow]);

  return {
    pushUndo,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
  };
}

export { useTableHistory };
export type { TableHistory, TableHistoryContext };
