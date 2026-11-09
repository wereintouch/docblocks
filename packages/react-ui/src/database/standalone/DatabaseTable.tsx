import { useCallback, useRef, useState } from "react";

import { DocblocksI18nProvider } from "../../i18n";
import type { DatabaseBridge } from "../bridge";
import { GridBody } from "../grid/GridBody";
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
 * as the consumer-placed components).
 */
function DatabaseTable({ bridge, tableId, readOnly = false, view, onViewChange }: DatabaseTableProps) {
  const [viewState, setViewState] = useState<Partial<DatabaseTableView>>(view ?? EMPTY_VIEW);
  // The ref mirror stands the async tail's fresh read (the render-time
  // state stands stale over the await).
  const viewRef = useRef(viewState);
  viewRef.current = viewState;

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
      <GridBody
        bridge={bridge}
        tableId={tableId}
        filter={viewState.filter}
        columnOrder={viewState.columnOrder}
        hiddenColumns={viewState.hiddenColumns}
        columnWidths={viewState.columnWidths}
        onViewChange={handleViewChange}
        readColumnOrder={() => viewRef.current.columnOrder}
        readOnly={readOnly}
      />
    </DocblocksI18nProvider>
  );
}

export { DatabaseTable };
export type { DatabaseTableProps };
