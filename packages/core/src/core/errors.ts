import type { ValidationError } from "@docblocks-core/schema";

/**
 * Typed command errors.
 *
 * A failing command always throws one of these classes (never a silent
 * no-op); the message names the offending block id / type / value.
 */

/** Base class for all docblocks-core errors. */
class DocBlocksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocBlocksError";
  }
}

/** The block id does not exist in the document. */
class UnknownBlockError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownBlockError";
  }
}

/** The block type string is not in the registry. */
class UnknownBlockTypeError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownBlockTypeError";
  }
}

/** The block exists but is not a child of the expected parent. */
class DetachedBlockError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "DetachedBlockError";
  }
}

/** A position, offset, or index is out of bounds, or from > to. */
class InvalidRangeError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRangeError";
  }
}

/** A selection set on a SelectionView is structurally invalid for the document. */
class InvalidSelectionError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSelectionError";
  }
}

/** Block attributes fail the registry rules. */
class InvalidAttrsError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAttrsError";
  }
}

/** The block type is not allowed under the given parent. */
class InvalidChildError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChildError";
  }
}

/** The row id does not exist in the database's rows / rowOrder. */
class UnknownRowError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownRowError";
  }
}

/** The column id is not in the database's columns. */
class UnknownColumnError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownColumnError";
  }
}

/** A cell value does not match the column type's value contract. */
class InvalidCellValueError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCellValueError";
  }
}

/**
 * A geometry value is structurally invalid: a non-finite number, a
 * non-positive size, or a partial merge that would leave a geometry
 * incomplete.
 */
class InvalidGeometryError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGeometryError";
  }
}

/** Mark input is structurally invalid. */
class InvalidMarkError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMarkError";
  }
}

/**
 * The operation is not allowed on the current document shape: remove/move of
 * the root, inserting `root`, moving a block into itself or its descendant,
 * applying marks in a code block.
 */
class InvalidOperationError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationError";
  }
}

/** CRDT bytes given to loadDoc do not form a complete, valid document state. */
class InvalidSnapshotError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSnapshotError";
  }
}

/** A method is called on a SelectionView after destroy(). */
class DestroyedViewError extends DocBlocksError {
  constructor(message: string) {
    super(message);
    this.name = "DestroyedViewError";
  }
}

/** Joins a ValidationError list into one message clause. */
function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((error) => error.message).join("; ");
}

export {
  DetachedBlockError,
  DestroyedViewError,
  DocBlocksError,
  InvalidAttrsError,
  InvalidCellValueError,
  InvalidChildError,
  InvalidGeometryError,
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  InvalidSelectionError,
  InvalidSnapshotError,
  UnknownBlockError,
  UnknownBlockTypeError,
  UnknownColumnError,
  UnknownRowError,
  formatValidationErrors,
};
