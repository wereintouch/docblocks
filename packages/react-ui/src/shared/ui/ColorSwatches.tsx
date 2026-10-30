/**
 * The shared color palette (a single row of circular swatches) — the one
 * primitive behind the format toolbar's text/highlight palette and the
 * shape / connector toolbars' fill + stroke palettes (each keeps its own
 * popover wrapping). A swatch displays its entry (a theme token `var(--…)`
 * or a hex) and, on press, resolves the entry to a concrete hex (the
 * document data holds a hex, never a token) before reporting it.
 *
 * The stand: circular swatches (rounded-full), a thin theme border
 * (`--border`), the selected one bordered in the accent (`--primary`).
 * Two opt-in extras (off by default): the transparent ("no color") swatch
 * (a theme-background circle crossed by a thin `--destructive` line —
 * reports `onSelectNone`) and the custom swatch (a rainbow circle that
 * reports `onCustom`; the full picker it opens is built on first use).
 */
import { useEffect, useState } from "react";

import { cn } from "./cn";
import { normalizeHex, resolveColorToHex } from "./color-utils";

function ColorSwatches({
  colors,
  current,
  onSelect,
  label,
  allowNone = false,
  noneActive = false,
  onSelectNone,
  allowCustom = false,
  onCustom,
}: {
  /** The swatch entries, in display order (a theme token `var(--…)` or a hex). */
  colors: readonly string[];
  /** The current color value (a hex); undefined / null when no color stands. */
  current?: string | null;
  /** Report a color swatch's resolved hex. */
  onSelect: (value: string) => void;
  /** The group's accessible label (the palette's target, e.g. "fill"). */
  label: string;
  /** Render the transparent ("no color") swatch (off by default). */
  allowNone?: boolean;
  /** Whether the none / transparent state stands (the consumer's notion). */
  noneActive?: boolean;
  /** Report the transparent swatch's press (required when `allowNone`). */
  onSelectNone?: () => void;
  /** Render the custom (rainbow) swatch (off by default). */
  allowCustom?: boolean;
  /** Report the custom swatch's press (the picker opens — built on first use). */
  onCustom?: () => void;
}) {
  // The resolved hex per entry (the selected state compares the current
  // value against it). Hex entries resolve synchronously (no DOM); the var
  // entries resolve against the active theme (a detached probe reads the
  // token). Re-resolve when the theme's class flips (the `.dark` toggle)
  // so the selected stand stays correct across the flip.
  const [resolved, setResolved] = useState<readonly (string | null)[]>([]);
  useEffect(() => {
    const resolve = () => setResolved(colors.map((entry) => resolveColorToHex(entry)));
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [colors]);

  const isColorSelected = (entry: string, index: number): boolean => {
    const currentHex = current === null || current === undefined ? null : normalizeHex(current);
    if (currentHex === null) return false;
    const entryHex = normalizeHex(entry) ?? resolved[index] ?? null;
    return entryHex === currentHex;
  };

  const selectSwatch = (entry: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
    const hex = resolveColorToHex(entry, event.currentTarget);
    if (hex !== null) onSelect(hex);
    // An entry that did not resolve (a token with no theme value) is
    // ignored (no write) — the palette is purely a selector.
  };

  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      {colors.map((entry, index) => {
        const selected = isColorSelected(entry, index);
        return (
          <button
            key={index}
            type="button"
            data-slot="docblocks/palette-swatch"
            data-color={entry}
            aria-label={`${label} color ${index + 1}`}
            aria-pressed={selected}
            title={entry}
            className={cn(
              "size-5 shrink-0 rounded-full border",
              selected ? "border-2 border-(--primary)" : "border-(--border)"
            )}
            style={{ background: entry }}
            onClick={selectSwatch(entry)}
          />
        );
      })}
      {allowNone && (
        <button
          type="button"
          data-slot="docblocks/palette-none"
          data-color="none"
          aria-label="No color"
          aria-pressed={noneActive}
          title="No color"
          className={cn(
            "relative size-5 shrink-0 overflow-hidden rounded-full border",
            noneActive ? "border-2 border-(--primary)" : "border-(--border)"
          )}
          style={{ background: "var(--background, #ffffff)" }}
          onClick={onSelectNone}
        >
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 h-px w-7 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-(--destructive)"
          />
        </button>
      )}
      {allowCustom && (
        <button
          type="button"
          data-slot="docblocks/palette-custom"
          data-color="custom"
          aria-label="Custom color"
          title="Custom color"
          className="size-5 shrink-0 rounded-full border border-(--border)"
          style={{
            background: "conic-gradient(red, orange, yellow, green, cyan, blue, magenta, red)",
          }}
          onClick={onCustom}
        />
      )}
    </div>
  );
}

export { ColorSwatches };
