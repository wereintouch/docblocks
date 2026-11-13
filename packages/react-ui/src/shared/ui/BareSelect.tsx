/**
 * The bare (native) select control: the compact h-8 form-field frame for
 * the filter builder. It keeps the native `<select>` semantics (the OS
 * options list, the native keyboard model) — distinct from the radix
 * `Select` menu primitive; the two stand for different control shapes (a
 * compact in-flow select vs the portaled menu). The frame stands the
 * standard portaled form-field look (the `--input` token's border + the
 * dark's fill — the `Input` / the `Select` trigger's parity), so it reads
 * as a field over the popover's background in both themes.
 */
import * as React from "react";

import { cn } from "./cn";

function BareSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select-bare"
      className={cn(
        "h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none dark:bg-input/30",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { BareSelect };
