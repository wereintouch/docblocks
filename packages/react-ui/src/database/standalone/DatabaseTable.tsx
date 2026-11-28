import { useCallback, useRef, useState } from "react";

import { DocblocksI18nProvider } from "../../i18n";
import { cn } from "../../shared/ui/cn";
import type { DatabaseBridge } from "../bridge";
import { GridBody } from "../grid/GridBody";
import type { DatabaseTableSection } from "../table-section";
import type { DatabaseTableView } from "./models";

/** The stable absent-seed's stand (the `view` prop's absent stand). */
const EMPTY_VIEW: Partial<DatabaseTableView> = {};

interface DatabaseTableProps {
  /** The consumer's bridge (the table's truth). */
  bridge: DatabaseBridge;
  /** The bridge's table id (the `TableRef.id` over the `listTables`'s catalog). */
  tableId: string;
  /** The read-only's stand: the grid's data stands rendered, the editing's paths stand off (the block's read-only's parity). */
  readOnly?: boolean;
  /** The initial view's state (the consumer's persistence's seed; the mount's stand only — the controlled's mode stands absent). */
  view?: Partial<DatabaseTableView>;
  /** The view's change's hook (the persistence's stand; the patch = the changed's attrs only). */
  onViewChange?: (patch: Partial<DatabaseTableView>) => void;
  /** The consumer's sizing / layout's classes over the root (the package's
   *  token's scope's anchor + the flex-column's stand): the width stands the
   *  consumer's layout (the grid's `w-full`'s parity), and a height-
   *  constrained root stands the grid's inner scroll (the unconstrained's
   *  stand is the content's height, as over the document's block). */
  className?: string;
  /** The consumer's per-table section settings: the header-row height the
   *  table itself carries (the document blocks reference the same table id
   *  and read the same stand over their provider's `databaseTableSection`). */
  tableSection?: DatabaseTableSection;
}

/**
 * The standalone's database table: the live grid over the bridge's table
 * id — the same `useDatabaseTable`'s data stand as the document block
 * (the schema + the rows + the live events + the optimistic cell's layer),
 * rendered outside any document (the consumer's own page / panel). The
 * view's settings stand the internal's state (seeded from the `view`
 * prop) + the consumer's persistence over the `onViewChange`'s patch
 * (one patch per change, as the block's `updateBlock` stand). The i18n's
 * scope stands self-contained (the package's instance — the same's stand
 * as the consumer-placed components). The sizing's stand is the
 * consumer's: the `className` over the root (a height-constrained root
 * stands the grid's inner scroll; the unconstrained's stand is the
 * content's height).
 */
function DatabaseTable({
  bridge,
  tableId,
  readOnly = false,
  view,
  onViewChange,
  className,
  tableSection,
}: DatabaseTableProps) {
  const [viewState, setViewState] = useState<Partial<DatabaseTableView>>(view ?? EMPTY_VIEW);
  // The ref mirror stands the async tail's fresh read (the render-time
  // state stands stale over the await).
  const viewRef = useRef(viewState);
  viewRef.current = viewState;

  // The section's header-row height: the consumer's persistent stand (the
  // same value the document blocks over this table read) with the local
  // commit's echo — the section's interface stands a read, not a
  // subscription, so the drag's release stands this instance's display
  // until the consumer's value lands (the echo drops over any other
  // value: the persisted stand / a change made elsewhere wins).
  const [headerEcho, setHeaderEcho] = useState<{ tableId: string; base: number | undefined; height: number } | null>(
    null
  );
  const sectionHeight = tableSection?.getHeaderHeight?.(tableId);
  const sectionHeaderHeight =
    headerEcho !== null && headerEcho.tableId === tableId && headerEcho.base === sectionHeight
      ? headerEcho.height
      : sectionHeight;
  const commitHeaderHeight = (height: number) => {
    setHeaderEcho({ tableId, base: sectionHeight, height });
    tableSection?.setHeaderHeight?.(tableId, height);
  };

  const handleViewChange = useCallback(
    (patch: Record<string, unknown>) => {
      const typed = patch as Partial<DatabaseTableView>;
      setViewState((current) => ({ ...current, ...typed }));
      if (onViewChange !== undefined) onViewChange(typed);
    },
    [onViewChange]
  );

  return (
    <DocblocksI18nProvider>
      {/*
        The standalone's root stands the package's token scope: the
        `--docblocks-*` mapping is declared on the editor root over the
        shipped CSS, and the grid stands outside any document (no editor
        root over the consumer's page) — without the scope the grid's
        token-driven utilities (the borders, the paddings, the row's
        heights) stand unresolved. The `dark` class over an ancestor (the
        consumer's convention) still stands the dark's mapping over the
        wrapper.
      */}
      <div
        data-slot="docblocks/editor"
        data-readonly={readOnly ? "true" : undefined}
        className={cn("flex flex-col", className)}
      >
        <GridBody
          bridge={bridge}
          tableId={tableId}
          filter={viewState.filter}
          columnOrder={viewState.columnOrder}
          hiddenColumns={viewState.hiddenColumns}
          columnWidths={viewState.columnWidths}
          sectionHeaderHeight={sectionHeaderHeight}
          getRowCount={tableSection?.getRowCount}
          // The handle stands only over the section contract (the table-level
          // persistence's write stand); the plain stand keeps the auto height.
          onHeaderHeightChange={tableSection === undefined ? undefined : commitHeaderHeight}
          onViewChange={handleViewChange}
          readColumnOrder={() => viewRef.current.columnOrder}
          readOnly={readOnly}
        />
      </div>
    </DocblocksI18nProvider>
  );
}

export { DatabaseTable };
export type { DatabaseTableProps };
