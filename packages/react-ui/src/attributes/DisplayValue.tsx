/** The display stand (a value's read-only rendering — the value zone's
 *  padding, the uniform font size; the mention reference stands its id
 *  over the monospace stand). */
import type { DocAttributeValue } from "docblocks-core";

import { cn } from "../shared/ui/cn";
import { displayTextOf, mentionRefOf, typedValueOf } from "./value-utils";

function DisplayValue({ value, placeholder }: { value: DocAttributeValue | undefined; placeholder: string }) {
  const text = displayTextOf(value);
  if (text === null || text === "")
    return <span className="px-1.5 py-1 text-sm text-muted-foreground">{placeholder}</span>;
  const typed = typedValueOf(value);
  const isMention = mentionRefOf(value) !== null || (typed !== null && typed.type === "mention");
  return <span className={cn("block truncate px-1.5 py-1 text-sm", isMention && "font-mono")}>{text}</span>;
}

export { DisplayValue };
