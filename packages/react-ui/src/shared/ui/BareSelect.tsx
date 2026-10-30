/**
 * The bare (native) select control: the compact h-8 grid-control look for
 * the database grid and the filter builder. It keeps the native `<select>`
 * semantics (the OS options list, the native keyboard model) — distinct
 * from the radix `Select` menu primitive; the two stand for different
 * control shapes (a compact in-flow select vs the portaled menu).
 */
import * as React from "react";

import { cn } from "./cn";

function BareSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select-bare"
      className={cn(
        "h-8 rounded-md border border-border bg-transparent px-2 text-sm text-foreground outline-none",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { BareSelect };
