/** The grid's header-row height stands: the resolution over the two
 *  persistence levels (the block's own attr over the consumer's per-table
 *  section value, an absent stand = the auto height), the drag's clamp, and
 *  the auto height's live measurement. */
import { MAX_DATABASE_HEADER_HEIGHT_PX, MIN_DATABASE_HEADER_HEIGHT_PX } from "./constants";

/** The header row's height stand: the block's own attr wins over the
 *  table section's value (the consumer's per-table persistence — the same
 *  height over every block referencing the table); an absent stand keeps
 *  the auto height. */
function resolveDatabaseHeaderHeight(blockHeight?: number, sectionHeight?: number): number | undefined {
  return blockHeight ?? sectionHeight;
}

/** The drag's clamp: the auto height is the floor (the column names never
 *  render clipped), with the one-line fallback floor when the auto height
 *  stands unmeasured; the ceiling is the drag's generous bound (the data
 *  level checks the positivity only). */
function clampDatabaseHeaderHeight(requested: number, natural: number): number {
  const floor = Math.max(Math.round(natural), MIN_DATABASE_HEADER_HEIGHT_PX);
  return Math.max(floor, Math.min(Math.round(requested), MAX_DATABASE_HEADER_HEIGHT_PX));
}

/** The header row's natural (auto) height in px, measured over the live
 *  grid: the explicit track's height is lifted for the read and restored
 *  before the frame paints, so the returned stand is the content's own.
 *  A detached / unlaid-out grid (no layout in the runtime) stands 0. */
function measureDatabaseHeaderHeight(grid: HTMLElement | null): number {
  if (grid === null) return 0;
  const previous = grid.style.gridTemplateRows;
  grid.style.gridTemplateRows = "auto";
  let natural = 0;
  for (const cell of grid.querySelectorAll<HTMLElement>('[data-slot="docblocks/database-header-cell"]')) {
    natural = Math.max(natural, cell.offsetHeight);
  }
  grid.style.gridTemplateRows = previous;
  return natural;
}

export { clampDatabaseHeaderHeight, measureDatabaseHeaderHeight, resolveDatabaseHeaderHeight };
