/** The panel's custom rows (every non-preset key of the `meta.attributes`
 *  record — the typed value's stand): the drag's preview over the edit
 *  mode (the `Reorder.Group`'s live reorder + the rows' position slide —
 *  the blocks' rows' parity; the release commits the preview's order
 *  over the full order's custom slots), the display-only's stand over
 *  the read-only modes (no grip, no drag). */
import { Reorder } from "framer-motion";

import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import type { Doc, DocAttributeValue, DocMeta } from "docblocks-core";

import { CustomAttributeRow } from "./CustomAttributeRow";
import { DraggableAttributeRow } from "./DraggableAttributeRow";
import { isPresetKey, orderedCustomKeys, typedValueOf } from "./value-utils";

type CustomRowsProps = {
  doc: Doc;
  meta: DocMeta;
  attributes: Record<string, DocAttributeValue>;
  viewMode: boolean;
  /** The inline edit's open stand (the panel's `editingKey`'s read). */
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  /** The rename's open stand (the writes' entries' session state). */
  renamingKey: string | null;
  /** The invalid target's stand (the commit's typed error's keep). */
  renameInvalid: boolean;
  setRenamingKey: (key: string | null) => void;
  setRenameInvalid: (invalid: boolean) => void;
  /** The key's rename's commit (the writes' entries' stand). */
  rename: (key: string, next: string) => void;
  set: (key: string, v: DocAttributeValue) => void;
  remove: (key: string) => void;
  /** The value zone's delegation (the consumer's `renderAttribute`'s
   *  stand over the key; the built-in zone's pass-through over the
   *  absent). */
  valueZone: (key: string, zone: ReactNode) => ReactNode;
};

