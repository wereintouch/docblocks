/**
 * The text input primitive: the standard field control for the editor's
 * chrome forms. Two sizes: `default` (the standard h-9 field — the header
 * and the portaled forms; the `--input` token frame + the focus ring) and
 * `sm` (the compact h-8 grid-control look the database grid, the filter
 * builder, and the portaled pickers stand — the `--border` token frame,
 * no ring). Two looks: `default` (the framed field) and `inline` (the
 * row's flat field — the in-row editor: no frame / the background / the
 * shadow over the rest, the focus's border stand only). The call site's
 * own classes merge through `cn` (width, focus background, or padding
 * overrides win over the size's stand).
 */
import { type VariantProps, cva } from "class-variance-authority";

import * as React from "react";

import { cn } from "./cn";

const inputVariants = cva(
  `
    h-9 w-full min-w-0 rounded-md border bg-transparent transition-[color,box-shadow] duration-300 outline-none
    selection:bg-primary selection:text-primary-foreground
    file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground
    placeholder:text-muted-foreground
    disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50
    dark:bg-input/30
  `,
  {
    variants: {
      size: {
        default: `
          border-input px-3 py-1 text-base shadow-xs
          focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40
          aria-invalid:border-destructive aria-invalid:ring-destructive/20
          md:text-sm
          dark:aria-invalid:ring-destructive/40
        `,
        sm: `h-8 border-border px-2 py-0.5 text-sm`,
      },
      variant: {
        default: ``,
        // The row's flat field stand (the in-row editor — the panel's
        // value zones / the key's rename): the frame / the background /
        // the shadow stand off over the rest, the focus's border stand
        // only (the row's hover's no-stand parity over the grid's
        // controls).
        inline: `
          h-8 border-transparent bg-transparent px-1.5 py-0.5 text-sm shadow-none
          focus-visible:border-ring focus-visible:ring-0
          aria-invalid:border-destructive
          dark:bg-transparent
        `,
      },
    },
    defaultVariants: { size: "default", variant: "default" },
  }
);

/**
 * The input's props: the native input props minus the native `size`
 * attribute (the number) — it would collide with the size variant
 * (`number & "sm" | "default"` collapses to `undefined`); the variant
 * takes the name. The `variant` axis stands the look (the framed's
 * field / the row's flat field) — it is not a native attribute either.
 */
type InputProps = Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>;

function Input({ className, size, variant, type, ...props }: InputProps) {
  return <input type={type} data-slot="input" className={cn(inputVariants({ size, variant, className }))} {...props} />;
}

export { Input };
