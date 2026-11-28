/** The header-row cell hosting the add-column control and its form. */
import { cn } from "../../shared/ui/cn";
import { AddColumnControl } from "./AddColumnControl";
import { GRID_CHROME_FRAME } from "./constants";
import type { useColumnForm } from "./use-column-form";

interface AddColumnCellProps {
  /** The cell's column track (the header row's last track). */
  gridColumn: number;
  readOnly: boolean;
  form: ReturnType<typeof useColumnForm>;
  OptionsEditor: React.ComponentType<{
    options: import("./models").EnumOptionDraft[];
    onChange: (next: import("./models").EnumOptionDraft[]) => void;
  }>;
}

function AddColumnCell({ gridColumn, readOnly, form, OptionsEditor }: AddColumnCellProps) {
  return (
    <div
      data-slot="docblocks/database-add-column"
      className="
        relative row-start-1 flex items-center justify-center rounded-tr-(--docblocks-radius)
        border-b-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
      "
      style={{ gridColumn }}
    >
      {!readOnly && (
        <AddColumnControl
          form={form}
          OptionsEditor={OptionsEditor}
          className={cn(
            GRID_CHROME_FRAME,
            "size-6 cursor-pointer p-1 text-(--docblocks-placeholder-color) hover:bg-transparent",
            "hover:text-(--docblocks-text-color) dark:hover:bg-transparent"
          )}
        />
      )}
    </div>
  );
}

export { AddColumnCell };
