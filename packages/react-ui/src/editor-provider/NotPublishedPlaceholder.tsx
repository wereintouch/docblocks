import { Alert, AlertDescription, AlertTitle, Card } from "../shared/ui";

/**
 * The no-published-snapshot stand (the "published"'s mode over a null
 * `publishedDoc`): the document is not published yet — the current state
 * is never rendered (a reader sees only what was published, the editor's
 * published's mode stands the same stand over an unpublished doc).
 */
function NotPublishedPlaceholder() {
  return (
    <Card data-slot="docblocks/not-published" className="flex min-h-40 items-center justify-center p-6">
      <Alert variant="default" data-slot="docblocks/not-published-stand">
        <AlertTitle>This document has not been published yet.</AlertTitle>
        <AlertDescription>Readers see the document only after it has been published.</AlertDescription>
      </Alert>
    </Card>
  );
}

export { NotPublishedPlaceholder };
