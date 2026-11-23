/** The panel's system rows (the meta's read-only derivatives): the id,
 *  the created date, and the live last-updated date (the dates' locale
 *  stand — the date only; the id's monospace). */
import { useTranslation } from "react-i18next";

import type { Doc, DocMeta } from "docblocks-core";

import { AttributeRow } from "./AttributeRow";
import { formatDate } from "./value-utils";

function AttributesSystemRows({
  meta,
  doc,
  hiddenAttributes,
}: {
  meta: DocMeta;
  doc: Doc;
  hiddenAttributes: readonly string[];
}) {
  const { t, i18n } = useTranslation("editor");
  const hidden = new Set(hiddenAttributes);
  const locale = i18n.language;

  return (
    <>
      {hidden.has("id") ? null : (
        <AttributeRow key="id" attributeKey="id" label={t("attributes.id")} removable={false}>
          <span className="block px-1.5 py-1 font-mono text-sm break-all">{meta.id}</span>
        </AttributeRow>
      )}
      {hidden.has("createdAt") ? null : (
        <AttributeRow key="createdAt" attributeKey="createdAt" label={t("attributes.createdAt")} removable={false}>
          <span className="block truncate px-1.5 py-1 text-sm">{formatDate(meta.createdAt, locale)}</span>
        </AttributeRow>
      )}
      {hidden.has("updatedAt") ? null : (
        <AttributeRow key="updatedAt" attributeKey="updatedAt" label={t("attributes.lastUpdatedAt")} removable={false}>
          <span className="block truncate px-1.5 py-1 text-sm">
            {formatDate(doc.lastUpdatedAt ?? meta.createdAt, locale)}
          </span>
        </AttributeRow>
      )}
    </>
  );
}

export { AttributesSystemRows };
