/** The cell's text / number edit input (the dumb controlled draft stand). */
import { cn } from "../../../shared/ui/cn";
import { CELL_INPUT } from "../constants";

/** The cell's edit input (the text / the number): the dumb controlled
 * stand — the draft stands in the cell (the grid's session teardown — the
 * outside press, the other cell's press — drops the session before the
 * DOM's blur stands, so the commit must not depend on the blur: the cell
 * commits the draft on the teardown, like the datetime's close commit).
 * The Enter stands the blur (the commit path); the Escape cancels the
 * draft without a write. */
interface CellEditInputProps {
  draft: string;
  kind: "text" | "number";
  /** The number input's minimum (the non-negative column stands 0). */
  min?: number;
  /** The number input's step stand (the column's decimals). */
  step?: string;
  /** The number column's right align (the type's contract — the value and
   * the input's text stand the right edge). */
  alignRight?: boolean;
  onDraftChange: (draft: string) => void;
  /** The blur / the Enter — the session's end (the cell commits the draft). */
  onEnd: () => void;
  /** The Escape — the draft's cancel (the session closes, no write). */
  onCancel: () => void;
}
function CellEditInput({ draft, kind, min, step, alignRight, onDraftChange, onEnd, onCancel }: CellEditInputProps) {
  return (
    <input
      type={kind === "number" ? "number" : "text"}
      data-slot="docblocks/database-cell-input"
      autoFocus
      min={min}
      step={step}
      className={cn(CELL_INPUT, alignRight && "text-right")}
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
      onBlur={onEnd}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}

export { CellEditInput };
