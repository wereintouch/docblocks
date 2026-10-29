/** The row-link cell's picker: the ref table's rows over the search (the
 *  client-side filter over the loaded page). */
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/Popover";

interface RowLinkPickerProps {
  /** The ref table's row ids (the picker's list). */
  rowIds: string[];
  /** The row displays (rowId → the display text; the join stands in the
   *  consumer backend). */
  displays: Record<string, string>;
  /** The current value (the row id or the empty stand). */
  current: string;
  /** The session stand (the grid's edit session). */
  open: boolean;
  onPick: (rowId: string) => void;
  onClear: () => void;
  onEditEnd: () => void;
}
/** The picker's list (the search + the rows): the component stands
 *  inside the popover content, so the search draft resets on the close
 *  (the content unmounts). */
function RowLinkPickerList({
  rowIds,
  displays,
  onPick,
  onClear,
  onEditEnd,
}: Omit<RowLinkPickerProps, "current" | "open">) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered =
    needle === ""
      ? rowIds
      : rowIds.filter(
          (rowId) => (displays[rowId] ?? rowId).toLowerCase().includes(needle) || rowId.toLowerCase().includes(needle)
        );
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        data-slot="docblocks/database-row-picker-search"
        autoFocus
        placeholder="Search rows"
        className="
          h-7 cursor-text rounded-md border border-border bg-transparent px-2 text-xs text-foreground outline-none
          focus:bg-muted/40
        "
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-48 overflow-y-auto">
        <button
          type="button"
          data-slot="docblocks/database-row-picker-clear"
          className="
            block w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground outline-none
            hover:bg-accent hover:text-accent-foreground
          "
          onClick={() => {
            onClear();
            onEditEnd();
          }}
        >
          —
        </button>
        {filtered.map((rowId) => (
          <button
            key={rowId}
            type="button"
            data-slot="docblocks/database-row-picker-row"
            data-row-id={rowId}
            className="
              block w-full cursor-pointer truncate rounded-sm px-2 py-1.5 text-left text-sm text-foreground outline-none
              hover:bg-accent hover:text-accent-foreground
            "
            onClick={() => {
              onPick(rowId);
              onEditEnd();
            }}
          >
            {displays[rowId] ?? rowId}
          </button>
        ))}
      </div>
    </div>
  );
}
/**
 * The row-link cell's picker: the ref table's rows over the search (the
 * client-side filter over the loaded page). The pick commits the row id
 * (one `updateRow`); the `—` entry clears the link.
 */
function RowLinkPicker({ rowIds, displays, current, open, onPick, onClear, onEditEnd }: RowLinkPickerProps) {
  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onEditEnd();
      }}
    >
      <PopoverTrigger asChild>
        <span
          data-slot="docblocks/database-row-picker-trigger"
          className="pointer-events-none block w-full px-1 text-(length:--docblocks-font-size)"
        >
          {current === "" ? null : <span className="line-clamp-1">{displays[current] ?? current}</span>}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} data-slot="docblocks/database-row-picker" className="w-60 p-2">
        <RowLinkPickerList
          rowIds={rowIds}
          displays={displays}
          onPick={onPick}
          onClear={onClear}
          onEditEnd={onEditEnd}
        />
      </PopoverContent>
    </Popover>
  );
}

export { RowLinkPicker };
