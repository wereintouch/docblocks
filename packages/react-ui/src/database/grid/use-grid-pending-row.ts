/**
 * The inserted row's temporary visibility (the `pendingRow`'s stand over
 * the filtered view): the live revision's re-baseline's stand (the mid-
 * session's refetch re-reads the revision over the peer's commit), the
 * edit's seat (the first column's cell stands the draft's focus stand),
 * and the dismissal (the outside press / the blur's stand — the editor
 * commits its draft when the session closes; the row stays mounted
 * through that effect and leaves the filtered view afterwards).
 */
import { useCallback, useEffect, useRef } from "react";
import type { FocusEvent } from "react";

import { useDatabaseTable } from "../use-database-table";
import type { DatabaseTableRow } from "../use-database-table/models";
import { cellKeyOf } from "./utils";

interface UseGridPendingRowContext {
  /** The effective pending row (the row absent from the filtered page). */
  pendingRow: DatabaseTableRow | null;
  data: Pick<ReturnType<typeof useDatabaseTable>, "dismissPendingRow">;
  columns: readonly { id: string }[];
  tableRef: { current: HTMLDivElement | null };
  setEditingCell: (key: string | null) => void;
}

function useGridPendingRow({ pendingRow, data, columns, tableRef, setEditingCell }: UseGridPendingRowContext) {
  const pendingDismissTimerRef = useRef<number | null>(null);
  const pendingRowId = pendingRow?.rowId ?? null;

  const pendingEditKey =
    pendingRowId !== null && columns[0] !== undefined ? cellKeyOf(pendingRowId, columns[0].id) : null;
  useEffect(() => {
    if (pendingEditKey !== null) setEditingCell(pendingEditKey);
  }, [pendingEditKey, setEditingCell]);

  const dismissPending = useCallback(() => {
    if (pendingRowId === null) return;
    setEditingCell(null);
    if (pendingDismissTimerRef.current !== null) window.clearTimeout(pendingDismissTimerRef.current);
    // The editor commits its draft when the session closes; the row stays
    // mounted through that effect and leaves the filtered view afterwards.
    pendingDismissTimerRef.current = window.setTimeout(() => {
      data.dismissPendingRow(pendingRowId);
      pendingDismissTimerRef.current = null;
    }, 0);
  }, [pendingRowId, data.dismissPendingRow, setEditingCell]);

  useEffect(() => {
    if (pendingRowId === null) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target === null) return;
      if (target.closest("[data-radix-popper-content-wrapper], [data-filter-pending='true']") !== null) return;
      dismissPending();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      if (pendingDismissTimerRef.current !== null) {
        window.clearTimeout(pendingDismissTimerRef.current);
        pendingDismissTimerRef.current = null;
      }
    };
  }, [pendingRowId, dismissPending]);

  const onTableBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (pendingRowId === null) return;
    const next = event.relatedTarget;
    if (!(next instanceof Node)) return;
    if (tableRef.current?.contains(next)) return;
    if (next instanceof Element && next.closest("[data-radix-popper-content-wrapper]") !== null) return;
    dismissPending();
  };

  return { pendingRowId, onTableBlur };
}

export { useGridPendingRow };
export type { UseGridPendingRowContext };
