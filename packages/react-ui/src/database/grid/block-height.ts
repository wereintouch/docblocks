/** The document database block's measured auto height and resize floor. */
import {
  AUTO_DATABASE_ROWS,
  DEFAULT_DATABASE_ROW_HEIGHT_PX,
  MIN_DATABASE_HEADER_HEIGHT_PX,
  MIN_DATABASE_ROWS,
} from "./constants";
import { measureDatabaseHeaderHeight } from "./header-height";

interface DatabaseBlockMetrics {
  auto: number;
  min: number;
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positivePixels(value: string, fallback: number): number {
  const parsed = cssPixels(value);
  return parsed > 0 ? parsed : fallback;
}

/** Measures the fixed chrome around the scrolling grid, so the block's
 *  explicit height leaves the toolbar visible and the floor stays usable. */
function measureDatabaseBlockMetrics(
  card: HTMLElement | null,
  table: HTMLElement | null,
  scroller: HTMLElement | null,
  headerHeight?: number
): DatabaseBlockMetrics {
  const header = headerHeight ?? Math.max(measureDatabaseHeaderHeight(table), MIN_DATABASE_HEADER_HEIGHT_PX);
  const rowHeight = positivePixels(
    card === null ? "" : getComputedStyle(card).getPropertyValue("--docblocks-database-row-height"),
    DEFAULT_DATABASE_ROW_HEIGHT_PX
  );
  let chrome = 0;
  if (card !== null) {
    const cardStyle = getComputedStyle(card);
    chrome += cssPixels(cardStyle.borderTopWidth) + cssPixels(cardStyle.borderBottomWidth);
    const content = card.querySelector<HTMLElement>(":scope > [data-slot='docblocks/database']");
    const toolbar = card.querySelector<HTMLElement>("[data-slot='docblocks/database-toolbar']");
    chrome += toolbar?.offsetHeight ?? 0;
    if (content !== null) {
      const style = getComputedStyle(content);
      chrome += cssPixels(style.paddingTop) + cssPixels(style.paddingBottom) + cssPixels(style.rowGap);
    }
    if (table !== null) {
      const style = getComputedStyle(table);
      chrome += cssPixels(style.borderTopWidth) + cssPixels(style.borderBottomWidth);
    }
    // Vertical overflow lives in scrollHeight and never expands the cap;
    // this difference reserves only the horizontal scrollbar's box.
    if (scroller !== null) chrome += Math.max(0, scroller.offsetHeight - scroller.clientHeight);
  }
  return {
    auto: Math.round(chrome + header + AUTO_DATABASE_ROWS * rowHeight),
    min: Math.round(chrome + header + MIN_DATABASE_ROWS * rowHeight),
  };
}

export { measureDatabaseBlockMetrics };
export type { DatabaseBlockMetrics };
