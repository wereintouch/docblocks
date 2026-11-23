/**
 * The Doc facade's meta/attribute delegates: the command calls behind the
 * title, avatar, and document-attribute methods.
 */
import type * as Y from "yjs";

import type { DocAttributeValue } from "@docblocks-core/schema";

import {
  removeAttribute as removeAttributeCommand,
  renameAttribute as renameAttributeCommand,
  reorderAttributes as reorderAttributesCommand,
  setAttribute as setAttributeCommand,
  setAvatar as setAvatarCommand,
  setTitle as setTitleCommand,
} from "../commands";

/** Replaces the document title. */
function setTitle(ydoc: Y.Doc, text: string): void {
  setTitleCommand(ydoc, text);
}

/** Sets the document's avatar (a short string / a few emoji); `null` or the empty string clears it. */
function setAvatar(ydoc: Y.Doc, avatar: string | null): void {
  setAvatarCommand(ydoc, avatar);
}

/**
 * Sets one document attribute (one transaction — one undo step, one wire
 * update; a set of the current value is a no-op). A reserved key or an
 * unsupported value throws the typed InvalidAttributeError.
 */
function setAttribute(ydoc: Y.Doc, key: string, value: DocAttributeValue): void {
  setAttributeCommand(ydoc, key, value);
}

/** Removes a document attribute (an absent key is a no-op). */
function removeAttribute(ydoc: Y.Doc, key: string): void {
  removeAttributeCommand(ydoc, key);
}

/**
 * Renames a document attribute (one transaction — one undo step, one
 * wire update; the value's form moves as-is, the display order keeps
 * the key's position). An absent source key and a same-key rename are
 * no-ops; a reserved / the taken target key throws the typed
 * InvalidAttributeError.
 */
function renameAttribute(ydoc: Y.Doc, fromKey: string, toKey: string): void {
  renameAttributeCommand(ydoc, fromKey, toKey);
}

/**
 * Reorders the document's attributes (the `order` is a permutation of the
 * record's keys; a missing / extra / duplicated key throws the typed
 * `InvalidAttributeError`). An order equal to the current stand is a no-op.
 */
function reorderAttributes(ydoc: Y.Doc, order: string[]): void {
  reorderAttributesCommand(ydoc, order);
}

export { removeAttribute, renameAttribute, reorderAttributes, setAttribute, setAvatar, setTitle };
