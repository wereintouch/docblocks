/**
 * Typed react-ui errors.
 *
 * Mirrors docblocks-core's typed command errors: a failed prop contract,
 * a failed blob-store lookup, or a failed fetch throws a named class
 * (never a raw Error), so a consumer can catch by class and the error's
 * identity survives the React boundary.
 */

/** Base class for all docblocks-react-ui errors. */
class DocBlocksUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocBlocksUiError";
  }
}

/** The EditorProvider's prop contract was violated: a mount-immutable prop
 * (the `doc` instance, the `rootBlockId`) changed, or a required prop is
 * absent. */
class EditorProviderError extends DocBlocksUiError {
  constructor(message: string) {
    super(message);
    this.name = "EditorProviderError";
  }
}

/** The blob store has no stored object for the file id. */
class BlobNotFoundError extends DocBlocksUiError {
  constructor(message: string) {
    super(message);
    this.name = "BlobNotFoundError";
  }
}

/** The PDF bytes could not be fetched (a non-ok HTTP response). */
class PdfFetchError extends DocBlocksUiError {
  constructor(message: string) {
    super(message);
    this.name = "PdfFetchError";
  }
}

/** The canvas paste's internal invariant was violated: a non-shape canvas
 * item reached the item insert (the connectors are handled in a
 * follow-up pass). */
class CanvasPasteError extends DocBlocksUiError {
  constructor(message: string) {
    super(message);
    this.name = "CanvasPasteError";
  }
}

/** The slash command's block type is outside the known registry set. */
class UnknownSlashCommandError extends DocBlocksUiError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownSlashCommandError";
  }
}

/** The exhaustiveness backstop: a value escaped a closed union's types. */
class UnhandledValueError extends DocBlocksUiError {
  constructor(message: string) {
    super(message);
    this.name = "UnhandledValueError";
  }
}

export {
  BlobNotFoundError,
  CanvasPasteError,
  DocBlocksUiError,
  EditorProviderError,
  PdfFetchError,
  UnhandledValueError,
  UnknownSlashCommandError,
};
