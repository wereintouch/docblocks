/**
 * The static form-row label: the grid forms' label + control row (the
 * database's add-column and column-type forms). A plain HTML label — no
 * radix dependency; wrapping a control keeps the native label click
 * focus. The floating variant for the same pattern stands in
 * `FloatingLabel` (the label that rises above its input on focus).
 */
import * as React from "react";

import { cn } from "./cn";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label data-slot="label" className={cn("flex items-center gap-2 text-sm text-foreground", className)} {...props} />
  );
}

export { Label };
