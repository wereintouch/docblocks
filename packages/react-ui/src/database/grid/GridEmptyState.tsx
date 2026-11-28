/** The schema-less grid's empty state and its first-column entry. */
import { useTranslation } from "react-i18next";

import type { ComponentType } from "react";

import { AddColumnControl } from "./AddColumnControl";
import { GRID_CHROME_FRAME } from "./constants";
import type { EnumOptionDraft } from "./models";
import type { useColumnForm } from "./use-column-form";

interface GridEmptyStateProps {
  form: ReturnType<typeof useColumnForm>;
  OptionsEditor: ComponentType<{
    options: EnumOptionDraft[];
    onChange: (next: EnumOptionDraft[]) => void;
  }>;
  readOnly: boolean;
}

function GridEmptyState({ form, OptionsEditor, readOnly }: GridEmptyStateProps) {
  const { t } = useTranslation("database");
  return (
    <div
      data-slot="docblocks/database-empty"
      className={`relative flex min-h-28 flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground ${GRID_CHROME_FRAME}`}
    >
      <span>{t("columns.empty")}</span>
      {!readOnly && <AddColumnControl form={form} OptionsEditor={OptionsEditor} withLabel className="cursor-pointer" />}
    </div>
  );
}

export { GridEmptyState };
