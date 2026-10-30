/**
 * The floating field label: the label that floats above its input. The
 * label sits in the input's middle and rises to the top edge on focus or
 * when the field is filled (the `:placeholder-shown` probe via `has-[+input]`
 * — the input must be the label's immediate sibling and carry a
 * placeholder). `filled` forces the floated position regardless of input
 * state (the contentEditable and other non-input elements that do not
 * support `:placeholder-shown`). The wrapper div carries the `group`
 * class (the label tracks the group's focus).
 */
import * as React from "react";

import { RequiredMark } from "./RequiredMark";
import { cn } from "./cn";

interface FloatingLabelOptions {
  title: string;
  /**
   * When true, forces the label in the "floated" position regardless of
   * input state. Use for contentEditable or other non-input elements that
   * don't support :placeholder-shown.
   */
  filled?: boolean;
  /** Required-field marker (red asterisk) right after the title. */
  required?: boolean;
}

function FloatingLabel({
  title,
  htmlFor,
  filled,
  required,
  className,
}: FloatingLabelOptions & React.ComponentProps<"label">) {
  return (
    <label
      htmlFor={htmlFor}
      data-slot="floating-label"
      className={cn(
        "origin-left text-muted-foreground",
        "absolute top-1/2",
        "block -translate-y-1/2 cursor-text px-2 text-sm transition-all duration-300",
        "group-focus-within:text-foreground",
        "group-focus-within:-top-2",
        "group-focus-within:cursor-default",
        "group-focus-within:text-xs",
        "group-focus-within:font-medium",
        "group-focus-within:pointer-events-none",
        "has-[+input:not(:placeholder-shown)]:-top-2",
        "has-[+input:not(:placeholder-shown)]:text-xs",
        "has-[+input:not(:placeholder-shown)]:font-medium",
        "has-[+input:not(:placeholder-shown)]:pointer-events-none",
        "has-[+input:not(:placeholder-shown)]:cursor-default",
        "group-data-image:pl-9",
        filled && ["pointer-events-none -top-2 cursor-default text-xs font-medium text-foreground"],
        className
      )}
    >
      <span
        className={cn(
          "inline-flex rounded-md px-1 py-1",
          "border-ring",
          "group-focus-within:ring-ring/20",
          "group-focus-within:bg-muted/50",
          "group-focus-within:ring-[1px]"
        )}
      >
        {title}
        {required && <RequiredMark />}
      </span>
    </label>
  );
}

export { FloatingLabel };
