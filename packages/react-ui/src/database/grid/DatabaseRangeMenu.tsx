import { useTranslation } from "react-i18next";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import type { GridRangePoint } from "./use-grid-range-menu";

interface DatabaseRangeMenuProps {
  anchor: GridRangePoint | null;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  onDelete: () => void;
}

function DatabaseRangeMenu({ anchor, onOpenChange, onClear, onDelete }: DatabaseRangeMenuProps) {
  const { t } = useTranslation("database");
  return (
    <DropdownMenu modal={false} open={anchor !== null} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <div
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={{ left: anchor?.x ?? 0, top: anchor?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent data-slot="docblocks/database-context-menu" aria-label={t("range.options")} sideOffset={4}>
        <DropdownMenuItem data-slot="docblocks/database-context-clear" onSelect={onClear}>
          {t("range.clear")}
        </DropdownMenuItem>
        <DropdownMenuItem data-slot="docblocks/database-context-delete" variant="destructive" onSelect={onDelete}>
          {t("range.deleteRows")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { DatabaseRangeMenu };
