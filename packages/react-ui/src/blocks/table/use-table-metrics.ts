/** The table's live DOM metrics: the add-row chip's left offset (the
 * center of the visible part of the table) and the row handles' vertical
 * centering (the row offsets / heights measured from the live DOM — the
 * heights are auto per the wrapped content). No scroll listeners: the
 * chip is pinned to the frame, not the scrolled content. jsdom has no
 * ResizeObserver — the metrics keep their initial stand. */
import { useLayoutEffect, useState } from "react";

import { ADD_BUTTON_SIZE, TABLE_ELEMENT_QUERY } from "./constants";

interface UseTableMetricsArgs {
  scrollRef: { current: HTMLDivElement | null };
  tableWidth: number;
  rows: string[];
}

interface TableMetrics {
  rowButtonLeft: number;
  rowMetrics: { top: number; height: number }[];
  /** The table's rendered height (the last row's bottom) — the add-column chip centers on it. */
  tableHeight: number;
}

function useTableMetrics({ scrollRef, tableWidth, rows }: UseTableMetricsArgs): TableMetrics {
  const [rowButtonLeft, setRowButtonLeft] = useState(0);
  const [rowMetrics, setRowMetrics] = useState<{ top: number; height: number }[]>([]);

  // The add-row chip's left offset: the center of the visible part of the
  // table (no scroll listeners — the chip is pinned to the frame, not the
  // scrolled content).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const update = () => setRowButtonLeft(Math.max(0, Math.min(tableWidth, el.clientWidth) / 2 - ADD_BUTTON_SIZE / 2));
    update();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [tableWidth, scrollRef]);

  // The row handles' vertical centering: the row offsets / heights
  // measured from the live DOM (the heights are auto per the wrapped
  // content) — remeasured on the structure / width change and on any
  // table resize.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const table = el?.querySelector<HTMLTableElement>(TABLE_ELEMENT_QUERY);
    if (el === null || table === null || table === undefined) return;
    const measure = () =>
      setRowMetrics(
        Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr")).map((tr) => ({
          top: tr.offsetTop,
          height: tr.offsetHeight,
        }))
      );
    measure();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(table);
      return () => observer.disconnect();
    }
  }, [rows, tableWidth, scrollRef]);

  const tableHeight =
    rowMetrics.length > 0 ? rowMetrics[rowMetrics.length - 1]!.top + rowMetrics[rowMetrics.length - 1]!.height : 0;
  return { rowButtonLeft, rowMetrics, tableHeight };
}

export { useTableMetrics };
