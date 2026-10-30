/** The row-link cell's picker: the ref table's rows over the search (the
 *  client-side filter over the loaded page). */
import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Input } from "../../../shared/ui/Input";
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
  const onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value);

  return (
    <div className="flex flex-col gap-2">
      <Input
        size="sm"
        type="search"
        data-slot="docblocks/database-row-picker-search"
        autoFocus
        placeholder="Search rows"
        className="h-7 cursor-text text-xs focus:bg-muted/40"
        value={query}
        onChange={onQueryChange}
      />
      <div className="max-h-48 overflow-y-auto">
        <Button
          data-slot="docblocks/database-row-picker-clear"
          variant="ghost"
          size="sm"
          className="w-full cursor-pointer justify-start rounded-sm px-2 py-1.5 text-sm font-normal text-muted-foreground"
          onClick={() => {
            onClear();
            onEditEnd();
          }}
        >
          —
        </Button>
        {filtered.map((rowId) => (
          <Button
            key={rowId}
            data-slot="docblocks/database-row-picker-row"
            data-row-id={rowId}
            variant="ghost"
            size="sm"
            className="w-full cursor-pointer justify-start truncate rounded-sm px-2 py-1.5 text-sm font-normal text-foreground"
            onClick={() => {
              onPick(rowId);
              onEditEnd();
            }}
          >
            {displays[rowId] ?? rowId}
          </Button>
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