function AttributesCustomRows({
  doc,
  meta,
  attributes,
  viewMode,
  editingKey,
  setEditingKey,
  renamingKey,
  renameInvalid,
  setRenamingKey,
  setRenameInvalid,
  rename,
  set,
  remove,
  valueZone,
}: CustomRowsProps) {
  // The custom keys (every non-preset key of the record). The display's
  // order stands the stored `meta.attributesOrder` (the stale entries'
  // drop, the missing keys' append over the record's key order; the
  // record's key order over the field's absence) — the base's rows stand
  // a fixed order of their own (the preset keys' order's entries are
  // ignored), the custom keys stand the last-added's stand over the
  // drag-free state.
  const customKeysAll = Object.keys(attributes).filter((key) => !isPresetKey(key));
  const derivedCustomOrder = orderedCustomKeys(meta.attributesOrder, customKeysAll);
  // The drag's preview's order (the framer reorder's live stand — the
  // doc/wire stand untouched over the drag; the release commits it).
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // The drag session's stand (the release's commit input + the resync's gate).
  const [dragging, setDragging] = useState(false);
  const dragOrderRef = useRef<string[] | null>(null);
  useLayoutEffect(() => {
    dragOrderRef.current = dragOrder;
  }, [dragOrder]);
  // A record change (a remote / a local add-remove) invalidates the
  // preview (a stale key's drag would stand the commit's rejection):
  // the key sets' divergence clears it over every state (the drag's
  // in-flight stand included — the row's unmount stands the same guard
  // over the framer's no-onDragEnd delivery).
  if (
    dragOrder !== null &&
    (dragOrder.some((key) => !customKeysAll.includes(key)) || customKeysAll.some((key) => !dragOrder.includes(key)))
  ) {
    setDragOrder(null);
    setDragging(false);
  }
  // A store change over the drag-free state resyncs the preview (a
  // committed reorder re-reads the store's order).
  if (!dragging && dragOrder !== null && dragOrder.join("\u0000") !== derivedCustomOrder.join("\u0000")) {
    setDragOrder(null);
  }
  const displayCustomKeys = dragOrder ?? derivedCustomOrder;

  /** The release's commit: the preview's custom order stands over the full
   *  order's custom slots (the non-custom keys' stand over their positions —
   *  the preset keys' slots keep their stand). One command (one undo step);
   *  the stale drag (a peer's record change over the drag) stands the
   *  no-write (the resync snaps the display). */
  const commitCustomReorder = (): void => {
    setDragging(false);
    const preview = dragOrderRef.current;
    setDragOrder(null);
    dragOrderRef.current = null;
    if (preview === null) return;
    const metaNow = doc.meta;
    const full = metaNow.attributesOrder ?? Object.keys(metaNow.attributes ?? {});
    const previewSet = new Set(preview);
    let index = 0;
    const nextFull: string[] = [];
    for (const key of full) {
      // The preview's slot stand (the preview covers the drag's custom keys;
      // a key outside the preview keeps its position — the stale drag's
      // commit stands the rejection's no-write).
      const slot = !isPresetKey(key) && previewSet.has(key) ? preview[index] : undefined;
      if (slot !== undefined) {
        index += 1;
        nextFull.push(slot);
      } else {
        nextFull.push(key);
      }
    }
    try {
      doc.reorderAttributes(nextFull);
    } catch {
      // The stale drag's rejection stands the no-write (the resync's stand).
    }
  };

  /** The custom value's commit (the type's parsing's stand: the empty's
   *  removal, the plain's plain write, the typed's typed write-back —
   *  the invalid number's no-write's stand). */
  const commitCustomValue = (key: string, next: string): void => {
    const trimmed = next.trim();
    if (trimmed === "") {
      remove(key);
      return;
    }
    const typed = typedValueOf(attributes[key]);
    if (typed === null) {
      set(key, trimmed);
      return;
    }
    switch (typed.type) {
      case "string":
        set(key, { type: "string", value: trimmed });
        break;
      case "number": {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return;
        set(key, { type: "number", value: n });
        break;
      }
      case "list":
        // The list's stand is the line editor's path (the
        // comma's input's stand dropped).
        set(key, {
          type: "list",
          value: trimmed
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== ""),
        });
        break;
      case "mention":
        set(key, { type: "mention", value: { id: trimmed } });
        break;
    }
  };

  /** The list form's read (the grip's top align's stand over the list's
   *  rows — the grip stands opposite the first line over the stack). */
  const isListCustom = (key: string): boolean => {
    const v = attributes[key];
    return Array.isArray(v) || typedValueOf(v)?.type === "list";
  };

  /** The custom row's stand (the `CustomAttributeRow`'s unit — the key's
   *  rename's entry + the value zone's editors over the type's stand). */
  const renderCustomRow = (key: string): ReactNode => (
    <CustomAttributeRow
      key={key}
      keyName={key}
      value={attributes[key]}
      viewMode={viewMode}
      editing={editingKey === `custom:${key}`}
      onEditStart={() => setEditingKey(`custom:${key}`)}
      onEditCommit={(next) => {
        setEditingKey(null);
        commitCustomValue(key, next);
      }}
      onEditCancel={() => setEditingKey(null)}
      renaming={renamingKey === key}
      renameInvalid={renameInvalid}
      onRenameStart={() => {
        setRenamingKey(key);
        setRenameInvalid(false);
      }}
      onRenameCommit={(next) => rename(key, next)}
      onRenameCancel={() => {
        setRenamingKey(null);
        setRenameInvalid(false);
      }}
      onRemove={() => remove(key)}
      setValue={(v) => set(key, v)}
      valueZone={(zone) => valueZone(key, zone)}
    />
  );

  return (
    <>
      {/* The custom rows' stand: the drag's preview over the edit mode
        (the `Reorder.Group`'s live reorder + the rows' position slide —
        the blocks' rows' parity), the display-only's stand over the
        read-only modes (no grip, no drag). */}
      {viewMode ? (
        <div data-slot="docblocks/attributes-custom" className="flex flex-col gap-1">
          {displayCustomKeys.map((key) => renderCustomRow(key))}
        </div>
      ) : (
        <Reorder.Group
          as="div"
          data-slot="docblocks/attributes-custom"
          axis="y"
          values={displayCustomKeys}
          onReorder={(next: string[]) => setDragOrder(next)}
          className="flex flex-col gap-1"
        >
          {displayCustomKeys.map((key) => (
            <DraggableAttributeRow
              key={key}
              attributeKey={key}
              topAlign={isListCustom(key)}
              onDragStart={() => setDragging(true)}
              onDragEnd={commitCustomReorder}
            >
              {renderCustomRow(key)}
            </DraggableAttributeRow>
          ))}
        </Reorder.Group>
      )}
    </>
  );
}

export { AttributesCustomRows };
