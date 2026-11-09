import { useTranslation } from "react-i18next";

import { Alert, AlertDescription, AlertTitle, Card } from "../shared/ui";

/**
 * The no-published-snapshot stand (the "published"'s mode over a null
 * `publishedDoc`): the document is not published yet — the current state
 * is never rendered (a reader sees only what was published, the editor's
 * published's mode stands the same stand over an unpublished doc).
 */
function NotPublishedPlaceholder() {
  const { t } = useTranslation("common");
  return (
    <Card data-slot="docblocks/not-published" className="flex min-h-40 items-center justify-center p-6">
      <Alert variant="default" data-slot="docblocks/not-published-stand">
        <AlertTitle>{t("access.notPublished")}</AlertTitle>
        <AlertDescription>{t("access.notPublishedHint")}</AlertDescription>
      </Alert>
    </Card>
  );
}

export { NotPublishedPlaceholder };
