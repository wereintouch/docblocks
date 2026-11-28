/** The grid's header row's single-line (auto) height, tracked live over
 * the laid-out grid. The stand is the stretch's decision's threshold (the
 * names' wrap over the height's stand) and the drag's clamp's floor's
 * source (the one-line fallback over the unmeasured's stand). The read
 * stands the single-line's stand over the current's wrap (the
 * measurement's suppression's parity), so the value is the auto height
 * regardless of the stretch. A detached / unlaid-out grid (no layout in
 * the runtime) stands 0. */
import { useLayoutEffect, useState } from "react";

import { measureDatabaseHeaderHeight } from "./header-height";

/** The grid's header row's single-line (auto) height in px (the live
 *  stand over the column's widths / the theme's font's changes). */
function useSingleLineHeaderHeight(tableRef: { current: HTMLDivElement | null }): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const grid = tableRef.current;
    if (grid === null) return;
    const measure = (): void => {
      const next = measureDatabaseHeaderHeight(grid);
      setHeight((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [tableRef]);
  return height;
}

export { useSingleLineHeaderHeight };
