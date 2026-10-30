/** The Doc construction's types: the createDoc options (the identity +
 *  metadata, all optional). */
import type { BlockId } from "@docblocks-core/schema";

/** Options for createDoc: document identity and metadata (all optional). */
interface CreateDocOptions {
  /** Document id; defaults to a generated id (see `generateId`). */
  id?: BlockId;
  title?: string;
  /** ISO 8601; defaults to the current time. */
  createdAt?: string;
  /** Document id generator; defaults to randomUUID. */
  generateId?: () => string;
}

export type { CreateDocOptions };
