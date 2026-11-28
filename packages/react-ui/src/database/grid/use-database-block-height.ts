/** The document database block's bottom-edge resize session. */
import { useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import { measureDatabaseBlockMetrics } from "./block-height";
import type { DatabaseBlockMetrics } from "./block-height";
import {
  AUTO_DATABASE_ROWS,
  DATABASE_RESIZE_KEY_STEP_PX,
  DEFAULT_DATABASE_ROW_HEIGHT_PX,
  MIN_DATABASE_HEADER_HEIGHT_PX,
  MIN_DATABASE_ROWS,
} from "./constants";

const INITIAL_METRICS: DatabaseBlockMetrics = {
  auto: MIN_DATABASE_HEADER_HEIGHT_PX + AUTO_DATABASE_ROWS * DEFAULT_DATABASE_ROW_HEIGHT_PX,
  min: MIN_DATABASE_HEADER_HEIGHT_PX + MIN_DATABASE_ROWS * DEFAULT_DATABASE_ROW_HEIGHT_PX,
};

interface UseDatabaseBlockHeightArgs {
  enabled: boolean;
  ready: boolean;
  height?: number;
  headerHeight?: number;
  cardRef: RefObject<HTMLDivElement | null>;
  tableRef: RefObject<HTMLDivElement | null>;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onCommit?: (height: number) => void;
}

interface DatabaseBlockHeightSession {
  pointerId: number;
  startY: number;
  startHeight: number;
  min: number;
  height: number;
}

function useDatabaseBlockHeight({
  enabled,
  ready,
  height,
  headerHeight,
  cardRef,
  tableRef,
  scrollerRef,
  onCommit,
}: UseDatabaseBlockHeightArgs) {
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [preview, setPreview] = useState<number | null>(null);
  const session = useRef<DatabaseBlockHeightSession | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !ready) return;
    const measure = () => {
      const next = measureDatabaseBlockMetrics(cardRef.current, tableRef.current, scrollerRef.current, headerHeight);
      setMetrics((current) => (current.auto === next.auto && current.min === next.min ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    const toolbar = cardRef.current?.querySelector("[data-slot='docblocks/database-toolbar']");
    if (toolbar !== null && toolbar !== undefined) observer.observe(toolbar);
    if (tableRef.current !== null) observer.observe(tableRef.current);
    return () => observer.disconnect();
  }, [cardRef, enabled, headerHeight, ready, scrollerRef, tableRef]);

  const currentHeight = preview ?? height;
  const style: CSSProperties | undefined = enabled
    ? {
        height: currentHeight,
        maxHeight: currentHeight === undefined ? metrics.auto : undefined,
      }
    : undefined;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0 || session.current !== null) return;
    const card = cardRef.current;
    if (card === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const nextMetrics = measureDatabaseBlockMetrics(card, tableRef.current, scrollerRef.current, headerHeight);
    setMetrics(nextMetrics);
    const measured = card.getBoundingClientRect().height;
    const startHeight = height ?? (measured > 0 ? measured : nextMetrics.auto);
    session.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
      min: nextMetrics.min,
      height: startHeight,
    };
    setPreview(startHeight);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const live = session.current;
    if (live === null || live.pointerId !== event.pointerId) return;
    live.height = Math.max(live.min, live.startHeight + event.clientY - live.startY);
    setPreview(live.height);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const live = session.current;
    if (live === null || live.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    session.current = null;
    setPreview(null);
    const committed = Math.round(live.height);
    if (committed !== Math.round(live.startHeight) && committed !== height) onCommit?.(committed);
  };

  const onPointerCancel = () => {
    session.current = null;
    setPreview(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const delta =
      event.key === "ArrowDown"
        ? DATABASE_RESIZE_KEY_STEP_PX
        : event.key === "ArrowUp"
          ? -DATABASE_RESIZE_KEY_STEP_PX
          : null;
    if (delta === null) return;
    event.preventDefault();
    const current = Math.round(currentHeight ?? metrics.auto);
    const next = Math.max(metrics.min, current + delta);
    if (next !== current) onCommit?.(next);
  };

  return {
    style,
    currentHeight: currentHeight ?? metrics.auto,
    minHeight: metrics.min,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onKeyDown,
  };
}

export { useDatabaseBlockHeight };
