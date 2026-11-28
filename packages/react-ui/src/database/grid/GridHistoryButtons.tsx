/** The bridge history's icon controls. */
import { useTranslation } from "react-i18next";

import { Button } from "../../shared/ui/Button";
import { Redo, Undo } from "../../shared/ui/icons";

interface GridHistoryButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

function GridHistoryButtons({ canUndo, canRedo, onUndo, onRedo }: GridHistoryButtonsProps) {
  const { t } = useTranslation("database");
  return (
    <>
      <Button
        data-slot="docblocks/database-undo"
        variant="outline"
        size="icon"
        className="size-8"
        data-disabled={canUndo ? undefined : true}
        disabled={!canUndo}
        title={t("toolbar.undo")}
        aria-label={t("toolbar.undo")}
        onClick={onUndo}
      >
        <Undo />
      </Button>
      <Button
        data-slot="docblocks/database-redo"
        variant="outline"
        size="icon"
        className="size-8"
        data-disabled={canRedo ? undefined : true}
        disabled={!canRedo}
        title={t("toolbar.redo")}
        aria-label={t("toolbar.redo")}
        onClick={onRedo}
      >
        <Redo />
      </Button>
    </>
  );
}

export { GridHistoryButtons };
