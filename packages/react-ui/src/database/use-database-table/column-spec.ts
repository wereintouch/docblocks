/**
 * The grid column's wire spec stand: the grid's flat reference / number
 * display fields map to the wire's nested shapes, a new column stands
 * nullable (the empty cells stand the nulls), the operators stand the
 * override, and the reference / number fields merge over the CURRENT
 * column's values (the patch never removes an attribute).
 */
import type { BridgeColumn, Column } from "../bridge";

/** The fresh column's wire spec: the flat reference / number fields map to
 *  the wire's nested shapes. The fresh id is bridge-assigned (the grid's
 *  draft id stands the form's local stand, never the wire's identity), so
 *  the spec carries no id / revision. */
function columnSpecOf(column: BridgeColumn, position: number): Omit<Column, "id" | "revision"> {
  const spec: Omit<Column, "id" | "revision"> = {
    name: column.name,
    type: column.type,
    position,
    nullable: true,
    ...(column.operators !== undefined ? { operators: [...column.operators] } : {}),
  };
  if (column.refKind !== undefined) {
    spec.reference = {
      kind: column.refKind,
      tableId: column.refTableId ?? "",
      many: column.refMany === true,
      ...(column.refDisplayColumn !== undefined ? { displayColumnId: column.refDisplayColumn } : {}),
    };
  }
  const numberDisplay: NonNullable<Column["numberDisplay"]> = {};
  let hasNumberDisplay = false;
  if (column.decimals !== undefined) {
    numberDisplay.decimals = column.decimals;
    hasNumberDisplay = true;
  }
  if (column.thousands !== undefined) {
    numberDisplay.thousands = column.thousands;
    hasNumberDisplay = true;
  }
  if (column.prefix !== undefined) {
    numberDisplay.prefix = column.prefix;
    hasNumberDisplay = true;
  }
  if (column.suffix !== undefined) {
    numberDisplay.suffix = column.suffix;
    hasNumberDisplay = true;
  }
  if (column.allowNegative !== undefined) {
    numberDisplay.allowNegative = column.allowNegative;
    hasNumberDisplay = true;
  }
  if (hasNumberDisplay) spec.numberDisplay = numberDisplay;
  return spec;
}

/** The grid patch's wire stand: the operators stand the override, the
 *  reference fields merge over the current column's reference, the flat
 *  number fields merge over the current `numberDisplay`. `null` = the
 *  patch stands no wire change (the write is a no-op). */
function columnPatchOf(
  current: Column | undefined,
  patch: Partial<Omit<BridgeColumn, "id" | "name">>
): Partial<Omit<Column, "id" | "revision">> | null {
  if (current === undefined) return null;
  const wirePatch: Partial<Omit<Column, "id" | "revision">> = {};
  if (patch.operators !== undefined) wirePatch.operators = [...patch.operators];
  if (
    patch.refKind !== undefined ||
    patch.refTableId !== undefined ||
    patch.refMany !== undefined ||
    patch.refDisplayColumn !== undefined
  ) {
    wirePatch.reference = {
      kind: patch.refKind ?? current.reference?.kind ?? "row",
      tableId: patch.refTableId ?? current.reference?.tableId ?? "",
      many: patch.refMany ?? current.reference?.many ?? false,
      ...(patch.refDisplayColumn !== undefined || current.reference?.displayColumnId !== undefined
        ? { displayColumnId: patch.refDisplayColumn ?? current.reference?.displayColumnId }
        : {}),
    };
  }
  const numberDisplay: NonNullable<Column["numberDisplay"]> = { ...current.numberDisplay };
  let hasNumberPatch = false;
  if (patch.decimals !== undefined) {
    numberDisplay.decimals = patch.decimals;
    hasNumberPatch = true;
  }
  if (patch.thousands !== undefined) {
    numberDisplay.thousands = patch.thousands;
    hasNumberPatch = true;
  }
  if (patch.prefix !== undefined) {
    numberDisplay.prefix = patch.prefix;
    hasNumberPatch = true;
  }
  if (patch.suffix !== undefined) {
    numberDisplay.suffix = patch.suffix;
    hasNumberPatch = true;
  }
  if (patch.allowNegative !== undefined) {
    numberDisplay.allowNegative = patch.allowNegative;
    hasNumberPatch = true;
  }
  if (hasNumberPatch) wirePatch.numberDisplay = numberDisplay;
  return Object.keys(wirePatch).length > 0 ? wirePatch : null;
}

export { columnPatchOf, columnSpecOf };
