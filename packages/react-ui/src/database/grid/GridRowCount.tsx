/** The consumer's total row count and the loaded filtered-window count. */
import { useTranslation } from "react-i18next";

import { Badge } from "../../shared/ui/Badge";

interface GridRowCountProps {
  total: number;
  visible: number;
  filtered: boolean;
}

function GridRowCount({ total, visible, filtered }: GridRowCountProps) {
  const { t } = useTranslation("database");
  return (
    <>
      <Badge data-slot="docblocks/database-count" variant="secondary">
        {total} {t("rowCount", { count: total })}
      </Badge>
      {filtered && (
        <Badge data-slot="docblocks/database-visible-count" variant="outline">
          {t("visibleRowCount", { count: visible })}
        </Badge>
      )}
    </>
  );
}

export { GridRowCount };
