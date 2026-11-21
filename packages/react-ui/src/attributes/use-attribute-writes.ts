/** The attribute's write entries (the panel's rows' stand): the doc's
 *  commands over the boundary validation's silent stand (the write entry
 *  never throws), and the key's rename's session state. */
import { useState } from "react";

import { InvalidAttributeError } from "docblocks-core";
import type { Doc, DocAttributeValue } from "docblocks-core";

function useAttributeWrites(doc: Doc) {
  // The rename's state (the custom key's inline edit over the key's
  // column): the open's key + the invalid's stand (the commit's typed
  // error's keep — the input's open stand over the invalid's border,
  // the re-type's stand).
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameInvalid, setRenameInvalid] = useState(false);

  const set = (key: string, v: DocAttributeValue): void => {
    try {
      doc.setAttribute(key, v);
    } catch {
      // The boundary validation (a reserved key / the value form) stands
      // the typed error — the panel's write entry never throws (the
      // display-only stand's parity).
    }
  };
  const remove = (key: string): void => {
    try {
      doc.removeAttribute(key);
    } catch {
      // The reserved key's rejection stands the silent stand (the row is
      // not a reserved key's row — the custom rows are the writable stand).
    }
  };
  const rename = (key: string, next: string): void => {
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === key) {
      // The empty's / the same key's stand: the cancel (no write — the
      // key is required, the rename to the same key is a no-op).
      setRenamingKey(null);
      setRenameInvalid(false);
      return;
    }
    try {
      doc.renameAttribute(key, trimmed);
      setRenamingKey(null);
      setRenameInvalid(false);
    } catch (error) {
      if (error instanceof InvalidAttributeError) {
        // The invalid target (the reserved / the taken key): the input's
        // open stand over the invalid's border (the re-type's stand).
        setRenameInvalid(true);
        return;
      }
      // The panel's write entry never throws (the display-only stand's
      // parity over the unexpected's rejection).
      setRenamingKey(null);
      setRenameInvalid(false);
    }
  };

  return { renamingKey, setRenamingKey, renameInvalid, setRenameInvalid, set, remove, rename };
}

export { useAttributeWrites };
