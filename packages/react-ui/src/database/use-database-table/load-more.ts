import type { Dispatch, SetStateAction } from "react";

import type { DatabaseBridge } from "../bridge";
import { isBridgeError } from "../bridge";
import type { DatabaseTableRow, RefCell } from "./models";

interface LoadMoreContext {
  bridge: DatabaseBridge;
  tableId: string;
  nextCursor: string | null;
  loadTokenRef: RefCell<number>;
  pageRef: RefCell<{ asOfSeq: number; fingerprint: string }>;
  revisionsRef: RefCell<Map<string, string>>;
  setRows: Dispatch<SetStateAction<DatabaseTableRow[]>>;
  setNextCursor: (cursor: string | null) => void;
  noteError: (operationError: unknown) => void;
  refresh: () => void;
}

/** The next page's continuation (the `nextCursor`'s stand over the
 *  cursor's snapshot boundary). */
function createLoadMore(ctx: LoadMoreContext): () => Promise<void> {
  const { bridge, tableId, nextCursor, loadTokenRef, pageRef, revisionsRef, setRows, setNextCursor } = ctx;
  const { noteError, refresh } = ctx;
  return async () => {
    if (nextCursor === null) return;
    // The token at the call's time: a fresh snapshot (the event refetch,
    // the retry, the rebaseline) bumps it, so the stale page stands no
    // state over the fresh one's rows + cursor.
    const token = loadTokenRef.current;
    const { asOfSeq, fingerprint } = pageRef.current;
    try {
      const page = await bridge.queryNextPage(tableId, {
        cursor: nextCursor,
        asOfSeq,
        queryFingerprint: fingerprint,
      });
      if (token !== loadTokenRef.current) return; // a newer snapshot stands the rows + cursor
      pageRef.current = { asOfSeq: page.asOfSeq, fingerprint: page.queryFingerprint };
      // The appended rows' revisions stand the CAS (the same stand as the
      // snapshot's page).
      for (const row of page.rows) revisionsRef.current.set(row.id, row.revision);
      setRows((rows) => {
        const known = new Set(rows.map((row) => row.rowId));
        const appended = page.rows
          .filter((row) => !known.has(row.id))
          .map((row) => ({ rowId: row.id, cells: { ...row.cells } }));
        return [...rows, ...appended];
      });
      setNextCursor(page.nextCursor);
    } catch (operationError) {
      if (token !== loadTokenRef.current) return; // a stale failure stands no error
      // The cursor's snapshot boundary advanced: the stand is the fresh
      // page (the re-snapshot), not the error.
      if (isBridgeError(operationError) && operationError.code === "cursor_expired") {
        refresh();
        return;
      }
      noteError(operationError);
    }
  };
}

export { createLoadMore };
export type { LoadMoreContext };
