/**
 * The enum option's system table's schema (the option IS a row of the
 * table — the row's pk stands the option's identity, so the rename / the
 * reorder stand the cell values intact; the `name` column stands the
 * option's label, the `color` column stands the option's chip color (the
 * hex data — the absent value stands the neutral display)). The enum
 * column's `refTableId` points at the table; the cell's value stands the
 * option's row id.
 */
const ENUM_OPTION_NAME_COLUMN = "name";
const ENUM_OPTION_COLOR_COLUMN = "color";

/** The enum's option catalog (the chip's colors stand the data — the
 *  consumer's palette stand over the hex; the form's color pick reads it).
 */
const ENUM_OPTION_PALETTE: readonly string[] = [
  "#f7a8a8",
  "#f9bd7d",
  "#f4e07d",
  "#97e3a8",
  "#8ed2f2",
  "#93b4f2",
  "#c5aef2",
];

export { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN, ENUM_OPTION_PALETTE };
