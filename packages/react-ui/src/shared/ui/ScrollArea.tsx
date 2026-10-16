import * as React from "react";

import { cn } from "./cn";

/**
 * The thin-scrollbar scroll container: the native scrollbar styled to the
 * theme's border color (`scrollbar-width: thin` + `scrollbar-color`), so a
 * scrollable region never shows the browser's default bar. The focus ring
 * stands for the keyboard scroll (the container takes the focus while a
 * user scrolls it with the keys).
 *
 * React 19: the `ref` stands as a regular prop (ref-as-prop) — the consumer
 * holds a DOM handle of the scroll element (the slash menu's active-item
 * auto-scroll queries through it).
 */
function ScrollArea({ className, ref, ...props }: React.ComponentProps<"div"> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      data-slot="scroll-area"
      className={cn(
        `
          relative scrollbar-thin [scrollbar-color:var(--border)_transparent] overflow-auto outline-none
          focus-visible:ring-[3px] focus-visible:ring-ring/50
        `,
        className
      )}
      {...props}
    />
  );
}

export { ScrollArea };
