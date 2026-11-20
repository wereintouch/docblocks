/**
 * The grid's non-ready state's surfaces: the loading's stand (the
 * placeholder's text) and the broken's stand (the table's death / the
 * fatal read's error surface + the reload's entry). The frames stand the
 * block's data attributes (the inspector's / the e2e's locators).
 */
import { useTranslation } from "react-i18next";

import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { Button } from "../../shared/ui/Button";
import { Card, CardContent } from "../../shared/ui/Card";
import { cn } from "../../shared/ui/cn";
import { GRID_BUTTON_HOVER, GRID_CHROME_FRAME } from "./constants";

interface GridStateCardProps {
  blockId?: BlockId;
  children: ReactNode;
  className?: string;
}

function GridStateCard({ blockId, children, className }: GridStateCardProps) {
  return (
    <Card
      data-slot="docblocks/block"
      data-block-type="database"
      data-block-id={blockId}
      className={cn("min-h-0 flex-1", className)}
    >
      {children}
    </Card>
  );
}

function GridLoadingCard({ blockId }: { blockId?: BlockId }) {
  const { t } = useTranslation("database");
  return (
    <GridStateCard blockId={blockId}>
      <CardContent data-slot="docblocks/database" data-state="loading" className="p-(--docblocks-block-spacing)">
        <span className="text-(length:--docblocks-font-size) text-(--docblocks-placeholder-color)">
          {t("state.loading")}
        </span>
      </CardContent>
    </GridStateCard>
  );
}

function GridBrokenCard({
  blockId,
  tableId,
  error,
  onRetry,
}: {
  blockId?: BlockId;
  tableId: string;
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation("database");
  return (
    <GridStateCard
      blockId={blockId}
      className="
        my-(--docblocks-block-spacing) rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
        border-(--docblocks-table-border-color) outline-none
      "
    >
      <CardContent
        data-slot="docblocks/database"
        data-state="broken"
        className="flex items-center justify-between gap-(--docblocks-block-spacing) p-(--docblocks-block-spacing)"
      >
        <div className="flex flex-col">
          <span
            data-slot="docblocks/database-broken"
            className="text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)"
          >
            {t("state.notFound")}
          </span>
          <span className="text-(length:--docblocks-font-size) text-(--docblocks-placeholder-color)">
            {error ?? t("state.unknownTable", { tableId })}
          </span>
        </div>
        <Button
          data-slot="docblocks/database-retry"
          variant="outline"
          size="sm"
          className={cn(
            GRID_CHROME_FRAME,
            GRID_BUTTON_HOVER,
            "h-auto px-2 py-1 text-(length:--docblocks-font-size) font-normal shadow-none"
          )}
          onClick={onRetry}
        >
          {t("state.retry")}
        </Button>
      </CardContent>
    </GridStateCard>
  );
}

export { GridBrokenCard, GridLoadingCard };
