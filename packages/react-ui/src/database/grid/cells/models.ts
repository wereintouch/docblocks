/** One option of the ref's picker / editor (the option's value + its
 *  display label — the enum's option label, the row-link's resolved
 *  display; the enum's option's chip color — the `color` column's hex,
 *  the absent stand stands the neutral chip). */
interface RefOption {
  value: string;
  label: string;
  color?: string;
}

export type { RefOption };
